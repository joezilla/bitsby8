<script lang="ts">
  // Drive Bays — the *served spindle* (Epic 6). The four drives the FDC+
  // controller has mounted right now, served to the real serial Altair and to
  // external FDC clients (shared, write-master coordinated). Virtual machines do
  // NOT read this set — they own their disks from their own definition. This is
  // the live "what's in the machine right now" room; the Disk Library is the
  // separate archival room for the image files themselves.
  import { onMount } from 'svelte';
  import { api } from '$lib/services/api';
  import { serverStatus } from '$lib/services/socket';
  import { showToast } from '$lib/stores/toast';
  import Icon from '$lib/components/shared/Icon.svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import Card from '$lib/components/shared/Card.svelte';
  import Input from '$lib/components/shared/Input.svelte';
  import Select from '$lib/components/shared/Select.svelte';
  import PageHeader from '$lib/components/shared/PageHeader.svelte';
  import LabelStrip from '$lib/components/shared/LabelStrip.svelte';
  import DriveCard from '$lib/components/shared/DriveCard.svelte';
  import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
  import Modal from '$lib/components/shared/Modal.svelte';
  import type { DiskImageInfo, DriveState } from '$lib/types/api';

  let images = $state<DiskImageInfo[]>([]);
  let drives = $derived($serverStatus?.drives ?? []);
  let dirtyTransient = $derived(drives.filter((d) => d.transient && d.dirty));

  let mountingDrive = $state<number | null>(null);

  // Transient eject: a dirty copy-on-write scratch prompts keep-or-discard.
  let transientEjectDrive = $state<DriveState | null>(null);
  let transientSaveLabel = $state('');
  let transientBusy = $state(false);

  // Global default for write-to-read-only (Serial config — restart-required).
  let showSettings = $state(false);
  let settingsPolicy = $state<'error' | 'transient'>('error');
  let settingsEtag = $state<string | undefined>(undefined);
  let settingsLoading = $state(false);
  let settingsSaving = $state(false);

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function driveStatus(drive: DriveState): { color: 'amber' | 'green' | 'off'; pulse?: boolean; text: string } {
    if (!drive.mounted) return { color: 'off', text: 'Empty' };
    if (drive.headLoaded) return { color: 'amber', pulse: true, text: 'Reading' };
    return { color: 'green', text: 'Online' };
  }

  function emptyDrive(id: number): DriveState {
    return { id, mounted: false, headLoaded: false, readonly: false, filename: null, fullPath: null, track: 0, lastIo: null };
  }

  function togglePicker(id: number) {
    mountingDrive = mountingDrive === id ? null : id;
  }

  async function loadImages() {
    try {
      images = (await api.listImagesDetailed()).images;
    } catch (err: any) {
      showToast(`Failed to load disk images: ${err.message}`, 'error');
    }
  }

  async function mountDisk(driveId: number, filename: string) {
    try {
      await api.mountDrive(driveId, filename);
      showToast(`Mounted ${filename} on Drive ${driveId}`, 'success');
    } catch (err: any) {
      showToast(`Mount failed: ${err.message}`, 'error');
    } finally {
      mountingDrive = null;
    }
  }

  async function unmountDisk(driveId: number) {
    const d = drives.find((x) => x.id === driveId);
    if (d && d.transient && d.dirty) {
      transientEjectDrive = d;
      transientSaveLabel = '';
      return; // defer to the keep-or-discard dialog
    }
    await doUnmount(driveId);
  }

  async function doUnmount(driveId: number) {
    try {
      await api.unmountDrive(driveId);
      showToast(`Drive ${driveId} unmounted`, 'success');
    } catch (err: any) {
      showToast(`Unmount failed: ${err.message}`, 'error');
    }
  }

  async function transientEject(action: 'discard' | 'snapshot' | 'commit') {
    if (!transientEjectDrive) return;
    const driveId = transientEjectDrive.id;
    transientBusy = true;
    try {
      if (action === 'snapshot') {
        await api.saveTransientSnapshot(driveId, transientSaveLabel.trim());
        showToast('Saved changes as a snapshot', 'success');
      } else if (action === 'commit') {
        await api.commitTransient(driveId);
        showToast('Committed changes to the master image', 'success');
      }
      await doUnmount(driveId);
      transientEjectDrive = null;
      await loadImages();
    } catch (err: any) {
      showToast(`Eject failed: ${err.message}`, 'error');
    } finally {
      transientBusy = false;
    }
  }

  async function toggleReadonly(driveId: number, current: boolean) {
    try {
      await api.setReadonly(driveId, !current);
      showToast(`Drive ${driveId} set to ${!current ? 'read-only' : 'read-write'}`, 'success');
    } catch (err: any) {
      showToast(`Failed to change read-only state: ${err.message}`, 'error');
    }
  }

  async function openSettings() {
    showSettings = true;
    settingsLoading = true;
    try {
      const [cfg, status] = await Promise.all([api.getConfig(), api.getConfigStatus()]);
      settingsPolicy = cfg.readonlyWritePolicy === 'transient' ? 'transient' : 'error';
      settingsEtag = status.etag;
    } catch (err: any) {
      showToast(`Failed to load settings: ${err.message}`, 'error');
    } finally {
      settingsLoading = false;
    }
  }

  async function saveSettings() {
    settingsSaving = true;
    try {
      await api.putSerialConfig({ readonlyWritePolicy: settingsPolicy }, settingsEtag);
      showToast('Saved. Restart the daemon for the new default to take effect.', 'success');
      showSettings = false;
    } catch (err: any) {
      showToast(`Save failed: ${err.message}`, 'error');
    } finally {
      settingsSaving = false;
    }
  }

  // Close the mount picker on any outside click.
  function closeMountPickers(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-mount-picker]')) mountingDrive = null;
  }

  onMount(() => {
    loadImages();
    document.addEventListener('click', closeMountPickers);
    return () => document.removeEventListener('click', closeMountPickers);
  });
</script>

{#snippet headerActions()}
  <Button variant="ghost" icon="settings" onclick={openSettings}>Settings</Button>
{/snippet}

<PageHeader
  eyebrow="Operate · Drive Bays"
  title="Drive Bays"
  subtitle="The disks mounted on the FDC+ controller right now — served to the real serial Altair and to external FDC clients. Virtual machines don't read these; they carry their own disks."
  actions={headerActions}
/>

<div class="fdc-page-body" style="display: flex; flex-direction: column; gap: 20px;">
  {#if dirtyTransient.length}
    <Card>
      <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 18px; color: var(--fg-2); font: var(--text-body-sm);">
        <Icon name="bolt" size={18} />
        <span style="flex: 1; min-width: 200px;">
          <strong>{dirtyTransient.length}</strong> transient drive{dirtyTransient.length === 1 ? '' : 's'}
          {dirtyTransient.length === 1 ? 'has' : 'have'} unsaved copy-on-write writes — eject a drive to keep them (commit or snapshot) or discard.
        </span>
        <span style="display: flex; gap: 6px; flex-wrap: wrap;">
          {#each dirtyTransient as d (d.id)}
            <StatusBadge state="unsaved" label="D{d.id}" size="sm" title="Drive {d.id}: {d.filename} has unsaved writes" />
          {/each}
        </span>
      </div>
    </Card>
  {/if}

  <div>
    <div style="margin-bottom: 10px;"><LabelStrip>Drive bays</LabelStrip></div>
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 12px;">
      {#each [0, 1, 2, 3] as id}
        {@const drive = drives.find((d) => d.id === id) ?? emptyDrive(id)}
        <div style="position: relative;" data-mount-picker>
          <DriveCard
            num={id}
            track={drive.mounted ? drive.track : null}
            hasDisk={drive.mounted}
            filename={drive.filename}
            protectedRo={drive.readonly}
            dirty={!!(drive.transient && drive.dirty)}
            status={driveStatus(drive)}
            emptyText="No disk mounted"
            onEject={() => unmountDisk(id)}
            onSwap={() => togglePicker(id)}
            onToggleRo={() => toggleReadonly(id, drive.readonly)}
            onInsert={() => togglePicker(id)}
          />

          {#if mountingDrive === id}
            <div style="position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 30; max-height: 280px; overflow-y: auto; background: var(--surface-raised); border: 1px solid var(--border-2); border-radius: var(--radius-md); box-shadow: var(--elev-3);">
              {#if images.length === 0}
                <div style="padding: 10px 12px; font: var(--text-body-sm); color: var(--fg-3);">No disk images available</div>
              {:else}
                {#each images as img (img.name)}
                  <button type="button" onclick={() => mountDisk(id, img.name)} style="width: 100%; text-align: left; padding: 8px 12px; background: transparent; border: none; border-bottom: 1px solid var(--border-1); color: var(--fg-1); cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                    <span class="fdc-mono" style="font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{img.name}</span>
                    <span class="fdc-mono" style="font-size: 11px; color: var(--fg-3); flex: 0 0 auto;">{formatSize(img.size)}</span>
                  </button>
                {/each}
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>

<!-- Transient eject: keep-or-discard dialog -->
{#if transientEjectDrive}
  <Modal title="Eject transient drive {transientEjectDrive.id}" icon="eject" busy={transientBusy} onClose={() => (transientEjectDrive = null)}>
    <p class="fdc-label-strip" style="color: var(--fg-3); margin: 0; text-transform: none; letter-spacing: 0;">
      <span class="fdc-mono" style="color: var(--accent);">{transientEjectDrive.filename}</span> has
      unsaved changes on its copy-on-write scratch. Ejecting discards them unless you keep them.
    </p>
    <div>
      <label class="fdc-label-strip" for="transient-save-label" style="display: block; margin-bottom: 4px;">Snapshot label (optional)</label>
      <Input id="transient-save-label" placeholder="e.g. session save" bind:value={transientSaveLabel} disabled={transientBusy} />
    </div>
    <div style="display: flex; flex-direction: column; gap: 8px;">
      <Button variant="filled" icon="photo_camera" disabled={transientBusy} onclick={() => transientEject('snapshot')}>Save as snapshot &amp; eject</Button>
      <Button variant="tonal" icon="save" disabled={transientBusy} onclick={() => transientEject('commit')}>Commit to master &amp; eject</Button>
      <Button variant="outline" icon="delete_forever" disabled={transientBusy} onclick={() => transientEject('discard')}>Discard changes &amp; eject</Button>
    </div>
    {#snippet footer()}
      <Button variant="ghost" disabled={transientBusy} onclick={() => (transientEjectDrive = null)}>Cancel</Button>
    {/snippet}
  </Modal>
{/if}

<!-- Global drive-serving defaults -->
{#if showSettings}
  <Modal title="Drive serving settings" icon="tune" size="lg" busy={settingsSaving} onClose={() => (showSettings = false)}>
    <p class="fdc-label-strip" style="color: var(--fg-3); margin: 0; text-transform: none; letter-spacing: 0;">
      Global defaults for served drives. A per-image setting (in each disk's Edit dialog on the Disk Library) overrides these.
    </p>
    <div>
      <label class="fdc-label-strip" for="settings-policy" style="display: block; margin-bottom: 4px;">Default: on write to read-only image</label>
      <Select id="settings-policy" bind:value={settingsPolicy} disabled={settingsLoading || settingsSaving}>
        <option value="error">Error — refuse writes (write-protect)</option>
        <option value="transient">Transient — copy-on-write, changes discarded on eject</option>
      </Select>
      <div class="fdc-label-strip" style="margin-top: 4px; text-transform: none; letter-spacing: 0; color: var(--fg-3);">
        Applies to disks with no per-image override. Restart-required — this is an install-time default.
      </div>
    </div>
    {#snippet footer()}
      <Button variant="ghost" disabled={settingsSaving} onclick={() => (showSettings = false)}>Close</Button>
      <Button variant="filled" icon="check" disabled={settingsLoading || settingsSaving} onclick={saveSettings}>
        {settingsSaving ? 'Saving…' : 'Save defaults'}
      </Button>
    {/snippet}
  </Modal>
{/if}
