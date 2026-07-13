/**
 * `true` while the browser tab is visible, `false` when hidden (backgrounded,
 * minimized, another tab). Pollers and live-stream subscriptions read this to
 * go quiet when nobody's looking — a real relief for a Raspberry Pi host that
 * would otherwise keep sampling video/front-panel state for an unseen page.
 */

import { readable } from 'svelte/store';

const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

export const pageVisible = readable(visible(), (set) => {
  if (typeof document === 'undefined') return;
  const update = () => set(visible());
  document.addEventListener('visibilitychange', update);
  return () => document.removeEventListener('visibilitychange', update);
});
