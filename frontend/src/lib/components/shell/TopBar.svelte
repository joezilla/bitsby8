<script lang="ts">
  import Icon from '$lib/components/shared/Icon.svelte';
  import IconButton from '$lib/components/shared/IconButton.svelte';
  import Led from '$lib/components/shared/Led.svelte';
  import { serverStatus, terminalStatus, connected } from '$lib/services/socket';
  import { theme, toggleTheme } from '$lib/stores/theme';
  import { terminalHealth } from '$lib/stores/terminalHealth';
  import type { DriveState } from '$lib/types/api';

  interface Props {
    chatOpen?: boolean;
    onToggleChat?: () => void;
    onToggleSidebar?: () => void;
    sidebarOpen?: boolean;
  }

  let {
    chatOpen = false,
    onToggleChat,
    onToggleSidebar,
    sidebarOpen = true,
  }: Props = $props();

  const drives: DriveState[] = $derived($serverStatus?.drives ?? []);
  const serialConnected = $derived($serverStatus?.serial.connected ?? false);
  const serialBaud = $derived($serverStatus?.serial.baudRate);
  const diskServingRunning = $derived($serverStatus?.diskServing.running ?? false);
  const termConnected = $derived($terminalStatus?.connected ?? false);

  const ACTIVITY_WINDOW_MS = 1500;
  type DriveLedState = { color: 'amber' | 'green' | 'off'; pulse: boolean };
  function driveLed(drive: DriveState | undefined): DriveLedState {
    if (!drive || !drive.mounted) return { color: 'off', pulse: false };
    const active = drive.lastIo !== null && Date.now() - drive.lastIo < ACTIVITY_WINDOW_MS;
    if (active) return { color: 'amber', pulse: true };
    return { color: 'green', pulse: false };
  }
</script>

<header
  style="
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px 0 12px;
    height: 56px;
    background: var(--surface);
    border-bottom: 1px solid var(--border-1);
    flex: 0 0 auto;
    gap: 12px;
  "
>
  <!-- Left: sidebar toggle + wordmark -->
  <div style="display: flex; align-items: center; gap: 16px; min-width: 0;">
    {#if onToggleSidebar}
      <IconButton
        icon="menu"
        size={20}
        title={sidebarOpen ? 'Hide navigation' : 'Show navigation'}
        on={sidebarOpen}
        onclick={onToggleSidebar}
      />
    {/if}
    <div style="display: flex; align-items: baseline; gap: 10px; min-width: 0;">
      <span
        style="
          font-family: var(--font-data);
          font-weight: 600;
          font-size: 20px;
          letter-spacing: 0.04em;
          color: var(--fg-1);
        "
      >
        BitsBy<span style="color: var(--accent);">8</span>
      </span>
      <span class="fdc-label-strip hidden md:inline" style="opacity: 0.7; white-space: nowrap;">
        FDC Controller · S100 Simulator
      </span>
    </div>
  </div>

  <!-- Right: status cluster + actions -->
  <div style="display: flex; align-items: center; gap: 14px;">
    <div class="hidden md:flex" style="align-items: center; gap: 12px;">
      <Led
        color={$connected ? 'green' : 'red'}
        pulse={!$connected}
        label={$connected ? 'Online' : 'Offline'}
      />
      <Led
        color={serialConnected ? 'cyan' : 'off'}
        label="Serial"
        sublabel={serialConnected && serialBaud ? String(serialBaud) : undefined}
      />
      <Led
        color={diskServingRunning ? 'green' : 'off'}
        label="FDC"
      />
    </div>

    <span class="hidden lg:inline" style="width: 1px; height: 22px; background: var(--border-1);"></span>

    <div class="hidden lg:flex" style="align-items: center; gap: 10px;">
      <span class="fdc-label-strip">Drives</span>
      {#each [0, 1, 2, 3] as n}
        {@const s = driveLed(drives.find((d) => d.id === n))}
        <span
          title="Drive {n}"
          style="display: inline-flex; flex-direction: column; align-items: center; gap: 3px;"
        >
          <Led color={s.color} pulse={s.pulse} size="md" />
          <span class="fdc-label-strip" style="font-size: 8.5px; letter-spacing: 0.1em;">{n}</span>
        </span>
      {/each}
    </div>

    <span class="hidden lg:inline" style="width: 1px; height: 22px; background: var(--border-1);"></span>

    <div class="hidden md:flex" style="align-items: center; gap: 12px;">
      <Led
        color={termConnected ? ($terminalHealth === 'webgl-fallback' ? 'red' : 'cyan') : 'off'}
        label="Term"
        sublabel={$terminalHealth === 'webgl-fallback' ? 'canvas' : undefined}
      />
    </div>

    <IconButton
      icon={$theme === 'dark' ? 'light_mode' : 'dark_mode'}
      size={18}
      title="Toggle theme"
      onclick={toggleTheme}
    />
    <IconButton
      icon="forum"
      size={18}
      title="AI Assistant"
      on={chatOpen}
      onclick={onToggleChat}
    />
  </div>
</header>
