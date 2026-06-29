<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    raised?: boolean;
    flush?: boolean;
    class?: string;
    children?: Snippet;
  }

  let {
    raised = false,
    flush = false,
    class: className = '',
    children,
  }: Props = $props();
</script>

<div class="card {raised ? 'raised' : ''} {flush ? 'flush' : ''} {className}">
  {#if children}{@render children()}{/if}
</div>
