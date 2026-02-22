# GPIO LED Status Indicator Implementation Plan

## Overview
Add optional GPIO LED support for Raspberry Pi to display real-time status information that mirrors the web interface and command line display.

## LED Requirements

### Total LEDs: 15

#### Disk Status LEDs (12 total)
- **Drive 0**: Disk Enable, Head Load, Read Only
- **Drive 1**: Disk Enable, Head Load, Read Only
- **Drive 2**: Disk Enable, Head Load, Read Only
- **Drive 3**: Disk Enable, Head Load, Read Only

#### Serial Terminal LEDs (3 total)
- **Terminal RX**: Active when receiving data
- **Terminal TX**: Active when transmitting data
- **Terminal Connected**: On when terminal port is connected

---

## GPIO Pin Mapping

### Raspberry Pi GPIO Layout (using BCM numbering)

```
Physical Pin Layout Reference:
┌─────────────────────────────┐
│ 3V3  (1) (2)  5V            │
│ GPIO2 (3) (4)  5V           │
│ GPIO3 (5) (6)  GND          │
│ GPIO4 (7) (8)  GPIO14       │
│ GND   (9) (10) GPIO15       │
│ GPIO17(11)(12) GPIO18       │
│ GPIO27(13)(14) GND          │
│ GPIO22(15)(16) GPIO23       │
│ 3V3  (17)(18) GPIO24       │
│ GPIO10(19)(20) GND          │
│ GPIO9 (21)(22) GPIO25       │
│ GPIO11(23)(24) GPIO8        │
│ GND  (25)(26) GPIO7         │
│ ID_SD(27)(28) ID_SC         │
│ GPIO5 (29)(30) GND          │
│ GPIO6 (31)(32) GPIO12       │
│ GPIO13(33)(34) GND          │
│ GPIO19(35)(36) GPIO16       │
│ GPIO26(37)(38) GPIO20       │
│ GND  (39)(40) GPIO21        │
└─────────────────────────────┘
```

### Reserved Pins (NOT Used for LEDs)

The following GPIO pins are **explicitly avoided** to prevent conflicts:

#### Hardware UART (Serial Console)
- **GPIO14 (Pin 8)** - UART TX - Reserved for serial console/debugging
- **GPIO15 (Pin 10)** - UART RX - Reserved for serial console/debugging

#### I2C Interface
- **GPIO2 (Pin 3)** - I2C SDA - Reserved for I2C devices
- **GPIO3 (Pin 5)** - I2C SCL - Reserved for I2C devices

#### SPI Interface
- **GPIO7 (Pin 26)** - SPI CE1 - Reserved for SPI devices
- **GPIO8 (Pin 24)** - SPI CE0 - Reserved for SPI devices
- **GPIO9 (Pin 21)** - SPI MISO - Reserved for SPI devices
- **GPIO10 (Pin 19)** - SPI MOSI - Reserved for SPI devices
- **GPIO11 (Pin 23)** - SPI SCLK - Reserved for SPI devices

#### Special Purpose
- **GPIO0-1** - I2C ID EEPROM (reserved for HATs)
- **GPIO4 (Pin 7)** - Often used for 1-wire (DS18B20 temperature sensors)
- **GPIO18 (Pin 12)** - Often used for PWM/audio

**Note:** Since this application already uses hardware serial ports for FDC+ communication
and terminal emulation, we must avoid GPIO 14/15 to prevent any conflicts with serial functionality.

### Default Pin Assignments (BCM Mode)

**All pins selected below are safe, general-purpose GPIO pins with no special hardware functions.**

#### Group 1: Drive 0 Status (GPIO 17-27)
| LED Function        | BCM Pin | Physical Pin | Description                    |
|---------------------|---------|--------------|--------------------------------|
| Drive 0 Enable      | GPIO17  | Pin 11       | Green: Disk mounted/enabled    |
| Drive 0 Head Load   | GPIO27  | Pin 13       | Yellow: Drive head loaded      |
| Drive 0 Read Only   | GPIO22  | Pin 15       | Red: Write protected           |

#### Group 2: Drive 1 Status (GPIO 23-25)
| LED Function        | BCM Pin | Physical Pin | Description                    |
|---------------------|---------|--------------|--------------------------------|
| Drive 1 Enable      | GPIO23  | Pin 16       | Green: Disk mounted/enabled    |
| Drive 1 Head Load   | GPIO24  | Pin 18       | Yellow: Drive head loaded      |
| Drive 1 Read Only   | GPIO25  | Pin 22       | Red: Write protected           |

#### Group 3: Drive 2 Status (GPIO 5-6-13)
| LED Function        | BCM Pin | Physical Pin | Description                    |
|---------------------|---------|--------------|--------------------------------|
| Drive 2 Enable      | GPIO5   | Pin 29       | Green: Disk mounted/enabled    |
| Drive 2 Head Load   | GPIO6   | Pin 31       | Yellow: Drive head loaded      |
| Drive 2 Read Only   | GPIO13  | Pin 33       | Red: Write protected           |

#### Group 4: Drive 3 Status (GPIO 19-26-12)
| LED Function        | BCM Pin | Physical Pin | Description                    |
|---------------------|---------|--------------|--------------------------------|
| Drive 3 Enable      | GPIO19  | Pin 35       | Green: Disk mounted/enabled    |
| Drive 3 Head Load   | GPIO26  | Pin 37       | Yellow: Drive head loaded      |
| Drive 3 Read Only   | GPIO12  | Pin 32       | Red: Write protected           |

#### Group 5: Serial Terminal Status (GPIO 16-20-21)
| LED Function        | BCM Pin | Physical Pin | Description                    |
|---------------------|---------|--------------|--------------------------------|
| Terminal RX         | GPIO16  | Pin 36       | Blink on data receive          |
| Terminal TX         | GPIO20  | Pin 38       | Blink on data transmit         |
| Terminal Connected  | GPIO21  | Pin 40       | On when port connected         |

### Pin Selection Rationale
- **Grouped by function**: Each drive's LEDs are physically near each other on the header
- **Avoid all special-purpose pins**: Explicitly excludes I2C, SPI, UART, and HAT ID pins
- **No serial port conflicts**: GPIO 14/15 (UART) completely avoided to prevent conflicts with FDC+ and terminal serial communication
- **Safe GPIO pins**: All 15 selected pins are general-purpose and safe for output
- **Easy breadboard layout**: Physical grouping makes wiring cleaner
- **Future-proof**: Leaves special-purpose pins available for other features (I2C displays, SPI expansion, etc.)

### Hardware Connection
```
For each LED:
[Raspberry Pi GPIO Pin] ---> [LED Anode (+)]
                             [LED Cathode (-)] ---> [220Ω Resistor] ---> [GND]

Note: Use 220Ω resistors for standard 20mA LEDs
      Connect all grounds to any GND pin on the Pi
```

---

## Configuration Schema

### Configuration File Extensions

Add to `src/config.ts` ConfigFile interface:

```typescript
export interface GpioLedConfig {
  enabled: boolean;

  // Disk status pin mappings (null = disabled for that LED)
  drive0?: {
    enable?: number | null;
    headLoad?: number | null;
    readOnly?: number | null;
  };
  drive1?: {
    enable?: number | null;
    headLoad?: number | null;
    readOnly?: number | null;
  };
  drive2?: {
    enable?: number | null;
    headLoad?: number | null;
    readOnly?: number | null;
  };
  drive3?: {
    enable?: number | null;
    headLoad?: number | null;
    readOnly?: number | null;
  };

  // Terminal status pin mappings
  terminal?: {
    rx?: number | null;
    tx?: number | null;
    connected?: number | null;
  };

  // LED behavior options
  blinkDuration?: number;  // ms for RX/TX blink (default: 100)
  activeLow?: boolean;     // true = LED on when GPIO low (default: false)
}

export interface ConfigFile {
  // ... existing fields ...

  // GPIO LED configuration
  gpioLeds?: GpioLedConfig;
}
```

### Example Configuration File

```json
{
  "port": "/dev/ttyUSB0",
  "baud": 460800,
  "drive0": "disks/cpm.dsk",
  "web": true,
  "webPort": 3000,

  "gpioLeds": {
    "enabled": true,
    "blinkDuration": 100,
    "activeLow": false,

    "drive0": {
      "enable": 17,
      "headLoad": 27,
      "readOnly": 22
    },
    "drive1": {
      "enable": 23,
      "headLoad": 24,
      "readOnly": 25
    },
    "drive2": {
      "enable": 5,
      "headLoad": 6,
      "readOnly": 13
    },
    "drive3": {
      "enable": 19,
      "headLoad": 26,
      "readOnly": 12
    },

    "terminal": {
      "rx": 16,
      "tx": 20,
      "connected": 21
    }
  }
}
```

### Command Line Options

Add to `src/index.ts` commander options:

```typescript
program
  .option('--gpio-leds', 'Enable GPIO LED status indicators')
  .option('--no-gpio-leds', 'Disable GPIO LED status indicators')
  .option('--gpio-active-low', 'Use active-low logic for LEDs')
```

**Priority**: CLI flag overrides config file setting

---

## Implementation Architecture

### New Files to Create

#### 1. `src/gpio/gpio-manager.ts`
Core GPIO LED management singleton

**Responsibilities:**
- Initialize GPIO pins on Raspberry Pi
- Provide methods to control individual LEDs
- Handle platform detection (only activate on Linux/Raspberry Pi)
- Safe error handling if GPIO not available
- Cleanup GPIO on shutdown

**Key Methods:**
```typescript
class GpioLedManager {
  static getInstance(): GpioLedManager
  initialize(config: GpioLedConfig): Promise<void>
  setLed(pin: number, state: boolean): void
  blinkLed(pin: number, duration: number): void
  cleanup(): Promise<void>
  isAvailable(): boolean
}
```

#### 2. `src/gpio/gpio-controller.ts`
High-level LED status controller

**Responsibilities:**
- Map application state to LED updates
- Subscribe to drive state changes
- Subscribe to terminal events
- Coordinate LED updates with GpioManager

**Key Methods:**
```typescript
class GpioLedController {
  static getInstance(): GpioLedController
  initialize(config: GpioLedConfig): Promise<void>
  updateDriveStatus(driveNum: number, status: DriveState): void
  updateTerminalRx(): void
  updateTerminalTx(): void
  updateTerminalConnected(connected: boolean): void
  shutdown(): Promise<void>
}
```

#### 3. `src/gpio/index.ts`
Export barrel file for GPIO module

---

## Integration Points

### 1. Drive Status Updates

**File: `src/drive.ts`**

Modify `DriveManager` methods to emit GPIO updates:

```typescript
// In mountDrive()
await this.openDrive(driveNumber, filename, readonly);
// ADD: GpioLedController.getInstance().updateDriveStatus(driveNumber, this.drives[driveNumber]);

// In unmountDrive()
this.closeDrive(driveNumber);
// ADD: GpioLedController.getInstance().updateDriveStatus(driveNumber, this.drives[driveNumber]);

// In writeProtect()
this.drives[driveNumber].readonly = protect;
// ADD: GpioLedController.getInstance().updateDriveStatus(driveNumber, this.drives[driveNumber]);
```

**File: `src/server.ts`**

Add GPIO updates in command handlers:

```typescript
// In handleStatCommand() - after updating hdld
if (this.drives[drv].hdld !== newHeadLoad) {
  this.drives[drv].hdld = newHeadLoad;
  // ADD: GpioLedController.getInstance().updateDriveStatus(drv, this.drives[drv]);
}

// In handleReadCommand() - after read operation
this.drives[drv].hdld = true;
// ADD: GpioLedController.getInstance().updateDriveStatus(drv, this.drives[drv]);

// In handleWriteCommand() - after write operation
this.drives[drv].hdld = true;
// ADD: GpioLedController.getInstance().updateDriveStatus(drv, this.drives[drv]);
```

### 2. Terminal Status Updates

**File: `src/terminal-serial.ts`**

```typescript
// In data receive handler (line 92)
this.port!.on('data', (data: Buffer) => {
  // ADD: GpioLedController.getInstance().updateTerminalRx();
  if (this.onDataCallback) {
    this.onDataCallback(data);
  }
});

// In write() method (line 138)
write(data: Buffer): Promise<void> {
  // ADD: GpioLedController.getInstance().updateTerminalTx();
  return new Promise((resolve, reject) => {
    // ... existing write logic
  });
}

// In open() method - on successful connection
await port.open();
// ADD: GpioLedController.getInstance().updateTerminalConnected(true);

// In close() method
await this.port.close();
// ADD: GpioLedController.getInstance().updateTerminalConnected(false);
```

### 3. Application Initialization

**File: `src/index.ts`**

```typescript
// After config loading and before starting server
if (finalConfig.gpioLeds?.enabled) {
  try {
    await GpioLedController.getInstance().initialize(finalConfig.gpioLeds);
    // console.log('GPIO LED status indicators enabled');
  } catch (error) {
    console.error('Failed to initialize GPIO LEDs:', error);
    // console.log('Continuing without GPIO LED support');
  }
}

// In shutdown handler
process.on('SIGINT', async () => {
  console.log('\nShutting down...');

  if (finalConfig.gpioLeds?.enabled) {
    await GpioLedController.getInstance().shutdown();
  }

  // ... existing cleanup
  process.exit(0);
});
```

---

## GPIO Library Selection

### Recommended: `onoff` Package

**Why:**
- Pure JavaScript, no native compilation required
- Supports both Raspberry Pi and other Linux GPIO
- Simple, clean API
- Well-maintained and widely used
- Works with /sys/class/gpio interface

**Installation:**
```bash
npm install onoff
npm install --save-dev @types/onoff
```

**Basic Usage:**
```typescript
import { Gpio } from 'onoff';

const led = new Gpio(17, 'out');  // GPIO17 as output
led.writeSync(1);  // Turn on
led.writeSync(0);  // Turn off
await led.write(1);  // Async version
led.unexport();  // Cleanup
```

**Fallback Behavior:**
- Check `Gpio.accessible` before initialization
- Gracefully disable GPIO features if not on Raspberry Pi
- Log warnings but continue normal operation

---

## Implementation Steps

### Phase 1: Core GPIO Infrastructure
1. Add `onoff` dependency to package.json
2. Create `src/gpio/gpio-manager.ts` with basic GPIO control
3. Create `src/gpio/gpio-controller.ts` with LED state management
4. Add platform detection and graceful fallback
5. Implement initialization and cleanup

### Phase 2: Configuration Support
1. Extend `ConfigFile` interface in `src/config.ts`
2. Add default GPIO configuration constants
3. Add validation for GPIO pin numbers (0-27)
4. Add command line options to `src/index.ts`
5. Update example config files

### Phase 3: Drive Status Integration
1. Hook into `DriveManager` mount/unmount/writeProtect methods
2. Hook into `FdcServer` command handlers for head load updates
3. Update all three LED types per drive
4. Test with actual drive operations

### Phase 4: Terminal Status Integration
1. Hook into `TerminalSerialManager` RX/TX events
2. Implement blink behavior for RX/TX LEDs
3. Hook connection status
4. Test with terminal communication

### Phase 5: Testing & Documentation
1. Test on actual Raspberry Pi hardware
2. Test graceful fallback on non-Pi systems (macOS, Windows)
3. Update README.md with GPIO LED documentation
4. Add wiring diagram and hardware setup guide
5. Update Debian package to include GPIO support

---

## Error Handling & Safety

### Platform Detection
```typescript
function isRaspberryPi(): boolean {
  if (process.platform !== 'linux') return false;

  try {
    const cpuInfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
    return cpuInfo.includes('Raspberry Pi') || cpuInfo.includes('BCM');
  } catch {
    return false;
  }
}
```

### Permission Handling
- GPIO requires appropriate permissions
- Add user to `gpio` group: `sudo usermod -a -G gpio $USER`
- Document permission requirements
- Provide clear error messages if access denied

### Pin Validation
- Validate pin numbers are in valid range (0-27 for BCM)
- Check for pin conflicts
- Warn if using special-purpose pins
- Allow null pins to disable specific LEDs

### Graceful Degradation
- If GPIO initialization fails, log warning and continue
- Application works normally without GPIO
- No crashes or hard failures
- Optional feature, not required

---

## Testing Strategy

### Unit Tests
- GPIO manager initialization
- LED state changes
- Blink timing
- Pin validation
- Configuration parsing

### Integration Tests
- Mock GPIO for CI/CD testing
- Test drive state → LED updates
- Test terminal events → LED updates
- Test configuration loading

### Hardware Tests (Manual)
- Verify all 15 LEDs respond correctly
- Test each drive operation
- Test terminal RX/TX/connected status
- Test configuration file pin mapping
- Test CLI enable/disable flag
- Verify cleanup on shutdown

---

## Documentation Updates

### Files to Update

1. **README.md**
   - Add GPIO LED section
   - Hardware requirements
   - Wiring instructions
   - Configuration examples

2. **QUICKSTART.md**
   - Add GPIO setup steps
   - Permission configuration
   - Basic LED test procedure

3. **New: GPIO-LEDS.md**
   - Detailed wiring guide
   - Pin mapping reference
   - Troubleshooting
   - Hardware shopping list
   - Example breadboard layout

4. **fdcsds.config.example**
   - Add commented GPIO configuration
   - Show default pin mappings
   - Explain options

---

## Debian Package Considerations

### Package Dependencies
Add optional dependency for GPIO support:
```
Suggests: wiringpi | python3-rpi.gpio
```

### systemd Service
No changes needed - GPIO will work with existing service

### Permission Setup
Add to postinst script:
```bash
# Add fdcsds user to gpio group if it exists
if getent group gpio >/dev/null; then
  usermod -a -G gpio fdcsds 2>/dev/null || true
fi
```

### udev Rules
Consider adding to `/etc/udev/rules.d/99-gpio.rules`:
```
SUBSYSTEM=="gpio", GROUP="gpio", MODE="0660"
```

---

## Future Enhancements

### Potential Additions
1. **PWM brightness control** - Dim LEDs instead of on/off
2. **Activity indication** - Flash rate proportional to disk activity
3. **Error indication** - Red flash on errors/retries
4. **LCD display support** - I2C character display as alternative
5. **Multiple LED patterns** - Breathing, pulsing, etc.
6. **Web UI GPIO control** - Configure pins from web interface
7. **GPIO input buttons** - Physical controls (mount/unmount)

---

## Timeline Estimate

- **Phase 1**: 4-6 hours (Core GPIO infrastructure)
- **Phase 2**: 2-3 hours (Configuration support)
- **Phase 3**: 3-4 hours (Drive integration)
- **Phase 4**: 2-3 hours (Terminal integration)
- **Phase 5**: 4-6 hours (Testing & documentation)

**Total**: 15-22 hours

---

## Summary

This implementation provides a robust, configurable GPIO LED system that:
- ✅ Displays status for all 4 drives (enable, head load, read only)
- ✅ Shows terminal activity (RX, TX, connected)
- ✅ Uses well-organized GPIO pin groups
- ✅ Fully configurable via config file and CLI
- ✅ Gracefully handles non-Raspberry Pi platforms
- ✅ Integrates cleanly with existing architecture
- ✅ Maintains backward compatibility
- ✅ Provides clear documentation and examples

The LED indicators will provide valuable visual feedback for system operation, especially useful for headless Raspberry Pi deployments where the web interface may not always be accessible.
