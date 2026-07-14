<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebglAddon } from '@xterm/addon-webgl';
  import '@xterm/xterm/css/xterm.css';
  import { socket, terminalStatus, replayProgress } from '$lib/services/socket';
  import { api } from '$lib/services/api';
  import { showToast } from '$lib/stores/toast';
  import { terminalHealth } from '$lib/stores/terminalHealth';
  import { terminalInstanceSession } from '$lib/stores/terminalSession';
  import Icon from '$lib/components/shared/Icon.svelte';
  import Select from '$lib/components/shared/Select.svelte';
  import Input from '$lib/components/shared/Input.svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import Modal from '$lib/components/shared/Modal.svelte';
  import type { SerialPortInfo, InstanceStatus, ScriptInfo } from '$lib/types/api';

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

  // Connection picker (anchored popover — target choice + connect in one gesture).
  let connMenuOpen = $state(false);
  const hasTargets = $derived(ports.length > 0 || instances.length > 0);
  const connectedLabel = $derived.by(() => {
    if (instanceSession) {
      const inst = instances.find((i) => i.id === instanceSession);
      return inst ? inst.profileRef : 'virtual console';
    }
    return selectedPort || 'serial';
  });

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

  // ── Scripts menu (notebook): record the outgoing keystroke stream to a new
  // script, or replay a saved script into the current connection. Kept behind a
  // single toolbar icon so the header stays slim. ─────────────────────────────
  let scriptsMenuOpen = $state(false);
  let scripts = $state<ScriptInfo[]>([]);
  let replayMode = $state<'raw' | 'xmodem'>('raw');
  // Recording captures what you *send* (replayable input), not device output.
  let recording = $state(false);
  let recordBuf = ''; // plain string — avoid per-keystroke reactivity churn
  let recordBytes = $state(0);
  let showSaveScript = $state(false);
  let saveName = $state('');
  // Frontend-driven replay into a virtual-instance console (the backend replay
  // engine only reaches the hardware serial port).
  let feReplay = $state<{ sent: number; total: number } | null>(null);
  let feCancel = false;
  const backendReplay = $derived($replayProgress);
  const replaying = $derived(feReplay !== null || backendReplay?.state === 'running');

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
      if (recording) {
        recordBuf += out;
        recordBytes = recordBuf.length;
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

  // Open the connection picker and refresh its target lists so they're current.
  function toggleConnMenu() {
    connMenuOpen = !connMenuOpen;
    if (connMenuOpen) refresh();
  }

  // Pick = connect: choosing a target connects to it (switching disconnects first).
  async function pickTarget(target: string) {
    connMenuOpen = false;
    if (isConnected) await disconnect();
    selectedPort = target;
    await connect();
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

  // ── Scripts: record + replay ────────────────────────────────────────────────
  async function toggleScriptsMenu() {
    scriptsMenuOpen = !scriptsMenuOpen;
    if (scriptsMenuOpen) {
      try {
        scripts = (await api.listScripts()).scripts;
      } catch {
        /* leave the previous list */
      }
    }
  }

  function startRecording() {
    recordBuf = '';
    recordBytes = 0;
    recording = true;
    scriptsMenuOpen = false;
    showToast('Recording keystrokes — everything you send is captured', 'info');
  }

  function stopRecording() {
    recording = false;
    scriptsMenuOpen = false;
    if (recordBuf.length === 0) {
      showToast('Nothing was recorded', 'warning');
      return;
    }
    saveName = '';
    showSaveScript = true;
  }

  async function saveRecordedScript() {
    const name = saveName.trim();
    if (!name) {
      showToast('Give the script a name', 'warning');
      return;
    }
    try {
      await api.createScript(name, recordBuf);
      showToast(`Saved ${name} (${recordBuf.length} bytes)`, 'success');
      showSaveScript = false;
    } catch (e) {
      showToast((e as Error).message || 'Save failed', 'error');
    }
  }

  async function replay(name: string) {
    scriptsMenuOpen = false;
    // Backend replay engine only reaches the hardware serial port; drive a
    // virtual-instance console from the client instead.
    if (instanceSession) {
      await replayIntoInstance(name);
      return;
    }
    try {
      await api.startReplay(name, replayMode);
      showToast(`Replaying ${name} (${replayMode})`, 'success');
    } catch (e) {
      showToast((e as Error).message || 'Replay failed', 'error');
    }
  }

  async function replayIntoInstance(name: string) {
    try {
      const s = await api.getScript(name);
      const content: string = (s as { content?: string }).content ?? '';
      if (!content) {
        showToast('Script is empty or binary — raw replay only', 'warning');
        return;
      }
      feCancel = false;
      feReplay = { sent: 0, total: content.length };
      const CHUNK = 48;
      for (let i = 0; i < content.length; i += CHUNK) {
        if (feCancel || !instanceSession) break;
        socket.emit('instance:console:write', {
          instanceId: instanceSession,
          data: content.slice(i, i + CHUNK),
        });
        feReplay = { sent: Math.min(i + CHUNK, content.length), total: content.length };
        await new Promise((r) => setTimeout(r, 30)); // paced like typing
      }
      const cancelled = feCancel;
      feReplay = null;
      showToast(cancelled ? 'Replay cancelled' : `Replayed ${name}`, cancelled ? 'info' : 'success');
    } catch (e) {
      feReplay = null;
      showToast((e as Error).message || 'Replay failed', 'error');
    }
  }

  async function cancelReplay() {
    feCancel = true;
    if (backendReplay?.state === 'running') {
      try {
        await api.cancelReplay();
      } catch {
        /* ignore */
      }
    }
  }

  function onDocClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (scriptsMenuOpen && !t.closest('[data-scripts-menu]')) scriptsMenuOpen = false;
    if (connMenuOpen && !t.closest('[data-conn-menu]')) connMenuOpen = false;
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

<svelte:window onclick={onDocClick} />

<div class="term-page" class:fullscreen={isFullscreen}>
  <!-- Streamlined single-line toolbar (nowrap) -->
  <div class="toolbar">
    <div class="title">Terminal</div>

    <!-- Connection: target picker + connect/disconnect, in one control -->
    <div class="conn" data-conn-menu>
      {#if isConnected}
        <button class="conn-pill on" onclick={toggleConnMenu} title="Switch target">
          <span class="sdot on"></span>
          <span class="conn-name fdc-mono">{connectedLabel}</span>
          <span class="conn-sub">{lineSummary}</span>
        </button>
        <button class="conn-x" title="Disconnect" aria-label="Disconnect" onclick={disconnect}>
          <Icon name="link_off" size={16} />
        </button>
      {:else}
        <button class="conn-pill accent" onclick={toggleConnMenu}>
          <Icon name="bolt" size={16} /><span class="conn-name">Connect…</span>
          <Icon name="expand_more" size={16} />
        </button>
      {/if}

      {#if connMenuOpen}
        <div class="conn-pop" role="menu">
          {#if ports.length}
            <div class="pop-sec">
              <span class="pop-lab">Serial ports</span>
              {#each ports as port}
                <button class="pop-row" class:cur={!instanceSession && selectedPort === port.recommended} onclick={() => pickTarget(port.recommended)}>
                  <Icon name="cable" size={16} />
                  <span class="pop-name fdc-mono">{port.recommended}</span>
                  <span class="pop-meta fdc-mono">{selectedBaud} {selectedDataBits}{parityChar(selectedParity)}{selectedStopBits}</span>
                </button>
              {/each}
            </div>
          {/if}
          {#if instances.length}
            <div class="pop-sec">
              <span class="pop-lab">Virtual machines</span>
              {#each instances as inst}
                <button class="pop-row" class:cur={instanceSession === inst.id} onclick={() => pickTarget(INST_PREFIX + inst.id)}>
                  <Icon name="dns" size={16} />
                  <span class="pop-name fdc-mono">{inst.profileRef}</span>
                  <span class="pop-meta">console</span>
                </button>
              {/each}
            </div>
          {/if}
          {#if !hasTargets}
            <div class="pop-empty">No serial ports or running machines. Launch a machine, or connect a device — then Refresh.</div>
          {/if}
          <div class="pop-div"></div>
          <button class="pop-row" onclick={() => { refresh(); }}>
            <Icon name="refresh" size={16} /><span>Refresh targets</span>
          </button>
        </div>
      {/if}
    </div>

    <div class="tright">
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

      <!-- Scripts: record / replay — tucked behind one notebook icon -->
      <div class="tb-menu" data-scripts-menu>
        <button class="tbtn" class:active={scriptsMenuOpen} class:rec={recording} title="Scripts — record &amp; replay" aria-label="Scripts" onclick={toggleScriptsMenu}>
          <Icon name="menu_book" size={20} />
          {#if recording}<span class="rec-dot" aria-hidden="true"></span>{/if}
        </button>
        {#if scriptsMenuOpen}
          <div class="tb-pop" role="menu">
            <div class="pop-sec">
              <span class="pop-lab">Record</span>
              {#if recording}
                <button class="pop-row" onclick={stopRecording}>
                  <Icon name="stop_circle" size={16} /><span>Stop &amp; save</span>
                  <span class="pop-meta fdc-mono">{recordBytes} B</span>
                </button>
              {:else}
                <button class="pop-row" disabled={!isConnected} onclick={startRecording}>
                  <Icon name="fiber_manual_record" size={16} /><span>Record to new script</span>
                </button>
              {/if}
            </div>
            <div class="pop-div"></div>
            <div class="pop-sec">
              <div class="pop-head">
                <span class="pop-lab">Replay</span>
                {#if !instanceSession}
                  <span class="pop-seg">
                    <button class:on={replayMode === 'raw'} onclick={() => (replayMode = 'raw')}>raw</button>
                    <button class:on={replayMode === 'xmodem'} onclick={() => (replayMode = 'xmodem')}>xmodem</button>
                  </span>
                {/if}
              </div>
              {#if replaying}
                <div class="pop-progress">
                  <span class="fdc-mono">{feReplay ? `${feReplay.sent}/${feReplay.total} B` : `${backendReplay?.bytesSent ?? 0} B sent`}</span>
                  <button class="pop-cancel" onclick={cancelReplay}>Cancel</button>
                </div>
              {:else if !isConnected}
                <div class="pop-empty">Connect first to replay.</div>
              {:else if scripts.length === 0}
                <div class="pop-empty">No scripts yet — record one, or add on the Scripts page.</div>
              {:else}
                <div class="pop-list">
                  {#each scripts as s (s.name)}
                    <button class="pop-row" onclick={() => replay(s.name)}>
                      <Icon name="play_arrow" size={16} /><span class="pop-name fdc-mono">{s.name}</span>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {/if}
      </div>

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

{#if showSaveScript}
  <Modal title="Save recorded script" icon="menu_book" size="sm" onClose={() => (showSaveScript = false)}>
    <p style="margin: 0; font: var(--text-body-sm); color: var(--fg-3);">
      Captured <strong>{recordBytes}</strong> bytes of input. Name it to save as a replayable script.
    </p>
    <Input placeholder="e.g. cpm-boot-session" bind:value={saveName} />
    {#snippet footer()}
      <Button variant="ghost" onclick={() => (showSaveScript = false)}>Cancel</Button>
      <Button variant="filled" icon="save" onclick={saveRecordedScript}>Save script</Button>
    {/snippet}
  </Modal>
{/if}

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

  /* Connection control — target picker + connect/disconnect in one pill. */
  .conn { position: relative; display: inline-flex; align-items: center; gap: 4px; flex: none; }
  .sdot { width: 7px; height: 7px; border-radius: 50%; background: var(--fg-4); flex: none; }
  .sdot.on { background: var(--success); box-shadow: 0 0 6px var(--success); }
  .conn-pill {
    display: inline-flex; align-items: center; gap: 8px; height: 38px; padding: 0 14px;
    border-radius: 9px; background: transparent; border: 1px solid var(--border-2);
    color: var(--fg-2); font-size: 13.5px; font-weight: 600; cursor: pointer; white-space: nowrap;
    max-width: 300px;
  }
  .conn-pill:hover { background: color-mix(in oklab, var(--fg-1) 6%, transparent); }
  .conn-pill.accent { background: var(--accent); border-color: var(--accent); color: var(--fg-on-accent); }
  .conn-pill.accent:hover { background: var(--accent-hover); }
  .conn-pill.on { color: var(--fg-1); }
  .conn-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .conn-sub { font: var(--text-overline); color: var(--fg-4); text-transform: none; letter-spacing: 0; flex: none; }
  .conn-x {
    display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 38px;
    border-radius: 9px; background: transparent; border: 1px solid var(--border-2); color: var(--fg-3); cursor: pointer;
  }
  .conn-x:hover { color: var(--error); border-color: color-mix(in oklab, var(--error) 40%, var(--border-2)); }
  .conn-pop {
    position: absolute; top: calc(100% + 6px); left: 0; z-index: 40; width: 300px;
    background: var(--surface-raised); border: 1px solid var(--border-2);
    border-radius: var(--radius-md); box-shadow: var(--elev-4); padding: 8px;
    display: flex; flex-direction: column; gap: 6px;
  }
  .conn-pop .pop-row.cur { color: var(--accent); }
  .conn-pop .pop-row.cur .pop-name { color: var(--accent); }

  .tright {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex-wrap: nowrap;
    justify-content: flex-end;
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
  .tbtn.active { color: var(--accent); border-color: color-mix(in oklab, var(--accent) 40%, var(--border-1)); }
  .tbtn.rec { color: var(--error); border-color: color-mix(in oklab, var(--error) 45%, var(--border-1)); }

  /* Scripts popover */
  .tb-menu { position: relative; display: inline-flex; }
  .rec-dot {
    position: absolute; top: 6px; right: 6px; width: 7px; height: 7px; border-radius: 50%;
    background: var(--error); box-shadow: 0 0 5px var(--error); animation: rec-pulse 1.4s ease-in-out infinite;
  }
  @keyframes rec-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
  @media (prefers-reduced-motion: reduce) { .rec-dot { animation: none; } }
  .tb-pop {
    position: absolute; top: calc(100% + 6px); right: 0; z-index: 40; width: 264px;
    background: var(--surface-raised); border: 1px solid var(--border-2);
    border-radius: var(--radius-md); box-shadow: var(--elev-4); padding: 8px;
    display: flex; flex-direction: column; gap: 6px;
  }
  .pop-sec { display: flex; flex-direction: column; gap: 4px; }
  .pop-head { display: flex; align-items: center; justify-content: space-between; }
  .pop-lab { font: var(--text-overline); text-transform: uppercase; letter-spacing: 0.08em; color: var(--fg-4); padding: 2px 4px; }
  .pop-div { height: 1px; background: var(--border-1); margin: 2px 0; }
  .pop-row {
    display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
    padding: 8px; border-radius: var(--radius-sm); background: transparent; border: none;
    color: var(--fg-2); cursor: pointer; font: var(--text-body-sm);
  }
  .pop-row:hover:not(:disabled) { background: color-mix(in oklab, var(--fg-1) 6%, transparent); color: var(--fg-1); }
  .pop-row:disabled { opacity: 0.4; cursor: default; }
  .pop-meta { margin-left: auto; font-size: 11px; color: var(--fg-4); }
  .pop-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
  .pop-list { display: flex; flex-direction: column; max-height: 220px; overflow-y: auto; }
  .pop-empty { padding: 8px; font: var(--text-body-sm); color: var(--fg-3); }
  .pop-progress { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; font-size: 12px; color: var(--fg-2); }
  .pop-cancel { background: none; border: 1px solid var(--border-2); border-radius: var(--radius-sm); color: var(--fg-2); cursor: pointer; padding: 3px 10px; font-size: 12px; }
  .pop-cancel:hover { color: var(--error); border-color: color-mix(in oklab, var(--error) 40%, var(--border-2)); }
  .pop-seg { display: inline-flex; border: 1px solid var(--border-2); border-radius: var(--radius-sm); overflow: hidden; }
  .pop-seg button { background: transparent; border: none; color: var(--fg-3); cursor: pointer; padding: 2px 8px; font: var(--text-overline); text-transform: uppercase; }
  .pop-seg button.on { background: var(--accent-bg); color: var(--accent); }

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
