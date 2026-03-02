# FDC+ Domain Analysis Report

**Generated:** 2026-02-20
**Analysis Scope:** Drive operations, CP/M filesystem, data structures, and build configuration

---

## 1. DRIVE OPERATIONS (src/drive.ts)

### DriveManager Class
The core drive management system handles all disk image I/O operations via in-memory file handles.

#### Key Properties
- **drives**: `Map<number, DriveState>` - Drive state for all 16 drives
- **fileHandles**: `Map<number, fs.FileHandle>` - Open file handles per drive
- **trackBuffer**: `Buffer` - Reusable 4384-byte track buffer
- **fdcErrno**: `FdcError` - Last operation error code
- **MAX_RETRIES**: 3 - Retry attempts for transient errors
- **RETRY_DELAY_MS**: 100 - Base retry delay (exponential backoff)

#### Core Operations

**Mount/Unmount:**
```typescript
async mountDrive(drive: number, filename: string): Promise<number>
// Opens disk image file, returns file descriptor
// Updates DriveState with mount status, track 0, no head load
// Supports RO/RW mode based on driveState.readonly flag
// Throws on file not found or open failure

async unmountDrive(drive: number): Promise<void>
// Closes file handle, resets DriveState
// Cleans up fileHandles map

async unmountAll(): Promise<void>
// Gracefully unmounts all mounted drives, collects errors
```

**Read/Write Track:**
```typescript
async readTrack(drive: number, track: number, length: number): Promise<Buffer>
// Reads physical track from disk image
// Offset = track * length (byte offset)
// Returns complete track buffer
// Sets FdcError.NOT_READY on failures

async writeTrack(drive: number, track: number, length: number, buffer: Buffer): Promise<number>
// Writes track data to disk image
// Validates: readonly flag, handle validity, buffer size
// Implements 3-retry loop for transient errors (EAGAIN, EBUSY, EINTR, EIO)
// Calls fileHandle.sync() for data integrity
// Returns bytes written
// Sets FdcError.WRITE_ERR on write failures or readonly violation
```

**Protection & State:**
```typescript
async writeProtect(drive: number, flag: boolean): Promise<void>
// Sets readonly flag on drive
// If mounted and flag changed, remounts with correct file mode (O_RDONLY vs O_RDWR)

async remountWithMode(drive: number, readonly: boolean): Promise<void>
// Private method to close/reopen file with new mode
// Prevents EBADF errors when mode doesn't match actual file open flags

getDriveState(drive: number): DriveState | null
getAllDriveStates(): Map<number, DriveState>
isMounted(drive: number): boolean
isReadOnly(drive: number): boolean
async canWrite(drive: number): Promise<boolean>
// Tests datasync() to check actual writable status
```

#### DriveState Interface
```typescript
interface DriveState {
  fd: number | null;           // File descriptor or null if unmounted
  filename: string | null;      // Full path to mounted image
  mounted: boolean;             // Is drive mounted?
  readonly: boolean;            // Write protected?
  hdld: boolean;               // Head loaded (set during read/write)
  track: number;               // Current track number
}
```

#### Error Handling
- **FdcError.OK** (0x00) - Successful operation
- **FdcError.NOT_READY** (0x01) - Drive not mounted or file handle invalid
- **FdcError.CHKSUM_ERR** (0x02) - Checksum mismatch (not used in drive.ts)
- **FdcError.WRITE_ERR** (0x03) - Write protected or write failure

#### Debug Logging
- `setDebug(enabled: boolean)` enables verbose operation logging
- Logs mount/unmount operations with file descriptors
- Logs read/write attempts with track, offset, and results
- Logs retry attempts with backoff strategy

---

## 2. CP/M FILESYSTEM OPERATIONS (src/cpm-filesystem.ts)

### Overview
Pure immutable-first filesystem implementation that operates on in-memory buffers. All operations create new buffers or modify internal state without mutating the original imageData.

### CDBL Sector Framing
CP/M logical sectors (128 bytes) are wrapped in CDBL physical sector format (137 bytes):

```
Offset  Bytes  Field
------  -----  -----
0       1      Track (with 0x80 sync bit)
1       2      File byte count / reserved
3       128    CP/M data payload
131     1      Marker (0xFF)
132     1      Checksum (8-bit sum of 128 data bytes)
133-136 4      Spare
------
Total: 137 bytes per physical sector
```

**2:1 Interleave Mapping** (physical → logical):
- Even physical sectors (0,2,4,...,30) → logical (0,1,...,15)
- Odd physical sectors (1,3,5,...,31) → logical (16,17,...,31)

#### Key Constants
```typescript
CDBL = {
  SECTOR_SIZE: 137,           // Total physical sector size
  DATA_OFFSET: 3,             // Byte offset to 128-byte payload
  DATA_SIZE: 128,             // CP/M logical sector size
  SECTORS_PER_TRACK: 32,      // Physical sectors per track
  TRACK_SIZE: 4384,           // 137 * 32
  MARKER_OFFSET: 131,         // 0xFF marker position
  CHECKSUM_OFFSET: 132,       // Checksum byte position
}
```

#### Disk Parameter Sets

**8-inch (Standard):**
```typescript
PARAMS_8INCH = {
  seclen: 128,      // Logical sector size
  tracks: 77,       // Total tracks
  sectrk: 32,       // Sectors per track
  blocksize: 2048,  // 2K allocation blocks
  maxdir: 64,       // 64 directory entries
  boottrk: 2,       // 2 boot tracks (reserved)
}
// Total capacity: 315 blocks × 2K = 630 KB
// Data area: blocks 2-314 (313 blocks available)
```

**Minidisk:**
```typescript
PARAMS_MINIDISK = {
  seclen: 128,
  tracks: 17,
  sectrk: 32,
  blocksize: 1024,  // 1K allocation blocks
  maxdir: 32,
  boottrk: 2,
}
// Total capacity: 65 blocks × 1K = 65 KB
// Data area: blocks 2-64 (63 blocks available)
```

### CpmFilesystem Class

#### Constructor
```typescript
constructor(imageData: Buffer, params?: CpmDiskParams)
// Creates defensive copy of imageData
// Auto-detects params if not provided
// Determines pointer size (8-bit vs 16-bit) based on total blocks > 255
```

#### Sector I/O Operations

```typescript
readSector(track: number, logicalSector: number): Buffer
// Maps logical sector through INTERLEAVE_TABLE to physical sector
// Extracts 128-byte payload from CDBL frame
// Returns new Buffer (defensive copy)

writeSector(track: number, logicalSector: number, data: Buffer): void
// Validates data is exactly 128 bytes
// Updates CDBL frame: track byte, marker, checksum
// Modifies internal imageData buffer in-place
```

#### Block I/O Operations

```typescript
readBlock(blockNumber: number): Buffer
// Blocksize = 2048 (8-inch) or 1024 (minidisk)
// Reads N sectors sequentially (2K block = 16 sectors)
// Returns concatenated buffer

writeBlock(blockNumber: number, data: Buffer): void
// Validates data matches blocksize exactly
// Writes data back to component sectors
```

#### Directory Operations

**Directory Entry Structure (32 bytes):**
```typescript
interface CpmDirEntry {
  status: number;           // 0x00-0x0F = user #, 0xE5 = deleted
  filename: string;         // 8 chars, space-padded
  extension: string;        // 3 chars, space-padded
  extentLow: number;        // XL - low 5 bits of extent
  bc: number;              // BC - byte count in last record (0 = full)
  extentHigh: number;      // XH - high 6 bits of extent
  rc: number;              // RC - records in last extent (0-128)
  blockPointers: number[]; // 16 (8-bit) or 8 (16-bit) blocks
  rawAttributes: number;   // Packed attribute bits
  readonly: boolean;       // T1' attribute (R/O)
  system: boolean;        // T2' attribute (SYS)
  archive: boolean;       // T3' attribute (ARC)
}
```

**Attribute Storage:** High bit of ext[0]/ext[1]/ext[2] encodes R/O, SYS, ARC flags.

**Directory Operations:**
```typescript
readDirectory(): CpmDirEntry[]
// Reads all directory entries from disk (blocks 0 onwards)
// Parses each 32-byte entry, handles deleted (0xE5) entries

writeDirectory(entries: CpmDirEntry[]): void
// Writes all entries back to directory blocks
// Fills unused entries with 0xE5 (deleted marker)
// Serializes attributes back to extension bytes

private parseDirEntry(buf: Buffer, off: number): CpmDirEntry
// Extracts 32-byte entry from buffer offset
// Decodes attributes from high bits of extension bytes

private serializeDirEntry(entry: CpmDirEntry, buf: Buffer, off: number): void
// Writes entry back to buffer with proper byte layout
// Encodes attributes back to high bits
```

### File Operations

**File Representation (Assembled from extents):**
```typescript
interface CpmFile {
  user: number;          // User number (0-15)
  filename: string;      // Trimmed to 8 chars
  extension: string;     // Trimmed to 3 chars
  size: number;          // Computed size in bytes
  extents: CpmDirEntry[]; // All directory entries for this file
  readonly: boolean;     // Aggregate of all extents
  system: boolean;
  archive: boolean;
}
```

**File Operations:**
```typescript
listFiles(): CpmFile[]
// Reads all directory entries
// Groups by user:filename:extension into extent lists
// Sorts extents by extent number
// Computes file sizes using EXM (extent mask) formula
// Returns sorted array (by user, then filename)

readFile(filename: string, ext: string, user?: number): Buffer
// Finds file in directory
// Collects all blocks from all extents
// Trims to computed file size
// Returns complete file data as Buffer

writeFile(filename: string, ext: string, data: Buffer, user?: number): void
// Deletes existing file with same name
// Allocates required blocks (via allocateBlocks)
// Writes data to allocated blocks
// Creates directory entries (one per blocksize capacity)
// Handles multi-extent files (EXM determines extents per entry)

deleteFile(filename: string, ext: string, user?: number): void
// Marks all directory entries for file as 0xE5 (deleted)
// Does NOT deallocate blocks (orphaned until re-allocated)
```

### Size Calculation (Complex)

CP/M extent numbering:
- **Logical extent** = 128 records (CP/M 2.2 definition)
- **EXM (extent mask)** = extents per directory entry - 1
- **8-inch 2K blocks**: 16 pointers/entry × (2048/128) records = 256 records = 2 logical extents → EXM = 1
- **8-inch 2K blocks (16-bit)**: 8 pointers × 256 records = 256 records = 1 logical extent per entry → EXM = 0

**Size computation:**
```
totalRecords = sum of (all blocks in all but last extent)
             + (subExtent × 128 + rc) where subExtent = lastExtLow & exm
size = totalRecords × 128
if (bc > 0 && rc > 0): size -= 128; size += bc;  // Last record byte count
```

### Block Allocation

```typescript
buildAllocationBitmap(): boolean[]
// Creates bitmap of allocated blocks
// Marks directory blocks as allocated
// Marks all blocks referenced by active directory entries
// Returns array where true = in use

allocateBlocks(count: number): number[]
// Scans bitmap for free blocks
// Returns array of N free block numbers
// Throws "Disk full" if insufficient free space

getFreeSpace(): CpmFreeSpace
// Returns detailed space info:
interface CpmFreeSpace {
  freeBlocks: number;
  freeBytes: number;
  totalBlocks: number;
  totalBytes: number;
  usedBlocks: number;
  usedBytes: number;
  directoryEntriesFree: number;
  directoryEntriesTotal: number;
}
```

### Utilities

```typescript
static detectParams(imageData: Buffer): CpmDiskParams | null
// Determines disk type by image size
// 74528-74624 bytes → minidisk (17 tracks)
// 337568-337664 bytes → 8-inch (77 tracks)
// Validates directory area to confirm CP/M filesystem

static normalizeFilename(name: string): {filename, extension}
// Parses "USER:FILENAME.EXT" or "FILENAME.EXT"
// Returns uppercase, trimmed to 8.3 format
// Strips user prefix if present

static parseFilenameParam(param: string): {user, filename, extension}
// Like normalizeFilename but extracts user number
// Returns {user: 0, filename: 'NAME', extension: 'EXT'}

getImageData(): Buffer
// Returns defensive copy of modified imageData

getParams(): CpmDiskParams
// Returns current disk parameters
```

---

## 3. DATA STRUCTURES & TYPES

### From protocol.ts

**Fundamental Constants:**
```typescript
MAX_DRIVES = 16
MAX_TRACKS = 77
MAX_TRACK_LEN = 4384  // 137 * 32 (CDBL format)
MAX_DISK_SIZE = 337,568  // 77 * 4384
MAX_PATH = 128

enum BaudRate {
  B9600, B19200, B38400, B57600, B76800, B230400, B403200, B460800
}
DEFAULT_BAUD_RATE = B460800

enum FdcError {
  OK = 0x00, NOT_READY = 0x01, CHKSUM_ERR = 0x02, WRITE_ERR = 0x03
}

enum FdcCommand {
  STAT = 'STAT', READ = 'READ', WRIT = 'WRIT'
}
```

**CommandResponseBlock (8-byte protocol packet):**
```typescript
class CommandResponseBlock {
  cmd: string;      // 4-byte ASCII command
  param1: number;   // uint16 LE
  param2: number;   // uint16 LE

  toBuffer(): Buffer
  static fromBuffer(buffer: Buffer): CommandResponseBlock
  static create(cmd: FdcCommand, param1: number, param2: number): CommandResponseBlock
  getCommand(): FdcCommand | null
}

class ByteUtils {
  static LSB(word: number): number    // word & 0xff
  static MSB(word: number): number    // (word >> 8) & 0xff
  static WORD(lsb: number, msb: number): number  // (msb << 8) | lsb
}
```

### From config.ts

**ConfigFile Interface:**
```typescript
interface ConfigFile {
  // Serial connection
  port?: string;      // e.g., "/dev/ttyUSB0"
  baud?: number;      // e.g., 230400

  // Drive mounts (startup mounts)
  drive0?: string;    // e.g., "disks/cpm22.dsk"
  drive1?: string;
  drive2?: string;
  drive3?: string;

  // Write protection
  readonly?: number[]; // [0, 2] = drives 0 and 2 read-only

  // Display
  verbose?: boolean;
  debug?: boolean;
  logFile?: string;

  // Web interface
  web?: boolean;
  webPort?: number;   // e.g., 3000
  webHost?: string;   // e.g., "localhost"

  // Terminal serial (secondary connection)
  terminalPort?: string;
  terminalBaud?: number;
  terminalAutoconnect?: boolean;

  // GPIO indicators (Raspberry Pi)
  gpioLeds?: GpioLedConfig;
}
```

### From web-server.ts

**WebServerConfig:**
```typescript
interface WebServerConfig {
  port: number;          // HTTP port (3000)
  host: string;          // Bind address ("0.0.0.0")
  disksDir: string;      // Path to disk images
  cassettesDir: string;  // Path to cassette files
  scriptsDir: string;    // Path to scripts
  uploadsDir?: string;   // Upload destination
}

interface PreferredTerminalSettings {
  port?: string;
  baud?: number;
}
```

---

## 4. BUILD CONFIGURATION (tsconfig.json)

```json
{
  "compilerOptions": {
    "target": "ES2022",           // Modern JavaScript
    "module": "commonjs",         // Node.js modules
    "lib": ["ES2022"],            // Standard library
    "outDir": "./dist",           // Compiled output
    "rootDir": "./src",           // Source root

    "strict": true,               // Full type checking
    "noUnusedLocals": true,       // Error on unused variables
    "noUnusedParameters": true,   // Error on unused params
    "noImplicitReturns": true,    // Must explicitly return
    "noFallthroughCasesInSwitch": true,

    "esModuleInterop": true,      // CommonJS interop
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,          // Generate .d.ts files
    "declarationMap": true,
    "sourceMap": true,
    "moduleResolution": "node",
    "allowSyntheticDefaultImports": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

**Build Process:**
```bash
npx tsc                     # Compile all src/**/*.ts → dist/
npm run build              # Same as above
npm run dev               # ts-node (direct TS execution)
npm run clean             # rm -rf dist
```

**Key Compiler Flags:**
- `strict: true` = `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, etc.
- `noUnusedLocals/Parameters` are **ENFORCED** - must delete unused code
- ES2022 target means async/await, optional chaining, nullish coalescing supported

---

## 5. DEPENDENCIES (package.json v2.0.0)

### Production Dependencies

**Core Server:**
- `express@^4.18.0` - HTTP server
- `socket.io@^4.6.0` - WebSocket communication
- `cors@^2.8.5` - CORS middleware
- `multer@^2.0.2` - File upload handling
- `serialport@^12.0.0` - Serial communication with FDC+ hardware

**CLI & Config:**
- `commander@^11.0.0` - Command-line parsing
- `blessed@^0.1.81` - Terminal UI framework

**Storage:**
- `sqlite3@^5.1.7` - Database (drive assignments, settings)

**Audio:**
- `play-sound@^1.1.6` - Play audio clips (floppy sounds)

**Hardware GPIO (Optional):**
- `onoff@^6.0.3` - GPIO control (Raspberry Pi LEDs)

**Type Definitions:**
- `@types/multer`, `@types/blessed`, `@types/cors`, `@types/express`, `@types/sqlite3`, `@types/play-sound` - TypeScript definitions
- `@types/node@^20.0.0` - Node.js types

### Dev Dependencies

- `typescript@^5.3.0` - TypeScript compiler
- `ts-jest@^29.0.0` - Jest with TypeScript support
- `jest@^29.0.0` - Test framework
- `ts-node@^10.9.0` - Direct TypeScript execution
- `@types/jest@^29.0.0` - Jest types

### Scripts

```json
{
  "build": "tsc",                 // Compile TypeScript
  "start": "node dist/index.js",  // Run compiled server
  "dev": "ts-node src/index.ts",  // Run with direct TS
  "test": "jest",                 // Run all tests
  "clean": "rm -rf dist"
}
```

### Binaries

```json
{
  "fdcsds": "./dist/index.js",
  "create-boot-disk": "./create-boot-disk.js"
}
```

**Node Requirements:** `>= 18.0.0`

---

## 6. KEY ARCHITECTURAL INSIGHTS

### Separation of Concerns

1. **Drive Layer** (`drive.ts`)
   - Low-level file handle management
   - Track-based I/O operations
   - Error codes propagated to callers
   - No filesystem knowledge

2. **Filesystem Layer** (`cpm-filesystem.ts`)
   - In-memory buffer-based operations
   - CP/M directory and allocation logic
   - File-level abstraction (listFiles, readFile, writeFile)
   - Immutable design (defensive copies)
   - No I/O operations (pure computation)

3. **Web Interface Layer** (`web-server.ts`)
   - REST API for drive management
   - Socket.IO for real-time status
   - File upload/download
   - Configuration management

### Critical Implementation Details

**Error Handling:**
- Drive errors set `fdcErrno` enum for protocol-level errors
- File operations throw exceptions
- Web layer catches and returns HTTP status codes

**Transient Error Handling:**
- Write operations retry up to 3 times for EAGAIN/EBUSY/EINTR/EIO
- Exponential backoff: delay × 2^attempt
- Non-transient errors fail immediately

**File Mode Integrity:**
- readonly flag changes trigger remount to ensure file mode matches
- Prevents EBADF errors from mode mismatches
- datasync() used to detect invalid file handles

**Block Allocation Strategy:**
- Simple first-fit allocation (scan from block 0)
- Directory blocks always allocated first (blocks 0-N)
- EXM (extent mask) determines multi-extent file handling
- No free space defragmentation

**Type Safety:**
- TypeScript strict mode enforced
- No unused variables or parameters allowed
- All buffer operations validated (size checks)
- Protocol packets validated (8-byte requirement)

---

## 7. SHARED TYPE OPPORTUNITIES FOR CLI

These types/interfaces would be useful in a CLI client and could be shared via a separate npm package or exported from domain modules:

### Essential Types
- `CpmFile` - File metadata structure
- `CpmFreeSpace` - Disk usage information
- `DriveState` - Drive mount status
- `FdcError`, `FdcCommand` - Protocol enums
- `CpmDiskParams` - Disk parameter set (8-inch, minidisk)

### Utility Functions
- `CpmFilesystem.normalizeFilename()`
- `CpmFilesystem.parseFilenameParam()`
- `CpmFilesystem.detectParams()`
- `CommandResponseBlock.toBuffer()` / `fromBuffer()`
- `ByteUtils` helpers

### Configuration
- `ConfigFile` interface
- Baud rate constants
- Path constants (MAX_DRIVES, MAX_TRACKS)

---

## 8. BUILD ARTIFACTS

After `npx tsc`:
- TypeScript compiled to CommonJS in `dist/`
- Source maps generated (`.js.map`)
- Type declarations generated (`.d.ts`, `.d.ts.map`)
- Ready for `npm install` via local path or published package

**Key Compiled Files:**
- `dist/drive.js` - DriveManager class + getDriveManager()
- `dist/cpm-filesystem.js` - CpmFilesystem, all interfaces/constants
- `dist/protocol.js` - FdcError, FdcCommand, CommandResponseBlock
- `dist/config.js` - ConfigFile interface, loadConfigFile()
- `dist/web-server.js` - WebServer REST/Socket.IO implementation
