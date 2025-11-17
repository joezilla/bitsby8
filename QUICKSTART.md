# FDC+ Serial Drive Server - Quick Start Guide

## Your Working Configuration

**Serial Port**: `/dev/cu.usbserial-FTE90ZVP`
**Baud Rate**: `460800`
**Status**: ✅ Flow control fix applied - serial communication working!

---

## 🚀 Start the Server

### Basic Usage (Terminal UI)

```bash
# With a disk image mounted on Drive 0
npm run dev -- -p /dev/cu.usbserial-FTE90ZVP -b 460800 -0 disks/test.dsk

# Or use the launcher script
./fdcsds.sh -p /dev/cu.usbserial-FTE90ZVP -b 460800 -0 disks/test.dsk
```

### With Verbose Output

```bash
npm run dev -- -p /dev/cu.usbserial-FTE90ZVP -b 460800 -0 disks/test.dsk -v
```

### With Web Interface

```bash
npm run dev -- -p /dev/cu.usbserial-FTE90ZVP -b 460800 -0 disks/test.dsk -w
```

Then open your browser to: **http://localhost:3000**

---

## 🔧 Debug Mode

If you need to troubleshoot:

```bash
# Run debug server to see raw serial communication
node dist/debug-server.js /dev/cu.usbserial-FTE90ZVP 460800
```

This will show:
- ✅ Serial port connection status
- 📨 All bytes received from FDC+
- 📤 Responses being sent
- 🔍 Parsed command details

---

## 💾 Mount Disk Images

Place your `.dsk` files in the `disks/` directory:

```bash
# Example disk images location
disks/
  ├── cpm22.dsk
  ├── altdos.dsk
  ├── basic.dsk
  └── test.dsk
```

Then mount them at startup:

```bash
npm run dev -- \
  -p /dev/cu.usbserial-FTE90ZVP \
  -b 460800 \
  -0 disks/cpm22.dsk \
  -1 disks/altdos.dsk \
  -2 disks/basic.dsk
```

---

## 🌐 Web Interface Features

Start with `-w` flag:

```bash
npm run dev -- -p /dev/cu.usbserial-FTE90ZVP -b 460800 -w
```

**Access at**: http://localhost:3000

**Features**:
- 📊 Real-time drive status
- 💿 Mount/unmount disk images remotely
- 🔒 Toggle write protection
- 📍 View track position and head status
- 🔄 Live updates every second via WebSocket

---

## 🎯 What You Should See

### Successful Connection

```
FDC+ Serial Drive Server v2.0
PORT: cu.usbserial-FTE90ZVP   BAUD RATE: 460800   COMMAND: STAT

Disk 0  cpm22.dsk                   Disk Enable *  Head Load *  Track 0000  RO -
Disk 1                              Disk Enable -  Head Load -  Track ----  RO -
Disk 2                              Disk Enable -  Head Load -  Track ----  RO -
Disk 3                              Disk Enable -  Head Load -  Track ----  RO -
```

### Normal Operation

You should see:
1. **STAT** commands (periodic status checks from FDC+)
2. **READ** commands (reading boot tracks and data)
3. **WRIT** commands (when writing to disk)
4. Track numbers incrementing (0, 1, 2, ...)
5. Head load indicators changing (`*` = loaded, `-` = unloaded)

---

## ⚠️ Important Notes

### Flow Control Fixed ✅

The serial port configuration now matches the C version:
- No RTS/CTS hardware flow control
- No XON/XOFF software flow control
- Direct byte-by-byte communication

**This is critical for FDC+ communication to work!**

### Baud Rate

Your FDC+ is configured for **460800 baud**. If you have issues:

Try these baud rates in order:
1. `460800` (your current working rate)
2. `230400` (common default)
3. `76800` (slower, more reliable)

### Serial Port Name

macOS USB serial ports show up as:
- `/dev/cu.usbserial-*` (non-blocking, use this)
- `/dev/tty.usbserial-*` (blocking, don't use)

Always use the `cu.*` version!

---

## 📚 Additional Documentation

- **Full README**: `README-TS.md`
- **Troubleshooting**: `TROUBLESHOOTING.md`
- **Web Interface**: `WEB-INTERFACE.md`
- **Launcher Script**: `LAUNCHER-USAGE.md`

---

## 🆘 Quick Troubleshooting

### No Commands Received

```bash
# Verify serial port exists
ls -la /dev/cu.usbserial-FTE90ZVP

# Run debug server
node dist/debug-server.js /dev/cu.usbserial-FTE90ZVP 460800
```

### Port Already in Use

```bash
# Find what's using it
lsof | grep usbserial

# Kill the process if needed
kill <PID>
```

### Computer Won't Boot

1. Verify disk image exists: `ls -lh disks/test.dsk`
2. Check baud rate matches FDC+ configuration
3. Ensure FDC+ is in serial disk mode (not SD card mode)
4. Try debug server to see if commands are being received

---

## 🎉 Success!

If everything is working:
- Your vintage computer should boot
- You'll see READ commands in the terminal
- Track numbers will increment as data is read
- The computer OS should load successfully

Enjoy your FDC+ Serial Drive Server! 🚀
