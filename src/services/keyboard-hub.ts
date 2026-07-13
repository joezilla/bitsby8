/**
 * Keyboard peripheral binding (Bitsby8 Story 5.9).
 *
 * A keyboard card (8sim's KeyboardCard) exposes a `.keyboard` surface — inject a
 * key press the guest reads from its data port. This is the input counterpart to
 * `consoleSourceFromCard` / `displaySourceFromCard`: the
 * host detects a card's keyboard port and surfaces it so the cockpit can route
 * the operator's real keyboard into a serial-less video terminal.
 */

/** The host-side keyboard surface an emulated keyboard card exposes. */
export interface KeyboardSink {
  /** Queue a single key (ASCII/byte) for the guest. */
  press(byte: number): void;
  /** Queue each character of a string. */
  type(text: string): void;
  /** How many keys are waiting to be read. */
  readonly pending: number;
}

/** The keyboard sink a card exposes, or null if it isn't a keyboard card. */
export function keyboardSourceFromCard(card: unknown): KeyboardSink | null {
  const k = (card as { keyboard?: Partial<KeyboardSink> } | undefined)?.keyboard;
  if (k && typeof k.press === 'function' && typeof k.type === 'function') {
    return k as KeyboardSink;
  }
  return null;
}
