/**
 * Terminal passthrough area for Altair serial data.
 * Writes raw byte data and command output within the scroll region.
 *
 * CURSOR MODEL: The cursor "lives" inside the scroll region at all times.
 * Terminal data is written directly at the current cursor position — the
 * Altair's own CR/LF/VT100 sequences handle movement. Status bar and input
 * line save/restore cursor when they temporarily leave the scroll region.
 */

import { ScreenRenderer, CSI, cursorTo, eraseEntireLine } from './renderer';
import chalk from 'chalk';

export class TerminalArea {
  private readonly renderer: ScreenRenderer;

  constructor(renderer: ScreenRenderer) {
    this.renderer = renderer;
  }

  /**
   * Write raw bytes from Altair serial data to the terminal area.
   * Writes directly at the current cursor position — no repositioning.
   * The Altair's CR/LF and VT100 escape sequences handle cursor movement.
   */
  write(data: number[]): void {
    const buf = Buffer.from(data);
    process.stdout.write(buf);
  }

  /**
   * Write command output with separator lines into the terminal area.
   * Writes at the current cursor position within the scroll region.
   */
  writeCommandOutput(command: string, lines: string[]): void {
    // Opening separator
    const separator = this.buildSeparator(command);
    this.renderer.write(`\r\n${chalk.dim(separator)}\r\n`);

    // Content lines
    for (const line of lines) {
      this.renderer.write(`${line}\r\n`);
    }

    // Closing separator
    const closingSep = chalk.dim('─'.repeat(Math.min(this.renderer.cols, 40)));
    this.renderer.write(`${closingSep}\r\n`);
  }

  /** Clear the terminal area and position cursor at the top of the scroll region. */
  clear(): void {
    const top = 2;
    const bottom = this.renderer.rows - 2;
    for (let row = top; row <= bottom; row++) {
      this.renderer.write(cursorTo(row, 1));
      this.renderer.write(eraseEntireLine());
    }
    // Leave cursor at top of scroll region
    this.renderer.write(`${CSI}${top};1H`);
  }

  /** Build a separator line like "─── /command ───" */
  private buildSeparator(command: string): string {
    const label = ` /${command} `;
    const dashCount = Math.max(0, Math.min(this.renderer.cols, 40) - label.length);
    const left = Math.floor(dashCount / 2);
    const right = dashCount - left;
    return '─'.repeat(left) + label + '─'.repeat(right);
  }
}
