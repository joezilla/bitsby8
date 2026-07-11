/**
 * Lifecycle tests for ConnectionManager using a fake WebSocket. Verifies that
 * a virtual client is registered with its own session and that closing the
 * socket tears it down. Full protocol round-trips are covered by the live
 * end-to-end path; here we assert the bookkeeping/teardown.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ConnectionManager } from '../src/services/connection-manager';
import { getMountRegistry } from '../src/mount-registry';

// Minimal WebSocket stand-in: OPEN, no-op send, emits 'close' on demand.
class FakeSocket extends EventEmitter {
  readyState = 1; // WebSocket.OPEN
  send(_data: any, cb?: (err?: Error) => void) { if (cb) cb(); }
  close() { this.readyState = 3; this.emit('close'); }
}

function tick(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

describe('ConnectionManager lifecycle', () => {
  test('addWsClient registers a client; closing the socket removes it', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-cm-'));
    const disks = path.join(dir, 'disks');
    await fs.mkdir(disks, { recursive: true });
    const master = path.join(disks, 'game.dsk');
    await fs.writeFile(master, Buffer.alloc(256, 0));

    // The manager builds sessions against the global mount registry.
    const registry = getMountRegistry();
    registry.set(0, master, false);

    const deps = {
      io: { emit() { /* noop */ } },
      runtimeConfig: { verbose: false, debug: false },
    } as any;
    const cm = new ConnectionManager(deps);

    const ws = new FakeSocket();
    await cm.addWsClient(ws as any, 'altair-1');

    expect(cm.count()).toBe(1);
    const info = cm.list();
    expect(info[0].clientId).toBe('altair-1');
    expect(info[0].transport).toBe('websocket');

    // Closing the socket tears the connection down.
    ws.close();
    await tick();
    expect(cm.count()).toBe(0);

    await cm.stopAll();
    registry.clear(0);
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('stopAll disposes all connections', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-cm2-'));
    const disks = path.join(dir, 'disks');
    await fs.mkdir(disks, { recursive: true });
    const master = path.join(disks, 'game.dsk');
    await fs.writeFile(master, Buffer.alloc(256, 0));
    const registry = getMountRegistry();
    registry.set(0, master, false);

    const deps = { io: { emit() {} }, runtimeConfig: {} } as any;
    const cm = new ConnectionManager(deps);
    await cm.addWsClient(new FakeSocket() as any, 'a');
    await cm.addWsClient(new FakeSocket() as any, 'b');
    expect(cm.count()).toBe(2);

    await cm.stopAll();
    expect(cm.count()).toBe(0);

    registry.clear(0);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
