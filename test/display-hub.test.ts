/**
 * Tests for video card detection (Bitsby8 Story 5.9): displaySourceFromCard
 * picks out a card's `.display` surface (the counterpart to consoleSourceFromCard).
 */
import { displaySourceFromCard } from '../src/services/display-hub';

describe('displaySourceFromCard', () => {
  test('detects a card exposing a .display surface', () => {
    const card = {
      id: 'vdm',
      display: { descriptor: { mode: 'charGrid', cols: 64, rows: 16, font: 'vdm', attrBit: 7 }, frame: () => ({ bytes: new Uint8Array(1024), state: {} }) },
    };
    expect(displaySourceFromCard(card)).toBe(card.display);
  });

  test('returns null for a card with no display', () => {
    expect(displaySourceFromCard({ id: 'x', clock: {} })).toBeNull();
    expect(displaySourceFromCard({ id: 'x', display: { descriptor: {} } })).toBeNull(); // no frame()
    expect(displaySourceFromCard(null)).toBeNull();
  });
});
