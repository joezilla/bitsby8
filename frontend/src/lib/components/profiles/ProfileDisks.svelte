<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/services/api';
  import { showToast } from '$lib/stores/toast';
  import DriveCard from '$lib/components/shared/DriveCard.svelte';
  import DiskPicker from '$lib/components/shared/DiskPicker.svelte';

  interface Props {
    /** Profile id (name@version) — the backend keys disks by the profile name. */
    profileId: string;
  }
  let { profileId }: Props = $props();

  type Binding = { drive: number; filename: string; readonly: boolean };
  const BAYS = 4;

  let disks = $state<Binding[]>([]);
  let pickerDrive = $state<number | null>(null);
  let loading = $state(true);

  const bindingFor = (drive: number) => disks.find((d) => d.drive === drive);
  const mountedCount = $derived(disks.length);

  async function load() {
    try {
      disks = (await api.listProfileDisks(profileId)).disks;
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      loading = false;
    }
  }
  onMount(load);

  async function mount(drive: number, filename: string) {
    pickerDrive = null;
    try {
      const keepRo = bindingFor(drive)?.readonly ?? false;
      disks = (await api.setProfileDisk(profileId, drive, filename, keepRo)).disks;
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  }

  async function eject(drive: number) {
    try {
      disks = (await api.clearProfileDisk(profileId, drive)).disks;
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  }

  async function toggleRo(drive: number) {
    const b = bindingFor(drive);
    if (!b) return;
    try {
      disks = (await api.setProfileDisk(profileId, drive, b.filename, !b.readonly)).disks;
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  }

</script>

<div class="pd-head">
  <div class="pd-title">
    <span class="pd-h2">Disk drives</span>
    <span class="pd-badge">{BAYS} slots</span>
  </div>
  <span class="pd-sub fdc-mono">{mountedCount} of {BAYS} mount at boot</span>
</div>

{#if loading}
  <p class="muted">Loading disks…</p>
{:else}
  <div class="pd-grid">
    {#each Array(BAYS) as _, i (i)}
      {@const b = bindingFor(i)}
      <div class="pd-slot">
        <DriveCard
          num={i}
          hasDisk={!!b}
          filename={b?.filename}
          protectedRo={b?.readonly}
          status={b ? { color: 'green', text: 'Boot' } : { color: 'off', text: 'Empty' }}
          emptyText="No disk at startup"
          onInsert={() => (pickerDrive = i)}
          onSwap={() => (pickerDrive = i)}
          onEject={() => eject(i)}
          onToggleRo={() => toggleRo(i)}
        />
      </div>
    {/each}
  </div>
{/if}

{#if pickerDrive !== null}
  <DiskPicker
    title="Startup disk · Drive {pickerDrive}"
    hint={profileId}
    onPick={(f) => mount(pickerDrive!, f)}
    onClose={() => (pickerDrive = null)}
  />
{/if}

<style>
  .pd-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: var(--space-3); }
  .pd-title { display: flex; align-items: center; gap: 12px; }
  .pd-h2 { font-size: 18px; font-weight: 700; color: var(--fg-1); }
  .pd-badge { font-family: var(--font-data); font-size: 12px; font-weight: 600; color: var(--info);
    background: color-mix(in oklab, var(--info) 12%, transparent); border: 1px solid color-mix(in oklab, var(--info) 25%, transparent);
    padding: 3px 9px; border-radius: 6px; }
  .pd-sub { font-size: 12px; color: var(--fg-3); }
  .pd-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
  @media (max-width: 900px) { .pd-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 520px) { .pd-grid { grid-template-columns: 1fr; } }
  .pd-slot { position: relative; min-width: 0; }
</style>
