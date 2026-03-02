# FDC+ Console

Interactive terminal client for the Altair 8800 FDC+ Serial Drive Server. Connects to a running FDC+ web server over the network and provides a full-screen TUI that combines direct Altair terminal access with slash-command management of drives, disk images, scripts, and file transfers.

```
+-------------------------------------------------------+
| FDC+ Console  http://pi.local:3000                    |  <- Title bar
|                                                       |
|  A>dir                                                |
|  A: ASM     COM : DDT     COM : DUMP    COM           |
|  A: ED      COM : LOAD    COM : PIP     COM           |  <- Terminal area
|  A: STAT    COM : SUBMIT  COM : XSUB    COM           |     (Altair serial
|  A>                                                   |      passthrough)
|                                                       |
| A:cpm22 B:work C:—— D:——  ●Ser ●Term       14:32:07  |  <- Status bar
| >                                                     |  <- Input line
+-------------------------------------------------------+
```

## Requirements

- Node.js 18+
- A running FDC+ web server (the main `fdcplus-web` project)

## Installation

```sh
cd cli
npm install
npm run build
```

To make the `fdc` command available globally:

```sh
npm link
```

## Connecting to a Server

The server URL can be provided in several ways (highest priority first):

| Method | Example |
|--------|---------|
| CLI argument | `fdc http://pi.local:3000` |
| `--server` / `-s` flag | `fdc -s 192.168.1.50:3000` |
| `FDC_SERVER` env var | `export FDC_SERVER=http://pi.local:3000` |
| Config file | `~/.fdcplus/config.json` (`defaultServer` field) |
| Default | `http://localhost:3000` |

### Examples

```sh
# Connect to a server on the local machine
fdc

# Connect to a Raspberry Pi on the network
fdc http://pi.local:3000

# Connect using the flag form
fdc -s 192.168.1.50:3000

# Set a default server for all sessions
export FDC_SERVER=http://pi.local:3000
fdc
```

## Usage

Once connected, the terminal area displays the live Altair serial output. Everything you type is sent directly to the Altair -- you are talking to CP/M (or whatever is running on the machine) in real time.

### Input Modes

The client has two input modes:

**Terminal mode** (default) -- Keystrokes are forwarded to the Altair serial port. This is where you interact with CP/M, run programs, etc.

**Command mode** -- Type slash commands to manage drives, images, scripts, and transfers. Enter command mode by pressing `/` or `Escape`. Press `Escape` again (or `Enter` on an empty line) to return to terminal mode.

### Key Bindings

| Key | Terminal Mode | Command Mode |
|-----|--------------|--------------|
| `/` | Enter command mode | Types `/` |
| `Escape` | Enter command mode | Return to terminal mode |
| `Ctrl+Q` | Quit | -- |
| `Enter` | -- | Execute command |
| `Tab` | -- | Autocomplete command |
| `Up/Down` | -- | Command history |
| `Left/Right` | -- | Move cursor in command buffer |

## Commands

### General

| Command | Aliases | Description |
|---------|---------|-------------|
| `/help` | `?` | Show all available commands |
| `/status` | `s` | Show server connection and drive summary |
| `/drives` | `d` | Show drive mount status with track positions |
| `/clear` | | Clear the terminal area |
| `/quit` | `q`, `exit` | Exit the client |

### Drive Management

| Command | Aliases | Description |
|---------|---------|-------------|
| `/mount <A-D> <image>` | `m` | Mount a disk image on a drive |
| `/unmount <A-D>` | `u`, `umount` | Unmount a drive |
| `/protect <A-D>` | `ro` | Set a drive to read-only |
| `/unprotect <A-D>` | `rw` | Set a drive to read-write |
| `/swap <A-D> <A-D>` | | Swap images between two drives |

Drives are addressed by letter (`A`-`D`) or number (`0`-`3`).

```
/mount A cpm22.dsk
/mount B work.dsk
/protect A
/swap A B
/unmount B
```

### Disk Images

| Command | Aliases | Description |
|---------|---------|-------------|
| `/images` | `i` | List all disk images with sizes |
| `/image create <name> [format]` | | Create a blank image (`8inch`, `minidisk`, `8mb`) |
| `/image clone <name>` | | Clone an existing image |
| `/image delete <name>` | | Delete an image |
| `/image info <name>` | | Show CP/M filesystem info (files, free space, format) |

```
/images
/image create scratch 8inch
/image clone cpm22.dsk
/image info work.dsk
/image delete scratch.dsk
```

### Scripts & Replay

| Command | Aliases | Description |
|---------|---------|-------------|
| `/scripts` | `sc` | List available scripts |
| `/script show <name>` | | Display script content |
| `/script upload <path>` | | Upload a local file as a script |
| `/script delete <name>` | | Delete a script |
| `/replay <name> [options]` | `r` | Replay a script to the Altair terminal |
| `/replay cancel` | | Cancel a running replay |
| `/replay status` | | Show current replay progress |
| `/xmodem <name> [--crc]` | `xm` | Send a file via XMODEM transfer |

Replay options:

| Option | Description |
|--------|-------------|
| `--delay N` | Inter-byte delay in milliseconds |
| `--line-delay N` | Inter-line delay in milliseconds |
| `--ending cr\|lf\|crlf\|raw` | Line ending conversion |
| `--chunk N` | Chunk size in bytes |

```
/scripts
/replay bootstrap.txt --delay 5 --ending cr
/replay status
/replay cancel
/xmodem program.com --crc
```

During a replay, the status bar shows a progress indicator with filename and percentage.

## Status Bar

The status bar (second row from the bottom) shows at a glance:

- **Drive indicators** -- `A:cpm22 B:work C:—— D:——` with `(RO)` for read-only drives
- **Connection status** -- Green/dim dots for serial port and terminal connections
- **Clock or replay progress** -- Current time, or a progress bar during file transfers

## Architecture

```
cli/
  bin/fdc              Entry point (shebang wrapper)
  src/
    index.ts           CLI argument parsing, launches App
    app.ts             Main controller, wires all components
    client.ts          REST + Socket.IO client (all server APIs)
    config.ts          ~/.fdcplus/config.json management
    history.ts         Persistent command history (~/.fdcplus/history)
    types/index.ts     TypeScript interfaces mirroring server API
    screen/
      renderer.ts      ANSI alternate screen buffer + scroll regions
      terminal-area.ts Altair serial data passthrough
      status-bar.ts    Inverse-video status line
      input-line.ts    Dual-mode input handler
    commands/
      registry.ts      Command registration and dispatch
      general.ts       help, status, drives, clear, quit
      drives.ts        mount, unmount, protect, images, swap
      scripts.ts       scripts, replay, xmodem
```

The TUI uses raw ANSI escape sequences (no curses/blessed dependency) to manage an alternate screen buffer with a scroll region for the terminal area. The Altair's own VT100 output passes through unmodified. The client communicates with the FDC+ server over Socket.IO for real-time serial data and REST for management operations.

## Configuration

Settings are stored in `~/.fdcplus/config.json`:

```json
{
  "defaultServer": "http://pi.local:3000"
}
```

Command history is persisted in `~/.fdcplus/history` (last 500 commands).

## License

GPL-3.0
