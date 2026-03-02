/**
 * Terminal serial port commands for FDC+ CLI.
 * /terminal open, /terminal close, /terminal status, /terminal ports
 */

import chalk from 'chalk';
import { CommandRegistry, CommandContext } from './registry';

export function registerTerminalCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'terminal',
    aliases: ['t'],
    description: 'Manage terminal serial connection',
    usage: 'terminal <open|close|status|ports> ...',
    async execute(args: string[], context: CommandContext): Promise<void> {
      const sub = (args[0] || 'status').toLowerCase();
      const rest = args.slice(1);

      switch (sub) {
        case 'open':
        case 'connect': {
          // Parse: terminal open [device] [--baud N]
          let device: string | undefined;
          let baudRate: number | undefined;

          for (let i = 0; i < rest.length; i++) {
            if (rest[i] === '--baud' || rest[i] === '-b') {
              baudRate = parseInt(rest[++i], 10);
              if (isNaN(baudRate)) {
                context.terminalArea.writeCommandOutput('terminal open', [
                  chalk.red('Invalid baud rate.'),
                ]);
                return;
              }
            } else if (!device) {
              device = rest[i];
            }
          }

          // If no device specified, try preferred or list ports
          if (!device) {
            const status = await context.client.terminalGetStatus();
            if (status.preferred?.port) {
              device = status.preferred.port;
            } else {
              // List available ports and ask user to specify
              const { ports } = await context.client.listPorts();
              if (ports.length === 0) {
                context.terminalArea.writeCommandOutput('terminal open', [
                  chalk.red('No serial ports found.'),
                ]);
                return;
              }
              context.terminalArea.writeCommandOutput('terminal open', [
                chalk.yellow('No device specified. Available ports:'),
                '',
                ...ports.map((p) => `  ${chalk.cyan(p.path)}${p.manufacturer ? chalk.dim(` (${p.manufacturer})`) : ''}`),
                '',
                chalk.dim('Usage: terminal open <device> [--baud N]'),
              ]);
              return;
            }
          }

          const config = baudRate ? { baudRate } : undefined;
          const result = await context.client.terminalOpen(device, config);
          const lines = [
            chalk.green(`\u2713 Terminal connected to ${result.device}`),
          ];
          if (baudRate) {
            lines.push(chalk.dim(`  Baud rate: ${baudRate}`));
          }
          context.terminalArea.writeCommandOutput('terminal open', lines);
          break;
        }

        case 'close':
        case 'disconnect': {
          await context.client.terminalClose();
          context.terminalArea.writeCommandOutput('terminal close', [
            chalk.green('\u2713 Terminal disconnected'),
          ]);
          break;
        }

        case 'status': {
          const status = await context.client.terminalGetStatus();
          const lines: string[] = [];

          const connStatus = status.connected
            ? chalk.green('connected')
            : chalk.red('disconnected');
          lines.push(`  Status:    ${connStatus}`);

          if (status.connected && status.device) {
            lines.push(`  Device:    ${chalk.cyan(status.device)}`);
            if (status.config.baudRate) {
              lines.push(`  Baud:      ${status.config.baudRate}`);
            }
            if (status.config.dataBits) {
              lines.push(`  Data bits: ${status.config.dataBits}`);
            }
            if (status.config.parity && status.config.parity !== 'none') {
              lines.push(`  Parity:    ${status.config.parity}`);
            }
            if (status.config.stopBits) {
              lines.push(`  Stop bits: ${status.config.stopBits}`);
            }
          } else if (status.preferred?.port) {
            lines.push(`  Preferred: ${chalk.dim(status.preferred.port)}`);
            if (status.preferred.baud) {
              lines.push(`  Pref baud: ${chalk.dim(String(status.preferred.baud))}`);
            }
          }

          context.terminalArea.writeCommandOutput('terminal', lines);
          break;
        }

        case 'ports': {
          const { ports } = await context.client.listPorts();

          if (ports.length === 0) {
            context.terminalArea.writeCommandOutput('terminal ports', [
              chalk.dim('No serial ports found.'),
            ]);
            return;
          }

          const lines: string[] = [];
          for (const port of ports) {
            const mfr = port.manufacturer ? chalk.dim(` (${port.manufacturer})`) : '';
            lines.push(`  ${chalk.cyan(port.path)}${mfr}`);
            if (port.recommended && port.recommended !== port.path) {
              lines.push(`    ${chalk.dim(`\u2192 ${port.recommended}`)}`);
            }
          }

          lines.push('');
          lines.push(chalk.dim(`  ${ports.length} port(s)`));

          context.terminalArea.writeCommandOutput('terminal ports', lines);
          break;
        }

        default:
          context.terminalArea.writeCommandOutput('terminal', [
            chalk.red(`Unknown subcommand: ${sub}`),
            '',
            chalk.yellow('Usage: terminal <subcommand>'),
            '',
            `  ${chalk.cyan('open')}   [device] [--baud N]  Connect to serial port`,
            `  ${chalk.cyan('close')}                       Disconnect`,
            `  ${chalk.cyan('status')}                      Show connection status`,
            `  ${chalk.cyan('ports')}                       List available serial ports`,
          ]);
      }
    },
  });
}
