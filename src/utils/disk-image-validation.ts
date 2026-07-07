/**
 * Shared validation for disk-image ingest.
 *
 * Both the HTTP upload route (`POST /api/images/upload`) and the MCP
 * `upload_disk_image` tool accept arbitrary bytes destined for the
 * disks directory, so they must apply identical guards — extension
 * allowlist, size ceiling, and a magic-byte sniff that rejects common
 * executables/archives/images masquerading as a disk image. Keeping
 * the rules here means the two entry points can't drift apart.
 */

import * as path from 'path';

/** Accepted disk-image file extensions (lower-case, with leading dot). */
export const DISK_IMAGE_EXTENSIONS = ['.dsk', '.img', '.ima'] as const;

/** Largest disk image we accept via upload/import. */
export const MAX_DISK_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

/** True iff `filename`'s extension is in the disk-image allowlist. */
export function isAllowedDiskImageExtension(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return (DISK_IMAGE_EXTENSIONS as readonly string[]).includes(ext);
}

const FORBIDDEN_MAGIC: Array<{ sig: number[]; label: string }> = [
  { sig: [0x50, 0x4b, 0x03, 0x04], label: 'ZIP' },
  { sig: [0x7f, 0x45, 0x4c, 0x46], label: 'ELF' },
  { sig: [0x4d, 0x5a], label: 'PE/DOS executable' },
  { sig: [0xff, 0xd8, 0xff], label: 'JPEG' },
  { sig: [0x89, 0x50, 0x4e, 0x47], label: 'PNG' },
];

/**
 * If the buffer's leading bytes match a known executable/archive/image
 * signature, returns that type's label; otherwise null. Callers should
 * reject a non-null result.
 */
export function detectForbiddenMagic(buf: Buffer): string | null {
  for (const { sig, label } of FORBIDDEN_MAGIC) {
    if (buf.length >= sig.length && buf.subarray(0, sig.length).equals(Buffer.from(sig))) {
      return label;
    }
  }
  return null;
}
