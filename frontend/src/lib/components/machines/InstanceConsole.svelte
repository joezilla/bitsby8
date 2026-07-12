<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebglAddon } from '@xterm/addon-webgl';
  import '@xterm/xterm/css/xterm.css';
  import { socket } from '$lib/services/socket';
  import Icon from '$lib/components/shared/Icon.svelte';

  interface Props {
    instanceId: string;
    title: string;
    onClose?: () => void;
    /** Embedded in the Run cockpit (no modal chrome; fills its container). */
    embedded?: boolean;
  }
  let { instanceId, title, onClose = () => {}, embedded = false }: Props = $props();

  let containerEl: HTMLDivElement;
  let term: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let resizeObserver: ResizeObserver | null = null;

  const reduceMotion =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function handleData({ instanceId: iid, data }: { instanceId: string; data: number[] }) {
    if (iid === instanceId) term?.write(new Uint8Array(data));
  }

  onMount(() => {
    term = new Terminal({
      cursorBlink: !reduceMotion,
      fontSize: 14,
      fontFamily: "'IBM Plex Mono', 'JetBrains Mono', 'Courier New', monospace",
      theme: { background: '#07090c', foreground: '#e8eaee', cursor: '#ffb020' },
      cols: 80,
      rows: 24,
      allowProposedApi: true,
    });
    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerEl);
    fitAddon.fit();
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      /* canvas fallback is fine */
    }

    // Keystrokes → the emulated console (RX).
    term.onData((d) => socket.emit('instance:console:write', { instanceId, data: d }));
    // Machine output (TX) → the terminal. Subscribing also clears the headless badge.
    socket.on('instance:console:data', handleData);
    socket.emit('instance:console:subscribe', { instanceId });

    resizeObserver = new ResizeObserver(() => fitAddon?.fit());
    resizeObserver.observe(containerEl);
    term.focus();
  });

  onDestroy(() => {
    socket.emit('instance:console:unsubscribe', { instanceId });
    socket.off('instance:console:data', handleData);
    resizeObserver?.disconnect();
    term?.dispose();
    term = null;
  });
</script>

{#if !embedded}
  <div
    class="overlay"
    role="button"
    tabindex="-1"
    aria-label="Close console"
    onclick={onClose}
    onkeydown={(e) => e.key === 'Escape' && onClose()}
  ></div>
{/if}
<div class="panel" class:embed={embedded} role="dialog" aria-modal="true" aria-label="Console for {title}">
  {#if !embedded}
    <header class="bar">
      <div class="ttl">
        <Icon name="terminal" size={18} />
        <span class="fdc-mono">{title}</span>
        <span class="hint">live console</span>
      </div>
      <button class="close" onclick={onClose} aria-label="Close console"><Icon name="close" size={20} /></button>
    </header>
  {/if}
  <div class="term" bind:this={containerEl}></div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: var(--surface-overlay);
    z-index: 40;
    border: none;
  }
  .panel {
    position: fixed;
    z-index: 41;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(760px, 94vw);
    background: var(--surface);
    border: 1px solid var(--border-3);
    border-radius: var(--radius-lg);
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-2);
    background: var(--surface-raised);
  }
  .ttl {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--fg-1);
    font-size: 14px;
  }
  .hint {
    font: var(--text-overline);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-4);
  }
  .close {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    background: none;
    border: none;
    color: var(--fg-3);
    cursor: pointer;
    border-radius: var(--radius-sm);
  }
  .close:hover {
    color: var(--fg-1);
  }
  .term {
    padding: var(--space-2);
    background: #07090c;
    min-height: 360px;
  }
  .panel.embed {
    position: static;
    transform: none;
    width: 100%;
    height: 100%;
    box-shadow: none;
    border: none;
    border-radius: 0;
    overflow: hidden;
  }
  .panel.embed .term {
    flex: 1;
    min-height: 0;
  }
</style>
