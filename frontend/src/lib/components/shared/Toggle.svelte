<script lang="ts">
  /** Pill switch used across the Configuration page. Green when on. */
  interface Props {
    checked: boolean;
    disabled?: boolean;
    title?: string;
    ariaLabel?: string;
    onToggle?: () => void;
  }

  let { checked, disabled = false, title, ariaLabel, onToggle }: Props = $props();
</script>

<button
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={ariaLabel}
  {title}
  {disabled}
  onclick={onToggle}
  class="toggle {checked ? 'on' : ''}"
>
  <span class="knob"></span>
</button>

<style>
  .toggle {
    flex: none;
    width: 42px;
    height: 24px;
    padding: 0;
    position: relative;
    border-radius: var(--radius-full);
    border: 1px solid var(--border-2);
    background: var(--surface-variant);
    cursor: pointer;
    transition: background var(--dur-short) var(--ease-standard),
      border-color var(--dur-short) var(--ease-standard);
  }
  .toggle:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  .toggle:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .toggle.on {
    background: var(--success);
    border-color: var(--success);
  }
  .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    transition: transform var(--dur-short) var(--ease-standard);
  }
  .toggle.on .knob {
    transform: translateX(18px);
  }
</style>
