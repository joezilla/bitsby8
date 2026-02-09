/**
 * Tests for CP/M Filesystem Module
 */

import {
  CpmFilesystem,
  CpmDiskParams,
  CDBL,
  INTERLEAVE_TABLE,
  REVERSE_INTERLEAVE_TABLE,
  PARAMS_8INCH,
  PARAMS_MINIDISK,
} from '../src/cpm-filesystem';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Test disk image builder
// ---------------------------------------------------------------------------

/**
 * Build a minimal CDBL-framed DSK buffer for testing.
 * Creates proper sector framing with track bytes, markers, and checksums.
 */
function buildTestDisk(
  params: CpmDiskParams = PARAMS_8INCH,
  options?: {
    files?: Array<{
      user?: number;
      filename: string;
      extension: string;
      data: Buffer;
      readonly?: boolean;
      system?: boolean;
    }>;
    emptyDir?: boolean;
  }
): Buffer {
  const imageSize = params.tracks * CDBL.TRACK_SIZE;
  const image = Buffer.alloc(imageSize, 0);

  // Initialize all sectors with proper CDBL framing
  for (let track = 0; track < params.tracks; track++) {
    for (let sec = 0; sec < CDBL.SECTORS_PER_TRACK; sec++) {
      const base = (track * CDBL.SECTORS_PER_TRACK + sec) * CDBL.SECTOR_SIZE;
      // Byte 0: track | 0x80
      image[base] = track | 0x80;
      // Byte 131: marker
      image[base + CDBL.MARKER_OFFSET] = 0xFF;
      // Byte 132: checksum (0 for zero data)
      image[base + CDBL.CHECKSUM_OFFSET] = 0;
    }
  }

  // Build a CpmFilesystem to write directory and files
  const cpm = new CpmFilesystem(image, params);

  // Initialize directory area with 0xE5 (all entries deleted)
  const entriesPerBlock = params.blocksize / 32;
  const dirBlocks = Math.ceil(params.maxdir / entriesPerBlock);
  for (let b = 0; b < dirBlocks; b++) {
    const blockData = Buffer.alloc(params.blocksize, 0xE5);
    cpm.writeBlock(b, blockData);
  }

  // Write files if specified
  if (options?.files) {
    for (const file of options.files) {
      cpm.writeFile(file.filename, file.extension, file.data, file.user || 0);
    }

    // Apply attributes if needed
    if (options.files.some(f => f.readonly || f.system)) {
      const entries = cpm.readDirectory();
      for (const file of options.files) {
        if (!file.readonly && !file.system) continue;
        const normFn = file.filename.toUpperCase().padEnd(8, ' ');
        const normExt = file.extension.toUpperCase().padEnd(3, ' ');
        for (const entry of entries) {
          if (entry.status === (file.user || 0) &&
              entry.filename === normFn &&
              entry.extension === normExt) {
            if (file.readonly) entry.readonly = true;
            if (file.system) entry.system = true;
          }
        }
      }
      cpm.writeDirectory(entries);
    }
  }

  return cpm.getImageData();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CpmFilesystem', () => {
  // =========================================================================
  // Interleave table
  // =========================================================================
  describe('interleave table', () => {
    test('maps logical sectors 0-15 to even physical sectors', () => {
      for (let log = 0; log < 16; log++) {
        expect(INTERLEAVE_TABLE[log]).toBe(log * 2);
      }
    });

    test('maps logical sectors 16-31 to odd physical sectors', () => {
      for (let log = 16; log < 32; log++) {
        expect(INTERLEAVE_TABLE[log]).toBe((log - 16) * 2 + 1);
      }
    });

    test('reverse table is inverse of forward table', () => {
      for (let log = 0; log < 32; log++) {
        expect(REVERSE_INTERLEAVE_TABLE[INTERLEAVE_TABLE[log]]).toBe(log);
      }
    });

    test('all 32 physical sectors are covered exactly once', () => {
      const physicals = new Set(INTERLEAVE_TABLE);
      expect(physicals.size).toBe(32);
      for (let i = 0; i < 32; i++) {
        expect(physicals.has(i)).toBe(true);
      }
    });
  });

  // =========================================================================
  // Sector I/O with CDBL framing
  // =========================================================================
  describe('readSector / writeSector', () => {
    test('reads 128 bytes of data from correct CDBL offset', () => {
      const image = buildTestDisk();
      const cpm = new CpmFilesystem(image, PARAMS_8INCH);

      // Write known data to a sector in the image directly
      const testData = Buffer.alloc(128);
      for (let i = 0; i < 128; i++) testData[i] = i & 0xFF;

      cpm.writeSector(2, 0, testData);
      const read = cpm.readSector(2, 0);
      expect(read).toEqual(testData);
    });

    test('writeSector updates CDBL framing bytes', () => {
      const image = buildTestDisk();
      const cpm = new CpmFilesystem(image, PARAMS_8INCH);

      const data = Buffer.alloc(128, 0x42);
      cpm.writeSector(5, 3, data);

      // Check the raw image via getImageData
      const raw = cpm.getImageData();
      const physSec = INTERLEAVE_TABLE[3];
      const base = (5 * 32 + physSec) * CDBL.SECTOR_SIZE;

      // Track byte with sync bit
      expect(raw[base]).toBe(5 | 0x80);
      // Marker byte
      expect(raw[base + CDBL.MARKER_OFFSET]).toBe(0xFF);
      // Checksum: 128 * 0x42 = 8448 → 0x42 * 128 mod 256
      const expectedChecksum = (0x42 * 128) & 0xFF;
      expect(raw[base + CDBL.CHECKSUM_OFFSET]).toBe(expectedChecksum);
    });

    test('interleave mapping is correct for sector I/O', () => {
      const image = buildTestDisk();
      const cpm = new CpmFilesystem(image, PARAMS_8INCH);

      // Write different data to logical sectors 0 and 16
      const data0 = Buffer.alloc(128, 0xAA);
      const data16 = Buffer.alloc(128, 0xBB);
      cpm.writeSector(3, 0, data0);
      cpm.writeSector(3, 16, data16);

      // Logical 0 → physical 0 (even), logical 16 → physical 1 (first odd)
      expect(cpm.readSector(3, 0)).toEqual(data0);
      expect(cpm.readSector(3, 16)).toEqual(data16);
    });

    test('throws on out-of-bounds sector read', () => {
      const image = buildTestDisk();
      const cpm = new CpmFilesystem(image, PARAMS_8INCH);
      expect(() => cpm.readSector(77, 0)).toThrow(/out of bounds/);
    });
  });

  // =========================================================================
  // Block I/O
  // =========================================================================
  describe('readBlock / writeBlock', () => {
    test('reads blocksize bytes spanning multiple sectors', () => {
      const image = buildTestDisk();
      const cpm = new CpmFilesystem(image, PARAMS_8INCH);

      // Write known data to block 2 (after directory blocks)
      const blockData = Buffer.alloc(2048);
      for (let i = 0; i < 2048; i++) blockData[i] = i & 0xFF;

      cpm.writeBlock(2, blockData);
      const read = cpm.readBlock(2);
      expect(read).toEqual(blockData);
    });

    test('block 0 starts at boottrk', () => {
      const image = buildTestDisk();
      const cpm = new CpmFilesystem(image, PARAMS_8INCH);

      const data = Buffer.alloc(2048, 0xCC);
      cpm.writeBlock(0, data);

      // Block 0 sector 0 should be at track 2 (boottrk), logical sector 0
      const sector = cpm.readSector(2, 0);
      expect(sector[0]).toBe(0xCC);
    });

    test('blocks span track boundaries correctly', () => {
      const image = buildTestDisk();
      const cpm = new CpmFilesystem(image, PARAMS_8INCH);

      // Block at the track boundary: 32 sectors/track, 16 sectors/block (2048/128)
      // Block 2 starts at absolute sector 32 (track 2 + 2 full tracks = track 4, sector 0)
      const blockData = Buffer.alloc(2048);
      for (let i = 0; i < 2048; i++) blockData[i] = (i + 7) & 0xFF;

      cpm.writeBlock(2, blockData);
      const read = cpm.readBlock(2);
      expect(read).toEqual(blockData);
    });

    test('throws on wrong-size block data', () => {
      const image = buildTestDisk();
      const cpm = new CpmFilesystem(image, PARAMS_8INCH);
      expect(() => cpm.writeBlock(0, Buffer.alloc(100))).toThrow(/exactly/);
    });
  });

  // =========================================================================
  // Directory parsing
  // =========================================================================
  describe('readDirectory', () => {
    test('returns maxdir entries from empty disk', () => {
      const image = buildTestDisk(PARAMS_8INCH, { emptyDir: true });
      const cpm = new CpmFilesystem(image, PARAMS_8INCH);
      const entries = cpm.readDirectory();
      expect(entries.length).toBe(64);
      // All should be deleted (0xE5)
      for (const e of entries) {
        expect(e.status).toBe(0xE5);
      }
    });

    test('parses file entries with correct filename and extension', () => {
      const image = buildTestDisk(PARAMS_8INCH, {
        files: [{
          filename: 'TEST',
          extension: 'COM',
          data: Buffer.from('Hello CP/M'),
        }],
      });

      const cpm = new CpmFilesystem(image, PARAMS_8INCH);
      const entries = cpm.readDirectory();
      const active = entries.filter(e => e.status !== 0xE5 && e.status <= 0x1F);

      expect(active.length).toBe(1);
      expect(active[0].filename.trimEnd()).toBe('TEST');
      expect(active[0].extension.trimEnd()).toBe('COM');
      expect(active[0].status).toBe(0); // user 0
    });

    test('parses attributes (readonly, system)', () => {
      const image = buildTestDisk(PARAMS_8INCH, {
        files: [{
          filename: 'READONLY',
          extension: 'TXT',
          data: Buffer.from('read only file'),
          readonly: true,
          system: true,
        }],
      });

      const cpm = new CpmFilesystem(image, PARAMS_8INCH);
      const entries = cpm.readDirectory();
      const active = entries.filter(e => e.status !== 0xE5 && e.status <= 0x1F);

      expect(active.length).toBe(1);
      expect(active[0].readonly).toBe(true);
      expect(active[0].system).toBe(true);
    });
  });

  // =========================================================================
  // listFiles
  // =========================================================================
  describe('listFiles', () => {
    test('lists files from disk with multiple files', () => {
      const image = buildTestDisk(PARAMS_8INCH, {
        files: [
          { filename: 'HELLO', extension: 'COM', data: Buffer.alloc(256, 0x41) },
          { filename: 'WORLD', extension: 'TXT', data: Buffer.alloc(100, 0x42) },
        ],
      });

      const cpm = new CpmFilesystem(image, PARAMS_8INCH);
      const files = cpm.listFiles();

      expect(files.length).toBe(2);
      const names = files.map(f => `${f.filename}.${f.extension}`);
      expect(names).toContain('HELLO.COM');
      expect(names).toContain('WORLD.TXT');
    });

    test('computes correct file size', () => {
      const data = Buffer.alloc(300, 0x55);
      const image = buildTestDisk(PARAMS_8INCH, {
        files: [{ filename: 'SIZE', extension: 'TST', data }],
      });

      const cpm = new CpmFilesystem(image, PARAMS_8INCH);
      const files = cpm.listFiles();
      const file = files.find(f => f.filename === 'SIZE');

      expect(file).toBeDefined();
      // RC = ceil(300/128) = 3, BC = 300 % 128 = 44
      // Size = (3-1)*128 + 44 = 300
      expect(file!.size).toBe(300);
    });

    test('handles multi-extent files', () => {
      // Create a file larger than one extent can hold
      // With 8-bit pointers, 16 pointers × 2048 block = 32768 bytes per extent
      const bigData = Buffer.alloc(40000, 0x77);
      const image = buildTestDisk(PARAMS_8INCH, {
        files: [{ filename: 'BIG', extension: 'DAT', data: bigData }],
      });

      const cpm = new CpmFilesystem(image, PARAMS_8INCH);
      const files = cpm.listFiles();
      const file = files.find(f => f.filename === 'BIG');

      expect(file).toBeDefined();
      expect(file!.extents.length).toBeGreaterThan(1);
      expect(file!.size).toBe(40000);
    });

    test('separates files by user number', () => {
      const image = buildTestDisk(PARAMS_8INCH, {
        files: [
          { filename: 'SAME', extension: 'COM', data: Buffer.alloc(10, 0x01), user: 0 },
          { filename: 'SAME', extension: 'COM', data: Buffer.alloc(20, 0x02), user: 1 },
        ],
      });

      const cpm = new CpmFilesystem(image, PARAMS_8INCH);
      const files = cpm.listFiles();

      const user0 = files.find(f => f.filename === 'SAME' && f.user === 0);
      const user1 = files.find(f => f.filename === 'SAME' && f.user === 1);

      expect(user0).toBeDefined();
      expect(user1).toBeDefined();
      expect(user0!.size).toBe(10);
      expect(user1!.size).toBe(20);
    });

    test('returns empty array for empty disk', () => {
      const image = buildTestDisk(PARAMS_8INCH);
      const cpm = new CpmFilesystem(image, PARAMS_8INCH);
      const files = cpm.listFiles();
      expect(files).toEqual([]);
    });
  });

  // =========================================================================
  // readFile
  // =========================================================================
  describe('readFile', () => {
    test('reads file content correctly', () => {
      const content = Buffer.from('The quick brown fox jumps over the lazy dog.');
      const image = buildTestDisk(PARAMS_8INCH, {
        files: [{ filename: 'FOX', extension: 'TXT', data: content }],
      });

      const cpm = new CpmFilesystem(image, PARAMS_8INCH);
      const result = cpm.readFile('FOX', 'TXT');
      expect(result.toString()).toBe(content.toString());
    });

    test('reads binary file correctly', () => {
      const binary = Buffer.alloc(512);
      for (let i = 0; i < 512; i++) binary[i] = i & 0xFF;

      const image = buildTestDisk(PARAMS_8INCH, {
        files: [{ filename: 'BINARY', extension: 'COM', data: binary }],
      });

      const cpm = new CpmFilesystem(image, PARAMS_8INCH);
      const result = cpm.readFile('BINARY', 'COM');
      expect(result).toEqual(binary);
    });

    test('throws for non-existent file', () => {
      const image = buildTestDisk(PARAMS_8INCH);
      const cpm = new CpmFilesystem(image, PARAMS_8INCH);
      expect(() => cpm.readFile('NOFILE', 'COM')).toThrow(/not found/);
    });

    test('reads file with specific user number', () => {
      const data0 = Buffer.from('user zero');
      const data1 = Buffer.from('user one');
      const image = buildTestDisk(PARAMS_8INCH, {
        files: [
          { filename: 'MULTI', extension: 'TXT', data: data0, user: 0 },
          { filename: 'MULTI', extension: 'TXT', data: data1, user: 1 },
        ],
      });

      const cpm = new CpmFilesystem(image, PARAMS_8INCH);
      expect(cpm.readFile('MULTI', 'TXT', 0).toString()).toBe('user zero');
      expect(cpm.readFile('MULTI', 'TXT', 1).toString()).toBe('user one');
    });
  });

  // =========================================================================
  // Write round-trip
  // =========================================================================
  describe('writeFile / readFile round-trip', () => {
    test('write then read returns same data', () => {
      const image = buildTestDisk(PARAMS_8INCH);
      const cpm = new CpmFilesystem(image, PARAMS_8INCH);

      const content = Buffer.from('Hello from the CP/M filesystem test!');
      cpm.writeFile('HELLO', 'TXT', content);
      const result = cpm.readFile('HELLO', 'TXT');
      expect(result.toString()).toBe(content.toString());
    });

    test('write overwrites existing file', () => {
      const image = buildTestDisk(PARAMS_8INCH, {
        files: [{ filename: 'OVER', extension: 'WRT', data: Buffer.from('old content') }],
      });

      const cpm = new CpmFilesystem(image, PARAMS_8INCH);
      const newContent = Buffer.from('new content replaced');
      cpm.writeFile('OVER', 'WRT', newContent);

      const result = cpm.readFile('OVER', 'WRT');
      expect(result.toString()).toBe('new content replaced');
    });

    test('handles exact block-boundary size', () => {
      const image = buildTestDisk(PARAMS_8INCH);
      const cpm = new CpmFilesystem(image, PARAMS_8INCH);

      // Exactly 2048 bytes = 1 block
      const data = Buffer.alloc(2048, 0xAA);
      cpm.writeFile('BLOCK', 'TST', data);
      const result = cpm.readFile('BLOCK', 'TST');
      expect(result).toEqual(data);
    });

    test('handles exact sector-boundary size', () => {
      const image = buildTestDisk(PARAMS_8INCH);
      const cpm = new CpmFilesystem(image, PARAMS_8INCH);

      // Exactly 128 bytes = 1 sector
      const data = Buffer.alloc(128, 0xBB);
      cpm.writeFile('SECTOR', 'TST', data);
      const result = cpm.readFile('SECTOR', 'TST');
      expect(result).toEqual(data);
    });

    test('write multiple files then read all back', () => {
      const image = buildTestDisk(PARAMS_8INCH);
      const cpm = new CpmFilesystem(image, PARAMS_8INCH);

      const files = [
        { name: 'FILE1', ext: 'COM', data: Buffer.alloc(1000, 0x11) },
        { name: 'FILE2', ext: 'TXT', data: Buffer.from('Second file content') },
        { name: 'FILE3', ext: 'DAT', data: Buffer.alloc(5000, 0x33) },
      ];

      for (const f of files) {
        cpm.writeFile(f.name, f.ext, f.data);
      }

      for (const f of files) {
        const result = cpm.readFile(f.name, f.ext);
        expect(result).toEqual(f.data);
      }
    });
  });

  // =========================================================================
  // deleteFile
  // =========================================================================
  describe('deleteFile', () => {
    test('deletes file and it no longer appears in listing', () => {
      const image = buildTestDisk(PARAMS_8INCH, {
        files: [
          { filename: 'KEEP', extension: 'COM', data: Buffer.alloc(100) },
          { filename: 'DEL', extension: 'ME', data: Buffer.alloc(200) },
        ],
      });

      const cpm = new CpmFilesystem(image, PARAMS_8INCH);
      cpm.deleteFile('DEL', 'ME');

      const files = cpm.listFiles();
      expect(files.length).toBe(1);
      expect(files[0].filename).toBe('KEEP');
    });

    test('throws when deleting non-existent file', () => {
      const image = buildTestDisk(PARAMS_8INCH);
      const cpm = new CpmFilesystem(image, PARAMS_8INCH);
      expect(() => cpm.deleteFile('NOFILE', 'COM')).toThrow(/not found/);
    });

    test('frees blocks after deletion', () => {
      const image = buildTestDisk(PARAMS_8INCH);
      const cpm = new CpmFilesystem(image, PARAMS_8INCH);

      const freeBeforeWrite = cpm.getFreeSpace().freeBlocks;
      cpm.writeFile('TEMP', 'DAT', Buffer.alloc(4096, 0x55));
      const freeAfterWrite = cpm.getFreeSpace().freeBlocks;
      expect(freeAfterWrite).toBeLessThan(freeBeforeWrite);

      cpm.deleteFile('TEMP', 'DAT');
      const freeAfterDelete = cpm.getFreeSpace().freeBlocks;
      expect(freeAfterDelete).toBe(freeBeforeWrite);
    });
  });

  // =========================================================================
  // Block allocation and free space
  // =========================================================================
  describe('allocation and free space', () => {
    test('buildAllocationBitmap marks directory blocks', () => {
      const image = buildTestDisk(PARAMS_8INCH);
      const cpm = new CpmFilesystem(image, PARAMS_8INCH);
      const bitmap = cpm.buildAllocationBitmap();

      // Directory: 64 entries × 32 bytes = 2048 bytes = 1 block
      expect(bitmap[0]).toBe(true);
      // Block 1 should be free on an empty disk
      expect(bitmap[1]).toBe(false);
    });

    test('getFreeSpace reports correct values for empty disk', () => {
      const image = buildTestDisk(PARAMS_8INCH);
      const cpm = new CpmFilesystem(image, PARAMS_8INCH);
      const space = cpm.getFreeSpace();

      // Total blocks: (77-2) * 32 * 128 / 2048 = 150
      expect(space.totalBlocks).toBe(150);
      // 1 block used for directory
      expect(space.usedBlocks).toBe(1);
      expect(space.freeBlocks).toBe(149);
      expect(space.directoryEntriesFree).toBe(64);
      expect(space.directoryEntriesTotal).toBe(64);
    });

    test('allocateBlocks returns correct count', () => {
      const image = buildTestDisk(PARAMS_8INCH);
      const cpm = new CpmFilesystem(image, PARAMS_8INCH);
      const blocks = cpm.allocateBlocks(5);
      expect(blocks.length).toBe(5);
      // All allocated blocks should be unique
      expect(new Set(blocks).size).toBe(5);
    });

    test('allocateBlocks throws when disk is full', () => {
      const image = buildTestDisk(PARAMS_8INCH);
      const cpm = new CpmFilesystem(image, PARAMS_8INCH);
      expect(() => cpm.allocateBlocks(200)).toThrow(/full/);
    });

    test('free space decreases after writing files', () => {
      const image = buildTestDisk(PARAMS_8INCH);
      const cpm = new CpmFilesystem(image, PARAMS_8INCH);

      const before = cpm.getFreeSpace();
      cpm.writeFile('TEST', 'DAT', Buffer.alloc(4096, 0x42)); // 2 blocks
      const after = cpm.getFreeSpace();

      expect(after.freeBlocks).toBe(before.freeBlocks - 2);
      expect(after.directoryEntriesFree).toBe(before.directoryEntriesFree - 1);
    });
  });

  // =========================================================================
  // detectParams
  // =========================================================================
  describe('detectParams', () => {
    test('detects 8-inch disk from image size (337,568 bytes)', () => {
      const image = buildTestDisk(PARAMS_8INCH);
      expect(image.length).toBe(77 * CDBL.TRACK_SIZE); // 337,568
      const params = CpmFilesystem.detectParams(image);
      expect(params).not.toBeNull();
      expect(params!.tracks).toBe(77);
      expect(params!.blocksize).toBe(2048);
    });

    test('detects 8-inch disk with 96 extra bytes (337,664 bytes)', () => {
      const image = Buffer.alloc(337664, 0);
      // Copy a valid test disk into the larger buffer
      const validDisk = buildTestDisk(PARAMS_8INCH);
      validDisk.copy(image);
      const params = CpmFilesystem.detectParams(image);
      expect(params).not.toBeNull();
      expect(params!.tracks).toBe(77);
    });

    test('returns null for non-CP/M disk (all zeros, no valid dir)', () => {
      const image = Buffer.alloc(337568, 0);
      // All zeros won't have valid directory structure
      // (status 0x00 with all-zero filename bytes → non-printable)
      // Actually, 0x00 status with space chars (0x20) would be valid...
      // Let's create an image with non-ASCII junk in directory area
      const dirOffset = (2 * 32 + INTERLEAVE_TABLE[0]) * CDBL.SECTOR_SIZE + CDBL.DATA_OFFSET;
      for (let i = 0; i < 128; i++) {
        image[dirOffset + i] = 0x01; // Non-printable, non-E5 status with garbage
      }
      const params = CpmFilesystem.detectParams(image);
      expect(params).toBeNull();
    });

    test('returns null for tiny images', () => {
      const image = Buffer.alloc(1000, 0);
      expect(CpmFilesystem.detectParams(image)).toBeNull();
    });
  });

  // =========================================================================
  // normalizeFilename
  // =========================================================================
  describe('normalizeFilename', () => {
    test('uppercases and trims', () => {
      expect(CpmFilesystem.normalizeFilename('hello.txt')).toEqual({
        filename: 'HELLO', extension: 'TXT',
      });
    });

    test('handles no extension', () => {
      expect(CpmFilesystem.normalizeFilename('README')).toEqual({
        filename: 'README', extension: '',
      });
    });

    test('truncates to 8.3', () => {
      expect(CpmFilesystem.normalizeFilename('longfilename.longext')).toEqual({
        filename: 'LONGFILE', extension: 'LON',
      });
    });

    test('strips user prefix', () => {
      expect(CpmFilesystem.normalizeFilename('3:TEST.COM')).toEqual({
        filename: 'TEST', extension: 'COM',
      });
    });
  });

  // =========================================================================
  // parseFilenameParam
  // =========================================================================
  describe('parseFilenameParam', () => {
    test('parses simple filename', () => {
      expect(CpmFilesystem.parseFilenameParam('TEST.COM')).toEqual({
        user: 0, filename: 'TEST', extension: 'COM',
      });
    });

    test('parses user-qualified filename', () => {
      expect(CpmFilesystem.parseFilenameParam('5:DATA.BIN')).toEqual({
        user: 5, filename: 'DATA', extension: 'BIN',
      });
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================
  describe('edge cases', () => {
    test('zero-length file', () => {
      const image = buildTestDisk(PARAMS_8INCH);
      const cpm = new CpmFilesystem(image, PARAMS_8INCH);

      cpm.writeFile('EMPTY', 'FIL', Buffer.alloc(0));
      const files = cpm.listFiles();
      const empty = files.find(f => f.filename === 'EMPTY');
      expect(empty).toBeDefined();
      expect(empty!.size).toBe(0);
    });

    test('single-byte file', () => {
      const image = buildTestDisk(PARAMS_8INCH);
      const cpm = new CpmFilesystem(image, PARAMS_8INCH);

      cpm.writeFile('ONE', 'BYT', Buffer.from([0x42]));
      const result = cpm.readFile('ONE', 'BYT');
      expect(result.length).toBe(1);
      expect(result[0]).toBe(0x42);
    });

    test('getParams returns copy of params', () => {
      const image = buildTestDisk(PARAMS_8INCH);
      const cpm = new CpmFilesystem(image, PARAMS_8INCH);
      const params = cpm.getParams();
      params.tracks = 999;
      expect(cpm.getParams().tracks).toBe(77);
    });

    test('constructor makes defensive copy of image data', () => {
      const original = buildTestDisk(PARAMS_8INCH);
      const copy = Buffer.from(original);
      const cpm = new CpmFilesystem(copy, PARAMS_8INCH);

      // Modify the passed-in buffer
      copy.fill(0xFF);

      // CpmFilesystem should still work correctly
      const entries = cpm.readDirectory();
      expect(entries.length).toBe(64);
    });

    test('handles minidisk parameters', () => {
      const image = buildTestDisk(PARAMS_MINIDISK);
      const cpm = new CpmFilesystem(image, PARAMS_MINIDISK);

      cpm.writeFile('MINI', 'TST', Buffer.from('minidisk test'));
      const result = cpm.readFile('MINI', 'TST');
      expect(result.toString()).toBe('minidisk test');
    });
  });

  // =========================================================================
  // Integration tests with real disk images
  // =========================================================================
  describe('real disk images', () => {
    const disksDir = path.join(__dirname, '..', 'disks');

    // Only run these tests if disks directory exists
    const hasDisks = fs.existsSync(disksDir);

    const realImageTest = hasDisks ? test : test.skip;

    realImageTest('detectParams works on LIFEBOAT-CPM22-48K.DSK', () => {
      const imgPath = path.join(disksDir, 'LIFEBOAT-CPM22-48K.DSK');
      if (!fs.existsSync(imgPath)) return;

      const imageData = fs.readFileSync(imgPath);
      const params = CpmFilesystem.detectParams(imageData);
      expect(params).not.toBeNull();
      expect(params!.tracks).toBe(77);
      expect(params!.sectrk).toBe(32);
      expect(params!.blocksize).toBe(2048);
    });

    realImageTest('lists files from LIFEBOAT-CPM22-48K.DSK', () => {
      const imgPath = path.join(disksDir, 'LIFEBOAT-CPM22-48K.DSK');
      if (!fs.existsSync(imgPath)) return;

      const imageData = fs.readFileSync(imgPath);
      const cpm = new CpmFilesystem(imageData);
      const files = cpm.listFiles();

      expect(files.length).toBeGreaterThan(0);

      // Verify some expected files exist
      const names = files.map(f => `${f.filename}.${f.extension}`);
      // Common CP/M 2.2 files
      const hasKnownFiles = names.some(n =>
        n.includes('MOVCPM') || n.includes('PIP') || n.includes('STAT') ||
        n.includes('DDT') || n.includes('ASM') || n.includes('LOAD')
      );
      expect(hasKnownFiles).toBe(true);
    });

    realImageTest('reads a file from LIFEBOAT-CPM22-48K.DSK', () => {
      const imgPath = path.join(disksDir, 'LIFEBOAT-CPM22-48K.DSK');
      if (!fs.existsSync(imgPath)) return;

      const imageData = fs.readFileSync(imgPath);
      const cpm = new CpmFilesystem(imageData);
      const files = cpm.listFiles();

      // Read the first file we find
      if (files.length > 0) {
        const file = files[0];
        const data = cpm.readFile(file.filename, file.extension, file.user);
        expect(data.length).toBe(file.size);
      }
    });

    realImageTest('getFreeSpace returns valid data for real disk', () => {
      const imgPath = path.join(disksDir, 'LIFEBOAT-CPM22-48K.DSK');
      if (!fs.existsSync(imgPath)) return;

      const imageData = fs.readFileSync(imgPath);
      const cpm = new CpmFilesystem(imageData);
      const space = cpm.getFreeSpace();

      expect(space.totalBlocks).toBe(150);
      expect(space.usedBlocks).toBeGreaterThan(0);
      expect(space.freeBlocks).toBeLessThan(space.totalBlocks);
      expect(space.usedBlocks + space.freeBlocks).toBe(space.totalBlocks);
    });

    // Test all .dsk files in disks/ directory for detectParams
    if (hasDisks) {
      const dskFiles = fs.readdirSync(disksDir).filter(f => f.toLowerCase().endsWith('.dsk'));
      for (const dskFile of dskFiles) {
        realImageTest(`detectParams on ${dskFile}`, () => {
          const imgPath = path.join(disksDir, dskFile);
          const imageData = fs.readFileSync(imgPath);
          const size = imageData.length;

          // Only test standard-size images
          if (size >= 337568 && size <= 337664) {
            const params = CpmFilesystem.detectParams(imageData);
            // Some disks may not have CP/M filesystem (boot-only), so null is OK
            if (params) {
              expect(params.tracks).toBe(77);
              expect(params.sectrk).toBe(32);
            }
          }
        });
      }
    }
  });
});
