<script lang="ts">
  import { onDestroy } from 'svelte';
  import { api } from '$lib/services/api';
  import { pageVisible } from '$lib/stores/pageVisible';
  import { showToast } from '$lib/stores/toast';
  import Icon from '$lib/components/shared/Icon.svelte';

  interface Props {
    instanceId: string;
    title: string;
    onClose?: () => void;
    /** Embedded in the Run cockpit (no modal chrome; fills its container). */
    embedded?: boolean;
  }
  let { instanceId, title, onClose = () => {}, embedded = false }: Props = $props();

  type Port = { cardId: string; direction: 'out' | 'in' | 'inout'; output: number };
  let ports = $state<Port[]>([]);
  let loading = $state(true);
  // Operator-set input byte per card (the CPU reads these — sense switches).
  let inputs = $state<Record<string, number>>({});
  let timer: ReturnType<typeof setInterval> | undefined;

  async function poll() {
    try {
      ports = (await api.listInstanceGpio(instanceId)).ports;
      for (const p of ports) if (!(p.cardId in inputs)) inputs[p.cardId] = 0x00;
    } catch {
      /* instance may have stopped */
    } finally {
      loading = false;
    }
  }

  // GPIO stays a REST poll (low frequency, and the component only mounts when
  // the panel is expanded), but pause it while the tab is hidden so a
  // backgrounded cockpit stops hitting the Pi.
  $effect(() => {
    if (!$pageVisible) return;
    poll();
    timer = setInterval(poll, 400); // GPIO is polled state, not a stream
    return () => timer && clearInterval(timer);
  });
  onDestroy(() => timer && clearInterval(timer));

  const bit = (byte: number, i: number) => (byte >> i) & 1; // bit 7 … bit 0, MSB first
  const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;
  const hasOut = (d: string) => d === 'out' || d === 'inout';
  const hasIn = (d: string) => d === 'in' || d === 'inout';

  async function toggleInput(cardId: string, i: number) {
    const next = inputs[cardId] ^ (1 << i);
    inputs[cardId] = next;
    try {
      await api.setInstanceGpioInput(instanceId, cardId, next);
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  }
</script>

{#if !embedded}
  <div class="overlay" role="button" tabindex="-1" aria-label="Close" onclick={onClose}
    onkeydown={(e) => e.key === 'Escape' && onClose()}></div>
{/if}
<div class="panel" class:embed={embedded} role="dialog" aria-modal="true" aria-label="GPIO for {title}">
  {#if !embedded}
    <header class="bar">
      <div class="ttl"><Icon name="toggle_on" size={18} /><span>GPIO</span><span class="hint fdc-mono">{title}</span></div>
      <button class="close" onclick={onClose} aria-label="Close"><Icon name="close" size={20} /></button>
    </header>
  {/if}

  <div class="body">
    {#if loading}
      <p class="muted">Reading ports…</p>
    {:else if ports.length === 0}
      <p class="muted">No GPIO cards on this machine. Add a “Parallel I/O port” card to a profile.</p>
    {:else}
      {#each ports as p (p.cardId)}
        <div class="port">
          <div class="port-head">
            <span class="cid fdc-mono">{p.cardId}</span>
            <span class="dir">{p.direction}</span>
          </div>

          {#if hasOut(p.direction)}
            <div class="lane">
              <span class="lane-label">out</span>
              <div class="bits">
                {#each [7, 6, 5, 4, 3, 2, 1, 0] as i (i)}
                  <span class="led" class:on={bit(p.output, i) === 1} title="bit {i}"></span>
                {/each}
              </div>
              <span class="val fdc-mono">{hex(p.output)}</span>
            </div>
          {/if}

          {#if hasIn(p.direction)}
            <div class="lane">
              <span class="lane-label">in</span>
              <div class="bits">
                {#each [7, 6, 5, 4, 3, 2, 1, 0] as i (i)}
                  <button
                    class="sw"
                    class:on={bit(inputs[p.cardId] ?? 0, i) === 1}
                    onclick={() => toggleInput(p.cardId, i)}
                    aria-label="{p.cardId} input bit {i}"
                    aria-pressed={bit(inputs[p.cardId] ?? 0, i) === 1}
                  ></button>
                {/each}
              </div>
              <span class="val fdc-mono">{hex(inputs[p.cardId] ?? 0)}</span>
            </div>
          {/if}
        </div>
      {/each}
      <p class="note">LEDs show the byte the CPU latched (output). Switches drive the byte the CPU reads (input).</p>
    {/if}
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; background: var(--surface-overlay); z-index: 40; border: none; }
  .panel {
    position: fixed; z-index: 41; left: 50%; top: 50%; transform: translate(-50%, -50%);
    width: min(480px, 94vw); max-height: 88vh; overflow-y: auto;
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
  .panel.embed { position: static; transform: none; width: 100%; max-width: none; max-height: none;
    box-shadow: none; border: none; border-radius: 0; background: transparent; }
  .muted { color: var(--fg-3); font: var(--text-body-sm); }
  .port { border: 1px solid var(--border-1); border-radius: var(--radius-md); padding: var(--space-2) var(--space-3); display: flex; flex-direction: column; gap: 8px; }
  .port-head { display: flex; align-items: baseline; justify-content: space-between; }
  .cid { font-size: 13px; font-weight: 600; }
  .dir { font-family: var(--font-mono, monospace); font-size: 11px; color: var(--fg-4); text-transform: uppercase; letter-spacing: 0.04em; }
  .lane { display: grid; grid-template-columns: 34px 1fr auto; align-items: center; gap: var(--space-2); }
  .lane-label { font-size: 11px; color: var(--fg-4); text-transform: uppercase; }
  .bits { display: flex; gap: 5px; }
  .led {
    width: 15px; height: 15px; border-radius: 50%;
    background: var(--surface-sunken); border: 1px solid var(--border-2);
  }
  .led.on {
    background: var(--success, #3fb950);
    border-color: color-mix(in srgb, var(--success, #3fb950) 60%, black);
    box-shadow: 0 0 6px color-mix(in srgb, var(--success, #3fb950) 70%, transparent);
  }
  .sw {
    width: 15px; height: 22px; border-radius: 3px; cursor: pointer; padding: 0;
    background: var(--surface-sunken); border: 1px solid var(--border-2);
    position: relative;
  }
  .sw::after {
    content: ""; position: absolute; left: 2px; right: 2px; height: 8px; top: 2px;
    border-radius: 2px; background: var(--fg-4); transition: top 0.08s;
  }
  .sw.on { background: color-mix(in srgb, var(--accent) 22%, var(--surface-sunken)); border-color: var(--accent); }
  .sw.on::after { top: auto; bottom: 2px; background: var(--accent); }
  .val { font-size: 12px; color: var(--fg-2); min-width: 46px; text-align: right; }
  .note { margin: 0; font-size: 12px; color: var(--fg-3); }
</style>
