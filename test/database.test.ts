/**
 * Database Service Tests
 */

import { DatabaseService } from '../src/database';
import * as fs from 'fs';
import * as path from 'path';

describe('DatabaseService', () => {
  let db: DatabaseService;
  let testDbPath: string;

  beforeEach(() => {
    // Reset singleton and use unique database path for each test
    DatabaseService.resetInstance();
    testDbPath = path.join(__dirname, `test-fdcplus-${Date.now()}.db`);

    // Clean up any existing test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    if (fs.existsSync(testDbPath + '-shm')) {
      fs.unlinkSync(testDbPath + '-shm');
    }
    if (fs.existsSync(testDbPath + '-wal')) {
      fs.unlinkSync(testDbPath + '-wal');
    }

    db = DatabaseService.getInstance(testDbPath);
  });

  afterEach(() => {
    // Reset singleton for next test
    DatabaseService.resetInstance();

    // Clean up test database files
    try {
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
      if (fs.existsSync(testDbPath + '-shm')) {
        fs.unlinkSync(testDbPath + '-shm');
      }
      if (fs.existsSync(testDbPath + '-wal')) {
        fs.unlinkSync(testDbPath + '-wal');
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('Disk Metadata', () => {
    test('should create and retrieve disk metadata', () => {
      db.upsertDiskMetadata({
        filename: 'test.dsk',
        description: 'Test disk image',
        size: 1024,
        uploadDate: '2025-01-20T12:00:00Z'
      });

      const meta = db.getDiskMetadata('test.dsk');
      expect(meta).not.toBeNull();
      expect(meta?.filename).toBe('test.dsk');
      expect(meta?.description).toBe('Test disk image');
      expect(meta?.size).toBe(1024);
    });

    test('should update existing disk metadata', () => {
      db.upsertDiskMetadata({
        filename: 'test.dsk',
        description: 'Original description',
        size: 1024,
        uploadDate: '2025-01-20T12:00:00Z'
      });

      db.upsertDiskMetadata({
        filename: 'test.dsk',
        description: 'Updated description',
        size: 2048,
        uploadDate: '2025-01-20T13:00:00Z'
      });

      const meta = db.getDiskMetadata('test.dsk');
      expect(meta?.description).toBe('Updated description');
      expect(meta?.size).toBe(2048);
    });

    test('should get all disk metadata', () => {
      db.upsertDiskMetadata({
        filename: 'disk1.dsk',
        description: 'Disk 1',
        size: 1024,
        uploadDate: '2025-01-20T12:00:00Z'
      });

      db.upsertDiskMetadata({
        filename: 'disk2.dsk',
        description: 'Disk 2',
        size: 2048,
        uploadDate: '2025-01-20T13:00:00Z'
      });

      const allMeta = db.getAllDiskMetadata();
      expect(allMeta).toHaveLength(2);
      expect(allMeta.find(m => m.filename === 'disk1.dsk')).toBeTruthy();
      expect(allMeta.find(m => m.filename === 'disk2.dsk')).toBeTruthy();
    });

    test('should update disk description', () => {
      db.upsertDiskMetadata({
        filename: 'test.dsk',
        description: 'Original',
        size: 1024,
        uploadDate: '2025-01-20T12:00:00Z'
      });

      const success = db.updateDiskDescription('test.dsk', 'New description');
      expect(success).toBe(true);

      const meta = db.getDiskMetadata('test.dsk');
      expect(meta?.description).toBe('New description');
    });

    test('should delete disk metadata', () => {
      db.upsertDiskMetadata({
        filename: 'test.dsk',
        description: 'Test',
        size: 1024,
        uploadDate: '2025-01-20T12:00:00Z'
      });

      const deleted = db.deleteDiskMetadata('test.dsk');
      expect(deleted).toBe(true);

      const meta = db.getDiskMetadata('test.dsk');
      expect(meta).toBeNull();
    });

    test('should return false when updating non-existent disk', () => {
      const success = db.updateDiskDescription('nonexistent.dsk', 'Description');
      expect(success).toBe(false);
    });
  });

  describe('Startup Mounts', () => {
    test('should set and get startup mount', () => {
      // Create disk metadata first (required by foreign key)
      db.upsertDiskMetadata({
        filename: 'boot.dsk',
        description: 'Boot disk',
        size: 1024,
        uploadDate: '2025-01-20T12:00:00Z'
      });

      db.setStartupMount(0, 'boot.dsk', false);

      const mount = db.getStartupMount(0);
      expect(mount).not.toBeNull();
      expect(mount?.driveId).toBe(0);
      expect(mount?.diskFilename).toBe('boot.dsk');
      expect(mount?.readonly).toBe(false);
    });

    test('should set startup mount as readonly', () => {
      // Create disk metadata first
      db.upsertDiskMetadata({
        filename: 'readonly.dsk',
        description: 'Read-only disk',
        size: 1024,
        uploadDate: '2025-01-20T12:00:00Z'
      });

      db.setStartupMount(1, 'readonly.dsk', true);

      const mount = db.getStartupMount(1);
      expect(mount?.readonly).toBe(true);
    });

    test('should clear startup mount', () => {
      // Setting to null doesn't require metadata
      db.setStartupMount(0, null, false);
      db.clearStartupMount(0);

      const mount = db.getStartupMount(0);
      expect(mount?.diskFilename).toBeNull();
    });

    test('should get all startup mounts', () => {
      // Create disk metadata first
      db.upsertDiskMetadata({
        filename: 'disk0.dsk',
        description: 'Disk 0',
        size: 1024,
        uploadDate: '2025-01-20T12:00:00Z'
      });
      db.upsertDiskMetadata({
        filename: 'disk1.dsk',
        description: 'Disk 1',
        size: 2048,
        uploadDate: '2025-01-20T13:00:00Z'
      });

      db.setStartupMount(0, 'disk0.dsk', false);
      db.setStartupMount(1, 'disk1.dsk', true);

      const mounts = db.getAllStartupMounts();
      expect(mounts).toHaveLength(4); // All 4 drives initialized

      const mount0 = mounts.find(m => m.driveId === 0);
      const mount1 = mounts.find(m => m.driveId === 1);

      expect(mount0?.diskFilename).toBe('disk0.dsk');
      expect(mount1?.diskFilename).toBe('disk1.dsk');
      expect(mount1?.readonly).toBe(true);
    });

    test('should clear all startup mounts', () => {
      // Create disk metadata first
      db.upsertDiskMetadata({
        filename: 'disk0.dsk',
        description: 'Disk 0',
        size: 1024,
        uploadDate: '2025-01-20T12:00:00Z'
      });
      db.upsertDiskMetadata({
        filename: 'disk1.dsk',
        description: 'Disk 1',
        size: 2048,
        uploadDate: '2025-01-20T13:00:00Z'
      });

      db.setStartupMount(0, 'disk0.dsk', false);
      db.setStartupMount(1, 'disk1.dsk', false);

      db.clearAllStartupMounts();

      const mounts = db.getAllStartupMounts();
      mounts.forEach(mount => {
        expect(mount.diskFilename).toBeNull();
        expect(mount.readonly).toBe(false);
      });
    });

    test('should throw error for invalid drive ID', () => {
      expect(() => db.setStartupMount(5, 'disk.dsk', false)).toThrow();
      expect(() => db.setStartupMount(-1, 'disk.dsk', false)).toThrow();
    });
  });

  describe('Configuration Overrides', () => {
    test('should set and get string config', () => {
      db.setConfigOverride('port', '/dev/ttyUSB0', 'string');

      const value = db.getConfigOverride('port');
      expect(value).toBe('/dev/ttyUSB0');
    });

    test('should set and get number config', () => {
      db.setConfigOverride('baud', 115200, 'number');

      const value = db.getConfigOverride('baud');
      expect(value).toBe(115200);
    });

    test('should set and get boolean config', () => {
      db.setConfigOverride('verbose', true, 'boolean');

      const value = db.getConfigOverride('verbose');
      expect(value).toBe(true);
    });

    test('should set and get JSON config', () => {
      const gpioConfig = { enabled: true, pins: [17, 27, 22, 23] };
      db.setConfigOverride('gpioLeds', gpioConfig, 'json');

      const value = db.getConfigOverride('gpioLeds');
      expect(value).toEqual(gpioConfig);
    });

    test('should get all config overrides', () => {
      db.setConfigOverride('port', '/dev/ttyUSB0', 'string');
      db.setConfigOverride('baud', 115200, 'number');
      db.setConfigOverride('verbose', true, 'boolean');

      const allConfig = db.getAllConfigOverrides();
      expect(allConfig.port).toBe('/dev/ttyUSB0');
      expect(allConfig.baud).toBe(115200);
      expect(allConfig.verbose).toBe(true);
    });

    test('should delete config override', () => {
      db.setConfigOverride('port', '/dev/ttyUSB0', 'string');

      const deleted = db.deleteConfigOverride('port');
      expect(deleted).toBe(true);

      const value = db.getConfigOverride('port');
      expect(value).toBeUndefined();
    });

    test('should clear all config overrides', () => {
      db.setConfigOverride('port', '/dev/ttyUSB0', 'string');
      db.setConfigOverride('baud', 115200, 'number');

      db.clearAllConfigOverrides();

      const allConfig = db.getAllConfigOverrides();
      expect(Object.keys(allConfig)).toHaveLength(0);
    });
  });

  describe('Disk Usage Check', () => {
    test('should detect disk in use by startup mount', () => {
      // Create disk metadata first
      db.upsertDiskMetadata({
        filename: 'test.dsk',
        description: 'Test',
        size: 1024,
        uploadDate: '2025-01-20T12:00:00Z'
      });

      db.setStartupMount(0, 'test.dsk', false);

      expect(db.isDiskInUse('test.dsk')).toBe(true);
    });

    test('should return false for unused disk', () => {
      // Disk doesn't need to exist in metadata to check if it's unused
      expect(db.isDiskInUse('nonexistent.dsk')).toBe(false);
    });
  });

  describe('Transactions', () => {
    test('should execute transaction successfully', () => {
      const result = db.transaction(() => {
        db.upsertDiskMetadata({
          filename: 'disk1.dsk',
          description: 'Disk 1',
          size: 1024,
          uploadDate: '2025-01-20T12:00:00Z'
        });

        db.upsertDiskMetadata({
          filename: 'disk2.dsk',
          description: 'Disk 2',
          size: 2048,
          uploadDate: '2025-01-20T13:00:00Z'
        });

        return 'success';
      });

      expect(result).toBe('success');

      const allMeta = db.getAllDiskMetadata();
      expect(allMeta).toHaveLength(2);
    });
  });
});
