# Repository Guidelines

## Project Structure & Module Organization
- Source lives in `src/` with discrete modules per concern: `index.ts` (CLI entry), `server.ts` (command handling), `drive.ts` (disk I/O), `serial.ts` (FDC+ comms), `web-server.ts` (Express + Socket.IO), `ui/` (terminal UI), and `gpio/` (LED control). Compiled output lands in `dist/` via `tsc`.
- Tests sit in `test/` and target modules via `*.test.ts`. The Svelte frontend lives in `frontend/` (build output in `frontend/dist/`); demo disks live under `disks/`; hardware docs and KiCad artifacts stay under `kicad/` and `images/`.
- Configuration examples: copy `fdcsds.config.example` or pipe `fdcsds --example-config` to `.fdcsds.config` at the repo root.

## Build, Test, and Development Commands
- `pnpm install`: Provisions both backend and `frontend/` (pnpm workspace).
- `pnpm dev -- <args>`: Run TypeScript directly with ts-node for quick iteration.
- `pnpm build`: Type-check and emit JS + maps into `dist/`, then regenerate `openapi.json`.
- `pnpm start -- <args>`: Execute the compiled server from `dist/`.
- `pnpm test`: Run Jest (ts-jest preset) against `test/**/*.test.ts`; outputs coverage to `coverage/`.
- `pnpm --filter fdcplus-frontend build`: Build the Svelte SPA into `frontend/dist/`.
- Debian packaging: `make deb` builds the .deb into `build/`; `make quick-install` installs it locally. Use `make clean` or `make distclean` before release artifacts.

## Coding Style & Naming Conventions
- TypeScript, CommonJS modules, strict compiler flags enabled. Favor 2-space indentation, single quotes, and `async/await` over raw callbacks.
- Keep filenames kebab-cased (e.g., `web-server.ts`, `gpio-manager.ts`). Export types alongside implementations in the same module when practical.
- Avoid editing `dist/` directly; regenerate via `pnpm build`. Keep config path defaults (`DEFAULT_CONFIG_LOCATIONS`) in sync with CLI help output.

## Testing Guidelines
- Framework: Jest with ts-jest; node test environment. Tests live in `test/` and follow `name.test.ts`.
- Include hardware boundary tests as mocks; do not require real serial ports or GPIO in CI. Prefer deterministic fixtures under `test/fixtures` if adding new assets.
- Add coverage for new modules; run `pnpm test -- --runInBand` if serializing hardware-mock tests locally.

## Commit & Pull Request Guidelines
- Follow the existing short, imperative style (`fix package scripts`, `logos`, `kicad files...`). Keep scope small and descriptive.
- PRs should state: purpose, config used (port paths, baud, drives), expected behavior, and screenshots for UI/Web changes. Note hardware assumptions (e.g., GPIO enabled) and include repro steps for serial interactions.
- Before opening a PR: `pnpm build` and `pnpm test` should pass; include any Makefile-driven packaging steps if the change affects Debian artifacts.

## Security & Configuration Tips
- Do not commit real serial device paths, secrets, or generated disk images. Example configs are safe; production configs belong outside the repo.
- When testing GPIO or serial, prefer mock paths or virtual ports to avoid device conflicts. Document any required udev or group membership tweaks in the PR.
