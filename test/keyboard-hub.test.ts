/**
 * Tests for keyboard card detection (Bitsby8 Story 5.9): keyboardSourceFromCard
 * picks out a keyboard card's `.keyboard` surface (the input counterpart to
 * displaySourceFromCard).
 */
import { keyboardSourceFromCard } from '../src/services/keyboard-hub';

describe('keyboardSourceFromCard', () => {
  test('detects a card exposing a .keyboard surface', () => {
    const card = { id: 'k', keyboard: { press: () => {}, type: () => {}, pending: 0 } };
    expect(keyboardSourceFromCard(card)).toBe(card.keyboard);
  });

  test('returns null for a non-keyboard card or an incomplete surface', () => {
    expect(keyboardSourceFromCard({ id: 'x', channel: {} })).toBeNull(); // a serial card
    expect(keyboardSourceFromCard({ id: 'x', keyboard: { press: () => {} } })).toBeNull(); // missing type()
    expect(keyboardSourceFromCard(null)).toBeNull();
    expect(keyboardSourceFromCard(undefined)).toBeNull();
  });
});
