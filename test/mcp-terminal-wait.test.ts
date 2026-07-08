/**
 * Unit tests for the MCP terminal wait helper.
 *
 * Covers the prompt regex, `until` compilation, and the wait-loop's
 * three exits: prompt match, idle settle, and hard timeout.
 */

import {
  DEFAULT_PROMPT_REGEX,
  compileUntil,
  resolvePromptRegex,
  waitForTerminalOutput,
  TerminalWaitDeps,
} from '../src/mcp-terminal-wait';

/**
 * Fake terminal manager that lets tests push bytes into the MCP buffer
 * and notifies the registered listener (mirrors terminal-serial.ts).
 */
function createFakeTerminal(): TerminalWaitDeps & { push: (b: Buffer | string) => void } {
  const chunks: Buffer[] = [];
  const listeners: Array<(data: Buffer) => void> = [];
  return {
    readMcpBuffer: () => Buffer.concat(chunks),
    clearMcpBuffer: () => { chunks.length = 0; },
    addMcpDataListener: (fn) => { listeners.push(fn); },
    removeMcpDataListener: (fn) => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    push: (b) => {
      const buf = Buffer.isBuffer(b) ? b : Buffer.from(b);
      chunks.push(buf);
      // Copy listeners so a listener that unregisters itself doesn't skip peers.
      [...listeners].forEach(fn => fn(buf));
    },
  };
}

describe('DEFAULT_PROMPT_REGEX', () => {
  it.each([
    ['A>', '\r\nA>'],
    ['B>', 'PIP\r\nB>'],
    ['P>', 'noise\nP>'],
    ['Ok CRLF', 'PRINT "HI"\r\nHI\r\nOk\r\n'],
    ['Ok LF only', 'HI\nOk\n'],
    ['READY', 'PROGRAM END\r\nREADY\r\n'],
    ['Ready mixed case', 'PROGRAM END\r\nReady\r\n'],
  ])('matches %s', (_label, input) => {
    expect(DEFAULT_PROMPT_REGEX.test(input)).toBe(true);
  });

  it.each([
    ['A> embedded mid-line', 'the arrow A>= is not a prompt'],
    ['Ok without EOL', 'this is Okay'],
    ['Q> outside CP/M range', '\r\nQ>'],
    ['lowercase ok not at line start followed by CR/LF', 'lookOk'],
  ])('does not match %s', (_label, input) => {
    expect(DEFAULT_PROMPT_REGEX.test(input)).toBe(false);
  });
});

describe('compileUntil', () => {
  it('returns a RegExp for a valid pattern', () => {
    const re = compileUntil('hello\\s+world');
    expect(re.test('hello  world')).toBe(true);
  });

  it('throws a friendly error for invalid regex', () => {
    expect(() => compileUntil('([)')).toThrow(/Invalid until regex/);
  });
});

describe('resolvePromptRegex', () => {
  it('prefers explicit until over awaitPrompt', () => {
    const custom = /XYZ/;
    expect(resolvePromptRegex({ until: custom, awaitPrompt: true })).toBe(custom);
  });

  it('falls back to DEFAULT_PROMPT_REGEX when awaitPrompt is set', () => {
    expect(resolvePromptRegex({ awaitPrompt: true })).toBe(DEFAULT_PROMPT_REGEX);
  });

  it('returns null when neither is set', () => {
    expect(resolvePromptRegex({})).toBeNull();
  });
});

describe('waitForTerminalOutput', () => {
  it('returns immediately with reason=no-wait when waitMs is 0 and no matcher', async () => {
    const term = createFakeTerminal();
    term.push('pending output\r\n');
    const t0 = Date.now();
    const res = await waitForTerminalOutput(term, { waitMs: 0 });
    expect(Date.now() - t0).toBeLessThan(50);
    expect(res.reason).toBe('no-wait');
    expect(res.matched).toBe(false);
    expect(res.output.toString('latin1')).toBe('pending output\r\n');
  });

  it('exits with reason=match when prompt appears mid-wait', async () => {
    const term = createFakeTerminal();
    // Schedule bytes to arrive after the wait starts.
    setTimeout(() => term.push('DIR\r\nA.COM B.COM\r\n'), 10);
    setTimeout(() => term.push('A>'), 30);

    const res = await waitForTerminalOutput(term, {
      awaitPrompt: true,
      waitMs: 2000,
      idleMs: 500,
    });

    expect(res.reason).toBe('match');
    expect(res.matched).toBe(true);
    expect(res.output.toString('latin1')).toContain('A>');
  });

  it('detects a prompt that is already buffered when the wait begins', async () => {
    const term = createFakeTerminal();
    term.push('welcome banner\r\nA>');
    const res = await waitForTerminalOutput(term, {
      awaitPrompt: true,
      waitMs: 2000,
      idleMs: 500,
    });
    expect(res.reason).toBe('match');
    expect(res.matched).toBe(true);
  });

  it('exits with reason=idle when bytes arrive but no prompt matches', async () => {
    const term = createFakeTerminal();
    setTimeout(() => term.push('partial output '), 5);
    setTimeout(() => term.push('more output '), 20);
    const res = await waitForTerminalOutput(term, {
      awaitPrompt: true,
      waitMs: 2000,
      idleMs: 100,
    });
    expect(res.reason).toBe('idle');
    expect(res.matched).toBe(false);
    expect(res.output.toString('latin1')).toBe('partial output more output ');
  });

  it('honors an explicit until regex over the default prompt', async () => {
    const term = createFakeTerminal();
    setTimeout(() => term.push('LOADING... '), 5);
    setTimeout(() => term.push('READY!'), 15);
    const res = await waitForTerminalOutput(term, {
      until: /READY!/,
      waitMs: 2000,
      idleMs: 500,
    });
    expect(res.reason).toBe('match');
    expect(res.matched).toBe(true);
  });

  it('exits with reason=timeout when nothing arrives before waitMs', async () => {
    const term = createFakeTerminal();
    const t0 = Date.now();
    const res = await waitForTerminalOutput(term, {
      awaitPrompt: true,
      waitMs: 100,
      idleMs: 500,
    });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(90);
    expect(res.reason).toBe('timeout');
    expect(res.matched).toBe(false);
    expect(res.output.length).toBe(0);
  });

  it('removes its data listener on exit', async () => {
    const term = createFakeTerminal();
    const listeners: Array<(d: Buffer) => void> = [];
    const spy: TerminalWaitDeps = {
      readMcpBuffer: term.readMcpBuffer,
      clearMcpBuffer: term.clearMcpBuffer,
      addMcpDataListener: (fn) => { listeners.push(fn); term.addMcpDataListener(fn); },
      removeMcpDataListener: (fn) => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
        term.removeMcpDataListener(fn);
      },
    };
    await waitForTerminalOutput(spy, { waitMs: 50, idleMs: 500 });
    expect(listeners).toHaveLength(0);
  });
});
