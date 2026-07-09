/**
 * FDC transport interface — abstracts serial and WebSocket transports.
 * Implementations handle their own framing (e.g. checksums on serial);
 * callers (FdcServer) always deal in plain data bytes.
 */
export interface IFdcTransport {
  sendBuffer(data: Buffer, timeoutMs: number): Promise<void>;
  receiveBuffer(length: number, timeoutMs: number): Promise<Buffer>;
  isOpen(): boolean;
}
