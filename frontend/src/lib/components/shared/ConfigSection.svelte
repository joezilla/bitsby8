<script lang="ts">
  /**
   * Card wrapping one section of the config page. Owns:
   *   - Dirty flag propagated to the shared configDirty store on change.
   *   - Save / Discard buttons in the header.
   *   - Restart-pending badge once a save has succeeded but the daemon
   *     hasn't relaunched yet.
   *   - Section-level error rendering (top-level "Save failed" copy).
   *
   * The `children` snippet renders whatever fields the section owns —
   * this component is purely chrome and dirty-state plumbing.
   */

  import type { Snippet } from 'svelte';
  import Card from './Card.svelte';
  import Button from './Button.svelte';
  import LabelStrip from './LabelStrip.svelte';
  import Chip from './Chip.svelte';
  import Led from './Led.svelte';
  import type { SectionId } from '$lib/stores/configDirty';
  import { configSections, setDirty, setRestartPending } from '$lib/stores/configDirty';

  interface Props {
    id: SectionId;
    title: string;
    description?: string;
    /** True when the section has unsaved edits. */
    dirty: boolean;
    /** Async save handler. Resolve on success, throw on failure. */
    onSave: () => Promise<void>;
    /** Reset local state to server truth. */
    onDiscard?: () => void;
    /** Optional lead-icon LED next to the title. */
    liveStatus?: 'live' | 'restart-required' | null;
    /** Anything the child form wants — a grid of FormFields, usually. */
    children?: Snippet;
  }

  let {
    id,
    title,
    description,
    dirty,
    onSave,
    onDiscard,
    liveStatus = 'restart-required',
    children,
  }: Props = $props();

  let saving = $state(false);
  let saveError = $state<string | null>(null);

  // Push dirty state up to the shared store so the RestartBanner can total it.
  $effect(() => {
    setDirty(id, dirty);
  });

  const restartPending = $derived($configSections[id]?.restartPending ?? false);

  async function handleSave() {
    if (saving) return;
    saving = true;
    saveError = null;
    try {
      await onSave();
      if (liveStatus === 'restart-required') {
        setRestartPending(id, true);
      }
    } catch (err) {
      saveError = (err as Error).message || 'Save failed';
    } finally {
      saving = false;
    }
  }

  function handleDiscard() {
    if (!onDiscard) return;
    onDiscard();
    saveError = null;
  }
</script>

<Card>
  <div style="padding: 20px; display: flex; flex-direction: column; gap: 16px;">
    <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;">
      <div style="min-width: 0; flex: 1;">
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <LabelStrip>{title}</LabelStrip>
          {#if restartPending}
            <Chip color="amber" icon="restart_alt">Restart pending</Chip>
          {:else if dirty}
            <Chip color="amber" icon="edit">Unsaved</Chip>
          {:else if liveStatus === 'live'}
            <Chip color="green" icon="bolt">Live</Chip>
          {/if}
        </div>
        {#if description}
          <p
            class="fdc-label-strip"
            style="color: var(--fg-3); margin: 4px 0 0; text-transform: none; letter-spacing: 0;"
          >
            {description}
          </p>
        {/if}
      </div>
      <div style="display: flex; gap: 8px; align-items: center; flex-shrink: 0;">
        {#if dirty}
          <Button variant="ghost" icon="undo" onclick={handleDiscard} disabled={saving}>Discard</Button>
        {/if}
        <Button
          variant="filled"
          icon="save"
          onclick={handleSave}
          disabled={!dirty || saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>

    {#if saveError}
      <div
        style="
          padding: 10px 12px;
          background: var(--error-container);
          border: 1px solid color-mix(in oklab, var(--error) 35%, var(--border-1));
          border-radius: var(--radius-md);
          font: var(--text-body-sm);
          color: var(--fg-1);
        "
      >
        <strong style="color: var(--error);">Save failed:</strong>
        {saveError}
      </div>
    {/if}

    {#if children}{@render children()}{/if}
  </div>
</Card>
