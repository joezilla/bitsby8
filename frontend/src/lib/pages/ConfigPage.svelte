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
  import { showToast } from '$lib/stores/toast';
  import type { SerialPortInfo } from '$lib/types/api';

  let config = $state<any>(null);
  let serialPorts = $state<SerialPortInfo[]>([]);
  let selectedPort = $state('');
  let selectedBaud = $state('230400');
  let diskServingEnabled = $state(false);
  let loading = $state(true);

  let serialConnected = $derived($serverStatus?.serial.connected ?? false);
  let termConnected = $derived($terminalStatus?.connected ?? false);

  $effect(() => {
    diskServingEnabled = $serverStatus?.diskServing.enabled ?? false;
  });

  const primaryBaudRates = [9600, 19200, 38400, 57600, 76800, 115200, 230400, 403200, 460800];
  const terminalBaudRates = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];

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

<PageHeader
  eyebrow="Section · System · Configuration"
  title="Configuration"
  subtitle="Serial, disk-serving, terminal, and GPIO settings."
/>

<div style="padding: 0 28px 28px; display: flex; flex-direction: column; gap: 16px;">
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

    <!-- Primary serial -->
    <Card>
      <div style="padding: 20px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
          <LabelStrip>Primary serial configuration</LabelStrip>
          <Led
            color={serialConnected ? 'green' : 'red'}
            label={serialConnected ? 'Connected' : 'Disconnected'}
          />
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;">
          <div>
            <label for="primary-port" class="fdc-label-strip" style="display: block; margin-bottom: 6px;">Serial port</label>
            <Select id="primary-port" bind:value={selectedPort}>
              <option value="">— Select port —</option>
              {#each serialPorts as port}
                <option value={port.recommended}>
                  {port.recommended}{port.manufacturer ? ` (${port.manufacturer})` : ''}
                </option>
              {/each}
            </Select>
          </div>
          <div>
            <label for="primary-baud" class="fdc-label-strip" style="display: block; margin-bottom: 6px;">Baud rate</label>
            <Select id="primary-baud" bind:value={selectedBaud}>
              {#each primaryBaudRates as baud}
                <option value={String(baud)}>{baud.toLocaleString()}</option>
              {/each}
            </Select>
          </div>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 16px;">
          <Button variant="filled" icon="check" onclick={applySerialConfig}>Apply</Button>
          <Button variant="ghost" icon="refresh" onclick={refreshPorts}>Refresh ports</Button>
        </div>
      </div>
    </Card>

    <!-- Disk serving -->
    <Card>
      <div style="padding: 20px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
          <LabelStrip>Disk serving mode</LabelStrip>
          <Led
            color={diskServingEnabled ? 'green' : 'off'}
            label={diskServingEnabled ? 'Enabled' : 'Disabled'}
          />
        </div>

        <div style="display: flex; align-items: center; gap: 12px;">
          <label style="position: relative; display: inline-flex; align-items: center; cursor: pointer;">
            <input
              type="checkbox"
              checked={diskServingEnabled}
              onchange={toggleDiskServing}
              class="peer"
              style="position: absolute; opacity: 0; pointer-events: none;"
            />
            <span
              class="peer-checked:bg-accent peer-checked:border-accent"
              style="
                width: 44px;
                height: 24px;
                background: var(--surface-sunken);
                border: 1px solid var(--border-2);
                border-radius: 999px;
                position: relative;
                transition: background var(--dur-short), border-color var(--dur-short);
              "
            >
              <span
                style="
                  position: absolute;
                  top: 3px;
                  left: {diskServingEnabled ? '23px' : '3px'};
                  width: 16px;
                  height: 16px;
                  background: {diskServingEnabled ? 'var(--accent)' : 'var(--fg-3)'};
                  border-radius: 999px;
                  transition: left var(--dur-short) var(--ease-standard), background var(--dur-short);
                "
              ></span>
            </span>
          </label>
          <span style="font: var(--text-body); color: var(--fg-1);">
            {diskServingEnabled ? 'Disk serving is active' : 'Disk serving is inactive'}
          </span>
        </div>
      </div>
    </Card>

    <!-- Web interface (read-only) -->
    <Card>
      <div style="padding: 20px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
          <LabelStrip>Web interface configuration</LabelStrip>
          <span class="fdc-label-strip" style="color: var(--fg-3); text-transform: none; letter-spacing: 0;">
            Requires restart
          </span>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <input
              type="checkbox"
              id="web-enabled"
              checked={config?.webEnabled ?? true}
              disabled
              style="accent-color: var(--accent); width: 16px; height: 16px;"
            />
            <label for="web-enabled" style="font: var(--text-body-sm); color: var(--fg-2);">Web interface enabled</label>
          </div>
          <div></div>
          <div>
            <label for="web-port" class="fdc-label-strip" style="display: block; margin-bottom: 6px;">Port</label>
            <Input id="web-port" value={String(config?.webPort ?? '3000')} disabled />
          </div>
          <div>
            <label for="web-host" class="fdc-label-strip" style="display: block; margin-bottom: 6px;">Host</label>
            <Input id="web-host" value={config?.webHost ?? '0.0.0.0'} disabled />
          </div>
        </div>
      </div>
    </Card>

    <!-- Terminal serial -->
    <Card>
      <div style="padding: 20px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
          <LabelStrip>Terminal serial configuration</LabelStrip>
          <Led
            color={termConnected ? 'cyan' : 'off'}
            label={termConnected ? 'Connected' : 'Disconnected'}
          />
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;">
          <div>
            <label for="term-port" class="fdc-label-strip" style="display: block; margin-bottom: 6px;">Serial port</label>
            <Select id="term-port" disabled>
              <option>{$terminalStatus?.device ?? config?.terminalPort ?? 'Not configured'}</option>
            </Select>
          </div>
          <div>
            <label for="term-baud" class="fdc-label-strip" style="display: block; margin-bottom: 6px;">Baud rate</label>
            <Select id="term-baud" disabled>
              <option>{$terminalStatus?.config?.baudRate ?? config?.terminalBaud ?? 9600}</option>
              {#each terminalBaudRates as baud}
                <option value={String(baud)}>{baud.toLocaleString()}</option>
              {/each}
            </Select>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <input
              type="checkbox"
              id="term-autoconnect"
              checked={config?.terminalAutoconnect ?? false}
              disabled
              style="accent-color: var(--accent); width: 16px; height: 16px;"
            />
            <label for="term-autoconnect" style="font: var(--text-body-sm); color: var(--fg-2);">Autoconnect on startup</label>
          </div>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 16px;">
          <Button variant="ghost" icon="refresh" onclick={refreshPorts}>Refresh ports</Button>
        </div>
      </div>
    </Card>

    <!-- Display -->
    <Card>
      <div style="padding: 20px;">
        <div style="margin-bottom: 16px;">
          <LabelStrip>Display options</LabelStrip>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <label style="position: relative; display: inline-flex; align-items: center; cursor: pointer;">
              <input
                type="checkbox"
                checked={config?.verbose ?? false}
                onchange={toggleVerbose}
                style="position: absolute; opacity: 0; pointer-events: none;"
              />
              <span
                style="
                  width: 44px;
                  height: 24px;
                  background: var(--surface-sunken);
                  border: 1px solid var(--border-2);
                  border-radius: 999px;
                  position: relative;
                "
              >
                <span
                  style="
                    position: absolute;
                    top: 3px;
                    left: {config?.verbose ? '23px' : '3px'};
                    width: 16px;
                    height: 16px;
                    background: {config?.verbose ? 'var(--accent)' : 'var(--fg-3)'};
                    border-radius: 999px;
                    transition: left var(--dur-short) var(--ease-standard);
                  "
                ></span>
              </span>
            </label>
            <span style="font: var(--text-body); color: var(--fg-1);">Verbose logging</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <input
              type="checkbox"
              id="display-debug"
              checked={config?.debug ?? false}
              disabled
              style="accent-color: var(--accent); width: 16px; height: 16px;"
            />
            <label for="display-debug" style="font: var(--text-body-sm); color: var(--fg-2);">
              Debug mode
              <span class="fdc-label-strip" style="text-transform: none; letter-spacing: 0; color: var(--fg-3); margin-left: 6px;">
                (read-only)
              </span>
            </label>
          </div>
        </div>
      </div>
    </Card>

    <!-- GPIO -->
    <Card>
      <div style="padding: 20px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
          <LabelStrip>GPIO LED configuration</LabelStrip>
          <span class="fdc-label-strip" style="color: var(--fg-3); text-transform: none; letter-spacing: 0;">
            Requires restart
          </span>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <input
              type="checkbox"
              id="gpio-enabled"
              checked={config?.gpioEnabled ?? false}
              disabled
              style="accent-color: var(--accent); width: 16px; height: 16px;"
            />
            <label for="gpio-enabled" style="font: var(--text-body-sm); color: var(--fg-2);">GPIO LEDs enabled</label>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <input
              type="checkbox"
              id="gpio-active-low"
              checked={config?.gpioActiveLow ?? false}
              disabled
              style="accent-color: var(--accent); width: 16px; height: 16px;"
            />
            <label for="gpio-active-low" style="font: var(--text-body-sm); color: var(--fg-2);">Active low</label>
          </div>
          <div>
            <label for="gpio-blink-duration" class="fdc-label-strip" style="display: block; margin-bottom: 6px;">Blink duration (ms)</label>
            <Input id="gpio-blink-duration" value={String(config?.gpioBlinkDuration ?? '100')} disabled />
          </div>
          <div>
            <label for="gpio-activity-blink" class="fdc-label-strip" style="display: block; margin-bottom: 6px;">Activity blink (ms)</label>
            <Input id="gpio-activity-blink" value={String(config?.gpioActivityBlink ?? '50')} disabled />
          </div>
        </div>
      </div>
    </Card>

  {/if}
</div>
