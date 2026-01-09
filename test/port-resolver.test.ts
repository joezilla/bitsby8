/**
 * Port Resolver Unit Tests
 *
 * Tests for serial port path resolution and persistent path discovery
 */

import {
  resolvePortPath,
  listPortsWithPersistent,
  validatePortPath,
  findPortByMetadata,
  suggestPersistentPath,
} from '../src/port-resolver';
import { SerialPort } from 'serialport';
import * as fs from 'fs/promises';

// Mock the serialport library
jest.mock('serialport');
const MockedSerialPort = SerialPort as jest.MockedClass<typeof SerialPort>;

// Mock fs/promises
jest.mock('fs/promises');
const mockedFs = fs as jest.Mocked<typeof fs>;

describe('Port Resolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('resolvePortPath', () => {
    it('should resolve a volatile path that exists', async () => {
      // Mock fs.access to indicate path exists
      mockedFs.access.mockResolvedValue(undefined);

      // Mock fs.lstat to indicate it's not a symlink
      mockedFs.lstat.mockResolvedValue({
        isSymbolicLink: () => false,
      } as any);

      // Mock SerialPort.list to return port metadata
      MockedSerialPort.list = jest.fn().mockResolvedValue([
        {
          path: '/dev/ttyUSB0',
          manufacturer: 'FTDI',
          serialNumber: 'ABC123',
          pnpId: 'usb-FTDI_FT232R_USB_UART_ABC123-if00-port0',
          vendorId: '0403',
          productId: '6001',
        },
      ]);

      const result = await resolvePortPath('/dev/ttyUSB0');

      expect(result.path).toBe('/dev/ttyUSB0');
      expect(result.resolvedPath).toBe('/dev/ttyUSB0');
      expect(result.exists).toBe(true);
      expect(result.isSymlink).toBe(false);
      expect(result.metadata.manufacturer).toBe('FTDI');
      expect(result.metadata.serialNumber).toBe('ABC123');
    });

    it('should resolve a symlink to actual device', async () => {
      // Mock fs.access
      mockedFs.access.mockResolvedValue(undefined);

      // Mock fs.lstat to indicate it IS a symlink
      mockedFs.lstat.mockResolvedValue({
        isSymbolicLink: () => true,
      } as any);

      // Mock fs.realpath to resolve symlink
      mockedFs.realpath.mockResolvedValue('/dev/ttyUSB0' as any);

      // Mock SerialPort.list
      MockedSerialPort.list = jest.fn().mockResolvedValue([
        {
          path: '/dev/ttyUSB0',
          manufacturer: 'FTDI',
          serialNumber: 'ABC123',
        },
      ]);

      const result = await resolvePortPath('/dev/serial/by-id/usb-FTDI_FT232R_USB_UART_ABC123-if00-port0');

      expect(result.path).toBe('/dev/serial/by-id/usb-FTDI_FT232R_USB_UART_ABC123-if00-port0');
      expect(result.resolvedPath).toBe('/dev/ttyUSB0');
      expect(result.exists).toBe(true);
      expect(result.isSymlink).toBe(true);
    });

    it('should handle non-existent path', async () => {
      // Mock fs.access to throw ENOENT
      mockedFs.access.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      const result = await resolvePortPath('/dev/ttyUSB99');

      expect(result.exists).toBe(false);
      expect(result.path).toBe('/dev/ttyUSB99');
    });

    it('should discover persistent paths on Linux', async () => {
      // Save original platform
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });

      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.lstat.mockResolvedValue({ isSymbolicLink: () => false } as any);

      // Mock /dev/serial/by-id/ directory scan
      mockedFs.readdir.mockImplementation(async (dir: any) => {
        if (dir === '/dev/serial/by-id') {
          return ['usb-FTDI_FT232R_USB_UART_ABC123-if00-port0'] as any;
        }
        if (dir === '/dev/serial/by-path') {
          return ['pci-0000:00:14.0-usb-0:1:1.0-port0'] as any;
        }
        return [] as any;
      });

      // Mock realpath for persistent paths
      mockedFs.realpath.mockImplementation(async (p: any) => {
        if (p.includes('by-id') || p.includes('by-path')) {
          return '/dev/ttyUSB0' as any;
        }
        return p as any;
      });

      MockedSerialPort.list = jest.fn().mockResolvedValue([
        { path: '/dev/ttyUSB0', manufacturer: 'FTDI' },
      ]);

      const result = await resolvePortPath('/dev/ttyUSB0');

      expect(result.persistentPaths.byId).toBe('/dev/serial/by-id/usb-FTDI_FT232R_USB_UART_ABC123-if00-port0');
      expect(result.persistentPaths.byPath).toBe('/dev/serial/by-path/pci-0000:00:14.0-usb-0:1:1.0-port0');

      // Restore platform
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should not discover persistent paths on non-Linux platforms', async () => {
      // Save original platform
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.lstat.mockResolvedValue({ isSymbolicLink: () => false } as any);

      MockedSerialPort.list = jest.fn().mockResolvedValue([
        { path: '/dev/cu.usbserial-ABC123', manufacturer: 'FTDI' },
      ]);

      const result = await resolvePortPath('/dev/cu.usbserial-ABC123');

      expect(result.persistentPaths.byId).toBeUndefined();
      expect(result.persistentPaths.byPath).toBeUndefined();

      // Restore platform
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should throw error for symlink loop', async () => {
      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.lstat.mockResolvedValue({ isSymbolicLink: () => true } as any);

      // Mock realpath to throw ELOOP
      mockedFs.realpath.mockRejectedValue(Object.assign(new Error('ELOOP'), { code: 'ELOOP' }));

      await expect(resolvePortPath('/dev/bad-symlink')).rejects.toThrow('Failed to resolve symlink');
    });
  });

  describe('listPortsWithPersistent', () => {
    it('should enhance SerialPort.list with persistent paths on Linux', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });

      // Mock SerialPort.list
      MockedSerialPort.list = jest.fn().mockResolvedValue([
        {
          path: '/dev/ttyUSB0',
          manufacturer: 'FTDI',
          serialNumber: 'ABC123',
        },
        {
          path: '/dev/ttyUSB1',
          manufacturer: 'Prolific',
          serialNumber: 'XYZ789',
        },
      ]);

      // Mock directory scans
      mockedFs.readdir.mockImplementation(async (dir: any) => {
        if (dir === '/dev/serial/by-id') {
          return [
            'usb-FTDI_FT232R_USB_UART_ABC123-if00-port0',
            'usb-Prolific_USB-Serial_Controller_XYZ789-if00-port0',
          ] as any;
        }
        return [] as any;
      });

      mockedFs.realpath.mockImplementation(async (p: any) => {
        if (p.includes('FTDI')) return '/dev/ttyUSB0' as any;
        if (p.includes('Prolific')) return '/dev/ttyUSB1' as any;
        return p as any;
      });

      const result = await listPortsWithPersistent();

      expect(result).toHaveLength(2);
      expect(result[0].path).toBe('/dev/ttyUSB0');
      expect(result[0].persistentPaths.byId).toContain('FTDI');
      expect(result[1].path).toBe('/dev/ttyUSB1');
      expect(result[1].persistentPaths.byId).toContain('Prolific');

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should work on non-Linux platforms without persistent paths', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      MockedSerialPort.list = jest.fn().mockResolvedValue([
        {
          path: '/dev/cu.usbserial-ABC123',
          manufacturer: 'FTDI',
        },
      ]);

      const result = await listPortsWithPersistent();

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('/dev/cu.usbserial-ABC123');
      expect(result[0].persistentPaths).toEqual({});

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });
  });

  describe('validatePortPath', () => {
    it('should validate existing port as valid', async () => {
      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.lstat.mockResolvedValue({ isSymbolicLink: () => false } as any);
      MockedSerialPort.list = jest.fn().mockResolvedValue([]);

      const result = await validatePortPath('/dev/ttyUSB0');

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should provide suggestions for non-existent port', async () => {
      mockedFs.access.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });

      MockedSerialPort.list = jest.fn().mockResolvedValue([
        { path: '/dev/ttyUSB1', manufacturer: 'FTDI' },
      ]);

      mockedFs.readdir.mockImplementation(async (dir: any) => {
        if (dir === '/dev/serial/by-id') {
          return ['usb-FTDI_FT232R_USB_UART_ABC123-if00-port0'] as any;
        }
        return [] as any;
      });

      mockedFs.realpath.mockResolvedValue('/dev/ttyUSB1' as any);

      const result = await validatePortPath('/dev/ttyUSB0');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not found');
      expect(result.suggestions).toBeDefined();
      expect(result.suggestions).toContain('/dev/serial/by-id/usb-FTDI_FT232R_USB_UART_ABC123-if00-port0');

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should handle permission denied error', async () => {
      mockedFs.access.mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }));

      const result = await validatePortPath('/dev/ttyUSB0');

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Permission denied');
      expect(result.reason).toContain('dialout');
    });
  });

  describe('findPortByMetadata', () => {
    it('should find port by serial number', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });

      MockedSerialPort.list = jest.fn().mockResolvedValue([
        {
          path: '/dev/ttyUSB0',
          manufacturer: 'FTDI',
          serialNumber: 'ABC123',
          vendorId: '0403',
        },
        {
          path: '/dev/ttyUSB1',
          manufacturer: 'Prolific',
          serialNumber: 'XYZ789',
          vendorId: '067b',
        },
      ]);

      mockedFs.readdir.mockResolvedValue([] as any);

      const result = await findPortByMetadata('ABC123');

      expect(result).not.toBeNull();
      expect(result?.path).toBe('/dev/ttyUSB0');
      expect(result?.metadata.manufacturer).toBe('FTDI');

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should match both serial number and vendor ID', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });

      MockedSerialPort.list = jest.fn().mockResolvedValue([
        {
          path: '/dev/ttyUSB0',
          serialNumber: 'ABC123',
          vendorId: '0403',
        },
        {
          path: '/dev/ttyUSB1',
          serialNumber: 'ABC123',  // Same serial number!
          vendorId: '067b',        // Different vendor
        },
      ]);

      mockedFs.readdir.mockResolvedValue([] as any);

      const result = await findPortByMetadata('ABC123', '0403');

      expect(result).not.toBeNull();
      expect(result?.path).toBe('/dev/ttyUSB0');

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should return null if no match found', async () => {
      MockedSerialPort.list = jest.fn().mockResolvedValue([]);

      const result = await findPortByMetadata('NONEXISTENT');

      expect(result).toBeNull();
    });
  });

  describe('suggestPersistentPath', () => {
    it('should suggest by-id path for volatile path', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });

      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.lstat.mockResolvedValue({ isSymbolicLink: () => false } as any);

      mockedFs.readdir.mockImplementation(async (dir: any) => {
        if (dir === '/dev/serial/by-id') {
          return ['usb-FTDI_FT232R_USB_UART_ABC123-if00-port0'] as any;
        }
        return [] as any;
      });

      mockedFs.realpath.mockResolvedValue('/dev/ttyUSB0' as any);

      MockedSerialPort.list = jest.fn().mockResolvedValue([
        { path: '/dev/ttyUSB0' },
      ]);

      const result = await suggestPersistentPath('/dev/ttyUSB0');

      expect(result).toBe('/dev/serial/by-id/usb-FTDI_FT232R_USB_UART_ABC123-if00-port0');

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should prefer by-id over by-path', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });

      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.lstat.mockResolvedValue({ isSymbolicLink: () => false } as any);

      mockedFs.readdir.mockImplementation(async (dir: any) => {
        if (dir === '/dev/serial/by-id') {
          return ['usb-FTDI-by-id'] as any;
        }
        if (dir === '/dev/serial/by-path') {
          return ['pci-by-path'] as any;
        }
        return [] as any;
      });

      mockedFs.realpath.mockResolvedValue('/dev/ttyUSB0' as any);
      MockedSerialPort.list = jest.fn().mockResolvedValue([{ path: '/dev/ttyUSB0' }]);

      const result = await suggestPersistentPath('/dev/ttyUSB0');

      expect(result).toBe('/dev/serial/by-id/usb-FTDI-by-id');

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should return null if no persistent path available', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.lstat.mockResolvedValue({ isSymbolicLink: () => false } as any);
      MockedSerialPort.list = jest.fn().mockResolvedValue([{ path: '/dev/cu.usbserial' }]);

      const result = await suggestPersistentPath('/dev/cu.usbserial');

      expect(result).toBeNull();

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should return null on error', async () => {
      mockedFs.access.mockRejectedValue(new Error('Some error'));

      const result = await suggestPersistentPath('/dev/invalid');

      expect(result).toBeNull();
    });
  });
});
