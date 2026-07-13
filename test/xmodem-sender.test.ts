/**
 * XMODEM Sender Unit Tests
 *
 * Tests CRC-16/XMODEM, checksum, packet building, and full protocol flow
 * for the XMODEM send-only implementation.
 */

// Mock fs/promises FIRST, before any imports (must be top-level)
jest.mock('fs/promises');
import * as fs from 'fs/promises';
const mockedFs = fs as jest.Mocked<typeof fs>;

// Mock transitive dependencies of terminal-serial.ts
jest.mock('serialport', () => ({ SerialPort: jest.fn() }));
jest.mock('../src/port-resolver', () => ({
  resolvePortPath: jest.fn(),
  validatePortPath: jest.fn(),
  listPortsWithPersistent: jest.fn(),
}));

import { crc16xmodem, checksumXmodem, XmodemSender } from '../src/xmodem-sender';
import { TerminalSerialManager } from '../src/terminal-serial';
import { ReplayProgress } from '../src/replay-engine';

// XMODEM protocol constants (must match source)
const SOH = 0x01;
const EOT = 0x04;
const ACK = 0x06;
const NAK = 0x15;
const CAN = 0x18;
const C_BYTE = 0x43;
const SUB = 0x1A;
const BLOCK_SIZE = 128;

/**
 * Create a mock TerminalSerialManager that captures the data interceptor,
 * allowing tests to simulate receiver responses.
 */
function createMockTerminalManager() {
  const writtenData: Buffer[] = [];
  let dataInterceptor: ((data: Buffer) => void) | null = null;

  const mockWrite = jest.fn(async (data: Buffer | string) => {
    writtenData.push(Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data as string));
  });
  const mockIsOpen = jest.fn().mockReturnValue(true);
  const mockSetDataInterceptor = jest.fn((cb: (data: Buffer) => void) => {
    dataInterceptor = cb;
  });
  const mockClearDataInterceptor = jest.fn(() => {
    dataInterceptor = null;
  });

  const manager = {
    isOpen: mockIsOpen,
    write: mockWrite,
    setDataInterceptor: mockSetDataInterceptor,
    clearDataInterceptor: mockClearDataInterceptor,
  } as unknown as TerminalSerialManager;

  /** Simulate receiver sending a byte through the serial port */
  const simulateReceive = (byte: number) => {
    if (dataInterceptor) {
      dataInterceptor(Buffer.from([byte]));
    }
  };

  return {
    manager,
    writtenData,
    mockWrite,
    mockIsOpen,
    mockSetDataInterceptor,
    mockClearDataInterceptor,
    simulateReceive,
  };
}

/** Flush pending microtasks by yielding to the event loop */
function flush(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe('crc16xmodem', () => {
  test('should return 0 for empty buffer', () => {
    expect(crc16xmodem(Buffer.alloc(0))).toBe(0x0000);
  });

  test('should compute correct CRC for standard test vector "123456789"', () => {
    // This is the canonical CRC-16/XMODEM test: "123456789" → 0x31C3
    const data = Buffer.from('123456789');
    expect(crc16xmodem(data)).toBe(0x31C3);
  });

  test('should return value in 16-bit range', () => {
    const data = Buffer.from([0x01]);
    const crc = crc16xmodem(data);
    expect(crc).toBeGreaterThanOrEqual(0);
    expect(crc).toBeLessThanOrEqual(0xFFFF);
  });

  test('should produce different CRCs for different data', () => {
    const crc1 = crc16xmodem(Buffer.from('hello'));
    const crc2 = crc16xmodem(Buffer.from('world'));
    expect(crc1).not.toBe(crc2);
  });

  test('should produce consistent results', () => {
    const data = Buffer.from('test data for crc');
    expect(crc16xmodem(data)).toBe(crc16xmodem(data));
  });

  test('should handle 128-byte block (XMODEM block size)', () => {
    const block = Buffer.alloc(128, 0x41); // All 'A'
    const crc = crc16xmodem(block);
    expect(crc).toBeGreaterThanOrEqual(0);
    expect(crc).toBeLessThanOrEqual(0xFFFF);
  });

  test('should handle all-zero 128-byte block', () => {
    const block = Buffer.alloc(128, 0x00);
    const crc = crc16xmodem(block);
    expect(crc).toBe(0x0000);
  });

  test('should handle all-0xFF 128-byte block', () => {
    const block = Buffer.alloc(128, 0xFF);
    const crc = crc16xmodem(block);
    expect(crc).toBeGreaterThanOrEqual(0);
    expect(crc).toBeLessThanOrEqual(0xFFFF);
    // Should not be zero (very unlikely for non-trivial data)
    expect(crc).not.toBe(0);
  });

  test('should handle single byte 0x00', () => {
    // CRC starts at 0, XOR 0<<8 = 0, 8 iterations all give 0
    expect(crc16xmodem(Buffer.from([0x00]))).toBe(0x0000);
  });

  test('should handle SUB padding byte (0x1A)', () => {
    // SUB is the XMODEM padding character for the last block
    const data = Buffer.alloc(128, 0x1A);
    const crc = crc16xmodem(data);
    expect(typeof crc).toBe('number');
  });
});

describe('checksumXmodem', () => {
  test('should return 0 for empty buffer', () => {
    expect(checksumXmodem(Buffer.alloc(0))).toBe(0);
  });

  test('should sum bytes correctly', () => {
    expect(checksumXmodem(Buffer.from([1, 2, 3]))).toBe(6);
  });

  test('should wrap at 256 (mod 256)', () => {
    expect(checksumXmodem(Buffer.from([255, 1]))).toBe(0);
    expect(checksumXmodem(Buffer.from([255, 2]))).toBe(1);
  });

  test('should compute correct checksum for larger values', () => {
    // 200 + 200 = 400; 400 & 0xFF = 144
    expect(checksumXmodem(Buffer.from([200, 200]))).toBe(144);
  });

  test('should return 0 for all-zero buffer', () => {
    expect(checksumXmodem(Buffer.alloc(128, 0))).toBe(0);
  });

  test('should handle all-0xFF buffer', () => {
    // 128 * 255 = 32640; 32640 % 256 = 128
    expect(checksumXmodem(Buffer.alloc(128, 0xFF))).toBe(128);
  });

  test('should handle sequential bytes 0-127', () => {
    const block = Buffer.alloc(128);
    for (let i = 0; i < 128; i++) {
      block[i] = i;
    }
    // Sum of 0..127 = 8128; 8128 % 256 = 192
    expect(checksumXmodem(block)).toBe(192);
  });

  test('should produce consistent results', () => {
    const data = Buffer.from([10, 20, 30, 40, 50]);
    expect(checksumXmodem(data)).toBe(checksumXmodem(data));
  });

  test('should handle single byte', () => {
    expect(checksumXmodem(Buffer.from([42]))).toBe(42);
    expect(checksumXmodem(Buffer.from([255]))).toBe(255);
    expect(checksumXmodem(Buffer.from([0]))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// XmodemSender protocol tests
// ---------------------------------------------------------------------------

describe('XmodemSender', () => {
  let sender: XmodemSender;
  let mock: ReturnType<typeof createMockTerminalManager>;

  beforeEach(() => {
    mock = createMockTerminalManager();
    sender = new XmodemSender(mock.manager);
    jest.clearAllMocks();
  });

  /** Configure mockWrite to auto-respond with ACK for block and EOT packets */
  function autoAck() {
    mock.mockWrite.mockImplementation(async (data) => {
      const buf = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data as string);
      mock.writtenData.push(buf);
      if (buf[0] === SOH || buf[0] === EOT) {
        setImmediate(() => mock.simulateReceive(ACK));
      }
    });
  }

  describe('initial state', () => {
    test('should not be running initially', () => {
      expect(sender.isRunning()).toBe(false);
    });

    test('should have no last progress initially', () => {
      expect(sender.getLastProgress()).toBeNull();
    });
  });

  describe('error handling', () => {
    test('should throw when port is not open', async () => {
      mock.mockIsOpen.mockReturnValue(false);
      await expect(
        sender.send({ filePath: '/test/file.bin', fileName: 'file.bin' })
      ).rejects.toThrow('Terminal serial port is not open');
    });

    test('should throw when transfer is already running', async () => {
      mockedFs.readFile.mockResolvedValue(Buffer.from('test data'));

      // Start send — will hang waiting for receiver initiation
      const sendPromise = sender.send({ filePath: '/test/file.bin', fileName: 'file.bin' });
      await flush();

      await expect(
        sender.send({ filePath: '/test/file2.bin', fileName: 'file2.bin' })
      ).rejects.toThrow('XMODEM transfer already in progress');

      sender.cancel();
      try { await sendPromise; } catch { /* expected */ }
    });

    test('should not throw when cancelling while not running', () => {
      sender.cancel();
      expect(sender.isRunning()).toBe(false);
    });

    test('should emit error progress on file read failure', async () => {
      mockedFs.readFile.mockRejectedValue(new Error('File not found'));

      const events: ReplayProgress[] = [];
      sender.on('progress', (p: ReplayProgress) => events.push(p));

      await expect(
        sender.send({ filePath: '/test/missing.bin', fileName: 'missing.bin' })
      ).rejects.toThrow('File not found');

      expect(events).toHaveLength(1);
      expect(events[0].state).toBe('error');
      expect(events[0].error).toBe('File not found');
    });

    test('should reset running state after error', async () => {
      mockedFs.readFile.mockRejectedValue(new Error('Read error'));
      try {
        await sender.send({ filePath: '/test/file.bin', fileName: 'file.bin' });
      } catch { /* expected */ }
      expect(sender.isRunning()).toBe(false);
    });
  });

  describe('data interceptor lifecycle', () => {
    test('should set data interceptor when send starts', async () => {
      mockedFs.readFile.mockResolvedValue(Buffer.from('test'));

      const sendPromise = sender.send({ filePath: '/test/file.bin', fileName: 'file.bin' });
      await flush();

      expect(mock.mockSetDataInterceptor).toHaveBeenCalled();

      sender.cancel();
      try { await sendPromise; } catch { /* expected */ }
    });

    test('should clear data interceptor when send completes', async () => {
      mockedFs.readFile.mockResolvedValue(Buffer.alloc(0)); // empty file completes immediately
      await sender.send({ filePath: '/test/empty.bin', fileName: 'empty.bin' });
      expect(mock.mockClearDataInterceptor).toHaveBeenCalled();
    });

    test('should clear data interceptor on error', async () => {
      mockedFs.readFile.mockRejectedValue(new Error('fail'));
      try { await sender.send({ filePath: '/test/bad.bin', fileName: 'bad.bin' }); } catch { /* expected */ }
      expect(mock.mockClearDataInterceptor).toHaveBeenCalled();
    });

    test('should clear data interceptor when cancelled', async () => {
      mockedFs.readFile.mockResolvedValue(Buffer.from('data'));

      const sendPromise = sender.send({ filePath: '/test/file.bin', fileName: 'file.bin' });
      await flush();
      sender.cancel();
      await sendPromise;

      expect(mock.mockClearDataInterceptor).toHaveBeenCalled();
    });
  });

  describe('empty file', () => {
    test('should complete immediately for empty file', async () => {
      mockedFs.readFile.mockResolvedValue(Buffer.alloc(0));

      const events: ReplayProgress[] = [];
      sender.on('progress', (p: ReplayProgress) => events.push(p));

      await sender.send({ filePath: '/test/empty.bin', fileName: 'empty.bin' });

      expect(events).toHaveLength(1);
      expect(events[0].state).toBe('completed');
      expect(events[0].bytesSent).toBe(0);
      expect(events[0].totalBytes).toBe(0);
      expect(events[0].percentComplete).toBe(100);
    });

    test('should not write anything for empty file', async () => {
      mockedFs.readFile.mockResolvedValue(Buffer.alloc(0));
      await sender.send({ filePath: '/test/empty.bin', fileName: 'empty.bin' });
      expect(mock.mockWrite).not.toHaveBeenCalled();
    });
  });

  describe('checksum mode transfer', () => {
    test('should complete single-block transfer with NAK initiation', async () => {
      const fileData = Buffer.from('Hello, XMODEM!'); // 14 bytes = 1 block
      mockedFs.readFile.mockResolvedValue(fileData);
      autoAck();

      const sendPromise = sender.send({ filePath: '/test/file.bin', fileName: 'file.bin' });
      await flush();
      mock.simulateReceive(NAK); // start checksum mode
      await sendPromise;

      const last = sender.getLastProgress()!;
      expect(last.state).toBe('completed');
      expect(last.bytesSent).toBe(14);
      expect(last.totalBytes).toBe(14);
      expect(last.percentComplete).toBe(100);
      expect(sender.isRunning()).toBe(false);
    });

    test('should build correct checksum-mode packet', async () => {
      const fileData = Buffer.from('A'.repeat(BLOCK_SIZE)); // exactly one full block
      mockedFs.readFile.mockResolvedValue(fileData);
      autoAck();

      const sendPromise = sender.send({ filePath: '/test/file.bin', fileName: 'file.bin' });
      await flush();
      mock.simulateReceive(NAK);
      await sendPromise;

      const packet = mock.writtenData[0];
      expect(packet[0]).toBe(SOH);                            // header
      expect(packet[1]).toBe(1);                               // block number
      expect(packet[2]).toBe(254);                             // complement (255 - 1)
      expect(packet.length).toBe(3 + BLOCK_SIZE + 1);         // SOH + blk + compl + data + checksum

      const dataBlock = packet.subarray(3, 3 + BLOCK_SIZE);
      expect(dataBlock).toEqual(fileData);

      const expectedChecksum = checksumXmodem(dataBlock);
      expect(packet[3 + BLOCK_SIZE]).toBe(expectedChecksum);

      // Second write should be EOT
      expect(mock.writtenData[1][0]).toBe(EOT);
    });

    test('should pad last block with SUB (0x1A)', async () => {
      const fileData = Buffer.from('Short'); // 5 bytes
      mockedFs.readFile.mockResolvedValue(fileData);
      autoAck();

      const sendPromise = sender.send({ filePath: '/test/file.bin', fileName: 'file.bin' });
      await flush();
      mock.simulateReceive(NAK);
      await sendPromise;

      const packet = mock.writtenData[0];
      const dataBlock = packet.subarray(3, 3 + BLOCK_SIZE);

      // First 5 bytes should be file data
      expect(dataBlock.subarray(0, 5)).toEqual(Buffer.from('Short'));
      // Remaining bytes should be SUB padding
      for (let i = 5; i < BLOCK_SIZE; i++) {
        expect(dataBlock[i]).toBe(SUB);
      }
    });

    test('should handle multi-block transfer', async () => {
      // 200 bytes = 2 blocks (128 + 72)
      const fileData = Buffer.alloc(200);
      for (let i = 0; i < 200; i++) fileData[i] = i & 0xFF;
      mockedFs.readFile.mockResolvedValue(fileData);
      autoAck();

      const sendPromise = sender.send({ filePath: '/test/file.bin', fileName: 'file.bin' });
      await flush();
      mock.simulateReceive(NAK);
      await sendPromise;

      // 2 block packets + 1 EOT
      expect(mock.writtenData).toHaveLength(3);
      expect(mock.writtenData[0][0]).toBe(SOH);
      expect(mock.writtenData[0][1]).toBe(1); // block 1
      expect(mock.writtenData[1][0]).toBe(SOH);
      expect(mock.writtenData[1][1]).toBe(2); // block 2
      expect(mock.writtenData[2][0]).toBe(EOT);

      expect(sender.getLastProgress()!.state).toBe('completed');
    });

    test('should handle exact block-boundary file size', async () => {
      const fileData = Buffer.alloc(BLOCK_SIZE * 2, 0x42); // exactly 256 bytes = 2 full blocks
      mockedFs.readFile.mockResolvedValue(fileData);
      autoAck();

      const sendPromise = sender.send({ filePath: '/test/file.bin', fileName: 'file.bin' });
      await flush();
      mock.simulateReceive(NAK);
      await sendPromise;

      const blockPackets = mock.writtenData.filter(b => b[0] === SOH);
      expect(blockPackets).toHaveLength(2);

      // Neither block should need SUB padding
      for (const pkt of blockPackets) {
        const dataBlock = pkt.subarray(3, 3 + BLOCK_SIZE);
        expect(dataBlock.indexOf(SUB)).toBe(-1);
      }

      expect(sender.getLastProgress()!.state).toBe('completed');
    });
  });

  describe('CRC mode transfer', () => {
    test('should complete transfer in CRC mode with C initiation', async () => {
      const fileData = Buffer.from('CRC mode test');
      mockedFs.readFile.mockResolvedValue(fileData);
      autoAck();

      const sendPromise = sender.send({ filePath: '/test/file.bin', fileName: 'file.bin', useCrc: true });
      await flush();
      mock.simulateReceive(C_BYTE); // receiver requests CRC mode
      await sendPromise;

      expect(sender.getLastProgress()!.state).toBe('completed');
    });

    test('should build correct CRC-mode packet with 2-byte CRC', async () => {
      const fileData = Buffer.from('A'.repeat(BLOCK_SIZE));
      mockedFs.readFile.mockResolvedValue(fileData);
      autoAck();

      const sendPromise = sender.send({ filePath: '/test/file.bin', fileName: 'file.bin', useCrc: true });
      await flush();
      mock.simulateReceive(C_BYTE);
      await sendPromise;

      const packet = mock.writtenData[0];
      expect(packet[0]).toBe(SOH);
      expect(packet[1]).toBe(1);
      expect(packet[2]).toBe(254);
      expect(packet.length).toBe(3 + BLOCK_SIZE + 2); // 2-byte CRC instead of 1-byte checksum

      const dataBlock = packet.subarray(3, 3 + BLOCK_SIZE);
      const expectedCrc = crc16xmodem(dataBlock);
      const actualCrc = (packet[3 + BLOCK_SIZE] << 8) | packet[3 + BLOCK_SIZE + 1];
      expect(actualCrc).toBe(expectedCrc);
    });

    test('should use checksum mode when receiver sends C but useCrc is false', async () => {
      const fileData = Buffer.from('A'.repeat(BLOCK_SIZE));
      mockedFs.readFile.mockResolvedValue(fileData);
      autoAck();

      const sendPromise = sender.send({
        filePath: '/test/file.bin', fileName: 'file.bin', useCrc: false,
      });
      await flush();
      mock.simulateReceive(C_BYTE); // receiver wants CRC, but sender has useCrc=false
      await sendPromise;

      // Should use checksum mode (1-byte check, not 2-byte CRC)
      const packet = mock.writtenData[0];
      expect(packet.length).toBe(3 + BLOCK_SIZE + 1);
    });

    test('should default to CRC mode when useCrc is not specified and receiver sends C', async () => {
      const fileData = Buffer.from('test');
      mockedFs.readFile.mockResolvedValue(fileData);
      autoAck();

      const sendPromise = sender.send({ filePath: '/test/file.bin', fileName: 'file.bin' });
      await flush();
      mock.simulateReceive(C_BYTE);
      await sendPromise;

      // useCrc defaults to true, so CRC mode packet (2-byte CRC)
      const packet = mock.writtenData[0];
      expect(packet.length).toBe(3 + BLOCK_SIZE + 2);
    });

    test('should use checksum mode when receiver sends NAK regardless of useCrc', async () => {
      const fileData = Buffer.from('test');
      mockedFs.readFile.mockResolvedValue(fileData);
      autoAck();

      const sendPromise = sender.send({ filePath: '/test/file.bin', fileName: 'file.bin', useCrc: true });
      await flush();
      mock.simulateReceive(NAK); // receiver only supports checksum
      await sendPromise;

      // NAK initiation always means checksum mode
      const packet = mock.writtenData[0];
      expect(packet.length).toBe(3 + BLOCK_SIZE + 1);
    });
  });

  describe('receiver cancellation', () => {
    test('should handle CAN during initiation', async () => {
      mockedFs.readFile.mockResolvedValue(Buffer.from('data'));

      const events: ReplayProgress[] = [];
      sender.on('progress', (p: ReplayProgress) => events.push(p));

      const sendPromise = sender.send({ filePath: '/test/file.bin', fileName: 'file.bin' });
      await flush();
      mock.simulateReceive(CAN);

      await sendPromise;

      const last = events[events.length - 1];
      expect(last.state).toBe('cancelled');
      expect(last.error).toBe('Receiver cancelled transfer');
    });

    test('should handle CAN during block transfer', async () => {
      mockedFs.readFile.mockResolvedValue(Buffer.alloc(300)); // 3 blocks

      mock.mockWrite.mockImplementation(async (data) => {
        const buf = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data as string);
        mock.writtenData.push(buf);
        if (buf[0] === SOH && buf[1] === 1) {
          setImmediate(() => mock.simulateReceive(ACK)); // ACK block 1
        } else if (buf[0] === SOH && buf[1] === 2) {
          setImmediate(() => mock.simulateReceive(CAN)); // CAN on block 2
        }
      });

      const events: ReplayProgress[] = [];
      sender.on('progress', (p: ReplayProgress) => events.push(p));

      const sendPromise = sender.send({ filePath: '/test/file.bin', fileName: 'file.bin' });
      await flush();
      mock.simulateReceive(NAK);

      await sendPromise;

      const last = events[events.length - 1];
      expect(last.state).toBe('cancelled');
      expect(last.error).toBe('Receiver cancelled transfer');
    });
  });

  describe('NAK retry', () => {
    test('should retry block on NAK and succeed on subsequent ACK', async () => {
      mockedFs.readFile.mockResolvedValue(Buffer.from('retry test'));

      let blockAttempt = 0;
      mock.mockWrite.mockImplementation(async (data) => {
        const buf = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data as string);
        mock.writtenData.push(buf);
        if (buf[0] === SOH) {
          blockAttempt++;
          if (blockAttempt <= 2) {
            setImmediate(() => mock.simulateReceive(NAK)); // NAK first two attempts
          } else {
            setImmediate(() => mock.simulateReceive(ACK)); // ACK third attempt
          }
        } else if (buf[0] === EOT) {
          setImmediate(() => mock.simulateReceive(ACK));
        }
      });

      const sendPromise = sender.send({ filePath: '/test/file.bin', fileName: 'file.bin' });
      await flush();
      mock.simulateReceive(NAK); // initiation

      await sendPromise;

      const blockWrites = mock.writtenData.filter(b => b[0] === SOH);
      expect(blockWrites).toHaveLength(3); // 2 NAKs + 1 ACK
      expect(sender.getLastProgress()!.state).toBe('completed');
    });

    test('should fail after MAX_RETRIES (10) NAKs on a block', async () => {
      mockedFs.readFile.mockResolvedValue(Buffer.from('fail test'));

      mock.mockWrite.mockImplementation(async (data) => {
        const buf = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data as string);
        mock.writtenData.push(buf);
        if (buf[0] === SOH) {
          setImmediate(() => mock.simulateReceive(NAK)); // always NAK
        }
      });

      const events: ReplayProgress[] = [];
      sender.on('progress', (p: ReplayProgress) => events.push(p));

      const sendPromise = sender.send({ filePath: '/test/file.bin', fileName: 'file.bin' });
      await flush();
      mock.simulateReceive(NAK); // initiation

      await sendPromise;

      const last = events[events.length - 1];
      expect(last.state).toBe('error');
      expect(last.error).toMatch(/Block 1 failed after 10 retries/);

      const blockWrites = mock.writtenData.filter(b => b[0] === SOH);
      expect(blockWrites).toHaveLength(10);
    });
  });

  describe('EOT handling', () => {
    test('should retry EOT on NAK and succeed on later ACK', async () => {
      mockedFs.readFile.mockResolvedValue(Buffer.from('eot test'));

      let eotCount = 0;
      mock.mockWrite.mockImplementation(async (data) => {
        const buf = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data as string);
        mock.writtenData.push(buf);
        if (buf[0] === SOH) {
          setImmediate(() => mock.simulateReceive(ACK));
        } else if (buf[0] === EOT) {
          eotCount++;
          if (eotCount <= 2) {
            setImmediate(() => mock.simulateReceive(NAK)); // NAK first two EOTs
          } else {
            setImmediate(() => mock.simulateReceive(ACK)); // ACK third
          }
        }
      });

      const sendPromise = sender.send({ filePath: '/test/file.bin', fileName: 'file.bin' });
      await flush();
      mock.simulateReceive(NAK);
      await sendPromise;

      const eotWrites = mock.writtenData.filter(b => b[0] === EOT);
      expect(eotWrites).toHaveLength(3);
      expect(sender.getLastProgress()!.state).toBe('completed');
    });

    test('should fail when EOT never acknowledged', async () => {
      mockedFs.readFile.mockResolvedValue(Buffer.from('eot fail'));

      mock.mockWrite.mockImplementation(async (data) => {
        const buf = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data as string);
        mock.writtenData.push(buf);
        if (buf[0] === SOH) {
          setImmediate(() => mock.simulateReceive(ACK));
        } else if (buf[0] === EOT) {
          setImmediate(() => mock.simulateReceive(NAK)); // always NAK EOT
        }
      });

      const events: ReplayProgress[] = [];
      sender.on('progress', (p: ReplayProgress) => events.push(p));

      const sendPromise = sender.send({ filePath: '/test/file.bin', fileName: 'file.bin' });
      await flush();
      mock.simulateReceive(NAK);

      await sendPromise;

      const last = events[events.length - 1];
      expect(last.state).toBe('error');
      expect(last.error).toBe('EOT not acknowledged after retries');

      const eotWrites = mock.writtenData.filter(b => b[0] === EOT);
      expect(eotWrites).toHaveLength(10);
    });
  });

  describe('sender cancellation', () => {
    test('should cancel before initiation', async () => {
      mockedFs.readFile.mockResolvedValue(Buffer.from('test'));

      const events: ReplayProgress[] = [];
      sender.on('progress', (p: ReplayProgress) => events.push(p));

      const sendPromise = sender.send({ filePath: '/test/file.bin', fileName: 'file.bin' });
      await flush(); // let sender reach waitForByte

      sender.cancel();
      await sendPromise;

      const last = events[events.length - 1];
      expect(last.state).toBe('cancelled');
      expect(sender.isRunning()).toBe(false);
    });

    test('should cancel during block transfer and send CAN CAN', async () => {
      mockedFs.readFile.mockResolvedValue(Buffer.alloc(300)); // 3 blocks

      mock.mockWrite.mockImplementation(async (data) => {
        const buf = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data as string);
        mock.writtenData.push(buf);
        if (buf[0] === SOH && buf[1] === 1) {
          setImmediate(() => {
            mock.simulateReceive(ACK);
            // Cancel after first block is ACK'd — sender will check cancelled
            // before writing block 2
            sender.cancel();
          });
        }
      });

      const events: ReplayProgress[] = [];
      sender.on('progress', (p: ReplayProgress) => events.push(p));

      const sendPromise = sender.send({ filePath: '/test/file.bin', fileName: 'file.bin' });
      await flush();
      mock.simulateReceive(NAK);

      await sendPromise;

      const last = events[events.length - 1];
      expect(last.state).toBe('cancelled');

      // Should have sent CAN CAN
      const canWrites = mock.writtenData.filter(b => b[0] === CAN);
      expect(canWrites.length).toBeGreaterThanOrEqual(1);
      expect(canWrites[0]).toEqual(Buffer.from([CAN, CAN]));
    });

    test('should not be running after cancellation', async () => {
      mockedFs.readFile.mockResolvedValue(Buffer.from('test'));

      const sendPromise = sender.send({ filePath: '/test/file.bin', fileName: 'file.bin' });
      await flush();
      sender.cancel();
      await sendPromise;

      expect(sender.isRunning()).toBe(false);
    });
  });

  describe('progress events', () => {
    test('should emit running then completed for successful transfer', async () => {
      mockedFs.readFile.mockResolvedValue(Buffer.alloc(BLOCK_SIZE));
      autoAck();

      const events: ReplayProgress[] = [];
      sender.on('progress', (p: ReplayProgress) => events.push({ ...p }));

      const sendPromise = sender.send({ filePath: '/test/file.bin', fileName: 'file.bin' });
      await flush();
      mock.simulateReceive(NAK);
      await sendPromise;

      // First event: running with 0 bytesSent (initial)
      expect(events[0].state).toBe('running');
      expect(events[0].bytesSent).toBe(0);

      // Last event: completed
      const last = events[events.length - 1];
      expect(last.state).toBe('completed');
      expect(last.percentComplete).toBe(100);
      expect(last.fileName).toBe('file.bin');
    });

    test('should track progress across multiple blocks', async () => {
      const fileData = Buffer.alloc(BLOCK_SIZE * 3); // 3 blocks
      mockedFs.readFile.mockResolvedValue(fileData);
      autoAck();

      const events: ReplayProgress[] = [];
      sender.on('progress', (p: ReplayProgress) => events.push({ ...p }));

      const sendPromise = sender.send({ filePath: '/test/file.bin', fileName: 'file.bin' });
      await flush();
      mock.simulateReceive(NAK);
      await sendPromise;

      // Should have running events with increasing bytesSent
      const runningEvents = events.filter(e => e.state === 'running');
      expect(runningEvents.length).toBeGreaterThanOrEqual(3); // initial + after each block

      for (let i = 1; i < runningEvents.length; i++) {
        expect(runningEvents[i].bytesSent).toBeGreaterThanOrEqual(runningEvents[i - 1].bytesSent);
      }
    });

    test('should update lastProgress on each event', async () => {
      mockedFs.readFile.mockResolvedValue(Buffer.from('A'));
      autoAck();

      const sendPromise = sender.send({ filePath: '/test/file.bin', fileName: 'file.bin' });
      await flush();
      mock.simulateReceive(NAK);
      await sendPromise;

      const lastProgress = sender.getLastProgress();
      expect(lastProgress).not.toBeNull();
      expect(lastProgress!.state).toBe('completed');
    });

    test('should include fileName in all progress events', async () => {
      mockedFs.readFile.mockResolvedValue(Buffer.from('test'));
      autoAck();

      const events: ReplayProgress[] = [];
      sender.on('progress', (p: ReplayProgress) => events.push(p));

      const sendPromise = sender.send({ filePath: '/test/myfile.bin', fileName: 'myfile.bin' });
      await flush();
      mock.simulateReceive(NAK);
      await sendPromise;

      for (const event of events) {
        expect(event.fileName).toBe('myfile.bin');
      }
    });
  });

  describe('block numbering', () => {
    test('should number blocks sequentially starting at 1', async () => {
      // 3 blocks (384 bytes)
      mockedFs.readFile.mockResolvedValue(Buffer.alloc(BLOCK_SIZE * 3));
      autoAck();

      const sendPromise = sender.send({ filePath: '/test/file.bin', fileName: 'file.bin' });
      await flush();
      mock.simulateReceive(NAK);
      await sendPromise;

      const blockPackets = mock.writtenData.filter(b => b[0] === SOH);
      expect(blockPackets).toHaveLength(3);

      expect(blockPackets[0][1]).toBe(1);
      expect(blockPackets[0][2]).toBe(254); // 255 - 1
      expect(blockPackets[1][1]).toBe(2);
      expect(blockPackets[1][2]).toBe(253); // 255 - 2
      expect(blockPackets[2][1]).toBe(3);
      expect(blockPackets[2][2]).toBe(252); // 255 - 3
    });

    test('should preserve correct block data in each packet', async () => {
      // 3 blocks with distinguishable data
      const fileData = Buffer.alloc(BLOCK_SIZE * 3);
      fileData.fill(0xAA, 0, BLOCK_SIZE);
      fileData.fill(0xBB, BLOCK_SIZE, BLOCK_SIZE * 2);
      fileData.fill(0xCC, BLOCK_SIZE * 2, BLOCK_SIZE * 3);
      mockedFs.readFile.mockResolvedValue(fileData);
      autoAck();

      const sendPromise = sender.send({ filePath: '/test/file.bin', fileName: 'file.bin' });
      await flush();
      mock.simulateReceive(NAK);
      await sendPromise;

      const blockPackets = mock.writtenData.filter(b => b[0] === SOH);

      const data1 = blockPackets[0].subarray(3, 3 + BLOCK_SIZE);
      const data2 = blockPackets[1].subarray(3, 3 + BLOCK_SIZE);
      const data3 = blockPackets[2].subarray(3, 3 + BLOCK_SIZE);

      expect(data1).toEqual(Buffer.alloc(BLOCK_SIZE, 0xAA));
      expect(data2).toEqual(Buffer.alloc(BLOCK_SIZE, 0xBB));
      expect(data3).toEqual(Buffer.alloc(BLOCK_SIZE, 0xCC));
    });
  });
});
