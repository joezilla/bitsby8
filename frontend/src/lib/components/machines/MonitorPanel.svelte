<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { socket } from '$lib/services/socket';
  import { pageVisible } from '$lib/stores/pageVisible';
  import Icon from '$lib/components/shared/Icon.svelte';
  import { vdmGlyph, VDM_GLYPH_W, VDM_GLYPH_H } from './vdm-font';

  interface Props {
    instanceId: string;
    title: string;
    onClose?: () => void;
    /** Embedded in the Run cockpit (no modal chrome; fills its container). */
    embedded?: boolean;
    /**
     * Whether this monitor is actually on-screen. The cockpit keeps the panel
     * mounted while maximizing the console (CSS-hidden), so gate the live
     * stream on real visibility — no point pushing frames nobody can see.
     */
    active?: boolean;
  }
  let { instanceId, title, onClose = () => {}, embedded = false, active = true }: Props = $props();

  type Display = { cardId: string; descriptor: Record<string, unknown>; state: Record<string, number>; frame: string };
  let displays = $state<Display[]>([]);
  let loading = $state(true);
  let canvas = $state<HTMLCanvasElement>();
  let off: HTMLCanvasElement | undefined; // offscreen native-res buffer (Dazzler)

  // Char cell + pixel scale for the phosphor look.
  const CELL_W = 7; // 5px glyph + 2px gap
  const CELL_H = 10; // 7px glyph + 3px gap
  const SCALE = 2;
  const PHOSPHOR = '#7dff9a';
  const PHOSPHOR_DIM = '#0c1f13';

  const videoNote = $derived.by(() => {
    const d = displays[0];
    if (!d) return '';
    if (d.descriptor.mode === 'bitmap') {
      const fmt = Number(d.state.format ?? 0);
      const x4 = (fmt & 0x20) !== 0;
      const color = (fmt & 0x10) !== 0;
      const w = color ? (x4 ? 64 : 32) : x4 ? 128 : 64;
      const off = Number(d.state.on ?? 0) ? '' : ' · off';
      return `${d.cardId} · Dazzler ${w}×${w} ${color ? 'colour' : 'mono'}${off}`;
    }
    return `${d.cardId} · ${d.descriptor.cols}×${d.descriptor.rows} chars`;
  });

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
    // VDM-1 hardware scroll: the DSTAT "Beginning Display Line" (low nibble,
    // surfaced as state.scroll) picks which memory row is shown at the top.
    // SOLOS writes new text into successive rows and bumps this instead of
    // moving characters, so visible row r must show memory row (scroll + r)%rows.
    const scroll = Number(d.state.scroll ?? 0);
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
      const memRow = (scroll + r) % rows;
      for (let c = 0; c < cols; c++) {
        const byte = bytes[memRow * cols + c] ?? 0x20;
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

  // A Dazzler 4-bit nibble → RGB (bit3 = intensity, bit2/1/0 = R/G/B).
  function nibbleRgb(nib: number): [number, number, number] {
    const level = nib & 0x8 ? 255 : 140;
    return [nib & 0x4 ? level : 0, nib & 0x2 ? level : 0, nib & 0x1 ? level : 0];
  }

  // Cromemco Dazzler: a DMA bitmap. Resolution + colour come from the runtime
  // format byte; the buffer is quadrant-interleaved (UL, LL, UR, LR).
  function renderDazzler(ctx: CanvasRenderingContext2D, d: Display) {
    const bytes = b64ToBytes(d.frame);
    const on = Number(d.state.on ?? 0);
    const fmt = Number(d.state.format ?? 0);
    const x4 = (fmt & 0x20) !== 0; // D5 resolution
    const color = (fmt & 0x10) !== 0; // D4 colour / monochrome
    const W = color ? (x4 ? 64 : 32) : x4 ? 128 : 64;
    const H = W;
    const scale = Math.max(1, Math.floor(480 / W));
    const cw = W * scale;
    const ch = H * scale;
    if (canvas!.width !== cw || canvas!.height !== ch) {
      canvas!.width = cw;
      canvas!.height = ch;
    }

    if (!off) off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const octx = off.getContext('2d')!;
    const img = octx.createImageData(W, H);
    const px = img.data;
    const put = (x: number, y: number, r: number, g: number, b: number) => {
      const i = (y * W + x) * 4;
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    };

    if (on) {
      const qw = W >> 1;
      const qh = H >> 1;
      for (let q = 0; q < 4; q++) {
        const ox = q >= 2 ? qw : 0; // q0/q1 left, q2/q3 right
        const oy = q & 1 ? qh : 0; //  q0/q2 top,  q1/q3 bottom
        if (color) {
          const bpr = qw >> 1; // 2 px/byte
          const qbase = q * bpr * qh;
          for (let y = 0; y < qh; y++)
            for (let x = 0; x < qw; x++) {
              const byte = bytes[qbase + y * bpr + (x >> 1)] ?? 0;
              const nib = x & 1 ? (byte >> 4) & 0xf : byte & 0xf;
              const [r, g, b] = nibbleRgb(nib);
              put(ox + x, oy + y, r, g, b);
            }
        } else {
          const bpr = qw >> 3; // 8 px/byte
          const qbase = q * bpr * qh;
          const [r, g, b] = nibbleRgb((fmt & 0x0f) || 0x0f); // on-colour (white if unset)
          for (let y = 0; y < qh; y++)
            for (let x = 0; x < qw; x++) {
              const byte = bytes[qbase + y * bpr + (x >> 3)] ?? 0;
              if ((byte >> (x & 7)) & 1) put(ox + x, oy + y, r, g, b);
            }
        }
      }
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(off, 0, 0, cw, ch);
  }

  function render() {
    const d = displays[0];
    const ctx = canvas?.getContext('2d');
    if (d && ctx && d.descriptor.mode === 'charGrid') renderCharGrid(ctx, d);
    else if (d && ctx && d.descriptor.mode === 'bitmap') renderDazzler(ctx, d);
  }

  // Server-pushed frames (see websocket/handlers.ts). Filter by instanceId
  // since the socket is shared across the app.
  function handleFrame(msg: { instanceId: string; displays: Display[] }) {
    if (msg.instanceId !== instanceId) return;
    displays = msg.displays;
    loading = false;
    render();
  }

  onMount(() => {
    socket.on('instance:monitor:frame', handleFrame);
  });
  onDestroy(() => {
    socket.emit('instance:monitor:unsubscribe', { instanceId });
    socket.off('instance:monitor:frame', handleFrame);
  });

  // Stream only while the panel is genuinely visible — on-screen AND the tab
  // isn't backgrounded. The $effect cleanup unsubscribes the moment either
  // flips, so a hidden/minimized cockpit stops costing the server anything.
  $effect(() => {
    if (active && $pageVisible) {
      socket.emit('instance:monitor:subscribe', { instanceId });
      return () => socket.emit('instance:monitor:unsubscribe', { instanceId });
    }
  });
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
      <p class="muted">No video cards on this machine. Add a “VDM-1 video” or “Cromemco Dazzler” card to a profile.</p>
    {:else}
      <div class="crt">
        <canvas bind:this={canvas}></canvas>
      </div>
      <p class="note fdc-mono">{videoNote}</p>
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
