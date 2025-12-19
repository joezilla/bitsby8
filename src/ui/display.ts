/**
 * Terminal UI Display Module
 * Uses blessed library for ncurses-like terminal UI
 */

import blessed from 'blessed';
import { FDCSDS_NAME, FDCSDS_COPYRIGHT, FDCSDS_VERSION } from '../protocol';

/**
 * Display Manager for terminal UI
 */
export class DisplayManager {
  private screen: blessed.Widgets.Screen | null;
  private statusBoxes: Map<string, blessed.Widgets.BoxElement>;

  constructor() {
    this.screen = null;
    this.statusBoxes = new Map();
  }

  /**
   * Initialize the display
   */
  init(): void {
    // Create screen
    this.screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
    });

    this.screen.title = 'FDC+ Serial Drive Server';

    // Title line (row 0)
    const title = blessed.box({
      top: 0,
      left: 0,
      width: 50,
      height: 1,
      content: `${FDCSDS_NAME} v${FDCSDS_VERSION}`,
      tags: true,
      style: {
        fg: 'white',
        bold: true,
      },
    });
    this.screen.append(title);

    // Copyright (row 0, right side)
    const copyright = blessed.box({
      top: 0,
      right: 0,
      width: 30,
      height: 1,
      content: FDCSDS_COPYRIGHT,
      tags: true,
      style: {
        fg: 'white',
      },
    });
    this.screen.append(copyright);
    this.createStatusScreen();

    // Help line (bottom row)
    const help = blessed.box({
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      content: '[C] Clear Errors | [Q] Quit | [V] Verbose | Configure via web UI',
      tags: true,
      style: {
        fg: 'yellow',
      },
    });
    this.screen.append(help);
    this.statusBoxes.set('help', help);

    // Setup keyboard handlers
    this.screen.key(['q', 'Q'], () => {
      this.reset();
      process.exit(0);
    });

    this.screen.key(['c', 'C'], () => {
      this.clearError();
    });

    this.render();
    this.screen.render();
  }

  /**
   * Reset display (restore terminal)
   */
  reset(): void {
    if (this.screen) {
      this.screen.destroy();
      this.screen = null;
    }
  }

  /**
   * Get keyboard input (non-blocking)
   */
  getKey(): string | null {
    // Handled by blessed event system
    return null;
  }

  /**
   * Display port info
   */
  displayPort(portPath: string): void {
    const box = this.statusBoxes.get('port');
    if (box) {
      const basename = portPath.split('/').pop() || portPath;
      box.setContent(`PORT: ${basename.substring(0, 20)}`);
      this.render();
    }
  }

  /**
   * Display baud rate
   */
  displayBaud(baud: number): void {
    const box = this.statusBoxes.get('baud');
    if (box) {
      box.setContent(`BAUD RATE: ${baud}`);
      this.render();
    }
  }

  /**
   * Display current command
   */
  displayCommand(cmd: string): void {
    const box = this.statusBoxes.get('command');
    if (box) {
      box.setContent(`COMMAND: ${cmd.substring(0, 4)}`);
      this.render();
    }
  }

  /**
   * Display block information (drive, track, length)
   */
  displayBlock(drive: number, track: number, length: number): void {
    const box = this.statusBoxes.get('block');
    if (box) {
      const driveStr = drive >= 0 && drive <= 0xff ? `D:${drive.toString(16).padStart(2, '0').toUpperCase()}` : 'D:--';
      const trackStr = track !== -1 ? `T:${track.toString().padStart(4, '0')}` : 'T:----';
      const lengthStr = length !== -1 ? `L:${length.toString().padStart(4, '0')}` : 'L:----';
      box.setContent(`${driveStr} ${trackStr} ${lengthStr}`);
      this.render();
    }
  }

  /**
   * Display error message
   */
  displayError(message: string, errno?: NodeJS.ErrnoException): void {
    const box = this.statusBoxes.get('error');
    if (box) {
      let errorMsg = message;
      if (errno && errno.message) {
        errorMsg += ` (${errno.message})`;
      }
      box.setContent(`ERROR: ${errorMsg.substring(0, 60)}`);
      this.render();
    }
  }

  /**
   * Clear error message
   */
  clearError(): void {
    const box = this.statusBoxes.get('error');
    if (box) {
      box.setContent('ERROR: ');
      this.render();
    }
  }

  /**
   * Display debug message
   */
  displayDebug(message: string): void {
    const box = this.statusBoxes.get('debug');
    if (box) {
      box.setContent(message);
      this.render();
    }
  }

  /**
   * Display head status for a drive
   */
  displayHead(drive: number, headLoaded: boolean): void {
    if (drive < 0 || drive > 3) {
      return;
    }

    // Update all drive lines
    for (let d = 0; d < 4; d++) {
      const box = this.statusBoxes.get(`drive${d}`);
      if (box) {
        const content = box.getContent();
        // Update disk enable position (48)
        const enabled = d === drive ? '*' : '-';
        // Update head load position (61)
        const head = d === drive && headLoaded ? '*' : '-';

        const updated =
          content.substring(0, 48) +
          enabled +
          content.substring(49, 61) +
          head +
          content.substring(62);

        box.setContent(updated);
      }
    }

    this.render();
  }

  /**
   * Display current track for a drive
   */
  displayTrack(drive: number, track: number): void {
    if (drive < 0 || drive > 3) {
      return;
    }

    const box = this.statusBoxes.get(`drive${drive}`);
    if (box) {
      const content = box.getContent();
      const trackStr = track.toString().padStart(4, '0');
      // Update track position (70-73)
      const updated = content.substring(0, 70) + trackStr + content.substring(74);
      box.setContent(updated);
      this.render();
    }
  }

  /**
   * Display mounted disk file for a drive
   */
  displayMount(drive: number, filename: string | null): void {
    if (drive < 0 || drive > 3) {
      return;
    }

    const box = this.statusBoxes.get(`drive${drive}`);
    if (box) {
      const content = box.getContent();
      const displayName = filename ? filename.substring(0, 25).padEnd(25, ' ') : ''.padEnd(25, ' ');
      // Update filename position (8-32)
      const updated = content.substring(0, 8) + displayName + content.substring(33);
      box.setContent(updated);
      this.render();
    }
  }

  /**
   * Display read-only status for a drive
   */
  displayRO(drive: number, readonly: boolean): void {
    if (drive < 0 || drive > 3) {
      return;
    }

    const box = this.statusBoxes.get(`drive${drive}`);
    if (box) {
      const content = box.getContent();
      const ro = readonly ? '*' : '-';
      // Update RO position (79)
      const updated = content.substring(0, 79) + ro;
      box.setContent(updated);
      this.render();
    }
  }

  /**
   * Display buffer contents (hex dump)
   */
  displayBuffer(label: string, buffer: Buffer, length: number): void {
    if (!length) {
      return;
    }

    const box = this.statusBoxes.get('buffer');
    if (!box) {
      return;
    }

    const lines: string[] = [];
    const maxLen = Math.min(length, 160);

    for (let i = 0; i < maxLen; i += 16) {
      const offset = i.toString(16).padStart(4, '0').toUpperCase();
      let hexPart = '';
      let asciiPart = '';

      for (let j = 0; j < 16 && i + j < maxLen; j++) {
        const byte = buffer[i + j];
        hexPart += byte.toString(16).padStart(2, '0').toUpperCase() + ' ';
        asciiPart += byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.';
      }

      lines.push(`${offset}: ${hexPart.padEnd(48, ' ')} ${asciiPart}`);
    }

    lines.push('');
    lines.push(label);

    box.setContent(lines.join('\n'));
    this.render();
  }

  /**
   * Render the screen
   */
  private render(): void {
    if (this.screen) {
      this.screen.render();
    }
  }

  /**
   * Build the status view and its boxes
   */
  private createStatusScreen(): void {
    if (!this.screen) {
      return;
    }
    const container = blessed.box({
      top: 2,
      left: 0,
      width: '100%',
      height: '100%-3',
      tags: true,
    });
    this.screen.append(container);

    // Port info (row 0 relative)
    const port = blessed.box({
      parent: container,
      top: 0,
      left: 0,
      width: 27,
      height: 1,
      content: 'PORT: ',
      tags: true,
      style: {
        fg: 'white',
      },
    });
    this.statusBoxes.set('port', port);

    // Baud rate (row 0)
    const baud = blessed.box({
      parent: container,
      top: 0,
      left: 27,
      width: 20,
      height: 1,
      content: 'BAUD RATE: ',
      tags: true,
      style: {
        fg: 'white',
      },
    });
    this.statusBoxes.set('baud', baud);

    // Command (row 0)
    const command = blessed.box({
      parent: container,
      top: 0,
      left: 47,
      width: 18,
      height: 1,
      content: 'COMMAND: ',
      tags: true,
      style: {
        fg: 'white',
      },
    });
    this.statusBoxes.set('command', command);

    // Block info (row 0, right side)
    const block = blessed.box({
      parent: container,
      top: 0,
      left: 65,
      width: 15,
      height: 1,
      content: '',
      tags: true,
      style: {
        fg: 'white',
      },
    });
    this.statusBoxes.set('block', block);

    // Drive status lines (rows 2-5)
    for (let d = 0; d < 4; d++) {
      const drive = blessed.box({
        parent: container,
        top: 2 + d,
        left: 0,
        width: 80,
        height: 1,
        content: `Disk ${d}                              Disk Enable -  Head Load -  Track ----  RO -`,
        tags: true,
        style: {
          fg: 'white',
        },
      });
      this.statusBoxes.set(`drive${d}`, drive);
    }

    // Error display (row 7)
    const error = blessed.box({
      parent: container,
      top: 7,
      left: 0,
      width: 80,
      height: 1,
      content: 'ERROR: ',
      tags: true,
      style: {
        fg: 'red',
      },
    });
    this.statusBoxes.set('error', error);

    // Debug display (row 8)
    const debug = blessed.box({
      parent: container,
      top: 8,
      left: 0,
      width: 80,
      height: 1,
      content: '',
      tags: true,
      style: {
        fg: 'cyan',
      },
    });
    this.statusBoxes.set('debug', debug);

    // Buffer display area (rows 10-20)
    const buffer = blessed.box({
      parent: container,
      top: 10,
      left: 0,
      width: 80,
      height: 11,
      content: '',
      tags: true,
      scrollable: false,
      style: {
        fg: 'white',
      },
    });
    this.statusBoxes.set('buffer', buffer);
  }

}

/**
 * Global display manager instance (singleton)
 */
let displayManagerInstance: DisplayManager | null = null;

export function getDisplayManager(): DisplayManager {
  if (!displayManagerInstance) {
    displayManagerInstance = new DisplayManager();
  }
  return displayManagerInstance;
}
