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
  import { api, setLoginRequired } from '$lib/services/api';

  interface Props {
    children?: import('svelte').Snippet;
  }

  let { children }: Props = $props();

  // 'probing'     — waiting on /api/auth/info.
  // 'unlocked'    — render children (with optional info banner).
  // 'locked'      — daemon requires login and we don't have a valid session.
  // 'unreachable' — apiKeyRequired && !loginRequired: browser can't
  //                 authenticate at all. The UI is functionally locked
  //                 until an admin password is set out-of-band.
  let gateState = $state<'probing' | 'unlocked' | 'locked' | 'unreachable'>('probing');
  let passwordInput = $state('');
  let submitting = $state(false);
  let error = $state<string | null>(null);

  onMount(async () => {
    try {
      const info = await api.getAuthInfo();
      // Tell the api client whether a 401 reload is even worth
      // attempting — see api.ts:request().
      setLoginRequired(info.loginRequired);

      if (!info.loginRequired && !info.apiKeyRequired) {
        // Truly open: no credentials configured. Dev flow.
        gateState = 'unlocked';
        return;
      }
      if (!info.loginRequired && info.apiKeyRequired) {
        // Machine token only: browsers can't authenticate. Instead of
        // rendering the app (which then infinite-loops on 401s), block
        // with a static explanation and point the operator at the fix.
        gateState = 'unreachable';
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
            <Button type="submit" variant="filled" disabled={submitting}>
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
{:else if gateState === 'unreachable'}
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
    <div style="width: 100%; max-width: 520px;">
      <Card>
        <div style="padding: 24px; display: flex; flex-direction: column; gap: 16px;">
          <div>
            <div style="font: var(--text-title-md); color: var(--fg-1);">
              FDC+ Serial Drive Server
            </div>
            <p
              class="fdc-label-strip"
              style="color: var(--fg-3); margin: 6px 0 0; text-transform: none; letter-spacing: 0;"
            >
              This dashboard is not accessible from a browser yet.
            </p>
          </div>
          <div style="color: var(--fg-2); font: var(--text-body-sm); line-height: 1.5;">
            <p style="margin: 0 0 12px;">
              The daemon has an <strong>API key</strong> configured — that protects the
              machine endpoints (MCP over HTTP, curl scripts) — but there is no
              <strong>admin password</strong>, so a browser has no way to log in.
            </p>
            <p style="margin: 0 0 12px;">
              To use the web UI, set an admin password by editing
              <code>/var/lib/fdcsds/fdcsds.overrides.json</code> and adding
              <code>"adminPassword": "your-password"</code>, then restart with
              <code>sudo systemctl restart fdcsds</code>. The daemon hashes it on first
              read.
            </p>
            <p style="margin: 0; color: var(--fg-3);">
              You can also set it over the API using your existing key:
            </p>
            <pre
              style="
                margin: 6px 0 0;
                padding: 10px 12px;
                background: var(--surface-variant);
                border: 1px solid var(--border-1);
                border-radius: var(--radius-sm);
                color: var(--fg-1);
                font: var(--text-code-sm);
                overflow-x: auto;
                white-space: pre-wrap;
                word-break: break-all;
              ">{`curl -X PUT http://HOST:PORT/api/config/web \\
  -H "Authorization: Bearer <api-key>" \\
  -H "Content-Type: application/json" \\
  -d '{"adminPassword": "your-password"}'`}</pre>
          </div>
        </div>
      </Card>
    </div>
  </div>
{:else}
  {@render children?.()}
{/if}
