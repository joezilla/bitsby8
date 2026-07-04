# Contributing to FDC+ Serial Drive Server

Thank you for considering a contribution. This project is a small, hobbyist-and-Pi-operator-targeted codebase, so the contribution process is deliberately lightweight.

## Before you start

- If you're working with an AI assistant, the load-bearing context lives in `_bmad-output/project-context.md` (locally generated, gitignored).
- The maintainer is solo. Hardware-touching PRs (serial, GPIO, FDC+ protocol) may sit until the maintainer can test on real Altair gear. Not a stall — a constraint. Account for it in expectations.

## How to send a PR

1. Fork the repo and branch from `main`. Branch names are free-form; descriptive is nice (`fix-mount-race`, `add-cassette-loop`, etc.).
2. Make your change. Keep the diff focused — one logical change per PR is easier to review.
3. Add tests if the change is testable and a test would have caught the bug.
4. Run the pre-PR gate locally:
   ```bash
   pnpm install               # provision both root and frontend/
   pnpm check                 # typecheck + lint + docs:check + test + frontend svelte-check
   pnpm build:all             # build both trees (catches build-time regressions)
   ```
   CI runs the same gate on Node 20 and 22.
5. If your change touched `@openapi` JSDoc in any `src/routes/*.ts`, run `pnpm docs` and **commit the regenerated `openapi.json`** in the same PR. `pnpm docs:check` (which runs in `pnpm check` and in CI) will fail the build otherwise.
6. Open the PR. Use the template that appears — it asks for the bits the maintainer needs to review hardware-related changes safely.

## Commit style

Follow the existing style: short imperative subject lines.

```
fix package scripts
Modernize stack: modular backend, MCP server, Svelte frontend
Migrate to pnpm workspace; repair .gitignore
```

Pair with a body when the *why* isn't obvious from the subject. One logical change per commit.

## Code style

- TypeScript everywhere. Backend is CommonJS; frontend is ESM (separate `tsconfig.json`).
- 2-space indent, single quotes, `async/await` over `.then()`.
- Filenames are kebab-case (`web-server.ts`, `cpm-filesystem.ts`).
- No `console.log` in committed backend code — use the shared `pino` logger from `src/logger.ts`.
- No ESLint config is present yet (intentional, per the project-context). Match the existing style mechanically.
- `dist/` is build output. Never hand-edit. Never commit changes from inside it.

## Domain invariants (read before touching `src/drive.ts`, `src/cpm-filesystem.ts`, or `src/protocol.ts`)

The server talks to vintage hardware that **cannot be patched**. The FDC+ wire protocol, CDBL sector format (137 bytes, 2:1 interleave), CP/M extent math, and 8-inch floppy parameters are all bit-exact requirements. The protocol-compliance tests in `test/protocol-compliance.test.ts` and the CP/M tests in `test/cpm-filesystem.test.ts` lock these. If you have to change one of these files, you must update those tests in lockstep and explain why in the PR.

## Hardware testing

- CI runs only mock-backed tests. No real serial port, no real GPIO.
- If your change is sensitive to actual hardware (timing, electrical, etc.), please describe what hardware you tested on and how.
- The serial-mock test suite has a known intermittent race; CI retries the test job once. If you're adding to that suite, prefer `--runInBand` locally.

## Reporting bugs / requesting features

Use the GitHub issue templates. For a security disclosure, see SECURITY.md (planned — for now, please email the maintainer directly rather than opening a public issue).

## License

By contributing you agree your work is licensed under **GPL-3.0**, same as the rest of the project.
