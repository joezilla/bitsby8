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

  type NavId = 'terminal' | 'disks' | 'clients' | 'cassettes' | 'catalog' | 'profiles' | 'machines' | 'scripts' | 'config';

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
  const navItems: NavItem[] = $derived([
    { id: 'terminal',  label: 'Terminal',  icon: 'monitor',  badge: () => null },
    { id: 'disks',     label: 'Disks',     icon: 'save',     badge: () => driveBadge },
    ...(multiEnabled
      ? [{ id: 'clients' as NavId, label: 'Clients', icon: 'devices', badge: () => (clientCount > 0 ? String(clientCount) : null) }]
      : []),
    { id: 'cassettes', label: 'Cassettes', icon: 'album',    badge: () => null },
    { id: 'catalog',   label: 'Catalog',   icon: 'developer_board', badge: () => null },
    { id: 'profiles',  label: 'Profiles',  icon: 'dns',      badge: () => null },
    { id: 'machines',  label: 'Machines',  icon: 'lan',      badge: () => null },
    { id: 'scripts',   label: 'Scripts',   icon: 'terminal', badge: () => null },
    { id: 'config',    label: 'Config',    icon: 'tune',     badge: () => null },
  ]);

  function go(id: NavId): void {
    onNavigate?.(id);
  }
</script>

<nav
  aria-label="Primary navigation"
  style="
    width: 220px;
    flex: 0 0 220px;
    background: var(--surface);
    border-right: 1px solid var(--border-1);
    display: flex;
    flex-direction: column;
    padding: 16px 0;
    min-height: 0;
    overflow-y: auto;
  "
>
  <div style="padding: 0 16px 8px;">
    <span class="fdc-label-strip" style="font-size: 9px;">Navigation</span>
  </div>

  <div style="display: flex; flex-direction: column; gap: 2px; padding: 0 8px;">
    {#each navItems as item}
      {@const isActive = item.id === active}
      {@const badge = item.badge()}
      <button
        type="button"
        aria-current={isActive ? 'page' : undefined}
        onclick={() => go(item.id)}
        style="
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 12px;
          border-radius: var(--radius-md);
          background: {isActive ? 'var(--accent-bg)' : 'transparent'};
          border: none;
          color: {isActive ? 'var(--accent)' : 'var(--fg-2)'};
          font: var(--text-label);
          font-size: 13px;
          font-weight: {isActive ? 600 : 500};
          cursor: pointer;
          text-align: left;
          position: relative;
          transition: background var(--dur-short) var(--ease-standard),
                      color var(--dur-short) var(--ease-standard);
        "
      >
        {#if isActive}
          <span
            aria-hidden="true"
            style="
              position: absolute;
              left: -8px;
              top: 8px;
              bottom: 8px;
              width: 3px;
              border-radius: 999px;
              background: var(--accent);
              box-shadow: var(--led-halo-amber);
            "
          ></span>
        {/if}
        <Icon name={item.icon} filled={isActive} size={20} />
        <span style="flex: 1;">{item.label}</span>
        {#if badge}
          <span
            class="fdc-mono"
            style="font-size: 11px; color: {isActive ? 'var(--accent)' : 'var(--fg-3)'};"
          >
            {badge}
          </span>
        {/if}
      </button>
    {/each}
  </div>

  <!-- Footer system info card -->
  <div style="padding: 16px 16px 4px;">
    <div
      class="card"
      style="padding: 12px; background: var(--surface-variant); border-radius: 10px;"
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
