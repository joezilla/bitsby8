<script lang="ts">
  import { toasts } from '$lib/stores/toast';
  import Icon from './Icon.svelte';
  import IconButton from './IconButton.svelte';

  type Tone = {
    icon: string;
    color: string;
  };

  const tones: Record<string, Tone> = {
    success: { icon: 'check_circle', color: 'var(--success)' },
    info:    { icon: 'info',         color: 'var(--info)' },
    warning: { icon: 'warning',      color: 'var(--warning)' },
    error:   { icon: 'error',        color: 'var(--error)' },
  };

  function dismiss(id: number): void {
    toasts.update((t) => t.filter((m) => m.id !== id));
  }
</script>

<div
  style="
    position: fixed;
    bottom: 16px;
    right: 16px;
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 380px;
  "
>
  {#each $toasts as toast (toast.id)}
    {@const tone = tones[toast.type] ?? tones.info}
    <div
      role="status"
      style="
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 12px 16px;
        background: var(--surface-raised);
        border: 1px solid var(--border-2);
        border-left: 3px solid {tone.color};
        border-radius: var(--radius-md);
        box-shadow: var(--elev-3);
        min-width: 280px;
      "
    >
      <span style="color: {tone.color}; display: inline-flex; padding-top: 1px;">
        <Icon name={tone.icon} size={20} />
      </span>
      <div style="flex: 1; font: var(--text-body-sm); color: var(--fg-1);">
        {toast.text}
      </div>
      <IconButton
        icon="close"
        size={16}
        title="Dismiss"
        onclick={() => dismiss(toast.id)}
      />
    </div>
  {/each}
</div>
