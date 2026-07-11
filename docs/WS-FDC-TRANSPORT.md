# FDC+ WebSocket Transport Protocol

This document specifies the WebSocket interface that lets a **virtual FDC controller** inside an Altair 8800 simulator exchange disk I/O with fdcplus-web without a physical serial connection.

The underlying command set is identical to the serial FDC+ protocol (see `PROTOCOL.md`). The difference is the transport layer: instead of a physical serial line at 403.2 K baud with checksum framing, commands are carried over a standard WebSocket connection as raw binary frames — no checksums, because WebSocket over TCP already guarantees ordered, lossless delivery.

---

## 1. Connection

### Endpoint

```
ws://<host>:<port>/fdc-ws
```

The WebSocket server shares the same TCP port as the fdcplus-web HTTP interface (default **3000**).

### Authentication

If an API key is configured on the server, every connection must present it. Two forms are accepted:

| Method | Example |
|---|---|
| HTTP `Authorization` header (preferred) | `Authorization: Bearer mysecretkey` |
| `token` query parameter (fallback) | `ws://host:3000/fdc-ws?token=mysecretkey` |

If no API key is configured the endpoint accepts unauthenticated connections. An unauthorized connection receives an HTTP `401 Unauthorized` response during the WebSocket upgrade handshake and the socket is closed — no WebSocket frames are exchanged.

### Single-client model

Only one virtual FDC client may be active at a time. A new connection automatically displaces any previous client. This mirrors the physical world where only one FDC controller can be wired to the server at a time.

---

## 2. Wire Format

All data flows as **binary WebSocket frames** (`Buffer` / `Uint8Array`). The server never sends text frames and ignores any it receives.

### Checksum note

The serial protocol appends a 2-byte little-endian checksum after every command block and after every block of track data. **The WebSocket transport omits all checksums.** Do not send them; the server will not send them. Error codes `0x02` (CHKSUM_ERR) are never generated over WebSocket.

### Message framing

There is no framing envelope beyond the WebSocket frame itself. You may send a command block as a single 8-byte frame or split it across multiple frames — the server accumulates bytes until it has the expected count before acting. Likewise the server may send a response as one frame or several; your client must accumulate until the expected byte count is satisfied.

In practice, sending one WebSocket frame per logical message (command block or track data payload) is the simplest implementation and is what the reference server does.

---

## 3. Command Block Structure

Every command from the virtual FDC to the server, and every response from the server back to the FDC, uses the same 8-byte block:

```
Offset  Size  Type         Description
──────  ────  ───────────  ───────────────────────────────────────
0       4     ASCII bytes  Command / response mnemonic
4       2     uint16 LE    Parameter 1 (meaning is command-specific)
6       2     uint16 LE    Parameter 2 (meaning is command-specific)
```

All multi-byte integers are **little-endian**.

---

## 4. Commands

The FDC (client) initiates every transaction. The server never sends an unsolicited message.

---

### 4.1 STAT — Drive Status

Used by the FDC to report its current head-load and track position, and to poll which drives are ready. The FDC issues STAT approximately ten times per second during normal operation.

**Client → Server (8 bytes)**

| Field    | Value |
|---|---|
| `cmd`    | `"STAT"` |
| `param1` | `(headLoad << 8) \| drive` |
| `param2` | Current track number |

- `drive` — selected drive number (0–15). Use `0xFF` if no drive is selected.
- `headLoad` — `0` = head unloaded, non-zero = head loaded.
- `track` — track the head is currently positioned on.

**Server → Client (8 bytes)**

| Field    | Value |
|---|---|
| `cmd`    | `"STAT"` |
| `param1` | Echoed from request |
| `param2` | Ready-drive bitmap |

- `param2` is a 16-bit bitmask: **bit *N* set** means drive *N* is mounted and ready. A drive that is mounted but inside its swap-invalidation window (≈2.5 s after a hot image swap) is reported as not-ready to force the FDC firmware to flush its track cache before the new image is served.

---

### 4.2 READ — Read Track

Read a full track from a mounted disk image.

**Client → Server (8 bytes)**

| Field    | Value |
|---|---|
| `cmd`    | `"READ"` |
| `param1` | `(drive << 12) \| track` |
| `param2` | Expected byte count for this track (`length`) |

- `drive` occupies bits 15–12 (high nibble of the high byte).
- `track` occupies bits 11–0.

**Server → Client (`length` bytes)**

Raw track data with no header or framing. The number of bytes returned equals `param2` from the request.

If the requested drive is not mounted or an I/O error occurs the server may return a zero-filled buffer of the requested length. Callers should treat all-zero data on an expected-to-be-ready drive as a soft error and retry.

---

### 4.3 WRIT — Write Track

Write a full track to a mounted disk image. This is a two-phase transaction.

#### Phase 1 — Request and acknowledgement

**Client → Server (8 bytes)**

| Field    | Value |
|---|---|
| `cmd`    | `"WRIT"` |
| `param1` | `(drive << 12) \| track` (same encoding as READ) |
| `param2` | Byte count of track data to follow (`length`) |

**Server → Client (8 bytes)**

| Field    | Value |
|---|---|
| `cmd`    | `"WRIT"` |
| `param1` | Status code (see §6) |
| `param2` | `0` |

If `param1 != 0x00` (OK) **abort** — do not send track data. The write was rejected (drive not mounted, drive is read-only, or other error).

#### Phase 2 — Track data and write status (only if phase 1 returned OK)

**Client → Server (`length` bytes)**

Raw track data, no framing.

**Server → Client (8 bytes)**

| Field    | Value |
|---|---|
| `cmd`    | `"WSTA"` |
| `param1` | Status code (see §6) |
| `param2` | `0` |

---

## 5. Parameter Encoding Reference

### STAT param1 encoding

```
Bits 15–8: headLoad   (0 = unloaded, non-zero = loaded)
Bits  7–0: drive      (0–15; 0xFF = no drive selected)
```

### READ / WRIT param1 encoding

```
Bits 15–12: drive     (0–15)
Bits 11– 0: track     (0–76 for 8-inch; 0–16 for mini-disk)
```

### Constructing param1 examples (pseudo-code)

```
// STAT: drive 0, head loaded, track 12
param1_stat = (1 << 8) | 0           // = 0x0100

// READ/WRIT: drive 2, track 35
param1_rw   = (2 << 12) | 35         // = 0x2023
```

---

## 6. Status / Error Codes

These appear in `param1` of WRIT acknowledgements and WSTA responses.

| Code   | Name         | Meaning |
|--------|--------------|---------|
| `0x00` | `OK`         | Operation succeeded |
| `0x01` | `NOT_READY`  | Drive not mounted, inside swap-invalidation window, or drive number out of range |
| `0x02` | `CHKSUM_ERR` | Unused over WebSocket (serial-only) |
| `0x03` | `WRITE_ERR`  | Disk-image write failed, or drive is mounted read-only |

---

## 7. Disk Geometry

The server determines track length from the mounted disk image. Always use the `param2` value your FDC firmware would normally report for the given disk type; the server validates it against the actual image geometry.

| Format           | Tracks | Bytes / track | Total |
|------------------|--------|---------------|-------|
| 8-inch floppy    | 77     | 4,384         | 337 KB |
| Mini-disk        | 17     | varies        | 75 KB  |
| 8 MB hard disk   | varies | varies        | 8 MB   |

Track data is 137-byte CDBL physical sectors packed without gaps. Tracks 0–5 use a boot-sector framing; tracks 6+ use a data-sector framing with skew applied. The server handles all of this internally — your client sends and receives opaque byte arrays.

The maximum single track payload the server will accept is **4,384 bytes** (`MAX_TRACK_LEN = 137 × 32`).

---

## 8. Session Flow

The virtual FDC drives the session with a polling loop that mirrors what the physical hardware does:

```
1. connect  ws://host:3000/fdc-ws?token=<key>

2. loop:
     a. Send STAT(drive, headLoad, track)
        Recv STAT response → check ready-drive bitmap
        If target drive bit is 0: no disk mounted, idle or wait

     b. If a READ is needed:
          Send READ(drive, track, length)
          Recv <length> bytes → track_data

     c. If a WRITE is needed:
          Send WRIT(drive, track, length)
          Recv WRIT ack
          If ack.param1 == 0x00 (OK):
            Send <length> bytes of track_data
            Recv WSTA
          Else:
            Handle error (drive not ready / write protected)

3. repeat from step 2
```

There is no session setup message or capability negotiation — the first message from the client is simply the first STAT command.

---

## 9. Disk Management (REST API)

The WebSocket transport handles only raw FDC I/O (STAT / READ / WRIT). All disk-library and drive management operations use the existing REST API:

| Operation | Endpoint |
|---|---|
| List mounted drive state | `GET /api/drives` |
| Mount a disk image | `POST /api/drives/:drive/mount` |
| Unmount a drive | `POST /api/drives/:drive/unmount` |
| Set drive read-only | `PUT /api/drives/:drive/readonly` |
| List available disk images | `GET /api/images` |
| Upload a new disk image | `POST /api/images` |
| Format / create blank image | `POST /api/images/format` |
| Enable disk serving | `POST /api/disk-serving/enable` |
| Disable disk serving | `POST /api/disk-serving/disable` |

Full REST documentation is available at `GET /api/docs` (Swagger UI) once the server is running.

To enable disk serving over the WebSocket transport: connect your WebSocket client first, then call `POST /api/disk-serving/enable`. The server detects that no serial port is configured and automatically uses the connected WebSocket client as the transport.

---

## 10. Reconnection

When the WebSocket connection drops, `FdcServer` idles on the `!transport.isOpen()` path — no commands are processed and no errors are thrown. Disk serving does not need to be re-enabled. Reconnect normally and the server resumes processing commands on the first received byte.

If a new connection arrives while one is already active, the previous connection is closed and the new one takes its place immediately.

---

## 11. Example Implementation Sketches

### JavaScript / Node.js (ws library)

```javascript
import WebSocket from 'ws';

const WS_URL = 'ws://localhost:3000/fdc-ws?token=mysecretkey';

function makeStatCmd(drive, headLoad, track) {
  const buf = Buffer.alloc(8);
  buf.write('STAT', 0, 'ascii');
  buf.writeUInt16LE((headLoad << 8) | (drive & 0xff), 4);
  buf.writeUInt16LE(track, 6);
  return buf;
}

function makeReadCmd(drive, track, length) {
  const buf = Buffer.alloc(8);
  buf.write('READ', 0, 'ascii');
  buf.writeUInt16LE(((drive & 0xf) << 12) | (track & 0xfff), 4);
  buf.writeUInt16LE(length, 6);
  return buf;
}

const ws = new WebSocket(WS_URL);
ws.on('open', () => {
  // Send a STAT for drive 0, head loaded, track 0
  ws.send(makeStatCmd(0, 1, 0));
});
ws.on('message', (data) => {
  const cmd = data.toString('ascii', 0, 4);
  if (cmd === 'STAT') {
    const bitmap = data.readUInt16LE(6);
    const drive0ready = (bitmap & 0x01) !== 0;
    console.log('Drive 0 ready:', drive0ready);
  }
});
```

### Python (websockets library)

```python
import asyncio
import struct
import websockets

WS_URL = 'ws://localhost:3000/fdc-ws?token=mysecretkey'

def make_stat(drive, head_load, track):
    return b'STAT' + struct.pack('<HH', (head_load << 8) | (drive & 0xff), track)

def make_read(drive, track, length):
    param1 = ((drive & 0xf) << 12) | (track & 0xfff)
    return b'READ' + struct.pack('<HH', param1, length)

async def fdc_loop():
    async with websockets.connect(WS_URL) as ws:
        # Poll STAT for drive 0
        await ws.send(make_stat(0, 1, 0))
        resp = await ws.recv()
        cmd = resp[0:4]
        bitmap = struct.unpack_from('<H', resp, 6)[0]
        print(f'STAT response: cmd={cmd}, ready bitmap={bitmap:#06x}')

        if bitmap & 0x01:
            # Drive 0 is ready — read track 1
            await ws.send(make_read(0, 1, 4384))
            track_data = b''
            while len(track_data) < 4384:
                track_data += await ws.recv()
            print(f'Track 1: {len(track_data)} bytes received')

asyncio.run(fdc_loop())
```

### C (libwebsockets sketch)

```c
/* Command block helpers */
static void encode_stat(uint8_t *buf, uint8_t drive,
                        uint8_t head_load, uint16_t track)
{
    memcpy(buf, "STAT", 4);
    uint16_t p1 = ((uint16_t)head_load << 8) | drive;
    memcpy(buf + 4, &p1, 2);   /* little-endian on LE host */
    memcpy(buf + 6, &track, 2);
}

static void encode_read(uint8_t *buf, uint8_t drive,
                        uint16_t track, uint16_t length)
{
    memcpy(buf, "READ", 4);
    uint16_t p1 = ((uint16_t)(drive & 0xf) << 12) | (track & 0xfff);
    memcpy(buf + 4, &p1, 2);
    memcpy(buf + 6, &length, 2);
}
```

---

## 12. Quick Reference

### Command summary

| Cmd    | Direction        | param1                          | param2          |
|--------|------------------|---------------------------------|-----------------|
| `STAT` | Client → Server  | `(headLoad<<8) \| drive`        | track           |
| `STAT` | Server → Client  | echoed                          | ready bitmap    |
| `READ` | Client → Server  | `(drive<<12) \| track`          | length          |
| —      | Server → Client  | *(raw track data, no header)*   |                 |
| `WRIT` | Client → Server  | `(drive<<12) \| track`          | length          |
| `WRIT` | Server → Client  | status code                     | `0`             |
| —      | Client → Server  | *(raw track data, no header)*   |                 |
| `WSTA` | Server → Client  | status code                     | `0`             |

### Status codes

| Value  | Meaning |
|--------|---------|
| `0x00` | OK |
| `0x01` | NOT_READY |
| `0x03` | WRITE_ERR |

### Key differences from serial protocol

| Aspect | Serial | WebSocket |
|---|---|---|
| Transport | RS-232, 403.2 K / 460.8 K baud | TCP WebSocket |
| Checksums | 2-byte LE checksum after every block | **None** |
| Command block size | 10 bytes (8 data + 2 checksum) | **8 bytes** |
| Track data size | `length + 2` bytes (data + checksum) | **`length` bytes** |
| Authentication | Physical access | Bearer token or `?token=` |
| Initiator | FDC hardware | Virtual FDC client |
