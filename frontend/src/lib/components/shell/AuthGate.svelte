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
  import Icon from '$lib/components/shared/Icon.svelte';
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
  let passwordVisible = $state(false);
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
  <!-- "Ambient Panel" login: a floating card over a dark, LED-dot-textured
       backdrop with an amber front-panel glow. -->
  <div class="login-root">
    <div class="login-dots"></div>
    <div class="login-bloom"></div>
    <div class="login-floor"></div>

    <div class="login-fg">
      <!-- Brand cluster: an 8-LED byte pill over the wordmark. -->
      <div style="display: flex; flex-direction: column; align-items: center; gap: 16px;">
        <div class="led-pill">
          {#each [1, 0, 1, 1, 1, 1, 0, 0] as bit}
            <span class="led {bit ? 'on' : 'off'}"></span>
          {/each}
        </div>
        <div style="text-align: center;">
          <div class="login-wordmark">BitsBy<span style="color: #ffb020;">8</span></div>
          <div class="login-sublabel">ADMIN CONSOLE</div>
        </div>
      </div>

      <!-- Login card -->
      <form class="login-card" onsubmit={submitLogin}>
        <div class="login-body">
          This application requires an admin password to access the UI.
        </div>

        <div class="login-fieldlabel">Admin password</div>
        <div class="login-field">
          <input
            class="login-input"
            type={passwordVisible ? 'text' : 'password'}
            value={passwordInput}
            oninput={(e) => (passwordInput = e.currentTarget.value)}
            placeholder="password"
            autocomplete="current-password"
            disabled={submitting}
          />
          <button
            type="button"
            class="login-eye"
            title={passwordVisible ? 'Hide password' : 'Show password'}
            aria-label={passwordVisible ? 'Hide password' : 'Show password'}
            onclick={() => (passwordVisible = !passwordVisible)}
          >
            <Icon name={passwordVisible ? 'visibility_off' : 'visibility'} size={20} />
          </button>
        </div>

        {#if error}
          <div class="login-error">{error}</div>
        {/if}

        <div style="margin-top: 20px; display: flex; justify-content: flex-end;">
          <button type="submit" class="login-signin" disabled={submitting}>
            {submitting ? 'Verifying…' : 'Sign in'}
          </button>
        </div>
      </form>

      <div class="login-footer">
        Sessions last 30 days per browser. The API key is a separate machine credential
        and is never entered here.
      </div>
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
              BitsBy8
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
              The application has an <strong>API key</strong> configured — that protects the
              machine endpoints (MCP over HTTP, curl scripts) — but there is no
              <strong>admin password</strong>, so a browser has no way to log in.
            </p>
            <p style="margin: 0 0 12px;">
              To use the web UI, set an admin password by editing
              <code>/var/lib/fdcsds/fdcsds.overrides.json</code> and adding
              <code>"adminPassword": "your-password"</code>, then restart with
              <code>sudo systemctl restart fdcsds</code>. The application hashes it on first
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

<style>
  /* "1a Ambient Panel" login — see design_handoff_login_1a. Dark, full-bleed,
     always dark regardless of theme; colors are pinned to the handoff. */
  .login-root {
    position: relative;
    min-height: 100vh;
    overflow: hidden;
    background: #0a0c0f;
    color: #e6e9ef;
  }
  .login-dots {
    position: absolute;
    inset: 0;
    background-image: radial-gradient(rgba(255, 255, 255, 0.045) 1px, transparent 1px);
    background-size: 26px 26px;
    opacity: 0.9;
  }
  .login-bloom {
    position: absolute;
    left: 50%;
    top: -14%;
    width: 900px;
    height: 640px;
    transform: translateX(-50%);
    background: radial-gradient(
      circle,
      rgba(255, 160, 30, 0.16) 0%,
      rgba(255, 160, 30, 0.05) 40%,
      transparent 70%
    );
    filter: blur(6px);
  }
  .login-floor {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, transparent 45%, rgba(5, 6, 7, 0.75) 100%);
  }
  .login-fg {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 34px;
    padding: 20px;
    box-sizing: border-box;
  }

  /* Brand cluster */
  .led-pill {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 12px 16px;
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid rgba(255, 255, 255, 0.06);
    box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.6);
  }
  .led {
    width: 15px;
    height: 15px;
    border-radius: 50%;
  }
  .led.on {
    background: radial-gradient(circle at 38% 32%, #ffe3a6 0%, #ffb020 46%, #e8860a 100%);
    box-shadow:
      0 0 10px rgba(255, 160, 30, 0.5),
      inset 0 -2px 3px rgba(120, 50, 0, 0.4),
      inset 0 1px 2px rgba(255, 255, 255, 0.6);
  }
  .led.off {
    background: radial-gradient(circle at 38% 32%, #2a2a2e, #141416 82%);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.75);
    border: 1px solid rgba(0, 0, 0, 0.4);
  }
  .login-wordmark {
    color: #f8f6f2;
    font-family: var(--font-sans);
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .login-sublabel {
    margin-top: 6px;
    color: #6d7580;
    font-family: var(--font-data);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.22em;
  }

  /* Card */
  .login-card {
    width: 440px;
    max-width: 100%;
    background: linear-gradient(180deg, #1a1e25 0%, #12151c 100%);
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 16px;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.05),
      0 30px 70px -30px rgba(0, 0, 0, 0.9);
    padding: 28px 28px 26px;
    box-sizing: border-box;
  }
  .login-body {
    color: #9aa2ad;
    font-family: var(--font-data);
    font-size: 12px;
    line-height: 1.55;
  }
  .login-fieldlabel {
    margin-top: 22px;
    color: #c4cad3;
    font-family: var(--font-data);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  .login-field {
    margin-top: 9px;
    position: relative;
    display: flex;
    align-items: center;
    background: #0b0d11;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.6);
  }
  .login-field:focus-within {
    border-color: rgba(255, 176, 32, 0.55);
  }
  .login-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    padding: 13px 14px;
    color: #e6e9ef;
    font-family: var(--font-data);
    font-size: 14px;
  }
  .login-input:focus {
    outline: none;
  }
  .login-input::placeholder {
    color: #4d5560;
  }
  .login-eye {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 42px;
    height: 44px;
    border: none;
    background: transparent;
    color: #6d7580;
    cursor: pointer;
  }
  .login-eye:hover {
    color: #c4cad3;
  }
  .login-error {
    margin-top: 12px;
    color: #ff6b6b;
    font-family: var(--font-data);
    font-size: 12px;
  }
  .login-signin {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 104px;
    height: 44px;
    padding: 0 22px;
    border: none;
    border-radius: 999px;
    background: #ffb020;
    color: #0a0c0f;
    font-family: var(--font-sans);
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 6px 20px -6px rgba(255, 160, 30, 0.6);
  }
  .login-signin:hover:not(:disabled) {
    filter: brightness(1.08);
  }
  .login-signin:disabled {
    opacity: 0.7;
    cursor: default;
  }

  /* Footer */
  .login-footer {
    width: 440px;
    max-width: 100%;
    color: #5b636e;
    font-family: var(--font-data);
    font-size: 11px;
    line-height: 1.6;
    text-align: center;
  }
</style>
