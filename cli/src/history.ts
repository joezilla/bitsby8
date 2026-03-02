/**
 * Persistent command history for FDC+ CLI.
 * Stores history in ~/.fdcplus/history, one command per line.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const HISTORY_FILE = path.join(os.homedir(), '.fdcplus', 'history');
const MAX_ENTRIES = 500;

export class CommandHistory {
  private entries: string[] = [];
  private position = 0;

  /** Load history from disk. Returns gracefully if file is missing. */
  load(): void {
    try {
      const content = fs.readFileSync(HISTORY_FILE, 'utf-8');
      this.entries = content
        .split('\n')
        .filter((line) => line.length > 0);
      this.position = this.entries.length;
    } catch {
      // File doesn't exist or can't be read — start with empty history
      this.entries = [];
      this.position = 0;
    }
  }

  /** Save history to disk (max 500 most recent entries). Creates directory if needed. */
  save(): void {
    try {
      const dir = path.dirname(HISTORY_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const toSave = this.entries.slice(-MAX_ENTRIES);
      fs.writeFileSync(HISTORY_FILE, toSave.join('\n') + '\n', 'utf-8');
    } catch {
      // Silently ignore write errors
    }
  }

  /** Add an entry. Skips if it duplicates the last entry. Resets position. */
  add(line: string): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;

    // Skip duplicate of last entry
    if (this.entries.length > 0 && this.entries[this.entries.length - 1] === trimmed) {
      this.position = this.entries.length;
      return;
    }

    this.entries.push(trimmed);
    this.position = this.entries.length;
  }

  /** Navigate to previous history entry. Returns undefined if at the start. */
  prev(): string | undefined {
    if (this.position <= 0) return undefined;
    this.position--;
    return this.entries[this.position];
  }

  /** Navigate to next history entry. Returns empty string at end. */
  next(): string | undefined {
    if (this.position >= this.entries.length) return undefined;
    this.position++;
    if (this.position >= this.entries.length) {
      return '';
    }
    return this.entries[this.position];
  }

  /** Reset position to end of history. */
  reset(): void {
    this.position = this.entries.length;
  }
}
