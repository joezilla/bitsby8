# FDC+ Serial Drive Server - Troubleshooting Guide

## 🔧 Debugging Tools

### **1. Debug Serial Monitor**

Run the debug script to see raw serial communication:

```bash
# Build first
npm run build

# Run debug monitor
node dist/debug-server.js /dev/cu.usbserial-FTE90ZVP 230400
```

This will show you:
- ✅ Whether serial port opens successfully
- 📨 All bytes received from FDC+
- 📤 Responses being sent
- 🔍 Parsed command structure

### **2. Run with Verbose + Debug**

```bash
npm run dev -- -p /dev/cu.usbserial-FTE90ZVP -0 disks/test.dsk -v -d
```

This enables:
- **Verbose**: Shows hex dumps of all protocol traffic
- **Debug**: Shows internal state and operations

---

## 🐛 Common Issues

### **Issue 1: No Commands Received**

**Symptoms:**
- Terminal shows "----" for command
- No STAT, READ, or WRIT commands appear
- Computer doesn't boot

**Causes & Solutions:**

**A. Wrong Serial Port**
```bash
# List all serial ports
ls /dev/cu.* /dev/tty*

# Try each USB serial port
npm run dev -- -p /dev/cu.usbserial-FTE90ZVP -0 disks/test.dsk -v
```

**B. Wrong Baud Rate**
The FDC+ supports multiple baud rates. Try:
```bash
# Try 230400 (default)
npm run dev -- -p /dev/cu.usbserial-FTE90ZVP -b 230400 -0 disks/test.dsk -v

# Try 460800 (higher speed)
npm run dev -- -p /dev/cu.usbserial-FTE90ZVP -b 460800 -0 disks/test.dsk -v

# Try 76800 (lower speed)
npm run dev -- -p /dev/cu.usbserial-FTE90ZVP -b 76800 -0 disks/test.dsk -v
```

**C. Serial Port Already in Use**
```bash
# Check what's using the port
lsof | grep usbserial

# Kill other processes if needed
# (Be careful - make sure you know what you're killing)
```

**D. Hardware Not Configured**
- Check FDC+ board jumpers and settings
- Verify serial cable is properly connected
- Ensure FDC+ is in serial disk mode (not SD card mode)

**E. Flow Control Issues (CRITICAL)**
If the C version works but TypeScript version shows no data:
- **Root Cause**: serialport library enables flow control by default
- **Solution**: Already fixed in v2.0+ (flow control explicitly disabled)
- **Verify**: Check that serial port opens successfully in debug mode
- The TypeScript version now matches C version's termios settings:
  - No RTS/CTS hardware flow control (rtscts: false)
  - No XON/XOFF software flow control (xon: false, xoff: false)
  - No input/output processing

If you modified serial.ts, ensure these settings are present:
```typescript
rtscts: false,         // No RTS/CTS hardware flow control
xon: false,            // No XON/XOFF software flow control
xoff: false,
xany: false,
lock: false,
```

### **Issue 2: Commands Received But No Response**

**Symptoms:**
- You see commands in debug output
- Computer hangs or times out
- Disk activity light doesn't blink

**Possible Causes:**

**A. Checksum Issues**
Run the debug script and check if checksums match:
```bash
node dist/debug-server.js /dev/cu.usbserial-FTE90ZVP
```

**B. Timing Issues**
The TypeScript version might respond too slowly. Check response times:
- Commands should be processed in < 100ms
- Track reads should take < 500ms

**C. Disk Image Not Mounted**
```bash
# Verify disk image exists
ls -lh disks/test.dsk

# Check it's actually mounted (look for Drive 0 showing filename in UI)
```

### **Issue 3: Disk Image Errors**

**Symptoms:**
- Sees "DISK NOT MOUNTED" or "READ TRACK" errors
- Drive shows "--ERROR--" in UI

**Solutions:**

**A. File Permissions**
```bash
# Make disk images readable
chmod 644 disks/*.dsk

# For write operations, ensure they're writable
chmod 666 disks/test.dsk
```

**B. File Path Issues**
```bash
# Use absolute path
npm run dev -- -p /dev/cu.usbserial-FTE90ZVP -0 /Users/mreppot/src/fds-ts/disks/test.dsk -v

# Or ensure you're in the right directory
cd /Users/mreppot/src/fds-ts
npm run dev -- -p /dev/cu.usbserial-FTE90ZVP -0 disks/test.dsk -v
```

**C. Corrupt Disk Image**
```bash
# Check file size (should be multiple of 4384 bytes)
ls -l disks/test.dsk

# For testing, create a blank disk
dd if=/dev/zero of=disks/blank.dsk bs=4384 count=77
```

### **Issue 4: Computer Boots But Crashes**

**Symptoms:**
- Initial boot works
- Crashes during disk operations
- Random read/write errors

**Causes:**

**A. Track Calculation Errors**
Check the server verbose output - track numbers should be 0-76.

**B. Read/Write Timeouts**
Serial communication is timing out. Try:
- Lower baud rate
- Better quality USB serial adapter
- Shorter serial cable

**C. Data Corruption**
Enable verbose mode and check hex dumps:
```bash
npm run dev -- -p /dev/cu.usbserial-FTE90ZVP -0 disks/test.dsk -v
```

Compare checksums in sent/received data.

---

## 🔬 Advanced Debugging

### **Compare with C Version**

If you have the original C version working:

1. Run C version with same disk image
2. Note what commands are received
3. Compare with TypeScript version output
4. Look for differences in:
   - Response timing
   - Data format
   - Checksum calculation

### **Capture Serial Traffic**

Use a serial port monitor to capture raw traffic:

**macOS:**
```bash
# Install minicom
brew install minicom

# Monitor port (read-only)
minicom -D /dev/cu.usbserial-FTE90ZVP -b 230400
```

**Linux:**
```bash
# Use screen
screen /dev/ttyUSB0 230400

# Or minicom
minicom -D /dev/ttyUSB0 -b 230400
```

### **Enable Node.js Debugging**

```bash
# Run with Node inspector
node --inspect dist/index.js -p /dev/cu.usbserial-FTE90ZVP -0 disks/test.dsk -v

# Then open chrome://inspect in Chrome
```

---

## 📊 What Should You See?

### **Successful Boot Sequence**

```
FDC+ Serial Drive Server v2.0
PORT: cu.usbserial-FTE90ZVP   BAUD RATE: 230400   COMMAND: STAT

Disk 0  test.dsk                    Disk Enable *  Head Load *  Track 0000  RO -
Disk 1                              Disk Enable -  Head Load -  Track ----  RO -
Disk 2                              Disk Enable -  Head Load -  Track ----  RO -
Disk 3                              Disk Enable -  Head Load -  Track ----  RO -
```

Then you should see:
1. **STAT** commands (periodic status checks)
2. **READ** commands (reading boot tracks)
3. Track numbers incrementing (0, 1, 2, ...)
4. Head load indicators changing

### **With Verbose Mode**

```
COMMAND: READ  D:00 T:0000 L:4384

0000: 4E 45 41 44 00 00 11 00 ...   (hex dump of track data)
...
```

---

## 🩺 Health Check Script

Create this script to test basic functionality:

```bash
#!/bin/bash
# health-check.sh

echo "FDC+ Server Health Check"
echo "========================"

# Check serial port
if [ -e /dev/cu.usbserial-FTE90ZVP ]; then
    echo "✅ Serial port exists"
    ls -l /dev/cu.usbserial-FTE90ZVP
else
    echo "❌ Serial port not found"
    echo "Available ports:"
    ls /dev/cu.* 2>/dev/null
    exit 1
fi

# Check disk images
if [ -d disks ]; then
    echo "✅ Disks directory exists"
    echo "Disk images:"
    ls -lh disks/*.dsk 2>/dev/null
else
    echo "❌ Disks directory not found"
    exit 1
fi

# Check build
if [ -d dist ]; then
    echo "✅ Project built"
else
    echo "⚠️  Project not built - run 'npm run build'"
fi

# Check Node.js
NODE_VERSION=$(node -v)
echo "✅ Node.js: $NODE_VERSION"

# Try to open serial port
echo ""
echo "Attempting to open serial port..."
node dist/debug-server.js /dev/cu.usbserial-FTE90ZVP 230400 &
DEBUGPID=$!
sleep 2
kill $DEBUGPID 2>/dev/null

echo ""
echo "If no errors above, try running:"
echo "npm run dev -- -p /dev/cu.usbserial-FTE90ZVP -0 disks/test.dsk -v -d"
```

---

## 🆘 Still Not Working?

### **Information to Gather**

1. **Terminal output** - Copy entire output with `-v -d` flags
2. **Serial port info** - Output of `ls -l /dev/cu.*`
3. **Disk image info** - Output of `ls -lh disks/`
4. **Debug script output** - Run debug-server.js and capture output
5. **FDC+ configuration** - Board settings, jumpers, firmware version

### **Try the C Version**

If the original C version works but TypeScript doesn't:

```bash
# Build C version
cd /path/to/original-fdcsds
./autogen.sh
./configure
make

# Run C version
./fdcsds -p /dev/cu.usbserial-FTE90ZVP -0 test.dsk

# Compare behavior
```

### **Next Steps**

1. Run debug script: `node dist/debug-server.js /dev/cu.usbserial-FTE90ZVP`
2. Power on vintage computer
3. Watch for incoming commands
4. Note what you see (or don't see)
5. Share output for further diagnosis

---

## 📝 Known Limitations

1. **WebSocket** requires modern browser for web interface
2. **Serial timing** may vary by platform (macOS vs Linux)
3. **Large disk images** (>8MB) not fully tested

---

## 🔗 Additional Resources

- Original C version: Check for fdcsds documentation
- FDC+ Manual: http://www.deramp.com
- Serial port debugging: https://serialport.io/docs/
- Node.js debugging: https://nodejs.org/en/docs/guides/debugging-getting-started/

---

**Need more help?** Provide the output from running with `-v -d` flags!
