/**
 * GPIO peripheral binding (Bitsby8 Story 5.8).
 *
 * A parallel card (8sim's ParallelCard) exposes a `.gpio` surface — the latched
 * output byte (drive LEDs / a printer), the input pins (sense switches), and an
 * on-write callback. This is the GPIO counterpart to `consoleSourceFromCard`:
 * the host detects a card's GPIO port and surfaces it so a panel can read the
 * output and set the input at run time. GPIO is polled state, not a byte stream,
 * so there's no hub/fan-out — just the detected port.
 */

export type GpioDirection = 'out' | 'in' | 'inout';

/** The host-side GPIO surface an emulated parallel card exposes. */
export interface GpioPort {
  readonly direction: GpioDirection;
  /** The byte the CPU last latched on the output pins. */
  read(): number;
  /** Drive the input pins — the value the CPU reads. */
  setInput(byte: number): void;
  /** Register a callback fired whenever the CPU writes the output latch. */
  onOutput(cb: (byte: number) => void): void;
}

/** The GPIO port a card exposes, or null if it isn't a GPIO card. */
export function gpioSourceFromCard(card: unknown): GpioPort | null {
  const g = (card as { gpio?: Partial<GpioPort> } | undefined)?.gpio;
  if (
    g &&
    typeof g.read === 'function' &&
    typeof g.setInput === 'function' &&
    typeof g.onOutput === 'function' &&
    typeof g.direction === 'string'
  ) {
    return g as GpioPort;
  }
  return null;
}
