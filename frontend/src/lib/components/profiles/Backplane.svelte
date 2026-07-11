<script lang="ts">
  import type { CardDefinition, ProfileCardInstance } from '$lib/types/api';
  import Icon from '$lib/components/shared/Icon.svelte';
  import Button from '$lib/components/shared/Button.svelte';

  interface ParamSpec {
    type: string;
    default?: number | string;
    min?: number;
    max?: number;
    enum?: (number | string)[];
    description?: string;
  }

  interface Props {
    cards: ProfileCardInstance[];
    catalog: CardDefinition[];
    onchange: (cards: ProfileCardInstance[]) => void;
    offenders?: Set<string>;
  }
  let { cards, catalog, onchange, offenders = new Set() }: Props = $props();

  let addRef = $state('');
  $effect(() => {
    if (!addRef && catalog.length) addRef = catalog[0].id;
  });

  const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;
  const schemaOf = (ref: string): Record<string, ParamSpec> =>
    (catalog.find((c) => c.id === ref)?.manifest?.configSchema as Record<string, ParamSpec>) ?? {};
  const nameOf = (ref: string) => catalog.find((c) => c.id === ref)?.name ?? ref.split('@')[0];
  const isByte = (s: ParamSpec) => /^u(8|16)$/.test(s.type);

  /** Client-side mirror of the server validator, for live per-field feedback. */
  function fieldError(spec: ParamSpec, value: unknown): string | null {
    if (value === undefined || value === null || value === '') return `required`;
    if (spec.type === 'enum') {
      return (spec.enum ?? []).includes(value as number | string)
        ? null
        : `must be one of ${(spec.enum ?? []).join(', ')}`;
    }
    const n = Number(value);
    if (!Number.isInteger(n)) return 'must be an integer';
    const min = spec.min ?? 0;
    const max = spec.max ?? (spec.type === 'u16' ? 0xffff : 0xff);
    return n < min || n > max ? `must be in ${hex(min)}–${hex(max)}` : null;
  }

  function uniqueId(base: string): string {
    const ids = new Set(cards.map((c) => c.id));
    if (!ids.has(base)) return base;
    let i = 2;
    while (ids.has(`${base}${i}`)) i++;
    return `${base}${i}`;
  }

  function defaultsFor(ref: string): Record<string, unknown> {
    const cfg: Record<string, unknown> = {};
    for (const [k, spec] of Object.entries(schemaOf(ref))) cfg[k] = spec.default;
    return cfg;
  }

  function emit(next: ProfileCardInstance[]) {
    onchange(next);
  }

  function addCard() {
    if (!addRef) return;
    const id = uniqueId(nameOf(addRef));
    emit([...cards, { id, ref: addRef, config: defaultsFor(addRef) }]);
  }

  function removeCard(i: number) {
    emit(cards.filter((_, idx) => idx !== i));
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= cards.length) return;
    const next = cards.slice();
    [next[i], next[j]] = [next[j], next[i]];
    emit(next);
  }

  function setConfig(i: number, param: string, raw: string, spec: ParamSpec) {
    const value: number | string = spec.type === 'enum' ? raw : Number(raw);
    const next = cards.map((c, idx) =>
      idx === i ? { ...c, config: { ...(c.config ?? {}), [param]: value } } : c,
    );
    emit(next);
  }
</script>

<div class="backplane">
  <div class="add-row">
    <label class="add-label" for="add-card">Install card</label>
    <select id="add-card" class="inp" bind:value={addRef}>
      {#each catalog as c (c.id)}
        <option value={c.id}>{c.name} · {c.kind}</option>
      {/each}
    </select>
    <Button variant="tonal" size="sm" icon="add" onclick={addCard}>Add to backplane</Button>
  </div>

  {#if cards.length === 0}
    <p class="muted">No cards installed. The backplane is empty.</p>
  {:else}
    <ol class="cage">
      {#each cards as card, i (card.id)}
        {@const schema = schemaOf(card.ref)}
        {@const params = Object.entries(schema)}
        <li class="slot">
          <div class="slot-rail" aria-hidden="true"><span class="slot-no fdc-mono">{i + 1}</span></div>
          <div class="board" class:collision={offenders.has(card.id)}>
            <div class="board-head">
              <div class="board-id">
                <span class="cid fdc-mono">
                  {#if offenders.has(card.id)}<Icon name="error" size={16} />{/if}
                  {card.id}
                </span>
                <span class="cref fdc-mono">{card.ref}</span>
              </div>
              <div class="board-actions">
                <button class="iconbtn" title="Move up" aria-label="Move {card.id} up"
                  onclick={() => move(i, -1)} disabled={i === 0}><Icon name="arrow_upward" size={18} /></button>
                <button class="iconbtn" title="Move down" aria-label="Move {card.id} down"
                  onclick={() => move(i, 1)} disabled={i === cards.length - 1}><Icon name="arrow_downward" size={18} /></button>
                <button class="iconbtn danger" title="Remove" aria-label="Remove {card.id}"
                  onclick={() => removeCard(i)}><Icon name="close" size={18} /></button>
              </div>
            </div>
            {#if params.length}
              <div class="params">
                {#each params as [param, spec] (param)}
                  {@const val = card.config?.[param] ?? spec.default}
                  {@const err = fieldError(spec, val)}
                  <div class="param">
                    <label class="plabel" for="{card.id}-{param}">
                      {param}
                      {#if isByte(spec)}<span class="phint fdc-mono">{hex(spec.min ?? 0)}–{hex(spec.max ?? (spec.type === 'u16' ? 0xffff : 0xff))}</span>{/if}
                    </label>
                    {#if spec.type === 'enum'}
                      <select id="{card.id}-{param}" class="inp mono" class:invalid={!!err}
                        value={String(val)} onchange={(e) => setConfig(i, param, e.currentTarget.value, spec)}>
                        {#each spec.enum ?? [] as opt (opt)}<option value={String(opt)}>{opt}</option>{/each}
                      </select>
                    {:else}
                      <input id="{card.id}-{param}" class="inp mono" class:invalid={!!err} type="number"
                        value={val as number} min={spec.min ?? 0} max={spec.max ?? (spec.type === 'u16' ? 0xffff : 0xff)}
                        onchange={(e) => setConfig(i, param, e.currentTarget.value, spec)} />
                    {/if}
                    {#if err}
                      <span class="perr" role="alert">{param} {err}</span>
                    {:else if isByte(spec) && typeof val === 'number'}
                      <span class="pval fdc-mono">{hex(val)}</span>
                    {/if}
                  </div>
                {/each}
              </div>
            {:else}
              <p class="muted small">No configurable settings.</p>
            {/if}
          </div>
        </li>
      {/each}
    </ol>
  {/if}
</div>

<style>
  .backplane {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .add-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .add-label {
    font: var(--text-overline);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-3);
  }
  .inp {
    background: var(--surface-sunken);
    border: 1px solid var(--border-2);
    border-radius: var(--radius-sm);
    color: var(--fg-1);
    font: var(--text-body-sm);
    padding: 6px var(--space-2);
    height: 32px;
  }
  .inp:focus {
    outline: none;
    border-color: var(--accent);
  }
  .inp.mono {
    font-family: var(--font-data, monospace);
  }
  .inp.invalid {
    border-color: var(--error);
  }

  .cage {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    border-left: 2px dashed var(--border-2);
    padding-left: var(--space-3);
  }
  .slot {
    display: flex;
    gap: var(--space-2);
  }
  .slot-rail {
    flex: 0 0 auto;
    display: flex;
    align-items: flex-start;
    padding-top: var(--space-3);
  }
  .slot-no {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    font-size: 11px;
    color: var(--fg-4);
    background: var(--surface-sunken);
    border: 1px solid var(--border-2);
    border-radius: var(--radius-xs);
  }
  .board {
    flex: 1;
    min-width: 0;
    background: var(--surface-raised);
    border: 1px solid var(--border-2);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .board.collision {
    border-color: var(--error);
    background: color-mix(in srgb, var(--error) 7%, var(--surface-raised));
  }
  .board.collision .cid {
    color: var(--error);
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .board-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .board-id {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .cid {
    font-size: 14px;
    font-weight: 600;
    color: var(--fg-1);
  }
  .cref {
    font-size: 11px;
    color: var(--fg-4);
  }
  .board-actions {
    display: flex;
    gap: 2px;
  }
  .iconbtn {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--fg-3);
    cursor: pointer;
  }
  .iconbtn:hover:not(:disabled) {
    color: var(--fg-1);
    border-color: var(--border-2);
  }
  .iconbtn.danger:hover:not(:disabled) {
    color: var(--error);
  }
  .iconbtn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .params {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .param {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .plabel {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font: var(--text-overline);
    text-transform: none;
    letter-spacing: 0;
    color: var(--fg-2);
  }
  .phint {
    font-size: 10px;
    color: var(--fg-4);
  }
  .param .inp {
    width: 150px;
  }
  .pval {
    font-size: 11px;
    color: var(--fg-4);
  }
  .perr {
    font-size: 11px;
    color: var(--error);
  }
  .muted {
    color: var(--fg-3);
    font: var(--text-body-sm);
  }
  .small {
    font-size: 12px;
  }
</style>
