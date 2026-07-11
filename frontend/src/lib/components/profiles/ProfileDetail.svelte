<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/services/api';
  import { showToast } from '$lib/stores/toast';
  import type { MachineProfile, CardDefinition, ProfileCardInstance, ProfileValidation } from '$lib/types/api';
  import Button from '$lib/components/shared/Button.svelte';
  import Card from '$lib/components/shared/Card.svelte';
  import Chip from '$lib/components/shared/Chip.svelte';
  import Icon from '$lib/components/shared/Icon.svelte';
  import HexInput from '$lib/components/shared/HexInput.svelte';
  import Backplane from '$lib/components/profiles/Backplane.svelte';

  interface Props {
    id: string;
    onBack: () => void;
    onChanged: (id: string | null) => void;
    onDeleted: () => void;
  }
  let { id, onBack, onChanged, onDeleted }: Props = $props();

  let profile = $state<MachineProfile | null>(null);
  let versions = $state<MachineProfile[]>([]);
  let catalog = $state<CardDefinition[]>([]);
  let loading = $state(true);
  let busy = $state(false);

  // Editable working state.
  let clockMode = $state<'max' | 'hz'>('max');
  let clockHz = $state(2000000);
  let resetVector = $state(0);
  let notes = $state('');
  let editCards = $state<ProfileCardInstance[]>([]);
  let validation = $state<ProfileValidation | null>(null);
  let validateToken = 0;
  let launchSpeed = $state<'2000000' | '4000000' | 'max'>('2000000');

  const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`;
  const clockLabel = (c: MachineProfile['clock']) => (c === 'max' ? 'max' : `${c.hz} Hz`);

  // Card instance ids currently involved in a bus collision (for inline flags).
  let offenderIds = $derived(
    new Set((validation?.collisions ?? []).flatMap((c) => c.offenders)),
  );

  // Re-validate for bus collisions whenever the backplane changes.
  $effect(() => {
    const cards = editCards;
    const memory = profile?.memory ?? [];
    const token = ++validateToken;
    api
      .validateProfileBody({ cards, memory })
      .then((v) => {
        if (token === validateToken) validation = v;
      })
      .catch(() => {});
  });

  async function autoAssign() {
    if (!profile) return;
    try {
      busy = true;
      const res = await api.autoAssignProfile({ cards: editCards, memory: profile.memory });
      editCards = res.content.cards;
      if (res.unresolved.length) {
        showToast(`Auto-assigned; ${res.unresolved.length} card(s) need manual fixing: ${res.unresolved.join(', ')}`, 'error');
      } else {
        showToast('Auto-assigned collision-free ports', 'success');
      }
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      busy = false;
    }
  }

  let dirty = $derived.by(() => {
    if (!profile) return false;
    const curClock = clockMode === 'max' ? 'max' : { hz: clockHz };
    const clockChanged = JSON.stringify(curClock) !== JSON.stringify(profile.clock);
    const cardsChanged = JSON.stringify(editCards) !== JSON.stringify(profile.cards);
    return (
      clockChanged ||
      resetVector !== profile.resetVector ||
      (notes ?? '') !== (profile.notes ?? '') ||
      cardsChanged
    );
  });

  function syncEditable(p: MachineProfile) {
    clockMode = p.clock === 'max' ? 'max' : 'hz';
    clockHz = p.clock === 'max' ? 2000000 : p.clock.hz;
    resetVector = p.resetVector;
    notes = p.notes ?? '';
    editCards = structuredClone(p.cards);
  }

  async function load() {
    try {
      loading = true;
      const { profile: p } = await api.getProfile(id);
      profile = p;
      syncEditable(p);
      const [vers, cat] = await Promise.all([
        api.listProfileVersions(p.name),
        catalog.length ? Promise.resolve({ cards: catalog }) : api.browseCatalog(),
      ]);
      versions = vers.versions;
      catalog = cat.cards;
    } catch (err) {
      showToast(`Failed to load profile: ${(err as Error).message}`, 'error');
      onBack();
    } finally {
      loading = false;
    }
  }

  async function save() {
    if (!profile) return;
    try {
      busy = true;
      const patch: Record<string, unknown> = {
        clock: clockMode === 'max' ? 'max' : { hz: clockHz },
        resetVector,
        notes,
        cards: editCards,
      };
      const { profile: np } = await api.updateProfile(profile.id, patch);
      if (np.id === profile.id) {
        showToast('No changes to save', 'info');
      } else {
        showToast(`Saved as ${np.version}`, 'success');
      }
      onChanged(np.id);
      id = np.id;
      await load();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      busy = false;
    }
  }

  async function launch() {
    if (!profile) return;
    try {
      busy = true;
      const speed = launchSpeed === 'max' ? 'max' : Number(launchSpeed);
      const { instance } = await api.launchTransient(profile.id, speed);
      showToast(`Launched instance ${instance.id.slice(0, 8)}… (mount a boot disk on drive 0 to boot)`, 'success');
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      busy = false;
    }
  }

  async function clone() {
    if (!profile) return;
    const name = prompt(`Clone "${profile.name}" as:`, `${profile.name}-copy`);
    if (!name) return;
    try {
      busy = true;
      const { profile: np } = await api.cloneProfile(profile.id, name);
      showToast(`Cloned to ${np.id}`, 'success');
      onChanged(np.id);
      id = np.id;
      await load();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!profile) return;
    if (!confirm(`Delete profile "${profile.name}" and all its versions?`)) return;
    try {
      busy = true;
      await api.deleteProfile(profile.id);
      showToast('Profile deleted', 'success');
      onDeleted();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      busy = false;
    }
  }

  onMount(load);
</script>

<div class="fdc-page-body detail">
  <button class="back" onclick={onBack}><Icon name="arrow_back" size={18} />Profiles</button>

  {#if loading}
    <p class="muted">Loading…</p>
  {:else if profile}
    {@const p = profile}
    <header class="head">
      <div class="head-main">
        <span class="fdc-overline">Machine Profile</span>
        <h1 class="title">{p.name}</h1>
        <div class="idrow">
          <Chip size="sm" color="amber">v{p.version}</Chip>
          <span class="source">{p.source}</span>
          <span class="digest fdc-mono" title={p.digest}>{p.digest}</span>
        </div>
      </div>
      <div class="head-actions">
        <label class="speed-pick" title="CPU speed at launch">
          <span class="sr-only">Launch speed</span>
          <select class="speed-select fdc-mono" bind:value={launchSpeed} disabled={busy}>
            <option value="2000000">2 MHz</option>
            <option value="4000000">4 MHz</option>
            <option value="max">max</option>
          </select>
        </label>
        <Button
          variant="tonal"
          icon="play_arrow"
          onclick={launch}
          disabled={busy || validation?.ok === false}
          title={validation?.ok === false ? 'Resolve bus collisions before launching' : ''}
        >
          Launch
        </Button>
        <Button variant="outline" icon="content_copy" onclick={clone} disabled={busy}>Clone</Button>
        <Button variant="ghost" icon="delete" danger onclick={remove} disabled={busy}>Delete</Button>
      </div>
    </header>

    {#if validation && !validation.ok}
      <div class="validator-bar" role="alert">
        <Icon name="error" size={20} />
        <div class="vb-body">
          <strong>{validation.collisions.length} bus collision{validation.collisions.length === 1 ? '' : 's'} — not runnable</strong>
          <ul class="vb-list">
            {#each validation.collisions as col (col.kind + col.resource + col.offenders.join())}
              <li>
                <span class="fdc-mono">{col.resource}</span> —
                {#if col.offenders.length === 1}
                  <span class="fdc-mono">{col.offenders[0]}</span> claims it more than once (check its port settings)
                {:else}
                  {col.offenders.join(' ✕ ')}
                {/if}
              </li>
            {/each}
          </ul>
        </div>
        <Button variant="tonal" size="sm" icon="auto_fix_high" onclick={autoAssign} disabled={busy}>Auto-assign</Button>
      </div>
    {:else if validation?.ok}
      <div class="validator-bar ok">
        <Icon name="check_circle" size={18} />
        <span>No bus collisions — runnable.</span>
      </div>
    {/if}

    <div class="cols">
      <div class="col">
        <Card raised>
          <h2 class="sec">Configuration</h2>
          <dl class="kv">
            <dt>CPU</dt>
            <dd class="fdc-mono">{p.cpuKind}</dd>
            <dt>Clock</dt>
            <dd>
              <div class="clock-edit">
                <label><input type="radio" bind:group={clockMode} value="max" /> max</label>
                <label><input type="radio" bind:group={clockMode} value="hz" /> fixed</label>
                {#if clockMode === 'hz'}
                  <input class="inp sm fdc-mono" type="number" bind:value={clockHz} min="1000" step="1000" />
                  <span class="unit">Hz</span>
                {/if}
              </div>
            </dd>
            <dt>Reset vector</dt>
            <dd>
              <HexInput
                value={resetVector}
                min={0}
                max={0xffff}
                ariaLabel="reset vector (hex)"
                onchange={(n) => (resetVector = n)}
              />
            </dd>
            <dt>Console card</dt>
            <dd class="fdc-mono">{p.consoleCardId ?? '—'}</dd>
          </dl>
        </Card>

        <Card raised>
          <h2 class="sec">Notes</h2>
          <textarea class="inp area" bind:value={notes} placeholder="What is this machine for?"></textarea>
        </Card>

        <div class="save-bar">
          <span class="muted">{dirty ? 'Saving writes a new version.' : 'No unsaved changes.'}</span>
          <Button variant="filled" icon="save" onclick={save} disabled={busy || !dirty}>Save new version</Button>
        </div>
      </div>

      <div class="col">
        <Card raised>
          <h2 class="sec">Memory layout</h2>
          <div class="table-wrap">
            <table class="tbl">
              <thead><tr><th>Region</th><th>Kind</th><th>Range</th></tr></thead>
              <tbody>
                {#each p.memory as m (m.id)}
                  <tr>
                    <td class="fdc-mono">{m.id}</td>
                    <td>{m.kind}{m.image ? ' · ROM image' : ''}</td>
                    <td class="fdc-mono">{hex(m.base)}–{hex(m.base + m.size - 1)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </Card>

        <Card raised>
          <div class="sec-row">
            <h2 class="sec">S-100 backplane</h2>
            <span class="pill">{editCards.length} card{editCards.length === 1 ? '' : 's'}</span>
          </div>
          <Backplane cards={editCards} {catalog} offenders={offenderIds} onchange={(c) => (editCards = c)} />
        </Card>

        <Card raised>
          <h2 class="sec">Versions</h2>
          <ul class="versions">
            {#each versions as v (v.id)}
              <li class:current={v.id === p.id}>
                <span class="fdc-mono">v{v.version}</span>
                {#if v.id === p.id}<Chip size="sm" color="green">current</Chip>{/if}
                <span class="digest fdc-mono" title={v.digest}>{v.digest}</span>
              </li>
            {/each}
          </ul>
        </Card>
      </div>
    </div>
  {/if}
</div>

<style>
  .detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .back {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 32px;
    padding: 0 var(--space-2) 0 4px;
    background: none;
    border: none;
    color: var(--fg-3);
    font: var(--text-label);
    cursor: pointer;
    border-radius: var(--radius-sm);
  }
  .back:hover {
    color: var(--fg-1);
  }
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
  }
  .head-main {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .fdc-overline {
    color: var(--fg-3);
    letter-spacing: 0.08em;
  }
  .title {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
    color: var(--fg-1);
  }
  .idrow {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .source {
    font: var(--text-overline);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-4);
  }
  .digest {
    color: var(--fg-4);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 40vw;
  }
  .head-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .speed-select {
    height: 36px;
    padding: 0 var(--space-2);
    background: var(--surface-sunken);
    border: 1px solid var(--border-2);
    border-radius: var(--radius-sm);
    color: var(--fg-1);
    font-size: 13px;
  }
  .speed-select:focus {
    outline: none;
    border-color: var(--accent);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .validator-bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--error) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--error) 40%, transparent);
    color: var(--error);
  }
  .validator-bar.ok {
    background: color-mix(in srgb, var(--success) 10%, transparent);
    border-color: color-mix(in srgb, var(--success) 35%, transparent);
    color: var(--success);
    font: var(--text-body-sm);
  }
  .vb-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    color: var(--fg-1);
  }
  .vb-body strong {
    color: var(--error);
    font-size: 14px;
  }
  .vb-list {
    margin: 0;
    padding-left: var(--space-4);
    font: var(--text-body-sm);
    color: var(--fg-2);
  }

  .cols {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
  }
  @media (min-width: 900px) {
    .cols {
      grid-template-columns: 1fr 1fr;
    }
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
  }

  .sec {
    margin: 0 0 var(--space-2);
    font: var(--text-title-sm);
    color: var(--fg-1);
  }
  .sec-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .sec-row .sec {
    margin: 0;
  }
  .pill {
    font: var(--text-overline);
    color: var(--info);
    background: color-mix(in srgb, var(--info) 14%, transparent);
    border-radius: var(--radius-xs);
    padding: 1px 6px;
  }

  .kv {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-2) var(--space-4);
    margin: 0;
    align-items: center;
  }
  .kv dt {
    font: var(--text-overline);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-3);
  }
  .kv dd {
    margin: 0;
    color: var(--fg-1);
    font-size: 14px;
  }
  .clock-edit {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
    font: var(--text-body-sm);
    color: var(--fg-2);
  }
  .clock-edit label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
  }
  .inp {
    background: var(--surface-sunken);
    border: 1px solid var(--border-2);
    border-radius: var(--radius-sm);
    color: var(--fg-1);
    font: var(--text-body-sm);
    padding: 6px var(--space-2);
  }
  .inp:focus {
    outline: none;
    border-color: var(--accent);
  }
  .inp.sm {
    width: 120px;
    height: 30px;
    padding: 0 var(--space-2);
  }
  .inp.area {
    width: 100%;
    min-height: 64px;
    resize: vertical;
  }
  .unit {
    color: var(--fg-3);
    font-size: 12px;
    margin-left: 6px;
  }

  .save-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .table-wrap {
    overflow-x: auto;
  }
  table.tbl {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  table.tbl th {
    text-align: left;
    font: var(--text-overline);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-3);
    padding: 0 var(--space-3) var(--space-2) 0;
    border-bottom: 1px solid var(--border-2);
    white-space: nowrap;
  }
  table.tbl td {
    padding: var(--space-2) var(--space-3) var(--space-2) 0;
    border-bottom: 1px solid var(--border-1);
    color: var(--fg-2);
  }

  .versions {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .versions li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 13px;
    color: var(--fg-1);
  }
  .versions .digest {
    margin-left: auto;
  }

  .muted {
    color: var(--fg-3);
    font: var(--text-body-sm);
  }
</style>
