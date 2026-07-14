import { writable } from 'svelte/store';

/**
 * Deep-link intent: a profile ref the Profiles page should open on arrival.
 *
 * Set by "profileRef" links on a running machine (cockpit + Machines card),
 * which then navigate to the Profiles page; consumed + cleared by ProfilesPage
 * once the profile appears in its loaded list. The value is a raw instance
 * `profileRef` — a bare profile id, or `preset:<id>` (ProfilesPage strips the
 * prefix to match). `inline` refs have no profile and are never linked.
 */
export const pendingProfileFocus = writable<string | null>(null);
