import { writable } from 'svelte/store';

/**
 * Deep-link intent: a disk image filename the Disks page should filter to and
 * briefly highlight in its library on arrival.
 *
 * Set by disk-name links elsewhere (the run cockpit, Machines cards, a client's
 * splinter), which then navigate to the Disks page; consumed + cleared by
 * DisksPage.
 */
export const pendingDiskFocus = writable<string | null>(null);
