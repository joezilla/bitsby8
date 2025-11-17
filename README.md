# FDC+ Serial Drive Server (TypeScript)

TypeScript port of the FDC+ Serial Drive Server - A Serial Disk Server compatible with the FDC+ Enhanced Floppy Disk Controller for the Altair 8800.

**Version:** 2.0.0
**Original C Version by:** Patrick Linstruth
**License:** GPL-3.0

---

## Overview

This is a complete TypeScript rewrite of the original C implementation. The TypeScript version provides:

- Modern async/await architecture
- Type-safe protocol implementation
- Better error handling
- Cross-platform support (Linux, macOS)
- Easier maintenance and extensibility

---

## Architecture

The codebase is organized into modular TypeScript components:

```
src/
├── index.ts          # Entry point with CLI parsing
├── server.ts         # Main server loop & command processing
├── drive.ts          # Drive management & disk I/O
├── serial.ts         # Serial port communication
├── protocol.ts       # FDC+ protocol definitions & types
└── ui/
    └── display.ts    # Terminal UI (blessed-based)
```

### Key Modules

- **protocol.ts**: Type definitions, constants, and protocol structures
- **drive.ts**: Async file operations using Node.js fs/promises
- **serial.ts**: Serial communication using the `serialport` package
- **display.ts**: Terminal UI using the `blessed` library
- **server.ts**: Command processing (STAT, READ, WRIT)
- **index.ts**: CLI argument parsing and initialization

---

## Installation

### Prerequisites

- **Node.js** 18+
- **npm** or **yarn**
- Serial port access permissions

### Install Dependencies

```bash
npm install
```

This will install:
- `serialport` - Serial port communication
- `blessed` - Terminal UI
- `commander` - CLI argument parsing
- `typescript` - TypeScript compiler

### Build

```bash
npm run build
```

This compiles the TypeScript source to JavaScript in the `dist/` directory.

### Global Installation (Optional)

```bash
npm install -g .
```

This installs `fdcsds` as a global command.

---

## Usage

### Basic Usage

```bash
# Development mode (ts-node)
npm run dev -- -p /dev/ttyUSB0 -0 disks/cpm22.dsk

# Production mode (compiled)
npm start -- -p /dev/ttyUSB0 -0 disks/cpm22.dsk

# Or if installed globally
fdcsds -p /dev/ttyUSB0 -0 disks/cpm22.dsk
```

### Command-Line Options

```
Usage: fdcsds [options] -p <port>

Options:
  -p, --port <device>    Serial port (required)
  -b, --baud <rate>      Set serial port speed (default: 230400)
  -0, --drive0 <file>    Mount disk image to drive 0
  -1, --drive1 <file>    Mount disk image to drive 1
  -2, --drive2 <file>    Mount disk image to drive 2
  -3, --drive3 <file>    Mount disk image to drive 3
  -r, --readonly <n>     Make drive 0-3 read only
  -v, --verbose          Verbose display
  -d, --debug            Debug mode
  -h, --help             Display help information
```

### Supported Baud Rates

- 9600
- 19200
- 38400
- 57600
- 76800
- 230400 (default)
- 403200 (macOS only)
- 460800

### Examples

**Mount multiple drives:**
```bash
fdcsds -p /dev/ttyUSB0 \
  -0 disks/cpm22.dsk \
  -1 disks/altdos.dsk \
  -2 disks/basic.dsk
```

**Read-only drive:**
```bash
fdcsds -p /dev/ttyUSB0 -0 disks/cpm22.dsk -r 0
```

**Custom baud rate:**
```bash
fdcsds -p /dev/ttyUSB0 -b 460800 -0 disks/cpm22.dsk
```

**Verbose mode:**
```bash
fdcsds -p /dev/ttyUSB0 -v -0 disks/cpm22.dsk
```

---

## Terminal UI

The server provides a real-time terminal interface showing:

- **Connection Info**: Serial port and baud rate
- **Command Status**: Current FDC+ command being processed
- **Drive Status** (up to 4 drives):
  - Mounted disk image filename
  - Drive enable indicator
  - Head load status
  - Current track number
  - Read-only flag
- **Error Messages**: Error details with errno information
- **Buffer Display**: Hex dump of data in verbose mode

### Interactive Controls

- **C** - Clear error message
- **Q** - Quit program
- **V** - Toggle verbose mode

---

## FDC+ Protocol

The server implements the FDC+ Serial Disk protocol:

### Commands

1. **STAT** - Status Command
   - Returns bitmask of mounted drives
   - Updates drive head load and track position

2. **READ** - Read Track Command
   - Reads 137-byte sectors from disk image
   - Supports up to 32 sectors per track

3. **WRIT** - Write Track Command
   - Writes sectors to disk image
   - Respects read-only protection
   - Two-phase protocol (acknowledge + data + status)

### Command/Response Block

```typescript
struct CommandResponseBlock {
  cmd: string;      // 4-byte ASCII command
  param1: uint16;   // Parameter 1 (little-endian)
  param2: uint16;   // Parameter 2 (little-endian)
}
```

### Data Integrity

- All data transfers include 16-bit checksums
- Checksum = sum of all bytes (uint16)
- Format: LSB, MSB (little-endian)

---

## Disk Images

### Supported Formats

- **8-inch disks**: 330KB
- **Minidisk**: 75KB
- **Extended**: Up to 8MB

### Format Details

- **Sectors per track**: 32
- **Bytes per sector**: 137
- **Total tracks**: 77 (max)
- **Track size**: 4,384 bytes (137 × 32)

### Creating Disk Images

Disk images are raw binary files:

```bash
# Create blank 330K 8-inch disk
dd if=/dev/zero of=blank.dsk bs=4384 count=77

# Create blank 75K minidisk
dd if=/dev/zero of=minidisk.dsk bs=4384 count=17
```

---

## Development

### Project Structure

```
fds-ts/
├── src/               # TypeScript source
├── dist/              # Compiled JavaScript (generated)
├── disks/             # Disk image storage
├── test/              # Unit tests (future)
├── package.json       # Dependencies & scripts
├── tsconfig.json      # TypeScript configuration
└── README-TS.md       # This file
```

### NPM Scripts

```bash
npm run build      # Compile TypeScript
npm run start      # Run compiled code
npm run dev        # Run with ts-node (development)
npm run clean      # Remove dist/
npm test           # Run tests (future)
```

### Type Checking

```bash
npx tsc --noEmit
```

### Dependencies

**Runtime:**
- `serialport` ^12.0.0 - Serial port I/O
- `blessed` ^0.1.81 - Terminal UI
- `commander` ^11.0.0 - CLI parsing

**Development:**
- `typescript` ^5.3.0
- `@types/node` ^20.0.0
- `@types/blessed` ^0.1.25
- `ts-node` ^10.9.0
- `jest` ^29.0.0 (testing)

---

## Serial Port Permissions

### Linux

Add your user to the `dialout` group:

```bash
sudo usermod -a -G dialout $USER
# Log out and back in
```

Or use `udev` rules:

```bash
sudo nano /etc/udev/rules.d/50-serial.rules
```

Add:
```
KERNEL=="ttyUSB[0-9]*", MODE="0666"
KERNEL=="ttyACM[0-9]*", MODE="0666"
```

Reload rules:
```bash
sudo udevadm control --reload-rules
```

### macOS

Serial ports typically work without special permissions. Ports appear as:
- `/dev/cu.usbserial-*`
- `/dev/tty.usbserial-*`

Use `cu.*` devices for best results.

---

## Differences from C Version

### Improvements

1. **Async/Await**: All I/O operations are non-blocking Promises
2. **Type Safety**: TypeScript provides compile-time type checking
3. **Error Handling**: Better error propagation and reporting
4. **Module System**: Clean ES module architecture
5. **Package Management**: npm-based dependency management
6. **Cross-Platform**: Better Node.js cross-platform support

### API Differences

- Uses `serialport` package instead of termios
- Uses `blessed` instead of ncurses
- Uses `fs/promises` instead of POSIX file I/O
- Promise-based timeout handling instead of select()

### Compatibility

The TypeScript version is **protocol-compatible** with the C version:
- Same FDC+ wire protocol
- Same disk image format
- Same command structure
- Binary-compatible data transfers

---

## Troubleshooting

### Serial Port Not Found

```bash
# List available serial ports
ls /dev/tty* /dev/cu*

# Check permissions
ls -l /dev/ttyUSB0
```

### Build Errors

```bash
# Clean and rebuild
npm run clean
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Runtime Errors

Enable debug mode:
```bash
fdcsds -p /dev/ttyUSB0 -0 disk.dsk -v -d
```

---

## Future Enhancements

- [ ] Unit tests with Jest
- [ ] Integration tests with mock serial port
- [ ] Web-based UI option
- [ ] REST API for remote management
- [ ] Support for more drive types
- [ ] Disk image conversion utilities
- [ ] Performance benchmarking

---

## Contributing

This is a TypeScript port of the original C implementation. Contributions are welcome!

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

---

## License

GPL-3.0 - Same as original C version

---

## Credits

- **Original C Implementation**: Patrick Linstruth
- **TypeScript Port**: 2024
- **FDC+ Hardware**: http://www.deramp.com

---

## References

- [FDC+ Hardware Documentation](http://www.deramp.com)
- [Altair 8800 Information](https://en.wikipedia.org/wiki/Altair_8800)
- [Node.js SerialPort](https://serialport.io/)
- [Blessed Documentation](https://github.com/chjj/blessed)
