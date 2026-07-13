import { writable } from 'svelte/store';

/**
 * Deep-link intent: the clientId the Clients page should scroll to and briefly
 * highlight when it opens. Set by "View client" on a machine instance (which
 * then navigates to the Clients page); consumed + cleared by ClientsPage.
 */
export const pendingClientFocus = writable<string | null>(null);
