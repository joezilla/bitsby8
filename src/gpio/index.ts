/**
 * GPIO Module - LED Status Indicators for Raspberry Pi
 *
 * Provides optional GPIO LED support for displaying real-time status:
 * - Drive status (enable, head load, read-only) for 4 drives
 * - Terminal status (RX, TX, connected)
 *
 * Gracefully handles non-Raspberry Pi platforms with no-op implementations.
 */

export {
  GpioLedManager,
  getGpioLedManager,
  GpioPin,
} from './gpio-manager';

export {
  GpioLedController,
  getGpioLedController,
  GpioLedConfig,
  GpioDrivePinConfig,
  GpioTerminalPinConfig,
  DEFAULT_GPIO_CONFIG,
} from './gpio-controller';
