/**
 * FDC Server Unit Tests
 *
 * Note: Full server loop tests are complex due to async nature.
 * These tests focus on initialization and basic functionality.
 * Integration tests with mock serial hardware would be needed for full coverage.
 */

import { FdcServer } from '../src/server';
import { DriveManager } from '../src/drive';
import { IFdcTransport } from '../src/transport';
import {
  CommandResponseBlock,
  createDefaultConfig,
} from '../src/protocol';

// Mock drive manager
jest.mock('../src/drive');

function makeMockTransport(): jest.Mocked<IFdcTransport> {
  return {
    receiveBuffer: jest.fn(),
    sendBuffer: jest.fn().mockResolvedValue(undefined),
    isOpen: jest.fn().mockReturnValue(true),
  };
}

describe('FdcServer', () => {
  let server: FdcServer;
  let mockDriveManager: jest.Mocked<DriveManager>;
  let mockTransport: jest.Mocked<IFdcTransport>;
  let config: any;

  beforeEach(() => {
    // Create mock instances
    mockDriveManager = new DriveManager() as jest.Mocked<DriveManager>;
    mockTransport = makeMockTransport();

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
    mockDriveManager.isInSwapWindow = jest.fn().mockReturnValue(false);
    mockDriveManager.readTrack = jest.fn().mockResolvedValue(Buffer.alloc(4384));
    mockDriveManager.writeTrack = jest.fn().mockResolvedValue(4384);

    config = createDefaultConfig();
    config.verbose = false;
    config.debug = false;

    server = new FdcServer(
      mockDriveManager,
      mockTransport,
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
        mockTransport,
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
        mockTransport,
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
      mockTransport.receiveBuffer.mockRejectedValue(new Error('Timeout'));

      void server.start();
      expect((server as any).running).toBe(true);

      // Stop to clean up
      server.stop();
    });

    test('should be stoppable after starting', () => {
      mockTransport.receiveBuffer.mockRejectedValue(new Error('Timeout'));

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

    test('should use injected transport', () => {
      expect((server as any).transport).toBe(mockTransport);
    });
  });

  describe('STAT bitmap', () => {
    // The FDC+ firmware uses transitions in this bitmap as its only signal to
    // invalidate its per-drive/per-track cache; drives inside a swap window
    // must be reported not-ready even though they are technically mounted.

    async function invokeStat(driveNo: number): Promise<number> {
      const cmd = new CommandResponseBlock('STAT', driveNo & 0xff, 0);
      await (server as any).handleStatCommand(cmd);
      // handleStatCommand mutates cmd.param2 with the ready bitmap.
      return cmd.param2;
    }

    test('reports mounted drive as ready when not in swap window', async () => {
      mockDriveManager.isMounted = jest
        .fn()
        .mockImplementation((d: number) => d === 0);
      mockDriveManager.isInSwapWindow = jest.fn().mockReturnValue(false);

      const bitmap = await invokeStat(0);

      expect(bitmap & 0b1).toBe(0b1);
    });

    test('omits mounted drive from bitmap while its swap window is active', async () => {
      mockDriveManager.isMounted = jest
        .fn()
        .mockImplementation((d: number) => d === 0 || d === 2);
      mockDriveManager.isInSwapWindow = jest
        .fn()
        .mockImplementation((d: number) => d === 0);

      const bitmap = await invokeStat(0);

      // Drive 0: mounted but in swap window → bit must be 0.
      expect(bitmap & 0b1).toBe(0);
      // Drive 2: mounted, no swap window → bit must be 1.
      expect(bitmap & 0b100).toBe(0b100);
    });

    test('restores drive to ready bitmap after swap window elapses', async () => {
      let inWindow = true;
      mockDriveManager.isMounted = jest
        .fn()
        .mockImplementation((d: number) => d === 0);
      mockDriveManager.isInSwapWindow = jest
        .fn()
        .mockImplementation((d: number) => d === 0 && inWindow);

      expect((await invokeStat(0)) & 0b1).toBe(0);
      inWindow = false;
      expect((await invokeStat(0)) & 0b1).toBe(0b1);
    });
  });

  describe('configuration', () => {
    test('should respect verbose configuration', () => {
      const verboseConfig = createDefaultConfig();
      verboseConfig.verbose = true;

      const verboseServer = new FdcServer(
        mockDriveManager,
        mockTransport,
        verboseConfig
      );

      expect((verboseServer as any).verbose).toBe(true);
    });

    test('should respect debug configuration', () => {
      const debugConfig = createDefaultConfig();
      debugConfig.debug = true;

      const debugServer = new FdcServer(
        mockDriveManager,
        mockTransport,
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
