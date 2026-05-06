<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/services/api';
  import { serverStatus } from '$lib/services/socket';
  import StatusLed from '$lib/components/shared/StatusLed.svelte';
  import { showToast } from '$lib/stores/toast';
  import type { DiskImageInfo, DriveState } from '$lib/types/api';
  import { Upload, Trash2, Copy, FileEdit, CircleMinus, HardDrive, Plus, Search } from 'lucide-svelte';

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

  function driveStatusColor(drive: DriveState): 'green' | 'amber' | 'off' {
    if (!drive.mounted) return 'off';
    if (drive.headLoaded) return 'amber';
    return 'green';
  }

  function driveStatusPulse(drive: DriveState): boolean {
    return drive.mounted && drive.headLoaded;
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

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    dragOver = true;
  }

  function handleDragLeave() {
    dragOver = false;
  }

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
    // Close pickers when clicking outside
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

<div class="flex flex-col gap-6">
  <h2 class="text-lg font-retro text-amber tracking-wider">Drives & Disk Images</h2>

  <!-- Drive Grid -->
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
    {#each drives as drive (drive.id)}
      <div class="bg-panel rounded-lg border border-border p-4 flex flex-col gap-2">
        <!-- Header -->
        <div class="flex items-center justify-between">
          <span class="font-retro text-amber text-lg">Drive {drive.id}</span>
          <StatusLed
            color={driveStatusColor(drive)}
            pulse={driveStatusPulse(drive)}
            size="md"
          />
        </div>

        <!-- Body -->
        <div class="flex-1 min-h-[2.5rem]">
          <p class="text-sm text-text truncate" title={drive.filename ?? ''}>
            {drive.mounted ? drive.filename : 'Empty'}
          </p>
          {#if drive.mounted}
            <div class="flex items-center gap-3 mt-1 text-xs text-text-dim">
              <span>Track {drive.track}</span>
              <span class={drive.readonly ? 'text-amber font-semibold' : 'text-green'}>
                {drive.readonly ? 'RO' : 'RW'}
              </span>
            </div>
          {/if}
        </div>

        <!-- Footer -->
        <div class="flex items-center gap-1.5 mt-1 border-t border-border pt-2">
          {#if drive.mounted}
            <button
              class="flex items-center gap-1 px-2 py-1 text-xs rounded bg-surface border border-border
                     text-text-dim hover:text-amber hover:border-amber transition-colors"
              onclick={() => unmountDisk(drive.id)}
              title="Unmount"
            >
              <CircleMinus size={12} />
              <span>Eject</span>
            </button>
            <button
              class="flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors
                     {drive.readonly
                       ? 'bg-amber/10 border-amber text-amber'
                       : 'bg-surface border-border text-text-dim hover:text-amber hover:border-amber'}"
              onclick={() => toggleReadonly(drive.id, drive.readonly)}
              title={drive.readonly ? 'Set read-write' : 'Set read-only'}
            >
              {drive.readonly ? 'RO' : 'RW'}
            </button>
          {:else}
            <div class="relative" data-mount-picker>
              <button
                class="flex items-center gap-1 px-2 py-1 text-xs rounded bg-surface border border-border
                       text-text-dim hover:text-green hover:border-green transition-colors"
                onclick={(e: MouseEvent) => { e.stopPropagation(); mountingDrive = mountingDrive === drive.id ? null : drive.id; }}
                title="Mount disk image"
              >
                <HardDrive size={12} />
                <span>Mount</span>
              </button>

              {#if mountingDrive === drive.id}
                <div class="absolute top-full left-0 mt-1 z-30 w-64 max-h-60 overflow-y-auto
                            bg-panel border border-border rounded-lg shadow-lg shadow-black/50">
                  {#if images.length === 0}
                    <p class="px-3 py-2 text-xs text-text-dim">No disk images available</p>
                  {:else}
                    {#each images as img (img.name)}
                      <button
                        class="w-full text-left px-3 py-2 text-xs text-text hover:bg-surface
                               hover:text-amber transition-colors border-b border-border last:border-b-0
                               flex items-center justify-between gap-2"
                        onclick={() => mountDisk(drive.id, img.name)}
                      >
                        <span class="truncate">{img.name}</span>
                        <span class="text-text-dim shrink-0">{formatSize(img.size)}</span>
                      </button>
                    {/each}
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    {/each}
  </div>

  <!-- Disk Image Library -->
  <div
    role="region"
    aria-label="Disk image library"
    class="bg-panel rounded-lg border border-border p-4 {dragOver ? 'border-amber border-dashed' : ''}"
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
  >
    <!-- Library Header -->
    <div class="flex flex-wrap items-center gap-3 mb-4">
      <h3 class="text-sm font-semibold text-text-dim uppercase tracking-wider mr-auto">
        Disk Image Library
      </h3>

      <!-- Search -->
      <div class="relative">
        <Search size={14} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-dim" />
        <input
          type="text"
          placeholder="Filter images..."
          bind:value={searchQuery}
          class="pl-8 pr-3 py-1.5 text-xs bg-surface border border-border rounded
                 text-text placeholder:text-text-dim/50 focus:border-amber focus:outline-none
                 w-48 font-mono"
        />
      </div>

      <!-- Upload -->
      <button
        class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-surface border border-border
               text-text-dim hover:text-cyan hover:border-cyan transition-colors"
        onclick={() => fileInputRef?.click()}
        disabled={uploading}
      >
        <Upload size={13} />
        <span>{uploading ? 'Uploading...' : 'Upload'}</span>
      </button>
      <input
        type="file"
        accept=".img,.dsk,.cpm,.raw,.IMD,.imd"
        multiple
        class="hidden"
        bind:this={fileInputRef}
        onchange={handleUpload}
      />

      <!-- Create Blank -->
      <button
        class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-surface border border-border
               text-text-dim hover:text-green hover:border-green transition-colors"
        onclick={() => { showCreateDialog = !showCreateDialog; }}
      >
        <Plus size={13} />
        <span>New Disk</span>
      </button>
    </div>

    <!-- Create Dialog -->
    {#if showCreateDialog}
      <div class="mb-4 p-3 bg-surface rounded-lg border border-border flex flex-wrap items-end gap-3">
        <div class="flex flex-col gap-1">
          <label for="new-disk-name" class="text-xs text-text-dim">Filename</label>
          <input
            id="new-disk-name"
            type="text"
            placeholder="mydisk"
            bind:value={newDiskName}
            class="px-2 py-1 text-xs bg-panel border border-border rounded text-text
                   placeholder:text-text-dim/50 focus:border-amber focus:outline-none
                   w-40 font-mono"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label for="new-disk-format" class="text-xs text-text-dim">Format</label>
          <select
            id="new-disk-format"
            bind:value={newDiskFormat}
            class="px-2 py-1 text-xs bg-panel border border-border rounded text-text
                   focus:border-amber focus:outline-none font-mono"
          >
            <option value="8dssd">8" SSSD (250 KB)</option>
            <option value="8dsdd">8" SSDD (500 KB)</option>
            <option value="5dsdd">5.25" DSDD (360 KB)</option>
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label for="new-disk-ext" class="text-xs text-text-dim">Extension</label>
          <select
            id="new-disk-ext"
            bind:value={newDiskExtension}
            class="px-2 py-1 text-xs bg-panel border border-border rounded text-text
                   focus:border-amber focus:outline-none font-mono"
          >
            <option value=".img">.img</option>
            <option value=".dsk">.dsk</option>
            <option value=".cpm">.cpm</option>
          </select>
        </div>
        <button
          class="px-3 py-1 text-xs rounded bg-green/20 border border-green text-green
                 hover:bg-green/30 transition-colors"
          onclick={createBlankDisk}
        >
          Create
        </button>
        <button
          class="px-3 py-1 text-xs rounded bg-surface border border-border text-text-dim
                 hover:text-text transition-colors"
          onclick={() => { showCreateDialog = false; }}
        >
          Cancel
        </button>
      </div>
    {/if}

    <!-- Drag-drop overlay hint -->
    {#if dragOver}
      <div class="flex items-center justify-center py-8 mb-4 border-2 border-dashed border-amber rounded-lg">
        <p class="text-amber font-retro text-sm">Drop disk image files here</p>
      </div>
    {/if}

    <!-- Image Table -->
    {#if loading}
      <p class="text-text-dim text-sm py-4">Loading disk images...</p>
    {:else if filteredImages.length === 0}
      <p class="text-text-dim text-sm py-4">
        {searchQuery ? 'No images match your filter.' : 'No disk images found. Upload or create one to get started.'}
      </p>
    {:else}
      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-border text-text-dim uppercase tracking-wider">
              <th class="text-left py-2 px-2 font-semibold">Name</th>
              <th class="text-right py-2 px-2 font-semibold">Size</th>
              <th class="text-left py-2 px-2 font-semibold hidden md:table-cell">Description</th>
              <th class="text-right py-2 px-2 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredImages as img (img.name)}
              <tr class="border-b border-border/50 hover:bg-surface/50 transition-colors group">
                <td class="py-2 px-2 font-mono text-text">
                  <span class="truncate block max-w-[14rem]" title={img.name}>{img.name}</span>
                </td>
                <td class="py-2 px-2 text-right text-text-dim whitespace-nowrap">
                  {formatSize(img.size)}
                </td>
                <td class="py-2 px-2 text-text-dim hidden md:table-cell">
                  <span class="truncate block max-w-[20rem]" title={img.description ?? ''}>
                    {img.description || '\u2014'}
                  </span>
                </td>
                <td class="py-2 px-2 text-right">
                  <div class="flex items-center justify-end gap-1">
                    <!-- Mount to drive picker -->
                    <div class="relative" data-mount-picker>
                      <button
                        class="p-1.5 rounded text-text-dim hover:text-green hover:bg-green/10
                               transition-colors"
                        onclick={(e: MouseEvent) => {
                          e.stopPropagation();
                          mountingImage = mountingImage === img.name ? null : img.name;
                          mountingDrive = null;
                        }}
                        title="Mount to drive"
                      >
                        <HardDrive size={13} />
                      </button>

                      {#if mountingImage === img.name}
                        <div class="absolute top-full right-0 mt-1 z-30 w-36
                                    bg-panel border border-border rounded-lg shadow-lg shadow-black/50">
                          {#each [0, 1, 2, 3] as driveId}
                            {@const driveState = drives.find((d) => d.id === driveId)}
                            <button
                              class="w-full text-left px-3 py-2 text-xs text-text hover:bg-surface
                                     hover:text-amber transition-colors border-b border-border
                                     last:border-b-0 flex items-center justify-between"
                              onclick={() => mountDisk(driveId, img.name)}
                            >
                              <span>Drive {driveId}</span>
                              {#if driveState?.mounted}
                                <span class="text-text-dim truncate ml-2 max-w-[4rem]" title={driveState.filename ?? ''}>
                                  {driveState.filename}
                                </span>
                              {:else}
                                <span class="text-text-dim">Empty</span>
                              {/if}
                            </button>
                          {/each}
                        </div>
                      {/if}
                    </div>

                    <!-- Clone -->
                    <button
                      class="p-1.5 rounded text-text-dim hover:text-cyan hover:bg-cyan/10
                             transition-colors"
                      onclick={() => cloneDisk(img.name)}
                      title="Clone image"
                    >
                      <Copy size={13} />
                    </button>

                    <!-- Edit notes -->
                    <button
                      class="p-1.5 rounded text-text-dim hover:text-amber hover:bg-amber/10
                             transition-colors"
                      onclick={() => openEditNotes(img)}
                      title="Edit notes"
                    >
                      <FileEdit size={13} />
                    </button>

                    <!-- Delete -->
                    <button
                      class="p-1.5 rounded text-text-dim hover:text-red hover:bg-red/10
                             transition-colors"
                      onclick={() => deleteDisk(img.name)}
                      title="Delete image"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="text-text-dim text-xs mt-2">
        {filteredImages.length} image{filteredImages.length === 1 ? '' : 's'}
        {searchQuery ? ` matching "${searchQuery}"` : ''}
      </p>
    {/if}
  </div>

  <!-- Edit Notes Modal -->
  {#if editingNotes}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4"
      onclick={() => { editingNotes = null; }}
      onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') editingNotes = null; }}
      role="dialog"
      aria-modal="true"
      aria-label="Edit disk image notes"
      tabindex="-1"
    >
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="bg-panel border border-border rounded-lg shadow-xl shadow-black/40
               w-full max-w-md p-5 flex flex-col gap-4"
        onclick={(e: MouseEvent) => e.stopPropagation()}
      >
        <h3 class="font-retro text-amber text-sm tracking-wider">
          Edit Notes: {editingNotes.name}
        </h3>

        <div class="flex flex-col gap-1">
          <label for="edit-desc" class="text-xs text-text-dim">Description</label>
          <input
            id="edit-desc"
            type="text"
            bind:value={editDescription}
            class="px-3 py-1.5 text-xs bg-surface border border-border rounded text-text
                   placeholder:text-text-dim/50 focus:border-amber focus:outline-none font-mono"
            placeholder="Short description..."
          />
        </div>

        <div class="flex flex-col gap-1">
          <label for="edit-notes" class="text-xs text-text-dim">Notes</label>
          <textarea
            id="edit-notes"
            bind:value={editNotesText}
            rows={4}
            class="px-3 py-1.5 text-xs bg-surface border border-border rounded text-text
                   placeholder:text-text-dim/50 focus:border-amber focus:outline-none font-mono
                   resize-y"
            placeholder="Additional notes..."
          ></textarea>
        </div>

        <div class="flex items-center justify-end gap-2">
          <button
            class="px-3 py-1.5 text-xs rounded bg-surface border border-border text-text-dim
                   hover:text-text transition-colors"
            onclick={() => { editingNotes = null; }}
          >
            Cancel
          </button>
          <button
            class="px-3 py-1.5 text-xs rounded bg-amber/20 border border-amber text-amber
                   hover:bg-amber/30 transition-colors"
            onclick={saveNotes}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
