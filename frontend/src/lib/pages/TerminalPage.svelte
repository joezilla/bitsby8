<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebglAddon } from '@xterm/addon-webgl';
  import '@xterm/xterm/css/xterm.css';
  import { socket, terminalStatus } from '$lib/services/socket';
  import { api } from '$lib/services/api';
  import { showToast } from '$lib/stores/toast';
  import { terminalHealth } from '$lib/stores/terminalHealth';
  import { terminalInstanceSession } from '$lib/stores/terminalSession';
  import Icon from '$lib/components/shared/Icon.svelte';
  import Select from '$lib/components/shared/Select.svelte';
  import type { SerialPortInfo, InstanceStatus } from '$lib/types/api';

  // Terminal instance (imperative, not reactive)
  let containerEl: HTMLDivElement;
  let term: Terminal | null = null;
  let fitAddon: FitAddon | null = null;

  // Connection targets: hardware serial ports + running virtual instances.
  const INST_PREFIX = 'inst:';
  let ports = $state<SerialPortInfo[]>([]);
  let instances = $state<InstanceStatus[]>([]);
  // selectedPort is either a serial device path or `inst:<instanceId>`.
  let selectedPort = $state('');
  let selectedBaud = $state('9600');
  let selectedDataBits = $state('8');
  let selectedStopBits = $state('1');
  let selectedParity = $state('none');
  let selectedFlow = $state('none');
  let isFullscreen = $state(false);

  // When connected to a virtual instance's console we manage the socket
  // subscription locally; a serial connection is tracked by $terminalStatus.
  let instanceSession = $state<string | null>(null);
  let isConnected = $derived(instanceSession !== null || ($terminalStatus?.connected ?? false));
  let selectingVirtual = $derived(selectedPort.startsWith(INST_PREFIX));

  const parityChar = (p: string) => (p === 'even' ? 'E' : p === 'odd' ? 'O' : p === 'mark' ? 'M' : p === 'space' ? 'S' : 'N');
  let lineSummary = $derived(
    instanceSession
      ? 'virtual console'
      : `${selectedBaud} ${selectedDataBits}${parityChar(selectedParity)}${selectedStopBits}`,
  );

  // Key mapping settings (loaded from config, saved via PUT /api/config/terminal)
  let showSettings = $state(false);
  let keySettings = $state({
    backspaceMode: 'del' as 'del' | 'bs',
    localEcho: false,
    crMode: 'cr' as 'cr' | 'crlf',
  });
  let settingsSaving = $state(false);

  // CRT phosphor mode — off (plain) / amber / green.
  type CrtMode = 'off' | 'amber' | 'green';
  let crtMode = $state<CrtMode>('off');

  const crtThemes: Record<CrtMode, Record<string, string>> = {
    off: { background: '#0c0e12', foreground: '#c8d0dc', cursor: '#c8d0dc', cursorAccent: '#0c0e12' },
    amber: { background: '#160d02', foreground: '#ffb04a', cursor: '#ffd07a', cursorAccent: '#160d02' },
    green: { background: '#02160a', foreground: '#5ae08a', cursor: '#9eff9e', cursorAccent: '#02160a' },
  };
  const crtGlow: Record<CrtMode, string> = {
    off: 'transparent',
    amber: 'rgba(255,176,32,0.55)',
    green: 'rgba(94,224,138,0.55)',
  };

  function setCrt(variant: CrtMode) {
    crtMode = variant;
    if (!term) return;
    try {
      term.options.theme = { ...term.options.theme, ...crtThemes[variant] };
    } catch {
      // term may be mid-dispose; mode reapplies on next mount.
    }
  }

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
      },
      cols: 80,
      rows: 24,
      allowProposedApi: true,
    });

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerEl);
    fitAddon.fit();
    setCrt(crtMode); // reapply persisted mode

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

    // Keystrokes → the connected target (virtual instance console or serial).
    term.onData((data) => {
      let out = data;
      if (keySettings.backspaceMode === 'bs' && data === '\x7f') out = '\x08';
      if (keySettings.crMode === 'crlf' && data === '\r') out = '\r\n';
      if (instanceSession) {
        socket.emit('instance:console:write', { instanceId: instanceSession, data: out });
      } else if ($terminalStatus?.connected) {
        socket.emit('terminal:write', out);
      }
      if (keySettings.localEcho) term?.write(out);
    });

    // Serial RX and virtual-instance console RX both write to the same xterm.
    const handleSerial = (data: number[]) => term?.write(new Uint8Array(data));
    const handleInstance = ({ instanceId, data }: { instanceId: string; data: number[] }) => {
      if (instanceSession && instanceId === instanceSession) term?.write(new Uint8Array(data));
    };
    socket.on('terminal:data', handleSerial);
    socket.on('instance:console:data', handleInstance);

    const resizeObserver = new ResizeObserver(() => fitAddon?.fit());
    resizeObserver.observe(containerEl);

    loadPorts();
    loadInstances().then(restoreInstanceSession);
    api
      .getConfig()
      .then((config) => {
        if (config.terminalBackspaceMode) keySettings.backspaceMode = config.terminalBackspaceMode;
        if (config.terminalLocalEcho !== undefined) keySettings.localEcho = config.terminalLocalEcho;
        if (config.terminalCrMode) keySettings.crMode = config.terminalCrMode;
      })
      .catch(() => {
        /* silent — use defaults */
      });

    const unsub = terminalStatus.subscribe((status) => {
      if (status?.preferred?.port && !selectedPort) selectedPort = status.preferred.port;
      if (status?.preferred?.baud && selectedBaud === '9600') selectedBaud = String(status.preferred.baud);
    });

    return () => {
      if (instanceSession) socket.emit('instance:console:unsubscribe', { instanceId: instanceSession });
      socket.off('terminal:data', handleSerial);
      socket.off('instance:console:data', handleInstance);
      resizeObserver.disconnect();
      unsub();
      const t = term;
      term = null;
      t?.dispose();
    };
  });

  async function loadPorts() {
    try {
      ports = (await api.listTerminalPorts()).ports;
    } catch {
      /* silent */
    }
  }

  async function loadInstances() {
    try {
      instances = (await api.listInstances()).instances.filter((i) => i.status === 'running');
    } catch {
      /* silent — single-server / no instances */
    }
  }

  // Resume a virtual-instance console we were attached to before navigating
  // away. The emulator kept running and the server buffered its output, so
  // re-subscribing replays the scrollback — no "starting from scratch".
  function restoreInstanceSession() {
    const savedId = get(terminalInstanceSession);
    if (!savedId) return;
    if (instances.some((i) => i.id === savedId)) {
      instanceSession = savedId;
      selectedPort = INST_PREFIX + savedId;
      socket.emit('instance:console:subscribe', { instanceId: savedId });
      term?.focus();
    } else {
      // The instance was stopped/destroyed while we were away — drop the stale session.
      terminalInstanceSession.set(null);
    }
  }

  function refresh() {
    loadPorts();
    loadInstances();
  }

  async function connect() {
    if (!selectedPort) return;
    if (selectedPort.startsWith(INST_PREFIX)) {
      // Virtual instance: subscribe to its emulated serial console.
      const id = selectedPort.slice(INST_PREFIX.length);
      instanceSession = id;
      terminalInstanceSession.set(id); // persist so navigating away/back resumes it
      socket.emit('instance:console:subscribe', { instanceId: id });
      showToast('Connected to virtual instance', 'success');
      term?.focus();
      return;
    }
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
    } catch (e) {
      showToast((e as Error).message || 'Connection failed', 'error');
    }
  }

  async function disconnect() {
    if (instanceSession) {
      socket.emit('instance:console:unsubscribe', { instanceId: instanceSession });
      instanceSession = null;
      terminalInstanceSession.set(null); // explicit disconnect ends the persisted session
      showToast('Disconnected', 'info');
      return;
    }
    try {
      await api.closeTerminal();
      showToast('Terminal disconnected', 'info');
    } catch (e) {
      showToast((e as Error).message || 'Disconnect failed', 'error');
    }
  }

  function clearTerminal() {
    term?.clear();
  }

  async function saveSettings() {
    settingsSaving = true;
    try {
      await api.putTerminalConfig({
        terminalBackspaceMode: keySettings.backspaceMode,
        terminalLocalEcho: keySettings.localEcho,
        terminalCrMode: keySettings.crMode,
      });
      showSettings = false;
      showToast('Terminal settings saved', 'success');
    } catch (e) {
      showToast((e as Error).message || 'Save failed', 'error');
    } finally {
      settingsSaving = false;
    }
  }

  function toggleFullscreen() {
    isFullscreen = !isFullscreen;
    setTimeout(() => fitAddon?.fit(), 50);
  }
</script>

<div class="term-page" class:fullscreen={isFullscreen}>
  <!-- Streamlined single-line toolbar (nowrap) -->
  <div class="toolbar">
    <div class="title">Terminal</div>

    <!-- Compact status pill; the line summary lives in its tooltip + the body. -->
    <div class="status-pill" class:on={isConnected} title={lineSummary}>
      <span class="sdot"></span>
      <span class="slabel">{isConnected ? 'Connected' : 'Disconnected'}</span>
    </div>

    <div class="tright">
      <Select bind:value={selectedPort} class="port-select">
        <option value="">— Select port —</option>
        {#if ports.length}
          <optgroup label="Hardware ports">
            {#each ports as port}
              <option value={port.recommended}>{port.recommended}</option>
            {/each}
          </optgroup>
        {/if}
        {#if instances.length}
          <optgroup label="Virtual instances · serial console">
            {#each instances as inst}
              <option value={INST_PREFIX + inst.id}>{inst.profileRef} · {inst.id.slice(0, 8)}</option>
            {/each}
          </optgroup>
        {/if}
      </Select>

      {#if isConnected}
        <button class="connect-btn" onclick={disconnect}>
          <Icon name="link_off" size={18} />Disconnect
        </button>
      {:else}
        <button class="connect-btn accent" disabled={!selectedPort} onclick={connect}>
          <Icon name="link" size={18} />Connect
        </button>
      {/if}

      <span class="vdiv"></span>

      <!-- CRT phosphor segmented control -->
      <div class="crt-seg" title="CRT phosphor mode">
        <button class="crt-btn" class:active={crtMode === 'off'} aria-label="Plain" title="Plain" onclick={() => setCrt('off')}>
          <Icon name="monitor" size={18} />
        </button>
        <button class="crt-btn" class:active={crtMode === 'amber'} aria-label="Amber CRT" title="Amber CRT" onclick={() => setCrt('amber')}>
          <span class="crt-dot" style="background: var(--crt-amber); box-shadow: 0 0 7px var(--crt-amber);"></span>
        </button>
        <button class="crt-btn" class:active={crtMode === 'green'} aria-label="Green CRT" title="Green CRT" onclick={() => setCrt('green')}>
          <span class="crt-dot" style="background: var(--crt-green); box-shadow: 0 0 7px var(--crt-green);"></span>
        </button>
      </div>

      <button class="tbtn" title="Refresh ports" aria-label="Refresh ports" onclick={refresh}><Icon name="refresh" size={20} /></button>
      <button class="tbtn" title="Clear terminal" aria-label="Clear terminal" onclick={clearTerminal}><Icon name="ink_eraser" size={20} /></button>
      <button class="tbtn" title="Toggle fullscreen" aria-label="Toggle fullscreen" onclick={toggleFullscreen}><Icon name={isFullscreen ? 'fullscreen_exit' : 'fullscreen'} size={20} /></button>
      <button class="tbtn" title="Terminal settings" aria-label="Terminal settings" onclick={() => (showSettings = true)}><Icon name="settings" size={20} /></button>
    </div>
  </div>

  <!-- Terminal body -->
  <div
    class="term-body"
    class:crt-active={crtMode !== 'off'}
    style="
      background: {crtThemes[crtMode].background};
      box-shadow: {crtMode !== 'off' ? 'inset 0 0 80px rgba(0,0,0,0.55), inset 0 0 18px rgba(0,0,0,0.35)' : 'none'};
    "
  >
    <div bind:this={containerEl} class="xterm-host"></div>

    {#if crtMode !== 'off'}
      <div class="crt-scanlines" aria-hidden="true"></div>
      <div class="crt-vignette" aria-hidden="true"></div>
      <div class="crt-label" style="color: {crtThemes[crtMode].foreground}; text-shadow: 0 0 4px {crtGlow[crtMode]};">
        {crtMode === 'amber' ? 'AMBER P3' : 'P1 PHOSPHOR'} · 80×24
      </div>
    {/if}

    <!-- RX indicator -->
    <div class="rx">
      <span class="rx-led" class:on={isConnected}></span>
      <span class="rx-txt" style="color: {crtMode !== 'off' ? crtThemes[crtMode].foreground : 'var(--fg-3)'}; opacity: {crtMode !== 'off' ? 0.5 : 1};">RX</span>
    </div>

    <!-- Disconnected empty state -->
    {#if !isConnected}
      <div class="empty" aria-hidden="true">
        <span class="icon empty-glyph">cable</span>
        <div class="empty-title">Not connected</div>
        <div class="empty-sub">
          Choose a {instances.length ? 'port or virtual instance' : 'port'} and press
          <span class="hl">Connect</span> · line at <span class="hl">{lineSummary}</span>
        </div>
      </div>
    {/if}
  </div>
</div>

{#if showSettings}
  <div role="dialog" aria-modal="true" class="modal-root">
    <button type="button" aria-label="Close settings" class="modal-scrim" onclick={() => (showSettings = false)}></button>
    <div role="document" class="modal">
      <div class="modal-head">
        <span style="color: var(--accent); display: inline-flex;"><Icon name="settings" size={20} /></span>
        <div class="modal-head-txt">
          <div class="modal-title">Terminal settings</div>
          <div class="modal-sub">Line parameters and key mapping for this session.</div>
        </div>
        <button class="tbtn" title="Close" aria-label="Close settings" onclick={() => (showSettings = false)}><Icon name="close" size={20} /></button>
      </div>

      <div class="modal-section">
        <div class="section-label">CONNECTION</div>
        <div class="grid-2">
          <label class="field"><span>Baud rate</span>
            <Select bind:value={selectedBaud}>
              {#each ['300', '1200', '2400', '4800', '9600', '19200', '38400', '57600', '115200', '230400'] as b}<option value={b}>{b}</option>{/each}
            </Select>
          </label>
          <label class="field"><span>Flow control</span>
            <Select bind:value={selectedFlow}>
              {#each ['none', 'hardware', 'software'] as f}<option value={f}>{f}</option>{/each}
            </Select>
          </label>
        </div>
        <div class="grid-3">
          <label class="field"><span>Data bits</span>
            <Select bind:value={selectedDataBits}>
              {#each ['5', '6', '7', '8'] as b}<option value={b}>{b}</option>{/each}
            </Select>
          </label>
          <label class="field"><span>Parity</span>
            <Select bind:value={selectedParity}>
              {#each ['none', 'even', 'odd', 'mark', 'space'] as p}<option value={p}>{p}</option>{/each}
            </Select>
          </label>
          <label class="field"><span>Stop bits</span>
            <Select bind:value={selectedStopBits}>
              {#each ['1', '2'] as b}<option value={b}>{b}</option>{/each}
            </Select>
          </label>
        </div>
        <div class="frame-note">Frame · <span>{selectedBaud} {selectedDataBits}{parityChar(selectedParity)}{selectedStopBits} · {selectedFlow} flow</span></div>
        {#if selectingVirtual}
          <div class="frame-note virtual">Line parameters apply to hardware serial ports; a virtual instance uses its emulated console.</div>
        {/if}
      </div>

      <div class="modal-section">
        <div class="section-label">KEY MAPPING</div>
        <div class="grid-2">
          <label class="field"><span>Backspace key sends</span>
            <Select bind:value={keySettings.backspaceMode}>
              <option value="del">DEL (0x7F) — xterm default</option>
              <option value="bs">BS (0x08) — CP/M compatible</option>
            </Select>
          </label>
          <label class="field"><span>Enter key sends</span>
            <Select bind:value={keySettings.crMode}>
              <option value="cr">CR (0x0D) — standard</option>
              <option value="crlf">CR+LF (0x0D 0x0A)</option>
            </Select>
          </label>
        </div>
        <label class="echo">
          <input type="checkbox" bind:checked={keySettings.localEcho} />
          <span>Local echo <span class="muted">— only if the remote does not echo</span></span>
        </label>
      </div>

      <div class="modal-foot">
        <button class="btn-ghost" onclick={() => (showSettings = false)}>Cancel</button>
        <button class="btn-accent" disabled={settingsSaving} onclick={saveSettings}>
          <Icon name="check" size={18} />{settingsSaving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .term-page {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .term-page.fullscreen {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: var(--bg);
  }

  /* Streamlined single-line toolbar */
  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 20px;
    background: var(--surface);
    border-bottom: 1px solid var(--border-1);
    flex-wrap: nowrap;
  }
  .title {
    font-size: 19px;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1;
    flex: none;
    color: var(--fg-1);
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    padding: 6px 12px;
    border-radius: 999px;
    flex: none;
    background: color-mix(in oklab, var(--error) 12%, transparent);
    border: 1px solid color-mix(in oklab, var(--error) 24%, transparent);
  }
  .status-pill.on {
    background: color-mix(in oklab, var(--success) 12%, transparent);
    border-color: color-mix(in oklab, var(--success) 26%, transparent);
  }
  .sdot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--error);
  }
  .status-pill.on .sdot {
    background: var(--success);
  }
  .slabel {
    font-family: var(--font-data);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--error);
  }
  .status-pill.on .slabel {
    color: var(--success);
  }

  .tright {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex-wrap: nowrap;
    justify-content: flex-end;
  }

  :global(.port-select) {
    flex: 1;
    min-width: 110px;
    max-width: 230px;
  }

  .connect-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    padding: 0 16px;
    border-radius: 9px;
    background: transparent;
    border: 1px solid var(--border-2);
    color: var(--fg-2);
    font-size: 13.5px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .connect-btn:hover {
    background: color-mix(in oklab, var(--fg-1) 6%, transparent);
  }
  .connect-btn.accent {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--fg-on-accent);
  }
  .connect-btn.accent:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .connect-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .vdiv {
    width: 1px;
    height: 22px;
    background: var(--border-2);
  }

  .crt-seg {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border-radius: 10px;
    background: var(--surface-sunken, var(--surface-variant));
    border: 1px solid var(--border-1);
  }
  .crt-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 30px;
    border-radius: 7px;
    border: none;
    background: transparent;
    color: var(--fg-3);
    cursor: pointer;
  }
  .crt-btn:hover {
    color: var(--fg-1);
  }
  .crt-btn.active {
    background: color-mix(in oklab, var(--fg-1) 12%, transparent);
    color: var(--fg-1);
  }
  .crt-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
  }

  .tbtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    border-radius: 9px;
    background: transparent;
    border: 1px solid var(--border-1);
    color: var(--fg-3);
    cursor: pointer;
    flex: none;
  }
  .tbtn:hover {
    background: color-mix(in oklab, var(--fg-1) 6%, transparent);
    color: var(--fg-1);
  }

  /* Terminal body */
  .term-body {
    flex: 1;
    min-height: 300px;
    position: relative;
    overflow: hidden;
  }
  .xterm-host {
    width: 100%;
    height: 100%;
    position: relative;
    z-index: 1;
    padding: 8px;
    box-sizing: border-box;
  }
  .crt-active :global(.xterm-rows) {
    filter: drop-shadow(0 0 1px currentColor);
  }
  .crt-scanlines {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 2;
    background: repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(0, 0, 0, 0.18) 1px, rgba(0, 0, 0, 0.18) 2px);
  }
  .crt-vignette {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 3;
    background: radial-gradient(ellipse 70% 60% at center, transparent 55%, rgba(0, 0, 0, 0.5) 100%);
  }
  .crt-label {
    position: absolute;
    left: 14px;
    bottom: 10px;
    z-index: 4;
    font-family: var(--font-data);
    font-size: 10px;
    letter-spacing: 0.22em;
    opacity: 0.5;
  }
  .rx {
    position: absolute;
    right: 14px;
    bottom: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    z-index: 4;
  }
  .rx-led {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--neutral-40, #444);
  }
  .rx-led.on {
    background: var(--success);
    box-shadow: 0 0 8px var(--success);
  }
  .rx-txt {
    font-family: var(--font-data);
    font-size: 10px;
    letter-spacing: 0.16em;
  }

  .empty {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--fg-4);
    pointer-events: none;
  }
  .empty-glyph {
    font-size: 44px;
    color: var(--fg-4);
    opacity: 0.6;
  }
  .empty-title {
    font-size: 14px;
    color: var(--fg-3);
  }
  .empty-sub {
    font-family: var(--font-data);
    font-size: 12px;
    letter-spacing: 0.02em;
    color: var(--fg-4);
  }
  .empty-sub .hl {
    color: var(--fg-2);
  }

  /* Settings modal */
  .modal-root {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .modal-scrim {
    position: absolute;
    inset: 0;
    background: rgba(6, 8, 11, 0.72);
    backdrop-filter: blur(4px);
    border: none;
    cursor: default;
  }
  .modal {
    position: relative;
    width: 100%;
    max-width: 560px;
    max-height: 90vh;
    overflow: auto;
    background: var(--surface);
    border: 1px solid var(--border-1);
    border-radius: 18px;
    box-shadow: 0 24px 64px -16px rgba(0, 0, 0, 0.8);
  }
  .modal-head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 22px 24px 0;
  }
  .modal-head-txt {
    flex: 1;
    min-width: 0;
  }
  .modal-title {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--fg-1);
  }
  .modal-sub {
    font-size: 13px;
    color: var(--fg-3);
    margin-top: 2px;
  }
  .modal-section {
    padding: 20px 24px 4px;
  }
  .section-label {
    font-family: var(--font-data);
    font-size: 10px;
    letter-spacing: 0.16em;
    color: var(--fg-4);
    margin-bottom: 12px;
  }
  .grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px 16px;
  }
  .grid-3 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 14px 16px;
    margin-top: 14px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .field > span {
    font-size: 12.5px;
    color: var(--fg-2);
  }
  .frame-note {
    margin-top: 12px;
    padding: 8px 12px;
    border-radius: 9px;
    background: color-mix(in oklab, var(--fg-1) 3%, transparent);
    border: 1px solid var(--border-1);
    font-family: var(--font-data);
    font-size: 12px;
    color: var(--fg-3);
  }
  .frame-note > span {
    color: var(--fg-2);
  }
  .frame-note.virtual {
    color: var(--fg-4);
  }
  .echo {
    display: flex;
    align-items: center;
    gap: 11px;
    margin-top: 16px;
    cursor: pointer;
    font-size: 14px;
    color: var(--fg-1);
  }
  .echo .muted {
    color: var(--fg-4);
  }
  .modal-foot {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    padding: 22px 24px;
    margin-top: 8px;
  }
  .btn-ghost {
    height: 42px;
    padding: 0 20px;
    border-radius: 10px;
    background: transparent;
    border: 1px solid var(--border-2);
    color: var(--fg-2);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .btn-ghost:hover {
    background: color-mix(in oklab, var(--fg-1) 6%, transparent);
  }
  .btn-accent {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 42px;
    padding: 0 22px;
    border-radius: 10px;
    background: var(--accent);
    border: 1px solid var(--accent);
    color: var(--fg-on-accent);
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
  }
  .btn-accent:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .btn-accent:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
