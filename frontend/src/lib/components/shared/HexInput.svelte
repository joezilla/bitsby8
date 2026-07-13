<script lang="ts">
  /**
   * A number field for S-100 hardware values — entered and shown in hex
   * (`0x18`), never decimal. Accepts input with or without the `0x` prefix.
   * Emits the parsed integer via `onchange`; range validation is the parent's
   * job (pass `invalid`).
   */
  interface Props {
    value: number;
    min?: number;
    max?: number;
    invalid?: boolean;
    id?: string;
    ariaLabel?: string;
    onchange: (n: number) => void;
  }
  let { value, min = 0, max = 0xff, invalid = false, id, ariaLabel, onchange }: Props = $props();

  const toHex = (n: number) => `0x${(Number.isFinite(n) ? n : 0).toString(16).toUpperCase()}`;

  // `editing` holds the raw text while the user types; otherwise the field shows
  // the value in hex. This resyncs to external changes (e.g. auto-assign) without
  // clobbering active input, and needs no reference to the prop in an initializer.
  let editing = $state<string | null>(null);
  let display = $derived(editing ?? toHex(value));

  function commit(raw: string) {
    const n = parseInt(raw.trim().replace(/^0x/i, ''), 16);
    if (!Number.isNaN(n)) onchange(n);
  }
</script>

<input
  {id}
  class="hexinp fdc-mono"
  class:invalid
  type="text"
  inputmode="text"
  spellcheck="false"
  autocomplete="off"
  aria-label={ariaLabel}
  title={`hex — 0x${min.toString(16).toUpperCase()} to 0x${max.toString(16).toUpperCase()}`}
  value={display}
  oninput={(e) => {
    editing = e.currentTarget.value;
    commit(e.currentTarget.value);
  }}
  onblur={(e) => {
    commit(e.currentTarget.value);
    editing = null;
  }}
/>

<style>
  .hexinp {
    background: var(--surface-sunken);
    border: 1px solid var(--border-2);
    border-radius: var(--radius-sm);
    color: var(--fg-1);
    font-size: 13px;
    padding: 0 var(--space-2);
    height: 30px;
    width: 110px;
  }
  .hexinp:focus {
    outline: none;
    border-color: var(--accent);
  }
  .hexinp.invalid {
    border-color: var(--error);
  }
</style>
