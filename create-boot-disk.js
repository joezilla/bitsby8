#!/usr/bin/env node
/**
 * create-boot-disk.js - Create bootable FDC+ disk images from HEX or binary files
 *
 * Usage:
 *   node create-boot-disk.js <input-file> [options]
 *
 * Supports:
 *   - Intel HEX format (.hex, .ihx)
 *   - Raw binary format (.bin, .com)
 *
 * Examples:
 *   node create-boot-disk.js boot.hex -o myos.dsk
 *   node create-boot-disk.js boot.bin -o myos.dsk --tracks 17
 *   node create-boot-disk.js boot.hex -o myos.dsk --8inch
 */

const fs = require('fs');
const path = require('path');

// FDC+ disk parameters (from protocol.ts)
const SECTOR_SIZE = 137;         // Total bytes per sector record
const SECTORS_PER_TRACK = 32;    // Sectors per track (8-inch / FDC+)
const DATA_PER_SECTOR = 128;     // Usable data bytes per sector
const TRACK_SIZE = SECTOR_SIZE * SECTORS_PER_TRACK;  // 4,384 bytes per track
const TRACKS_8INCH = 77;         // Standard 8-inch floppy
const TRACKS_MINIDISK = 17;      // 5.25-inch minidisk
const MAX_TRACKS = 1863;         // 8MB format maximum

/**
 * Parse Intel HEX format file
 * @param {string} hexContent - Content of the HEX file
 * @returns {Buffer} - Binary data with correct addressing
 */
function parseIntelHex(hexContent) {
    const lines = hexContent.split(/\r?\n/);
    let minAddress = Infinity;
    let maxAddress = 0;
    const dataRecords = [];
    let extendedAddress = 0;

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum].trim();
        if (!line || !line.startsWith(':')) continue;

        // Parse record
        const byteCount = parseInt(line.substring(1, 3), 16);
        const address = parseInt(line.substring(3, 7), 16);
        const recordType = parseInt(line.substring(7, 9), 16);
        const dataHex = line.substring(9, 9 + byteCount * 2);
        const checksum = parseInt(line.substring(9 + byteCount * 2, 11 + byteCount * 2), 16);

        // Verify checksum
        let sum = byteCount + (address >> 8) + (address & 0xFF) + recordType;
        for (let i = 0; i < byteCount; i++) {
            sum += parseInt(dataHex.substring(i * 2, i * 2 + 2), 16);
        }
        sum = (~sum + 1) & 0xFF;
        if (sum !== checksum) {
            throw new Error(`Checksum error on line ${lineNum + 1}: expected ${checksum.toString(16)}, got ${sum.toString(16)}`);
        }

        switch (recordType) {
            case 0x00: // Data record
                const fullAddress = extendedAddress + address;
                const data = Buffer.from(dataHex, 'hex');
                dataRecords.push({ address: fullAddress, data });
                minAddress = Math.min(minAddress, fullAddress);
                maxAddress = Math.max(maxAddress, fullAddress + data.length);
                break;

            case 0x01: // End of file
                break;

            case 0x02: // Extended segment address
                extendedAddress = parseInt(dataHex, 16) << 4;
                break;

            case 0x04: // Extended linear address
                extendedAddress = parseInt(dataHex, 16) << 16;
                break;

            case 0x03: // Start segment address (entry point - ignore for disk image)
            case 0x05: // Start linear address (entry point - ignore for disk image)
                break;

            default:
                console.warn(`Warning: Unknown record type ${recordType} on line ${lineNum + 1}`);
        }
    }

    if (dataRecords.length === 0) {
        throw new Error('No data records found in HEX file');
    }

    // For boot code, we typically want data starting at address 0
    // If the code is assembled for org 0, minAddress should be 0
    const size = maxAddress - minAddress;
    const binary = Buffer.alloc(maxAddress, 0); // Allocate from 0 to maxAddress

    // Copy data records to correct positions
    for (const record of dataRecords) {
        record.data.copy(binary, record.address);
    }

    console.log(`Parsed HEX file: ${dataRecords.length} data records`);
    console.log(`  Address range: 0x${minAddress.toString(16).padStart(4, '0')} - 0x${(maxAddress - 1).toString(16).padStart(4, '0')}`);
    console.log(`  Binary size: ${maxAddress} bytes`);

    // Return only the used portion if minAddress > 0, otherwise return from 0
    if (minAddress > 0) {
        console.log(`  Note: Code starts at 0x${minAddress.toString(16).padStart(4, '0')}, not 0x0000`);
        console.log(`        For boot code, ensure your assembler uses ORG 0000h`);
    }

    return binary.slice(0, maxAddress);
}

/**
 * Create a bootable disk image with proper Altair boot-track sector format.
 *
 * Each 137-byte sector is formatted per the CDBL specification:
 *   Byte 0       Track number | 0x80 (sync bit)
 *   Bytes 1-2    File byte count (16-bit LE, total boot code size)
 *   Bytes 3-130  Sector data (128 bytes)
 *   Byte 131     Marker byte (0xFF)
 *   Byte 132     Checksum (8-bit sum of 128 data bytes)
 *   Bytes 133-136 Spare (zeros)
 *
 * Sectors are interleaved 2:1: even sectors (0,2,4,...) are loaded
 * first, then odd sectors (1,3,5,...) on each track.
 *
 * @param {Buffer} bootCode - Binary boot code
 * @param {number} trackCount - Number of tracks in the disk image
 * @returns {Buffer} - Complete disk image
 */
function createDiskImage(bootCode, trackCount) {
    const diskSize = TRACK_SIZE * trackCount;
    const disk = Buffer.alloc(diskSize, 0);

    const dataPerTrack = DATA_PER_SECTOR * SECTORS_PER_TRACK;
    const dataCapacity = dataPerTrack * trackCount;

    if (bootCode.length > dataCapacity) {
        const tracksNeeded = Math.ceil(bootCode.length / dataPerTrack);
        throw new Error(`Boot code requires ${tracksNeeded} tracks but disk only has ${trackCount} tracks`);
    }

    const fileByteCount = bootCode.length;
    let bootOffset = 0;

    for (let track = 0; track < trackCount; track++) {
        // CDBL reads sectors in 2:1 interleave order:
        // even sectors first (0,2,4,...,30) then odd (1,3,5,...,31)
        for (let pass = 0; pass < 2; pass++) {
            for (let s = pass; s < SECTORS_PER_TRACK; s += 2) {
                const imgOffset = (track * SECTORS_PER_TRACK + s) * SECTOR_SIZE;

                // Byte 0: Track number with MSB set (sync bit)
                disk[imgOffset] = track | 0x80;

                // Bytes 1-2: File byte count (16-bit little-endian)
                disk[imgOffset + 1] = fileByteCount & 0xFF;
                disk[imgOffset + 2] = (fileByteCount >> 8) & 0xFF;

                // Bytes 3-130: Sector data (128 bytes) + compute checksum
                let checksum = 0;
                for (let i = 0; i < DATA_PER_SECTOR; i++) {
                    const dataByte = bootOffset < bootCode.length ? bootCode[bootOffset] : 0;
                    disk[imgOffset + 3 + i] = dataByte;
                    checksum = (checksum + dataByte) & 0xFF;
                    bootOffset++;
                }

                // Byte 131: Marker byte (must be 0xFF / 377 octal)
                disk[imgOffset + 131] = 0xFF;

                // Byte 132: Checksum (8-bit sum of all 128 data bytes)
                disk[imgOffset + 132] = checksum;

                // Bytes 133-136: Spare (already 0 from Buffer.alloc)
            }
        }
    }

    const sectorsUsed = Math.ceil(bootCode.length / DATA_PER_SECTOR) || 0;
    console.log(`Created disk image: ${trackCount} tracks, ${diskSize} bytes`);
    console.log(`  Boot code: ${bootCode.length} bytes (${sectorsUsed} sector${sectorsUsed !== 1 ? 's' : ''})`);

    return disk;
}

/**
 * Print usage information
 */
function printUsage() {
    console.log(`
create-boot-disk.js - Create bootable FDC+ disk images

Usage:
  node create-boot-disk.js <input-file> [options]

Arguments:
  input-file          Input file (.hex, .ihx for Intel HEX, .bin/.com for raw binary)

Options:
  -o, --output FILE   Output disk image file (default: <input>.dsk)
  -t, --tracks NUM    Number of tracks (default: 77 for 8-inch)
  --8inch             Create 8-inch disk (77 tracks, 337,664 bytes)
  --mini              Create minidisk (17 tracks, 74,528 bytes)
  --8mb               Create 8MB disk (1863 tracks, 8,171,392 bytes)
  -h, --help          Show this help message

Disk Formats:
  8-inch:    77 tracks x 4,384 bytes = 337,664 bytes (default)
  Minidisk:  17 tracks x 4,384 bytes = 74,528 bytes
  8MB:       1,863 tracks x 4,384 bytes = 8,171,392 bytes

Examples:
  node create-boot-disk.js hello.hex
  node create-boot-disk.js boot.hex -o myos.dsk
  node create-boot-disk.js boot.bin --mini -o minios.dsk
  node create-boot-disk.js kernel.hex --8mb -o bigdisk.dsk

Intel HEX Format:
  Standard format from 8080/Z80 assemblers. Each line contains:
  :LLAAAATT[DD...]CC
  where LL=byte count, AAAA=address, TT=record type, DD=data, CC=checksum

For more information, see BOOTABLE-DISK-IMAGES.md
`);
}

/**
 * Parse command line arguments
 */
function parseArgs(args) {
    const options = {
        input: null,
        output: null,
        tracks: TRACKS_8INCH,
        help: false
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        switch (arg) {
            case '-h':
            case '--help':
                options.help = true;
                break;

            case '-o':
            case '--output':
                options.output = args[++i];
                break;

            case '-t':
            case '--tracks':
                options.tracks = parseInt(args[++i], 10);
                if (isNaN(options.tracks) || options.tracks < 1 || options.tracks > MAX_TRACKS) {
                    throw new Error(`Invalid track count: ${args[i]} (must be 1-${MAX_TRACKS})`);
                }
                break;

            case '--8inch':
                options.tracks = TRACKS_8INCH;
                break;

            case '--mini':
            case '--minidisk':
                options.tracks = TRACKS_MINIDISK;
                break;

            case '--8mb':
                options.tracks = MAX_TRACKS;
                break;

            default:
                if (arg.startsWith('-')) {
                    throw new Error(`Unknown option: ${arg}`);
                }
                if (options.input) {
                    throw new Error(`Multiple input files specified: ${options.input} and ${arg}`);
                }
                options.input = arg;
        }
    }

    return options;
}

/**
 * Main entry point
 */
function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        printUsage();
        process.exit(1);
    }

    let options;
    try {
        options = parseArgs(args);
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }

    if (options.help) {
        printUsage();
        process.exit(0);
    }

    if (!options.input) {
        console.error('Error: No input file specified');
        printUsage();
        process.exit(1);
    }

    // Check input file exists
    if (!fs.existsSync(options.input)) {
        console.error(`Error: Input file not found: ${options.input}`);
        process.exit(1);
    }

    // Determine output filename
    if (!options.output) {
        const parsed = path.parse(options.input);
        options.output = path.join(parsed.dir, parsed.name + '.dsk');
    }

    // Determine input format and read file
    const ext = path.extname(options.input).toLowerCase();
    let bootCode;

    try {
        console.log(`Reading: ${options.input}`);

        if (ext === '.hex' || ext === '.ihx' || ext === '.h86') {
            // Intel HEX format
            const hexContent = fs.readFileSync(options.input, 'utf8');
            bootCode = parseIntelHex(hexContent);
        } else {
            // Assume raw binary (.bin, .com, or any other extension)
            bootCode = fs.readFileSync(options.input);
            console.log(`Read binary file: ${bootCode.length} bytes`);
        }

        // Create disk image
        const diskImage = createDiskImage(bootCode, options.tracks);

        // Write output file
        fs.writeFileSync(options.output, diskImage);
        console.log(`\nWrote: ${options.output}`);
        console.log(`\nTo use this disk image:`);
        console.log(`  1. Copy to the disks/ directory`);
        console.log(`  2. Mount to drive 0 using the web interface`);
        console.log(`  3. Boot the Altair from FDC+`);

    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

// Export functions for testing
module.exports = {
    parseIntelHex, createDiskImage, parseArgs, main,
    SECTOR_SIZE, SECTORS_PER_TRACK, DATA_PER_SECTOR,
    TRACK_SIZE, TRACKS_8INCH, TRACKS_MINIDISK, MAX_TRACKS,
};

// Run main function when executed directly (not when require()'d)
if (require.main === module) {
    main();
}
