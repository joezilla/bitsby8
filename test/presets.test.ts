/**
 * Tests for the built-in machine presets (Bitsby8 Story 1.7 / 5.2). Each preset
 * builds a valid MachineProfile; the CP/M machines bundle the CDBL boot PROM so
 * an agent can boot a standard S-100 machine by identity alone. Presets are also
 * seeded as editable source:'preset' profiles (see profile-service tests).
 */

import { PRESETS, listPresets, getPreset } from '../src/services/presets';

const CPM_PRESETS = ['imsai-cpm', 'altair-cpm'];

describe('machine presets', () => {
  test('lists every built-in preset with id/name/description (no build fn leaked)', () => {
    const ids = listPresets().map((p) => p.id).sort();
    expect(ids).toEqual(
      ['altair-bank-rtc', 'altair-cpm', 'blank', 'dazzler-station', 'imsai-cpm', 'vdm-terminal'].sort(),
    );
    for (const p of listPresets()) {
      expect(typeof p.name).toBe('string');
      expect(typeof p.description).toBe('string');
      expect((p as Record<string, unknown>).build).toBeUndefined();
    }
  });

  test('every preset name is profile-name-safe (letters/digits/space/._-)', () => {
    for (const p of PRESETS) expect(/^[a-zA-Z0-9][a-zA-Z0-9 _.-]{0,63}$/.test(p.name)).toBe(true);
  });

  test('getPreset returns undefined for an unknown id', () => {
    expect(getPreset('nope')).toBeUndefined();
  });

  test.each(CPM_PRESETS)('%s is a bootable i8080 CP/M machine with CDBL burned into the EPROM', (id) => {
    const profile = getPreset(id)!.build();
    expect(profile.cpuKind).toBe('i8080');
    expect(profile.resetVector).toBe(0xff00);
    expect(profile.consoleCardId).toBe('sio');
    expect(profile.cards.map((c) => c.id)).toEqual(['cpu', 'ram', 'boot', 'sio', 'dcdd']);

    const rom = profile.memory[0];
    expect(rom.id).toBe('boot/rom');
    expect(rom.kind).toBe('rom');
    expect(rom.base).toBe(0xff00);
    expect(rom.image).toBeInstanceOf(Uint8Array);
    expect(rom.image![0]).toBe(0xf3); // CDBL first byte is DI (0xF3)
  });

  test('blank is a bare CPU + 64K RAM, no ROM or I/O', () => {
    const p = getPreset('blank')!.build();
    expect(p.cards.map((c) => c.ref)).toEqual(['i8080-cpu@1.0.0', 'ram-card@1.0.0']);
    expect(p.memory).toHaveLength(0);
  });

  test('altair-bank-rtc adds a bank-RAM card and an MM58167 RTC', () => {
    const p = getPreset('altair-bank-rtc')!.build();
    const refs = p.cards.map((c) => c.ref);
    expect(refs).toContain('bank-ram@1.0.0');
    expect(refs).toContain('mm58167-rtc@1.0.0');
  });

  test('the video terminals carry a display + a keyboard card', () => {
    for (const [id, videoRef] of [['vdm-terminal', 'vdm-1-video@1.0.0'], ['dazzler-station', 'cromemco-dazzler@1.0.0']] as const) {
      const p = getPreset(id)!.build();
      const refs = p.cards.map((c) => c.ref);
      expect(refs).toContain(videoRef);
      expect(refs).toContain('ascii-keyboard@1.0.0');
    }
  });
});
