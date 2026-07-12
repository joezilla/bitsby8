/**
 * Built-in machine presets (Bitsby8 Story 1.7) — standard S-100 machines an
 * agent/operator can boot by identity, without passing a binary boot ROM
 * through the tool call.
 *
 * As of Epic 5 a preset is a fully card-based machine: the processor, RAM, and
 * boot EPROM are S-100 cards (not fixed top-level regions), so every part is
 * editable on the backplane and shows on the memory-map ribbon. The CDBL boot
 * PROM is burned into the EPROM card via a `<cardId>/rom` override region — the
 * same mechanism the Burn action uses (Story 5.2). A preset is just a backplane
 * pre-populated with cards you can freely re-lay-out.
 */

import type { MachineProfile } from './resolver';

/** CDBL (Combo Disk Boot Loader) v3.00 — 256-byte 8080 boot PROM, base64. */
const CDBL_ROM_B64 =
  '8xEOTDF7TSHh6eXNeU07O34SHCzAwxhMr9MI2wjmCMIYTD4E0wkBggY+AdMJC3ixwi1MDNsIDw/aNEzmED4CwitM2wnmP/4ewkJM2wkP0ktM2wkP2lFM5h/GEE8+A9MQPhHTEK/TIi/TIz4s0yJlPhAxe0312wnmPw+4wnVMEXtNfKrm/j5PyuFM5cUBgADbCAfaj0zbChIcwo9MHn4ad77C30yARxMjDcKeTOtODCOuscHC0kwqfE3rfZN8mtLjTBFvTNUEBHi52AYByHjTCQXJPgTTCeHxPcJxTD5DET5NRzc+gNMI0gAA+yIBAHgyAADTAdMR0wXTI8PyTAAAAA==';

function cdblRom(): Uint8Array {
  return new Uint8Array(Buffer.from(CDBL_ROM_B64, 'base64'));
}

export interface MachinePreset {
  id: string;
  name: string;
  description: string;
  build(): MachineProfile;
}

/**
 * 8080 CPU card + a 63.75K RAM card + a boot EPROM card (CDBL burned @0xFF00) +
 * serial console + 88-DCDD floppy — every part an editable S-100 card. The CDBL
 * bytes ride in the `boot/rom` override region (the EPROM card 'boot' otherwise
 * emits a zero-filled ROM); the resolver uses the override, exactly like a burn.
 */
function cpmMachine(consoleCfg: Record<string, unknown>): MachineProfile {
  const rom = cdblRom();
  return {
    cpuKind: 'i8080',
    clock: 'max',
    resetVector: 0xff00,
    consoleCardId: 'sio',
    // Only the burned-EPROM override lives at the profile level; RAM comes from a card.
    memory: [{ id: 'boot/rom', base: 0xff00, size: rom.length, kind: 'rom', image: rom }],
    cards: [
      { id: 'cpu', ref: 'i8080-cpu@1.0.0', config: { resetVector: 0xff00 } },
      { id: 'ram', ref: 'ram-card@1.0.0', config: { base: 0x0000, size: 0xff00 } },
      { id: 'boot', ref: 'eprom-card@1.0.0', config: { base: 0xff00, size: rom.length } },
      { id: 'sio', ref: 'imsai-sio2@1.0.0', config: consoleCfg },
      { id: 'dcdd', ref: 'mits-88-dcdd@1.0.0' },
    ],
  };
}

export const PRESETS: MachinePreset[] = [
  {
    id: 'imsai-cpm',
    name: 'IMSAI 8080 — CP/M',
    description: '8080 CPU + 63.75K RAM card + CDBL boot EPROM + IMSAI SIO-2 console (0x12) + MITS 88-DCDD floppy — all editable cards',
    build: () => cpmMachine({ basePortA: 0x12, boardCtrlPort: 0x18 }),
  },
  {
    id: 'altair-cpm',
    name: 'Altair 8800 — CP/M',
    description: '8080 CPU + 63.75K RAM card + CDBL boot EPROM + 2SIO-style console (0x10) + MITS 88-DCDD floppy — all editable cards',
    build: () => cpmMachine({ basePortA: 0x10, boardCtrlPort: 0x16 }),
  },
];

export function listPresets(): Array<Omit<MachinePreset, 'build'>> {
  return PRESETS.map(({ id, name, description }) => ({ id, name, description }));
}

export function getPreset(id: string): MachinePreset | undefined {
  return PRESETS.find((p) => p.id === id);
}
