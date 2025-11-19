# GPIO LED Status Indicators

The FDC+ Serial Drive Server supports optional GPIO LED status indicators for Raspberry Pi and compatible Linux systems. This feature provides real-time visual feedback for drive and terminal status without needing to access the web interface or terminal UI.

## Overview

The GPIO LED feature displays the status of:
- **12 Drive LEDs** (3 per drive × 4 drives):
  - Drive Enable (disk mounted)
  - Head Load (drive is actively reading/writing)
  - Read Only (write protection enabled)
- **3 Terminal LEDs**:
  - RX (receiving data)
  - TX (transmitting data)
  - Connected (terminal port is open)

**Total: 15 LEDs**

## Hardware Requirements

- Raspberry Pi (any model with GPIO)
- 15 LEDs (suggested: green for enable, yellow for head load, red for read-only)
- 15 × 220Ω resistors (for standard 20mA LEDs)
- Breadboard or custom circuit board
- Jumper wires

## GPIO Pin Mapping

The default configuration uses the following BCM pin assignments:

### Disk Activity LED (any disk)
| Function | BCM Pin | Physical Pin | Color Suggestion |
|----------|---------|--------------|------------------|
| Activity | GPIO4   | Pin 7        | Red              |

### Drive 0 LEDs
| Function | BCM Pin | Physical Pin | Color Suggestion |
|----------|---------|--------------|------------------|
| Enable   | GPIO17  | Pin 11       | Red              |
| Head Load| GPIO27  | Pin 13       | Red              |
| Read Only| GPIO22  | Pin 15       | Red              |

### Drive 1 LEDs
| Function | BCM Pin | Physical Pin | Color Suggestion |
|----------|---------|--------------|------------------|
| Enable   | GPIO23  | Pin 16       | Red              |
| Head Load| GPIO24  | Pin 18       | Red              |
| Read Only| GPIO25  | Pin 22       | Red              |

### Drive 2 LEDs
| Function | BCM Pin | Physical Pin | Color Suggestion |
|----------|---------|--------------|------------------|
| Enable   | GPIO5   | Pin 29       | Red              |
| Head Load| GPIO6   | Pin 31       | Red              |
| Read Only| GPIO13  | Pin 33       | Red              |

### Drive 3 LEDs
| Function | BCM Pin | Physical Pin | Color Suggestion |
|----------|---------|--------------|------------------|
| Enable   | GPIO19  | Pin 35       | Red              |
| Head Load| GPIO26  | Pin 37       | Red              |
| Read Only| GPIO12  | Pin 32       | Red              |

### Terminal LEDs
| Function  | BCM Pin | Physical Pin | Color Suggestion |
|-----------|---------|--------------|------------------|
| RX        | GPIO16  | Pin 36       | Red              |
| TX        | GPIO20  | Pin 38       | Red              |
| Connected | GPIO21  | Pin 40       | Red              |

### Reserved Pins (Avoided)

The GPIO implementation explicitly avoids these pins to prevent hardware conflicts:

- **GPIO14, GPIO15** (UART TX/RX) - Serial console
- **GPIO2, GPIO3** (I2C SDA/SCL) - I2C devices
- **GPIO7-11** (SPI) - SPI devices
- **GPIO4** - Common for 1-wire devices
- **GPIO18** - PWM/audio

## Wiring Diagram

```
For each LED:
[Raspberry Pi GPIO Pin] ──→ [LED Anode (+)]
                            [LED Cathode (-)] ──→ [220Ω Resistor] ──→ [GND]

Use any GND pin on the Raspberry Pi (pins 6, 9, 14, 20, 25, 30, 34, 39)
```

### Example Breadboard Layout

```
GPIO17 ──→ LED (Green)  ──→ 220Ω ──→ GND    (Drive 0 Enable)
GPIO27 ──→ LED (Yellow) ──→ 220Ω ──→ GND    (Drive 0 Head Load)
GPIO22 ──→ LED (Red)    ──→ 220Ω ──→ GND    (Drive 0 Read Only)
... (repeat for other drives and terminal)
```

## Configuration

### Enable GPIO LEDs

GPIO LEDs can be enabled via configuration file or command line.

#### Configuration File

Add to your `.fdcsds.config` or `fdcsds.config.json`:

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

#### Command Line

```bash
# Enable GPIO LEDs with default pin mapping
fdcsds -p /dev/ttyUSB0 -0 disks/cpm.dsk --gpio-leds

# Disable GPIO LEDs (override config file)
fdcsds -p /dev/ttyUSB0 -0 disks/cpm.dsk --no-gpio-leds

# Use active-low LEDs (cathode connected to GPIO)
fdcsds -p /dev/ttyUSB0 -0 disks/cpm.dsk --gpio-leds --gpio-active-low
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable/disable GPIO LED support |
| `blinkDuration` | number | `100` | Duration in ms for RX/TX LED blinks |
| `activeLow` | boolean | `false` | Use active-low logic (LED on when GPIO low) |
| `drive[0-3].enable` | number/null | See table | GPIO pin for drive enable LED |
| `drive[0-3].headLoad` | number/null | See table | GPIO pin for head load LED |
| `drive[0-3].readOnly` | number/null | See table | GPIO pin for read-only LED |
| `terminal.rx` | number/null | `16` | GPIO pin for terminal RX LED |
| `terminal.tx` | number/null | `20` | GPIO pin for terminal TX LED |
| `terminal.connected` | number/null | `21` | GPIO pin for terminal connected LED |

**Note**: Set any pin to `null` to disable that specific LED.

## LED Behavior

### Drive Enable LED
- **ON**: Disk image is mounted
- **OFF**: No disk mounted

### Head Load LED
- **ON**: Drive head is loaded (actively reading/writing)
- **OFF**: Drive head is unloaded (idle)

### Read Only LED
- **ON**: Write protection enabled
- **OFF**: Write protection disabled

### Terminal RX LED
- **Blink**: Flashes for 100ms when receiving data from terminal device

### Terminal TX LED
- **Blink**: Flashes for 100ms when transmitting data to terminal device

### Terminal Connected LED
- **ON**: Terminal serial port is connected
- **OFF**: Terminal serial port is disconnected

## Platform Support

### Supported Platforms
- Raspberry Pi (all models with 40-pin GPIO header)
- Other Linux systems with GPIO support via `/sys/class/gpio`

### Unsupported Platforms
The GPIO feature gracefully disables itself on:
- macOS
- Windows
- Linux without GPIO hardware
- Systems without the `onoff` npm package

**No error messages or crashes occur on unsupported platforms.**

## Permissions

### GPIO Group

On most Linux systems, GPIO access requires permissions:

```bash
# Add your user to the gpio group
sudo usermod -a -G gpio $USER

# Log out and back in for changes to take effect
```

### udev Rules

If needed, create `/etc/udev/rules.d/99-gpio.rules`:

```
SUBSYSTEM=="gpio", GROUP="gpio", MODE="0660"
```

Then reload udev rules:

```bash
sudo udevadm control --reload-rules
sudo udevadm trigger
```

## Debian Package Installation

When installing via the Debian package, GPIO permissions are automatically configured:

```bash
# Install package
sudo dpkg -i fdcsds_2.0.0-1_all.deb

# The postinst script automatically adds the fdcsds user to the gpio group
```

## Testing

### Test Individual LEDs

Create a test configuration that enables only the LEDs you want to test:

```json
{
  "port": "/dev/ttyUSB0",
  "gpioLeds": {
    "enabled": true,
    "drive0": {
      "enable": 17,
      "headLoad": null,
      "readOnly": null
    },
    "drive1": { "enable": null, "headLoad": null, "readOnly": null },
    "drive2": { "enable": null, "headLoad": null, "readOnly": null },
    "drive3": { "enable": null, "headLoad": null, "readOnly": null },
    "terminal": { "rx": null, "tx": null, "connected": null }
  }
}
```

### Monitor GPIO Status

```bash
# Check GPIO exports
ls -l /sys/class/gpio/

# Check specific GPIO value
cat /sys/class/gpio/gpio17/value
```

## Troubleshooting

### LEDs Don't Light Up

1. **Check permissions**:
   ```bash
   groups $USER  # Should include 'gpio'
   ```

2. **Verify GPIO is available**:
   ```bash
   ls -l /sys/class/gpio/
   ```

3. **Check LED polarity**:
   - Standard: Anode (+) to GPIO, Cathode (-) to GND
   - Active-low: Cathode (-) to GPIO, Anode (+) to 3.3V (requires `activeLow: true`)

4. **Test LED manually**:
   ```bash
   # Export GPIO 17
   echo 17 > /sys/class/gpio/export

   # Set as output
   echo out > /sys/class/gpio/gpio17/direction

   # Turn on
   echo 1 > /sys/class/gpio/gpio17/value

   # Turn off
   echo 0 > /sys/class/gpio/gpio17/value

   # Cleanup
   echo 17 > /sys/class/gpio/unexport
   ```

### Permission Denied Errors

```bash
# Check GPIO group exists
getent group gpio

# Create GPIO group if missing
sudo groupadd gpio

# Add user to group
sudo usermod -a -G gpio $USER

# Reboot for changes to take effect
sudo reboot
```

### Pin Already in Use

If a GPIO pin is already exported:

```bash
# Check what's using it
ls -l /sys/class/gpio/gpio17/

# Unexport it
echo 17 > /sys/class/gpio/unexport
```

### Wrong Pin Numbers

Make sure you're using **BCM pin numbering**, not physical pin numbers:
- ✅ Correct: `GPIO17` (BCM mode)
- ❌ Wrong: `Pin 11` (physical mode)

## Hardware Shopping List

### Components Needed

For a complete 15-LED setup:

- 1 × Raspberry Pi (any model with 40-pin header)
- 15 × LEDs:
  - 8 × Green LEDs (drive enable + terminal connected)
  - 4 × Yellow LEDs (head load)
  - 4 × Red LEDs (read only)
  - 3 × Blue LEDs (terminal RX/TX) *or reuse green*
- 15 × 220Ω resistors (1/4W or 1/8W)
- 1 × Breadboard (830 tie-points recommended)
- 20-30 × Jumper wires (male-to-male)
- Optional: PCB or perfboard for permanent installation

### Estimated Cost

- Raspberry Pi: $35-75 (if not already owned)
- LEDs: $5-10
- Resistors: $2-5
- Breadboard: $5-10
- Jumper wires: $5-10

**Total (excluding Pi): ~$15-35**

## Example Usage

### Basic Setup with GPIO LEDs

```bash
# Start server with GPIO LEDs enabled
fdcsds -p /dev/ttyUSB0 -b 460800 \
  -0 disks/cpm22.dsk \
  -1 disks/games.dsk \
  --gpio-leds \
  -w

# Access web interface at http://localhost:3000
# Watch drive LEDs respond to disk activity
```

### Configuration File Example

```json
{
  "port": "/dev/ttyUSB0",
  "baud": 460800,
  "drive0": "disks/cpm22.dsk",
  "drive1": "disks/games.dsk",
  "web": true,
  "webPort": 3000,
  "gpioLeds": {
    "enabled": true,
    "blinkDuration": 100
  }
}
```

Then simply run:

```bash
fdcsds
```

## Advanced Customization

### Custom Pin Mapping

You can use any valid GPIO pins (0-27 in BCM mode):

```json
{
  "gpioLeds": {
    "enabled": true,
    "drive0": {
      "enable": 2,
      "headLoad": 3,
      "readOnly": 4
    }
  }
}
```

**Warning**: Avoid pins used by I2C, SPI, UART, or other hardware peripherals.

### Disable Specific LEDs

Set any LED to `null` to disable it:

```json
{
  "gpioLeds": {
    "enabled": true,
    "drive0": {
      "enable": 17,
      "headLoad": null,
      "readOnly": null
    }
  }
}
```

### Active-Low LEDs

For LED configurations where the cathode connects to GPIO:

```json
{
  "gpioLeds": {
    "enabled": true,
    "activeLow": true
  }
}
```

## Integration with Web Interface

The GPIO LEDs work seamlessly alongside the web interface:

1. LEDs update in real-time as drives are accessed
2. Terminal activity shows on RX/TX LEDs
3. Web interface can remotely mount/unmount drives
4. LEDs reflect all changes made via web or CLI

Both interfaces show the same status simultaneously.

## Future Enhancements

Potential future additions:

- PWM brightness control
- Activity-based blink rates
- Error indication patterns
- LCD display support (I2C)
- Physical button inputs
- Multiple LED patterns (breathing, pulsing)
- Web UI GPIO configuration

## References

- [Raspberry Pi GPIO Pinout](https://pinout.xyz)
- [onoff npm package](https://www.npmjs.com/package/onoff)
- [GPIO LED tutorial](https://www.raspberrypi.com/documentation/computers/raspberry-pi.html)

## Support

For issues or questions about GPIO LED support:
1. Check this documentation
2. Review troubleshooting section
3. Test with manual GPIO commands
4. Report issues on the project repository
