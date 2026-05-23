<script lang="ts">
  import type { Snippet } from 'svelte';

  type Variant = 'inline' | 'strip';

  interface Props {
    variant?: Variant;
    items?: string[];
    children?: Snippet;
    class?: string;
  }

  let {
    variant = 'inline',
    items,
    children,
    class: className = '',
  }: Props = $props();
</script>

{#if variant === 'inline'}
  <span class="fdc-label-strip {className}">
    {#if items}{items.join(' · ')}{/if}
    {#if children}{@render children()}{/if}
  </span>
{:else}
  <div
    class={className}
    style="
      display: flex;
      align-items: center;
      height: 18px;
      padding: 0 12px;
      gap: 16px;
      background: linear-gradient(180deg, var(--surface-variant), color-mix(in oklab, var(--surface-variant) 70%, var(--bg)));
      border-top: 1px solid var(--border-1);
      border-bottom: 1px solid var(--border-1);
    "
  >
    {#if items}
      {#each items as label, i}
        <span
          class="fdc-label-strip"
          style="font-size: 9px; opacity: {i === 0 ? 0.85 : 0.55}; letter-spacing: 0.2em;"
        >
          {label}
        </span>
      {/each}
    {/if}
    {#if children}{@render children()}{/if}
  </div>
{/if}
