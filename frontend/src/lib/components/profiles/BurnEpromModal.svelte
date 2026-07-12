<script lang="ts">
  import { api } from '$lib/services/api';
  import { showToast } from '$lib/stores/toast';
  import Button from '$lib/components/shared/Button.svelte';
  import Icon from '$lib/components/shared/Icon.svelte';

  interface Props {
    profileId: string;
    cardId: string;
    /** EPROM window geometry, for a pre-burn hint (optional). */
    region?: { base: number; size: number };
    onClose: () => void;
    /** Called with the new profile version id after a successful burn. */
    onBurned: (newProfileId: string) => void;
  }
  let { profileId, cardId, region, onClose, onBurned }: Props = $props();

  let file = $state<File | null>(null);
  let addressing = $state<'base' | 'file'>('base');
  let busy = $state(false);

  const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, '0')}`;
  const sizeLabel = (n: number) => (n >= 1024 && n % 1024 === 0 ? `${n / 1024} KB` : `${n} bytes`);
  const isHex = $derived(!!file && /\.(hex|ihex|ihx)$/i.test(file.name));

  function pick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    file = input.files?.[0] ?? null;
  }

  function toBase64(bytes: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  async function burn() {
    if (!file) return;
    try {
      busy = true;
      const image = toBase64(new Uint8Array(await file.arrayBuffer()));
      const res = await api.burnEprom(profileId, cardId, { image, addressing, filename: file.name });
      showToast(res.summary, 'success');
      onBurned(res.profile.id);
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      busy = false;
    }
  }
</script>

<div class="overlay" role="button" tabindex="-1" aria-label="Close" onclick={onClose}
  onkeydown={(e) => e.key === 'Escape' && onClose()}></div>
<div class="panel" role="dialog" aria-modal="true" aria-label="Burn EPROM {cardId}">
  <header class="bar">
    <div class="ttl">
      <Icon name="memory" size={18} />
      <span>Burn EPROM</span>
      <span class="hint fdc-mono">{cardId}</span>
    </div>
    <button class="close" onclick={onClose} aria-label="Close"><Icon name="close" size={20} /></button>
  </header>

  <div class="body">
    {#if region}
      <p class="geom">
        Window <span class="fdc-mono">{hex(region.base)}–{hex(region.base + region.size - 1)}</span>
        · {sizeLabel(region.size)}
      </p>
    {/if}

    <label class="filepick">
      <input type="file" accept=".bin,.rom,.hex,.ihex,.ihx" onchange={pick} disabled={busy} />
      <Icon name="upload_file" size={18} />
      <span>{file ? file.name : 'Choose a .bin or Intel HEX file…'}</span>
    </label>

    <fieldset class="modes" disabled={busy}>
      <legend>Addressing</legend>
      <label class="mode">
        <input type="radio" value="base" bind:group={addressing} />
        <span class="mode-t">From base <span class="mode-d">— load the image starting at the EPROM base</span></span>
      </label>
      <label class="mode">
        <input type="radio" value="file" bind:group={addressing} />
        <span class="mode-t">Honor file addresses <span class="mode-d">— place bytes at the addresses in the file (Intel HEX)</span></span>
      </label>
      {#if file && !isHex && addressing === 'file'}
        <p class="warn">A raw binary has no addresses — it loads from the base regardless.</p>
      {/if}
    </fieldset>
  </div>

  <footer class="foot">
    <Button variant="ghost" size="sm" onclick={onClose} disabled={busy}>Cancel</Button>
    <Button variant="filled" size="sm" icon="bolt" onclick={burn} disabled={busy || !file}>Burn</Button>
  </footer>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: var(--surface-overlay);
    z-index: 40;
    border: none;
  }
  .panel {
    position: fixed;
    z-index: 41;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(480px, 94vw);
    background: var(--surface);
    border: 1px solid var(--border-3);
    border-radius: var(--radius-lg);
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-2);
    background: var(--surface-raised);
  }
  .ttl {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: 600;
  }
  .hint {
    color: var(--fg-3);
    font-size: 12px;
  }
  .close {
    background: none;
    border: none;
    color: var(--fg-3);
    cursor: pointer;
    display: flex;
  }
  .close:hover {
    color: var(--fg-1);
  }
  .body {
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .geom {
    margin: 0;
    color: var(--fg-3);
    font-size: 13px;
  }
  .filepick {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px dashed var(--border-3);
    border-radius: var(--radius-md);
    cursor: pointer;
    color: var(--fg-2);
  }
  .filepick:hover {
    border-color: var(--accent);
  }
  .filepick input {
    display: none;
  }
  .modes {
    border: 1px solid var(--border-1);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .modes legend {
    font: var(--text-overline);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-4);
    padding: 0 var(--space-1);
  }
  .mode {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    cursor: pointer;
    font-size: 13px;
  }
  .mode-d {
    color: var(--fg-3);
    font-size: 12px;
  }
  .warn {
    margin: 0;
    color: var(--warning, var(--fg-3));
    font-size: 12px;
  }
  .foot {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-top: 1px solid var(--border-2);
    background: var(--surface-raised);
  }
</style>
