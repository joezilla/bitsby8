<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { api } from '$lib/services/api';
  import Icon from '$lib/components/shared/Icon.svelte';
  import { vdmGlyph, VDM_GLYPH_W, VDM_GLYPH_H } from './vdm-font';

  interface Props {
    instanceId: string;
    title: string;
    onClose?: () => void;
    /** Embedded in the Run cockpit (no modal chrome; fills its container). */
    embedded?: boolean;
  }
  let { instanceId, title, onClose = () => {}, embedded = false }: Props = $props();

  type Display = { cardId: string; descriptor: Record<string, unknown>; state: Record<string, number>; frame: string };
  let displays = $state<Display[]>([]);
  let loading = $state(true);
  let canvas = $state<HTMLCanvasElement>();
  let timer: ReturnType<typeof setInterval> | undefined;

  // Char cell + pixel scale for the phosphor look.
  const CELL_W = 7; // 5px glyph + 2px gap
  const CELL_H = 10; // 7px glyph + 3px gap
  const SCALE = 2;
  const PHOSPHOR = '#7dff9a';
  const PHOSPHOR_DIM = '#0c1f13';

  function b64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function renderCharGrid(ctx: CanvasRenderingContext2D, d: Display) {
    const cols = Number(d.descriptor.cols ?? 64);
    const rows = Number(d.descriptor.rows ?? 16);
    const attrBit = Number(d.descriptor.attrBit ?? 7);
    const bytes = b64ToBytes(d.frame);
    const w = cols * CELL_W * SCALE;
    const h = rows * CELL_H * SCALE;
    if (canvas!.width !== w || canvas!.height !== h) {
      canvas!.width = w;
      canvas!.height = h;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#04120a';
    ctx.fillRect(0, 0, w, h);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const byte = bytes[r * cols + c] ?? 0x20;
        const inverse = (byte & (1 << attrBit)) !== 0;
        const glyph = vdmGlyph(byte);
        const x0 = c * CELL_W * SCALE;
        const y0 = r * CELL_H * SCALE;
        if (inverse) {
          ctx.fillStyle = PHOSPHOR;
          ctx.fillRect(x0, y0, CELL_W * SCALE, CELL_H * SCALE);
        }
        ctx.fillStyle = inverse ? PHOSPHOR_DIM : PHOSPHOR;
        for (let gy = 0; gy < VDM_GLYPH_H; gy++) {
          const rowBits = glyph[gy] ?? 0;
          for (let gx = 0; gx < VDM_GLYPH_W; gx++) {
            if ((rowBits >> (VDM_GLYPH_W - 1 - gx)) & 1) {
              ctx.fillRect(x0 + gx * SCALE, y0 + gy * SCALE, SCALE, SCALE);
            }
          }
        }
      }
    }
  }

  async function poll() {
    try {
      displays = (await api.listInstanceDisplays(instanceId)).displays;
      loading = false;
      const d = displays[0];
      const ctx = canvas?.getContext('2d');
      if (d && ctx && d.descriptor.mode === 'charGrid') renderCharGrid(ctx, d);
    } catch {
      /* instance may have stopped */
    }
  }

  onMount(() => {
    poll();
    timer = setInterval(poll, 66); // ~15 fps
  });
  onDestroy(() => timer && clearInterval(timer));
</script>

{#if !embedded}
  <div class="overlay" role="button" tabindex="-1" aria-label="Close" onclick={onClose}
    onkeydown={(e) => e.key === 'Escape' && onClose()}></div>
{/if}
<div class="panel" class:embed={embedded} role="dialog" aria-modal="true" aria-label="Monitor for {title}">
  {#if !embedded}
    <header class="bar">
      <div class="ttl"><Icon name="monitor" size={18} /><span>Monitor</span><span class="hint fdc-mono">{title}</span></div>
      <button class="close" onclick={onClose} aria-label="Close"><Icon name="close" size={20} /></button>
    </header>
  {/if}

  <div class="body">
    {#if loading}
      <p class="muted">Reading display…</p>
    {:else if displays.length === 0}
      <p class="muted">No video cards on this machine. Add a “VDM-1 video” card to a profile.</p>
    {:else}
      <div class="crt">
        <canvas bind:this={canvas}></canvas>
      </div>
      <p class="note fdc-mono">{displays[0].cardId} · {displays[0].descriptor.cols}×{displays[0].descriptor.rows} chars</p>
    {/if}
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; background: var(--surface-overlay); z-index: 40; border: none; }
  .panel {
    position: fixed; z-index: 41; left: 50%; top: 50%; transform: translate(-50%, -50%);
    max-width: 96vw; max-height: 92vh; overflow: auto;
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
  .body { padding: var(--space-3); display: flex; flex-direction: column; gap: var(--space-2); align-items: center; }
  .panel.embed { position: static; transform: none; width: 100%; height: 100%; max-width: none; max-height: none;
    box-shadow: none; border: none; border-radius: 0; background: transparent; }
  .panel.embed .body { flex: 1; padding: 0; justify-content: flex-start; }
  .muted { color: var(--fg-3); font: var(--text-body-sm); }
  .crt {
    background: #04120a;
    padding: 18px 20px;
    border-radius: 10px;
    border: 1px solid #123; box-shadow: inset 0 0 40px rgba(0,0,0,0.6), 0 0 0 3px #0a0a0a;
    display: flex; align-items: center; justify-content: center; overflow: hidden; max-width: 100%;
  }
  /* Scale the fixed-resolution framebuffer to fit its box, staying pixel-crisp. */
  .crt canvas { display: block; image-rendering: pixelated; max-width: 100%; max-height: 70vh; }
  .note { color: var(--fg-4); font-size: 12px; }
  /* Embedded (cockpit): the CRT fills the panel and the canvas contains-fits it. */
  .panel.embed .crt { flex: 1; width: 100%; height: 100%; min-height: 0; padding: 10px; border-radius: 0; border: none; }
  .panel.embed .crt canvas { width: 100%; height: 100%; max-height: none; object-fit: contain; }
</style>
