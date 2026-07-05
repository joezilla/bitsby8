/**
 * Configuration File Parser Unit Tests
 */

import * as fs from 'fs/promises';
import {
  loadConfigFile,
  mergeConfig,
  getExampleConfig,
  ConfigFile,
  ConfigSchema,
  SerialSchema,
  WebSchema,
  GpioSchema,
  resolveDataDir,
  resolveDrivePath,
} from '../src/config';

jest.mock('fs/promises');

describe('Configuration Module', () => {
  const mockReadFile = fs.readFile as jest.MockedFunction<typeof fs.readFile>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('loadConfigFile', () => {
    test('returns { config, filePath } when the file is readable', async () => {
      const content = JSON.stringify({
        port: '/dev/ttyUSB0',
        baud: 230400,
        drive0: 'test.dsk',
        web: true,
      });
      mockReadFile.mockResolvedValue(content);

      const result = await loadConfigFile('test.config');

      expect(result?.config).toEqual({
        port: '/dev/ttyUSB0',
        baud: 230400,
        drive0: 'test.dsk',
        web: true,
      });
      expect(result?.filePath).toMatch(/test\.config$/);
    });

    test('throws when the requested path does not exist', async () => {
      const enoent: any = new Error('File not found');
      enoent.code = 'ENOENT';
      mockReadFile.mockRejectedValue(enoent);
      await expect(loadConfigFile('missing.config')).rejects.toThrow('Config file not found');
    });

    test('throws on invalid JSON', async () => {
      mockReadFile.mockResolvedValue('{ invalid json }');
      await expect(loadConfigFile('bad.config')).rejects.toThrow('Invalid JSON');
    });

    test('returns null when no default location has a config', async () => {
      const enoent: any = new Error('ENOENT');
      enoent.code = 'ENOENT';
      mockReadFile.mockRejectedValue(enoent);
      await expect(loadConfigFile()).resolves.toBeNull();
    });

    test('loads from the first available default location', async () => {
      const content = JSON.stringify({ port: '/dev/ttyUSB0' });
      mockReadFile
        .mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
        .mockResolvedValueOnce(content);

      const result = await loadConfigFile();

      expect(result?.config).toEqual({ port: '/dev/ttyUSB0' });
      expect(mockReadFile).toHaveBeenCalledTimes(2);
    });
  });

  describe('Zod validation via loadConfigFile', () => {
    test('rejects a non-string port', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ port: 123 }));
      await expect(loadConfigFile('test.config')).rejects.toThrow(/Config error/);
    });

    test('rejects a non-number baud', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ baud: 'fast' }));
      await expect(loadConfigFile('test.config')).rejects.toThrow(/Config error/);
    });

    test('rejects a drive path that is a number', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ drive0: 123 }));
      await expect(loadConfigFile('test.config')).rejects.toThrow(/Config error/);
    });

    test('rejects a readonly array containing out-of-range drive numbers', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ readonly: [0, 5] }));
      await expect(loadConfigFile('test.config')).rejects.toThrow(/Config error/);
    });

    test('rejects a non-boolean verbose flag', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ verbose: 'yes' }));
      await expect(loadConfigFile('test.config')).rejects.toThrow(/Config error/);
    });

    test('accepts null for optional string fields (drives, dataDir, logFile)', async () => {
      mockReadFile.mockResolvedValue(
        JSON.stringify({ drive2: null, drive3: null, dataDir: null, logFile: null }),
      );
      const result = await loadConfigFile('test.config');
      expect(result?.config).toEqual({
        drive2: null,
        drive3: null,
        dataDir: null,
        logFile: null,
      });
    });

    test('parses the output of getExampleConfig() cleanly', async () => {
      mockReadFile.mockResolvedValue(getExampleConfig());
      const result = await loadConfigFile('test.config');
      expect(result?.config.dataDir).toBeNull();
      expect(result?.config.drive2).toBeNull();
      expect(result?.config.gpioLeds?.enabled).toBe(true);
    });

    test('accepts a fully populated valid config', async () => {
      const valid = {
        port: '/dev/ttyUSB0',
        baud: 230400,
        drive0: 'disk0.dsk',
        readonly: [0, 1],
        verbose: true,
        debug: false,
        logFile: '/var/log/fdcsds.log',
        dataDir: '/var/lib/fdcsds',
        web: true,
        webPort: 3000,
        webHost: 'localhost',
        terminalPort: '/dev/ttyUSB1',
        terminalBaud: 9600,
        terminalAutoconnect: true,
      };
      mockReadFile.mockResolvedValue(JSON.stringify(valid));
      const result = await loadConfigFile('test.config');
      expect(result?.config).toEqual(valid);
    });

    test('preserves unknown fields via passthrough (backwards-compat guarantee)', async () => {
      const withExtra = {
        port: '/dev/ttyUSB0',
        futureField: 'we-dont-know-about-this-yet',
      };
      mockReadFile.mockResolvedValue(JSON.stringify(withExtra));
      const result = await loadConfigFile('test.config');
      expect((result?.config as any).futureField).toBe('we-dont-know-about-this-yet');
    });
  });

  describe('Section schemas', () => {
    test('SerialSchema accepts partial input', () => {
      expect(SerialSchema.parse({ baud: 115200 })).toEqual({ baud: 115200 });
    });

    test('WebSchema rejects port out of range', () => {
      expect(() => WebSchema.parse({ webPort: 999999 })).toThrow();
    });

    test('GpioSchema fills in enabled default', () => {
      expect(GpioSchema.parse({})).toEqual({ enabled: false });
    });

    test('ConfigSchema flags a GPIO pin used twice', () => {
      const result = ConfigSchema.safeParse({
        gpioLeds: {
          enabled: true,
          drive0: { enable: 17 },
          drive1: { enable: 17 },
        },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(i => /used more than once/i.test(i.message))).toBe(true);
      }
    });

    test('ConfigSchema allows the same pin number in two independent drive fields when only one is set', () => {
      const result = ConfigSchema.safeParse({
        gpioLeds: {
          enabled: true,
          drive0: { enable: 17, headLoad: 27 },
          drive1: { enable: null, headLoad: 24 },
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('mergeConfig', () => {
    test('uses config-file values when CLI omits them', () => {
      const cfg: ConfigFile = { port: '/dev/ttyUSB0', baud: 230400, drive0: 'test.dsk' };
      const merged = mergeConfig(cfg, {});
      expect(merged.port).toBe('/dev/ttyUSB0');
      expect(merged.baud).toBe(230400);
      expect(merged.drive0).toBe('test.dsk');
    });

    test('overrides config with CLI options', () => {
      const cfg: ConfigFile = { port: '/dev/ttyUSB0', baud: 230400 };
      const merged = mergeConfig(cfg, { port: '/dev/ttyUSB1' });
      expect(merged.port).toBe('/dev/ttyUSB1');
      expect(merged.baud).toBe(230400);
    });

    test('handles null config file', () => {
      const merged = mergeConfig(null, { port: '/dev/ttyUSB0', baud: '460800' });
      expect(merged.port).toBe('/dev/ttyUSB0');
      expect(merged.baud).toBe('460800');
    });

    test('merges web-interface options and parses webPort as int', () => {
      const cfg: ConfigFile = { web: false, webPort: 8080, webHost: '0.0.0.0' };
      const merged = mergeConfig(cfg, { web: true, webPort: '3000' });
      expect(merged.web).toBe(true);
      expect(merged.webPort).toBe(3000);
      expect(merged.webHost).toBe('0.0.0.0');
    });

    test('does not override readonly with an empty CLI array', () => {
      const cfg: ConfigFile = { readonly: [0, 1] };
      const merged = mergeConfig(cfg, { readonly: [] });
      expect(merged.readonly).toEqual([0, 1]);
    });

    test('overrides dataDir from CLI when supplied', () => {
      const cfg: ConfigFile = { dataDir: '/var/lib/fdcsds', port: '/dev/ttyUSB0' };
      const merged = mergeConfig(cfg, { dataDir: '/tmp/fdctest' });
      expect(merged.dataDir).toBe('/tmp/fdctest');
      expect(merged.port).toBe('/dev/ttyUSB0');
    });
  });

  describe('getExampleConfig', () => {
    test('returns valid JSON', () => {
      expect(() => JSON.parse(getExampleConfig())).not.toThrow();
    });

    test('includes every top-level knob', () => {
      const ex = JSON.parse(getExampleConfig());
      for (const key of [
        'dataDir', 'port', 'baud', 'drive0', 'drive1', 'drive2', 'drive3',
        'readonly', 'verbose', 'debug', 'logFile', 'web', 'webPort', 'webHost',
        'terminalPort', 'terminalBaud', 'terminalAutoconnect', 'gpioLeds',
      ]) {
        expect(ex).toHaveProperty(key);
      }
    });

    test('has sensible defaults', () => {
      const ex = JSON.parse(getExampleConfig());
      expect(ex.dataDir).toBeNull();
      expect(ex.baud).toBe(230400);
      expect(ex.webPort).toBe(3000);
      expect(ex.webHost).toBe('localhost');
      expect(ex.terminalBaud).toBe(9600);
      expect(ex.verbose).toBe(false);
      expect(Array.isArray(ex.readonly)).toBe(true);
    });

    test('is accepted by ConfigSchema.parse', () => {
      expect(() => ConfigSchema.parse(JSON.parse(getExampleConfig()))).not.toThrow();
    });
  });

  describe('resolveDataDir', () => {
    test('returns cwd for undefined / null / empty', () => {
      expect(resolveDataDir(undefined)).toBe(process.cwd());
      expect(resolveDataDir(null)).toBe(process.cwd());
      expect(resolveDataDir('')).toBe(process.cwd());
    });

    test('passes absolute paths through unchanged', () => {
      expect(resolveDataDir('/var/lib/fdcsds')).toBe('/var/lib/fdcsds');
    });

    test('resolves relative paths against cwd', () => {
      expect(resolveDataDir('data')).toBe(require('path').resolve('data'));
    });
  });

  describe('resolveDrivePath', () => {
    test('returns absolute paths unchanged', () => {
      expect(resolveDrivePath('/absolute/path/to/disk.dsk', '/var/lib/fdcsds')).toBe(
        '/absolute/path/to/disk.dsk',
      );
    });

    test('resolves relative paths against dataDir', () => {
      expect(resolveDrivePath('disks/cpm22.dsk', '/var/lib/fdcsds')).toBe(
        '/var/lib/fdcsds/disks/cpm22.dsk',
      );
    });
  });
});
