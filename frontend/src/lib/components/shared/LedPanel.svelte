<script lang="ts">
  import Led from './Led.svelte';
  import { serverStatus, terminalStatus, connected } from '$lib/services/socket';
  import type { DriveState } from '$lib/types/api';

  let drives: DriveState[] = $derived($serverStatus?.drives ?? []);
  let serialConnected = $derived($serverStatus?.serial.connected ?? false);
  let diskServingRunning = $derived($serverStatus?.diskServing.running ?? false);
  let termConnected = $derived($terminalStatus?.connected ?? false);
</script>

<div class="flex items-center gap-4 text-xs">
  <!-- Connection status -->
  <Led
    color={$connected ? 'green' : 'red'}
    pulse={!$connected}
    label={$connected ? 'Online' : 'Offline'}
  />

  <!-- Serial -->
  <Led
    color={serialConnected ? 'cyan' : 'off'}
    label="Serial"
  />

  <!-- Disk serving (FDC) -->
  <Led
    color={diskServingRunning ? 'green' : 'off'}
    label="FDC"
  />

  <!-- Drive LEDs -->
  <div class="flex items-center gap-2 border-l border-border pl-3">
    {#each drives as drive}
      <div class="flex items-center gap-1" title="Drive {drive.id}">
        <span class="fdc-label-strip" style="font-size: 9px;">{drive.id}</span>
        <Led
          color={drive.mounted ? (drive.headLoaded ? 'amber' : 'green') : 'off'}
          pulse={drive.headLoaded}
        />
      </div>
    {/each}
  </div>

  <!-- Terminal -->
  <div class="border-l border-border pl-3">
    <Led
      color={termConnected ? 'cyan' : 'off'}
      label="Term"
    />
  </div>
</div>
