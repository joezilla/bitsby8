/**
 * Per-machine Run cockpit keyboard routing — where the operator's real keyboard
 * is delivered to the guest when focus is outside the serial console pane.
 *
 * `'auto'` keeps the derived heuristic (keyboard card if present, else the serial
 * console when the monitor is maximized). An explicit value overrides it:
 *   - `'serial'`      → the designated serial console (instance:console:write)
 *   - `'kbd:<cardId>'`→ a specific keyboard card's data port
 *
 * Keyed by **profile ref** (name@version), not instance id, so the choice sticks
 * across re-spun transient instances of the same machine — "remember how I drive
 * this machine", not "remember this one ephemeral run". Card ids are stable per
 * profile, so a stored `kbd:<cardId>` stays meaningful.
 *
 * Persists to localStorage with the same SSR/try-catch guards as cockpitLayout.
 */

import { writable, get } from 'svelte/store';

/** `'auto'` | `'serial'` | `'kbd:<cardId>'`. */
export type KeyboardRoute = string;

export const AUTO_ROUTE: KeyboardRoute = 'auto';

const STORAGE_KEY = 'fdcplus.keyboardRoute';
const MAX_ENTRIES = 50; // bound growth across many profiles

type RouteMap = Record<string, KeyboardRoute>;

function readInitial(): RouteMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as RouteMap) : {};
  } catch {
    return {};
  }
}

const routes = writable<RouteMap>(readInitial());

routes.subscribe((map) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Quota exceeded or storage disabled; the value still lives in memory.
  }
});

/** The saved route for a profile, or `'auto'` when none is stored. */
export function getKeyboardRoute(profileRef: string): KeyboardRoute {
  return get(routes)[profileRef] ?? AUTO_ROUTE;
}

/** Persist the route for a profile. `'auto'` clears the stored override. */
export function setKeyboardRoute(profileRef: string, route: KeyboardRoute): void {
  routes.update((map) => {
    const next = { ...map };
    if (route === AUTO_ROUTE) {
      delete next[profileRef];
    } else {
      next[profileRef] = route;
    }
    // Evict oldest-inserted keys if the map grows unbounded.
    const keys = Object.keys(next);
    if (keys.length > MAX_ENTRIES) {
      for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete next[k];
    }
    return next;
  });
}
