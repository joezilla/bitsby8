<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/services/api';
  import { serverStatus } from '$lib/services/socket';
  import { showToast } from '$lib/stores/toast';
  import PageHeader from '$lib/components/shared/PageHeader.svelte';
  import Card from '$lib/components/shared/Card.svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import IconButton from '$lib/components/shared/IconButton.svelte';
  import Chip from '$lib/components/shared/Chip.svelte';
  import Input from '$lib/components/shared/Input.svelte';
  import Select from '$lib/components/shared/Select.svelte';
  import LabelStrip from '$lib/components/shared/LabelStrip.svelte';
  import type { ClientBay, DiskImageInfo } from '$lib/types/api';

  let clients = $state<ClientBay[]>([]);
  let images = $state<DiskImageInfo[]>([]);
  let loading = $state(true);
  let newClientId = $state('');
  let nameEdits = $state<Record<string, string>>({});

  let multiEnabled = $derived($serverStatus?.multiClient?.enabled ?? false);
  // Reload when the set of connected client ids changes (connect/disconnect).
  let connectedKey = $derived(
    ($serverStatus?.multiClient?.clients ?? []).map((c) => c.clientId ?? c.id).sort().join(',')
  );

  async function load() {
    try {
      loading = true;
      const [c, imgs] = await Promise.all([api.getClients(), api.listImagesDetailed()]);
      clients = c.clients;
      images = imgs.images;
      // Seed name editors without clobbering in-progress edits.
      for (const cl of clients) if (!(cl.clientId in nameEdits)) nameEdits[cl.clientId] = cl.name;
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

  async function saveName(clientId: string) {
    try {
      await api.setClientName(clientId, (nameEdits[clientId] ?? '').trim());
      showToast('Name saved', 'success');
      await load();
    } catch (err: any) {
      showToast(`Save failed: ${err.message}`, 'error');
    }
  }

  async function forgetClient(clientId: string) {
    if (!confirm(`Forget client "${clientId}"? This clears its drive overrides, splinters, and name.`)) return;
    try {
      await api.forgetClient(clientId);
      delete nameEdits[clientId];
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

  function sourceChip(source: string): { color: 'cyan' | 'green' | 'amber'; text: string } {
    if (source === 'override') return { color: 'cyan', text: 'Override' };
    if (source === 'global') return { color: 'green', text: 'Inherited' };
    return { color: 'amber', text: 'Empty' };
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
    <Card><div style="padding: 20px; color: var(--fg-3);">Loading…</div></Card>
  {:else if clients.length === 0}
    <Card><div style="padding: 20px; color: var(--fg-3);">No known clients yet. Connect a client with <code>?clientId=…</code> or add one above.</div></Card>
  {/if}

  {#each clients as client (client.clientId)}
    <Card>
      <div style="padding: 16px 20px; display: flex; flex-direction: column; gap: 14px;">
        <!-- Header -->
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;">
          <div style="min-width: 0;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span class="fdc-mono" style="font-size: 15px; color: var(--accent);">{client.clientId}</span>
              {#if client.connected}<Chip color="green" icon="bolt">connected</Chip>{:else}<Chip color="amber">offline</Chip>{/if}
              {#if client.isMaster}<Chip color="green" icon="edit">master</Chip>{/if}
              {#if client.hasSplinters}<Chip color="cyan" icon="content_copy">splinters</Chip>{/if}
            </div>
            <div style="display: flex; align-items: center; gap: 6px; margin-top: 8px;">
              <Input placeholder="Friendly name…" bind:value={nameEdits[client.clientId]} />
              <Button variant="tonal" onclick={() => saveName(client.clientId)}>Save name</Button>
            </div>
          </div>
          <IconButton icon="delete_forever" size={18} title="Forget client" onclick={() => forgetClient(client.clientId)} />
        </div>

        <!-- Drive bays -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px;">
          {#each client.drives as d (d.drive)}
            {@const chip = sourceChip(d.source)}
            <div style="border: 1px solid var(--border-1); border-radius: var(--radius-md); padding: 12px;">
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <span class="fdc-label-strip">Drive {d.drive}</span>
                <Chip color={chip.color}>{chip.text}</Chip>
              </div>
              <div class="fdc-mono" style="font-size: 12px; color: var(--fg-1); margin: 6px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                {d.filename ?? '(empty)'}
                {#if d.readonly}<span style="color: var(--fg-3);"> · RO</span>{/if}
                {#if d.dirty}<span style="color: var(--accent);"> · changed</span>{/if}
              </div>
              <div style="display: flex; gap: 6px; align-items: center;">
                <Select
                  value=""
                  onchange={(e) => setDrive(client.clientId, d.drive, (e.target as HTMLSelectElement).value, d.readonly)}
                >
                  <option value="">— set override —</option>
                  {#each images as img}
                    <option value={img.name}>{img.name}</option>
                  {/each}
                </Select>
                {#if d.source === 'override'}
                  <IconButton
                    icon={d.readonly ? 'lock' : 'lock_open'}
                    size={16}
                    title={d.readonly ? 'Make writable' : 'Make read-only'}
                    onclick={() => setDrive(client.clientId, d.drive, d.filename!, !d.readonly)}
                  />
                  <IconButton icon="undo" size={16} title="Inherit global" onclick={() => clearDrive(client.clientId, d.drive)} />
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    </Card>
  {/each}
</div>
