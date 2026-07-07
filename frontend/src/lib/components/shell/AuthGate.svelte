<script lang="ts">
  /**
   * Auth gate around the entire SPA.
   *
   * Boots by asking the daemon (unauthenticated) whether an API key is
   * required. If it is and the browser doesn't have a valid one stored,
   * blocks the app behind a login prompt. If the daemon says no key is
   * required, or a stored key already validates, renders children
   * unchanged.
   *
   * Storage lives in `localStorage` under `fdc.apiKey` (via
   * getStoredApiKey/setStoredApiKey), so a browser only ever prompts
   * once per device even across restarts.
   */

  import { onMount } from 'svelte';
  import Card from '$lib/components/shared/Card.svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import Input from '$lib/components/shared/Input.svelte';
  import {
    api,
    verifyApiKey,
    getStoredApiKey,
    setStoredApiKey,
  } from '$lib/services/api';

  interface Props {
    children?: import('svelte').Snippet;
  }

  let { children }: Props = $props();

  // States: 'probing' — waiting on /api/auth/info; 'unlocked' — render
  // children; 'locked' — show the login form.
  let gateState = $state<'probing' | 'unlocked' | 'locked'>('probing');
  let keyInput = $state('');
  let submitting = $state(false);
  let error = $state<string | null>(null);

  onMount(async () => {
    try {
      const info = await api.getAuthInfo();
      if (!info.authRequired) {
        gateState = 'unlocked';
        return;
      }
      const stored = getStoredApiKey();
      if (stored && (await verifyApiKey(stored))) {
        gateState = 'unlocked';
        return;
      }
      // Stored key invalid (or missing) — force a fresh entry.
      setStoredApiKey(null);
      gateState = 'locked';
    } catch (err) {
      // Probe failed (daemon down, network) — best effort: assume the
      // stored key might work and let real API calls surface the error.
      gateState = 'unlocked';
      // eslint-disable-next-line no-console
      console.warn('AuthGate: probe failed, proceeding without gate:', err);
    }
  });

  async function submitKey(e?: SubmitEvent) {
    e?.preventDefault();
    const candidate = keyInput.trim();
    if (!candidate) {
      error = 'Enter the API key configured on the daemon.';
      return;
    }
    submitting = true;
    error = null;
    try {
      const ok = await verifyApiKey(candidate);
      if (!ok) {
        error = 'That key was rejected. Double-check the value set in Web & API.';
        submitting = false;
        return;
      }
      setStoredApiKey(candidate);
      gateState = 'unlocked';
    } catch (err) {
      error = `Verification failed: ${(err as Error).message}`;
      submitting = false;
    }
  }
</script>

{#if gateState === 'probing'}
  <!-- Deliberately blank: probe completes in one round-trip; a spinner
       here just flashes on a fast LAN. If the probe is slow the user
       will see this dark background briefly. -->
  <div style="width: 100%; height: 100vh; background: var(--bg);"></div>
{:else if gateState === 'locked'}
  <div
    style="
      width: 100%;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: var(--bg);
    "
  >
    <div style="width: 100%; max-width: 420px;">
      <Card>
        <form onsubmit={submitKey} style="padding: 24px; display: flex; flex-direction: column; gap: 16px;">
          <div>
            <div style="font: var(--text-title-md); color: var(--fg-1);">FDC+ Serial Drive Server</div>
            <p
              class="fdc-label-strip"
              style="color: var(--fg-3); margin: 6px 0 0; text-transform: none; letter-spacing: 0;"
            >
              This daemon requires an API key. Enter the key configured in
              <strong>Web &amp; API</strong>.
            </p>
          </div>

          <label style="display: flex; flex-direction: column; gap: 6px;">
            <span
              class="fdc-label-strip"
              style="color: var(--fg-2); text-transform: none; letter-spacing: 0;"
            >
              API key
            </span>
            <Input
              type="password"
              bind:value={keyInput}
              placeholder="paste key here"
              disabled={submitting}
            />
          </label>

          {#if error}
            <div style="color: var(--error); font: var(--text-body-sm);">
              {error}
            </div>
          {/if}

          <div style="display: flex; justify-content: flex-end;">
            <Button variant="filled" disabled={submitting}>
              {submitting ? 'Verifying…' : 'Unlock'}
            </Button>
          </div>

          <p
            class="fdc-label-strip"
            style="color: var(--fg-3); margin: 0; text-transform: none; letter-spacing: 0; font-size: 0.85em;"
          >
            Stored in this browser's local storage after a successful unlock. Clear browser data or
            change the key in the config to reset.
          </p>
        </form>
      </Card>
    </div>
  </div>
{:else}
  {@render children?.()}
{/if}
