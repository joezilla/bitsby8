# FDC+ Boot Examples

This directory contains example boot code for the Altair 8800 FDC+ controller.

## Files

| File | Description |
|------|-------------|
| `hello.asm` | 8080 assembly source - prints "Hi" to serial console |
| `hello.hex` | Pre-assembled Intel HEX file |
| `hello.dsk` | Ready-to-boot disk image (77 tracks, 8-inch format) |

## Quick Start

The `hello.dsk` image is ready to use:

1. Copy to the disks directory: `cp hello.dsk ../disks/`
2. Start the server: `npm run start`
3. Mount `hello.dsk` to drive 0 using the web interface
4. Boot the Altair - you should see "Hi" on the serial terminal

## Building from Source

If you want to modify the example or create your own:

```bash
# Assemble the source (requires an 8080 assembler)
asm8080 hello.asm -o hello.hex

# Create disk image
node ../create-boot-disk.js hello.hex -o hello.dsk
```

## Creating Your Own Boot Code

1. Write 8080 assembly with `ORG 0000h`
2. Assemble to Intel HEX format
3. Use `create-boot-disk.js` to create the disk image
4. See `../BOOTABLE-DISK-IMAGES.md` for detailed documentation

## Hardware Requirements

- Altair 8800 (or compatible) with FDC+ controller
- 2SIO serial board at ports 00h/01h (or modify for your configuration)
- At least 256 bytes of RAM (this example uses minimal memory)
