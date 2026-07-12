/**
 * Peripheral binding registry (Bitsby8 Story 5.6).
 *
 * A card is `bus-interface + behavior-kernel + peripheral-binding`. The bus side
 * is emulated; the peripheral side connects to a named host **endpoint**. Today
 * two bindings exist ad-hoc — the operator terminal (`consoleCardId` → the xterm
 * ConsoleHub) and disks (the injected `fdc` channel + drive mounts). This
 * registry is the first-class vocabulary of endpoint *types* a card's far side
 * can bind to; concrete instances (which terminal, which disk image) are
 * assigned at run time. Authoring (5.7+) offers a card a binding from this list.
 */

import { Dependencies } from '../types';

export type EndpointType = 'terminal' | 'disk' | 'display' | 'gpio' | 'clock' | 'socket';

export interface PeripheralEndpointType {
  type: EndpointType;
  label: string;
  description: string;
  /** Whether a card can bind to this endpoint today. */
  available: boolean;
  /** The Epic 5 story that lights this up, when not yet available. */
  arrivesWith?: string;
}

/** The endpoint taxonomy, with what's wired today vs. what's coming. Static in
 * shape; `available` reflects which host-side machinery exists. */
export function listPeripheralEndpoints(_deps: Dependencies): PeripheralEndpointType[] {
  return [
    {
      type: 'terminal',
      label: 'Operator terminal',
      description: 'A character stream to the machine console (xterm) — a serial/UART card’s far side.',
      available: true,
    },
    {
      type: 'disk',
      label: 'Disk image',
      description: 'A virtual floppy/hard-disk image served over the FDC channel, with copy-on-write.',
      available: true,
    },
    {
      type: 'clock',
      label: 'Host clock',
      description: 'The host real-time clock — read by an RTC card.',
      available: true,
    },
    {
      type: 'gpio',
      label: 'GPIO lanes',
      description: 'Parallel byte lanes: sense switches, LEDs, a printer — and real hardware GPIO on the host.',
      available: false,
      arrivesWith: '5.8',
    },
    {
      type: 'display',
      label: 'Monitor',
      description: 'A canvas display a memory-mapped video card renders into (geometry + charset/pixel format).',
      available: false,
      arrivesWith: '5.9',
    },
    {
      type: 'socket',
      label: 'Network socket',
      description: 'A TCP socket — a serial card bound here is a telnet/modem bridge.',
      available: false,
      arrivesWith: 'Tier 2',
    },
  ];
}
