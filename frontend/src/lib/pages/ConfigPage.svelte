<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/services/api';
  import { serverStatus, terminalStatus } from '$lib/services/socket';
  import Button from '$lib/components/shared/Button.svelte';
  import IconButton from '$lib/components/shared/IconButton.svelte';
  import Icon from '$lib/components/shared/Icon.svelte';
  import Input from '$lib/components/shared/Input.svelte';
  import Select from '$lib/components/shared/Select.svelte';
  import Chip from '$lib/components/shared/Chip.svelte';
  import Toggle from '$lib/components/shared/Toggle.svelte';
  import PageHeader from '$lib/components/shared/PageHeader.svelte';
  import RestartBanner from '$lib/components/shared/RestartBanner.svelte';
  import { showToast } from '$lib/stores/toast';
  import { setRestartPending } from '$lib/stores/configDirty';
  import type { SerialPortInfo, ConfigDoc, ConfigStatus } from '$lib/types/api';

  let config = $state<ConfigDoc | null>(null);
  let configStatus = $state<ConfigStatus | null>(null);
  let serialPorts = $state<SerialPortInfo[]>([]);
  let diskServingEnabled = $state(false);
  let diskServingInFlight = $state(false);
  // TCP-based disk serving (WebSocket FDC transport). On by default;
  // synced from config in resetAllForms(). Applied live — no restart.
  let wsTransportEnabled = $state(true);
  let wsTransportInFlight = $state(false);
  // Multi-client disk serving — DB-backed operator setting, applied live
  // (moved here from the Disks page settings modal).
  let multiClientServing = $state(false);
  let multiClientBusy = $state(false);
  let writeMaster = $state('serial');
  let writeMasterBusy = $state(false);
  let connectedClients = $derived($serverStatus?.multiClient?.clients ?? []);
  let loading = $state(true);
  let savingAll = $state(false);
  let sysInfoOpen = $state(false);
  // Daemon power controls (header) — systemd-managed only.
  let restarting = $state(false);
  let shuttingDown = $state(false);

  // Section-local editable copies. Refreshed from `config` after each save.
  //
  // Note: per-drive image paths (drive0..3) and the readonly[] array live
  // in the schema for backwards compat but are managed from the Disks
  // page, not here. Same story for dataDir (system-level) and
  // terminalOnly (redundant with the runtime disk-serving toggle) —
  // both are intentionally absent from the UI.
  let serialForm = $state({
    port: '',
    baud: 230400 as number,
  });
  let webForm = $state({
    web: true,
    webPort: 3000,
    webHost: 'localhost',
    // Empty string = leave existing apiKey unchanged. A new value sets
    // it (typed or Generated). "clear" is a distinct action wired below.
    apiKey: '' as string,
    // Same convention as apiKey: empty = leave existing adminPassword
    // as-is; typed = replace. Password reset flows through the dedicated
    // Change Password section, not this form.
    adminPassword: '' as string,
  });
  // MCP-over-HTTP is applied live (instant toggle), not through the save bar.
  let mcpForm = $state({
    enableMcpHttp: false,
  });
  let terminalForm = $state({
    terminalPort: '',
    terminalBaud: 9600,
    terminalAutoconnect: false,
  });
  // `verbose` is live-toggled and excluded from dirty tracking; only debug
  // + logFile flow through the save bar.
  let loggingForm = $state({
    verbose: false,
    debug: false,
    logFile: '' as string | null,
  });

  // Per-section snapshots taken at load time. Dirty derivations JSON-
  // compare against these instead of re-defaulting from `config` on
  // every render — avoids "form-has-explicit-default vs config-has-
  // undefined" false positives (that pattern kept every section
  // reading "unsaved" on cold load).
  let serialBaseline = $state('');
  let webBaseline = $state('');
  let terminalBaseline = $state('');
  let loggingBaseline = $state('');

  let serialConnected = $derived($serverStatus?.serial.connected ?? false);
  let termConnected = $derived($terminalStatus?.connected ?? false);

  $effect(() => {
    diskServingEnabled = $serverStatus?.diskServing.enabled ?? false;
  });

  const primaryBaudRates = [9600, 19200, 38400, 57600, 76800, 115200, 230400, 403200, 460800];
  const terminalBaudRates = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];

  onMount(async () => {
    await refresh();
    try {
      const { ports } = await api.listSerialPorts();
      serialPorts = ports;
    } catch {
      /* non-fatal */
    }
    try {
      const settings = await api.getSettings();
      multiClientServing = settings.multiClientServing;
      writeMaster = settings.writeMaster || 'serial';
    } catch {
      /* non-fatal */
    }
    loading = false;
  });

  /** Refetch config + status. `resetForms` re-seeds the editable copies
   *  and baselines — skip it after a live toggle so in-progress drafts in
   *  other sections survive. */
  async function loadConfig(resetForms: boolean) {
    try {
      config = await api.getConfig();
      configStatus = await api.getConfigStatus();
      if (resetForms) resetAllForms();
    } catch (err) {
      showToast(`Failed to load configuration: ${(err as Error).message}`, 'error');
    }
  }

  async function refresh() {
    await loadConfig(true);
  }

  function loggingComparable() {
    return { debug: loggingForm.debug, logFile: loggingForm.logFile ?? '' };
  }

  function resetAllForms() {
    if (!config) return;
    // A rotated/cleared key would leave a stale plaintext cached; drop it
    // and re-collapse the reveal so the next reveal/copy re-fetches.
    revealedKey = null;
    apiKeyRevealed = false;
    serialForm = {
      port: config.port ?? '',
      baud: config.baud ?? 230400,
    };
    webForm = {
      web: config.web ?? true,
      webPort: config.webPort ?? 3000,
      webHost: config.webHost ?? 'localhost',
      // Server never echoes apiKey / adminPassword — inputs stay empty
      // and the "currently set" hint drives the UX.
      apiKey: '',
      adminPassword: '',
    };
    mcpForm = {
      enableMcpHttp: config.enableMcpHttp ?? false,
    };
    // Absent = on: the WS/TCP transport defaults to enabled.
    wsTransportEnabled = config.enableWsTransport ?? true;
    terminalForm = {
      terminalPort: config.terminalPort ?? '',
      terminalBaud: config.terminalBaud ?? 9600,
      terminalAutoconnect: config.terminalAutoconnect ?? false,
    };
    loggingForm = {
      verbose: config.verbose ?? false,
      debug: config.debug ?? false,
      logFile: config.logFile ?? '',
    };

    // Snapshot each freshly-populated form so the dirty derivations
    // compare like-shape against like-shape. Set AFTER the form
    // assignments so the baseline matches what the UI is showing.
    // Snapshot via $state.snapshot so we compare plain-object vs
    // plain-object. JSON.stringify on a live $state proxy can serialise
    // differently from a plain object with the same fields, producing
    // a false-dirty flag on load.
    serialBaseline = JSON.stringify($state.snapshot(serialForm));
    webBaseline = JSON.stringify($state.snapshot(webForm));
    terminalBaseline = JSON.stringify($state.snapshot(terminalForm));
    loggingBaseline = JSON.stringify(loggingComparable());
  }

  // ---------- Dirty tracking (structural equality per section) ----------

  const serialDirty = $derived(!!config && JSON.stringify($state.snapshot(serialForm)) !== serialBaseline);
  const webDirty = $derived(!!config && JSON.stringify($state.snapshot(webForm)) !== webBaseline);
  const terminalDirty = $derived(!!config && JSON.stringify($state.snapshot(terminalForm)) !== terminalBaseline);
  const loggingDirty = $derived(!!config && JSON.stringify(loggingComparable()) !== loggingBaseline);

  const anyDirty = $derived(serialDirty || webDirty || terminalDirty || loggingDirty);
  const dirtyCount = $derived(
    [serialDirty, webDirty, terminalDirty, loggingDirty].filter(Boolean).length,
  );

  // ---------- Save (unified sticky bar) ----------

  function trimStrOrNull(v: string | null): string | null {
    const s = (v ?? '').trim();
    return s === '' ? null : s;
  }

  // Reconstruct the concurrency ETag from a PUT response's mtimeMs so a
  // multi-section save can thread a fresh token through each request
  // without a round-trip to /status between them.
  function etagFor(mtimeMs: number | null): string | undefined {
    if (!configStatus) return undefined;
    return `"epoch-${configStatus.startupEpoch}+mtime-${mtimeMs ?? 0}"`;
  }

  async function saveAll() {
    if (savingAll || !anyDirty) return;
    if (configStatus?.configReadonly) {
      showToast('Config is read-only — saves are refused.', 'error');
      return;
    }
    // Pre-flight confirmations for destructive credential changes so a
    // late "cancel" can't leave earlier sections half-saved.
    if (webDirty) {
      if (webForm.apiKey.trim() && !confirm(
        'Changing the API key will invalidate the previous key. Existing MCP clients need the new one. Save?',
      )) return;
      if (webForm.adminPassword.length > 0 && !confirm(
        'Setting a new admin password will sign out every other browser. Save?',
      )) return;
    }

    savingAll = true;
    let etag = configStatus?.etag;
    try {
      if (serialDirty) {
        const r = await api.putSerialConfig({ port: serialForm.port.trim(), baud: serialForm.baud }, etag);
        setRestartPending('serial', r.restartRequired);
        etag = etagFor(r.mtimeMs);
      }
      if (terminalDirty) {
        const r = await api.putTerminalConfig({
          terminalPort: terminalForm.terminalPort.trim(),
          terminalBaud: terminalForm.terminalBaud,
          terminalAutoconnect: terminalForm.terminalAutoconnect,
        }, etag);
        setRestartPending('terminal', r.restartRequired);
        etag = etagFor(r.mtimeMs);
      }
      if (webDirty) {
        const patch: Record<string, unknown> = {
          web: webForm.web,
          webPort: webForm.webPort,
          webHost: webForm.webHost.trim(),
        };
        if (webForm.apiKey.trim()) patch.apiKey = webForm.apiKey.trim();
        if (webForm.adminPassword.length > 0) patch.adminPassword = webForm.adminPassword;
        const r = await api.putWebConfig(patch as any, etag);
        setRestartPending('web', r.restartRequired);
        etag = etagFor(r.mtimeMs);
      }
      if (loggingDirty) {
        const r = await api.putLoggingConfig({
          verbose: loggingForm.verbose,
          debug: loggingForm.debug,
          logFile: trimStrOrNull(loggingForm.logFile),
        }, etag);
        setRestartPending('logging', r.restartRequired);
        etag = etagFor(r.mtimeMs);
      }
      await loadConfig(true);
      showToast('Configuration saved.', 'success');
    } catch (err) {
      showToast(`Save failed: ${(err as Error).message}`, 'error');
      // Resync status (fresh ETag) but keep the drafts so the operator
      // can retry without re-typing.
      await loadConfig(false);
    } finally {
      savingAll = false;
    }
  }

  function discardAll() {
    resetAllForms();
    showToast('All changes discarded.', 'info');
  }

  // ---------- API key (machine token) ----------

  // Reveal/copy state for the API key input. The eye-icon lets the
  // operator confirm the value they just pasted or generated; the
  // copy icon puts it on the clipboard. Because the key is stored
  // plaintext (unlike the bcrypt-hashed admin password), it can be
  // fetched back from the daemon at any time. `revealedKey` caches that
  // fetched value; it's invalidated on every refresh (see resetAllForms).
  let apiKeyRevealed = $state(false);
  let revealedKey = $state<string | null>(null);
  let revealLoading = $state(false);

  async function fetchStoredKey(): Promise<string | null> {
    if (revealedKey !== null) return revealedKey;
    try {
      revealLoading = true;
      revealedKey = (await api.getApiKey()).apiKey;
      return revealedKey;
    } catch (err) {
      showToast(`Couldn't load the key: ${(err as Error).message}`, 'error');
      return null;
    } finally {
      revealLoading = false;
    }
  }

  async function toggleApiKeyReveal() {
    const next = !apiKeyRevealed;
    if (next && !webForm.apiKey && configStatus?.apiKeySet) {
      await fetchStoredKey();
    }
    apiKeyRevealed = next;
  }

  async function copyApiKey() {
    let value = webForm.apiKey;
    if (!value && configStatus?.apiKeySet) {
      value = (await fetchStoredKey()) ?? '';
    }
    if (!value) {
      showToast('No key to copy — Generate one first.', 'info');
      return;
    }
    // navigator.clipboard is gated behind secure contexts (HTTPS or
    // localhost). On plain HTTP over the LAN, fall back to execCommand.
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      showToast('API key copied to clipboard.', 'success');
    } catch (err) {
      showToast(`Copy failed: ${(err as Error).message}`, 'error');
    }
  }

  function generateApiKey() {
    // crypto.randomUUID() is only defined in secure contexts; this app
    // runs on plain HTTP over the LAN. getRandomValues() is always
    // available — 32 random bytes hex-encoded = 256-bit opaque token.
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    webForm.apiKey = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    apiKeyRevealed = true;
  }

  async function clearApiKey() {
    if (!confirm('Clear the API key? MCP over HTTP will stop accepting connections.')) return;
    try {
      await api.putWebConfig({ apiKey: null } as any, configStatus?.etag);
      webForm.apiKey = '';
      await loadConfig(false);
      showToast('API key cleared.', 'success');
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    }
  }

  async function copyMcpSetup() {
    const host = typeof window !== 'undefined' ? window.location.host : 'HOST:PORT';
    const cmd =
      `claude mcp add --transport http fdcplus \\\n` +
      `  http://${host}/mcp \\\n` +
      `  --header "Authorization: Bearer <api-key>"`;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(cmd);
      } else {
        const ta = document.createElement('textarea');
        ta.value = cmd;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      showToast('Setup command copied.', 'success');
    } catch (err) {
      showToast(`Copy failed: ${(err as Error).message}`, 'error');
    }
  }

  // ---------- Admin password (UI login) ----------

  let showChangePassword = $state(false);
  let cpwOld = $state('');
  let cpwNew = $state('');
  let cpwSubmitting = $state(false);

  async function submitChangePassword() {
    if (!cpwOld || !cpwNew) {
      showToast('Both fields required.', 'error');
      return;
    }
    cpwSubmitting = true;
    try {
      await api.changePassword(cpwOld, cpwNew);
      showToast('Password changed. Other browsers signed out.', 'success');
      cpwOld = '';
      cpwNew = '';
      showChangePassword = false;
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      cpwSubmitting = false;
    }
  }

  async function clearAdminPassword() {
    if (!confirm('Clear the admin password? The dashboard UI will be open to anyone on the LAN.')) return;
    try {
      // Empty string maps to "clear" server-side (see routes/config.ts).
      await api.putWebConfig({ adminPassword: '' } as any, configStatus?.etag);
      webForm.adminPassword = '';
      await loadConfig(false);
      showToast('Admin password cleared.', 'success');
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    }
  }

  async function logOut() {
    if (!confirm('Sign out?')) return;
    try {
      await api.logout();
    } catch { /* ignore — reload anyway */ }
    window.location.reload();
  }

  // ---------- Live (instant-apply) toggles ----------

  async function toggleVerboseLive() {
    try {
      const next = !loggingForm.verbose;
      await api.updateConfig({ verbose: next });
      loggingForm.verbose = next;
      if (config) (config as any).verbose = next;
      showToast(`Verbose logging ${next ? 'enabled' : 'disabled'}`, 'info');
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    }
  }

  async function toggleMcp() {
    const next = !mcpForm.enableMcpHttp;
    if (next && !configStatus?.apiKeySet) {
      showToast('Set an API key before enabling MCP over HTTP.', 'error');
      return;
    }
    try {
      await api.putMcpConfig({ enableMcpHttp: next }, configStatus?.etag);
      mcpForm.enableMcpHttp = next;
      await loadConfig(false);
      showToast(next ? 'MCP over HTTP enabled' : 'MCP over HTTP disabled', 'success');
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    }
  }

  async function refreshPorts() {
    try {
      const { ports } = await api.listSerialPorts();
      serialPorts = ports;
      showToast('Serial ports refreshed', 'info');
    } catch (err) {
      showToast(`Failed to refresh ports: ${(err as Error).message}`, 'error');
    }
  }

  async function toggleWsTransport() {
    if (wsTransportInFlight) return;
    wsTransportInFlight = true;
    const next = !wsTransportEnabled;
    try {
      await api.putDiskServingConfig({ enableWsTransport: next }, configStatus?.etag);
      wsTransportEnabled = next;
      await loadConfig(false);
      showToast(`TCP-based disk serving ${next ? 'enabled' : 'disabled'}`, next ? 'success' : 'info');
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    } finally {
      wsTransportInFlight = false;
    }
  }

  async function toggleMultiClient() {
    const next = !multiClientServing;
    multiClientBusy = true;
    try {
      await api.putSettings({ multiClientServing: next });
      multiClientServing = next;
      showToast(`Multi-client serving ${next ? 'enabled' : 'disabled'}`, 'success');
    } catch (err) {
      // e.g. 409 when disabling with >1 client connected.
      showToast(`Failed to update setting: ${(err as Error).message}`, 'error');
    } finally {
      multiClientBusy = false;
    }
  }

  async function saveWriteMaster() {
    const value = writeMaster.trim() || 'serial';
    writeMasterBusy = true;
    try {
      await api.putSettings({ writeMaster: value });
      writeMaster = value;
      showToast(`Write-master set to "${value}"`, 'success');
    } catch (err) {
      showToast(`Failed to set write-master: ${(err as Error).message}`, 'error');
    } finally {
      writeMasterBusy = false;
    }
  }

  function formatClientTime(ms: number): string {
    const d = new Date(ms);
    return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString();
  }

  async function toggleDiskServing() {
    if (diskServingInFlight) return;
    diskServingInFlight = true;
    try {
      if (diskServingEnabled) {
        await api.disableDiskServing();
        showToast('Disk serving disabled', 'info');
      } else {
        await api.enableDiskServing();
        showToast('Disk serving enabled', 'success');
      }
    } catch (err) {
      showToast(`Failed: ${(err as Error).message}`, 'error');
    } finally {
      diskServingInFlight = false;
    }
  }

  const canPower = $derived(!!configStatus?.systemdManaged);

  async function doRestart() {
    if (!canPower || restarting || shuttingDown) return;
    if (!confirm('Restart the FDC+ daemon now? Active serial/WebSocket connections drop briefly while it relaunches.')) return;
    restarting = true;
    try {
      await api.restartDaemon();
      showToast('Daemon restarting… the page will reconnect shortly.', 'info');
      // systemd relaunches on the clean exit; give it a beat, then reload.
      setTimeout(() => window.location.reload(), 4000);
    } catch (err) {
      showToast(`Restart failed: ${(err as Error).message}`, 'error');
      restarting = false;
    }
  }

  async function doShutdown() {
    if (!canPower || restarting || shuttingDown) return;
    if (!confirm(
      'Stop the FDC+ daemon? It will NOT restart automatically — you must start it again from the host (sudo systemctl start bitsby8).',
    )) return;
    shuttingDown = true;
    try {
      await api.shutdownDaemon();
      showToast('Daemon stopping. Restart it from the host: sudo systemctl start bitsby8', 'info');
    } catch (err) {
      showToast(`Shutdown failed: ${(err as Error).message}`, 'error');
      shuttingDown = false;
    }
  }

  function formatUptime(secs: number | undefined): string {
    if (!secs && secs !== 0) return '—';
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d ? d + 'd ' : ''}${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  const overridePath = $derived(
    configStatus?.overrideConfigFilePath ?? configStatus?.configFilePath ?? '(no path configured)',
  );
</script>

{#snippet info(text: string)}
  <span class="cfg-info" title={text}><Icon name="info" size={12} /></span>
{/snippet}

{#snippet statusPill(variant: 'red' | 'green' | 'gray', label: string)}
  <span class="cfg-pill cfg-pill--{variant}"><span class="cfg-pill__dot"></span>{label}</span>
{/snippet}

{#snippet fieldLabel(text: string, tip?: string)}
  <span class="cfg-flabel">
    {text}
    {#if tip}{@render info(tip)}{/if}
  </span>
{/snippet}

{#snippet headerActions()}
  <Button
    variant="outline"
    icon="restart_alt"
    disabled={restarting || shuttingDown || !canPower}
    title={canPower ? 'Restart the daemon' : 'Not systemd-managed — restart from the host: sudo systemctl restart bitsby8'}
    onclick={doRestart}
  >
    {restarting ? 'Restarting…' : 'Restart'}
  </Button>
  <Button
    variant="outline"
    danger
    icon="power_settings_new"
    disabled={restarting || shuttingDown || !canPower}
    title={canPower ? 'Stop the daemon (does not auto-restart)' : 'Not systemd-managed — stop from the host: sudo systemctl stop bitsby8'}
    onclick={doShutdown}
  >
    {shuttingDown ? 'Stopping…' : 'Shutdown'}
  </Button>
{/snippet}

<PageHeader
  eyebrow="Section · System · Configuration"
  title="Configuration"
  subtitle="Everything the daemon reads from the config file — editable, validated, saved atomically."
  actions={headerActions}
/>

<div class="fdc-page-body">
  <div class="cfg-list" class:has-savebar={anyDirty}>
    <RestartBanner
      status={configStatus}
      onDiscardAll={discardAll}
      onRolledBack={refresh}
      onRestarted={refresh}
    />

    {#if configStatus?.configReadonly}
      <div class="cfg-notice">
        <Icon name="lock" size={18} />
        <span>
          Config is read-only (<code>--config-readonly</code>). Saves are refused; sections stay
          as edit-preview only.
        </span>
      </div>
    {/if}

    {#if loading}
      {#each Array(4) as _}
        <div class="cfg-card">
          <div class="cfg-skel" style="width: 200px; margin-bottom: 16px;"></div>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px;">
            <div class="cfg-skel" style="height: 44px;"></div>
            <div class="cfg-skel" style="height: 44px;"></div>
          </div>
        </div>
      {/each}
    {:else}

      <!-- ============ SERIAL PORTS ============ -->
      <section class="cfg-card">
        <div class="cfg-head">
          <Icon name="cable" size={20} class="cfg-head__icon" />
          <div class="cfg-title">Serial ports</div>
          {@render info('Drive mounts and read-only flags are managed from the Disks page.')}
        </div>
        <div class="cfg-desc">Physical ports for the FDC+ controller and the built-in VT102 terminal.</div>

        <!-- Primary / FDC+ -->
        <div class="cfg-sub">
          <span class="cfg-sub__label">Primary · FDC+</span>
          <span class="cfg-sub__rule"></span>
          {@render statusPill(serialConnected ? 'green' : 'red', serialConnected ? 'Connected' : 'Disconnected')}
        </div>
        <div class="cfg-grid-side">
          <div>
            {@render fieldLabel('Serial port')}
            <Select bind:value={serialForm.port}>
              <option value="">— unset —</option>
              {#each serialPorts as p}
                <option value={p.recommended}>{p.recommended}{p.manufacturer ? ` (${p.manufacturer})` : ''}</option>
              {/each}
              {#if serialForm.port && !serialPorts.some((p) => p.recommended === serialForm.port)}
                <option value={serialForm.port}>{serialForm.port} (current)</option>
              {/if}
            </Select>
          </div>
          <div>
            {@render fieldLabel('Baud rate')}
            <Select value={String(serialForm.baud)} onchange={(e) => (serialForm.baud = parseInt((e.target as HTMLSelectElement).value, 10))}>
              {#each primaryBaudRates as b}
                <option value={String(b)}>{b.toLocaleString()}</option>
              {/each}
            </Select>
          </div>
        </div>
        <div class="cfg-inline">
          <Button variant="outline" size="sm" icon="refresh" onclick={refreshPorts}>Refresh port list</Button>
          <span class="cfg-hint">
            Prefer a persistent <code>by-id</code> path so a reboot doesn't reshuffle ports.
          </span>
        </div>

        <!-- Terminal / VT102 -->
        <div class="cfg-sub" style="margin-top: 26px;">
          <span class="cfg-sub__label">Terminal · VT102</span>
          <span class="cfg-sub__rule"></span>
          {@render statusPill(termConnected ? 'green' : 'gray', termConnected ? 'Port open' : 'Port closed')}
        </div>
        <div class="cfg-grid-side">
          <div>
            {@render fieldLabel('Terminal port')}
            <Select bind:value={terminalForm.terminalPort}>
              <option value="">— unset —</option>
              {#each serialPorts as p}
                <option value={p.recommended}>{p.recommended}{p.manufacturer ? ` (${p.manufacturer})` : ''}</option>
              {/each}
              {#if terminalForm.terminalPort && !serialPorts.some((p) => p.recommended === terminalForm.terminalPort)}
                <option value={terminalForm.terminalPort}>{terminalForm.terminalPort} (current)</option>
              {/if}
            </Select>
          </div>
          <div>
            {@render fieldLabel('Baud rate')}
            <Select value={String(terminalForm.terminalBaud)} onchange={(e) => (terminalForm.terminalBaud = parseInt((e.target as HTMLSelectElement).value, 10))}>
              {#each terminalBaudRates as b}
                <option value={String(b)}>{b.toLocaleString()}</option>
              {/each}
            </Select>
          </div>
        </div>
        <div class="cfg-row cfg-row--divided">
          <div class="cfg-row__main">
            <div class="cfg-row__title">Auto-connect on startup</div>
            <div class="cfg-row__desc">Open the terminal port automatically when the daemon starts.</div>
          </div>
          <Toggle
            checked={terminalForm.terminalAutoconnect}
            ariaLabel="Auto-connect terminal on startup"
            onToggle={() => (terminalForm.terminalAutoconnect = !terminalForm.terminalAutoconnect)}
          />
        </div>
      </section>

      <!-- ============ DISK SERVING ============ -->
      <section class="cfg-card">
        <div class="cfg-head">
          <Icon name="save" size={20} class="cfg-head__icon" />
          <div class="cfg-title">Disk serving</div>
        </div>
        <div class="cfg-desc tight">Serve virtual floppies to the FDC+. Both toggles apply without restarting the daemon.</div>

        <div class="cfg-row cfg-row--divided">
          <div class="cfg-row__main">
            <div class="cfg-row__titlerow">
              <span class="cfg-row__title">Serve over serial</span>
              <Chip color="green" icon="bolt" size="sm">Live</Chip>
            </div>
            <div class="cfg-row__desc">Run the FDC+ command loop on the primary serial port.</div>
          </div>
          <Toggle
            checked={diskServingEnabled}
            disabled={diskServingInFlight}
            ariaLabel="Serve disks over serial"
            onToggle={toggleDiskServing}
          />
        </div>

        <div class="cfg-row cfg-row--divided">
          <div class="cfg-row__main">
            <div class="cfg-row__titlerow">
              <span class="cfg-row__title">Serve over TCP / WebSocket</span>
              <Chip color="green" icon="bolt" size="sm">Live</Chip>
            </div>
            <div class="cfg-row__desc">
              Accept virtual FDC clients at <code>/fdc-ws</code> — no physical port needed.
              Disabling drops live connections.
            </div>
          </div>
          <Toggle
            checked={wsTransportEnabled}
            disabled={wsTransportInFlight || configStatus?.configReadonly}
            ariaLabel="Serve disks over TCP / WebSocket"
            onToggle={toggleWsTransport}
          />
        </div>

        <div class="cfg-row cfg-row--divided">
          <div class="cfg-row__main">
            <div class="cfg-row__titlerow">
              <span class="cfg-row__title">Multi-client disk serving</span>
              <Chip color="green" icon="bolt" size="sm">Live</Chip>
            </div>
            <div class="cfg-row__desc">
              Allow multiple virtual (TCP/WebSocket) clients at once, each with its own
              copy-on-write fork of the mounted disks. Off = single client (default).
            </div>
          </div>
          <Toggle
            checked={multiClientServing}
            disabled={multiClientBusy}
            ariaLabel="Multi-client disk serving"
            onToggle={toggleMultiClient}
          />
        </div>

        {#if multiClientServing}
          <div class="cfg-mcp">
            <div>
              {@render fieldLabel('Write-master · writes the base image directly')}
              <div class="cfg-inputrow">
                <Input placeholder="serial" bind:value={writeMaster} disabled={writeMasterBusy} />
                <Button variant="tonal" disabled={writeMasterBusy} onclick={saveWriteMaster}>Set</Button>
              </div>
              <div class="cfg-hint" style="margin-top: 6px;">
                A client id, or <code>serial</code> (physical device, default), or <code>none</code>.
                Everyone else writes to their own splinter.
              </div>
            </div>
            <div style="margin-top: 14px;">
              {@render fieldLabel(`Connected clients · ${connectedClients.length}`)}
              {#if connectedClients.length === 0}
                <div class="cfg-hint">No virtual clients connected.</div>
              {:else}
                <div style="display: flex; flex-direction: column; gap: 6px;">
                  {#each connectedClients as c (c.id)}
                    <div class="cfg-client">
                      <span class="cfg-mono" style="text-align: left;">{c.clientId ?? '(anonymous)'}</span>
                      {#if (c.clientId ?? 'serial') === writeMaster}<Chip color="green" icon="edit" size="sm">master</Chip>{/if}
                      <span class="cfg-row__desc" style="margin-top: 0; margin-left: auto;">
                        {c.transport} · since {formatClientTime(c.connectedAt)}
                      </span>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {/if}
      </section>

      <!-- ============ WEB, API & MCP ============ -->
      <section class="cfg-card">
        <div class="cfg-head">
          <Icon name="lan" size={20} class="cfg-head__icon" />
          <div class="cfg-title">Web, API &amp; MCP</div>
        </div>
        <div class="cfg-desc">HTTP listener, credentials, and the MCP endpoint for AI clients. The API key is shared across all three.</div>

        <!-- Listener -->
        <div class="cfg-row cfg-row--divided">
          <div class="cfg-row__main">
            <div class="cfg-row__title">Serve the web UI &amp; REST API</div>
            <div class="cfg-row__desc">Turns the HTTP listener on. Port and host apply on save.</div>
          </div>
          <Toggle
            checked={webForm.web}
            ariaLabel="Serve the web UI and REST API"
            onToggle={() => (webForm.web = !webForm.web)}
          />
        </div>
        <div class="cfg-grid-even">
          <div>
            {@render fieldLabel('HTTP port')}
            <Input type="number" value={String(webForm.webPort)}
              oninput={(e) => (webForm.webPort = parseInt((e.target as HTMLInputElement).value, 10) || 0)} />
          </div>
          <div>
            {@render fieldLabel('Bind host', 'Use 0.0.0.0 for LAN access, localhost to stay local-only.')}
            <Input bind:value={webForm.webHost} />
          </div>
        </div>

        <!-- API key -->
        <div class="cfg-block">
          <div class="cfg-block__head">
            {@render fieldLabel('API key · machine token', "Required by MCP-over-HTTP and any curl script. Generate a new one — humans shouldn't type these.")}
            {#if configStatus?.apiKeySet}<Chip color="green" size="sm">Set</Chip>{/if}
          </div>
          <div class="cfg-inputrow">
            {#if apiKeyRevealed && configStatus?.apiKeySet && !webForm.apiKey}
              <Input value={revealedKey ?? ''} placeholder={revealLoading ? 'Loading…' : '(unavailable)'} type="text" readonly />
            {:else}
              <Input
                bind:value={webForm.apiKey}
                placeholder={configStatus?.apiKeySet ? '(hidden — enter to replace)' : '(no key set)'}
                type={apiKeyRevealed ? 'text' : 'password'}
              />
            {/if}
            <IconButton icon={apiKeyRevealed ? 'visibility_off' : 'visibility'} title={apiKeyRevealed ? 'Hide key' : 'Reveal key'} on={apiKeyRevealed} onclick={toggleApiKeyReveal} />
            <IconButton icon="content_copy" title="Copy key to clipboard" onclick={copyApiKey} />
            <Button variant="tonal" icon="autorenew" onclick={generateApiKey}>Generate</Button>
          </div>
          {#if configStatus?.apiKeySet}
            <button type="button" class="cfg-link" onclick={clearApiKey}>Clear key</button>
          {/if}
        </div>

        <!-- Admin password -->
        <div class="cfg-block">
          <div class="cfg-block__head">
            {@render fieldLabel('Admin password · UI login', 'What you type when signing in on a new browser. Stored as a bcrypt hash — never plaintext. Setting a new value signs out all other browsers.')}
            {#if configStatus?.adminPasswordSet}<Chip color="green" size="sm">Set</Chip>{/if}
          </div>
          <div class="cfg-inputrow">
            <Input bind:value={webForm.adminPassword} placeholder="(enter to replace)" type="password" />
            {#if configStatus?.adminPasswordSet}
              <Button variant="tonal" icon="lock_reset" onclick={() => (showChangePassword = !showChangePassword)}>Change</Button>
              <Button variant="outline" icon="logout" onclick={logOut}>Sign out</Button>
            {/if}
          </div>
          {#if configStatus?.adminPasswordSet}
            <button type="button" class="cfg-link" onclick={clearAdminPassword}>Clear password</button>
          {/if}

          {#if showChangePassword && configStatus?.adminPasswordSet}
            <!-- Dedicated change-password flow requires the current password
                 even though the caller is authenticated — defense against a
                 stolen cookie being used to lock the operator out. -->
            <div class="cfg-subpanel">
              {@render fieldLabel('Change password (requires current)')}
              <div class="cfg-changepw">
                <Input bind:value={cpwOld} type="password" placeholder="current" disabled={cpwSubmitting} />
                <Input bind:value={cpwNew} type="password" placeholder="new" disabled={cpwSubmitting} />
                <Button variant="filled" onclick={submitChangePassword} disabled={cpwSubmitting}>
                  {cpwSubmitting ? 'Updating…' : 'Update'}
                </Button>
              </div>
            </div>
          {/if}
        </div>

        <!-- MCP -->
        <div class="cfg-mcp">
          <div class="cfg-row">
            <div class="cfg-row__main">
              <div class="cfg-row__titlerow">
                <span class="cfg-row__title">MCP server</span>
                {#if configStatus?.mcpHttpLive}<Chip color="green" icon="bolt" size="sm">Live</Chip>{/if}
              </div>
              <div class="cfg-row__desc">Expose FDC+ tools to Claude Code and other AI clients at <code>/mcp</code>.</div>
            </div>
            <div class="cfg-mcp__ctl">
              {#if configStatus?.mcpHttpLive}
                <span class="cfg-serving"><span class="cfg-serving__dot"></span>Serving · {configStatus?.mcpHttpSessions ?? 0} session{(configStatus?.mcpHttpSessions ?? 0) === 1 ? '' : 's'}</span>
              {/if}
              <Toggle
                checked={mcpForm.enableMcpHttp}
                disabled={!configStatus?.apiKeySet}
                ariaLabel="Enable MCP over HTTP"
                onToggle={toggleMcp}
              />
            </div>
          </div>

          {#if !configStatus?.apiKeySet}
            <div class="cfg-mcp__note">
              <Icon name="key_off" size={16} />
              Set an API key above before enabling MCP over HTTP — bearer auth is required.
            </div>
          {:else if configStatus?.mcpHttpLive}
            <div style="margin-top: 14px;">
              {@render fieldLabel('Register with Claude Code')}
              <div class="cfg-code">
<pre>claude mcp add --transport http fdcplus \
  http://{typeof window !== 'undefined' ? window.location.host : 'HOST:PORT'}/mcp \
  --header "Authorization: Bearer &lt;api-key&gt;"</pre>
                <button type="button" class="cfg-code__copy" title="Copy" onclick={copyMcpSetup}>
                  <Icon name="content_copy" size={16} />
                </button>
              </div>
            </div>
          {/if}
        </div>
      </section>

      <!-- ============ LOGGING ============ -->
      <section class="cfg-card">
        <div class="cfg-head">
          <Icon name="description" size={20} class="cfg-head__icon" />
          <div class="cfg-title">Logging</div>
        </div>
        <div class="cfg-desc tight">Verbosity and where log output is written.</div>

        <div class="cfg-row cfg-row--divided">
          <div class="cfg-row__main">
            <div class="cfg-row__titlerow">
              <span class="cfg-row__title">Verbose logging</span>
              <Chip color="green" icon="bolt" size="sm">Live</Chip>
            </div>
            <div class="cfg-row__desc">Applies immediately; persists to disk on save.</div>
          </div>
          <Toggle checked={loggingForm.verbose} ariaLabel="Verbose logging" onToggle={toggleVerboseLive} />
        </div>

        <div class="cfg-row cfg-row--divided">
          <div class="cfg-row__main">
            <div class="cfg-row__title">Debug logging</div>
            <div class="cfg-row__desc">Very noisy — ships every FDC+ command byte.</div>
          </div>
          <Toggle checked={loggingForm.debug} ariaLabel="Debug logging" onToggle={() => (loggingForm.debug = !loggingForm.debug)} />
        </div>

        <div class="cfg-block">
          {@render fieldLabel('Log file', 'Blank = stdout only. Path is relative to dataDir unless absolute.')}
          <Input bind:value={loggingForm.logFile as string} placeholder="stdout only" />
        </div>
      </section>

      <!-- ============ SYSTEM INFO ============ -->
      <section class="cfg-card cfg-card--flush">
        <button type="button" class="cfg-sysbtn" onclick={() => (sysInfoOpen = !sysInfoOpen)}>
          <Icon name="expand_more" size={20} class={sysInfoOpen ? 'cfg-chevron open' : 'cfg-chevron'} />
          <span class="cfg-title">System info</span>
          <span class="cfg-sysbtn__hint">Install-time details — not editable</span>
        </button>
        {#if sysInfoOpen}
          <div class="cfg-sysgrid">
            <div class="cfg-sysrow"><span>Version</span><span class="cfg-mono">{$serverStatus?.system.version ?? '—'}{$serverStatus?.system.build ? ` (${$serverStatus.system.build})` : ''}</span></div>
            <div class="cfg-sysrow"><span>Data dir</span><span class="cfg-mono">{config?.dataDir ?? '(cwd)'}</span></div>
            <div class="cfg-sysrow"><span>Config file</span><span class="cfg-mono">{overridePath}</span></div>
            <div class="cfg-sysrow"><span>Baseline</span><span class="cfg-mono">{configStatus?.packageConfigFilePath ?? '(none)'}</span></div>
            <div class="cfg-sysrow"><span>Uptime</span><span class="cfg-mono">{formatUptime($serverStatus?.system.uptimeSeconds)}</span></div>
            <div class="cfg-sysrow"><span>Built</span><span class="cfg-mono">{$serverStatus?.system.builtAt ?? '(dev)'}</span></div>
            <div class="cfg-sysrow"><span>systemd-managed</span><span class="cfg-mono">{configStatus?.systemdManaged ? 'yes' : 'no'}</span></div>
            <div class="cfg-sysrow"><span>Overrides writable</span><span class="cfg-mono">{configStatus?.writable ? 'yes' : 'no'}</span></div>
            <div class="cfg-sysrow"><span>API key set</span><span class="cfg-mono">{configStatus?.apiKeySet ? 'yes' : 'no'}</span></div>
            <div class="cfg-sysrow"><span>Admin password set</span><span class="cfg-mono">{configStatus?.adminPasswordSet ? 'yes' : 'no'}</span></div>
            <div class="cfg-sysrow"><span>MCP over HTTP</span><span class="cfg-mono">{configStatus?.mcpHttpLive ? `live (${configStatus?.mcpHttpSessions ?? 0})` : 'off'}</span></div>
            <div class="cfg-sysrow"><span>Read-only</span><span class="cfg-mono">{configStatus?.configReadonly ? 'yes' : 'no'}</span></div>
          </div>
        {/if}
      </section>
    {/if}
  </div>
</div>

<!-- ============ STICKY SAVE BAR ============ -->
{#if anyDirty}
  <div class="cfg-savebar">
    <div class="cfg-savebar__inner">
      <Icon name="edit_note" size={20} class="cfg-savebar__icon" />
      <span class="cfg-savebar__label">{dirtyCount} unsaved {dirtyCount === 1 ? 'change' : 'changes'}</span>
      <div class="cfg-savebar__actions">
        <Button variant="outline" disabled={savingAll} onclick={discardAll}>Discard</Button>
        <Button variant="filled" icon="save" disabled={savingAll || configStatus?.configReadonly} onclick={saveAll}>
          {savingAll ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  </div>
{/if}

<style>
  .cfg-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: 100%;
  }
  /* Leave room so the sticky save bar never covers the last card. */
  .cfg-list.has-savebar {
    padding-bottom: 84px;
  }

  .cfg-card {
    background: var(--surface-raised);
    border: 1px solid var(--border-1);
    border-radius: var(--radius-lg);
    padding: 22px 24px;
    box-shadow: var(--elev-2);
  }
  .cfg-card--flush {
    padding: 0;
    overflow: hidden;
  }

  .cfg-skel {
    height: 14px;
    background: var(--surface-variant);
    border-radius: var(--radius-sm);
  }

  .cfg-notice {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: var(--surface-variant);
    border: 1px solid var(--border-1);
    border-radius: var(--radius-md);
    color: var(--fg-2);
    font: var(--text-body-sm);
  }

  /* ---- section header ---- */
  .cfg-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .cfg-head--spread {
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }
  .cfg-head :global(.cfg-head__icon) {
    color: var(--fg-2);
  }
  .cfg-title {
    font-size: 16px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--fg-1);
  }
  .cfg-desc {
    margin: 4px 0 18px 30px;
    font: var(--text-body-sm);
    color: var(--fg-3);
  }
  .cfg-desc.tight {
    margin-bottom: 8px;
  }

  .cfg-info {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 17px;
    height: 17px;
    border-radius: 50%;
    border: 1px solid var(--border-2);
    color: var(--fg-3);
    cursor: help;
    flex: none;
  }

  /* ---- sub-section divider row ---- */
  .cfg-sub {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 14px;
  }
  .cfg-sub__label {
    font-family: var(--font-data);
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--fg-2);
  }
  .cfg-sub__rule {
    flex: 1;
    height: 1px;
    background: var(--border-1);
  }

  /* ---- status pill ---- */
  .cfg-pill {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 4px 10px;
    border-radius: var(--radius-full);
    background: var(--surface-variant);
    border: 1px solid var(--border-1);
    font-family: var(--font-data);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-2);
    white-space: nowrap;
  }
  .cfg-pill__dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--fg-4);
  }
  .cfg-pill--green {
    color: var(--success);
    background: var(--success-container);
    border-color: color-mix(in oklab, var(--success) 25%, transparent);
  }
  .cfg-pill--green .cfg-pill__dot { background: var(--success); }
  .cfg-pill--red {
    color: var(--error);
    background: var(--error-container);
    border-color: color-mix(in oklab, var(--error) 25%, transparent);
  }
  .cfg-pill--red .cfg-pill__dot { background: var(--error); }

  /* ---- field labels + grids ---- */
  .cfg-flabel {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 7px;
    font-family: var(--font-data);
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--fg-3);
  }
  .cfg-grid-side {
    display: grid;
    grid-template-columns: 1fr 220px;
    gap: 16px;
  }
  .cfg-grid-even {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    padding: 16px 0;
  }
  @media (max-width: 640px) {
    .cfg-grid-side, .cfg-grid-even { grid-template-columns: 1fr; }
  }

  .cfg-inline {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    margin-top: 12px;
  }
  .cfg-hint {
    font: var(--text-body-sm);
    color: var(--fg-3);
  }
  .cfg-hint code, .cfg-row__desc code, .cfg-notice code {
    font-family: var(--font-data);
    color: var(--fg-2);
  }

  /* ---- toggle rows ---- */
  .cfg-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 0;
  }
  .cfg-row--divided {
    border-top: 1px solid var(--border-1);
  }
  .cfg-row__main {
    min-width: 0;
  }
  .cfg-row__titlerow {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .cfg-row__title {
    font-size: 14px;
    font-weight: 500;
    color: var(--fg-1);
  }
  .cfg-row__desc {
    margin-top: 3px;
    font: var(--text-body-sm);
    color: var(--fg-3);
  }

  /* ---- credential blocks ---- */
  .cfg-block {
    padding: 16px 0 0;
    border-top: 1px solid var(--border-1);
    margin-top: 16px;
  }
  .cfg-block:first-of-type {
    margin-top: 0;
  }
  .cfg-block__head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 7px;
  }
  .cfg-block__head .cfg-flabel {
    margin-bottom: 0;
  }
  .cfg-inputrow {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .cfg-inputrow > :global(:first-child) {
    flex: 1;
    min-width: 0;
  }
  .cfg-link {
    margin-top: 8px;
    padding: 0;
    background: none;
    border: none;
    color: var(--fg-3);
    font: var(--text-body-sm);
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }
  .cfg-link:hover {
    color: var(--fg-1);
  }
  .cfg-subpanel {
    margin-top: 12px;
    padding: 12px;
    background: var(--surface-variant);
    border: 1px solid var(--border-1);
    border-radius: var(--radius-md);
  }
  .cfg-changepw {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 8px;
    align-items: center;
    margin-top: 8px;
  }
  @media (max-width: 560px) {
    .cfg-changepw { grid-template-columns: 1fr; }
  }

  /* ---- MCP inset ---- */
  .cfg-mcp {
    margin-top: 20px;
    padding: 4px 16px 16px;
    border-radius: var(--radius-md);
    background: var(--surface-variant);
    border: 1px solid var(--border-1);
  }
  .cfg-mcp__ctl {
    display: flex;
    align-items: center;
    gap: 14px;
    flex: none;
  }
  .cfg-client {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: var(--surface-raised);
    border: 1px solid var(--border-1);
    border-radius: var(--radius-sm);
  }
  .cfg-serving {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font: var(--text-body-sm);
    color: var(--fg-2);
    white-space: nowrap;
  }
  .cfg-serving__dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--success);
    animation: cfg-pulse 1.8s ease-in-out infinite;
  }
  @keyframes cfg-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  .cfg-mcp__note {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
    padding: 10px 12px;
    background: var(--surface-raised);
    border: 1px solid var(--border-1);
    border-radius: var(--radius-sm);
    font: var(--text-body-sm);
    color: var(--fg-2);
  }
  .cfg-code {
    position: relative;
    background: var(--surface-sunken);
    border: 1px solid var(--border-1);
    border-radius: var(--radius-md);
    overflow-x: auto;
  }
  .cfg-code pre {
    margin: 0;
    padding: 14px 48px 14px 16px;
    font-family: var(--font-data);
    font-size: 12.5px;
    line-height: 1.7;
    color: var(--fg-2);
    white-space: pre;
  }
  .cfg-code__copy {
    position: absolute;
    top: 10px;
    right: 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-sm);
    background: var(--surface-variant);
    border: 1px solid var(--border-2);
    color: var(--fg-2);
    cursor: pointer;
  }
  .cfg-code__copy:hover {
    background: var(--surface-raised);
    color: var(--fg-1);
  }

  /* ---- system info ---- */
  .cfg-sysbtn {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 18px 24px;
    background: transparent;
    border: 0;
    color: var(--fg-1);
    cursor: pointer;
    text-align: left;
  }
  .cfg-sysbtn:hover {
    background: var(--surface-variant);
  }
  .cfg-sysbtn__hint {
    margin-left: auto;
    font: var(--text-body-sm);
    color: var(--fg-3);
  }
  .cfg-sysbtn :global(.cfg-chevron) {
    color: var(--fg-3);
    transition: transform var(--dur-medium) var(--ease-standard);
  }
  .cfg-sysbtn :global(.cfg-chevron.open) {
    transform: rotate(180deg);
  }
  .cfg-sysgrid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 32px;
    padding: 0 24px 20px;
  }
  @media (max-width: 640px) {
    .cfg-sysgrid { grid-template-columns: 1fr; }
  }
  .cfg-sysrow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 0;
    border-top: 1px solid var(--border-1);
    font: var(--text-body-sm);
    color: var(--fg-3);
  }
  .cfg-mono {
    font-family: var(--font-data);
    font-size: 12.5px;
    color: var(--fg-2);
    text-align: right;
    word-break: break-all;
  }

  /* ---- sticky save bar ---- */
  .cfg-savebar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 50;
    display: flex;
    justify-content: center;
    padding: 0 28px 20px;
    pointer-events: none;
  }
  .cfg-savebar__inner {
    pointer-events: auto;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 14px 12px 18px;
    border-radius: var(--radius-lg);
    background: color-mix(in oklab, var(--accent) 14%, var(--surface-raised));
    border: 1px solid color-mix(in oklab, var(--accent) 38%, transparent);
    box-shadow: var(--elev-4);
    backdrop-filter: blur(10px);
  }
  .cfg-savebar :global(.cfg-savebar__icon) {
    color: var(--accent);
  }
  .cfg-savebar__label {
    font-size: 14px;
    font-weight: 500;
    color: var(--fg-1);
  }
  .cfg-savebar__actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 10px;
  }
</style>
