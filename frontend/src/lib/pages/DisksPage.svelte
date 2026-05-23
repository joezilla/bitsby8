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
  import type { DiskImageInfo, DriveState } from '$lib/types/api';

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
  let editDescription = $state('');
  let editNotesText = $state('');
  let showCreateDialog = $state(false);
  let newDiskName = $state('');
  let newDiskFormat = $state('8dssd');
  let newDiskExtension = $state('.img');

  let fileInputRef = $state<HTMLInputElement | null>(null);

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
      track: 0,
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

  async function saveNotes() {
    if (!editingNotes) return;
    try {
      await api.updateImageNotes(editingNotes.name, editDescription, editNotesText);
      showToast(`Notes updated for ${editingNotes.name}`, 'success');
      editingNotes = null;
      await loadImages();
    } catch (err: any) {
      showToast(`Failed to save notes: ${err.message}`, 'error');
    }
  }

  function openEditNotes(image: DiskImageInfo) {
    editingNotes = image;
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

<div style="padding: 0 28px 28px; display: flex; flex-direction: column; gap: 20px;">
  <!-- Drive bays -->
  <div>
    <div style="margin-bottom: 10px;"><LabelStrip>Drive bays</LabelStrip></div>
    <div
      style="
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
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
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 12px; align-items: end;">
          <div>
            <label class="fdc-label-strip" for="new-disk-name" style="display: block; margin-bottom: 4px;">Filename</label>
            <Input id="new-disk-name" placeholder="mydisk" bind:value={newDiskName} />
          </div>
          <div>
            <label class="fdc-label-strip" for="new-disk-format" style="display: block; margin-bottom: 4px;">Format</label>
            <Select id="new-disk-format" bind:value={newDiskFormat}>
              <option value="8dssd">8" SSSD (250 KB)</option>
              <option value="8dsdd">8" SSDD (500 KB)</option>
              <option value="5dsdd">5.25" DSDD (360 KB)</option>
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
        <div style="flex: 1; min-width: 200px;">
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
        <LabelStrip>Edit notes</LabelStrip>
        <h3 class="fdc-mono" style="font-size: 16px; color: var(--accent); margin: 4px 0 0;">
          {editingNotes.name}
        </h3>
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
        <Button variant="ghost" onclick={() => (editingNotes = null)}>Cancel</Button>
        <Button variant="filled" icon="check" onclick={saveNotes}>Save</Button>
      </div>
    </div>
  </div>
{/if}
