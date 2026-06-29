<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/services/api';
  import { showToast } from '$lib/stores/toast';
  import Icon from '$lib/components/shared/Icon.svelte';
  import IconButton from '$lib/components/shared/IconButton.svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import Card from '$lib/components/shared/Card.svelte';
  import Chip from '$lib/components/shared/Chip.svelte';
  import Input from '$lib/components/shared/Input.svelte';
  import TextArea from '$lib/components/shared/TextArea.svelte';
  import PageHeader from '$lib/components/shared/PageHeader.svelte';
  import LabelStrip from '$lib/components/shared/LabelStrip.svelte';
  import type { CassetteInfo } from '$lib/types/api';

  let cassettes = $state<CassetteInfo[]>([]);
  let loading = $state(true);
  let playingFile = $state<string | null>(null);
  let editingNotes = $state<string | null>(null);
  let editDescription = $state('');
  let editNotesText = $state('');
  let streamAudio: HTMLAudioElement | null = null;
  let streamingFile = $state<string | null>(null);
  let uploadInput: HTMLInputElement | undefined = $state();

  let activeCassette = $derived(
    cassettes.find((c) => c.name === playingFile) ??
      cassettes.find((c) => c.name === streamingFile) ??
      null
  );

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
    } catch {
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

{#snippet headerActions()}
  <Button variant="filled" icon="upload" onclick={() => uploadInput?.click()}>Upload .wav</Button>
  <input
    bind:this={uploadInput}
    type="file"
    accept=".wav,.cas"
    style="display: none;"
    onchange={handleUpload}
  />
{/snippet}

<PageHeader
  eyebrow="Section · Cassettes · Audio out"
  title="Cassettes"
  subtitle="Tape audio for SAVE / LOAD on the Altair. Play through the FDC+ serial output or stream in-browser."
  actions={headerActions}
/>

<div style="padding: 0 28px 28px; display: flex; flex-direction: column; gap: 16px;">
  {#if activeCassette}
    <Card raised>
      <div style="padding: 18px; display: flex; align-items: center; gap: 16px;">
        <div
          style="
            padding: 12px;
            background: var(--accent-bg);
            border-radius: var(--radius-md);
            flex: 0 0 auto;
            display: inline-flex;
          "
        >
          <Icon name="album" size={24} class="text-accent" />
        </div>
        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <LabelStrip>Current cassette</LabelStrip>
            {#if playingFile === activeCassette.name}
              <Chip color="amber" icon="play_arrow">Playing</Chip>
            {/if}
            {#if streamingFile === activeCassette.name}
              <Chip color="cyan" icon="graphic_eq">Streaming</Chip>
            {/if}
          </div>
          <div
            class="fdc-mono"
            style="font-size: 16px; color: var(--fg-1); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
            title={activeCassette.name}
          >
            {activeCassette.name}
          </div>
          {#if activeCassette.description}
            <div
              style="font: var(--text-body-sm); color: var(--fg-2); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
              title={activeCassette.description}
            >
              {activeCassette.description}
            </div>
          {/if}
        </div>
        <div style="display: flex; gap: 8px; flex: 0 0 auto;">
          {#if playingFile === activeCassette.name}
            <Button variant="ghost" icon="stop" danger onclick={stopCassette}>Stop</Button>
          {/if}
          {#if streamingFile === activeCassette.name}
            <Button variant="ghost" icon="graphic_eq" onclick={() => streamCassette(activeCassette.name)}>Stop stream</Button>
          {/if}
        </div>
      </div>
    </Card>
  {/if}

  {#if loading}
    <Card>
      <div style="padding: 24px; font: var(--text-body-sm); color: var(--fg-3);">
        Loading cassettes…
      </div>
    </Card>
  {:else if cassettes.length === 0}
    <Card>
      <div style="padding: 40px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px;">
        <Icon name="album" size={24} class="text-fg-4" />
        <div style="font: var(--text-body); color: var(--fg-2);">No cassette files found.</div>
        <div style="font: var(--text-body-sm); color: var(--fg-3);">Upload a .wav file to get started.</div>
      </div>
    </Card>
  {:else}
    <div
      style="
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 12px;
      "
    >
      {#each cassettes as cassette}
        <Card>
          <div style="padding: 16px; display: flex; flex-direction: column; gap: 12px;">
            <!-- Header -->
            <div style="display: flex; align-items: flex-start; gap: 12px;">
              <div
                style="
                  padding: 8px;
                  background: var(--accent-bg);
                  border-radius: var(--radius-sm);
                  flex: 0 0 auto;
                  display: inline-flex;
                "
              >
                <Icon name="album" size={20} class="text-accent" />
              </div>
              <div style="flex: 1; min-width: 0;">
                <div
                  class="fdc-mono"
                  style="font-size: 13px; color: var(--fg-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                  title={cassette.name}
                >
                  {cassette.name}
                </div>
                <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px;">
                  <Chip>{formatSize(cassette.size)}</Chip>
                  {#if playingFile === cassette.name}
                    <Chip color="amber" icon="play_arrow">Playing</Chip>
                  {/if}
                  {#if streamingFile === cassette.name}
                    <Chip color="cyan" icon="graphic_eq">Streaming</Chip>
                  {/if}
                </div>
                {#if cassette.description}
                  <div
                    style="font: var(--text-body-sm); color: var(--fg-2); margin-top: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                    title={cassette.description}
                  >
                    {cassette.description}
                  </div>
                {/if}
              </div>
            </div>

            <!-- Inline notes editor -->
            {#if editingNotes === cassette.name}
              <div
                style="
                  display: flex;
                  flex-direction: column;
                  gap: 8px;
                  padding-top: 12px;
                  border-top: 1px solid var(--border-1);
                "
              >
                <div>
                  <label class="fdc-label-strip" for="cassette-desc-{cassette.name}" style="display: block; margin-bottom: 4px;">Description</label>
                  <Input id="cassette-desc-{cassette.name}" bind:value={editDescription} placeholder="Short description…" />
                </div>
                <div>
                  <label class="fdc-label-strip" for="cassette-notes-{cassette.name}" style="display: block; margin-bottom: 4px;">Notes</label>
                  <TextArea id="cassette-notes-{cassette.name}" bind:value={editNotesText} rows={3} placeholder="Additional notes…" />
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 8px;">
                  <Button variant="ghost" size="sm" onclick={() => (editingNotes = null)}>Cancel</Button>
                  <Button variant="filled" size="sm" icon="check" onclick={saveNotes}>Save</Button>
                </div>
              </div>
            {/if}

            <!-- Actions -->
            <div
              style="
                display: flex;
                align-items: center;
                gap: 6px;
                padding-top: 12px;
                border-top: 1px solid var(--border-1);
              "
            >
              {#if playingFile === cassette.name}
                <Button variant="ghost" size="sm" icon="stop" danger onclick={stopCassette}>Stop</Button>
              {:else}
                <Button variant="tonal" size="sm" icon="play_arrow" onclick={() => playCassette(cassette.name)}>Play</Button>
              {/if}
              <Button
                variant={streamingFile === cassette.name ? 'filled' : 'ghost'}
                size="sm"
                icon="graphic_eq"
                onclick={() => streamCassette(cassette.name)}
              >
                {streamingFile === cassette.name ? 'Streaming' : 'Stream'}
              </Button>
              <div style="flex: 1;"></div>
              <IconButton icon="edit_note" size={18} title="Edit notes" onclick={() => openNotes(cassette)} />
              <IconButton icon="delete" size={16} title="Delete cassette" onclick={() => deleteCassette(cassette.name)} />
            </div>
          </div>
        </Card>
      {/each}
    </div>
  {/if}
</div>
