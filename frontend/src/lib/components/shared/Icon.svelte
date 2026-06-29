<script lang="ts">
  type Size = 16 | 18 | 20 | 24;

  interface Props {
    name: string;
    filled?: boolean;
    size?: Size;
    class?: string;
  }

  let { name, filled = false, size = 20, class: className = '' }: Props = $props();
</script>

<span
  class="icon s-{size} {filled ? 'filled' : ''} {className}"
  aria-hidden="true"
>
  {name}
</span>
