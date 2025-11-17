/**
 * Protocol Module Unit Tests
 */

import {
  CommandResponseBlock,
  FdcCommand,
  FdcError,
  BaudRate,
  ByteUtils,
  createDefaultConfig,
  MAX_DRIVES,
  MAX_TRACKS,
  MAX_TRACK_LEN,
} from '../src/protocol';

describe('Protocol Constants', () => {
  test('MAX_DRIVES should be 16', () => {
    expect(MAX_DRIVES).toBe(16);
  });

  test('MAX_TRACKS should be 77', () => {
    expect(MAX_TRACKS).toBe(77);
  });

  test('MAX_TRACK_LEN should be 4384 (137*32)', () => {
    expect(MAX_TRACK_LEN).toBe(137 * 32);
    expect(MAX_TRACK_LEN).toBe(4384);
  });
});

describe('BaudRate Enum', () => {
  test('should contain all supported baud rates', () => {
    expect(BaudRate.B9600).toBe(9600);
    expect(BaudRate.B19200).toBe(19200);
    expect(BaudRate.B38400).toBe(38400);
    expect(BaudRate.B57600).toBe(57600);
    expect(BaudRate.B76800).toBe(76800);
    expect(BaudRate.B230400).toBe(230400);
    expect(BaudRate.B460800).toBe(460800);
  });
});

describe('FdcError Enum', () => {
  test('should contain all error codes', () => {
    expect(FdcError.OK).toBe(0x00);
    expect(FdcError.NOT_READY).toBe(0x01);
    expect(FdcError.CHKSUM_ERR).toBe(0x02);
    expect(FdcError.WRITE_ERR).toBe(0x03);
  });
});

describe('FdcCommand Enum', () => {
  test('should contain all commands', () => {
    expect(FdcCommand.STAT).toBe('STAT');
    expect(FdcCommand.READ).toBe('READ');
    expect(FdcCommand.WRIT).toBe('WRIT');
  });
});

describe('ByteUtils', () => {
  describe('LSB', () => {
    test('should extract low byte', () => {
      expect(ByteUtils.LSB(0x1234)).toBe(0x34);
      expect(ByteUtils.LSB(0xabcd)).toBe(0xcd);
      expect(ByteUtils.LSB(0xff)).toBe(0xff);
      expect(ByteUtils.LSB(0x00)).toBe(0x00);
    });
  });

  describe('MSB', () => {
    test('should extract high byte', () => {
      expect(ByteUtils.MSB(0x1234)).toBe(0x12);
      expect(ByteUtils.MSB(0xabcd)).toBe(0xab);
      expect(ByteUtils.MSB(0xff)).toBe(0x00);
      expect(ByteUtils.MSB(0x0100)).toBe(0x01);
    });
  });

  describe('WORD', () => {
    test('should combine LSB and MSB into word', () => {
      expect(ByteUtils.WORD(0x34, 0x12)).toBe(0x1234);
      expect(ByteUtils.WORD(0xcd, 0xab)).toBe(0xabcd);
      expect(ByteUtils.WORD(0xff, 0xff)).toBe(0xffff);
      expect(ByteUtils.WORD(0x00, 0x00)).toBe(0x0000);
    });

    test('should mask values to bytes', () => {
      expect(ByteUtils.WORD(0x134, 0x112)).toBe(0x1234);
      expect(ByteUtils.WORD(0xfff, 0xfff)).toBe(0xffff);
    });
  });
});

describe('CommandResponseBlock', () => {
  describe('constructor', () => {
    test('should create block with default values', () => {
      const block = new CommandResponseBlock();
      expect(block.cmd).toBe('\0\0\0\0');
      expect(block.param1).toBe(0);
      expect(block.param2).toBe(0);
    });

    test('should create block with specified values', () => {
      const block = new CommandResponseBlock('TEST', 0x1234, 0x5678);
      expect(block.cmd).toBe('TEST');
      expect(block.param1).toBe(0x1234);
      expect(block.param2).toBe(0x5678);
    });

    test('should pad short commands to 4 bytes', () => {
      const block = new CommandResponseBlock('AB', 0, 0);
      expect(block.cmd).toBe('AB\0\0');
      expect(block.cmd.length).toBe(4);
    });

    test('should truncate long commands to 4 bytes', () => {
      const block = new CommandResponseBlock('TOOLONG', 0, 0);
      expect(block.cmd).toBe('TOOL');
      expect(block.cmd.length).toBe(4);
    });

    test('should mask parameters to 16 bits', () => {
      const block = new CommandResponseBlock('TEST', 0x12345, 0xabcde);
      expect(block.param1).toBe(0x2345);
      expect(block.param2).toBe(0xbcde);
    });
  });

  describe('toBuffer', () => {
    test('should convert to 8-byte buffer', () => {
      const block = new CommandResponseBlock('READ', 0x1234, 0x5678);
      const buffer = block.toBuffer();

      expect(buffer.length).toBe(8);
      expect(buffer.toString('ascii', 0, 4)).toBe('READ');
      expect(buffer.readUInt16LE(4)).toBe(0x1234);
      expect(buffer.readUInt16LE(6)).toBe(0x5678);
    });

    test('should use little-endian byte order', () => {
      const block = new CommandResponseBlock('TEST', 0x1234, 0xabcd);
      const buffer = block.toBuffer();

      // param1: 0x1234 -> LSB=0x34, MSB=0x12
      expect(buffer[4]).toBe(0x34);
      expect(buffer[5]).toBe(0x12);

      // param2: 0xabcd -> LSB=0xcd, MSB=0xab
      expect(buffer[6]).toBe(0xcd);
      expect(buffer[7]).toBe(0xab);
    });
  });

  describe('fromBuffer', () => {
    test('should parse buffer correctly', () => {
      const buffer = Buffer.alloc(8);
      buffer.write('STAT', 0, 4, 'ascii');
      buffer.writeUInt16LE(0x1234, 4);
      buffer.writeUInt16LE(0x5678, 6);

      const block = CommandResponseBlock.fromBuffer(buffer);

      expect(block.cmd).toBe('STAT');
      expect(block.param1).toBe(0x1234);
      expect(block.param2).toBe(0x5678);
    });

    test('should throw error for short buffer', () => {
      const buffer = Buffer.alloc(7);
      expect(() => CommandResponseBlock.fromBuffer(buffer)).toThrow(
        'Invalid buffer length: 7, expected 8'
      );
    });

    test('should handle null characters in command', () => {
      const buffer = Buffer.alloc(8);
      buffer.write('AB\0\0', 0, 4, 'ascii');
      buffer.writeUInt16LE(0, 4);
      buffer.writeUInt16LE(0, 6);

      const block = CommandResponseBlock.fromBuffer(buffer);
      expect(block.cmd).toBe('AB\0\0');
    });
  });

  describe('getCommand', () => {
    test('should return valid FdcCommand', () => {
      const statBlock = new CommandResponseBlock('STAT', 0, 0);
      expect(statBlock.getCommand()).toBe(FdcCommand.STAT);

      const readBlock = new CommandResponseBlock('READ', 0, 0);
      expect(readBlock.getCommand()).toBe(FdcCommand.READ);

      const writBlock = new CommandResponseBlock('WRIT', 0, 0);
      expect(writBlock.getCommand()).toBe(FdcCommand.WRIT);
    });

    test('should return null for invalid command', () => {
      const block = new CommandResponseBlock('INVL', 0, 0);
      expect(block.getCommand()).toBeNull();
    });

    test('should trim whitespace before matching', () => {
      const block = new CommandResponseBlock('READ', 0, 0);
      block.cmd = 'READ'; // Already trimmed in constructor
      expect(block.getCommand()).toBe(FdcCommand.READ);
    });
  });

  describe('create', () => {
    test('should create block from command enum', () => {
      const block = CommandResponseBlock.create(
        FdcCommand.READ,
        0x1234,
        0x5678
      );

      expect(block.cmd).toBe('READ');
      expect(block.param1).toBe(0x1234);
      expect(block.param2).toBe(0x5678);
    });
  });

  describe('round-trip conversion', () => {
    test('should preserve data through buffer conversion', () => {
      const original = new CommandResponseBlock('WRIT', 0xabcd, 0x1234);
      const buffer = original.toBuffer();
      const restored = CommandResponseBlock.fromBuffer(buffer);

      expect(restored.cmd).toBe(original.cmd);
      expect(restored.param1).toBe(original.param1);
      expect(restored.param2).toBe(original.param2);
    });
  });
});

describe('createDefaultConfig', () => {
  test('should create valid default configuration', () => {
    const config = createDefaultConfig();

    expect(config.port).toBeNull();
    expect(config.baudRate).toBe(460800);
    expect(config.verbose).toBe(false);
    expect(config.debug).toBe(false);
    expect(config.drives).toBeInstanceOf(Map);
    expect(config.drives.size).toBe(0);
    expect(config.readonlyDrives).toBeInstanceOf(Set);
    expect(config.readonlyDrives.size).toBe(0);
  });

  test('should create independent config objects', () => {
    const config1 = createDefaultConfig();
    const config2 = createDefaultConfig();

    config1.drives.set(0, 'test.dsk');
    expect(config2.drives.size).toBe(0);

    config1.readonlyDrives.add(0);
    expect(config2.readonlyDrives.size).toBe(0);
  });
});
