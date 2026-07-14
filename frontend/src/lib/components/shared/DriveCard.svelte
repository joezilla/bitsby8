<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  type StatusColor = 'amber' | 'green' | 'cyan' | 'off';

  interface Props {
    /** Drive slot number — rendered as a two-digit badge. */
    num: number;
    /**
     * Track/head position readout.
     *   - `undefined` hides the TRACK block entirely (client bays have no live head).
     *   - `null` or an unmounted drive shows an em-dash.
     *   - a number is zero-padded to three digits.
     */
    track?: number | null;
    hasDisk: boolean;
    filename?: string | null;
    /** Write-protected — draws the lock glyph in the media tile's top flag slot. */
    protectedRo?: boolean;
    /**
     * Unsaved copy-on-write changes (transient scratch / client splinter modified
     * since mount) — draws the "changed" bolt glyph in the media tile's bottom
     * flag slot. Replaces the old dedicated status pill.
     */
    dirty?: boolean;
    status: { color: StatusColor; pulse?: boolean; text: string };
    /** Media-tile text when no disk is present. */
    emptyText?: string;
    /**
     * Custom action row. When omitted, the default operator controls render
     * from the on* callbacks below (eject / swap / write-protect / insert).
     */
    actions?: Snippet;
    onEject?: () => void;
    onSwap?: () => void;
    onToggleRo?: () => void;
    onInsert?: () => void;
    /** When set, the mounted filename becomes a link to the disk's library entry. */
    onOpenFile?: (filename: string) => void;
  }

  let {
    num,
    track,
    hasDisk,
    filename = null,
    protectedRo = false,
    dirty = false,
    status,
    emptyText = 'No disk mounted',
    actions,
    onEject,
    onSwap,
    onToggleRo,
    onInsert,
    onOpenFile,
  }: Props = $props();

  const numStr = $derived(String(num).padStart(2, '0'));
  const trackStr = $derived(
    track === undefined ? null : !hasDisk ? '—' : String(track ?? 0).padStart(3, '0')
  );
</script>

<div class="drive-card">
  <!-- Zone 1: identity + status -->
  <div class="dc-head">
    <div class="dc-id">
      <div class="dc-num" title="Drive {num}">{numStr}</div>
      {#if trackStr !== null}
        <div class="dc-track" title="Track / head position">
          <span class="dc-track-label">TRACK</span>
          <span class="dc-track-val">{trackStr}</span>
        </div>
      {/if}
    </div>
    <div class="dc-status" title="Drive status: {status.text}">
      <span class="led led-{status.color} {status.pulse ? 'pulse' : ''}"></span>
      <span class="dc-status-text">{status.text}</span>
    </div>
  </div>

  <!-- Zone 2: media (cartridge tile) -->
  {#if hasDisk}
    <div class="dc-media">
      <div class="dc-media-icon">
        <span title="Mounted disk image"><Icon name="album" size={24} /></span>
      </div>
      <div class="dc-media-body">
        <div class="dc-media-row">
          {#if onOpenFile && filename}
            <button type="button" class="dc-file dc-file-link" title="Open {filename} in the disk library" onclick={() => onOpenFile?.(filename!)}>
              {filename}
            </button>
          {:else}
            <span class="dc-file" title={filename ?? ''}>{filename}</span>
          {/if}
          <!-- Fixed two-slot flag column: top = write-protect, bottom = changed.
               Slots reserve space so the filename stays aligned when absent. -->
          <div class="dc-flags">
            <div class="dc-flag-slot">
              {#if protectedRo}
                <span class="dc-flag-lock" title="Write protected"><Icon name="lock" size={16} /></span>
              {/if}
            </div>
            <div class="dc-flag-slot">
              {#if dirty}
                <span class="dc-flag-changed" title="Unsaved changes — disk modified since mount">
                  <Icon name="bolt" size={16} />
                </span>
              {/if}
            </div>
          </div>
        </div>
      </div>
    </div>
  {:else}
    <div class="dc-media dc-media-empty">
      <div class="dc-media-icon">
        <span title="Empty drive slot"><Icon name="album" size={24} /></span>
      </div>
      <div class="dc-media-body"><span class="dc-file-empty">{emptyText}</span></div>
    </div>
  {/if}

  <div class="dc-divider"></div>

  <!-- Zone 3: actions -->
  {#if actions}
    <div class="dc-actions">{@render actions()}</div>
  {:else if hasDisk}
    <div class="dc-actions">
      {#if onEject}
        <button type="button" class="dc-sq" title="Eject" onclick={onEject}>
          <Icon name="eject" size={18} />
        </button>
      {/if}
      {#if onSwap}
        <button type="button" class="dc-sq" title="Swap disk" onclick={onSwap}>
          <Icon name="swap_horiz" size={18} />
        </button>
      {/if}
      {#if onToggleRo}
        <button
          type="button"
          class="dc-toggle {protectedRo ? 'on' : ''}"
          title={protectedRo ? 'Set read-write' : 'Set read-only'}
          onclick={onToggleRo}
        >
          <Icon name={protectedRo ? 'lock' : 'lock_open'} size={16} />
          {protectedRo ? 'Locked' : 'Unlocked'}
        </button>
      {/if}
    </div>
  {:else if onInsert}
    <div class="dc-actions">
      <button type="button" class="dc-insert" title="Insert disk — mount an image" onclick={onInsert}>
        <Icon name="input" size={16} />Insert disk
      </button>
    </div>
  {/if}
</div>

<style>
  .drive-card {
    display: flex;
    flex-direction: column;
    gap: 15px;
    min-width: 0;
    padding: 18px 18px 16px;
    background: var(--surface-raised);
    border: 1px solid var(--border-1);
    border-radius: var(--radius-lg);
    box-shadow: var(--elev-2);
  }

  /* Zone 1 */
  .dc-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .dc-id {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .dc-num {
    flex: none;
    width: 42px;
    height: 42px;
    border-radius: 11px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-bg);
    border: 1px solid color-mix(in oklab, var(--accent) 32%, transparent);
    color: var(--accent);
    font-family: var(--font-data);
    font-weight: 600;
    font-size: 18px;
  }
  .dc-track {
    display: flex;
    flex-direction: column;
    line-height: 1.1;
    min-width: 0;
  }
  .dc-track-label {
    font-family: var(--font-data);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.14em;
    color: var(--fg-3);
  }
  .dc-track-val {
    font-family: var(--font-data);
    font-size: 19px;
    font-weight: 600;
    color: var(--fg-1);
  }
  .dc-status {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    flex: none;
    padding: 5px 11px 5px 9px;
    border-radius: var(--radius-full);
    background: var(--surface-variant);
    border: 1px solid var(--border-1);
  }
  .dc-status-text {
    font-family: var(--font-data);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-1);
  }

  /* Zone 2 */
  .dc-media {
    display: flex;
    align-items: stretch;
    border: 1px solid var(--border-1);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  .dc-media-icon {
    flex: none;
    width: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-bg);
    color: var(--accent);
  }
  .dc-media-empty .dc-media-icon {
    background: var(--surface-variant);
    color: var(--fg-4);
  }
  .dc-media-body {
    flex: 1;
    min-width: 0;
    padding: 11px 13px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    background: color-mix(in oklab, var(--surface-variant) 45%, transparent);
  }
  .dc-media-row {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }
  .dc-flags {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .dc-flag-slot {
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .dc-flag-lock {
    display: inline-flex;
    color: var(--accent);
  }
  /* Amber to match the unified "unsaved" status vocabulary (StatusBadge). */
  .dc-flag-changed {
    display: inline-flex;
    color: var(--warning);
  }
  .dc-file {
    flex: 1;
    min-width: 0;
    font-family: var(--font-data);
    font-size: 11.5px;
    font-weight: 500;
    line-height: 1.35;
    min-height: 2.7em;
    color: var(--fg-1);
    word-break: break-all;
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
  .dc-file-link {
    background: none;
    border: none;
    padding: 0;
    text-align: left;
    cursor: pointer;
    transition: color var(--dur-short) var(--ease-standard);
  }
  .dc-file-link:hover {
    color: var(--accent);
    text-decoration: underline;
  }
  .dc-file-link:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--radius-xs);
  }
  .dc-file-empty {
    display: flex;
    align-items: center;
    min-height: 36px;
    font-family: var(--font-data);
    font-size: 11.5px;
    font-weight: 500;
    line-height: 1.35;
    color: var(--fg-3);
  }

  .dc-divider {
    height: 1px;
    margin-top: auto;
    background: var(--border-1);
  }

  /* Zone 3 — action-button styles (.dc-sq/.dc-toggle/.dc-insert) live in
     app.css so the Clients page bays can reuse the same controls. */
  .dc-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
