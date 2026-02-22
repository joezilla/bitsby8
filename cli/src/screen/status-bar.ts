/**
 * Status bar renderer for FDC+ CLI.
 * Displays drive mounts, connection indicators, and time/progress.
 */

import { ScreenRenderer, eraseEntireLine } from './renderer';
import { ServerStatus, TerminalStatus, ReplayProgress } from '../types/index';
import chalk from 'chalk';

export class StatusBar {
  private readonly renderer: ScreenRenderer;

  constructor(renderer: ScreenRenderer) {
    this.renderer = renderer;
  }

  /**
   * Render the full status bar at the status bar row.
   * Shows drive indicators, connection status, and time or replay progress.
   */
  render(status: ServerStatus, terminalStatus: TerminalStatus, replay?: ReplayProgress): void {
    this.renderer.saveCursor();
    this.renderer.positionAtStatusBar();
    this.renderer.write(eraseEntireLine());

    const drives = this.formatDrives(status);
    const connections = this.formatConnections(status, terminalStatus);
    const left = ` ${drives}  ${connections}`;

    let right: string;
    let rightLen: number;
    if (replay && replay.state === 'running') {
      right = this.formatReplayProgress(replay);
      rightLen = this.stripAnsi(right).length;
    } else {
      right = this.formatTime();
      rightLen = right.length;
    }

    const leftLen = this.stripAnsi(left).length;
    const gap = Math.max(1, this.renderer.cols - leftLen - rightLen);
    const line = left + ' '.repeat(gap) + right;

    // Render in inverse video
    this.renderer.write(`\x1b[7m${line}\x1b[0m`);
    this.renderer.restoreCursor();
  }

  /** Render a disconnected status bar. */
  renderDisconnected(url: string): void {
    this.renderer.saveCursor();
    this.renderer.positionAtStatusBar();
    this.renderer.write(eraseEntireLine());

    const text = ` ${chalk.dim('\u25CC')} Disconnected from ${url}`;
    const padded = this.padToWidth(text);
    this.renderer.write(`\x1b[7m${padded}\x1b[0m`);
    this.renderer.restoreCursor();
  }

  /** Format drive indicators: "A:name(RO) B:name C:-- D:--" */
  private formatDrives(status: ServerStatus): string {
    const labels = ['A', 'B', 'C', 'D'];
    const parts: string[] = [];

    for (let i = 0; i < 4; i++) {
      const label = labels[i];
      const drive = status.drives[i];
      if (drive && drive.mounted && drive.filename) {
        // Strip extension for brevity
        const name = drive.filename.replace(/\.[^.]+$/, '');
        const truncated = name.length > 8 ? name.substring(0, 8) : name;
        if (drive.readonly) {
          parts.push(`${label}:${truncated}${chalk.yellow('(RO)')}`);
        } else {
          parts.push(`${label}:${truncated}`);
        }
      } else {
        parts.push(`${label}:${chalk.dim('\u2014\u2014')}`);
      }
    }

    return parts.join(' ');
  }

  /** Format connection indicators for serial and terminal. */
  private formatConnections(status: ServerStatus, terminalStatus: TerminalStatus): string {
    const serIcon = status.serial.connected
      ? chalk.green('\u25CF') + 'Ser'
      : chalk.dim('\u25CC') + chalk.dim('Ser');

    const termIcon = terminalStatus.connected
      ? chalk.green('\u25CF') + 'Term'
      : chalk.dim('\u25CC') + chalk.dim('Term');

    return `${serIcon} ${termIcon}`;
  }

  /** Format current time as HH:MM:SS. */
  private formatTime(): string {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss} `;
  }

  /** Format replay progress bar: "file [||||__] 62%" */
  private formatReplayProgress(replay: ReplayProgress): string {
    const pct = Math.round(replay.percentComplete);
    const name = replay.fileName.length > 12
      ? replay.fileName.substring(0, 12)
      : replay.fileName;

    const barWidth = 10;
    const filled = Math.round(barWidth * pct / 100);
    const empty = barWidth - filled;
    const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);

    return `${chalk.green('\u25B6')}${name} [${bar}] ${pct}% `;
  }

  /** Strip ANSI escape sequences to get visible character count. */
  private stripAnsi(str: string): string {
    // eslint-disable-next-line no-control-regex
    return str.replace(/\x1b\[[0-9;]*m/g, '');
  }

  /** Pad a string (accounting for ANSI codes) to fill terminal width. */
  private padToWidth(str: string): string {
    const visible = this.stripAnsi(str).length;
    const padding = Math.max(0, this.renderer.cols - visible);
    return str + ' '.repeat(padding);
  }
}
