<script lang="ts">
  /**
   * GPIO pin input. BCM numbering, 0-27 on a Pi. `null` = "not assigned".
   *
   * Conflict highlighting: the parent form owns a Set of pins used
   * elsewhere on the page and passes it in as `usedPins`. If our
   * current value appears in that set at the moment the user leaves
   * the field, the input turns amber and a hint appears — matches how
   * the backend's superRefine would reject the save.
   */

  interface Props {
    value: number | null | undefined;
    /** Set of every other pin currently assigned on the page. */
    usedPins?: Set<number>;
    disabled?: boolean;
    id?: string;
  }

  let { value = $bindable(), usedPins = new Set<number>(), disabled = false, id }: Props = $props();

  let raw = $state(value === null || value === undefined ? '' : String(value));

  $effect(() => {
    raw = value === null || value === undefined ? '' : String(value);
  });

  const conflict = $derived(
    typeof value === 'number' && usedPins.has(value),
  );

  const outOfRange = $derived(
    typeof value === 'number' && (value < 0 || value > 27),
  );

  function handleInput(e: Event) {
    const target = e.target as HTMLInputElement;
    raw = target.value;
    if (raw === '') {
      value = null;
    } else {
      const n = parseInt(raw, 10);
      value = Number.isFinite(n) ? n : null;
    }
  }
</script>

<div style="display: flex; flex-direction: column; gap: 4px;">
  <input
    {id}
    type="number"
    min="0"
    max="27"
    step="1"
    placeholder="—"
    value={raw}
    {disabled}
    oninput={handleInput}
    class="input"
    style:border-color={conflict || outOfRange ? 'var(--warning)' : undefined}
    style:box-shadow={conflict || outOfRange
      ? '0 0 0 2px color-mix(in oklab, var(--warning) 25%, transparent)'
      : undefined}
  />
  {#if conflict}
    <span class="fdc-label-strip" style="color: var(--warning); text-transform: none; letter-spacing: 0;">
      Pin {value} is already assigned elsewhere.
    </span>
  {:else if outOfRange}
    <span class="fdc-label-strip" style="color: var(--warning); text-transform: none; letter-spacing: 0;">
      Valid BCM pin range is 0–27.
    </span>
  {/if}
</div>
