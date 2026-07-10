/**
 * Tests for ClientMountRegistry (in-memory per-client drive-bay overrides).
 */

import { ClientMountRegistry } from '../src/client-mount-registry';

describe('ClientMountRegistry', () => {
  test('set records an override and bumps epoch; get reflects it', () => {
    const r = new ClientMountRegistry();
    expect(r.get('a', 0)).toBeNull();
    r.set('a', 0, 'game.dsk', true);
    const e1 = r.get('a', 0)!;
    expect(e1).toMatchObject({ filename: 'game.dsk', readonly: true });
    expect(e1.epoch).toBeGreaterThan(0);

    r.set('a', 0, 'other.dsk', false);
    expect(r.get('a', 0)!.filename).toBe('other.dsk');
    expect(r.get('a', 0)!.epoch).toBeGreaterThan(e1.epoch);
  });

  test('overrides are isolated per client', () => {
    const r = new ClientMountRegistry();
    r.set('a', 0, 'a0.dsk', false);
    r.set('b', 0, 'b0.dsk', false);
    expect(r.get('a', 0)!.filename).toBe('a0.dsk');
    expect(r.get('b', 0)!.filename).toBe('b0.dsk');
  });

  test('clear removes one drive; clearClient removes all', () => {
    const r = new ClientMountRegistry();
    r.set('a', 0, 'x.dsk', false);
    r.set('a', 1, 'y.dsk', false);
    r.clear('a', 0);
    expect(r.get('a', 0)).toBeNull();
    expect(r.get('a', 1)).not.toBeNull();
    r.clearClient('a');
    expect(r.get('a', 1)).toBeNull();
    expect(r.forClient('a').size).toBe(0);
  });

  test('forClient returns a snapshot of the client overrides', () => {
    const r = new ClientMountRegistry();
    r.set('a', 0, 'x.dsk', false);
    r.set('a', 2, 'z.dsk', true);
    const snap = r.forClient('a');
    expect(snap.size).toBe(2);
    expect(snap.get(2)!.readonly).toBe(true);
  });
});
