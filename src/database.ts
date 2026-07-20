/**
 * Database Module
 * Manages SQLite database for disk and cassette metadata (notes, descriptions).
 *
 * Uses better-sqlite3 for synchronous, high-performance SQLite access.
 * Methods retain async signatures for backward compatibility with callers.
 */

import BetterSqlite3 from 'better-sqlite3';
import { chmodSync, existsSync, renameSync } from 'fs';
import * as path from 'path';

/** Current on-disk SQLite database filename (inside `dataDir`). */
export const DB_FILENAME = 'bitsby8.db';
/** Pre-rename filename, self-healed to {@link DB_FILENAME} on startup. */
export const LEGACY_DB_FILENAME = 'fdcplus.db';

export interface DiskNote {
  filename: string;
  description: string;
  notes: string;
  updated_at: string;
}

export interface CassetteNote {
  filename: string;
  description: string;
  notes: string;
  updated_at: string;
}

export interface DriveAssignment {
  drive_id: number;
  filename: string;
  readonly: number; // SQLite uses 0/1 for boolean
  updated_at: string;
}

export interface SnapshotRecord {
  id: string;
  disk_filename: string;
  label: string;
  size_bytes: number;
  created_at: string;
}

/** Per-image behavior when the guest writes to a read-only mount. */
export type ReadonlyWritePolicy = 'inherit' | 'error' | 'transient';

export interface ClientSplinter {
  client_id: string;
  drive: number;
  base_filename: string;
  path: string;
  dirty: number; // SQLite 0/1
  updated_at: string;
}

export interface ClientMount {
  client_id: string;
  drive: number;
  filename: string;
  readonly: number; // SQLite 0/1
  updated_at: string;
}

export interface ProfileDisk {
  profile_name: string;
  drive: number;
  filename: string;
  readonly: number; // SQLite 0/1
  updated_at: string;
}

export interface ClientLabel {
  client_id: string;
  name: string;
  updated_at: string;
}

/** A Card Definition in the Catalog (Bitsby8). Identity = `name@version` +
 * `digest`; `manifest` is the JSON-serialized CardManifest. */
export interface CardDefinitionRecord {
  id: string; // `${name}@${version}`
  name: string;
  version: string;
  digest: string;
  type: string;
  maker: string | null;
  summary: string | null;
  manifest: string; // JSON
  entry: string | null; // bundle entry ref
  source: string; // 'seed' | 'imported' | 'signed'
  created_at: string;
}

/** A persistent Machine Instance (Bitsby8). Transient instances are memory-only
 * (never written here). `client_id` is the reserved `inst:<uuid>` serving id. */
export interface MachineInstanceRecord {
  id: string;
  profile_ref: string;
  client_id: string;
  cpu_kind: string;
  status: string; // 'defined' | 'running' | 'stopped'
  created_at: string;
}

/** An instance disk/media snapshot (Bitsby8 Story 3.4) — the machine definition
 * (profile_ref) + a copy of each bound drive's disk state, as a restorable unit.
 * Execution (CPU) state is explicitly NOT captured. Disk images live under
 * `{disksDir}/.instance-snapshots/<id>/`; `disks` is the JSON manifest. */
export interface InstanceSnapshotRecord {
  id: string;
  instance_id: string;
  profile_ref: string;
  label: string | null;
  disks: string; // JSON: [{ drive, base_filename, file }]
  created_at: string;
}

/** A Machine Profile (Bitsby8) — a versioned Primitive (name@version + sha256
 * `digest`) describing a machine declaratively. The full profile (CPU, clock,
 * memory/ROM layout, card instances) is stored as JSON with ROM images base64.
 * Versions are immutable: editing writes a new version; prior versions remain. */
export interface MachineProfileRecord {
  id: string; // `${name}@${version}`
  name: string;
  version: string;
  digest: string;
  cpu_kind: string;
  profile: string; // JSON (MachineProfile with memory images base64-encoded)
  notes: string | null;
  /** Run-cockpit LED grouping default ('oct' | 'hex') — metadata, not digested. */
  panel_base: string;
  /** Fold operator a–z keystrokes to A–Z at the console RX (SOLOS-class machines
   * that accept only upper case) — metadata (0/1), not digested. */
  uppercase_input: number;
  source: string; // 'user' | 'preset' | 'imported'
  created_at: string;
}

// Schema migrations, applied in order. Each runs inside a transaction.
const MIGRATIONS: string[] = [
  // Migration 0: initial schema
  `CREATE TABLE IF NOT EXISTS disk_notes (
    filename TEXT PRIMARY KEY,
    description TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS cassette_notes (
    filename TEXT PRIMARY KEY,
    description TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS drive_assignments (
    drive_id INTEGER PRIMARY KEY,
    filename TEXT NOT NULL,
    readonly INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`,
  // Migration 1: disk snapshots — point-in-time full-file copies keyed by
  // the disk image filename. The .snap blob lives under {disksDir}/.snapshots.
  `CREATE TABLE IF NOT EXISTS disk_snapshots (
    id TEXT PRIMARY KEY,
    disk_filename TEXT NOT NULL,
    label TEXT DEFAULT '',
    size_bytes INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_disk_snapshots_disk ON disk_snapshots(disk_filename);`,
  // Migration 2: per-image read-only-write policy. Overrides the global
  // `readonlyWritePolicy` config default; 'inherit' (or an absent row) falls
  // through to that default.
  `CREATE TABLE IF NOT EXISTS disk_policies (
    filename TEXT PRIMARY KEY,
    on_readonly_write TEXT NOT NULL DEFAULT 'inherit',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`,
  // Migration 3: generic key/value settings store for operator-facing runtime
  // toggles that live in the DB (not the config file), e.g. the multi-client
  // serving feature flag.
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`,
  // Migration 4: persistent per-client copy-on-write splinters. Keyed by
  // (client_id, drive); `base_filename` records which mounted image the
  // splinter forked from so a reconnecting client only re-attaches when the
  // same base is still mounted.
  `CREATE TABLE IF NOT EXISTS client_splinters (
    client_id TEXT NOT NULL,
    drive INTEGER NOT NULL,
    base_filename TEXT NOT NULL,
    path TEXT NOT NULL,
    dirty INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (client_id, drive)
  );
  CREATE INDEX IF NOT EXISTS idx_client_splinters_base ON client_splinters(base_filename);`,
  // Migration 5: per-client drive-bay overrides + friendly names. A
  // client_mounts row overrides the global mount on one drive for one client;
  // an absent row means that drive inherits the global mount. client_labels
  // gives a persistent client a human-readable name.
  `CREATE TABLE IF NOT EXISTS client_mounts (
    client_id TEXT NOT NULL,
    drive INTEGER NOT NULL,
    filename TEXT NOT NULL,
    readonly INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (client_id, drive)
  );
  CREATE INDEX IF NOT EXISTS idx_client_mounts_filename ON client_mounts(filename);
  CREATE TABLE IF NOT EXISTS client_labels (
    client_id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`,

  // Migration 6: Catalog — Card Definitions (Bitsby8). A Card Definition is a
  // versioned Primitive identified by `name@version` + a content `digest`; the
  // full CardManifest (config schema, docs refs) is stored as JSON. `entry` is
  // the bundle's behavior-module ref; `source` records provenance for the
  // (deferred) trust boundary.
  `CREATE TABLE IF NOT EXISTS card_definitions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    digest TEXT NOT NULL,
    type TEXT NOT NULL,
    maker TEXT,
    summary TEXT,
    manifest TEXT NOT NULL,
    entry TEXT,
    source TEXT NOT NULL DEFAULT 'seed',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (name, version)
  );
  CREATE INDEX IF NOT EXISTS idx_card_definitions_name ON card_definitions(name);`,

  // Migration 7: persistent Machine Instances (Bitsby8). A DB-backed instance
  // is re-runnable across restarts; transient instances are memory-only in the
  // InstanceManager and never recorded here. `client_id` is the reserved
  // `inst:<uuid>` serving identity that keys the instance's copy-on-write splinter.
  `CREATE TABLE IF NOT EXISTS machine_instances (
    id TEXT PRIMARY KEY,
    profile_ref TEXT NOT NULL,
    client_id TEXT NOT NULL,
    cpu_kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'defined',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`,

  // Migration 8: Machine Profiles (Bitsby8) — a declarative machine as a
  // versioned Primitive (`name@version` + content `digest`). The full profile
  // (CPU, clock, memory/ROM layout, card instances) is stored as JSON. Versions
  // are immutable — an edit inserts a new (name, version) row; prior versions
  // stay resolvable (FR-10 content addressing).
  `CREATE TABLE IF NOT EXISTS machine_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    digest TEXT NOT NULL,
    cpu_kind TEXT NOT NULL,
    profile TEXT NOT NULL,
    notes TEXT,
    source TEXT NOT NULL DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (name, version)
  );
  CREATE INDEX IF NOT EXISTS idx_machine_profiles_name ON machine_profiles(name);`,

  // Migration 9: instance disk/media snapshots (Bitsby8 Story 3.4). A snapshot
  // is the machine definition (profile_ref) + a copy of each bound drive's disk
  // state, restorable as a unit. Execution state is out of scope. Disk images
  // are stored on disk under {disksDir}/.instance-snapshots/<id>/.
  `CREATE TABLE IF NOT EXISTS instance_snapshots (
    id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL,
    profile_ref TEXT NOT NULL,
    label TEXT,
    disks TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_instance_snapshots_instance ON instance_snapshots(instance_id);`,

  // Migration 10: per-profile startup disk mounts (Bitsby8). Which disk image
  // (if any) each drive gets when a machine is launched from a profile. Keyed by
  // profile NAME (not name@version), so the disk set follows the machine lineage
  // across saved versions. Applied at launch as per-instance mount overrides —
  // profiles stay content-addressed, so disks live here, never in profile content.
  `CREATE TABLE IF NOT EXISTS profile_disks (
    profile_name TEXT NOT NULL,
    drive INTEGER NOT NULL,
    filename TEXT NOT NULL,
    readonly INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (profile_name, drive)
  );
  CREATE INDEX IF NOT EXISTS idx_profile_disks_filename ON profile_disks(filename);`,

  // Migration 11: per-profile front-panel base (oct/hex) — a display default for
  // the run cockpit's LED grouping. It's a machine-definition preference, not
  // hardware: stored alongside `notes`, OUTSIDE the content digest, so it never
  // rebuilds the profile's identity or reaches the 8sim spec.
  `ALTER TABLE machine_profiles ADD COLUMN panel_base TEXT NOT NULL DEFAULT 'oct';`,

  // Migration 12: per-profile uppercase-only console input. Machines like the
  // SOL-20 SOLOS accept only upper-case ASCII; when set, the operator's a–z
  // keystrokes are folded to A–Z at the RX boundary. Metadata, not hardware —
  // stored alongside panel_base, OUTSIDE the content digest and the 8sim spec.
  `ALTER TABLE machine_profiles ADD COLUMN uppercase_input INTEGER NOT NULL DEFAULT 0;`,
];

export class Database {
  private db: BetterSqlite3.Database | null = null;
  private dbPath: string;
  private initialized = false;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  getPath(): string {
    return this.dbPath;
  }

  /**
   * Initialize database and run migrations.
   */
  async initialize(): Promise<void> {
    this.db = new BetterSqlite3(this.dbPath);

    // Enable WAL mode for better concurrent read performance
    this.db.pragma('journal_mode = WAL');

    this.runMigrations();

    this.initialized = true;
    try { chmodSync(this.dbPath, 0o600); } catch { /* non-fatal */ }
    console.log(`Database initialized at: ${this.dbPath}`);
  }

  /**
   * Run schema migrations.
   */
  private runMigrations(): void {
    if (!this.db) throw new Error('Database not open');

    // Create migration tracking table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get current version
    const row = this.db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null } | undefined;
    const currentVersion = row?.version ?? -1;

    // Apply pending migrations
    for (let i = currentVersion + 1; i < MIGRATIONS.length; i++) {
      const migrate = this.db.transaction(() => {
        this.db!.exec(MIGRATIONS[i]);
        this.db!.prepare('INSERT INTO schema_version (version) VALUES (?)').run(i);
      });
      migrate();
      console.log(`Applied database migration ${i}`);
    }
  }

  /**
   * Get disk note by filename.
   */
  async getDiskNote(filename: string): Promise<DiskNote | null> {
    this.ensureInitialized();
    const row = this.db!.prepare('SELECT * FROM disk_notes WHERE filename = ?').get(filename) as DiskNote | undefined;
    return row || null;
  }

  /**
   * Get cassette note by filename.
   */
  async getCassetteNote(filename: string): Promise<CassetteNote | null> {
    this.ensureInitialized();
    const row = this.db!.prepare('SELECT * FROM cassette_notes WHERE filename = ?').get(filename) as CassetteNote | undefined;
    return row || null;
  }

  /**
   * Get all disk notes.
   */
  async getAllDiskNotes(): Promise<Map<string, DiskNote>> {
    this.ensureInitialized();
    const rows = this.db!.prepare('SELECT * FROM disk_notes').all() as DiskNote[];
    const map = new Map<string, DiskNote>();
    for (const row of rows) {
      map.set(row.filename, row);
    }
    return map;
  }

  /**
   * Get all cassette notes.
   */
  async getAllCassetteNotes(): Promise<Map<string, CassetteNote>> {
    this.ensureInitialized();
    const rows = this.db!.prepare('SELECT * FROM cassette_notes').all() as CassetteNote[];
    const map = new Map<string, CassetteNote>();
    for (const row of rows) {
      map.set(row.filename, row);
    }
    return map;
  }

  /**
   * Update or insert disk note.
   */
  async upsertDiskNote(filename: string, description: string, notes: string): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare(
      `INSERT INTO disk_notes (filename, description, notes, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(filename) DO UPDATE SET
         description = excluded.description,
         notes = excluded.notes,
         updated_at = CURRENT_TIMESTAMP`
    ).run(filename, description, notes);
  }

  /**
   * Update or insert cassette note.
   */
  async upsertCassetteNote(filename: string, description: string, notes: string): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare(
      `INSERT INTO cassette_notes (filename, description, notes, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(filename) DO UPDATE SET
         description = excluded.description,
         notes = excluded.notes,
         updated_at = CURRENT_TIMESTAMP`
    ).run(filename, description, notes);
  }

  /**
   * Delete disk note.
   */
  async deleteDiskNote(filename: string): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare('DELETE FROM disk_notes WHERE filename = ?').run(filename);
  }

  /**
   * Move a disk note from one filename to another. No-op if no row matched.
   * If the destination key already has a row, this throws (SQLite UNIQUE
   * constraint) — callers should clear the destination first or treat as error.
   */
  async renameDiskNote(oldFilename: string, newFilename: string): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare(
      `UPDATE disk_notes SET filename = ?, updated_at = CURRENT_TIMESTAMP WHERE filename = ?`
    ).run(newFilename, oldFilename);
  }

  /**
   * Delete cassette note.
   */
  async deleteCassetteNote(filename: string): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare('DELETE FROM cassette_notes WHERE filename = ?').run(filename);
  }

  /**
   * Get all drive assignments.
   */
  async getAllDriveAssignments(): Promise<DriveAssignment[]> {
    this.ensureInitialized();
    return this.db!.prepare('SELECT * FROM drive_assignments ORDER BY drive_id').all() as DriveAssignment[];
  }

  /**
   * Save drive assignment (mount).
   */
  async saveDriveAssignment(driveId: number, filename: string, readonly: boolean): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare(
      `INSERT INTO drive_assignments (drive_id, filename, readonly, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(drive_id) DO UPDATE SET
         filename = excluded.filename,
         readonly = excluded.readonly,
         updated_at = CURRENT_TIMESTAMP`
    ).run(driveId, filename, readonly ? 1 : 0);
  }

  /**
   * Clear drive assignment (unmount).
   */
  async clearDriveAssignment(driveId: number): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare('DELETE FROM drive_assignments WHERE drive_id = ?').run(driveId);
  }

  /**
   * Clear all drive assignments.
   */
  async clearAllDriveAssignments(): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare('DELETE FROM drive_assignments').run();
  }

  /**
   * Insert a snapshot metadata row. The caller creates the .snap blob first.
   */
  async insertSnapshot(id: string, diskFilename: string, label: string, sizeBytes: number): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare(
      `INSERT INTO disk_snapshots (id, disk_filename, label, size_bytes, created_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).run(id, diskFilename, label, sizeBytes);
  }

  /**
   * Get a single snapshot by id.
   */
  async getSnapshot(id: string): Promise<SnapshotRecord | null> {
    this.ensureInitialized();
    const row = this.db!.prepare('SELECT * FROM disk_snapshots WHERE id = ?').get(id) as SnapshotRecord | undefined;
    return row || null;
  }

  /**
   * List all snapshots for a disk image, newest first.
   */
  async listSnapshotsForDisk(diskFilename: string): Promise<SnapshotRecord[]> {
    this.ensureInitialized();
    return this.db!.prepare(
      'SELECT * FROM disk_snapshots WHERE disk_filename = ? ORDER BY created_at DESC, id DESC'
    ).all(diskFilename) as SnapshotRecord[];
  }

  /**
   * Delete a single snapshot row. The caller removes the .snap blob separately.
   */
  async deleteSnapshotRow(id: string): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare('DELETE FROM disk_snapshots WHERE id = ?').run(id);
  }

  /**
   * Repoint all snapshots for a disk when the disk image is renamed.
   */
  async renameSnapshotsDisk(oldFilename: string, newFilename: string): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare(
      'UPDATE disk_snapshots SET disk_filename = ? WHERE disk_filename = ?'
    ).run(newFilename, oldFilename);
  }

  /**
   * Delete all snapshot rows for a disk and return their ids so the caller
   * can remove the matching .snap blobs.
   */
  async deleteSnapshotsForDisk(diskFilename: string): Promise<string[]> {
    this.ensureInitialized();
    const rows = this.db!.prepare('SELECT id FROM disk_snapshots WHERE disk_filename = ?').all(diskFilename) as { id: string }[];
    this.db!.prepare('DELETE FROM disk_snapshots WHERE disk_filename = ?').run(diskFilename);
    return rows.map((r) => r.id);
  }

  /**
   * Get the per-image read-only-write policy. Returns 'inherit' when no row
   * exists (i.e. fall through to the global default).
   */
  async getDiskPolicy(filename: string): Promise<ReadonlyWritePolicy> {
    this.ensureInitialized();
    const row = this.db!.prepare('SELECT on_readonly_write FROM disk_policies WHERE filename = ?').get(filename) as { on_readonly_write: ReadonlyWritePolicy } | undefined;
    return row?.on_readonly_write ?? 'inherit';
  }

  /**
   * Set the per-image read-only-write policy. Writing 'inherit' clears the row
   * so the disk simply follows the global default.
   */
  async setDiskPolicy(filename: string, policy: ReadonlyWritePolicy): Promise<void> {
    this.ensureInitialized();
    if (policy === 'inherit') {
      this.db!.prepare('DELETE FROM disk_policies WHERE filename = ?').run(filename);
      return;
    }
    this.db!.prepare(
      `INSERT INTO disk_policies (filename, on_readonly_write, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(filename) DO UPDATE SET
         on_readonly_write = excluded.on_readonly_write,
         updated_at = CURRENT_TIMESTAMP`
    ).run(filename, policy);
  }

  /** Move a policy row when a disk image is renamed. */
  async renameDiskPolicy(oldFilename: string, newFilename: string): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare(
      'UPDATE disk_policies SET filename = ?, updated_at = CURRENT_TIMESTAMP WHERE filename = ?'
    ).run(newFilename, oldFilename);
  }

  /** Delete the policy row for a disk image. */
  async deleteDiskPolicy(filename: string): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare('DELETE FROM disk_policies WHERE filename = ?').run(filename);
  }

  /**
   * Read a generic setting. Returns null when unset so callers can apply their
   * own default.
   */
  async getSetting(key: string): Promise<string | null> {
    this.ensureInitialized();
    const row = this.db!.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  /** Write a generic setting. */
  async setSetting(key: string, value: string): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
    ).run(key, value);
  }

  /** Get a persistent client splinter, or null. */
  async getClientSplinter(clientId: string, drive: number): Promise<ClientSplinter | null> {
    this.ensureInitialized();
    const row = this.db!.prepare(
      'SELECT * FROM client_splinters WHERE client_id = ? AND drive = ?'
    ).get(clientId, drive) as ClientSplinter | undefined;
    return row || null;
  }

  /** Record (or update) a persistent client splinter. */
  async upsertClientSplinter(clientId: string, drive: number, baseFilename: string, path: string, dirty: boolean): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare(
      `INSERT INTO client_splinters (client_id, drive, base_filename, path, dirty, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(client_id, drive) DO UPDATE SET
         base_filename = excluded.base_filename,
         path = excluded.path,
         dirty = excluded.dirty,
         updated_at = CURRENT_TIMESTAMP`
    ).run(clientId, drive, baseFilename, path, dirty ? 1 : 0);
  }

  /** Delete one client splinter row. */
  async deleteClientSplinter(clientId: string, drive: number): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare('DELETE FROM client_splinters WHERE client_id = ? AND drive = ?').run(clientId, drive);
  }

  /** List all persistent splinters (e.g. for status / cleanup). */
  async listClientSplinters(): Promise<ClientSplinter[]> {
    this.ensureInitialized();
    return this.db!.prepare('SELECT * FROM client_splinters').all() as ClientSplinter[];
  }

  /**
   * Delete every splinter row forked from a base image and return their paths
   * so the caller can remove the blobs. Used when the base is deleted.
   */
  async deleteClientSplintersForBase(baseFilename: string): Promise<string[]> {
    this.ensureInitialized();
    const rows = this.db!.prepare('SELECT path FROM client_splinters WHERE base_filename = ?').all(baseFilename) as { path: string }[];
    this.db!.prepare('DELETE FROM client_splinters WHERE base_filename = ?').run(baseFilename);
    return rows.map((r) => r.path);
  }

  /** Repoint splinter rows when a base image is renamed (content unchanged). */
  async renameClientSplintersBase(oldBase: string, newBase: string): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare(
      'UPDATE client_splinters SET base_filename = ?, updated_at = CURRENT_TIMESTAMP WHERE base_filename = ?'
    ).run(newBase, oldBase);
  }

  // --- Per-client drive-bay overrides (client_mounts) ---------------------

  /** Get a client's override for one drive, or null (⇒ inherit global). */
  async getClientMount(clientId: string, drive: number): Promise<ClientMount | null> {
    this.ensureInitialized();
    const row = this.db!.prepare('SELECT * FROM client_mounts WHERE client_id = ? AND drive = ?').get(clientId, drive) as ClientMount | undefined;
    return row || null;
  }

  /** Set (or replace) a client's per-drive mount override. */
  async setClientMount(clientId: string, drive: number, filename: string, readonly: boolean): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare(
      `INSERT INTO client_mounts (client_id, drive, filename, readonly, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(client_id, drive) DO UPDATE SET
         filename = excluded.filename,
         readonly = excluded.readonly,
         updated_at = CURRENT_TIMESTAMP`
    ).run(clientId, drive, filename, readonly ? 1 : 0);
  }

  /** Clear a client's override on one drive (⇒ fall back to global). */
  async deleteClientMount(clientId: string, drive: number): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare('DELETE FROM client_mounts WHERE client_id = ? AND drive = ?').run(clientId, drive);
  }

  /** List a single client's overrides, or all of them when clientId omitted. */
  async listClientMounts(clientId?: string): Promise<ClientMount[]> {
    this.ensureInitialized();
    if (clientId === undefined) {
      return this.db!.prepare('SELECT * FROM client_mounts ORDER BY client_id, drive').all() as ClientMount[];
    }
    return this.db!.prepare('SELECT * FROM client_mounts WHERE client_id = ? ORDER BY drive').all(clientId) as ClientMount[];
  }

  /** Delete every client override that points at a base image (base deleted). */
  async deleteClientMountsForBase(filename: string): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare('DELETE FROM client_mounts WHERE filename = ?').run(filename);
  }

  /** Repoint client overrides when a base image is renamed. */
  async renameClientMountsBase(oldFilename: string, newFilename: string): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare(
      'UPDATE client_mounts SET filename = ?, updated_at = CURRENT_TIMESTAMP WHERE filename = ?'
    ).run(newFilename, oldFilename);
  }

  /** Remove all of a client's overrides (used by "forget client"). */
  async deleteClientMountsForClient(clientId: string): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare('DELETE FROM client_mounts WHERE client_id = ?').run(clientId);
  }

  // --- Per-profile startup disk mounts (profile_disks) --------------------

  /** List a profile's startup disk bindings (by profile name), sorted by drive. */
  async listProfileDisks(profileName: string): Promise<ProfileDisk[]> {
    this.ensureInitialized();
    return this.db!.prepare(
      'SELECT * FROM profile_disks WHERE profile_name = ? ORDER BY drive'
    ).all(profileName) as ProfileDisk[];
  }

  /** Set (or replace) a profile's disk binding for one drive. */
  async setProfileDisk(profileName: string, drive: number, filename: string, readonly: boolean): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare(
      `INSERT INTO profile_disks (profile_name, drive, filename, readonly, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(profile_name, drive) DO UPDATE SET
         filename = excluded.filename,
         readonly = excluded.readonly,
         updated_at = CURRENT_TIMESTAMP`
    ).run(profileName, drive, filename, readonly ? 1 : 0);
  }

  /** Clear a profile's binding on one drive. */
  async deleteProfileDisk(profileName: string, drive: number): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare('DELETE FROM profile_disks WHERE profile_name = ? AND drive = ?').run(profileName, drive);
  }

  /** Remove all of a profile's disk bindings (used when the profile is deleted). */
  async deleteProfileDisksForProfile(profileName: string): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare('DELETE FROM profile_disks WHERE profile_name = ?').run(profileName);
  }

  /** Delete every profile binding that points at a base image (base deleted). */
  async deleteProfileDisksForBase(filename: string): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare('DELETE FROM profile_disks WHERE filename = ?').run(filename);
  }

  /** Repoint profile bindings when a base image is renamed. */
  async renameProfileDisksBase(oldFilename: string, newFilename: string): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare(
      'UPDATE profile_disks SET filename = ?, updated_at = CURRENT_TIMESTAMP WHERE filename = ?'
    ).run(newFilename, oldFilename);
  }

  // --- Per-client friendly names (client_labels) --------------------------

  async getClientLabel(clientId: string): Promise<ClientLabel | null> {
    this.ensureInitialized();
    const row = this.db!.prepare('SELECT * FROM client_labels WHERE client_id = ?').get(clientId) as ClientLabel | undefined;
    return row || null;
  }

  async setClientLabel(clientId: string, name: string): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare(
      `INSERT INTO client_labels (client_id, name, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(client_id) DO UPDATE SET name = excluded.name, updated_at = CURRENT_TIMESTAMP`
    ).run(clientId, name);
  }

  async listClientLabels(): Promise<ClientLabel[]> {
    this.ensureInitialized();
    return this.db!.prepare('SELECT * FROM client_labels').all() as ClientLabel[];
  }

  async deleteClientLabel(clientId: string): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare('DELETE FROM client_labels WHERE client_id = ?').run(clientId);
  }

  /** Distinct client ids known to the DB (overrides ∪ splinters ∪ labels). */
  async listKnownClientIds(): Promise<string[]> {
    this.ensureInitialized();
    const rows = this.db!.prepare(
      `SELECT client_id FROM client_mounts
       UNION SELECT client_id FROM client_splinters
       UNION SELECT client_id FROM client_labels`
    ).all() as { client_id: string }[];
    return rows.map((r) => r.client_id);
  }

  /**
   * Close database connection.
   */
  async close(): Promise<void> {
    if (!this.db) return;
    this.db.close();
    this.initialized = false;
    this.db = null;
  }

  /**
   * Check if database is initialized.
   */
  // --- Catalog: Card Definitions (Bitsby8) ---

  async upsertCardDefinition(rec: Omit<CardDefinitionRecord, 'created_at'>): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare(
      `INSERT INTO card_definitions (id, name, version, digest, type, maker, summary, manifest, entry, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         digest = excluded.digest, type = excluded.type, maker = excluded.maker,
         summary = excluded.summary, manifest = excluded.manifest,
         entry = excluded.entry, source = excluded.source`
    ).run(
      rec.id, rec.name, rec.version, rec.digest, rec.type,
      rec.maker, rec.summary, rec.manifest, rec.entry, rec.source
    );
  }

  async getCardDefinitionById(id: string): Promise<CardDefinitionRecord | undefined> {
    this.ensureInitialized();
    return this.db!.prepare('SELECT * FROM card_definitions WHERE id = ?').get(id) as
      | CardDefinitionRecord
      | undefined;
  }

  async listCardDefinitions(): Promise<CardDefinitionRecord[]> {
    this.ensureInitialized();
    return this.db!.prepare(
      'SELECT * FROM card_definitions ORDER BY type, name, version'
    ).all() as CardDefinitionRecord[];
  }

  async deleteCardDefinition(id: string): Promise<boolean> {
    this.ensureInitialized();
    return this.db!.prepare('DELETE FROM card_definitions WHERE id = ?').run(id).changes > 0;
  }

  // --- Machine Instances (Bitsby8) ---

  async upsertMachineInstance(rec: Omit<MachineInstanceRecord, 'created_at'>): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare(
      `INSERT INTO machine_instances (id, profile_ref, client_id, cpu_kind, status, created_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         profile_ref = excluded.profile_ref, client_id = excluded.client_id,
         cpu_kind = excluded.cpu_kind, status = excluded.status`
    ).run(rec.id, rec.profile_ref, rec.client_id, rec.cpu_kind, rec.status);
  }

  async setMachineInstanceStatus(id: string, status: string): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare('UPDATE machine_instances SET status = ? WHERE id = ?').run(status, id);
  }

  async getMachineInstance(id: string): Promise<MachineInstanceRecord | undefined> {
    this.ensureInitialized();
    return this.db!.prepare('SELECT * FROM machine_instances WHERE id = ?').get(id) as
      | MachineInstanceRecord
      | undefined;
  }

  async listMachineInstances(): Promise<MachineInstanceRecord[]> {
    this.ensureInitialized();
    return this.db!.prepare('SELECT * FROM machine_instances ORDER BY created_at DESC').all() as
      MachineInstanceRecord[];
  }

  async deleteMachineInstance(id: string): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare('DELETE FROM machine_instances WHERE id = ?').run(id);
  }

  // --- Machine Profiles (Bitsby8) ---

  async insertMachineProfile(rec: Omit<MachineProfileRecord, 'created_at'>): Promise<void> {
    this.ensureInitialized();
    // Versions are immutable — a colliding (name, version) is a conflict, not an upsert.
    this.db!.prepare(
      `INSERT INTO machine_profiles (id, name, version, digest, cpu_kind, profile, notes, panel_base, uppercase_input, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).run(rec.id, rec.name, rec.version, rec.digest, rec.cpu_kind, rec.profile, rec.notes, rec.panel_base, rec.uppercase_input, rec.source);
  }

  async getMachineProfileById(id: string): Promise<MachineProfileRecord | undefined> {
    this.ensureInitialized();
    return this.db!.prepare('SELECT * FROM machine_profiles WHERE id = ?').get(id) as
      | MachineProfileRecord
      | undefined;
  }

  /** Edit a profile row in place (digest/content/cpu/notes), keeping its id +
   * version. Used only for preset templates, which are living, not versioned. */
  async updateMachineProfileContent(
    id: string,
    fields: { digest: string; cpu_kind: string; profile: string; notes: string | null; panel_base: string; uppercase_input: number },
  ): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare(
      'UPDATE machine_profiles SET digest = ?, cpu_kind = ?, profile = ?, notes = ?, panel_base = ?, uppercase_input = ? WHERE id = ?'
    ).run(fields.digest, fields.cpu_kind, fields.profile, fields.notes, fields.panel_base, fields.uppercase_input, id);
  }

  /** All versions of a profile name, newest-created first. `rowid` is a
   * monotonic tiebreaker for versions inserted within the same clock second. */
  async listMachineProfileVersions(name: string): Promise<MachineProfileRecord[]> {
    this.ensureInitialized();
    return this.db!.prepare(
      'SELECT * FROM machine_profiles WHERE name = ? ORDER BY created_at DESC, rowid DESC'
    ).all(name) as MachineProfileRecord[];
  }

  async listMachineProfiles(): Promise<MachineProfileRecord[]> {
    this.ensureInitialized();
    return this.db!.prepare(
      'SELECT * FROM machine_profiles ORDER BY name, created_at DESC, rowid DESC'
    ).all() as MachineProfileRecord[];
  }

  async deleteMachineProfile(id: string): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare('DELETE FROM machine_profiles WHERE id = ?').run(id);
  }

  async deleteMachineProfilesByName(name: string): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare('DELETE FROM machine_profiles WHERE name = ?').run(name);
  }

  /**
   * Rename a profile in place across every version: re-keys `id` (name@version)
   * and the `name` column for all versions, preserving version rows, digests,
   * notes and created_at (history intact). Because the name is Identity, this
   * also migrates name-keyed startup disks and re-points anything storing a
   * `name@version` ref (running instances, snapshots) so nothing dangles. Runs
   * in one transaction. Caller must ensure `newName` is free of collisions.
   */
  async renameMachineProfile(oldName: string, newName: string): Promise<void> {
    this.ensureInitialized();
    const db = this.db!;
    // Exact-prefix match on `oldName@` — computed with substr, NOT LIKE, since
    // profile names may contain `_`/`%` which are LIKE wildcards.
    const oldPrefix = `${oldName}@`;
    const newPrefix = `${newName}@`;
    const plen = oldPrefix.length;
    db.transaction(() => {
      db.prepare(
        "UPDATE machine_profiles SET id = ? || '@' || version, name = ? WHERE name = ?"
      ).run(newName, newName, oldName);
      db.prepare('UPDATE profile_disks SET profile_name = ? WHERE profile_name = ?').run(newName, oldName);
      for (const table of ['machine_instances', 'instance_snapshots'] as const) {
        db.prepare(
          `UPDATE ${table} SET profile_ref = ? || substr(profile_ref, ?) WHERE substr(profile_ref, 1, ?) = ?`
        ).run(newPrefix, plen + 1, plen, oldPrefix);
      }
    })();
  }

  // --- Instance snapshots (Bitsby8) ---

  async insertInstanceSnapshot(rec: Omit<InstanceSnapshotRecord, 'created_at'>): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare(
      `INSERT INTO instance_snapshots (id, instance_id, profile_ref, label, disks, created_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).run(rec.id, rec.instance_id, rec.profile_ref, rec.label, rec.disks);
  }

  async getInstanceSnapshot(id: string): Promise<InstanceSnapshotRecord | undefined> {
    this.ensureInitialized();
    return this.db!.prepare('SELECT * FROM instance_snapshots WHERE id = ?').get(id) as
      | InstanceSnapshotRecord
      | undefined;
  }

  async listInstanceSnapshots(instanceId?: string): Promise<InstanceSnapshotRecord[]> {
    this.ensureInitialized();
    if (instanceId) {
      return this.db!.prepare(
        'SELECT * FROM instance_snapshots WHERE instance_id = ? ORDER BY created_at DESC, rowid DESC'
      ).all(instanceId) as InstanceSnapshotRecord[];
    }
    return this.db!.prepare(
      'SELECT * FROM instance_snapshots ORDER BY created_at DESC, rowid DESC'
    ).all() as InstanceSnapshotRecord[];
  }

  async deleteInstanceSnapshot(id: string): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare('DELETE FROM instance_snapshots WHERE id = ?').run(id);
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  private ensureInitialized(): void {
    if (!this.db || !this.initialized) {
      throw new Error('Database not initialized');
    }
  }
}

/**
 * Resolve the SQLite database path inside `dataDir`, self-healing a
 * legacy `fdcplus.db` to the current `bitsby8.db` name on first startup.
 *
 * The rename covers SQLite's WAL sidecars (`-wal`/`-shm`) so a legacy
 * daemon's in-flight WAL isn't orphaned. It fires only when the new file
 * is absent and the legacy one is present, so it's idempotent and a no-op
 * on fresh installs and post-migration boots. Keying off the file (not the
 * packaging) means every install shape — .deb, docker, source — migrates.
 */
export function resolveDbPath(dataDir: string): string {
  const target = path.join(dataDir, DB_FILENAME);
  const legacy = path.join(dataDir, LEGACY_DB_FILENAME);
  if (!existsSync(target) && existsSync(legacy)) {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        if (existsSync(legacy + suffix)) {
          renameSync(legacy + suffix, target + suffix);
        }
      } catch (err) {
        console.warn(
          `Could not migrate legacy database file ${legacy + suffix} → ${target + suffix}: ${(err as Error).message}`,
        );
      }
    }
    if (existsSync(target)) {
      console.log(`Migrated legacy database ${LEGACY_DB_FILENAME} → ${DB_FILENAME}`);
    }
  }
  return target;
}

// Singleton instance
let databaseInstance: Database | null = null;

/**
 * Get singleton database instance.
 */
export function getDatabase(dbPath?: string): Database {
  if (!databaseInstance && dbPath) {
    databaseInstance = new Database(dbPath);
  }
  if (!databaseInstance) {
    throw new Error('Database not initialized. Call getDatabase with dbPath first.');
  }
  return databaseInstance;
}
