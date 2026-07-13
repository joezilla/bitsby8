/**
 * Tests for ROM image burning (Bitsby8 Story 5.2): .bin + Intel HEX parsing,
 * the file-addresses vs from-base toggle, window overflow errors, and the
 * summary line.
 */
import { burnImage, burnSummary, detectFormat, RomImageError } from '../src/services/rom-image';

/** Assemble one Intel HEX record (with a valid checksum). */
function hexLine(count: number, addr: number, type: number, data: number[]): string {
  const bytes = [count, (addr >> 8) & 0xff, addr & 0xff, type, ...data];
  const sum = (0x100 - bytes.reduce((a, x) => (a + x) & 0xff, 0)) & 0xff;
  return ':' + [...bytes, sum].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join('');
}

/** Build a minimal Intel HEX file: optional prefix lines, data records, EOF. */
function ihex(records: Array<{ addr: number; data: number[] }>, prefix: string[] = []): Uint8Array {
  const lines = [...prefix, ...records.map((r) => hexLine(r.data.length, r.addr, 0x00, r.data)), ':00000001FF'];
  return new Uint8Array(Buffer.from(lines.join('\n'), 'ascii'));
}

describe('detectFormat', () => {
  test('sniffs a leading colon as Intel HEX, else binary', () => {
    expect(detectFormat(new Uint8Array(Buffer.from(':00000001FF', 'ascii')))).toBe('ihex');
    expect(detectFormat(new Uint8Array([0xc3, 0x00, 0xf8]))).toBe('bin');
  });
  test('honors the filename extension', () => {
    expect(detectFormat(new Uint8Array([0x3a]), 'boot.bin')).toBe('bin');
    expect(detectFormat(new Uint8Array([0xc3]), 'boot.hex')).toBe('ihex');
  });
});

describe('burnImage — raw binary', () => {
  test('loads at the region base and zero-pads the rest', () => {
    const r = burnImage({
      bytes: new Uint8Array([0xc3, 0x00, 0xf8]),
      format: 'bin',
      addressing: 'base',
      region: { base: 0xf800, size: 0x0800 },
    });
    expect(r.image.length).toBe(0x0800);
    expect([...r.image.slice(0, 4)]).toEqual([0xc3, 0x00, 0xf8, 0x00]);
    expect(r.bytesWritten).toBe(3);
    expect(r.lowAddr).toBe(0xf800);
    expect(r.highAddr).toBe(0xf802);
    // A binary ignores the addressing toggle — 'file' also loads from base.
    const r2 = burnImage({ bytes: new Uint8Array([0x76]), format: 'bin', addressing: 'file', region: { base: 0xf800, size: 0x10 } });
    expect(r2.lowAddr).toBe(0xf800);
  });

  test('rejects a binary larger than the EPROM', () => {
    expect(() =>
      burnImage({ bytes: new Uint8Array(0x900), format: 'bin', addressing: 'base', region: { base: 0xf800, size: 0x0800 } }),
    ).toThrow(RomImageError);
  });
});

describe('burnImage — Intel HEX, honor file addresses', () => {
  test('places each record at its absolute address within the window', () => {
    const file = ihex([
      { addr: 0xf800, data: [0x01, 0x02] },
      { addr: 0xf810, data: [0xaa] },
    ]);
    const r = burnImage({ bytes: file, format: 'ihex', addressing: 'file', region: { base: 0xf800, size: 0x0800 } });
    expect([...r.image.slice(0, 2)]).toEqual([0x01, 0x02]);
    expect(r.image[0x10]).toBe(0xaa);
    expect(r.bytesWritten).toBe(3);
    expect(r.lowAddr).toBe(0xf800);
    expect(r.highAddr).toBe(0xf810);
  });

  test('rejects a record that falls outside the EPROM window', () => {
    const file = ihex([{ addr: 0x0100, data: [0x01] }]); // way below a 0xF800 EPROM
    expect(() =>
      burnImage({ bytes: file, format: 'ihex', addressing: 'file', region: { base: 0xf800, size: 0x0800 } }),
    ).toThrow(/falls outside the EPROM window/);
  });

  test('supports an extended-linear-address record (type 04) preceding data', () => {
    // 04 sets the upper 16 bits to 0x0000, then data at 0xF800 lands at 0xF800.
    const file = ihex([{ addr: 0xf800, data: [0x42] }], [hexLine(2, 0x0000, 0x04, [0x00, 0x00])]);
    const r = burnImage({ bytes: file, format: 'ihex', addressing: 'file', region: { base: 0xf800, size: 0x100 } });
    expect(r.image[0]).toBe(0x42);
  });
});

describe('burnImage — Intel HEX, from base (relocate)', () => {
  test("shifts the file's lowest address to the region base", () => {
    // File addressed at 0x0000/0x0002; relocate into a 0xF800 EPROM.
    const file = ihex([
      { addr: 0x0000, data: [0x11, 0x22] },
      { addr: 0x0004, data: [0x33] },
    ]);
    const r = burnImage({ bytes: file, format: 'ihex', addressing: 'base', region: { base: 0xf800, size: 0x0800 } });
    expect([...r.image.slice(0, 5)]).toEqual([0x11, 0x22, 0x00, 0x00, 0x33]);
    expect(r.lowAddr).toBe(0xf800); // min file addr → base
    expect(r.highAddr).toBe(0xf804);
  });

  test('rejects when the relocated span exceeds the EPROM size', () => {
    // Two bytes 0x0900 apart → a 0x901-byte span, past a 0x800 EPROM after relocate.
    const file = ihex([
      { addr: 0x0000, data: [0x5a] },
      { addr: 0x0900, data: [0x5a] },
    ]);
    expect(() =>
      burnImage({ bytes: file, format: 'ihex', addressing: 'base', region: { base: 0xf800, size: 0x0800 } }),
    ).toThrow(/only 2048 bytes/);
  });
});

describe('Intel HEX validation', () => {
  test('rejects a bad checksum', () => {
    const bad = new Uint8Array(Buffer.from(':0100000000FE\n:00000001FF', 'ascii')); // wrong checksum
    expect(() => burnImage({ bytes: bad, format: 'ihex', addressing: 'base', region: { base: 0, size: 0x10 } })).toThrow(/checksum/);
  });
  test('rejects a missing EOF record', () => {
    const noeof = new Uint8Array(Buffer.from(':0100000000FF', 'ascii'));
    expect(() => burnImage({ bytes: noeof, format: 'ihex', addressing: 'base', region: { base: 0, size: 0x10 } })).toThrow(/end-of-file/);
  });
});

describe('burnSummary', () => {
  test('renders KB when byte count is a KB multiple', () => {
    const r = burnImage({ bytes: new Uint8Array(2048), format: 'bin', addressing: 'base', region: { base: 0xf800, size: 0x0800 } });
    expect(burnSummary(r)).toBe('burned 2 KB → 0xF800–0xFFFF (binary, from base)');
  });
  test('renders bytes otherwise, naming the mode', () => {
    const file = ihex([{ addr: 0xf800, data: [1, 2, 3] }]);
    const r = burnImage({ bytes: file, format: 'ihex', addressing: 'file', region: { base: 0xf800, size: 0x0800 } });
    expect(burnSummary(r)).toBe('burned 3 bytes → 0xF800–0xF802 (Intel HEX, from file addresses)');
  });
});
