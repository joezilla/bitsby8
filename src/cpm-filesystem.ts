/**
 * CP/M Filesystem Module
 * Reads and writes CP/M files within CDBL-formatted DSK disk images.
 *
 * Operates entirely on an in-memory Buffer for testability and safety.
 * Handles standard 8-inch (77 track) and minidisk (17 track) formats.
 */

// ---------------------------------------------------------------------------
// CDBL framing constants (must match create-boot-disk.js / protocol.ts)
// ---------------------------------------------------------------------------
export const CDBL = {
  SECTOR_SIZE: 137,        // Total bytes per physical sector record
  DATA_OFFSET: 3,          // Byte offset to start of 128-byte data payload
  DATA_SIZE: 128,          // CP/M logical sector size
  SECTORS_PER_TRACK: 32,   // Physical sectors per track
  TRACK_SIZE: 137 * 32,    // 4384 bytes per track
  MARKER_OFFSET: 131,      // 0xFF marker byte position
  CHECKSUM_OFFSET: 132,    // 8-bit checksum position
} as const;

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
// 2:1 interleave table  –  maps logical sector → physical sector
// CDBL reads evens first (0,2,4,...,30) then odds (1,3,5,...,31)
// ---------------------------------------------------------------------------
function buildInterleaveTable(): number[] {
  const table: number[] = new Array(32);
  let phys = 0;
  // Even physical sectors first (logical 0..15 → physical 0,2,4,...,30)
  for (let log = 0; log < 16; log++) {
    table[log] = phys;
    phys += 2;
  }
  // Odd physical sectors next (logical 16..31 → physical 1,3,5,...,31)
  phys = 1;
  for (let log = 16; log < 32; log++) {
    table[log] = phys;
    phys += 2;
  }
  return table;
}

export const INTERLEAVE_TABLE = buildInterleaveTable();

// Reverse table: physical sector → logical sector
function buildReverseInterleaveTable(): number[] {
  const table: number[] = new Array(32);
  for (let log = 0; log < 32; log++) {
    table[INTERLEAVE_TABLE[log]] = log;
  }
  return table;
}

export const REVERSE_INTERLEAVE_TABLE = buildReverseInterleaveTable();

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
   * Read a 128-byte CP/M logical sector from the image.
   * @param track  Absolute track number (0-based)
   * @param logicalSector  Logical sector (0-31), mapped through interleave table
   */
  readSector(track: number, logicalSector: number): Buffer {
    const physSector = INTERLEAVE_TABLE[logicalSector];
    const offset = (track * CDBL.SECTORS_PER_TRACK + physSector) * CDBL.SECTOR_SIZE + CDBL.DATA_OFFSET;
    if (offset + CDBL.DATA_SIZE > this.imageData.length) {
      throw new Error(
        `Sector read out of bounds: track=${track} logSec=${logicalSector} physSec=${physSector} offset=${offset}`
      );
    }
    return Buffer.from(this.imageData.subarray(offset, offset + CDBL.DATA_SIZE));
  }

  /**
   * Write a 128-byte CP/M logical sector to the image.
   * Also updates track byte, marker, and checksum in the CDBL frame.
   */
  writeSector(track: number, logicalSector: number, data: Buffer): void {
    if (data.length !== CDBL.DATA_SIZE) {
      throw new Error(`Sector data must be exactly ${CDBL.DATA_SIZE} bytes, got ${data.length}`);
    }
    const physSector = INTERLEAVE_TABLE[logicalSector];
    const sectorBase = (track * CDBL.SECTORS_PER_TRACK + physSector) * CDBL.SECTOR_SIZE;
    if (sectorBase + CDBL.SECTOR_SIZE > this.imageData.length) {
      throw new Error(
        `Sector write out of bounds: track=${track} logSec=${logicalSector}`
      );
    }

    // Byte 0: Track | 0x80 (sync bit)
    this.imageData[sectorBase] = track | 0x80;

    // Bytes 1-2: leave existing file byte count (or zero)
    // Bytes 3-130: sector data
    data.copy(this.imageData, sectorBase + CDBL.DATA_OFFSET);

    // Byte 131: marker
    this.imageData[sectorBase + CDBL.MARKER_OFFSET] = 0xFF;

    // Byte 132: checksum (8-bit sum of 128 data bytes)
    let checksum = 0;
    for (let i = 0; i < CDBL.DATA_SIZE; i++) {
      checksum = (checksum + data[i]) & 0xFF;
    }
    this.imageData[sectorBase + CDBL.CHECKSUM_OFFSET] = checksum;
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

      // Determine EXM for this disk
      const pointersPerEntry = this.useLargePointers ? 8 : 16;
      const recordsPerEntry = pointersPerEntry * (this.params.blocksize / this.params.seclen);
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

    // Write data to blocks
    for (let i = 0; i < blocksNeeded; i++) {
      const blockData = Buffer.alloc(this.params.blocksize, 0);
      const srcOff = i * this.params.blocksize;
      const copyLen = Math.min(this.params.blocksize, data.length - srcOff);
      data.copy(blockData, 0, srcOff, srcOff + copyLen);
      this.writeBlock(allocatedBlocks[i], blockData);
    }

    // Create directory entries (may need multiple extents)
    // Each directory entry holds pointersPerExtent block pointers.
    // The CP/M logical extent size is 16K (128 records × 128 bytes).
    // EXM (extent mask) determines how many logical extents fit in one
    // directory entry:  EXM = (blocksize / 128) * pointersPerEntry / 128 - 1
    // For 8-bit ptrs with 2K blocks: EXM = (2048/128)*16/128 - 1 = 1
    // For 16-bit ptrs with 2K blocks: EXM = (2048/128)*8/128 - 1 = 0
    const pointersPerExtent = this.useLargePointers ? 8 : 16;
    const blocksPerExtent = pointersPerExtent;
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

      // Calculate RC (record count) for this directory entry
      let rc: number;
      let bc = 0;
      if (dir_idx === dirEntryCount - 1) {
        // Last entry: calculate remaining records
        const bytesInPrevEntries = dir_idx * blocksPerExtent * this.params.blocksize;
        const remainingBytes = data.length - bytesInPrevEntries;
        rc = Math.ceil(remainingBytes / this.params.seclen);
        // RC is modulo 128 (records within the last logical extent of this entry)
        if (rc > 128) rc = rc % 128 || 128;
        // BC = byte count in last record
        bc = remainingBytes % this.params.seclen;
        if (bc === 0 && remainingBytes > 0) bc = 0; // full last record = 0
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
    for (const entry of entries) {
      if (entry.status === 0xE5 || entry.status > 0x1F) continue;
      for (const bp of entry.blockPointers) {
        if (bp > 0 && bp < totalBlocks) {
          bitmap[bp] = true;
        }
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
