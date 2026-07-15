/**
 * WebSocket (Socket.IO) event handlers.
 *
 * SECURITY: WebSocket connections are NOT gated by session/bearer
 * auth today. The Express `createSessionOrBearerAuth` middleware runs
 * on HTTP requests to `/api/*`; Socket.IO's initial HTTP handshake
 * bypasses that mount and long-poll upgrades don't run Express
 * middleware at all. Copying the auth middleware into this file
 * "helpfully" will NOT fix it. A real fix needs one of: Socket.IO's
 * `use((socket, next) => ...)` connection middleware with cookie
 * parsing, a signed WS-connect token exchange, or gating this whole
 * mount behind the Express middleware before Socket.IO attaches.
 * Tracked separately from the login/API-key split.
 */

import { Server as SocketIOServer } from 'socket.io';
import { Dependencies } from '../types';
import { getStatus, getTerminalStatus } from '../services/status';
import { listInstanceDisplays, readInstanceFrontPanel } from '../services/instance-service';
import { safeErrorMessage } from '../utils/safe-path';
import { startRawReplay, startXmodemSend, cancelActiveTransfer } from '../services/transfer';
import { safeResolvePath } from '../utils/safe-path';

export function setupWebSocket(io: SocketIOServer, deps: Dependencies): void {
  io.on('connection', (socket) => {
    // Send initial status
    socket.emit('status', getStatus(deps));
    socket.emit('terminal:status', getTerminalStatus(deps));

    // Per-socket subscriptions to virtual instance consoles (Bitsby8).
    const consoleUnsubs = new Map<string, () => void>();

    // Per-socket subscriptions to *sampled* instance state (monitor displays,
    // front panel). Unlike the console — which is event-driven off the emulated
    // serial output — these are snapshots with no natural change event, so the
    // server samples them on a fixed cadence and pushes frames. This replaces
    // the old client-side REST polling (a monitor at 15fps was ~900 req/min per
    // viewer, which tripped the API rate limiter and pegged a Raspberry Pi's CPU
    // with per-request auth/session overhead). Now the browser holds one socket
    // and the server only does work while someone is actually subscribed.
    const sampledUnsubs = new Map<string, () => void>();

    /**
     * Start a server-driven sampling loop keyed by `key`, pushing `read()` on
     * `frameEvent` every `intervalMs`. Idempotent per key. Ends itself and
     * emits `errorEvent` when the read throws (e.g. the instance stopped).
     */
    function startSampled(
      key: string,
      intervalMs: number,
      read: () => unknown,
      frameEvent: string,
      errorEvent: string,
    ): void {
      if (!deps.instanceManager) {
        socket.emit(errorEvent, { message: 'virtual instances are not available' });
        return;
      }
      if (sampledUnsubs.has(key)) return; // already streaming to this socket
      let timer: ReturnType<typeof setInterval> | undefined;
      const stop = (): void => {
        if (timer) clearInterval(timer);
        sampledUnsubs.delete(key);
      };
      const tick = (): void => {
        try {
          socket.emit(frameEvent, read());
        } catch (error) {
          stop();
          socket.emit(errorEvent, { message: safeErrorMessage(error) });
        }
      };
      timer = setInterval(tick, intervalMs);
      sampledUnsubs.set(key, stop);
      tick(); // push one frame immediately so the panel isn't blank until the first tick
    }

    // Handle disconnect
    socket.on('disconnect', () => {
      for (const off of consoleUnsubs.values()) off();
      consoleUnsubs.clear();
      for (const off of sampledUnsubs.values()) off();
      sampledUnsubs.clear();
    });

    // --- Virtual instance console (Bitsby8, AD-6) ---

    socket.on('instance:console:subscribe', ({ instanceId }: { instanceId: string }) => {
      try {
        if (!deps.instanceManager) throw new Error('virtual instances are not available');
        if (consoleUnsubs.has(instanceId)) return; // idempotent
        // Replay the buffered scrollback (boot sign-on, prior output) first, so a
        // console opened AFTER the machine printed isn't blank. The read and the
        // live subscribe are synchronous with no yield between them, so no bytes
        // are dropped or duplicated at the seam.
        const history = deps.instanceManager.readConsole(instanceId);
        if (history.data) {
          socket.emit('instance:console:data', {
            instanceId,
            data: Array.from(history.data, (ch) => ch.charCodeAt(0) & 0xff),
          });
        }
        const off = deps.instanceManager.subscribeConsole(instanceId, {
          onOutput: (bytes) => socket.emit('instance:console:data', { instanceId, data: Array.from(bytes) }),
        });
        consoleUnsubs.set(instanceId, off);
      } catch (error) {
        socket.emit('instance:console:error', { instanceId, message: safeErrorMessage(error) });
      }
    });

    socket.on('instance:console:write', ({ instanceId, data }: { instanceId: string; data: string }) => {
      try {
        deps.instanceManager?.writeConsole(instanceId, data);
      } catch (error) {
        socket.emit('instance:console:error', { instanceId, message: safeErrorMessage(error) });
      }
    });

    socket.on('instance:console:unsubscribe', ({ instanceId }: { instanceId: string }) => {
      consoleUnsubs.get(instanceId)?.();
      consoleUnsubs.delete(instanceId);
    });

    // --- Virtual instance monitor (video displays) — server-pushed frames ---
    // ~12fps: smooth enough for a VDM/Dazzler, far lighter on the Pi than the
    // old 15fps REST poll (and no per-frame HTTP auth/session cost).
    socket.on('instance:monitor:subscribe', ({ instanceId }: { instanceId: string }) => {
      startSampled(
        `monitor:${instanceId}`,
        80,
        () => ({ instanceId, displays: listInstanceDisplays(deps, instanceId) }),
        'instance:monitor:frame',
        'instance:monitor:error',
      );
    });
    socket.on('instance:monitor:unsubscribe', ({ instanceId }: { instanceId: string }) => {
      sampledUnsubs.get(`monitor:${instanceId}`)?.();
    });

    // --- Virtual instance front panel — server-pushed state ---
    socket.on('instance:frontpanel:subscribe', ({ instanceId }: { instanceId: string }) => {
      startSampled(
        // ~4Hz: the cockpit's LED inertia loop (rAF) interpolates between these
        // samples, so a slower wire rate still reads smoothly while cutting
        // traffic. (Step B replaces this with backend-aggregated duty cycles.)
        `frontpanel:${instanceId}`,
        250,
        () => ({ instanceId, state: readInstanceFrontPanel(deps, instanceId) }),
        'instance:frontpanel:state',
        'instance:frontpanel:error',
      );
    });
    socket.on('instance:frontpanel:unsubscribe', ({ instanceId }: { instanceId: string }) => {
      sampledUnsubs.get(`frontpanel:${instanceId}`)?.();
    });

    // Handle status request
    socket.on('request-status', () => {
      socket.emit('status', getStatus(deps));
    });

    // Terminal WebSocket handlers

    // Handle terminal data from client (keyboard input)
    socket.on('terminal:write', async (data: string) => {
      try {
        if (deps.terminalManager.isOpen()) {
          await deps.terminalManager.write(Buffer.from(data));
        }
      } catch (error) {
        socket.emit('terminal:error', { message: safeErrorMessage(error) });
      }
    });

    // Handle terminal control signals
    socket.on('terminal:control', async (signal: { type: 'dtr' | 'rts'; value: boolean }) => {
      try {
        if (deps.terminalManager.isOpen()) {
          if (signal.type === 'dtr') {
            await deps.terminalManager.setDTR(signal.value);
          } else if (signal.type === 'rts') {
            await deps.terminalManager.setRTS(signal.value);
          }
        }
      } catch (error) {
        socket.emit('terminal:error', { message: safeErrorMessage(error) });
      }
    });

    // Replay Socket.IO handlers

    // Send current replay status on connect (if transfer is active)
    if (deps.replayEngine && deps.replayEngine.isRunning()) {
      const progress = deps.replayEngine.getLastProgress();
      if (progress) {
        socket.emit('replay:status', { active: true, mode: 'raw', progress });
      }
    } else if (deps.xmodemSender && deps.xmodemSender.isRunning()) {
      const progress = deps.xmodemSender.getLastProgress();
      if (progress) {
        socket.emit('replay:status', { active: true, mode: 'xmodem', progress });
      }
    }

    // Start replay/XMODEM via Socket.IO
    socket.on('replay:start', async (data: {
      scriptName: string;
      mode?: string;
      chunkSize?: number;
      interByteDelayMs?: number;
      interLineDelayMs?: number;
      lineEnding?: string;
      useCrc?: boolean;
    }) => {
      try {
        const { scriptName, mode, chunkSize, interByteDelayMs, interLineDelayMs, lineEnding, useCrc } = data;

        if (!scriptName) {
          socket.emit('replay:progress', {
            state: 'error', bytesSent: 0, totalBytes: 0,
            percentComplete: 0, fileName: '', error: 'scriptName is required',
          });
          return;
        }

        // Check for active transfer
        if ((deps.replayEngine && deps.replayEngine.isRunning()) ||
            (deps.xmodemSender && deps.xmodemSender.isRunning())) {
          socket.emit('replay:progress', {
            state: 'error', bytesSent: 0, totalBytes: 0,
            percentComplete: 0, fileName: scriptName, error: 'A transfer is already in progress',
          });
          return;
        }

        // Validate filename
        if (scriptName.includes('..') || scriptName.includes('/') || scriptName.includes('\\')) {
          socket.emit('replay:progress', {
            state: 'error', bytesSent: 0, totalBytes: 0,
            percentComplete: 0, fileName: scriptName, error: 'Invalid script name',
          });
          return;
        }

        const filePath = safeResolvePath(deps.config.scriptsDir, scriptName);
        if (!filePath) {
          socket.emit('replay:progress', {
            state: 'error', bytesSent: 0, totalBytes: 0,
            percentComplete: 0, fileName: scriptName, error: 'File not found',
          });
          return;
        }

        if (mode === 'xmodem') {
          startXmodemSend(deps, filePath, scriptName, useCrc);
        } else {
          startRawReplay(deps, filePath, scriptName, chunkSize, interByteDelayMs, interLineDelayMs, lineEnding);
        }
      } catch (error) {
        socket.emit('replay:progress', {
          state: 'error', bytesSent: 0, totalBytes: 0,
          percentComplete: 0, fileName: data?.scriptName || '', error: safeErrorMessage(error),
        });
      }
    });

    // Cancel active transfer via Socket.IO
    socket.on('replay:cancel', () => {
      cancelActiveTransfer(deps);
    });
  });

  // Setup terminal data handler to broadcast incoming serial data to all clients
  deps.terminalManager.onData((data: Buffer) => {
    io.emit('terminal:data', Array.from(data));
  });

  // Setup terminal error handler
  deps.terminalManager.onError((error: Error) => {
    io.emit('terminal:error', { message: error.message });
  });

  // Setup terminal close handler
  deps.terminalManager.onClose(() => {
    io.emit('terminal:status', getTerminalStatus(deps));
  });
}
