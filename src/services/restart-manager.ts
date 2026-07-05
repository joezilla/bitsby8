/**
 * Restart manager.
 *
 * Phase 1 exposes just the introspection needed by the config status
 * endpoint (are we under systemd? what's the startup epoch?). The
 * actual `restart()` implementation lands in Phase 2 alongside the
 * `Restart=always` change to the systemd unit — until then, calling
 * it would produce a dead daemon on dev / docker installs.
 */

/**
 * True if the current process was started by systemd. Determined by
 * the presence of `INVOCATION_ID` in the environment, which systemd
 * always sets for its child units.
 *
 * A `false` here means an in-app "Restart now" click can't work —
 * process.exit(0) wouldn't relaunch. The UI should render a copy-paste
 * command instead.
 */
export function isSystemdManaged(): boolean {
  return !!process.env.INVOCATION_ID;
}

/**
 * Millisecond epoch captured at module-import time. Cached so it's
 * stable across the process; the caller in `index.ts` doesn't have to
 * plumb an extra value if it doesn't want to.
 */
export const MODULE_STARTUP_EPOCH = Date.now();
