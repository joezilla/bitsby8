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

  test.each(PRESETS.map((p) => p.id))('%s builds a bootable i8080 machine from cards, CDBL burned into the EPROM', (id) => {
    const profile = getPreset(id)!.build();
    expect(profile.cpuKind).toBe('i8080');
    expect(profile.resetVector).toBe(0xff00);
    expect(profile.consoleCardId).toBe('sio');

    // Everything is a card now: CPU, RAM, boot EPROM, serial, floppy.
    expect(profile.cards.map((c) => c.id)).toEqual(['cpu', 'ram', 'boot', 'sio', 'dcdd']);
    expect(profile.cards.map((c) => c.ref)).toEqual([
      'i8080-cpu@1.0.0',
      'ram-card@1.0.0',
      'eprom-card@1.0.0',
      'imsai-sio2@1.0.0',
      'mits-88-dcdd@1.0.0',
    ]);
    // The RAM card spans below the PROM and is editable (a card, not a fixed region).
    const ramCard = profile.cards.find((c) => c.id === 'ram')!;
    expect(ramCard.config).toMatchObject({ base: 0, size: 0xff00 });
    // The boot EPROM card maps the reset vector.
    expect(profile.cards.find((c) => c.id === 'boot')!.config).toMatchObject({ base: 0xff00 });

    // The only profile-level region is the CDBL override burned into the EPROM
    // (id matches the card's emitted region: `boot/rom`).
    expect(profile.memory).toHaveLength(1);
    const rom = profile.memory[0];
    expect(rom.id).toBe('boot/rom');
    expect(rom.kind).toBe('rom');
    expect(rom.base).toBe(0xff00);
    expect(rom.image).toBeInstanceOf(Uint8Array);
    expect(rom.image!.length).toBe(256);
    // First CDBL byte is DI (0xF3) — a sanity check the ROM decoded correctly.
    expect(rom.image![0]).toBe(0xf3);
  });
});
