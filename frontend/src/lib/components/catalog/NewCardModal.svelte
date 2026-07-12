<script lang="ts">
  import { api } from '$lib/services/api';
  import { showToast } from '$lib/stores/toast';
  import Button from '$lib/components/shared/Button.svelte';
  import Icon from '$lib/components/shared/Icon.svelte';
  import HexInput from '$lib/components/shared/HexInput.svelte';

  interface Props {
    onClose: () => void;
    onCreated: () => void;
  }
  let { onClose, onCreated }: Props = $props();

  // The declarative kinds you can author with no code.
  type Kind = 'ram' | 'rom' | 'cpu-i8080' | 'cpu-z80';
  const KINDS: { id: Kind; label: string; icon: string; desc: string }[] = [
    { id: 'ram', label: 'RAM board', icon: 'memory', desc: 'Read/write memory at a base address.' },
    { id: 'rom', label: 'EPROM board', icon: 'memory', desc: 'Read-only memory you can burn an image into.' },
    { id: 'cpu-i8080', label: 'CPU — Intel 8080', icon: 'developer_board', desc: 'An 8080 processor board.' },
    { id: 'cpu-z80', label: 'CPU — Zilog Z80', icon: 'developer_board', desc: 'A Z80 processor board.' },
  ];

  let kind = $state<Kind>('ram');
  let name = $state('');
  let maker = $state('');
  let summary = $state('');
  let base = $state(0xf000);
  let size = $state(0x0800);
  let resetVector = $state(0xf800);
  let busy = $state(false);

  const isMemory = $derived(kind === 'ram' || kind === 'rom');
  const isCpu = $derived(kind === 'cpu-i8080' || kind === 'cpu-z80');

  function behaviorFor() {
    if (kind === 'ram') return { resolvesTo: 'memory', memKind: 'ram' } as const;
    if (kind === 'rom') return { resolvesTo: 'memory', memKind: 'rom' } as const;
    if (kind === 'cpu-i8080') return { resolvesTo: 'cpu', cpuKind: 'i8080' } as const;
    return { resolvesTo: 'cpu', cpuKind: 'z80' } as const;
  }

  async function create() {
    if (!name.trim()) {
      showToast('Give the card a name', 'error');
      return;
    }
    try {
      busy = true;
      const defaults = isMemory ? { base, size } : { resetVector };
      const card = await api.authorCard({
        name: name.trim(),
        maker: maker.trim() || undefined,
        summary: summary.trim() || undefined,
        behavior: behaviorFor(),
        defaults,
      });
      showToast(`Authored ${card.id}`, 'success');
      onCreated();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      busy = false;
    }
  }
</script>

<div class="overlay" role="button" tabindex="-1" aria-label="Close" onclick={onClose}
  onkeydown={(e) => e.key === 'Escape' && onClose()}></div>
<div class="panel" role="dialog" aria-modal="true" aria-label="Author a new card">
  <header class="bar">
    <div class="ttl"><Icon name="add_circle" size={18} /><span>New card</span><span class="hint">no code — declarative</span></div>
    <button class="close" onclick={onClose} aria-label="Close"><Icon name="close" size={20} /></button>
  </header>

  <div class="body">
    <fieldset class="kinds" disabled={busy}>
      <legend>What kind of board?</legend>
      <div class="kind-grid">
        {#each KINDS as k (k.id)}
          <label class="kind" class:sel={kind === k.id}>
            <input type="radio" value={k.id} bind:group={kind} />
            <Icon name={k.icon} size={18} />
            <span class="kind-l">{k.label}</span>
            <span class="kind-d">{k.desc}</span>
          </label>
        {/each}
      </div>
    </fieldset>

    <div class="field">
      <label for="nc-name">Name</label>
      <input id="nc-name" class="inp" bind:value={name} placeholder="e.g. cromemco-64kz" disabled={busy} />
    </div>
    <div class="two">
      <div class="field">
        <label for="nc-maker">Maker <span class="opt">(optional)</span></label>
        <input id="nc-maker" class="inp" bind:value={maker} placeholder="e.g. Cromemco" disabled={busy} />
      </div>
      <div class="field">
        <label for="nc-summary">Summary <span class="opt">(optional)</span></label>
        <input id="nc-summary" class="inp" bind:value={summary} placeholder="One line" disabled={busy} />
      </div>
    </div>

    {#if isMemory}
      <div class="two">
        <div class="field">
          <label for="nc-base">Default base</label>
          <HexInput id="nc-base" value={base} min={0} max={0xffff} ariaLabel="default base" onchange={(n) => (base = n)} />
        </div>
        <div class="field">
          <label for="nc-size">Default size</label>
          <HexInput id="nc-size" value={size} min={1} max={0xffff} ariaLabel="default size" onchange={(n) => (size = n)} />
        </div>
      </div>
      <p class="note">Defaults seat the card at these addresses; every instance can override them on the backplane.</p>
    {/if}
    {#if isCpu}
      <div class="field half">
        <label for="nc-reset">Default reset vector</label>
        <HexInput id="nc-reset" value={resetVector} min={0} max={0xffff} ariaLabel="default reset vector" onchange={(n) => (resetVector = n)} />
      </div>
      <p class="note">The processor board sets the machine's CPU and its power-on jump.</p>
    {/if}
  </div>

  <footer class="foot">
    <Button variant="ghost" size="sm" onclick={onClose} disabled={busy}>Cancel</Button>
    <Button variant="filled" size="sm" icon="add" onclick={create} disabled={busy || !name.trim()}>Create card</Button>
  </footer>
</div>

<style>
  .overlay { position: fixed; inset: 0; background: var(--surface-overlay); z-index: 40; border: none; }
  .panel {
    position: fixed; z-index: 41; left: 50%; top: 50%; transform: translate(-50%, -50%);
    width: min(560px, 95vw); max-height: 90vh; overflow-y: auto;
    background: var(--surface); border: 1px solid var(--border-3); border-radius: var(--radius-lg);
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5); display: flex; flex-direction: column;
  }
  .bar {
    display: flex; align-items: center; justify-content: space-between;
    padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--border-2); background: var(--surface-raised);
  }
  .ttl { display: flex; align-items: center; gap: var(--space-2); font-weight: 600; }
  .hint { color: var(--fg-3); font-size: 12px; }
  .close { background: none; border: none; color: var(--fg-3); cursor: pointer; display: flex; }
  .close:hover { color: var(--fg-1); }
  .body { padding: var(--space-3); display: flex; flex-direction: column; gap: var(--space-3); }
  .kinds { border: none; padding: 0; margin: 0; }
  .kinds legend {
    font: var(--text-overline); text-transform: uppercase; letter-spacing: 0.04em; color: var(--fg-4); padding: 0 0 var(--space-2);
  }
  .kind-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); }
  .kind {
    display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 8px; align-items: center;
    padding: var(--space-2) var(--space-3); border: 1px solid var(--border-2); border-radius: var(--radius-md); cursor: pointer;
  }
  .kind.sel { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .kind input { grid-row: 1 / 3; }
  .kind-l { font-size: 13px; font-weight: 600; }
  .kind-d { grid-column: 2; font-size: 11px; color: var(--fg-3); }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field.half { max-width: 220px; }
  .field label { font-size: 12px; color: var(--fg-2); }
  .opt { color: var(--fg-4); }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
  .note { margin: 0; font-size: 12px; color: var(--fg-3); }
  .foot {
    display: flex; justify-content: flex-end; gap: var(--space-2);
    padding: var(--space-2) var(--space-3); border-top: 1px solid var(--border-2); background: var(--surface-raised);
    position: sticky; bottom: 0;
  }
</style>
