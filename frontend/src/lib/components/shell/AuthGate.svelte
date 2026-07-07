<script lang="ts">
  /**
   * Auth gate around the entire SPA.
   *
   * Boots by asking the daemon (unauthenticated) via `/api/auth/info`
   * what credentials it requires:
   *   loginRequired  — an `adminPassword` is configured; the UI must
   *                    prompt for a password and POST to
   *                    `/api/auth/login` to get a session cookie.
   *   apiKeyRequired — an `apiKey` is configured; machine clients need
   *                    it in Bearer, but the UI never enters it.
   *
   * States:
   *   probing    — waiting on /api/auth/info.
   *   locked     — loginRequired=true; user hasn't got a valid session
   *                yet (401 on the session probe). Show login card.
   *   unlocked   — either no credentials required, or the session
   *                cookie already validates. Render children. When
   *                loginRequired=false && apiKeyRequired=true, render
   *                a persistent "LAN-open" warning banner above the
   *                app (see banner slot below).
   */

  import { onMount } from 'svelte';
  import Card from '$lib/components/shared/Card.svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import Input from '$lib/components/shared/Input.svelte';
  import { api } from '$lib/services/api';

  interface Props {
    children?: import('svelte').Snippet;
  }

  let { children }: Props = $props();

  let gateState = $state<'probing' | 'unlocked' | 'locked'>('probing');
  let showOpenLanWarning = $state(false);
  let passwordInput = $state('');
  let submitting = $state(false);
  let error = $state<string | null>(null);

  onMount(async () => {
    try {
      const info = await api.getAuthInfo();
      if (!info.loginRequired) {
        // No password login required. Reveal the app; if only an API
        // key is configured, warn the operator that the UI is still
        // wide open on the LAN.
        showOpenLanWarning = info.apiKeyRequired;
        gateState = 'unlocked';
        return;
      }
      // loginRequired: check whether the browser already has a valid
      // session cookie by pinging /api/config/status. 200 → unlocked;
      // 401/403 → locked and prompt.
      try {
        const res = await fetch('/api/config/status', { credentials: 'include' });
        if (res.ok) {
          gateState = 'unlocked';
          return;
        }
      } catch {
        /* fall through to locked */
      }
      gateState = 'locked';
    } catch (err) {
      // Probe failed (daemon down / network hiccup). Best-effort: let
      // the app try to render; real API calls will surface their own
      // errors instead of trapping the user behind a dead login form.
      gateState = 'unlocked';
      // eslint-disable-next-line no-console
      console.warn('AuthGate: probe failed, proceeding without gate:', err);
    }
  });

  async function submitLogin(e?: SubmitEvent) {
    e?.preventDefault();
    const candidate = passwordInput;
    if (!candidate) {
      error = 'Enter your admin password.';
      return;
    }
    submitting = true;
    error = null;
    try {
      await api.login(candidate);
      // Session cookie is now set. Reveal the app.
      gateState = 'unlocked';
      passwordInput = '';
    } catch (err) {
      error = (err as Error).message || 'Login failed.';
      submitting = false;
    }
  }
</script>

{#if gateState === 'probing'}
  <!-- One round-trip; a spinner just flashes on a fast LAN. If the
       probe is slow the operator sees this dark background briefly. -->
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
        <form onsubmit={submitLogin} style="padding: 24px; display: flex; flex-direction: column; gap: 16px;">
          <div>
            <div style="font: var(--text-title-md); color: var(--fg-1);">FDC+ Serial Drive Server</div>
            <p
              class="fdc-label-strip"
              style="color: var(--fg-3); margin: 6px 0 0; text-transform: none; letter-spacing: 0;"
            >
              This daemon requires an admin password to access the UI. Enter it below.
            </p>
          </div>

          <label style="display: flex; flex-direction: column; gap: 6px;">
            <span
              class="fdc-label-strip"
              style="color: var(--fg-2); text-transform: none; letter-spacing: 0;"
            >
              Admin password
            </span>
            <Input
              type="password"
              bind:value={passwordInput}
              placeholder="password"
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
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </div>

          <p
            class="fdc-label-strip"
            style="color: var(--fg-3); margin: 0; text-transform: none; letter-spacing: 0; font-size: 0.85em;"
          >
            Sessions last 30 days per browser. The API key is a separate machine credential and
            is never entered here.
          </p>
        </form>
      </Card>
    </div>
  </div>
{:else}
  {#if showOpenLanWarning}
    <!-- Persistent banner: apiKey configured but no adminPassword. The
         UI is wide open to anyone on the LAN. We deliberately don't
         make this dismissible — the pressure is the point. -->
    <div
      style="
        padding: 10px 16px;
        background: color-mix(in oklab, var(--warning) 20%, var(--surface-raised));
        border-bottom: 1px solid color-mix(in oklab, var(--warning) 40%, var(--border-1));
        color: var(--fg-1);
        font: var(--text-body-sm);
        text-align: center;
      "
    >
      <strong>Admin password not set.</strong> Anyone on the LAN can reach this dashboard.
      Set one in <em>Web &amp; API</em>. The API key alone doesn't restrict UI access — it's
      only for machine clients (MCP, curl).
    </div>
  {/if}
  {@render children?.()}
{/if}
