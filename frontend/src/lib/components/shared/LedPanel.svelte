<script lang="ts">
  import StatusLed from './StatusLed.svelte';
  import { serverStatus, terminalStatus, connected } from '$lib/services/socket';
  import type { DriveState } from '$lib/types/api';

  let drives: DriveState[] = $derived($serverStatus?.drives ?? []);
  let serialConnected = $derived($serverStatus?.serial.connected ?? false);
  let diskServingRunning = $derived($serverStatus?.diskServing.running ?? false);
  let termConnected = $derived($terminalStatus?.connected ?? false);
</script>

<div class="flex items-center gap-4 text-xs">
  <!-- Connection status -->
  <StatusLed
    color={$connected ? 'green' : 'red'}
    pulse={!$connected}
    label={$connected ? 'Online' : 'Offline'}
  />

  <!-- Serial -->
  <StatusLed
    color={serialConnected ? 'cyan' : 'off'}
    label="Serial"
  />

  <!-- Disk serving -->
  <StatusLed
    color={diskServingRunning ? 'green' : 'off'}
    label="FDC"
  />

  <!-- Drive LEDs -->
  <div class="flex items-center gap-2 border-l border-border pl-3">
    {#each drives as drive}
      <div class="flex items-center gap-1" title="Drive {drive.id}">
        <span class="text-text-dim font-retro">{drive.id}:</span>
        <StatusLed
          color={drive.mounted ? (drive.headLoaded ? 'amber' : 'green') : 'off'}
          pulse={drive.headLoaded}
        />
      </div>
    {/each}
  </div>

  <!-- Terminal -->
  <div class="border-l border-border pl-3">
    <StatusLed
      color={termConnected ? 'cyan' : 'off'}
      label="Term"
    />
  </div>
</div>
