<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { api } from '$lib/services/api';
  import { showToast } from '$lib/stores/toast';
  import type { InstanceStatus, ClientBay } from '$lib/types/api';
  import PageHeader from '$lib/components/shared/PageHeader.svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import Icon from '$lib/components/shared/Icon.svelte';
  import Sparkline from '$lib/components/machines/Sparkline.svelte';
  import InstanceConsole from '$lib/components/machines/InstanceConsole.svelte';
  import SnapshotsModal from '$lib/components/machines/SnapshotsModal.svelte';
  import GpioPanel from '$lib/components/machines/GpioPanel.svelte';
  import MonitorPanel from '$lib/components/machines/MonitorPanel.svelte';

  interface Props {
    onNavigate?: (page: 'terminal' | 'clients') => void;
  }
  let { onNavigate }: Props = $props();

  let instances = $state<InstanceStatus[]>([]);
  let clients = $state<ClientBay[]>([]);
  let loading = $state(true);
  let consoleFor = $state<InstanceStatus | null>(null);
  let snapshotsFor = $state<InstanceStatus | null>(null);
  let gpioFor = $state<InstanceStatus | null>(null);
  let monitorFor = $state<InstanceStatus | null>(null);
  let sparkData = $state<Record<string, number[]>>({}); // per-instance effectiveHz ring
  let poll: ReturnType<typeof setInterval> | null = null;

  let running = $derived(instances.filter((i) => i.status === 'running'));
  let aggregateMHz = $derived(running.reduce((s, i) => s + (i.effectiveHz ?? 0), 0) / 1e6);
  // Physical/external FDC clients — connected clients that aren't virtual instances.
  let physical = $derived(clients.filter((c) => c.connected && !c.clientId.startsWith('inst:')));

  function hzLabel(hz?: number | 'max'): string {
    if (hz === 'max' || hz === undefined) return typeof hz === 'string' ? 'max' : '—';
    if (hz >= 1e6) return `${(hz / 1e6).toFixed(2)} MHz`;
    if (hz >= 1e3) return `${(hz / 1e3).toFixed(0)} kHz`;
    return `${hz} Hz`;
  }
  function uptimeLabel(s?: number): string {
    if (s === undefined) return '—';
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  }
  const drivenBy = (d: string) => (d === 'mcp' ? 'Claude Code (MCP)' : d === 'api' ? 'API' : 'Operator');
  const targetLabel = (t?: number | 'max') => (t === 'max' ? 'max' : t ? `${(t / 1e6).toFixed(2)} MHz` : '—');

  const uptimeFrom = (ms: number | null) => (ms == null ? '—' : uptimeLabel(Math.floor((Date.now() - ms) / 1000)));

  async function load() {
    try {
      const { instances: next } = await api.listInstances();
      instances = next;
      // Physical/external clients live in the multi-client registry; tolerate its
      // absence (single-server mode) without failing the instance view.
      clients = await api
        .getClients()
        .then((r) => r.clients)
        .catch(() => []);
      const nextSpark: Record<string, number[]> = {};
      for (const i of next) {
        const ring = (sparkData[i.id] ?? []).slice();
        if (i.status === 'running' && i.effectiveHz !== undefined) {
          ring.push(i.effectiveHz);
          if (ring.length > 40) ring.shift();
        }
        nextSpark[i.id] = ring;
      }
      sparkData = nextSpark; // reassign → reactive
    } catch (err) {
      showToast(`Failed to load instances: ${(err as Error).message}`, 'error');
    } finally {
      loading = false;
    }
  }

  async function act(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      showToast(ok, 'success');
      await load();
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  }

  const SPEEDS: Array<{ label: string; value: number | 'max' }> = [
    { label: '2 MHz', value: 2000000 },
    { label: '4 MHz', value: 4000000 },
    { label: 'max', value: 'max' },
  ];
  const isActiveSpeed = (i: InstanceStatus, v: number | 'max') => i.targetHz === v;
  function setSpeed(i: InstanceStatus, v: number | 'max') {
    if (isActiveSpeed(i, v)) return;
    void act(() => api.setInstanceSpeed(i.id, v), `Speed → ${v === 'max' ? 'max' : v / 1e6 + ' MHz'}`);
  }

  function destroy(i: InstanceStatus) {
    const dirty = i.disks.some((d) => d.dirty);
    const msg = dirty
      ? `Destroy "${i.profileRef}"? It has uncommitted disk writes that will be discarded.`
      : `Destroy instance "${i.profileRef}"?`;
    if (!confirm(msg)) return;
    void act(() => api.destroyInstance(i.id), 'Instance destroyed');
  }

  onMount(() => {
    load();
    poll = setInterval(load, 1000);
  });
  onDestroy(() => {
    if (poll) clearInterval(poll);
  });
</script>

{#snippet headerActions()}
  <Button variant="ghost" icon="refresh" onclick={load}>Refresh</Button>
{/snippet}

<PageHeader
  eyebrow="Operate · Machines"
  title="Machines"
  subtitle="Everything consuming the disk server, in one view — virtual instances and physical/external clients."
  actions={headerActions}
/>

<div class="fdc-page-body machines">
  <!-- Summary strip -->
  <div class="summary">
    <div class="stat"><span class="snum">{instances.length}</span><span class="slabel">instances</span></div>
    <div class="stat"><span class="snum">{running.length}</span><span class="slabel">running</span></div>
    <div class="stat"><span class="snum fdc-mono">{aggregateMHz.toFixed(1)}</span><span class="slabel">aggregate MHz</span></div>
    {#if physical.length}
      <div class="stat"><span class="snum">{physical.length}</span><span class="slabel">physical</span></div>
    {/if}
  </div>

  {#if loading}
    <p class="muted">Loading…</p>
  {:else if instances.length === 0 && physical.length === 0}
    <div class="empty">
      <Icon name="dns" size={24} />
      <p class="muted">Nothing running. Launch a machine from a Profile, or connect a physical/external FDC client.</p>
    </div>
  {:else}
    <div class="grid">
      {#each instances as i (i.id)}
        <div class="card" class:running={i.status === 'running'}>
          <div class="top">
            <span class="target">virtual · 8sim</span>
            <div class="status">
              <span class="dot {i.status}" aria-hidden="true"></span>
              <span class="stext">{i.status}</span>
            </div>
          </div>

          <div class="idline">
            <span class="pref fdc-mono" title={i.profileRef}>{i.profileRef}</span>
          </div>
          <div class="badges">
            {#if i.transient}<span class="badge">transient</span>{/if}
            {#if i.headless}<span class="badge" title="Running with no console attached">headless</span>{/if}
            <span class="driven">driven by: {drivenBy(i.driver)}</span>
          </div>

          {#if i.status === 'running'}
            <div class="speed">
              <div class="speedvals">
                <span class="eff fdc-mono">{hzLabel(i.effectiveHz)}</span>
                <span class="tgt">/ {targetLabel(i.targetHz)} target</span>
              </div>
              <Sparkline
                values={sparkData[i.id] ?? []}
                max={typeof i.targetHz === 'number' ? i.targetHz : undefined}
                label="effective speed {hzLabel(i.effectiveHz)}"
              />
            </div>
            <div class="meta"><Icon name="schedule" size={14} /> up {uptimeLabel(i.uptimeSeconds)}</div>
            <div class="speedctl" role="group" aria-label="CPU speed">
              {#each SPEEDS as s (s.label)}
                <button
                  class="seg"
                  class:on={isActiveSpeed(i, s.value)}
                  aria-pressed={isActiveSpeed(i, s.value)}
                  onclick={() => setSpeed(i, s.value)}
                >
                  {s.label}
                </button>
              {/each}
            </div>
          {/if}

          {#if i.disks.length}
            <ul class="disks">
              {#each i.disks as d (d.drive)}
                <li>
                  <span class="dnum fdc-mono">D{d.drive}</span>
                  <span class="dfile fdc-mono" title={d.filename}>{d.filename}</span>
                  {#if d.readonly}<Icon name="lock" size={16} />{/if}
                  {#if d.dirty}<span class="dirty" title="Uncommitted disk writes">●</span>{/if}
                </li>
              {/each}
            </ul>
          {/if}

          <div class="actions">
            {#if i.status === 'running'}
              <Button variant="tonal" size="sm" icon="terminal" onclick={() => (consoleFor = i)}>Console</Button>
              <Button variant="ghost" size="sm" icon="monitor" onclick={() => (monitorFor = i)}>Monitor</Button>
              <Button variant="ghost" size="sm" icon="toggle_on" onclick={() => (gpioFor = i)}>GPIO</Button>
              <Button variant="outline" size="sm" icon="stop" onclick={() => act(() => api.stopInstance(i.id), 'Stopped')}>Stop</Button>
            {:else}
              <Button variant="tonal" size="sm" icon="play_arrow" onclick={() => act(() => api.startInstance(i.id), 'Started')}>Start</Button>
            {/if}
            {#if i.disks.length}
              <Button variant="ghost" size="sm" icon="photo_camera" onclick={() => (snapshotsFor = i)}>Snapshots</Button>
            {/if}
            <Button variant="ghost" size="sm" icon="delete" danger onclick={() => destroy(i)}>Destroy</Button>
          </div>
        </div>
      {/each}

      {#each physical as c (c.clientId)}
        <div class="card running">
          <div class="top">
            <span class="target phys">physical · serial</span>
            <div class="status">
              <span class="dot running" aria-hidden="true"></span>
              <span class="stext">connected</span>
            </div>
          </div>
          <div class="idline">
            <span class="pref fdc-mono" title={c.clientId}>{c.name || c.clientId}</span>
          </div>
          <div class="badges">
            {#if c.isMaster}<span class="badge">master</span>{/if}
            {#if c.hasSplinters}<span class="badge" title="Has copy-on-write disk writes">splinters</span>{/if}
            <span class="driven">external FDC client</span>
          </div>
          <div class="meta"><Icon name="schedule" size={14} /> up {uptimeFrom(c.connectedAt)}</div>

          {#if c.drives.some((d) => d.filename)}
            <ul class="disks">
              {#each c.drives.filter((d) => d.filename) as d (d.drive)}
                <li>
                  <span class="dnum fdc-mono">D{d.drive}</span>
                  <span class="dfile fdc-mono" title={d.filename ?? ''}>{d.filename}</span>
                  {#if d.readonly}<Icon name="lock" size={16} />{/if}
                  {#if d.dirty}<span class="dirty" title="Uncommitted disk writes">●</span>{/if}
                </li>
              {/each}
            </ul>
          {/if}

          <div class="actions">
            <Button variant="tonal" size="sm" icon="terminal" onclick={() => onNavigate?.('terminal')}>Terminal</Button>
            <Button variant="ghost" size="sm" icon="tune" onclick={() => onNavigate?.('clients')}>Manage disks</Button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if gpioFor}
  <GpioPanel instanceId={gpioFor.id} title={gpioFor.profileRef} onClose={() => (gpioFor = null)} />
{/if}

{#if monitorFor}
  <MonitorPanel instanceId={monitorFor.id} title={monitorFor.profileRef} onClose={() => (monitorFor = null)} />
{/if}

{#if consoleFor}
  <InstanceConsole instanceId={consoleFor.id} title={consoleFor.profileRef} onClose={() => (consoleFor = null)} />
{/if}

{#if snapshotsFor}
  <SnapshotsModal
    instanceId={snapshotsFor.id}
    title={snapshotsFor.profileRef}
    onClose={() => (snapshotsFor = null)}
    onRestored={load}
  />
{/if}

<style>
  .machines {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }
  .summary {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-3) var(--space-4);
    background: var(--surface);
    border: 1px solid var(--border-2);
    border-radius: var(--radius-md);
    min-width: 110px;
  }
  .snum {
    font-size: 24px;
    font-weight: 600;
    color: var(--fg-1);
  }
  .slabel {
    font: var(--text-overline);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-3);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: var(--space-3);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
    background: var(--surface-raised);
    border: 1px solid var(--border-2);
    border-radius: var(--radius-md);
  }
  .card.running {
    border-color: color-mix(in srgb, var(--success) 30%, var(--border-2));
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .target {
    font: var(--text-overline);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-4);
    background: var(--surface-sunken);
    border: 1px solid var(--border-1);
    border-radius: var(--radius-xs);
    padding: 1px 6px;
  }
  .target.phys {
    color: var(--info);
    border-color: color-mix(in srgb, var(--info) 35%, transparent);
  }
  .status {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--fg-4);
  }
  .dot.running {
    background: var(--success);
    box-shadow: 0 0 6px var(--success);
  }
  .stext {
    font: var(--text-label);
    color: var(--fg-2);
    text-transform: capitalize;
  }

  .idline {
    min-width: 0;
  }
  .pref {
    font-size: 14px;
    font-weight: 600;
    color: var(--fg-1);
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badges {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }
  .badge {
    font: var(--text-overline);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--info);
    background: color-mix(in srgb, var(--info) 14%, transparent);
    border-radius: var(--radius-xs);
    padding: 1px 6px;
  }
  .driven {
    font: var(--text-overline);
    color: var(--fg-4);
  }

  .speed {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    margin-top: 2px;
  }
  .speedvals {
    display: flex;
    align-items: baseline;
    gap: 5px;
  }
  .eff {
    font-size: 15px;
    color: var(--accent);
    font-weight: 600;
  }
  .tgt {
    font: var(--text-overline);
    color: var(--fg-4);
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 4px;
    font: var(--text-label);
    color: var(--fg-3);
  }

  .speedctl {
    display: inline-flex;
    align-self: flex-start;
    border: 1px solid var(--border-2);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .seg {
    min-height: 26px;
    padding: 0 var(--space-2);
    background: var(--surface-sunken);
    border: none;
    border-right: 1px solid var(--border-2);
    color: var(--fg-3);
    font: var(--text-label);
    cursor: pointer;
  }
  .seg:last-child {
    border-right: none;
  }
  .seg:hover {
    color: var(--fg-1);
  }
  .seg.on {
    background: var(--accent-bg);
    color: var(--accent);
    font-weight: 600;
  }

  .disks {
    list-style: none;
    margin: 0;
    padding: var(--space-2) 0 0;
    border-top: 1px solid var(--border-1);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .disks li {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--fg-2);
  }
  .dnum {
    color: var(--fg-4);
  }
  .dfile {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dirty {
    color: var(--warning);
    margin-left: auto;
    font-size: 14px;
    line-height: 1;
  }

  .actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-1);
    flex-wrap: wrap;
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
