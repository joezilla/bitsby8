/**
 * Input line handler for FDC+ CLI.
 * Manages terminal and command input modes at the bottom of the screen.
 */

import chalk from 'chalk';
import { ScreenRenderer, cursorTo, eraseEntireLine, CSI } from './renderer';
import { InputMode } from '../types/index';

export interface InputLineCallbacks {
  onTerminalWrite(data: string): void;
  onCommand(line: string): void;
  onComplete(partial: string): string[];
  onHistoryPrev(): string | undefined;
  onHistoryNext(): string | undefined;
}

export class InputLine {
  mode: InputMode = 'terminal';
  buffer = '';
  cursorPos = 0;

  private readonly screen: ScreenRenderer;
  private readonly callbacks: InputLineCallbacks;
  private escBuffer = '';
  private escTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(screen: ScreenRenderer, callbacks: InputLineCallbacks) {
    this.screen = screen;
    this.callbacks = callbacks;
  }

  /** Process a keystroke from stdin. */
  handleKey(data: Buffer): void {
    if (this.mode === 'terminal') {
      this.handleTerminalKey(data);
    } else {
      this.handleCommandKey(data);
    }
  }

  /** Set input mode and re-render. */
  setMode(mode: InputMode): void {
    this.mode = mode;
    this.render();
  }

  /** Set buffer content (used by history navigation). */
  setBuffer(text: string): void {
    this.buffer = text;
    this.cursorPos = text.length;
    this.render();
  }

  /** Draw the input line at the bottom row. */
  render(): void {
    this.screen.saveCursor();
    this.screen.write(cursorTo(this.screen.rows, 1));
    this.screen.write(eraseEntireLine());

    if (this.mode === 'terminal') {
      this.screen.write(chalk.dim('> '));
      // Show cursor in terminal mode
      this.screen.write(`${CSI}?25h`);
    } else {
      this.screen.write(chalk.cyan('/ '));
      const before = this.buffer.slice(0, this.cursorPos);
      const cursorChar = this.buffer[this.cursorPos] || ' ';
      const after = this.buffer.slice(this.cursorPos + 1);
      this.screen.write(before);
      // Invert the cursor character
      this.screen.write(`${CSI}7m${cursorChar}${CSI}0m`);
      this.screen.write(after);
      // Hide real cursor in command mode (we draw our own)
      this.screen.write(`${CSI}?25l`);
    }

    this.screen.restoreCursor();
  }

  // --- Private ---

  private handleTerminalKey(data: Buffer): void {
    const byte = data[0];

    // "/" at start of empty buffer: switch to command mode
    if (byte === 0x2f && this.buffer === '') {
      this.buffer = '';
      this.cursorPos = 0;
      this.mode = 'command';
      this.render();
      return;
    }

    // Escape: switch to command mode
    if (byte === 0x1b && data.length === 1) {
      this.buffer = '';
      this.cursorPos = 0;
      this.mode = 'command';
      this.render();
      return;
    }

    // Ctrl+Q: quit
    if (byte === 0x11) {
      this.callbacks.onCommand('quit');
      return;
    }

    // Forward raw data to terminal
    this.callbacks.onTerminalWrite(data.toString('binary'));
  }

  private handleCommandKey(data: Buffer): void {
    const str = data.toString();

    // Check for escape sequences
    if (this.escBuffer.length > 0 || data[0] === 0x1b) {
      this.handleEscSequence(data);
      return;
    }

    const byte = data[0];

    // Enter: dispatch command
    if (byte === 0x0d) {
      const line = this.buffer;
      this.buffer = '';
      this.cursorPos = 0;
      this.mode = 'terminal';
      this.render();
      if (line.length > 0) {
        this.callbacks.onCommand(line);
      }
      return;
    }

    // Tab: completion
    if (byte === 0x09) {
      const completions = this.callbacks.onComplete(this.buffer);
      if (completions.length === 1) {
        this.buffer = completions[0] + ' ';
        this.cursorPos = this.buffer.length;
        this.render();
      }
      return;
    }

    // Backspace
    if (byte === 0x7f || byte === 0x08) {
      if (this.cursorPos > 0) {
        this.buffer =
          this.buffer.slice(0, this.cursorPos - 1) +
          this.buffer.slice(this.cursorPos);
        this.cursorPos--;
        this.render();
      }
      return;
    }

    // Printable characters
    if (byte >= 0x20 && byte < 0x7f) {
      this.buffer =
        this.buffer.slice(0, this.cursorPos) +
        str +
        this.buffer.slice(this.cursorPos);
      this.cursorPos += str.length;
      this.render();
    }
  }

  private handleEscSequence(data: Buffer): void {
    this.escBuffer += data.toString();

    // Clear any existing timeout
    if (this.escTimeout) {
      clearTimeout(this.escTimeout);
      this.escTimeout = null;
    }

    // Bare escape (no following chars after timeout)
    if (this.escBuffer === '\x1b') {
      this.escTimeout = setTimeout(() => {
        this.escBuffer = '';
        // Escape: return to terminal mode
        this.buffer = '';
        this.cursorPos = 0;
        this.mode = 'terminal';
        this.render();
      }, 50);
      return;
    }

    // CSI sequences: ESC [ <char>
    if (this.escBuffer.length >= 3 && this.escBuffer[1] === '[') {
      const code = this.escBuffer[2];
      this.escBuffer = '';

      switch (code) {
        case 'D': // Left arrow
          if (this.cursorPos > 0) {
            this.cursorPos--;
            this.render();
          }
          break;
        case 'C': // Right arrow
          if (this.cursorPos < this.buffer.length) {
            this.cursorPos++;
            this.render();
          }
          break;
        case 'H': // Home
          this.cursorPos = 0;
          this.render();
          break;
        case 'F': // End
          this.cursorPos = this.buffer.length;
          this.render();
          break;
        case 'A': { // Up arrow - history prev
          const prev = this.callbacks.onHistoryPrev();
          if (prev !== undefined) {
            this.setBuffer(prev);
          }
          break;
        }
        case 'B': { // Down arrow - history next
          const next = this.callbacks.onHistoryNext();
          if (next !== undefined) {
            this.setBuffer(next);
          }
          break;
        }
      }
      return;
    }

    // If we have ESC + something that isn't '[', discard
    if (this.escBuffer.length >= 2 && this.escBuffer[1] !== '[') {
      this.escBuffer = '';
    }
  }
}
