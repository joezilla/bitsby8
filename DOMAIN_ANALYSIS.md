# FDC+ Domain Analysis Report

**Generated:** 2026-07-02
**Analysis Scope:** Backend under `src/` — drive I/O, CP/M filesystem, HTTP/WebSocket surface, middleware, MCP server, GPIO, database, protocol, and build configuration. Frontend (`frontend/`) and CLI (`cli/`) are covered separately in `FRONTEND_ANALYSIS.md` and `cli/README.md`.

---

## 1. DRIVE OPERATIONS (src/drive.ts)

### DriveManager Class
The core drive-management layer. Owns the open `fs.FileHandle` for every mounted drive and translates track-level read/write requests into `pread`/`pwrite`+`fsync` against the disk image file.

#### Key Properties
- **drives**: `Map<number, DriveState>` — state for all 16 slots (only 0-3 are typically populated)
- **fileHandles**: `Map<number, fs.FileHandle>` — open file handle per mounted drive
- **trackBuffer**: `Buffer` — reusable buffer sized to `MAX_TRACK_LEN` (4384 bytes)
- **fdcErrno**: `FdcError` — sticky last-error code, read by the protocol layer
- **MAX_RETRIES**: 3
- **RETRY_DELAY_MS**: 100 (base for exponential backoff)

#### Core Operations

**Mount / Unmount:**
```typescript
async mountDrive(drive: number, filename: string): Promise<number>
// Opens the disk image with fs.open() using O_RDONLY or O_RDWR based on the
// drive's current readonly flag. Populates DriveState, registers the file
// handle, notifies GpioLedController, returns the numeric fd.

async unmountDrive(drive: number): Promise<void>
// Closes the file handle, resets DriveState fields to their empty values,
// notifies GPIO.

async unmountAll(): Promise<void>
// Iterates every mounted slot; collects errors but keeps unmounting.

async cleanup(): Promise<void>
// Alias for unmountAll(); called from the SIGINT/SIGTERM handler in index.ts.
```

**Read / Write Track:**
```typescript
async readTrack(drive: number, track: number, length: number): Promise<Buffer>
// pread at offset = track * length. Sets driveState.hdld = true and
// driveState.track = track. On success stamps driveState.lastIo = Date.now().
// On failure sets fdcErrno = NOT_READY and rethrows.

async writeTrack(drive: number, track: number, length: number, buffer: Buffer): Promise<number>
// Validates mount, non-readonly state, and handle writability via a
// preflight datasync() (catches EBADF/EACCES from a stale handle).
// Retries EAGAIN/EBUSY/EINTR/EIO up to MAX_RETRIES with exponential
// backoff (RETRY_DELAY_MS * 2^attempt). Calls fileHandle.sync() after a
// successful write for durability. Stamps lastIo, returns bytes written.
// Sets fdcErrno = WRITE_ERR on failure / readonly / bad params.
```

**Protection & State:**
```typescript
async writeProtect(drive: number, flag: boolean): Promise<void>
// Updates driveState.readonly. If the flag actually changed and the drive
// is mounted, calls the private remountWithMode() to reopen the file with
// the correct O_RDONLY / O_RDWR mode — this prevents EBADF errors that
// would otherwise appear the next time we try to write.

private async remountWithMode(drive: number, readonly: boolean): Promise<void>
// Closes the current handle, reopens the same filename with the new mode,
// updates fd + fileHandles. On open failure, marks the drive unmounted.

getDriveState(drive: number): DriveState | null
getAllDriveStates(): Map<number, DriveState>
isMounted(drive: number): boolean
isReadOnly(drive: number): boolean
async canWrite(drive: number): Promise<boolean>
// Does a datasync() probe to verify the handle really is writable
// (mount flag says one thing, kernel might disagree).
```

#### DriveState Interface (from src/protocol.ts)
```typescript
interface DriveState {
  fd: number | null;      // File descriptor, or null if unmounted
  filename: string | null;// Full path to the mounted image
  mounted: boolean;
  readonly: boolean;      // Write-protected
  hdld: boolean;          // Head loaded (set during any read/write)
  track: number;          // Current track
  lastIo: number | null;  // Epoch ms of the most recent successful I/O
}
```
`lastIo` is what the web UI uses to render the "recently active" LED for a drive.

#### Error Handling
- `fdcErrno` is set to the appropriate `FdcError` enum value on failure and read by the FDC protocol layer for the wire response.
- File-system exceptions propagate out of the DriveManager for the caller to handle.

#### Debug Logging
`setDebug(true)` emits verbose `[DEBUG] DriveManager.*` traces to stdout: mount attempts, file sizes, read/write offsets, retry attempts.

The module also imports `getGpioLedController()` from `./gpio` and notifies it after every mount, unmount, and writeProtect so that drive LEDs on a Raspberry Pi stay in sync with the software state.

---

## 2. CP/M FILESYSTEM OPERATIONS (src/cpm-filesystem.ts)

Pure in-memory reader/writer for CP/M 2.2 filesystems inside a CDBL-framed disk image. All operations run against a defensive `Buffer` copy of the image — no file I/O is performed here; the route handlers read the whole image, mutate it via `CpmFilesystem`, and write it back atomically.

### Sector framing — dual-format

The historical assumption that every physical sector uses one framing was wrong for real Altair 8" SD Lifeboat disks: those disks use two different physical layouts within a single image. Tracks 0-5 (the cold-start loader / CP/M system image / directory) use **boot framing**; tracks 6+ (user data) use **data framing** laid down by the BIOS during normal file I/O. Writing boot framing onto a data track corrupts the frame and CP/M reports `Bdos Err on B: Bad Sector` the next time it reads. Newly written files on data tracks were the trigger for finding this.

Both framings share offset 0 (sync = `track | 0x80`) and bytes 3-130 (the 128-byte CP/M payload). They diverge in bytes 1-2 and 131-136:

```
Boot framing (tracks 0-5 on 8" Lifeboat, or entire disk if systemTracks unset):
  [0]      track | 0x80
  [1-2]    file byte count / unused
  [3-130]  128 data bytes
  [131]    0xFF stop byte
  [132]    8-bit checksum (sum of bytes 3-130)
  [133-136] spare

Data framing (tracks 6+ on 8" Lifeboat):
  [0]      track | 0x80
  [1]      physical-sector position (phys * 17 mod 256)
  [2]      0x01
  [3-130]  128 data bytes
  [131-134] MUST be zero — 0xFF here would look like the stop byte to the BIOS
  [135]    0xFF stop byte
  [136]    0x00
```

The switch is driven by `CpmDiskParams.systemTracks`. `PARAMS_8INCH` sets it to `ALTAIR_8INCH_SYSTEM_TRACKS = 6`; `PARAMS_MINIDISK` leaves it undefined, which defaults to "boot framing everywhere" — the minidisk format has no separate BIOS data-track layout.

#### Key Constants
```typescript
export const CDBL = {
  SECTOR_SIZE: 137,        // Total bytes per physical sector record
  DATA_OFFSET: 3,          // Byte offset to start of 128-byte data payload
  DATA_SIZE: 128,          // CP/M logical sector size
  SECTORS_PER_TRACK: 32,   // Physical sectors per track
  TRACK_SIZE: 137 * 32,    // 4384 bytes per track
  MARKER_OFFSET: 131,      // Boot-track 0xFF marker position
  CHECKSUM_OFFSET: 132,    // Boot-track checksum position
  DATA_MARKER_OFFSET: 135, // Data-track 0xFF marker position
  DATA_END_OFFSET: 136,    // Data-track terminator (0x00)
} as const;

export const ALTAIR_8INCH_SYSTEM_TRACKS = 6;
```

**2:1 interleave** (physical → logical):
- Even physical sectors (0, 2, 4, ..., 30) → logical 0-15
- Odd physical sectors (1, 3, 5, ..., 31) → logical 16-31

Both directions are materialized at module load as `INTERLEAVE_TABLE` and `REVERSE_INTERLEAVE_TABLE`.

#### Disk Parameter Sets

```typescript
export interface CpmDiskParams {
  seclen: number;          // Logical sector size (always 128 for CP/M)
  tracks: number;          // Total tracks on disk
  sectrk: number;          // Logical sectors per track
  blocksize: number;       // Allocation block size in bytes
  maxdir: number;          // Maximum directory entries
  boottrk: number;         // Number of reserved boot tracks
  systemTracks?: number;   // Tracks that use boot framing; tracks >= this
                           // use data framing. Undefined = boot everywhere.
  dpbAL0?: number;
  dpbAL1?: number;
}

export const PARAMS_8INCH: CpmDiskParams = {
  seclen: 128, tracks: 77, sectrk: 32,
  blocksize: 2048, maxdir: 64, boottrk: 2,
  systemTracks: ALTAIR_8INCH_SYSTEM_TRACKS,   // 6
};

export const PARAMS_MINIDISK: CpmDiskParams = {
  seclen: 128, tracks: 17, sectrk: 32,
  blocksize: 1024, maxdir: 32, boottrk: 2,
};
```

### CpmFilesystem Class

#### Constructor
```typescript
constructor(imageData: Buffer, params?: CpmDiskParams)
// Defensively copies imageData. Auto-detects params via detectParams() if
// not supplied. Picks 8-bit vs 16-bit block pointers based on total blocks
// > 255 (useLargePointers).
```

#### Sector I/O
```typescript
readSector(track: number, logicalSector: number): Buffer
// Interleave maps logical → physical, extracts the 128-byte payload.

writeSector(track: number, logicalSector: number, data: Buffer): void
// Writes byte 0 (sync) and bytes 3-130 (payload) identically for both
// framings, then branches on (track < params.systemTracks):
//   - boot framing: 0xFF at offset 131, checksum at 132
//   - data framing: sets [1] (phys*17 & 0xFF), [2] = 0x01, zeroes bytes
//     131-134, writes 0xFF at 135, 0x00 at 136
```

#### Block I/O
```typescript
readBlock(blockNumber: number): Buffer
writeBlock(blockNumber: number, data: Buffer): void
// blockSize / seclen sectors per block. Block 0 starts at boottrk.
```

#### Directory Entry Structure (32 bytes)
```typescript
export interface CpmDirEntry {
  status: number;          // 0x00-0x0F = user #, 0xE5 = deleted
  filename: string;        // 8 chars, space-padded, high bits stripped
  extension: string;       // 3 chars, space-padded, high bits stripped
  extentLow: number;       // XL - low 5 bits of extent number
  bc: number;              // BC - byte count in last record (0 = full)
  extentHigh: number;      // XH - high bits of extent number
  rc: number;              // RC - records in this extent (0-128)
  blockPointers: number[]; // 16 (8-bit) or 8 (16-bit) block numbers
  rawAttributes: number;
  readonly: boolean;       // T1' bit (high bit of ext[0])
  system: boolean;         // T2' bit (high bit of ext[1])
  archive: boolean;        // T3' bit (high bit of ext[2])
}
```
Attribute bits live in the high bit of each extension character; `parseDirEntry` and `serializeDirEntry` transparently split them from the printable name.

#### Directory Operations
```typescript
readDirectory(): CpmDirEntry[]
writeDirectory(entries: CpmDirEntry[]): void
// Directory occupies ceil(maxdir / (blocksize/32)) blocks starting at
// block 0. writeDirectory fills unused slots with 0xE5.
```

### File-level operations

```typescript
export interface CpmFile {
  user: number;
  filename: string;        // Trimmed
  extension: string;       // Trimmed
  size: number;            // Computed from extents/RC/BC
  extents: CpmDirEntry[];
  readonly: boolean;
  system: boolean;
  archive: boolean;
}

listFiles(): CpmFile[]
// Groups directory entries by status:filename:extension. Sorts extents by
// (extentHigh * 32 + extentLow). Computes size:
//   sum of (used blocks * records/block) for every entry except the last
//   + subExtent*128 + last.rc  for the last entry (subExtent = extentLow & exm)
//   * seclen, adjusted by BC if the last record is partial.

readFile(name, ext, user=0): Buffer
// Collects blocks in extent order, trims to computed size.

writeFile(name, ext, data, user=0): void
// Deletes any existing file with the same name, allocates blocksNeeded
// blocks, writes them, then creates directory entries. blocksPerExtent =
// pointers per entry (16 for 8-bit, 8 for 16-bit); logicalExtentsPerEntry
// governs how extentLow / extentHigh advance across entries. Fills the
// last entry's RC (record count) and BC (byte count in final record).

deleteFile(name, ext, user=0): void
// Sets status = 0xE5 on every matching directory entry. Blocks are freed
// implicitly the next time buildAllocationBitmap() scans the directory.
```

### Block allocation
```typescript
buildAllocationBitmap(): boolean[]
// Directory blocks always marked in use, then walks every active dir
// entry and marks the block pointers it references.

allocateBlocks(count: number): number[]
// First-fit scan of the bitmap; throws "Disk full" if not enough.

getFreeSpace(): CpmFreeSpace
// { freeBlocks, freeBytes, totalBlocks, totalBytes, usedBlocks, usedBytes,
//   directoryEntriesFree, directoryEntriesTotal }
```

### Static utilities
```typescript
static detectParams(imageData: Buffer): CpmDiskParams | null
// Size sniff: ~74528 → minidisk, ~337568 → 8", else derive from image length.
// Then validateDirectory() sanity-checks the first 4 directory entries.

static normalizeFilename(name: string): { filename, extension }
static parseFilenameParam(param: string): { user, filename, extension }
// Parses "USER:NAME.EXT" or "NAME.EXT", returns 8.3 uppercase.
```

`getImageData()` returns a defensive copy of the mutated image; the route handlers write that Buffer straight back to disk via `fs.writeFile`.

---

## 3. PROTOCOL (src/protocol.ts)

Unchanged in shape since the C port — this file is stable.

```typescript
export const FDCSDS_NAME    = 'FDC+ Serial Drive Server';
export const FDCSDS_VERSION = '2.0.0';

export const MAX_DRIVES     = 16;
export const MAX_TRACKS     = 77;
export const MAX_TRACK_LEN  = 137 * 32;      // 4384
export const MAX_DISK_SIZE  = MAX_TRACK_LEN * MAX_TRACKS;
export const MAX_PATH       = 128;

export enum BaudRate {
  B9600 = 9600, B19200 = 19200, B38400 = 38400, B57600 = 57600,
  B76800 = 76800, B230400 = 230400, B403200 = 403200 /* macOS only */,
  B460800 = 460800,
}
export const DEFAULT_BAUD_RATE = BaudRate.B460800;

export enum FdcError {
  OK = 0x00, NOT_READY = 0x01, CHKSUM_ERR = 0x02, WRITE_ERR = 0x03,
}

export enum FdcCommand {
  STAT = 'STAT', READ = 'READ', WRIT = 'WRIT',
}

export class CommandResponseBlock {
  cmd: string;    // 4-byte ASCII
  param1: number; // uint16 LE
  param2: number; // uint16 LE
  toBuffer(): Buffer
  static fromBuffer(buffer: Buffer): CommandResponseBlock
  static create(cmd: FdcCommand, p1: number, p2: number): CommandResponseBlock
  getCommand(): FdcCommand | null
}

export class ByteUtils {
  static LSB(word: number): number
  static MSB(word: number): number
  static WORD(lsb: number, msb: number): number
}

export interface Config {
  port: string | null;
  baudRate: BaudRate;
  verbose: boolean;
  debug: boolean;
  drives: Map<number, string>;
  readonlyDrives: Set<number>;
}
export function createDefaultConfig(): Config;

export const TIMEOUT_DEFAULT = 5000;
export const TIMEOUT_BYTE    = 1000;
export const TIMEOUT_BUFFER  = 5000;
```

---

## 4. HTTP SURFACE (src/web-server.ts + src/routes/*)

`src/web-server.ts` is a thin orchestrator: it constructs Express + Socket.IO, resolves the database, builds a `Dependencies` bag, wires middleware, and hands the router to each route module.

```typescript
export class WebServer {
  constructor(
    config: WebServerConfig,
    driveManager: DriveManager,
    serialManager: SerialPortManager,
    terminalManager: TerminalSerialManager,
    preferredTerminalSettings?: PreferredTerminalSettings,
    options?: { server?: FdcServer; runtimeConfig?: ConfigFile; database?: Database }
  )
  async start(): Promise<void>       // Binds HTTP, starts 1 s status broadcast
  async startServer(): Promise<void> // Starts the FdcServer under WebServer control
  async stop(): Promise<void>
  broadcastStatus(): void            // Emits 'status' to all Socket.IO clients
  cancelActiveTransfer(): void       // Cancels replay / XMODEM
}
```

The `Dependencies` type in `src/types.ts` is the shared bag threaded through routes, services, WebSocket handlers, and the MCP server:

```typescript
export interface Dependencies {
  config: WebServerConfig;
  driveManager: DriveManager;
  serialManager: SerialPortManager;
  terminalManager: TerminalSerialManager;
  preferredTerminalSettings: PreferredTerminalSettings;
  io: SocketIOServer;
  database: Database;
  runtimeConfig: ConfigFile | null;
  server: FdcServer | null;
  diskServingEnabled: boolean;
  serverTask: Promise<void> | null;
  replayEngine: ReplayEngine | null;
  xmodemSender: XmodemSender | null;
  audioPlayer: any;
  currentAudioProcess: any;
}
```

### Route modules

Every module exports `register<Name>Routes(router, deps)` and attaches its endpoints to the Express app. Each handler carries `@openapi` JSDoc that `swagger-jsdoc` consumes to generate the committed `openapi.json`.

**`src/routes/health.ts`**
- `GET /api/health` — liveness probe
- `GET /api/status` — full status snapshot (serial + disk-serving + drives + system)

**`src/routes/config.ts`**
- `GET /api/config` — returns the current runtime `ConfigFile`
- `POST /api/config` — accepts partial updates; only `verbose` takes effect without restart (propagated to `FdcServer` and `TerminalSerialManager`)

**`src/routes/serial.ts`**
- `GET /api/serial/ports` — enumerates ports via `TerminalSerialManager.listPorts()`
- `PUT /api/serial/config` — closes the primary port, reopens with new device / baud, pauses the `FdcServer` during the swap, updates `runtimeConfig`

**`src/routes/disk-serving.ts`**
- `POST /api/disk-serving/enable` — opens primary serial if needed, lazily constructs `FdcServer`, starts serving
- `POST /api/disk-serving/disable` — stops the server, closes the primary port

**`src/routes/drives.ts`**
- `GET /api/drives` — per-drive status via `getDrivesStatus(deps)`
- `POST /api/drives/:id/mount` — mounts a `.dsk` from `disksDir` and persists the assignment
- `POST /api/drives/:id/unmount` — unmounts, clears the DB row
- `PUT /api/drives/:id/readonly` — toggles write protection (may remount)

**`src/routes/images.ts`**
- `GET /api/images` — filenames of `.dsk` / `.img` / `.ima` files
- `GET /api/images/details` — same with size + notes joined from `disk_notes`
- `POST /api/images/upload` — multer disk-storage upload, magic-bytes check rejecting ZIP/ELF/PE/JPEG/PNG masquerading as disk images (10 MB cap, its own rate limiter)
- `POST /api/images/:filename/clone` — copies to `name-copy[N].ext`
- `POST /api/images/create` — creates a zero-filled image; `format` is `8inch` (77 tracks), `minidisk` (17 tracks), or `8mb` (1863 tracks)
- `DELETE /api/images/:filename` — refuses (409) if mounted; also deletes the `disk_notes` row
- `PUT /api/images/:filename/notes` — upserts the `disk_notes` row
- `PUT /api/images/:filename/rename` — renames the file on disk **and** migrates the `disk_notes` row via `database.renameDiskNote(old, new)`; refuses (409) if mounted or if the target name already exists; same-name renames are no-ops; validates that the new name contains no path separators, does not start with `.`, and is ≤ 200 chars

**`src/routes/cpm.ts`** — all endpoints scoped to a single disk image file
- `GET /api/images/:filename/cpm/info` — returns `params`, `freeSpace`, `fileCount`, and `mounted` (drive number or `false`)
- `GET /api/images/:filename/cpm/files` — CP/M directory listing
- `GET /api/images/:filename/cpm/files/:cpmFile` — downloads a single CP/M file as `application/octet-stream`; `cpmFile` is `USER:NAME.EXT` (e.g. `0:ASM.COM`)
- `POST /api/images/:filename/cpm/files` — uploads a file into the CP/M filesystem via `writeFile`; 256 KB cap, memory storage, refuses (409) if the disk is mounted
- `DELETE /api/images/:filename/cpm/files/:cpmFile` — deletes a CP/M file; refuses (409) if mounted

**`src/routes/cassettes.ts`**
- `GET /api/cassettes/details` — list with size + notes
- `POST /api/cassettes/upload` — `.wav` only, 100 MB cap
- `DELETE /api/cassettes/:filename`
- `PUT /api/cassettes/:filename/notes`
- `GET /api/cassettes/:filename/stream` — pipes the WAV to the client
- `POST /api/cassettes/:filename/play` — server-side playback via `play-sound`
- `POST /api/cassettes/stop` — kills the currently playing audio process

**`src/routes/terminal.ts`**
- `GET /api/terminal/status`
- `GET /api/terminal/ports`
- `POST /api/terminal/open` — opens the secondary port
- `POST /api/terminal/close`
- `PUT /api/terminal/config` — updates baud / bits / parity on an open port

**`src/routes/scripts.ts`**
- `GET /api/scripts` — file names + sizes
- `GET /api/scripts/:name` — content for `.txt`, metadata only for binaries
- `POST /api/scripts` — create new text script (409 if exists)
- `PUT /api/scripts/:name` — overwrite
- `DELETE /api/scripts/:name`
- `POST /api/scripts/upload` — any file, 1 MB cap

**`src/routes/replay.ts`**
- `POST /api/replay/start` — `mode` is `raw` or `xmodem`; passes chunk size / delays / line ending or CRC flag through to `ReplayEngine` / `XmodemSender`
- `POST /api/replay/cancel`
- `GET /api/replay/status` — active + last progress snapshot

Filename validation across every route rejects `..`, `/`, `\`, and the `safeResolvePath()` helper in `src/utils/safe-path.ts` `realpathSync`-resolves and verifies the result stays under the configured root, guarding against symlink escapes.

---

## 5. SERVICES (src/services/)

Small pure helpers that route modules and the MCP server share.

**`services/status.ts`**
- `getStatus(deps)` — combined serial + disk-serving + drives + system status; the payload the `status` Socket.IO event carries every second
- `getDrivesStatus(deps)` — 4-element array (drives 0-3) of `{ id, mounted, filename, fullPath, readonly, headLoaded, track, lastIo }`
- `getTerminalStatus(deps)` — terminal open/close + config + preferred settings

**`services/disk-serving.ts`**
- `enableDiskServing(deps)` — opens serial port if needed, constructs a fresh `FdcServer` if none exists, launches `server.start()` as a background task, sets `diskServingEnabled = true`
- `disableDiskServing(deps)` — stops the server, closes the port
- `broadcastStatus(deps)` — one-liner around `deps.io.emit('status', getStatus(deps))`

**`services/transfer.ts`**
- `startRawReplay(deps, path, name, chunkSize?, interByteDelayMs?, interLineDelayMs?, lineEnding?)`
- `startXmodemSend(deps, path, name, useCrc?)`
- `cancelActiveTransfer(deps)` — cancels whichever of `replayEngine` / `xmodemSender` is running
- Both starters lazily instantiate the underlying engine and wire `progress` → `deps.io.emit('replay:progress', ...)`

**`services/file-listing.ts`**
- `listDiskImages(deps)` — filenames only
- `listDiskImagesWithDetails(deps)` — joins the `disk_notes` map for descriptions
- `listCassettesWithDetails(deps)` — same for cassette WAVs

**`services/audio.ts`**
- `getAudioPlayer(deps)` — lazy `play-sound` init, caches on `deps.audioPlayer`; falls back to a stub that throws so route handlers can report a clean error on hosts without an audio backend.

---

## 6. MIDDLEWARE (src/middleware/)

**`middleware/security.ts`** — `setupSecurityMiddleware(app, config, apiKey?)`
- Helmet with a CSP allowing `'self'`, inline scripts, Google Fonts (for Material Symbols), `ws:` / `wss:` connect; HSTS and `upgradeInsecureRequests` are deliberately disabled because this server is intended for plain HTTP on LAN / localhost (Safari's implicit HTTPS upgrade blanks the page otherwise)
- CORS allow-list is `[http://host:port, http://localhost:port, http://127.0.0.1:port]` from `buildAllowedOrigins()`
- `express-rate-limit` on `/api/`: 200 req/min, exempt for `127.0.0.1`/`::1`
- `createAuthMiddleware(apiKey)` mounted on `/api/`
- `express.json()` body parser last

**`middleware/auth.ts`** — `createAuthMiddleware(apiKey)`
- Returns an Express middleware that passes through when `apiKey` is null / empty / undefined
- Always allows `/api/docs*` (Swagger UI unaffected by auth)
- Otherwise requires `Authorization: Bearer <key>`; 401 if missing, 403 on mismatch

**`middleware/static.ts`** — `setupStaticMiddleware(app)`
- Resolves the SPA build directory in this order: `${cwd}/frontend/dist` first, then `${__dirname}/../../frontend/dist`. The cwd path wins under `pnpm dev`; the `__dirname` path is what a Debian install at `/usr/lib/fdcsds/dist/middleware/` resolves to (i.e. `/usr/lib/fdcsds/frontend/dist`)
- Serves `express.static(publicDir)`
- Mounts Swagger UI at `/api/docs` and the raw spec at `/api/docs.json`
- SPA fallback route on `GET /` sends `index.html`

---

## 7. WEBSOCKET (src/websocket/handlers.ts)

`setupWebSocket(io, deps)` wires all Socket.IO events. On connection it emits current `status` + `terminal:status`, then handles:

Client → server:
- `request-status` — re-emits status to just that socket
- `terminal:write` — buffered write to the terminal serial port
- `terminal:control` — sets DTR or RTS
- `replay:start` — kicks off raw or XMODEM (409-equivalent via `replay:progress` error if already running)
- `replay:cancel`

Server → client (also broadcast, not just to the connecting socket):
- `status` — every second, driven by `WebServer.start()`
- `terminal:data` — outgoing serial bytes as a `number[]` (piped from `terminalManager.onData`)
- `terminal:error`, `terminal:status`
- `replay:progress`

---

## 8. DATABASE (src/database.ts)

SQLite via `better-sqlite3` — synchronous underneath, though method signatures return `Promise` so the rest of the codebase can stay `async`. Do **not** `await` these operations expecting them to yield the event loop; they run straight through.

Schema (created by migration 0 in a transaction):
- `disk_notes(filename PK, description, notes, updated_at)`
- `cassette_notes(filename PK, description, notes, updated_at)`
- `drive_assignments(drive_id PK, filename, readonly INTEGER 0/1, updated_at)`

Migrations are gated by a `schema_version` table; each entry in the `MIGRATIONS` array runs in a transaction and records itself. WAL mode is on. The DB file is `chmod 0600` after creation (non-fatal if it fails).

Key methods (all `async`, but synchronous under the hood):
```typescript
getDiskNote(filename): Promise<DiskNote | null>
getAllDiskNotes(): Promise<Map<string, DiskNote>>
upsertDiskNote(filename, description, notes): Promise<void>
deleteDiskNote(filename): Promise<void>
renameDiskNote(oldFilename, newFilename): Promise<void>  // no-op if no row

getCassetteNote / getAllCassetteNotes / upsertCassetteNote / deleteCassetteNote

getAllDriveAssignments(): Promise<DriveAssignment[]>
saveDriveAssignment(driveId, filename, readonly): Promise<void>
clearDriveAssignment(driveId): Promise<void>
clearAllDriveAssignments(): Promise<void>
```

`renameDiskNote` is what makes `PUT /api/images/:filename/rename` carry a disk's notes forward to its new filename.

The singleton is exposed via `getDatabase(dbPath?)` and initialized in `src/index.ts` at `${dataDir}/fdcplus.db`.

---

## 9. MCP SERVER (src/mcp-server.ts)

Opt-in via `--mcp` on the CLI entry point. When set, `startMcpStdio(deps)` is called instead of the usual web-server / FDC-server startup and the process reads / writes MCP messages over stdio (via `StdioServerTransport` from `@modelcontextprotocol/sdk`).

Resources (JSON snapshots at fetch time):
- `fdcplus://status`
- `fdcplus://drives`
- `fdcplus://images`
- `fdcplus://terminal`

Tools — 29 total, grouped by domain:
- **Server / status:** `get_status`
- **Serial:** `list_serial_ports`, `configure_serial`, `enable_disk_serving`, `disable_disk_serving`
- **Drives:** `list_drives`, `mount_disk`, `unmount_disk`, `set_drive_readonly`
- **Disk images:** `list_disk_images`, `create_disk_image`, `clone_disk_image`, `delete_disk_image`, `update_disk_notes`
- **CP/M filesystem:** `get_cpm_disk_info`, `list_cpm_files`, `read_cpm_file`, `write_cpm_file`, `delete_cpm_file`
- **Terminal:** `get_terminal_status`, `list_terminal_ports`, `open_terminal`, `close_terminal`, `send_to_terminal`
- **Replay / transfer:** `list_scripts`, `start_replay`, `cancel_replay`, `get_replay_status`
- **Cassettes:** `list_cassettes`

The tools delegate to the same `services/*` helpers the HTTP routes use, so a single change of behavior (e.g. a new mount-check) shows up in both surfaces automatically.

---

## 10. GPIO SUBSYSTEM (src/gpio/)

Optional LED status output on Raspberry Pi, no-op elsewhere.

**`gpio-manager.ts`** — `GpioLedManager` (singleton)
- `require('onoff')` sits behind a `try / catch`; if the module isn't installed (macOS, or an armv6 build that skipped optional deps) the `Gpio` reference stays `null` and every operation becomes a no-op. `onoff` is declared under `optionalDependencies` in `package.json` for this reason.
- Detects platform via `os.platform() === 'linux'` and `Gpio.accessible === true`
- Reads `/sys/kernel/debug/gpio` to compute the kernel-side chip base offset (e.g. 512 on newer Pi kernels)
- Async write queue with 10 ms debounce, coalescing per-pin, plus a separate blink debounce map so RX/TX activity storms don't produce O(N) `write` syscalls
- Reports stats (`totalWrites`, `queuedWrites`, `coalescedWrites`, `errors`, `lastFlush`)

**`gpio-controller.ts`** — `GpioLedController` (singleton)
- High-level mapping from application state (`DriveState`, terminal open/data, replay progress) to LED pins
- Config shape (`GpioLedConfig`) covers 4 drives × 3 pins (enable / headLoad / readOnly), 3 terminal pins (rx / tx / connected), an activity LED, blink durations, and an active-low toggle
- Exposed via `getGpioLedController()` and called from `DriveManager` (mount / unmount / write-protect) and `TerminalSerialManager` (data / connect / disconnect)

---

## 11. CLI ENTRY (src/index.ts)

Commander-driven. Flags include the drive mounts (`-0` through `-3`), serial port + baud (`-p` / `-b`), read-only markers (`-r`), verbose / debug, web toggle + host + port, terminal port / baud / autoconnect, `--terminal-only`, `--gpio-leds` / `--no-gpio-leds` / `--gpio-active-low`, `--data-dir`, `-c/--config`, `--example-config`, `--show-persistent-paths`, and `--mcp`.

Startup sequence:
1. Load `.fdcsds.config` (or `--config` path), merge with CLI options (CLI wins)
2. Resolve `dataDir`, print merged config
3. Instantiate singletons: `DriveManager`, `SerialPortManager`, `TerminalSerialManager`, `GpioLedController`, `Logger`
4. Enable file logging if `--log-file`
5. Initialize GPIO if configured (blinks all LEDs once as a self-test)
6. Set write-protect on configured drives, mount them, open primary serial (soft-fail continues)
7. Auto-connect terminal port if requested
8. Open the database, restore saved `drive_assignments` from the previous run (only when `--web`)
9. Construct `FdcServer` unless `--terminal-only`
10. If `--mcp`: build a minimal `Dependencies`, call `startMcpStdio` and return (mutually exclusive with the web server)
11. Otherwise construct `WebServer` if `--web`, register SIGINT / SIGTERM / SIGHUP / uncaught handlers, start the FDC server under web-server management (or standalone), then park on an unresolved promise

Shutdown runs cancel-transfer → stop FDC → stop web → close serial ports → unmount drives → clean up temp uploads → GPIO shutdown → DB close → logger close, all racing a 5 s timeout so a wedged handle can't hold the process open.

---

## 12. BUILD CONFIGURATION (tsconfig.json)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "moduleResolution": "node",
    "allowSyntheticDefaultImports": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

`noUnusedLocals` and `noUnusedParameters` are enforced; the codebase actively prefixes intentionally unused Express handler args with `_`.

---

## 13. PACKAGE METADATA (package.json)

`fds-ts` v2.0.0, GPL-3.0. pnpm workspace: root package is the backend, `frontend/` is the Svelte SPA (managed by pnpm-workspace.yaml). Node `>= 18`, pinned pnpm 11.2.2.

### Runtime dependencies
- HTTP + realtime: `express@^4.18.0`, `socket.io@^4.6.0`, `cors@^2.8.5`
- Security / rate: `helmet@^8.1.0`, `express-rate-limit@^8.3.2`
- Upload: `multer@^2.0.2`
- OpenAPI: `swagger-jsdoc@^6.2.8`, `swagger-ui-express@^5.0.1`
- Validation: `zod@^4.4.3` (used by the MCP tool schemas)
- Storage: `better-sqlite3@^12.9.0` (sync)
- Serial: `serialport@^12.0.0`
- Audio: `play-sound@^1.1.6`
- MCP: `@modelcontextprotocol/sdk@^1.29.0`
- CLI / TUI: `commander@^11.0.0`, `blessed@^0.1.81`
- Logging: `pino@^10.3.1`, `pino-pretty@^13.1.3`

### Optional dependency
- `onoff@^6.0.3` — guarded via try/require in `src/gpio/gpio-manager.ts`, absent-safe on macOS and non-Pi Linux

### Dev dependencies
- TypeScript 5.3, ts-node 10.9, jest 29, ts-jest 29, concurrently 9

### Scripts
```json
"build":      "tsc && pnpm run docs",
"build:all":  "pnpm run build && pnpm --filter fdcplus-frontend build",
"docs":       "ts-node scripts/generate-openapi.ts",
"docs:check": "ts-node scripts/generate-openapi.ts --check",
"start":      "node dist/index.js",
"dev":        "ts-node src/index.ts",
"dev:all":    "concurrently backend + Vite frontend",
"test":       "jest --runInBand",
"typecheck":  "tsc --noEmit",
"lint":       "echo 'lint: no ESLint configured' && exit 0",
"check":      "typecheck + lint + docs:check + test + frontend svelte-check",
"clean":      "rm -rf dist coverage frontend/dist"
```

`docs:check` fails CI if `openapi.json` is out of sync with the JSDoc; regenerate with `pnpm docs`. `--runInBand` is the default for tests because the serial-port mock has a known cross-worker race.

### Binaries
- `fdcsds` → `dist/index.js`
- `create-boot-disk` → `create-boot-disk.js`

---

## 14. KEY ARCHITECTURAL INSIGHTS

### Separation of concerns

1. **Drive layer (`drive.ts`)** — file-handle lifecycle, track-level I/O, retry policy, GPIO notification. Has no filesystem knowledge and no HTTP awareness.
2. **CP/M layer (`cpm-filesystem.ts`)** — pure in-memory Buffer manipulation. No file I/O; route handlers own the read-mutate-writeback cycle.
3. **Route layer (`routes/*.ts`)** — HTTP concerns only, delegates business logic to services.
4. **Service layer (`services/*.ts`)** — shared helpers used by HTTP routes, WebSocket handlers, and the MCP tools so every surface stays in sync.
5. **Middleware (`middleware/*.ts`)** — cross-cutting: Helmet + CSP, rate limit, optional Bearer auth, SPA + Swagger UI serving.
6. **Transport (`server.ts`, `serial.ts`, `terminal-serial.ts`)** — FDC protocol loop and raw serial abstraction.
7. **MCP (`mcp-server.ts`)** — parallel entry point that reuses the service layer.

### The dual-framing gotcha

Any code path that writes CP/M sectors on a real 8" SD Lifeboat image must go through `CpmFilesystem` so that `writeSector` picks boot vs data framing based on `params.systemTracks`. Directly patching bytes 131-134 with anything but zero on tracks >= 6 produces "Bad Sector" errors on read, because the BIOS scans for 0xFF as a sector-end sentinel and the boot-framing marker at 131 hits first.

### Write integrity

`DriveManager.writeTrack` combines:
- Preflight `datasync()` to detect a stale handle (`EBADF` / `EACCES`) before touching the disk
- Transient-error retries (`EAGAIN` / `EBUSY` / `EINTR` / `EIO`) with exponential backoff
- Post-write `sync()` for durability
- Read-only remount when the readonly flag is toggled, so subsequent writes can't silently fail with `EBADF`

### Mount-guard invariants

Any endpoint that could corrupt live state refuses (409) while the target image is mounted:
- `DELETE /api/images/:filename`
- `PUT  /api/images/:filename/rename`
- `POST /api/images/:filename/cpm/files` (upload)
- `DELETE /api/images/:filename/cpm/files/:cpmFile`

The check walks all 16 drives comparing `path.basename(driveState.filename)` against the requested filename.

### Symlink-safe path resolution

`safeResolvePath(root, filename)` `realpathSync`-resolves both root and target, then verifies the resolved target begins with `resolvedRoot + sep`. That defeats a symlink planted inside the disks directory that points at `/etc/passwd`.

### Types actually shared with the CLI

The CLI at `cli/` (a separate pnpm package, `fdcplus-cli`) talks to the backend over `socket.io-client` — it consumes JSON events, not the backend's TypeScript types directly. There is no source-level type import from `src/` into `cli/src/`. The wire contract is instead the OpenAPI schema in `openapi.json` (also served at `/api/docs.json`).

If shared types ever become useful for the CLI or third-party integrations, natural extraction candidates are:
- `CpmFile`, `CpmFreeSpace`, `CpmDiskParams` — CP/M browse data
- `DriveState` — drive status shape
- `FdcError`, `FdcCommand`, `BaudRate`, `MAX_DRIVES`, `MAX_TRACK_LEN` — protocol constants
- `ReplayProgress` — transfer progress payload

---

## 15. BUILD ARTIFACTS

`tsc` emits to `dist/`:
- CommonJS `.js` files, source maps (`.js.map`), and declarations (`.d.ts`, `.d.ts.map`)
- `dist/drive.js`, `dist/cpm-filesystem.js`, `dist/protocol.js`, `dist/database.js`, `dist/web-server.js`, `dist/mcp-server.js`, `dist/routes/*.js`, `dist/services/*.js`, `dist/middleware/*.js`, `dist/gpio/*.js`, `dist/websocket/*.js`

`openapi.json` at the repo root is regenerated by `pnpm docs` (running `scripts/generate-openapi.ts`) and committed. `pnpm docs:check` fails CI if it drifts.

Debian package output lands in `build/` (the `.gitignore` covers it). `debian/rules` runs `pnpm --config.node-linker=hoisted install` so `node_modules` is a flat `npm`-style tree, then `override_dh_auto_install` stages:
- `debian/fdcsds/usr/lib/fdcsds/dist/` — compiled backend
- `debian/fdcsds/usr/lib/fdcsds/frontend/dist/` — compiled Svelte SPA (this is what `middleware/static.ts` resolves via `__dirname/../../frontend/dist`)
- `debian/fdcsds/usr/lib/fdcsds/node_modules/` — hoisted runtime tree
- `debian/fdcsds/usr/lib/fdcsds/{package.json,pnpm-lock.yaml,openapi.json}`
- `debian/fdcsds/usr/bin/fdcsds` — symlink to `/usr/lib/fdcsds/dist/index.js`

Runtime is managed by `debian/fdcsds.service` (systemd).
