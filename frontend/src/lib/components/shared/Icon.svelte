<script lang="ts">
  type Size = 16 | 18 | 20 | 24;

  interface Props {
    name: string;
    filled?: boolean;
    size?: Size;
    class?: string;
    title?: string;
  }

  let { name, filled = false, size = 20, class: className = '', title }: Props = $props();
</script>

<span
  class="icon s-{size} {filled ? 'filled' : ''} {className}"
  role={title ? 'img' : 'presentation'}
  aria-label={title}
  aria-hidden={title ? undefined : 'true'}
>
  {name}
</span>
