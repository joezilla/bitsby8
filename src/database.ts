/**
 * Database Module
 * Manages SQLite database for disk and cassette metadata (notes, descriptions).
 *
 * Uses better-sqlite3 for synchronous, high-performance SQLite access.
 * Methods retain async signatures for backward compatibility with callers.
 */

import BetterSqlite3 from 'better-sqlite3';
import { chmodSync } from 'fs';

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

  isInitialized(): boolean {
    return this.initialized;
  }

  private ensureInitialized(): void {
    if (!this.db || !this.initialized) {
      throw new Error('Database not initialized');
    }
  }
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
