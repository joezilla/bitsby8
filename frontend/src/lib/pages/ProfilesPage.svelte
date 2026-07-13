<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/services/api';
  import { showToast } from '$lib/stores/toast';
  import type { MachineProfile } from '$lib/types/api';
  import PageHeader from '$lib/components/shared/PageHeader.svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import Chip from '$lib/components/shared/Chip.svelte';
  import Icon from '$lib/components/shared/Icon.svelte';
  import ProfileDetail from '$lib/components/profiles/ProfileDetail.svelte';

  interface Props {
    onNavigate?: (page: 'machines') => void;
  }
  let { onNavigate }: Props = $props();

  let profiles = $state<MachineProfile[]>([]);
  let loading = $state(true);
  let selectedId = $state<string | null>(null);

  // Presets are profiles marked source:'preset' — editable templates you clone
  // a new machine from. Everything else is a user machine.
  const presetProfiles = $derived(profiles.filter((p) => p.source === 'preset'));
  const userProfiles = $derived(profiles.filter((p) => p.source !== 'preset'));

  // Create panel
  let creating = $state(false);
  let newName = $state('');
  let newPreset = $state('');
  let busy = $state(false);
  let fileInput = $state<HTMLInputElement>();

  async function onImportFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = ''; // allow re-selecting the same file
    if (!file) return;
    try {
      busy = true;
      const bundle = JSON.parse(await file.text());
      const { profile, warnings } = await api.importProfileBundle(bundle);
      showToast(
        warnings.length ? `Imported ${profile.id} (${warnings.length} warning)` : `Imported ${profile.id}`,
        warnings.length ? 'warning' : 'success',
      );
      await load();
      selectedId = profile.id;
    } catch (err) {
      showToast(`Import failed: ${(err as Error).message}`, 'error');
    } finally {
      busy = false;
    }
  }

  const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`;
  const clockLabel = (c: MachineProfile['clock']) => (c === 'max' ? 'max' : `${c.hz} Hz`);

  async function load() {
    try {
      loading = true;
      const p = await api.listProfiles();
      profiles = p.profiles;
      if (!newPreset && presetProfiles.length) newPreset = presetProfiles[0].id;
    } catch (err) {
      showToast(`Failed to load profiles: ${(err as Error).message}`, 'error');
    } finally {
      loading = false;
    }
  }

  function openCreate() {
    newName = '';
    if (presetProfiles.length) newPreset = presetProfiles[0].id;
    creating = true;
  }

  async function submitCreate() {
    if (!newName.trim()) {
      showToast('Give the profile a name', 'error');
      return;
    }
    try {
      busy = true;
      // A new machine is an independent clone of the chosen preset (so preset
      // edits flow into new machines, and the clone versions on its own).
      const { profile } = await api.cloneProfile(newPreset, newName.trim());
      showToast(`Created ${profile.id}`, 'success');
      creating = false;
      await load();
      selectedId = profile.id;
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      busy = false;
    }
  }

  onMount(load);
</script>

{#if selectedId}
  <ProfileDetail
    id={selectedId}
    {onNavigate}
    onBack={() => (selectedId = null)}
    onChanged={(id) => { load(); if (id) selectedId = id; }}
    onDeleted={() => { selectedId = null; load(); }}
  />
{:else}
  {#snippet headerActions()}
    <Button variant="ghost" icon="refresh" onclick={load}>Refresh</Button>
    <Button variant="ghost" icon="upload" onclick={() => fileInput?.click()} disabled={busy}>Import</Button>
    <Button variant="filled" icon="add" onclick={openCreate}>New profile</Button>
  {/snippet}

  <input
    bind:this={fileInput}
    type="file"
    accept=".json,.b8.json,application/json"
    style="display:none"
    onchange={onImportFile}
  />

  <PageHeader
    eyebrow="Build · Profiles"
    title="Machine Profiles"
    subtitle="Declarative S-100 machines you define once and reuse. Each save is a new version; prior versions stay resolvable."
    actions={headerActions}
  />

  <div class="fdc-page-body profiles">
    {#if creating}
      <div class="create card">
        <h2 class="sec">New machine from a preset</h2>
        <p class="hint">Clones a preset into your own machine you can edit freely. Start from <strong>Blank Machine</strong> for a bare CPU + RAM, or a full bootable preset.</p>
        <div class="create-row">
          <label class="field">
            <span>Name</span>
            <input class="inp" bind:value={newName} placeholder="my-imsai" />
          </label>
          <label class="field">
            <span>Preset</span>
            <select class="inp" bind:value={newPreset}>
              {#each presetProfiles as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
            </select>
          </label>
          <div class="create-actions">
            <Button variant="ghost" size="sm" onclick={() => (creating = false)} disabled={busy}>Cancel</Button>
            <Button variant="filled" size="sm" icon="check" onclick={submitCreate} disabled={busy}>Create</Button>
          </div>
        </div>
        {#if newPreset}
          <p class="preset-desc">{presetProfiles.find((p) => p.id === newPreset)?.notes ?? ''}</p>
        {/if}
      </div>
    {/if}

    {#snippet profileCard(p: MachineProfile)}
      <button class="card-btn" onclick={() => (selectedId = p.id)} aria-label="Open {p.name}">
        <div class="card-body">
          <div class="card-top">
            <span class="pname">{p.name}</span>
            {#if p.source === 'preset'}<Chip size="sm" color="cyan">preset</Chip>{:else}<Chip size="sm" color="amber">v{p.version}</Chip>{/if}
          </div>
          <div class="specs">
            <span class="spec fdc-mono">{p.cpuKind}</span>
            <span class="spec fdc-mono">{clockLabel(p.clock)}</span>
            <span class="spec">{p.cards.length} card{p.cards.length === 1 ? '' : 's'}</span>
          </div>
          {#if p.notes}<p class="notes">{p.notes}</p>{/if}
          <span class="open-hint"><Icon name="arrow_forward" size={16} />Open</span>
        </div>
      </button>
    {/snippet}

    {#if loading}
      <p class="muted">Loading profiles…</p>
    {:else if profiles.length === 0}
      <div class="empty">
        <Icon name="dns" size={24} />
        <p class="muted">No machine profiles yet.</p>
        <Button variant="outline" size="sm" icon="add" onclick={openCreate}>Create your first profile</Button>
      </div>
    {:else}
      {#if presetProfiles.length}
        <div class="section-head"><h2 class="sec">Presets</h2><span class="sub">editable templates — clone one for a new machine, or edit in place</span></div>
        <div class="grid">
          {#each presetProfiles as p (p.id)}{@render profileCard(p)}{/each}
        </div>
      {/if}
      <div class="section-head"><h2 class="sec">Your machines</h2></div>
      {#if userProfiles.length}
        <div class="grid">
          {#each userProfiles as p (p.id)}{@render profileCard(p)}{/each}
        </div>
      {:else}
        <p class="muted">No machines yet — clone a preset above with “New profile”.</p>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .profiles {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border-2);
    border-radius: var(--radius-md);
    padding: var(--space-4);
  }
  .create {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .sec {
    margin: 0;
    font: var(--text-title-sm);
    color: var(--fg-1);
  }
  .section-head {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    flex-wrap: wrap;
    margin-top: var(--space-2);
  }
  .section-head .sub {
    font: var(--text-body-sm);
    color: var(--fg-3);
  }
  .hint {
    margin: 0;
    font: var(--text-body-sm);
    color: var(--fg-3);
  }
  .create-row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-3);
    margin-top: var(--space-1);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .field span {
    font: var(--text-overline);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-3);
  }
  .inp {
    height: 36px;
    min-width: 200px;
    padding: 0 var(--space-3);
    background: var(--surface-sunken);
    border: 1px solid var(--border-2);
    border-radius: var(--radius-sm);
    color: var(--fg-1);
    font: var(--text-body-sm);
  }
  .inp:focus {
    outline: none;
    border-color: var(--accent);
  }
  .create-actions {
    display: flex;
    gap: var(--space-2);
    margin-left: auto;
  }
  .preset-desc {
    margin: 0;
    font: var(--text-body-sm);
    color: var(--fg-2);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: var(--space-3);
  }
  .card-btn {
    display: block;
    width: 100%;
    text-align: left;
    padding: var(--space-4);
    background: var(--surface-raised);
    border: 1px solid var(--border-1);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition:
      border-color var(--dur-short) var(--ease-standard),
      transform var(--dur-short) var(--ease-standard);
  }
  .card-btn:hover {
    border-color: var(--accent);
    transform: translateY(-1px);
  }
  .card-btn:hover .open-hint {
    color: var(--accent);
  }
  .card-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .pname {
    font-size: 15px;
    font-weight: 600;
    color: var(--fg-1);
  }
  .specs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .spec {
    font: var(--text-overline);
    color: var(--fg-3);
    background: var(--surface-sunken);
    border: 1px solid var(--border-1);
    border-radius: var(--radius-xs);
    padding: 1px 6px;
  }
  .notes {
    margin: 0;
    font: var(--text-body-sm);
    color: var(--fg-2);
  }
  .open-hint {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    margin-top: var(--space-1);
    font: var(--text-overline);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-4);
  }
  .muted {
    color: var(--fg-3);
    font: var(--text-body-sm);
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-9) var(--space-4);
    color: var(--fg-3);
  }
</style>
