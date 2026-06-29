<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  type Color = 'amber' | 'green' | 'cyan' | 'red';

  interface Props {
    color?: Color;
    icon?: string;
    children?: Snippet;
  }

  let { color, icon, children }: Props = $props();
</script>

<span class="chip {color ?? ''}">
  {#if icon}
    <Icon name={icon} size={16} />
  {/if}
  {#if children}{@render children()}{/if}
</span>
