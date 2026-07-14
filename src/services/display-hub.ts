/**
 * Display peripheral binding (Bitsby8 Story 5.9).
 *
 * A video card (8sim's VdmCard, later Dazzler) exposes a `.display` surface —
 * a descriptor (how to render) plus a `frame()` the host reads each refresh.
 * This is the display counterpart to `consoleSourceFromCard`:
 * the host detects a card's display and a canvas viewer renders its frames.
 */

export type DisplayDescriptor =
  | { mode: 'charGrid'; cols: number; rows: number; font: string; attrBit: number }
  | { mode: 'bitmap'; width: number; height: number; format: string };

export interface DisplaySurface {
  readonly descriptor: DisplayDescriptor;
  frame(): { bytes: Uint8Array; state: Record<string, number> };
}

/** The display surface a card exposes, or null if it isn't a video card. */
export function displaySourceFromCard(card: unknown): DisplaySurface | null {
  const d = (card as { display?: Partial<DisplaySurface> } | undefined)?.display;
  if (d && d.descriptor && typeof d.frame === 'function') {
    return d as DisplaySurface;
  }
  return null;
}
