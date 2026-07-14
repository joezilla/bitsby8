/**
 * Tests for src/services/config-persistence.ts
 *
 * Uses a real temp directory rather than mocking fs — atomicity and
 * backup rotation are precisely the properties that would silently
 * regress if the tests ran against jest.mock('fs/promises').
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  writePartialConfig,
  readCurrentConfig,
  rollbackConfig,
  ConfigWriteError,
  MAX_BACKUPS,
} from '../src/services/config-persistence';
import type { ConfigFile } from '../src/config';

async function makeTempOverride(initial: object): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-cfg-'));
  const file = path.join(dir, 'fdcsds.overrides.json');
  await fs.writeFile(file, JSON.stringify(initial, null, 2));
  return file;
}

async function makeTempOverridePath(): Promise<string> {
  // A path to an override that doesn't exist yet — the directory
  // is writable but writePartialConfig must handle "first save".
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-cfg-'));
  return path.join(dir, 'fdcsds.overrides.json');
}

describe('config persistence', () => {
  describe('writePartialConfig', () => {
    test('creates the override file on first save when it did not exist', async () => {
      const filePath = await makeTempOverridePath();
      const baseline: ConfigFile = { port: '/dev/ttyUSB0', baud: 230400, verbose: false };
      const { config } = await writePartialConfig(filePath, { verbose: true }, baseline);
      // Effective config = baseline ∪ new override.
      expect(config.port).toBe('/dev/ttyUSB0');
      expect(config.baud).toBe(230400);
      expect(config.verbose).toBe(true);
      // On disk, only the changed keys are in the override.
      const onDisk = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      expect(onDisk).toEqual({ verbose: true });
    });

    test('shallow-merges the patch onto an existing override, preserves the baseline for untouched keys', async () => {
      const filePath = await makeTempOverride({ webPort: 3001 });
      const baseline: ConfigFile = { port: '/dev/ttyUSB0', webPort: 3000, verbose: false };
      const { config } = await writePartialConfig(filePath, { verbose: true }, baseline);
      expect(config.port).toBe('/dev/ttyUSB0'); // from baseline (never in override)
      expect(config.webPort).toBe(3001);         // from prior override
      expect(config.verbose).toBe(true);         // from this patch
      // On disk, override now names both webPort and verbose — not port.
      const onDisk = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      expect(onDisk).toEqual({ webPort: 3001, verbose: true });
    });

    test('does NOT touch the /etc-style baseline file', async () => {
      const overrideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-o-'));
      const baselineDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-b-'));
      const overridePath = path.join(overrideDir, 'fdcsds.overrides.json');
      const baselinePath = path.join(baselineDir, 'fdcsds.config.json');
      await fs.writeFile(baselinePath, JSON.stringify({ port: '/dev/ttyUSB0' }));
      const beforeMtime = (await fs.stat(baselinePath)).mtimeMs;

      // small delay to let mtime resolution catch a would-be write
      await new Promise(r => setTimeout(r, 20));
      await writePartialConfig(overridePath, { verbose: true }, { port: '/dev/ttyUSB0' });

      const afterMtime = (await fs.stat(baselinePath)).mtimeMs;
      expect(afterMtime).toBe(beforeMtime);
    });

    test('rejects with VALIDATION_FAILED when the merged effective doc is invalid', async () => {
      const filePath = await makeTempOverridePath();
      await expect(
        writePartialConfig(filePath, { webPort: 999999 } as any, { port: '/dev/ttyUSB0' }),
      ).rejects.toBeInstanceOf(ConfigWriteError);
    });

    test('rejects with NO_CONFIG_FILE when no override path is configured', async () => {
      await expect(writePartialConfig('', { verbose: true } as any, null)).rejects.toMatchObject({
        code: 'NO_CONFIG_FILE',
      });
    });

    test('rotates backups so bak.1 is the previous version', async () => {
      const filePath = await makeTempOverride({ verbose: false });
      await writePartialConfig(filePath, { verbose: true }, null);
      const bak1 = JSON.parse(await fs.readFile(`${filePath}.bak.1`, 'utf-8'));
      expect(bak1).toEqual({ verbose: false });
    });

    test('caps backups at MAX_BACKUPS and rolls the oldest off', async () => {
      const filePath = await makeTempOverride({ verbose: false });

      for (let i = 0; i < MAX_BACKUPS + 2; i++) {
        await writePartialConfig(filePath, { webPort: 4000 + i }, null);
      }

      // .bak.1..MAX_BACKUPS exist, .bak.(MAX_BACKUPS+1) doesn't.
      for (let i = 1; i <= MAX_BACKUPS; i++) {
        await expect(fs.access(`${filePath}.bak.${i}`)).resolves.toBeUndefined();
      }
      await expect(fs.access(`${filePath}.bak.${MAX_BACKUPS + 1}`)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });

    test('leaves no .tmp turd on the disk after a successful write', async () => {
      const filePath = await makeTempOverride({ verbose: false });
      await writePartialConfig(filePath, { verbose: true }, null);
      await expect(fs.access(`${filePath}.tmp`)).rejects.toMatchObject({ code: 'ENOENT' });
    });

  });

  describe('rollbackConfig', () => {
    test('restores bak.1 as the live override file and shifts backups', async () => {
      const filePath = await makeTempOverride({ webPort: 3000 });
      await writePartialConfig(filePath, { webPort: 3001 }, null);
      await writePartialConfig(filePath, { webPort: 3002 }, null);

      // Sanity: three revisions on disk.
      const before = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      expect(before.webPort).toBe(3002);
      const bak1Before = JSON.parse(await fs.readFile(`${filePath}.bak.1`, 'utf-8'));
      expect(bak1Before.webPort).toBe(3001);

      const { config } = await rollbackConfig(filePath, null);

      expect(config.webPort).toBe(3001);
      const onDisk = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      expect(onDisk.webPort).toBe(3001);
      // bak.2 (webPort=3000) has moved to bak.1.
      const bak1After = JSON.parse(await fs.readFile(`${filePath}.bak.1`, 'utf-8'));
      expect(bak1After.webPort).toBe(3000);
    });

    test('a second rollback walks further back', async () => {
      const filePath = await makeTempOverride({ webPort: 3000 });
      await writePartialConfig(filePath, { webPort: 3001 }, null);
      await writePartialConfig(filePath, { webPort: 3002 }, null);

      await rollbackConfig(filePath, null);   // → 3001
      const { config } = await rollbackConfig(filePath, null); // → 3000
      expect(config.webPort).toBe(3000);
    });

    test('throws NO_CONFIG_FILE with a friendly message when no bak.1 exists', async () => {
      const filePath = await makeTempOverride({ verbose: false });
      await expect(rollbackConfig(filePath, null)).rejects.toMatchObject({
        code: 'NO_CONFIG_FILE',
        message: expect.stringMatching(/no runtime changes to roll back/i),
      });
    });

    test('refuses to promote a corrupt backup', async () => {
      const filePath = await makeTempOverride({ webPort: 3000 });
      await writePartialConfig(filePath, { webPort: 3001 }, null);
      // Corrupt the newest backup by hand.
      await fs.writeFile(`${filePath}.bak.1`, '{ not json ');
      await expect(rollbackConfig(filePath, null)).rejects.toMatchObject({ code: 'INVALID_JSON' });
      // Live file is untouched.
      expect(JSON.parse(await fs.readFile(filePath, 'utf-8'))).toEqual({ webPort: 3001 });
    });
  });

  describe('readCurrentConfig', () => {
    test('returns the parsed config alongside raw text + mtime', async () => {
      const filePath = await makeTempOverride({ port: '/dev/ttyUSB0', baud: 230400 });
      const { config, raw, mtimeMs } = await readCurrentConfig(filePath);
      expect(config.port).toBe('/dev/ttyUSB0');
      expect(raw).toContain('"port"');
      expect(typeof mtimeMs).toBe('number');
    });

    test('throws INVALID_JSON when the file on disk is unparseable', async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-badjson-'));
      const file = path.join(dir, 'fdcsds.config');
      await fs.writeFile(file, '{ not json ');
      await expect(readCurrentConfig(file)).rejects.toMatchObject({ code: 'INVALID_JSON' });
    });
  });
});
