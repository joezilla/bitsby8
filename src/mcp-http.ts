/**
 * MCP over Streamable HTTP.
 *
 * Mounts `/mcp` on the existing Express app so remote Claude Code
 * clients on the trusted LAN can drive FDC+ tools. Bearer auth is
 * applied by the caller (see `web-server.ts`) — this module assumes
 * the request already cleared the auth gate.
 *
 * Sessions are stateful: each initialize creates a fresh `McpServer`
 * bound to its own transport, keyed by the SDK-generated session id.
 * Stateless mode would drop server-initiated notifications, so
 * long-running tool progress would silently vanish.
 */

import { randomUUID } from 'crypto';
import { Router, Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { Dependencies } from './types';
import { createMcpServer } from './mcp-server';
import { createLogger } from './logger';

const log = createLogger('mcp-http');

const transports = new Map<string, StreamableHTTPServerTransport>();

/**
 * Runtime enable flag. Toggled by the config-save path so operators
 * can flip MCP on/off without a daemon restart. When false, all
 * `/mcp` requests short-circuit to 503.
 */
let mcpEnabled = false;

export function setMcpHttpEnabled(enabled: boolean): void {
  const prev = mcpEnabled;
  mcpEnabled = enabled;
  if (prev && !enabled) {
    // Disabling: drop live sessions so clients see a clean close
    // rather than a stale connection that no longer responds.
    closeAllMcpSessions();
  }
}

export function isMcpHttpEnabled(): boolean {
  return mcpEnabled;
}

export function activeMcpSessionCount(): number {
  return transports.size;
}

export function closeAllMcpSessions(): void {
  for (const t of transports.values()) {
    try {
      t.close();
    } catch (err) {
      log.warn({ err }, 'Failed to close MCP session cleanly');
    }
  }
  transports.clear();
}

export function registerMcpRoutes(router: Router, deps: Dependencies): void {
  const guard = (req: Request, res: Response, next: () => void): void => {
    if (!mcpEnabled) {
      log.warn(
        { method: req.method, path: req.path },
        'MCP request rejected — transport disabled (set enableMcpHttp + apiKey)',
      );
      res.status(503).json({ error: 'MCP HTTP transport is disabled.' });
      return;
    }
    next();
  };

  router.post('/mcp', guard, async (req: Request, res: Response): Promise<void> => {
    const sid = req.header('mcp-session-id');
    let transport = sid ? transports.get(sid) : undefined;

    if (!transport) {
      if (!isInitializeRequest(req.body)) {
        res.status(400).json({
          error: 'Missing or unknown Mcp-Session-Id — send an initialize request first.',
        });
        return;
      }
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport!);
          log.info({ sessionId: id, active: transports.size }, 'MCP session initialized');
        },
      });
      transport.onclose = () => {
        const id = transport!.sessionId;
        if (id) {
          transports.delete(id);
          log.info({ sessionId: id, active: transports.size }, 'MCP session closed');
        }
      };
      const server = createMcpServer(deps);
      await server.connect(transport);
    }

    try {
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log.error({ err }, 'MCP request handling failed');
      if (!res.headersSent) {
        res.status(500).json({ error: 'MCP request handling failed.' });
      }
    }
  });

  const streamPassthrough = async (req: Request, res: Response): Promise<void> => {
    const sid = req.header('mcp-session-id');
    const t = sid ? transports.get(sid) : undefined;
    if (!t) {
      res.status(400).json({ error: 'Unknown or missing Mcp-Session-Id.' });
      return;
    }
    try {
      await t.handleRequest(req, res);
    } catch (err) {
      log.error({ err }, 'MCP stream handling failed');
      if (!res.headersSent) res.status(500).end();
    }
  };
  router.get('/mcp', guard, streamPassthrough);
  router.delete('/mcp', guard, streamPassthrough);
}
