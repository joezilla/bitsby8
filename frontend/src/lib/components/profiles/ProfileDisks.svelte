<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/services/api';
  import { showToast } from '$lib/stores/toast';
  import Icon from '$lib/components/shared/Icon.svelte';
  import DriveCard from '$lib/components/shared/DriveCard.svelte';
  import type { DiskImageInfo } from '$lib/types/api';

  interface Props {
    /** Profile id (name@version) — the backend keys disks by the profile name. */
    profileId: string;
  }
  let { profileId }: Props = $props();

  type Binding = { drive: number; filename: string; readonly: boolean };
  const BAYS = 4;

  let disks = $state<Binding[]>([]);
  let images = $state<DiskImageInfo[]>([]);
  let pickerDrive = $state<number | null>(null);
  let loading = $state(true);

  const bindingFor = (drive: number) => disks.find((d) => d.drive === drive);
  const mountedCount = $derived(disks.length);

  async function load() {
    try {
      const [d, im] = await Promise.all([api.listProfileDisks(profileId), api.listImagesDetailed()]);
      disks = d.disks;
      images = im.images;
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

  const togglePicker = (drive: number) => (pickerDrive = pickerDrive === drive ? null : drive);
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
          onInsert={() => togglePicker(i)}
          onSwap={() => togglePicker(i)}
          onEject={() => eject(i)}
          onToggleRo={() => toggleRo(i)}
        />
        {#if pickerDrive === i}
          <div class="pd-menu">
            <div class="pd-menu-label fdc-mono">Disk library</div>
            <div class="pd-menu-list">
              {#each images as img (img.name)}
                <button class="pd-menu-row" class:current={b?.filename === img.name} onclick={() => mount(i, img.name)}>
                  <Icon name="album" size={16} />
                  <span class="pd-menu-name fdc-mono">{img.name}</span>
                  {#if b?.filename === img.name}<Icon name="check" size={16} />{/if}
                </button>
              {/each}
              {#if images.length === 0}
                <div class="pd-menu-empty muted">No disk images. Upload one on the Disks page.</div>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

{#if pickerDrive !== null}
  <button class="pd-scrim" aria-label="Close" onclick={() => (pickerDrive = null)}></button>
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
  .pd-menu { position: absolute; left: 0; right: 0; bottom: calc(100% + 6px); z-index: 30;
    background: var(--surface); border: 1px solid var(--border-2); border-radius: var(--radius-lg);
    box-shadow: var(--elev-4, 0 18px 50px -12px rgba(0, 0, 0, 0.6)); padding: 7px; }
  .pd-menu-label { font-size: 10px; letter-spacing: 0.12em; color: var(--fg-3); padding: 5px 8px 7px; text-transform: uppercase; }
  .pd-menu-list { max-height: 210px; overflow-y: auto; display: flex; flex-direction: column; }
  .pd-menu-row { display: flex; align-items: center; gap: 9px; padding: 8px; border-radius: 8px; cursor: pointer;
    background: none; border: none; color: var(--fg-2); text-align: left; width: 100%; }
  .pd-menu-row:hover { background: var(--surface-variant); }
  .pd-menu-row.current { color: var(--accent); }
  .pd-menu-name { flex: 1; min-width: 0; font-size: 11.5px; word-break: break-all; }
  .pd-menu-empty { padding: 12px 8px; font-size: 12.5px; text-align: center; }
  .pd-scrim { position: fixed; inset: 0; z-index: 20; background: none; border: none; cursor: default; }
</style>
