# BitsBy8

<img src="images/mits-logo.svg" alt="MITS Altair 8800" width="180" align="right" />

**BitsBy8** turns a Raspberry Pi (or any Linux/macOS machine) into a disk server and virtual-machine workbench for the **MITS Altair 8800** and other **S-100** computers.

It serves virtual floppy and hard-disk images to a real Altair through its **FDC+ Enhanced Floppy Disk Controller** over a serial cable — and it can also build and boot fully **virtual S-100 machines** right in your browser, no hardware required. Everything runs from a single Svelte web UI, with a REST API and an MCP server for AI assistants on the side.

**Version:** 3.0.0-alpha · **License:** GPL-3.0 · **Platforms:** Linux (Raspberry Pi & x86), macOS

> **Note:** BitsBy8 is the product name. The Debian package and systemd service are now named `bitsby8` (the CLI is `bitsby8`, with an `fdcsds` alias kept for backward compatibility). The source repo is still `fdcplus-web`.

![BitsBy8 web UI — the Drives & Library page: four drive bays across the top, disk-image library below.](images/ui-disks.png)

---

## What it does

**Serve disks to a real Altair.** Mount up to four floppies (plus larger hard-disk images) and serve them to an unmodified Altair 8800 through its FDC+ controller over serial — or over a WebSocket link to an Altair *simulator*. Drives can be read-only or copy-on-write, and multiple machines can share the same library at once.

**Run virtual machines.** Assemble an S-100 computer from a catalog of emulated cards — CPU (8080/Z80), RAM, disk, serial, video — save it as a reusable **Machine Profile**, and boot it in the browser. Each running machine gets a live serial console, an Altair-style **front panel**, and a **video monitor** (VDM-1 character display / Cromemco Dazzler graphics). Snapshot a machine and restore it later.

**One place to drive it all.** The web UI, a full REST API, and an MCP server (90+ tools) all reach the same live state, so you can operate BitsBy8 by hand, from scripts, or from an AI assistant.

At a glance:

- 💾 **Disk serving** over real serial or WebSocket, with read-only and copy-on-write (transient / per-client "splinter") mounts you can keep, commit, or save as a new image
- 🖥️ **Virtual S-100 machines** — card catalog, machine profiles, and a run cockpit with console, front panel, and video monitor
- ⌨️ **VT102 terminal** in the browser for a real serial console or a virtual machine's console — reconnects where you left off
- 🧑‍🤝‍🧑 **Multi-client serving** so several machines (real and virtual) share one disk library
- 📼 **Cassette audio** playback
- 🤖 **AI assistant integration** via MCP (stdio or HTTP), plus OpenAPI/Swagger docs at `/api/docs`

---

## Quick start (no hardware needed)

Try the whole thing on your laptop — mount a sample disk or boot a virtual machine without an Altair in sight:

```bash
git clone <repo-url> fdcplus-web && cd fdcplus-web
pnpm install            # provisions the backend + frontend workspace
pnpm dev:all            # backend + web UI, live-reloading
open http://localhost:3000
```

Requires **Node.js 22+** and **pnpm**.

---

## Installation

### Raspberry Pi / Debian (recommended for real hardware)

Build and install the `.deb`, then run it as a systemd service:

```bash
make deb
sudo dpkg -i ../bitsby8_*.deb
sudo apt-get install -f            # pull in any missing dependencies

sudo nano /etc/bitsby8/bitsby8.config.json   # set your serial port, drives, etc.
sudo systemctl enable --now bitsby8          # start on boot and now
```

Upgrading from an older `fdcsds` install is automatic — apt supersedes it and
your config, data, and database are migrated. 

The web UI is then at `http://<pi-hostname>:3000`. See [DEBIAN-PACKAGE.md](DEBIAN-PACKAGE.md) for the full packaging guide.

### Docker

```bash
docker compose up -d      # then open the web UI (default port 3000)
```

Configuration and data persist in the mounted volume; see [`docker-compose.yml`](docker-compose.yml).

### From source

```bash
git clone <repo-url> fdcplus-web && cd fdcplus-web
pnpm install
pnpm build:all            # compile backend + build the web UI
pnpm start -- --web       # or: bitsby8 --web  (if installed globally)
```

---

## Connecting a real Altair

Wire the FDC+ controller to a USB serial adapter and point BitsBy8 at that port:

```bash
bitsby8 -p /dev/ttyUSB0 -0 disks/cpm22.dsk -w
# -p  serial port for the FDC+     -0..-3  mount a disk to a drive
# -w  enable the web interface     -b <rate>  set baud (default 230400)
```

A second serial port can drive an interactive **console terminal** in the web UI:

```bash
bitsby8 -p /dev/ttyUSB0 -0 disks/cpm22.dsk \
  --terminal-port /dev/ttyUSB1 --terminal-baud 9600 -w
```

A few setup notes:

- **Serial permissions (Linux):** add your user to the `dialout` group (`sudo usermod -aG dialout $USER`, then log out and back in).
- **Stable port names:** USB port names like `/dev/ttyUSB0` can shuffle across reboots. Run `bitsby8 --show-persistent-paths` to get a stable `/dev/serial/by-id/...` path for your config.
- **No physical FDC+?** An Altair *simulator* can connect over WebSocket instead of serial — see [docs/WS-FDC-TRANSPORT.md](docs/WS-FDC-TRANSPORT.md).

Generate a starter config any time with `bitsby8 --example-config > .bitsby8.config`, and run `bitsby8 --help` for the full option list.

---

## The web interface

Open the UI and everything is in the left sidebar:

| Section | What it's for |
|---|---|
| **Disks** | Mount/unmount images across the four drive bays, toggle read-only, browse and upload the disk library, take snapshots |
| **Virtual Machines** | Boot machine profiles and drive them in the run cockpit — serial console, Altair front panel, video monitor |
| **Card Catalog** / **Machine Profiles** | Assemble S-100 machines from emulated cards and save them as reusable profiles |
| **Terminal** | A VT102 console for a real serial port or a running virtual machine |
| **Cassettes** | Play cassette-tape audio images |
| **Disk Clients** | See and manage the machines currently sharing your disks (multi-client serving) |
| **Scripts** | Replay canned input / XMODEM transfers to a machine |
| **Config** | Server settings — serial defaults, web/API, MCP |

More detail in [docs/WEB-INTERFACE.md](docs/WEB-INTERFACE.md).

---

## AI assistant integration (MCP)

BitsBy8 ships a [Model Context Protocol](https://modelcontextprotocol.io/) server exposing 90+ tools — mount disks, drive machines, read/write CP/M files, run the terminal — to assistants like Claude Code. It's **off by default**; opt in per transport:

- **Local (stdio):** point your assistant at `bitsby8 --mcp`:
  ```json
  { "mcpServers": { "bitsby8": { "command": "bitsby8", "args": ["--mcp", "--data-dir", "/path/to/data"] } } }
  ```
- **Over the LAN (HTTP):** set an API key, then enable MCP-over-HTTP in *Config → MCP server* (or `--mcp-http`). It requires a bearer token and is intended for trusted networks — put TLS in front if you expose it.

The tools can read and **write** disk images and send bytes to real hardware, so don't point an assistant at a production machine without meaning to.

---

## Configuration

Settings live at two layers:

- **Install-time defaults** — a config file (`/etc/bitsby8/bitsby8.config.json`, or `.bitsby8.config` from source) plus CLI flags. These set up the box; changes take effect on restart.
- **Day-to-day settings** — managed live from the web UI (and REST/MCP), stored in a SQLite database in the data directory. Per-image settings like notes, write policy, and snapshots live here and apply immediately.

The data directory (`/var/lib/bitsby8` on a `.deb` install) holds your disk library, uploads, cassettes, and the database.

---

## Documentation

- [DEBIAN-PACKAGE.md](DEBIAN-PACKAGE.md) — building and installing the Debian package
- [docs/WEB-INTERFACE.md](docs/WEB-INTERFACE.md) — web UI walkthrough
- [docs/WS-FDC-TRANSPORT.md](docs/WS-FDC-TRANSPORT.md) — WebSocket disk transport for simulators
- [docs/PROTOCOL.md](docs/PROTOCOL.md) — the FDC+ serial disk protocol
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — common issues
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to contribute

---

## License

GPL-3.0.

## Credits

- **BitsBy8 software** (disk server, web interface, virtual machines, MCP server): Joe Toppe, 2024–present.
- **FDC+ Enhanced Floppy Disk Controller hardware:** Mike Douglas / [deramp.com](http://www.deramp.com). BitsBy8 talks to that controller over serial; the hardware itself is a separate product.

See [AUTHORS](AUTHORS) for the full contributor list.

## References

- [FDC+ Hardware Documentation](http://www.deramp.com)
- [Altair 8800 (Wikipedia)](https://en.wikipedia.org/wiki/Altair_8800)
- [Node.js SerialPort](https://serialport.io/)
