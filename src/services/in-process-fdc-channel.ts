/**
 * In-process FDC frame channel (Bitsby8 Story 1.4).
 *
 * A local virtual Machine Instance reaches the disk-serving layer over this
 * in-memory duplex instead of a TCP WebSocket — same FDC protocol, same
 * per-client copy-on-write serving (AD-3). One end is a {@link WebSocketLike}
 * (handed to 8sim's `FdcPlusClient`/`MitsDcddCard`); the other is an
 * {@link IFdcTransport} (handed to the server's `FdcServer` loop).
 *
 * Guarantees the FDC protocol depends on (matching WsTransportManager):
 *  - ordered, complete-frame delivery (receiveBuffer accumulates until N bytes);
 *  - non-reentrant server→client delivery (scheduled on a microtask, never
 *    synchronously re-entering a send);
 *  - unbounded in-memory buffering (no head-of-line drop) with timeout-aware
 *    receive.
 */

import type { WebSocketLike } from '@joezilla/8sim';
import { IFdcTransport } from '../transport';

const OPEN = 1;
const CLOSED = 3;

export class InProcessFdcChannel {
  /** Bytes the client has sent, awaiting the server's receiveBuffer. */
  private c2s: Buffer = Buffer.alloc(0);
  private waiters: Array<() => void> = [];
  private open = true;
  private closeHook?: () => void;

  // --- client-side WebSocketLike callback slots (set by FdcPlusClient) ---
  onmessage: ((ev: { data: ArrayBuffer | Uint8Array }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;

  /** The client end, structurally a WebSocketLike, handed to the emulated card. */
  get client(): WebSocketLike {
    return this as unknown as WebSocketLike;
  }

  // WebSocketLike.send — client → server.
  send(data: Uint8Array): void {
    if (!this.open) return;
    this.c2s = Buffer.concat([this.c2s, Buffer.from(data)]);
    this.wake();
  }

  // WebSocketLike.readyState / close.
  get readyState(): number {
    return this.open ? OPEN : CLOSED;
  }
  close(): void {
    this.shutdown();
  }

  /** The server end handed to FdcServer. */
  readonly server: IFdcTransport = {
    isOpen: () => this.open,

    sendBuffer: async (data: Buffer, _timeoutMs: number): Promise<void> => {
      if (!this.open) throw new Error('in-process FDC channel closed');
      const copy = new Uint8Array(data); // detach from the shared buffer
      // Non-reentrant: never deliver synchronously inside sendBuffer.
      queueMicrotask(() => {
        if (this.open) this.onmessage?.({ data: copy });
      });
    },

    receiveBuffer: async (length: number, timeoutMs: number): Promise<Buffer> => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (this.c2s.length >= length) {
          const out = Buffer.from(this.c2s.subarray(0, length));
          this.c2s = this.c2s.subarray(length);
          return out;
        }
        if (!this.open) throw new Error('in-process FDC channel closed');
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          throw new Error(`Timeout receiving buffer at byte ${this.c2s.length}/${length}`);
        }
        await new Promise<void>((resolve) => {
          const onData = () => {
            clearTimeout(timer);
            resolve();
          };
          const timer = setTimeout(() => {
            const i = this.waiters.indexOf(onData);
            if (i >= 0) this.waiters.splice(i, 1);
            resolve();
          }, remaining);
          this.waiters.push(onData);
        });
      }
    },
  };

  /** Register a teardown hook (ConnectionManager wires this to remove()). */
  setOnClose(cb: () => void): void {
    this.closeHook = cb;
  }

  private wake(): void {
    const woken = this.waiters.splice(0);
    woken.forEach((w) => w());
  }

  private shutdown(): void {
    if (!this.open) return;
    this.open = false;
    this.wake(); // unblock any pending receiveBuffer so the loop exits
    queueMicrotask(() => this.onclose?.());
    this.closeHook?.();
  }
}
