/**
 * Database Module
 * Manages SQLite database for disk and cassette metadata (notes, descriptions)
 */

import sqlite3 from 'sqlite3';

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

export class Database {
  private db: sqlite3.Database | null = null;
  private dbPath: string;
  private initialized = false;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  /**
   * Initialize database and create tables if they don't exist
   */
  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
          return;
        }

        // Create tables
        this.createTables()
          .then(() => {
            this.initialized = true;
            console.log(`Database initialized at: ${this.dbPath}`);
            resolve();
          })
          .catch(reject);
      });
    });
  }

  /**
   * Create database tables
   */
  private async createTables(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const createDiskNotesTable = `
      CREATE TABLE IF NOT EXISTS disk_notes (
        filename TEXT PRIMARY KEY,
        description TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createCassetteNotesTable = `
      CREATE TABLE IF NOT EXISTS cassette_notes (
        filename TEXT PRIMARY KEY,
        description TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    return new Promise((resolve, reject) => {
      this.db!.serialize(() => {
        this.db!.run(createDiskNotesTable, (err) => {
          if (err) {
            reject(err);
            return;
          }

          this.db!.run(createCassetteNotesTable, (err) => {
            if (err) {
              reject(err);
              return;
            }
            resolve();
          });
        });
      });
    });
  }

  /**
   * Get disk note by filename
   */
  async getDiskNote(filename: string): Promise<DiskNote | null> {
    if (!this.db || !this.initialized) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      this.db!.get(
        'SELECT * FROM disk_notes WHERE filename = ?',
        [filename],
        (err, row: DiskNote | undefined) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(row || null);
        }
      );
    });
  }

  /**
   * Get cassette note by filename
   */
  async getCassetteNote(filename: string): Promise<CassetteNote | null> {
    if (!this.db || !this.initialized) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      this.db!.get(
        'SELECT * FROM cassette_notes WHERE filename = ?',
        [filename],
        (err, row: CassetteNote | undefined) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(row || null);
        }
      );
    });
  }

  /**
   * Get all disk notes
   */
  async getAllDiskNotes(): Promise<Map<string, DiskNote>> {
    if (!this.db || !this.initialized) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      this.db!.all(
        'SELECT * FROM disk_notes',
        (err, rows: DiskNote[]) => {
          if (err) {
            reject(err);
            return;
          }
          const map = new Map<string, DiskNote>();
          rows.forEach((row) => {
            map.set(row.filename, row);
          });
          resolve(map);
        }
      );
    });
  }

  /**
   * Get all cassette notes
   */
  async getAllCassetteNotes(): Promise<Map<string, CassetteNote>> {
    if (!this.db || !this.initialized) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      this.db!.all(
        'SELECT * FROM cassette_notes',
        (err, rows: CassetteNote[]) => {
          if (err) {
            reject(err);
            return;
          }
          const map = new Map<string, CassetteNote>();
          rows.forEach((row) => {
            map.set(row.filename, row);
          });
          resolve(map);
        }
      );
    });
  }

  /**
   * Update or insert disk note
   */
  async upsertDiskNote(filename: string, description: string, notes: string): Promise<void> {
    if (!this.db || !this.initialized) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      this.db!.run(
        `INSERT INTO disk_notes (filename, description, notes, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(filename) DO UPDATE SET
           description = excluded.description,
           notes = excluded.notes,
           updated_at = CURRENT_TIMESTAMP`,
        [filename, description, notes],
        (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        }
      );
    });
  }

  /**
   * Update or insert cassette note
   */
  async upsertCassetteNote(filename: string, description: string, notes: string): Promise<void> {
    if (!this.db || !this.initialized) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      this.db!.run(
        `INSERT INTO cassette_notes (filename, description, notes, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(filename) DO UPDATE SET
           description = excluded.description,
           notes = excluded.notes,
           updated_at = CURRENT_TIMESTAMP`,
        [filename, description, notes],
        (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        }
      );
    });
  }

  /**
   * Delete disk note
   */
  async deleteDiskNote(filename: string): Promise<void> {
    if (!this.db || !this.initialized) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      this.db!.run(
        'DELETE FROM disk_notes WHERE filename = ?',
        [filename],
        (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        }
      );
    });
  }

  /**
   * Delete cassette note
   */
  async deleteCassetteNote(filename: string): Promise<void> {
    if (!this.db || !this.initialized) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      this.db!.run(
        'DELETE FROM cassette_notes WHERE filename = ?',
        [filename],
        (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        }
      );
    });
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (!this.db) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.db!.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        this.initialized = false;
        this.db = null;
        resolve();
      });
    });
  }

  /**
   * Check if database is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// Singleton instance
let databaseInstance: Database | null = null;

/**
 * Get singleton database instance
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
