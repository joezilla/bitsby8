/**
 * Tests for the peripheral binding registry (Bitsby8 Story 5.6): the vocabulary
 * of endpoint types a card's far side can bind to, and which are wired today.
 */
import { listPeripheralEndpoints, EndpointType } from '../src/services/peripheral-registry';
import { Dependencies } from '../src/types';

const deps = {} as unknown as Dependencies;

describe('peripheral registry', () => {
  test('lists the full endpoint taxonomy', () => {
    const types = listPeripheralEndpoints(deps).map((e) => e.type).sort();
    expect(types).toEqual<EndpointType[]>(['clock', 'disk', 'display', 'gpio', 'socket', 'terminal']);
  });

  test('terminal, disk, clock, gpio are wired today; display/socket name their story', () => {
    const byType = new Map(listPeripheralEndpoints(deps).map((e) => [e.type, e]));
    for (const t of ['terminal', 'disk', 'clock', 'gpio'] as EndpointType[]) {
      expect(byType.get(t)!.available).toBe(true);
    }
    for (const t of ['display', 'socket'] as EndpointType[]) {
      expect(byType.get(t)!.available).toBe(false);
      expect(byType.get(t)!.arrivesWith).toBeTruthy(); // says when it lands
    }
  });

  test('every endpoint carries a human label + description', () => {
    for (const e of listPeripheralEndpoints(deps)) {
      expect(e.label.length).toBeGreaterThan(0);
      expect(e.description.length).toBeGreaterThan(0);
    }
  });
});
