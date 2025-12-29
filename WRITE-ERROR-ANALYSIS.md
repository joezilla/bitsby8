# Write Error Analysis - EBADF: bad file descriptor

## Error Pattern

```
[2025-12-29T17:58:18.244Z] Writing track - Drive 0, Track 2, Length 4384, Offset 8768, FD 25
[2025-12-29T17:58:18.251Z] EBADF: bad file descriptor, write
```

**Repeated failures for:**
- Drive 0
- Track 2
- Length 4384
- Offset 8768
- File descriptor: 25
- File: disks/LIFEBOAT-IMSAI-CPM22-62K.DSK

## Root Cause Analysis

### Critical Issue: File Handle Mode vs Readonly Flag Mismatch

**Problem Location:** `src/drive.ts` - `writeProtect()` and `mountDrive()` interaction

#### The Bug

1. **File opened with mode based on readonly flag:**
   ```typescript
   // drive.ts:87-90
   const mode = driveState.readonly
     ? fsSync.constants.O_RDONLY   // Read-only mode
     : fsSync.constants.O_RDWR;     // Read-write mode
   ```

2. **Readonly flag can be changed after mount:**
   ```typescript
   // drive.ts:190-200 (writeProtect)
   writeProtect(drive: number, flag: boolean): void {
     driveState.readonly = flag;  // Only changes flag!
     // Does NOT reopen file with new mode!
   }
   ```

3. **Web API allows runtime readonly toggle:**
   ```typescript
   // web-server.ts:349
   this.driveManager.writeProtect(driveId, readonly);
   // File stays open in original mode
   ```

#### The Race Condition

**Scenario A: Mount as RO, Toggle to RW, Write Fails**
1. Mount drive with readonly=true → Opens as O_RDONLY (FD 25)
2. User toggles readonly to false via web UI
3. Drive state shows readonly=false
4. Write operation attempts to write to FD 25
5. **File still open as O_RDONLY** → EBADF error

**Scenario B: File Handle Stale After Toggle**
1. Drive mounted as RW (O_RDWR)
2. Toggle readonly to RO
3. Some systems may invalidate write capability on FD
4. Toggle back to RW
5. FD 25 might be in inconsistent state → EBADF

**Scenario C: Concurrent Access**
1. Web UI toggles readonly during active write
2. File handle becomes invalid mid-operation
3. Write fails with EBADF

### Protocol Compliance Issue

Per `protocol.txt`:
- Server must respond to WRIT command with OK or NOT READY
- If drive not writable, should respond NOT READY (0x0001)
- Current code responds OK even if file opened as RDONLY

**Current Flow:**
```
FDC: WRIT command for Drive 0, Track 2
Server: Checks driveState.readonly (false after toggle)
Server: Responds WRIT OK (ready to receive)
FDC: Sends 4384 bytes of track data
Server: Attempts write to FD opened as O_RDONLY
Result: EBADF error
```

**Should Be:**
```
FDC: WRIT command
Server: Checks file handle actual mode
Server: If FD not writable, respond NOT READY
FDC: Retries or reports error to host
```

### Evidence from Logs

1. **Consistent failure pattern** - Same track, same offset
2. **FD is valid** (25) - Not closed/undefined
3. **EBADF specifically** - File descriptor exists but operation not permitted
4. **No "drive not mounted" errors** - File handle exists in Map
5. **Retries all fail** - EBADF is not transient, won't resolve with retry

### Additional Issues Found

#### 1. No File Mode Validation Before Write

```typescript
// drive.ts:282-285
if (fileHandle.fd === undefined || fileHandle.fd < 0) {
  throw new Error(`Drive ${drive} file handle is invalid`);
}
```

**Missing:** Check if file opened with write capability

#### 2. Retry Logic Doesn't Handle EBADF

```typescript
// drive.ts:56-60
private isTransientError(error: any): boolean {
  const code = error?.code;
  return code === 'EAGAIN' || code === 'EBUSY' || code === 'EINTR' || code === 'EIO';
  // EBADF not listed - not retryable
}
```

**Result:** Retries happen (logs show multiple attempts) but not at this level

#### 3. Protocol Response Timing Issue

```typescript
// server.ts:315 - Responds OK before validating write capability
await this.sendWriteResponse(cmd, FdcError.OK);

// server.ts:330 - Write fails here
await this.driveManager.writeTrack(...);
```

**Problem:** FDC already committed to sending data before server validated write capability

## Solution

### Phase 1: Immediate Fix - Remount on Readonly Toggle

**File:** `src/drive.ts`

Add `remountWithMode()` method:
```typescript
private async remountWithMode(drive: number, readonly: boolean): Promise<void> {
  const driveState = this.drives.get(drive)!;
  const filename = driveState.filename;

  if (!filename || !driveState.mounted) {
    return; // Nothing to remount
  }

  // Close current handle
  const fileHandle = this.fileHandles.get(drive);
  if (fileHandle) {
    await fileHandle.close();
    this.fileHandles.delete(drive);
  }

  // Reopen with correct mode
  const mode = readonly
    ? fsSync.constants.O_RDONLY
    : fsSync.constants.O_RDWR;

  const newHandle = await fs.open(filename, mode);
  driveState.fd = newHandle.fd;
  this.fileHandles.set(drive, newHandle);
}
```

Update `writeProtect()`:
```typescript
async writeProtect(drive: number, flag: boolean): Promise<void> {
  if (drive >= MAX_DRIVES) {
    throw new Error(`Invalid drive number: ${drive}`);
  }

  const driveState = this.drives.get(drive)!;
  const oldFlag = driveState.readonly;

  // Update flag
  driveState.readonly = flag;

  // If mounted and flag changed, remount with correct mode
  if (driveState.mounted && oldFlag !== flag) {
    await this.remountWithMode(drive, flag);
  }

  // Update GPIO LEDs
  getGpioLedController().updateDriveStatus(drive, driveState);
}
```

**Impact:**
- Requires changing `writeProtect` to async
- Web API handler must await the call
- Fixes mode mismatch issue

### Phase 2: Add File Mode Validation

**File:** `src/drive.ts`

Add validation before write:
```typescript
// In writeTrack(), after line 285:
// Validate file is writable (check actual file mode)
try {
  await fileHandle.datasync(); // Test write capability
} catch (error: any) {
  if (error.code === 'EBADF' || error.code === 'EACCES') {
    this.fdcErrno = FdcError.WRITE_ERR;
    throw new Error(`Drive ${drive} file not open for writing (fd=${fileHandle.fd})`);
  }
}
```

### Phase 3: Improve Protocol Response

**File:** `src/server.ts`

Validate before responding OK:
```typescript
// In handleWriteCommand(), before line 315:
// Validate drive is writable
try {
  const driveState = this.driveManager.getDriveState(drive);
  const fileHandle = this.driveManager['fileHandles'].get(drive);

  if (!driveState || !fileHandle || driveState.readonly) {
    await this.sendWriteResponse(cmd, FdcError.NOT_READY);
    return;
  }

  // Test write capability
  try {
    await fileHandle.datasync();
  } catch (error: any) {
    if (error.code === 'EBADF') {
      await this.sendWriteResponse(cmd, FdcError.NOT_READY);
      return;
    }
  }
} catch (error) {
  await this.sendWriteResponse(cmd, FdcError.NOT_READY);
  return;
}

// Now safe to respond OK
await this.sendWriteResponse(cmd, FdcError.OK);
```

### Phase 4: Add Diagnostic Logging

Add to `mountDrive()`:
```typescript
console.log(`Mounted drive ${drive}: ${filename}, mode=${readonly ? 'RO' : 'RW'}, fd=${fileHandle.fd}`);
```

Add to `writeProtect()`:
```typescript
console.log(`WriteProtect drive ${drive}: ${flag ? 'RO' : 'RW'}, mounted=${driveState.mounted}, remounting=${oldFlag !== flag}`);
```

## Testing Plan

### Test Case 1: Toggle RO During Operation
1. Mount drive as RW
2. Start write operations (run CP/M program)
3. Toggle readonly to RO via web UI
4. Observe: Write should fail gracefully with NOT READY
5. Toggle back to RW
6. Observe: Writes should resume

### Test Case 2: Mount RO, Toggle to RW
1. Mount drive with readonly=true
2. Verify file opened as O_RDONLY
3. Toggle readonly to false
4. Verify file reopened as O_RDWR
5. Perform write operation
6. Verify: Success

### Test Case 3: Write to RO Drive
1. Mount drive as RO
2. Attempt write from CP/M
3. Verify: Server responds NOT READY (not OK then EBADF)

## Implementation Priority

1. **HIGH - Phase 1**: Remount on readonly toggle (fixes root cause)
2. **MEDIUM - Phase 3**: Protocol response validation (prevents EBADF after OK)
3. **LOW - Phase 2**: File mode validation (defense in depth)
4. **LOW - Phase 4**: Diagnostic logging (debugging)

## Risks

### Breaking Changes
- `writeProtect()` becomes async
- Web API must be updated to await
- May affect other callers

### Mitigation
- Update all callers of `writeProtect()`
- Add error handling for remount failures
- Log all mode changes for debugging

## Alternative Solutions Considered

### ❌ Check File Mode on Every Write
**Rejected:** Too much overhead, doesn't fix root cause

### ❌ Disallow Readonly Toggle on Mounted Drives
**Rejected:** Reduces functionality, user frustration

### ✅ Remount on Readonly Change
**Selected:** Fixes root cause, maintains functionality, clean solution

## Files to Modify

| File | Function | Change Type |
|------|----------|-------------|
| `src/drive.ts` | `writeProtect()` | Make async, add remount |
| `src/drive.ts` | `remountWithMode()` | New method |
| `src/web-server.ts` | `/api/drives/:id/readonly` | Await writeProtect |
| `src/index.ts` | Initialization | Await writeProtect calls |
| `src/server.ts` | `handleWriteCommand()` | Add validation before OK |

## Next Steps

1. Implement Phase 1 fix
2. Update all writeProtect() callers
3. Test with actual hardware
4. Monitor logs for EBADF recurrence
5. If fixed, implement remaining phases
