/**
 * GPIO LED Manager - Low-level GPIO control
 *
 * Provides platform-aware GPIO pin management using the onoff library.
 * Automatically detects and applies GPIO chip base offset for proper kernel mapping.
 * Gracefully handles non-Raspberry Pi platforms by providing a no-op implementation.
 */

import * as fs from 'fs';
import * as os from 'os';

// Conditional import of onoff - only available on Linux
let Gpio: any = null;

try {
  const onoffModule = require('onoff');
  Gpio = onoffModule.Gpio;
} catch (error) {
  // onoff not available or GPIO not accessible
  Gpio = null;
}

/**
 * Check if GPIO is accessible
 */
function isGpioAccessible(): boolean {
  return Gpio !== null && Gpio.accessible === true;
}

/**
 * Detect GPIO chip base offset from /sys/kernel/debug/gpio
 * Returns the base offset (e.g., 512 for gpiochip0 on some Pi models)
 */
function detectGpioChipBase(): number {
  try {
    const gpioDebug = fs.readFileSync('/sys/kernel/debug/gpio', 'utf8');

    // Look for gpiochip0 line like: "gpiochip0: GPIOs 512-565"
    const match = gpioDebug.match(/gpiochip0:\s+GPIOs\s+(\d+)-(\d+)/);

    if (match) {
      const baseOffset = parseInt(match[1], 10);
      console.log(`GPIO: Detected chip base offset: ${baseOffset}`);
      return baseOffset;
    }
  } catch (error) {
    console.warn('GPIO: Could not read /sys/kernel/debug/gpio, assuming base 0');
  }

  return 0; // Default to no offset
}

export interface GpioPin {
  pin: number;
  kernelPin: number;
  gpio: any | null; // Gpio instance from onoff
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
  private chipBaseOffset: number = 0;

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
    return `Platform: ${os.platform()}, GPIO Available: ${isGpioAccessible()}, Supported: ${this.platformSupported}, Chip Base: ${this.chipBaseOffset}`;
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

    // Detect GPIO chip base offset
    this.chipBaseOffset = detectGpioChipBase();

    this.initialized = true;
  }

  /**
   * Setup a GPIO pin for LED output
   * @param pin GPIO pin number (BCM numbering)
   */
  public async setupPin(pin: number): Promise<void> {
    // Check initialization first
    if (!this.initialized) {
      if (!this.platformSupported) {
        // No-op on unsupported platforms
        return;
      }
      throw new Error('GPIO Manager not initialized');
    }

    if (!this.isAvailable()) {
      // No-op if GPIO not available
      return;
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
      // Apply chip base offset to get kernel GPIO number
      const kernelPin = pin + this.chipBaseOffset;

      console.log(`GPIO: Setting up BCM pin ${pin} as kernel GPIO ${kernelPin}`);

      // Create GPIO instance using kernel pin number
      const gpio = new Gpio(kernelPin, 'out');

      // Initialize to off state using async write
      const offValue = this.activeLow ? 1 : 0;

      // Use a small delay and write to avoid timing issues
      await new Promise(resolve => setTimeout(resolve, 50));
      await gpio.write(offValue);

      this.pins.set(pin, { pin, kernelPin, gpio });
    } catch (error) {
      throw new Error(`Failed to setup GPIO pin ${pin}: ${error}`);
    }
  }

  /**
   * Set LED state
   * @param pin GPIO pin number (BCM numbering)
   * @param state true = on, false = off
   */
  public setLed(pin: number, state: boolean): void {
    if (!this.isAvailable()) {
      return; // No-op
    }

    const pinInfo = this.pins.get(pin);
    if (!pinInfo || !pinInfo.gpio) {
      // Pin not setup, ignore
      return;
    }

    try {
      // Handle active-low logic
      const value = this.activeLow ? (state ? 0 : 1) : (state ? 1 : 0);
      pinInfo.gpio.writeSync(value);
    } catch (error) {
      console.error(`Failed to set GPIO pin ${pin}:`, error);
    }
  }

  /**
   * Blink LED for specified duration
   * @param pin GPIO pin number (BCM numbering)
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
          if (pinInfo.gpio) {
            // Turn off LED before unexport
            const offValue = this.activeLow ? 1 : 0;
            pinInfo.gpio.writeSync(offValue);
            pinInfo.gpio.unexport();
          }
        } catch (error) {
          console.error(`Failed to cleanup GPIO pin ${pin}:`, error);
        }
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
