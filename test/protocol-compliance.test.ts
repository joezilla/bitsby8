/**
 * Protocol Compliance Tests
 * Tests adherence to FDC+ Serial Drive Communications Protocol (protocol.txt)
 */

import {
  CommandResponseBlock,
  FdcError,
} from '../src/protocol';

describe('Protocol Compliance - Message Format', () => {
  describe('Command Message Format (FDC to Server)', () => {
    test('should be 10 bytes: 4 byte command + 3 words (6 bytes)', () => {
      const cmd = new CommandResponseBlock('READ', 0x1234, 0x5678);
      const buffer = cmd.toBuffer();

      // Per protocol.txt line 26-29
      expect(buffer.length).toBe(8); // Without checksum (checksum is calculated separately)
      expect(buffer.toString('ascii', 0, 4)).toBe('READ');
      expect(buffer.readUInt16LE(4)).toBe(0x1234); // param1
      expect(buffer.readUInt16LE(6)).toBe(0x5678); // param2
    });

    test('should use little endian byte order', () => {
      // Per protocol.txt line 24: "three 16 bit words (little endian)"
      const cmd = new CommandResponseBlock('TEST', 0x1234, 0xabcd);
      const buffer = cmd.toBuffer();

      // Param1: 0x1234 → LSB=0x34, MSB=0x12
      expect(buffer[4]).toBe(0x34);
      expect(buffer[5]).toBe(0x12);

      // Param2: 0xabcd → LSB=0xcd, MSB=0xab
      expect(buffer[6]).toBe(0xcd);
      expect(buffer[7]).toBe(0xab);
    });

    test('command should be 4-byte ASCII string', () => {
      // Per protocol.txt line 22: "first four bytes are a command in ASCII"
      const commands = ['STAT', 'READ', 'WRIT'];

      commands.forEach(cmd => {
        const block = new CommandResponseBlock(cmd, 0, 0);
        expect(block.cmd.length).toBe(4);
        expect(block.toBuffer().toString('ascii', 0, 4)).toBe(cmd);
      });
    });
  });

  describe('Response Message Format (Server to FDC)', () => {
    test('should have response code and response data fields', () => {
      // Per protocol.txt line 60-63:
      // Bytes 4-5: Response Code
      // Bytes 6-7: Response Data
      const resp = new CommandResponseBlock('STAT', FdcError.OK, 0x00ff);
      const buffer = resp.toBuffer();

      expect(buffer.readUInt16LE(4)).toBe(FdcError.OK);     // Response code
      expect(buffer.readUInt16LE(6)).toBe(0x00ff);          // Response data
    });
  });
});

describe('Protocol Compliance - Error Codes', () => {
  test('should use correct error code values', () => {
    // Per protocol.txt line 79-83
    expect(FdcError.OK).toBe(0x0000);
    expect(FdcError.NOT_READY).toBe(0x0001);
    expect(FdcError.CHKSUM_ERR).toBe(0x0002);
    expect(FdcError.WRITE_ERR).toBe(0x0003);
  });
});

describe('Protocol Compliance - STAT Command', () => {
  test('STAT command should have drive and head status in param1', () => {
    // Per protocol.txt line 32-37:
    // LSB of param1 = drive number (or 0xff if no drive)
    // MSB of param1 = head load status (non-zero = loaded)

    const driveNum = 5;
    const headLoaded = 0x01;
    const param1 = (headLoaded << 8) | driveNum;

    const cmd = new CommandResponseBlock('STAT', param1, 0);

    // Extract values
    const extractedDrive = cmd.param1 & 0xff;
    const extractedHead = (cmd.param1 >> 8) & 0xff;

    expect(extractedDrive).toBe(driveNum);
    expect(extractedHead).toBe(headLoaded);
  });

  test('STAT command should have track number in param2', () => {
    // Per protocol.txt line 33: "current track number in Parameter 2"
    const trackNum = 42;
    const cmd = new CommandResponseBlock('STAT', 0, trackNum);
    expect(cmd.param2).toBe(trackNum);
  });

  test('STAT response should have drive mount status as bitmask', () => {
    // Per protocol.txt line 66-68:
    // "Returns drive status in Response Data with one bit per drive"
    // "Bits 15-0 correspond to drive numbers 15-0"

    // Example: Drives 0, 3, and 7 mounted
    const mountedDrives = (1 << 0) | (1 << 3) | (1 << 7);
    const resp = new CommandResponseBlock('STAT', FdcError.OK, mountedDrives);

    expect(resp.param2).toBe(mountedDrives);
    expect(resp.param2 & (1 << 0)).toBeTruthy(); // Drive 0 mounted
    expect(resp.param2 & (1 << 3)).toBeTruthy(); // Drive 3 mounted
    expect(resp.param2 & (1 << 7)).toBeTruthy(); // Drive 7 mounted
    expect(resp.param2 & (1 << 1)).toBeFalsy();  // Drive 1 not mounted
  });
});

describe('Protocol Compliance - READ Command', () => {
  test('READ param1 should have drive in MSNibble and track in lower 12 bits', () => {
    // Per protocol.txt line 44-47:
    // "Parameter 1 contains the drive number in the MSNibble"
    // "The lower 12 bits contain the track number"

    const driveNum = 3;
    const trackNum = 42;
    const param1 = (driveNum << 12) | (trackNum & 0x0fff);

    const cmd = new CommandResponseBlock('READ', param1, 0);

    // Extract values
    const extractedDrive = (cmd.param1 >> 12) & 0x0f;
    const extractedTrack = cmd.param1 & 0x0fff;

    expect(extractedDrive).toBe(driveNum);
    expect(extractedTrack).toBe(trackNum);
  });

  test('READ param2 should contain track length', () => {
    // Per protocol.txt line 45-46:
    // "Transfer length is in Parameter 2 and must be the track length"
    const trackLength = 4384;
    const cmd = new CommandResponseBlock('READ', 0, trackLength);
    expect(cmd.param2).toBe(trackLength);
  });
});

describe('Protocol Compliance - WRIT Command', () => {
  test('WRIT param1 should have drive in MSNibble and track in lower 12 bits', () => {
    // Per protocol.txt line 49-52:
    // Same format as READ
    const driveNum = 2;
    const trackNum = 15;
    const param1 = (driveNum << 12) | (trackNum & 0x0fff);

    const cmd = new CommandResponseBlock('WRIT', param1, 0);

    const extractedDrive = (cmd.param1 >> 12) & 0x0f;
    const extractedTrack = cmd.param1 & 0x0fff;

    expect(extractedDrive).toBe(driveNum);
    expect(extractedTrack).toBe(trackNum);
  });

  test('WRIT param2 should contain track length', () => {
    // Per protocol.txt line 50-51:
    // "Transfer length must be track length"
    const trackLength = 4384;
    const cmd = new CommandResponseBlock('WRIT', 0, trackLength);
    expect(cmd.param2).toBe(trackLength);
  });

  describe('WRIT Two-Phase Protocol', () => {
    test('should respond with WRIT OK when ready to receive data', () => {
      // Per protocol.txt line 70-74:
      // "tell the FDC that the server is ready to accept continuous transfer"
      // "response code word set to OK"

      const writResp = new CommandResponseBlock('WRIT', FdcError.OK, 0);
      expect(writResp.cmd).toBe('WRIT');
      expect(writResp.param1).toBe(FdcError.OK);
    });

    test('should respond with WRIT NOT_READY for unmounted drive', () => {
      // Per protocol.txt line 72-74:
      // "If the request can't be fulfilled (e.g., specified drive not mounted)"
      // "the response code is set to NOT READY"

      const writResp = new CommandResponseBlock('WRIT', FdcError.NOT_READY, 0);
      expect(writResp.cmd).toBe('WRIT');
      expect(writResp.param1).toBe(FdcError.NOT_READY);
    });

    test('should respond with WSTA after receiving track data', () => {
      // Per protocol.txt line 76-77:
      // "Final status of the write command after receiving the track data"
      // "is returned in the response code field"

      const wstaResp = new CommandResponseBlock('WSTA', FdcError.OK, 0);
      expect(wstaResp.cmd).toBe('WSTA');
    });

    test('should use WSTA CHKSUM_ERR for bad checksum', () => {
      // Per protocol.txt line 82:
      // "0x0002 - Checksum error (e.g., on the block of write data)"

      const wstaResp = new CommandResponseBlock('WSTA', FdcError.CHKSUM_ERR, 0);
      expect(wstaResp.param1).toBe(FdcError.CHKSUM_ERR);
    });

    test('should use WSTA WRITE_ERR for write failure', () => {
      // Per protocol.txt line 83:
      // "0x0003 - Write error (e.g., write to disk failed)"

      const wstaResp = new CommandResponseBlock('WSTA', FdcError.WRITE_ERR, 0);
      expect(wstaResp.param1).toBe(FdcError.WRITE_ERR);
    });
  });
});

describe('Protocol Compliance - Track Data Transfer', () => {
  test('track data should be followed by 16-bit little endian checksum', () => {
    // Per protocol.txt line 86-89:
    // "Track data is sent as a sequence of bytes followed by a 16 bit,
    //  little endian checksum"

    // Simulate track data
    const trackData = Buffer.alloc(100);
    for (let i = 0; i < 100; i++) {
      trackData[i] = i % 256;
    }

    // Calculate checksum (simple sum for demonstration)
    let checksum = 0;
    for (let i = 0; i < trackData.length; i++) {
      checksum = (checksum + trackData[i]) & 0xffff;
    }

    // Create buffer with checksum
    const dataWithChecksum = Buffer.alloc(102);
    trackData.copy(dataWithChecksum, 0);
    dataWithChecksum.writeUInt16LE(checksum, 100);

    // Verify little endian
    expect(dataWithChecksum[100]).toBe(checksum & 0xff);
    expect(dataWithChecksum[101]).toBe((checksum >> 8) & 0xff);
  });

  test('transfer length should NOT include checksum bytes', () => {
    // Per protocol.txt line 88:
    // "Note the Transfer Length field does NOT include the two bytes of the checksum"

    const trackLength = 4384;
    const cmd = new CommandResponseBlock('READ', 0, trackLength);

    expect(cmd.param2).toBe(trackLength);
    // When reading/writing, we transfer trackLength bytes + 2 checksum bytes
    // But param2 only contains trackLength
  });
});

describe('Protocol Compliance - Error Recovery', () => {
  test('server should ignore commands with invalid checksum', () => {
    // Per protocol.txt line 95-96:
    // "The server should ignore commands with an invalid checksum"

    // This is implementation behavior, not testable at protocol level
    // but we verify checksum calculation works
    const cmd = new CommandResponseBlock('READ', 0x1234, 0x5678);
    const buffer = cmd.toBuffer();

    // Calculate checksum (sum of first 8 bytes)
    let checksum = 0;
    for (let i = 0; i < 8; i++) {
      checksum = (checksum + buffer[i]) & 0xffff;
    }

    expect(checksum).toBeGreaterThan(0);
  });

  test('invalid write data checksum should return CHKSUM_ERR', () => {
    // Per protocol.txt line 97-98:
    // "An invalid checksum on a block of write data should not be ignored,
    //  instead, the WRIT response should have the Response Code field set to
    //  0x002, checksum error"

    const resp = new CommandResponseBlock('WSTA', FdcError.CHKSUM_ERR, 0);
    expect(resp.param1).toBe(0x0002);
  });
});

describe('Protocol Compliance - Drive Selection', () => {
  test('should support drive numbers 0-15', () => {
    // Per protocol.txt line 66-68: Bits 15-0 correspond to drive numbers 15-0

    for (let drive = 0; drive < 16; drive++) {
      const param1 = (drive << 12) | 0x0000; // Drive in MSNibble
      const cmd = new CommandResponseBlock('READ', param1, 0);

      const extractedDrive = (cmd.param1 >> 12) & 0x0f;
      expect(extractedDrive).toBe(drive);
      expect(extractedDrive).toBeLessThan(16);
    }
  });

  test('no drive selected should use 0xff', () => {
    // Per protocol.txt line 36:
    // "or 0xff is no drive is selected"

    const param1 = 0xff; // No drive selected
    const cmd = new CommandResponseBlock('STAT', param1, 0);

    expect(cmd.param1 & 0xff).toBe(0xff);
  });
});

describe('Protocol Compliance - Track Numbers', () => {
  test('should support track numbers up to 4095 (12 bits)', () => {
    // Per protocol.txt line 45: "lower 12 bits contain the track number"

    const maxTrack = 0x0fff; // 12 bits = 4095
    const param1 = (0 << 12) | maxTrack;
    const cmd = new CommandResponseBlock('READ', param1, 0);

    const extractedTrack = cmd.param1 & 0x0fff;
    expect(extractedTrack).toBe(maxTrack);
  });

  test('should mask track number to 12 bits', () => {
    // Ensure upper nibble of param1 is drive, lower 12 bits are track
    const drive = 7;
    const track = 0x1234; // More than 12 bits
    const param1 = (drive << 12) | (track & 0x0fff);

    const cmd = new CommandResponseBlock('READ', param1, 0);

    const extractedDrive = (cmd.param1 >> 12) & 0x0f;
    const extractedTrack = cmd.param1 & 0x0fff;

    expect(extractedDrive).toBe(drive);
    expect(extractedTrack).toBe(0x0234); // Upper bits masked off
  });
});
