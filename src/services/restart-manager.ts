/**
 * Restart manager.
 *
 * Exposes `isSystemdManaged()` for the config status endpoint and
 * `scheduleRestart()` for `POST /api/config/restart`. The strategy is
 * "clean exit + systemd Restart=always" (see debian/fdcsds.service).
 * We never call systemctl or shell out — the daemon just terminates
 * itself and systemd relaunches it.
 *
 * Under any environment where systemd isn't managing the process
 * (dev/docker), `scheduleRestart()` returns false without exiting and
 * the caller renders a copy-paste command instead. That's honest:
 * killing the process without a supervisor would just leave the
 * operator with a dead daemon they can't reach from the UI.
 */

/**
 * True if the current process was started by systemd. Determined by
 * the presence of `INVOCATION_ID` in the environment, which systemd
 * always sets for its child units.
 */
export function isSystemdManaged(): boolean {
  return !!process.env.INVOCATION_ID;
}

/**
 * Millisecond epoch captured at module-import time.
 */
export const MODULE_STARTUP_EPOCH = Date.now();

/**
 * Exit code the daemon uses to ask systemd to STOP it (not relaunch).
 * The unit sets `RestartPreventExitStatus=42`, so exiting with this code
 * overrides `Restart=always` and leaves the service inactive — the
 * systemd-native "stop" that needs no systemctl call or extra privilege
 * (the daemon runs as a hardened, non-root, NoNewPrivileges unit).
 */
export const SHUTDOWN_EXIT_CODE = 42;

/**
 * Schedule a graceful process exit so systemd relaunches the daemon.
 * Returns `false` when the process isn't systemd-managed — the caller
 * should surface a copy-paste command in that case rather than pretend
 * the restart happened.
 *
 * The delay gives the response a chance to flush over the socket
 * before the process disappears. 500 ms is more than enough for a
 * local UI and short enough that the operator's browser reconnects
 * before the "restart in progress" spinner feels stale.
 */
export function scheduleRestart(delayMs = 500): boolean {
  if (!isSystemdManaged()) return false;

  setTimeout(() => {
    console.log('[restart-manager] exiting so systemd can relaunch the daemon');
    process.exit(0);
  }, delayMs);

  return true;
}

/**
 * Schedule a graceful STOP: exit with {@link SHUTDOWN_EXIT_CODE} so systemd
 * leaves the daemon down (via `RestartPreventExitStatus`) instead of
 * relaunching it. Returns `false` when not systemd-managed — the caller
 * should surface a copy-paste `systemctl stop` command instead of pretending
 * the daemon stopped (killing an unsupervised process would just leave a
 * dead daemon the operator can't reach from the UI).
 */
export function scheduleShutdown(delayMs = 500): boolean {
  if (!isSystemdManaged()) return false;

  setTimeout(() => {
    console.log('[restart-manager] exiting with stop code so systemd leaves the daemon down');
    process.exit(SHUTDOWN_EXIT_CODE);
  }, delayMs);

  return true;
}
