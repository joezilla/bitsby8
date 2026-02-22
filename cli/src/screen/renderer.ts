/**
 * Main screen layout manager for FDC+ CLI.
 * Manages alternate screen buffer, scroll regions, and cursor positioning.
 */

// ANSI escape sequence constants
export const ESC = '\x1b';
export const CSI = `${ESC}[`;

// ANSI helper functions
export function cursorTo(row: number, col: number): string {
  return `${CSI}${row};${col}H`;
}

export function eraseEntireLine(): string {
  return `${CSI}2K`;
}

export function eraseToEndOfLine(): string {
  return `${CSI}K`;
}

export class ScreenRenderer {
  rows: number;
  cols: number;
  readonly serverUrl: string;

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
    this.rows = process.stdout.rows || 24;
    this.cols = process.stdout.columns || 80;
  }

  /** Switch to alternate screen buffer, set scroll region, draw title bar, position cursor. */
  enterScreen(): void {
    // Switch to alternate screen buffer
    this.write(`${CSI}?1049h`);
    // Set scroll region: row 2 to (rows - 2) for the terminal area
    this.setScrollRegion(2, this.rows - 2);
    // Draw the title bar at row 1 (uses save/restore internally)
    this.drawTitleBar();
    // Position cursor at the top of the terminal area — this is where it "lives"
    this.write(cursorTo(2, 1));
    // Show cursor
    this.write(`${CSI}?25h`);
  }

  /** Restore scroll region, show cursor, leave alternate screen buffer. */
  leaveScreen(): void {
    // Reset scroll region to full screen
    this.setScrollRegion(1, this.rows);
    // Show cursor
    this.write(`${CSI}?25h`);
    // Leave alternate screen buffer
    this.write(`${CSI}?1049l`);
  }

  /** Set the terminal scroll region between top and bottom rows (1-indexed). */
  setScrollRegion(top: number, bottom: number): void {
    this.write(`${CSI}${top};${bottom}r`);
  }

  /**
   * Render "FDC+ Console" + server URL at row 1 in dim/inverse style.
   * Caller is responsible for save/restore cursor if needed.
   */
  drawTitleBar(): void {
    this.write(cursorTo(1, 1));
    this.write(eraseEntireLine());
    const title = `FDC+ Console`;
    const url = this.serverUrl;
    const text = ` ${title}  ${url} `;
    const padded = text.padEnd(this.cols);
    // ESC[2m = dim, ESC[7m = inverse, ESC[0m = reset
    this.write(`${CSI}2m${CSI}7m${padded}${CSI}0m`);
  }

  /** Handle terminal resize: recalculate dimensions, reset scroll region, redraw chrome. */
  onResize(): void {
    this.rows = process.stdout.rows || 24;
    this.cols = process.stdout.columns || 80;
    // Save cursor (in terminal area), reconfigure, restore
    this.saveCursor();
    this.setScrollRegion(2, this.rows - 2);
    this.drawTitleBar();
    this.restoreCursor();
  }

  /** Position cursor at the bottom of the scroll region for terminal output. */
  positionInTerminalArea(): void {
    this.write(cursorTo(this.rows - 2, 1));
  }

  /** Position cursor at the status bar row (rows - 1). */
  positionAtStatusBar(): void {
    this.write(cursorTo(this.rows - 1, 1));
  }

  /** Position cursor at the input line row (rows). */
  positionAtInputLine(): void {
    this.write(cursorTo(this.rows, 1));
  }

  /** Save cursor position. */
  saveCursor(): void {
    this.write(`${CSI}s`);
  }

  /** Restore cursor position. */
  restoreCursor(): void {
    this.write(`${CSI}u`);
  }

  /** Write raw data to stdout. */
  write(data: string): void {
    process.stdout.write(data);
  }
}
