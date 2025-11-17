"use strict";
/**
 * Serial Port Communication Module
 * Handles communication with FDC+ controller via serial port
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SerialPortManager = void 0;
exports.getSerialPortManager = getSerialPortManager;
const serialport_1 = require("serialport");
const protocol_1 = require("./protocol");
const protocol_2 = require("./protocol");
/**
 * Serial Port Manager for FDC+ communication
 */
class SerialPortManager {
    port;
    device;
    baudRate;
    dataBuffer;
    dataResolvers;
    constructor() {
        this.port = null;
        this.device = null;
        this.baudRate = protocol_1.BaudRate.B460800;
        this.dataBuffer = Buffer.alloc(0);
        this.dataResolvers = [];
    }
    /**
     * Open serial port with specified device and baud rate
     */
    async openPort(device, baudRate) {
        if (!device) {
            throw new Error('Device path is required');
        }
        this.device = device;
        this.baudRate = baudRate;
        return new Promise((resolve, reject) => {
            this.port = new serialport_1.SerialPort({
                path: device,
                baudRate: baudRate,
                dataBits: 8,
                stopBits: 1,
                parity: 'none',
                // Critical: Disable ALL flow control to match C version
                rtscts: false, // No RTS/CTS hardware flow control
                xon: false, // No XON/XOFF software flow control
                xoff: false,
                xany: false,
                // Non-blocking I/O
                autoOpen: true,
                lock: false,
            }, (error) => {
                if (error) {
                    reject(error);
                }
                else {
                    // Flush input buffer to match C version's tcflush(fd, TCIFLUSH)
                    this.port?.flush((flushErr) => {
                        if (flushErr) {
                            console.warn('Flush warning:', flushErr.message);
                        }
                    });
                    resolve();
                }
            });
            // Setup error handler
            this.port.on('error', (err) => {
                console.error('Serial port error:', err);
            });
            // Setup data handler to buffer incoming data
            this.port.on('data', (data) => {
                // Append new data to buffer
                this.dataBuffer = Buffer.concat([this.dataBuffer, data]);
                // Resolve any pending byte requests
                while (this.dataBuffer.length > 0 && this.dataResolvers.length > 0) {
                    const resolver = this.dataResolvers.shift();
                    const byte = this.dataBuffer[0];
                    this.dataBuffer = this.dataBuffer.slice(1);
                    if (resolver) {
                        resolver(byte);
                    }
                }
            });
        });
    }
    /**
     * Close serial port
     */
    async closePort() {
        if (!this.port || !this.port.isOpen) {
            return;
        }
        // Clear buffers and resolvers
        this.dataBuffer = Buffer.alloc(0);
        this.dataResolvers = [];
        return new Promise((resolve, reject) => {
            this.port.close((error) => {
                if (error) {
                    reject(error);
                }
                else {
                    this.port = null;
                    resolve();
                }
            });
        });
    }
    /**
     * Check if port is open
     */
    isOpen() {
        return this.port !== null && this.port.isOpen;
    }
    /**
     * Get device path
     */
    getDevice() {
        return this.device;
    }
    /**
     * Get baud rate
     */
    getBaudRate() {
        return this.baudRate;
    }
    /**
     * Receive a single byte with timeout
     */
    async receiveByte(timeoutMs = protocol_1.TIMEOUT_BYTE) {
        if (!this.port || !this.port.isOpen) {
            throw new Error('Serial port not open');
        }
        return new Promise((resolve, reject) => {
            // If data is already buffered, return immediately
            if (this.dataBuffer.length > 0) {
                const byte = this.dataBuffer[0];
                this.dataBuffer = this.dataBuffer.slice(1);
                resolve(byte);
                return;
            }
            // Setup timeout
            const timer = setTimeout(() => {
                // Remove resolver from queue
                const index = this.dataResolvers.indexOf(resolverFn);
                if (index >= 0) {
                    this.dataResolvers.splice(index, 1);
                }
                reject(new Error('Timeout receiving byte'));
            }, timeoutMs);
            // Create resolver function
            const resolverFn = (byte) => {
                clearTimeout(timer);
                resolve(byte);
            };
            // Add to resolver queue
            this.dataResolvers.push(resolverFn);
        });
    }
    /**
     * Receive buffer with checksum verification
     */
    async receiveBuffer(length, timeoutMs = protocol_1.TIMEOUT_BUFFER) {
        if (!this.port || !this.port.isOpen) {
            throw new Error('Serial port not open');
        }
        const buffer = Buffer.alloc(length);
        let bytesReceived = 0;
        // Receive requested length
        while (bytesReceived < length) {
            try {
                const byte = await this.receiveByte(timeoutMs);
                buffer[bytesReceived++] = byte;
            }
            catch (error) {
                throw new Error(`Timeout receiving buffer at byte ${bytesReceived}/${length}`);
            }
        }
        // Receive checksum (2 bytes: LSB, MSB)
        let checksumLsb;
        let checksumMsb;
        try {
            checksumLsb = await this.receiveByte(1000);
            checksumMsb = await this.receiveByte(1000);
        }
        catch (error) {
            throw new Error('Timeout receiving checksum');
        }
        const receivedChecksum = protocol_2.ByteUtils.WORD(checksumLsb, checksumMsb);
        const calculatedChecksum = this.calculateChecksum(buffer);
        if (receivedChecksum !== calculatedChecksum) {
            throw new Error(`Checksum mismatch: received 0x${receivedChecksum.toString(16)}, ` +
                `calculated 0x${calculatedChecksum.toString(16)}`);
        }
        return buffer;
    }
    /**
     * Send buffer with checksum appended
     */
    async sendBuffer(buffer, timeoutMs = protocol_1.TIMEOUT_BUFFER) {
        if (!this.port || !this.port.isOpen) {
            throw new Error('Serial port not open');
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error('Timeout sending buffer'));
            }, timeoutMs);
            // Calculate checksum
            const checksum = this.calculateChecksum(buffer);
            const checksumLsb = protocol_2.ByteUtils.LSB(checksum);
            const checksumMsb = protocol_2.ByteUtils.MSB(checksum);
            // Create buffer with checksum appended
            const dataWithChecksum = Buffer.alloc(buffer.length + 2);
            buffer.copy(dataWithChecksum, 0);
            dataWithChecksum[buffer.length] = checksumLsb;
            dataWithChecksum[buffer.length + 1] = checksumMsb;
            // Send data
            this.port.write(dataWithChecksum, (error) => {
                clearTimeout(timer);
                if (error) {
                    reject(error);
                }
                else {
                    // Wait for data to be transmitted (drain)
                    this.port.drain((drainError) => {
                        if (drainError) {
                            reject(drainError);
                        }
                        else {
                            resolve();
                        }
                    });
                }
            });
        });
    }
    /**
     * Calculate 16-bit checksum
     */
    calculateChecksum(buffer) {
        let checksum = 0;
        for (let i = 0; i < buffer.length; i++) {
            checksum += buffer[i];
        }
        // Ensure 16-bit result
        return checksum & 0xffff;
    }
    /**
     * Flush serial port buffers
     */
    async flush() {
        if (!this.port || !this.port.isOpen) {
            return;
        }
        // Clear our internal buffer
        this.dataBuffer = Buffer.alloc(0);
        return new Promise((resolve, reject) => {
            this.port.flush((error) => {
                if (error) {
                    reject(error);
                }
                else {
                    resolve();
                }
            });
        });
    }
}
exports.SerialPortManager = SerialPortManager;
/**
 * Global serial port manager instance (singleton)
 */
let serialPortManagerInstance = null;
function getSerialPortManager() {
    if (!serialPortManagerInstance) {
        serialPortManagerInstance = new SerialPortManager();
    }
    return serialPortManagerInstance;
}
//# sourceMappingURL=serial.js.map