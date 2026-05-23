<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    value?: string;
    disabled?: boolean;
    name?: string;
    id?: string;
    class?: string;
    onchange?: (e: Event) => void;
    children?: Snippet;
  }

  let {
    value = $bindable(''),
    disabled = false,
    name,
    id,
    class: className = '',
    onchange,
    children,
  }: Props = $props();
</script>

<select
  bind:value
  {disabled}
  {name}
  {id}
  {onchange}
  class="select {className}"
>
  {#if children}{@render children()}{/if}
</select>
