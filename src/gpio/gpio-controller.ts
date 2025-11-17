/**
 * GPIO LED Controller - High-level LED state management
 *
 * Maps application state (drives, terminal) to GPIO LED updates.
 * Coordinates with GpioLedManager for actual hardware control.
 */

import { GpioLedManager } from './gpio-manager';
import { DriveState } from '../protocol';

export interface GpioDrivePinConfig {
  enable?: number | null;
  headLoad?: number | null;
  readOnly?: number | null;
}

export interface GpioTerminalPinConfig {
  rx?: number | null;
  tx?: number | null;
  connected?: number | null;
}

export interface GpioLedConfig {
  enabled: boolean;
  drive0?: GpioDrivePinConfig;
  drive1?: GpioDrivePinConfig;
  drive2?: GpioDrivePinConfig;
  drive3?: GpioDrivePinConfig;
  terminal?: GpioTerminalPinConfig;
  blinkDuration?: number;
  activeLow?: boolean;
}

interface DriveConfig {
  enablePin: number | null;
  headLoadPin: number | null;
  readOnlyPin: number | null;
}

interface TerminalConfig {
  rxPin: number | null;
  txPin: number | null;
  connectedPin: number | null;
}

/**
 * GpioLedController - Singleton for high-level LED control
 */
export class GpioLedController {
  private static instance: GpioLedController | null = null;
  private manager: GpioLedManager;
  private config: GpioLedConfig | null = null;
  private driveConfigs: Map<number, DriveConfig> = new Map();
  private terminalConfig: TerminalConfig | null = null;
  private blinkDuration: number = 100; // Default 100ms blink
  private initialized: boolean = false;

  private constructor() {
    this.manager = GpioLedManager.getInstance();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): GpioLedController {
    if (!GpioLedController.instance) {
      GpioLedController.instance = new GpioLedController();
    }
    return GpioLedController.instance;
  }

  /**
   * Initialize GPIO LED controller with configuration
   */
  public async initialize(config: GpioLedConfig): Promise<void> {
    if (this.initialized) {
      throw new Error('GPIO LED Controller already initialized');
    }

    if (!config.enabled) {
      // Disabled, don't initialize
      return;
    }

    this.config = config;
    this.blinkDuration = config.blinkDuration || 100;

    // Initialize GPIO manager
    await this.manager.initialize(config.activeLow || false);

    if (!this.manager.isAvailable()) {
      // Platform not supported, silently disable
      return;
    }

    // Setup drive pins
    this.setupDrivePins(0, config.drive0);
    this.setupDrivePins(1, config.drive1);
    this.setupDrivePins(2, config.drive2);
    this.setupDrivePins(3, config.drive3);

    // Setup terminal pins
    this.setupTerminalPins(config.terminal);

    this.initialized = true;
  }

  /**
   * Setup GPIO pins for a drive
   */
  private setupDrivePins(driveNum: number, pinConfig?: GpioDrivePinConfig): void {
    if (!pinConfig) {
      this.driveConfigs.set(driveNum, {
        enablePin: null,
        headLoadPin: null,
        readOnlyPin: null,
      });
      return;
    }

    const config: DriveConfig = {
      enablePin: pinConfig.enable ?? null,
      headLoadPin: pinConfig.headLoad ?? null,
      readOnlyPin: pinConfig.readOnly ?? null,
    };

    // Setup each configured pin
    if (config.enablePin !== null) {
      this.manager.setupPin(config.enablePin);
    }
    if (config.headLoadPin !== null) {
      this.manager.setupPin(config.headLoadPin);
    }
    if (config.readOnlyPin !== null) {
      this.manager.setupPin(config.readOnlyPin);
    }

    this.driveConfigs.set(driveNum, config);
  }

  /**
   * Setup GPIO pins for terminal
   */
  private setupTerminalPins(pinConfig?: GpioTerminalPinConfig): void {
    if (!pinConfig) {
      this.terminalConfig = {
        rxPin: null,
        txPin: null,
        connectedPin: null,
      };
      return;
    }

    this.terminalConfig = {
      rxPin: pinConfig.rx ?? null,
      txPin: pinConfig.tx ?? null,
      connectedPin: pinConfig.connected ?? null,
    };

    // Setup each configured pin
    if (this.terminalConfig.rxPin !== null) {
      this.manager.setupPin(this.terminalConfig.rxPin);
    }
    if (this.terminalConfig.txPin !== null) {
      this.manager.setupPin(this.terminalConfig.txPin);
    }
    if (this.terminalConfig.connectedPin !== null) {
      this.manager.setupPin(this.terminalConfig.connectedPin);
    }
  }

  /**
   * Update drive status LEDs
   */
  public updateDriveStatus(driveNum: number, driveState: DriveState): void {
    if (!this.initialized || !this.manager.isAvailable()) {
      return; // No-op
    }

    const config = this.driveConfigs.get(driveNum);
    if (!config) {
      return; // Drive not configured
    }

    // Update enable LED (mounted status)
    if (config.enablePin !== null) {
      this.manager.setLed(config.enablePin, driveState.mounted);
    }

    // Update head load LED
    if (config.headLoadPin !== null) {
      this.manager.setLed(config.headLoadPin, driveState.hdld);
    }

    // Update read-only LED
    if (config.readOnlyPin !== null) {
      this.manager.setLed(config.readOnlyPin, driveState.readonly);
    }
  }

  /**
   * Blink terminal RX LED
   */
  public updateTerminalRx(): void {
    if (!this.initialized || !this.manager.isAvailable() || !this.terminalConfig) {
      return; // No-op
    }

    if (this.terminalConfig.rxPin !== null) {
      this.manager.blinkLed(this.terminalConfig.rxPin, this.blinkDuration);
    }
  }

  /**
   * Blink terminal TX LED
   */
  public updateTerminalTx(): void {
    if (!this.initialized || !this.manager.isAvailable() || !this.terminalConfig) {
      return; // No-op
    }

    if (this.terminalConfig.txPin !== null) {
      this.manager.blinkLed(this.terminalConfig.txPin, this.blinkDuration);
    }
  }

  /**
   * Update terminal connected LED
   */
  public updateTerminalConnected(connected: boolean): void {
    if (!this.initialized || !this.manager.isAvailable() || !this.terminalConfig) {
      return; // No-op
    }

    if (this.terminalConfig.connectedPin !== null) {
      this.manager.setLed(this.terminalConfig.connectedPin, connected);
    }
  }

  /**
   * Check if GPIO is available
   */
  public isAvailable(): boolean {
    return this.manager.isAvailable();
  }

  /**
   * Check if initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get configuration
   */
  public getConfig(): GpioLedConfig | null {
    return this.config;
  }

  /**
   * Shutdown and cleanup
   */
  public async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    await this.manager.cleanup();
    this.initialized = false;
    this.config = null;
    this.driveConfigs.clear();
    this.terminalConfig = null;
  }

  /**
   * Reset singleton (for testing)
   */
  public static resetInstance(): void {
    if (GpioLedController.instance) {
      GpioLedController.instance.shutdown().catch(() => {});
      GpioLedController.instance = null;
    }
  }
}

/**
 * Get the singleton GPIO LED controller instance
 */
export function getGpioLedController(): GpioLedController {
  return GpioLedController.getInstance();
}

/**
 * Default GPIO pin configuration
 */
export const DEFAULT_GPIO_CONFIG: GpioLedConfig = {
  enabled: false,
  drive0: {
    enable: 17,
    headLoad: 27,
    readOnly: 22,
  },
  drive1: {
    enable: 23,
    headLoad: 24,
    readOnly: 25,
  },
  drive2: {
    enable: 5,
    headLoad: 6,
    readOnly: 13,
  },
  drive3: {
    enable: 19,
    headLoad: 26,
    readOnly: 12,
  },
  terminal: {
    rx: 16,
    tx: 20,
    connected: 21,
  },
  blinkDuration: 100,
  activeLow: false,
};
