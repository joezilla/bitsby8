<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/services/api';
  import { showToast } from '$lib/stores/toast';
  import type { CassetteInfo } from '$lib/types/api';
  import { Music, Upload, Play, Square, Trash2, FileEdit, Volume2 } from 'lucide-svelte';

  let cassettes = $state<CassetteInfo[]>([]);
  let loading = $state(true);
  let playingFile = $state<string | null>(null);
  let editingNotes = $state<string | null>(null);
  let editDescription = $state('');
  let editNotesText = $state('');
  let streamAudio: HTMLAudioElement | null = null;
  let streamingFile = $state<string | null>(null);
  let uploadInput: HTMLInputElement;

  function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  async function loadCassettes() {
    try {
      loading = true;
      const res = await api.listCassettes();
      cassettes = res.cassettes;
    } catch (err: any) {
      showToast(err.message || 'Failed to load cassettes', 'error');
    } finally {
      loading = false;
    }
  }

  async function playCassette(filename: string) {
    try {
      await api.playCassette(filename);
      playingFile = filename;
      showToast(`Playing "${filename}"`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to play cassette', 'error');
    }
  }

  async function stopCassette() {
    try {
      await api.stopCassette();
      playingFile = null;
      showToast('Playback stopped', 'info');
    } catch (err: any) {
      showToast(err.message || 'Failed to stop cassette', 'error');
    }
  }

  function streamCassette(filename: string) {
    // Stop any existing stream
    if (streamAudio) {
      streamAudio.pause();
      streamAudio = null;
      if (streamingFile === filename) {
        streamingFile = null;
        return;
      }
    }
    try {
      streamAudio = new Audio(`/api/cassettes/${encodeURIComponent(filename)}/stream`);
      streamAudio.play();
      streamingFile = filename;
      streamAudio.onended = () => {
        streamingFile = null;
        streamAudio = null;
      };
      streamAudio.onerror = () => {
        showToast('Audio stream failed', 'error');
        streamingFile = null;
        streamAudio = null;
      };
    } catch (err: any) {
      showToast('Failed to stream cassette', 'error');
    }
  }

  async function deleteCassette(filename: string) {
    if (!confirm(`Delete cassette "${filename}"?`)) return;
    try {
      await api.deleteCassette(filename);
      if (playingFile === filename) playingFile = null;
      if (streamingFile === filename && streamAudio) {
        streamAudio.pause();
        streamAudio = null;
        streamingFile = null;
      }
      showToast('Cassette deleted', 'success');
      await loadCassettes();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete cassette', 'error');
    }
  }

  function openNotes(cassette: CassetteInfo) {
    editingNotes = cassette.name;
    editDescription = cassette.description || '';
    editNotesText = cassette.notes || '';
  }

  async function saveNotes() {
    if (!editingNotes) return;
    try {
      await api.updateCassetteNotes(editingNotes, editDescription, editNotesText);
      editingNotes = null;
      showToast('Notes saved', 'success');
      await loadCassettes();
    } catch (err: any) {
      showToast(err.message || 'Failed to save notes', 'error');
    }
  }

  async function handleUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const form = new FormData();
      form.append('cassette', file);
      const res = await fetch('/api/cassettes/upload', { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || res.statusText);
      }
      showToast(`Uploaded "${file.name}"`, 'success');
      await loadCassettes();
    } catch (err: any) {
      showToast(err.message || 'Upload failed', 'error');
    } finally {
      input.value = '';
    }
  }

  onMount(() => {
    loadCassettes();
    return () => {
      if (streamAudio) {
        streamAudio.pause();
        streamAudio = null;
      }
    };
  });
</script>

<div class="flex flex-col gap-4">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <h2 class="text-lg font-retro text-amber tracking-wider">Cassettes</h2>
    <div class="flex gap-2">
      <button
        onclick={() => uploadInput.click()}
        class="flex items-center gap-1.5 px-3 py-1.5 bg-cyan/10 border border-cyan/30 rounded text-cyan text-xs hover:bg-cyan/20 transition-colors"
      >
        <Upload size={14} />
        Upload .wav
      </button>
      <input
        bind:this={uploadInput}
        type="file"
        accept=".wav,.cas"
        class="hidden"
        onchange={handleUpload}
      />
    </div>
  </div>

  <!-- Cassette List -->
  {#if loading}
    <div class="bg-panel rounded-lg border border-border p-6">
      <p class="text-text-dim text-sm">Loading cassettes...</p>
    </div>
  {:else if cassettes.length === 0}
    <div class="bg-panel rounded-lg border border-border p-8 text-center">
      <Music size={48} class="text-text-dim/30 mx-auto mb-3" />
      <p class="text-text-dim text-sm">No cassette files found.</p>
      <p class="text-text-dim/60 text-xs mt-1">Upload a .wav file to get started.</p>
    </div>
  {:else}
    <div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
      {#each cassettes as cassette}
        <div class="bg-panel rounded-lg border border-border p-4 flex flex-col gap-3">
          <!-- Card Header -->
          <div class="flex items-start gap-3">
            <div class="p-2 bg-amber/10 rounded shrink-0">
              <Music size={18} class="text-amber" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-sm text-text font-mono truncate" title={cassette.name}>
                {cassette.name}
              </div>
              <div class="text-xs text-text-dim">{formatSize(cassette.size)}</div>
              {#if cassette.description}
                <div class="text-xs text-text-dim/80 mt-1 truncate" title={cassette.description}>
                  {cassette.description}
                </div>
              {/if}
            </div>
          </div>

          <!-- Inline Notes Editor -->
          {#if editingNotes === cassette.name}
            <div class="flex flex-col gap-2 border-t border-border/50 pt-3">
              <div>
                <label class="block text-xs text-text-dim mb-1" for="cassette-desc">Description</label>
                <input
                  id="cassette-desc"
                  type="text"
                  bind:value={editDescription}
                  placeholder="Short description..."
                  class="w-full bg-surface border border-border rounded px-2 py-1.5 text-xs text-text placeholder:text-text-dim focus:outline-none focus:border-amber"
                />
              </div>
              <div>
                <label class="block text-xs text-text-dim mb-1" for="cassette-notes">Notes</label>
                <textarea
                  id="cassette-notes"
                  bind:value={editNotesText}
                  placeholder="Additional notes..."
                  rows="3"
                  class="w-full bg-surface border border-border rounded px-2 py-1.5 text-xs text-text placeholder:text-text-dim focus:outline-none focus:border-amber resize-none"
                ></textarea>
              </div>
              <div class="flex justify-end gap-2">
                <button
                  onclick={() => (editingNotes = null)}
                  class="px-2 py-1 bg-surface border border-border rounded text-text-dim text-xs hover:bg-surface/80 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onclick={saveNotes}
                  class="px-2 py-1 bg-green/10 border border-green/30 rounded text-green text-xs hover:bg-green/20 transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          {/if}

          <!-- Actions -->
          <div class="flex items-center gap-1.5 border-t border-border/50 pt-3">
            {#if playingFile === cassette.name}
              <button
                onclick={stopCassette}
                class="flex items-center gap-1 px-2 py-1 bg-red/10 border border-red/30 rounded text-red text-xs hover:bg-red/20 transition-colors"
                title="Stop playback"
              >
                <Square size={12} />
                Stop
              </button>
            {:else}
              <button
                onclick={() => playCassette(cassette.name)}
                class="flex items-center gap-1 px-2 py-1 bg-green/10 border border-green/30 rounded text-green text-xs hover:bg-green/20 transition-colors"
                title="Play via server (serial output)"
              >
                <Play size={12} />
                Play
              </button>
            {/if}

            <button
              onclick={() => streamCassette(cassette.name)}
              class="flex items-center gap-1 px-2 py-1 bg-cyan/10 border border-cyan/30 rounded text-xs transition-colors {streamingFile === cassette.name ? 'text-amber border-amber/30 bg-amber/10 hover:bg-amber/20' : 'text-cyan border-cyan/30 hover:bg-cyan/20'}"
              title={streamingFile === cassette.name ? 'Stop streaming' : 'Stream in browser'}
            >
              <Volume2 size={12} />
              {streamingFile === cassette.name ? 'Streaming' : 'Stream'}
            </button>

            <div class="flex-1"></div>

            <button
              onclick={() => openNotes(cassette)}
              class="p-1.5 text-text-dim hover:text-amber transition-colors"
              title="Edit notes"
            >
              <FileEdit size={14} />
            </button>
            <button
              onclick={() => deleteCassette(cassette.name)}
              class="p-1.5 text-text-dim hover:text-red transition-colors"
              title="Delete cassette"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
