/**
 * WebSocket FDC transport — lets a virtual Altair FDC controller connect
 * over WebSocket instead of a physical serial port.
 *
 * The wire format is the same as the serial protocol (8-byte command/response
 * blocks, raw track data) but without the 2-byte checksum trailer that the
 * serial transport appends — WebSocket/TCP provides reliable delivery.
 */

import { WebSocket, RawData } from 'ws';
import { IFdcTransport } from './transport';

export class WsTransportManager implements IFdcTransport {
  private ws: WebSocket | null = null;
  private rxBuffer: Buffer = Buffer.alloc(0);
  private dataWaiters: Array<() => void> = [];

  /**
   * Accept an incoming WebSocket connection as the active FDC transport.
   * Any previous connection is closed first.
   */
  acceptConnection(ws: WebSocket): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
    this.ws = ws;
    this.rxBuffer = Buffer.alloc(0);

    ws.on('message', (data: RawData) => {
      let chunk: Buffer;
      if (Buffer.isBuffer(data)) {
        chunk = data;
      } else if (data instanceof ArrayBuffer) {
        chunk = Buffer.from(data);
      } else {
        chunk = Buffer.concat(data as Buffer[]);
      }
      this.rxBuffer = Buffer.concat([this.rxBuffer, chunk]);
      const waiters = this.dataWaiters.splice(0);
      waiters.forEach(w => w());
    });

    ws.on('close', () => {
      if (this.ws === ws) {
        this.ws = null;
      }
      const waiters = this.dataWaiters.splice(0);
      waiters.forEach(w => w());
    });

    ws.on('error', (err) => {
      console.error('[WsTransport] WebSocket error:', err.message);
    });
  }

  isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  async sendBuffer(data: Buffer, timeoutMs: number): Promise<void> {
    if (!this.isOpen()) {
      throw new Error('WebSocket transport not open');
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Timeout sending buffer')),
        timeoutMs
      );
      this.ws!.send(data, (err) => {
        clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async receiveBuffer(length: number, timeoutMs: number): Promise<Buffer> {
    const deadline = Date.now() + timeoutMs;

    while (true) {
      if (this.rxBuffer.length >= length) {
        const result = this.rxBuffer.slice(0, length);
        this.rxBuffer = this.rxBuffer.slice(length);
        return result;
      }

      if (!this.isOpen()) {
        throw new Error('WebSocket transport closed');
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(
          `Timeout receiving buffer at byte ${this.rxBuffer.length}/${length}`
        );
      }

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = this.dataWaiters.indexOf(resolve);
          if (idx >= 0) this.dataWaiters.splice(idx, 1);
          reject(
            new Error(
              `Timeout receiving buffer at byte ${this.rxBuffer.length}/${length}`
            )
          );
        }, remaining);

        const wakeup = () => {
          clearTimeout(timer);
          resolve();
        };
        this.dataWaiters.push(wakeup);
      });
    }
  }
}

let wsTransportManagerInstance: WsTransportManager | null = null;

export function getWsTransportManager(): WsTransportManager {
  if (!wsTransportManagerInstance) {
    wsTransportManagerInstance = new WsTransportManager();
  }
  return wsTransportManagerInstance;
}
