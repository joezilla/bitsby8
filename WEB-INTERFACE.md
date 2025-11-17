# FDC+ Serial Drive Server - Web Interface

## 🌐 Overview

The web interface provides real-time monitoring and remote management of the FDC+ Serial Drive Server through your web browser. You can view drive status, mount/unmount disk images, and change drive settings - all in real-time!

---

## ✨ Features

✅ **Real-Time Status Updates** - WebSocket-based live updates every second
✅ **Drive Management** - Mount and unmount disk images remotely
✅ **Write Protection** - Toggle read-only status on any drive
✅ **Serial Port Monitoring** - View connection status and baud rate
✅ **Track Position Display** - See current head position and track number
✅ **Modern UI** - Clean, responsive interface with live notifications
✅ **REST API** - Full API for automation and integration

---

## 🚀 Quick Start

### **Enable Web Interface**

Add the `-w` or `--web` flag when starting the server:

```bash
# With development mode
npm run dev -- -p /dev/cu.usbserial-114110 -0 disks/test.dsk -w

# With production mode
npm start -- -p /dev/cu.usbserial-114110 -0 disks/test.dsk -w

# Using the launcher script
./fdcsds.sh -p /dev/cu.usbserial-114110 -0 disks/test.dsk -w
```

### **Access the Interface**

Open your web browser and navigate to:
```
http://localhost:3000
```

That's it! You'll see the live status of all drives.

---

## ⚙️ Configuration Options

### **Custom Port**

```bash
./fdcsds.sh -p /dev/cu.usbserial-114110 -w --web-port 8080
```

Access at: `http://localhost:8080`

### **Custom Host**

```bash
./fdcsds.sh -p /dev/cu.usbserial-114110 -w --web-host 0.0.0.0 --web-port 3000
```

Access from any device on your network at: `http://your-ip:3000`

### **All Options**

```bash
./fdcsds.sh \
  -p /dev/cu.usbserial-114110 \
  -0 disks/cpm22.dsk \
  -w \
  --web-port 3000 \
  --web-host localhost
```

---

## 🎮 Using the Web Interface

### **Dashboard Overview**

The interface shows:

**Header:**
- Serial connection status (green = connected, red = disconnected)
- Connected serial device path
- Current baud rate
- Last update timestamp

**Drive Cards (4 drives shown):**
- Drive number and mount status badge
- Currently mounted disk image filename
- Current track position
- Head load status (loaded/unloaded)
- Write protection status (read-only/read-write)

### **Mounting a Disk Image**

1. Select a disk image from the dropdown menu
2. Click the **Mount** button
3. Watch the status update in real-time!

The dropdown automatically lists all `.dsk`, `.img`, and `.ima` files in your `disks/` directory.

### **Unmounting a Disk**

1. Click the **Unmount** button on any mounted drive
2. The drive will show as "Empty" immediately

### **Setting Write Protection**

1. Check the "Read-Only" checkbox to protect a drive
2. Uncheck to allow writes
3. Changes apply immediately

---

## 🔌 REST API

The web server provides a full REST API for automation.

### **Base URL**

```
http://localhost:3000/api
```

### **Endpoints**

#### **GET /api/status**

Get complete server status.

**Response:**
```json
{
  "serial": {
    "connected": true,
    "device": "/dev/cu.usbserial-114110",
    "baudRate": 230400
  },
  "drives": [
    {
      "id": 0,
      "mounted": true,
      "filename": "cpm22.dsk",
      "fullPath": "/path/to/disks/cpm22.dsk",
      "readonly": false,
      "headLoaded": true,
      "track": 5
    }
  ],
  "timestamp": "2024-11-16T12:00:00.000Z"
}
```

#### **GET /api/drives**

Get all drive statuses.

**Response:**
```json
[
  {
    "id": 0,
    "mounted": true,
    "filename": "cpm22.dsk",
    "readonly": false,
    "headLoaded": true,
    "track": 5
  }
]
```

#### **POST /api/drives/:id/mount**

Mount a disk image to a drive.

**Request:**
```json
{
  "filename": "cpm22.dsk"
}
```

**Response:**
```json
{
  "success": true,
  "drive": 0,
  "filename": "cpm22.dsk"
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/api/drives/0/mount \
  -H "Content-Type: application/json" \
  -d '{"filename":"cpm22.dsk"}'
```

#### **POST /api/drives/:id/unmount**

Unmount a drive.

**Response:**
```json
{
  "success": true,
  "drive": 0
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/api/drives/0/unmount
```

#### **PUT /api/drives/:id/readonly**

Set drive read-only status.

**Request:**
```json
{
  "readonly": true
}
```

**Response:**
```json
{
  "success": true,
  "drive": 0,
  "readonly": true
}
```

**Example:**
```bash
curl -X PUT http://localhost:3000/api/drives/0/readonly \
  -H "Content-Type: application/json" \
  -d '{"readonly":true}'
```

#### **GET /api/images**

List available disk images in the disks directory.

**Response:**
```json
{
  "images": [
    "cpm22.dsk",
    "altdos.dsk",
    "basic.dsk",
    "test.dsk"
  ]
}
```

**Example:**
```bash
curl http://localhost:3000/api/images
```

#### **GET /api/health**

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-11-16T12:00:00.000Z"
}
```

---

## 🔄 WebSocket Events

For real-time updates, connect to the WebSocket server.

### **Connect to WebSocket**

```javascript
const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('Connected to FDC+ server');

  // Request initial status
  socket.emit('request-status');
});

socket.on('status', (status) => {
  console.log('Status update:', status);
  // Handle status update
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
});
```

### **Events**

**Server → Client:**
- `status` - Status update (sent every second and on changes)

**Client → Server:**
- `request-status` - Request immediate status update

---

## 🛠️ Automation Examples

### **Mount All Drives**

```bash
#!/bin/bash
# mount-all.sh

curl -X POST http://localhost:3000/api/drives/0/mount \
  -H "Content-Type: application/json" \
  -d '{"filename":"cpm22.dsk"}'

curl -X POST http://localhost:3000/api/drives/1/mount \
  -H "Content-Type: application/json" \
  -d '{"filename":"altdos.dsk"}'

curl -X POST http://localhost:3000/api/drives/2/mount \
  -H "Content-Type: application/json" \
  -d '{"filename":"basic.dsk"}'
```

### **Check Server Status**

```python
#!/usr/bin/env python3
# check-status.py

import requests
import json

response = requests.get('http://localhost:3000/api/status')
status = response.json()

print(f"Serial: {status['serial']['device']}")
print(f"Connected: {status['serial']['connected']}")
print(f"Baud Rate: {status['serial']['baudRate']}")
print("\nDrives:")
for drive in status['drives']:
    print(f"  Drive {drive['id']}: {drive['filename'] or 'Empty'}")
```

### **Auto-Mount on Startup**

```javascript
// auto-mount.js
const axios = require('axios');

const API_BASE = 'http://localhost:3000/api';

async function autoMount() {
  const mounts = [
    { drive: 0, image: 'cpm22.dsk' },
    { drive: 1, image: 'altdos.dsk' },
  ];

  for (const mount of mounts) {
    try {
      await axios.post(`${API_BASE}/drives/${mount.drive}/mount`, {
        filename: mount.image
      });
      console.log(`Mounted ${mount.image} to drive ${mount.drive}`);
    } catch (error) {
      console.error(`Failed to mount drive ${mount.drive}:`, error.message);
    }
  }
}

autoMount();
```

---

## 🔒 Security Considerations

### **Local Network Only**

By default, the server binds to `localhost` (127.0.0.1), making it accessible only from the same machine.

### **Expose to Network (Use with Caution)**

To allow access from other devices:

```bash
./fdcsds.sh -p /dev/cu.usbserial-114110 -w --web-host 0.0.0.0
```

**⚠️ Warning:** This exposes the server to your entire network. Anyone on your network can:
- View drive status
- Mount/unmount disk images
- Change drive settings

**Recommendations:**
- Only use on trusted networks
- Consider using a firewall
- Add authentication (future feature)
- Use SSH tunnel for remote access:
  ```bash
  ssh -L 3000:localhost:3000 user@remote-server
  ```

---

## 📂 File Management

### **Disk Images Directory**

The web interface lists files from:
```
/path/to/fds-ts/disks/
```

### **Supported File Types**

- `.dsk` - Disk image files
- `.img` - Raw disk images
- `.ima` - Image files

### **Adding New Images**

Just copy files to the `disks/` directory:

```bash
cp my-disk.dsk /path/to/fds-ts/disks/
```

Refresh the web page to see the new image in the dropdowns.

---

## 🐛 Troubleshooting

### **Web Interface Won't Load**

**Check if server is running with `-w` flag:**
```bash
# Must include -w or --web
./fdcsds.sh -p /dev/cu.usbserial-114110 -0 disks/test.dsk -w
```

**Check the port:**
```bash
# Look for this message in output:
# Web interface available at http://localhost:3000
```

**Try accessing directly:**
```bash
curl http://localhost:3000/api/health
# Should return: {"status":"ok","timestamp":"..."}
```

### **Port Already in Use**

```bash
# Use a different port
./fdcsds.sh -p /dev/cu.usbserial-114110 -w --web-port 8080
```

### **Can't Mount Disk Images**

**Check disks directory exists:**
```bash
ls -la disks/
```

**Check file permissions:**
```bash
chmod 644 disks/*.dsk
```

**Check API errors in browser console:**
- Open browser DevTools (F12)
- Check Console tab for errors

### **Real-Time Updates Not Working**

**Check WebSocket connection in browser console:**
```javascript
// Should see:
// Connected to server
```

**Check for firewall blocking WebSocket:**
- WebSockets use same port as HTTP (3000)
- Some corporate firewalls block WebSockets

---

## 🎨 Customization

### **Change Update Frequency**

Edit `src/web-server.ts`:

```typescript
// Update every 2 seconds instead of 1
this.statusInterval = setInterval(() => {
  this.broadcastStatus();
}, 2000);
```

### **Add More Drives to UI**

Edit `public/index.html`:

```typescript
// Show 8 drives instead of 4
for (let i = 0; i < 8; i++) {
```

---

## 📊 Performance

- **WebSocket Updates:** ~1KB per second
- **HTTP API Calls:** <100ms response time
- **Concurrent Connections:** Supports multiple browsers
- **Resource Usage:** Minimal (< 50MB RAM for web server)

---

## 🔮 Future Features

Planned enhancements:
- [ ] User authentication
- [ ] HTTPS support
- [ ] Drag-and-drop disk image upload
- [ ] Disk image creation/formatting tools
- [ ] Command history log
- [ ] Performance metrics graphs
- [ ] Mobile-optimized UI
- [ ] Dark mode theme

---

## 📚 Additional Resources

- **Main README:** See `README-TS.md` for overall documentation
- **API Examples:** Check `examples/` directory (future)
- **Source Code:** `src/web-server.ts` and `public/index.html`

---

For help or issues, please check the GitHub repository!
