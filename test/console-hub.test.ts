/**
 * Tests for the Console abstraction (Bitsby8 Story 1.6, AD-6): shared TX
 * multiplexer (one source → N subscribers), RX write-through, and duck-typing
 * a console source out of a seed card.
 */

import { ConsoleHub, IConsoleSource, consoleSourceFromCard } from '../src/services/console-hub';

function fakeSource() {
  let emit: (byte: number) => void = () => {};
  const rx: number[] = [];
  const source: IConsoleSource = {
    onOutput: (cb) => { emit = cb; },
    writeByte: (b) => rx.push(b),
  };
  return { source, rx, emit: (b: number) => emit(b) };
}

describe('ConsoleHub — shared TX multiplexer', () => {
  test('fans one source output out to every subscriber', () => {
    const s = fakeSource();
    const hub = new ConsoleHub(s.source);
    const a: number[][] = [];
    const b: number[][] = [];
    hub.subscribe({ onOutput: (d) => a.push([...d]) });
    hub.subscribe({ onOutput: (d) => b.push([...d]) });

    s.emit(0x41); // 'A'
    s.emit(0x3e); // '>'
    expect(a).toEqual([[0x41], [0x3e]]);
    expect(b).toEqual([[0x41], [0x3e]]);
    expect(hub.subscriberCount).toBe(2);
  });

  test('an unsubscribed subscriber stops receiving output', () => {
    const s = fakeSource();
    const hub = new ConsoleHub(s.source);
    const got: number[] = [];
    const off = hub.subscribe({ onOutput: (d) => got.push(d[0]) });
    s.emit(1);
    off();
    s.emit(2);
    expect(got).toEqual([1]);
    expect(hub.subscriberCount).toBe(0);
  });

  test('a throwing subscriber does not stall the machine TX', () => {
    const s = fakeSource();
    const hub = new ConsoleHub(s.source);
    const good: number[] = [];
    hub.subscribe({ onOutput: () => { throw new Error('bad subscriber'); } });
    hub.subscribe({ onOutput: (d) => good.push(d[0]) });
    expect(() => s.emit(0x42)).not.toThrow();
    expect(good).toEqual([0x42]);
  });

  test('write delivers input bytes to the source (RX)', () => {
    const s = fakeSource();
    const hub = new ConsoleHub(s.source);
    hub.write('AB');
    hub.write(Uint8Array.of(0x0d));
    expect(s.rx).toEqual([0x41, 0x42, 0x0d]);
  });
});

describe('ConsoleHub — output buffer (readSince, for MCP request/response)', () => {
  test('buffers output even with no subscribers, and reads from a cursor', () => {
    const s = fakeSource();
    const hub = new ConsoleHub(s.source);
    // No subscriber attached — output must still accumulate for later reads.
    for (const b of 'HI') s.emit(b.charCodeAt(0));

    const first = hub.readSince(0);
    expect(first.data).toBe('HI');
    expect(first.cursor).toBe(2);

    // Reading from the returned cursor yields only new output.
    s.emit('!'.charCodeAt(0));
    const next = hub.readSince(first.cursor);
    expect(next.data).toBe('!');
    expect(next.cursor).toBe(3);

    // A cursor at the end yields nothing new.
    expect(hub.readSince(next.cursor).data).toBe('');
  });

  test('a cursor older than the retained buffer clamps to the buffer start', () => {
    const s = fakeSource();
    const hub = new ConsoleHub(s.source);
    for (let i = 0; i < 70 * 1024; i++) s.emit(0x41); // exceed the 64K cap
    const read = hub.readSince(0); // cursor 0 predates the retained window
    expect(read.cursor).toBe(70 * 1024);
    expect(read.data.length).toBe(64 * 1024); // clamped to retained bytes
    expect(read.data.length).toBeLessThan(70 * 1024);
  });
});

describe('consoleSourceFromCard', () => {
  test('extracts a source from a card exposing a serial channel (channelA)', () => {
    let cb: (byte: number) => void = () => {};
    const rx: number[] = [];
    const card = { id: 'sio', channelA: { onTransmit: (f: (b: number) => void) => { cb = f; }, enqueueRx: (b: number) => rx.push(b) } };
    const source = consoleSourceFromCard(card);
    expect(source).not.toBeNull();
    source!.writeByte(0x5a);
    expect(rx).toEqual([0x5a]);
    const out: number[] = [];
    source!.onOutput((b) => out.push(b));
    cb(0x39);
    expect(out).toEqual([0x39]);
  });

  test('returns null for a card with no console channel', () => {
    expect(consoleSourceFromCard({ id: 'dcdd' })).toBeNull();
    expect(consoleSourceFromCard(null)).toBeNull();
  });
});
