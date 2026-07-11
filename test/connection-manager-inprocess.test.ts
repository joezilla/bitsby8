/**
 * ConnectionManager in-process serving (Bitsby8 Story 1.4): a local virtual
 * client is served over an in-process FDC channel — same session/splinter
 * machinery as a WebSocket client — and closing the channel tears it down.
 * (Full protocol round-trips are covered by the Story 1.5 end-to-end boot.)
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ConnectionManager } from '../src/services/connection-manager';
import { getMountRegistry } from '../src/mount-registry';

function tick(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

async function harness() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-cmip-'));
  const disks = path.join(dir, 'disks');
  await fs.mkdir(disks, { recursive: true });
  const master = path.join(disks, 'game.dsk');
  await fs.writeFile(master, Buffer.alloc(256, 0));
  const registry = getMountRegistry();
  registry.set(0, master, false);
  const deps = { io: { emit() {} }, runtimeConfig: { verbose: false, debug: false } } as any;
  const cm = new ConnectionManager(deps);
  return { dir, registry, cm };
}

describe('ConnectionManager in-process client', () => {
  test('addInProcessClient registers a served client and returns a usable channel', async () => {
    const { dir, registry, cm } = await harness();

    const { channel, id } = await cm.addInProcessClient('altair-vm-1');
    expect(typeof id).toBe('string');
    expect(typeof channel.send).toBe('function');
    expect(channel.readyState).toBe(1);

    expect(cm.count()).toBe(1);
    const info = cm.list();
    expect(info[0].clientId).toBe('altair-vm-1');
    expect(info[0].transport).toBe('in-process'); // distinguished from websocket clients

    // Closing the channel tears the served connection down (like a socket close).
    channel.close();
    await tick();
    expect(cm.count()).toBe(0);

    await cm.stopAll();
    registry.clear(0);
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('virtual (in-process) and physical (websocket) clients coexist in one list', async () => {
    const { dir, registry, cm } = await harness();
    const { EventEmitter } = await import('events');
    class FakeSocket extends EventEmitter {
      readyState = 1;
      send(_d: unknown, cb?: (e?: Error) => void) {
        if (cb) cb();
      }
      close() {
        this.readyState = 3;
        this.emit('close');
      }
    }

    await cm.addWsClient(new FakeSocket() as any, 'physical-altair');
    const { channel } = await cm.addInProcessClient('virtual-vm');

    expect(cm.count()).toBe(2);
    const kinds = cm.list().map((c) => `${c.clientId}:${c.transport}`).sort();
    expect(kinds).toEqual(['physical-altair:websocket', 'virtual-vm:in-process']);

    channel.close();
    await tick();
    expect(cm.count()).toBe(1);

    await cm.stopAll();
    registry.clear(0);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
