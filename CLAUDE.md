# fdcplus-web

Altair 8800 FDC+ Serial Drive Server: serves virtual floppy/hard-disk images to
a real (or emulated) Altair over serial or a WebSocket FDC transport, with a
Svelte web UI, a REST API, and an MCP server.

## Configuration conventions

Settings live at two layers, and the layer decides *where* they are managed:

- **Global defaults → CLI flags + config files** (`/etc/fdcsds/fdcsds.config`,
  `{dataDir}/fdcsds.overrides.json`). Treat these as **installation-time
  defaults**. Section PUTs (`PUT /api/config/:section`) persist to the override
  file and are **restart-required** — they do not live-mutate the running
  daemon. Do not reach for the CLI/config file to change day-to-day behavior;
  it's for provisioning the box.
- **Runtime, operator-facing settings → the web UI + REST/MCP**, backed by the
  SQLite database (`{dataDir}/fdcplus.db`). These apply live. Per-image settings
  (notes, read-only-write policy, snapshots) live here and override the global
  default.

When adding an operator-facing setting, prefer a live, DB-backed control surfaced
in the UI over a config-file knob. Reserve config-file/CLI knobs for global
install-time defaults.

### Read-only-write policy (transient copy-on-write) — worked example

- Global default: `readonlyWritePolicy` (`error` | `transient`) in the Serial
  config section — install-time default, managed from the **Disks page settings
  modal** in the UI (restart-required).
- Per-image override: `disk_policies` table (`inherit` | `error` | `transient`),
  managed live from the disk's Edit modal; per-image wins over the global default.

## Checks

`pnpm run check` runs the full gate: backend `tsc`, `docs:check` (OpenAPI spec is
generated from route JSDoc via `pnpm run docs` and committed — regenerate it when
routes change), the Jest suite, and the frontend `svelte-check`. Run it before
committing backend/route changes.
