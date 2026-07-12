/**
 * Per-machine Run cockpit layout — which console/monitor pane is maximized and
 * whether the Front Panel and GPIO panels are expanded. Keyed by instance id so
 * re-opening a machine's cockpit (or navigating away and back) restores its
 * collapsed/maximized state instead of snapping to defaults.
 *
 * Persists to localStorage (so it also survives a reload), following the same
 * SSR/try-catch guards as the theme store.
 */

import { writable, get } from 'svelte/store';

export type DuoLayout = 'both' | 'cmax' | 'mmax';

export interface CockpitLayout {
  /** Console|Monitor split: both 50/50, console-max, or monitor-max. */
  duo: DuoLayout;
  /** Front Panel expanded. */
  frontPanelOpen: boolean;
  /** GPIO panel expanded. */
  gpioOpen: boolean;
}

export const DEFAULT_LAYOUT: CockpitLayout = { duo: 'both', frontPanelOpen: true, gpioOpen: true };

const STORAGE_KEY = 'fdcplus.cockpitLayout';
const MAX_ENTRIES = 50; // bound growth from stopped/relaunched instances

type LayoutMap = Record<string, CockpitLayout>;

function readInitial(): LayoutMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as LayoutMap) : {};
  } catch {
    // Safari private mode, disabled/corrupt storage, etc.
    return {};
  }
}

const layouts = writable<LayoutMap>(readInitial());

layouts.subscribe((map) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Quota exceeded or storage disabled; layout still lives in memory.
  }
});

/** The saved layout for an instance, or the default when none is stored. */
export function getCockpitLayout(instanceId: string): CockpitLayout {
  return { ...DEFAULT_LAYOUT, ...get(layouts)[instanceId] };
}

/** Persist a (partial) layout change for an instance. */
export function setCockpitLayout(instanceId: string, patch: Partial<CockpitLayout>): void {
  layouts.update((map) => {
    const next: LayoutMap = { ...map, [instanceId]: { ...DEFAULT_LAYOUT, ...map[instanceId], ...patch } };
    // Keep only the most-recently-written entries so dead instances don't pile up.
    const keys = Object.keys(next);
    for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete next[stale];
    return next;
  });
}
