/**
 * Tracks per-section dirty state + pending-restart state for ConfigPage.
 *
 * Every ConfigSection registers itself with a section id ('serial',
 * 'web', ...) and reports two flags:
 *   - dirty: user has unsaved edits
 *   - restartPending: user has SAVED changes that need a restart to
 *     take effect (cleared automatically when startupEpoch changes)
 *
 * A sticky RestartBanner subscribes to the derived totals so the whole
 * page can show a single "3 unsaved changes · 1 restart pending"
 * summary without every section prop-drilling into it.
 */

import { writable, derived, get } from 'svelte/store';

export type SectionId =
  | 'serial'
  | 'web'
  | 'terminal'
  | 'logging'
  | 'gpio';

interface SectionState {
  dirty: boolean;
  restartPending: boolean;
}

const initial: Record<SectionId, SectionState> = {
  serial: { dirty: false, restartPending: false },
  web: { dirty: false, restartPending: false },
  terminal: { dirty: false, restartPending: false },
  logging: { dirty: false, restartPending: false },
  gpio: { dirty: false, restartPending: false },
};

export const configSections = writable<Record<SectionId, SectionState>>(initial);

/** Total number of sections with unsaved edits. */
export const dirtyCount = derived(configSections, ($sections) =>
  Object.values($sections).filter((s) => s.dirty).length,
);

/** Total number of sections that saved successfully but still need a restart. */
export const restartPendingCount = derived(configSections, ($sections) =>
  Object.values($sections).filter((s) => s.restartPending).length,
);

export function setDirty(id: SectionId, dirty: boolean): void {
  configSections.update((s) => ({
    ...s,
    [id]: { ...s[id], dirty },
  }));
}

export function setRestartPending(id: SectionId, pending: boolean): void {
  configSections.update((s) => ({
    ...s,
    [id]: { ...s[id], restartPending: pending },
  }));
}

/**
 * Clear every section's `restartPending` flag. Call this after the UI
 * has detected a fresh startupEpoch (i.e. the daemon really came back).
 */
export function clearAllRestartPending(): void {
  configSections.update((s) => {
    const next: Record<SectionId, SectionState> = { ...s };
    for (const id of Object.keys(next) as SectionId[]) {
      next[id] = { ...next[id], restartPending: false };
    }
    return next;
  });
}

/** True if any section has unsaved edits — useful for `beforeunload` prompts. */
export function anyDirty(): boolean {
  return get(dirtyCount) > 0;
}
