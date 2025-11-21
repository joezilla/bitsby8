# Repository Guidelines

## Project Structure & Module Organization
- Source lives in `src/`: runtime entry (`index.ts`), server loop (`server.ts`), disk I/O (`drive.ts`), serial pipeline (`serial.ts`/`terminal-serial.ts`), web API/UI (`web-server.ts`, `public/` assets), GPIO LEDs (`src/gpio/`), and terminal UI (`src/ui/`).
- Tests sit in `test/*.test.ts`; fixtures like disk images are under `disks/`. Built output goes to `dist/`; npm bin is `dist/index.js` (`fdcsds`).
- Configuration templates: `fdcsds.config.example` and generated configs searched at `.fdcsds.config`, `.config/fdcsds.json`, or `fdcsds.config.json`.

## Build, Test, and Development Commands
- `npm install`: install dependencies (Node 18+).
- `npm run dev -- -p /dev/ttyUSB0 -0 disks/test.dsk`: run TypeScript directly via ts-node with CLI flags.
- `npm run build`: type-check and emit JS to `dist/`.
- `npm start -- -p …`: run compiled server.
- `npm test`: execute Jest suite (ts-jest) with coverage written to `coverage/`.
- Debian packaging helpers: `make build`, `make deb`, `make validate`, `make deb-clean`; use when preparing Raspbian/packaged installs.

## Coding Style & Naming Conventions
- TypeScript with `strict` compiler settings; keep modules CommonJS-compatible.
- Prefer 2-space indentation, single quotes, and explicit return types on exported functions.
- Organize exports per feature (e.g., `getSerialPortManager`, `getGpioLedController`); keep CLI/config parsing in `config.ts` and `index.ts`.
- Run `npm run build` before pushing to catch type/consistency issues; no formatter is enforced, so match existing style.

## Testing Guidelines
- Tests live in `test/` and use `*.test.ts` naming. Focus on protocol edges, GPIO behavior, and serial path stubs rather than hardware devices.
- `npm test` collects coverage from `src/**/*.ts`; add tests for new modules and adjust mocks to avoid touching real serial/GPIO hardware.
- If a change requires device access, document how to reproduce with the target port and baud settings in the PR.

## Commit & Pull Request Guidelines
- Commit messages follow short, imperative summaries (e.g., “Fix GPIO activity LED init”) as seen in repo history.
- PRs should include: intent summary, key CLI/config changes, test results (`npm test`, `npm run build`, or relevant `make` targets), and notes on platform impact (serial port, GPIO, web UI).
- Link issues when applicable and add screenshots or logs for web/UI or terminal changes.

## Configuration & Security Notes
- Do not commit real serial port paths or private disk images; use `disks/test.dsk` examples.
- Favor config files (`fdcsds.config.json` variants) for repeatable setups; keep secrets or privileged paths out of source control.
