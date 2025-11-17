/**
 * Terminal Serial Port Manager Unit Tests
 */

import { EventEmitter } from 'events';
import { TerminalConfig, DEFAULT_TERMINAL_CONFIG } from '../src/terminal-serial';

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

  write(_data: Buffer | string, callback: (error: Error | null) => void) {
    setTimeout(() => callback(null), 10);
  }

  drain(callback: (error: Error | null) => void) {
    setTimeout(() => callback(null), 10);
  }

  set(_options: any, callback: (error: Error | null) => void) {
    setTimeout(() => callback(null), 10);
  }

  close(callback: (error: Error | null) => void) {
    this.isOpen = false;
    setTimeout(() => callback(null), 10);
  }
}

// Mock the serialport module
jest.mock('serialport', () => {
  const mockList = async () => {
    return [
      { path: '/dev/ttyUSB0', manufacturer: 'FTDI' },
      { path: '/dev/ttyUSB1', manufacturer: 'Prolific' },
    ];
  };

  return {
    SerialPort: Object.assign(
      jest.fn((options: any, callback?: (error: Error | null) => void) => {
        return new (MockSerialPort as any)(options, callback);
      }),
      {
        list: mockList
      }
    )
  };
});

// Import after mocking
import { TerminalSerialManager } from '../src/terminal-serial';

describe('TerminalSerialManager', () => {
  let terminalManager: TerminalSerialManager;

  beforeEach(() => {
    terminalManager = new TerminalSerialManager();
    jest.clearAllMocks();
    mockSerialPortInstances.length = 0;
  });

  describe('constructor', () => {
    test('should initialize with null port', () => {
      expect(terminalManager.isOpen()).toBe(false);
      expect(terminalManager.getDevice()).toBeNull();
    });

    test('should have default configuration', () => {
      const config = terminalManager.getConfig();
      expect(config.baudRate).toBe(DEFAULT_TERMINAL_CONFIG.baudRate);
      expect(config.dataBits).toBe(DEFAULT_TERMINAL_CONFIG.dataBits);
      expect(config.stopBits).toBe(DEFAULT_TERMINAL_CONFIG.stopBits);
      expect(config.parity).toBe(DEFAULT_TERMINAL_CONFIG.parity);
      expect(config.flowControl).toBe(DEFAULT_TERMINAL_CONFIG.flowControl);
    });
  });

  describe('openPort', () => {
    test('should open terminal port with default config', async () => {
      await terminalManager.openPort('/dev/ttyUSB0');

      expect(terminalManager.isOpen()).toBe(true);
      expect(terminalManager.getDevice()).toBe('/dev/ttyUSB0');
    });

    test('should open port with custom configuration', async () => {
      const customConfig: Partial<TerminalConfig> = {
        baudRate: 115200,
        dataBits: 7,
        stopBits: 2,
        parity: 'even',
        flowControl: 'hardware',
      };

      await terminalManager.openPort('/dev/ttyUSB0', customConfig);

      const config = terminalManager.getConfig();
      expect(config.baudRate).toBe(115200);
      expect(config.dataBits).toBe(7);
      expect(config.stopBits).toBe(2);
      expect(config.parity).toBe('even');
      expect(config.flowControl).toBe('hardware');
    });

    test('should throw error for empty device path', async () => {
      await expect(
        terminalManager.openPort('')
      ).rejects.toThrow('Device path is required');
    });

    test('should throw error if port already open', async () => {
      await terminalManager.openPort('/dev/ttyUSB0');
      await expect(
        terminalManager.openPort('/dev/ttyUSB1')
      ).rejects.toThrow('Port is already open');
    });

    test('should accept all supported baud rates', async () => {
      const baudRates = [9600, 19200, 38400, 57600, 115200];

      for (const rate of baudRates) {
        const manager = new TerminalSerialManager();
        await expect(
          manager.openPort('/dev/ttyUSB0', { baudRate: rate as any })
        ).resolves.not.toThrow();
        expect(manager.getConfig().baudRate).toBe(rate);
        await manager.closePort();
      }
    });
  });

  describe('closePort', () => {
    test('should close open port', async () => {
      await terminalManager.openPort('/dev/ttyUSB0');
      await terminalManager.closePort();

      expect(terminalManager.isOpen()).toBe(false);
    });

    test('should handle closing already closed port', async () => {
      await expect(terminalManager.closePort()).resolves.not.toThrow();
    });
  });

  describe('write', () => {
    beforeEach(async () => {
      await terminalManager.openPort('/dev/ttyUSB0');
    });

    test('should write buffer data successfully', async () => {
      const testData = Buffer.from('Hello Terminal');
      await expect(terminalManager.write(testData)).resolves.not.toThrow();
    });

    test('should write string data successfully', async () => {
      await expect(terminalManager.write('Hello Terminal')).resolves.not.toThrow();
    });

    test('should throw error if port not open', async () => {
      await terminalManager.closePort();
      await expect(
        terminalManager.write('test')
      ).rejects.toThrow('Serial port not open');
    });
  });

  describe('updateConfig', () => {
    test('should update config on closed port', async () => {
      await terminalManager.updateConfig({ baudRate: 115200 });
      expect(terminalManager.getConfig().baudRate).toBe(115200);
    });

    test('should reopen port with new config', async () => {
      await terminalManager.openPort('/dev/ttyUSB0');
      const wasOpen = terminalManager.isOpen();

      await terminalManager.updateConfig({ baudRate: 115200 });

      expect(wasOpen).toBe(true);
      expect(terminalManager.isOpen()).toBe(true);
      expect(terminalManager.getConfig().baudRate).toBe(115200);
    });

    test('should update multiple config parameters', async () => {
      await terminalManager.updateConfig({
        baudRate: 57600,
        dataBits: 7,
        parity: 'odd',
      });

      const config = terminalManager.getConfig();
      expect(config.baudRate).toBe(57600);
      expect(config.dataBits).toBe(7);
      expect(config.parity).toBe('odd');
    });
  });

  describe('callbacks', () => {
    test('should call onData callback when data received', async () => {
      await terminalManager.openPort('/dev/ttyUSB0');

      const dataCallback = jest.fn();
      terminalManager.onData(dataCallback);

      const testData = Buffer.from('test data');
      (terminalManager as any).port.emit('data', testData);

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(dataCallback).toHaveBeenCalledWith(testData);
    });

    test('should call onError callback on error', async () => {
      await terminalManager.openPort('/dev/ttyUSB0');

      const errorCallback = jest.fn();
      terminalManager.onError(errorCallback);

      const testError = new Error('Test error');
      (terminalManager as any).port.emit('error', testError);

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(errorCallback).toHaveBeenCalledWith(testError);
    });

    test('should call onClose callback when port closes', async () => {
      await terminalManager.openPort('/dev/ttyUSB0');

      const closeCallback = jest.fn();
      terminalManager.onClose(closeCallback);

      (terminalManager as any).port.emit('close');

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(closeCallback).toHaveBeenCalled();
    });
  });

  describe('control signals', () => {
    beforeEach(async () => {
      await terminalManager.openPort('/dev/ttyUSB0');
    });

    test('should set DTR signal', async () => {
      await expect(terminalManager.setDTR(true)).resolves.not.toThrow();
      await expect(terminalManager.setDTR(false)).resolves.not.toThrow();
    });

    test('should set RTS signal', async () => {
      await expect(terminalManager.setRTS(true)).resolves.not.toThrow();
      await expect(terminalManager.setRTS(false)).resolves.not.toThrow();
    });

    test('should throw error if port not open', async () => {
      await terminalManager.closePort();
      await expect(terminalManager.setDTR(true)).rejects.toThrow('Serial port not open');
      await expect(terminalManager.setRTS(true)).rejects.toThrow('Serial port not open');
    });
  });

  describe('listPorts', () => {
    test('should list available serial ports', async () => {
      const ports = await TerminalSerialManager.listPorts();

      expect(Array.isArray(ports)).toBe(true);
      expect(ports.length).toBeGreaterThan(0);
      expect(ports[0]).toHaveProperty('path');
    });
  });

  describe('flow control', () => {
    test('should configure no flow control', async () => {
      await terminalManager.openPort('/dev/ttyUSB0', { flowControl: 'none' });
      expect(terminalManager.getConfig().flowControl).toBe('none');
    });

    test('should configure hardware flow control', async () => {
      await terminalManager.openPort('/dev/ttyUSB0', { flowControl: 'hardware' });
      expect(terminalManager.getConfig().flowControl).toBe('hardware');
    });

    test('should configure software flow control', async () => {
      await terminalManager.openPort('/dev/ttyUSB0', { flowControl: 'software' });
      expect(terminalManager.getConfig().flowControl).toBe('software');
    });
  });

  describe('parity options', () => {
    test('should configure all parity options', async () => {
      const parityOptions: Array<'none' | 'even' | 'odd' | 'mark' | 'space'> =
        ['none', 'even', 'odd', 'mark', 'space'];

      for (const parity of parityOptions) {
        const manager = new TerminalSerialManager();
        await manager.openPort('/dev/ttyUSB0', { parity });
        expect(manager.getConfig().parity).toBe(parity);
        await manager.closePort();
      }
    });
  });

  describe('isOpen', () => {
    test('should return true when port is open', async () => {
      await terminalManager.openPort('/dev/ttyUSB0');
      expect(terminalManager.isOpen()).toBe(true);
    });

    test('should return false when port is closed', () => {
      expect(terminalManager.isOpen()).toBe(false);
    });

    test('should return false after closing port', async () => {
      await terminalManager.openPort('/dev/ttyUSB0');
      await terminalManager.closePort();
      expect(terminalManager.isOpen()).toBe(false);
    });
  });

  describe('getDevice and getConfig', () => {
    test('should return null device before opening', () => {
      expect(terminalManager.getDevice()).toBeNull();
    });

    test('should return correct device after opening', async () => {
      await terminalManager.openPort('/dev/ttyUSB0');
      expect(terminalManager.getDevice()).toBe('/dev/ttyUSB0');
    });

    test('should return config copy (not reference)', () => {
      const config1 = terminalManager.getConfig();
      const config2 = terminalManager.getConfig();

      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2); // Different objects
    });
  });
});
