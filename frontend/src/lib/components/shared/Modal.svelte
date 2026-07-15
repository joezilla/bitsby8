<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  // One dialog shell for the app's form/confirm modals. Before this, ~9 modals
  // hand-rolled their own overlay, panel, shadow, z-index and header — drifting in
  // width, elevation and dismiss behaviour. Callers now supply a title (+ optional
  // icon/hint), body content, and an optional footer; the shell owns the overlay,
  // centring, Escape / backdrop dismissal (guarded by `busy`), scroll and focus.
  interface Props {
    title: string;
    icon?: string;
    /** Small uppercase caption beside the title (e.g. "disk snapshots"). */
    hint?: string;
    onClose: () => void;
    /** While true, backdrop/Escape/✕ won't dismiss (an operation is in flight). */
    busy?: boolean;
    size?: 'sm' | 'md' | 'lg' | 'xl';
    /** Body content. */
    children: Snippet;
    /** Optional action row pinned to the bottom. */
    footer?: Snippet;
  }

  let { title, icon, hint, onClose, busy = false, size = 'md', children, footer }: Props = $props();

  const WIDTH: Record<NonNullable<Props['size']>, string> = {
    sm: 'min(440px, 94vw)',
    md: 'min(480px, 94vw)',
    lg: 'min(600px, 94vw)',
    xl: 'min(720px, 94vw)',
  };

  function tryClose() {
    if (!busy) onClose();
  }

  // Move focus into the dialog on open and restore it to the invoking control on
  // close, so keyboard users aren't dropped back at the top of the document.
  let panel = $state<HTMLDivElement | null>(null);
  $effect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panel?.focus();
    return () => prev?.focus?.();
  });
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && tryClose()} />

<div class="fdc-modal-overlay">
  <button type="button" class="fdc-modal-scrim" aria-label="Close" tabindex="-1" onclick={tryClose}></button>
  <div
    bind:this={panel}
    class="fdc-modal-panel"
    style="width: {WIDTH[size]};"
    role="dialog"
    aria-modal="true"
    aria-label={title}
    tabindex="-1"
  >
    <header class="fdc-modal-bar">
      <div class="fdc-modal-ttl">
        {#if icon}<Icon name={icon} size={18} />{/if}
        <span class="fdc-modal-title">{title}</span>
        {#if hint}<span class="fdc-modal-hint">{hint}</span>{/if}
      </div>
      <button type="button" class="fdc-modal-close" onclick={tryClose} disabled={busy} aria-label="Close">
        <Icon name="close" size={20} />
      </button>
    </header>

    <div class="fdc-modal-body">
      {@render children()}
    </div>

    {#if footer}
      <footer class="fdc-modal-footer">{@render footer()}</footer>
    {/if}
  </div>
</div>

<style>
  .fdc-modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 55;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
  }
  .fdc-modal-scrim {
    position: absolute;
    inset: 0;
    background: var(--surface-overlay);
    border: none;
    cursor: default;
  }
  .fdc-modal-panel {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    max-height: min(86vh, 720px);
    background: var(--surface-raised);
    border: 1px solid var(--border-3);
    border-radius: var(--radius-lg);
    box-shadow: var(--elev-4);
    overflow: hidden;
  }
  .fdc-modal-panel:focus {
    outline: none;
  }
  .fdc-modal-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--border-2);
    background: var(--surface);
  }
  .fdc-modal-ttl {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
    color: var(--fg-1);
  }
  .fdc-modal-title {
    font: var(--text-title-sm);
    color: var(--fg-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fdc-modal-hint {
    flex: none;
    font: var(--text-overline);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-4);
  }
  .fdc-modal-close {
    flex: none;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--fg-3);
    cursor: pointer;
    transition: color var(--dur-short) var(--ease-standard);
  }
  .fdc-modal-close:hover:not(:disabled) {
    color: var(--fg-1);
  }
  .fdc-modal-close:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .fdc-modal-body {
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    overflow: auto;
  }
  .fdc-modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    flex-wrap: wrap;
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--border-2);
    background: var(--surface);
  }
</style>
