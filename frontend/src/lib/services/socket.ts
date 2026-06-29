/** Socket.IO client with typed Svelte stores. */

import { io } from 'socket.io-client';
import { writable } from 'svelte/store';
import type { ServerStatus, TerminalStatus, ReplayProgress } from '$lib/types/api';

export const socket = io({ autoConnect: true });

// Reactive stores derived from socket events
export const serverStatus = writable<ServerStatus | null>(null);
export const terminalStatus = writable<TerminalStatus | null>(null);
export const replayProgress = writable<ReplayProgress | null>(null);
export const connected = writable(false);

socket.on('connect', () => {
  connected.set(true);
  socket.emit('request-status');
});

socket.on('disconnect', () => {
  connected.set(false);
});

socket.on('status', (data: ServerStatus) => {
  serverStatus.set(data);
});

socket.on('terminal:status', (data: TerminalStatus) => {
  terminalStatus.set(data);
});

socket.on('replay:progress', (data: ReplayProgress) => {
  replayProgress.set(data);
});
