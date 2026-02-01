/**
 * Replay Engine Unit Tests
 *
 * Tests the server-side file replay engine that writes file bytes
 * to the serial port with backpressure and inter-line delays.
 */

// Mock fs/promises before any imports
jest.mock('fs/promises');
import * as fs from 'fs/promises';
const mockedFs = fs as jest.Mocked<typeof fs>;

// Mock transitive dependencies of terminal-serial.ts
jest.mock('serialport', () => ({ SerialPort: jest.fn() }));
jest.mock('../src/gpio', () => ({
  getGpioLedController: () => ({
    updateTerminalConnected: jest.fn(),
    updateTerminalRx: jest.fn(),
    updateTerminalTx: jest.fn(),
  }),
}));
jest.mock('../src/port-resolver', () => ({
  resolvePortPath: jest.fn(),
  validatePortPath: jest.fn(),
  listPortsWithPersistent: jest.fn(),
}));

import { ReplayEngine, ReplayProgress, convertLineEndings } from '../src/replay-engine';
import { TerminalSerialManager } from '../src/terminal-serial';

/**
 * Create a mock TerminalSerialManager with controllable write behavior.
 */
function createMockTerminalManager() {
  const writtenChunks: Buffer[] = [];
  const mockWrite = jest.fn(async (data: Buffer | string, _drain?: boolean) => {
    writtenChunks.push(Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data as string));
  });
  const mockIsOpen = jest.fn().mockReturnValue(true);
  const mockDrain = jest.fn(async () => true);

  const manager = {
    isOpen: mockIsOpen,
    write: mockWrite,
    drain: mockDrain,
    setDataInterceptor: jest.fn(),
    clearDataInterceptor: jest.fn(),
    getConfig: jest.fn().mockReturnValue({
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: 'none',
    }),
  } as unknown as TerminalSerialManager;

  return { manager, writtenChunks, mockWrite, mockIsOpen, mockDrain };
}

describe('ReplayEngine', () => {
  let engine: ReplayEngine;
  let mock: ReturnType<typeof createMockTerminalManager>;

  beforeEach(() => {
    mock = createMockTerminalManager();
    engine = new ReplayEngine(mock.manager);
    jest.clearAllMocks();
  });

  describe('initial state', () => {
    test('should not be running initially', () => {
      expect(engine.isRunning()).toBe(false);
    });

    test('should have no last progress initially', () => {
      expect(engine.getLastProgress()).toBeNull();
    });
  });

  describe('basic replay', () => {
    test('should send all bytes for a simple file with chunkSize=1', async () => {
      const content = Buffer.from('ABCDEF');
      mockedFs.readFile.mockResolvedValue(content);

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 1,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      const allWritten = Buffer.concat(mock.writtenChunks);
      expect(allWritten).toEqual(content);
    });

    test('should send all bytes with multi-byte chunks', async () => {
      const content = Buffer.from('ABCDEFGHIJ');
      mockedFs.readFile.mockResolvedValue(content);

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 4,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      const allWritten = Buffer.concat(mock.writtenChunks);
      expect(allWritten).toEqual(content);
    });

    test('should handle empty file', async () => {
      mockedFs.readFile.mockResolvedValue(Buffer.alloc(0));

      const progressEvents: ReplayProgress[] = [];
      engine.on('progress', (p: ReplayProgress) => progressEvents.push(p));

      await engine.replay({
        filePath: '/test/empty.txt',
        fileName: 'empty.txt',
      });

      expect(mock.mockWrite).not.toHaveBeenCalled();
      expect(progressEvents).toHaveLength(1);
      expect(progressEvents[0].state).toBe('completed');
      expect(progressEvents[0].bytesSent).toBe(0);
    });

    test('should handle single-byte file', async () => {
      mockedFs.readFile.mockResolvedValue(Buffer.from('X'));

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 1,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      expect(mock.writtenChunks).toHaveLength(1);
      expect(mock.writtenChunks[0]).toEqual(Buffer.from('X'));
    });
  });

  describe('newline boundary splitting', () => {
    test('should split chunk at LF boundary with chunkSize > 1', async () => {
      // "AB\nCD" with chunkSize=4 should split into "AB\n" and "CD"
      const content = Buffer.from('AB\nCD');
      mockedFs.readFile.mockResolvedValue(content);

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 4,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      expect(mock.writtenChunks[0]).toEqual(Buffer.from('AB\n'));
      expect(mock.writtenChunks[1]).toEqual(Buffer.from('CD'));
      expect(Buffer.concat(mock.writtenChunks)).toEqual(content);
    });

    test('should split chunk at CR boundary', async () => {
      const content = Buffer.from('AB\rCD');
      mockedFs.readFile.mockResolvedValue(content);

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 4,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      expect(mock.writtenChunks[0]).toEqual(Buffer.from('AB\r'));
      expect(mock.writtenChunks[1]).toEqual(Buffer.from('CD'));
    });

    test('should treat CRLF as single line ending with chunkSize > 1', async () => {
      // "AB\r\nCD" with chunkSize=4 should split as "AB\r\n" then "CD"
      const content = Buffer.from('AB\r\nCD');
      mockedFs.readFile.mockResolvedValue(content);

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 4,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      // CRLF kept together
      expect(mock.writtenChunks[0]).toEqual(Buffer.from('AB\r\n'));
      expect(mock.writtenChunks[1]).toEqual(Buffer.from('CD'));
    });

    test('should treat CRLF as single line ending with chunkSize=1', async () => {
      // With chunkSize=1, CRLF should be sent as a single 2-byte unit
      const content = Buffer.from('A\r\nB');
      mockedFs.readFile.mockResolvedValue(content);

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 1,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      expect(mock.writtenChunks[0]).toEqual(Buffer.from('A'));
      expect(mock.writtenChunks[1]).toEqual(Buffer.from('\r\n'));
      expect(mock.writtenChunks[2]).toEqual(Buffer.from('B'));
    });

    test('should handle multiple lines with large chunk size', async () => {
      const content = Buffer.from('line1\nline2\nline3');
      mockedFs.readFile.mockResolvedValue(content);

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 16,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      // Each line should be a separate write
      expect(mock.writtenChunks[0]).toEqual(Buffer.from('line1\n'));
      expect(mock.writtenChunks[1]).toEqual(Buffer.from('line2\n'));
      expect(mock.writtenChunks[2]).toEqual(Buffer.from('line3'));
    });

    test('should handle consecutive newlines', async () => {
      const content = Buffer.from('A\n\nB');
      mockedFs.readFile.mockResolvedValue(content);

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 8,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      expect(mock.writtenChunks[0]).toEqual(Buffer.from('A\n'));
      expect(mock.writtenChunks[1]).toEqual(Buffer.from('\n'));
      expect(mock.writtenChunks[2]).toEqual(Buffer.from('B'));
    });

    test('should handle file ending with newline', async () => {
      const content = Buffer.from('ABC\n');
      mockedFs.readFile.mockResolvedValue(content);

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 8,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      expect(mock.writtenChunks[0]).toEqual(Buffer.from('ABC\n'));
      expect(Buffer.concat(mock.writtenChunks)).toEqual(content);
    });

    test('should handle file ending with CRLF', async () => {
      const content = Buffer.from('ABC\r\n');
      mockedFs.readFile.mockResolvedValue(content);

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 8,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      expect(mock.writtenChunks[0]).toEqual(Buffer.from('ABC\r\n'));
    });

    test('should handle bare CR without following LF', async () => {
      // Old Mac-style line endings
      const content = Buffer.from('AB\rCD\rEF');
      mockedFs.readFile.mockResolvedValue(content);

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 8,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      expect(mock.writtenChunks[0]).toEqual(Buffer.from('AB\r'));
      expect(mock.writtenChunks[1]).toEqual(Buffer.from('CD\r'));
      expect(mock.writtenChunks[2]).toEqual(Buffer.from('EF'));
    });

    test('should not drop any bytes with mixed line endings', async () => {
      const content = Buffer.from('A\r\nB\nC\rD');
      mockedFs.readFile.mockResolvedValue(content);

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 16,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      const allWritten = Buffer.concat(mock.writtenChunks);
      expect(allWritten).toEqual(content);
      expect(allWritten.length).toBe(content.length);
    });

    test('should split long lines at chunkSize boundaries', async () => {
      // "ABCDEFGH\n" with chunkSize=4 should be "ABCD", "EFGH", "\n" ...
      // Wait: the newline scan is within the chunk range. Let me trace:
      // offset=0, end=4: scan 0-3, no newline → chunk="ABCD"
      // offset=4, end=8: scan 4-7, no newline → chunk="EFGH"
      // offset=8, end=9: scan 8, byte=\n → end=9 → chunk="\n"
      const content = Buffer.from('ABCDEFGH\n');
      mockedFs.readFile.mockResolvedValue(content);

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 4,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      expect(mock.writtenChunks[0]).toEqual(Buffer.from('ABCD'));
      expect(mock.writtenChunks[1]).toEqual(Buffer.from('EFGH'));
      expect(mock.writtenChunks[2]).toEqual(Buffer.from('\n'));
      expect(Buffer.concat(mock.writtenChunks)).toEqual(content);
    });

    test('should handle typical multi-line program listing', async () => {
      const content = Buffer.from(
        '10 PRINT "HELLO"\r\n' +
        '20 GOTO 10\r\n'
      );
      mockedFs.readFile.mockResolvedValue(content);

      await engine.replay({
        filePath: '/test/basic.txt',
        fileName: 'basic.txt',
        chunkSize: 8,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      // All bytes preserved
      const allWritten = Buffer.concat(mock.writtenChunks);
      expect(allWritten).toEqual(content);

      // Each chunk should end at or before a CRLF boundary
      for (const chunk of mock.writtenChunks) {
        const crIdx = chunk.indexOf(0x0D);
        const lfIdx = chunk.indexOf(0x0A);
        // If chunk has CR, it should be at the end (possibly followed by LF)
        if (crIdx >= 0) {
          expect(crIdx).toBe(chunk.length - 2); // CR followed by LF at end
          expect(lfIdx).toBe(chunk.length - 1);
        }
        // If chunk has LF without CR, it should be the last byte
        if (lfIdx >= 0 && crIdx < 0) {
          expect(lfIdx).toBe(chunk.length - 1);
        }
      }
    });
  });

  describe('chunk size handling', () => {
    test('should clamp chunk size to minimum of 1', async () => {
      const content = Buffer.from('AB');
      mockedFs.readFile.mockResolvedValue(content);

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 0,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      expect(mock.writtenChunks.length).toBe(2);
      expect(mock.writtenChunks[0]).toEqual(Buffer.from('A'));
      expect(mock.writtenChunks[1]).toEqual(Buffer.from('B'));
    });

    test('should clamp negative chunk size to 1', async () => {
      const content = Buffer.from('AB');
      mockedFs.readFile.mockResolvedValue(content);

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: -5,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      expect(mock.writtenChunks.length).toBe(2);
    });

    test('should clamp chunk size to maximum of 16', async () => {
      const content = Buffer.from('A'.repeat(20));
      mockedFs.readFile.mockResolvedValue(content);

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 100,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      expect(mock.writtenChunks[0].length).toBe(16);
      expect(mock.writtenChunks[1].length).toBe(4);
    });

    test('should default chunk size to 1 when not specified', async () => {
      const content = Buffer.from('ABC');
      mockedFs.readFile.mockResolvedValue(content);

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      expect(mock.writtenChunks.length).toBe(3);
    });

    test('should handle file smaller than chunk size', async () => {
      const content = Buffer.from('AB');
      mockedFs.readFile.mockResolvedValue(content);

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 16,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      expect(mock.writtenChunks.length).toBe(1);
      expect(mock.writtenChunks[0]).toEqual(Buffer.from('AB'));
    });
  });

  describe('progress events', () => {
    test('should emit completed event after successful replay', async () => {
      const content = Buffer.from('ABC');
      mockedFs.readFile.mockResolvedValue(content);

      const progressEvents: ReplayProgress[] = [];
      engine.on('progress', (p: ReplayProgress) => progressEvents.push(p));

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 1,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      const lastEvent = progressEvents[progressEvents.length - 1];
      expect(lastEvent.state).toBe('completed');
      expect(lastEvent.bytesSent).toBe(3);
      expect(lastEvent.totalBytes).toBe(3);
      expect(lastEvent.percentComplete).toBe(100);
      expect(lastEvent.fileName).toBe('file.txt');
    });

    test('should emit running events during replay', async () => {
      const content = Buffer.from('ABCDEF');
      mockedFs.readFile.mockResolvedValue(content);

      const progressEvents: ReplayProgress[] = [];
      engine.on('progress', (p: ReplayProgress) => progressEvents.push(p));

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 1,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      // Should have running events before the final completed event
      const runningEvents = progressEvents.filter(p => p.state === 'running');
      expect(runningEvents.length).toBeGreaterThan(0);

      // Completed should be the last event
      expect(progressEvents[progressEvents.length - 1].state).toBe('completed');
    });

    test('should update lastProgress on each event', async () => {
      const content = Buffer.from('A');
      mockedFs.readFile.mockResolvedValue(content);

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 1,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      const lastProgress = engine.getLastProgress();
      expect(lastProgress).not.toBeNull();
      expect(lastProgress!.state).toBe('completed');
    });
  });

  describe('cancellation', () => {
    test('should cancel replay when cancel() is called', async () => {
      const content = Buffer.from('A'.repeat(100));
      mockedFs.readFile.mockResolvedValue(content);

      const progressEvents: ReplayProgress[] = [];
      engine.on('progress', (p: ReplayProgress) => progressEvents.push(p));

      let writeCount = 0;
      mock.mockWrite.mockImplementation(async () => {
        writeCount++;
        if (writeCount >= 5) {
          engine.cancel();
        }
      });

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 1,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      const lastEvent = progressEvents[progressEvents.length - 1];
      expect(lastEvent.state).toBe('cancelled');
      expect(lastEvent.bytesSent).toBeLessThan(100);
    });

    test('should not be running after cancellation', async () => {
      const content = Buffer.from('A'.repeat(100));
      mockedFs.readFile.mockResolvedValue(content);

      let writeCount = 0;
      mock.mockWrite.mockImplementation(async () => {
        writeCount++;
        if (writeCount >= 2) {
          engine.cancel();
        }
      });

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 1,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      expect(engine.isRunning()).toBe(false);
    });

    test('should not throw when cancelling while not running', () => {
      engine.cancel();
      expect(engine.isRunning()).toBe(false);
    });
  });

  describe('error handling', () => {
    test('should throw when port is not open', async () => {
      mock.mockIsOpen.mockReturnValue(false);

      await expect(
        engine.replay({
          filePath: '/test/file.txt',
          fileName: 'file.txt',
        })
      ).rejects.toThrow('Terminal serial port is not open');
    });

    test('should throw when replay is already running', async () => {
      const content = Buffer.from('A'.repeat(1000));
      mockedFs.readFile.mockResolvedValue(content);

      // Make write slow so replay stays running
      mock.mockWrite.mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 50))
      );

      const replayPromise = engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 1,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      // Try to start another replay immediately
      await expect(
        engine.replay({
          filePath: '/test/file2.txt',
          fileName: 'file2.txt',
        })
      ).rejects.toThrow('Replay already in progress');

      // Clean up
      engine.cancel();
      await replayPromise;
    });

    test('should emit error progress on file read failure', async () => {
      mockedFs.readFile.mockRejectedValue(new Error('File not found'));

      const progressEvents: ReplayProgress[] = [];
      engine.on('progress', (p: ReplayProgress) => progressEvents.push(p));

      await expect(
        engine.replay({
          filePath: '/test/missing.txt',
          fileName: 'missing.txt',
        })
      ).rejects.toThrow('File not found');

      expect(progressEvents).toHaveLength(1);
      expect(progressEvents[0].state).toBe('error');
      expect(progressEvents[0].error).toBe('File not found');
    });

    test('should report actual bytesSent in error progress on write failure', async () => {
      const content = Buffer.from('ABCDEF');
      mockedFs.readFile.mockResolvedValue(content);

      let writeCount = 0;
      mock.mockWrite.mockImplementation(async () => {
        writeCount++;
        if (writeCount > 3) {
          throw new Error('Write failed');
        }
      });

      const progressEvents: ReplayProgress[] = [];
      engine.on('progress', (p: ReplayProgress) => progressEvents.push(p));

      await expect(
        engine.replay({
          filePath: '/test/file.txt',
          fileName: 'file.txt',
          chunkSize: 1,
          interByteDelayMs: 0,
          interLineDelayMs: 0,
        })
      ).rejects.toThrow('Write failed');

      const errorEvent = progressEvents.find(p => p.state === 'error');
      expect(errorEvent).toBeDefined();
      // 3 successful writes of 1 byte each
      expect(errorEvent!.bytesSent).toBe(3);
      expect(errorEvent!.totalBytes).toBe(6);
    });

    test('should reset running state after error', async () => {
      mockedFs.readFile.mockRejectedValue(new Error('Read error'));

      try {
        await engine.replay({
          filePath: '/test/file.txt',
          fileName: 'file.txt',
        });
      } catch {
        // expected
      }

      expect(engine.isRunning()).toBe(false);
    });
  });

  describe('binary data integrity', () => {
    test('should handle all byte values 0x00-0xFF', async () => {
      const content = Buffer.alloc(256);
      for (let i = 0; i < 256; i++) {
        content[i] = i;
      }
      mockedFs.readFile.mockResolvedValue(content);

      await engine.replay({
        filePath: '/test/binary.bin',
        fileName: 'binary.bin',
        chunkSize: 16,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      const allWritten = Buffer.concat(mock.writtenChunks);
      expect(allWritten).toEqual(content);
      expect(allWritten.length).toBe(256);
    });

    test('should preserve byte sequence with embedded CR, LF, CRLF', async () => {
      const content = Buffer.from([
        0x00, 0x01, 0x0D, 0x0A, // data then CRLF
        0xFF, 0x0A,              // data then LF
        0x0D, 0x42,              // bare CR then data
        0x0D, 0x0A,              // trailing CRLF
      ]);
      mockedFs.readFile.mockResolvedValue(content);

      await engine.replay({
        filePath: '/test/binary.bin',
        fileName: 'binary.bin',
        chunkSize: 8,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      const allWritten = Buffer.concat(mock.writtenChunks);
      expect(allWritten).toEqual(content);
    });
  });

  describe('delay behavior', () => {
    test('should not apply inter-line delay for non-newline chunks', async () => {
      const content = Buffer.from('ABCD');
      mockedFs.readFile.mockResolvedValue(content);

      const start = Date.now();
      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 4,
        interByteDelayMs: 0,
        interLineDelayMs: 200,  // Non-zero but shouldn't trigger
      });
      const elapsed = Date.now() - start;

      // No newlines → no inter-line delays
      expect(elapsed).toBeLessThan(100);
    });

    test('should default interLineDelayMs to 200 when not specified', async () => {
      const content = Buffer.from('A\nB');
      mockedFs.readFile.mockResolvedValue(content);

      const start = Date.now();
      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 1,
        interByteDelayMs: 0,
        // interLineDelayMs not set → defaults to 200
      });
      const elapsed = Date.now() - start;

      // Should have at least ~200ms delay for the newline
      expect(elapsed).toBeGreaterThanOrEqual(150);
    });

    test('should apply inter-line delay only once for CRLF with chunkSize=1', async () => {
      // This verifies the fix: CRLF should trigger ONE delay, not two
      const content = Buffer.from('A\r\nB');
      mockedFs.readFile.mockResolvedValue(content);

      const start = Date.now();
      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 1,
        interByteDelayMs: 0,
        interLineDelayMs: 200,
      });
      const elapsed = Date.now() - start;

      // Should be ~200ms (one delay), not ~400ms (double delay)
      expect(elapsed).toBeGreaterThanOrEqual(150);
      expect(elapsed).toBeLessThan(350);
    });
  });

  describe('line ending conversion', () => {
    describe('convertLineEndings utility', () => {
      test('raw mode returns buffer unchanged', () => {
        const buf = Buffer.from('A\nB\r\nC\rD');
        const result = convertLineEndings(buf, 'raw');
        expect(result).toBe(buf); // same reference
      });

      test('converts LF to CR', () => {
        const buf = Buffer.from('line1\nline2\nline3');
        const result = convertLineEndings(buf, 'cr');
        expect(result).toEqual(Buffer.from('line1\rline2\rline3'));
      });

      test('converts CRLF to CR', () => {
        const buf = Buffer.from('line1\r\nline2\r\n');
        const result = convertLineEndings(buf, 'cr');
        expect(result).toEqual(Buffer.from('line1\rline2\r'));
      });

      test('converts CR to LF', () => {
        const buf = Buffer.from('line1\rline2\r');
        const result = convertLineEndings(buf, 'lf');
        expect(result).toEqual(Buffer.from('line1\nline2\n'));
      });

      test('converts LF to CRLF', () => {
        const buf = Buffer.from('line1\nline2\n');
        const result = convertLineEndings(buf, 'crlf');
        expect(result).toEqual(Buffer.from('line1\r\nline2\r\n'));
      });

      test('handles mixed line endings (LF, CRLF, bare CR) converting to CR', () => {
        const buf = Buffer.from('A\nB\r\nC\rD');
        const result = convertLineEndings(buf, 'cr');
        expect(result).toEqual(Buffer.from('A\rB\rC\rD'));
      });

      test('handles consecutive newlines', () => {
        const buf = Buffer.from('A\n\nB');
        const result = convertLineEndings(buf, 'cr');
        expect(result).toEqual(Buffer.from('A\r\rB'));
      });

      test('handles empty buffer', () => {
        const buf = Buffer.alloc(0);
        const result = convertLineEndings(buf, 'cr');
        expect(result).toEqual(Buffer.alloc(0));
      });

      test('handles buffer with no line endings', () => {
        const buf = Buffer.from('ABCDEF');
        const result = convertLineEndings(buf, 'cr');
        expect(result).toEqual(Buffer.from('ABCDEF'));
      });

      test('handles buffer that is only newlines', () => {
        const buf = Buffer.from('\n\r\n\r');
        const result = convertLineEndings(buf, 'cr');
        expect(result).toEqual(Buffer.from('\r\r\r'));
      });

      test('preserves non-newline bytes exactly', () => {
        const buf = Buffer.from([0x00, 0x0A, 0xFF, 0x0D, 0x0A, 0x42]);
        const result = convertLineEndings(buf, 'cr');
        expect(result).toEqual(Buffer.from([0x00, 0x0D, 0xFF, 0x0D, 0x42]));
      });
    });

    describe('replay with lineEnding option', () => {
      test('should convert LF to CR when lineEnding=cr', async () => {
        const content = Buffer.from('10 PRINT\n20 GOTO 10\n');
        mockedFs.readFile.mockResolvedValue(content);

        await engine.replay({
          filePath: '/test/basic.txt',
          fileName: 'basic.txt',
          chunkSize: 16,
          interByteDelayMs: 0,
          interLineDelayMs: 0,
          lineEnding: 'cr',
        });

        const allWritten = Buffer.concat(mock.writtenChunks);
        expect(allWritten).toEqual(Buffer.from('10 PRINT\r20 GOTO 10\r'));
      });

      test('should send bytes as-is when lineEnding=raw', async () => {
        const content = Buffer.from('A\nB\r\nC');
        mockedFs.readFile.mockResolvedValue(content);

        await engine.replay({
          filePath: '/test/file.txt',
          fileName: 'file.txt',
          chunkSize: 16,
          interByteDelayMs: 0,
          interLineDelayMs: 0,
          lineEnding: 'raw',
        });

        const allWritten = Buffer.concat(mock.writtenChunks);
        expect(allWritten).toEqual(content);
      });

      test('should default to raw when lineEnding not specified', async () => {
        const content = Buffer.from('A\nB');
        mockedFs.readFile.mockResolvedValue(content);

        await engine.replay({
          filePath: '/test/file.txt',
          fileName: 'file.txt',
          chunkSize: 16,
          interByteDelayMs: 0,
          interLineDelayMs: 0,
        });

        const allWritten = Buffer.concat(mock.writtenChunks);
        expect(allWritten).toEqual(content); // LF preserved
      });

      test('should report converted size in progress events', async () => {
        // CRLF→CR reduces file size: "AB\r\n" (4 bytes) → "AB\r" (3 bytes)
        const content = Buffer.from('AB\r\n');
        mockedFs.readFile.mockResolvedValue(content);

        const progressEvents: ReplayProgress[] = [];
        engine.on('progress', (p: ReplayProgress) => progressEvents.push(p));

        await engine.replay({
          filePath: '/test/file.txt',
          fileName: 'file.txt',
          chunkSize: 16,
          interByteDelayMs: 0,
          interLineDelayMs: 0,
          lineEnding: 'cr',
        });

        const lastEvent = progressEvents[progressEvents.length - 1];
        expect(lastEvent.state).toBe('completed');
        expect(lastEvent.totalBytes).toBe(3); // converted size
        expect(lastEvent.bytesSent).toBe(3);
      });
    });
  });

  describe('drain behavior', () => {
    test('should call drain at line boundaries', async () => {
      const content = Buffer.from('AB\nCD\n');
      mockedFs.readFile.mockResolvedValue(content);

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 8,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      // Two newlines → two drain calls
      expect(mock.mockDrain).toHaveBeenCalledTimes(2);
    });

    test('should not call drain for chunks without newlines', async () => {
      const content = Buffer.from('ABCDEF');
      mockedFs.readFile.mockResolvedValue(content);

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 8,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      expect(mock.mockDrain).not.toHaveBeenCalled();
    });

    test('should call drain with timeout based on interLineDelayMs', async () => {
      const content = Buffer.from('A\nB');
      mockedFs.readFile.mockResolvedValue(content);

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 8,
        interByteDelayMs: 0,
        interLineDelayMs: 500,
      });

      // drain timeout should be max(interLineDelayMs, 100) = 500
      expect(mock.mockDrain).toHaveBeenCalledWith(500);
    });

    test('should use minimum drain timeout of 100ms', async () => {
      const content = Buffer.from('A\nB');
      mockedFs.readFile.mockResolvedValue(content);

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 8,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      // drain timeout should be max(0, 100) = 100
      expect(mock.mockDrain).toHaveBeenCalledWith(100);
    });

    test('should continue replay even if drain returns false (timeout)', async () => {
      const content = Buffer.from('A\nB\nC');
      mockedFs.readFile.mockResolvedValue(content);

      // Simulate drain timeout
      mock.mockDrain.mockResolvedValue(false);

      const progressEvents: ReplayProgress[] = [];
      engine.on('progress', (p: ReplayProgress) => progressEvents.push(p));

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 8,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      // Should complete despite drain timeouts
      const lastEvent = progressEvents[progressEvents.length - 1];
      expect(lastEvent.state).toBe('completed');
      expect(lastEvent.bytesSent).toBe(content.length);
    });

    test('should write without drain (drain=false) for all chunks', async () => {
      const content = Buffer.from('AB\nCD');
      mockedFs.readFile.mockResolvedValue(content);

      await engine.replay({
        filePath: '/test/file.txt',
        fileName: 'file.txt',
        chunkSize: 8,
        interByteDelayMs: 0,
        interLineDelayMs: 0,
      });

      // All write calls should pass drain=false
      for (const call of mock.mockWrite.mock.calls) {
        expect(call[1]).toBe(false);
      }
    });
  });
});
