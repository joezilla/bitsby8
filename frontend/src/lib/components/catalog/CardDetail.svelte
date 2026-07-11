<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/services/api';
  import { showToast } from '$lib/stores/toast';
  import type { CardDetail } from '$lib/types/api';
  import Button from '$lib/components/shared/Button.svelte';
  import Card from '$lib/components/shared/Card.svelte';
  import Chip from '$lib/components/shared/Chip.svelte';
  import Icon from '$lib/components/shared/Icon.svelte';

  interface Props {
    id: string;
    onBack: () => void;
  }
  let { id, onBack }: Props = $props();

  let detail = $state<CardDetail | null>(null);
  let loading = $state(true);

  type ParamSpec = {
    type?: string;
    default?: unknown;
    min?: number;
    max?: number;
    description?: string;
  };
  let schema = $derived<Array<[string, ParamSpec]>>(
    detail ? Object.entries((detail.card.manifest?.configSchema ?? {}) as Record<string, ParamSpec>) : [],
  );

  const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;
  const isByte = (s: ParamSpec) => /^u(8|16)$/.test(s.type ?? '') && typeof s.default === 'number';
  function fmtDefault(s: ParamSpec): string {
    if (s.default === undefined || s.default === null) return '—';
    return isByte(s) && typeof s.default === 'number' ? hex(s.default) : String(s.default);
  }
  function fmtRange(s: ParamSpec): string {
    if (typeof s.min !== 'number' || typeof s.max !== 'number') return '—';
    return isByte(s) ? `${hex(s.min)}–${hex(s.max)}` : `${s.min}–${s.max}`;
  }

  async function load() {
    try {
      loading = true;
      detail = await api.getCardDetail(id);
    } catch (err) {
      showToast(`Failed to load card: ${(err as Error).message}`, 'error');
      onBack();
    } finally {
      loading = false;
    }
  }

  async function copySkills() {
    if (!detail) return;
    try {
      await navigator.clipboard.writeText(detail.skills);
      showToast('Skills file copied', 'success');
    } catch {
      showToast('Copy failed', 'error');
    }
  }

  onMount(load);
</script>

<div class="fdc-page-body detail">
  <button class="back" onclick={onBack}>
    <Icon name="arrow_back" size={18} />Catalog
  </button>

  {#if loading}
    <p class="muted">Loading datasheet…</p>
  {:else if detail}
    {@const c = detail.card}
    <header class="head">
      <div class="head-main">
        <span class="fdc-overline type">{c.type}</span>
        <h1 class="title fdc-mono">{c.name}</h1>
        <div class="idrow">
          <span class="ver fdc-mono">{c.version}</span>
          {#if c.maker}<Chip size="sm" color="cyan">{c.maker}</Chip>{/if}
          <span class="source">{c.source}</span>
        </div>
      </div>
      <Button variant="filled" icon="add" disabled title="Assembly arrives with a later story">
        Add to a Profile
      </Button>
    </header>

    <div class="cols">
      <div class="col">
        <!-- Overview -->
        <Card raised>
          <h2 class="sec">Overview</h2>
          {#if c.summary}<p class="summary">{c.summary}</p>{/if}
          <dl class="kv">
            <dt>Identity</dt>
            <dd class="fdc-mono">{c.id}</dd>
            <dt>Kind</dt>
            <dd>{c.kind === 'chip' ? 'Chip (component)' : 'Card (S-100 board)'}</dd>
            <dt>Type</dt>
            <dd style="text-transform: capitalize;">{c.type}</dd>
            <dt>Digest</dt>
            <dd class="fdc-mono digest" title={c.digest}>{c.digest}</dd>
            {#if c.capabilities.length}
              <dt>Capabilities</dt>
              <dd class="caps">
                {#each c.capabilities as cap (cap)}<span class="cap-tag">{cap}</span>{/each}
              </dd>
            {/if}
          </dl>
        </Card>

        <!-- Default bus footprint -->
        <Card raised>
          <h2 class="sec">Default bus footprint</h2>
          {#if detail.footprint}
            <div class="footprint">
              <div class="fp-row">
                <span class="fp-label">Ports</span>
                <div class="ports">
                  {#if detail.footprint.ports.length}
                    {#each detail.footprint.ports as p (p)}
                      <span class="port fdc-mono">{hex(p)}</span>
                    {/each}
                  {:else}
                    <span class="muted">none</span>
                  {/if}
                </div>
              </div>
              <div class="fp-row">
                <span class="fp-label">IRQ</span>
                <span class="fdc-mono">{detail.footprint.irq == null ? 'none' : detail.footprint.irq}</span>
              </div>
            </div>
          {:else}
            <p class="muted">Not derivable for this card.</p>
          {/if}
        </Card>

        <!-- Configuration schema -->
        <Card raised>
          <h2 class="sec">Configuration schema</h2>
          {#if schema.length}
            <div class="table-wrap">
              <table class="schema">
                <thead>
                  <tr><th>Parameter</th><th>Type</th><th>Default</th><th>Range</th><th>Description</th></tr>
                </thead>
                <tbody>
                  {#each schema as [key, spec] (key)}
                    <tr>
                      <td class="fdc-mono">{key}</td>
                      <td class="fdc-mono">{spec.type ?? '—'}</td>
                      <td class="fdc-mono">{fmtDefault(spec)}</td>
                      <td class="fdc-mono">{fmtRange(spec)}</td>
                      <td>{spec.description ?? ''}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else}
            <p class="muted">This card takes no configuration.</p>
          {/if}
        </Card>
      </div>

      <div class="col">
        <!-- Skills file -->
        <Card raised>
          <div class="sec-row">
            <h2 class="sec">Skills file</h2>
            <Button variant="ghost" size="sm" icon="content_copy" onclick={copySkills}>Copy</Button>
          </div>
          <p class="hint">Human- and agent-readable — how to recognize and program this card.</p>
          <pre class="skills fdc-mono">{detail.skills}</pre>
        </Card>

        <!-- Documentation -->
        <Card raised>
          <h2 class="sec">Documentation</h2>
          {#if c.summary}
            <p class="summary">{c.summary}</p>
          {:else}
            <p class="muted">No documentation authored yet.</p>
          {/if}
        </Card>

        <!-- Versions -->
        <Card raised>
          <h2 class="sec">Versions</h2>
          <ul class="versions">
            {#each detail.versions as v (v.id)}
              <li>
                <span class="fdc-mono">{v.version}</span>
                <span class="source">{v.source}</span>
                <span class="digest fdc-mono" title={v.digest}>{v.digest}</span>
              </li>
            {/each}
          </ul>
        </Card>

        <!-- Used by -->
        <Card raised>
          <h2 class="sec">Used by</h2>
          {#if detail.usedBy.length}
            <ul class="versions">
              {#each detail.usedBy as p (p)}<li class="fdc-mono">{p}</li>{/each}
            </ul>
          {:else}
            <p class="muted">No Machine Profiles reference this card yet.</p>
          {/if}
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
  .type {
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
  }
  .ver {
    color: var(--fg-2);
    font-size: 14px;
  }
  .source {
    font: var(--text-overline);
    color: var(--fg-4);
    text-transform: uppercase;
    letter-spacing: 0.04em;
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
  .hint,
  .summary {
    margin: 0 0 var(--space-3);
    font: var(--text-body-sm);
    color: var(--fg-2);
  }
  .hint {
    color: var(--fg-3);
  }

  .kv {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px var(--space-4);
    margin: 0;
  }
  .kv dt {
    font: var(--text-overline);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-3);
    align-self: center;
  }
  .kv dd {
    margin: 0;
    color: var(--fg-1);
    font-size: 14px;
    min-width: 0;
  }
  .digest {
    color: var(--fg-3);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .caps {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .cap-tag {
    font: var(--text-overline);
    color: var(--fg-3);
    background: var(--surface-sunken);
    border: 1px solid var(--border-1);
    border-radius: var(--radius-xs);
    padding: 1px 6px;
  }

  .footprint {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .fp-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .fp-label {
    min-width: 56px;
    font: var(--text-overline);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-3);
  }
  .ports {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .port {
    font-size: 13px;
    color: var(--accent);
    background: var(--accent-bg);
    border-radius: var(--radius-sm);
    padding: 2px 8px;
  }

  .table-wrap {
    overflow-x: auto;
  }
  table.schema {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  table.schema th {
    text-align: left;
    font: var(--text-overline);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-3);
    padding: 0 var(--space-3) var(--space-2) 0;
    border-bottom: 1px solid var(--border-2);
    white-space: nowrap;
  }
  table.schema td {
    padding: var(--space-2) var(--space-3) var(--space-2) 0;
    border-bottom: 1px solid var(--border-1);
    color: var(--fg-2);
    vertical-align: top;
  }
  table.schema td.fdc-mono {
    color: var(--fg-1);
    white-space: nowrap;
  }

  pre.skills {
    margin: 0;
    padding: var(--space-3);
    background: var(--surface-sunken);
    border: 1px solid var(--border-1);
    border-radius: var(--radius-sm);
    font-size: 12px;
    line-height: 1.5;
    color: var(--fg-2);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 460px;
    overflow: auto;
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
    gap: var(--space-3);
    font-size: 13px;
    color: var(--fg-1);
  }
  .versions .digest {
    margin-left: auto;
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-4);
    font-size: 11px;
  }

  .muted {
    color: var(--fg-3);
    font: var(--text-body-sm);
  }
</style>
