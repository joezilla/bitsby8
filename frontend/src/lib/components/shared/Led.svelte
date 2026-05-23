<script lang="ts">
  type Color = 'amber' | 'green' | 'cyan' | 'red' | 'off';
  type Size = 'sm' | 'md';

  interface Props {
    color?: Color;
    pulse?: boolean;
    size?: Size;
    label?: string;
    sublabel?: string;
  }

  let {
    color = 'off',
    pulse = false,
    size = 'sm',
    label,
    sublabel,
  }: Props = $props();

  const srLabel = $derived(label ?? `${color}${pulse ? ' (active)' : ''}`);
</script>

<span style="display: inline-flex; align-items: center; gap: 8px;">
  <span
    class="led led-{color} {size === 'md' ? 'led-md' : ''} {pulse ? 'pulse' : ''}"
    role="img"
    aria-label={srLabel}
  ></span>
  {#if label}
    <span style="display: inline-flex; flex-direction: column; line-height: 1.1;">
      <span style="font: var(--text-label); color: var(--fg-2);">{label}</span>
      {#if sublabel}
        <span class="fdc-label-strip" style="font-size: 9px;">{sublabel}</span>
      {/if}
    </span>
  {/if}
</span>
