<script lang="ts">
  import Icon from './Icon.svelte';

  type Variant = 'default' | 'search';

  interface Props {
    value?: string;
    placeholder?: string;
    type?: 'text' | 'number' | 'email' | 'password' | 'url';
    variant?: Variant;
    disabled?: boolean;
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
    type = 'text',
    variant = 'default',
    disabled = false,
    error,
    name,
    id,
    class: className = '',
    onkeydown,
    oninput,
    onchange,
  }: Props = $props();

  const focusRing = $derived(error ? '0 0 0 3px var(--ring-error)' : undefined);
</script>

{#if variant === 'search'}
  <span class="input search {className}" style="cursor: text;">
    <Icon name="search" size={16} class="text-fg-3" />
    <input
      bind:value
      {type}
      {placeholder}
      {disabled}
      {name}
      {id}
      {onkeydown}
      {oninput}
      {onchange}
      style="all: unset; flex: 1; min-width: 0; font-family: var(--font-data); font-size: 12.5px; color: var(--fg-1);"
    />
  </span>
{:else}
  <input
    bind:value
    {type}
    {placeholder}
    {disabled}
    {name}
    {id}
    {onkeydown}
    {oninput}
    {onchange}
    class="input {className}"
    style:border-color={error ? 'var(--error)' : undefined}
    style:box-shadow={focusRing}
    aria-invalid={error ? 'true' : undefined}
  />
{/if}
{#if error}
  <span class="fdc-label-strip" style="color: var(--error); margin-top: 4px; display: block; text-transform: none; letter-spacing: 0;">
    {error}
  </span>
{/if}
