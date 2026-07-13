/**
 * Content-addressed Identity for Primitives (Bitsby8 Story 4.1, AD-8).
 *
 * One byte-exact rule for every Primitive (Card Bundle, ROM Image, Machine
 * Profile): a `sha256` over a canonical Merkle manifest —
 *   - JCS / RFC-8785 canonical JSON for the manifest,
 *   - members carry a POSIX + NFC + byte-sorted logical `path`, a `mediaType`
 *     from a FROZEN extension table, `size`, and a `digest` over the shipped
 *     BYTES (e.g. a ROM's raw bytes, built ESM — never source, never a filename).
 *
 * Byte-identical Primitives → the same digest; any content change → a different
 * digest; a host filename is never part of Identity (member paths are logical).
 */

import { createHash } from 'crypto';

/** Frozen extension → mediaType table (AD-8). Unknown → octet-stream. */
export const MEDIA_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.bin': 'application/octet-stream',
  '.rom': 'application/octet-stream',
  '.img': 'application/octet-stream',
  '.dsk': 'application/octet-stream',
});
const DEFAULT_MEDIA_TYPE = 'application/octet-stream';

export interface MemberRef {
  path: string; // logical POSIX + NFC path within the primitive
  mediaType: string;
  size: number;
  digest: string; // sha256: over the member bytes
}

export interface PrimitiveManifest {
  kind: 'card' | 'profile' | 'rom';
  /** Declarative metadata (canonicalized). */
  meta: Record<string, unknown>;
  /** Shipped byte members, byte-sorted by path. */
  members: MemberRef[];
}

const sha256 = (bytes: Uint8Array | Buffer): string =>
  'sha256:' + createHash('sha256').update(bytes).digest('hex');

/** mediaType for a logical path from the frozen table (lowercased extension). */
export function mediaTypeFor(logicalPath: string): string {
  const dot = logicalPath.lastIndexOf('.');
  const ext = dot >= 0 ? logicalPath.slice(dot).toLowerCase() : '';
  return MEDIA_TYPES[ext] ?? DEFAULT_MEDIA_TYPE;
}

/** Normalize a member path: POSIX separators, NFC, no leading slash. */
export function normalizeMemberPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/+/, '').normalize('NFC');
}

/** A member from raw bytes at a logical path. */
export function memberFromBytes(logicalPath: string, bytes: Uint8Array): MemberRef {
  const path = normalizeMemberPath(logicalPath);
  return { path, mediaType: mediaTypeFor(path), size: bytes.length, digest: sha256(bytes) };
}

/**
 * JCS (RFC-8785) canonical JSON. Objects: keys sorted by UTF-16 code unit, no
 * whitespace; strings/integers via ECMAScript serialization (JSON semantics).
 * Non-finite and non-integer numbers are rejected — Primitive manifests use only
 * strings, integers, booleans, null, arrays, and objects.
 */
export function jcsCanonicalize(value: unknown): string {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number') {
    const n = value as number;
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw new Error(`content-address: only integer numbers are canonicalizable (got ${n})`);
    }
    return JSON.stringify(n);
  }
  if (t === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(jcsCanonicalize).join(',') + ']';
  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined) // JSON drops undefined
      .sort(); // default string sort == UTF-16 code-unit order (RFC-8785)
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + jcsCanonicalize(obj[k])).join(',') + '}';
  }
  throw new Error(`content-address: unsupported value type ${t}`);
}

/** Content-addressed Identity of a ROM Image Primitive (its raw bytes as the
 * sole member). Used by export/import; two identical ROMs → the same digest. */
export function romDigest(bytes: Uint8Array, meta: { name?: string; version?: string } = {}): string {
  return primitiveDigest({
    kind: 'rom',
    meta: { name: meta.name ?? null, version: meta.version ?? null },
    members: [memberFromBytes('rom.bin', bytes)],
  });
}

/** The Identity digest of a Primitive: sha256 over its canonical Merkle manifest. */
export function primitiveDigest(manifest: PrimitiveManifest): string {
  const canonical: PrimitiveManifest = {
    kind: manifest.kind,
    meta: manifest.meta,
    members: [...manifest.members].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  };
  return sha256(Buffer.from(jcsCanonicalize(canonical as unknown as Record<string, unknown>), 'utf8'));
}
