<script lang="ts">
  interface Props {
    color?: 'green' | 'amber' | 'red' | 'cyan' | 'off';
    pulse?: boolean;
    size?: 'sm' | 'md';
    label?: string;
  }

  let { color = 'off', pulse = false, size = 'sm', label = '' }: Props = $props();

  const colorClasses: Record<string, string> = {
    green: 'bg-green shadow-[0_0_6px_var(--color-green)]',
    amber: 'bg-amber shadow-[0_0_6px_var(--color-amber)]',
    red: 'bg-red shadow-[0_0_6px_var(--color-red)]',
    cyan: 'bg-cyan shadow-[0_0_6px_var(--color-cyan)]',
    off: 'bg-border',
  };

  const sizeClasses: Record<string, string> = {
    sm: 'w-2 h-2',
    md: 'w-3 h-3',
  };
</script>

<span class="inline-flex items-center gap-1.5" title={label}>
  <span
    class="inline-block rounded-full transition-all duration-200 {sizeClasses[size]} {colorClasses[color]}"
    class:animate-pulse={pulse && color !== 'off'}
  ></span>
  {#if label}
    <span class="text-xs text-text-dim">{label}</span>
  {/if}
</span>
