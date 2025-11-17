"use strict";
/**
 * Terminal UI Display Module
 * Uses blessed library for ncurses-like terminal UI
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DisplayManager = void 0;
exports.getDisplayManager = getDisplayManager;
const blessed_1 = __importDefault(require("blessed"));
const protocol_1 = require("../protocol");
/**
 * Display Manager for terminal UI
 */
class DisplayManager {
    screen;
    boxes;
    constructor() {
        this.screen = null;
        this.boxes = new Map();
    }
    /**
     * Initialize the display
     */
    init() {
        // Create screen
        this.screen = blessed_1.default.screen({
            smartCSR: true,
            fullUnicode: true,
        });
        this.screen.title = 'FDC+ Serial Drive Server';
        // Title line (row 0)
        const title = blessed_1.default.box({
            top: 0,
            left: 0,
            width: 50,
            height: 1,
            content: `${protocol_1.FDCSDS_NAME} v${protocol_1.FDCSDS_VERSION}`,
            tags: true,
            style: {
                fg: 'white',
                bold: true,
            },
        });
        this.screen.append(title);
        this.boxes.set('title', title);
        // Copyright (row 0, right side)
        const copyright = blessed_1.default.box({
            top: 0,
            right: 0,
            width: 30,
            height: 1,
            content: protocol_1.FDCSDS_COPYRIGHT,
            tags: true,
            style: {
                fg: 'white',
            },
        });
        this.screen.append(copyright);
        this.boxes.set('copyright', copyright);
        // Port info (row 2)
        const port = blessed_1.default.box({
            top: 2,
            left: 0,
            width: 27,
            height: 1,
            content: 'PORT: ',
            tags: true,
            style: {
                fg: 'white',
            },
        });
        this.screen.append(port);
        this.boxes.set('port', port);
        // Baud rate (row 2)
        const baud = blessed_1.default.box({
            top: 2,
            left: 27,
            width: 20,
            height: 1,
            content: 'BAUD RATE: ',
            tags: true,
            style: {
                fg: 'white',
            },
        });
        this.screen.append(baud);
        this.boxes.set('baud', baud);
        // Command (row 2)
        const command = blessed_1.default.box({
            top: 2,
            left: 47,
            width: 18,
            height: 1,
            content: 'COMMAND: ',
            tags: true,
            style: {
                fg: 'white',
            },
        });
        this.screen.append(command);
        this.boxes.set('command', command);
        // Block info (row 2, right side)
        const block = blessed_1.default.box({
            top: 2,
            left: 65,
            width: 15,
            height: 1,
            content: '',
            tags: true,
            style: {
                fg: 'white',
            },
        });
        this.screen.append(block);
        this.boxes.set('block', block);
        // Drive status lines (rows 4-7)
        for (let d = 0; d < 4; d++) {
            const drive = blessed_1.default.box({
                top: 4 + d,
                left: 0,
                width: 80,
                height: 1,
                content: `Disk ${d}                              Disk Enable -  Head Load -  Track ----  RO -`,
                tags: true,
                style: {
                    fg: 'white',
                },
            });
            this.screen.append(drive);
            this.boxes.set(`drive${d}`, drive);
        }
        // Error display (row 9)
        const error = blessed_1.default.box({
            top: 9,
            left: 0,
            width: 80,
            height: 1,
            content: 'ERROR: ',
            tags: true,
            style: {
                fg: 'red',
            },
        });
        this.screen.append(error);
        this.boxes.set('error', error);
        // Debug display (row 10)
        const debug = blessed_1.default.box({
            top: 10,
            left: 0,
            width: 80,
            height: 1,
            content: '',
            tags: true,
            style: {
                fg: 'cyan',
            },
        });
        this.screen.append(debug);
        this.boxes.set('debug', debug);
        // Buffer display area (rows 11-21)
        const buffer = blessed_1.default.box({
            top: 11,
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
        this.screen.append(buffer);
        this.boxes.set('buffer', buffer);
        // Help line (bottom row)
        const help = blessed_1.default.box({
            bottom: 0,
            left: 0,
            width: '100%',
            height: 1,
            content: '[C] = Clear Error Message | [Q] = Quit Program | [V] = Verbose Toggle',
            tags: true,
            style: {
                fg: 'yellow',
            },
        });
        this.screen.append(help);
        this.boxes.set('help', help);
        // Setup keyboard handlers
        this.screen.key(['q', 'Q'], () => {
            this.reset();
            process.exit(0);
        });
        this.screen.key(['c', 'C'], () => {
            this.clearError();
        });
        this.screen.render();
    }
    /**
     * Reset display (restore terminal)
     */
    reset() {
        if (this.screen) {
            this.screen.destroy();
            this.screen = null;
        }
    }
    /**
     * Get keyboard input (non-blocking)
     */
    getKey() {
        // Handled by blessed event system
        return null;
    }
    /**
     * Display port info
     */
    displayPort(portPath) {
        const box = this.boxes.get('port');
        if (box) {
            const basename = portPath.split('/').pop() || portPath;
            box.setContent(`PORT: ${basename.substring(0, 20)}`);
            this.render();
        }
    }
    /**
     * Display baud rate
     */
    displayBaud(baud) {
        const box = this.boxes.get('baud');
        if (box) {
            box.setContent(`BAUD RATE: ${baud}`);
            this.render();
        }
    }
    /**
     * Display current command
     */
    displayCommand(cmd) {
        const box = this.boxes.get('command');
        if (box) {
            box.setContent(`COMMAND: ${cmd.substring(0, 4)}`);
            this.render();
        }
    }
    /**
     * Display block information (drive, track, length)
     */
    displayBlock(drive, track, length) {
        const box = this.boxes.get('block');
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
    displayError(message, errno) {
        const box = this.boxes.get('error');
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
    clearError() {
        const box = this.boxes.get('error');
        if (box) {
            box.setContent('ERROR: ');
            this.render();
        }
    }
    /**
     * Display debug message
     */
    displayDebug(message) {
        const box = this.boxes.get('debug');
        if (box) {
            box.setContent(message);
            this.render();
        }
    }
    /**
     * Display head status for a drive
     */
    displayHead(drive, headLoaded) {
        if (drive < 0 || drive > 3) {
            return;
        }
        // Update all drive lines
        for (let d = 0; d < 4; d++) {
            const box = this.boxes.get(`drive${d}`);
            if (box) {
                const content = box.getContent();
                // Update disk enable position (48)
                const enabled = d === drive ? '*' : '-';
                // Update head load position (61)
                const head = d === drive && headLoaded ? '*' : '-';
                const updated = content.substring(0, 48) +
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
    displayTrack(drive, track) {
        if (drive < 0 || drive > 3) {
            return;
        }
        const box = this.boxes.get(`drive${drive}`);
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
    displayMount(drive, filename) {
        if (drive < 0 || drive > 3) {
            return;
        }
        const box = this.boxes.get(`drive${drive}`);
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
    displayRO(drive, readonly) {
        if (drive < 0 || drive > 3) {
            return;
        }
        const box = this.boxes.get(`drive${drive}`);
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
    displayBuffer(label, buffer, length) {
        if (!length) {
            return;
        }
        const box = this.boxes.get('buffer');
        if (!box) {
            return;
        }
        const lines = [];
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
    render() {
        if (this.screen) {
            this.screen.render();
        }
    }
}
exports.DisplayManager = DisplayManager;
/**
 * Global display manager instance (singleton)
 */
let displayManagerInstance = null;
function getDisplayManager() {
    if (!displayManagerInstance) {
        displayManagerInstance = new DisplayManager();
    }
    return displayManagerInstance;
}
//# sourceMappingURL=display.js.map