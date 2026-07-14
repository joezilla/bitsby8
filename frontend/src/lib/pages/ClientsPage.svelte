<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/services/api';
  import { serverStatus } from '$lib/services/socket';
  import { showToast } from '$lib/stores/toast';
  import PageHeader from '$lib/components/shared/PageHeader.svelte';
  import Card from '$lib/components/shared/Card.svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import IconButton from '$lib/components/shared/IconButton.svelte';
  import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
  import EmptyState from '$lib/components/shared/EmptyState.svelte';
  import Input from '$lib/components/shared/Input.svelte';
  import Icon from '$lib/components/shared/Icon.svelte';
  import Modal from '$lib/components/shared/Modal.svelte';
  import DiskPicker from '$lib/components/shared/DiskPicker.svelte';
  import DriveCard from '$lib/components/shared/DriveCard.svelte';
  import type { ClientBay, ClientDrive } from '$lib/types/api';
  import { pendingRunInstance } from '$lib/stores/pendingRun';
  import { pendingClientFocus } from '$lib/stores/pendingClientFocus';
  import { pendingDiskFocus } from '$lib/stores/pendingDiskFocus';

  interface Props {
    onNavigate?: (page: 'terminal' | 'machines' | 'disks' | 'drives') => void;
  }
  let { onNavigate }: Props = $props();

  /** Deep-link a client's mounted disk to its library entry (inspect the image). */
  function goDisk(filename: string): void {
    pendingDiskFocus.set(filename);
    onNavigate?.('disks');
  }

  /** Provenance (Epic 6.4): where a drive's mount *originates*, so you can manage
   *  it at the source. A 'global' mount is the served spindle → Drive Bays; a
   *  'profile' mount comes from the VM's own definition → open the machine. */
  function driveOrigin(client: ClientBay, d: ClientDrive): (() => void) | undefined {
    if (d.source === 'global') return () => onNavigate?.('drives');
    if (d.source === 'profile' && client.isInstance && client.instanceExists && client.instanceId) {
      const id = client.instanceId;
      return () => openMachine(id);
    }
    return undefined;
  }

  let clients = $state<ClientBay[]>([]);
  let loading = $state(true);
  let newClientId = $state('');
  let focusId = $state<string | null>(null); // briefly highlighted after a deep-link

  const orphans = $derived(clients.filter((c) => c.isInstance && !c.instanceExists));

  // Deep-link from a machine → highlight + scroll to its client once loaded.
  $effect(() => {
    const want = $pendingClientFocus;
    if (want && clients.some((c) => c.clientId === want)) {
      focusId = want;
      pendingClientFocus.set(null);
      requestAnimationFrame(() => {
        document.getElementById(`client-${want}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      setTimeout(() => { if (focusId === want) focusId = null; }, 2600);
    }
  });

  function openMachine(instanceId: string) {
    pendingRunInstance.set(instanceId);
    onNavigate?.('machines');
  }

  async function cleanupOrphans() {
    if (!confirm(`Clean up ${orphans.length} orphaned machine client(s)? This clears the splinters, overrides, and labels left by deleted machines.`)) return;
    try {
      const { cleaned } = await api.cleanupOrphanClients();
      showToast(`Cleaned up ${cleaned.length} orphaned client(s)`, 'success');
      await load();
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  }

  // "Edit friendly name" modal — opened from the pencil icon on each client card.
  let nameModal = $state<{ clientId: string } | null>(null);
  let nameModalValue = $state('');
  let nameModalBusy = $state(false);

  // "Keep splinter changes" modal — commit to master, save as a snapshot, or
  // publish as a new disk.
  let splinterModal = $state<{ clientId: string; drive: number; filename: string } | null>(null);
  let splinterLabel = $state('');
  let splinterNewName = $state('');
  let splinterBusy = $state(false);

  // Modal disk picker — set/change a client drive's override image. Opened
  // from the "change disk" (swap) control on each bay.
  let diskPicker = $state<{ clientId: string; drive: number; readonly: boolean } | null>(null);

  let multiEnabled = $derived($serverStatus?.multiClient?.enabled ?? false);

  function openDiskPicker(clientId: string, drive: number, readonly: boolean) {
    diskPicker = { clientId, drive, readonly };
  }

  async function pickDisk(filename: string) {
    if (!diskPicker) return;
    const { clientId, drive, readonly } = diskPicker;
    diskPicker = null;
    await setDrive(clientId, drive, filename, readonly);
  }
  // Reload when the set of connected client ids changes (connect/disconnect).
  let connectedKey = $derived(
    ($serverStatus?.multiClient?.clients ?? []).map((c) => c.clientId ?? c.id).sort().join(',')
  );

  async function load() {
    try {
      loading = true;
      clients = (await api.getClients()).clients;
    } catch (err: any) {
      showToast(`Failed to load clients: ${err.message}`, 'error');
    } finally {
      loading = false;
    }
  }

  onMount(load);
  // Re-fetch full detail whenever connections change.
  let lastKey = '';
  $effect(() => {
    if (connectedKey !== lastKey) {
      lastKey = connectedKey;
      if (!loading) load();
    }
  });

  async function addClient() {
    const id = newClientId.trim();
    if (!id) return;
    if (/[\\/]/.test(id) || id.includes('..')) {
      showToast('Invalid client id', 'warning');
      return;
    }
    try {
      await api.setClientName(id, '');
      newClientId = '';
      await load();
      showToast(`Added client "${id}"`, 'success');
    } catch (err: any) {
      showToast(`Add failed: ${err.message}`, 'error');
    }
  }

  function openNameModal(client: ClientBay) {
    nameModal = { clientId: client.clientId };
    nameModalValue = client.name ?? '';
  }

  async function saveNameModal() {
    if (!nameModal) return;
    nameModalBusy = true;
    try {
      await api.setClientName(nameModal.clientId, nameModalValue.trim());
      showToast('Name saved', 'success');
      nameModal = null;
      await load();
    } catch (err: any) {
      showToast(`Save failed: ${err.message}`, 'error');
    } finally {
      nameModalBusy = false;
    }
  }

  async function forgetClient(clientId: string) {
    if (!confirm(`Forget client "${clientId}"? This clears its drive overrides, splinters, and name.`)) return;
    try {
      await api.forgetClient(clientId);
      showToast(`Forgot ${clientId}`, 'success');
      await load();
    } catch (err: any) {
      showToast(`Forget failed: ${err.message}`, 'error');
    }
  }

  async function setDrive(clientId: string, drive: number, filename: string, readonly: boolean) {
    if (!filename) return;
    try {
      await api.setClientDrive(clientId, drive, filename, readonly);
      showToast(`Drive ${drive}: ${filename}`, 'success');
      await load();
    } catch (err: any) {
      showToast(`Set failed: ${err.message}`, 'error');
    }
  }

  async function clearDrive(clientId: string, drive: number) {
    try {
      await api.clearClientDrive(clientId, drive);
      showToast(`Drive ${drive} inherits global`, 'success');
      await load();
    } catch (err: any) {
      showToast(`Clear failed: ${err.message}`, 'error');
    }
  }

  function openSplinter(clientId: string, drive: number, filename: string) {
    splinterModal = { clientId, drive, filename };
    splinterLabel = '';
    splinterNewName = '';
  }

  async function commitSplinter() {
    if (!splinterModal) return;
    if (!confirm(
      `Commit this splinter onto master "${splinterModal.filename}"?\n\n` +
      `This overwrites the master image AND hot-swaps every attached client currently ` +
      `reading this disk to the new contents. Any operator read-only/transient view of ` +
      `this disk is re-cut from the committed base (unsaved transient scratch is lost). ` +
      `Clients with their own splinter keep their changes.`,
    )) return;
    splinterBusy = true;
    try {
      const res = await api.commitClientSplinter(splinterModal.clientId, splinterModal.drive);
      const note = res.reloadedDrives?.length ? ` (reloaded drive${res.reloadedDrives.length > 1 ? 's' : ''} ${res.reloadedDrives.join(', ')})` : '';
      showToast(`Committed splinter to master${note}`, 'success');
      splinterModal = null;
      await load();
    } catch (err: any) {
      // 409 = base held read-write by a live master; keep the modal open so the
      // operator can pick "Save as new disk" instead.
      showToast(`Commit failed: ${err.message}`, 'error');
    } finally {
      splinterBusy = false;
    }
  }

  async function snapshotSplinter() {
    if (!splinterModal) return;
    splinterBusy = true;
    try {
      await api.saveClientSplinterSnapshot(splinterModal.clientId, splinterModal.drive, splinterLabel.trim());
      showToast('Saved splinter snapshot', 'success');
      splinterModal = null;
      await load();
    } catch (err: any) {
      showToast(`Snapshot failed: ${err.message}`, 'error');
    } finally {
      splinterBusy = false;
    }
  }

  async function saveSplinterAsDisk() {
    if (!splinterModal) return;
    const name = splinterNewName.trim();
    if (!name) {
      showToast('Enter a name for the new disk', 'warning');
      return;
    }
    splinterBusy = true;
    try {
      const res = await api.saveClientSplinterAsDisk(splinterModal.clientId, splinterModal.drive, name);
      showToast(`Saved splinter as ${res.filename}`, 'success');
      splinterModal = null;
      await load();
    } catch (err: any) {
      showToast(`Save failed: ${err.message}`, 'error');
    } finally {
      splinterBusy = false;
    }
  }

  function driveStatus(d: ClientDrive): { color: 'cyan' | 'green' | 'off'; text: string } {
    if (d.source === 'override') return { color: 'cyan', text: 'Override' };
    if (d.source === 'profile') return { color: 'green', text: 'From machine' };
    if (d.source === 'global') return { color: 'green', text: 'Inherited' };
    return { color: 'off', text: 'Empty' };
  }
</script>

<PageHeader
  eyebrow="Section · Multi-client"
  title="Clients"
  subtitle="Per-client drive bays for persistent virtual clients. A client's override wins over the global mount; unset drives inherit it."
/>

<div class="fdc-page-body" style="display: flex; flex-direction: column; gap: 16px;">
  {#if !multiEnabled}
    <Card>
      <div style="padding: 20px; color: var(--fg-2); font: var(--text-body-sm);">
        Multi-client serving is off. Enable it in <strong>Disks → Settings → Advanced</strong> to
        connect multiple virtual clients and give each its own drive bay. (Pre-provisioning below
        still works, but only applies once a client connects with its id.)
      </div>
    </Card>
  {/if}

  <!-- Add / pre-provision a client -->
  <Card>
    <div style="padding: 16px 20px; display: flex; align-items: flex-end; gap: 8px;">
      <div style="flex: 1; min-width: 0;">
        <label class="fdc-label-strip" for="new-client" style="display: block; margin-bottom: 4px;">Add a client by id (pre-provision)</label>
        <Input id="new-client" placeholder="e.g. altair-lab-1" bind:value={newClientId} />
      </div>
      <Button variant="filled" icon="add" onclick={addClient}>Add</Button>
      <Button variant="ghost" icon="refresh" onclick={load}>Refresh</Button>
    </div>
  </Card>

  {#if loading && clients.length === 0}
    <EmptyState loading>Loading clients…</EmptyState>
  {:else if clients.length === 0}
    <EmptyState icon="devices">No known clients yet. Connect a client with <code>?clientId=…</code> or add one above.</EmptyState>
  {/if}

  {#if orphans.length}
    <Card>
      <div class="orphan-banner">
        <Icon name="warning" size={18} />
        <span><strong>{orphans.length}</strong> orphaned machine client{orphans.length === 1 ? '' : 's'} — splinters and overrides left behind by deleted machines.</span>
        <Button variant="tonal" size="sm" icon="cleaning_services" onclick={cleanupOrphans}>Clean up all</Button>
      </div>
    </Card>
  {/if}

  {#each clients as client (client.clientId)}
    <div id="client-{client.clientId}" class="client-wrap" class:focus={focusId === client.clientId} class:orphan={client.isInstance && !client.instanceExists}>
    <Card>
      <div style="padding: 16px 20px; display: flex; flex-direction: column; gap: 14px;">
        <!-- Header -->
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;">
          <div style="min-width: 0;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span class="fdc-mono" style="font-size: 15px; color: var(--accent);">{client.clientId}</span>
              {#if client.isInstance}
                {#if client.instanceExists}
                  <StatusBadge state="machine" />
                {:else}
                  <StatusBadge state="orphan" label="orphan · machine deleted" />
                {/if}
              {/if}
              {#if client.connected}<StatusBadge state="connected" />{:else}<StatusBadge state="offline" />{/if}
              {#if client.isMaster}<StatusBadge state="master" />{/if}
              {#if client.hasSplinters}<StatusBadge state="unsaved" label="splinters" title="This client has copy-on-write disk splinters with unsaved changes" />{/if}
            </div>
            <div style="margin-top: 6px; font: var(--text-body-sm); color: {client.name ? 'var(--fg-2)' : 'var(--fg-4)'};">
              {client.name || 'No friendly name set'}
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 4px; flex: none;">
            {#if client.isInstance && client.instanceExists && client.instanceId}
              <Button variant="ghost" size="sm" icon="open_in_new" onclick={() => openMachine(client.instanceId!)}>Open machine</Button>
            {/if}
            <IconButton icon="edit" size={18} title="Edit friendly name" onclick={() => openNameModal(client)} />
            <IconButton icon="delete_forever" size={18} title={client.isInstance && !client.instanceExists ? 'Clean up this orphaned machine client' : 'Forget client'} onclick={() => forgetClient(client.clientId)} />
          </div>
        </div>

        <!-- Drive bays -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;">
          {#each client.drives as d (d.drive)}
            <DriveCard
              num={d.drive}
              hasDisk={!!d.filename}
              filename={d.filename}
              protectedRo={d.readonly}
              dirty={d.dirty}
              status={driveStatus(d)}
              emptyText={client.isInstance ? 'Not in machine definition' : 'Inherits global'}
              onOpenFile={goDisk}
              onOrigin={driveOrigin(client, d)}
            >
              {#snippet actions()}
                {#if d.filename}
                  {#if d.source === 'override'}
                    <button
                      type="button"
                      class="dc-sq"
                      title="Clear override — inherit the global mount"
                      onclick={() => clearDrive(client.clientId, d.drive)}
                    >
                      <Icon name="eject" size={18} />
                    </button>
                  {/if}
                  <button
                    type="button"
                    class="dc-sq"
                    title={d.source === 'override' ? 'Change disk' : 'Set an override disk'}
                    onclick={() => openDiskPicker(client.clientId, d.drive, d.readonly)}
                  >
                    <Icon name="swap_horiz" size={18} />
                  </button>
                  {#if d.dirty}
                    <button
                      type="button"
                      class="dc-sq"
                      title="Keep splinter changes…"
                      onclick={() => openSplinter(client.clientId, d.drive, d.filename ?? '')}
                    >
                      <Icon name="save_as" size={18} />
                    </button>
                  {/if}
                  <button
                    type="button"
                    class="dc-toggle {d.readonly ? 'on' : ''}"
                    title={d.source === 'override'
                      ? d.readonly
                        ? 'Set read-write'
                        : 'Set read-only'
                      : d.readonly
                        ? 'Set read-write (pins this disk as a per-client override)'
                        : 'Set read-only (pins this disk as a per-client override)'}
                    onclick={() => setDrive(client.clientId, d.drive, d.filename!, !d.readonly)}
                  >
                    <Icon name={d.readonly ? 'lock' : 'lock_open'} size={16} />
                    {d.readonly ? 'Locked' : 'Unlocked'}
                  </button>
                {:else}
                  <button
                    type="button"
                    class="dc-insert"
                    title="Set disk — choose an override image for this drive"
                    onclick={() => openDiskPicker(client.clientId, d.drive, false)}
                  >
                    <Icon name="input" size={16} />Set disk
                  </button>
                {/if}
              {/snippet}
            </DriveCard>
          {/each}
        </div>
      </div>
    </Card>
    </div>
  {/each}
</div>

<!-- Edit friendly name modal -->
{#if nameModal}
  <Modal title="Edit friendly name" icon="badge" busy={nameModalBusy} onClose={() => (nameModal = null)}>
    <div class="modal-keys" role="none" onkeydown={(e) => { if (e.key === 'Enter' && !nameModalBusy) saveNameModal(); }}>
      <p class="modal-desc">
        A human-friendly label for
        <span class="fdc-mono" style="color: var(--accent);">{nameModal.clientId}</span>.
        Leave blank to clear it.
      </p>
      <div>
        <label class="fdc-label-strip" for="client-name" style="display: block; margin-bottom: 4px;">Name</label>
        <Input id="client-name" placeholder="e.g. Altair Lab 1" bind:value={nameModalValue} disabled={nameModalBusy} />
      </div>
    </div>
    {#snippet footer()}
      <Button variant="ghost" disabled={nameModalBusy} onclick={() => (nameModal = null)}>Cancel</Button>
      <Button variant="filled" icon="check" disabled={nameModalBusy} onclick={saveNameModal}>
        {nameModalBusy ? 'Saving…' : 'Save'}
      </Button>
    {/snippet}
  </Modal>
{/if}

<!-- Disk picker — set/change a client drive's override image -->
{#if diskPicker}
  <DiskPicker
    title="Set disk · drive {diskPicker.drive}"
    hint={diskPicker.clientId}
    onPick={pickDisk}
    onClose={() => (diskPicker = null)}
  />
{/if}

{#if splinterModal}
  <Modal
    title="Keep splinter · {splinterModal.clientId} · drive {splinterModal.drive}"
    icon="save_as"
    busy={splinterBusy}
    onClose={() => (splinterModal = null)}
  >
    <p class="modal-desc">
      This client's copy-on-write splinter of
      <span class="fdc-mono" style="color: var(--accent);">{splinterModal.filename}</span>
      has changes. Save them as a snapshot, publish them as a new disk, or commit them
      back onto the master image.
    </p>
    <div>
      <label class="fdc-label-strip" for="splinter-save-label" style="display: block; margin-bottom: 4px;">Snapshot label (optional)</label>
      <Input id="splinter-save-label" placeholder="e.g. client save" bind:value={splinterLabel} disabled={splinterBusy} />
      <div style="margin-top: 8px;">
        <Button variant="filled" icon="photo_camera" disabled={splinterBusy} onclick={snapshotSplinter}>
          Save as snapshot
        </Button>
      </div>
    </div>
    <div>
      <label class="fdc-label-strip" for="splinter-new-name" style="display: block; margin-bottom: 4px;">New disk name (non-destructive)</label>
      <Input id="splinter-new-name" placeholder="e.g. game-edited" bind:value={splinterNewName} disabled={splinterBusy} />
      <div style="margin-top: 8px;">
        <Button variant="tonal" icon="save_as" disabled={splinterBusy} onclick={saveSplinterAsDisk}>
          Save as new disk
        </Button>
      </div>
    </div>
    <div>
      <p class="modal-desc" style="color: var(--warning); margin-bottom: 8px;">
        Committing overwrites the master and hot-swaps every attached client reading this
        disk to the new contents. Blocked while a live master-write client (or a read-write
        operator mount) holds the disk.
      </p>
      <Button variant="outline" icon="publish" disabled={splinterBusy} onclick={commitSplinter}>
        Commit to master
      </Button>
    </div>
    {#snippet footer()}
      <Button variant="ghost" disabled={splinterBusy} onclick={() => (splinterModal = null)}>Cancel</Button>
    {/snippet}
  </Modal>
{/if}

<style>
  .orphan-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    padding: 12px 18px;
    color: var(--fg-2);
    font: var(--text-body-sm);
  }
  .orphan-banner > span { flex: 1; min-width: 200px; }
  .client-wrap {
    border-radius: var(--radius-lg);
    transition: box-shadow 0.4s ease;
  }
  .client-wrap.orphan {
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--error, #ff6b64) 40%, transparent);
  }
  .client-wrap.focus {
    box-shadow: 0 0 0 2px var(--accent), 0 0 0 6px color-mix(in oklab, var(--accent) 22%, transparent);
  }

  /* Shared modal-body helpers (used with the Modal shell). */
  .modal-keys {
    display: contents;
  }
  .modal-desc {
    margin: 0;
    font: var(--text-body-sm);
    color: var(--fg-3);
  }
</style>
