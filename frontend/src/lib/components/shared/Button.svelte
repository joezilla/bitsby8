<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  type Variant = 'filled' | 'tonal' | 'outline' | 'ghost';
  type Size = 'sm' | 'md' | 'lg';

  interface Props {
    variant?: Variant;
    size?: Size;
    icon?: string;
    iconFilled?: boolean;
    danger?: boolean;
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    title?: string;
    class?: string;
    onclick?: (e: MouseEvent) => void;
    children?: Snippet;
  }

  let {
    variant = 'outline',
    size = 'md',
    icon,
    iconFilled = false,
    danger = false,
    disabled = false,
    type = 'button',
    title,
    class: className = '',
    onclick,
    children,
  }: Props = $props();

  const sizeClass = $derived(size === 'md' ? '' : size);
  const iconSize: 16 | 18 = $derived(size === 'sm' ? 16 : 18);
</script>

<button
  {type}
  {disabled}
  {title}
  {onclick}
  class="btn {variant} {sizeClass} {danger ? 'danger' : ''} {className}"
>
  {#if icon}
    <Icon name={icon} filled={iconFilled} size={iconSize} />
  {/if}
  {#if children}
    <span>{@render children()}</span>
  {/if}
</button>
