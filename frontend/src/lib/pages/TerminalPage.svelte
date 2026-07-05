<script lang="ts">
  import { onMount } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebglAddon } from '@xterm/addon-webgl';
  import '@xterm/xterm/css/xterm.css';
  import { socket, terminalStatus } from '$lib/services/socket';
  import { api } from '$lib/services/api';
  import { showToast } from '$lib/stores/toast';
  import { terminalHealth } from '$lib/stores/terminalHealth';
  import Icon from '$lib/components/shared/Icon.svelte';
  import IconButton from '$lib/components/shared/IconButton.svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import Chip from '$lib/components/shared/Chip.svelte';
  import Select from '$lib/components/shared/Select.svelte';
  import Led from '$lib/components/shared/Led.svelte';
  import PageHeader from '$lib/components/shared/PageHeader.svelte';
  import LabelStrip from '$lib/components/shared/LabelStrip.svelte';
  import type { SerialPortInfo } from '$lib/types/api';

  // Terminal instance (imperative, not reactive)
  let containerEl: HTMLDivElement;
  let term: Terminal | null = null;
  let fitAddon: FitAddon | null = null;

  // Connection state
  let ports = $state<SerialPortInfo[]>([]);
  let selectedPort = $state('');
  let selectedBaud = $state('9600');
  let selectedDataBits = $state('8');
  let selectedStopBits = $state('1');
  let selectedParity = $state('none');
  let selectedFlow = $state('none');
  let isConnected = $derived($terminalStatus?.connected ?? false);
  let isFullscreen = $state(false);

  // CRT mode — off / amber / green (per new design)
  type CrtMode = 'off' | 'amber' | 'green';
  let crtMode = $state<CrtMode>('off');

  const crtThemes: Record<CrtMode, any> = {
    off: {
      background: '#0c0e12',
      foreground: '#c8d0dc',
      cursor: '#c8d0dc',
      cursorAccent: '#0c0e12',
    },
    amber: {
      background: '#160d02',
      foreground: '#ffb04a',
      cursor: '#ffd07a',
      cursorAccent: '#160d02',
    },
    green: {
      background: '#02160a',
      foreground: '#5ae08a',
      cursor: '#9eff9e',
      cursorAccent: '#02160a',
    },
  };

  const crtGlow: Record<CrtMode, string> = {
    off: 'transparent',
    amber: 'rgba(255,176,32,0.55)',
    green: 'rgba(94,224,138,0.55)',
  };

  const crtPipColors: Record<CrtMode, string> = {
    off: 'var(--neutral-50)',
    amber: 'var(--crt-amber)',
    green: 'var(--crt-green)',
  };

  function setCrt(variant: CrtMode) {
    crtMode = variant;
    if (!term) return;
    try {
      term.options.theme = { ...term.options.theme, ...crtThemes[variant] };
    } catch {
      // term may be in the middle of dispose; mode will reapply on next mount.
    }
  }

  // Terminal lifecycle
  onMount(() => {
    term = new Terminal({
      cursorBlink: true,
      fontSize: 15,
      fontFamily: "'IBM Plex Mono', 'JetBrains Mono', 'Courier New', monospace",
      theme: {
        background: crtThemes.off.background,
        foreground: crtThemes.off.foreground,
        cursor: crtThemes.off.cursor,
        cursorAccent: crtThemes.off.cursorAccent,
        selectionBackground: '#ffffff40',
        black: '#000000',
        red: '#cc3333',
        green: '#00cc00',
        yellow: '#cccc00',
        blue: '#3333cc',
        magenta: '#cc33cc',
        cyan: '#00cccc',
        white: '#cccccc',
        brightBlack: '#666666',
        brightRed: '#ff4444',
        brightGreen: '#44ff44',
        brightYellow: '#ffff44',
        brightBlue: '#4444ff',
        brightMagenta: '#ff44ff',
        brightCyan: '#44ffff',
        brightWhite: '#ffffff',
      },
      cols: 80,
      rows: 24,
      allowProposedApi: true,
    });

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerEl);
    fitAddon.fit();

    // Reapply persisted CRT mode (state survives navigation away+back even
    // though the terminal instance does not).
    setCrt(crtMode);

    // Try the webgl renderer; fall back to canvas with a one-line toast so
    // the operator knows. The Term LED in the topbar flips to red via the
    // terminalHealth store.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl.dispose();
        terminalHealth.set('webgl-fallback');
        showToast('Terminal lost WebGL context — using canvas renderer', 'warning');
      });
      term.loadAddon(webgl);
      terminalHealth.set('ok');
    } catch {
      terminalHealth.set('webgl-fallback');
      showToast('WebGL unavailable — terminal using canvas renderer', 'warning');
    }

    term.onData((data) => {
      if ($terminalStatus?.connected) {
        socket.emit('terminal:write', data);
      }
    });

    const handleData = (data: number[]) => {
      term?.write(new Uint8Array(data));
    };
    socket.on('terminal:data', handleData);

    const resizeObserver = new ResizeObserver(() => {
      fitAddon?.fit();
    });
    resizeObserver.observe(containerEl);

    loadPorts();

    const unsub = terminalStatus.subscribe((status) => {
      if (status?.preferred?.port && !selectedPort) {
        selectedPort = status.preferred.port;
      }
      if (status?.preferred?.baud && selectedBaud === '9600') {
        selectedBaud = String(status.preferred.baud);
      }
    });

    return () => {
      socket.off('terminal:data', handleData);
      resizeObserver.disconnect();
      unsub();
      // Null `term` BEFORE dispose so any in-flight handler (e.g. setCrt
      // from a click that fires during teardown) sees `term === null`.
      const t = term;
      term = null;
      t?.dispose();
    };
  });

  async function loadPorts() {
    try {
      const { ports: p } = await api.listTerminalPorts();
      ports = p;
    } catch {
      // silent
    }
  }

  async function connect() {
    try {
      await api.openTerminal(selectedPort, {
        baudRate: parseInt(selectedBaud),
        dataBits: parseInt(selectedDataBits),
        stopBits: parseInt(selectedStopBits),
        parity: selectedParity,
        flowControl: selectedFlow,
      });
      showToast('Terminal connected', 'success');
      term?.focus();
    } catch (e: any) {
      showToast(e.message || 'Connection failed', 'error');
    }
  }

  async function disconnect() {
    try {
      await api.closeTerminal();
      showToast('Terminal disconnected', 'info');
    } catch (e: any) {
      showToast(e.message || 'Disconnect failed', 'error');
    }
  }

  function clearTerminal() {
    term?.clear();
  }

  function toggleFullscreen() {
    isFullscreen = !isFullscreen;
    setTimeout(() => fitAddon?.fit(), 50);
  }
</script>

{#snippet headerActions()}
  <Chip color="cyan" icon="cable">
    {isConnected ? ($terminalStatus?.device ?? 'Connected') : 'Disconnected'} · {selectedBaud} {selectedDataBits}{(selectedParity[0] ?? 'n').toUpperCase()}{selectedStopBits}
  </Chip>
  <span style="width: 1px; height: 22px; background: var(--border-1); align-self: center;"></span>
  <Button variant="ghost" size="sm" icon="refresh" onclick={loadPorts}>Refresh ports</Button>
{/snippet}

<PageHeader
  eyebrow="Section · Serial terminal · VT102"
  title="Terminal"
  actions={headerActions}
/>

<div
  class="fdc-page-body"
  class:fullscreen={isFullscreen}
  style="
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  "
>
  <!-- Connection bar -->
  <div
    style="
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 16px;
      background: var(--surface);
      border: 1px solid var(--border-1);
      border-radius: var(--radius-md) var(--radius-md) 0 0;
      border-bottom: none;
      flex-wrap: wrap;
    "
  >
    <!-- Field group -->
    <div style="display: flex; flex-direction: column; gap: 3px; min-width: 0;">
      <span class="fdc-label-strip" style="font-size: 9px;">Port</span>
      <Select bind:value={selectedPort}>
        <option value="">— Select port —</option>
        {#each ports as port}
          <option value={port.recommended}>{port.recommended}</option>
        {/each}
      </Select>
    </div>
    <div style="display: flex; flex-direction: column; gap: 3px; width: 110px;">
      <span class="fdc-label-strip" style="font-size: 9px;">Baud</span>
      <Select bind:value={selectedBaud}>
        {#each ['300', '1200', '2400', '4800', '9600', '19200', '38400', '57600', '115200'] as baud}
          <option value={baud}>{baud}</option>
        {/each}
      </Select>
    </div>
    <div style="display: flex; flex-direction: column; gap: 3px; width: 72px;">
      <span class="fdc-label-strip" style="font-size: 9px;">Data</span>
      <Select bind:value={selectedDataBits}>
        {#each ['5', '6', '7', '8'] as bits}
          <option value={bits}>{bits}</option>
        {/each}
      </Select>
    </div>
    <div style="display: flex; flex-direction: column; gap: 3px; width: 90px;">
      <span class="fdc-label-strip" style="font-size: 9px;">Parity</span>
      <Select bind:value={selectedParity}>
        {#each ['none', 'even', 'odd', 'mark', 'space'] as p}
          <option value={p}>{p}</option>
        {/each}
      </Select>
    </div>
    <div style="display: flex; flex-direction: column; gap: 3px; width: 70px;">
      <span class="fdc-label-strip" style="font-size: 9px;">Stop</span>
      <Select bind:value={selectedStopBits}>
        {#each ['1', '2'] as bits}
          <option value={bits}>{bits}</option>
        {/each}
      </Select>
    </div>
    <div style="display: flex; flex-direction: column; gap: 3px; width: 110px;">
      <span class="fdc-label-strip" style="font-size: 9px;">Flow</span>
      <Select bind:value={selectedFlow}>
        {#each ['none', 'hardware', 'software'] as f}
          <option value={f}>{f}</option>
        {/each}
      </Select>
    </div>

    <div style="flex: 1;"></div>

    <!-- CRT mode toggle: 3-pip control -->
    <div
      title="CRT phosphor mode"
      style="
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 8px 3px 8px;
        border-radius: 999px;
        background: var(--surface-sunken);
        border: 1px solid var(--border-1);
      "
    >
      <Icon name="tv" size={16} class="text-fg-3" />
      {#each ['off', 'amber', 'green'] as opt}
        {@const active = crtMode === opt}
        <button
          type="button"
          aria-label="CRT mode {opt}"
          aria-pressed={active}
          onclick={() => setCrt(opt as CrtMode)}
          style="
            width: 18px;
            height: 18px;
            border-radius: 999px;
            border: {active ? 'none' : '1px solid var(--border-2)'};
            background: {active ? crtPipColors[opt as CrtMode] : 'transparent'};
            box-shadow: {active && opt !== 'off' ? `0 0 8px ${crtPipColors[opt as CrtMode]}` : 'none'};
            cursor: pointer;
            padding: 0;
          "
        ></button>
      {/each}
    </div>

    <Button variant="ghost" size="sm" icon="cleaning_services" onclick={clearTerminal}>Clear</Button>
    <IconButton icon={isFullscreen ? 'fullscreen_exit' : 'fullscreen'} size={18} title="Toggle fullscreen" onclick={toggleFullscreen} />
    {#if isConnected}
      <Button variant="filled" size="sm" icon="link_off" onclick={disconnect}>Disconnect</Button>
    {:else}
      <Button variant="filled" size="sm" icon="link" disabled={!selectedPort} onclick={connect}>Connect</Button>
    {/if}
  </div>

  <!-- Terminal area -->
  <div
    style="
      flex: 1;
      min-height: 300px;
      position: relative;
      background: {crtThemes[crtMode].background};
      border: 1px solid var(--border-1);
      border-top: 1px solid var(--border-2);
      border-radius: 0 0 var(--radius-md) var(--radius-md);
      overflow: hidden;
      box-shadow: {crtMode !== 'off'
        ? 'inset 0 0 80px rgba(0,0,0,0.55), inset 0 0 18px rgba(0,0,0,0.35)'
        : 'none'};
    "
    class:crt-active={crtMode !== 'off'}
  >
    <!-- xterm host -->
    <div bind:this={containerEl} style="width: 100%; height: 100%; position: relative; z-index: 1;"></div>

    <!-- CRT scanline overlay -->
    {#if crtMode !== 'off'}
      <div
        aria-hidden="true"
        style="
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: repeating-linear-gradient(
            0deg,
            transparent,
            transparent 1px,
            rgba(0, 0, 0, 0.18) 1px,
            rgba(0, 0, 0, 0.18) 2px
          );
          z-index: 2;
        "
      ></div>
    {/if}

    <!-- CRT vignette overlay -->
    {#if crtMode !== 'off'}
      <div
        aria-hidden="true"
        style="
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: radial-gradient(ellipse 70% 60% at center, transparent 55%, rgba(0, 0, 0, 0.5) 100%);
          z-index: 3;
        "
      ></div>
    {/if}

    <!-- Phosphor corner label -->
    {#if crtMode !== 'off'}
      <div
        style="
          position: absolute;
          left: 14px;
          bottom: 10px;
          z-index: 4;
          font-family: var(--font-data);
          font-size: 10px;
          letter-spacing: 0.22em;
          color: {crtThemes[crtMode].foreground};
          opacity: 0.5;
          text-shadow: 0 0 4px {crtGlow[crtMode]};
        "
      >
        {crtMode === 'amber' ? 'AMBER P3' : 'P1 PHOSPHOR'} · 80×24
      </div>
    {/if}

    <!-- RX LED corner -->
    <div
      style="
        position: absolute;
        right: 14px;
        bottom: 12px;
        display: flex;
        align-items: center;
        gap: 6px;
        z-index: 4;
      "
    >
      <Led color={isConnected ? 'green' : 'off'} pulse={isConnected} />
      <span
        class="fdc-label-strip"
        style="color: {crtMode !== 'off' ? crtThemes[crtMode].foreground : 'var(--fg-3)'}; opacity: {crtMode !== 'off' ? 0.5 : 1};"
      >
        RX
      </span>
    </div>
  </div>
</div>

<style>
  .fullscreen {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: var(--bg);
    padding: 16px;
  }
  /* xterm phosphor glow */
  .crt-active :global(.xterm-rows) {
    filter: drop-shadow(0 0 1px currentColor);
  }
</style>
