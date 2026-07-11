/**
 * ClientMountRegistry — in-memory per-client drive-bay overrides, mirroring the
 * global MountRegistry but keyed by (clientId, drive). An entry overrides the
 * global mount for one client on one drive; the absence of an entry means that
 * drive inherits the global mount.
 *
 * Backed by the `client_mounts` DB table: loaded once at startup, and kept in
 * sync by the /api/clients write path (which bumps the per-entry epoch so live
 * DriveSessions detect the change and re-open + open a swap window).
 */

import * as path from 'path';

export interface ClientMountEntry {
  filename: string;
  readonly: boolean;
  /** Monotonic version, bumped on every change to this (client, drive). */
  epoch: number;
}

export class ClientMountRegistry {
  private byClient = new Map<string, Map<number, ClientMountEntry>>();
  private epochCounter = 0;

  /** Set (or replace) a client's override on one drive. Bumps its epoch. */
  set(clientId: string, drive: number, filename: string, readonly: boolean): void {
    let drives = this.byClient.get(clientId);
    if (!drives) {
      drives = new Map();
      this.byClient.set(clientId, drives);
    }
    drives.set(drive, { filename, readonly, epoch: ++this.epochCounter });
  }

  /** Clear a client's override on one drive (⇒ inherit global). */
  clear(clientId: string, drive: number): void {
    const drives = this.byClient.get(clientId);
    if (!drives) return;
    drives.delete(drive);
    if (drives.size === 0) this.byClient.delete(clientId);
  }

  /** Remove all of a client's overrides. */
  clearClient(clientId: string): void {
    this.byClient.delete(clientId);
  }

  get(clientId: string, drive: number): ClientMountEntry | null {
    return this.byClient.get(clientId)?.get(drive) ?? null;
  }

  /** Snapshot copy of one client's overrides. */
  forClient(clientId: string): Map<number, ClientMountEntry> {
    return new Map(this.byClient.get(clientId) ?? []);
  }

  /** Remove every override pointing at an image (matched by basename). Used
   *  when the base image is deleted. */
  clearByBasename(basename: string): void {
    for (const [clientId, drives] of this.byClient) {
      for (const [drive, entry] of drives) {
        if (path.basename(entry.filename) === basename) drives.delete(drive);
      }
      if (drives.size === 0) this.byClient.delete(clientId);
    }
  }

  /** Repoint every override on an image to a new absolute path (image renamed). */
  renameByBasename(oldBasename: string, newFullPath: string): void {
    for (const drives of this.byClient.values()) {
      for (const [drive, entry] of drives) {
        if (path.basename(entry.filename) === oldBasename) {
          drives.set(drive, { filename: newFullPath, readonly: entry.readonly, epoch: ++this.epochCounter });
        }
      }
    }
  }
}

let clientMountRegistryInstance: ClientMountRegistry | null = null;

export function getClientMountRegistry(): ClientMountRegistry {
  if (!clientMountRegistryInstance) {
    clientMountRegistryInstance = new ClientMountRegistry();
  }
  return clientMountRegistryInstance;
}
