/**
 * Database service for FDC+ Web
 * Manages SQLite database for disk metadata, configuration overrides, and startup mounts
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

// Database types
export interface DiskMetadata {
  filename: string;
  description: string;
  size: number;
  uploadDate: string;
  checksum?: string;
}

export interface StartupMount {
  driveId: number; // 0-3
  diskFilename: string | null;
  readonly: boolean;
}

export interface ConfigOverride {
  key: string;
  value: string;
  type: 'string' | 'number' | 'boolean' | 'json';
}

/**
 * Database service singleton
 */
export class DatabaseService {
  private static instance: DatabaseService;
  private db: Database.Database;
  private dbPath: string;

  private constructor(dbPath?: string) {
    // Default database location
    this.dbPath = dbPath || join(process.cwd(), '.fdcplus.db');

    // Ensure directory exists
    const dbDir = join(this.dbPath, '..');
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    // Open database
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL'); // Write-Ahead Logging for better concurrency
    this.db.pragma('foreign_keys = ON'); // Enable foreign key constraints

    // Initialize schema
    this.initializeSchema();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(dbPath?: string): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService(dbPath);
    }
    return DatabaseService.instance;
  }

  /**
   * Reset singleton instance (for testing only)
   */
  public static resetInstance(): void {
    if (DatabaseService.instance) {
      try {
        DatabaseService.instance.close();
      } catch (e) {
        // Ignore close errors
      }
      DatabaseService.instance = null as any;
    }
  }

  /**
   * Initialize database schema
   */
  private initializeSchema(): void {
    // Create tables
    this.db.exec(`
      -- Disk metadata table
      CREATE TABLE IF NOT EXISTS disk_metadata (
        filename TEXT PRIMARY KEY,
        description TEXT NOT NULL DEFAULT '',
        size INTEGER NOT NULL,
        upload_date TEXT NOT NULL,
        checksum TEXT
      );

      -- Startup mounts table
      CREATE TABLE IF NOT EXISTS startup_mounts (
        drive_id INTEGER PRIMARY KEY CHECK(drive_id >= 0 AND drive_id <= 3),
        disk_filename TEXT,
        readonly INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (disk_filename) REFERENCES disk_metadata(filename) ON DELETE SET NULL
      );

      -- Initialize all 4 drives if not exists
      INSERT OR IGNORE INTO startup_mounts (drive_id, disk_filename, readonly)
      VALUES (0, NULL, 0), (1, NULL, 0), (2, NULL, 0), (3, NULL, 0);

      -- Configuration overrides table
      CREATE TABLE IF NOT EXISTS config_overrides (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('string', 'number', 'boolean', 'json'))
      );

      -- Create indexes for performance
      CREATE INDEX IF NOT EXISTS idx_disk_upload_date ON disk_metadata(upload_date DESC);
      CREATE INDEX IF NOT EXISTS idx_config_key ON config_overrides(key);
    `);
  }

  // ==================== Disk Metadata Operations ====================

  /**
   * Add or update disk metadata
   */
  public upsertDiskMetadata(metadata: DiskMetadata): void {
    const stmt = this.db.prepare(`
      INSERT INTO disk_metadata (filename, description, size, upload_date, checksum)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(filename) DO UPDATE SET
        description = excluded.description,
        size = excluded.size,
        upload_date = excluded.upload_date,
        checksum = excluded.checksum
    `);

    stmt.run(
      metadata.filename,
      metadata.description,
      metadata.size,
      metadata.uploadDate,
      metadata.checksum || null
    );
  }

  /**
   * Get disk metadata by filename
   */
  public getDiskMetadata(filename: string): DiskMetadata | null {
    const stmt = this.db.prepare('SELECT * FROM disk_metadata WHERE filename = ?');
    const row = stmt.get(filename) as any;

    if (!row) return null;

    return {
      filename: row.filename,
      description: row.description,
      size: row.size,
      uploadDate: row.upload_date,
      checksum: row.checksum || undefined
    };
  }

  /**
   * Get all disk metadata
   */
  public getAllDiskMetadata(): DiskMetadata[] {
    const stmt = this.db.prepare('SELECT * FROM disk_metadata ORDER BY upload_date DESC');
    const rows = stmt.all() as any[];

    return rows.map(row => ({
      filename: row.filename,
      description: row.description,
      size: row.size,
      uploadDate: row.upload_date,
      checksum: row.checksum || undefined
    }));
  }

  /**
   * Update disk description
   */
  public updateDiskDescription(filename: string, description: string): boolean {
    const stmt = this.db.prepare('UPDATE disk_metadata SET description = ? WHERE filename = ?');
    const result = stmt.run(description, filename);
    return result.changes > 0;
  }

  /**
   * Delete disk metadata
   */
  public deleteDiskMetadata(filename: string): boolean {
    const stmt = this.db.prepare('DELETE FROM disk_metadata WHERE filename = ?');
    const result = stmt.run(filename);
    return result.changes > 0;
  }

  // ==================== Startup Mounts Operations ====================

  /**
   * Set startup mount for a drive
   */
  public setStartupMount(driveId: number, diskFilename: string | null, readonly: boolean = false): void {
    if (driveId < 0 || driveId > 3) {
      throw new Error(`Invalid drive ID: ${driveId}. Must be 0-3.`);
    }

    const stmt = this.db.prepare(`
      UPDATE startup_mounts
      SET disk_filename = ?, readonly = ?
      WHERE drive_id = ?
    `);

    stmt.run(diskFilename, readonly ? 1 : 0, driveId);
  }

  /**
   * Get startup mount for a drive
   */
  public getStartupMount(driveId: number): StartupMount | null {
    if (driveId < 0 || driveId > 3) {
      throw new Error(`Invalid drive ID: ${driveId}. Must be 0-3.`);
    }

    const stmt = this.db.prepare('SELECT * FROM startup_mounts WHERE drive_id = ?');
    const row = stmt.get(driveId) as any;

    if (!row) return null;

    return {
      driveId: row.drive_id,
      diskFilename: row.disk_filename,
      readonly: row.readonly === 1
    };
  }

  /**
   * Get all startup mounts
   */
  public getAllStartupMounts(): StartupMount[] {
    const stmt = this.db.prepare('SELECT * FROM startup_mounts ORDER BY drive_id');
    const rows = stmt.all() as any[];

    return rows.map(row => ({
      driveId: row.drive_id,
      diskFilename: row.disk_filename,
      readonly: row.readonly === 1
    }));
  }

  /**
   * Clear startup mount for a drive
   */
  public clearStartupMount(driveId: number): void {
    this.setStartupMount(driveId, null, false);
  }

  /**
   * Clear all startup mounts
   */
  public clearAllStartupMounts(): void {
    this.db.prepare('UPDATE startup_mounts SET disk_filename = NULL, readonly = 0').run();
  }

  // ==================== Configuration Overrides Operations ====================

  /**
   * Set configuration override
   */
  public setConfigOverride(key: string, value: any, type: ConfigOverride['type']): void {
    const valueStr = type === 'json' ? JSON.stringify(value) : String(value);

    const stmt = this.db.prepare(`
      INSERT INTO config_overrides (key, value, type)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        type = excluded.type
    `);

    stmt.run(key, valueStr, type);
  }

  /**
   * Get configuration override
   */
  public getConfigOverride(key: string): any {
    const stmt = this.db.prepare('SELECT * FROM config_overrides WHERE key = ?');
    const row = stmt.get(key) as any;

    if (!row) return undefined;

    // Parse value based on type
    switch (row.type) {
      case 'number':
        return parseFloat(row.value);
      case 'boolean':
        return row.value === 'true';
      case 'json':
        return JSON.parse(row.value);
      case 'string':
      default:
        return row.value;
    }
  }

  /**
   * Get all configuration overrides
   */
  public getAllConfigOverrides(): Record<string, any> {
    const stmt = this.db.prepare('SELECT * FROM config_overrides');
    const rows = stmt.all() as any[];

    const config: Record<string, any> = {};

    for (const row of rows) {
      switch (row.type) {
        case 'number':
          config[row.key] = parseFloat(row.value);
          break;
        case 'boolean':
          config[row.key] = row.value === 'true';
          break;
        case 'json':
          config[row.key] = JSON.parse(row.value);
          break;
        case 'string':
        default:
          config[row.key] = row.value;
      }
    }

    return config;
  }

  /**
   * Delete configuration override
   */
  public deleteConfigOverride(key: string): boolean {
    const stmt = this.db.prepare('DELETE FROM config_overrides WHERE key = ?');
    const result = stmt.run(key);
    return result.changes > 0;
  }

  /**
   * Clear all configuration overrides
   */
  public clearAllConfigOverrides(): void {
    this.db.prepare('DELETE FROM config_overrides').run();
  }

  // ==================== Utility Operations ====================

  /**
   * Check if a disk is referenced by any startup mount
   */
  public isDiskInUse(filename: string): boolean {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM startup_mounts WHERE disk_filename = ?');
    const result = stmt.get(filename) as any;
    return result.count > 0;
  }

  /**
   * Close database connection
   */
  public close(): void {
    this.db.close();
  }

  /**
   * Get database path
   */
  public getDbPath(): string {
    return this.dbPath;
  }

  /**
   * Execute a transaction
   */
  public transaction<T>(fn: () => T): T {
    const txn = this.db.transaction(fn);
    return txn();
  }
}

// Export singleton instance getter
export const getDatabase = (dbPath?: string): DatabaseService => {
  return DatabaseService.getInstance(dbPath);
};
