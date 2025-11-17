# TypeScript Port Troubleshooting Notes

## Issue: IMSAI 8080 Not Booting with TypeScript Server

### Problem Summary
After porting the FDC+ Serial Drive Server from C to TypeScript, the IMSAI 8080 vintage computer would not boot from the serial disk server, even though the C version worked perfectly.

### Root Causes Discovered

#### 1. Flow Control Issue (CRITICAL)
**Problem**: The Node.js serialport library enables flow control by default, but the C version explicitly disables all flow control.

**Symptoms**:
- No data received from IMSAI
- Server appeared to be running but completely silent

**Fix**: Explicitly disable all flow control in serial port configuration:
```typescript
{
  rtscts: false,    // No RTS/CTS hardware flow control
  xon: false,       // No XON/XOFF software flow control
  xoff: false,
  xany: false,
  lock: false,
}
```

**Location**: src/serial.ts:40-45

**C Equivalent**: In io.c, the termios configuration disables flow control by not setting any flow control flags in c_cflag.

#### 2. Serial Drain Missing (CRITICAL)
**Problem**: After writing data to the serial port, the code needs to wait for all data to be physically transmitted before continuing.

**Symptoms**:
- IMSAI receives STAT commands but never progresses to READ commands
- Boot sequence gets stuck in polling loop

**Fix**: Call drain() after every write operation:
```typescript
this.port!.write(dataWithChecksum, (error) => {
  if (error) {
    reject(error);
  } else {
    // Wait for data to be transmitted (drain)
    this.port!.drain((drainError) => {
      if (drainError) {
        reject(drainError);
      } else {
        resolve();
      }
    });
  }
});
```

**Location**: src/serial.ts:235-241

**C Equivalent**: In io.c:241, the C version calls `tcdrain(fd)` after each write to ensure all data is transmitted.

#### 3. Boot Sequence Timing
**Problem**: The IMSAI's boot ROM is timing-sensitive and expects consistent response timing.

**Solution**: The drain() call ensures consistent timing by not returning control until all data is physically transmitted, matching the C version's behavior.

### Successful Boot Sequence

When working correctly, the log shows:
```
📨 STAT p1=0xff00 p2=0x0000 (polling with head=255)
📨 READ p1=0x0000 p2=0x1120 (read track 0, 4384 bytes)
📨 READ p1=0x0001 p2=0x1120 (read track 1)
📨 READ p1=0x0002 p2=0x1120 (read track 2)
📨 STAT p1=0x0000 p2=0x0002 (transitions to head=0)
```

### Debugging Approach That Worked

1. **Created simple-server.ts**: Bypassed terminal UI to see raw protocol data
2. **Added hex logging**: Showed exact bytes being sent/received
3. **Modified C version to log**: Created fdcsds.log to compare working vs non-working sequences
4. **Compared byte-for-byte**: Found protocol was identical but timing was different
5. **Read C source code carefully**: Discovered tcdrain() call that was missing in TypeScript

### Key Lessons

1. **Serial communication is timing-sensitive**: Vintage hardware expects consistent timing
2. **Always drain after writes**: Modern async code needs explicit synchronization
3. **Library defaults differ**: Node.js serialport defaults don't match POSIX termios defaults
4. **Log everything during debugging**: Hex dumps of all traffic were essential
5. **Compare with working implementation**: Having the C version logs was crucial

### Testing Procedure

To test the server with IMSAI 8080:

1. Start the TypeScript server FIRST
2. Power OFF the IMSAI completely
3. Wait 5 seconds
4. Power ON the IMSAI
5. Trigger boot sequence
6. Should see STAT polling followed by READ commands and successful boot

### Files Modified

- `src/serial.ts`: Added explicit flow control disabling, already had drain()
- `src/debug-server.ts`: Added flow control fix for debugging
- `src/simple-server.ts`: Created new simplified debug server with drain() calls
- `src/protocol.ts`: Changed default baud from 230400 to 460800
- `io.c` and `fdcsds.c`: Added logging for comparison (temporary)

### Performance Notes

The TypeScript version performs identically to the C version:
- Baud rate: 460800 bps
- Track size: 4384 bytes
- Boot time: ~3 seconds (tracks 0, 1, 2)
- CPU usage: Minimal when idle

### Related Documentation

- FLOW-CONTROL-FIX.md: Detailed explanation of flow control issue
- fdcsds.log: Successful C version boot log for reference
- simple-server.ts: Simplified debug server for troubleshooting
