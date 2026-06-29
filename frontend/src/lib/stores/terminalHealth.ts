/** Terminal health store — tracks xterm renderer fallback state.
 *
 * Webgl rendering fails on some browsers / GPUs. When it fails the terminal
 * silently falls back to canvas, which is functional but slow on long
 * sessions. The TopBar Term LED surfaces this so the operator knows.
 */

import { writable } from 'svelte/store';

export type TerminalHealth = 'ok' | 'webgl-fallback';

export const terminalHealth = writable<TerminalHealth>('ok');
