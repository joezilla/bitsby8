/**
 * GPIO LED Manager - Low-level GPIO control
 *
 * Provides platform-aware GPIO pin management using gpiod CLI tools.
 * Uses the official Linux kernel GPIO interface via gpioset/gpioget commands.
 *
 * - Zero npm dependencies
 * - Works on Pi 4, Pi 5, and all modern Raspberry Pi models
 * - Simple and reliable
 */

import * as fs from 'fs';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * GPIO implementation interface
 */
interface IGpioImplementation {
  name: string;
  initialize(activeLow: boolean): Promise<void>;
  setupPin(pin: number): Promise<void>;
  setPin(pin: number, value: boolean): void;
  cleanup(): Promise<void>;
  isAvailable(): boolean;
}

// lgpio native implementation removed due to API incompatibility issues
// Using CLI-only approach which is reliable and has zero npm dependencies

/**
 * gpiod CLI implementation (fallback, zero dependencies)
 */
class GpiodCliImplementation implements IGpioImplementation {
  name = 'gpiod-cli';
  private pins: Set<number> = new Set();
  private activeLow: boolean = false;
  private chipName: string = 'gpiochip0';

  isAvailable(): boolean {
    // Check if gpioset command exists
    try {
      const { execSync } = require('child_process');
      execSync('which gpioset', { stdio: 'ignore' });
      return true;
    } catch (error) {
      return false;
    }
  }

  async initialize(activeLow: boolean): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('gpiod CLI tools not available');
    }

    this.activeLow = activeLow;

    // Determine which gpiochip to use (gpiochip0 or gpiochip4 on some Pi 5 versions)
    // We'll default to gpiochip0 as it's standard on latest kernels
    this.chipName = 'gpiochip0';
  }

  async setupPin(pin: number): Promise<void> {
    // With CLI, we don't need to explicitly setup pins
    // Just record that this pin is managed
    this.pins.add(pin);

    // Initialize pin to off state
    await this.setPinAsync(pin, false);
  }

  setPin(pin: number, value: boolean): void {
    if (!this.pins.has(pin)) {
      return;
    }

    // Use fire-and-forget for synchronous interface
    this.setPinAsync(pin, value).catch(error => {
      console.error(`gpiod-cli: Failed to write pin ${pin}:`, error);
    });
  }

  private async setPinAsync(pin: number, value: boolean): Promise<void> {
    // Determine the value based on active-low setting
    let gpioValue = value ? 1 : 0;
    if (this.activeLow) {
      gpioValue = value ? 0 : 1;
    }

    const cmd = `gpioset ${this.chipName} ${pin}=${gpioValue}`;

    try {
      // Note: gpioset exits immediately after setting, so we use --mode=time with 0 duration
      // This sets the value and exits, making the pin hold its state
      await execAsync(`${cmd} --mode=exit`);
    } catch (error) {
      throw new Error(`Failed to execute: ${cmd} - ${error}`);
    }
  }

  async cleanup(): Promise<void> {
    // Turn off all pins
    for (const pin of this.pins) {
      try {
        await this.setPinAsync(pin, false);
      } catch (error) {
        console.error(`gpiod-cli: Failed to cleanup pin ${pin}:`, error);
      }
    }

    this.pins.clear();
  }
}

export interface GpioPin {
  pin: number;
}

/**
 * GpioLedManager - Singleton for managing GPIO pins
 * Automatically selects best available implementation
 */
export class GpioLedManager {
  private static instance: GpioLedManager | null = null;
  private pins: Map<number, GpioPin> = new Map();
  private initialized: boolean = false;
  private platformSupported: boolean = false;
  private implementation: IGpioImplementation | null = null;

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

    // Try to detect Raspberry Pi from /proc/cpuinfo or check for GPIO devices
    try {
      const cpuInfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
      const isRaspberryPi = cpuInfo.includes('Raspberry Pi') || cpuInfo.includes('BCM');
      if (isRaspberryPi) {
        return true;
      }
    } catch (error) {
      // Ignore
    }

    // Also check if GPIO devices exist
    try {
      return fs.existsSync('/dev/gpiochip0') || fs.existsSync('/dev/gpiochip4');
    } catch (error) {
      return false;
    }
  }

  /**
   * Select and initialize the best available GPIO implementation
   */
  private async selectImplementation(activeLow: boolean): Promise<void> {
    // Use CLI implementation (zero npm dependencies, always works)
    const impl = new GpiodCliImplementation();

    if (impl.isAvailable()) {
      try {
        await impl.initialize(activeLow);
        this.implementation = impl;
        console.log(`GPIO: Using ${impl.name} implementation`);
        return;
      } catch (error) {
        console.warn(`GPIO: ${impl.name} initialization failed:`, error);
      }
    }

    throw new Error('No GPIO implementation available. Install gpiod tools: sudo apt install gpiod');
  }

  /**
   * Check if GPIO is available on this platform
   */
  public isAvailable(): boolean {
    return this.platformSupported && this.implementation !== null;
  }

  /**
   * Get platform information for logging
   */
  public getPlatformInfo(): string {
    const implName = this.implementation ? this.implementation.name : 'none';
    return `Platform: ${os.platform()}, Implementation: ${implName}, Supported: ${this.platformSupported}`;
  }

  /**
   * Initialize GPIO with active-low configuration
   */
  public async initialize(activeLow: boolean = false): Promise<void> {
    if (this.initialized) {
      throw new Error('GPIO Manager already initialized');
    }

    if (!this.platformSupported) {
      // Silent no-op on unsupported platforms
      this.initialized = true;
      return;
    }

    await this.selectImplementation(activeLow);
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

    if (!this.isAvailable() || !this.implementation) {
      // No-op if no implementation available
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

    await this.implementation.setupPin(pin);
    this.pins.set(pin, { pin });
  }

  /**
   * Set LED state
   * @param pin GPIO pin number
   * @param state true = on, false = off
   */
  public setLed(pin: number, state: boolean): void {
    if (!this.isAvailable() || !this.implementation) {
      return; // No-op
    }

    const pinInfo = this.pins.get(pin);
    if (!pinInfo) {
      // Pin not setup, ignore
      return;
    }

    this.implementation.setPin(pin, state);
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
    if (this.implementation) {
      await this.implementation.cleanup();
      this.implementation = null;
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
