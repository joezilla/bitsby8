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
