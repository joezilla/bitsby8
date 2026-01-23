# Creating Bootable Disk Images for FDC+ Controller

## Overview

This guide explains how to create bootable disk images for the FDC+ controller that boot your own custom operating system or code on an Altair 8800 or compatible vintage computer.

## Understanding the FDC+ System

### What is FDC+?

FDC+ is an Enhanced Floppy Disk Controller for the Altair 8800 that operates in "serial disk mode" - instead of physical disks, it reads/writes to disk image files via serial communication with a host server (this fdcplus-web project).

### Key Parameters

| Parameter | Value |
|-----------|-------|
| Track size | 4,384 bytes (137 × 32) |
| 8-inch disk | 77 tracks = 337,664 bytes |
| Minidisk | 17 tracks = 74,528 bytes |
| Max tracks | 1,863 (8MB format) |

---

## The Boot Process

### What Happens When You Boot

1. **Altair Boot ROM** reads Track 0 from the disk into memory at address `0x0000`
2. **Your boot code** (8080 assembly) executes starting at address `0x0000`
3. Your code can then read more tracks, initialize hardware, and load your OS

### Memory Layout (Altair 8800)

```
Address     Purpose
─────────────────────────────
0x0000      Boot code entry point (Track 0 loaded here)
0x0100      Traditional user program area
0xFF00+     High memory (varies by RAM installed)
```

---

## Step-by-Step: Creating a Bootable Disk Image

### Step 1: Write Your Boot Code (8080 Assembly)

Create an assembly file (e.g., `boot.asm`) with your boot code. Here's a minimal example that outputs a character to the serial console:

```asm
; boot.asm - Minimal Altair 8800 boot code
; Assembled for org 0x0000 (where boot track loads)

        ORG     0000h

START:
        ; Initialize stack pointer
        LXI     SP, 0FFFFh

        ; Output 'H' to serial port (SIO port 01h)
        MVI     A, 'H'          ; Load 'H' into A
WAIT1:  IN      00h             ; Read SIO status
        ANI     02h             ; Check TX ready bit
        JZ      WAIT1           ; Wait until ready
        MOV     A, 'H'
        OUT     01h             ; Output character

        ; Infinite loop
HALT:   JMP     HALT

        END     START
```

### Step 2: Assemble the Code

Use an 8080 assembler to convert assembly to machine code. Options include:

**Option A: asm8080 (recommended)**
```bash
# Install via npm or download
npm install -g asm8080

# Assemble
asm8080 boot.asm -o boot.bin
```

**Option B: z80asm (compatible mode)**
```bash
z80asm --8080 -o boot.bin boot.asm
```

**Option C: Online assembler**
- Use https://www.asm80.com/ (supports 8080)

### Step 3: Create the Disk Image

The disk image is simply raw track data concatenated together. Track 0 contains your boot code.

**Method A: Using create-boot-disk.js (Recommended)**

This project includes a utility script that handles Intel HEX and raw binary files:

```bash
# From Intel HEX file (common assembler output format)
node create-boot-disk.js boot.hex -o myos.dsk

# From raw binary file
node create-boot-disk.js boot.bin -o myos.dsk

# Create a minidisk (17 tracks) instead of 8-inch (77 tracks)
node create-boot-disk.js boot.hex --mini -o minios.dsk

# See all options
node create-boot-disk.js --help
```

A working example is provided in the `examples/` directory:
```bash
# Create disk from the included example
node create-boot-disk.js examples/hello.hex -o disks/hello.dsk
```

**Method B: Using dd and cat (Unix/Mac)**
```bash
# Create a blank 77-track disk image (337,664 bytes)
dd if=/dev/zero of=myos.dsk bs=4384 count=77

# Write boot code to track 0 (first 4384 bytes)
dd if=boot.bin of=myos.dsk bs=1 conv=notrunc
```

**Method B: Using a script (Node.js)**
```javascript
const fs = require('fs');

const TRACK_SIZE = 4384;
const TRACK_COUNT = 77;  // 8-inch disk

// Create blank disk
const disk = Buffer.alloc(TRACK_SIZE * TRACK_COUNT, 0);

// Load boot code into track 0
const bootCode = fs.readFileSync('boot.bin');
bootCode.copy(disk, 0);

// Write disk image
fs.writeFileSync('myos.dsk', disk);
```

**Method C: Using the FDC+ Web UI**
1. Use the web interface to create a blank disk (8-inch format)
2. Use the write API to write your boot code to track 0

### Step 4: Mount and Boot

1. Copy your `.dsk` file to the `disks/` directory
2. Start the fdcplus-web server: `npm run serve`
3. Open the web UI and mount your disk to drive 0
4. Power on the Altair and boot from the FDC+

---

## Writing More Complex Boot Loaders

### Loading Additional Tracks

To load your OS from subsequent tracks, you need to interact with the FDC+ hardware:

```asm
; Example: Read Track 1 into memory at 0x1000
;
; FDC+ I/O Ports:
;   Port 08h = Status/Control
;   Port 09h = Data

READ_TRACK:
        ; Wait for FDC ready
        IN      08h             ; Read status
        ANI     08h             ; Check ready bit
        JZ      READ_TRACK      ; Loop until ready

        ; Set track number
        MVI     A, 01h          ; Track 1
        OUT     09h             ; Send to FDC

        ; Set command: read
        MVI     A, 04h          ; Read command
        OUT     08h             ; Send command

        ; Read track data into memory
        LXI     H, 1000h        ; Destination address
        LXI     B, 1120h        ; 4384 bytes (0x1120)

READ_LOOP:
        IN      08h             ; Wait for data ready
        ANI     01h
        JZ      READ_LOOP
        IN      09h             ; Read byte
        MOV     M, A            ; Store to memory
        INX     H               ; Next address
        DCX     B               ; Decrement count
        MOV     A, B
        ORA     C
        JNZ     READ_LOOP       ; Loop until done

        RET
```

### Full Custom OS Structure

A typical custom OS disk layout:

| Track | Content |
|-------|---------|
| 0 | Boot loader (loads tracks 1-N) |
| 1-2 | OS kernel |
| 3+ | File system, applications |

---

## Example: Complete "Hello World" OS

Here's a complete example that boots and prints "Hello World":

```asm
; hello.asm - Complete bootable "Hello World" for Altair 8800
; Assemble with: asm8080 hello.asm -o hello.bin

        ORG     0000h

; Altair 8800 SIO ports
SIO_STATUS  EQU 00h
SIO_DATA    EQU 01h
TX_READY    EQU 02h

START:
        LXI     SP, 0FFFFh      ; Set stack to top of memory

        ; Print message
        LXI     H, MESSAGE      ; Point to message
PRINT:  MOV     A, M            ; Get character
        ORA     A               ; Check for null terminator
        JZ      DONE            ; If zero, done
        CALL    PUTCHAR         ; Print it
        INX     H               ; Next character
        JMP     PRINT

DONE:   HLT                     ; Halt CPU

; Output character in A to serial port
PUTCHAR:
        PUSH    PSW             ; Save character
WAIT:   IN      SIO_STATUS      ; Read status
        ANI     TX_READY        ; Check TX ready
        JZ      WAIT            ; Wait until ready
        POP     PSW             ; Restore character
        OUT     SIO_DATA        ; Send it
        RET

MESSAGE:
        DB      'Hello World from my custom OS!', 0Dh, 0Ah, 0

        END     START
```

Build and create disk:
```bash
asm8080 hello.asm -o hello.bin
dd if=/dev/zero of=hello.dsk bs=4384 count=77
dd if=hello.bin of=hello.dsk bs=1 conv=notrunc
```

---

## Important Considerations

### 1. I/O Port Addresses

The Altair 8800 has various configurations. Common serial ports:

| Port | Purpose |
|------|---------|
| 00h/01h | 2SIO Board A (status/data) |
| 02h/03h | 2SIO Board B |
| 08h/09h | FDC control/data |
| 10h/11h | SIO-2 alternative |

### 2. Memory Constraints

- Original Altair: 256 bytes to 64KB RAM
- Your code must fit in available RAM
- Stack grows downward from initial SP

### 3. Timing

- The Altair runs at 2MHz
- Serial I/O requires proper wait loops
- FDC operations have timing requirements

### 4. Testing Without Hardware

You can test your disk images with an Altair emulator:
- **z80pack** - Includes Altair/IMSAI emulator
- **Altair32** - Windows Altair emulator
- **SimH** - Portable historical computer simulator

---

## Tools and Resources

### Assemblers
- `asm8080` - Modern 8080 assembler (npm package)
- `z80asm` - Z80/8080 assembler
- `as8` - AS macro assembler (8080 support)

### Emulators
- SimH: https://simh.trailing-edge.com/
- z80pack: https://www.autometer.de/unix4fun/z80pack/

### Documentation
- Intel 8080 Programmer's Manual
- Altair 8800 Operator's Manual
- CP/M source code (reference implementation)

### Examples
- `examples/hello.asm` - Minimal "Hi" program source code
- `examples/hello.hex` - Pre-assembled Intel HEX file
- `examples/hello.dsk` - Ready-to-boot disk image (created with create-boot-disk.js)

### Disk Image Tools
- `create-boot-disk.js` - **Included in this project** - creates disk images from HEX or binary files
- `cpmtools` - Read/write CP/M disk images
- `dd` - Unix disk image manipulation

---

## Summary

Creating a bootable FDC+ disk image involves:

1. **Write 8080 assembly** code starting at address 0x0000
2. **Assemble** to raw binary (no headers)
3. **Create disk image** file (4384 bytes × track count)
4. **Copy boot code** to beginning of disk image (track 0)
5. **Mount and boot** using fdcplus-web server

The FDC+ expects raw track data - there's no special formatting beyond placing your machine code at the start of track 0.
