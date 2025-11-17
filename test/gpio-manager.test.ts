/**
 * GPIO Manager Unit Tests
 */

// Mock fs module for platform detection
jest.mock('fs');

// Mock os module
jest.mock('os', () => ({
  platform: jest.fn(() => 'linux'),
}));

// Mock child_process for CLI fallback detection
jest.mock('child_process', () => ({
  execSync: jest.fn(() => '/usr/bin/gpioset'),
  exec: jest.fn(),
}));

// Mock lgpio module - must be done before importing GpioLedManager
jest.mock('lgpio', () => {
  let handleCounter = 0;
  const pins = new Map();

  return {
    gpiochip_open: jest.fn((_chipnum: number) => {
      return ++handleCounter;
    }),
    gpio_claim_output: jest.fn((_handle: number, _flags: number, pin: number, value: number) => {
      pins.set(pin, value);
    }),
    gpio_write: jest.fn((_handle: number, pin: number, value: number) => {
      pins.set(pin, value);
    }),
    gpio_free: jest.fn((_handle: number, pin: number) => {
      pins.delete(pin);
    }),
    gpiochip_close: jest.fn((_handle: number) => {
      // Close the chip
    }),
    SET_ACTIVE_LOW: 1,
  };
}, { virtual: true });

import { GpioLedManager } from '../src/gpio/gpio-manager';
import * as fs from 'fs';

describe('GpioLedManager', () => {
  let manager: GpioLedManager;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset singleton
    GpioLedManager.resetInstance();

    // Mock cpuinfo to simulate Raspberry Pi - must be done before getInstance()
    (fs.readFileSync as jest.Mock).mockReturnValue('Raspberry Pi 4 Model B');
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    // Ensure os.platform returns 'linux' - some tests change this
    const os = require('os');
    (os.platform as jest.Mock).mockReturnValue('linux');

    manager = GpioLedManager.getInstance();
  });

  afterEach(async () => {
    await manager.cleanup();
    GpioLedManager.resetInstance();
  });

  describe('Singleton Pattern', () => {
    test('should return same instance', () => {
      const instance1 = GpioLedManager.getInstance();
      const instance2 = GpioLedManager.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('Platform Detection', () => {
    test('should detect Raspberry Pi from cpuinfo', async () => {
      (fs.readFileSync as jest.Mock).mockReturnValue('Model: Raspberry Pi 4');
      GpioLedManager.resetInstance();
      const newManager = GpioLedManager.getInstance();
      await newManager.initialize();
      expect(newManager.isAvailable()).toBe(true);
    });

    test('should detect BCM chip from cpuinfo', async () => {
      (fs.readFileSync as jest.Mock).mockReturnValue('Hardware: BCM2835');
      GpioLedManager.resetInstance();
      const newManager = GpioLedManager.getInstance();
      await newManager.initialize();
      expect(newManager.isAvailable()).toBe(true);
    });

    test('should return false on non-Linux platform', () => {
      const os = require('os');
      (os.platform as jest.Mock).mockReturnValue('darwin');
      GpioLedManager.resetInstance();
      const newManager = GpioLedManager.getInstance();
      expect(newManager.isAvailable()).toBe(false);
    });
  });

  describe('Initialization', () => {
    test('should initialize successfully', async () => {
      await expect(manager.initialize()).resolves.not.toThrow();
    });

    test('should initialize with active-low mode', async () => {
      await expect(manager.initialize(true)).resolves.not.toThrow();
    });

    test('should throw error if already initialized', async () => {
      await manager.initialize();
      await expect(manager.initialize()).rejects.toThrow('already initialized');
    });

    test('should not throw on unsupported platform', async () => {
      const os = require('os');
      (os.platform as jest.Mock).mockReturnValue('darwin');
      GpioLedManager.resetInstance();
      const unsupportedManager = GpioLedManager.getInstance();
      await expect(unsupportedManager.initialize()).resolves.not.toThrow();
    });
  });

  describe('Pin Setup', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    test('should setup valid GPIO pin', async () => {
      await expect(manager.setupPin(17)).resolves.not.toThrow();
      expect(manager.getConfiguredPins()).toContain(17);
    });

    test('should setup multiple pins', async () => {
      await manager.setupPin(17);
      await manager.setupPin(27);
      await manager.setupPin(22);
      expect(manager.getConfiguredPins()).toEqual(expect.arrayContaining([17, 27, 22]));
    });

    test('should not setup duplicate pins', async () => {
      await manager.setupPin(17);
      await manager.setupPin(17);
      expect(manager.getConfiguredPins().filter(p => p === 17)).toHaveLength(1);
    });

    test('should throw error for invalid pin number (negative)', async () => {
      await expect(manager.setupPin(-1)).rejects.toThrow('Invalid GPIO pin number');
    });

    test('should throw error for invalid pin number (too high)', async () => {
      await expect(manager.setupPin(28)).rejects.toThrow('Invalid GPIO pin number');
    });

    test('should throw error if not initialized', async () => {
      GpioLedManager.resetInstance();
      const uninitManager = GpioLedManager.getInstance();
      await expect(uninitManager.setupPin(17)).rejects.toThrow('not initialized');
    });

    test('should be no-op on unsupported platform', async () => {
      const os = require('os');
      (os.platform as jest.Mock).mockReturnValue('darwin');
      GpioLedManager.resetInstance();
      const unsupportedManager = GpioLedManager.getInstance();
      await expect(unsupportedManager.setupPin(17)).resolves.not.toThrow();
      expect(unsupportedManager.getConfiguredPins()).toEqual([]);
    });
  });

  describe('LED Control', () => {
    beforeEach(async () => {
      await manager.initialize();
      await manager.setupPin(17);
    });

    test('should set LED on', () => {
      expect(() => manager.setLed(17, true)).not.toThrow();
    });

    test('should set LED off', () => {
      expect(() => manager.setLed(17, false)).not.toThrow();
    });

    test('should ignore non-setup pins', () => {
      expect(() => manager.setLed(27, true)).not.toThrow();
    });

    test('should blink LED', () => {
      jest.useFakeTimers();
      manager.blinkLed(17, 100);
      jest.advanceTimersByTime(100);
      jest.useRealTimers();
    });

    test('should be no-op on unsupported platform', () => {
      const os = require('os');
      (os.platform as jest.Mock).mockReturnValue('darwin');
      GpioLedManager.resetInstance();
      const unsupportedManager = GpioLedManager.getInstance();
      expect(() => unsupportedManager.setLed(17, true)).not.toThrow();
      expect(() => unsupportedManager.blinkLed(17, 100)).not.toThrow();
    });
  });

  describe('Cleanup', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    test('should cleanup all pins', async () => {
      await manager.setupPin(17);
      await manager.setupPin(27);
      await expect(manager.cleanup()).resolves.not.toThrow();
      expect(manager.getConfiguredPins()).toEqual([]);
    });

    test('should be no-op on unsupported platform', async () => {
      const os = require('os');
      (os.platform as jest.Mock).mockReturnValue('darwin');
      GpioLedManager.resetInstance();
      const unsupportedManager = GpioLedManager.getInstance();
      await expect(unsupportedManager.cleanup()).resolves.not.toThrow();
    });

    test('should allow re-initialization after cleanup', async () => {
      await manager.cleanup();
      await expect(manager.initialize()).resolves.not.toThrow();
    });
  });

  describe('Platform Info', () => {
    test('should return platform information', async () => {
      await manager.initialize();
      const info = manager.getPlatformInfo();
      expect(info).toContain('Platform:');
      expect(info).toContain('Implementation:');
      expect(info).toContain('Supported:');
    });
  });
});
