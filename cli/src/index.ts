/**
 * FDC+ Console — Interactive TUI for the Altair 8800 FDC+ Serial Drive Server.
 * Entry point: parses args and launches the app.
 */

import { App } from './app';
import { getServerUrl } from './config';

function main(): void {
  // Parse CLI args: fdc [server-url] or fdc --server URL or fdc -s URL
  const args = process.argv.slice(2);
  let serverArg: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--server' || arg === '-s') {
      serverArg = args[i + 1];
      break;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else if (arg === '--version' || arg === '-V') {
      process.stdout.write('fdc 1.0.0\n');
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      serverArg = arg;
      break;
    }
  }

  const serverUrl = getServerUrl(serverArg);
  const app = new App(serverUrl);

  app.start().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Fatal: ${msg}\n`);
    process.exit(1);
  });
}

function printUsage(): void {
  process.stdout.write(`
FDC+ Console — Interactive TUI for the Altair 8800 FDC+ Serial Drive Server

Usage: fdc [options] [server-url]

Arguments:
  server-url          Server URL (default: http://localhost:3000)

Options:
  -s, --server URL    Server URL
  -h, --help          Show this help
  -V, --version       Show version

Environment:
  FDC_SERVER          Default server URL

Examples:
  fdc                           Connect to localhost:3000
  fdc http://pi.local:3000      Connect to remote server
  fdc -s 192.168.1.50:3000      Connect with explicit flag

`);
}

main();
