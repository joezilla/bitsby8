<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/services/api';
  import { replayProgress } from '$lib/services/socket';
  import { showToast } from '$lib/stores/toast';
  import Icon from '$lib/components/shared/Icon.svelte';
  import IconButton from '$lib/components/shared/IconButton.svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import Card from '$lib/components/shared/Card.svelte';
  import Chip from '$lib/components/shared/Chip.svelte';
  import Input from '$lib/components/shared/Input.svelte';
  import Select from '$lib/components/shared/Select.svelte';
  import TextArea from '$lib/components/shared/TextArea.svelte';
  import PageHeader from '$lib/components/shared/PageHeader.svelte';
  import LabelStrip from '$lib/components/shared/LabelStrip.svelte';
  import type { ScriptInfo } from '$lib/types/api';

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
  let uploadInput: HTMLInputElement | undefined = $state();
  let expectingNewProgress = $state(false);

  $effect(() => {
    if ($replayProgress?.state === 'running') {
      expectingNewProgress = false;
    }
  });

  let filteredScripts = $derived(
    searchQuery
      ? scripts.filter((s) => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
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
    // Hide stale progress from a previous run until the next 'running' event arrives.
    expectingNewProgress = true;
    try {
      await api.startReplay(name, replayMode);
      showToast(`Replay started (${replayMode})`, 'success');
    } catch (err: any) {
      expectingNewProgress = false;
      showToast(err.message || 'Failed to start replay', 'error');
    }
  }

  async function cancelReplay() {
    expectingNewProgress = false;
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
      await api.uploadScript(file);
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

{#snippet headerActions()}
  <Button variant="filled" icon="add" onclick={() => (showNewModal = true)}>New script</Button>
  <Button variant="ghost" icon="upload" onclick={() => uploadInput?.click()}>Upload</Button>
  <input bind:this={uploadInput} type="file" style="display: none;" onchange={handleUpload} />
{/snippet}

<PageHeader
  eyebrow="Section · Scripts · Replay"
  title="Scripts"
  subtitle="Compose, edit, and replay scripts to the FDC+ serial line."
  actions={headerActions}
/>

<div
  class="fdc-page-body"
  style="
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 16px;
  "
>
  <!-- Left: script list -->
  <div style="width: 320px; flex: 0 0 320px; display: flex; flex-direction: column; gap: 12px; min-height: 0;">
    <Input variant="search" placeholder="Filter scripts…" bind:value={searchQuery} />

    <Card>
      <div style="flex: 1; overflow-y: auto; max-height: 60vh;">
        {#if loading}
          <div style="padding: 16px; font: var(--text-body-sm); color: var(--fg-3);">Loading scripts…</div>
        {:else if filteredScripts.length === 0}
          <div style="padding: 16px; font: var(--text-body-sm); color: var(--fg-3);">
            {searchQuery ? 'No scripts match your search.' : 'No scripts found.'}
          </div>
        {:else}
          {#each filteredScripts as script}
            {@const isActive = selectedScript === script.name}
            <div
              role="button"
              tabindex="0"
              onclick={() => selectScript(script.name)}
              onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') selectScript(script.name); }}
              style="
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 10px 12px;
                cursor: pointer;
                border-bottom: 1px solid var(--border-1);
                background: {isActive ? 'var(--accent-bg)' : 'transparent'};
                border-left: 3px solid {isActive ? 'var(--accent)' : 'transparent'};
                transition: background var(--dur-short) var(--ease-standard);
              "
            >
              <Icon name="description" size={18} class={isActive ? 'text-accent' : 'text-fg-3'} />
              <div style="flex: 1; min-width: 0;">
                <div
                  class="fdc-mono"
                  style="font-size: 12px; color: {isActive ? 'var(--accent)' : 'var(--fg-1)'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                >
                  {script.name}
                </div>
                <div class="fdc-label-strip" style="margin-top: 2px;">
                  {formatSize(script.size)}
                </div>
              </div>
              <IconButton
                icon="delete"
                size={16}
                title="Delete script"
                onclick={(e: MouseEvent) => { e.stopPropagation(); deleteScript(script.name); }}
              />
            </div>
          {/each}
        {/if}
      </div>
    </Card>
  </div>

  <!-- Right: editor -->
  <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 12px; min-height: 0;">
    {#if selectedScript}
      <!-- Editor header -->
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <Icon name="description" size={20} class="text-accent" />
          <span class="fdc-mono" style="font-size: 14px; color: var(--accent);">{selectedScript}</span>
        </div>
        <div style="display: flex; gap: 8px;">
          {#if editing}
            <Button variant="ghost" size="sm" onclick={() => { editing = false; selectScript(selectedScript!); }}>Cancel</Button>
            <Button variant="filled" size="sm" icon="save" onclick={saveScript}>Save</Button>
          {:else}
            <Button variant="outline" size="sm" icon="edit" onclick={() => (editing = true)}>Edit</Button>
          {/if}
        </div>
      </div>

      <!-- Editor -->
      <textarea
        bind:value={scriptContent}
        readonly={!editing}
        spellcheck="false"
        class="fdc-mono"
        style="
          flex: 1;
          min-height: 200px;
          background: {editing ? 'var(--surface-sunken)' : 'var(--surface)'};
          border: 1px solid var(--border-2);
          border-radius: var(--radius-md);
          padding: 16px;
          font-size: 12.5px;
          color: var(--fg-1);
          resize: none;
          outline: none;
          line-height: 1.5;
        "
        onfocus={(e: Event) => {
          if (editing) {
            (e.target as HTMLTextAreaElement).style.borderColor = 'var(--accent)';
            (e.target as HTMLTextAreaElement).style.boxShadow = '0 0 0 3px var(--ring)';
          }
        }}
        onblur={(e: Event) => {
          (e.target as HTMLTextAreaElement).style.borderColor = 'var(--border-2)';
          (e.target as HTMLTextAreaElement).style.boxShadow = 'none';
        }}
      ></textarea>

      <!-- Replay controls -->
      <Card>
        <div style="padding: 14px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <LabelStrip>Replay</LabelStrip>
            <div style="width: 140px;">
              <Select bind:value={replayMode}>
                <option value="raw">Raw</option>
                <option value="xmodem">XMODEM</option>
              </Select>
            </div>
            {#if isReplaying}
              <Button variant="ghost" size="sm" icon="stop" danger onclick={cancelReplay}>Cancel</Button>
            {:else}
              <Button variant="filled" size="sm" icon="send" onclick={() => startReplay(selectedScript!)}>Send</Button>
            {/if}
            {#if isReplaying}
              <Chip color="amber" icon="play_arrow">Running</Chip>
            {/if}
          </div>

          {#if progress && !expectingNewProgress && (progress.state === 'running' || progress.state === 'completed')}
            <div style="margin-top: 14px;">
              <div style="display: flex; align-items: center; justify-content: space-between; font: var(--text-body-sm); color: var(--fg-2); margin-bottom: 6px;">
                <span class="fdc-mono" style="font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{progress.fileName}</span>
                <span class="fdc-mono" style="font-size: 11px;">{progress.percentComplete}%</span>
              </div>
              <div style="width: 100%; height: 6px; background: var(--surface-sunken); border-radius: 999px; overflow: hidden;">
                <div
                  style="
                    height: 100%;
                    width: {progress.percentComplete}%;
                    background: {progress.state === 'completed' ? 'var(--success)' : 'var(--accent)'};
                    border-radius: 999px;
                    transition: width var(--dur-medium) var(--ease-standard);
                  "
                ></div>
              </div>
              {#if progress.state === 'completed'}
                <div style="font: var(--text-body-sm); color: var(--success); margin-top: 6px;">Transfer complete</div>
              {/if}
            </div>
          {/if}
          {#if progress?.state === 'error'}
            <div style="font: var(--text-body-sm); color: var(--error); margin-top: 8px;">
              {progress.error || 'Replay error'}
            </div>
          {/if}
        </div>
      </Card>
    {:else}
      <Card>
        <div style="padding: 60px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px;">
          <Icon name="description" size={24} class="text-fg-4" />
          <div style="font: var(--text-body); color: var(--fg-2);">Select a script to view or edit</div>
        </div>
      </Card>
    {/if}
  </div>
</div>

<!-- New script modal -->
{#if showNewModal}
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Create new script"
    tabindex="-1"
    onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') showNewModal = false; }}
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
      onclick={() => (showNewModal = false)}
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
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      "
    >
      <div>
        <LabelStrip>New script</LabelStrip>
        <h3 style="font: var(--text-title-lg); color: var(--fg-1); margin: 4px 0 0;">Create script</h3>
      </div>
      <div>
        <label class="fdc-label-strip" for="new-script-name" style="display: block; margin-bottom: 4px;">Filename</label>
        <Input id="new-script-name" placeholder="my-script.txt" bind:value={newScriptName} />
      </div>
      <div>
        <label class="fdc-label-strip" for="new-script-content" style="display: block; margin-bottom: 4px;">Content</label>
        <TextArea id="new-script-content" rows={8} placeholder="Enter script content…" bind:value={newScriptContent} />
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <Button variant="ghost" onclick={() => { showNewModal = false; newScriptName = ''; newScriptContent = ''; }}>Cancel</Button>
        <Button variant="filled" icon="check" onclick={createScript}>Create</Button>
      </div>
    </div>
  </div>
{/if}
