/**
 * Configuration File Parser Unit Tests
 */

import * as fs from 'fs/promises';
import { loadConfigFile, mergeConfig, getExampleConfig, ConfigFile } from '../src/config';

// Mock fs module
jest.mock('fs/promises');

describe('Configuration Module', () => {
  const mockReadFile = fs.readFile as jest.MockedFunction<typeof fs.readFile>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('loadConfigFile', () => {
    test('should load valid config file from specified path', async () => {
      const configContent = JSON.stringify({
        port: '/dev/ttyUSB0',
        baud: 230400,
        drive0: 'test.dsk',
        web: true,
      });

      mockReadFile.mockResolvedValue(configContent);

      const config = await loadConfigFile('test.config');

      expect(config).toEqual({
        port: '/dev/ttyUSB0',
        baud: 230400,
        drive0: 'test.dsk',
        web: true,
      });
    });

    test('should throw error if specified config file not found', async () => {
      const error: any = new Error('File not found');
      error.code = 'ENOENT';
      mockReadFile.mockRejectedValue(error);

      await expect(loadConfigFile('missing.config')).rejects.toThrow('Config file not found');
    });

    test('should throw error for invalid JSON', async () => {
      mockReadFile.mockResolvedValue('{ invalid json }');

      await expect(loadConfigFile('bad.config')).rejects.toThrow('Invalid JSON');
    });

    test('should return null if no config file found in default locations', async () => {
      const error: any = new Error('File not found');
      error.code = 'ENOENT';
      mockReadFile.mockRejectedValue(error);

      const config = await loadConfigFile();

      expect(config).toBeNull();
    });

    test('should load from first available default location', async () => {
      const configContent = JSON.stringify({ port: '/dev/ttyUSB0' });

      // First call fails (first default location)
      // Second call succeeds (second default location)
      mockReadFile
        .mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
        .mockResolvedValueOnce(configContent);

      const config = await loadConfigFile();

      expect(config).toEqual({ port: '/dev/ttyUSB0' });
      expect(mockReadFile).toHaveBeenCalledTimes(2);
    });
  });

  describe('config validation', () => {
    test('should validate port as string', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ port: 123 }));
      await expect(loadConfigFile('test.config')).rejects.toThrow('"port" must be a string');
    });

    test('should validate baud as number', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ baud: 'fast' }));
      await expect(loadConfigFile('test.config')).rejects.toThrow('"baud" must be a number');
    });

    test('should validate drive paths as strings', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ drive0: 123 }));
      await expect(loadConfigFile('test.config')).rejects.toThrow('"drive0" must be a string');
    });

    test('should validate readonly as array', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ readonly: 'yes' }));
      await expect(loadConfigFile('test.config')).rejects.toThrow('"readonly" must be an array');
    });

    test('should validate readonly array contains valid drive numbers', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ readonly: [0, 5] }));
      await expect(loadConfigFile('test.config')).rejects.toThrow('"readonly" must contain numbers 0-3');
    });

    test('should validate boolean fields', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ verbose: 'yes' }));
      await expect(loadConfigFile('test.config')).rejects.toThrow('"verbose" must be a boolean');
    });

    test('should validate webPort as number', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ webPort: '3000' }));
      await expect(loadConfigFile('test.config')).rejects.toThrow('"webPort" must be a number');
    });

    test('should accept all valid fields', async () => {
      const validConfig = {
        port: '/dev/ttyUSB0',
        baud: 230400,
        drive0: 'disk0.dsk',
        drive1: 'disk1.dsk',
        drive2: 'disk2.dsk',
        drive3: 'disk3.dsk',
        readonly: [0, 1],
        verbose: true,
        debug: false,
        web: true,
        webPort: 3000,
        webHost: 'localhost',
        terminalPort: '/dev/ttyUSB1',
        terminalBaud: 9600,
        terminalAutoconnect: true,
      };

      mockReadFile.mockResolvedValue(JSON.stringify(validConfig));

      const config = await loadConfigFile('test.config');
      expect(config).toEqual(validConfig);
    });
  });

  describe('mergeConfig', () => {
    test('should use config file values when CLI options not provided', () => {
      const configFile: ConfigFile = {
        port: '/dev/ttyUSB0',
        baud: 230400,
        drive0: 'test.dsk',
      };

      const cliOptions = {};

      const merged = mergeConfig(configFile, cliOptions);

      expect(merged.port).toBe('/dev/ttyUSB0');
      expect(merged.baud).toBe(230400);
      expect(merged.drive0).toBe('test.dsk');
    });

    test('should override config file with CLI options', () => {
      const configFile: ConfigFile = {
        port: '/dev/ttyUSB0',
        baud: 230400,
        drive0: 'config.dsk',
      };

      const cliOptions = {
        port: '/dev/ttyUSB1',
        drive0: 'cli.dsk',
      };

      const merged = mergeConfig(configFile, cliOptions);

      expect(merged.port).toBe('/dev/ttyUSB1');
      expect(merged.baud).toBe(230400);
      expect(merged.drive0).toBe('cli.dsk');
    });

    test('should handle null config file', () => {
      const cliOptions = {
        port: '/dev/ttyUSB0',
        baud: '460800',
      };

      const merged = mergeConfig(null, cliOptions);

      expect(merged.port).toBe('/dev/ttyUSB0');
      expect(merged.baud).toBe('460800');
    });

    test('should merge all drive options', () => {
      const configFile: ConfigFile = {
        drive0: 'config0.dsk',
        drive1: 'config1.dsk',
      };

      const cliOptions = {
        drive1: 'cli1.dsk',
        drive2: 'cli2.dsk',
      };

      const merged = mergeConfig(configFile, cliOptions);

      expect(merged.drive0).toBe('config0.dsk');
      expect(merged.drive1).toBe('cli1.dsk');
      expect(merged.drive2).toBe('cli2.dsk');
    });

    test('should merge web interface options', () => {
      const configFile: ConfigFile = {
        web: false,
        webPort: 8080,
        webHost: '0.0.0.0',
      };

      const cliOptions = {
        web: true,
        webPort: '3000',
      };

      const merged = mergeConfig(configFile, cliOptions);

      expect(merged.web).toBe(true);
      expect(merged.webPort).toBe(3000);
      expect(merged.webHost).toBe('0.0.0.0');
    });

    test('should merge terminal options', () => {
      const configFile: ConfigFile = {
        terminalPort: '/dev/ttyUSB1',
        terminalBaud: 115200,
        terminalAutoconnect: false,
      };

      const cliOptions = {
        terminalBaud: '9600',
        terminalAutoconnect: true,
      };

      const merged = mergeConfig(configFile, cliOptions);

      expect(merged.terminalPort).toBe('/dev/ttyUSB1');
      expect(merged.terminalBaud).toBe(9600);
      expect(merged.terminalAutoconnect).toBe(true);
    });

    test('should handle readonly array override', () => {
      const configFile: ConfigFile = {
        readonly: [0, 1],
      };

      const cliOptions = {
        readonly: [2, 3],
      };

      const merged = mergeConfig(configFile, cliOptions);

      expect(merged.readonly).toEqual([2, 3]);
    });

    test('should not override with empty readonly array', () => {
      const configFile: ConfigFile = {
        readonly: [0, 1],
      };

      const cliOptions = {
        readonly: [],
      };

      const merged = mergeConfig(configFile, cliOptions);

      expect(merged.readonly).toEqual([0, 1]);
    });
  });

  describe('getExampleConfig', () => {
    test('should return valid JSON string', () => {
      const example = getExampleConfig();

      expect(() => JSON.parse(example)).not.toThrow();
    });

    test('should include all config options', () => {
      const example = JSON.parse(getExampleConfig());

      expect(example).toHaveProperty('port');
      expect(example).toHaveProperty('baud');
      expect(example).toHaveProperty('drive0');
      expect(example).toHaveProperty('drive1');
      expect(example).toHaveProperty('drive2');
      expect(example).toHaveProperty('drive3');
      expect(example).toHaveProperty('readonly');
      expect(example).toHaveProperty('verbose');
      expect(example).toHaveProperty('debug');
      expect(example).toHaveProperty('web');
      expect(example).toHaveProperty('webPort');
      expect(example).toHaveProperty('webHost');
      expect(example).toHaveProperty('terminalPort');
      expect(example).toHaveProperty('terminalBaud');
      expect(example).toHaveProperty('terminalAutoconnect');
    });

    test('should have sensible default values', () => {
      const example = JSON.parse(getExampleConfig());

      expect(example.baud).toBe(230400);
      expect(example.webPort).toBe(3000);
      expect(example.webHost).toBe('localhost');
      expect(example.terminalBaud).toBe(9600);
      expect(example.verbose).toBe(false);
      expect(example.debug).toBe(false);
      expect(Array.isArray(example.readonly)).toBe(true);
    });
  });
});
