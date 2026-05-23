/** Theme store — dark (default) / light. Persists to localStorage and syncs to <html data-theme>. */

import { writable } from 'svelte/store';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'fdcplus.theme';

function readInitial(): Theme {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'light' ? 'light' : 'dark';
  } catch {
    // Safari private mode, disabled storage, etc.
    return 'dark';
  }
}

function applyToDom(value: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', value);
}

const initial = readInitial();
applyToDom(initial);

export const theme = writable<Theme>(initial);

theme.subscribe((value) => {
  applyToDom(value);
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Quota exceeded or storage disabled; theme still applied to DOM.
  }
});

export function toggleTheme(): void {
  theme.update((t) => (t === 'dark' ? 'light' : 'dark'));
}
