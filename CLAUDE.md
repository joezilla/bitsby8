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

### Keeping copy-on-write changes

A transient/splinter scratch is discarded on unmount/disconnect unless kept. "Keep"
actions are shared by REST + MCP + UI:

- **Global transient drive** (operator's own read-only mount): `transient-service`
  → `POST /api/drives/:id/transient/{commit,save-snapshot}`, surfaced in the Disks
  page eject modal.
- **Per-client splinter** (multi-client `.splinter/<clientId>/drive<N>.img`, tracked
  in `client_splinters`): `splinter-service` →
  `POST /api/clients/:clientId/drives/:drive/splinter/{commit,save-snapshot,save-as-disk}`,
  surfaced on the Clients page when a drive shows `dirty`. Acts on the DB-recorded
  splinter file, so it works whether or not the client is connected.

**Splinter commit is a hot base-swap.** It atomically replaces the master, then
reloads every open handle via the existing swap-window + mount-epoch machinery —
operator drives through `DriveManager.reloadDrive` (which reuses `mountDrive`'s
close→swap-window→reopen), client sessions through `connectionManager.syncAll()`.
Splinters re-attach by base *name* (`DriveSession.openDrive` compares `base_filename`,
not content), so every client keeps its own writes; only readers of the base pick up
the new bytes. Commit is refused (409) only when the base is held **read-write** by a
live master-write path — an operator drive mounted RW/non-transient, or the connected
`writeMaster` client — since its in-flight write would be orphaned by the rename
(`baseWritableByLiveMaster`). An operator RO+transient view of the base has its scratch
re-cut from the committed bytes on reload. `save-as-disk` is the non-destructive
alternative: it copies the splinter to a new named image and never touches the base.

## Checks

`pnpm run check` runs the full gate: backend `tsc`, `docs:check` (OpenAPI spec is
generated from route JSDoc via `pnpm run docs` and committed — regenerate it when
routes change), the Jest suite, and the frontend `svelte-check`. Run it before
committing backend/route changes.
