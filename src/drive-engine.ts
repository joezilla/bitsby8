/**
 * IDriveEngine — the drive-side surface the FdcServer command loop needs.
 *
 * Two implementations:
 *   - DriveManager  (src/drive.ts): the global singleton engine used for the
 *     single-client path (multi-client flag OFF) — unchanged behavior.
 *   - DriveSession  (src/drive-session.ts): a per-connection engine used when
 *     multi-client serving is ON, giving each client its own copy-on-write
 *     view of the operator-mounted disks.
 *
 * Decoupling FdcServer from the concrete DriveManager lets one command loop
 * per connection drive its own engine.
 */

import { DriveState, FdcError } from './protocol';

export interface IDriveEngine {
  /** Last FDC error code (read by the write-response path). */
  fdcErrno: FdcError;
  /** Mutable per-drive state (the loop sets hdld/track on it). */
  getDriveState(drive: number): DriveState | null;
  isMounted(drive: number): boolean;
  isInSwapWindow(drive: number): boolean;
  readTrack(drive: number, track: number, length: number): Promise<Buffer>;
  canWrite(drive: number): Promise<boolean>;
  writeTrack(drive: number, track: number, length: number, buffer: Buffer): Promise<number>;
}
