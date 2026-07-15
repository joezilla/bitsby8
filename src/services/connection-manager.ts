/**
 * ConnectionManager — owns the extra per-connection FDC command loops used
 * when multi-client serving is ON. Each virtual (WebSocket) client gets its
 * own transport instance, its own FdcServer loop, and its own copy-on-write
 * DriveSession over the shared operator mounts.
 *
 * This runs ALONGSIDE the existing single-server path: the master/serial
 * client keeps being served by the shared DriveManager + deps.server. When the
 * multi-client flag is OFF this manager is never invoked, so the legacy path is
 * byte-for-byte unchanged.
 */

import { WebSocket } from 'ws';
import type { WebSocketLike } from '@joezilla/8sim';
import { randomUUID } from 'crypto';
import { Dependencies } from '../types';
import { WsTransportManager } from '../ws-transport';
import { IFdcTransport } from '../transport';
import { InProcessFdcChannel } from './in-process-fdc-channel';
import { DriveSession } from '../drive-session';
import { FdcServer } from '../server';
import { getMountRegistry } from '../mount-registry';
import { getClientMountRegistry } from '../client-mount-registry';
import { INSTANCE_CLIENT_PREFIX } from './instance-manager';
import { createDefaultConfig } from '../protocol';
import { createLogger } from '../logger';

const log = createLogger('connection-manager');

type TransportKind = 'websocket' | 'in-process';

interface ConnectionContext {
  id: string;
  clientId: string | null;
  transport: IFdcTransport;
  kind: TransportKind;
  session: DriveSession;
  server: FdcServer;
  task: Promise<void> | null;
  connectedAt: number;
}

export interface ConnectedClientInfo {
  id: string;
  clientId: string | null;
  transport: TransportKind;
  connectedAt: number;
}

export class ConnectionManager {
  private connections = new Map<string, ConnectionContext>();

  constructor(private deps: Dependencies) {}

  /**
   * Accept a virtual FDC WebSocket client as its own served connection.
   * Only called when the multi-client flag is on.
   */
  async addWsClient(ws: WebSocket, clientId: string | null): Promise<void> {
    const transport = new WsTransportManager();
    transport.acceptConnection(ws);
    const id = await this.startServed(transport, clientId, 'websocket');
    // Tear down when the socket closes.
    ws.on('close', () => { void this.remove(id); });
    log.info({ id, clientId, transport: 'websocket', total: this.connections.size }, 'multi-client FDC connection started');
    this.broadcast();
  }

  /**
   * Accept a LOCAL virtual client over an in-process FDC frame channel (no TCP,
   * AD-3). Returns the client-side WebSocketLike to hand to the emulated card's
   * FdcPlusClient, plus the connection id. Closing the channel tears the served
   * connection down, exactly like a socket close.
   */
  async addInProcessClient(clientId: string | null): Promise<{ channel: WebSocketLike; id: string }> {
    const channel = new InProcessFdcChannel();
    const id = await this.startServed(channel.server, clientId, 'in-process');
    channel.setOnClose(() => { void this.remove(id); });
    log.info({ id, clientId, transport: 'in-process', total: this.connections.size }, 'in-process FDC connection started');
    this.broadcast();
    return { channel: channel.client, id };
  }

  /**
   * Build and start a served connection over any FDC transport (a real
   * WebSocket or an in-process channel). Each gets its own DriveSession —
   * a supplied clientId → persistent splinters; anonymous → ephemeral; the
   * designated master client writes the base image directly.
   */
  private async startServed(transport: IFdcTransport, clientId: string | null, kind: TransportKind): Promise<string> {
    const id = randomUUID();
    const writesMaster = clientId != null && clientId === this.deps.writeMaster;
    // A VM instance owns its drives (from its profile definition); it does not
    // inherit the shared served spindle the serial box + external clients share.
    const inheritsGlobal = !clientId?.startsWith(INSTANCE_CLIENT_PREFIX);
    const session = new DriveSession({
      clientId,
      registry: getMountRegistry(),
      clientMounts: getClientMountRegistry(),
      database: this.deps.database,
      writesMaster,
      inheritsGlobal,
    });
    await session.sync();

    const config = createDefaultConfig();
    config.verbose = this.deps.runtimeConfig?.verbose || false;
    config.debug = this.deps.runtimeConfig?.debug || false;

    const server = new FdcServer(session, transport, config);
    const ctx: ConnectionContext = {
      id, clientId, transport, kind, session, server, task: null, connectedAt: Date.now(),
    };
    this.connections.set(id, ctx);

    ctx.task = server.start().catch((err) => {
      log.error({ err, id, clientId }, 'per-connection FDC loop error');
    });
    return id;
  }

  private async remove(id: string): Promise<void> {
    const ctx = this.connections.get(id);
    if (!ctx) return;
    this.connections.delete(id);
    ctx.server.stop();
    await ctx.session.dispose();
    log.info({ id, clientId: ctx.clientId, total: this.connections.size }, 'multi-client FDC connection ended');
    this.broadcast();
  }

  /** Re-sync every session with the mount registry (operator remounts). */
  async syncAll(): Promise<void> {
    for (const ctx of this.connections.values()) {
      await ctx.session.sync().catch((err) => log.error({ err, id: ctx.id }, 'session sync failed'));
    }
  }

  /** Re-sync only the live sessions for one client (per-client mount change). */
  async syncClient(clientId: string): Promise<void> {
    for (const ctx of this.connections.values()) {
      if (ctx.clientId === clientId) {
        await ctx.session.sync().catch((err) => log.error({ err, id: ctx.id }, 'session sync failed'));
      }
    }
  }

  list(): ConnectedClientInfo[] {
    return Array.from(this.connections.values()).map((c) => ({
      id: c.id,
      clientId: c.clientId,
      transport: c.kind,
      connectedAt: c.connectedAt,
    }));
  }

  count(): number {
    return this.connections.size;
  }

  /** Stop and dispose every managed connection. */
  async stopAll(): Promise<void> {
    for (const id of Array.from(this.connections.keys())) {
      await this.remove(id);
    }
  }

  private broadcast(): void {
    try {
      this.deps.io?.emit('status', require('./status').getStatus(this.deps));
    } catch {
      /* status broadcast is best-effort */
    }
  }
}
