<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/services/api';
  import { serverStatus } from '$lib/services/socket';
  import { showToast } from '$lib/stores/toast';
  import Icon from '$lib/components/shared/Icon.svelte';
  import IconButton from '$lib/components/shared/IconButton.svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import Card from '$lib/components/shared/Card.svelte';
  import Chip from '$lib/components/shared/Chip.svelte';
  import Input from '$lib/components/shared/Input.svelte';
  import Select from '$lib/components/shared/Select.svelte';
  import TextArea from '$lib/components/shared/TextArea.svelte';
  import Led from '$lib/components/shared/Led.svelte';
  import PageHeader from '$lib/components/shared/PageHeader.svelte';
  import LabelStrip from '$lib/components/shared/LabelStrip.svelte';
  import type { DiskImageInfo, DriveState, CpmFileInfo, SnapshotInfo } from '$lib/types/api';

  let images = $state<DiskImageInfo[]>([]);
  let searchQuery = $state('');
  let loading = $state(true);
  let drives = $derived($serverStatus?.drives ?? []);
  let filteredImages = $derived(
    searchQuery
      ? images.filter(
          (i) =>
            i.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (i.description ?? '').toLowerCase().includes(searchQuery.toLowerCase())
        )
      : images
  );
  let mountingDrive = $state<number | null>(null);
  let mountingImage = $state<string | null>(null);
  let uploading = $state(false);
  let dragOver = $state(false);
  let editingNotes = $state<DiskImageInfo | null>(null);
  let editFilename = $state('');
  let editDescription = $state('');
  let editNotesText = $state('');
  let savingEdit = $state(false);
  let showCreateDialog = $state(false);
  let newDiskName = $state('');
  let newDiskFormat = $state('8inch');
  let newDiskExtension = $state('.img');

  // Snapshots
  let snapshotDisk = $state<DiskImageInfo | null>(null);
  let snapshots = $state<SnapshotInfo[]>([]);
  let snapshotsLoading = $state(false);
  let newSnapshotLabel = $state('');
  let creatingSnapshot = $state(false);
  let snapshotBusyId = $state<string | null>(null);
  // Rollback overwrites the image file, so it's refused while mounted.
  let snapshotDiskMounted = $derived(
    snapshotDisk ? isImageMounted(snapshotDisk.name) : false
  );

  let fileInputRef = $state<HTMLInputElement | null>(null);

  // CP/M files browser
  type CpmInfoResp = Awaited<ReturnType<typeof api.getCpmInfo>>;
  let cpmDisk = $state<DiskImageInfo | null>(null);
  let cpmInfo = $state<CpmInfoResp | null>(null);
  let cpmFiles = $state<CpmFileInfo[]>([]);
  let cpmLoading = $state(false);
  let cpmError = $state<string | null>(null);
  let cpmUploading = $state(false);
  let cpmDragOver = $state(false);
  let cpmFileInputRef = $state<HTMLInputElement | null>(null);
  let cpmMounted = $derived(cpmInfo && cpmInfo.mounted !== false);

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function driveLed(drive: DriveState): { color: 'amber' | 'green' | 'off'; pulse: boolean } {
    if (!drive.mounted) return { color: 'off', pulse: false };
    if (drive.headLoaded) return { color: 'amber', pulse: true };
    return { color: 'green', pulse: false };
  }

  function emptyDrive(id: number): DriveState {
    return {
      id,
      mounted: false,
      headLoaded: false,
      readonly: false,
      filename: null,
      fullPath: null,
      track: 0,
      lastIo: null,
    };
  }

  async function loadImages() {
    try {
      loading = true;
      const result = await api.listImagesDetailed();
      images = result.images;
    } catch (err: any) {
      showToast(`Failed to load disk images: ${err.message}`, 'error');
    } finally {
      loading = false;
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
      mountingImage = null;
    }
  }

  async function unmountDisk(driveId: number) {
    try {
      await api.unmountDrive(driveId);
      showToast(`Drive ${driveId} unmounted`, 'success');
    } catch (err: any) {
      showToast(`Unmount failed: ${err.message}`, 'error');
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

  async function cloneDisk(filename: string) {
    try {
      await api.cloneImage(filename);
      showToast(`Cloned ${filename}`, 'success');
      await loadImages();
    } catch (err: any) {
      showToast(`Clone failed: ${err.message}`, 'error');
    }
  }

  async function deleteDisk(filename: string) {
    if (!confirm(`Delete disk image "${filename}"? This cannot be undone.`)) return;
    try {
      await api.deleteImage(filename);
      showToast(`Deleted ${filename}`, 'success');
      await loadImages();
    } catch (err: any) {
      showToast(`Delete failed: ${err.message}`, 'error');
    }
  }

  /** True when the named image is mounted on any drive (matches on basename). */
  function isImageMounted(name: string): boolean {
    return drives.some(
      (d) => d.mounted && !!d.filename && d.filename.split(/[\\/]/).pop() === name
    );
  }

  function formatTimestamp(sqlTs: string): string {
    // SQLite CURRENT_TIMESTAMP is UTC "YYYY-MM-DD HH:MM:SS" with no zone.
    const parsed = new Date(sqlTs.replace(' ', 'T') + 'Z');
    return isNaN(parsed.getTime()) ? sqlTs : parsed.toLocaleString();
  }

  async function openSnapshots(image: DiskImageInfo) {
    snapshotDisk = image;
    newSnapshotLabel = '';
    await loadSnapshots();
  }

  async function loadSnapshots() {
    if (!snapshotDisk) return;
    try {
      snapshotsLoading = true;
      const result = await api.listSnapshots(snapshotDisk.name);
      snapshots = result.snapshots;
    } catch (err: any) {
      showToast(`Failed to load snapshots: ${err.message}`, 'error');
    } finally {
      snapshotsLoading = false;
    }
  }

  async function createSnapshotForDisk() {
    if (!snapshotDisk) return;
    try {
      creatingSnapshot = true;
      await api.createSnapshot(snapshotDisk.name, newSnapshotLabel.trim());
      showToast(`Snapshot of ${snapshotDisk.name} created`, 'success');
      newSnapshotLabel = '';
      await loadSnapshots();
    } catch (err: any) {
      showToast(`Snapshot failed: ${err.message}`, 'error');
    } finally {
      creatingSnapshot = false;
    }
  }

  async function restoreSnapshotForDisk(snap: SnapshotInfo) {
    if (!snapshotDisk) return;
    const label = snap.label || formatTimestamp(snap.created_at);
    if (!confirm(`Roll ${snapshotDisk.name} back to "${label}"? Current contents will be overwritten.`)) return;
    try {
      snapshotBusyId = snap.id;
      await api.restoreSnapshot(snapshotDisk.name, snap.id);
      showToast(`Rolled ${snapshotDisk.name} back to snapshot`, 'success');
      await loadImages();
    } catch (err: any) {
      showToast(`Rollback failed: ${err.message}`, 'error');
    } finally {
      snapshotBusyId = null;
    }
  }

  async function deleteSnapshotForDisk(snap: SnapshotInfo) {
    if (!snapshotDisk) return;
    const label = snap.label || formatTimestamp(snap.created_at);
    if (!confirm(`Delete snapshot "${label}"? This cannot be undone.`)) return;
    try {
      snapshotBusyId = snap.id;
      await api.deleteSnapshot(snapshotDisk.name, snap.id);
      showToast('Snapshot deleted', 'success');
      await loadSnapshots();
    } catch (err: any) {
      showToast(`Delete failed: ${err.message}`, 'error');
    } finally {
      snapshotBusyId = null;
    }
  }

  async function handleUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) return;
    uploading = true;
    try {
      for (const file of files) {
        await api.uploadImage(file);
        showToast(`Uploaded ${file.name}`, 'success');
      }
      await loadImages();
    } catch (err: any) {
      showToast(`Upload failed: ${err.message}`, 'error');
    } finally {
      uploading = false;
      input.value = '';
    }
  }

  async function handleDrop(event: DragEvent) {
    event.preventDefault();
    dragOver = false;
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;
    uploading = true;
    try {
      for (const file of files) {
        await api.uploadImage(file);
        showToast(`Uploaded ${file.name}`, 'success');
      }
      await loadImages();
    } catch (err: any) {
      showToast(`Upload failed: ${err.message}`, 'error');
    } finally {
      uploading = false;
    }
  }

  function handleDragOver(event: DragEvent) { event.preventDefault(); dragOver = true; }
  function handleDragLeave() { dragOver = false; }

  async function saveEdit() {
    if (!editingNotes) return;
    const oldName = editingNotes.name;
    const newName = editFilename.trim();
    if (!newName) {
      showToast('Filename cannot be empty', 'warning');
      return;
    }
    if (newName.includes('/') || newName.includes('\\') || newName.includes('..')) {
      showToast('Filename cannot contain "/", "\\", or ".."', 'warning');
      return;
    }

    savingEdit = true;
    try {
      // Rename first (if changed). If this fails, don't touch notes.
      let resolvedName = oldName;
      if (newName !== oldName) {
        const res = await api.renameImage(oldName, newName);
        resolvedName = res.filename;
        showToast(`Renamed ${oldName} → ${resolvedName}`, 'success');
      }
      await api.updateImageNotes(resolvedName, editDescription, editNotesText);
      if (newName === oldName) {
        showToast(`Notes updated for ${resolvedName}`, 'success');
      }
      editingNotes = null;
      await loadImages();
    } catch (err: any) {
      showToast(`Save failed: ${err.message}`, 'error');
    } finally {
      savingEdit = false;
    }
  }

  function openEditNotes(image: DiskImageInfo) {
    editingNotes = image;
    editFilename = image.name;
    editDescription = image.description ?? '';
    editNotesText = image.notes ?? '';
  }

  async function createBlankDisk() {
    if (!newDiskName.trim()) {
      showToast('Enter a filename for the new disk image', 'warning');
      return;
    }
    try {
      await api.createImage(newDiskName.trim(), newDiskFormat, newDiskExtension);
      showToast(`Created ${newDiskName.trim()}${newDiskExtension}`, 'success');
      showCreateDialog = false;
      newDiskName = '';
      await loadImages();
    } catch (err: any) {
      showToast(`Create failed: ${err.message}`, 'error');
    }
  }

  function closeMountPickers(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-mount-picker]')) {
      mountingDrive = null;
      mountingImage = null;
    }
  }

  // ---------------- CP/M file browser ----------------

  function cpmFormatName(f: CpmFileInfo): string {
    const name = f.filename.trimEnd();
    const ext = f.extension.trimEnd();
    return ext ? `${name}.${ext}` : name;
  }

  function cpmFileId(f: CpmFileInfo): string {
    return `${f.user}:${cpmFormatName(f)}`;
  }

  async function refreshCpm(filename: string) {
    cpmLoading = true;
    cpmError = null;
    try {
      const [info, list] = await Promise.all([
        api.getCpmInfo(filename),
        api.listCpmFiles(filename),
      ]);
      cpmInfo = info;
      cpmFiles = list.files;
    } catch (err: any) {
      cpmError = err.message;
      cpmFiles = [];
      cpmInfo = null;
    } finally {
      cpmLoading = false;
    }
  }

  function openCpmBrowser(image: DiskImageInfo) {
    cpmDisk = image;
    cpmInfo = null;
    cpmFiles = [];
    cpmError = null;
    refreshCpm(image.name);
  }

  function closeCpmBrowser() {
    cpmDisk = null;
    cpmInfo = null;
    cpmFiles = [];
    cpmError = null;
    cpmDragOver = false;
  }

  async function downloadCpmFile(f: CpmFileInfo) {
    if (!cpmDisk) return;
    try {
      const res = await api.downloadCpmFile(cpmDisk.name, cpmFileId(f));
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || res.statusText);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = cpmFormatName(f);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      showToast(`Download failed: ${err.message}`, 'error');
    }
  }

  async function deleteCpmFile(f: CpmFileInfo) {
    if (!cpmDisk) return;
    if (cpmMounted) {
      showToast('Unmount the disk before modifying files', 'warning');
      return;
    }
    const label = cpmFormatName(f);
    if (!confirm(`Delete CP/M file "${label}" from ${cpmDisk.name}?`)) return;
    try {
      await api.deleteCpmFile(cpmDisk.name, cpmFileId(f));
      showToast(`Deleted ${label}`, 'success');
      await refreshCpm(cpmDisk.name);
    } catch (err: any) {
      showToast(`Delete failed: ${err.message}`, 'error');
    }
  }

  async function formatCpmDisk() {
    if (!cpmDisk) return;
    if (cpmMounted) {
      showToast('Unmount the disk before formatting', 'warning');
      return;
    }
    const ok = confirm(
      `Format ${cpmDisk.name}?\n\n` +
      `This will erase every file on the disk and lay down a fresh CP/M layout. ` +
      `This cannot be undone.`,
    );
    if (!ok) return;
    try {
      await api.formatImage(cpmDisk.name);
      showToast(`Formatted ${cpmDisk.name}`, 'success');
      await refreshCpm(cpmDisk.name);
    } catch (err: any) {
      showToast(`Format failed: ${err.message}`, 'error');
    }
  }

  async function uploadCpmFiles(files: FileList | File[]) {
    if (!cpmDisk) return;
    if (cpmMounted) {
      showToast('Unmount the disk before uploading files', 'warning');
      return;
    }
    if (!files || files.length === 0) return;
    cpmUploading = true;
    try {
      for (const file of files) {
        await api.uploadCpmFile(cpmDisk.name, file);
        showToast(`Uploaded ${file.name}`, 'success');
      }
      await refreshCpm(cpmDisk.name);
    } catch (err: any) {
      showToast(`Upload failed: ${err.message}`, 'error');
    } finally {
      cpmUploading = false;
    }
  }

  function handleCpmUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files) uploadCpmFiles(input.files);
    input.value = '';
  }

  function handleCpmDrop(event: DragEvent) {
    event.preventDefault();
    cpmDragOver = false;
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) uploadCpmFiles(files);
  }

  function handleCpmDragOver(event: DragEvent) {
    event.preventDefault();
    if (!cpmMounted) cpmDragOver = true;
  }

  function handleCpmDragLeave() {
    cpmDragOver = false;
  }

  onMount(() => {
    loadImages();
    document.addEventListener('click', closeMountPickers);
    return () => document.removeEventListener('click', closeMountPickers);
  });
</script>

{#snippet headerActions()}
  <Button variant="ghost" icon="refresh" onclick={loadImages}>Refresh</Button>
  <Button variant="ghost" icon="upload" disabled={uploading} onclick={() => fileInputRef?.click()}>
    {uploading ? 'Uploading…' : 'Upload'}
  </Button>
  <Button variant="filled" icon="add" onclick={() => (showCreateDialog = !showCreateDialog)}>New disk</Button>
  <input
    type="file"
    accept=".img,.dsk,.cpm,.raw,.IMD,.imd"
    multiple
    style="display: none;"
    bind:this={fileInputRef}
    onchange={handleUpload}
  />
{/snippet}

<PageHeader
  eyebrow="Section · Drives & disk images"
  title="Drives & Library"
  subtitle="Mount up to four virtual floppies on the FDC+ controller. Drag .img / .dsk files onto the library to upload."
  actions={headerActions}
/>

<div class="fdc-page-body" style="display: flex; flex-direction: column; gap: 20px;">
  <!-- Drive bays -->
  <div>
    <div style="margin-bottom: 10px;"><LabelStrip>Drive bays</LabelStrip></div>
    <div
      style="
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
        gap: 12px;
      "
    >
      {#each [0, 1, 2, 3] as id}
        {@const drive = drives.find((d) => d.id === id) ?? emptyDrive(id)}
        {@const ledState = driveLed(drive)}
        <Card>
          <div style="padding: 16px; display: flex; flex-direction: column; gap: 10px;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <div style="display: flex; align-items: baseline; gap: 8px;">
                <span class="fdc-label-strip">Drive</span>
                <span class="fdc-mono" style="font-size: 18px; color: var(--accent); font-weight: 600;">{id}</span>
              </div>
              <Led color={ledState.color} pulse={ledState.pulse} size="md" />
            </div>

            <div style="flex: 1; min-height: 40px;">
              {#if drive.mounted}
                <div
                  class="fdc-mono"
                  style="font-size: 12px; color: var(--fg-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                  title={drive.filename ?? ''}
                >
                  {drive.filename}
                </div>
                <div style="display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap;">
                  <Chip>TRK {drive.track}</Chip>
                  {#if drive.readonly}
                    <Chip color="amber">RO</Chip>
                  {:else}
                    <Chip color="green">R/W</Chip>
                  {/if}
                </div>
              {:else}
                <div style="font: var(--text-body-sm); color: var(--fg-3); font-style: italic;">Empty bay</div>
              {/if}
            </div>

            <div
              style="
                display: flex;
                align-items: center;
                gap: 6px;
                padding-top: 8px;
                border-top: 1px solid var(--border-1);
              "
            >
              {#if drive.mounted}
                <Button variant="ghost" size="sm" icon="eject" onclick={() => unmountDisk(id)}>Eject</Button>
                <Button
                  variant={drive.readonly ? 'tonal' : 'outline'}
                  size="sm"
                  onclick={() => toggleReadonly(id, drive.readonly)}
                  title={drive.readonly ? 'Set read-write' : 'Set read-only'}
                >
                  {drive.readonly ? 'RO' : 'RW'}
                </Button>
              {:else}
                <div style="position: relative;" data-mount-picker>
                  <Button
                    variant="tonal"
                    size="sm"
                    icon="save"
                    onclick={(e: MouseEvent) => {
                      e.stopPropagation();
                      mountingDrive = mountingDrive === id ? null : id;
                      mountingImage = null;
                    }}
                  >
                    Mount…
                  </Button>
                  {#if mountingDrive === id}
                    <div
                      style="
                        position: absolute;
                        top: calc(100% + 4px);
                        left: 0;
                        z-index: 30;
                        width: 260px;
                        max-height: 280px;
                        overflow-y: auto;
                        background: var(--surface-raised);
                        border: 1px solid var(--border-2);
                        border-radius: var(--radius-md);
                        box-shadow: var(--elev-3);
                      "
                    >
                      {#if images.length === 0}
                        <div style="padding: 10px 12px; font: var(--text-body-sm); color: var(--fg-3);">
                          No disk images available
                        </div>
                      {:else}
                        {#each images as img (img.name)}
                          <button
                            type="button"
                            onclick={() => mountDisk(id, img.name)}
                            style="
                              width: 100%;
                              text-align: left;
                              padding: 8px 12px;
                              background: transparent;
                              border: none;
                              border-bottom: 1px solid var(--border-1);
                              color: var(--fg-1);
                              cursor: pointer;
                              display: flex;
                              align-items: center;
                              justify-content: space-between;
                              gap: 8px;
                            "
                          >
                            <span
                              class="fdc-mono"
                              style="font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                            >
                              {img.name}
                            </span>
                            <span class="fdc-mono" style="font-size: 11px; color: var(--fg-3); flex: 0 0 auto;">
                              {formatSize(img.size)}
                            </span>
                          </button>
                        {/each}
                      {/if}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        </Card>
      {/each}
    </div>
  </div>

  <!-- Create disk inline form -->
  {#if showCreateDialog}
    <Card raised>
      <div style="padding: 16px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
          <LabelStrip>Create blank disk</LabelStrip>
          <IconButton icon="close" size={16} title="Close" onclick={() => (showCreateDialog = false)} />
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr)); gap: 12px; align-items: end;">
          <div>
            <label class="fdc-label-strip" for="new-disk-name" style="display: block; margin-bottom: 4px;">Filename</label>
            <Input id="new-disk-name" placeholder="mydisk" bind:value={newDiskName} />
          </div>
          <div>
            <label class="fdc-label-strip" for="new-disk-format" style="display: block; margin-bottom: 4px;">Format</label>
            <Select id="new-disk-format" bind:value={newDiskFormat}>
              <option value="8inch">8-inch floppy (330 KB)</option>
              <option value="minidisk">5.25" mini-disk (75 KB)</option>
              <option value="8mb">8 MB hard disk (7.8 MB)</option>
            </Select>
          </div>
          <div>
            <label class="fdc-label-strip" for="new-disk-ext" style="display: block; margin-bottom: 4px;">Extension</label>
            <Select id="new-disk-ext" bind:value={newDiskExtension}>
              <option value=".img">.img</option>
              <option value=".dsk">.dsk</option>
              <option value=".cpm">.cpm</option>
            </Select>
          </div>
          <Button variant="filled" icon="check" onclick={createBlankDisk}>Create</Button>
        </div>
      </div>
    </Card>
  {/if}

  <!-- Image library -->
  <Card>
    <div
      role="region"
      aria-label="Disk image library"
      ondragover={handleDragOver}
      ondragleave={handleDragLeave}
      ondrop={handleDrop}
      style="
        padding: 16px;
        {dragOver ? 'border: 1px dashed var(--accent); border-radius: var(--radius-lg);' : ''}
      "
    >
      <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px;">
        <LabelStrip>Disk image library</LabelStrip>
        <div style="flex: 1; min-width: min(200px, 100%);">
          <Input variant="search" placeholder="Filter images…" bind:value={searchQuery} />
        </div>
      </div>

      {#if dragOver}
        <div
          style="
            padding: 32px;
            text-align: center;
            border: 2px dashed var(--accent);
            border-radius: var(--radius-md);
            margin-bottom: 12px;
            color: var(--accent);
            font: var(--text-body);
          "
        >
          Drop disk image files here
        </div>
      {/if}

      {#if loading}
        <div style="font: var(--text-body-sm); color: var(--fg-3); padding: 12px 0;">Loading disk images…</div>
      {:else if filteredImages.length === 0}
        <div style="font: var(--text-body-sm); color: var(--fg-3); padding: 12px 0;">
          {searchQuery ? 'No images match your filter.' : 'No disk images found. Upload or create one to get started.'}
        </div>
      {:else}
        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="border-bottom: 1px solid var(--border-1);">
                <th class="fdc-label-strip" style="text-align: left; padding: 8px;">Name</th>
                <th class="fdc-label-strip" style="text-align: right; padding: 8px;">Size</th>
                <th class="fdc-label-strip hidden md:table-cell" style="text-align: left; padding: 8px;">Description</th>
                <th class="fdc-label-strip" style="text-align: right; padding: 8px;">Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredImages as img (img.name)}
                <tr style="border-bottom: 1px solid var(--border-1);">
                  <td class="fdc-mono" style="padding: 8px; font-size: 12px; color: var(--fg-1);">
                    <span
                      style="display: inline-block; max-width: 16rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom;"
                      title={img.name}
                    >
                      {img.name}
                    </span>
                  </td>
                  <td class="fdc-mono" style="padding: 8px; text-align: right; color: var(--fg-2); font-size: 11px; white-space: nowrap;">
                    {formatSize(img.size)}
                  </td>
                  <td class="hidden md:table-cell" style="padding: 8px; color: var(--fg-2); font: var(--text-body-sm);">
                    <span
                      style="display: inline-block; max-width: 22rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom;"
                      title={img.description ?? ''}
                    >
                      {img.description || '—'}
                    </span>
                  </td>
                  <td style="padding: 8px; text-align: right;">
                    <div style="display: inline-flex; align-items: center; gap: 4px;">
                      <div style="position: relative;" data-mount-picker>
                        <IconButton
                          icon="save"
                          size={16}
                          title="Mount to drive"
                          onclick={(e: MouseEvent) => {
                            e.stopPropagation();
                            mountingImage = mountingImage === img.name ? null : img.name;
                            mountingDrive = null;
                          }}
                        />
                        {#if mountingImage === img.name}
                          <div
                            style="
                              position: absolute;
                              top: calc(100% + 4px);
                              right: 0;
                              z-index: 30;
                              width: 200px;
                              background: var(--surface-raised);
                              border: 1px solid var(--border-2);
                              border-radius: var(--radius-md);
                              box-shadow: var(--elev-3);
                            "
                          >
                            {#each [0, 1, 2, 3] as driveId}
                              {@const driveState = drives.find((d) => d.id === driveId)}
                              <button
                                type="button"
                                onclick={() => mountDisk(driveId, img.name)}
                                style="
                                  width: 100%;
                                  text-align: left;
                                  padding: 8px 12px;
                                  background: transparent;
                                  border: none;
                                  border-bottom: 1px solid var(--border-1);
                                  color: var(--fg-1);
                                  cursor: pointer;
                                  display: flex;
                                  align-items: center;
                                  justify-content: space-between;
                                  font: var(--text-body-sm);
                                "
                              >
                                <span>Drive {driveId}</span>
                                <span class="fdc-mono" style="font-size: 10px; color: var(--fg-3); flex: 0 0 auto; max-width: 7rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                  {driveState?.mounted ? driveState.filename : 'Empty'}
                                </span>
                              </button>
                            {/each}
                          </div>
                        {/if}
                      </div>
                      <IconButton icon="folder_open" size={16} title="Browse CP/M files (experimental)" onclick={() => openCpmBrowser(img)} />
                      <IconButton icon="history" size={18} title="Snapshots" onclick={() => openSnapshots(img)} />
                      <IconButton icon="content_copy" size={16} title="Clone image" onclick={() => cloneDisk(img.name)} />
                      <IconButton icon="edit_note" size={18} title="Edit notes" onclick={() => openEditNotes(img)} />
                      <IconButton icon="delete" size={16} title="Delete image" onclick={() => deleteDisk(img.name)} />
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <div class="fdc-label-strip" style="margin-top: 8px; text-transform: none; letter-spacing: 0; color: var(--fg-3);">
          {filteredImages.length} image{filteredImages.length === 1 ? '' : 's'}{searchQuery ? ` matching "${searchQuery}"` : ''}
        </div>
      {/if}
    </div>
  </Card>
</div>

<!-- Edit notes modal -->
{#if editingNotes}
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Edit disk image notes"
    tabindex="-1"
    onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') editingNotes = null; }}
    style="
      position: fixed;
      inset: 0;
      z-index: 50;
      background: var(--surface-overlay);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    "
  >
    <button
      type="button"
      onclick={() => (editingNotes = null)}
      aria-label="Close"
      style="position: absolute; inset: 0; background: transparent; border: none; cursor: default;"
    ></button>
    <div
      role="document"
      style="
        position: relative;
        background: var(--surface-raised);
        border: 1px solid var(--border-2);
        border-radius: var(--radius-lg);
        box-shadow: var(--elev-4);
        width: 100%;
        max-width: 520px;
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      "
    >
      <div>
        <LabelStrip>Edit disk image</LabelStrip>
        <h3 class="fdc-mono" style="font-size: 16px; color: var(--accent); margin: 4px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          {editingNotes.name}
        </h3>
      </div>
      <div>
        <label class="fdc-label-strip" for="edit-filename" style="display: block; margin-bottom: 4px;">Filename</label>
        <Input id="edit-filename" placeholder="disk.dsk" bind:value={editFilename} />
        <div class="fdc-label-strip" style="margin-top: 4px; text-transform: none; letter-spacing: 0; color: var(--fg-3);">
          Renames the file on disk. Fails if the image is mounted on a drive.
        </div>
      </div>
      <div>
        <label class="fdc-label-strip" for="edit-desc" style="display: block; margin-bottom: 4px;">Description</label>
        <Input id="edit-desc" placeholder="Short description…" bind:value={editDescription} />
      </div>
      <div>
        <label class="fdc-label-strip" for="edit-notes" style="display: block; margin-bottom: 4px;">Notes</label>
        <TextArea id="edit-notes" rows={4} placeholder="Additional notes…" bind:value={editNotesText} />
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <Button variant="ghost" disabled={savingEdit} onclick={() => (editingNotes = null)}>Cancel</Button>
        <Button variant="filled" icon="check" disabled={savingEdit} onclick={saveEdit}>
          {savingEdit ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  </div>
{/if}

<!-- Snapshots modal -->
{#if snapshotDisk}
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Disk image snapshots"
    tabindex="-1"
    onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') snapshotDisk = null; }}
    style="
      position: fixed;
      inset: 0;
      z-index: 50;
      background: var(--surface-overlay);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    "
  >
    <button
      type="button"
      onclick={() => (snapshotDisk = null)}
      aria-label="Close"
      style="position: absolute; inset: 0; background: transparent; border: none; cursor: default;"
    ></button>
    <div
      role="document"
      style="
        position: relative;
        background: var(--surface-raised);
        border: 1px solid var(--border-2);
        border-radius: var(--radius-lg);
        box-shadow: var(--elev-4);
        width: 100%;
        max-width: 560px;
        max-height: 85vh;
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        overflow: hidden;
      "
    >
      <div>
        <LabelStrip>Snapshots</LabelStrip>
        <h3 class="fdc-mono" style="font-size: 16px; color: var(--accent); margin: 4px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title={snapshotDisk.name}>
          {snapshotDisk.name}
        </h3>
      </div>

      <!-- Create -->
      <div style="display: flex; gap: 8px; align-items: flex-end;">
        <div style="flex: 1; min-width: 0;">
          <label class="fdc-label-strip" for="snap-label" style="display: block; margin-bottom: 4px;">New snapshot label (optional)</label>
          <Input id="snap-label" placeholder="e.g. before format" bind:value={newSnapshotLabel} />
        </div>
        <Button variant="filled" icon="photo_camera" disabled={creatingSnapshot} onclick={createSnapshotForDisk}>
          {creatingSnapshot ? 'Saving…' : 'Snapshot'}
        </Button>
      </div>

      {#if snapshotDiskMounted}
        <div class="fdc-label-strip" style="text-transform: none; letter-spacing: 0; color: var(--fg-3); display: flex; align-items: center; gap: 6px;">
          <Icon name="info" size={14} />
          Mounted on a drive — rollback is disabled. Unmount to roll back.
        </div>
      {/if}

      <!-- List -->
      <div style="overflow-y: auto; display: flex; flex-direction: column; gap: 8px;">
        {#if snapshotsLoading}
          <div class="fdc-label-strip" style="text-transform: none; letter-spacing: 0; color: var(--fg-3);">Loading…</div>
        {:else if snapshots.length === 0}
          <div class="fdc-label-strip" style="text-transform: none; letter-spacing: 0; color: var(--fg-3);">
            No snapshots yet. Create one above.
          </div>
        {:else}
          {#each snapshots as snap (snap.id)}
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid var(--border-1); border-radius: var(--radius-md);">
              <div style="min-width: 0;">
                <div style="color: var(--fg-1); font: var(--text-body-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  {snap.label || 'Untitled snapshot'}
                </div>
                <div class="fdc-mono" style="font-size: 10px; color: var(--fg-3);">
                  {formatTimestamp(snap.created_at)} · {formatSize(snap.size_bytes)}
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 4px; flex: 0 0 auto;">
                <IconButton
                  icon="restore"
                  size={18}
                  title={snapshotDiskMounted ? 'Unmount to roll back' : 'Roll back to this snapshot'}
                  disabled={snapshotDiskMounted || snapshotBusyId === snap.id}
                  onclick={() => restoreSnapshotForDisk(snap)}
                />
                <IconButton
                  icon="delete"
                  size={16}
                  title="Delete snapshot"
                  disabled={snapshotBusyId === snap.id}
                  onclick={() => deleteSnapshotForDisk(snap)}
                />
              </div>
            </div>
          {/each}
        {/if}
      </div>

      <div style="display: flex; justify-content: flex-end;">
        <Button variant="ghost" onclick={() => (snapshotDisk = null)}>Close</Button>
      </div>
    </div>
  </div>
{/if}

<!-- CP/M files browser modal (experimental) -->
{#if cpmDisk}
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Browse CP/M files"
    tabindex="-1"
    onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') closeCpmBrowser(); }}
    style="
      position: fixed;
      inset: 0;
      z-index: 50;
      background: var(--surface-overlay);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    "
  >
    <button
      type="button"
      onclick={closeCpmBrowser}
      aria-label="Close"
      style="position: absolute; inset: 0; background: transparent; border: none; cursor: default;"
    ></button>
    <div
      role="document"
      style="
        position: relative;
        background: var(--surface-raised);
        border: 1px solid var(--border-2);
        border-radius: var(--radius-lg);
        box-shadow: var(--elev-4);
        width: 100%;
        max-width: 720px;
        max-height: 85vh;
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        overflow: hidden;
      "
    >
      <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;">
        <div style="min-width: 0;">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <LabelStrip>CP/M files</LabelStrip>
            <Chip color="amber" icon="science">Experimental</Chip>
          </div>
          <h3
            class="fdc-mono"
            style="font-size: 16px; color: var(--accent); margin: 4px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
            title={cpmDisk.name}
          >
            {cpmDisk.name}
          </h3>
        </div>
        <div style="display: flex; align-items: center; gap: 4px;">
          <IconButton
            icon="restart_alt"
            size={18}
            title={cpmMounted ? 'Unmount before formatting' : 'Format disk (erases everything)'}
            disabled={!!cpmMounted}
            onclick={formatCpmDisk}
          />
          <IconButton icon="close" size={18} title="Close" onclick={closeCpmBrowser} />
        </div>
      </div>

      <!-- Experimental + safety notice -->
      <div
        style="
          padding: 10px 12px;
          background: color-mix(in oklab, var(--accent) 10%, var(--surface-raised));
          border: 1px solid color-mix(in oklab, var(--accent) 30%, var(--border-1));
          border-radius: var(--radius-md);
          font: var(--text-body-sm);
          color: var(--fg-2);
          line-height: 1.5;
        "
      >
        <strong style="color: var(--fg-1);">Experimental.</strong>
        This editor walks the CP/M filesystem inside the image and writes
        directly to the .dsk on disk. Back up images before making changes.
        Uploads and deletes are blocked while the image is mounted on a drive.
      </div>

      <!-- Status bar -->
      {#if cpmLoading && !cpmInfo}
        <div style="font: var(--text-body-sm); color: var(--fg-3);">Loading CP/M filesystem…</div>
      {:else if cpmError}
        <div
          style="
            padding: 10px 12px;
            background: var(--error-container);
            border: 1px solid color-mix(in oklab, var(--error) 35%, var(--border-1));
            border-radius: var(--radius-md);
            font: var(--text-body-sm);
            color: var(--fg-1);
          "
        >
          Could not read CP/M filesystem: {cpmError}
        </div>
      {:else if cpmInfo}
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          {#if cpmMounted}
            <Chip color="amber" icon="lock">Mounted on drive {cpmInfo.mounted} (read-only)</Chip>
          {:else}
            <Chip color="green" icon="lock_open">Unmounted (writable)</Chip>
          {/if}
          <Chip>{cpmFiles.length} file{cpmFiles.length === 1 ? '' : 's'}</Chip>
          <Chip>{formatSize(cpmInfo.freeSpace.usedBytes)} used</Chip>
          <Chip>{formatSize(cpmInfo.freeSpace.freeBytes)} free</Chip>
          <Chip>{cpmInfo.freeSpace.directoryEntriesFree}/{cpmInfo.freeSpace.directoryEntriesTotal} dir slots free</Chip>
        </div>
      {/if}

      <!-- File list -->
      <div style="flex: 1; min-height: 0; overflow-y: auto; border: 1px solid var(--border-1); border-radius: var(--radius-md);">
        {#if cpmFiles.length === 0 && !cpmLoading && !cpmError}
          <div style="padding: 24px; text-align: center; font: var(--text-body-sm); color: var(--fg-3);">
            No CP/M files on this image.
          </div>
        {:else if cpmFiles.length > 0}
          <table style="width: 100%; border-collapse: collapse;">
            <thead style="position: sticky; top: 0; background: var(--surface-raised); z-index: 1;">
              <tr style="border-bottom: 1px solid var(--border-1);">
                <th class="fdc-label-strip" style="text-align: left; padding: 8px 12px;">User</th>
                <th class="fdc-label-strip" style="text-align: left; padding: 8px 12px;">Filename</th>
                <th class="fdc-label-strip" style="text-align: right; padding: 8px 12px;">Size</th>
                <th class="fdc-label-strip" style="text-align: left; padding: 8px 12px;">Attrs</th>
                <th class="fdc-label-strip" style="text-align: right; padding: 8px 12px;">Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each cpmFiles as f (cpmFileId(f))}
                <tr style="border-bottom: 1px solid var(--border-1);">
                  <td class="fdc-mono" style="padding: 6px 12px; font-size: 11px; color: var(--fg-3);">{f.user}</td>
                  <td class="fdc-mono" style="padding: 6px 12px; font-size: 12px; color: var(--fg-1);">
                    {cpmFormatName(f)}
                  </td>
                  <td class="fdc-mono" style="padding: 6px 12px; text-align: right; font-size: 11px; color: var(--fg-2); white-space: nowrap;">
                    {formatSize(f.size)}
                  </td>
                  <td style="padding: 6px 12px;">
                    <div style="display: inline-flex; gap: 4px;">
                      {#if f.readonly}<Chip color="amber">RO</Chip>{/if}
                      {#if f.system}<Chip color="cyan">SYS</Chip>{/if}
                      {#if !f.readonly && !f.system}<span style="color: var(--fg-3); font-size: 11px;">—</span>{/if}
                    </div>
                  </td>
                  <td style="padding: 6px 12px; text-align: right; white-space: nowrap;">
                    <IconButton icon="download" size={16} title="Download" onclick={() => downloadCpmFile(f)} />
                    <IconButton
                      icon="delete"
                      size={16}
                      title={cpmMounted ? 'Unmount to delete' : 'Delete from disk'}
                      disabled={!!cpmMounted}
                      onclick={() => deleteCpmFile(f)}
                    />
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>

      <!-- Upload zone -->
      <div
        role="region"
        aria-label="Upload file to CP/M image"
        ondragover={handleCpmDragOver}
        ondragleave={handleCpmDragLeave}
        ondrop={handleCpmDrop}
        style="
          padding: 14px;
          text-align: center;
          border: 1px dashed {cpmDragOver ? 'var(--accent)' : 'var(--border-2)'};
          border-radius: var(--radius-md);
          color: {cpmMounted ? 'var(--fg-3)' : 'var(--fg-2)'};
          font: var(--text-body-sm);
          background: {cpmDragOver ? 'color-mix(in oklab, var(--accent) 8%, transparent)' : 'transparent'};
          {cpmMounted ? 'opacity: 0.6;' : ''}
        "
      >
        {#if cpmMounted}
          Eject this disk from drive {cpmInfo?.mounted} to upload files.
        {:else if cpmUploading}
          Uploading…
        {:else}
          Drop a file here, or
          <button
            type="button"
            onclick={() => cpmFileInputRef?.click()}
            style="background: none; border: none; color: var(--accent); cursor: pointer; font: inherit; text-decoration: underline; padding: 0;"
          >
            choose a file
          </button>
          to add it to the CP/M filesystem. Filename is auto-shortened to 8.3.
        {/if}
        <input
          type="file"
          bind:this={cpmFileInputRef}
          onchange={handleCpmUpload}
          style="display: none;"
        />
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <Button variant="ghost" icon="refresh" onclick={() => cpmDisk && refreshCpm(cpmDisk.name)} disabled={cpmLoading}>
          Refresh
        </Button>
        <Button variant="filled" onclick={closeCpmBrowser}>Close</Button>
      </div>
    </div>
  </div>
{/if}
