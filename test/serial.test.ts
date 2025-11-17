/**
 * Serial Port Manager Unit Tests
 */

import { BaudRate } from '../src/protocol';
import { EventEmitter } from 'events';

// Mock SerialPort - defined before the mock setup
const mockSerialPortInstances: any[] = [];

class MockSerialPort extends EventEmitter {
  public isOpen: boolean = false;
  public path: string;
  public baudRate: number;
  private openCallback: ((error: Error | null) => void) | null = null;

  constructor(options: any, callback?: (error: Error | null) => void) {
    super();
    this.path = options.path;
    this.baudRate = options.baudRate;
    this.openCallback = callback || null;
    mockSerialPortInstances.push(this);

    // Simulate async open
    setTimeout(() => {
      this.isOpen = true;
      if (this.openCallback) {
        this.openCallback(null);
      }
    }, 10);
  }

  write(_data: Buffer, callback: (error: Error | null) => void) {
    setTimeout(() => callback(null), 10);
  }

  drain(callback: (error: Error | null) => void) {
    setTimeout(() => callback(null), 10);
  }

  flush(callback?: (error: Error | null) => void) {
    if (callback) {
      setTimeout(() => callback(null), 10);
    }
  }

  close(callback: (error: Error | null) => void) {
    this.isOpen = false;
    setTimeout(() => callback(null), 10);
  }
}

// Mock the serialport module
jest.mock('serialport', () => {
  return {
    SerialPort: jest.fn((options: any, callback?: (error: Error | null) => void) => {
      return new MockSerialPort(options, callback);
    })
  };
});

// Import after mocking
import { SerialPortManager } from '../src/serial';

describe('SerialPortManager', () => {
  let serialManager: SerialPortManager;

  beforeEach(() => {
    serialManager = new SerialPortManager();
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    test('should initialize with null port', () => {
      expect(serialManager.isOpen()).toBe(false);
      expect(serialManager.getDevice()).toBeNull();
    });

    test('should have default baud rate', () => {
      expect(serialManager.getBaudRate()).toBe(BaudRate.B460800);
    });
  });

  describe('openPort', () => {
    test('should open serial port successfully', async () => {
      await serialManager.openPort('/dev/ttyUSB0', BaudRate.B460800);

      expect(serialManager.isOpen()).toBe(true);
      expect(serialManager.getDevice()).toBe('/dev/ttyUSB0');
      expect(serialManager.getBaudRate()).toBe(BaudRate.B460800);
    });

    test('should accept all supported baud rates', async () => {
      const baudRates = [
        BaudRate.B9600,
        BaudRate.B19200,
        BaudRate.B38400,
        BaudRate.B57600,
        BaudRate.B76800,
        BaudRate.B230400,
        BaudRate.B460800,
      ];

      for (const rate of baudRates) {
        const manager = new SerialPortManager();
        await expect(
          manager.openPort('/dev/ttyUSB0', rate)
        ).resolves.not.toThrow();
        expect(manager.getBaudRate()).toBe(rate);
      }
    });

    test('should throw error for null device', async () => {
      await expect(
        serialManager.openPort('', BaudRate.B230400)
      ).rejects.toThrow('Device path is required');
    });
  });

  describe('closePort', () => {
    test('should close open port', async () => {
      await serialManager.openPort('/dev/ttyUSB0', BaudRate.B230400);
      await serialManager.closePort();

      expect(serialManager.isOpen()).toBe(false);
    });

    test('should handle closing already closed port', async () => {
      await expect(serialManager.closePort()).resolves.not.toThrow();
    });
  });

  describe('calculateChecksum', () => {
    test('should calculate 16-bit checksum correctly', () => {
      const buffer1 = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      expect(serialManager.calculateChecksum(buffer1)).toBe(0x0a); // 1+2+3+4

      const buffer2 = Buffer.from([0xff, 0xff]);
      expect(serialManager.calculateChecksum(buffer2)).toBe(0x1fe); // 255+255

      const buffer3 = Buffer.from([0x00, 0x00, 0x00]);
      expect(serialManager.calculateChecksum(buffer3)).toBe(0x00);
    });

    test('should wrap around at 16 bits', () => {
      const buffer = Buffer.alloc(1000, 0xff); // 1000 * 255 = 255000
      const checksum = serialManager.calculateChecksum(buffer);
      expect(checksum).toBe(255000 & 0xffff); // Should be 16-bit value
      expect(checksum).toBeLessThan(0x10000);
    });

    test('should handle empty buffer', () => {
      const buffer = Buffer.alloc(0);
      expect(serialManager.calculateChecksum(buffer)).toBe(0);
    });
  });

  describe('receiveByte', () => {
    beforeEach(async () => {
      await serialManager.openPort('/dev/ttyUSB0', BaudRate.B230400);
    });

    test('should receive byte successfully', async () => {
      // Simulate data arrival
      setTimeout(() => {
        (serialManager as any).port.emit('data', Buffer.from([0x42]));
      }, 50);

      const byte = await serialManager.receiveByte(1000);
      expect(byte).toBe(0x42);
    });

    test('should timeout if no data received', async () => {
      await expect(serialManager.receiveByte(100)).rejects.toThrow(
        'Timeout receiving byte'
      );
    });

    test('should throw error if port not open', async () => {
      await serialManager.closePort();
      await expect(serialManager.receiveByte(100)).rejects.toThrow(
        'Serial port not open'
      );
    });

    test('should receive first byte from multi-byte data', async () => {
      setTimeout(() => {
        (serialManager as any).port.emit('data', Buffer.from([0x12, 0x34, 0x56]));
      }, 50);

      const byte = await serialManager.receiveByte(1000);
      expect(byte).toBe(0x12);
    });
  });

  describe('receiveBuffer', () => {
    beforeEach(async () => {
      await serialManager.openPort('/dev/ttyUSB0', BaudRate.B230400);
    });

    test('should receive buffer with valid checksum', async () => {
      const testData = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const checksum = serialManager.calculateChecksum(testData);
      const checksumLsb = checksum & 0xff;
      const checksumMsb = (checksum >> 8) & 0xff;

      // Simulate receiving data byte by byte
      let byteIndex = 0;
      const allData = Buffer.concat([
        testData,
        Buffer.from([checksumLsb, checksumMsb]),
      ]);

      const emitNextByte = () => {
        if (byteIndex < allData.length) {
          (serialManager as any).port.emit('data', Buffer.from([allData[byteIndex++]]));
          setTimeout(emitNextByte, 10);
        }
      };

      setTimeout(emitNextByte, 50);

      const received = await serialManager.receiveBuffer(4, 2000);
      expect(received).toEqual(testData);
    });

    test('should throw error on checksum mismatch', async () => {
      const testData = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const wrongChecksum = 0x9999;

      let byteIndex = 0;
      const allData = Buffer.concat([
        testData,
        Buffer.from([wrongChecksum & 0xff, (wrongChecksum >> 8) & 0xff]),
      ]);

      const emitNextByte = () => {
        if (byteIndex < allData.length) {
          (serialManager as any).port.emit('data', Buffer.from([allData[byteIndex++]]));
          setTimeout(emitNextByte, 10);
        }
      };

      setTimeout(emitNextByte, 50);

      await expect(serialManager.receiveBuffer(4, 2000)).rejects.toThrow(
        'Checksum mismatch'
      );
    });

    test('should timeout if data not received', async () => {
      await expect(serialManager.receiveBuffer(4, 100)).rejects.toThrow(
        /Timeout receiving buffer/
      );
    });

    test('should throw error if port not open', async () => {
      await serialManager.closePort();
      await expect(serialManager.receiveBuffer(4, 100)).rejects.toThrow(
        'Serial port not open'
      );
    });
  });

  describe('sendBuffer', () => {
    beforeEach(async () => {
      await serialManager.openPort('/dev/ttyUSB0', BaudRate.B230400);
    });

    test('should send buffer with checksum', async () => {
      const testData = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const mockWrite = jest.spyOn((serialManager as any).port, 'write');

      await serialManager.sendBuffer(testData, 1000);

      expect(mockWrite).toHaveBeenCalled();
      const sentData = mockWrite.mock.calls[0][0] as Buffer;

      // Should be original data + 2 byte checksum
      expect(sentData.length).toBe(6);
      expect(sentData.slice(0, 4)).toEqual(testData);

      // Verify checksum
      const checksum = serialManager.calculateChecksum(testData);
      expect(sentData[4]).toBe(checksum & 0xff); // LSB
      expect(sentData[5]).toBe((checksum >> 8) & 0xff); // MSB
    });

    test('should throw error if port not open', async () => {
      await serialManager.closePort();
      const testData = Buffer.from([0x01, 0x02]);
      await expect(serialManager.sendBuffer(testData, 100)).rejects.toThrow(
        'Serial port not open'
      );
    });

    test('should handle empty buffer', async () => {
      const emptyBuffer = Buffer.alloc(0);
      await expect(
        serialManager.sendBuffer(emptyBuffer, 1000)
      ).resolves.not.toThrow();
    });
  });

  describe('flush', () => {
    test('should flush port when open', async () => {
      await serialManager.openPort('/dev/ttyUSB0', BaudRate.B230400);
      await expect(serialManager.flush()).resolves.not.toThrow();
    });

    test('should not throw when port closed', async () => {
      await expect(serialManager.flush()).resolves.not.toThrow();
    });
  });

  describe('isOpen', () => {
    test('should return true when port is open', async () => {
      await serialManager.openPort('/dev/ttyUSB0', BaudRate.B230400);
      expect(serialManager.isOpen()).toBe(true);
    });

    test('should return false when port is closed', () => {
      expect(serialManager.isOpen()).toBe(false);
    });

    test('should return false after closing port', async () => {
      await serialManager.openPort('/dev/ttyUSB0', BaudRate.B230400);
      await serialManager.closePort();
      expect(serialManager.isOpen()).toBe(false);
    });
  });

  describe('getDevice and getBaudRate', () => {
    test('should return null device before opening', () => {
      expect(serialManager.getDevice()).toBeNull();
    });

    test('should return correct device after opening', async () => {
      await serialManager.openPort('/dev/ttyUSB0', BaudRate.B230400);
      expect(serialManager.getDevice()).toBe('/dev/ttyUSB0');
    });

    test('should return correct baud rate', async () => {
      await serialManager.openPort('/dev/ttyUSB0', BaudRate.B460800);
      expect(serialManager.getBaudRate()).toBe(BaudRate.B460800);
    });
  });
});
