<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/services/api';
  import { replayProgress } from '$lib/services/socket';
  import { showToast } from '$lib/stores/toast';
  import type { ScriptInfo } from '$lib/types/api';
  import { FileText, Upload, Plus, Play, Square, Trash2, Send } from 'lucide-svelte';

  let scripts = $state<ScriptInfo[]>([]);
  let selectedScript = $state<string | null>(null);
  let scriptContent = $state('');
  let loading = $state(true);
  let editing = $state(false);
  let showNewModal = $state(false);
  let newScriptName = $state('');
  let newScriptContent = $state('');
  let replayMode = $state<'raw' | 'xmodem'>('raw');
  let searchQuery = $state('');
  let uploadInput: HTMLInputElement;

  let filteredScripts = $derived(
    searchQuery
      ? scripts.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
      : scripts
  );

  let progress = $derived($replayProgress);
  let isReplaying = $derived(progress?.state === 'running');

  function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  async function loadScripts() {
    try {
      loading = true;
      const res = await api.listScripts();
      scripts = res.scripts;
    } catch (err: any) {
      showToast(err.message || 'Failed to load scripts', 'error');
    } finally {
      loading = false;
    }
  }

  async function selectScript(name: string) {
    try {
      selectedScript = name;
      editing = false;
      const res = await api.getScript(name);
      if (res.binary) {
        scriptContent = '(Binary file — cannot display)';
      } else {
        scriptContent = res.content ?? '';
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to load script', 'error');
      scriptContent = '';
    }
  }

  async function saveScript() {
    if (!selectedScript) return;
    try {
      await api.updateScript(selectedScript, scriptContent);
      editing = false;
      showToast('Script saved', 'success');
      await loadScripts();
    } catch (err: any) {
      showToast(err.message || 'Failed to save script', 'error');
    }
  }

  async function createScript() {
    if (!newScriptName.trim()) {
      showToast('Script name is required', 'warning');
      return;
    }
    try {
      await api.createScript(newScriptName.trim(), newScriptContent);
      showNewModal = false;
      newScriptName = '';
      newScriptContent = '';
      showToast('Script created', 'success');
      await loadScripts();
    } catch (err: any) {
      showToast(err.message || 'Failed to create script', 'error');
    }
  }

  async function deleteScript(name: string) {
    if (!confirm(`Delete script "${name}"?`)) return;
    try {
      await api.deleteScript(name);
      if (selectedScript === name) {
        selectedScript = null;
        scriptContent = '';
      }
      showToast('Script deleted', 'success');
      await loadScripts();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete script', 'error');
    }
  }

  async function startReplay(name: string) {
    try {
      await api.startReplay(name, replayMode);
      showToast(`Replay started (${replayMode})`, 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to start replay', 'error');
    }
  }

  async function cancelReplay() {
    try {
      await api.cancelReplay();
      showToast('Replay cancelled', 'info');
    } catch (err: any) {
      showToast(err.message || 'Failed to cancel replay', 'error');
    }
  }

  async function handleUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const form = new FormData();
      form.append('script', file);
      const res = await fetch('/api/scripts/upload', { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || res.statusText);
      }
      showToast(`Uploaded "${file.name}"`, 'success');
      await loadScripts();
    } catch (err: any) {
      showToast(err.message || 'Upload failed', 'error');
    } finally {
      input.value = '';
    }
  }

  onMount(() => {
    loadScripts();
  });
</script>

<div class="flex flex-col gap-4 h-full">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <h2 class="text-lg font-retro text-amber tracking-wider">Scripts</h2>
  </div>

  <div class="flex gap-4 flex-1 min-h-0">
    <!-- Left Panel: Script List (1/3) -->
    <div class="w-1/3 flex flex-col gap-3 min-h-0">
      <!-- Search & Actions -->
      <div class="flex gap-2">
        <input
          type="text"
          placeholder="Search scripts..."
          bind:value={searchQuery}
          class="flex-1 bg-surface border border-border rounded px-3 py-1.5 text-sm text-text placeholder:text-text-dim focus:outline-none focus:border-amber"
        />
      </div>
      <div class="flex gap-2">
        <button
          onclick={() => (showNewModal = true)}
          class="flex items-center gap-1.5 px-3 py-1.5 bg-amber/10 border border-amber/30 rounded text-amber text-xs hover:bg-amber/20 transition-colors"
        >
          <Plus size={14} />
          New
        </button>
        <button
          onclick={() => uploadInput.click()}
          class="flex items-center gap-1.5 px-3 py-1.5 bg-cyan/10 border border-cyan/30 rounded text-cyan text-xs hover:bg-cyan/20 transition-colors"
        >
          <Upload size={14} />
          Upload
        </button>
        <input
          bind:this={uploadInput}
          type="file"
          class="hidden"
          onchange={handleUpload}
        />
      </div>

      <!-- Script List -->
      <div class="flex-1 overflow-y-auto bg-panel rounded-lg border border-border">
        {#if loading}
          <div class="p-4 text-text-dim text-sm">Loading scripts...</div>
        {:else if filteredScripts.length === 0}
          <div class="p-4 text-text-dim text-sm">
            {searchQuery ? 'No scripts match your search.' : 'No scripts found.'}
          </div>
        {:else}
          {#each filteredScripts as script}
            <div
              role="button"
              tabindex="0"
              onclick={() => selectScript(script.name)}
              onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') selectScript(script.name); }}
              class="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-surface/50 transition-colors border-b border-border/50 last:border-b-0 cursor-pointer {selectedScript === script.name ? 'bg-amber/10 border-l-2 border-l-amber' : ''}"
            >
              <FileText size={16} class="text-text-dim shrink-0" />
              <div class="flex-1 min-w-0">
                <div class="text-sm text-text truncate">{script.name}</div>
                <div class="text-xs text-text-dim">{formatSize(script.size)}</div>
              </div>
              <button
                onclick={(e: MouseEvent) => { e.stopPropagation(); deleteScript(script.name); }}
                class="p-1 text-text-dim hover:text-red transition-colors shrink-0"
                title="Delete script"
              >
                <Trash2 size={14} />
              </button>
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <!-- Right Panel: Editor (2/3) -->
    <div class="w-2/3 flex flex-col gap-3 min-h-0">
      {#if selectedScript}
        <!-- Editor Header -->
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <FileText size={16} class="text-amber" />
            <span class="text-sm font-mono text-amber">{selectedScript}</span>
          </div>
          <div class="flex gap-2">
            {#if editing}
              <button
                onclick={saveScript}
                class="px-3 py-1.5 bg-green/10 border border-green/30 rounded text-green text-xs hover:bg-green/20 transition-colors"
              >
                Save
              </button>
              <button
                onclick={() => { editing = false; selectScript(selectedScript!); }}
                class="px-3 py-1.5 bg-surface border border-border rounded text-text-dim text-xs hover:bg-surface/80 transition-colors"
              >
                Cancel
              </button>
            {:else}
              <button
                onclick={() => (editing = true)}
                class="px-3 py-1.5 bg-surface border border-border rounded text-text text-xs hover:bg-surface/80 transition-colors"
              >
                Edit
              </button>
            {/if}
          </div>
        </div>

        <!-- Text Editor -->
        <textarea
          bind:value={scriptContent}
          readonly={!editing}
          class="flex-1 bg-surface border border-border rounded-lg p-4 font-mono text-sm text-text resize-none focus:outline-none focus:border-amber {editing ? 'bg-surface' : 'bg-panel'}"
          spellcheck="false"
        ></textarea>

        <!-- Replay Controls -->
        <div class="bg-panel rounded-lg border border-border p-3">
          <div class="flex items-center gap-3">
            <span class="text-xs text-text-dim uppercase tracking-wider shrink-0">Replay</span>
            <select
              bind:value={replayMode}
              class="bg-surface border border-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:border-amber"
            >
              <option value="raw">Raw</option>
              <option value="xmodem">XMODEM</option>
            </select>
            {#if isReplaying}
              <button
                onclick={cancelReplay}
                class="flex items-center gap-1.5 px-3 py-1.5 bg-red/10 border border-red/30 rounded text-red text-xs hover:bg-red/20 transition-colors"
              >
                <Square size={14} />
                Cancel
              </button>
            {:else}
              <button
                onclick={() => startReplay(selectedScript!)}
                class="flex items-center gap-1.5 px-3 py-1.5 bg-green/10 border border-green/30 rounded text-green text-xs hover:bg-green/20 transition-colors"
              >
                <Send size={14} />
                Send
              </button>
            {/if}
          </div>

          <!-- Progress Bar -->
          {#if progress && (progress.state === 'running' || progress.state === 'completed')}
            <div class="mt-3">
              <div class="flex items-center justify-between text-xs text-text-dim mb-1">
                <span class="truncate">{progress.fileName}</span>
                <span>{progress.percentComplete}%</span>
              </div>
              <div class="w-full h-2 bg-surface rounded-full overflow-hidden">
                <div
                  class="h-full rounded-full transition-all duration-300 {progress.state === 'completed' ? 'bg-green' : 'bg-amber'}"
                  style="width: {progress.percentComplete}%"
                ></div>
              </div>
              {#if progress.state === 'completed'}
                <div class="text-xs text-green mt-1">Transfer complete</div>
              {/if}
            </div>
          {/if}
          {#if progress?.state === 'error'}
            <div class="mt-2 text-xs text-red">{progress.error || 'Replay error'}</div>
          {/if}
        </div>
      {:else}
        <!-- Placeholder -->
        <div class="flex-1 flex items-center justify-center bg-panel rounded-lg border border-border">
          <div class="text-center">
            <FileText size={48} class="text-text-dim/30 mx-auto mb-3" />
            <p class="text-text-dim text-sm">Select a script to view or edit</p>
          </div>
        </div>
      {/if}
    </div>
  </div>

  <!-- New Script Modal -->
  {#if showNewModal}
    <div class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
      <div class="bg-panel border border-border rounded-lg p-6 w-full max-w-lg mx-4 shadow-xl">
        <h3 class="text-sm font-retro text-amber tracking-wider mb-4">Create New Script</h3>
        <div class="flex flex-col gap-3">
          <div>
            <label class="block text-xs text-text-dim mb-1">Filename</label>
            <input
              type="text"
              bind:value={newScriptName}
              placeholder="my-script.txt"
              class="w-full bg-surface border border-border rounded px-3 py-2 text-sm text-text placeholder:text-text-dim focus:outline-none focus:border-amber"
            />
          </div>
          <div>
            <label class="block text-xs text-text-dim mb-1">Content</label>
            <textarea
              bind:value={newScriptContent}
              placeholder="Enter script content..."
              rows="8"
              class="w-full bg-surface border border-border rounded px-3 py-2 text-sm text-text font-mono placeholder:text-text-dim focus:outline-none focus:border-amber resize-none"
              spellcheck="false"
            ></textarea>
          </div>
          <div class="flex justify-end gap-2 mt-2">
            <button
              onclick={() => { showNewModal = false; newScriptName = ''; newScriptContent = ''; }}
              class="px-4 py-2 bg-surface border border-border rounded text-text-dim text-sm hover:bg-surface/80 transition-colors"
            >
              Cancel
            </button>
            <button
              onclick={createScript}
              class="px-4 py-2 bg-amber/10 border border-amber/30 rounded text-amber text-sm hover:bg-amber/20 transition-colors"
            >
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>
