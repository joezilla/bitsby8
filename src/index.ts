#!/usr/bin/env node

/**
 * FDC+ Serial Drive Server - Main Entry Point
 * TypeScript port of original C implementation
 */

import { Command } from 'commander';
import {
  FDCSDS_NAME,
  FDCSDS_COPYRIGHT,
  FDCSDS_VERSION,
  BaudRate,
  createDefaultConfig,
  Config,
} from './protocol';
import { getDriveManager } from './drive';
import { getSerialPortManager } from './serial';
import { getTerminalSerialManager } from './terminal-serial';
import { getDisplayManager } from './ui/display';
import { FdcServer } from './server';
import { WebServer } from './web-server';
import { loadConfigFile, mergeConfig, getExampleConfig, DEFAULT_CONFIG_LOCATIONS } from './config';
import { getGpioLedController, DEFAULT_GPIO_CONFIG } from './gpio';
import { getLogger } from './logger';
import * as path from 'path';

/**
 * Print help information
 */
function printHelp(): void {
  console.log(`\n${FDCSDS_NAME} v${FDCSDS_VERSION}`);
  console.log(`${FDCSDS_COPYRIGHT}\n`);
  console.log('Serial Disk Server compatible with the FDC+ Enhanced Floppy Disk');
  console.log('Controller for the Altair 8800 available at http://www.deramp.com\n');
  console.log('Usage: fdcsds [options] -p <port>\n');
  console.log('Options:');
  console.log('  -0, --drive0 <file>    Mount disk image file to drive 0');
  console.log('  -1, --drive1 <file>    Mount disk image file to drive 1');
  console.log('  -2, --drive2 <file>    Mount disk image file to drive 2');
  console.log('  -3, --drive3 <file>    Mount disk image file to drive 3');
  console.log('                         The FDC+ in serial disk mode supports 330K 8 inch,');
  console.log('                         75K Minidisk, and 8MB disk images.');
  console.log('  -b, --baud <rate>      Set serial port speed (default: 230400)');
  console.log('  -p, --port <device>    Serial port (required)');
  console.log('  -r, --readonly <n>     Make drive 0-3 read only (can be used multiple times)');
  console.log('  -v, --verbose          Verbose display');
  console.log('  -d, --debug            Debug mode');
  console.log('  --headless             Disable text-based status display (for systemd/background)');
  console.log('  --log-file <path>      Log file path (enables file-based logging)');
  console.log('  -w, --web              Enable web interface (default: disabled)');
  console.log('  --web-port <port>      Web interface port (default: 3000)');
  console.log('  --web-host <host>      Web interface host (default: localhost)');
  console.log('  --terminal-port <device>  Second serial port for terminal emulation');
  console.log('  --terminal-baud <rate>    Terminal port baud rate (default: 9600)');
  console.log('  --terminal-autoconnect    Auto-connect terminal port on startup');
  console.log('  --gpio-leds               Enable GPIO LED status indicators (Raspberry Pi)');
  console.log('  --no-gpio-leds            Disable GPIO LED status indicators');
  console.log('  --gpio-active-low         Use active-low logic for LEDs');
  console.log('  -c, --config <file>       Configuration file path (default: .fdcsds.config)');
  console.log('  --example-config          Print example configuration file and exit');
  console.log('  -h, --help             Display this help message\n');
  console.log('Supported baud rates: 9600, 19200, 38400, 57600, 76800, 230400, 460800\n');
  console.log('Default config file locations (searched in order):');
  DEFAULT_CONFIG_LOCATIONS.forEach(loc => console.log(`  - ${loc}`));
  console.log();
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const program = new Command();

  program
    .name('fdcsds')
    .description('FDC+ Serial Drive Server')
    .version(FDCSDS_VERSION)
    .option('-p, --port <device>', 'Serial port (required)')
    .option('-b, --baud <rate>', 'Set serial port speed')
    .option('-0, --drive0 <file>', 'Mount disk image to drive 0')
    .option('-1, --drive1 <file>', 'Mount disk image to drive 1')
    .option('-2, --drive2 <file>', 'Mount disk image to drive 2')
    .option('-3, --drive3 <file>', 'Mount disk image to drive 3')
    .option('-r, --readonly <drive>', 'Make drive read-only', (value, previous: number[]) => {
      return previous.concat([parseInt(value)]);
    }, [] as number[])
    .option('-v, --verbose', 'Verbose display')
    .option('-d, --debug', 'Debug mode')
    .option('--headless', 'Disable text-based status display (for systemd/background)')
    .option('--log-file <path>', 'Log file path (enables file-based logging)')
    .option('-w, --web', 'Enable web interface')
    .option('--web-port <port>', 'Web interface port')
    .option('--web-host <host>', 'Web interface host')
    .option('--terminal-port <device>', 'Second serial port for terminal emulation')
    .option('--terminal-baud <rate>', 'Terminal port baud rate')
    .option('--terminal-autoconnect', 'Auto-connect terminal port on startup')
    .option('--gpio-leds', 'Enable GPIO LED status indicators (Raspberry Pi)')
    .option('--no-gpio-leds', 'Disable GPIO LED status indicators')
    .option('--gpio-active-low', 'Use active-low logic for LEDs')
    .option('-c, --config <file>', 'Configuration file path')
    .option('--example-config', 'Print example configuration file and exit')
    .helpOption('-h, --help', 'Display help information');

  program.parse(process.argv);

  const options = program.opts();

  // Show custom help if requested
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  // Print example config if requested
  if (options.exampleConfig) {
    console.log('# Example FDC+ Serial Drive Server Configuration File');
    console.log('# Save as .fdcsds.config, .config/fdcsds.json, or fdcsds.config.json\n');
    console.log(getExampleConfig());
    process.exit(0);
  }

  // Load configuration file
  let configFile = null;
  try {
    configFile = await loadConfigFile(options.config);
    if (configFile) {
      console.log('Configuration loaded successfully');
      console.log(`  Port: ${configFile.port || '(not set)'}`);
      console.log(`  Baud: ${configFile.baud || '(not set)'}`);
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }

  // Merge config file with command line options (CLI takes precedence)
  const mergedOptions = mergeConfig(configFile, options);

  console.log('Final configuration after merge:');
  console.log(`  Port: ${mergedOptions.port || '(not set)'}`);
  console.log(`  Baud: ${mergedOptions.baud || '(not set)'} (type: ${typeof mergedOptions.baud})`);
  console.log(`  Web: ${mergedOptions.web}`);
  console.log(`  WebPort: ${mergedOptions.webPort}`);
  console.log(`  WebHost: ${mergedOptions.webHost}`);
  console.log(`  Drive0: ${mergedOptions.drive0 || '(not set)'}`);
  console.log(`  Drive1: ${mergedOptions.drive1 || '(not set)'}`);
  console.log(`  TerminalPort: ${mergedOptions.terminalPort || '(not set)'}`);
  console.log(`  TerminalBaud: ${mergedOptions.terminalBaud || '(not set)'}`);
  console.log(`  TerminalAutoconnect: ${mergedOptions.terminalAutoconnect}`);

  // Port is optional if web interface is enabled (can connect later via UI)
  if (!mergedOptions.port && !mergedOptions.web) {
    printHelp();
    console.error('Error: You must specify a serial port with \'-p\' option, in config file, or enable web interface.\n');
    process.exit(1);
  }

  // Parse baud rate (handle both string and number from config)
  const baudRateValue = mergedOptions.baud || 230400;
  const baudRate = typeof baudRateValue === 'string' ? parseInt(baudRateValue) : baudRateValue;

  // Debug output
  if (configFile) {
    console.log(`Loaded config from file. Baud rate: ${baudRate}`);
  }

  if (!Object.values(BaudRate).includes(baudRate as BaudRate)) {
    console.error(`Error: Invalid baud rate: ${baudRate}`);
    console.error('Supported rates: 9600, 19200, 38400, 57600, 76800, 230400, 460800\n');
    process.exit(1);
  }

  // Create configuration
  const config: Config = createDefaultConfig();
  config.port = mergedOptions.port;
  config.baudRate = baudRate as BaudRate;
  config.verbose = mergedOptions.verbose || false;
  config.debug = mergedOptions.debug || false;
  const headless = mergedOptions.headless || false;

  // Parse drive mounts (skip empty strings)
  if (mergedOptions.drive0 && mergedOptions.drive0.trim()) config.drives.set(0, mergedOptions.drive0);
  if (mergedOptions.drive1 && mergedOptions.drive1.trim()) config.drives.set(1, mergedOptions.drive1);
  if (mergedOptions.drive2 && mergedOptions.drive2.trim()) config.drives.set(2, mergedOptions.drive2);
  if (mergedOptions.drive3 && mergedOptions.drive3.trim()) config.drives.set(3, mergedOptions.drive3);

  // Parse read-only drives
  if (mergedOptions.readonly && Array.isArray(mergedOptions.readonly)) {
    for (const drive of mergedOptions.readonly) {
      if (drive >= 0 && drive <= 3) {
        config.readonlyDrives.add(drive);
      }
    }
  }

  // Get singleton instances
  const driveManager = getDriveManager();
  const serialManager = getSerialPortManager();
  const terminalManager = getTerminalSerialManager();
  const displayManager = getDisplayManager();
  const gpioController = getGpioLedController();
  const logger = getLogger();

  try {

    // Initialize file-based logging if requested
    if (mergedOptions.logFile) {
      try {
        // In headless mode, disable console output (logs go to file only)
        // In normal mode, enable console output (logs go to both file and console)
        await logger.initialize(mergedOptions.logFile, !headless);
        console.log(`File-based logging enabled: ${mergedOptions.logFile}`);
      } catch (error) {
        console.error('Failed to initialize logging:', error);
        console.log('Continuing without file-based logging');
      }
    }

    // Initialize display (unless running in headless mode)
    if (!headless) {
      displayManager.init();
    } else {
      console.log('Running in headless mode (text-based display disabled)');
    }

    // Initialize GPIO LEDs if enabled
    if (mergedOptions.gpioLeds?.enabled !== false && mergedOptions.gpioLeds !== undefined) {
      try {
        // Merge user config with defaults to preserve all pin configurations
        const gpioConfig = {
          ...DEFAULT_GPIO_CONFIG,
          ...mergedOptions.gpioLeds,
          // Merge nested drive configs
          drive0: { ...DEFAULT_GPIO_CONFIG.drive0, ...mergedOptions.gpioLeds.drive0 },
          drive1: { ...DEFAULT_GPIO_CONFIG.drive1, ...mergedOptions.gpioLeds.drive1 },
          drive2: { ...DEFAULT_GPIO_CONFIG.drive2, ...mergedOptions.gpioLeds.drive2 },
          drive3: { ...DEFAULT_GPIO_CONFIG.drive3, ...mergedOptions.gpioLeds.drive3 },
          terminal: { ...DEFAULT_GPIO_CONFIG.terminal, ...mergedOptions.gpioLeds.terminal },
        };
        // Ensure enabled flag is set
        if (gpioConfig.enabled === undefined) {
          gpioConfig.enabled = true;
        }

        await gpioController.initialize(gpioConfig);

        if (gpioController.isAvailable()) {
          console.log('GPIO LED status indicators enabled');

          // Blink all LEDs once as a startup test
          console.log('Testing GPIO LEDs...');
          await gpioController.blinkAllLeds(500);
          console.log('GPIO LED test complete');
        } else {
          console.log('GPIO LED support not available on this platform (continuing without LEDs)');
        }
      } catch (error) {
        console.error('Failed to initialize GPIO LEDs:', error);
        console.log('Continuing without GPIO LED support');
      }
    }

    // Set write protection for read-only drives
    for (const drive of config.readonlyDrives) {
      driveManager.writeProtect(drive, true);
      displayManager.displayRO(drive, true);
    }

    // Mount drives
    for (const [driveNum, filename] of config.drives.entries()) {
      try {
        await driveManager.mountDrive(driveNum, filename);
        displayManager.displayMount(driveNum, filename);
      } catch (error) {
        displayManager.displayMount(driveNum, '--ERROR--');
        displayManager.displayError(
          `Failed to mount drive ${driveNum}`,
          error as NodeJS.ErrnoException
        );
      }
    }

    // Open serial port (allow failure if web interface is enabled)
    if (config.port) {
      try {
        await serialManager.openPort(config.port, config.baudRate);
        displayManager.displayPort(config.port);
        displayManager.displayBaud(config.baudRate);
        console.log(`Serial port connected: ${config.port} @ ${config.baudRate} baud`);
      } catch (error) {
        console.error(`Failed to open serial port ${config.port}:`, error);
        if (!mergedOptions.web) {
          // Only throw error if web interface is disabled
          console.error('Error: Serial port required when web interface is disabled.');
          throw error;
        }
        // If web interface is enabled, continue without serial port
        console.log('Continuing without serial port connection. Use web interface to reconnect.');
      }
    } else {
      console.log('No serial port specified. Use web interface to connect.');
    }

    // Auto-connect terminal if requested
    if (mergedOptions.terminalPort && mergedOptions.terminalAutoconnect) {
      try {
        const terminalBaudValue = mergedOptions.terminalBaud || 9600;
        const terminalBaud = typeof terminalBaudValue === 'string' ? parseInt(terminalBaudValue) : terminalBaudValue;
        await terminalManager.openPort(mergedOptions.terminalPort, {
          baudRate: terminalBaud as any,
        });
        console.log(`Terminal port connected: ${mergedOptions.terminalPort} @ ${terminalBaud} baud`);
      } catch (error) {
        console.error('Failed to auto-connect terminal port:', error);
      }
    }

    // Create web server if enabled
    let webServer: WebServer | null = null;
    if (mergedOptions.web) {
      const webConfig = {
        port: parseInt(mergedOptions.webPort || '3000'),
        host: mergedOptions.webHost || 'localhost',
        disksDir: path.join(process.cwd(), 'disks'),
      };

      // Pass preferred terminal settings from config
      const preferredTerminalSettings = {
        port: mergedOptions.terminalPort,
        baud: mergedOptions.terminalBaud,
      };

      webServer = new WebServer(webConfig, driveManager, serialManager, terminalManager, preferredTerminalSettings);
      await webServer.start();
    }

    // Create and start server
    const server = new FdcServer(
      driveManager,
      serialManager,
      displayManager,
      config
    );

    // Setup signal handlers
    const cleanup = async () => {
      server.stop();
      if (webServer) {
        await webServer.stop();
      }
      await serialManager.closePort();
      await terminalManager.closePort();
      await driveManager.unmountAll();

      // Cleanup GPIO LEDs
      if (gpioController.isInitialized()) {
        await gpioController.shutdown();
      }

      // Close logger
      if (logger.isInitialized()) {
        await logger.close();
      }

      displayManager.reset();
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Start server
    await server.start();

  } catch (error) {
    displayManager.reset();

    // Close logger if initialized
    if (logger.isInitialized()) {
      await logger.close().catch(() => {});
    }

    console.error('Error:', error);
    process.exit(1);
  }
}

// Run main function
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
