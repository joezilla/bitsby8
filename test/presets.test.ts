/**
 * Tests for the built-in machine presets (Bitsby8 Story 1.7): each preset
 * builds a valid MachineProfile with the CDBL boot PROM bundled, so an agent
 * can boot a standard S-100 machine by identity alone (no binary in the tool call).
 */

import { PRESETS, listPresets, getPreset } from '../src/services/presets';

describe('machine presets', () => {
  test('lists imsai-cpm and altair-cpm with id/name/description (no build fn leaked)', () => {
    const ids = listPresets().map((p) => p.id).sort();
    expect(ids).toEqual(['altair-cpm', 'imsai-cpm']);
    for (const p of listPresets()) {
      expect(typeof p.name).toBe('string');
      expect(typeof p.description).toBe('string');
      expect((p as Record<string, unknown>).build).toBeUndefined();
    }
  });

  test('getPreset returns undefined for an unknown id', () => {
    expect(getPreset('nope')).toBeUndefined();
  });

  test.each(PRESETS.map((p) => p.id))('%s builds a bootable i8080 profile with a CDBL ROM', (id) => {
    const profile = getPreset(id)!.build();
    expect(profile.cpuKind).toBe('i8080');
    expect(profile.resetVector).toBe(0xff00);
    expect(profile.consoleCardId).toBe('sio');

    // RAM below the PROM + a 256-byte ROM image mapped at the reset vector.
    const rom = profile.memory.find((m) => m.kind === 'rom');
    expect(rom).toBeTruthy();
    expect(rom!.base).toBe(0xff00);
    expect(rom!.image).toBeInstanceOf(Uint8Array);
    expect(rom!.image!.length).toBe(256);
    // First CDBL byte is DI (0xF3) — a sanity check the ROM decoded correctly.
    expect(rom!.image![0]).toBe(0xf3);

    const ram = profile.memory.find((m) => m.kind === 'ram');
    expect(ram!.base).toBe(0);
    expect(ram!.size).toBe(0xff00);
    // Console serial card + the floppy controller.
    expect(profile.cards.map((c) => c.id)).toEqual(['sio', 'dcdd']);
  });
});
