<script lang="ts">
  import type { InstanceStatus } from '$lib/types/api';
  import { api } from '$lib/services/api';
  import { socket } from '$lib/services/socket';
  import { showToast } from '$lib/stores/toast';
  import Icon from '$lib/components/shared/Icon.svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import DriveCard from '$lib/components/shared/DriveCard.svelte';
  import DiskPicker from '$lib/components/shared/DiskPicker.svelte';
  import InstanceConsole from '$lib/components/machines/InstanceConsole.svelte';
  import MonitorPanel from '$lib/components/machines/MonitorPanel.svelte';
  import FrontPanel from '$lib/components/machines/FrontPanel.svelte';
  import { getCockpitLayout, setCockpitLayout } from '$lib/stores/cockpitLayout';
  import { getKeyboardRoute, setKeyboardRoute, AUTO_ROUTE } from '$lib/stores/keyboardRoute';
  import { onMount } from 'svelte';

  interface Props {
    instance: InstanceStatus;
    onBack: () => void;
    /** Called after a lifecycle change (stop) so the parent can refresh. */
    onChanged?: () => void;
    /** Deep-link to this machine's profile editor (W1). */
    onProfile?: (ref: string) => void;
  }
  let { instance, onBack, onChanged, onProfile }: Props = $props();

  const profileLinkable = $derived(!!instance.profileRef && instance.profileRef !== 'inline');

  // Drives panel (W2): a VM owns its drives, so we manage them right here — swap /
  // eject / insert / write-protect operate on this instance's own `inst:` client
  // via the shared client-drive API; the running guest hot-reloads live.
  let picker = $state<number | null>(null);
  const bindingFor = (drive: number) => instance.disks.find((d) => d.drive === drive);
  const mountedCount = $derived(instance.disks.filter((d) => d.filename).length);

  async function refresh() {
    onChanged?.();
  }
  async function setDrive(drive: number, filename: string, readonly: boolean) {
    picker = null;
    try {
      await api.setClientDrive(instance.clientId, drive, filename, readonly);
      showToast(`Drive ${drive} → ${filename}`, 'success');
      await refresh();
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  }
  async function ejectDrive(drive: number) {
    try {
      await api.clearClientDrive(instance.clientId, drive);
      showToast(`Drive ${drive} ejected`, 'success');
      await refresh();
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  }
  function toggleRo(drive: number) {
    const b = bindingFor(drive);
    if (b?.filename) void setDrive(drive, b.filename, !b.readonly);
  }

  // Panel collapse/maximize state is remembered per machine (keyed by instance
  // id) so re-opening a cockpit — or navigating away and back — restores it
  // instead of snapping to defaults.
  // svelte-ignore state_referenced_locally -- one-time read; RunView is remounted per instance
  const saved = getCockpitLayout(instance.id);
  // Console + monitor layout: both 50/50, or one maximized (the other a rail).
  let duo = $state<'both' | 'cmax' | 'mmax'>(saved.duo);
  let frontPanelOpen = $state(saved.frontPanelOpen);
  let drivesOpen = $state(saved.drivesOpen);
  let busy = $state(false);

  // Persist any change back to the per-machine layout store.
  $effect(() => {
    setCockpitLayout(instance.id, { duo, frontPanelOpen, drivesOpen });
  });

  // Keyboard routing. By default the cockpit derives the target ('auto'); the
  // operator can pin it to the serial console or a specific keyboard card, and
  // the choice is remembered per profile. The card list drives the picker.
  let keyboards = $state<{ cardId: string; pending: number }[]>([]);
  const hasKeyboard = $derived(keyboards.length > 0);
  // svelte-ignore state_referenced_locally -- one-time seed; validated once cards load
  let route = $state<string>(getKeyboardRoute(instance.profileRef));

  // Picker options: Auto, the single serial console, then every keyboard card.
  // (Multiple *serial* ports as distinct targets aren't wired for input yet —
  // only the designated console is.)
  const routeOptions = $derived([
    { value: AUTO_ROUTE, label: 'Auto' },
    { value: 'serial', label: 'Serial console' },
    ...keyboards.map((k) => ({ value: `kbd:${k.cardId}`, label: `Keyboard · ${k.cardId}` })),
  ]);

  onMount(async () => {
    try {
      keyboards = (await api.listInstanceKeyboards(instance.id)).keyboards;
    } catch {
      /* not running / no keyboard */
    }
    // A stored kbd:<cardId> can go stale if the profile was re-carded — fall back.
    if (!routeOptions.some((o) => o.value === route)) route = AUTO_ROUTE;
  });

  // Remember the choice per profile (survives re-spun transient instances).
  $effect(() => {
    setKeyboardRoute(instance.profileRef, route);
  });

  async function stop() {
    try {
      busy = true;
      await api.stopInstance(instance.id);
      showToast('Machine stopped', 'success');
      onChanged?.();
      onBack();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      busy = false;
    }
  }

  const toSerial = (data: string) =>
    socket.emit('instance:console:write', { instanceId: instance.id, data });
  const toKeyboard = (byte: number, cardId?: string) =>
    api.sendInstanceKey(instance.id, { byte, cardId }).catch(() => {});

  // Physical-keyboard routing. When the serial console's xterm is focused it
  // captures input directly (the TEXTAREA guard below bails), so focus always
  // wins for the console pane. Otherwise the `route` decides: an explicit
  // 'serial'/'kbd:<cardId>' override, or 'auto' — a machine with a keyboard card
  // feeds its keyboard port, a serial-only machine forwards to the console when
  // the monitor is maximized.
  function onKey(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    // The console xterm's helper element is a TEXTAREA — when it's focused, let
    // it handle input; likewise skip any real form field.
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    let data = '';
    if (e.key === 'Enter') data = '\r';
    else if (e.key === 'Backspace') data = '\x7f';
    else if (e.key === 'Tab') data = '\t';
    else if (e.key === 'Escape') data = '\x1b';
    else if (e.key.length === 1) data = e.key;
    else return;
    e.preventDefault();
    // Explicit override wins over the auto heuristic.
    if (route === 'serial') return void toSerial(data);
    if (route.startsWith('kbd:')) return void toKeyboard(data.charCodeAt(0), route.slice(4));
    // route === 'auto'
    if (hasKeyboard) return void toKeyboard(data.charCodeAt(0));
    if (duo === 'mmax') toSerial(data);
  }

  const hz = $derived(
    instance.effectiveHz ? `${(instance.effectiveHz / 1_000_000).toFixed(1)} MHz` : '',
  );
</script>

<svelte:window onkeydown={onKey} />

<div class="fdc-page-body cockpit">
  <!-- Header -->
  <div class="top">
    <div class="id">
      <span class="dot"></span>
      {#if profileLinkable && onProfile}
        <button type="button" class="name link fdc-mono" title="Open profile {instance.profileRef}" onclick={() => onProfile?.(instance.profileRef)}>
          {instance.profileRef}<Icon name="arrow_outward" size={14} />
        </button>
      {:else}
        <span class="name fdc-mono">{instance.profileRef}</span>
      {/if}
      <span class="meta">
        {#if hz}<span class="chip">{hz}</span>{/if}
        <span class="chip run">running</span>
        <label class="kbroute" title="Where your keyboard is delivered to this machine">
          <span class="kbicon">⌨ →</span>
          <select bind:value={route} aria-label="Keyboard routing">
            {#each routeOptions as opt (opt.value)}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        </label>
      </span>
    </div>
    <div class="actions">
      <Button variant="outline" size="sm" icon="stop" onclick={stop} disabled={busy}>Stop</Button>
      <Button variant="ghost" size="sm" icon="arrow_back" onclick={onBack}>Machines</Button>
    </div>
  </div>

  <div class="stack">
    <!-- Live Altair-style front panel — CPU introspection + examine/deposit/step -->
    <FrontPanel instanceId={instance.id} bind:open={frontPanelOpen} initialBase={instance.panelBase} />

    <!-- Drives — this VM's own bays (swap/eject/insert live) -->
    <div class="panel">
      <button class="fphead" onclick={() => (drivesOpen = !drivesOpen)}>
        <span class="ptitle">
          <span class="chev {drivesOpen ? 'open' : ''}">▶</span>
          <Icon name="save" size={16} /> Drives
          <span class="psub">{mountedCount} of 4 mounted</span>
        </span>
      </button>
      {#if drivesOpen}
        <div class="drives-body">
          {#each [0, 1, 2, 3] as id (id)}
            {@const b = bindingFor(id)}
            <DriveCard
              num={id}
              hasDisk={!!b?.filename}
              filename={b?.filename ?? null}
              protectedRo={!!b?.readonly}
              dirty={!!b?.dirty}
              status={b?.filename ? { color: 'green', text: 'Mounted' } : { color: 'off', text: 'Empty' }}
              emptyText="No disk"
              onEject={() => ejectDrive(id)}
              onSwap={() => (picker = id)}
              onToggleRo={() => toggleRo(id)}
              onInsert={() => (picker = id)}
            />
          {/each}
        </div>
      {/if}
    </div>

    <!-- Console | Monitor -->
    <div class="duo {duo}">
      <div class="pane console panel">
        <div class="phead">
          <span class="ptitle"><Icon name="terminal" size={16} /> Console <span class="psub">serial</span></span>
          <span class="hright">
            <span class="kbd">⌨ keyboard</span>
            <button class="mx" title="Maximize monitor" onclick={() => (duo = 'mmax')}>❮ hide</button>
          </span>
        </div>
        <div class="pbody"><InstanceConsole instanceId={instance.id} title={instance.profileRef} embedded autofocus={route === AUTO_ROUTE} /></div>
        <button class="rail" onclick={() => (duo = 'both')}>
          <span class="exp">❯</span><span class="railtxt">CONSOLE</span><span class="kbmini">⌨</span>
        </button>
      </div>

      <div class="pane monitor panel">
        <div class="phead">
          <span class="ptitle"><Icon name="monitor" size={16} /> Monitor <span class="psub">VDM</span></span>
          <span class="hright"><button class="mx" title="Maximize console" onclick={() => (duo = 'cmax')}>hide ❯</button></span>
        </div>
        <div class="pbody"><MonitorPanel instanceId={instance.id} title={instance.profileRef} embedded active={duo !== 'cmax'} /></div>
        <button class="rail" onclick={() => (duo = 'both')}>
          <span class="exp">❮</span><span class="railtxt">MONITOR</span><span></span>
        </button>
      </div>
    </div>
    <p class="kbcap">
      <Icon name="keyboard" size={14} />
      {#if route === 'serial'}
        Keyboard pinned to the serial console — typing hits the console port even when the monitor is maximized.
      {:else if route.startsWith('kbd:')}
        Keyboard pinned to card <span class="fdc-mono">{route.slice(4)}</span> — type anywhere outside the console to hit its data port.
      {:else if hasKeyboard}
        Auto: keyboard feeds this machine's keyboard card — type anywhere outside the console to hit its data port. Focus the console pane to talk to the serial port instead.
      {:else}
        Auto: keyboard routes to the serial console — typing hits the console port even when the monitor is maximized.
      {/if}
    </p>
  </div>
</div>

{#if picker !== null}
  <DiskPicker
    title="Set disk · Drive {picker}"
    hint={instance.profileRef}
    onPick={(f) => setDrive(picker!, f, bindingFor(picker!)?.readonly ?? false)}
    onClose={() => (picker = null)}
  />
{/if}

<style>
  .cockpit { display: flex; flex-direction: column; padding-top: var(--space-4); }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: var(--space-4); }
  .id { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--success); box-shadow: 0 0 0 4px rgba(34, 192, 143, 0.15); flex: none; }
  .name { font-size: 18px; font-weight: 600; }
  button.name { display: inline-flex; align-items: center; gap: 3px; background: none; border: none; padding: 0;
    color: var(--fg-1); cursor: pointer; }
  button.name :global(.icon) { color: var(--fg-4); transition: color var(--dur-short) var(--ease-standard); }
  button.name:hover { color: var(--accent); text-decoration: underline; }
  button.name:hover :global(.icon) { color: var(--accent); }
  .meta { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .chip { font: var(--text-body-sm); font-family: var(--font-mono, monospace); font-size: 11.5px; color: var(--fg-2);
    background: var(--surface-variant); border: 1px solid var(--border-1); padding: 2px 9px; border-radius: 999px; }
  .link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: var(--radius-xs); }
  .chip.run { color: var(--success); background: rgba(34, 192, 143, 0.1); border-color: rgba(34, 192, 143, 0.28); }
  .kbroute { display: inline-flex; align-items: center; gap: 5px; color: var(--accent); background: var(--accent-bg);
    border: 1px solid rgba(255, 176, 32, 0.3); padding: 1px 6px 1px 9px; border-radius: 999px;
    font-family: var(--font-mono, monospace); font-size: 11.5px; }
  .kbroute .kbicon { flex: none; }
  .kbroute select { appearance: none; -webkit-appearance: none; background: none; border: none; color: var(--accent);
    font: inherit; padding: 1px 2px; cursor: pointer; outline: none; }
  .kbroute select:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-radius: var(--radius-xs); }
  .kbroute :global(option) { color: var(--fg-1); background: var(--surface); }
  .actions { display: flex; gap: var(--space-2); }
  .stack { display: flex; flex-direction: column; gap: var(--space-3); }

  .panel { background: var(--surface); border: 1px solid var(--border-1); border-radius: var(--radius-lg); overflow: hidden; }
  .drives-body { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr)); gap: var(--space-3); padding: var(--space-3); }
  .phead, .fphead { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
    padding: var(--space-2) var(--space-3); background: var(--surface-raised); border-bottom: 1px solid var(--border-1); }
  .fphead { width: 100%; cursor: pointer; border: none; text-align: left; }
  .ptitle { display: flex; align-items: center; gap: var(--space-2); font-size: 12px; font-weight: 600; color: var(--fg-1); }
  .chev { color: var(--fg-3); font-size: 11px; transition: transform 0.15s ease; }
  .chev.open { transform: rotate(90deg); }
  .psub { font-family: var(--font-mono, monospace); font-size: 10.5px; color: var(--fg-4); text-transform: uppercase; letter-spacing: 0.06em; }
  .hright { display: flex; align-items: center; gap: var(--space-2); }
  .kbd { font-family: var(--font-mono, monospace); font-size: 10px; color: var(--accent); background: var(--accent-bg);
    border: 1px solid rgba(255, 176, 32, 0.3); padding: 2px 7px; border-radius: 5px; }
  .mx { background: none; border: 1px solid var(--border-2); border-radius: 6px; color: var(--fg-3); cursor: pointer; font-size: 12px; padding: 2px 8px; }
  .mx:hover { color: var(--fg-1); border-color: var(--border-3); }

  /* console | monitor — maximize to side */
  .duo { display: flex; gap: var(--space-3); align-items: stretch; min-height: 420px; }
  .pane { display: flex; flex-direction: column; overflow: hidden; transition: flex 0.22s ease; min-width: 0; }
  .duo.both .pane { flex: 1 1 0; }
  .duo.cmax .console { flex: 1 1 0; } .duo.cmax .monitor { flex: 0 0 48px; }
  .duo.mmax .monitor { flex: 1 1 0; } .duo.mmax .console { flex: 0 0 48px; }
  .pbody { flex: 1; min-height: 0; display: flex; }
  .pbody > :global(.panel.embed) { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .rail { display: none; }
  .duo.cmax .monitor .phead, .duo.cmax .monitor .pbody { display: none; }
  .duo.mmax .console .phead, .duo.mmax .console .pbody { display: none; }
  .duo.cmax .monitor .rail, .duo.mmax .console .rail { display: flex; }
  .rail { flex-direction: column; align-items: center; justify-content: space-between; background: var(--surface-raised);
    border: none; cursor: pointer; color: var(--fg-2); width: 100%; height: 100%; padding: 14px 0; }
  .rail:hover { color: var(--fg-1); background: var(--surface-variant); }
  .railtxt { writing-mode: vertical-rl; transform: rotate(180deg); font-family: var(--font-mono, monospace); font-size: 12px; letter-spacing: 0.16em; font-weight: 600; }
  .rail .exp { font-size: 14px; color: var(--accent); } .rail .kbmini { font-size: 11px; color: var(--accent); }
  .kbcap { font-family: var(--font-mono, monospace); font-size: 11px; color: var(--fg-4); display: flex; align-items: center; gap: 6px; margin: 0; }

  @media (max-width: 820px) { .duo { flex-direction: column; min-height: 0; } }
</style>
