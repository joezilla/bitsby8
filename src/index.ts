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
import { getDriveManager, TRANSIENT_DIRNAME } from './drive';
import { getMountRegistry } from './mount-registry';
import type { ReadonlyWritePolicy } from './database';
import { getSerialPortManager } from './serial';
import { getTerminalSerialManager } from './terminal-serial';
import { FdcServer } from './server';
import { WebServer } from './web-server';
import {
  loadConfigFile,
  loadOverridesFile,
  mergeConfig,
  mergeConfigLayers,
  getExampleConfig,
  DEFAULT_CONFIG_LOCATIONS,
  OVERRIDE_FILENAME,
  resolveDataDir,
  resolveDrivePath,
} from './config';
import { getGpioLedController, DEFAULT_GPIO_CONFIG } from './gpio';
import { getLogger } from './logger';
import { resolvePortPath, listPortsWithPersistent } from './port-resolver';
import * as path from 'path';
import * as fs from 'fs/promises';

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
  console.log('                         Example: /dev/serial/by-id/usb-FTDI_FT232R_USB_UART_ABC123-if00-port0');
  console.log('  -r, --readonly <n>     Make drive 0-3 read only (can be used multiple times)');
  console.log('  -v, --verbose          Verbose display');
  console.log('  -d, --debug            Debug mode');
  console.log('  --log-file <path>      Log file path (enables file-based logging)');
  console.log('  -w, --web              Enable web interface (default: disabled)');
  console.log('  --web-port <port>      Web interface port (default: 3000)');
  console.log('  --web-host <host>      Web interface host (default: localhost)');
  console.log('  --terminal-port <device>  Second serial port for terminal emulation');
  console.log('  --terminal-baud <rate>    Terminal port baud rate (default: 9600)');
  console.log('  --terminal-autoconnect    Auto-connect terminal port on startup');
  console.log('  --terminal-only           Disable FDC drive serving (terminal mode only)');
  console.log('  --gpio-leds               Enable GPIO LED status indicators (Raspberry Pi)');
  console.log('  --no-gpio-leds            Disable GPIO LED status indicators');
  console.log('  --gpio-active-low         Use active-low logic for LEDs');
  console.log('  --data-dir <path>         Data directory for dynamic content');
  console.log('  -c, --config <file>       Configuration file path (default: .fdcsds.config)');
  console.log('  --example-config          Print example configuration file and exit');
  console.log('  --show-persistent-paths   Show persistent path alternatives for configured ports');
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
    .option('--log-file <path>', 'Log file path (enables file-based logging)')
    .option('-w, --web', 'Enable web interface')
    .option('--web-port <port>', 'Web interface port')
    .option('--web-host <host>', 'Web interface host')
    .option('--terminal-port <device>', 'Second serial port for terminal emulation')
    .option('--terminal-baud <rate>', 'Terminal port baud rate')
    .option('--terminal-autoconnect', 'Auto-connect terminal port on startup')
    .option('--terminal-only', 'Disable FDC drive serving (terminal mode only)')
    .option('--gpio-leds', 'Enable GPIO LED status indicators (Raspberry Pi)')
    .option('--no-gpio-leds', 'Disable GPIO LED status indicators')
    .option('--gpio-active-low', 'Use active-low logic for LEDs')
    .option('-c, --config <file>', 'Configuration file path')
    .option('--config-readonly', 'Refuse UI config writes (kiosk/demo mode) — every PUT /api/config/* returns 423 Locked')
    .option('--data-dir <path>', 'Data directory for disks, cassettes, scripts, uploads, and database')
    .option('--example-config', 'Print example configuration file and exit')
    .option('--show-persistent-paths', 'Show persistent path alternatives for configured ports')
    .option('--mcp', 'Start as MCP (Model Context Protocol) server over stdio')
    .option('--mcp-http', 'Serve MCP over HTTP on the web server at /mcp (requires --api-key or apiKey in config)')
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

  // Show persistent paths if requested
  if (options.showPersistentPaths) {
    console.log('Serial Port Path Information\n');

    // Load config to get configured ports
    let loaded = null;
    try {
      loaded = await loadConfigFile(options.config);
    } catch (error) {
      // Ignore config load errors for this command
    }

    const mergedOptions = mergeConfig(loaded?.config ?? null, options);
    const portsToCheck: Array<{ label: string; path: string }> = [];

    if (mergedOptions.port) {
      portsToCheck.push({ label: 'Primary Serial Port', path: mergedOptions.port });
    }

    if (mergedOptions.terminalPort) {
      portsToCheck.push({ label: 'Terminal Serial Port', path: mergedOptions.terminalPort });
    }

    if (portsToCheck.length === 0) {
      console.log('No serial ports configured. Showing all available ports:\n');
      try {
        const allPorts = await listPortsWithPersistent();
        if (allPorts.length === 0) {
          console.log('  No serial ports detected on this system.\n');
        } else {
          for (const port of allPorts) {
            console.log(`Port: ${port.path}`);
            if (port.metadata.manufacturer) {
              console.log(`  Manufacturer: ${port.metadata.manufacturer}`);
            }
            if (port.persistentPaths.byId) {
              console.log(`  Persistent (by-id): ${port.persistentPaths.byId}`);
              console.log(`  ↑ Recommended for config file`);
            } else if (port.persistentPaths.byPath) {
              console.log(`  Persistent (by-path): ${port.persistentPaths.byPath}`);
              console.log(`  ↑ Recommended for config file`);
            } else {
              console.log(`  No persistent path available (non-Linux or built-in port)`);
            }
            console.log();
          }
        }
      } catch (error) {
        console.error(`Error listing ports: ${(error as Error).message}`);
        process.exit(1);
      }
    } else {
      for (const portToCheck of portsToCheck) {
        console.log(`${portToCheck.label}:`);
        try {
          const portInfo = await resolvePortPath(portToCheck.path);
          console.log(`  Current: ${portInfo.path}`);
          console.log(`  Resolved: ${portInfo.resolvedPath}`);
          console.log(`  Exists: ${portInfo.exists ? 'Yes' : 'No'}`);

          if (portInfo.metadata.manufacturer) {
            console.log(`  Manufacturer: ${portInfo.metadata.manufacturer}`);
          }

          if (portInfo.persistentPaths.byId) {
            console.log(`  Persistent (by-id): ${portInfo.persistentPaths.byId}`);
            console.log(`  ↑ Recommended for config file`);
          } else if (portInfo.persistentPaths.byPath) {
            console.log(`  Persistent (by-path): ${portInfo.persistentPaths.byPath}`);
            console.log(`  ↑ Recommended for config file`);
          } else {
            console.log(`  No persistent path available (non-Linux or built-in port)`);
          }
          console.log();
        } catch (error) {
          console.error(`  Error: ${(error as Error).message}\n`);
        }
      }
    }

    process.exit(0);
  }

  // Load the package baseline config file. This is the .deb-installed
  // /etc/fdcsds/fdcsds.config.json in prod, or whichever file was found
  // in DEFAULT_CONFIG_LOCATIONS in dev. The daemon *reads* this file at
  // startup and *never writes it* — every UI-driven save lands in the
  // runtime override file (see below).
  let loaded = null;
  try {
    loaded = await loadConfigFile(options.config);
    if (loaded) {
      console.log('Baseline configuration loaded successfully');
      console.log(`  Baseline: ${loaded.filePath}`);
      console.log(`  Port: ${loaded.config.port || '(not set)'}`);
      console.log(`  Baud: ${loaded.config.baud || '(not set)'}`);
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }

  // Baseline (package config) and its absolute path. Both are read-only
  // from the app's POV. `null` filePath means no baseline was found and
  // the daemon runs with all-defaults, which is fine for dev.
  const baselineConfig = loaded?.config ?? null;
  const packageConfigFilePath = loaded?.filePath ?? null;

  // Resolve dataDir before loading the override — the override file
  // lives inside dataDir. CLI --data-dir wins over the baseline value.
  const preliminaryDataDir = resolveDataDir(options.dataDir ?? baselineConfig?.dataDir ?? null);
  const overrideConfigFilePath = path.join(preliminaryDataDir, OVERRIDE_FILENAME);

  // Load the runtime override. Fresh installs return null cleanly.
  let overrideLoaded = null;
  try {
    overrideLoaded = await loadOverridesFile(overrideConfigFilePath);
    if (overrideLoaded) {
      console.log(`Runtime overrides loaded from: ${overrideLoaded.filePath}`);
    } else {
      console.log(`Runtime overrides: (none yet at ${overrideConfigFilePath})`);
    }
  } catch (error) {
    // loadOverridesFile already logs a warning on corrupt files and
    // returns null for the "no override" case — anything reaching here
    // is exceptional. Continue with baseline-only rather than fail-fast:
    // losing overrides is recoverable, refusing to start is not.
    console.error(`Warning: could not load runtime override: ${(error as Error).message}`);
  }

  // Effective config = shallow merge (override wins per top-level key).
  // Merge CLI options on top (still highest precedence).
  const effectiveConfig = mergeConfigLayers(baselineConfig, overrideLoaded?.config ?? null);
  const mergedOptions = mergeConfig(effectiveConfig, options);

  // Millisecond epoch captured once so `GET /api/config/status` can
  // report a monotonic per-process value; the UI compares this after
  // a restart to detect the daemon has actually relaunched.
  const startupEpoch = Date.now();

  // Kiosk / demo mode: refuse to persist changes even if the caller
  // has auth. Enforced by the config-route layer.
  const configReadonly = !!options.configReadonly;

  // Resolve data directory
  const dataDir = resolveDataDir(mergedOptions.dataDir);

  console.log('Final configuration after merge:');
  if (mergedOptions.dataDir) {
    console.log(`  DataDir: ${dataDir}`);
  }
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
  console.log(`  TerminalOnly: ${mergedOptions.terminalOnly || false}`);

  // Validate port is specified (unless in terminal-only mode)
  if (!mergedOptions.port && !mergedOptions.terminalOnly) {
    printHelp();
    console.error('Error: You must specify a serial port with \'-p\' option or in config file.\n');
    console.error('       (or use --terminal-only mode if you only need terminal functionality)\n');
    process.exit(1);
  }

  // In terminal-only mode, ensure we have at least web or terminal port
  if (mergedOptions.terminalOnly) {
    if (!mergedOptions.web && !mergedOptions.terminalPort) {
      console.error('Error: Terminal-only mode requires either --web or --terminal-port to be specified.\n');
      process.exit(1);
    }
    console.log('Running in TERMINAL-ONLY mode (FDC drive serving disabled)');
  }

  // Parse baud rate (handle both string and number from config)
  const baudRateValue = mergedOptions.baud || 230400;
  const baudRate = typeof baudRateValue === 'string' ? parseInt(baudRateValue) : baudRateValue;

  // Debug output
  if (baselineConfig || overrideLoaded) {
    console.log(`Effective config resolved. Baud rate: ${baudRate}`);
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

  // Parse drive mounts (skip empty strings, resolve relative paths against dataDir)
  if (mergedOptions.drive0 && mergedOptions.drive0.trim()) config.drives.set(0, resolveDrivePath(mergedOptions.drive0, dataDir));
  if (mergedOptions.drive1 && mergedOptions.drive1.trim()) config.drives.set(1, resolveDrivePath(mergedOptions.drive1, dataDir));
  if (mergedOptions.drive2 && mergedOptions.drive2.trim()) config.drives.set(2, resolveDrivePath(mergedOptions.drive2, dataDir));
  if (mergedOptions.drive3 && mergedOptions.drive3.trim()) config.drives.set(3, resolveDrivePath(mergedOptions.drive3, dataDir));

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
  // Keep the shared operator mount table in sync as drives mount/unmount.
  driveManager.setMountRegistry(getMountRegistry());
  const serialManager = getSerialPortManager();
  const terminalManager = getTerminalSerialManager();
  const gpioController = getGpioLedController();
  const logger = getLogger();

  // Enable debug logging if requested
  if (config.debug) {
    driveManager.setDebug(true);
    console.log('Debug mode enabled - all serial drive operations will be logged');
  }

  // Sweep any transient (copy-on-write) scratch files left behind by a crash.
  // They are mount-scoped and never valid across restarts.
  try {
    await fs.rm(path.join(dataDir, 'disks', TRANSIENT_DIRNAME), { recursive: true, force: true });
  } catch (error) {
    console.error('Failed to sweep leftover transient scratch files:', error);
  }

  // Initialize file-based logging if requested
  if (mergedOptions.logFile) {
    try {
      await logger.initialize(mergedOptions.logFile, true);
      console.log(`File-based logging enabled: ${mergedOptions.logFile}`);
    } catch (error) {
      console.error('Failed to initialize logging:', error);
      console.log('Continuing without file-based logging');
    }
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

  // Only setup FDC drives and serial port if not in terminal-only mode
  if (!mergedOptions.terminalOnly) {
    // Set write protection for read-only drives
    for (const drive of config.readonlyDrives) {
      await driveManager.writeProtect(drive, true);
    }

    // Mount drives
    for (const [driveNum, filename] of config.drives.entries()) {
      try {
        await driveManager.mountDrive(driveNum, filename);
        console.log(`Mounted drive ${driveNum}: ${filename}`);
      } catch (error) {
        console.error(`Failed to mount drive ${driveNum}:`, error);
      }
    }

    // Attempt to open serial port, but continue running if it fails
    try {
      if (!config.port) {
        throw new Error('No primary serial port configured');
      }
      await serialManager.openPort(config.port, config.baudRate);
      console.log(`Serial port opened: ${config.port} @ ${config.baudRate} baud`);
    } catch (error) {
      console.error('Primary serial port unavailable; continuing without connection:', error);
    }
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

  // Initialize database and load saved drive assignments
  const { Database } = await import('./database');
  const dbPath = path.join(dataDir, 'fdcplus.db');
  let database: InstanceType<typeof Database> | undefined;

  try {
    const db = new Database(dbPath);
    await db.initialize();
    database = db;
    console.log('Database initialized successfully');

    // Teach the drive manager how to resolve the effective read-only-write
    // policy: per-image (DB) overrides the global default, 'inherit' falls
    // through. Set before the restore loop so DB-restored read-only mounts
    // pick up transient backing. Reads runtimeConfig live via mergedOptions.
    driveManager.setTransientPolicyResolver(async (master) => {
      const globalPolicy =
        (mergedOptions as { readonlyWritePolicy?: 'error' | 'transient' }).readonlyWritePolicy ?? 'error';
      let perImage: ReadonlyWritePolicy = 'inherit';
      try {
        perImage = await db.getDiskPolicy(master);
      } catch {
        perImage = 'inherit';
      }
      const effective = perImage !== 'inherit' ? perImage : globalPolicy;
      return effective === 'transient';
    });

    // Load saved drive assignments (only if web server will be enabled)
    if (mergedOptions.web) {
      try {
        const savedAssignments = await database.getAllDriveAssignments();
        console.log(`Found ${savedAssignments.length} saved drive assignment(s)`);

        for (const assignment of savedAssignments) {
          try {
            const fullPath = path.join(dataDir, 'disks', assignment.filename);

            // Check if file exists before mounting
            const fs = await import('fs');
            if (!fs.existsSync(fullPath)) {
              console.warn(`Skipping drive ${assignment.drive_id}: file not found: ${assignment.filename}`);
              await database.clearDriveAssignment(assignment.drive_id);
              continue;
            }

            // DB assignment is source of truth: if a slot was mounted from CLI/config
            // with a different image, remount to match the DB. mountDrive() closes
            // the existing handle before opening the new one.
            const driveState = driveManager.getDriveState(assignment.drive_id);
            const currentFilename = driveState?.mounted && driveState.filename
              ? path.basename(driveState.filename)
              : null;

            if (currentFilename === assignment.filename) {
              await driveManager.writeProtect(assignment.drive_id, !!assignment.readonly);
            } else {
              if (currentFilename !== null) {
                console.log(`Drive ${assignment.drive_id}: DB assignment overrides CLI/config (${currentFilename} → ${assignment.filename})`);
              }
              await driveManager.mountDrive(assignment.drive_id, fullPath);

              if (assignment.readonly) {
                await driveManager.writeProtect(assignment.drive_id, true);
              }

              console.log(`Restored drive ${assignment.drive_id}: ${assignment.filename} (${assignment.readonly ? 'RO' : 'RW'})`);
            }
          } catch (error) {
            console.error(`Failed to restore drive ${assignment.drive_id}:`, error);
            // Clear the invalid assignment from database
            await database.clearDriveAssignment(assignment.drive_id);
          }
        }
      } catch (error) {
        console.error('Failed to load saved drive assignments:', error);
      }
    }
  } catch (error) {
    console.error(`Failed to initialize database at ${dbPath}:`, error);
    console.log('Continuing without database support');
  }

  // Create FDC server (only if not in terminal-only mode)
  let server: FdcServer | null = null;
  if (!mergedOptions.terminalOnly) {
    server = new FdcServer(
      driveManager,
      serialManager,
      config
    );
  }

  // Start MCP server if requested (mutually exclusive with web server)
  if (mergedOptions.mcp) {
    const { startMcpStdio } = await import('./mcp-server');
    const { Server: SocketIOServer } = await import('socket.io');

    // Build a minimal Dependencies object for MCP
    // MCP doesn't need a real Socket.IO server, but the deps interface requires it
    const http = await import('http');
    const dummyHttpServer = http.createServer();
    const dummyIo = new SocketIOServer(dummyHttpServer);

    const mcpDeps = {
      config: {
        port: 0,
        host: 'localhost',
        disksDir: path.join(dataDir, 'disks'),
        cassettesDir: path.join(dataDir, 'cassettes'),
        scriptsDir: path.join(dataDir, 'scripts'),
        uploadsDir: path.join(dataDir, 'uploads'),
        dataDir: dataDir,
      },
      driveManager,
      serialManager,
      terminalManager,
      preferredTerminalSettings: {
        port: mergedOptions.terminalPort,
        baud: mergedOptions.terminalBaud,
      },
      io: dummyIo,
      database: database!,
      runtimeConfig: mergedOptions,
      packageConfigFilePath,
      overrideConfigFilePath,
      baselineConfig,
      startupEpoch,
      configReadonly,
      server: server,
      diskServingEnabled: server !== null,
      serverTask: null,
      replayEngine: null,
      xmodemSender: null,
      audioPlayer: null,
      currentAudioProcess: null,
    };

    // Start MCP server over stdio (blocks until client disconnects)
    await startMcpStdio(mcpDeps as any);
    return;
  }

  // Create web server if enabled
  let webServer: WebServer | null = null;
  if (mergedOptions.web) {
    const webConfig = {
      port: parseInt(mergedOptions.webPort || '3000'),
      host: mergedOptions.webHost || 'localhost',
      disksDir: path.join(dataDir, 'disks'),
      cassettesDir: path.join(dataDir, 'cassettes'),
      scriptsDir: path.join(dataDir, 'scripts'),
      uploadsDir: path.join(dataDir, 'uploads'),
      dataDir: dataDir,
    };

    // Pass preferred terminal settings from config
    const preferredTerminalSettings = {
      port: mergedOptions.terminalPort,
      baud: mergedOptions.terminalBaud,
    };

    webServer = new WebServer(
      webConfig,
      driveManager,
      serialManager,
      terminalManager,
      preferredTerminalSettings,
      {
        server: server || undefined,
        runtimeConfig: mergedOptions,
        database,
        packageConfigFilePath,
        overrideConfigFilePath,
        baselineConfig,
        startupEpoch,
        configReadonly,
      }
    );
    await webServer.start();
  }

  // Setup signal handlers
  const cleanup = async () => {
    console.log('\nShutting down gracefully...');

    // Create a timeout promise to prevent hanging
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('Cleanup timeout after 5 seconds')), 5000);
    });

    // Perform cleanup operations
    const cleanupPromise = async () => {
      // Cancel any active replay/XMODEM transfers
      if (webServer) {
        webServer.cancelActiveTransfer();
      }

      if (server) {
        server.stop();
      }
      if (webServer) {
        await webServer.stop();
      }
      await serialManager.closePort();
      await terminalManager.closePort();
      await driveManager.unmountAll();

      // Clean up temp upload files
      try {
        const uploadsReplayDir = path.join(dataDir, 'uploads', 'replay');
        await fs.rm(uploadsReplayDir, { recursive: true, force: true });
      } catch {
        // Best effort cleanup
      }

      // Cleanup GPIO LEDs
      if (gpioController.isInitialized()) {
        await gpioController.shutdown();
      }

      // Close database
      if (database && database.isInitialized()) {
        await database.close();
      }

      // Close logger
      if (logger.isInitialized()) {
        await logger.close();
      }
    };

    try {
      // Race cleanup against timeout
      await Promise.race([cleanupPromise(), timeoutPromise]);
      console.log('Cleanup complete');
    } catch (error) {
      console.error('Cleanup error or timeout:', error);
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('SIGHUP', cleanup);

  // Handle uncaught exceptions and rejections
  process.on('uncaughtException', async (error) => {
    console.error('Uncaught exception:', error);
    await cleanup();
  });

  process.on('unhandledRejection', async (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
    await cleanup();
  });

  // Start FDC server (only if not in terminal-only mode)
  if (server) {
    if (webServer) {
      // Web server is enabled - let it manage the server lifecycle
      await webServer.startServer();
      console.log('FDC server running under web server management');

      // Keep process alive indefinitely (web server and FDC server both running)
      await new Promise(() => {
        // This promise never resolves, keeping the process alive
        // The process can still exit via SIGINT, SIGTERM, or cleanup handlers
      });
    } else {
      // No web server - run FDC server directly (blocks forever)
      console.log('Starting FDC server (no web interface)');
      await server.start();
    }
  } else {
    // In terminal-only mode, keep the process alive
    console.log('Terminal-only mode: FDC server not started');
    console.log('Process will remain running for web interface and/or terminal access');

    // Keep process alive with an infinite loop that yields to event loop
    await new Promise(() => {
      // This promise never resolves, keeping the process alive
      // The process can still exit via SIGINT, SIGTERM, or cleanup handlers
    });
  }
}

// Run main function
main().catch(async (error) => {
  console.error('Fatal error:', error);

  // Attempt cleanup before exiting
  try {
    const driveManager = getDriveManager();
    await driveManager.unmountAll();
  } catch (cleanupError) {
    console.error('Cleanup error:', cleanupError);
  }

  process.exit(1);
});
