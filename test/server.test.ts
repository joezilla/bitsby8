/**
 * FDC Server Unit Tests
 *
 * Note: Full server loop tests are complex due to async nature.
 * These tests focus on initialization and basic functionality.
 * Integration tests with mock serial hardware would be needed for full coverage.
 */

import { FdcServer } from '../src/server';
import { DriveManager } from '../src/drive';
import { SerialPortManager } from '../src/serial';
import { DisplayManager } from '../src/ui/display';
import {
  createDefaultConfig,
} from '../src/protocol';

// Mock all dependencies
jest.mock('../src/drive');
jest.mock('../src/serial');
jest.mock('../src/ui/display');

describe('FdcServer', () => {
  let server: FdcServer;
  let mockDriveManager: jest.Mocked<DriveManager>;
  let mockSerialManager: jest.Mocked<SerialPortManager>;
  let mockDisplayManager: jest.Mocked<DisplayManager>;
  let config: any;

  beforeEach(() => {
    // Create mock instances
    mockDriveManager = new DriveManager() as jest.Mocked<DriveManager>;
    mockSerialManager = new SerialPortManager() as jest.Mocked<SerialPortManager>;
    mockDisplayManager = new DisplayManager() as jest.Mocked<DisplayManager>;

    // Setup default mock implementations
    mockDriveManager.getDriveState = jest.fn().mockReturnValue({
      fd: 3,
      filename: 'test.dsk',
      mounted: true,
      readonly: false,
      hdld: false,
      track: 0,
    });
    mockDriveManager.isMounted = jest.fn().mockReturnValue(true);
    mockDriveManager.readTrack = jest.fn().mockResolvedValue(Buffer.alloc(4384));
    mockDriveManager.writeTrack = jest.fn().mockResolvedValue(4384);

    mockSerialManager.receiveBuffer = jest.fn();
    mockSerialManager.sendBuffer = jest.fn().mockResolvedValue(undefined);

    mockDisplayManager.displayCommand = jest.fn();
    mockDisplayManager.displayBlock = jest.fn();
    mockDisplayManager.displayHead = jest.fn();
    mockDisplayManager.displayTrack = jest.fn();
    mockDisplayManager.displayBuffer = jest.fn();
    mockDisplayManager.displayError = jest.fn();
    mockDisplayManager.displayDebug = jest.fn();

    config = createDefaultConfig();
    config.verbose = false;
    config.debug = false;

    server = new FdcServer(
      mockDriveManager,
      mockSerialManager,
      mockDisplayManager,
      config
    );
  });

  describe('constructor', () => {
    test('should initialize with config values', () => {
      expect(server).toBeInstanceOf(FdcServer);
    });

    test('should start with running = false', () => {
      expect((server as any).running).toBe(false);
    });

    test('should initialize verbose mode from config', () => {
      expect((server as any).verbose).toBe(false);

      const verboseConfig = createDefaultConfig();
      verboseConfig.verbose = true;
      const verboseServer = new FdcServer(
        mockDriveManager,
        mockSerialManager,
        mockDisplayManager,
        verboseConfig
      );
      expect((verboseServer as any).verbose).toBe(true);
    });

    test('should initialize debug mode from config', () => {
      expect((server as any).debug).toBe(false);

      const debugConfig = createDefaultConfig();
      debugConfig.debug = true;
      const debugServer = new FdcServer(
        mockDriveManager,
        mockSerialManager,
        mockDisplayManager,
        debugConfig
      );
      expect((debugServer as any).debug).toBe(true);
    });
  });

  describe('stop', () => {
    test('should set running flag to false', () => {
      (server as any).running = true;
      server.stop();
      expect((server as any).running).toBe(false);
    });

    test('should work when server not running', () => {
      expect(() => server.stop()).not.toThrow();
      expect((server as any).running).toBe(false);
    });
  });

  describe('toggleVerbose', () => {
    test('should toggle verbose mode', () => {
      expect((server as any).verbose).toBe(false);
      server.toggleVerbose();
      expect((server as any).verbose).toBe(true);
      server.toggleVerbose();
      expect((server as any).verbose).toBe(false);
    });

    test('should toggle multiple times', () => {
      // Initial state is false
      for (let i = 0; i < 10; i++) {
        server.toggleVerbose();
        const expected = (i + 1) % 2 === 1; // After toggle: odd iterations = true
        expect((server as any).verbose).toBe(expected);
      }
    });
  });

  describe('start', () => {
    test('should set running flag to true', () => {
      // Mock receiveBuffer to throw immediately to avoid infinite loop
      mockSerialManager.receiveBuffer.mockRejectedValue(new Error('Timeout'));

      void server.start();
      expect((server as any).running).toBe(true);

      // Stop to clean up
      server.stop();
    });

    test('should be stoppable after starting', () => {
      mockSerialManager.receiveBuffer.mockRejectedValue(new Error('Timeout'));

      void server.start();
      expect((server as any).running).toBe(true);

      server.stop();
      expect((server as any).running).toBe(false);
    });
  });

  describe('dependency injection', () => {
    test('should use injected drive manager', () => {
      expect((server as any).driveManager).toBe(mockDriveManager);
    });

    test('should use injected serial manager', () => {
      expect((server as any).serialManager).toBe(mockSerialManager);
    });

    test('should use injected display manager', () => {
      expect((server as any).displayManager).toBe(mockDisplayManager);
    });
  });

  describe('configuration', () => {
    test('should respect verbose configuration', () => {
      const verboseConfig = createDefaultConfig();
      verboseConfig.verbose = true;

      const verboseServer = new FdcServer(
        mockDriveManager,
        mockSerialManager,
        mockDisplayManager,
        verboseConfig
      );

      expect((verboseServer as any).verbose).toBe(true);
    });

    test('should respect debug configuration', () => {
      const debugConfig = createDefaultConfig();
      debugConfig.debug = true;

      const debugServer = new FdcServer(
        mockDriveManager,
        mockSerialManager,
        mockDisplayManager,
        debugConfig
      );

      expect((debugServer as any).debug).toBe(true);
    });
  });
});

/*
 * Note: Integration tests for command handling (STAT, READ, WRIT) would require
 * more complex mocking of the async server loop. These are better tested as
 * integration tests with real or mock serial hardware.
 *
 * Command processing tests should cover:
 * - STAT command handling and drive status reporting
 * - READ command handling and track data transmission
 * - WRIT command handling and two-phase write protocol
 * - Error handling for invalid drives
 * - Verbose and debug output
 * - Checksum validation
 *
 * These tests are deferred to integration testing phase.
 */
