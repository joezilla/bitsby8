<script lang="ts">
  import type { MemoryBand } from '$lib/types/api';

  interface Props {
    /** Resolved memory map (from the live validator). */
    map: MemoryBand[];
    /** Program counter at power-on — drawn as a marker; red when over a hole. */
    resetVector: number;
  }
  let { map, resetVector }: Props = $props();

  const SPACE = 0x10000; // 64 KiB address space
  const pct = (n: number) => `${(n / SPACE) * 100}%`;
  const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, '0')}`;
  const sizeLabel = (n: number) => (n >= 1024 && n % 1024 === 0 ? `${n / 1024}K` : `${n}B`);

  // Sorted, clamped bands.
  let bands = $derived(
    [...map]
      .filter((b) => b.size > 0)
      .sort((a, b) => a.base - b.base)
      .map((b) => ({ ...b, end: Math.min(b.base + b.size, SPACE) })),
  );

  // Is the reset vector inside a mapped region?
  let resetInHole = $derived(!bands.some((b) => resetVector >= b.base && resetVector < b.end));
  // Is the reset vector inside ROM (the healthy case — boot code lives in ROM)?
  let resetInRom = $derived(bands.some((b) => b.kind === 'rom' && resetVector >= b.base && resetVector < b.end));

  const kindLabel = (k: string) => (k === 'ram' ? 'RAM' : k === 'rom' ? 'ROM' : k === 'mmio' ? 'MMIO' : k);
</script>

<div class="ribbon-wrap">
  <div class="scale">
    <span>0x0000</span><span>0x4000</span><span>0x8000</span><span>0xC000</span><span class="r">0xFFFF</span>
  </div>

  <div class="ribbon" role="img" aria-label="Memory map from 0x0000 to 0xFFFF">
    {#each bands as b (b.id)}
      <div
        class="band {b.kind}"
        class:from-card={b.source === 'card'}
        style="left: {pct(b.base)}; width: {pct(b.end - b.base)};"
        title="{b.id} · {kindLabel(b.kind)} · {hex(b.base)}–{hex(b.end - 1)} ({sizeLabel(b.end - b.base)}){b.source === 'card' ? ' · from card' : ''}"
      >
        <span class="band-label">{kindLabel(b.kind)}</span>
      </div>
    {/each}

    <!-- Reset-vector marker -->
    <div
      class="reset"
      class:hole={resetInHole}
      style="left: {pct(resetVector)};"
      title="reset vector {hex(resetVector)}{resetInHole ? ' — over unmapped memory!' : resetInRom ? ' (in ROM)' : ''}"
      aria-label="reset vector at {hex(resetVector)}"
    >
      <span class="reset-flag">⏷</span>
    </div>
  </div>

  <div class="legend">
    <span class="key"><i class="sw ram"></i>RAM</span>
    <span class="key"><i class="sw rom"></i>ROM</span>
    <span class="key"><i class="sw mmio"></i>MMIO</span>
    <span class="key"><i class="sw card-hint"></i>from card</span>
    <span class="key reset-key"><i class="sw reset-sw"></i>reset {hex(resetVector)}</span>
    {#if resetInHole}
      <span class="reset-warn" role="alert">reset vector points at unmapped memory</span>
    {/if}
    {#if bands.length === 0}
      <span class="empty">no memory mapped — add a RAM or EPROM card</span>
    {/if}
  </div>
</div>

<style>
  .ribbon-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .scale {
    display: flex;
    justify-content: space-between;
    font: var(--text-overline);
    color: var(--fg-4);
    font-family: var(--font-mono, monospace);
    font-size: 10px;
  }
  .scale .r {
    text-align: right;
  }
  .ribbon {
    position: relative;
    height: 34px;
    background: repeating-linear-gradient(
      90deg,
      var(--surface-sunken),
      var(--surface-sunken) 2px,
      transparent 2px,
      transparent 8px
    );
    border: 1px solid var(--border-2);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .band {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 2px;
    border-right: 1px solid rgba(0, 0, 0, 0.35);
    box-sizing: border-box;
    overflow: hidden;
  }
  .band-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.03em;
    color: rgba(0, 0, 0, 0.7);
    white-space: nowrap;
  }
  .band.ram {
    background: color-mix(in srgb, var(--accent) 55%, transparent);
  }
  .band.rom {
    background: color-mix(in srgb, var(--success, #3fb950) 60%, transparent);
  }
  .band.mmio {
    background: color-mix(in srgb, var(--warning, #d29922) 60%, transparent);
  }
  .band.from-card {
    background-image: repeating-linear-gradient(
      45deg,
      rgba(255, 255, 255, 0.16),
      rgba(255, 255, 255, 0.16) 3px,
      transparent 3px,
      transparent 7px
    );
  }
  .reset {
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 2px;
    background: var(--fg-1);
    transform: translateX(-1px);
    z-index: 2;
  }
  .reset-flag {
    position: absolute;
    top: -11px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 11px;
    line-height: 1;
    color: var(--fg-1);
  }
  .reset.hole,
  .reset.hole .reset-flag {
    background: var(--error);
    color: var(--error);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    font-size: 11px;
    color: var(--fg-3);
  }
  .key {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .sw {
    width: 11px;
    height: 11px;
    border-radius: 2px;
    display: inline-block;
  }
  .sw.ram {
    background: color-mix(in srgb, var(--accent) 55%, transparent);
  }
  .sw.rom {
    background: color-mix(in srgb, var(--success, #3fb950) 60%, transparent);
  }
  .sw.mmio {
    background: color-mix(in srgb, var(--warning, #d29922) 60%, transparent);
  }
  .sw.card-hint {
    background-image: repeating-linear-gradient(45deg, var(--fg-4), var(--fg-4) 2px, transparent 2px, transparent 5px);
    border: 1px solid var(--border-2);
  }
  .sw.reset-sw {
    background: var(--fg-1);
    width: 3px;
    height: 12px;
    border-radius: 0;
  }
  .reset-warn {
    color: var(--error);
    font-weight: 500;
  }
  .empty {
    color: var(--fg-4);
    font-style: italic;
  }
</style>
