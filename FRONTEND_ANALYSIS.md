# FDC+ Web Frontend Feature Analysis

Comprehensive catalog of every user-facing feature and workflow in the Material Design 3 SPA frontend.

## 1. UI SCREENS/PAGES

The frontend is a single-page application with 7 main sections accessible via navigation drawer:

### 1.1 Terminal Page (`page-terminal`)
- Primary interface for serial communication with Altair 8800 or other serial devices
- VT102 terminal emulator with configurable visual effects

### 1.2 Disks Page (`page-disks`)
- Drive management and disk image library
- 4 physical drives (A-D) with mount/unmount controls
- CP/M file browser for exploring disk contents

### 1.3 Cassettes Page (`page-cassettes`)
- Audio cassette management
- WAV file playback (server-side or client-side)
- Progress tracking for cassette playback

### 1.4 ROMs Page (`page-roms`)
- ROM management (stub - coming soon)

### 1.5 Scripts Page (`page-scripts`)
- Script/automation management
- Text file editor for command sequences
- Script replay/execution

### 1.6 Notes Page (`page-notes`)
- Notes system (stub - coming soon)

### 1.7 Configuration Page (`page-configuration`)
- Global settings for all subsystems
- Primary FDC+ serial connection
- Terminal serial connection (optional second port)
- Web interface settings
- CRT display effects
- Key mapping configuration
- Disk serving toggles

---

## 2. USER ACTIONS BY FEATURE AREA

### 2.1 Terminal Management

**Port & Connection:**
- Connect/disconnect terminal to selected serial port (REST: `/api/terminal/open`, `/api/terminal/close`)
- Select serial port from available ports (REST: `/api/terminal/ports`)
- Configure serial parameters:
  - Baud rate (9600, 19200, 38400, 57600, 115200)
  - Data bits (5, 6, 7, 8)
  - Stop bits (1, 2)
  - Parity (none, even, odd, mark, space)
  - Flow control (none, hardware, software)
- Click status indicator to toggle connection
- Vibration feedback on mobile (navigator.vibrate)

**Terminal Display:**
- Type commands into terminal (Socket: `terminal:write`)
- Clear terminal display
- Toggle fullscreen mode (Ctrl+Shift+F)
- Toggle controls panel visibility (Ctrl+Shift+H)
- View real-time terminal data (Socket: `terminal:data`)
- Display error messages (Socket: `terminal:error`)
- Display status updates (Socket: `terminal:status`)

**CRT Effects:**
- Toggle CRT mode on/off (Ctrl+Shift+R)
- Select CRT variant via right-click or long-press:
  - Modern (no effect)
  - CGA Cyan
  - Green Phosphor
  - Amber Phosphor
- Configure CRT effects (Configuration page):
  - Toggle screen glow
  - Toggle scanlines
  - Toggle vignette

---

### 2.2 Drive Management

**Drive Operations (for each of 4 drives A-D):**
- Select disk image from dropdown (populated from `/api/images`)
- Mount selected disk image (REST: `/api/drives/{driveId}/mount`)
- Unmount currently mounted disk (REST: `/api/drives/{driveId}/unmount`)
- Toggle read-only mode (REST: `/api/drives/{driveId}/readonly`)
- View real-time drive status (Socket: `status`)

**Disk Image Library:**
- Upload new disk image (.dsk, .img, .ima files) - REST: `/api/images/upload`
  - Progress tracking with visual progress bar
  - File name display before upload
- Create new blank disk image with format selection:
  - 8-inch floppy (330K - 77 tracks)
  - Minidisk (75K - 17 tracks)
  - 8MB disk (1863 tracks)
  - Extension selection (.dsk, .img, .ima)
  - Preview before creation
  - REST: `/api/images/create`
- Clone existing disk image (REST: `/api/images/{filename}/clone`)
- Delete disk image (REST: `/api/images/{filename}`)
- View disk details (REST: `/api/images/details`)
- Edit disk notes/description (modal with rich text)

---

### 2.3 CP/M File Browser

**Access:** Browse button on each disk image in library

**File Operations:**
- View list of files on selected disk with metadata:
  - User number
  - Filename and extension
  - File size
  - Attributes (R/O, SYS)
- Download individual CP/M file (REST: `/api/images/{diskName}/cpm/files/{filename}`)
- Delete CP/M file (if disk not mounted) (REST: DELETE `/api/images/{diskName}/cpm/files/{filename}`)
- Upload file to CP/M disk (REST: POST `/api/images/{diskName}/cpm/files`)
  - Rename on upload (optional)
  - User number assignment (0-15)
  - System/Read-only flag options

**Disk Information Display:**
- Total file count
- Free space (bytes)
- Available directory entries
- Block size
- Boot track count
- Mount status indicator (read-only warning if mounted)

---

### 2.4 Cassette Management

**Cassette Operations:**
- Upload audio cassette (.wav files) (REST: `/api/cassettes/upload`)
  - Progress tracking with visual progress bar
- Play cassette on server (REST: `/api/cassettes/{filename}/play`)
  - Real-time progress updates (Socket: `replay:progress`)
  - Status updates (Socket: `replay:status`)
- Play cassette in browser (client-side playback via audio element)
- Stop cassette playback (REST: `/api/cassettes/stop`)
- Stream cassette for browser playback (REST: `/api/cassettes/{filename}/stream`)
- Delete cassette (REST: `/api/cassettes/{filename}`)
- View cassette details (REST: `/api/cassettes/details`)
- Edit cassette notes/description (modal with rich text)

---

### 2.5 Script Management

**Script Operations:**
- View list of available scripts
- Create new script:
  - Name input (auto-adds .txt extension)
  - Content editor (monospace textarea)
  - Save via REST: `/api/scripts` (POST)
- Edit existing script:
  - Load content (REST: `/api/scripts/{name}`)
  - Modify content
  - Save changes (REST: `/api/scripts/{name}` PUT)
- Delete script (REST: `/api/scripts/{name}` DELETE)
- View script list dropdown (lazy-loaded on first interaction)

**Script Execution:**
- Replay selected script with multiple modes:
  - **Raw Mode:**
    - Line ending (CR, LF, CRLF)
    - Chunk size (1-256 bytes per send)
    - Byte delay (ms between bytes)
    - Line delay (ms between lines)
  - **XMODEM Mode:**
    - CRC checksum option
- Toggle replay settings panel
- Start replay (Socket: `replay:start`)
- Cancel replay (Socket: `replay:cancel`)
- Monitor replay progress (Socket: `replay:progress`, `replay:status`)
- View live progress percentage and status

---

### 2.6 Configuration & Settings

**Primary FDC+ Connection:**
- Select serial port (REST: `/api/serial/ports`)
- Configure baud rate (9600 to 230400)
- Set data bits, stop bits, parity
- Set flow control
- Apply configuration (REST: `/api/serial/config`)
- View connection status indicator
- Refresh available ports

**Terminal Connection (Optional):**
- Enable/disable terminal
- Select port from available ports
- Configure baud rate
- Toggle auto-connect on startup
- Refresh ports

**Web Interface:**
- Toggle web interface enabled/disabled
- Set web port (1-65535)
- Set web host/IP address

**CRT Display Effects:**
- Toggle screen glow
- Toggle scanlines
- Toggle vignette
- All apply immediately without restart

**Key Mapping:**
- Switch between preset profiles:
  - VT102 Native (xterm.js default)
  - Mac Backspace Fix
  - CP/M (ADM-3A style)
  - VT100 Standard
  - Unix/Linux (xterm)
  - Custom (user-defined)
- View current key mappings table
- Add custom key mappings:
  - Select key name (Backspace, Delete, Arrows, Home, End, PageUp/Down, Insert, Escape, F1-F12)
  - Enter sequence (hex escape codes like `\x7F` or `\x1B[A`)
  - Add description
  - Delete custom mappings
- Reset to default mappings

**Disk Serving:**
- Toggle disk serving mode on/off (REST: `/api/disk-serving/enable`, `/api/disk-serving/disable`)

---

### 2.7 Keyboard Shortcuts

Global shortcuts accessible from any page:

- **Ctrl+Shift+F:** Toggle terminal fullscreen
- **Ctrl+Shift+H:** Toggle terminal controls visibility
- **Ctrl+Shift+R:** Toggle CRT mode
- **Alt+1:** Navigate to Terminal
- **Alt+2:** Navigate to Disks
- **Alt+3:** Navigate to Cassettes
- **Alt+4:** Navigate to ROMs
- **Alt+5:** Navigate to Scripts
- **Alt+6:** Navigate to Notes
- **Alt+7:** Navigate to Configuration
- **Alt+Left Arrow:** Navigate to previous page
- **Alt+Right Arrow:** Navigate to next page

---

## 3. REAL-TIME STATUS DISPLAYS

### 3.1 Connection Status Indicators

**Terminal Status:**
- Color-coded status dot (connected/disconnected)
- Display selected port name
- Click to toggle connection
- Active label updates in header

**Drive Status:**
- Per-drive mounted/empty indicator chip
- Current filename display
- Real-time updates via Socket status events

**FDC+ Connection:**
- Status dot and label in configuration card
- Updated on status change

**Cassette Playback:**
- Real-time progress bar and percentage
- Current time / total duration display
- Status messages

**Script Replay:**
- Progress bar and percentage
- Status messages
- Cancel button availability

### 3.2 System Status

Socket event listeners:
- `status` - General system status update
- `terminal:status` - Terminal connection status
- `terminal:data` - Incoming terminal data
- `terminal:error` - Terminal errors
- `replay:progress` - Script/cassette replay progress
- `replay:status` - Replay status changes
- `connect` - WebSocket connection
- `disconnect` - WebSocket disconnection

---

## 4. FORMS AND CONFIGURATION

### 4.1 Disk Creation Modal
- **Fields:**
  - Filename input (no extension)
  - Format selector (8-inch, minidisk, 8MB)
  - Extension selector (.dsk, .img, .ima)
  - Live preview display

### 4.2 CP/M File Operations Modal
- **Upload Form:**
  - File input
  - Rename field (optional)
  - User number selector (0-15)
  - System flag toggle
  - Read-only flag toggle

### 4.3 Notes/Description Modal
- **Fields:**
  - Description (short summary)
  - Notes (long-form textarea)
- **Target Types:** Disks, cassettes, scripts

### 4.4 Script Editor Modal
- **Fields:**
  - Script name (text input)
  - Content (monospace textarea)
  - Create vs Edit modes

### 4.5 Replay Settings Panel
- **Raw Mode Options:**
  - Line ending selector
  - Chunk size input
  - Byte delay input
  - Line delay input
- **XMODEM Mode Options:**
  - CRC checksum toggle

---

## 5. ERROR HANDLING

Error display patterns:

- **Toast notifications** (temporary popups):
  - Success messages (green)
  - Error messages (red)
  - Info messages (blue)
  - Auto-dismiss after 5 seconds

- **Modal error messages:**
  - Failed disk operations
  - Failed script load/save
  - Failed upload operations

- **Inline error display:**
  - Socket errors during replay
  - CP/M file browser errors (displays in modal)
  - Terminal connection errors

- **Validation:**
  - Filename validation (alphanumeric, spaces, underscores, hyphens, periods)
  - Port selection validation
  - Script name validation (auto-adds .txt)
  - Field requirement checks before operations

- **User Confirmations:**
  - Confirm before deleting disk image
  - Confirm before deleting cassette
  - Confirm before deleting CP/M file
  - Confirm before overwriting script

---

## 6. DATA FLOWS - API CALLS & SOCKET EVENTS

### 6.1 REST API Endpoints

**Terminal/Serial:**
- `GET /api/terminal/ports` - List available serial ports
- `POST /api/terminal/open` - Open terminal connection
- `POST /api/terminal/close` - Close terminal connection
- `GET /api/serial/ports` - List FDC+ ports
- `POST /api/serial/config` - Save serial configuration

**Disk Images:**
- `GET /api/images` - List all disk images
- `POST /api/images/upload` - Upload new disk image
- `POST /api/images/create` - Create new blank disk
- `GET /api/images/details` - Get disk details
- `GET /api/images/{filename}/clone` - Clone disk image
- `DELETE /api/images/{filename}` - Delete disk image

**CP/M Files:**
- `GET /api/images/{diskName}/cpm/info` - Get CP/M disk info (file count, free space, parameters)
- `GET /api/images/{diskName}/cpm/files` - List CP/M files on disk
- `GET /api/images/{diskName}/cpm/files/{filename}` - Download CP/M file
- `POST /api/images/{diskName}/cpm/files` - Upload file to CP/M disk
- `DELETE /api/images/{diskName}/cpm/files/{filename}` - Delete CP/M file
- `POST /api/images/{diskName}/notes` - Save disk notes (implied)
- `GET /api/images/{diskName}/notes` - Get disk notes (implied)

**Drives:**
- `POST /api/drives/{driveId}/mount` - Mount disk on drive
- `POST /api/drives/{driveId}/unmount` - Unmount disk
- `POST /api/drives/{driveId}/readonly` - Toggle read-only mode

**Cassettes:**
- `POST /api/cassettes/upload` - Upload WAV file
- `GET /api/cassettes/details` - List cassettes
- `POST /api/cassettes/{filename}/play` - Start server-side playback
- `POST /api/cassettes/stop` - Stop cassette playback
- `GET /api/cassettes/{filename}/stream` - Stream cassette for browser playback
- `DELETE /api/cassettes/{filename}` - Delete cassette
- `POST /api/cassettes/{filename}/notes` - Save cassette notes (implied)
- `GET /api/cassettes/{filename}/notes` - Get cassette notes (implied)

**Scripts:**
- `GET /api/scripts` - List all scripts
- `POST /api/scripts` - Create new script
- `GET /api/scripts/{name}` - Load script content
- `PUT /api/scripts/{name}` - Update script content
- `DELETE /api/scripts/{name}` - Delete script
- `POST /api/scripts/upload` - Upload script file

**Configuration:**
- `GET /api/config` - Get all configuration
- `POST /api/config` - Save configuration
- `POST /api/disk-serving/enable` - Enable disk serving
- `POST /api/disk-serving/disable` - Disable disk serving

### 6.2 WebSocket Events

**Emitted by Frontend:**
- `request-status` - Request system status on connect
- `terminal:write` - Send data to terminal
- `replay:start` - Start script/cassette replay with options
- `replay:cancel` - Cancel ongoing replay

**Listened by Frontend:**
- `connect` - WebSocket connected
- `disconnect` - WebSocket disconnected
- `status` - System status update (drives, connections)
- `terminal:status` - Terminal connection status
- `terminal:data` - Incoming terminal data bytes
- `terminal:error` - Terminal error messages
- `replay:progress` - Progress update (bytes sent, percentage, duration)
- `replay:status` - Replay status change (started, completed, error)

---

## 7. CP/M FILE MANAGEMENT FEATURES

### 7.1 File Browser Interface
- Modal dialog showing table of files
- Columns: User, Filename, Extension, Size, Attributes
- Sortable columns (implied by table structure)
- Row actions: Download, Delete (if unmounted)

### 7.2 File Properties
- User number (0-15)
- Filename (8.3 format)
- Size display (human-readable)
- Attributes display:
  - R/O (Read-Only)
  - SYS (System file)

### 7.3 File Operations
- **Download:** Triggers browser download (REST GET with filename in path)
- **Delete:** Removes file from CP/M disk (only if disk unmounted)
- **Upload:** Add new files with optional rename and user assignment

### 7.4 Disk Information
- Total file count
- Free space (bytes)
- Free directory entries
- Block size
- Boot track count
- Mount status (prevents file modifications if mounted)

---

## 8. SPECIAL FEATURES

### 8.1 Theme Support
- Dark/light theme toggle in header
- Persists across sessions
- Material Design 3 theme tokens

### 8.2 Mobile Responsiveness
- Navigation drawer collapses on mobile
- Touch-friendly button sizing
- Simulated fullscreen mode for terminal on touch devices
- Vibration feedback on actions

### 8.3 Recording/Playback
- Record terminal session (implied by record button)
- Play back script/cassette in different modes (raw, XMODEM)
- Progress tracking
- Cancellation support

### 8.4 Notes System
- Attach descriptions and notes to:
  - Disk images
  - Cassette files
  - Scripts
- Edit in modal with short + long-form fields
- Persistent storage

### 8.5 Offline Capability
- Status indicators for connection state
- Graceful degradation when offline
- Re-request status on reconnect

---

## 9. COMPLETE FEATURE MATRIX FOR CLI ALTERNATIVE

A CLI frontend would need to replicate:

1. **Terminal Interface (5 features)**
   - Port selection and connection management
   - Serial parameter configuration
   - Real-time input/output
   - Status display

2. **Drive Management (6 features)**
   - Drive listing and mounting
   - Disk image creation and upload
   - Image cloning and deletion
   - Read-only toggle
   - Status monitoring

3. **CP/M File Browser (8 features)**
   - File listing with metadata
   - File download
   - File deletion
   - File upload with rename/user/flags
   - Disk information display
   - Free space reporting
   - Directory entry tracking
   - Mount status awareness

4. **Cassette Management (6 features)**
   - Cassette upload
   - Server-side playback
   - Client-side playback (N/A for CLI)
   - Stop/pause controls
   - Progress tracking
   - Deletion

5. **Script Management (5 features)**
   - Script creation/editing
   - Script saving and listing
   - Script deletion
   - Replay with multiple modes (raw, XMODEM)
   - Progress tracking and cancellation

6. **Configuration (6 features)**
   - Serial port and baud configuration
   - Key mapping profiles and custom mappings
   - Web/terminal settings
   - CRT effects (visual only - N/A for CLI)
   - Disk serving toggle
   - Persistent configuration

7. **Status & Monitoring (4 features)**
   - Real-time connection status
   - Progress tracking for long operations
   - Error display and handling
   - Log/notification system

**Total: 40 distinct features to replicate**

---

## 10. IMPLEMENTATION NOTES FOR CLI

- Single HTML file (~272KB) with embedded JavaScript, CSS, Material Design 3
- Uses xterm.js for terminal emulation
- Socket.IO for real-time communication
- localStorage for configuration persistence
- No external API dependencies beyond Express/Socket.IO
- All API calls documented and categorized
- Feature separation allows incremental CLI implementation
