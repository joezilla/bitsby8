/**
 * ROM image burning (Bitsby8 Story 5.2): load a raw binary (`.bin`) or an Intel
 * HEX file into an EPROM card's ROM region, honoring the file's addresses or
 * relocating them to the region base. The result is a region-sized, zero-padded
 * byte buffer ready to become a `MachineSpec.memory` ROM image.
 *
 * Two addressing modes (operator-selectable — the party's "a and b"):
 *  - `file`  — honor the file's addresses: a byte at file address A lands at the
 *              physical address A; every byte must fall inside the EPROM window.
 *  - `base`  — relocate to the region base: the file's lowest address maps to the
 *              EPROM base, preserving internal layout/gaps.
 *
 * A raw `.bin` has no intrinsic addresses, so it always loads from the base
 * (both modes place byte 0 at the EPROM base).
 */

export type ImageFormat = 'bin' | 'ihex';
export type Addressing = 'file' | 'base';

export interface BurnRegion {
  base: number;
  size: number;
}

export interface BurnResult {
  /** Exactly `region.size` bytes, zero-padded where the image doesn't reach. */
  image: Uint8Array;
  /** Total data bytes written. */
  bytesWritten: number;
  /** Absolute address span actually written (inclusive). */
  lowAddr: number;
  highAddr: number;
  addressing: Addressing;
  format: ImageFormat;
}

/** Thrown when a file is malformed or its data won't fit the EPROM window. */
export class RomImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RomImageError';
  }
}

const hex = (n: number, w = 4) => `0x${(n >>> 0).toString(16).toUpperCase().padStart(w, '0')}`;

/** A contiguous run of bytes at an absolute source address. */
interface Chunk {
  addr: number;
  data: Uint8Array;
}

/**
 * Best-effort format detection: an Intel HEX file is ASCII whose first
 * non-whitespace character is a record-start colon. Anything else is a raw
 * binary. A caller with the filename can override (`.hex`/`.ihx` → ihex).
 */
export function detectFormat(bytes: Uint8Array, filename?: string): ImageFormat {
  if (filename) {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.hex') || lower.endsWith('.ihex') || lower.endsWith('.ihx')) return 'ihex';
    if (lower.endsWith('.bin') || lower.endsWith('.rom')) return 'bin';
  }
  // Sniff: skip leading whitespace; a ':' start with all-ASCII bytes ⇒ Intel HEX.
  let i = 0;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
  if (i < bytes.length && bytes[i] === 0x3a /* ':' */) return 'ihex';
  return 'bin';
}

/** Parse an Intel HEX file into absolute-addressed chunks (supports record
 * types 00 data, 01 EOF, 02 extended segment, 04 extended linear address). */
function parseIntelHex(bytes: Uint8Array): Chunk[] {
  const text = Buffer.from(bytes).toString('ascii');
  const lines = text.split(/\r?\n/);
  const chunks: Chunk[] = [];
  let baseAddr = 0; // from ext segment (02) / ext linear (04)
  let sawEof = false;

  for (let ln = 0; ln < lines.length; ln++) {
    const raw = lines[ln].trim();
    if (raw === '') continue;
    const where = `Intel HEX line ${ln + 1}`;
    if (raw[0] !== ':') throw new RomImageError(`${where}: missing ':' record start`);
    if (sawEof) throw new RomImageError(`${where}: data after end-of-file record`);
    const body = raw.slice(1);
    if (body.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(body)) {
      throw new RomImageError(`${where}: not valid hex`);
    }
    const b: number[] = [];
    for (let i = 0; i < body.length; i += 2) b.push(parseInt(body.slice(i, i + 2), 16));
    if (b.length < 5) throw new RomImageError(`${where}: record too short`);
    const count = b[0];
    const addr = (b[1] << 8) | b[2];
    const type = b[3];
    if (b.length !== 5 + count) throw new RomImageError(`${where}: byte count ${count} disagrees with line length`);
    const sum = b.reduce((a, x) => (a + x) & 0xff, 0);
    if (sum !== 0) throw new RomImageError(`${where}: bad checksum`);
    const data = Uint8Array.from(b.slice(4, 4 + count));

    switch (type) {
      case 0x00: // data
        chunks.push({ addr: baseAddr + addr, data });
        break;
      case 0x01: // EOF
        sawEof = true;
        break;
      case 0x02: // extended segment address (paragraph << 4)
        baseAddr = ((data[0] << 8) | data[1]) << 4;
        break;
      case 0x04: // extended linear address (upper 16 bits)
        baseAddr = ((data[0] << 8) | data[1]) << 16;
        break;
      case 0x03: // start segment address — ignored (no CS:IP here)
      case 0x05: // start linear address — ignored
        break;
      default:
        throw new RomImageError(`${where}: unsupported record type 0x${type.toString(16)}`);
    }
  }
  if (!sawEof) throw new RomImageError('Intel HEX: missing end-of-file (:00000001FF) record');
  if (chunks.length === 0) throw new RomImageError('Intel HEX: no data records');
  return chunks;
}

/**
 * Burn an image into an EPROM window. Returns a region-sized buffer plus a
 * summary of what landed where. Throws {@link RomImageError} on a malformed file
 * or data that falls outside the window.
 */
export function burnImage(input: {
  bytes: Uint8Array;
  format: ImageFormat;
  addressing: Addressing;
  region: BurnRegion;
}): BurnResult {
  const { bytes, format, addressing, region } = input;
  if (region.size <= 0) throw new RomImageError(`EPROM size must be positive (got ${region.size})`);

  // Normalize both formats to absolute-addressed chunks. A raw binary has no
  // addresses, so it anchors at the region base (both modes place it there).
  const chunks: Chunk[] =
    format === 'bin' ? [{ addr: region.base, data: bytes }] : parseIntelHex(bytes);
  if (chunks.length === 0 || chunks.every((c) => c.data.length === 0)) {
    throw new RomImageError('image contains no data');
  }

  // The address that maps to the region base: for `file` (honor) it's the base
  // itself (absolute); for `base` (relocate) it's the file's lowest address.
  const minAddr = chunks.reduce((m, c) => Math.min(m, c.addr), Infinity);
  const anchor = addressing === 'file' ? region.base : minAddr;

  const image = new Uint8Array(region.size);
  let bytesWritten = 0;
  let lowOff = Infinity;
  let highOff = -1;

  for (const c of chunks) {
    if (c.data.length === 0) continue;
    const off = c.addr - anchor;
    const end = off + c.data.length; // exclusive
    if (off < 0 || end > region.size) {
      if (addressing === 'file') {
        throw new RomImageError(
          `data at ${hex(c.addr)} (${c.data.length} bytes) falls outside the EPROM window ${hex(region.base)}–${hex(region.base + region.size - 1)}`,
        );
      }
      throw new RomImageError(
        `image spans ${hex(minAddr)}–${hex(chunks.reduce((m, x) => Math.max(m, x.addr + x.data.length - 1), 0))} ` +
          `(${end} bytes from base) but the EPROM is only ${region.size} bytes`,
      );
    }
    image.set(c.data, off);
    bytesWritten += c.data.length;
    lowOff = Math.min(lowOff, off);
    highOff = Math.max(highOff, end - 1);
  }

  return {
    image,
    bytesWritten,
    lowAddr: region.base + lowOff,
    highAddr: region.base + highOff,
    addressing,
    format,
  };
}

/** Human-readable one-liner, e.g. "burned 2 KB → 0xF800–0xFFFF (Intel HEX, from file addresses)". */
export function burnSummary(r: BurnResult): string {
  const kb = r.bytesWritten >= 1024 && r.bytesWritten % 1024 === 0
    ? `${r.bytesWritten / 1024} KB`
    : `${r.bytesWritten} bytes`;
  const fmt = r.format === 'ihex' ? 'Intel HEX' : 'binary';
  const mode = r.addressing === 'file' ? 'from file addresses' : 'from base';
  return `burned ${kb} → ${hex(r.lowAddr)}–${hex(r.highAddr)} (${fmt}, ${mode})`;
}
