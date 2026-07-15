<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/services/api';
  import { showToast } from '$lib/stores/toast';
  import type { InstanceSnapshot } from '$lib/types/api';
  import Button from '$lib/components/shared/Button.svelte';
  import Modal from '$lib/components/shared/Modal.svelte';
  import EmptyState from '$lib/components/shared/EmptyState.svelte';

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

<Modal title={title} icon="photo_camera" hint="disk snapshots" size="lg" busy={busy} {onClose}>
  <div class="take">
    <input class="inp" placeholder="Label (optional)" bind:value={label} disabled={busy} />
    <Button variant="filled" size="sm" icon="add_a_photo" onclick={take} disabled={busy}>Snapshot now</Button>
  </div>

  {#if loading}
    <EmptyState loading compact>Loading snapshots…</EmptyState>
  {:else if snapshots.length === 0}
    <EmptyState icon="photo_camera" compact>No snapshots yet. Take one to capture this machine's disks.</EmptyState>
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
</Modal>

<style>
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
</style>
