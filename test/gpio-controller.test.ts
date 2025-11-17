/**
 * GPIO LED Controller Unit Tests
 */

import { GpioLedController, GpioLedConfig } from '../src/gpio/gpio-controller';
import { GpioLedManager } from '../src/gpio/gpio-manager';
import { DriveState } from '../src/protocol';

// Mock GpioLedManager
jest.mock('../src/gpio/gpio-manager');

describe('GpioLedController', () => {
  let controller: GpioLedController;
  let mockManager: jest.Mocked<GpioLedManager>;

  const testConfig: GpioLedConfig = {
    enabled: true,
    drive0: {
      enable: 17,
      headLoad: 27,
      readOnly: 22,
    },
    drive1: {
      enable: 23,
      headLoad: 24,
      readOnly: 25,
    },
    terminal: {
      rx: 16,
      tx: 20,
      connected: 21,
    },
    blinkDuration: 100,
    activeLow: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    GpioLedController.resetInstance();

    // Setup mock manager
    mockManager = {
      getInstance: jest.fn(),
      initialize: jest.fn().mockResolvedValue(undefined),
      setupPin: jest.fn(),
      setLed: jest.fn(),
      blinkLed: jest.fn(),
      cleanup: jest.fn().mockResolvedValue(undefined),
      isAvailable: jest.fn().mockReturnValue(true),
      getConfiguredPins: jest.fn().mockReturnValue([]),
      getPlatformInfo: jest.fn().mockReturnValue('Mock Platform'),
    } as any;

    (GpioLedManager.getInstance as jest.Mock).mockReturnValue(mockManager);
    controller = GpioLedController.getInstance();
  });

  afterEach(async () => {
    await controller.shutdown();
    GpioLedController.resetInstance();
  });

  describe('Singleton Pattern', () => {
    test('should return same instance', () => {
      const instance1 = GpioLedController.getInstance();
      const instance2 = GpioLedController.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('Initialization', () => {
    test('should initialize with valid config', async () => {
      await expect(controller.initialize(testConfig)).resolves.not.toThrow();
      expect(mockManager.initialize).toHaveBeenCalledWith(false);
      expect(controller.isInitialized()).toBe(true);
    });

    test('should initialize with active-low config', async () => {
      const activeLowConfig = { ...testConfig, activeLow: true };
      await controller.initialize(activeLowConfig);
      expect(mockManager.initialize).toHaveBeenCalledWith(true);
    });

    test('should not initialize if disabled', async () => {
      const disabledConfig = { ...testConfig, enabled: false };
      await controller.initialize(disabledConfig);
      expect(mockManager.initialize).not.toHaveBeenCalled();
      expect(controller.isInitialized()).toBe(false);
    });

    test('should setup pins for configured drives', async () => {
      await controller.initialize(testConfig);
      expect(mockManager.setupPin).toHaveBeenCalledWith(17); // drive0 enable
      expect(mockManager.setupPin).toHaveBeenCalledWith(27); // drive0 headLoad
      expect(mockManager.setupPin).toHaveBeenCalledWith(22); // drive0 readOnly
      expect(mockManager.setupPin).toHaveBeenCalledWith(23); // drive1 enable
    });

    test('should setup terminal pins', async () => {
      await controller.initialize(testConfig);
      expect(mockManager.setupPin).toHaveBeenCalledWith(16); // rx
      expect(mockManager.setupPin).toHaveBeenCalledWith(20); // tx
      expect(mockManager.setupPin).toHaveBeenCalledWith(21); // connected
    });

    test('should handle partial drive configuration', async () => {
      const partialConfig: GpioLedConfig = {
        enabled: true,
        drive0: {
          enable: 17,
          // headLoad and readOnly not specified
        },
      };
      await controller.initialize(partialConfig);
      expect(mockManager.setupPin).toHaveBeenCalledWith(17);
      expect(mockManager.setupPin).not.toHaveBeenCalledWith(27);
      expect(mockManager.setupPin).not.toHaveBeenCalledWith(22);
    });

    test('should handle null pin values', async () => {
      const nullPinConfig: GpioLedConfig = {
        enabled: true,
        drive0: {
          enable: 17,
          headLoad: null,
          readOnly: null,
        },
      };
      await controller.initialize(nullPinConfig);
      expect(mockManager.setupPin).toHaveBeenCalledWith(17);
      expect(mockManager.setupPin).toHaveBeenCalledTimes(1);
    });

    test('should throw error if already initialized', async () => {
      await controller.initialize(testConfig);
      await expect(controller.initialize(testConfig)).rejects.toThrow('already initialized');
    });

    test('should handle platform not available', async () => {
      mockManager.isAvailable.mockReturnValue(false);
      await controller.initialize(testConfig);
      expect(controller.isInitialized()).toBe(false);
      expect(mockManager.setupPin).not.toHaveBeenCalled();
    });
  });

  describe('Drive Status Updates', () => {
    const driveState: DriveState = {
      fd: 1,
      filename: 'test.dsk',
      mounted: true,
      readonly: false,
      hdld: true,
      track: 5,
    };

    beforeEach(async () => {
      await controller.initialize(testConfig);
    });

    test('should update drive 0 status', () => {
      controller.updateDriveStatus(0, driveState);
      expect(mockManager.setLed).toHaveBeenCalledWith(17, true); // enable
      expect(mockManager.setLed).toHaveBeenCalledWith(27, true); // headLoad
      expect(mockManager.setLed).toHaveBeenCalledWith(22, false); // readOnly
    });

    test('should update drive 1 status', () => {
      controller.updateDriveStatus(1, driveState);
      expect(mockManager.setLed).toHaveBeenCalledWith(23, true); // enable
      expect(mockManager.setLed).toHaveBeenCalledWith(24, true); // headLoad
      expect(mockManager.setLed).toHaveBeenCalledWith(25, false); // readOnly
    });

    test('should update mounted and readonly status', () => {
      const unmountedReadOnly: DriveState = {
        ...driveState,
        mounted: false,
        readonly: true,
      };
      controller.updateDriveStatus(0, unmountedReadOnly);
      expect(mockManager.setLed).toHaveBeenCalledWith(17, false); // enable off
      expect(mockManager.setLed).toHaveBeenCalledWith(22, true); // readonly on
    });

    test('should handle unconfigured drive', () => {
      controller.updateDriveStatus(2, driveState); // drive2 not configured
      expect(mockManager.setLed).not.toHaveBeenCalled();
    });

    test('should be no-op if not initialized', () => {
      GpioLedController.resetInstance();
      const uninitController = GpioLedController.getInstance();
      uninitController.updateDriveStatus(0, driveState);
      expect(mockManager.setLed).not.toHaveBeenCalled();
    });

    test('should be no-op if platform not available', async () => {
      // Reset and create a new controller with platform unavailable
      GpioLedController.resetInstance();
      const newController = GpioLedController.getInstance();
      mockManager.isAvailable.mockReturnValue(false);
      await newController.initialize(testConfig);
      mockManager.isAvailable.mockReturnValue(false);
      newController.updateDriveStatus(0, driveState);
      // Should not throw, but won't set LEDs
      expect(mockManager.setLed).not.toHaveBeenCalled();
    });
  });

  describe('Terminal Status Updates', () => {
    beforeEach(async () => {
      await controller.initialize(testConfig);
    });

    test('should blink RX LED', () => {
      controller.updateTerminalRx();
      expect(mockManager.blinkLed).toHaveBeenCalledWith(16, 100);
    });

    test('should blink TX LED', () => {
      controller.updateTerminalTx();
      expect(mockManager.blinkLed).toHaveBeenCalledWith(20, 100);
    });

    test('should update connected LED on', () => {
      controller.updateTerminalConnected(true);
      expect(mockManager.setLed).toHaveBeenCalledWith(21, true);
    });

    test('should update connected LED off', () => {
      controller.updateTerminalConnected(false);
      expect(mockManager.setLed).toHaveBeenCalledWith(21, false);
    });

    test('should use custom blink duration', async () => {
      const customConfig = { ...testConfig, blinkDuration: 50 };
      GpioLedController.resetInstance();
      const customController = GpioLedController.getInstance();
      await customController.initialize(customConfig);

      customController.updateTerminalRx();
      expect(mockManager.blinkLed).toHaveBeenCalledWith(16, 50);
    });

    test('should be no-op if not initialized', () => {
      GpioLedController.resetInstance();
      const uninitController = GpioLedController.getInstance();
      uninitController.updateTerminalRx();
      uninitController.updateTerminalTx();
      uninitController.updateTerminalConnected(true);
      expect(mockManager.blinkLed).not.toHaveBeenCalled();
      expect(mockManager.setLed).not.toHaveBeenCalled();
    });

    test('should handle missing terminal config', async () => {
      const noTerminalConfig: GpioLedConfig = {
        enabled: true,
        drive0: {
          enable: 17,
        },
      };
      GpioLedController.resetInstance();
      const newController = GpioLedController.getInstance();
      await newController.initialize(noTerminalConfig);

      newController.updateTerminalRx();
      newController.updateTerminalTx();
      newController.updateTerminalConnected(true);
      expect(mockManager.blinkLed).not.toHaveBeenCalled();
      expect(mockManager.setLed).not.toHaveBeenCalled();
    });
  });

  describe('Status Methods', () => {
    test('should return availability status', async () => {
      mockManager.isAvailable.mockReturnValue(true);
      expect(controller.isAvailable()).toBe(true);

      mockManager.isAvailable.mockReturnValue(false);
      expect(controller.isAvailable()).toBe(false);
    });

    test('should return initialization status', async () => {
      expect(controller.isInitialized()).toBe(false);
      await controller.initialize(testConfig);
      expect(controller.isInitialized()).toBe(true);
    });

    test('should return configuration', async () => {
      expect(controller.getConfig()).toBeNull();
      await controller.initialize(testConfig);
      expect(controller.getConfig()).toEqual(testConfig);
    });
  });

  describe('Shutdown', () => {
    test('should cleanup manager on shutdown', async () => {
      await controller.initialize(testConfig);
      await controller.shutdown();
      expect(mockManager.cleanup).toHaveBeenCalled();
      expect(controller.isInitialized()).toBe(false);
      expect(controller.getConfig()).toBeNull();
    });

    test('should be no-op if not initialized', async () => {
      await controller.shutdown();
      expect(mockManager.cleanup).not.toHaveBeenCalled();
    });

    test('should allow re-initialization after shutdown', async () => {
      await controller.initialize(testConfig);
      await controller.shutdown();
      await expect(controller.initialize(testConfig)).resolves.not.toThrow();
      expect(controller.isInitialized()).toBe(true);
    });
  });
});
