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

/** SOLOS v1.3 — the 2 KB Processor Technology Sol-20 personality-module ROM
 * (@0xC000), assembled from bios/sol20/solos1.asm in @joezilla/8sim, base64. */
const SOLOS_ROM_B64 = 'AMOvwcPJwcPgxcMDxsNGxsODxsPLxsN/xzoHyMM7wDoGyOUhmsLmAweFb8Mnwtv6L+YByNv8yQDDAcDlIZLCwybA2/jmQMjb+cnb+BfSSsB40/nJ5dXFOgzIt8JfwXjmf0fKfMAhc8LNgsDNHMF+9oB3KgrILK8rvMJ3wMHR4ckjI363ypTAuCPCgMDlzTbB48Mnwnj+f8jNHMFwOgjI/j/awcA6Ccj+D8LBwK8yCMhPzSPBr836wDoKyDzmD8PuwDoIyDzmPzIIyMA6Ccg85g8yCcjJIQDMNqAjNiAjfP7Q2tvANz4AMgnIMgjI0NP+MgrIyc0cwToIyP5A0DYgIzzD+sA6Ccg9w8/AOgjIPeY/MgjIyToIyDzDD8E6CMhPOgnIbzoKyIUPD2/mA8bMZ33mwIFvyc0cwX7mf3fJzQvBzRzBNiDJzfTAww/BOgnIPOYPwtHAw7DAPv8yDMjJzTbBzWjBw2vAOgzI/v/KkMEhDMg2AP4C2ojByozB/gjKmMX+CdqYwMB4ww/BeMPPwHj+A8qmwf4EwqLBRE3h0cXlrzIMyMkhCMhGI07DncGvTyEAyHcjDMK0wTH/y83VwK/T+jIHyDIGyDH/yzoHyPWvMgfIzfHCzeTB8TIHyM0FwsPJwc0fwMrkwf6MygDp5n/KwMFH/g3I/n/C/8EGX80ZwMPkwc02wQ4BzSDB6yEAwOXNLsPKgMTrEUrCzTHCzC7CyoHEE+t+I2Zv433JETzIGrfI5b4TwkPCIxq+wkPC4bfJExMT4cMxwlRFZ8NEVb/DRU4jxEVYXsRHRafEU0HmxFhFpsRDQSvFU0V6xUNVvcUAC9XAFwTBGsvAAQvBExXBDuXADUfBCk3BXz7BG1nBAFTASsDmwtLCLsBCwN3Cy8JUQY7FUz2ZxUk9ncVPPaHFTj21xUNJpcVDT6nFWEWxxVRZrcVDUrnFAOUqAMjD1sLlKgLIfbTKwMHjydv6L+YCyNv9ydv65gTC5sJ40/3JzfnCBj7DGcAGCs0ZwAYNzRnAOhDITw34r80fxMMHw80bwz4ByM1Aw33JDgwa/iDKLsMT/j3KLsMNwh3DyQ4KGv4gwBMNyMMww80bw8qAxCEAABr+IMj+L8j+OsgpKSkpzV3D0oDEhW8Tw0PD1jD+CtjWB/4Qyc0QwzIGyM0QwzIHyM0uwMqLw0f+gMrAwdqIw81UwMOLw80ZwM0fwMpzw+Z/ynPDR/4b0rnD/g3KucP+Csq5wzoMyLfCucPFBhvNVMAGB81UwMHNVMDDc8PNOsPlzRDD0evN+cLN6MPNBsQOEH7Fze3DfZN8mtLJwcEjDcLTw8PIw3zNC8R9zQvEzR/AygbE5n/KycH+IMIGxM0fwMoAxAYgwxnATw8PDw/NFMR55g/GMP462h/ExgdHwxnAzTrD5a8yB8jN+cIGOs3/wc02wQ4BzSDB6w4DzTDDyivE/i/KwMHNQMP+OspZxH3hdyPlwzzE4xPDPMTNOsPlIQDAySEcyM0bwwYGGv4gyobE/i/KhsR3EyMFwm7E6zY/w8DBNgAjBcKGxP4vPgHCmsQTzS7D1jDmAT6AwqLEHzJUyMk+r/UhLMjNacQhAADNEMPrISzIfrfCwcQhHMjlzUjF4c3LxtoUxc1QxfG3yDoiyLf6FMU6Ici3whTFKifIw2HEzWbEzTrD5c06w+PlzRDDIiXI4dHle5VvepxnIyIjyOXNSMUhHMjNr8fR4cOQx835whYGISXFzWrFzVDFw8DBRVJST1IgzWbEzfnCzUjFBgHN78fNI8fawMHCOcXNUMXDOcUhVMg6Dci2yRYIIRvIzWrFzQbEKiXIzejDKiPIzejDw/nCfrfCccU+IM0fxCMVwmrFyc0bw8qAxNXNOsPjEaLCzTHCwyLCt8qUxT4gMg3IyXgyC8jJMgbIyTIHyMkiAMjJIgLIyTIiyMkiJ8jJMhDIyTIRyMnNZsQhycHNEMPlIRzIzS7CytPFGzYAfhITI34SE+HrcyNyyeXNM8bC+sU2ASN3I3cRY8g6VMiCV8G3w7bG4dGvN8k9N9HJzTPGyLc8NgDIIyN+fs2/xsUhBwAJt8orxuV3IzYAI3MjcmBpzXzH4a93I3fhw3zHIVXIH+YBMlTIykLGIVzIfrc3yc0zxsg8+vzFNv8jfuUjzb/G4bfCdcbV5SPNpsbNyMba+sXhe7LK/8VzIzYAK3vRPXcjfjSDX9KAxhQat8nNM8bIPMg2/iMjePXlzb/G4X6DX9KbxhTxErc0wM2mxsN8x82/xsUhBgAJAQABzbbG4ckjcSNwI3MjcskjTiNGI14jVsnN3sfVBgPN78fb++XNI8fh2gbHwtPG5REcyM3Sx+HC08bRerMqI8jrwvbGKiXI1c0Vx8oQx81Ex9oGx8r3xq83wxHHBgHN8cev0/rRya9HssIgx7PIQ1rJFbfJBgrNXcfY2/u3wiPHBcIlx81vx9j+Adozx8IjxyEcyAYQDgDNb8fYdyPNqMcFwkbHzW/Hqcg6Ecg8ydv65kDAzR/Ayl3H5n/CXcc3yc1dx9jb+uYY2/vIN8nN3sflza/H4REHABleI1YjfiNmb+XNFcfKC8fNw8fDkcf12/rmgMqex/HT+5FPqS+RT8nN7ccWMq/NnccVwrTHPgHNnccGEA4Afs2dxwUjwsXHecOdxwYFGr7ABcgjE8PUxzpUyLc6DcjC6sfGQMZAyQYE0/oRAAAberPC9McFwvHHyQA=';

function solosRom(): Uint8Array {
  return new Uint8Array(Buffer.from(SOLOS_ROM_B64, 'base64'));
}

/** IMSAI MPU-A monitor/boot ROM — 1920-byte EPROM (@0xD800) whose power-on
 * monitor auto-boots drive 0 via the FIF controller, base64. */
const IMSAI_MPUA_ROM_B64 = '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';

function imsaiMpuaRom(): Uint8Array {
  return new Uint8Array(Buffer.from(IMSAI_MPUA_ROM_B64, 'base64'));
}

/** A startup disk a preset ships with — seeded into `profile_disks` when the
 * preset is first seeded (or reset). The image file ships in the `disks/` dir. */
export interface PresetDisk {
  drive: number;
  filename: string;
  readonly?: boolean;
}

export interface MachinePreset {
  /** Stable key for reset-to-default; not the profile name. */
  id: string;
  /** Profile-safe display name (also the seeded profile's name). */
  name: string;
  description: string;
  build(): MachineProfile;
  /** Boot/startup disks bound to the seeded profile (overlay on the global
   * mounts). Empty/absent for presets that ship without media. */
  disks?: PresetDisk[];
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
function videoTerminal(
  videoRef: string,
  videoCfg: Record<string, unknown>,
  ramSize = 0xc000,
  sioBaseA = 0x10,
): MachineProfile {
  const rom = cdblRom();
  return {
    cpuKind: 'i8080',
    clock: 'max',
    resetVector: 0xff00,
    consoleCardId: 'sio',
    memory: [{ id: 'boot/rom', base: 0xff00, size: rom.length, kind: 'rom', image: rom }],
    cards: [
      { id: 'cpu', ref: 'i8080-cpu@1.0.0', config: { resetVector: 0xff00 } },
      { id: 'ram', ref: 'ram-card@1.0.0', config: { base: 0x0000, size: ramSize } },
      { id: 'video', ref: videoRef, config: videoCfg },
      { id: 'kbd', ref: 'ascii-keyboard@1.0.0', config: { dataPort: 0x01, statusPort: 0x00 } },
      { id: 'sio', ref: 'imsai-sio2@1.0.0', config: { basePortA: sioBaseA, boardCtrlPort: 0x16 } },
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

/**
 * Processor Technology Sol-20: an 8080 with the SOLOS personality-module ROM
 * (@0xC000) driving the machine's built-in console — the VDM-1 memory-mapped
 * character display (@0xCC00) and the Sol keyboard (data 0xFC, ready = bit 0 of
 * status 0xFA, active-low) — plus a 3P+S serial card and the Helios II disk
 * system (ports F0-F7). SOLOS paints straight to the VDM, so this is a
 * serial-less video terminal: the display + keyboard are surfaced by the
 * instance's display/keyboard hubs, no serial console needed. Memory tiles
 * around the personality-module window: RAM 0x0000-0xBFFF, SOLOS ROM
 * 0xC000-0xC7FF, SOLOS scratch RAM 0xC800-0xCBFF, VDM video RAM 0xCC00-0xCFFF
 * (from the video card), RAM 0xD000-0xFFFF.
 */
function sol20Machine(): MachineProfile {
  const rom = solosRom();
  return {
    cpuKind: 'i8080',
    clock: 'max',
    resetVector: 0xc000,
    // SOLOS bytes ride in the burned-EPROM override; the VDM video RAM is the video card's region.
    memory: [{ id: 'boot/rom', base: 0xc000, size: rom.length, kind: 'rom', image: rom }],
    cards: [
      { id: 'cpu', ref: 'i8080-cpu@1.0.0', config: { resetVector: 0xc000 } },
      { id: 'ram', ref: 'ram-card@1.0.0', config: { base: 0x0000, size: 0xc000 } }, // 0x0000-0xBFFF
      { id: 'scratch', ref: 'ram-card@1.0.0', config: { base: 0xc800, size: 0x0400 } }, // SOLOS 1K scratch
      { id: 'himem', ref: 'ram-card@1.0.0', config: { base: 0xd000, size: 0x3000 } }, // 0xD000-0xFFFF
      { id: 'boot', ref: 'eprom-card@1.0.0', config: { base: 0xc000, size: rom.length } },
      { id: 'video', ref: 'vdm-1-video@1.0.0', config: { base: 0xcc00 } },
      {
        id: 'kbd',
        ref: 'ascii-keyboard@1.0.0',
        config: { dataPort: 0xfc, statusPort: 0xfa, readyMask: 0x01, readyPolarity: 'active-low' },
      },
      { id: '3ps', ref: 'proctech-3ps@1.0.0', config: { basePort: 0x00 } },
      { id: 'helios', ref: 'pt-helios@1.0.0', config: { basePort: 0xf0 } },
    ],
  };
}

/**
 * IMSAI 8080: the MPU-A monitor/boot EPROM (@0xD800) whose power-on entry checks
 * drive 0 and bootstraps the OS, an IMSAI SIO-2 serial console (channel A at
 * 0x02/0x03, board control 0x08), and the DMA-capable FIF floppy controller on
 * output port 0xFD. Boots IMDOS (or CP/M) from an image mounted on drive 0 —
 * the FIF is what IMDOS's on-disk BIOS actually drives.
 */
function imsaiFifMachine(): MachineProfile {
  const rom = imsaiMpuaRom();
  const romTop = 0xd800 + rom.length;
  return {
    cpuKind: 'i8080',
    clock: 'max',
    resetVector: 0xd800,
    consoleCardId: 'sio',
    memory: [{ id: 'boot/rom', base: 0xd800, size: rom.length, kind: 'rom', image: rom }],
    cards: [
      { id: 'cpu', ref: 'i8080-cpu@1.0.0', config: { resetVector: 0xd800 } },
      { id: 'ram', ref: 'ram-card@1.0.0', config: { base: 0x0000, size: 0xd800 } }, // 0x0000-0xD7FF
      { id: 'boot', ref: 'eprom-card@1.0.0', config: { base: 0xd800, size: rom.length } },
      { id: 'himem', ref: 'ram-card@1.0.0', config: { base: romTop, size: 0x10000 - romTop } }, // above the ROM
      { id: 'sio', ref: 'imsai-sio2@1.0.0', config: { basePortA: 0x02, basePortB: 0x04, boardCtrlPort: 0x08 } },
      { id: 'fif', ref: 'imsai-fif@1.0.0', config: { port: 0xfd } },
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
    description: 'CPU + 51K RAM + VDM-1 character display + ASCII keyboard + serial + boot EPROM + floppy. Boots the JX monitor from drive 0.',
    // RAM runs 0x0000-0xCBFF, right up to the VDM-1 video RAM window at 0xCC00.
    // JX polls the SIO-2 console at 0x12/0x13 — not the ASCII keyboard card — so
    // the serial console (not the kbd card) is the keyboard path for this OS.
    build: () => videoTerminal('vdm-1-video@1.0.0', { base: 0xcc00 }, 0xcc00, 0x12),
    disks: [{ drive: 0, filename: 'jx-monitor.dsk' }],
  },
  {
    id: 'dazzler-station',
    name: 'Dazzler Graphics Workstation',
    description: 'CPU + 48K RAM + Cromemco Dazzler colour graphics + ASCII keyboard + serial + boot EPROM + floppy.',
    build: () => videoTerminal('cromemco-dazzler@1.0.0', { controlPort: 0x0e, formatPort: 0x0f }),
  },
  {
    id: 'sol20-solos',
    name: 'Processor Technology Sol-20',
    description:
      '8080 + SOLOS personality ROM (0xC000) driving the built-in VDM-1 display + Sol keyboard console, plus a 3P+S serial card and the Helios II disk system (F0-F7).',
    build: sol20Machine,
  },
  {
    id: 'imsai-fif-imdos',
    name: 'IMSAI 8080 FIF IMDOS',
    description:
      '8080 + MPU-A boot ROM (0xD800) + IMSAI SIO-2 console + FIF floppy controller (port 0xFD). Boots IMDOS from a disk mounted on drive 0.',
    build: imsaiFifMachine,
    disks: [{ drive: 0, filename: 'imdos202.dsk' }],
  },
];

export function listPresets(): Array<Omit<MachinePreset, 'build'>> {
  return PRESETS.map(({ id, name, description }) => ({ id, name, description }));
}

export function getPreset(id: string): MachinePreset | undefined {
  return PRESETS.find((p) => p.id === id);
}
