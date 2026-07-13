<script lang="ts">
  /**
   * Sticky top banner shown when there are unsaved edits OR sections
   * waiting on a restart. Fires the auto-restart flow and polls the
   * daemon's startup epoch to detect when it comes back.
   */

  import Button from './Button.svelte';
  import Chip from './Chip.svelte';
  import { api } from '$lib/services/api';
  import type { ConfigStatus } from '$lib/types/api';
  import { dirtyCount, restartPendingCount, clearAllRestartPending } from '$lib/stores/configDirty';
  import { showToast } from '$lib/stores/toast';

  interface Props {
    status: ConfigStatus | null;
    onDiscardAll?: () => void;
    /** Called after a successful rollback so the page can refetch. */
    onRolledBack?: () => Promise<void> | void;
    /** Called after a restart round-trip completes so the page can refetch. */
    onRestarted?: () => Promise<void> | void;
  }

  let { status, onDiscardAll, onRolledBack, onRestarted }: Props = $props();

  let restarting = $state(false);
  let rollingBack = $state(false);
  let pollingEpoch = $state<number | null>(null);

  const total = $derived($dirtyCount + $restartPendingCount);
  const canRestart = $derived(!!status?.systemdManaged);
  const canRollback = $derived(!status?.configReadonly);

  async function handleRollback() {
    if (rollingBack || !status) return;
    if (
      !confirm(
        'Undo the most recent save?\n\n' +
          "The current config file will be replaced with the previous version (`.bak.1`). " +
          "You'll still need to restart the daemon for the change to take effect.",
      )
    ) {
      return;
    }
    rollingBack = true;
    try {
      await api.rollbackConfig();
      showToast('Rolled back to previous config. Restart to apply.', 'success');
      if (onRolledBack) await onRolledBack();
    } catch (err) {
      showToast(`Rollback failed: ${(err as Error).message}`, 'error');
    } finally {
      rollingBack = false;
    }
  }

  async function handleRestart() {
    if (restarting || !status) return;
    if (
      !confirm(
        'Restart the daemon now?\n\n' +
          'The web UI will disconnect briefly while the process relaunches. ' +
          'This is required for changes to serial ports or the web bind to take effect.',
      )
    ) {
      return;
    }
    restarting = true;
    pollingEpoch = status.startupEpoch;
    try {
      const res = await api.restartDaemon();
      if (res.manualCommand) {
        showToast(`Restart manually: ${res.manualCommand}`, 'warning', 8000);
        restarting = false;
        return;
      }
      showToast('Restart scheduled. Waiting for daemon to come back…', 'info', 3000);
      pollForRestart(status.startupEpoch);
    } catch (err) {
      showToast(`Restart failed: ${(err as Error).message}`, 'error');
      restarting = false;
    }
  }

  async function pollForRestart(oldEpoch: number, attempt = 0) {
    if (attempt > 30) {
      showToast(
        'Restart taking longer than expected — check `journalctl -u fdcsds`.',
        'warning',
        8000,
      );
      restarting = false;
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const s = await api.getConfigStatus();
      if (s.startupEpoch !== oldEpoch) {
        clearAllRestartPending();
        showToast('Daemon back online.', 'success');
        restarting = false;
        pollingEpoch = null;
        // Re-fetch config so the page reflects freshly-loaded values
        // (e.g. `apiKeySet: true` after the operator saved a new key).
        if (onRestarted) await onRestarted();
        return;
      }
    } catch {
      /* daemon is between exit and relaunch — expected */
    }
    pollForRestart(oldEpoch, attempt + 1);
  }
</script>

{#if total > 0}
  <div
    style="
      position: sticky;
      top: 0;
      z-index: 20;
      background: color-mix(in oklab, var(--warning) 15%, var(--surface-raised));
      border: 1px solid color-mix(in oklab, var(--warning) 40%, var(--border-1));
      border-radius: var(--radius-md);
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 4px;
    "
  >
    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
      {#if $dirtyCount > 0}
        <Chip color="amber" icon="edit">
          {$dirtyCount} unsaved {$dirtyCount === 1 ? 'change' : 'changes'}
        </Chip>
      {/if}
      {#if $restartPendingCount > 0}
        <Chip color="amber" icon="restart_alt">
          {$restartPendingCount} {$restartPendingCount === 1 ? 'section' : 'sections'} pending restart
        </Chip>
      {/if}
      {#if !canRestart && $restartPendingCount > 0}
        <span
          class="fdc-label-strip"
          style="color: var(--fg-3); text-transform: none; letter-spacing: 0;"
        >
          — not systemd-managed; run <code>sudo systemctl restart fdcsds</code> manually.
        </span>
      {/if}
    </div>
    <div style="display: flex; gap: 8px; flex-shrink: 0;">
      {#if $dirtyCount > 0 && onDiscardAll}
        <Button variant="ghost" icon="undo" onclick={onDiscardAll} disabled={restarting || rollingBack}>
          Discard all
        </Button>
      {/if}
      {#if $restartPendingCount > 0 && canRollback}
        <Button
          variant="ghost"
          icon="history"
          onclick={handleRollback}
          disabled={restarting || rollingBack}
          title="Restore the previous saved config file"
        >
          {rollingBack ? 'Rolling back…' : 'Undo last save'}
        </Button>
      {/if}
      {#if $restartPendingCount > 0}
        <Button
          variant="filled"
          icon="restart_alt"
          onclick={handleRestart}
          disabled={!canRestart || restarting || rollingBack}
        >
          {restarting ? 'Restarting…' : 'Restart now'}
        </Button>
      {/if}
    </div>
  </div>
{/if}
