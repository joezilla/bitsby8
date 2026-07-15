<script lang="ts">
  // The one disk-image picker dialog, shared by every surface that mounts a disk
  // into a bay: Drive Bays, the run cockpit, Machine Profiles, and per-client
  // drives. Self-contained — it loads the image library itself and returns a
  // chosen filename via onPick; the caller decides what to do with it (mount,
  // set an override, bind as a startup disk).
  import { onMount } from 'svelte';
  import { api } from '$lib/services/api';
  import { showToast } from '$lib/stores/toast';
  import Modal from './Modal.svelte';
  import Input from './Input.svelte';
  import Button from './Button.svelte';
  import EmptyState from './EmptyState.svelte';
  import type { DiskImageInfo } from '$lib/types/api';

  interface Props {
    title: string;
    /** Small caption beside the title (e.g. the machine or client name). */
    hint?: string;
    onPick: (filename: string) => void;
    onClose: () => void;
  }
  let { title, hint, onPick, onClose }: Props = $props();

  let images = $state<DiskImageInfo[]>([]);
  let loading = $state(true);
  let filter = $state('');

  const filtered = $derived(
    filter
      ? images.filter((i) => i.name.toLowerCase().includes(filter.toLowerCase()))
      : images,
  );

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  onMount(async () => {
    try {
      images = (await api.listImagesDetailed()).images;
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      loading = false;
    }
  });
</script>

<Modal {title} {hint} icon="album" size="md" {onClose}>
  <Input variant="search" placeholder="Filter images…" bind:value={filter} />
  <div class="picker-list">
    {#if loading}
      <EmptyState loading compact>Loading images…</EmptyState>
    {:else if filtered.length === 0}
      <EmptyState icon="album" compact>
        {filter ? 'No images match your filter.' : 'No disk images available. Create one in the Disk Library.'}
      </EmptyState>
    {:else}
      {#each filtered as img (img.name)}
        <button type="button" class="picker-row" onclick={() => onPick(img.name)}>
          <span class="picker-name fdc-mono">{img.name}</span>
          <span class="picker-size fdc-mono">{formatSize(img.size)}</span>
        </button>
      {/each}
    {/if}
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={onClose}>Cancel</Button>
  {/snippet}
</Modal>

<style>
  .picker-list {
    display: flex;
    flex-direction: column;
    min-height: 0;
    max-height: 44vh;
    overflow-y: auto;
    border: 1px solid var(--border-1);
    border-radius: var(--radius-md);
  }
  .picker-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    text-align: left;
    padding: 10px 14px;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border-1);
    color: var(--fg-1);
    cursor: pointer;
  }
  .picker-row:last-child {
    border-bottom: none;
  }
  .picker-row:hover {
    background: color-mix(in oklab, var(--fg-1) 6%, transparent);
  }
  .picker-name {
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .picker-size {
    flex: 0 0 auto;
    font-size: 11px;
    color: var(--fg-3);
  }
</style>
