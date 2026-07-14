<script lang="ts">
  import Icon from '$lib/components/shared/Icon.svelte';
  import Chip from '$lib/components/shared/Chip.svelte';
  import Led from '$lib/components/shared/Led.svelte';
  import { serverStatus, connected } from '$lib/services/socket';
  import type { DriveState } from '$lib/types/api';

  function formatUptime(seconds: number | undefined): string {
    if (seconds === undefined || seconds < 0) return '—';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    return `${m}m`;
  }

  // Compact local time in the user's locale for a footer chip — full ISO is
  // still surfaced as the title attribute for anyone who needs UTC precision.
  function formatBuildTime(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  type NavId = 'terminal' | 'disks' | 'drives' | 'clients' | 'cassettes' | 'catalog' | 'profiles' | 'machines' | 'scripts' | 'config';

  interface Props {
    active: NavId;
    onNavigate?: (id: NavId) => void;
  }

  let { active, onNavigate }: Props = $props();

  const drives: DriveState[] = $derived($serverStatus?.drives ?? []);
  const mountedCount = $derived(drives.filter((d) => d.mounted).length);
  const driveBadge = $derived(drives.length > 0 ? `${mountedCount}/${drives.length}` : null);

  // Multi-client "Clients" nav appears only when the feature is enabled.
  const multiEnabled = $derived($serverStatus?.multiClient?.enabled ?? false);
  const clientCount = $derived($serverStatus?.multiClient?.clients?.length ?? 0);

  type NavItem = { id: NavId; label: string; icon: string; badge: () => string | null };
  type NavGroup = { label: string; items: NavItem[] };
  // Grouped by lifecycle — Build (author the machine) → Operate (run & serve it)
  // → System — mirroring the `Build ·` / `Operate ·` page-header eyebrows.
  const navGroups: NavGroup[] = $derived([
    {
      label: 'Build',
      items: [
        { id: 'catalog',  label: 'Card Catalog',  icon: 'grid_view', badge: () => null },
        { id: 'profiles', label: 'Machine Profiles', icon: 'dns', badge: () => null },
      ],
    },
    {
      label: 'Operate',
      items: [
        { id: 'terminal',  label: 'Terminal',  icon: 'desktop_windows', badge: () => null },
        { id: 'machines',  label: 'Virtual Machines',  icon: 'hub',       badge: () => null },
        { id: 'drives',    label: 'Drive Bays', icon: 'save',   badge: () => driveBadge },
        { id: 'disks',     label: 'Disk Library', icon: 'inventory_2', badge: () => null },
        { id: 'cassettes', label: 'Cassettes', icon: 'album',   badge: () => null },
        ...(multiEnabled
          ? [{ id: 'clients' as NavId, label: 'Disk Clients', icon: 'devices', badge: () => (clientCount > 0 ? String(clientCount) : null) }]
          : []),
        { id: 'scripts',   label: 'Scripts',   icon: 'terminal', badge: () => null },
      ],
    },
    {
      label: 'System',
      items: [
        { id: 'config', label: 'Config', icon: 'tune', badge: () => null },
      ],
    },
  ]);

  function go(id: NavId): void {
    onNavigate?.(id);
  }
</script>

<nav
  aria-label="Primary navigation"
  style="
    width: 272px;
    flex: 0 0 272px;
    background: var(--surface);
    border-right: 1px solid var(--border-1);
    display: flex;
    flex-direction: column;
    padding: 22px 16px 16px;
    min-height: 0;
    overflow-y: auto;
  "
>
  <div style="display: flex; flex-direction: column;">
    {#each navGroups as group, gi}
      <div class="nav-group-label" style="margin-top: {gi === 0 ? '0' : '22px'};">{group.label}</div>
      <div style="display: flex; flex-direction: column; gap: 2px;">
        {#each group.items as item}
          {@const isActive = item.id === active}
          {@const badge = item.badge()}
          <button
            type="button"
            class="nav-item"
            class:active={isActive}
            aria-current={isActive ? 'page' : undefined}
            onclick={() => go(item.id)}
          >
            {#if isActive}
              <span class="nav-item-bar" aria-hidden="true"></span>
            {/if}
            <span class="nav-item-icon"><Icon name={item.icon} size={24} /></span>
            <span class="nav-item-label">{item.label}</span>
            {#if badge}
              <span class="nav-item-badge fdc-mono">{badge}</span>
            {/if}
          </button>
        {/each}
      </div>
    {/each}
  </div>

  <!-- Footer system info card -->
  <div style="margin-top: 18px;">
    <div
      class="card"
      style="padding: 14px 16px; background: var(--surface-variant); border-radius: 14px;"
    >
      <div style="display: flex; align-items: center; gap: 8px;">
        <Led color={$connected ? 'green' : 'off'} pulse={$connected} />
        <span class="fdc-label-strip">System</span>
      </div>
      {#if $serverStatus?.system?.updateAvailable && $serverStatus?.system?.latestVersion && $serverStatus?.system?.latestUrl}
        <div style="margin-top: 8px;">
          <a
            href={$serverStatus.system.latestUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={`Latest release: ${$serverStatus.system.latestVersion}${$serverStatus.system.updateCheckedAt ? ` — checked ${formatBuildTime($serverStatus.system.updateCheckedAt)}` : ''}`}
            style="text-decoration: none;"
          >
            <Chip color="amber" icon="upgrade" size="sm">UPDATE {$serverStatus.system.latestVersion}</Chip>
          </a>
        </div>
      {/if}
      <div
        style="
          margin-top: 8px;
          font: var(--text-body-sm);
          color: var(--fg-2);
          display: grid;
          grid-template-columns: auto 1fr;
          row-gap: 2px;
          column-gap: 8px;
        "
      >
        <span class="fdc-label-strip">VER</span>
        <span class="fdc-mono" style="font-size: 11px;">
          {$serverStatus?.system?.version ?? '—'}{#if $serverStatus?.system?.dirty}<span
            style="color: var(--warning); margin-left: 4px;"
            title="Built from a working tree with uncommitted changes"
          >*</span>{/if}
        </span>
        {#if $serverStatus?.system?.commit}
          <span class="fdc-label-strip">BLD</span>
          <span class="fdc-mono" style="font-size: 11px;" title={$serverStatus?.system?.build ?? undefined}>
            {$serverStatus.system.commit}
          </span>
        {/if}
        {#if $serverStatus?.system?.builtAt}
          <span class="fdc-label-strip">BUILT</span>
          <span class="fdc-mono" style="font-size: 11px;" title={$serverStatus.system.builtAt}>
            {formatBuildTime($serverStatus.system.builtAt)}
          </span>
        {/if}
        <span class="fdc-label-strip">UP</span>
        <span class="fdc-mono" style="font-size: 11px;">{formatUptime($serverStatus?.system?.uptimeSeconds)}</span>
      </div>
    </div>
  </div>
</nav>

<style>
  /* Grouped nav visual refresh — see design project "Nav Sidebar.dc.html".
     Colors are sourced from theme tokens so the rail survives light mode. */
  .nav-group-label {
    font-family: var(--font-data);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--fg-3);
    padding: 0 10px 10px;
  }

  .nav-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 13px;
    height: 44px;
    padding: 0 12px;
    border-radius: 10px;
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    text-align: left;
    transition:
      background var(--dur-short) var(--ease-standard),
      border-color var(--dur-short) var(--ease-standard);
  }
  .nav-item:hover {
    background: color-mix(in oklab, var(--fg-1) 6%, transparent);
  }
  .nav-item.active {
    background: var(--accent-bg);
    border-color: color-mix(in oklab, var(--accent) 30%, transparent);
  }
  .nav-item.active:hover {
    background: color-mix(in oklab, var(--accent) 16%, transparent);
  }

  /* Left accent bar on the active row — reaches into the nav's 16px gutter. */
  .nav-item-bar {
    position: absolute;
    left: -16px;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 22px;
    border-radius: 0 3px 3px 0;
    background: var(--accent);
  }

  .nav-item-icon {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    color: var(--fg-3);
  }
  .nav-item-label {
    flex: 1;
    font-family: var(--font-sans);
    font-size: 15px;
    font-weight: 500;
    letter-spacing: -0.005em;
    color: var(--fg-2);
  }
  .nav-item-badge {
    font-size: 12px;
    font-weight: 500;
    color: var(--fg-3);
  }

  .nav-item.active .nav-item-icon,
  .nav-item.active .nav-item-label,
  .nav-item.active .nav-item-badge {
    color: var(--accent);
  }
  .nav-item.active .nav-item-label {
    font-weight: 600;
  }
</style>
