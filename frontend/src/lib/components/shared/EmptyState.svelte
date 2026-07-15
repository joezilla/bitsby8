<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  // A single centred placeholder for the "nothing here yet" and "still loading"
  // moments. Replaces the ad-hoc mix of `.muted` paragraphs, bare `.empty` divs
  // and `<Card>Loading…</Card>` wrappers that each page used to hand-roll.
  interface Props {
    /** Material symbol shown above the message (hidden while loading). */
    icon?: string;
    /** Loading spinner instead of the icon; use for the initial-fetch state. */
    loading?: boolean;
    /** Tighter padding for inline/in-card use rather than a full-page blank. */
    compact?: boolean;
    /** Optional action row (e.g. a "Launch a machine" button). */
    actions?: Snippet;
    /** The message. */
    children: Snippet;
  }

  let { icon, loading = false, compact = false, actions, children }: Props = $props();
</script>

<div class="empty-state" class:compact role={loading ? 'status' : undefined} aria-live={loading ? 'polite' : undefined}>
  {#if loading}
    <span class="spinner" aria-hidden="true"></span>
  {:else if icon}
    <span class="empty-icon"><Icon name={icon} size={24} /></span>
  {/if}
  <p class="empty-msg">{@render children()}</p>
  {#if actions}
    <div class="empty-actions">{@render actions()}</div>
  {/if}
</div>

<style>
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-9) var(--space-4);
    text-align: center;
  }
  .empty-state.compact {
    padding: var(--space-5) var(--space-4);
    gap: var(--space-2);
  }
  .empty-icon {
    display: inline-flex;
    color: var(--fg-4);
  }
  .empty-msg {
    margin: 0;
    max-width: 44ch;
    font: var(--text-body-sm);
    color: var(--fg-3);
  }
  .empty-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
    justify-content: center;
  }

  .spinner {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid var(--border-2);
    border-top-color: var(--accent);
    animation: es-spin 0.7s linear infinite;
  }
  @keyframes es-spin {
    to { transform: rotate(360deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner { animation-duration: 2.4s; }
  }
</style>
