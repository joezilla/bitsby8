import { writable } from 'svelte/store';

/**
 * Deep-link intent: the id of an instance the Machines page should open in the
 * Run cockpit as soon as it appears in its polled instance list.
 *
 * Set by the "Launch" action on a machine profile (which then navigates to the
 * Machines page); consumed and cleared by MachinesPage once the instance shows.
 */
export const pendingRunInstance = writable<string | null>(null);
