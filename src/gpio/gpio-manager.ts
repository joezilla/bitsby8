/**
 * GPIO LED Manager - Low-level GPIO control
 *
 * Provides platform-aware GPIO pin management using the node-libgpiod library.
 * Uses the modern Linux GPIO character device interface (/dev/gpiochip*).
 * Gracefully handles non-Raspberry Pi platforms by providing a no-op implementation.
 */

import * as fs from 'fs';
import * as os from 'os';

// Conditional import of node-libgpiod - only available on Linux with gpiod
let Chip: any = null;
let Line: any = null;

try {
  const gpiodModule = require('node-libgpiod');
  Chip = gpiodModule.Chip;
  Line = gpiodModule.Line;
} catch (error) {
  // node-libgpiod not available or GPIO not accessible
  Chip = null;
  Line = null;
}

/**
 * Check if GPIO is accessible
 */
function isGpioAccessible(): boolean {
  if (Chip === null) {
    return false;
  }

  // Check if /dev/gpiochip0 exists
  try {
    return fs.existsSync('/dev/gpiochip0');
  } catch (error) {
    return false;
  }
}

export interface GpioPin {
  pin: number;
  line: any | null; // Line instance from node-libgpiod
}

/**
 * GpioLedManager - Singleton for managing GPIO pins
 */
export class GpioLedManager {
  private static instance: GpioLedManager | null = null;
  private pins: Map<number, GpioPin> = new Map();
  private initialized: boolean = false;
  private platformSupported: boolean = false;
  private activeLow: boolean = false;
  private chip: any | null = null; // Chip instance from node-libgpiod

  private constructor() {
    this.platformSupported = this.detectPlatform();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): GpioLedManager {
    if (!GpioLedManager.instance) {
      GpioLedManager.instance = new GpioLedManager();
    }
    return GpioLedManager.instance;
  }

  /**
   * Detect if running on Raspberry Pi or compatible Linux platform
   */
  private detectPlatform(): boolean {
    // Must be Linux
    if (os.platform() !== 'linux') {
      return false;
    }

    // Check if GPIO is accessible
    if (!isGpioAccessible()) {
      return false;
    }

    // Try to detect Raspberry Pi from /proc/cpuinfo
    try {
      const cpuInfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
      const isRaspberryPi = cpuInfo.includes('Raspberry Pi') || cpuInfo.includes('BCM');
      return isRaspberryPi;
    } catch (error) {
      // Can't read cpuinfo, but if GPIO is accessible, allow it
      return isGpioAccessible();
    }
  }

  /**
   * Check if GPIO is available on this platform
   */
  public isAvailable(): boolean {
    return this.platformSupported && isGpioAccessible();
  }

  /**
   * Get platform information for logging
   */
  public getPlatformInfo(): string {
    return `Platform: ${os.platform()}, GPIO Available: ${isGpioAccessible()}, Supported: ${this.platformSupported}`;
  }

  /**
   * Initialize GPIO with active-low configuration
   */
  public async initialize(activeLow: boolean = false): Promise<void> {
    if (this.initialized) {
      throw new Error('GPIO Manager already initialized');
    }

    this.activeLow = activeLow;

    if (!this.isAvailable()) {
      // Silent no-op on unsupported platforms
      this.initialized = true;
      return;
    }

    try {
      // Open GPIO chip (gpiochip0 is the main chip on Raspberry Pi)
      this.chip = new Chip(0);
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to open GPIO chip: ${error}`);
    }
  }

  /**
   * Setup a GPIO pin for LED output
   * @param pin GPIO pin number (BCM numbering)
   */
  public async setupPin(pin: number): Promise<void> {
    if (!this.isAvailable()) {
      // No-op on unsupported platforms
      return;
    }

    if (!this.initialized || !this.chip) {
      throw new Error('GPIO Manager not initialized');
    }

    // Validate pin number (BCM 0-27)
    if (pin < 0 || pin > 27) {
      throw new Error(`Invalid GPIO pin number: ${pin}. Must be 0-27 (BCM mode)`);
    }

    // Check if pin already setup
    if (this.pins.has(pin)) {
      return; // Already configured
    }

    try {
      // Request the line as output
      // node-libgpiod uses flags for configuration
      const line = this.chip.getLine(pin);

      // Request line for output
      // ACTIVE_LOW flag if configured, otherwise normal output
      const flags = this.activeLow ? Line.REQUEST_FLAG_ACTIVE_LOW : 0;
      line.requestOutputMode('fdcsds-led', flags, 0); // Start with LED off (0)

      this.pins.set(pin, { pin, line });
    } catch (error) {
      throw new Error(`Failed to setup GPIO pin ${pin}: ${error}`);
    }
  }

  /**
   * Set LED state
   * @param pin GPIO pin number
   * @param state true = on, false = off
   */
  public setLed(pin: number, state: boolean): void {
    if (!this.isAvailable()) {
      return; // No-op
    }

    const pinInfo = this.pins.get(pin);
    if (!pinInfo || !pinInfo.line) {
      // Pin not setup, ignore
      return;
    }

    try {
      // With node-libgpiod, active-low is handled by the line configuration
      // So we just set 1 for on, 0 for off
      const value = state ? 1 : 0;
      pinInfo.line.setValue(value);
    } catch (error) {
      console.error(`Failed to set GPIO pin ${pin}:`, error);
    }
  }

  /**
   * Blink LED for specified duration
   * @param pin GPIO pin number
   * @param durationMs Blink duration in milliseconds
   */
  public blinkLed(pin: number, durationMs: number): void {
    if (!this.isAvailable()) {
      return; // No-op
    }

    // Turn on
    this.setLed(pin, true);

    // Schedule turn off
    setTimeout(() => {
      this.setLed(pin, false);
    }, durationMs);
  }

  /**
   * Cleanup all GPIO pins
   */
  public async cleanup(): Promise<void> {
    if (this.isAvailable()) {
      for (const [pin, pinInfo] of this.pins.entries()) {
        try {
          if (pinInfo.line) {
            // Turn off LED before releasing
            pinInfo.line.setValue(0);
            // Release the line
            pinInfo.line.release();
          }
        } catch (error) {
          console.error(`Failed to cleanup GPIO pin ${pin}:`, error);
        }
      }

      // Close the chip
      if (this.chip) {
        try {
          this.chip.close();
        } catch (error) {
          console.error('Failed to close GPIO chip:', error);
        }
        this.chip = null;
      }
    }

    this.pins.clear();
    this.initialized = false;
  }

  /**
   * Get list of configured pins
   */
  public getConfiguredPins(): number[] {
    return Array.from(this.pins.keys());
  }

  /**
   * Reset singleton (for testing)
   */
  public static resetInstance(): void {
    if (GpioLedManager.instance) {
      GpioLedManager.instance.cleanup().catch(() => {});
      GpioLedManager.instance = null;
    }
  }
}

/**
 * Get the singleton GPIO manager instance
 */
export function getGpioLedManager(): GpioLedManager {
  return GpioLedManager.getInstance();
}
