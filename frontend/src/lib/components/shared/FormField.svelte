<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    for_?: string;
    help?: string;
    error?: string;
    /** Chip text shown to the right of the label (e.g. "Live", "Restart pending", "overridden by CLI"). */
    hint?: string;
    hintColor?: 'green' | 'amber' | 'gray';
    children?: Snippet;
  }

  let {
    label,
    for_,
    help,
    error,
    hint,
    hintColor = 'gray',
    children,
  }: Props = $props();

  const hintBg = $derived(
    hintColor === 'green'
      ? 'color-mix(in oklab, var(--success) 20%, var(--surface-raised))'
      : hintColor === 'amber'
        ? 'color-mix(in oklab, var(--warning) 25%, var(--surface-raised))'
        : 'var(--surface-variant)'
  );
  const hintFg = $derived(
    hintColor === 'green'
      ? 'var(--success)'
      : hintColor === 'amber'
        ? 'var(--warning)'
        : 'var(--fg-2)'
  );
</script>

<div style="display: flex; flex-direction: column; gap: 6px;">
  <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
    <label class="fdc-label-strip" for={for_} style="display: block;">
      {label}
    </label>
    {#if hint}
      <span
        class="fdc-label-strip"
        style="
          padding: 2px 8px;
          border-radius: 999px;
          background: {hintBg};
          color: {hintFg};
          font-size: 10px;
          text-transform: none;
          letter-spacing: 0;
        "
      >
        {hint}
      </span>
    {/if}
  </div>
  {#if children}{@render children()}{/if}
  {#if error}
    <span
      class="fdc-label-strip"
      style="color: var(--error); text-transform: none; letter-spacing: 0;"
    >
      {error}
    </span>
  {:else if help}
    <span
      class="fdc-label-strip"
      style="color: var(--fg-3); text-transform: none; letter-spacing: 0;"
    >
      {help}
    </span>
  {/if}
</div>
