/**
 * Shared wait/read logic for the MCP terminal tools.
 *
 * The terminal is a slow serial line to an Altair 8800 running CP/M, MBASIC,
 * or similar 8-bit software. Callers used to have to guess `waitMs` per command
 * class (short DIR vs. long SURVEY). Adding prompt detection collapses that
 * guessing: return the moment the buffer shows a prompt.
 */

/**
 * Default prompt regex — matches the common return-to-idle signals from
 * CP/M and its interpreters after a command finishes:
 *
 *   - CP/M CCP prompt at start of line: `A>`, `B>`, ... `P>`
 *   - MBASIC / BASIC-80: `Ok` followed by CR/LF (case-insensitive)
 *   - Level II / Extended BASIC: `READY` followed by CR/LF
 *
 * All alternatives require an end-of-line before the prompt so we don't
 * false-match `A>` appearing inside program output.
 */
export const DEFAULT_PROMPT_REGEX = /(?:^|\r|\n)(?:[A-P]>|Ok\r?\n|READY\r?\n|Ready\r?\n)/;

export interface TerminalWaitDeps {
  addMcpDataListener(fn: (data: Buffer) => void): void;
  removeMcpDataListener(fn: (data: Buffer) => void): void;
  readMcpBuffer(): Buffer;
  clearMcpBuffer(): void;
}

export interface WaitOptions {
  /** Hard timeout in ms (safety cap). Defaults to 5000 when a match is expected, else 0. */
  waitMs?: number;
  /** Return once no new bytes arrive for this many ms. Default 200. */
  idleMs?: number;
  /** Explicit regex to match against the accumulated buffer. Returns as soon as it matches. */
  until?: RegExp;
  /** If true and no `until` provided, use DEFAULT_PROMPT_REGEX. */
  awaitPrompt?: boolean;
}

export interface WaitResult {
  output: Buffer;
  matched: boolean;
  reason: 'match' | 'idle' | 'timeout' | 'no-wait';
}

/**
 * Compile a caller-provided regex string to a RegExp, or throw a friendly error.
 */
export function compileUntil(until: string): RegExp {
  try {
    return new RegExp(until);
  } catch (err) {
    throw new Error(`Invalid until regex: ${(err as Error).message}`);
  }
}

/**
 * Resolve which regex (if any) should terminate the wait early.
 */
export function resolvePromptRegex(opts: Pick<WaitOptions, 'until' | 'awaitPrompt'>): RegExp | null {
  if (opts.until) return opts.until;
  if (opts.awaitPrompt) return DEFAULT_PROMPT_REGEX;
  return null;
}

/**
 * Wait for terminal output using idle detection, an optional prompt match,
 * and a hard-timeout safety cap. Reads and returns the accumulated buffer.
 */
export async function waitForTerminalOutput(
  deps: TerminalWaitDeps,
  opts: WaitOptions
): Promise<WaitResult> {
  const promptRe = resolvePromptRegex(opts);
  const hasMatcher = promptRe !== null;
  const idleMs = opts.idleMs ?? 200;
  const waitMs = opts.waitMs ?? (hasMatcher ? 5000 : 0);

  if (waitMs <= 0) {
    const output = deps.readMcpBuffer();
    return { output, matched: false, reason: 'no-wait' };
  }

  let reason: WaitResult['reason'] = 'timeout' as WaitResult['reason'];
  let listener: ((data: Buffer) => void) | null = null;

  await new Promise<void>((resolve) => {
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const finish = (why: WaitResult['reason']) => {
      if (settled) return;
      settled = true;
      reason = why;
      if (idleTimer) clearTimeout(idleTimer);
      clearTimeout(hardTimer);
      resolve();
    };

    const hardTimer = setTimeout(() => finish('timeout'), waitMs);

    const checkMatch = () => {
      if (!promptRe) return false;
      const text = deps.readMcpBuffer().toString('latin1');
      return promptRe.test(text);
    };

    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish('idle'), idleMs);
    };

    listener = () => {
      if (checkMatch()) {
        finish('match');
        return;
      }
      resetIdle();
    };
    deps.addMcpDataListener(listener);

    // Buffer may already contain matching output from before we started waiting.
    if (checkMatch()) {
      finish('match');
      return;
    }
    resetIdle();
  });

  if (listener) deps.removeMcpDataListener(listener);
  const output = deps.readMcpBuffer();
  return { output, matched: reason === 'match', reason };
}
