/**
 * The Terminal page's active virtual-instance console selection, held OUTSIDE
 * the component so navigating away and back resumes the same session instead of
 * starting from scratch. The emulator keeps running server-side and its
 * `ConsoleHub` buffers output continuously (even with no subscriber), so on
 * return we re-subscribe and the server replays the scrollback — including
 * anything printed while the page was gone.
 *
 * `null` = no virtual session (disconnected, or a hardware serial connection,
 * whose liveness is tracked separately by the backend + `terminalStatus`).
 */

import { writable } from 'svelte/store';

export const terminalInstanceSession = writable<string | null>(null);
