<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/services/api';
  import { serverStatus, terminalStatus } from '$lib/services/socket';
  import Led from '$lib/components/shared/Led.svelte';
  import Card from '$lib/components/shared/Card.svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import Input from '$lib/components/shared/Input.svelte';
  import Select from '$lib/components/shared/Select.svelte';
  import PageHeader from '$lib/components/shared/PageHeader.svelte';
  import LabelStrip from '$lib/components/shared/LabelStrip.svelte';
  import Chip from '$lib/components/shared/Chip.svelte';
  import ConfigSection from '$lib/components/shared/ConfigSection.svelte';
  import FormField from '$lib/components/shared/FormField.svelte';
  import GpioPinInput from '$lib/components/shared/GpioPinInput.svelte';
  import RestartBanner from '$lib/components/shared/RestartBanner.svelte';
  import { showToast } from '$lib/stores/toast';
  import type { SerialPortInfo, ConfigDoc, ConfigStatus, GpioSection } from '$lib/types/api';

  let config = $state<ConfigDoc | null>(null);
  let configStatus = $state<ConfigStatus | null>(null);
  let serialPorts = $state<SerialPortInfo[]>([]);
  let diskServingEnabled = $state(false);
  let diskServingInFlight = $state(false);
  let loading = $state(true);

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
    apiKey: '' as string | null,
  });
  let terminalForm = $state({
    terminalPort: '',
    terminalBaud: 9600,
    terminalAutoconnect: false,
  });
  let loggingForm = $state({
    verbose: false,
    debug: false,
    logFile: '' as string | null,
  });
  let gpioForm = $state<GpioSection>({
    enabled: false,
    activeLow: false,
    blinkDuration: 100,
    activityBlinkDuration: 50,
    activityLed: null,
    drive0: { enable: null, headLoad: null, readOnly: null },
    drive1: { enable: null, headLoad: null, readOnly: null },
    drive2: { enable: null, headLoad: null, readOnly: null },
    drive3: { enable: null, headLoad: null, readOnly: null },
    terminal: { rx: null, tx: null, connected: null },
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
  let gpioBaseline = $state('');

  let serialConnected = $derived($serverStatus?.serial.connected ?? false);
  let termConnected = $derived($terminalStatus?.connected ?? false);

  $effect(() => {
    diskServingEnabled = $serverStatus?.diskServing.enabled ?? false;
  });

  const primaryBaudRates = [9600, 19200, 38400, 57600, 76800, 115200, 230400, 403200, 460800];
  const terminalBaudRates = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];

  // GPIO defaults from the README / getExampleConfig() — used to
  // pre-populate the form the first time an operator enables GPIO
  // without an existing pin map on disk. Keeps them from having to
  // hand-type 15 numbers from the docs.
  const GPIO_DEFAULTS: GpioSection = {
    enabled: true,
    activeLow: false,
    blinkDuration: 100,
    activityBlinkDuration: 50,
    activityLed: 4,
    drive0: { enable: 17, headLoad: 27, readOnly: 22 },
    drive1: { enable: 23, headLoad: 24, readOnly: 25 },
    drive2: { enable: 5, headLoad: 6, readOnly: 13 },
    drive3: { enable: 19, headLoad: 26, readOnly: 12 },
    terminal: { rx: 16, tx: 20, connected: 21 },
  };

  function anyPinAssigned(g: GpioSection): boolean {
    const pins: (number | null | undefined)[] = [
      g.activityLed,
      g.drive0?.enable, g.drive0?.headLoad, g.drive0?.readOnly,
      g.drive1?.enable, g.drive1?.headLoad, g.drive1?.readOnly,
      g.drive2?.enable, g.drive2?.headLoad, g.drive2?.readOnly,
      g.drive3?.enable, g.drive3?.headLoad, g.drive3?.readOnly,
      g.terminal?.rx, g.terminal?.tx, g.terminal?.connected,
    ];
    return pins.some((p) => typeof p === 'number');
  }

  function applyGpioDefaults() {
    // Deep-clone so subsequent edits don't mutate the constant.
    const d = JSON.parse(JSON.stringify(GPIO_DEFAULTS)) as GpioSection;
    // Preserve the operator's own choices for the numeric knobs if
    // they've already tweaked them; only fill in what's unset.
    gpioForm = {
      enabled: true,
      activeLow: gpioForm.activeLow ?? d.activeLow,
      blinkDuration: gpioForm.blinkDuration ?? d.blinkDuration,
      activityBlinkDuration: gpioForm.activityBlinkDuration ?? d.activityBlinkDuration,
      activityLed: d.activityLed,
      drive0: { ...d.drive0 },
      drive1: { ...d.drive1 },
      drive2: { ...d.drive2 },
      drive3: { ...d.drive3 },
      terminal: { ...d.terminal },
    };
  }

  onMount(async () => {
    await refresh();
    try {
      const { ports } = await api.listSerialPorts();
      serialPorts = ports;
    } catch {
      /* non-fatal */
    }
    loading = false;
  });

  async function refresh() {
    try {
      config = await api.getConfig();
      configStatus = await api.getConfigStatus();
      resetAllForms();
    } catch (err) {
      showToast(`Failed to load configuration: ${(err as Error).message}`, 'error');
    }
  }

  /**
   * Canonical form-shape for the GPIO section. Both `gpioForm` (edit
   * copy) and the dirty-detection baseline run through this so the
   * two are structurally comparable — otherwise `gpioForm` always
   * looks "dirty" against a bare `{}` or a partial `{ enabled: true }`
   * config, since resetAllForms fills in explicit defaults for every
   * scalar field.
   */
  function normalizeGpio(g: GpioSection | undefined | null): GpioSection {
    const src = g ?? {};
    // Fully populate every optional key so both the baseline snapshot
    // and the live gpioForm serialise to the exact same JSON. Empty
    // sub-objects here would let the template's bind:value silently
    // materialise `enable`/`headLoad`/`readOnly` keys on the proxy,
    // which then makes the "dirty" JSON diverge from the baseline.
    const drive = (d: any) => ({
      enable: d?.enable ?? null,
      headLoad: d?.headLoad ?? null,
      readOnly: d?.readOnly ?? null,
    });
    return {
      enabled: src.enabled ?? false,
      activeLow: src.activeLow ?? false,
      blinkDuration: src.blinkDuration ?? 100,
      activityBlinkDuration: src.activityBlinkDuration ?? 50,
      activityLed: src.activityLed ?? null,
      drive0: drive(src.drive0),
      drive1: drive(src.drive1),
      drive2: drive(src.drive2),
      drive3: drive(src.drive3),
      terminal: {
        rx: src.terminal?.rx ?? null,
        tx: src.terminal?.tx ?? null,
        connected: src.terminal?.connected ?? null,
      },
    };
  }

  function resetAllForms() {
    if (!config) return;
    serialForm = {
      port: config.port ?? '',
      baud: config.baud ?? 230400,
    };
    webForm = {
      web: config.web ?? true,
      webPort: config.webPort ?? 3000,
      webHost: config.webHost ?? 'localhost',
      apiKey: (config as any).apiKey ?? '',
    };
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
    gpioForm = normalizeGpio(config.gpioLeds);

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
    loggingBaseline = JSON.stringify($state.snapshot(loggingForm));
    gpioBaseline = JSON.stringify($state.snapshot(gpioForm));
  }

  // ---------- Dirty tracking (structural equality per section) ----------

  const serialDirty = $derived(!!config && JSON.stringify($state.snapshot(serialForm)) !== serialBaseline);
  const webDirty = $derived(!!config && JSON.stringify($state.snapshot(webForm)) !== webBaseline);
  const terminalDirty = $derived(!!config && JSON.stringify($state.snapshot(terminalForm)) !== terminalBaseline);
  const loggingDirty = $derived(!!config && JSON.stringify($state.snapshot(loggingForm)) !== loggingBaseline);
  const gpioDirty = $derived(!!config && JSON.stringify($state.snapshot(gpioForm)) !== gpioBaseline);

  // ---------- Pin conflict detection (mirrors backend superRefine) ----------

  const gpioUsedPins = $derived((): Set<number> => {
    const s = new Set<number>();
    const add = (v: number | null | undefined) => {
      if (typeof v === 'number') s.add(v);
    };
    add(gpioForm.activityLed);
    for (const drive of [gpioForm.drive0, gpioForm.drive1, gpioForm.drive2, gpioForm.drive3]) {
      add(drive?.enable);
      add(drive?.headLoad);
      add(drive?.readOnly);
    }
    add(gpioForm.terminal?.rx);
    add(gpioForm.terminal?.tx);
    add(gpioForm.terminal?.connected);
    return s;
  });

  // Used to highlight a specific field: pass a Set that excludes the
  // pin at THAT field, so the field only lights up when it duplicates
  // another one, not itself.
  function usedPinsExcluding(v: number | null | undefined): Set<number> {
    const s = gpioUsedPins();
    if (typeof v === 'number') {
      // If this pin appears more than once, keep it in the set so
      // every field showing it lights up. If it appears exactly once
      // (this field only), remove it.
      let count = 0;
      const all: (number | null | undefined)[] = [
        gpioForm.activityLed,
        ...([gpioForm.drive0, gpioForm.drive1, gpioForm.drive2, gpioForm.drive3].flatMap((d) => [
          d?.enable,
          d?.headLoad,
          d?.readOnly,
        ])),
        gpioForm.terminal?.rx,
        gpioForm.terminal?.tx,
        gpioForm.terminal?.connected,
      ];
      for (const p of all) if (p === v) count++;
      if (count <= 1) s.delete(v);
    }
    return s;
  }

  // ---------- Save handlers ----------

  function trimStrOrNull(v: string | null): string | null {
    const s = (v ?? '').trim();
    return s === '' ? null : s;
  }

  async function saveSerial() {
    await api.putSerialConfig({
      port: serialForm.port.trim(),
      baud: serialForm.baud,
    }, configStatus?.etag);
    await refresh();
  }
  async function saveWeb() {
    const apiKey = trimStrOrNull(webForm.apiKey);
    if (apiKey && !confirm(
      'Setting or changing the API key will disconnect the current session on the next restart. ' +
        'Save anyway?',
    )) throw new Error('Cancelled');
    await api.putWebConfig({
      web: webForm.web,
      webPort: webForm.webPort,
      webHost: webForm.webHost.trim(),
      apiKey,
    }, configStatus?.etag);
    await refresh();
  }
  async function saveTerminal() {
    await api.putTerminalConfig({
      terminalPort: terminalForm.terminalPort.trim(),
      terminalBaud: terminalForm.terminalBaud,
      terminalAutoconnect: terminalForm.terminalAutoconnect,
    }, configStatus?.etag);
    await refresh();
  }
  async function saveLogging() {
    await api.putLoggingConfig({
      verbose: loggingForm.verbose,
      debug: loggingForm.debug,
      logFile: trimStrOrNull(loggingForm.logFile),
    }, configStatus?.etag);
    await refresh();
  }
  async function saveGpio() {
    await api.putGpioConfig(
      { gpioLeds: $state.snapshot(gpioForm) as any },
      configStatus?.etag,
    );
    await refresh();
  }

  function discardAll() {
    resetAllForms();
    showToast('All changes discarded.', 'info');
  }

  // ---------- Live-toggle bits (verbose + disk serving) ----------

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

  async function refreshPorts() {
    try {
      const { ports } = await api.listSerialPorts();
      serialPorts = ports;
      showToast('Serial ports refreshed', 'info');
    } catch (err) {
      showToast(`Failed to refresh ports: ${(err as Error).message}`, 'error');
    }
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
</script>

<PageHeader
  eyebrow="Section · System · Configuration"
  title="Configuration"
  subtitle="Everything the daemon reads from the config file — editable, validated, saved atomically."
/>

<div class="fdc-page-body" style="display: flex; flex-direction: column; gap: 16px;">
  <RestartBanner
    status={configStatus}
    onDiscardAll={discardAll}
    onRolledBack={refresh}
  />

  {#if configStatus?.configReadonly}
    <div
      style="
        padding: 10px 14px;
        background: var(--surface-variant);
        border: 1px solid var(--border-1);
        border-radius: var(--radius-md);
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--fg-2);
        font: var(--text-body-sm);
      "
    >
      <span class="material-symbols-rounded" style="font-size: 18px;">lock</span>
      Config is read-only (<code>--config-readonly</code>). Saves are refused; sections stay
      as edit-preview only.
    </div>
  {/if}

  {#if loading}
    {#each Array(4) as _}
      <Card>
        <div style="padding: 20px;">
          <div style="height: 14px; width: 200px; background: var(--surface-variant); border-radius: var(--radius-xs); margin-bottom: 16px;"></div>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px;">
            <div style="height: 36px; background: var(--surface-variant); border-radius: var(--radius-sm);"></div>
            <div style="height: 36px; background: var(--surface-variant); border-radius: var(--radius-sm);"></div>
          </div>
        </div>
      </Card>
    {/each}
  {:else}

    <!-- Serial (FDC+) -->
    <ConfigSection
      id="serial"
      title="Serial (FDC+)"
      description="Primary serial port to the FDC+ controller and baud rate."
      dirty={serialDirty}
      onSave={saveSerial}
      onDiscard={resetAllForms}
    >
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;">
        <FormField label="Serial port" for_="serial-port"
          help="Prefer a persistent /dev/serial/by-id/... path so a reboot doesn't reshuffle ports.">
          <Select id="serial-port" bind:value={serialForm.port}>
            <option value="">— unset —</option>
            {#each serialPorts as p}
              <option value={p.recommended}>{p.recommended}{p.manufacturer ? ` (${p.manufacturer})` : ''}</option>
            {/each}
            {#if serialForm.port && !serialPorts.some((p) => p.recommended === serialForm.port)}
              <option value={serialForm.port}>{serialForm.port} (current)</option>
            {/if}
          </Select>
        </FormField>

        <FormField label="Baud rate" for_="serial-baud">
          <Select id="serial-baud" value={String(serialForm.baud)} onchange={(e) => (serialForm.baud = parseInt((e.target as HTMLSelectElement).value, 10))}>
            {#each primaryBaudRates as b}
              <option value={String(b)}>{b.toLocaleString()}</option>
            {/each}
          </Select>
        </FormField>
      </div>

      <div style="display: flex; gap: 12px; align-items: center; margin-top: 4px;">
        <Led color={serialConnected ? 'green' : 'red'} label={serialConnected ? 'Connected' : 'Disconnected'} />
        <Button variant="ghost" icon="refresh" onclick={refreshPorts}>Refresh port list</Button>
      </div>

      <p class="fdc-label-strip" style="color: var(--fg-3); margin: 0; text-transform: none; letter-spacing: 0;">
        Drive mounts and read-only flags are managed from the Disks page.
      </p>
    </ConfigSection>

    <!-- Disk serving (live) -->
    <Card>
      <div style="padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
        <div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <LabelStrip>Disk serving</LabelStrip>
            <Chip color="green" icon="bolt">Live</Chip>
          </div>
          <p class="fdc-label-strip" style="color: var(--fg-3); margin: 4px 0 0; text-transform: none; letter-spacing: 0;">
            Toggle the FDC+ command loop without restarting the daemon.
          </p>
        </div>
        <div style="display: flex; align-items: center; gap: 12px;">
          <Led color={diskServingEnabled ? 'green' : 'off'} label={diskServingEnabled ? 'Enabled' : 'Disabled'} />
          <Button
            variant={diskServingEnabled ? 'ghost' : 'filled'}
            icon={diskServingEnabled ? 'pause' : 'play_arrow'}
            onclick={toggleDiskServing}
            disabled={diskServingInFlight}
          >
            {diskServingEnabled ? 'Disable' : 'Enable'}
          </Button>
        </div>
      </div>
    </Card>

    <!-- Web / API -->
    <ConfigSection
      id="web"
      title="Web & API"
      description="HTTP bind address, port, and optional API-key auth."
      dirty={webDirty}
      onSave={saveWeb}
      onDiscard={resetAllForms}
    >
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;">
        <FormField label="Web enabled">
          <label style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" bind:checked={webForm.web} />
            <span class="fdc-label-strip" style="text-transform: none; letter-spacing: 0;">
              Serve the web UI + REST API
            </span>
          </label>
        </FormField>
        <FormField label="HTTP port" for_="web-port">
          <Input id="web-port" type="number" value={String(webForm.webPort)}
            oninput={(e) => (webForm.webPort = parseInt((e.target as HTMLInputElement).value, 10) || 0)} />
        </FormField>
        <FormField label="Bind host" for_="web-host"
          help="Use 0.0.0.0 for LAN access, localhost to stay local-only.">
          <Input id="web-host" bind:value={webForm.webHost} />
        </FormField>
        <FormField
          label="API key"
          hint={configStatus?.apiKeySet ? 'currently set' : 'not set'}
          hintColor={configStatus?.apiKeySet ? 'green' : 'gray'}
          help="Blank = no auth. Setting this makes every API call require Authorization: Bearer <key>.">
          <Input bind:value={webForm.apiKey as string} placeholder="(no key)" type="password" />
        </FormField>
      </div>
    </ConfigSection>

    <!-- Terminal -->
    <ConfigSection
      id="terminal"
      title="Terminal (secondary serial)"
      description="Optional second serial port for the built-in VT102 terminal emulator."
      dirty={terminalDirty}
      onSave={saveTerminal}
      onDiscard={resetAllForms}
    >
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;">
        <FormField label="Terminal port" for_="term-port">
          <Select id="term-port" bind:value={terminalForm.terminalPort}>
            <option value="">— unset —</option>
            {#each serialPorts as p}
              <option value={p.recommended}>{p.recommended}{p.manufacturer ? ` (${p.manufacturer})` : ''}</option>
            {/each}
            {#if terminalForm.terminalPort && !serialPorts.some((p) => p.recommended === terminalForm.terminalPort)}
              <option value={terminalForm.terminalPort}>{terminalForm.terminalPort} (current)</option>
            {/if}
          </Select>
        </FormField>
        <FormField label="Baud rate" for_="term-baud">
          <Select id="term-baud" value={String(terminalForm.terminalBaud)}
            onchange={(e) => (terminalForm.terminalBaud = parseInt((e.target as HTMLSelectElement).value, 10))}>
            {#each terminalBaudRates as b}
              <option value={String(b)}>{b.toLocaleString()}</option>
            {/each}
          </Select>
        </FormField>
        <FormField label="Auto-connect on startup">
          <label style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" bind:checked={terminalForm.terminalAutoconnect} />
            <span class="fdc-label-strip" style="text-transform: none; letter-spacing: 0;">
              Open the terminal port automatically at daemon start
            </span>
          </label>
        </FormField>
      </div>
      <div style="margin-top: 4px;">
        <Led color={termConnected ? 'green' : 'off'} label={termConnected ? 'Terminal port open' : 'Terminal port closed'} />
      </div>
    </ConfigSection>

    <!-- Logging -->
    <ConfigSection
      id="logging"
      title="Logging"
      description="Log verbosity + optional destination file."
      dirty={loggingDirty}
      onSave={saveLogging}
      onDiscard={resetAllForms}
      liveStatus="restart-required"
    >
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;">
        <FormField label="Verbose logging" hint="live-toggleable" hintColor="green"
          help="Toggle immediately with the button, or save to persist to disk.">
          <div style="display: flex; align-items: center; gap: 8px;">
            <label style="display: flex; align-items: center; gap: 8px;">
              <input type="checkbox" bind:checked={loggingForm.verbose} />
              <span class="fdc-label-strip" style="text-transform: none; letter-spacing: 0;">Enabled</span>
            </label>
            <Button variant="ghost" icon="bolt" onclick={toggleVerboseLive}>Toggle now</Button>
          </div>
        </FormField>
        <FormField label="Debug logging" help="Very noisy. Ships every FDC+ command byte.">
          <label style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" bind:checked={loggingForm.debug} />
            <span class="fdc-label-strip" style="text-transform: none; letter-spacing: 0;">Enabled</span>
          </label>
        </FormField>
        <FormField label="Log file"
          help="Blank = stdout only. Path is relative to dataDir unless absolute.">
          <Input bind:value={loggingForm.logFile as string} placeholder="fdcsds.log" />
        </FormField>
      </div>
    </ConfigSection>

    <!-- GPIO LEDs -->
    <ConfigSection
      id="gpio"
      title="GPIO LEDs (Raspberry Pi)"
      description="Drive drive-status and terminal LEDs from BCM GPIO pins on a Pi."
      dirty={gpioDirty}
      onSave={saveGpio}
      onDiscard={resetAllForms}
    >
      <FormField label="Drive the LEDs">
        <label style="display: flex; align-items: center; gap: 8px;">
          <input
            type="checkbox"
            checked={gpioForm.enabled}
            onchange={(e) => {
              const on = (e.target as HTMLInputElement).checked;
              if (on && !anyPinAssigned(gpioForm)) {
                applyGpioDefaults();
              } else {
                gpioForm.enabled = on;
              }
            }}
          />
          <span class="fdc-label-strip" style="text-transform: none; letter-spacing: 0;">
            Enable GPIO output — populates default pin map from the README if you haven't set any pins yet.
          </span>
        </label>
      </FormField>

      {#if gpioForm.enabled}
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px;">
        <FormField label="Active-low">
          <label style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" bind:checked={gpioForm.activeLow} />
            <span class="fdc-label-strip" style="text-transform: none; letter-spacing: 0;">
              Invert (LED wired to 3.3V, pin sinks)
            </span>
          </label>
        </FormField>
        <FormField label="Status blink (ms)">
          <Input type="number" value={String(gpioForm.blinkDuration ?? 100)}
            oninput={(e) => (gpioForm.blinkDuration = parseInt((e.target as HTMLInputElement).value, 10) || 0)} />
        </FormField>
        <FormField label="Activity blink (ms)">
          <Input type="number" value={String(gpioForm.activityBlinkDuration ?? 50)}
            oninput={(e) => (gpioForm.activityBlinkDuration = parseInt((e.target as HTMLInputElement).value, 10) || 0)} />
        </FormField>
        <FormField label="Activity LED pin">
          <GpioPinInput bind:value={gpioForm.activityLed} usedPins={usedPinsExcluding(gpioForm.activityLed)} />
        </FormField>
      </div>

      <!-- Drive 0 -->
      <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-1);">
        <LabelStrip>Drive 0</LabelStrip>
        <div style="display: grid; grid-template-columns: repeat(3, minmax(120px, 1fr)); gap: 12px; margin-top: 8px;">
          <FormField label="Enable">
            <GpioPinInput bind:value={gpioForm.drive0!.enable} usedPins={usedPinsExcluding(gpioForm.drive0?.enable)} />
          </FormField>
          <FormField label="Head-load">
            <GpioPinInput bind:value={gpioForm.drive0!.headLoad} usedPins={usedPinsExcluding(gpioForm.drive0?.headLoad)} />
          </FormField>
          <FormField label="Read-only">
            <GpioPinInput bind:value={gpioForm.drive0!.readOnly} usedPins={usedPinsExcluding(gpioForm.drive0?.readOnly)} />
          </FormField>
        </div>
      </div>

      <!-- Drive 1 -->
      <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-1);">
        <LabelStrip>Drive 1</LabelStrip>
        <div style="display: grid; grid-template-columns: repeat(3, minmax(120px, 1fr)); gap: 12px; margin-top: 8px;">
          <FormField label="Enable">
            <GpioPinInput bind:value={gpioForm.drive1!.enable} usedPins={usedPinsExcluding(gpioForm.drive1?.enable)} />
          </FormField>
          <FormField label="Head-load">
            <GpioPinInput bind:value={gpioForm.drive1!.headLoad} usedPins={usedPinsExcluding(gpioForm.drive1?.headLoad)} />
          </FormField>
          <FormField label="Read-only">
            <GpioPinInput bind:value={gpioForm.drive1!.readOnly} usedPins={usedPinsExcluding(gpioForm.drive1?.readOnly)} />
          </FormField>
        </div>
      </div>

      <!-- Drive 2 -->
      <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-1);">
        <LabelStrip>Drive 2</LabelStrip>
        <div style="display: grid; grid-template-columns: repeat(3, minmax(120px, 1fr)); gap: 12px; margin-top: 8px;">
          <FormField label="Enable">
            <GpioPinInput bind:value={gpioForm.drive2!.enable} usedPins={usedPinsExcluding(gpioForm.drive2?.enable)} />
          </FormField>
          <FormField label="Head-load">
            <GpioPinInput bind:value={gpioForm.drive2!.headLoad} usedPins={usedPinsExcluding(gpioForm.drive2?.headLoad)} />
          </FormField>
          <FormField label="Read-only">
            <GpioPinInput bind:value={gpioForm.drive2!.readOnly} usedPins={usedPinsExcluding(gpioForm.drive2?.readOnly)} />
          </FormField>
        </div>
      </div>

      <!-- Drive 3 -->
      <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-1);">
        <LabelStrip>Drive 3</LabelStrip>
        <div style="display: grid; grid-template-columns: repeat(3, minmax(120px, 1fr)); gap: 12px; margin-top: 8px;">
          <FormField label="Enable">
            <GpioPinInput bind:value={gpioForm.drive3!.enable} usedPins={usedPinsExcluding(gpioForm.drive3?.enable)} />
          </FormField>
          <FormField label="Head-load">
            <GpioPinInput bind:value={gpioForm.drive3!.headLoad} usedPins={usedPinsExcluding(gpioForm.drive3?.headLoad)} />
          </FormField>
          <FormField label="Read-only">
            <GpioPinInput bind:value={gpioForm.drive3!.readOnly} usedPins={usedPinsExcluding(gpioForm.drive3?.readOnly)} />
          </FormField>
        </div>
      </div>

      <!-- Terminal LEDs -->
      <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-1);">
        <LabelStrip>Terminal LEDs</LabelStrip>
        <div style="display: grid; grid-template-columns: repeat(3, minmax(120px, 1fr)); gap: 12px; margin-top: 8px;">
          <FormField label="RX">
            <GpioPinInput bind:value={gpioForm.terminal!.rx} usedPins={usedPinsExcluding(gpioForm.terminal?.rx)} />
          </FormField>
          <FormField label="TX">
            <GpioPinInput bind:value={gpioForm.terminal!.tx} usedPins={usedPinsExcluding(gpioForm.terminal?.tx)} />
          </FormField>
          <FormField label="Connected">
            <GpioPinInput bind:value={gpioForm.terminal!.connected} usedPins={usedPinsExcluding(gpioForm.terminal?.connected)} />
          </FormField>
        </div>
      </div>
      {/if}
    </ConfigSection>

    <!-- System info (read-only, tucked behind a disclosure) -->
    <Card>
      <details style="padding: 12px 20px;">
        <summary
          style="
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            font: var(--text-body-sm);
            color: var(--fg-2);
            list-style: none;
          "
        >
          <span class="material-symbols-rounded" style="font-size: 16px; color: var(--fg-3);">expand_more</span>
          <LabelStrip>System info</LabelStrip>
          <span style="color: var(--fg-3); text-transform: none; letter-spacing: 0;">
            install-time details — not editable
          </span>
        </summary>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-top: 12px; font: var(--text-body-sm); color: var(--fg-2);">
          <div><strong style="color: var(--fg-1);">Config file:</strong><br />{configStatus?.configFilePath ?? '(none loaded)'}</div>
          <div><strong style="color: var(--fg-1);">Data directory:</strong><br />{config?.dataDir ?? '(cwd)'}</div>
          <div><strong style="color: var(--fg-1);">Writable:</strong> {configStatus?.writable ? 'yes' : 'no'}</div>
          <div><strong style="color: var(--fg-1);">systemd-managed:</strong> {configStatus?.systemdManaged ? 'yes' : 'no'}</div>
          <div><strong style="color: var(--fg-1);">Startup epoch:</strong> {configStatus?.startupEpoch ?? '—'}</div>
          <div><strong style="color: var(--fg-1);">API key set:</strong> {configStatus?.apiKeySet ? 'yes' : 'no'}</div>
          <div><strong style="color: var(--fg-1);">Read-only:</strong> {configStatus?.configReadonly ? 'yes' : 'no'}</div>
          <div><strong style="color: var(--fg-1);">Build:</strong> {$serverStatus?.system.build ?? '(dev)'}</div>
        </div>
      </details>
    </Card>
  {/if}
</div>
