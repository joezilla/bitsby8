<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/services/api';
  import { serverStatus, terminalStatus } from '$lib/services/socket';
  import StatusLed from '$lib/components/shared/StatusLed.svelte';
  import { showToast } from '$lib/stores/toast';
  import type { SerialPortInfo } from '$lib/types/api';

  // ── State ──────────────────────────────────────────────────
  let config = $state<any>(null);
  let serialPorts = $state<SerialPortInfo[]>([]);
  let selectedPort = $state('');
  let selectedBaud = $state('230400');
  let diskServingEnabled = $state(false);
  let loading = $state(true);

  // ── Derived ────────────────────────────────────────────────
  let serialConnected = $derived($serverStatus?.serial.connected ?? false);
  let termConnected = $derived($terminalStatus?.connected ?? false);

  // ── Effects ────────────────────────────────────────────────
  $effect(() => {
    diskServingEnabled = $serverStatus?.diskServing.enabled ?? false;
  });

  // ── Baud rate options ──────────────────────────────────────
  const primaryBaudRates = [9600, 19200, 38400, 57600, 76800, 115200, 230400, 403200, 460800];
  const terminalBaudRates = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];

  // ── Lifecycle ──────────────────────────────────────────────
  onMount(async () => {
    try {
      config = await api.getConfig();
      const { ports } = await api.listSerialPorts();
      serialPorts = ports;
      selectedPort = config.port || '';
      selectedBaud = String(config.baud || 230400);
    } catch (e) {
      showToast('Failed to load configuration', 'error');
    }
    loading = false;
  });

  // ── Functions ──────────────────────────────────────────────
  async function refreshPorts() {
    try {
      const { ports } = await api.listSerialPorts();
      serialPorts = ports;
      showToast('Serial ports refreshed', 'info');
    } catch (e) {
      showToast('Failed to refresh ports', 'error');
    }
  }

  async function applySerialConfig() {
    try {
      await api.configureSerial(selectedPort, parseInt(selectedBaud));
      showToast('Serial configuration applied', 'success');
    } catch (e: any) {
      showToast(e.message || 'Failed to apply serial config', 'error');
    }
  }

  async function toggleDiskServing() {
    try {
      if (diskServingEnabled) {
        await api.disableDiskServing();
        showToast('Disk serving disabled', 'info');
      } else {
        await api.enableDiskServing();
        showToast('Disk serving enabled', 'success');
      }
    } catch (e: any) {
      showToast(e.message || 'Failed to toggle disk serving', 'error');
    }
  }

  async function toggleVerbose() {
    try {
      await api.updateConfig({ verbose: !config.verbose });
      config = { ...config, verbose: !config.verbose };
      showToast(`Verbose logging ${config.verbose ? 'enabled' : 'disabled'}`, 'info');
    } catch (e: any) {
      showToast(e.message || 'Failed to update verbose setting', 'error');
    }
  }
</script>

<div class="flex flex-col gap-6">
  <h2 class="text-lg font-retro text-amber tracking-wider">Configuration</h2>

  {#if loading}
    <!-- Loading skeleton -->
    <div class="flex flex-col gap-4">
      {#each Array(4) as _}
        <div class="bg-panel rounded-lg border border-border p-5 animate-pulse">
          <div class="h-4 bg-panel-sunken rounded w-48 mb-4"></div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="h-9 bg-panel-sunken rounded"></div>
            <div class="h-9 bg-panel-sunken rounded"></div>
          </div>
        </div>
      {/each}
    </div>
  {:else}

    <!-- ─── 1. Primary Serial Configuration ─────────────── -->
    <div class="bg-panel rounded-lg border border-border p-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-semibold uppercase tracking-wider text-text-dim">
          Primary Serial Configuration
        </h3>
        <StatusLed
          color={serialConnected ? 'green' : 'red'}
          label={serialConnected ? 'Connected' : 'Disconnected'}
        />
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <!-- Port -->
        <div>
          <label for="primary-port" class="block text-xs text-text-dim mb-1">Serial Port</label>
          <select
            id="primary-port"
            bind:value={selectedPort}
            class="bg-panel-sunken border border-border rounded px-3 py-2 text-sm text-text w-full focus:border-amber focus:outline-none"
          >
            <option value="">-- Select port --</option>
            {#each serialPorts as port}
              <option value={port.recommended}>{port.recommended}{port.manufacturer ? ` (${port.manufacturer})` : ''}</option>
            {/each}
          </select>
        </div>

        <!-- Baud Rate -->
        <div>
          <label for="primary-baud" class="block text-xs text-text-dim mb-1">Baud Rate</label>
          <select
            id="primary-baud"
            bind:value={selectedBaud}
            class="bg-panel-sunken border border-border rounded px-3 py-2 text-sm text-text w-full focus:border-amber focus:outline-none"
          >
            {#each primaryBaudRates as baud}
              <option value={String(baud)}>{baud.toLocaleString()}</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="flex items-center gap-3 mt-4">
        <button
          onclick={applySerialConfig}
          class="bg-amber text-panel-sunken px-4 py-2 rounded text-sm font-semibold hover:bg-amber-bright transition-colors"
        >
          Apply
        </button>
        <button
          onclick={refreshPorts}
          class="border border-border text-text-dim px-4 py-2 rounded text-sm hover:text-text hover:border-border-bright transition-colors"
        >
          Refresh Ports
        </button>
      </div>
    </div>

    <!-- ─── 2. Disk Serving Mode ────────────────────────── -->
    <div class="bg-panel rounded-lg border border-border p-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-semibold uppercase tracking-wider text-text-dim">
          Disk Serving Mode
        </h3>
        <StatusLed
          color={diskServingEnabled ? 'green' : 'off'}
          label={diskServingEnabled ? 'Enabled' : 'Disabled'}
        />
      </div>

      <div class="flex items-center gap-3">
        <label class="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={diskServingEnabled}
            onchange={toggleDiskServing}
            class="sr-only peer"
          />
          <div class="w-11 h-6 bg-panel-sunken border border-border rounded-full peer peer-checked:bg-amber/30 peer-checked:border-amber after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:bg-text-dim after:rounded-full after:h-4.5 after:w-4.5 after:transition-all peer-checked:after:translate-x-5 peer-checked:after:bg-amber"></div>
        </label>
        <span class="text-sm text-text">
          {diskServingEnabled ? 'Disk serving is active' : 'Disk serving is inactive'}
        </span>
      </div>
    </div>

    <!-- ─── 3. Web Interface Configuration ──────────────── -->
    <div class="bg-panel rounded-lg border border-border p-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-semibold uppercase tracking-wider text-text-dim">
          Web Interface Configuration
        </h3>
        <span class="text-xs text-text-dim italic">Requires restart</span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <!-- Enabled -->
        <div class="flex items-center gap-2">
          <input
            type="checkbox"
            id="web-enabled"
            checked={config?.webEnabled ?? true}
            disabled
            class="accent-amber h-4 w-4"
          />
          <label for="web-enabled" class="text-sm text-text-dim">Web interface enabled</label>
        </div>

        <!-- Spacer for grid alignment -->
        <div></div>

        <!-- Port -->
        <div>
          <label for="web-port" class="block text-xs text-text-dim mb-1">Port</label>
          <input
            id="web-port"
            type="text"
            value={config?.webPort ?? '3000'}
            disabled
            class="bg-panel-sunken border border-border rounded px-3 py-2 text-sm text-text-dim w-full opacity-60 cursor-not-allowed"
          />
        </div>

        <!-- Host -->
        <div>
          <label for="web-host" class="block text-xs text-text-dim mb-1">Host</label>
          <input
            id="web-host"
            type="text"
            value={config?.webHost ?? '0.0.0.0'}
            disabled
            class="bg-panel-sunken border border-border rounded px-3 py-2 text-sm text-text-dim w-full opacity-60 cursor-not-allowed"
          />
        </div>
      </div>
    </div>

    <!-- ─── 4. Terminal Serial Configuration ────────────── -->
    <div class="bg-panel rounded-lg border border-border p-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-semibold uppercase tracking-wider text-text-dim">
          Terminal Serial Configuration
        </h3>
        <StatusLed
          color={termConnected ? 'cyan' : 'off'}
          label={termConnected ? 'Connected' : 'Disconnected'}
        />
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <!-- Port -->
        <div>
          <label for="term-port" class="block text-xs text-text-dim mb-1">Serial Port</label>
          <select
            id="term-port"
            disabled
            class="bg-panel-sunken border border-border rounded px-3 py-2 text-sm text-text-dim w-full opacity-60 cursor-not-allowed"
          >
            <option>{$terminalStatus?.device ?? config?.terminalPort ?? 'Not configured'}</option>
          </select>
        </div>

        <!-- Baud Rate -->
        <div>
          <label for="term-baud" class="block text-xs text-text-dim mb-1">Baud Rate</label>
          <select
            id="term-baud"
            disabled
            class="bg-panel-sunken border border-border rounded px-3 py-2 text-sm text-text-dim w-full opacity-60 cursor-not-allowed"
          >
            <option>{$terminalStatus?.config?.baudRate ?? config?.terminalBaud ?? 9600}</option>
            {#each terminalBaudRates as baud}
              <option value={String(baud)}>{baud.toLocaleString()}</option>
            {/each}
          </select>
        </div>

        <!-- Autoconnect -->
        <div class="flex items-center gap-2">
          <input
            type="checkbox"
            id="term-autoconnect"
            checked={config?.terminalAutoconnect ?? false}
            disabled
            class="accent-amber h-4 w-4"
          />
          <label for="term-autoconnect" class="text-sm text-text-dim">Autoconnect on startup</label>
        </div>
      </div>

      <div class="flex items-center gap-3 mt-4">
        <button
          onclick={refreshPorts}
          class="border border-border text-text-dim px-4 py-2 rounded text-sm hover:text-text hover:border-border-bright transition-colors"
        >
          Refresh Ports
        </button>
      </div>
    </div>

    <!-- ─── 5. Display Options ──────────────────────────── -->
    <div class="bg-panel rounded-lg border border-border p-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-semibold uppercase tracking-wider text-text-dim">
          Display Options
        </h3>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <!-- Verbose -->
        <div class="flex items-center gap-3">
          <label class="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={config?.verbose ?? false}
              onchange={toggleVerbose}
              class="sr-only peer"
            />
            <div class="w-11 h-6 bg-panel-sunken border border-border rounded-full peer peer-checked:bg-amber/30 peer-checked:border-amber after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:bg-text-dim after:rounded-full after:h-4.5 after:w-4.5 after:transition-all peer-checked:after:translate-x-5 peer-checked:after:bg-amber"></div>
          </label>
          <span class="text-sm text-text">Verbose logging</span>
        </div>

        <!-- Debug -->
        <div class="flex items-center gap-2">
          <input
            type="checkbox"
            id="display-debug"
            checked={config?.debug ?? false}
            disabled
            class="accent-amber h-4 w-4"
          />
          <label for="display-debug" class="text-sm text-text-dim">Debug mode <span class="text-xs italic">(read-only)</span></label>
        </div>
      </div>
    </div>

    <!-- ─── 6. GPIO LED Configuration ───────────────────── -->
    <div class="bg-panel rounded-lg border border-border p-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-semibold uppercase tracking-wider text-text-dim">
          GPIO LED Configuration
        </h3>
        <span class="text-xs text-text-dim italic">Requires restart</span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <!-- Enabled -->
        <div class="flex items-center gap-2">
          <input
            type="checkbox"
            id="gpio-enabled"
            checked={config?.gpioEnabled ?? false}
            disabled
            class="accent-amber h-4 w-4"
          />
          <label for="gpio-enabled" class="text-sm text-text-dim">GPIO LEDs enabled</label>
        </div>

        <!-- Active Low -->
        <div class="flex items-center gap-2">
          <input
            type="checkbox"
            id="gpio-active-low"
            checked={config?.gpioActiveLow ?? false}
            disabled
            class="accent-amber h-4 w-4"
          />
          <label for="gpio-active-low" class="text-sm text-text-dim">Active low</label>
        </div>

        <!-- Blink Duration -->
        <div>
          <label for="gpio-blink-duration" class="block text-xs text-text-dim mb-1">Blink Duration (ms)</label>
          <input
            id="gpio-blink-duration"
            type="text"
            value={config?.gpioBlinkDuration ?? '100'}
            disabled
            class="bg-panel-sunken border border-border rounded px-3 py-2 text-sm text-text-dim w-full opacity-60 cursor-not-allowed"
          />
        </div>

        <!-- Activity Blink -->
        <div>
          <label for="gpio-activity-blink" class="block text-xs text-text-dim mb-1">Activity Blink (ms)</label>
          <input
            id="gpio-activity-blink"
            type="text"
            value={config?.gpioActivityBlink ?? '50'}
            disabled
            class="bg-panel-sunken border border-border rounded px-3 py-2 text-sm text-text-dim w-full opacity-60 cursor-not-allowed"
          />
        </div>
      </div>
    </div>

  {/if}
</div>
