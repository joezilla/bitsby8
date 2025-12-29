# Script Replay Character Loss - Analysis and Fix Plan

## Problem Statement
Script replay against the serial console randomly misses characters, making automated command execution unreliable.

## Root Cause Analysis

### 1. **Bulk Character Transmission** (PRIMARY ISSUE)
**Location:** `public/index.html:3980`
```javascript
socket.emit('terminal:write', command + '\r');
```

**Problem:** The entire command string (potentially 50+ characters) is sent as a single block to the serial port. Serial devices with small input buffers (typically 16-128 bytes) cannot handle this burst of data.

**Evidence:**
- Serial ports are character-oriented, not packet-oriented
- Old computers (CP/M, DOS, vintage systems) have minimal buffering
- UART hardware buffers are typically 16 bytes or less

### 2. **No Inter-Character Delay**
**Problem:** Characters arrive faster than the receiving device can process them, especially at higher baud rates (9600+).

**Calculation Example:**
- At 9600 baud: ~960 characters/second = ~1ms per character
- Character processing on vintage systems: 5-50ms per character
- Result: Serial buffer overflow and dropped characters

### 3. **Inadequate Inter-Command Delay**
**Location:** `public/index.html:3983`
```javascript
await new Promise(resolve => setTimeout(resolve, 500));
```

**Problem:**
- 500ms may not be enough for command execution (disk access, processing)
- Fixed delay doesn't account for varying command complexity
- No feedback mechanism to verify command completion

### 4. **Flow Control Disabled by Default**
**Location:** `src/terminal-serial.ts:28`
```typescript
flowControl: 'none',
```

**Problem:**
- No hardware (RTS/CTS) flow control
- No software (XON/XOFF) flow control
- Receiving device cannot signal "buffer full, slow down"

**Note:** Flow control UI exists but defaults to 'none'

### 5. **No Echo Verification**
**Problem:** Script doesn't wait for character echo before sending next character. This is crucial for interactive systems that echo each character.

### 6. **Serial Port Drain Only**
**Location:** `src/terminal-serial.ts:159`
```typescript
this.port!.drain((drainError) => { ... });
```

**Issue:** `drain()` only waits for OS buffer to empty, not for receiving device to process characters.

## Technical Details

### Current Data Flow
```
Browser (replayScript)
  ↓ [Full command string]
WebSocket (socket.emit)
  ↓ [Full command string]
Server (terminal:write handler)
  ↓ [Full command string]
TerminalSerialManager.write()
  ↓ [Full command string]
SerialPort.write()
  ↓ [Buffer overflow risk]
Serial Device (16-byte buffer)
  ↓ [Lost characters!]
Terminal/Computer
```

### Baud Rate Impact
| Baud Rate | Char/sec | Time/char | Buffer fill (16 chars) |
|-----------|----------|-----------|------------------------|
| 300       | 30       | 33ms      | 533ms                  |
| 1200      | 120      | 8ms       | 133ms                  |
| 9600      | 960      | 1ms       | 16ms                   |
| 19200     | 1920     | 0.5ms     | 8ms                    |
| 115200    | 11520    | 0.087ms   | 1.4ms                  |

**At 9600 baud:** A 30-character command fills the buffer in 16ms, but processing might take 150ms+

## Solution Plan

### Phase 1: Immediate Fix - Character-by-Character Transmission

**Priority:** HIGH
**Complexity:** Medium
**Files to modify:** `public/index.html`

#### Changes:
1. **Add configurable timing parameters**
   ```javascript
   const SCRIPT_CHAR_DELAY_MS = 10;  // Delay between characters
   const SCRIPT_CMD_DELAY_MS = 500;   // Delay between commands
   const SCRIPT_WAIT_FOR_ECHO = false; // Future: echo verification
   ```

2. **Implement character-by-character sending**
   ```javascript
   async function replayScript() {
     // ... existing validation ...

     for (let i = 0; i < commands.length; i++) {
       const command = commands[i];

       // Send character by character
       for (let j = 0; j < command.length; j++) {
         socket.emit('terminal:write', command[j]);
         await new Promise(resolve => setTimeout(resolve, SCRIPT_CHAR_DELAY_MS));
       }

       // Send newline
       socket.emit('terminal:write', '\r');

       // Wait before next command
       await new Promise(resolve => setTimeout(resolve, SCRIPT_CMD_DELAY_MS));
     }
   }
   ```

**Benefits:**
- ✅ Prevents buffer overflow
- ✅ Works with all baud rates
- ✅ Simple to implement
- ✅ No server-side changes needed

**Limitations:**
- ⚠️ Fixed timing (no adaptive adjustment)
- ⚠️ No echo verification

### Phase 2: Configuration UI

**Priority:** MEDIUM
**Complexity:** Low
**Files to modify:** `public/index.html`

#### Add Settings Panel:
```html
<div class="script-settings">
  <label>
    Character Delay (ms):
    <input type="number" id="scriptCharDelay" value="10" min="0" max="1000">
  </label>
  <label>
    Command Delay (ms):
    <input type="number" id="scriptCmdDelay" value="500" min="0" max="5000">
  </label>
  <label>
    <input type="checkbox" id="scriptWaitForEcho">
    Wait for Echo (slower but safer)
  </label>
</div>
```

**Location:** Add near terminal controls (line ~1813)

### Phase 3: Flow Control Improvement

**Priority:** MEDIUM
**Complexity:** Low
**Files to modify:** `public/index.html`

#### Enable software flow control by default for terminal:
```javascript
async function connectTerminal() {
  // ... existing code ...
  flowControl: 'software'  // Enable XON/XOFF
}
```

**Benefits:**
- ✅ Hardware flow control for compatible devices
- ✅ Software flow control (XON/XOFF) widely supported
- ✅ Device can signal when ready

**Note:** User can still override in configuration

### Phase 4: Echo Verification (Advanced)

**Priority:** LOW
**Complexity:** HIGH
**Files to modify:** `public/index.html`, `src/web-server.ts`

#### Concept:
```javascript
async function sendCharacterWithEcho(char) {
  return new Promise((resolve, reject) => {
    let echoReceived = false;
    const timeout = setTimeout(() => {
      if (!echoReceived) reject(new Error('Echo timeout'));
    }, 1000);

    const echoHandler = (data) => {
      if (data.includes(char)) {
        echoReceived = true;
        clearTimeout(timeout);
        socket.off('terminal:data', echoHandler);
        resolve();
      }
    };

    socket.on('terminal:data', echoHandler);
    socket.emit('terminal:write', char);
  });
}
```

**Benefits:**
- ✅ Guaranteed delivery verification
- ✅ Adaptive timing based on actual device speed

**Challenges:**
- ⚠️ Requires echo to be enabled on terminal
- ⚠️ More complex error handling
- ⚠️ May not work with all systems

### Phase 5: Smart Timing (Future Enhancement)

**Priority:** LOW
**Complexity:** MEDIUM

#### Auto-adjust delays based on:
- Baud rate (faster = longer delays needed)
- Command type (disk operations need more time)
- Historical success rate

## Testing Strategy

### Test Cases:
1. **Short commands (5-10 chars)** - Should work with minimal delay
2. **Long commands (50+ chars)** - Primary failure case
3. **Rapid fire (many commands)** - Test inter-command delay
4. **Different baud rates** - 300, 1200, 9600, 19200, 115200
5. **Real systems** - CP/M, DOS, Linux, BSD

### Success Metrics:
- ✅ 100% character delivery (no drops)
- ✅ Readable terminal output
- ✅ Commands execute correctly
- ⚠️ Acceptable replay speed (trade-off with reliability)

## Recommended Implementation Order

1. **Immediate (Day 1):**
   - Implement character-by-character transmission with fixed 10ms delay
   - Test with existing scripts

2. **Short-term (Week 1):**
   - Add configuration UI for delays
   - Enable software flow control by default
   - Document usage in README

3. **Medium-term (Optional):**
   - Add echo verification mode
   - Implement smart timing

## Code Locations

| File | Lines | Description |
|------|-------|-------------|
| `public/index.html` | 3939-3988 | `replayScript()` function |
| `public/index.html` | 1804-1808 | Flow control selector |
| `src/terminal-serial.ts` | 146-169 | `write()` method |
| `src/terminal-serial.ts` | 23-29 | Default terminal config |
| `src/web-server.ts` | 1053-1061 | `terminal:write` handler |

## Alternative Solutions Considered

### ❌ Server-side Buffering
**Rejected:** Adds latency, doesn't solve root cause

### ❌ Increase Serial Buffer Size
**Rejected:** Not possible - hardware limitation

### ❌ Hardware Flow Control Only
**Rejected:** Requires compatible cables/devices

### ✅ Character-by-Character + Configurable Delays
**Selected:** Best balance of reliability, simplicity, and compatibility

## References

- SerialPort Node.js docs: https://serialport.io/docs/
- Flow Control: https://en.wikipedia.org/wiki/Flow_control_(data)
- UART Buffers: Typically 16 bytes (16550), 64 bytes (16750)
- XON/XOFF: Software flow control standard (Ctrl+S/Ctrl+Q)

## Next Steps

1. Review this plan with stakeholders
2. Implement Phase 1 (character-by-character)
3. Test with real hardware
4. Iterate based on results
5. Document recommended settings for different systems
