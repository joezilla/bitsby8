/**
 * CP/M Filesystem Module
 * Reads and writes CP/M files within CDBL-formatted DSK disk images.
 *
 * Operates entirely on an in-memory Buffer for testability and safety.
 * Handles standard 8-inch (77 track) and minidisk (17 track) formats.
 */

// ---------------------------------------------------------------------------
// Physical sector layout for MITS 88-DCDD 8" disks.
//
// The controller writes 137-byte sectors with two very different framings
// depending on the track. The layout below matches the altair_tools
// reference implementation (see docs/altair_8in_fdd.md in that repo) —
// prior attempts to reverse-engineer this from disk samples got several
// details wrong, so treat that reference as authoritative.
//
//   Boot framing (tracks 0-5):
//     [0]      track | 0x80
//     [1-2]    unused (bytes 0x00 0x01 after formatting)
//     [3-130]  128 data bytes
//     [131]    0xFF stop byte
//     [132]    checksum = sum(data[0..127]) mod 256
//     [133-136] 0x00
//
//   Data framing (tracks 6-76):
//     [0]      track | 0x80
//     [1]      sector ID = (physSector * 17) mod 32 (physSector is 0..31)
//     [2-3]    unused (included in checksum)
//     [4]      checksum = sum(data[0..127]) + sector[2..3] + sector[5..6],
//              all mod 256
//     [5-6]    unused (included in checksum)
//     [7-134]  128 data bytes
//     [135]    0xFF stop byte
//     [136]    0x00
// ---------------------------------------------------------------------------
export const CDBL = {
  SECTOR_SIZE: 137,        // Total bytes per physical sector record
  DATA_SIZE: 128,          // CP/M logical sector size
  SECTORS_PER_TRACK: 32,   // Physical sectors per track
  TRACK_SIZE: 137 * 32,    // 4384 bytes per track
  // Boot-framing offsets (tracks 0-5)
  BOOT_DATA_OFFSET: 3,
  BOOT_STOP_OFFSET: 131,
  BOOT_CSUM_OFFSET: 132,
  BOOT_ZERO_OFFSET: 133,
  // Data-framing offsets (tracks 6+)
  DATA_DATA_OFFSET: 7,
  DATA_STOP_OFFSET: 135,
  DATA_END_OFFSET: 136,
  DATA_CSUM_OFFSET: 4,
  DATA_SECT_OFFSET: 1,
  // Backwards-compatible aliases so tests/UI code doesn't break.
  DATA_OFFSET: 3,
  MARKER_OFFSET: 131,
  CHECKSUM_OFFSET: 132,
  DATA_MARKER_OFFSET: 135,
} as const;

// Altair 8" SD: tracks 0-5 use boot framing, tracks 6+ use data framing.
// Other formats (minidisk, blank images created by this code) default to
// boot framing across the whole disk.
export const ALTAIR_8INCH_SYSTEM_TRACKS = 6;

// ---------------------------------------------------------------------------
// CP/M disk parameter block (diskdef equivalent)
// ---------------------------------------------------------------------------
export interface CpmDiskParams {
  seclen: number;          // Logical sector size (always 128 for CP/M)
  tracks: number;          // Total tracks on disk
  sectrk: number;          // Logical sectors per track
  blocksize: number;       // Allocation block size in bytes
  maxdir: number;          // Maximum directory entries
  boottrk: number;         // Number of reserved boot tracks
  systemTracks?: number;   // # of tracks at the start that use boot-style
                           // CDBL framing (marker @ 131). Tracks at or
                           // beyond this index use data-track framing
                           // (marker @ 135). Defaults to the entire disk,
                           // i.e. boot framing everywhere.
  dpbAL0?: number;         // AL0 byte for directory blocks (optional)
  dpbAL1?: number;         // AL1 byte for directory blocks (optional)
}

// Standard 8-inch CP/M 2.2 disk parameters
export const PARAMS_8INCH: CpmDiskParams = {
  seclen: 128,
  tracks: 77,
  sectrk: 32,
  blocksize: 2048,
  maxdir: 64,
  boottrk: 2,
  systemTracks: ALTAIR_8INCH_SYSTEM_TRACKS,
};

// Standard minidisk parameters
export const PARAMS_MINIDISK: CpmDiskParams = {
  seclen: 128,
  tracks: 17,
  sectrk: 32,
  blocksize: 1024,
  maxdir: 32,
  boottrk: 2,
};

// ---------------------------------------------------------------------------
// MITS 8" sector skew tables.
//
// The interleave the BIOS uses to translate a logical sector index into a
// physical sector position differs between boot tracks (0-5) and data
// tracks (6+). Both derive from a 1-based base table:
//
//   base = [1, 9, 17, 25, 3, 11, 19, 27, 5, 13, 21, 29, 7, 15, 23, 31,
//           2, 10, 18, 26, 4, 12, 20, 28, 6, 14, 22, 30, 8, 16, 24, 32]
//
// Tracks 0-5: physical = base[logical] (with `-1` to switch to 0-based).
// Tracks 6+ : physical = ((base[logical] - 1) * 17) mod 32 + 1
//             ("strange historical reasons", per altair_tools).
//
// Both tables below are 0-based. Blindly using the boot skew on data
// tracks (or vice versa) scrambles the second half of every block, and
// using a self-invented 2:1 scheme scrambles the whole thing.
// ---------------------------------------------------------------------------
const MITS_BASE_SKEW: number[] = [
   1,  9, 17, 25,  3, 11, 19, 27,  5, 13, 21, 29,  7, 15, 23, 31,
   2, 10, 18, 26,  4, 12, 20, 28,  6, 14, 22, 30,  8, 16, 24, 32,
];

function buildBootSkew(): number[] {
  return MITS_BASE_SKEW.map(v => v - 1);
}

function buildDataSkew(): number[] {
  return MITS_BASE_SKEW.map(v => (((v - 1) * 17) % 32));
}

export const BOOT_SKEW_TABLE = buildBootSkew();
export const DATA_SKEW_TABLE = buildDataSkew();

/**
 * Map a logical sector (0-31) on the given track to a physical sector
 * position (0-31), applying the right skew for the track's framing.
 */
export function logicalToPhysical(track: number, logicalSector: number, systemTracks: number): number {
  const table = track < systemTracks ? BOOT_SKEW_TABLE : DATA_SKEW_TABLE;
  return table[logicalSector];
}

// Legacy re-exports so callers that predate the split still compile.
// INTERLEAVE_TABLE now points at the boot skew (correct for the
// directory-track reads that were the original use case); anything
// I/O-bound routes through logicalToPhysical() instead.
export const INTERLEAVE_TABLE = BOOT_SKEW_TABLE;
export const REVERSE_INTERLEAVE_TABLE: number[] = (() => {
  const t = new Array(32);
  for (let log = 0; log < 32; log++) t[BOOT_SKEW_TABLE[log]] = log;
  return t;
})();

// ---------------------------------------------------------------------------
// Directory entry structure (32 bytes each)
// ---------------------------------------------------------------------------
export interface CpmDirEntry {
  status: number;        // 0x00-0x0F = user number, 0xE5 = deleted
  filename: string;      // 8 chars, space-padded, high bits stripped
  extension: string;     // 3 chars, space-padded, high bits stripped
  extentLow: number;     // XL - low 5 bits of extent number
  bc: number;            // BC - byte count in last record (0 = full)
  extentHigh: number;    // XH - high bits of extent number
  rc: number;            // RC - record count in this extent (0-128)
  blockPointers: number[]; // 16 single-byte or 8 double-byte block numbers
  rawAttributes: number; // High bits of extension bytes (R/O, SYS, ARC)
  readonly: boolean;     // T1' bit (high bit of ext[0])
  system: boolean;       // T2' bit (high bit of ext[1])
  archive: boolean;      // T3' bit (high bit of ext[2])
}

// ---------------------------------------------------------------------------
// Assembled file (all extents merged)
// ---------------------------------------------------------------------------
export interface CpmFile {
  user: number;
  filename: string;      // Trimmed
  extension: string;     // Trimmed
  size: number;          // Computed size in bytes
  extents: CpmDirEntry[];
  readonly: boolean;
  system: boolean;
  archive: boolean;
}

// ---------------------------------------------------------------------------
// Free space information
// ---------------------------------------------------------------------------
export interface CpmFreeSpace {
  freeBlocks: number;
  freeBytes: number;
  totalBlocks: number;
  totalBytes: number;
  usedBlocks: number;
  usedBytes: number;
  directoryEntriesFree: number;
  directoryEntriesTotal: number;
}

// ---------------------------------------------------------------------------
// Main filesystem class
// ---------------------------------------------------------------------------
export class CpmFilesystem {
  private imageData: Buffer;
  private params: CpmDiskParams;
  private useLargePointers: boolean; // true if blocks > 255

  constructor(imageData: Buffer, params?: CpmDiskParams) {
    this.imageData = Buffer.from(imageData); // defensive copy
    this.params = params || CpmFilesystem.detectParams(imageData) || PARAMS_8INCH;

    // Determine pointer size: 16-bit if totalBlocks > 255
    const totalDataTracks = this.params.tracks - this.params.boottrk;
    const totalBlocks = Math.floor(
      (totalDataTracks * this.params.sectrk * this.params.seclen) / this.params.blocksize
    );
    this.useLargePointers = totalBlocks > 255;
  }

  // =========================================================================
  // Low-level sector I/O
  // =========================================================================

  /**
   * Data-payload offset within a physical sector, depending on the
   * track's framing style. Boot tracks put data at byte 3; data tracks
   * (6+) push it back to byte 7 to make room for the FDC's per-sector
   * checksum at byte 4.
   */
  private dataOffsetForTrack(track: number): number {
    const systemTracks = this.params.systemTracks ?? this.params.tracks;
    return track < systemTracks ? CDBL.BOOT_DATA_OFFSET : CDBL.DATA_DATA_OFFSET;
  }

  /**
   * Read a 128-byte CP/M logical sector from the image.
   */
  readSector(track: number, logicalSector: number): Buffer {
    const systemTracks = this.params.systemTracks ?? this.params.tracks;
    const physSector = logicalToPhysical(track, logicalSector, systemTracks);
    const sectorBase = (track * CDBL.SECTORS_PER_TRACK + physSector) * CDBL.SECTOR_SIZE;
    const dataOff = this.dataOffsetForTrack(track);
    if (sectorBase + dataOff + CDBL.DATA_SIZE > this.imageData.length) {
      throw new Error(
        `Sector read out of bounds: track=${track} logSec=${logicalSector} physSec=${physSector}`
      );
    }
    return Buffer.from(this.imageData.subarray(sectorBase + dataOff, sectorBase + dataOff + CDBL.DATA_SIZE));
  }

  /**
   * Write a 128-byte CP/M logical sector to the image, updating whichever
   * framing bytes the track type requires (stop, zero, checksum, sector
   * ID). Does NOT re-format the surrounding "unused" bytes on data
   * tracks — they were set at format time and are included verbatim in
   * the checksum sum.
   */
  writeSector(track: number, logicalSector: number, data: Buffer): void {
    if (data.length !== CDBL.DATA_SIZE) {
      throw new Error(`Sector data must be exactly ${CDBL.DATA_SIZE} bytes, got ${data.length}`);
    }
    const systemTracks = this.params.systemTracks ?? this.params.tracks;
    const physSector = logicalToPhysical(track, logicalSector, systemTracks);
    const sectorBase = (track * CDBL.SECTORS_PER_TRACK + physSector) * CDBL.SECTOR_SIZE;
    if (sectorBase + CDBL.SECTOR_SIZE > this.imageData.length) {
      throw new Error(`Sector write out of bounds: track=${track} logSec=${logicalSector}`);
    }

    // Byte 0 is the same in both framings — track marker with high bit set.
    this.imageData[sectorBase] = track | 0x80;

    if (track < systemTracks) {
      // Boot framing: data at [3..130], stop at 131, checksum at 132.
      data.copy(this.imageData, sectorBase + CDBL.BOOT_DATA_OFFSET);
      this.imageData[sectorBase + CDBL.BOOT_STOP_OFFSET] = 0xFF;
      let csum = 0;
      for (let i = 0; i < CDBL.DATA_SIZE; i++) csum = (csum + data[i]) & 0xFF;
      this.imageData[sectorBase + CDBL.BOOT_CSUM_OFFSET] = csum;
      // Bytes 133-136 are 0x00 in a freshly formatted disk; leave in
      // place so we don't stomp any signature on non-blank disks.
    } else {
      // Data framing: data at [7..134], stop at 135, zero at 136,
      // sector ID at 1, checksum at 4. The checksum includes bytes
      // 2, 3, 5, 6 of the on-disk sector — preserve whatever's there.
      data.copy(this.imageData, sectorBase + CDBL.DATA_DATA_OFFSET);
      this.imageData[sectorBase + CDBL.DATA_SECT_OFFSET] = (physSector * 17) & 31;
      this.imageData[sectorBase + CDBL.DATA_STOP_OFFSET] = 0xFF;
      this.imageData[sectorBase + CDBL.DATA_END_OFFSET] = 0x00;
      let csum = 0;
      for (let i = 0; i < CDBL.DATA_SIZE; i++) csum = (csum + data[i]) & 0xFF;
      csum = (csum + this.imageData[sectorBase + 2] + this.imageData[sectorBase + 3]
                   + this.imageData[sectorBase + 5] + this.imageData[sectorBase + 6]) & 0xFF;
      this.imageData[sectorBase + CDBL.DATA_CSUM_OFFSET] = csum;
    }
  }

  /**
   * Read an allocation block (blocksize bytes) from the CP/M data area.
   * Block 0 starts at boottrk.
   */
  readBlock(blockNumber: number): Buffer {
    const sectorsPerBlock = this.params.blocksize / this.params.seclen;
    const absoluteSector = blockNumber * sectorsPerBlock;
    const result = Buffer.alloc(this.params.blocksize);

    for (let i = 0; i < sectorsPerBlock; i++) {
      const absSec = absoluteSector + i;
      const track = this.params.boottrk + Math.floor(absSec / this.params.sectrk);
      const logSec = absSec % this.params.sectrk;
      const sectorData = this.readSector(track, logSec);
      sectorData.copy(result, i * this.params.seclen);
    }

    return result;
  }

  /**
   * Write an allocation block to the CP/M data area.
   */
  writeBlock(blockNumber: number, data: Buffer): void {
    if (data.length !== this.params.blocksize) {
      throw new Error(
        `Block data must be exactly ${this.params.blocksize} bytes, got ${data.length}`
      );
    }
    const sectorsPerBlock = this.params.blocksize / this.params.seclen;
    const absoluteSector = blockNumber * sectorsPerBlock;

    for (let i = 0; i < sectorsPerBlock; i++) {
      const absSec = absoluteSector + i;
      const track = this.params.boottrk + Math.floor(absSec / this.params.sectrk);
      const logSec = absSec % this.params.sectrk;
      const sectorData = data.subarray(i * this.params.seclen, (i + 1) * this.params.seclen);
      this.writeSector(track, logSec, Buffer.from(sectorData));
    }
  }

  // =========================================================================
  // Directory operations
  // =========================================================================

  /**
   * Read all directory entries from the disk.
   * Directory occupies the first N blocks (determined by maxdir and blocksize).
   */
  readDirectory(): CpmDirEntry[] {
    const entriesPerBlock = this.params.blocksize / 32;
    const dirBlocks = Math.ceil(this.params.maxdir / entriesPerBlock);
    const entries: CpmDirEntry[] = [];

    for (let b = 0; b < dirBlocks; b++) {
      const blockData = this.readBlock(b);
      const entriesInBlock = Math.min(
        entriesPerBlock,
        this.params.maxdir - b * entriesPerBlock
      );

      for (let e = 0; e < entriesInBlock; e++) {
        const off = e * 32;
        entries.push(this.parseDirEntry(blockData, off));
      }
    }

    return entries;
  }

  /**
   * Write directory entries back to the disk.
   */
  writeDirectory(entries: CpmDirEntry[]): void {
    const entriesPerBlock = this.params.blocksize / 32;
    const dirBlocks = Math.ceil(this.params.maxdir / entriesPerBlock);

    for (let b = 0; b < dirBlocks; b++) {
      const blockData = Buffer.alloc(this.params.blocksize, 0xE5);
      const startEntry = b * entriesPerBlock;
      const entriesInBlock = Math.min(entriesPerBlock, entries.length - startEntry);

      for (let e = 0; e < entriesInBlock; e++) {
        if (startEntry + e < entries.length) {
          this.serializeDirEntry(entries[startEntry + e], blockData, e * 32);
        }
      }

      this.writeBlock(b, blockData);
    }
  }

  /**
   * Parse a single 32-byte directory entry from a buffer.
   */
  private parseDirEntry(buf: Buffer, off: number): CpmDirEntry {
    const status = buf[off];

    // Filename: bytes 1-8, mask high bits
    let filename = '';
    for (let i = 1; i <= 8; i++) {
      filename += String.fromCharCode(buf[off + i] & 0x7F);
    }

    // Extension: bytes 9-11, save attribute bits, mask high bits for name
    const rawExt0 = buf[off + 9];
    const rawExt1 = buf[off + 10];
    const rawExt2 = buf[off + 11];

    const readonly = (rawExt0 & 0x80) !== 0;
    const system = (rawExt1 & 0x80) !== 0;
    const archive = (rawExt2 & 0x80) !== 0;

    let extension = '';
    extension += String.fromCharCode(rawExt0 & 0x7F);
    extension += String.fromCharCode(rawExt1 & 0x7F);
    extension += String.fromCharCode(rawExt2 & 0x7F);

    const extentLow = buf[off + 12];
    const bc = buf[off + 13];
    const extentHigh = buf[off + 14];
    const rc = buf[off + 15];

    // Block pointers: bytes 16-31
    const blockPointers: number[] = [];
    if (this.useLargePointers) {
      // 8 x 16-bit LE pointers
      for (let i = 0; i < 8; i++) {
        blockPointers.push(buf.readUInt16LE(off + 16 + i * 2));
      }
    } else {
      // 16 x 8-bit pointers
      for (let i = 0; i < 16; i++) {
        blockPointers.push(buf[off + 16 + i]);
      }
    }

    return {
      status,
      filename,
      extension,
      extentLow,
      bc,
      extentHigh,
      rc,
      blockPointers,
      rawAttributes: ((rawExt0 & 0x80) >> 5) | ((rawExt1 & 0x80) >> 6) | ((rawExt2 & 0x80) >> 7),
      readonly,
      system,
      archive,
    };
  }

  /**
   * Serialize a directory entry back to a 32-byte region of a buffer.
   */
  private serializeDirEntry(entry: CpmDirEntry, buf: Buffer, off: number): void {
    buf[off] = entry.status;

    // Filename (8 bytes, space-padded)
    const fname = entry.filename.padEnd(8, ' ');
    for (let i = 0; i < 8; i++) {
      buf[off + 1 + i] = fname.charCodeAt(i) & 0x7F;
    }

    // Extension (3 bytes) with attribute high bits
    const ext = entry.extension.padEnd(3, ' ');
    buf[off + 9] = (ext.charCodeAt(0) & 0x7F) | (entry.readonly ? 0x80 : 0);
    buf[off + 10] = (ext.charCodeAt(1) & 0x7F) | (entry.system ? 0x80 : 0);
    buf[off + 11] = (ext.charCodeAt(2) & 0x7F) | (entry.archive ? 0x80 : 0);

    buf[off + 12] = entry.extentLow;
    buf[off + 13] = entry.bc;
    buf[off + 14] = entry.extentHigh;
    buf[off + 15] = entry.rc;

    // Block pointers
    if (this.useLargePointers) {
      for (let i = 0; i < 8; i++) {
        buf.writeUInt16LE(i < entry.blockPointers.length ? entry.blockPointers[i] : 0, off + 16 + i * 2);
      }
    } else {
      for (let i = 0; i < 16; i++) {
        buf[off + 16 + i] = i < entry.blockPointers.length ? entry.blockPointers[i] : 0;
      }
    }
  }

  // =========================================================================
  // File-level operations
  // =========================================================================

  /**
   * List all files on the disk, assembling multi-extent files.
   */
  listFiles(): CpmFile[] {
    const entries = this.readDirectory();
    const fileMap = new Map<string, CpmDirEntry[]>();

    for (const entry of entries) {
      // Skip deleted entries and invalid status bytes
      if (entry.status === 0xE5 || entry.status > 0x1F) continue;

      const key = `${entry.status}:${entry.filename}:${entry.extension}`;
      if (!fileMap.has(key)) {
        fileMap.set(key, []);
      }
      fileMap.get(key)!.push(entry);
    }

    const files: CpmFile[] = [];
    for (const [, extents] of fileMap) {
      // Sort by extent number
      extents.sort((a, b) => {
        const extA = (a.extentHigh * 32) + a.extentLow;
        const extB = (b.extentHigh * 32) + b.extentLow;
        return extA - extB;
      });

      const first = extents[0];
      const last = extents[extents.length - 1];

      // Compute file size from extent numbers and record count.
      //
      // CP/M extent numbering: each logical extent = 128 records = 16K.
      // With EXM (extent mask), a single directory entry may span multiple
      // logical extents. The XL field stores the first logical extent number
      // of the entry, and RC is the record count within the LAST logical
      // extent of that directory entry (0-128).
      //
      // For small files that don't fill a full logical extent, RC simply
      // gives the total records in the entry.
      //
      // The EXM determines how many logical extents per directory entry:
      //   8-bit ptrs, 2K blocks → EXM=1 → 2 logical extents per entry
      //   16-bit ptrs, 2K blocks → EXM=0 → 1 logical extent per entry
      //
      // Size in records = (lastExtentNumber + EXM) * 128 + RC
      //   (where EXM extra extents are from the same directory entry)
      // But we can simplify: just use the extent number for all but the
      // last entry, and for the last entry count its actual records.

      // Determine EXM for this disk.
      //
      // CP/M 2.2 always reserves 8 allocation slots per directory entry
      // (`ALLOCS_PER_EXT = 16` bytes; either 8 uint8 or 8 uint16LE).
      // Records per entry = 8 * (blocksize / seclen). EXM =
      // recordsPerEntry / 128 - 1 (0 for standard 8" 2K blocks, 1 for a
      // 4K-block hard disk, etc.). Verified against altair_tools'
      // disk_recs_per_extent() = ((recs_per_alloc * 8) + 127)/128 * 128.
      const recordsPerEntry = 8 * (this.params.blocksize / this.params.seclen);
      const exm = Math.max(0, Math.floor(recordsPerEntry / 128) - 1);

      const lastExtLow = last.extentLow & 0x1F;

      // Total records:
      // Records before the last directory entry's logical extents
      // + RC from the last entry
      // The extent number is the FIRST logical extent of the entry.
      // Records in all previous logical extents = lastExtNum * 128
      // Records in the last entry = (min(exm, ...) * 128) + RC
      // But RC can be 0..128, and the EXM extents within the entry before
      // the one with RC are full (128 records each).
      //
      // Simple formula used by cpmtools:
      //   size = lastExtNum * 16384 + (exm ? 16384 : 0) + RC * 128
      //   but only when RC > 0; when the file exactly fills, last entry's
      //   ext number tells us the extents prior to it.
      //
      // Actually the correct formula from the CP/M spec is:
      //   totalRecords = lastExtNum * 128 + RC    (when EXM = 0)
      //   totalRecords = (lastExtNum & ~exm) * 128 + RC  (when EXM > 0)
      //   ...but that doesn't account for the sub-extents.
      //
      // The most reliable approach: count all used blocks from all entries
      // except the last, then use the last entry's block count trimmed by RC.

      // Records from all entries before the last one = all their blocks' capacity
      let totalRecords = 0;
      for (let i = 0; i < extents.length - 1; i++) {
        const usedBlocks = extents[i].blockPointers.filter(bp => bp !== 0).length;
        totalRecords += usedBlocks * (this.params.blocksize / this.params.seclen);
      }

      // Last entry: RC gives records used, but with EXM > 0, each sub-extent
      // below the one containing RC is full (128 records).
      // The last extent's XL modulo (EXM+1) tells which sub-extent RC refers to.
      const subExtent = lastExtLow & exm;  // which sub-extent within entry
      const lastEntryRecords = subExtent * 128 + last.rc;
      totalRecords += lastEntryRecords;

      let size = totalRecords * this.params.seclen;

      // Refine with BC (byte count in last record)
      if (last.bc > 0 && last.rc > 0) {
        size -= this.params.seclen;
        size += last.bc;
      }

      files.push({
        user: first.status,
        filename: first.filename.trimEnd(),
        extension: first.extension.trimEnd(),
        size,
        extents,
        readonly: first.readonly,
        system: first.system,
        archive: first.archive,
      });
    }

    // Sort by user, then filename
    files.sort((a, b) => {
      if (a.user !== b.user) return a.user - b.user;
      const nameA = `${a.filename}.${a.extension}`;
      const nameB = `${b.filename}.${b.extension}`;
      return nameA.localeCompare(nameB);
    });

    return files;
  }

  /**
   * Read an entire file from the disk, assembling all extents.
   */
  readFile(filename: string, ext: string, user: number = 0): Buffer {
    const files = this.listFiles();
    const file = files.find(
      f => f.filename === filename.trimEnd() &&
           f.extension === ext.trimEnd() &&
           f.user === user
    );

    if (!file) {
      throw new Error(`File not found: ${user}:${filename}.${ext}`);
    }

    // Collect all blocks in extent order
    const blocks: Buffer[] = [];
    for (const extent of file.extents) {
      for (const bp of extent.blockPointers) {
        if (bp === 0) continue; // 0 = no block allocated
        blocks.push(this.readBlock(bp));
      }
    }

    // Concatenate all blocks and trim to file size
    const fullData = Buffer.concat(blocks);
    return Buffer.from(fullData.subarray(0, file.size));
  }

  /**
   * Write a file to the disk image.
   * Allocates blocks, creates directory entries (one per extent).
   */
  writeFile(filename: string, ext: string, data: Buffer, user: number = 0): void {
    // Normalize filename
    const norm = CpmFilesystem.normalizeFilename(`${filename}.${ext}`);

    // First delete any existing file with the same name
    try {
      this.deleteFile(norm.filename, norm.extension, user);
    } catch {
      // File didn't exist, that's fine
    }

    // Calculate how many blocks we need
    const blocksNeeded = Math.ceil(data.length / this.params.blocksize) || 0;
    if (blocksNeeded === 0) {
      // Zero-length file: just create a directory entry with no blocks
      const entries = this.readDirectory();
      const freeSlot = entries.findIndex(e => e.status === 0xE5);
      if (freeSlot === -1) {
        throw new Error('Directory full: no free entries');
      }

      entries[freeSlot] = this.createDirEntry(norm.filename, norm.extension, user, 0, 0, 0, []);
      this.writeDirectory(entries);
      return;
    }

    // Allocate blocks
    const allocatedBlocks = this.allocateBlocks(blocksNeeded);

    // Write data to blocks. CP/M convention: pad the tail of the last
    // used record with 0x1A (Ctrl-Z) — the standard EOF marker text
    // tools (MBASIC's LOAD, ED, TYPE) stop at. Bytes past the last used
    // record inside the same block stay zero. Files that are an exact
    // multiple of 128 bytes get no 0x1A (nothing to pad).
    const bytesInLastRecord = data.length % this.params.seclen;
    for (let i = 0; i < blocksNeeded; i++) {
      const blockData = Buffer.alloc(this.params.blocksize, 0);
      const srcOff = i * this.params.blocksize;
      const copyLen = Math.min(this.params.blocksize, data.length - srcOff);
      data.copy(blockData, 0, srcOff, srcOff + copyLen);
      // If this is the final block AND the file ends mid-record, fill
      // the remainder of that record with 0x1A.
      if (i === blocksNeeded - 1 && bytesInLastRecord !== 0) {
        const recordEnd = copyLen + (this.params.seclen - bytesInLastRecord);
        blockData.fill(0x1A, copyLen, recordEnd);
      }
      this.writeBlock(allocatedBlocks[i], blockData);
    }

    // Create directory entries. CP/M 2.2 uses 8 allocation slots per
    // directory entry regardless of pointer size (8-bit or 16-bit).
    // Slots 8..15 of the 16-byte allocation area stay zero on 8-bit
    // disks. Each entry covers `recordsPerEntry = 8 * (blocksize/seclen)`
    // records, spanning `logicalExtentsPerEntry = recordsPerEntry / 128`
    // logical extents (EXM = that - 1). altair_tools computes the same
    // as `disk_recs_per_extent()`.
    const blocksPerExtent = 8;
    const recordsPerEntry = blocksPerExtent * (this.params.blocksize / this.params.seclen);
    const logicalExtentsPerEntry = Math.max(1, Math.floor(recordsPerEntry / 128));
    const dirEntryCount = Math.ceil(blocksNeeded / blocksPerExtent);

    const entries = this.readDirectory();

    for (let dir_idx = 0; dir_idx < dirEntryCount; dir_idx++) {
      const freeSlot = entries.findIndex(e => e.status === 0xE5);
      if (freeSlot === -1) {
        throw new Error(`Directory full: needed ${dirEntryCount} entries but ran out at entry ${dir_idx}`);
      }

      const startBlock = dir_idx * blocksPerExtent;
      const endBlock = Math.min(startBlock + blocksPerExtent, blocksNeeded);
      const extentBlocks = allocatedBlocks.slice(startBlock, endBlock);

      // Calculate RC (record count) for this directory entry.
      //
      // Byte 13 of the entry (S1 / "bc") is reserved in CP/M 2.2 — the
      // spec says it must be 0. CP/M 3.x reused it as "byte count in
      // last record," and some 2.2 clones misinterpret a non-zero S1 as
      // an internal BDOS scratch field, corrupting sequential reads
      // (observed as 4-sector jumps on a Burcon-derived CP/M 2.2).
      // Every existing entry we've inspected on real Altair disks stores
      // 0 here regardless of the true tail-byte count. Match that
      // convention: always emit S1=0, round file size up to a full
      // record, and rely on the last record's padding (0x00 for now) to
      // signal end-of-data.
      let rc: number;
      const bc = 0;
      if (dir_idx === dirEntryCount - 1) {
        // Last entry: calculate remaining records
        const bytesInPrevEntries = dir_idx * blocksPerExtent * this.params.blocksize;
        const remainingBytes = data.length - bytesInPrevEntries;
        rc = Math.ceil(remainingBytes / this.params.seclen);
        // RC is modulo 128 (records within the last logical extent of this entry)
        if (rc > 128) rc = rc % 128 || 128;
      } else {
        rc = recordsPerEntry > 128 ? 128 : recordsPerEntry;
      }

      // Extent number: each directory entry covers logicalExtentsPerEntry extents
      const logicalExtent = dir_idx * logicalExtentsPerEntry;
      const extentLow = logicalExtent & 0x1F;
      const extentHigh = (logicalExtent >> 5) & 0x3F;

      entries[freeSlot] = this.createDirEntry(
        norm.filename, norm.extension, user,
        extentLow, extentHigh, rc, extentBlocks, bc
      );
    }

    this.writeDirectory(entries);
  }

  /**
   * Delete a file from the disk image.
   * Marks all of its directory entries as deleted (0xE5).
   */
  deleteFile(filename: string, ext: string, user: number = 0): void {
    const entries = this.readDirectory();
    const trimFn = filename.trimEnd().padEnd(8, ' ');
    const trimExt = ext.trimEnd().padEnd(3, ' ');
    let found = false;

    for (const entry of entries) {
      if (entry.status === user &&
          entry.filename === trimFn &&
          entry.extension === trimExt) {
        entry.status = 0xE5;
        found = true;
      }
    }

    if (!found) {
      throw new Error(`File not found: ${user}:${filename}.${ext}`);
    }

    this.writeDirectory(entries);
  }

  // =========================================================================
  // Block allocation
  // =========================================================================

  /**
   * Build a bitmap of allocated blocks.
   * Returns array where true = block is in use.
   */
  buildAllocationBitmap(): boolean[] {
    const totalDataTracks = this.params.tracks - this.params.boottrk;
    const totalBlocks = Math.floor(
      (totalDataTracks * this.params.sectrk * this.params.seclen) / this.params.blocksize
    );
    const bitmap = new Array(totalBlocks).fill(false);

    // Mark directory blocks as allocated
    const entriesPerBlock = this.params.blocksize / 32;
    const dirBlocks = Math.ceil(this.params.maxdir / entriesPerBlock);
    for (let i = 0; i < dirBlocks; i++) {
      if (i < bitmap.length) bitmap[i] = true;
    }

    // Mark blocks referenced by active directory entries
    const entries = this.readDirectory();
    let firstUsed = Infinity;
    for (const entry of entries) {
      if (entry.status === 0xE5 || entry.status > 0x1F) continue;
      for (const bp of entry.blockPointers) {
        if (bp > 0 && bp < totalBlocks) {
          bitmap[bp] = true;
          if (bp < firstUsed) firstUsed = bp;
        }
      }
    }

    // Reserve any gap between our expected dirBlocks and the first block
    // an existing file actually uses. CP/M formats vary in how many blocks
    // they reserve for the directory (via AL0/AL1 in the DPB), and that
    // reservation isn't stored on the disk. If a disk was formatted with
    // maxdir larger than ours and its files start at block N > dirBlocks,
    // blocks dirBlocks..N-1 hold directory entries our default maxdir
    // doesn't see. Allocating into them would clobber live directory
    // sectors and yield "Bdos Err: Bad Sector" on the real machine.
    if (firstUsed !== Infinity && firstUsed > dirBlocks) {
      for (let i = dirBlocks; i < firstUsed && i < bitmap.length; i++) {
        bitmap[i] = true;
      }
    }

    return bitmap;
  }

  /**
   * Allocate N free blocks. Returns array of block numbers.
   * Throws if not enough free blocks available.
   */
  allocateBlocks(count: number): number[] {
    const bitmap = this.buildAllocationBitmap();
    const allocated: number[] = [];

    for (let i = 0; i < bitmap.length && allocated.length < count; i++) {
      if (!bitmap[i]) {
        allocated.push(i);
      }
    }

    if (allocated.length < count) {
      throw new Error(
        `Disk full: need ${count} blocks but only ${allocated.length} free`
      );
    }

    return allocated;
  }

  /**
   * Get free space information.
   */
  getFreeSpace(): CpmFreeSpace {
    const bitmap = this.buildAllocationBitmap();
    const totalBlocks = bitmap.length;
    const usedBlocks = bitmap.filter(b => b).length;
    const freeBlocks = totalBlocks - usedBlocks;

    // Count free directory entries
    const entries = this.readDirectory();
    const usedDirEntries = entries.filter(e => e.status !== 0xE5 && e.status <= 0x1F).length;

    return {
      freeBlocks,
      freeBytes: freeBlocks * this.params.blocksize,
      totalBlocks,
      totalBytes: totalBlocks * this.params.blocksize,
      usedBlocks,
      usedBytes: usedBlocks * this.params.blocksize,
      directoryEntriesFree: this.params.maxdir - usedDirEntries,
      directoryEntriesTotal: this.params.maxdir,
    };
  }

  // =========================================================================
  // Utilities
  // =========================================================================

  /**
   * Create a directory entry object.
   */
  private createDirEntry(
    filename: string,
    extension: string,
    user: number,
    extentLow: number,
    extentHigh: number,
    rc: number,
    blockPointers: number[],
    bc: number = 0,
  ): CpmDirEntry {
    // Pad to expected sizes
    const pointerCount = this.useLargePointers ? 8 : 16;
    const paddedPointers = [...blockPointers];
    while (paddedPointers.length < pointerCount) {
      paddedPointers.push(0);
    }

    return {
      status: user,
      filename: filename.padEnd(8, ' '),
      extension: extension.padEnd(3, ' '),
      extentLow,
      bc,
      extentHigh,
      rc,
      blockPointers: paddedPointers,
      rawAttributes: 0,
      readonly: false,
      system: false,
      archive: false,
    };
  }

  /**
   * Auto-detect disk parameters from image size and directory contents.
   * Returns null if no valid CP/M filesystem is found.
   */
  static detectParams(imageData: Buffer): CpmDiskParams | null {
    const size = imageData.length;

    // Determine track count from image size
    // Standard: 77 * 4384 = 337,568 or 337,664 (with 96 extra bytes)
    // Minidisk: 17 * 4384 = 74,528
    let params: CpmDiskParams;
    if (size >= 74528 && size <= 74624) {
      params = { ...PARAMS_MINIDISK };
    } else if (size >= 337568 && size <= 337664) {
      params = { ...PARAMS_8INCH };
    } else {
      // Try to compute from track size
      const tracks = Math.floor(size / CDBL.TRACK_SIZE);
      if (tracks < 3) return null; // Not enough tracks for boottrk + directory

      if (tracks <= 20) {
        params = { ...PARAMS_MINIDISK, tracks };
      } else {
        params = { ...PARAMS_8INCH, tracks };
      }
    }

    // Validate: check if directory area contains valid entries
    if (!CpmFilesystem.validateDirectory(imageData, params)) {
      return null;
    }

    return params;
  }

  /**
   * Check if the directory area looks like valid CP/M directory entries.
   */
  private static validateDirectory(imageData: Buffer, params: CpmDiskParams): boolean {
    // Read first sector of directory (track = boottrk, sector = 0)
    const physSector = INTERLEAVE_TABLE[0];
    const offset = (params.boottrk * CDBL.SECTORS_PER_TRACK + physSector) * CDBL.SECTOR_SIZE + CDBL.DATA_OFFSET;

    if (offset + CDBL.DATA_SIZE > imageData.length) return false;

    // Check first 4 directory entries (128 bytes = 4 * 32)
    let validCount = 0;
    for (let e = 0; e < 4; e++) {
      const entryOff = offset + e * 32;
      if (entryOff + 32 > imageData.length) break;

      const status = imageData[entryOff];

      // Valid status: 0x00-0x0F (user numbers) or 0xE5 (deleted)
      if (status <= 0x0F || status === 0xE5) {
        if (status === 0xE5) {
          validCount++;
          continue;
        }

        // Check filename bytes are printable ASCII (or space)
        let isAscii = true;
        for (let i = 1; i <= 11; i++) {
          const ch = imageData[entryOff + i] & 0x7F;
          if (ch < 0x20 || ch > 0x7E) {
            isAscii = false;
            break;
          }
        }
        if (isAscii) validCount++;
      }
    }

    // At least 2 out of 4 entries should look valid
    return validCount >= 2;
  }

  /**
   * Normalize a CP/M filename string to 8.3 format.
   * Input can be: "FILENAME.EXT", "filename.ext", "FILE", etc.
   * Returns { filename: 'FILENAME', extension: 'EXT' } (trimmed, uppercase)
   */
  static normalizeFilename(name: string): { filename: string; extension: string } {
    // Strip user prefix if present (e.g., "0:FILENAME.EXT")
    let cleanName = name;
    const colonIdx = name.indexOf(':');
    if (colonIdx >= 0 && colonIdx <= 2) {
      cleanName = name.substring(colonIdx + 1);
    }

    const parts = cleanName.split('.');
    let filename = (parts[0] || '').toUpperCase().substring(0, 8);
    let extension = (parts[1] || '').toUpperCase().substring(0, 3);

    return { filename, extension };
  }

  /**
   * Parse a CP/M filename from URL parameter format.
   * Handles: "FILENAME.EXT" and "0:FILENAME.EXT"
   * Returns { user, filename, extension }
   */
  static parseFilenameParam(param: string): { user: number; filename: string; extension: string } {
    let user = 0;
    let cleanName = param;
    const colonIdx = param.indexOf(':');
    if (colonIdx >= 0 && colonIdx <= 2) {
      user = parseInt(param.substring(0, colonIdx), 10) || 0;
      cleanName = param.substring(colonIdx + 1);
    }

    const norm = CpmFilesystem.normalizeFilename(cleanName);
    return { user, filename: norm.filename, extension: norm.extension };
  }

  /**
   * Build a freshly-formatted MITS 8" style disk image of the given
   * `params`. Every physical sector gets the correct framing bytes,
   * sector ID, stop byte, zero terminator and checksum — matching the
   * `mits8in_format_disk()` routine in altair_tools. Data area (bytes
   * 3-130 on boot tracks, 7-134 on data tracks) is filled with 0xE5,
   * which is CP/M's "unused" marker in the directory and elsewhere.
   */
  static formatImage(params: CpmDiskParams = PARAMS_8INCH): Buffer {
    const systemTracks = params.systemTracks ?? params.tracks;
    const imageSize = params.tracks * CDBL.SECTORS_PER_TRACK * CDBL.SECTOR_SIZE;
    const image = Buffer.alloc(imageSize, 0);

    for (let track = 0; track < params.tracks; track++) {
      for (let phys = 0; phys < CDBL.SECTORS_PER_TRACK; phys++) {
        const base = (track * CDBL.SECTORS_PER_TRACK + phys) * CDBL.SECTOR_SIZE;
        // Start every sector as 0xE5 across the whole 137 bytes so the
        // data payload is 0xE5-filled by default; framing bytes below
        // overwrite the metadata positions.
        image.fill(0xE5, base, base + CDBL.SECTOR_SIZE);
        image[base] = track | 0x80;

        if (track < systemTracks) {
          // Boot framing: data at [3..130], stop at 131, csum at 132,
          // zero-fill 133..136. Byte 1 = 0x00, byte 2 = 0x01 per
          // altair_tools' format function.
          image[base + 1] = 0x00;
          image[base + 2] = 0x01;
          image[base + CDBL.BOOT_STOP_OFFSET] = 0xFF;
          image[base + 133] = 0;
          image[base + 134] = 0;
          image[base + 135] = 0;
          image[base + 136] = 0;
          // Checksum = sum of data[0..127] with data = 0xE5.
          image[base + CDBL.BOOT_CSUM_OFFSET] = (0xE5 * CDBL.DATA_SIZE) & 0xFF;
        } else {
          // Data framing: byte 1 = sector ID, byte 2 = 0x01, data at
          // [7..134], stop at 135, zero at 136. Bytes 3, 5, 6 stay 0xE5
          // from the fill — they're "unused" but summed into the
          // checksum, matching altair_tools' initial buffer state.
          image[base + CDBL.DATA_SECT_OFFSET] = (phys * 17) & 31;
          image[base + 2] = 0x01;
          image[base + CDBL.DATA_STOP_OFFSET] = 0xFF;
          image[base + CDBL.DATA_END_OFFSET] = 0x00;
          // Checksum = sum(data[0..127]) + bytes 2, 3, 5, 6.
          const dataSum = (0xE5 * CDBL.DATA_SIZE) & 0xFF;
          const csum = (dataSum + image[base + 2] + image[base + 3] + image[base + 5] + image[base + 6]) & 0xFF;
          image[base + CDBL.DATA_CSUM_OFFSET] = csum;
        }
      }
    }
    return image;
  }

  /**
   * Get the full disk image data (with any modifications applied).
   */
  getImageData(): Buffer {
    return Buffer.from(this.imageData);
  }

  /**
   * Get the current disk parameters.
   */
  getParams(): CpmDiskParams {
    return { ...this.params };
  }
}
