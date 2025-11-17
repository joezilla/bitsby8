/**
 * Serial Port Communication Module
 * Handles communication with FDC+ controller via serial port
 */
import { BaudRate } from './protocol';
/**
 * Serial Port Manager for FDC+ communication
 */
export declare class SerialPortManager {
    private port;
    private device;
    private baudRate;
    private dataBuffer;
    private dataResolvers;
    constructor();
    /**
     * Open serial port with specified device and baud rate
     */
    openPort(device: string, baudRate: BaudRate): Promise<void>;
    /**
     * Close serial port
     */
    closePort(): Promise<void>;
    /**
     * Check if port is open
     */
    isOpen(): boolean;
    /**
     * Get device path
     */
    getDevice(): string | null;
    /**
     * Get baud rate
     */
    getBaudRate(): BaudRate;
    /**
     * Receive a single byte with timeout
     */
    receiveByte(timeoutMs?: number): Promise<number>;
    /**
     * Receive buffer with checksum verification
     */
    receiveBuffer(length: number, timeoutMs?: number): Promise<Buffer>;
    /**
     * Send buffer with checksum appended
     */
    sendBuffer(buffer: Buffer, timeoutMs?: number): Promise<void>;
    /**
     * Calculate 16-bit checksum
     */
    calculateChecksum(buffer: Buffer): number;
    /**
     * Flush serial port buffers
     */
    flush(): Promise<void>;
}
export declare function getSerialPortManager(): SerialPortManager;
//# sourceMappingURL=serial.d.ts.map