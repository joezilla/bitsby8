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
      // console.log(`GPIO: Detected chip base offset: ${baseOffset}`);
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

interface QueuedWrite {
  pin: number;
  value: number;
  timestamp: number;
}

export interface GpioStats {
  totalWrites: number;
  queuedWrites: number;
  coalescedWrites: number;
  errors: number;
  lastFlush: number;
}

/**
 * GpioLedManager - Singleton for managing GPIO pins
 *
 * Performance optimizations:
 * - Async write queue prevents blocking the event loop
 * - Write batching reduces GPIO syscalls
 * - Write coalescing eliminates redundant updates
 * - Blink debouncing prevents GPIO spam during high-frequency updates
 */
export class GpioLedManager {
  private static instance: GpioLedManager | null = null;
  private pins: Map<number, GpioPin> = new Map();
  private initialized: boolean = false;
  private platformSupported: boolean = false;
  private activeLow: boolean = false;
  private chipBaseOffset: number = 0;

  // Async write queue for non-blocking GPIO operations
  private writeQueue: QueuedWrite[] = [];
  private flushTimeout: NodeJS.Timeout | null = null;
  private processing: boolean = false;
  private readonly DEBOUNCE_MS = 10; // Batch writes within 10ms window

  // Debouncing for blink operations (RX/TX LEDs)
  private blinkDebounce: Map<number, NodeJS.Timeout> = new Map();

  // Performance monitoring
  private stats: GpioStats = {
    totalWrites: 0,
    queuedWrites: 0,
    coalescedWrites: 0,
    errors: 0,
    lastFlush: 0,
  };

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

     // console.log(`GPIO: Setting up BCM pin ${pin} as kernel GPIO ${kernelPin}`);

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
   * Set LED state (non-blocking, queued)
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

    // Handle active-low logic
    const value = this.activeLow ? (state ? 0 : 1) : (state ? 1 : 0);

    // Add to queue instead of writing synchronously
    this.queueWrite(pin, value);
  }

  /**
   * Queue a GPIO write for batched async processing
   * @param pin GPIO pin number (BCM numbering)
   * @param value 0 or 1
   */
  private queueWrite(pin: number, value: number): void {
    // Add to queue
    this.writeQueue.push({
      pin,
      value,
      timestamp: Date.now(),
    });

    this.stats.queuedWrites++;

    // Debounce - schedule flush after DEBOUNCE_MS of no new writes
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
    }

    this.flushTimeout = setTimeout(() => {
      this.flushQueue();
    }, this.DEBOUNCE_MS);
  }

  /**
   * Flush queued writes to GPIO hardware (async, non-blocking)
   */
  private async flushQueue(): Promise<void> {
    if (this.processing || this.writeQueue.length === 0) {
      return;
    }

    this.processing = true;
    const batch = [...this.writeQueue];
    this.writeQueue = [];

    try {
      // Coalesce: only keep last state for each pin
      const pinStates = new Map<number, number>();
      for (const { pin, value } of batch) {
        pinStates.set(pin, value);
      }

      // Track coalesced writes
      const coalesced = batch.length - pinStates.size;
      this.stats.coalescedWrites += coalesced;

      // Write all pins asynchronously (non-blocking)
      const writePromises = Array.from(pinStates.entries()).map(
        async ([pin, value]) => {
          const pinInfo = this.pins.get(pin);
          if (pinInfo && pinInfo.gpio) {
            try {
              await pinInfo.gpio.write(value);
              this.stats.totalWrites++;
            } catch (error) {
              this.stats.errors++;
              console.error(`Failed to write GPIO pin ${pin}:`, error);
            }
          }
        }
      );

      await Promise.all(writePromises);
      this.stats.lastFlush = Date.now();
    } catch (error) {
      this.stats.errors++;
      console.error('GPIO queue flush error:', error);
    } finally {
      this.processing = false;

      // If more writes were queued during processing, flush again
      if (this.writeQueue.length > 0 && !this.flushTimeout) {
        this.flushTimeout = setTimeout(() => {
          this.flushQueue();
        }, this.DEBOUNCE_MS);
      }
    }
  }

  /**
   * Blink LED for specified duration (with debouncing)
   * Prevents GPIO spam during high-frequency RX/TX activity
   * @param pin GPIO pin number (BCM numbering)
   * @param durationMs Blink duration in milliseconds
   */
  public blinkLed(pin: number, durationMs: number): void {
    if (!this.isAvailable()) {
      return; // No-op
    }

    // Check if this pin is already blinking (debounce)
    const existingTimeout = this.blinkDebounce.get(pin);
    if (existingTimeout) {
      // LED is already on, just extend the off timer
      clearTimeout(existingTimeout);
    } else {
      // Turn on LED (only if not already blinking)
      this.setLed(pin, true);
    }

    // Schedule turn off
    const timeout = setTimeout(() => {
      this.setLed(pin, false);
      this.blinkDebounce.delete(pin);
    }, durationMs);

    this.blinkDebounce.set(pin, timeout);
  }

  /**
   * Cleanup all GPIO pins
   */
  public async cleanup(): Promise<void> {
    // Clear all pending timeouts
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }

    for (const timeout of this.blinkDebounce.values()) {
      clearTimeout(timeout);
    }
    this.blinkDebounce.clear();

    // Flush any pending writes before cleanup
    if (this.writeQueue.length > 0) {
      await this.flushQueue();
    }

    if (this.isAvailable()) {
      // Turn off all LEDs using async writes
      const cleanupPromises = Array.from(this.pins.entries()).map(
        async ([pin, pinInfo]) => {
          try {
            if (pinInfo.gpio) {
              // Turn off LED before unexport (async)
              const offValue = this.activeLow ? 1 : 0;
              await pinInfo.gpio.write(offValue);
              pinInfo.gpio.unexport();
            }
          } catch (error) {
            console.error(`Failed to cleanup GPIO pin ${pin}:`, error);
          }
        }
      );

      await Promise.all(cleanupPromises);
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
   * Get performance statistics
   */
  public getStats(): GpioStats & { queueLength: number; isProcessing: boolean } {
    return {
      ...this.stats,
      queueLength: this.writeQueue.length,
      isProcessing: this.processing,
    };
  }

  /**
   * Reset statistics (for monitoring)
   */
  public resetStats(): void {
    this.stats = {
      totalWrites: 0,
      queuedWrites: 0,
      coalescedWrites: 0,
      errors: 0,
      lastFlush: 0,
    };
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
