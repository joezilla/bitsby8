<script lang="ts">
  import Icon from './Icon.svelte';

  type Size = 16 | 18 | 20 | 24;

  interface Props {
    icon: string;
    iconFilled?: boolean;
    size?: Size;
    on?: boolean;
    disabled?: boolean;
    title?: string;
    type?: 'button' | 'submit' | 'reset';
    class?: string;
    onclick?: (e: MouseEvent) => void;
  }

  let {
    icon,
    iconFilled = false,
    size = 18,
    on = false,
    disabled = false,
    title,
    type = 'button',
    class: className = '',
    onclick,
  }: Props = $props();
</script>

<button
  {type}
  {disabled}
  {title}
  {onclick}
  aria-label={title}
  aria-pressed={on}
  class="iconbtn {on ? 'on' : ''} {className}"
>
  <Icon name={icon} filled={iconFilled} {size} />
</button>
