<script lang="ts">
  import { toasts } from '$lib/stores/toast';

  const typeClasses: Record<string, string> = {
    info: 'border-cyan bg-cyan/10 text-cyan',
    success: 'border-green bg-green/10 text-green',
    error: 'border-red bg-red/10 text-red',
    warning: 'border-amber bg-amber/10 text-amber',
  };
</script>

<div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
  {#each $toasts as toast (toast.id)}
    <div
      class="px-4 py-3 rounded-lg border text-sm font-mono shadow-lg {typeClasses[toast.type]}"
    >
      {toast.text}
    </div>
  {/each}
</div>
