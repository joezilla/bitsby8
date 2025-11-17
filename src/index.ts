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
import { getDisplayManager } from './ui/display';
import { FdcServer } from './server';
import { WebServer } from './web-server';
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
  console.log('  -w, --web              Enable web interface (default: disabled)');
  console.log('  --web-port <port>      Web interface port (default: 3000)');
  console.log('  --web-host <host>      Web interface host (default: localhost)');
  console.log('  -h, --help             Display this help message\n');
  console.log('Supported baud rates: 9600, 19200, 38400, 57600, 76800, 230400, 460800\n');
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
    .option('-b, --baud <rate>', 'Set serial port speed', '230400')
    .option('-0, --drive0 <file>', 'Mount disk image to drive 0')
    .option('-1, --drive1 <file>', 'Mount disk image to drive 1')
    .option('-2, --drive2 <file>', 'Mount disk image to drive 2')
    .option('-3, --drive3 <file>', 'Mount disk image to drive 3')
    .option('-r, --readonly <drive>', 'Make drive read-only', (value, previous: number[]) => {
      return previous.concat([parseInt(value)]);
    }, [] as number[])
    .option('-v, --verbose', 'Verbose display', false)
    .option('-d, --debug', 'Debug mode', false)
    .option('-w, --web', 'Enable web interface', false)
    .option('--web-port <port>', 'Web interface port', '3000')
    .option('--web-host <host>', 'Web interface host', 'localhost')
    .helpOption('-h, --help', 'Display help information');

  program.parse(process.argv);

  const options = program.opts();

  // Show custom help if requested
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  // Validate port is specified
  if (!options.port) {
    printHelp();
    console.error('Error: You must specify a serial port with \'-p\' option.\n');
    process.exit(1);
  }

  // Parse baud rate
  const baudRate = parseInt(options.baud);
  if (!Object.values(BaudRate).includes(baudRate as BaudRate)) {
    console.error(`Error: Invalid baud rate: ${baudRate}`);
    console.error('Supported rates: 9600, 19200, 38400, 57600, 76800, 230400, 460800\n');
    process.exit(1);
  }

  // Create configuration
  const config: Config = createDefaultConfig();
  config.port = options.port;
  config.baudRate = baudRate as BaudRate;
  config.verbose = options.verbose || false;
  config.debug = options.debug || false;

  // Parse drive mounts
  if (options.drive0) config.drives.set(0, options.drive0);
  if (options.drive1) config.drives.set(1, options.drive1);
  if (options.drive2) config.drives.set(2, options.drive2);
  if (options.drive3) config.drives.set(3, options.drive3);

  // Parse read-only drives
  if (options.readonly && Array.isArray(options.readonly)) {
    for (const drive of options.readonly) {
      if (drive >= 0 && drive <= 3) {
        config.readonlyDrives.add(drive);
      }
    }
  }

  // Get singleton instances
  const driveManager = getDriveManager();
  const serialManager = getSerialPortManager();
  const displayManager = getDisplayManager();

  // Initialize display
  displayManager.init();

  try {
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

    // Open serial port
    await serialManager.openPort(config.port!, config.baudRate);
    displayManager.displayPort(config.port!);
    displayManager.displayBaud(config.baudRate);

    // Create web server if enabled
    let webServer: WebServer | null = null;
    if (options.web) {
      const webConfig = {
        port: parseInt(options.webPort),
        host: options.webHost,
        disksDir: path.join(process.cwd(), 'disks'),
      };

      webServer = new WebServer(webConfig, driveManager, serialManager);
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
      await driveManager.unmountAll();
      displayManager.reset();
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Start server
    await server.start();

  } catch (error) {
    displayManager.reset();
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run main function
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
