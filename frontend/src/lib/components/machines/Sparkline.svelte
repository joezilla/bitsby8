<script lang="ts">
  interface Props {
    /** Recent samples (oldest → newest). */
    values: number[];
    /** Nominal max for scaling (e.g. target Hz); falls back to max sample. */
    max?: number;
    label: string; // accessible description
    width?: number;
    height?: number;
  }
  let { values, max, label, width = 96, height = 24 }: Props = $props();

  let path = $derived.by(() => {
    if (values.length < 2) return '';
    const hi = Math.max(max ?? 0, ...values, 1);
    const stepX = width / (values.length - 1);
    return values
      .map((v, i) => {
        const x = i * stepX;
        const y = height - 1 - (Math.max(0, Math.min(v, hi)) / hi) * (height - 2);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  });
  let lastX = $derived(width);
  let lastY = $derived.by(() => {
    if (!values.length) return height - 1;
    const hi = Math.max(max ?? 0, ...values, 1);
    return height - 1 - (Math.max(0, Math.min(values[values.length - 1], hi)) / hi) * (height - 2);
  });
</script>

<svg
  class="spark"
  {width}
  {height}
  viewBox="0 0 {width} {height}"
  role="img"
  aria-label={label}
  preserveAspectRatio="none"
>
  {#if path}
    <path d={path} fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round" />
    <circle cx={lastX} cy={lastY} r="1.8" fill="var(--accent)" />
  {:else}
    <line x1="0" y1={height - 1} x2={width} y2={height - 1} stroke="var(--border-2)" stroke-width="1" />
  {/if}
</svg>

<style>
  .spark {
    display: block;
    overflow: visible;
  }
</style>
