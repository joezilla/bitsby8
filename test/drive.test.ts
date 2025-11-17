/**
 * Drive Manager Unit Tests
 */

import { DriveManager } from '../src/drive';
import { FdcError, MAX_DRIVES } from '../src/protocol';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';

// Mock fs modules
jest.mock('fs/promises');
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  constants: {
    O_RDONLY: 0,
    O_RDWR: 2,
    F_OK: 0,
  },
}));

describe('DriveManager', () => {
  let driveManager: DriveManager;
  let mockFileHandle: any;

  beforeEach(() => {
    driveManager = new DriveManager();
    jest.clearAllMocks();

    // Mock file handle
    mockFileHandle = {
      fd: 3,
      read: jest.fn(),
      write: jest.fn(),
      sync: jest.fn(),
      close: jest.fn(),
    };
  });

  describe('constructor', () => {
    test('should initialize all drives as unmounted', () => {
      for (let i = 0; i < MAX_DRIVES; i++) {
        const state = driveManager.getDriveState(i);
        expect(state).not.toBeNull();
        expect(state?.mounted).toBe(false);
        expect(state?.filename).toBeNull();
        expect(state?.readonly).toBe(false);
        expect(state?.hdld).toBe(false);
        expect(state?.track).toBe(0);
      }
    });

    test('should initialize fdc error to OK', () => {
      expect(driveManager.fdcErrno).toBe(FdcError.OK);
    });
  });

  describe('getDriveState', () => {
    test('should return drive state for valid drive', () => {
      const state = driveManager.getDriveState(0);
      expect(state).not.toBeNull();
      expect(state?.mounted).toBe(false);
    });

    test('should return null for invalid drive number', () => {
      expect(driveManager.getDriveState(-1)).toBeNull();
      expect(driveManager.getDriveState(MAX_DRIVES)).toBeNull();
      expect(driveManager.getDriveState(MAX_DRIVES + 1)).toBeNull();
    });
  });

  describe('getAllDriveStates', () => {
    test('should return map of all drive states', () => {
      const states = driveManager.getAllDriveStates();
      expect(states).toBeInstanceOf(Map);
      expect(states.size).toBe(MAX_DRIVES);
    });

    test('should return copy of internal state', () => {
      const states = driveManager.getAllDriveStates();
      states.clear();
      expect(driveManager.getAllDriveStates().size).toBe(MAX_DRIVES);
    });
  });

  describe('mountDrive', () => {
    beforeEach(() => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.open as jest.Mock).mockResolvedValue(mockFileHandle);
    });

    test('should mount disk image successfully', async () => {
      const fd = await driveManager.mountDrive(0, 'test.dsk');

      expect(fd).toBe(mockFileHandle.fd);
      expect(fs.access).toHaveBeenCalledWith('test.dsk', fsSync.constants.F_OK);
      expect(fs.open).toHaveBeenCalledWith('test.dsk', fsSync.constants.O_RDWR);

      const state = driveManager.getDriveState(0);
      expect(state?.mounted).toBe(true);
      expect(state?.filename).toBe('test.dsk');
      expect(state?.track).toBe(0);
      expect(state?.hdld).toBe(false);
    });

    test('should open read-only drives with O_RDONLY', async () => {
      driveManager.writeProtect(0, true);
      await driveManager.mountDrive(0, 'test.dsk');

      expect(fs.open).toHaveBeenCalledWith('test.dsk', fsSync.constants.O_RDONLY);
    });

    test('should throw error for invalid drive number', async () => {
      await expect(
        driveManager.mountDrive(MAX_DRIVES, 'test.dsk')
      ).rejects.toThrow('Invalid drive number');
    });

    test('should throw error if file does not exist', async () => {
      (fs.access as jest.Mock).mockRejectedValue(new Error('ENOENT'));

      await expect(driveManager.mountDrive(0, 'missing.dsk')).rejects.toThrow();

      const state = driveManager.getDriveState(0);
      expect(state?.mounted).toBe(false);
      expect(state?.filename).toBe('--ERROR--');
    });

    test('should throw error if file cannot be opened', async () => {
      (fs.open as jest.Mock).mockRejectedValue(new Error('Permission denied'));

      await expect(driveManager.mountDrive(0, 'test.dsk')).rejects.toThrow();

      const state = driveManager.getDriveState(0);
      expect(state?.mounted).toBe(false);
    });
  });

  describe('unmountDrive', () => {
    beforeEach(async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.open as jest.Mock).mockResolvedValue(mockFileHandle);
      mockFileHandle.close.mockResolvedValue(undefined);
    });

    test('should unmount mounted drive', async () => {
      await driveManager.mountDrive(0, 'test.dsk');
      await driveManager.unmountDrive(0);

      expect(mockFileHandle.close).toHaveBeenCalled();

      const state = driveManager.getDriveState(0);
      expect(state?.mounted).toBe(false);
      expect(state?.filename).toBeNull();
      expect(state?.fd).toBeNull();
    });

    test('should handle unmounting unmounted drive', async () => {
      await driveManager.unmountDrive(0);
      expect(mockFileHandle.close).not.toHaveBeenCalled();
    });

    test('should throw error for invalid drive number', async () => {
      await expect(driveManager.unmountDrive(MAX_DRIVES)).rejects.toThrow(
        'Invalid drive number'
      );
    });
  });

  describe('unmountAll', () => {
    beforeEach(async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.open as jest.Mock).mockResolvedValue(mockFileHandle);
      mockFileHandle.close.mockResolvedValue(undefined);
    });

    test('should unmount all mounted drives', async () => {
      await driveManager.mountDrive(0, 'test0.dsk');
      await driveManager.mountDrive(1, 'test1.dsk');
      await driveManager.mountDrive(2, 'test2.dsk');

      await driveManager.unmountAll();

      expect(mockFileHandle.close).toHaveBeenCalledTimes(3);

      for (let i = 0; i < 3; i++) {
        const state = driveManager.getDriveState(i);
        expect(state?.mounted).toBe(false);
      }
    });

    test('should not error if no drives mounted', async () => {
      await expect(driveManager.unmountAll()).resolves.not.toThrow();
    });
  });

  describe('writeProtect', () => {
    test('should set write protection', () => {
      driveManager.writeProtect(0, true);
      const state = driveManager.getDriveState(0);
      expect(state?.readonly).toBe(true);
    });

    test('should clear write protection', () => {
      driveManager.writeProtect(0, true);
      driveManager.writeProtect(0, false);
      const state = driveManager.getDriveState(0);
      expect(state?.readonly).toBe(false);
    });

    test('should throw error for invalid drive number', () => {
      expect(() => driveManager.writeProtect(MAX_DRIVES, true)).toThrow(
        'Invalid drive number'
      );
    });
  });

  describe('readTrack', () => {
    beforeEach(async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.open as jest.Mock).mockResolvedValue(mockFileHandle);
    });

    test('should read track data successfully', async () => {
      const trackData = Buffer.alloc(4384, 0xaa);
      mockFileHandle.read.mockResolvedValue({
        bytesRead: 4384,
        buffer: trackData,
      });

      await driveManager.mountDrive(0, 'test.dsk');
      const result = await driveManager.readTrack(0, 5, 4384);

      expect(mockFileHandle.read).toHaveBeenCalledWith(
        expect.any(Buffer),
        0,
        4384,
        5 * 4384
      );

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBe(4384);
      expect(driveManager.fdcErrno).toBe(FdcError.OK);

      const state = driveManager.getDriveState(0);
      expect(state?.track).toBe(5);
      expect(state?.hdld).toBe(true);
    });

    test('should throw error for invalid drive', async () => {
      await expect(driveManager.readTrack(MAX_DRIVES, 0, 4384)).rejects.toThrow(
        'Invalid drive number'
      );
      expect(driveManager.fdcErrno).toBe(FdcError.NOT_READY);
    });

    test('should throw error for unmounted drive', async () => {
      await expect(driveManager.readTrack(0, 0, 4384)).rejects.toThrow(
        'Drive 0 not mounted'
      );
      expect(driveManager.fdcErrno).toBe(FdcError.NOT_READY);
    });

    test('should throw error if wrong number of bytes read', async () => {
      mockFileHandle.read.mockResolvedValue({
        bytesRead: 100,
        buffer: Buffer.alloc(100),
      });

      await driveManager.mountDrive(0, 'test.dsk');

      await expect(driveManager.readTrack(0, 0, 4384)).rejects.toThrow(
        'Read 100 bytes, expected 4384'
      );
      expect(driveManager.fdcErrno).toBe(FdcError.NOT_READY);
    });
  });

  describe('writeTrack', () => {
    beforeEach(async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.open as jest.Mock).mockResolvedValue(mockFileHandle);
    });

    test('should write track data successfully', async () => {
      const trackData = Buffer.alloc(4384, 0xbb);
      mockFileHandle.write.mockResolvedValue({
        bytesWritten: 4384,
        buffer: trackData,
      });
      mockFileHandle.sync.mockResolvedValue(undefined);

      await driveManager.mountDrive(0, 'test.dsk');
      const result = await driveManager.writeTrack(0, 7, 4384, trackData);

      expect(mockFileHandle.write).toHaveBeenCalledWith(
        trackData,
        0,
        4384,
        7 * 4384
      );
      expect(mockFileHandle.sync).toHaveBeenCalled();
      expect(result).toBe(4384);
      expect(driveManager.fdcErrno).toBe(FdcError.OK);

      const state = driveManager.getDriveState(0);
      expect(state?.track).toBe(7);
      expect(state?.hdld).toBe(true);
    });

    test('should throw error for read-only drive', async () => {
      driveManager.writeProtect(0, true);
      await driveManager.mountDrive(0, 'test.dsk');

      const trackData = Buffer.alloc(4384);
      await expect(
        driveManager.writeTrack(0, 0, 4384, trackData)
      ).rejects.toThrow('Drive 0 is read-only');
      expect(driveManager.fdcErrno).toBe(FdcError.WRITE_ERR);
    });

    test('should throw error for invalid drive', async () => {
      const trackData = Buffer.alloc(4384);
      await expect(
        driveManager.writeTrack(MAX_DRIVES, 0, 4384, trackData)
      ).rejects.toThrow('Invalid drive number');
      expect(driveManager.fdcErrno).toBe(FdcError.NOT_READY);
    });

    test('should throw error for unmounted drive', async () => {
      const trackData = Buffer.alloc(4384);
      await expect(driveManager.writeTrack(0, 0, 4384, trackData)).rejects.toThrow(
        'Drive 0 not mounted'
      );
      expect(driveManager.fdcErrno).toBe(FdcError.NOT_READY);
    });

    test('should throw error if wrong number of bytes written', async () => {
      mockFileHandle.write.mockResolvedValue({
        bytesWritten: 100,
        buffer: Buffer.alloc(100),
      });

      await driveManager.mountDrive(0, 'test.dsk');

      const trackData = Buffer.alloc(4384);
      await expect(driveManager.writeTrack(0, 0, 4384, trackData)).rejects.toThrow(
        'Wrote 100 bytes, expected 4384'
      );
      expect(driveManager.fdcErrno).toBe(FdcError.WRITE_ERR);
    });
  });

  describe('isMounted', () => {
    beforeEach(async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.open as jest.Mock).mockResolvedValue(mockFileHandle);
    });

    test('should return true for mounted drive', async () => {
      await driveManager.mountDrive(0, 'test.dsk');
      expect(driveManager.isMounted(0)).toBe(true);
    });

    test('should return false for unmounted drive', () => {
      expect(driveManager.isMounted(0)).toBe(false);
    });

    test('should return false for invalid drive', () => {
      expect(driveManager.isMounted(-1)).toBe(false);
      expect(driveManager.isMounted(MAX_DRIVES)).toBe(false);
    });
  });

  describe('isReadOnly', () => {
    test('should return true for read-only drive', () => {
      driveManager.writeProtect(0, true);
      expect(driveManager.isReadOnly(0)).toBe(true);
    });

    test('should return false for read-write drive', () => {
      expect(driveManager.isReadOnly(0)).toBe(false);
    });

    test('should return false for invalid drive', () => {
      expect(driveManager.isReadOnly(-1)).toBe(false);
      expect(driveManager.isReadOnly(MAX_DRIVES)).toBe(false);
    });
  });

  describe('getTrackBuffer', () => {
    test('should return track buffer', () => {
      const buffer = driveManager.getTrackBuffer();
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBe(4384);
    });
  });
});
