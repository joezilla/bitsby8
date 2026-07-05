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
  ConfigWriteError,
  MAX_BACKUPS,
} from '../src/services/config-persistence';

async function makeTempConfig(initial: object): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-cfg-'));
  const file = path.join(dir, 'fdcsds.config');
  await fs.writeFile(file, JSON.stringify(initial, null, 2));
  return file;
}

describe('config persistence', () => {
  describe('writePartialConfig', () => {
    test('merges the patch and preserves untouched fields', async () => {
      const filePath = await makeTempConfig({ port: '/dev/ttyUSB0', baud: 230400, verbose: false });
      const { config } = await writePartialConfig(filePath, { verbose: true });
      expect(config.port).toBe('/dev/ttyUSB0');
      expect(config.baud).toBe(230400);
      expect(config.verbose).toBe(true);
      const onDisk = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      expect(onDisk).toEqual({ port: '/dev/ttyUSB0', baud: 230400, verbose: true });
    });

    test('rejects with VALIDATION_FAILED when the merged doc is invalid', async () => {
      const filePath = await makeTempConfig({ port: '/dev/ttyUSB0' });
      await expect(writePartialConfig(filePath, { webPort: 999999 } as any)).rejects.toBeInstanceOf(
        ConfigWriteError,
      );
    });

    test('rejects with NO_CONFIG_FILE when the daemon has no config path', async () => {
      await expect(writePartialConfig('', { verbose: true } as any)).rejects.toMatchObject({
        code: 'NO_CONFIG_FILE',
      });
    });

    test('rotates backups so bak.1 is the previous version', async () => {
      const filePath = await makeTempConfig({ port: '/dev/ttyUSB0', verbose: false });
      await writePartialConfig(filePath, { verbose: true });
      const bak1 = JSON.parse(await fs.readFile(`${filePath}.bak.1`, 'utf-8'));
      expect(bak1).toEqual({ port: '/dev/ttyUSB0', verbose: false });
    });

    test('caps backups at MAX_BACKUPS and rolls the oldest off', async () => {
      const filePath = await makeTempConfig({ verbose: false });

      for (let i = 0; i < MAX_BACKUPS + 2; i++) {
        await writePartialConfig(filePath, { webPort: 4000 + i });
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
      const filePath = await makeTempConfig({ verbose: false });
      await writePartialConfig(filePath, { verbose: true });
      await expect(fs.access(`${filePath}.tmp`)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    test('cross-field pin conflict comes back as a proper VALIDATION_FAILED', async () => {
      const filePath = await makeTempConfig({});
      await expect(
        writePartialConfig(filePath, {
          gpioLeds: {
            enabled: true,
            drive0: { enable: 17 },
            drive1: { enable: 17 },
          },
        } as any),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  describe('readCurrentConfig', () => {
    test('returns the parsed config alongside raw text + mtime', async () => {
      const filePath = await makeTempConfig({ port: '/dev/ttyUSB0', baud: 230400 });
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
