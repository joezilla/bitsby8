/**
 * Tests for GPIO card detection (Bitsby8 Story 5.8): gpioSourceFromCard picks
 * out a parallel card's `.gpio` surface (the counterpart to consoleSourceFromCard).
 */
import { gpioSourceFromCard } from '../src/services/gpio-hub';

describe('gpioSourceFromCard', () => {
  test('detects a card exposing a complete .gpio surface', () => {
    const card = {
      id: 'p',
      gpio: { direction: 'out', read: () => 0, setInput: () => {}, onOutput: () => {} },
    };
    expect(gpioSourceFromCard(card)).toBe(card.gpio);
  });

  test('returns null for a card with no gpio, or an incomplete surface', () => {
    expect(gpioSourceFromCard({ id: 'x', channel: {} })).toBeNull(); // a serial card
    expect(gpioSourceFromCard({ id: 'x', gpio: { direction: 'out', read: () => 0 } })).toBeNull(); // missing setInput/onOutput
    expect(gpioSourceFromCard(null)).toBeNull();
    expect(gpioSourceFromCard(undefined)).toBeNull();
  });
});
