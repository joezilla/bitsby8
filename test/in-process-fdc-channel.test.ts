/**
 * Tests for the in-process FDC frame channel (Bitsby8 Story 1.4): the byte
 * semantics the strict request/response FDC protocol depends on.
 */

import { InProcessFdcChannel } from '../src/services/in-process-fdc-channel';

describe('InProcessFdcChannel', () => {
  test('reassembles client bytes into a complete N-byte frame on the server', async () => {
    const ch = new InProcessFdcChannel();
    ch.send(new Uint8Array([1, 2, 3]));
    ch.send(new Uint8Array([4, 5]));
    const buf = await ch.server.receiveBuffer(5, 1000);
    expect([...buf]).toEqual([1, 2, 3, 4, 5]);
  });

  test('receiveBuffer blocks until enough bytes arrive, preserving order', async () => {
    const ch = new InProcessFdcChannel();
    const p = ch.server.receiveBuffer(3, 1000);
    setTimeout(() => {
      ch.send(new Uint8Array([9]));
      ch.send(new Uint8Array([8, 7]));
    }, 5);
    expect([...(await p)]).toEqual([9, 8, 7]);
  });

  test('leaves surplus bytes buffered for the next receive', async () => {
    const ch = new InProcessFdcChannel();
    ch.send(new Uint8Array([1, 2, 3, 4]));
    expect([...(await ch.server.receiveBuffer(2, 100))]).toEqual([1, 2]);
    expect([...(await ch.server.receiveBuffer(2, 100))]).toEqual([3, 4]);
  });

  test('server→client delivery is non-reentrant (never synchronous within sendBuffer)', async () => {
    const ch = new InProcessFdcChannel();
    const got: number[][] = [];
    ch.onmessage = (ev) => got.push([...new Uint8Array(ev.data as Uint8Array)]);
    const p = ch.server.sendBuffer(Buffer.from([1, 2]), 1000);
    expect(got).toHaveLength(0); // synchronous check: not delivered during the call
    await p;
    await new Promise((r) => setTimeout(r, 0));
    expect(got).toEqual([[1, 2]]);
  });

  test('multiple server frames arrive in order', async () => {
    const ch = new InProcessFdcChannel();
    const got: number[][] = [];
    ch.onmessage = (ev) => got.push([...new Uint8Array(ev.data as Uint8Array)]);
    await ch.server.sendBuffer(Buffer.from([1, 2]), 1000);
    await ch.server.sendBuffer(Buffer.from([3, 4]), 1000);
    await new Promise((r) => setTimeout(r, 0));
    expect(got).toEqual([[1, 2], [3, 4]]);
  });

  test('receiveBuffer times out when bytes never arrive', async () => {
    const ch = new InProcessFdcChannel();
    await expect(ch.server.receiveBuffer(4, 20)).rejects.toThrow(/Timeout/);
  });

  test('close unblocks a pending receive, flips readyState, and fires hooks', async () => {
    const ch = new InProcessFdcChannel();
    let clientClosed = false;
    let hookFired = false;
    ch.onclose = () => {
      clientClosed = true;
    };
    ch.setOnClose(() => {
      hookFired = true;
    });
    const p = ch.server.receiveBuffer(4, 1000);
    ch.close();
    await expect(p).rejects.toThrow(/closed/);
    expect(hookFired).toBe(true);
    expect(ch.readyState).toBe(3);
    await new Promise((r) => setTimeout(r, 0));
    expect(clientClosed).toBe(true);
  });

  test('send after close is a no-op; sendBuffer rejects after close', async () => {
    const ch = new InProcessFdcChannel();
    ch.close();
    expect(() => ch.send(new Uint8Array([1]))).not.toThrow();
    await expect(ch.server.sendBuffer(Buffer.from([1]), 100)).rejects.toThrow(/closed/);
  });
});
