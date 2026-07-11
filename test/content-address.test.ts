/**
 * Tests for the content-addressing rule (Bitsby8 Story 4.1, AD-8): JCS/RFC-8785
 * canonicalization, the frozen mediaType table, byte-member hashing, and the
 * Primitive digest (byte-identical → same digest; any change → different; a
 * filename is never Identity).
 */

import {
  jcsCanonicalize,
  mediaTypeFor,
  normalizeMemberPath,
  memberFromBytes,
  primitiveDigest,
  romDigest,
} from '../src/services/content-address';

describe('jcsCanonicalize (RFC-8785)', () => {
  test('sorts object keys by code unit, no whitespace', () => {
    expect(jcsCanonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(jcsCanonicalize({ z: [3, 1], a: 'x' })).toBe('{"a":"x","z":[3,1]}');
    expect(jcsCanonicalize({ B: 1, a: 2 })).toBe('{"B":1,"a":2}'); // 'B' (0x42) < 'a' (0x61)
  });

  test('key order does not affect the canonical form', () => {
    expect(jcsCanonicalize({ a: 1, b: { d: 4, c: 3 } })).toBe(jcsCanonicalize({ b: { c: 3, d: 4 }, a: 1 }));
  });

  test('drops undefined members, keeps null', () => {
    expect(jcsCanonicalize({ a: undefined, b: null, c: 1 })).toBe('{"b":null,"c":1}');
  });

  test('rejects non-integer and non-finite numbers', () => {
    expect(() => jcsCanonicalize({ x: 1.5 })).toThrow(/integer/);
    expect(() => jcsCanonicalize({ x: NaN })).toThrow();
  });
});

describe('mediaType table + member paths', () => {
  test('frozen extension table; unknown → octet-stream', () => {
    expect(mediaTypeFor('rom.bin')).toBe('application/octet-stream');
    expect(mediaTypeFor('a/b/manifest.json')).toBe('application/json');
    expect(mediaTypeFor('card.MJS')).toBe('text/javascript'); // case-insensitive
    expect(mediaTypeFor('mystery.xyz')).toBe('application/octet-stream');
  });

  test('member paths are POSIX + NFC, no leading slash', () => {
    expect(normalizeMemberPath('\\mem\\rom.bin')).toBe('mem/rom.bin');
    const m = memberFromBytes('mem/rom.bin', Uint8Array.of(1, 2, 3));
    expect(m).toMatchObject({ path: 'mem/rom.bin', mediaType: 'application/octet-stream', size: 3 });
    expect(m.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('primitiveDigest', () => {
  const base = { kind: 'profile' as const, meta: { cpu: 'i8080', reset: 0xff00 }, members: [] };

  test('byte-identical primitives (any key/member order) → same digest', () => {
    const a = primitiveDigest(base);
    const b = primitiveDigest({ kind: 'profile', meta: { reset: 0xff00, cpu: 'i8080' }, members: [] });
    expect(b).toBe(a);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('member order does not matter (members are byte-sorted by path)', () => {
    const m1 = memberFromBytes('mem/a.bin', Uint8Array.of(1));
    const m2 = memberFromBytes('mem/b.bin', Uint8Array.of(2));
    expect(primitiveDigest({ ...base, members: [m1, m2] })).toBe(
      primitiveDigest({ ...base, members: [m2, m1] }),
    );
  });

  test('any content change changes the digest', () => {
    const a = primitiveDigest(base);
    expect(primitiveDigest({ ...base, meta: { cpu: 'z80', reset: 0xff00 } })).not.toBe(a);
    expect(primitiveDigest({ ...base, members: [memberFromBytes('mem/x.bin', Uint8Array.of(9))] })).not.toBe(a);
  });
});

describe('romDigest', () => {
  test('same bytes → same digest; one byte change → different', () => {
    const a = romDigest(Uint8Array.of(0xf3, 0x11, 0x00));
    expect(romDigest(Uint8Array.of(0xf3, 0x11, 0x00))).toBe(a);
    expect(romDigest(Uint8Array.of(0xf3, 0x11, 0x01))).not.toBe(a);
  });
});
