<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/services/api';
  import { showToast } from '$lib/stores/toast';
  import type { InstanceSnapshot } from '$lib/types/api';
  import Button from '$lib/components/shared/Button.svelte';
  import Icon from '$lib/components/shared/Icon.svelte';

  interface Props {
    instanceId: string;
    title: string;
    onClose: () => void;
    onRestored: () => void;
  }
  let { instanceId, title, onClose, onRestored }: Props = $props();

  let snapshots = $state<InstanceSnapshot[]>([]);
  let loading = $state(true);
  let busy = $state(false);
  let label = $state('');

  async function load() {
    try {
      loading = true;
      snapshots = (await api.listInstanceSnapshots(instanceId)).snapshots;
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      loading = false;
    }
  }

  async function take() {
    try {
      busy = true;
      const { snapshot } = await api.snapshotInstance(instanceId, label.trim() || undefined);
      showToast(`Snapshot taken (${snapshot.disks.length} disk${snapshot.disks.length === 1 ? '' : 's'})`, 'success');
      label = '';
      await load();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      busy = false;
    }
  }

  async function restore(s: InstanceSnapshot) {
    if (!confirm(`Restore this snapshot? The instance will stop, its disks revert, and it will reboot.`)) return;
    try {
      busy = true;
      await api.restoreInstanceSnapshot(s.id);
      showToast('Snapshot restored — machine rebooting', 'success');
      onRestored();
      onClose();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      busy = false;
    }
  }

  async function remove(s: InstanceSnapshot) {
    if (!confirm('Delete this snapshot?')) return;
    try {
      busy = true;
      await api.deleteInstanceSnapshot(s.id);
      await load();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      busy = false;
    }
  }

  const when = (iso: string) => iso.replace('T', ' ').replace(/\..*/, '').replace('Z', '');

  onMount(load);
</script>

<div class="overlay" role="button" tabindex="-1" aria-label="Close" onclick={onClose}
  onkeydown={(e) => e.key === 'Escape' && onClose()}></div>
<div class="panel" role="dialog" aria-modal="true" aria-label="Snapshots for {title}">
  <header class="bar">
    <div class="ttl"><Icon name="photo_camera" size={18} /><span class="fdc-mono">{title}</span><span class="hint">disk snapshots</span></div>
    <button class="close" onclick={onClose} aria-label="Close"><Icon name="close" size={20} /></button>
  </header>

  <div class="body">
    <div class="take">
      <input class="inp" placeholder="Label (optional)" bind:value={label} disabled={busy} />
      <Button variant="filled" size="sm" icon="add_a_photo" onclick={take} disabled={busy}>Snapshot now</Button>
    </div>

    {#if loading}
      <p class="muted">Loading…</p>
    {:else if snapshots.length === 0}
      <p class="muted">No snapshots yet. Take one to capture this machine's disks.</p>
    {:else}
      <ul class="list">
        {#each snapshots as s (s.id)}
          <li>
            <div class="meta">
              <span class="lbl">{s.label || 'snapshot'}</span>
              <span class="sub fdc-mono">{when(s.createdAt)} · {s.disks.map((d) => 'D' + d.drive).join(' ')}</span>
            </div>
            <div class="acts">
              <Button variant="tonal" size="sm" icon="restore" onclick={() => restore(s)} disabled={busy}>Restore</Button>
              <Button variant="ghost" size="sm" icon="delete" danger onclick={() => remove(s)} disabled={busy}>Delete</Button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: var(--surface-overlay);
    z-index: 40;
    border: none;
  }
  .panel {
    position: fixed;
    z-index: 41;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(560px, 94vw);
    background: var(--surface);
    border: 1px solid var(--border-3);
    border-radius: var(--radius-lg);
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-2);
    background: var(--surface-raised);
  }
  .ttl {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--fg-1);
    font-size: 14px;
  }
  .hint {
    font: var(--text-overline);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-4);
  }
  .close {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    background: none;
    border: none;
    color: var(--fg-3);
    cursor: pointer;
    border-radius: var(--radius-sm);
  }
  .close:hover {
    color: var(--fg-1);
  }
  .body {
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-height: 60vh;
    overflow: auto;
  }
  .take {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  .inp {
    flex: 1;
    height: 34px;
    padding: 0 var(--space-3);
    background: var(--surface-sunken);
    border: 1px solid var(--border-2);
    border-radius: var(--radius-sm);
    color: var(--fg-1);
    font: var(--text-body-sm);
  }
  .inp:focus {
    outline: none;
    border-color: var(--accent);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--surface-raised);
    border: 1px solid var(--border-1);
    border-radius: var(--radius-sm);
  }
  .meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .lbl {
    font-size: 14px;
    color: var(--fg-1);
    font-weight: 500;
  }
  .sub {
    font-size: 11px;
    color: var(--fg-4);
  }
  .acts {
    display: flex;
    gap: var(--space-1);
    flex-shrink: 0;
  }
  .muted {
    color: var(--fg-3);
    font: var(--text-body-sm);
  }
</style>
