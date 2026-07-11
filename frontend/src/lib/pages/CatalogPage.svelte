<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/services/api';
  import { showToast } from '$lib/stores/toast';
  import type { CardDefinition, CatalogFacets } from '$lib/types/api';
  import PageHeader from '$lib/components/shared/PageHeader.svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import Chip from '$lib/components/shared/Chip.svelte';
  import Icon from '$lib/components/shared/Icon.svelte';
  import CardDetail from '$lib/components/catalog/CardDetail.svelte';

  let cards = $state<CardDefinition[]>([]);
  let facets = $state<CatalogFacets>({ types: [], makers: [], capabilities: [] });
  let loading = $state(true);
  let selectedId = $state<string | null>(null);

  // Active filters (single-select facets + free text), applied client-side over
  // the fetched set to match the server's /api/catalog/cards filter semantics.
  let selType = $state<string | null>(null);
  let selMaker = $state<string | null>(null);
  let selCap = $state<string | null>(null);
  let query = $state('');

  let hasFilter = $derived(!!(selType || selMaker || selCap || query.trim()));

  let filtered = $derived(
    cards.filter((c) => {
      if (selType && c.type.toLowerCase() !== selType.toLowerCase()) return false;
      if (selMaker && (c.maker ?? '').toLowerCase() !== selMaker.toLowerCase()) return false;
      if (selCap && !c.capabilities.some((x) => x.toLowerCase() === selCap!.toLowerCase())) return false;
      const q = query.trim().toLowerCase();
      if (q) {
        const hay = `${c.id} ${c.name} ${c.summary ?? ''} ${c.maker ?? ''} ${c.type}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }),
  );

  // Group the filtered cards by type, in facet order, for the "grouped like the
  // assembly rail" browse layout (UX-DR2).
  let groups = $derived(
    facets.types
      .map((t) => ({ type: t, items: filtered.filter((c) => c.type === t) }))
      .filter((g) => g.items.length > 0),
  );

  const TYPE_ICON: Record<string, string> = {
    serial: 'cable',
    floppy: 'save',
    memory: 'memory',
    panel: 'toggle_on',
    other: 'developer_board',
  };
  const typeIcon = (t: string) => TYPE_ICON[t] ?? 'developer_board';

  async function load() {
    try {
      loading = true;
      const res = await api.browseCatalog();
      cards = res.cards;
      facets = res.facets;
    } catch (err) {
      showToast(`Failed to load catalog: ${(err as Error).message}`, 'error');
    } finally {
      loading = false;
    }
  }

  function toggle(kind: 'type' | 'maker' | 'cap', value: string) {
    if (kind === 'type') selType = selType === value ? null : value;
    else if (kind === 'maker') selMaker = selMaker === value ? null : value;
    else selCap = selCap === value ? null : value;
  }

  function clearAll() {
    selType = null;
    selMaker = null;
    selCap = null;
    query = '';
  }

  onMount(load);
</script>

{#snippet headerActions()}
  <Button variant="ghost" icon="refresh" onclick={load}>Refresh</Button>
{/snippet}

{#if selectedId}
  <CardDetail id={selectedId} onBack={() => (selectedId = null)} />
{:else}
<PageHeader
  eyebrow="Build · Catalog"
  title="Card Catalog"
  subtitle="The S-100 card knowledge library — browse and filter the Card Definitions you assemble machines from."
  actions={headerActions}
/>

<div class="fdc-page-body catalog">
  <!-- Filter rail -->
  <div class="filters" role="search" aria-label="Filter the card catalog">
    <div class="searchbox">
      <Icon name="search" size={18} />
      <input
        type="search"
        class="search-input"
        placeholder="Search cards by name, maker, or summary…"
        bind:value={query}
        aria-label="Search cards"
      />
      {#if query}
        <button class="clear-search" onclick={() => (query = '')} aria-label="Clear search">
          <Icon name="close" size={18} />
        </button>
      {/if}
    </div>

    {#if facets.types.length}
      <div class="facet">
        <span class="facet-label" id="facet-type">Type</span>
        <div class="facet-chips" role="group" aria-labelledby="facet-type">
          {#each facets.types as t (t)}
            <button
              class="filter-chip"
              class:active={selType === t}
              aria-pressed={selType === t}
              onclick={() => toggle('type', t)}
            >
              <Icon name={typeIcon(t)} size={16} />{t}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    {#if facets.makers.length}
      <div class="facet">
        <span class="facet-label" id="facet-maker">Maker</span>
        <div class="facet-chips" role="group" aria-labelledby="facet-maker">
          {#each facets.makers as m (m)}
            <button
              class="filter-chip"
              class:active={selMaker === m}
              aria-pressed={selMaker === m}
              onclick={() => toggle('maker', m)}
            >
              {m}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    {#if facets.capabilities.length}
      <div class="facet">
        <span class="facet-label" id="facet-cap">Capability</span>
        <div class="facet-chips" role="group" aria-labelledby="facet-cap">
          {#each facets.capabilities as c (c)}
            <button
              class="filter-chip"
              class:active={selCap === c}
              aria-pressed={selCap === c}
              onclick={() => toggle('cap', c)}
            >
              {c}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    {#if hasFilter}
      <button class="clear-all" onclick={clearAll}>
        <Icon name="filter_alt_off" size={16} />Clear filters
      </button>
    {/if}
  </div>

  <!-- Results -->
  {#if loading}
    <p class="muted">Loading catalog…</p>
  {:else if cards.length === 0}
    <p class="muted">The catalog is empty. Seed cards load at startup.</p>
  {:else if filtered.length === 0}
    <div class="empty">
      <Icon name="search_off" size={24} />
      <p class="muted">No cards match these filters.</p>
      <Button variant="outline" size="sm" onclick={clearAll}>Clear filters</Button>
    </div>
  {:else}
    <p class="count muted">
      {filtered.length}
      {filtered.length === 1 ? 'card' : 'cards'}{hasFilter ? ` of ${cards.length}` : ''}
    </p>
    {#each groups as group (group.type)}
      <section class="group" aria-label="{group.type} cards">
        <h2 class="group-head">
          <Icon name={typeIcon(group.type)} size={18} />
          <span class="fdc-overline">{group.type}</span>
          <span class="group-count">{group.items.length}</span>
        </h2>
        <div class="grid">
          {#each group.items as card (card.id)}
            <button
              class="card-btn"
              onclick={() => (selectedId = card.id)}
              aria-label="Open {card.id} datasheet"
            >
              <div class="card-body">
                <div class="card-top">
                  <span class="card-id fdc-mono" title={card.id}>{card.id}</span>
                  {#if card.maker}<Chip size="sm" color="cyan">{card.maker}</Chip>{/if}
                </div>
                {#if card.summary}
                  <p class="card-summary">{card.summary}</p>
                {/if}
                {#if card.capabilities.length}
                  <div class="caps">
                    {#each card.capabilities as cap (cap)}
                      <span class="cap-tag">{cap}</span>
                    {/each}
                  </div>
                {/if}
                <span class="open-hint"><Icon name="arrow_forward" size={16} />Datasheet</span>
              </div>
            </button>
          {/each}
        </div>
      </section>
    {/each}
  {/if}
</div>
{/if}

<style>
  .catalog {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .filters {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .searchbox {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    max-width: 460px;
    padding: 0 var(--space-3);
    height: 40px;
    background: var(--surface);
    border: 1px solid var(--border-2);
    border-radius: var(--radius-md);
    color: var(--fg-3);
  }
  .searchbox:focus-within {
    border-color: var(--accent);
    color: var(--fg-2);
  }
  .search-input {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    outline: none;
    color: var(--fg-1);
    font: var(--text-body-sm);
  }
  .clear-search {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: none;
    background: none;
    color: var(--fg-3);
    cursor: pointer;
    border-radius: var(--radius-full);
  }
  .clear-search:hover {
    color: var(--fg-1);
  }

  .facet {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .facet-label {
    flex: 0 0 auto;
    min-width: 68px;
    font: var(--text-overline);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-3);
  }
  .facet-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .filter-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 28px;
    padding: 0 var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border-2);
    border-radius: var(--radius-full);
    color: var(--fg-2);
    font: var(--text-label);
    text-transform: capitalize;
    cursor: pointer;
    transition:
      border-color var(--dur-short) var(--ease-standard),
      background var(--dur-short) var(--ease-standard),
      color var(--dur-short) var(--ease-standard);
  }
  .filter-chip:hover {
    border-color: var(--border-3);
    color: var(--fg-1);
  }
  /* Active state is signalled by fill AND a check glyph + weight — not color
     alone (AC-a11y, non-color-only state). */
  .filter-chip.active {
    background: var(--accent-bg);
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }
  .filter-chip.active::before {
    content: 'check';
    font-family: 'Material Symbols Rounded';
    font-size: 16px;
    line-height: 1;
  }

  .clear-all {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 28px;
    padding: 0 var(--space-2);
    background: none;
    border: none;
    color: var(--fg-3);
    font: var(--text-label);
    cursor: pointer;
    border-radius: var(--radius-sm);
  }
  .clear-all:hover {
    color: var(--fg-1);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .group-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    color: var(--fg-2);
  }
  .group-head .fdc-overline {
    letter-spacing: 0.08em;
  }
  .group-count {
    font: var(--text-overline);
    color: var(--fg-4);
    background: var(--surface-variant);
    border-radius: var(--radius-full);
    padding: 1px 8px;
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
  .card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .card-id {
    font-size: 14px;
    font-weight: 600;
    color: var(--fg-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card-summary {
    margin: 0;
    font: var(--text-body-sm);
    color: var(--fg-2);
  }
  .caps {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 2px;
  }
  .cap-tag {
    font: var(--text-overline);
    letter-spacing: 0.02em;
    color: var(--fg-3);
    background: var(--surface-sunken);
    border: 1px solid var(--border-1);
    border-radius: var(--radius-xs);
    padding: 1px 6px;
  }

  .muted {
    color: var(--fg-3);
    font: var(--text-body-sm);
  }
  .count {
    margin: 0;
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
