# FDC+ Console — Interactive TUI Frontend Plan

A persistent, interactive terminal application for managing the Altair 8800 FDC+ Serial Drive Server remotely from macOS. Think Claude Code, but for your Altair.

---

## 1. Concept

You launch `fdc`, it connects to your server, and you're immediately in an interactive session. The Altair terminal is your primary view. You manage drives, images, and files through **slash commands** and **hotkeys** without ever leaving the app — just like typing `/help` in Claude Code while having a conversation.

```
┌─ FDC+ Console ──────────────────────── http://pi.local:3000 ─┐
│                                                                │
│  A>dir                                                         │
│  A: ASM      COM : DDT      COM : DUMP     COM : ED       COM │
│  A: LOAD     COM : PIP      COM : STAT     COM : SUBMIT   COM │
│  A>pip b:=a:pip.com                                            │
│  A>_                                                           │
│                                                                │
│                                                                │
│                                                                │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│ A: cpm22.dsk(RO)  B: work.dsk  C: ——  D: ——   ● Serial ● Term│
├────────────────────────────────────────────────────────────────┤
│ > _                                                            │
└────────────────────────────────────────────────────────────────┘
```

**Three zones:**
1. **Terminal area** (top, fills screen) — Live VT100/ANSI passthrough to the Altair
2. **Status bar** (1 line) — Drive mounts, connection indicators, transfer progress
3. **Input line** (bottom) — Keystrokes go to Altair by default; type `/` to enter command mode

---

## 2. Two Input Modes

### Terminal Mode (default)
Every keystroke goes directly to the Altair via Socket.IO `terminal:write`. You're typing at the CP/M prompt, running MBASIC, playing games — full transparent serial passthrough. The input line shows `> _` with a blinking cursor. What you type appears in the terminal area as the Altair echoes it back.

### Command Mode (prefix with `/`)
Type `/` in the input line and it switches to command mode. The prompt changes to `/ _` and you get tab-completion, command history, and inline results. Command output appears in the terminal area (clearly delineated) before returning you to terminal mode.

**No mode toggle key needed.** Just like Claude Code — you're always in the conversation, and `/` is your escape hatch to issue commands.

### Escape Key Alternative
Press `Escape` to enter command mode without the `/` prefix. Press `Escape` again or `Enter` on empty to return to terminal mode. This is for when you want to browse, check status, etc. without sending any keystrokes to the Altair.

---

## 3. Architecture

```
┌────────────────────┐       HTTP REST + Socket.IO       ┌──────────────────────┐
│  FDC+ Console      │ ◄──────────────────────────────► │  FDC+ Web Server     │
│  (macOS app)       │       (LAN / Internet)            │  (Pi / any host)     │
│                    │                                    │                      │
│  ┌──────────────┐  │                                    │  - Express REST API  │
│  │ Terminal View │◄─┼── Socket.IO terminal:data ────────┤  - Socket.IO events  │
│  │ (ANSI pass)  │──┼── Socket.IO terminal:write ───────►│  - Serial hardware   │
│  ├──────────────┤  │                                    │                      │
│  │ Status Bar   │◄─┼── Socket.IO status (1/sec) ───────┤                      │
│  ├──────────────┤  │                                    │                      │
│  │ Command Line │──┼── REST API calls ─────────────────►│                      │
│  └──────────────┘  │                                    │                      │
└────────────────────┘                                    └──────────────────────┘
```

The app maintains a persistent Socket.IO connection for:
- Terminal data (bidirectional, real-time)
- Server status updates (every 1 second)
- Transfer progress events

REST API is used for management commands (mount, upload, config, etc.).

---

## 4. Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | Shared types with server, existing toolchain |
| TUI Framework | Custom on raw Node.js TTY | Full control over terminal rendering; no framework can do ANSI passthrough + command input well |
| Screen Management | ANSI escape sequences | Alternate screen buffer, scroll regions, cursor positioning |
| Input Handling | Raw stdin + readline for command mode | Raw mode for terminal passthrough, readline for command editing |
| WebSocket | socket.io-client | Matches server's socket.io@4.x |
| HTTP Client | Built-in `fetch` (Node 18+) | Zero-dependency, native FormData for uploads |
| Command Parser | Custom slash-command parser | Lightweight; commander.js is overkill for interactive commands |
| Tab Completion | Custom | Context-aware (image names, drive IDs, filenames) |
| Config Storage | `~/.fdcplus/config.json` | Server URL, preferences, command history |
| Packaging | pkg or bun build --compile | Single-binary for macOS |

### Why Custom TUI Instead of Blessed/Ink?

The core challenge is unique: we need to pass raw VT100/ANSI bytes from the Altair through to a specific region of the screen while simultaneously managing a status bar and command input. No existing TUI framework handles this well:

- **Blessed** tries to own the entire screen and fights with raw ANSI passthrough
- **Ink** is React-based and re-renders; can't do byte-level terminal passthrough
- **Raw approach**: Use ANSI scroll regions (`CSI;r`) to confine Altair output to the top portion, render status bar and input line in fixed positions at the bottom. This is how `screen` and `tmux` work internally.

### Key ANSI Techniques
```
ESC[1;{rows-2}r    — Set scroll region (terminal area only)
ESC[{rows-1};1H    — Position cursor at status bar
ESC[{rows};1H      — Position cursor at input line
ESC[?47h / ESC[?47l — Alternate screen buffer (enter/exit)
ESC[?25h / ESC[?25l — Show/hide cursor
```

---

## 5. Slash Commands

All commands start with `/`. Tab completion works on command names, subcommands, image names, and filenames.

### 5.1 General

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/status` | Show full server status (serial, drives, serving) |
| `/quit` or `/q` | Exit FDC+ Console |
| `/clear` | Clear terminal area |
| `/connect <url>` | Connect to a different server |
| `/disconnect` | Disconnect from server |

### 5.2 Drive Management

| Command | Description |
|---------|-------------|
| `/drives` | Show all 4 drives with mount status |
| `/mount <A-D> <image>` | Mount disk image to drive |
| `/unmount <A-D>` | Unmount drive |
| `/protect <A-D>` | Set drive read-only |
| `/unprotect <A-D>` | Set drive read-write |
| `/swap <A-D> <A-D>` | Swap images between two drives |

Example:
```
/ mount A cpm22.dsk
✓ Mounted cpm22.dsk on Drive A
/ drives
  A: ██ cpm22.dsk     (R/O)  Track 12
  B: ██ work.dsk              Track 0
  C: —
  D: —
```

### 5.3 Disk Image Management

| Command | Description |
|---------|-------------|
| `/images` | List all disk images |
| `/image create <name> [8inch\|minidisk\|8mb]` | Create blank disk image |
| `/image upload <local-path>` | Upload .dsk/.img/.ima from Mac |
| `/image clone <name>` | Clone existing disk image |
| `/image delete <name>` | Delete disk image (with confirmation) |
| `/image info <name>` | Show CP/M filesystem info |
| `/image notes <name> [text]` | View or set description |

Example:
```
/ images
  NAME              SIZE      FORMAT    DESCRIPTION
  cpm22.dsk         330 KB    8-inch    CP/M 2.2 boot disk
  work.dsk          330 KB    8-inch    Working disk
  blank.dsk         330 KB    8-inch    Empty formatted disk

/ image create mytest 8inch
✓ Created mytest.dsk (330 KB, 8-inch format)
```

### 5.4 CP/M File Operations

| Command | Description |
|---------|-------------|
| `/ls <image>` | List CP/M files on disk |
| `/get <image> <file> [local-path]` | Download CP/M file to Mac |
| `/put <image> <local-path> [--user N] [--name X]` | Upload file to CP/M disk |
| `/rm <image> <file>` | Delete CP/M file |
| `/cat <image> <file>` | Display CP/M file contents in terminal area |
| `/df <image>` | Show disk free space |

Example:
```
/ ls cpm22.dsk
  USER  FILENAME     EXT   SIZE    ATTR
  0     ASM          COM   8,192
  0     DDT          COM   5,120
  0     PIP          COM   7,168   R/O
  9 files, 291 KB free, 48 dir entries free

/ get cpm22.dsk PIP.COM ~/Downloads/
✓ Downloaded PIP.COM (7,168 bytes) → ~/Downloads/PIP.COM

/ put work.dsk ./MYPROG.COM --user 0
✓ Uploaded MYPROG.COM (2,048 bytes) to work.dsk
```

### 5.5 Terminal Connection

| Command | Description |
|---------|-------------|
| `/terminal open [--port X] [--baud N]` | Open terminal serial connection |
| `/terminal close` | Close terminal connection |
| `/terminal status` | Show terminal port info |
| `/ports` | List available serial ports on server |
| `/baud <rate>` | Quick-change terminal baud rate |
| `/dtr` | Toggle DTR signal |
| `/rts` | Toggle RTS signal |

### 5.6 Script & Transfer

| Command | Description |
|---------|-------------|
| `/scripts` | List available scripts |
| `/script show <name>` | Display script content |
| `/script create <name>` | Create script (opens inline editor) |
| `/script edit <name>` | Edit script (opens in $EDITOR) |
| `/script upload <local-path>` | Upload script file |
| `/script delete <name>` | Delete script |
| `/replay <script> [options]` | Replay script to terminal |
| `/replay cancel` | Cancel active transfer |
| `/xmodem <script> [--crc]` | Send file via XMODEM |

Replay options: `--line-ending cr|lf|crlf` `--chunk N` `--byte-delay N` `--line-delay N`

During transfers, the status bar shows live progress:
```
├────────────────────────────────────────────────────────────────┤
│ ▶ Replaying loader.txt  [████████████░░░░░░░░] 62%  1.9K/3.1K│
├────────────────────────────────────────────────────────────────┤
```

### 5.7 Cassette

| Command | Description |
|---------|-------------|
| `/cassettes` | List cassette files |
| `/cassette upload <local-path>` | Upload WAV file |
| `/cassette play <name>` | Play on server (progress in status bar) |
| `/cassette stop` | Stop playback |
| `/cassette delete <name>` | Delete cassette |

### 5.8 Configuration

| Command | Description |
|---------|-------------|
| `/config` | Show server configuration |
| `/config set <key> <value>` | Update config value |
| `/serial [--port X] [--baud N]` | Configure primary FDC+ serial |
| `/serving on` | Enable disk serving |
| `/serving off` | Disable disk serving |
| `/keymap <profile>` | Switch key mapping (vt102, cpm, mac, etc.) |

### 5.9 Shortcuts (Convenience Aliases)

| Short | Equivalent |
|-------|-----------|
| `/m A cpm22.dsk` | `/mount A cpm22.dsk` |
| `/u A` | `/unmount A` |
| `/d` | `/drives` |
| `/i` | `/images` |
| `/s` | `/status` |
| `/p` | `/ports` |

---

## 6. Hotkeys

Hotkeys work in terminal mode (no `/` prefix needed). These use modifier keys that don't conflict with typical VT100 sequences the Altair would expect.

| Hotkey | Action |
|--------|--------|
| `Escape` | Toggle command mode (focus input line for commands) |
| `Ctrl+Q` | Quit (with confirmation if drives mounted) |
| `Ctrl+L` | Clear terminal area |
| `Ctrl+G d` | Show drives (chord: Ctrl+G then d) |
| `Ctrl+G s` | Show status |
| `Ctrl+G i` | Show images |
| `Ctrl+G 1-4` | Quick-mount last image on drive A-D |
| `Ctrl+G p` | Show transfer progress |
| `Ctrl+G ?` | Show hotkey help |

**Chord system:** `Ctrl+G` is the prefix key (like `Ctrl+A` in screen). After pressing `Ctrl+G`, the next key determines the action. This avoids stealing single-modifier keys from the Altair terminal.

---

## 7. Screen Layout & Rendering

### Full-Screen Layout
```
┌─ FDC+ Console ──────────────────────── http://pi.local:3000 ─┐  ← Title bar (row 1)
│                                                                │
│  [Terminal area - ANSI scroll region rows 2 to N-2]            │  ← Altair VT100 output
│  Everything from the Altair appears here exactly as if         │
│  you were on a real serial terminal. Cursor positioning,       │
│  line drawing, inverse video — all passed through.             │
│                                                                │
│                                                                │
│  A>_                                                           │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│ A: cpm22(RO) B: work  C: ——  D: ——  ● Ser ● Term  12:34:56  │  ← Status bar (row N-1)
├────────────────────────────────────────────────────────────────┤
│ > _                                                            │  ← Input line (row N)
└────────────────────────────────────────────────────────────────┘
```

### Rendering Strategy

1. **Enter alternate screen** on startup (`ESC[?1049h`) — preserves user's scrollback
2. **Set scroll region** to rows 2 through (height - 2): `ESC[2;{h-2}r`
3. **Terminal area**: All Socket.IO `terminal:data` bytes are written directly to stdout while cursor is positioned within the scroll region. The scroll region ensures Altair output stays confined and scrolls naturally within its zone.
4. **Status bar**: Rendered at row (height - 1) using absolute cursor positioning. Updated on Socket.IO `status` events (every 1s). Does not scroll.
5. **Input line**: Rendered at row (height). In terminal mode, keystrokes are forwarded via Socket.IO. In command mode, readline-style editing with history and tab completion.
6. **Command output**: When a slash command produces output (e.g., `/images` listing), it's written into the terminal area (within the scroll region), preceded and followed by a dim separator line. The Altair output continues below it seamlessly.
7. **Resize handling**: Listen for `SIGWINCH`, recalculate scroll region, redraw status bar and input line.
8. **Exit**: Restore scroll region, leave alternate screen (`ESC[?1049l`), restore cursor.

### Command Output in Terminal Area

When you run a command like `/drives`, the output appears inline in the terminal area:

```
A>dir
A: ASM      COM : DDT      COM : DUMP     COM
───────────────────────── /drives ───────────────────────────
  A: ██ cpm22.dsk     (R/O)  Track 12
  B: ██ work.dsk              Track 0
  C: —
  D: —
─────────────────────────────────────────────────────────────
A>_
```

This keeps everything in context. You can scroll back to see previous command output mixed with your Altair session.

---

## 8. Status Bar Design

The status bar packs maximum info into one line, updating every second:

### Normal State
```
A:cpm22(RO) B:work C:—— D:——  ●Ser ●Term 9600  12:34:56
```

### During Transfer
```
A:cpm22(RO) B:work C:—— D:——  ▶loader.txt ████░░ 62%  ●Ser
```

### Disconnected
```
◌ Disconnected from http://pi.local:3000    Ctrl+G ? for help
```

### Status Indicators
- `●` Green — connected/active
- `◌` Dim — disconnected/inactive
- `██` — drive mounted
- `——` — drive empty
- `(RO)` — read-only
- `▶` — transfer in progress

---

## 9. Startup Flow

```bash
$ fdc                                    # Connect to default server
$ fdc http://pi.local:3000              # Connect to specific server
$ fdc --server pi.local --port 3000     # Explicit host and port
```

### First Launch
```
$ fdc http://pi.local:3000
Connecting to http://pi.local:3000...
● Connected to FDC+ Server v2.0.0

No terminal port configured. Available ports:
  1. /dev/ttyUSB0 — FTDI FT232R (recommended)
  2. /dev/ttyUSB1 — Prolific PL2303

Select port for terminal [1]: 1
Baud rate [9600]: 9600

● Terminal connected: /dev/ttyUSB0 @ 9600 8N1
Saved to ~/.fdcplus/config.json

Type to interact with the Altair. Press Escape or type / for commands.
─────────────────────────────────────────────────────────────────

A>_
```

### Subsequent Launches
```
$ fdc
● Connected to http://pi.local:3000
● Terminal: /dev/ttyUSB0 @ 9600 8N1
─────────────────────────────────────────────────────────────────

A>_
```

Auto-connects to saved server and terminal port. Immediately ready.

---

## 10. Tab Completion

Context-aware tab completion in command mode:

| Context | Completes |
|---------|-----------|
| `/` | Command names (`mount`, `images`, `ls`, ...) |
| `/mount A ` | Disk image filenames (fetched from server) |
| `/ls ` | Disk image filenames |
| `/get cpm22.dsk ` | CP/M filenames on that disk |
| `/rm cpm22.dsk ` | CP/M filenames on that disk |
| `/replay ` | Script names |
| `/cassette play ` | Cassette filenames |
| `/keymap ` | Profile names (vt102, cpm, mac, ...) |
| `/config set ` | Config key names |

Tab completion data is cached from server responses and refreshed on use.

---

## 11. Project Structure

```
cli/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                 # Entry point, arg parsing, launch
│   ├── app.ts                   # Main application controller
│   ├── client.ts                # FdcClient (REST + Socket.IO)
│   ├── config.ts                # ~/.fdcplus/config.json management
│   ├── screen/
│   │   ├── renderer.ts          # Screen layout, scroll regions, redraws
│   │   ├── terminal-area.ts     # ANSI passthrough for Altair data
│   │   ├── status-bar.ts        # Status bar rendering and updates
│   │   └── input-line.ts        # Input handling, mode switching, readline
│   ├── commands/
│   │   ├── registry.ts          # Command registration and dispatch
│   │   ├── drives.ts            # /drives, /mount, /unmount, /protect
│   │   ├── images.ts            # /images, /image create|upload|clone|delete
│   │   ├── cpm.ts               # /ls, /get, /put, /rm, /cat, /df
│   │   ├── terminal.ts          # /terminal open|close|status, /ports, /baud
│   │   ├── scripts.ts           # /scripts, /script, /replay, /xmodem
│   │   ├── cassettes.ts         # /cassettes, /cassette play|stop|upload
│   │   ├── config-cmd.ts        # /config, /serial, /serving, /keymap
│   │   └── general.ts           # /help, /status, /quit, /clear, /connect
│   ├── completion.ts            # Tab completion engine
│   ├── history.ts               # Command history (persistent)
│   ├── keymaps.ts               # Key mapping profiles
│   └── types/
│       └── index.ts             # Shared types
├── test/
│   ├── client.test.ts
│   ├── screen/
│   │   └── renderer.test.ts
│   ├── commands/
│   │   └── *.test.ts
│   └── completion.test.ts
└── bin/
    └── fdc                      # #!/usr/bin/env node
```

### Monorepo Layout (Recommended)
```
fdcplus-web/
├── src/                 # Server source (existing)
├── cli/                 # CLI source (new)
│   ├── src/
│   └── package.json
├── shared/              # Shared types extracted
│   └── types.ts
├── public/              # Web SPA (existing)
└── package.json         # Workspace root
```

---

## 12. Core Client Module

Same `FdcClient` class from the original plan — this doesn't change. It encapsulates all REST and Socket.IO communication. The difference is that instead of being called by individual CLI commands that exit, it's a long-lived instance managed by the `App` controller.

```typescript
class App {
  private client: FdcClient;
  private screen: ScreenRenderer;
  private input: InputLine;
  private commands: CommandRegistry;
  private mode: 'terminal' | 'command';

  constructor(serverUrl: string);

  async start(): Promise<void>;       // Connect, setup screen, enter main loop
  async shutdown(): Promise<void>;    // Cleanup, restore terminal

  // Input routing
  handleKeystroke(key: Buffer): void; // Route to terminal or command mode
  handleCommand(line: string): void;  // Parse and execute slash command

  // Screen updates
  onTerminalData(data: number[]): void;    // Write to terminal area
  onStatusUpdate(status: ServerStatus): void; // Update status bar
  onReplayProgress(progress: ReplayProgress): void; // Update status bar
}
```

### Lifecycle

```
fdc launched
  → Parse args (server URL)
  → Load config from ~/.fdcplus/config.json
  → Create FdcClient, connect Socket.IO
  → Enter alternate screen buffer
  → Set scroll region
  → Draw status bar and input line
  → Auto-open terminal if configured
  → Enter main loop (stdin → keystroke handler)
  → ...user interacts...
  → /quit or Ctrl+Q
  → Close terminal connection
  → Disconnect Socket.IO
  → Leave alternate screen buffer
  → Exit
```

---

## 13. macOS Packaging & Distribution

Same as original plan:

| Phase | Method | Details |
|-------|--------|---------|
| Phase 1 | npm global install | `npm install -g fdcplus-cli` → `fdc` command |
| Phase 2 | Single binary | `pkg` or `bun build --compile` for macOS arm64/x64 |
| Phase 3 | Homebrew | `brew install fdcplus-cli` |

---

## 14. Feature Parity Matrix

| Web Feature | Console Equivalent | Priority |
|------------|-------------------|----------|
| Terminal emulator (VT102) | Primary view — raw ANSI passthrough | P0 |
| Drive mount/unmount | `/mount`, `/unmount`, `/drives` | P0 |
| Drive status | Status bar (live) + `/drives` | P0 |
| Disk image list/create | `/images`, `/image create` | P0 |
| Disk image upload | `/image upload` | P0 |
| CP/M file browser | `/ls`, `/get`, `/put`, `/rm` | P0 |
| Serial port config | `/serial`, `/ports` | P0 |
| Disk serving toggle | `/serving on\|off` | P0 |
| Live status updates | Status bar (Socket.IO, 1/sec) | P0 |
| Script replay (raw) | `/replay <script>` with progress | P1 |
| Script replay (XMODEM) | `/xmodem <script>` | P1 |
| Script create/edit | `/script create\|edit` ($EDITOR) | P1 |
| Cassette playback | `/cassette play\|stop` | P1 |
| Transfer progress | Status bar progress indicator | P1 |
| Tab completion | Context-aware on commands + names | P1 |
| Command history | Up/Down arrows, persistent | P1 |
| Server config | `/config show\|set` | P2 |
| Image clone/delete/notes | `/image clone\|delete\|notes` | P2 |
| Key mapping profiles | `/keymap` | P2 |
| DTR/RTS control | `/dtr`, `/rts` | P2 |
| CRT visual effects | N/A (visual only) | Skip |
| Dark/light theme | N/A (terminal handles this) | Skip |
| Mobile touch/vibration | N/A | Skip |
| Client-side cassette play | N/A (browser audio) | Skip |
| ROMs page | N/A (stub in web) | Skip |
| Notes page | N/A (stub in web) | Skip |

---

## 15. Implementation Phases

### Phase 1: Shell + Terminal Passthrough (Week 1-2)
The hardest part first — get the screen working.

1. Project scaffolding (cli/, tsconfig, package.json)
2. `FdcClient` class — Socket.IO connect, REST fetch wrapper
3. `ScreenRenderer` — alternate screen, scroll regions, resize handling
4. `TerminalArea` — ANSI passthrough from `terminal:data` events
5. `StatusBar` — renders from `status` events (drives, connections)
6. `InputLine` — raw mode keystroke forwarding to `terminal:write`
7. Mode switching — Escape and `/` toggle to command mode
8. `/quit`, `/help`, `/clear`, `/status` commands
9. Startup flow — connect, auto-open terminal
10. Config file — `~/.fdcplus/config.json` persistence

**Milestone:** Launch `fdc`, see Altair terminal, type commands, see status bar updating.

### Phase 2: Drive & Image Commands (Week 3-4)
1. `/drives`, `/mount`, `/unmount`, `/protect`, `/unprotect`
2. `/images`, `/image create`, `/image info`
3. `/image upload` — file upload with progress
4. `/image clone`, `/image delete` (with confirmation prompt)
5. Tab completion engine — command names, image filenames
6. Command history — up/down arrows, persistent to disk
7. `/ports`, `/serial`, `/baud` — serial configuration
8. `/serving on|off` — disk serving control

**Milestone:** Full drive and image management without leaving the app.

### Phase 3: CP/M Files + Scripts + Transfers (Week 5-6)
1. `/ls`, `/get`, `/put`, `/rm`, `/cat`, `/df` — CP/M file operations
2. Tab completion for CP/M filenames (lazy-loaded per disk)
3. `/scripts`, `/script show|create|edit|upload|delete`
4. `/replay` with options — raw mode transfer
5. `/xmodem` — XMODEM transfer mode
6. Status bar transfer progress (from `replay:progress` events)
7. `/replay cancel`
8. `/cassettes`, `/cassette upload|play|stop|delete`

**Milestone:** Complete feature parity with web UI.

### Phase 4: Polish + Packaging (Week 7-8)
1. `/image notes`, `/cassette notes` — metadata editing
2. `/keymap` — key mapping profile switching
3. `/dtr`, `/rts` — signal control
4. Chord hotkeys (`Ctrl+G` prefix)
5. Error handling — connection drops, reconnection, server errors
6. `--json` flag for scripted/piped usage (non-interactive mode)
7. Single-binary packaging (pkg or bun)
8. README, man page
9. GitHub Actions CI

**Milestone:** Polished, packaged, ready for distribution.

---

## 16. Testing Strategy

### Unit Tests
- `FdcClient` methods with mocked HTTP/Socket.IO
- `ScreenRenderer` — scroll region calculations, resize
- `InputLine` — mode switching, command parsing
- `CommandRegistry` — dispatch, argument parsing
- Tab completion — completion candidates for various contexts
- Command history — load/save/navigate

### Integration Tests
- Start real server, launch CLI, verify Socket.IO connection
- Mount/unmount lifecycle through commands
- CP/M file upload/download round-trip
- Transfer progress tracking

### Manual Testing
- [ ] Launch, connect to remote server over LAN
- [ ] Type at Altair CP/M prompt through terminal passthrough
- [ ] Run `/drives` — see output in terminal area, return to terminal mode
- [ ] Mount/unmount via `/mount A cpm22.dsk`
- [ ] Status bar updates in real-time
- [ ] Tab-complete image names in `/mount`
- [ ] Upload file via `/image upload ./local.dsk`
- [ ] Browse CP/M files via `/ls cpm22.dsk`
- [ ] Download CP/M file via `/get cpm22.dsk PIP.COM`
- [ ] Run script replay with progress in status bar
- [ ] Resize terminal window — layout adjusts
- [ ] Disconnect/reconnect gracefully
- [ ] Single binary runs on clean macOS

---

## 17. Example Session

```
$ fdc http://pi.local:3000
● Connected to FDC+ Server v2.0.0
● Terminal: /dev/ttyUSB1 @ 9600 8N1

64K CP/M VERS 2.2

A>dir
A: ASM      COM : DDT      COM : DUMP     COM : ED       COM
A: LOAD     COM : PIP      COM : STAT     COM : SUBMIT   COM

A>stat *.*
 Recs  Bytes  Ext  Acc
   64     8K    1  R/O A:ASM.COM
   40     6K    1  R/O A:DDT.COM
    4     2K    1  R/O A:DUMP.COM
Bytes Remaining On A: 216K

/ images                                              ← User types /images
───────────────────────── /images ──────────────────────────
  NAME              SIZE      FORMAT    DESCRIPTION
  cpm22.dsk         330 KB    8-inch    CP/M 2.2 boot disk
  work.dsk          330 KB    8-inch    Working disk
  games.dsk         330 KB    8-inch    Altair games
────────────────────────────────────────────────────────────

/ mount B games.dsk                                   ← Mount games disk
✓ Mounted games.dsk on Drive B

A>b:                                                  ← Back to Altair
B>dir
B: STARTREK BAS : CHASE    BAS : WUMPUS   BAS

/ ls games.dsk                                        ← Check files
───────────────────────── /ls games.dsk ────────────────────
  USER  FILENAME     EXT    SIZE    ATTR
  0     STARTREK     BAS    12,288
  0     CHASE        BAS    4,096
  0     WUMPUS       BAS    2,048
  3 files, 305 KB free
────────────────────────────────────────────────────────────

B>mbasic startrek                                     ← Back to playing
                    SUPER STAR TREK
```

---

## 18. Open Questions

1. **Scroll region vs full redraw?** Scroll regions are more efficient but some terminal emulators handle them differently. May need a fallback.
2. **Command output location** — inline in terminal area (proposed) vs. a temporary overlay panel that dismisses? Inline is simpler and preserves context.
3. **Binary name?** `fdc`, `fdcplus`, `altair`?
4. **Should `/` at the start of a line be configurable?** Some users might want a different prefix to avoid conflicts with CP/M commands.
5. **Offline mode?** Should there be a mode that reads local .dsk files without a server for CP/M file management?
6. **Multiple server connections?** Named profiles in config, switch with `/connect <name>`.
