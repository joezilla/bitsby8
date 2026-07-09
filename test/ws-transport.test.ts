import { EventEmitter } from 'events';
import { WsTransportManager } from '../src/ws-transport';

// Minimal WebSocket mock that satisfies the interface WsTransportManager uses.
class MockWebSocket extends EventEmitter {
  static OPEN = 1;
  static CLOSED = 3;

  readyState: number;
  send: jest.Mock;
  close: jest.Mock;

  constructor(open = true) {
    super();
    this.readyState = open ? MockWebSocket.OPEN : MockWebSocket.CLOSED;
    this.send = jest.fn((_data: Buffer, cb?: (err?: Error) => void) => {
      if (cb) cb(undefined);
    });
    this.close = jest.fn(() => {
      this.readyState = MockWebSocket.CLOSED;
      this.emit('close');
    });
  }
}

function makeTransport() {
  return new WsTransportManager();
}

describe('WsTransportManager', () => {
  describe('isOpen', () => {
    test('returns false with no connection', () => {
      const t = makeTransport();
      expect(t.isOpen()).toBe(false);
    });

    test('returns true after acceptConnection with open socket', () => {
      const t = makeTransport();
      const ws = new MockWebSocket(true);
      t.acceptConnection(ws as any);
      expect(t.isOpen()).toBe(true);
    });

    test('returns false after socket closes', () => {
      const t = makeTransport();
      const ws = new MockWebSocket(true);
      t.acceptConnection(ws as any);
      ws.close();
      expect(t.isOpen()).toBe(false);
    });
  });

  describe('acceptConnection', () => {
    test('replaces a previous connection', () => {
      const t = makeTransport();
      const ws1 = new MockWebSocket(true);
      const ws2 = new MockWebSocket(true);

      t.acceptConnection(ws1 as any);
      expect(t.isOpen()).toBe(true);

      t.acceptConnection(ws2 as any);
      expect(t.isOpen()).toBe(true);
      expect(ws1.close).toHaveBeenCalled();
    });

    test('resets rx buffer on new connection', async () => {
      const t = makeTransport();
      const ws1 = new MockWebSocket(true);
      t.acceptConnection(ws1 as any);

      // Push partial data on first connection
      ws1.emit('message', Buffer.from([0x01, 0x02]));

      // Connect a new client — buffer should be cleared
      const ws2 = new MockWebSocket(true);
      t.acceptConnection(ws2 as any);

      // Send a full 2-byte payload on the new connection
      ws2.emit('message', Buffer.from([0xAA, 0xBB]));
      const result = await t.receiveBuffer(2, 100);
      expect(result).toEqual(Buffer.from([0xAA, 0xBB]));
    });
  });

  describe('receiveBuffer', () => {
    test('returns data that arrives before the call', async () => {
      const t = makeTransport();
      const ws = new MockWebSocket(true);
      t.acceptConnection(ws as any);

      ws.emit('message', Buffer.from([0x53, 0x54, 0x41, 0x54, 0x00, 0x00, 0x00, 0x00]));
      const result = await t.receiveBuffer(8, 100);
      expect(result.length).toBe(8);
      expect(result.toString('ascii', 0, 4)).toBe('STAT');
    });

    test('waits for data and resolves when it arrives', async () => {
      const t = makeTransport();
      const ws = new MockWebSocket(true);
      t.acceptConnection(ws as any);

      const promise = t.receiveBuffer(4, 500);
      // Deliver data asynchronously
      setImmediate(() => ws.emit('message', Buffer.from([0x01, 0x02, 0x03, 0x04])));

      const result = await promise;
      expect(result).toEqual(Buffer.from([0x01, 0x02, 0x03, 0x04]));
    });

    test('accumulates fragmented frames', async () => {
      const t = makeTransport();
      const ws = new MockWebSocket(true);
      t.acceptConnection(ws as any);

      const promise = t.receiveBuffer(4, 500);
      setImmediate(() => {
        ws.emit('message', Buffer.from([0x01, 0x02]));
        ws.emit('message', Buffer.from([0x03, 0x04]));
      });

      const result = await promise;
      expect(result).toEqual(Buffer.from([0x01, 0x02, 0x03, 0x04]));
    });

    test('leaves extra bytes in buffer for the next call', async () => {
      const t = makeTransport();
      const ws = new MockWebSocket(true);
      t.acceptConnection(ws as any);

      ws.emit('message', Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]));

      const first = await t.receiveBuffer(4, 100);
      const second = await t.receiveBuffer(2, 100);
      expect(first).toEqual(Buffer.from([0x01, 0x02, 0x03, 0x04]));
      expect(second).toEqual(Buffer.from([0x05, 0x06]));
    });

    test('rejects on timeout when no data arrives', async () => {
      const t = makeTransport();
      const ws = new MockWebSocket(true);
      t.acceptConnection(ws as any);

      await expect(t.receiveBuffer(4, 50)).rejects.toThrow('Timeout');
    });

    test('rejects when transport is not open', async () => {
      const t = makeTransport();
      await expect(t.receiveBuffer(4, 100)).rejects.toThrow('closed');
    });

    test('rejects when socket closes while waiting', async () => {
      const t = makeTransport();
      const ws = new MockWebSocket(true);
      t.acceptConnection(ws as any);

      const promise = t.receiveBuffer(8, 1000);
      setImmediate(() => ws.emit('close'));

      await expect(promise).rejects.toThrow();
    });
  });

  describe('sendBuffer', () => {
    test('sends data as a binary WebSocket frame', async () => {
      const t = makeTransport();
      const ws = new MockWebSocket(true);
      t.acceptConnection(ws as any);

      const data = Buffer.from([0x52, 0x45, 0x41, 0x44, 0x00, 0x10, 0x20, 0x11]);
      await t.sendBuffer(data, 100);

      expect(ws.send).toHaveBeenCalledWith(data, expect.any(Function));
    });

    test('rejects when transport is not open', async () => {
      const t = makeTransport();
      await expect(t.sendBuffer(Buffer.from([1, 2]), 100)).rejects.toThrow('not open');
    });

    test('rejects when send callback returns an error', async () => {
      const t = makeTransport();
      const ws = new MockWebSocket(true);
      ws.send = jest.fn((_d: Buffer, cb?: (err?: Error) => void) => {
        if (cb) cb(new Error('send failed'));
      });
      t.acceptConnection(ws as any);

      await expect(t.sendBuffer(Buffer.from([1]), 100)).rejects.toThrow('send failed');
    });
  });
});
