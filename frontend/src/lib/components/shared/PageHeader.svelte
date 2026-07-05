<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    eyebrow?: string;
    title: string;
    subtitle?: string;
    actions?: Snippet;
  }

  let { eyebrow, title, subtitle, actions }: Props = $props();
</script>

<div class="fdc-page-header">
  <div class="fdc-page-header__titles">
    {#if eyebrow}
      <div class="fdc-label-strip" style="margin-bottom: 6px;">{eyebrow}</div>
    {/if}
    <h1
      style="
        font: var(--text-display-sm);
        color: var(--fg-1);
        margin: 0;
        letter-spacing: -0.01em;
      "
    >
      {title}
    </h1>
    {#if subtitle}
      <p style="margin: 6px 0 0; color: var(--fg-2); font: var(--text-body);">
        {subtitle}
      </p>
    {/if}
  </div>
  {#if actions}
    <div class="fdc-page-header__actions">
      {@render actions()}
    </div>
  {/if}
</div>
