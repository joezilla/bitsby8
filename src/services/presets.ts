/**
 * Built-in machine presets (Bitsby8 Story 1.7) — standard S-100 machines an
 * agent/operator can boot by identity, without passing a binary boot ROM
 * through the tool call. Each preset builds a MachineProfile over seed cards
 * with the CDBL boot PROM bundled here (base64). When DB-backed Profile CRUD
 * lands (Story 2.3), operator-authored Profiles supplement these.
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

/** 8080 + ~63.75K RAM + CDBL boot PROM @0xFF00, serial console, 88-DCDD floppy. */
function cpmMachine(consoleCfg: Record<string, unknown>): MachineProfile {
  const rom = cdblRom();
  return {
    cpuKind: 'i8080',
    clock: 'max',
    resetVector: 0xff00,
    consoleCardId: 'sio',
    memory: [
      { id: 'ram', base: 0x0000, size: 0xff00, kind: 'ram' },
      { id: 'cdbl', base: 0xff00, size: rom.length, kind: 'rom', image: rom },
    ],
    cards: [
      { id: 'sio', ref: 'imsai-sio2@1.0.0', config: consoleCfg },
      { id: 'dcdd', ref: 'mits-88-dcdd@1.0.0' },
    ],
  };
}

export const PRESETS: MachinePreset[] = [
  {
    id: 'imsai-cpm',
    name: 'IMSAI 8080 — CP/M',
    description: '8080 + 63.75K RAM + CDBL boot PROM + IMSAI SIO-2 console (0x12) + MITS 88-DCDD floppy',
    build: () => cpmMachine({ basePortA: 0x12, boardCtrlPort: 0x18 }),
  },
  {
    id: 'altair-cpm',
    name: 'Altair 8800 — CP/M',
    description: '8080 + 63.75K RAM + CDBL boot PROM + 2SIO-style console (0x10) + MITS 88-DCDD floppy',
    build: () => cpmMachine({ basePortA: 0x10, boardCtrlPort: 0x16 }),
  },
];

export function listPresets(): Array<Omit<MachinePreset, 'build'>> {
  return PRESETS.map(({ id, name, description }) => ({ id, name, description }));
}

export function getPreset(id: string): MachinePreset | undefined {
  return PRESETS.find((p) => p.id === id);
}
