/**
 * Unit and integration tests for create-boot-disk.js
 *
 * Tests the Intel HEX parser, disk image creator, argument parser,
 * and end-to-end CLI behavior.
 */

const {
  parseIntelHex,
  createDiskImage,
  parseArgs,
  SECTOR_SIZE,
  SECTORS_PER_TRACK,
  DATA_PER_SECTOR,
  TRACK_SIZE,
  TRACKS_8INCH,
  TRACKS_MINIDISK,
  MAX_TRACKS,
} = require('../create-boot-disk');

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Helpers for building Intel HEX records
// ---------------------------------------------------------------------------

/** Build a valid Intel HEX data record (type 00) */
function makeDataRecord(address: number, data: number[]): string {
  const byteCount = data.length;
  const type = 0x00;
  let sum = byteCount + ((address >> 8) & 0xff) + (address & 0xff) + type;
  for (const b of data) sum += b;
  const checksum = (~sum + 1) & 0xff;
  const hex = data.map((b) => b.toString(16).padStart(2, '0')).join('');
  return (
    ':' +
    [
      byteCount.toString(16).padStart(2, '0'),
      address.toString(16).padStart(4, '0'),
      type.toString(16).padStart(2, '0'),
      hex,
      checksum.toString(16).padStart(2, '0'),
    ]
      .join('')
      .toUpperCase()
  );
}

/** EOF record (type 01) */
const EOF_RECORD = ':00000001FF';

/** Extended segment address record (type 02) — sets base = segment << 4 */
function makeExtSegRecord(segment: number): string {
  const type = 0x02;
  const hi = (segment >> 8) & 0xff;
  const lo = segment & 0xff;
  let sum = 2 + 0 + 0 + type + hi + lo;
  const checksum = (~sum + 1) & 0xff;
  return (
    ':02000002' +
    hi.toString(16).padStart(2, '0').toUpperCase() +
    lo.toString(16).padStart(2, '0').toUpperCase() +
    checksum.toString(16).padStart(2, '0').toUpperCase()
  );
}

/** Extended linear address record (type 04) — sets base = upper << 16 */
function makeExtLinRecord(upper: number): string {
  const type = 0x04;
  const hi = (upper >> 8) & 0xff;
  const lo = upper & 0xff;
  let sum = 2 + 0 + 0 + type + hi + lo;
  const checksum = (~sum + 1) & 0xff;
  return (
    ':02000004' +
    hi.toString(16).padStart(2, '0').toUpperCase() +
    lo.toString(16).padStart(2, '0').toUpperCase() +
    checksum.toString(16).padStart(2, '0').toUpperCase()
  );
}

/** Build a generic HEX record with arbitrary type */
function makeRecord(
  address: number,
  type: number,
  data: number[],
): string {
  const byteCount = data.length;
  let sum =
    byteCount + ((address >> 8) & 0xff) + (address & 0xff) + type;
  for (const b of data) sum += b;
  const checksum = (~sum + 1) & 0xff;
  const hex = data.map((b) => b.toString(16).padStart(2, '0')).join('');
  return (
    ':' +
    [
      byteCount.toString(16).padStart(2, '0'),
      address.toString(16).padStart(4, '0'),
      type.toString(16).padStart(2, '0'),
      hex,
      checksum.toString(16).padStart(2, '0'),
    ]
      .join('')
      .toUpperCase()
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('create-boot-disk', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  // ----- Constants --------------------------------------------------------

  describe('constants', () => {
    test('SECTOR_SIZE is 137', () => {
      expect(SECTOR_SIZE).toBe(137);
    });

    test('SECTORS_PER_TRACK is 32', () => {
      expect(SECTORS_PER_TRACK).toBe(32);
    });

    test('DATA_PER_SECTOR is 128', () => {
      expect(DATA_PER_SECTOR).toBe(128);
    });

    test('TRACK_SIZE is 4384 (137 * 32)', () => {
      expect(TRACK_SIZE).toBe(4384);
      expect(TRACK_SIZE).toBe(SECTOR_SIZE * SECTORS_PER_TRACK);
    });

    test('TRACKS_8INCH is 77', () => {
      expect(TRACKS_8INCH).toBe(77);
    });

    test('TRACKS_MINIDISK is 17', () => {
      expect(TRACKS_MINIDISK).toBe(17);
    });

    test('MAX_TRACKS is 1863', () => {
      expect(MAX_TRACKS).toBe(1863);
    });

    test('8-inch disk size is 337,568 bytes (4384 * 77)', () => {
      expect(TRACK_SIZE * TRACKS_8INCH).toBe(337568);
    });

    test('minidisk size is 74,528 bytes (4384 * 17)', () => {
      expect(TRACK_SIZE * TRACKS_MINIDISK).toBe(74528);
    });

    test('8MB disk size is 8,167,392 bytes (4384 * 1863)', () => {
      expect(TRACK_SIZE * MAX_TRACKS).toBe(8167392);
    });
  });

  // ----- parseIntelHex ----------------------------------------------------

  describe('parseIntelHex', () => {
    test('parses a single data record at address 0x0000', () => {
      const hex = [
        makeDataRecord(0x0000, [0xc3, 0x00, 0x00]),
        EOF_RECORD,
      ].join('\n');

      const result = parseIntelHex(hex);
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBe(3);
      expect(result[0]).toBe(0xc3);
      expect(result[1]).toBe(0x00);
      expect(result[2]).toBe(0x00);
    });

    test('parses multiple contiguous data records', () => {
      const hex = [
        makeDataRecord(0x0000, [0x31, 0xff, 0xff]),
        makeDataRecord(0x0003, [0x76]),
        EOF_RECORD,
      ].join('\n');

      const result = parseIntelHex(hex);
      expect(result.length).toBe(4);
      expect(result[0]).toBe(0x31);
      expect(result[1]).toBe(0xff);
      expect(result[2]).toBe(0xff);
      expect(result[3]).toBe(0x76);
    });

    test('parses non-contiguous data records with gap filled by zeros', () => {
      const hex = [
        makeDataRecord(0x0000, [0xaa]),
        makeDataRecord(0x0010, [0xbb]),
        EOF_RECORD,
      ].join('\n');

      const result = parseIntelHex(hex);
      expect(result.length).toBe(0x0011);
      expect(result[0x0000]).toBe(0xaa);
      expect(result[0x0001]).toBe(0x00); // gap
      expect(result[0x000f]).toBe(0x00); // gap
      expect(result[0x0010]).toBe(0xbb);
    });

    test('handles non-zero base address (code at ORG 0x0100)', () => {
      const hex = [
        makeDataRecord(0x0100, [0xaa, 0xbb]),
        EOF_RECORD,
      ].join('\n');

      const result = parseIntelHex(hex);
      // Buffer is allocated from 0 to maxAddress (0x0102)
      expect(result.length).toBe(0x0102);
      // First 0x100 bytes should be zero
      for (let i = 0; i < 0x0100; i++) {
        expect(result[i]).toBe(0);
      }
      expect(result[0x0100]).toBe(0xaa);
      expect(result[0x0101]).toBe(0xbb);
    });

    test('handles CRLF line endings', () => {
      const hex = [
        makeDataRecord(0x0000, [0x76]),
        EOF_RECORD,
      ].join('\r\n');

      const result = parseIntelHex(hex);
      expect(result.length).toBe(1);
      expect(result[0]).toBe(0x76);
    });

    test('skips blank lines and whitespace-only lines', () => {
      const hex = [
        '',
        '  ',
        makeDataRecord(0x0000, [0x76]),
        '',
        EOF_RECORD,
        '',
      ].join('\n');

      const result = parseIntelHex(hex);
      expect(result.length).toBe(1);
      expect(result[0]).toBe(0x76);
    });

    test('handles extended segment address records (type 02)', () => {
      // Segment 0x1000 -> base address 0x1000 << 4 = 0x10000
      const hex = [
        makeExtSegRecord(0x1000),
        makeDataRecord(0x0000, [0xaa]),
        EOF_RECORD,
      ].join('\n');

      const result = parseIntelHex(hex);
      expect(result.length).toBe(0x10001);
      expect(result[0x10000]).toBe(0xaa);
    });

    test('handles extended linear address records (type 04)', () => {
      // Upper 0x0001 -> base address 0x0001 << 16 = 0x10000
      const hex = [
        makeExtLinRecord(0x0001),
        makeDataRecord(0x0000, [0xbb]),
        EOF_RECORD,
      ].join('\n');

      const result = parseIntelHex(hex);
      expect(result.length).toBe(0x10001);
      expect(result[0x10000]).toBe(0xbb);
    });

    test('extended address resets when a new extended record appears', () => {
      const hex = [
        makeExtSegRecord(0x1000),             // base = 0x10000
        makeDataRecord(0x0000, [0xaa]),        // addr = 0x10000
        makeExtSegRecord(0x0000),             // base = 0x00000
        makeDataRecord(0x0005, [0xcc]),        // addr = 0x00005
        EOF_RECORD,
      ].join('\n');

      const result = parseIntelHex(hex);
      expect(result[0x10000]).toBe(0xaa);
      expect(result[0x0005]).toBe(0xcc);
    });

    test('throws on checksum error', () => {
      const valid = makeDataRecord(0x0000, [0x76]);
      // Corrupt last two chars (checksum)
      const corrupt = valid.slice(0, -2) + 'FF';
      const hex = [corrupt, EOF_RECORD].join('\n');

      expect(() => parseIntelHex(hex)).toThrow(/[Cc]hecksum/);
    });

    test('throws when file has no data records', () => {
      expect(() => parseIntelHex(EOF_RECORD)).toThrow(/[Nn]o data records/);
    });

    test('throws when file is empty / blank lines only', () => {
      expect(() => parseIntelHex('\n\n\n')).toThrow(/[Nn]o data records/);
    });

    test('ignores start segment address records (type 03)', () => {
      const hex = [
        makeDataRecord(0x0000, [0x76]),
        makeRecord(0x0000, 0x03, [0xff, 0xff, 0x00, 0x00]),
        EOF_RECORD,
      ].join('\n');

      const result = parseIntelHex(hex);
      expect(result.length).toBe(1);
      expect(result[0]).toBe(0x76);
    });

    test('ignores start linear address records (type 05)', () => {
      const hex = [
        makeDataRecord(0x0000, [0x76]),
        makeRecord(0x0000, 0x05, [0x00, 0x00, 0x00, 0x00]),
        EOF_RECORD,
      ].join('\n');

      const result = parseIntelHex(hex);
      expect(result.length).toBe(1);
      expect(result[0]).toBe(0x76);
    });

    test('warns on unknown record types', () => {
      const hex = [
        makeDataRecord(0x0000, [0x76]),
        makeRecord(0x0000, 0x06, [0x00]),
        EOF_RECORD,
      ].join('\n');

      parseIntelHex(hex);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown record type'),
      );
    });

    test('parses 16-byte data records (full-length)', () => {
      const data = Array.from({ length: 16 }, (_, i) => i);
      const hex = [makeDataRecord(0x0000, data), EOF_RECORD].join('\n');

      const result = parseIntelHex(hex);
      expect(result.length).toBe(16);
      for (let i = 0; i < 16; i++) {
        expect(result[i]).toBe(i);
      }
    });

    test('parses the examples/hello.hex file', () => {
      const hexPath = path.join(__dirname, '..', 'examples', 'hello.hex');
      if (!fs.existsSync(hexPath)) return; // skip if missing

      const hexContent = fs.readFileSync(hexPath, 'utf8');
      const result = parseIntelHex(hexContent);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThan(TRACK_SIZE);
      // First byte should be 0x31 (LXI SP instruction)
      expect(result[0]).toBe(0x31);
    });
  });

  // ----- createDiskImage --------------------------------------------------

  /** Helper: read sector fields from a disk image at a given physical sector */
  function readSector(disk: Buffer, track: number, sector: number) {
    const offset = (track * SECTORS_PER_TRACK + sector) * SECTOR_SIZE;
    const trackByte = disk[offset];
    const fileSizeLo = disk[offset + 1];
    const fileSizeHi = disk[offset + 2];
    const fileSize = fileSizeLo | (fileSizeHi << 8);
    const data = disk.slice(offset + 3, offset + 3 + DATA_PER_SECTOR);
    const marker = disk[offset + 131];
    const checksum = disk[offset + 132];
    return { trackByte, fileSize, data, marker, checksum };
  }

  /** Compute expected checksum for 128 data bytes */
  function computeChecksum(data: Buffer): number {
    let sum = 0;
    for (let i = 0; i < DATA_PER_SECTOR; i++) {
      sum = (sum + (data[i] || 0)) & 0xff;
    }
    return sum;
  }

  describe('createDiskImage', () => {
    test('creates disk of correct size for 8-inch (77 tracks)', () => {
      const disk = createDiskImage(Buffer.from([0x76]), 77);
      expect(disk.length).toBe(TRACK_SIZE * 77);
    });

    test('creates disk of correct size for minidisk (17 tracks)', () => {
      const disk = createDiskImage(Buffer.from([0x76]), 17);
      expect(disk.length).toBe(TRACK_SIZE * 17);
    });

    test('creates disk of correct size for 8MB (1863 tracks)', () => {
      const disk = createDiskImage(Buffer.from([0x76]), MAX_TRACKS);
      expect(disk.length).toBe(TRACK_SIZE * MAX_TRACKS);
    });

    test('formats sector 0 with correct CDBL boot-track structure', () => {
      const boot = Buffer.from([0x31, 0xff, 0xff, 0x76]);
      const disk = createDiskImage(boot, 77);
      const sec = readSector(disk, 0, 0);

      // Header
      expect(sec.trackByte).toBe(0x80);    // track 0 | 0x80
      expect(sec.fileSize).toBe(4);         // boot code length

      // Data: first 4 bytes are boot code, rest are zero-padded
      expect(sec.data[0]).toBe(0x31);
      expect(sec.data[1]).toBe(0xff);
      expect(sec.data[2]).toBe(0xff);
      expect(sec.data[3]).toBe(0x76);
      for (let i = 4; i < DATA_PER_SECTOR; i++) {
        expect(sec.data[i]).toBe(0);
      }

      // Trailer
      expect(sec.marker).toBe(0xff);
      expect(sec.checksum).toBe(computeChecksum(sec.data));
    });

    test('all sectors have valid marker byte and checksum', () => {
      const disk = createDiskImage(Buffer.from([0x76]), 1);

      for (let s = 0; s < SECTORS_PER_TRACK; s++) {
        const sec = readSector(disk, 0, s);
        expect(sec.trackByte).toBe(0x80);
        expect(sec.marker).toBe(0xff);
        expect(sec.checksum).toBe(computeChecksum(sec.data));
      }
    });

    test('interleaves data in 2:1 order (even sectors first, then odd)', () => {
      // Create boot code large enough to span multiple sectors
      const boot = Buffer.alloc(DATA_PER_SECTOR * 3, 0);
      // Mark each 128-byte chunk with a unique byte
      boot.fill(0xAA, 0, DATA_PER_SECTOR);                           // logical sector 0
      boot.fill(0xBB, DATA_PER_SECTOR, DATA_PER_SECTOR * 2);         // logical sector 1
      boot.fill(0xCC, DATA_PER_SECTOR * 2, DATA_PER_SECTOR * 3);     // logical sector 2

      const disk = createDiskImage(boot, 1);

      // Logical sector 0 -> physical sector 0 (first even)
      expect(readSector(disk, 0, 0).data[0]).toBe(0xAA);
      // Logical sector 1 -> physical sector 2 (second even)
      expect(readSector(disk, 0, 2).data[0]).toBe(0xBB);
      // Logical sector 2 -> physical sector 4 (third even)
      expect(readSector(disk, 0, 4).data[0]).toBe(0xCC);
    });

    test('odd sectors receive data after all even sectors', () => {
      // 17 sectors of data: 16 even + 1 odd
      const boot = Buffer.alloc(DATA_PER_SECTOR * 17, 0);
      boot.fill(0xDD, DATA_PER_SECTOR * 16, DATA_PER_SECTOR * 17);  // 17th chunk

      const disk = createDiskImage(boot, 1);

      // 17th logical sector -> physical sector 1 (first odd sector)
      expect(readSector(disk, 0, 1).data[0]).toBe(0xDD);
    });

    test('handles boot code spanning multiple tracks', () => {
      const dataPerTrack = DATA_PER_SECTOR * SECTORS_PER_TRACK;
      const size = dataPerTrack + 100;
      const boot = Buffer.alloc(size, 0xaa);
      const disk = createDiskImage(boot, 3);

      expect(disk.length).toBe(TRACK_SIZE * 3);

      // Track 0 sectors should have data
      const sec0 = readSector(disk, 0, 0);
      expect(sec0.data[0]).toBe(0xaa);
      expect(sec0.trackByte).toBe(0x80);

      // Track 1 sector 0 should also have data (spillover)
      const sec1 = readSector(disk, 1, 0);
      expect(sec1.data[0]).toBe(0xaa);
      expect(sec1.trackByte).toBe(0x81);  // track 1 | 0x80
    });

    test('throws when boot code exceeds disk data capacity', () => {
      const dataPerTrack = DATA_PER_SECTOR * SECTORS_PER_TRACK;
      const boot = Buffer.alloc(dataPerTrack * 3, 0xff);
      expect(() => createDiskImage(boot, 2)).toThrow(/requires.*tracks/i);
    });

    test('handles boot code that exactly fills one track of data', () => {
      const dataPerTrack = DATA_PER_SECTOR * SECTORS_PER_TRACK;
      const boot = Buffer.alloc(dataPerTrack, 0xab);
      const disk = createDiskImage(boot, 2);
      expect(disk.length).toBe(TRACK_SIZE * 2);

      // Every sector on track 0 should have 0xab data
      for (let s = 0; s < SECTORS_PER_TRACK; s++) {
        const sec = readSector(disk, 0, s);
        expect(sec.data[0]).toBe(0xab);
        expect(sec.marker).toBe(0xff);
      }

      // Track 1 sector 0 should have zero data (no more boot code)
      const sec1 = readSector(disk, 1, 0);
      expect(sec1.data[0]).toBe(0x00);
    });

    test('handles empty boot code (zero-length buffer)', () => {
      const disk = createDiskImage(Buffer.alloc(0), 77);
      expect(disk.length).toBe(TRACK_SIZE * 77);

      // Sector 0 should be properly formatted with zero data
      const sec = readSector(disk, 0, 0);
      expect(sec.trackByte).toBe(0x80);
      expect(sec.fileSize).toBe(0);
      expect(sec.marker).toBe(0xff);
      expect(sec.checksum).toBe(0);
    });

    test('single-track disk with boot code', () => {
      const boot = Buffer.from([0xc3, 0x00, 0x00]);
      const disk = createDiskImage(boot, 1);
      expect(disk.length).toBe(TRACK_SIZE);

      const sec = readSector(disk, 0, 0);
      expect(sec.data[0]).toBe(0xc3);
      expect(sec.data[1]).toBe(0x00);
      expect(sec.data[2]).toBe(0x00);
      expect(sec.fileSize).toBe(3);
      expect(sec.marker).toBe(0xff);
    });
  });

  // ----- parseArgs --------------------------------------------------------

  describe('parseArgs', () => {
    test('parses bare input file', () => {
      const opts = parseArgs(['boot.hex']);
      expect(opts.input).toBe('boot.hex');
      expect(opts.output).toBeNull();
      expect(opts.tracks).toBe(TRACKS_8INCH);
      expect(opts.help).toBe(false);
    });

    test('parses -o flag', () => {
      const opts = parseArgs(['boot.hex', '-o', 'out.dsk']);
      expect(opts.output).toBe('out.dsk');
    });

    test('parses --output flag', () => {
      const opts = parseArgs(['boot.hex', '--output', 'out.dsk']);
      expect(opts.output).toBe('out.dsk');
    });

    test('parses -t flag', () => {
      const opts = parseArgs(['boot.hex', '-t', '35']);
      expect(opts.tracks).toBe(35);
    });

    test('parses --tracks flag', () => {
      const opts = parseArgs(['boot.hex', '--tracks', '35']);
      expect(opts.tracks).toBe(35);
    });

    test('defaults to 77 tracks (8-inch)', () => {
      const opts = parseArgs(['boot.hex']);
      expect(opts.tracks).toBe(77);
    });

    test('parses --8inch flag', () => {
      const opts = parseArgs(['boot.hex', '--8inch']);
      expect(opts.tracks).toBe(77);
    });

    test('parses --mini flag', () => {
      const opts = parseArgs(['boot.hex', '--mini']);
      expect(opts.tracks).toBe(17);
    });

    test('parses --minidisk flag', () => {
      const opts = parseArgs(['boot.hex', '--minidisk']);
      expect(opts.tracks).toBe(17);
    });

    test('parses --8mb flag', () => {
      const opts = parseArgs(['boot.hex', '--8mb']);
      expect(opts.tracks).toBe(1863);
    });

    test('parses -h flag', () => {
      const opts = parseArgs(['-h']);
      expect(opts.help).toBe(true);
    });

    test('parses --help flag', () => {
      const opts = parseArgs(['--help']);
      expect(opts.help).toBe(true);
    });

    test('handles options before input file', () => {
      const opts = parseArgs(['-o', 'out.dsk', '--mini', 'boot.hex']);
      expect(opts.input).toBe('boot.hex');
      expect(opts.output).toBe('out.dsk');
      expect(opts.tracks).toBe(17);
    });

    test('last format flag wins', () => {
      const opts = parseArgs(['boot.hex', '--mini', '--8inch']);
      expect(opts.tracks).toBe(77);
    });

    test('returns null input when no positional arg', () => {
      const opts = parseArgs(['-o', 'out.dsk']);
      expect(opts.input).toBeNull();
    });

    test('throws on unknown option', () => {
      expect(() => parseArgs(['--bad'])).toThrow(/[Uu]nknown option/);
    });

    test('throws on multiple input files', () => {
      expect(() => parseArgs(['a.hex', 'b.hex'])).toThrow(
        /[Mm]ultiple input/,
      );
    });

    test('throws on non-numeric track count', () => {
      expect(() => parseArgs(['boot.hex', '-t', 'abc'])).toThrow(
        /[Ii]nvalid track count/,
      );
    });

    test('throws on track count 0', () => {
      expect(() => parseArgs(['boot.hex', '-t', '0'])).toThrow(
        /[Ii]nvalid track count/,
      );
    });

    test('throws on negative track count', () => {
      // -1 is consumed as the value for -t, not as a flag
      expect(() => parseArgs(['boot.hex', '-t', '-1'])).toThrow(
        /[Ii]nvalid track count/,
      );
    });

    test('throws on track count exceeding MAX_TRACKS', () => {
      expect(() => parseArgs(['boot.hex', '-t', '9999'])).toThrow(
        /[Ii]nvalid track count/,
      );
    });

    test('accepts boundary track values (1 and MAX_TRACKS)', () => {
      expect(parseArgs(['boot.hex', '-t', '1']).tracks).toBe(1);
      expect(parseArgs(['boot.hex', '-t', '1863']).tracks).toBe(1863);
    });

    test('-o without value falls through silently (bug: no validation)', () => {
      // This documents a known bug: -o as last arg sets output to undefined
      const opts = parseArgs(['-o']);
      expect(opts.output).toBeUndefined();
    });

    test('--tracks without value results in NaN error', () => {
      expect(() => parseArgs(['boot.hex', '--tracks'])).toThrow(
        /[Ii]nvalid track count/,
      );
    });
  });

  // ----- Integration: end-to-end ------------------------------------------

  describe('integration', () => {
    let tmpDir: string;
    const scriptPath = path.join(__dirname, '..', 'create-boot-disk.js');

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boot-disk-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('creates disk from binary data via API', () => {
      const boot = Buffer.from([0x31, 0xff, 0xff, 0x76]);
      const disk = createDiskImage(boot, 77);
      const dskPath = path.join(tmpDir, 'boot.dsk');
      fs.writeFileSync(dskPath, disk);

      const written = fs.readFileSync(dskPath);
      expect(written.length).toBe(TRACK_SIZE * 77);
      // Sector 0 header: track 0 | 0x80, file size 4 (LE)
      expect(written[0]).toBe(0x80);
      expect(written[1]).toBe(0x04);
      expect(written[2]).toBe(0x00);
      // Sector 0 data starts at byte 3
      expect(written[3]).toBe(0x31);
      expect(written[6]).toBe(0x76);
      // Marker at byte 131
      expect(written[131]).toBe(0xff);
    });

    test('creates disk from HEX data via API', () => {
      const hexContent = [
        makeDataRecord(0x0000, [0x31, 0xff, 0xff]),
        makeDataRecord(0x0003, [0x76]),
        EOF_RECORD,
      ].join('\n');

      const boot = parseIntelHex(hexContent);
      const disk = createDiskImage(boot, 17);

      expect(disk.length).toBe(TRACK_SIZE * 17);
      // Sector 0 data at byte 3
      expect(disk[3]).toBe(0x31);
      expect(disk[6]).toBe(0x76);
      expect(disk[131]).toBe(0xff);
    });

    test('creates disk from examples/hello.hex via API', () => {
      const hexPath = path.join(__dirname, '..', 'examples', 'hello.hex');
      if (!fs.existsSync(hexPath)) return;

      const hexContent = fs.readFileSync(hexPath, 'utf8');
      const boot = parseIntelHex(hexContent);
      const disk = createDiskImage(boot, 77);

      expect(disk.length).toBe(TRACK_SIZE * 77);
      expect(boot.length).toBeLessThan(TRACK_SIZE);
    });

    test('CLI creates correct output from binary file', () => {
      const binPath = path.join(tmpDir, 'test.bin');
      const dskPath = path.join(tmpDir, 'test.dsk');
      fs.writeFileSync(binPath, Buffer.from([0x76]));

      execSync(`node "${scriptPath}" "${binPath}" -o "${dskPath}"`, {
        stdio: 'pipe',
      });

      const disk = fs.readFileSync(dskPath);
      expect(disk.length).toBe(TRACK_SIZE * 77);
      // Sector 0: header then data
      expect(disk[0]).toBe(0x80);  // track 0 | 0x80
      expect(disk[3]).toBe(0x76);  // first data byte
      expect(disk[131]).toBe(0xff); // marker
    });

    test('CLI creates correct output from HEX file', () => {
      const hexPath = path.join(tmpDir, 'test.hex');
      const dskPath = path.join(tmpDir, 'test.dsk');
      const hexContent = [
        makeDataRecord(0x0000, [0xc3, 0x03, 0x00]),
        makeDataRecord(0x0003, [0x76]),
        EOF_RECORD,
      ].join('\n');
      fs.writeFileSync(hexPath, hexContent);

      execSync(`node "${scriptPath}" "${hexPath}" -o "${dskPath}"`, {
        stdio: 'pipe',
      });

      const disk = fs.readFileSync(dskPath);
      expect(disk.length).toBe(TRACK_SIZE * 77);
      // Sector 0 data starts at byte 3
      expect(disk[3]).toBe(0xc3);
      expect(disk[6]).toBe(0x76);
      expect(disk[131]).toBe(0xff);
    });

    test('CLI --mini creates 17-track disk', () => {
      const binPath = path.join(tmpDir, 'test.bin');
      const dskPath = path.join(tmpDir, 'test.dsk');
      fs.writeFileSync(binPath, Buffer.from([0x76]));

      execSync(
        `node "${scriptPath}" "${binPath}" --mini -o "${dskPath}"`,
        { stdio: 'pipe' },
      );

      const disk = fs.readFileSync(dskPath);
      expect(disk.length).toBe(TRACK_SIZE * 17);
    });

    test('CLI auto-generates .dsk output filename', () => {
      const binPath = path.join(tmpDir, 'myboot.bin');
      const expectedDsk = path.join(tmpDir, 'myboot.dsk');
      fs.writeFileSync(binPath, Buffer.from([0x76]));

      execSync(`node "${scriptPath}" "${binPath}"`, { stdio: 'pipe' });

      expect(fs.existsSync(expectedDsk)).toBe(true);
      const disk = fs.readFileSync(expectedDsk);
      expect(disk.length).toBe(TRACK_SIZE * 77);
    });

    test('CLI exits non-zero for missing input file', () => {
      expect(() => {
        execSync(`node "${scriptPath}" nonexistent.hex`, {
          stdio: 'pipe',
        });
      }).toThrow();
    });

    test('CLI exits non-zero with no arguments', () => {
      expect(() => {
        execSync(`node "${scriptPath}"`, { stdio: 'pipe' });
      }).toThrow();
    });

    test('CLI exits non-zero for unknown option', () => {
      expect(() => {
        execSync(`node "${scriptPath}" --bogus`, { stdio: 'pipe' });
      }).toThrow();
    });

    test('CLI --help exits with code 0', () => {
      const result = execSync(`node "${scriptPath}" --help`, {
        encoding: 'utf8',
      });
      expect(result).toContain('create-boot-disk');
      expect(result).toContain('--8inch');
    });
  });
});
