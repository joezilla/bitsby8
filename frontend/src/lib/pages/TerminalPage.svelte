<script lang="ts">
  import { onMount } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import { socket, terminalStatus } from '$lib/services/socket';
  import { api } from '$lib/services/api';
  import { showToast } from '$lib/stores/toast';
  import StatusLed from '$lib/components/shared/StatusLed.svelte';
  import type { SerialPortInfo } from '$lib/types/api';
  import { Maximize2, Minimize2, Monitor, Settings2, Tv } from 'lucide-svelte';

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
  let controlsVisible = $state(true);
  let isFullscreen = $state(false);

  // CRT mode
  let crtMode = $state<'off' | 'cyan' | 'green' | 'amber'>('off');
  let crtMenuOpen = $state(false);

  const crtThemes: Record<string, any> = {
    off: {
      background: '#0a0a0a',
      foreground: '#e0e0e0',
      cursor: '#e0e0e0',
      cursorAccent: '#0a0a0a',
    },
    cyan: {
      background: '#001a1a',
      foreground: '#00AAAA',
      cursor: '#55FFFF',
      cursorAccent: '#001a1a',
    },
    green: {
      background: '#001a00',
      foreground: '#00CC00',
      cursor: '#00FF00',
      cursorAccent: '#001a00',
    },
    amber: {
      background: '#1a0e00',
      foreground: '#FFAA00',
      cursor: '#FFCC44',
      cursorAccent: '#1a0e00',
    },
  };

  const crtGlowColors: Record<string, string> = {
    cyan: '#55FFFF',
    green: '#00FF00',
    amber: '#FFCC44',
  };

  function setCrt(variant: typeof crtMode) {
    crtMode = variant;
    crtMenuOpen = false;
    if (term) {
      term.options.theme = { ...term.options.theme, ...crtThemes[variant] };
    }
  }

  // Terminal initialization
  onMount(() => {
    term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Courier New', monospace",
      theme: {
        background: '#0a0a0a',
        foreground: '#e0e0e0',
        cursor: '#e0e0e0',
        cursorAccent: '#0a0a0a',
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

    // Terminal input -> Socket.IO
    term.onData((data) => {
      if ($terminalStatus?.connected) {
        socket.emit('terminal:write', data);
      }
    });

    // Socket.IO -> Terminal
    const handleData = (data: number[]) => {
      term?.write(new Uint8Array(data));
    };
    socket.on('terminal:data', handleData);

    // Resize handler
    const resizeObserver = new ResizeObserver(() => {
      fitAddon?.fit();
    });
    resizeObserver.observe(containerEl);

    // Load ports
    loadPorts();

    // Apply preferred settings from terminal status
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
      term?.dispose();
      term = null;
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

  function handleCrtMenuBlur() {
    setTimeout(() => { crtMenuOpen = false; }, 150);
  }
</script>

<div
  class="flex flex-col gap-0 h-full"
  class:fixed={isFullscreen}
  class:inset-0={isFullscreen}
  class:z-50={isFullscreen}
  class:bg-panel-sunken={isFullscreen}
>
  <!-- Terminal Header -->
  <div class="flex items-center justify-between bg-panel border border-border rounded-t-lg px-4 py-2">
    <div class="flex items-center gap-3">
      <Monitor size={16} class="text-amber" />
      <span class="text-sm font-retro text-amber tracking-wider">Serial Terminal (VT102)</span>
    </div>

    <div class="flex items-center gap-2">
      <StatusLed
        color={isConnected ? 'green' : 'off'}
        label={isConnected ? ($terminalStatus?.device ?? 'Connected') : 'Disconnected'}
      />

      <!-- CRT mode -->
      <div class="relative">
        <button
          class="p-1.5 rounded text-text-dim hover:text-text transition-colors {crtMode !== 'off' ? 'text-amber' : ''}"
          onclick={() => crtMenuOpen = !crtMenuOpen}
          onblur={handleCrtMenuBlur}
          title="CRT Mode"
        >
          <Tv size={16} />
        </button>
        {#if crtMenuOpen}
          <div class="absolute right-0 top-full mt-1 bg-panel border border-border rounded-lg shadow-lg z-10 py-1 min-w-[160px]">
            {#each [
              { id: 'off', label: 'Modern', color: '' },
              { id: 'cyan', label: 'CGA Cyan', color: 'bg-cyan' },
              { id: 'green', label: 'Green Phosphor', color: 'bg-green' },
              { id: 'amber', label: 'Amber Phosphor', color: 'bg-amber' },
            ] as variant}
              <button
                class="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-surface-hover transition-colors
                  {crtMode === variant.id ? 'text-amber' : 'text-text-dim'}"
                onclick={() => setCrt(variant.id as typeof crtMode)}
              >
                <span class="inline-block w-2.5 h-2.5 rounded-full {variant.color || 'bg-border'}"></span>
                {variant.label}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <button
        class="p-1.5 rounded text-text-dim hover:text-text transition-colors"
        onclick={() => controlsVisible = !controlsVisible}
        title="Toggle Controls"
      >
        <Settings2 size={16} />
      </button>

      <button
        class="p-1.5 rounded text-text-dim hover:text-text transition-colors"
        onclick={toggleFullscreen}
        title="Fullscreen"
      >
        {#if isFullscreen}
          <Minimize2 size={16} />
        {:else}
          <Maximize2 size={16} />
        {/if}
      </button>
    </div>
  </div>

  <!-- Controls bar -->
  {#if controlsVisible}
    <div class="flex flex-wrap items-center gap-2 bg-panel border-x border-border px-4 py-2 text-xs">
      <label class="flex items-center gap-1.5">
        <span class="text-text-dim">Port:</span>
        <select
          class="bg-panel-sunken border border-border rounded px-2 py-1 text-xs text-text focus:border-amber focus:outline-none"
          bind:value={selectedPort}
        >
          <option value="">Select port...</option>
          {#each ports as port}
            <option value={port.recommended}>{port.recommended}</option>
          {/each}
        </select>
      </label>

      <label class="flex items-center gap-1.5">
        <span class="text-text-dim">Baud:</span>
        <select class="bg-panel-sunken border border-border rounded px-2 py-1 text-xs text-text focus:border-amber focus:outline-none" bind:value={selectedBaud}>
          {#each ['300', '1200', '2400', '4800', '9600', '19200', '38400', '57600', '115200'] as baud}
            <option value={baud}>{baud}</option>
          {/each}
        </select>
      </label>

      <label class="flex items-center gap-1.5">
        <span class="text-text-dim">Data:</span>
        <select class="bg-panel-sunken border border-border rounded px-2 py-1 text-xs text-text focus:border-amber focus:outline-none" bind:value={selectedDataBits}>
          {#each ['5', '6', '7', '8'] as bits}
            <option value={bits}>{bits}</option>
          {/each}
        </select>
      </label>

      <label class="flex items-center gap-1.5">
        <span class="text-text-dim">Parity:</span>
        <select class="bg-panel-sunken border border-border rounded px-2 py-1 text-xs text-text focus:border-amber focus:outline-none" bind:value={selectedParity}>
          {#each ['none', 'even', 'odd', 'mark', 'space'] as p}
            <option value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
          {/each}
        </select>
      </label>

      <label class="flex items-center gap-1.5">
        <span class="text-text-dim">Flow:</span>
        <select class="bg-panel-sunken border border-border rounded px-2 py-1 text-xs text-text focus:border-amber focus:outline-none" bind:value={selectedFlow}>
          {#each ['none', 'hardware', 'software'] as f}
            <option value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
          {/each}
        </select>
      </label>

      <div class="flex items-center gap-1.5 ml-2">
        {#if isConnected}
          <button
            class="bg-red/20 text-red border border-red/30 px-3 py-1 rounded text-xs hover:bg-red/30 transition-colors"
            onclick={disconnect}
          >
            Disconnect
          </button>
        {:else}
          <button
            class="bg-green/20 text-green border border-green/30 px-3 py-1 rounded text-xs hover:bg-green/30 transition-colors"
            onclick={connect}
            disabled={!selectedPort}
          >
            Connect
          </button>
        {/if}
        <button
          class="border border-border text-text-dim px-3 py-1 rounded text-xs hover:text-text transition-colors"
          onclick={clearTerminal}
        >
          Clear
        </button>
        <button
          class="border border-border text-text-dim px-3 py-1 rounded text-xs hover:text-text transition-colors"
          onclick={loadPorts}
        >
          Refresh
        </button>
      </div>
    </div>
  {/if}

  <!-- Terminal container -->
  <div
    class="flex-1 bg-[#0a0a0a] border border-border rounded-b-lg overflow-hidden relative min-h-[300px]"
    class:rounded-t-lg={!controlsVisible}
    style={crtMode !== 'off' ? `--crt-glow-color: ${crtGlowColors[crtMode]}` : ''}
    class:crt-active={crtMode !== 'off'}
  >
    <div bind:this={containerEl} class="w-full h-full"></div>
  </div>
</div>

<style>
  .crt-active :global(.xterm-rows) {
    filter: drop-shadow(0 0 1px var(--crt-glow-color, #55FFFF));
  }

  .crt-active::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: repeating-linear-gradient(
      0deg,
      transparent,
      transparent 1px,
      rgba(0, 0, 0, 0.15) 1px,
      rgba(0, 0, 0, 0.15) 2px
    );
    z-index: 1;
  }

  .crt-active::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(ellipse at center, transparent 50%, rgba(0, 0, 0, 0.4) 100%);
    z-index: 2;
  }
</style>
