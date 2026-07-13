/**
 * Tests for client-service instance-awareness (Bitsby8): flagging which clients
 * are virtual machine instances (`inst:<id>`), whether their machine still
 * exists, and cleaning up the orphans a deleted machine leaves behind.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../src/database';
import { Dependencies } from '../src/types';
import { listClients, cleanupOrphanInstanceClients } from '../src/services/client-service';

async function makeDeps(liveInstanceClientIds: string[]): Promise<Dependencies> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-cli-'));
  const db = new Database(path.join(dir, 'test.db'));
  await db.initialize();
  return {
    database: db,
    writeMaster: '',
    instanceManager: { list: () => liveInstanceClientIds.map((clientId) => ({ clientId })) },
  } as unknown as Dependencies;
}

describe('client-service instance-awareness', () => {
  test('flags instance clients and whether their machine still exists', async () => {
    const deps = await makeDeps(['inst:live']);
    // A live instance client, an orphan instance client, and a plain external one.
    await deps.database.setClientLabel('inst:live', 'live machine');
    await deps.database.setClientLabel('inst:orphan', '');
    await deps.database.setClientLabel('esp32-a', 'a real device');

    const { clients } = await listClients(deps);
    const by = new Map(clients.map((c) => [c.clientId, c]));

    expect(by.get('inst:live')).toMatchObject({ isInstance: true, instanceId: 'live', instanceExists: true });
    expect(by.get('inst:orphan')).toMatchObject({ isInstance: true, instanceId: 'orphan', instanceExists: false });
    expect(by.get('esp32-a')).toMatchObject({ isInstance: false, instanceId: null, instanceExists: false });
  });

  test('cleanup forgets only the orphaned instance clients', async () => {
    const deps = await makeDeps(['inst:live']);
    await deps.database.setClientLabel('inst:live', '');
    await deps.database.setClientLabel('inst:orphan', '');
    await deps.database.setClientMount('inst:orphan', 0, 'scratch.dsk', false);
    await deps.database.setClientLabel('esp32-a', 'device');

    const cleaned = await cleanupOrphanInstanceClients(deps);
    expect(cleaned).toEqual(['inst:orphan']);

    const { clients } = await listClients(deps);
    const ids = clients.map((c) => c.clientId);
    expect(ids).toContain('inst:live'); // live machine untouched
    expect(ids).toContain('esp32-a'); // external client untouched
    expect(ids).not.toContain('inst:orphan'); // orphan forgotten (label + mount gone)
  });
});
