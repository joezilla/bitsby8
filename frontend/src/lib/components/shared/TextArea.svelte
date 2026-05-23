<script lang="ts">
  interface Props {
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    rows?: number;
    error?: string;
    name?: string;
    id?: string;
    class?: string;
    onkeydown?: (e: KeyboardEvent) => void;
    oninput?: (e: Event) => void;
    onchange?: (e: Event) => void;
  }

  let {
    value = $bindable(''),
    placeholder,
    disabled = false,
    rows = 4,
    error,
    name,
    id,
    class: className = '',
    onkeydown,
    oninput,
    onchange,
  }: Props = $props();
</script>

<textarea
  bind:value
  {placeholder}
  {disabled}
  {rows}
  {name}
  {id}
  {onkeydown}
  {oninput}
  {onchange}
  class="textarea {className}"
  style:border-color={error ? 'var(--error)' : undefined}
  style:box-shadow={error ? '0 0 0 3px var(--ring-error)' : undefined}
  aria-invalid={error ? 'true' : undefined}
></textarea>
{#if error}
  <span class="fdc-label-strip" style="color: var(--error); margin-top: 4px; display: block; text-transform: none; letter-spacing: 0;">
    {error}
  </span>
{/if}
