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
  /** Stable key for reset-to-default; not the profile name. */
  id: string;
  /** Profile-safe display name (also the seeded profile's name). */
  name: string;
  description: string;
  build(): MachineProfile;
}

/** A bare machine to build up from: 8080 CPU + 64K RAM, nothing else. */
function blankMachine(): MachineProfile {
  return {
    cpuKind: 'i8080',
    clock: 'max',
    resetVector: 0x0000,
    memory: [],
    cards: [
      { id: 'cpu', ref: 'i8080-cpu@1.0.0', config: { resetVector: 0x0000 } },
      { id: 'ram', ref: 'ram-card@1.0.0', config: { base: 0x0000, size: 0xffff } },
    ],
  };
}

/** CP/M machine + a bank-switch RAM card (extra RAM banks) + an MM58167 RTC. */
function bankRtcMachine(): MachineProfile {
  const m = cpmMachine({ basePortA: 0x10, boardCtrlPort: 0x16 });
  m.cards.push(
    { id: 'bank', ref: 'bank-ram@1.0.0', config: { window: 0x8000, size: 0x4000, banks: 4, selectPort: 0x40 } },
    { id: 'rtc', ref: 'mm58167-rtc@1.0.0', config: { base: 0x50 } },
  );
  return m;
}

/** A VDM-1 / Dazzler video-terminal hardware template: CPU + 48K RAM + video +
 * ASCII keyboard + serial console + boot EPROM + floppy. Mount a monitor OS to
 * drive the display. `videoRef` picks VDM-1 (char) or Dazzler (graphics). */
function videoTerminal(videoRef: string, videoCfg: Record<string, unknown>): MachineProfile {
  const rom = cdblRom();
  return {
    cpuKind: 'i8080',
    clock: 'max',
    resetVector: 0xff00,
    consoleCardId: 'sio',
    memory: [{ id: 'boot/rom', base: 0xff00, size: rom.length, kind: 'rom', image: rom }],
    cards: [
      { id: 'cpu', ref: 'i8080-cpu@1.0.0', config: { resetVector: 0xff00 } },
      { id: 'ram', ref: 'ram-card@1.0.0', config: { base: 0x0000, size: 0xc000 } },
      { id: 'video', ref: videoRef, config: videoCfg },
      { id: 'kbd', ref: 'ascii-keyboard@1.0.0', config: { dataPort: 0x01, statusPort: 0x00 } },
      { id: 'sio', ref: 'imsai-sio2@1.0.0', config: { basePortA: 0x10, boardCtrlPort: 0x16 } },
      { id: 'boot', ref: 'eprom-card@1.0.0', config: { base: 0xff00, size: rom.length } },
      { id: 'dcdd', ref: 'mits-88-dcdd@1.0.0' },
    ],
  };
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
    id: 'blank',
    name: 'Blank Machine',
    description: 'A bare 8080 + 64K RAM to build up from. No ROM, no I/O — add cards on the backplane.',
    build: blankMachine,
  },
  {
    id: 'imsai-cpm',
    name: 'IMSAI 8080 CPM',
    description: '8080 CPU + 63.75K RAM card + CDBL boot EPROM + IMSAI SIO-2 console (0x12) + MITS 88-DCDD floppy — all editable cards',
    build: () => cpmMachine({ basePortA: 0x12, boardCtrlPort: 0x18 }),
  },
  {
    id: 'altair-cpm',
    name: 'Altair 8800 CPM',
    description: '8080 CPU + 63.75K RAM card + CDBL boot EPROM + 2SIO-style console (0x10) + MITS 88-DCDD floppy — all editable cards',
    build: () => cpmMachine({ basePortA: 0x10, boardCtrlPort: 0x16 }),
  },
  {
    id: 'altair-bank-rtc',
    name: 'Altair 8800 Bank RAM RTC',
    description: 'CP/M Altair plus a 4-bank switch-RAM card (window 0x8000) and an MM58167 real-time clock (port 0x50).',
    build: bankRtcMachine,
  },
  {
    id: 'vdm-terminal',
    name: 'VDM-1 Video Terminal',
    description: 'CPU + 48K RAM + VDM-1 character display + ASCII keyboard + serial + boot EPROM + floppy. Add a monitor OS to drive the screen.',
    build: () => videoTerminal('vdm-1-video@1.0.0', { base: 0xcc00 }),
  },
  {
    id: 'dazzler-station',
    name: 'Dazzler Graphics Workstation',
    description: 'CPU + 48K RAM + Cromemco Dazzler colour graphics + ASCII keyboard + serial + boot EPROM + floppy.',
    build: () => videoTerminal('cromemco-dazzler@1.0.0', { controlPort: 0x0e, formatPort: 0x0f }),
  },
];

export function listPresets(): Array<Omit<MachinePreset, 'build'>> {
  return PRESETS.map(({ id, name, description }) => ({ id, name, description }));
}

export function getPreset(id: string): MachinePreset | undefined {
  return PRESETS.find((p) => p.id === id);
}
