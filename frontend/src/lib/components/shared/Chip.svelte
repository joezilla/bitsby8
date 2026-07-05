<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  type Color = 'amber' | 'green' | 'cyan' | 'red';
  type Size = 'md' | 'sm';

  interface Props {
    color?: Color;
    icon?: string;
    size?: Size;
    children?: Snippet;
  }

  let { color, icon, size = 'md', children }: Props = $props();
</script>

<span class="chip {color ?? ''} {size === 'sm' ? 'sm' : ''}">
  {#if icon}
    <Icon name={icon} size={size === 'sm' ? 12 : 16} />
  {/if}
  {#if children}{@render children()}{/if}
</span>
