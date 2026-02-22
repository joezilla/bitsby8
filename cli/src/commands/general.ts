/**
 * General built-in commands for FDC+ CLI.
 */

import chalk from 'chalk';
import { CommandRegistry, CommandContext } from './registry';

export function registerGeneralCommands(registry: CommandRegistry): void {
  // /help
  registry.register({
    name: 'help',
    aliases: ['?'],
    description: 'Show available commands',
    async execute(_args: string[], context: CommandContext): Promise<void> {
      const allCmds = registry.getAll();
      const lines: string[] = [chalk.bold('Available commands:'), ''];

      for (const cmd of allCmds) {
        const aliases =
          cmd.aliases.length > 0
            ? chalk.dim(` (${cmd.aliases.join(', ')})`)
            : '';
        const name = chalk.cyan(cmd.name.padEnd(12));
        lines.push(`  ${name}${cmd.description}${aliases}`);
      }

      lines.push('');
      lines.push(
        chalk.dim('Type "/" or press Escape to enter command mode. Press Escape again to return.'),
      );

      context.terminalArea.writeCommandOutput('help', lines);
    },
  });

  // /quit
  registry.register({
    name: 'quit',
    aliases: ['q', 'exit'],
    description: 'Exit the CLI',
    async execute(_args: string[], context: CommandContext): Promise<void> {
      context.app.shutdown();
    },
  });

  // /clear
  registry.register({
    name: 'clear',
    aliases: [],
    description: 'Clear the terminal area',
    async execute(_args: string[], context: CommandContext): Promise<void> {
      context.terminalArea.clear();
    },
  });

  // /status
  registry.register({
    name: 'status',
    aliases: ['s'],
    description: 'Show server status',
    async execute(_args: string[], context: CommandContext): Promise<void> {
      const status = await context.client.status();
      const lines: string[] = [];

      // Serial connection
      const serialStatus = status.serial.connected
        ? chalk.green('connected')
        : chalk.red('disconnected');
      lines.push(
        `  Serial:  ${serialStatus} ${chalk.dim(`(${status.serial.device} @ ${status.serial.baudRate} baud)`)}`,
      );

      // Disk serving
      const servingStatus = status.diskServing.running
        ? chalk.green('active')
        : status.diskServing.enabled
          ? chalk.yellow('enabled (idle)')
          : chalk.dim('disabled');
      lines.push(`  Serving: ${servingStatus}`);

      // Drive summary
      const mountedCount = status.drives.filter((d) => d.mounted).length;
      lines.push(
        `  Drives:  ${chalk.cyan(String(mountedCount))}/${status.drives.length} mounted`,
      );

      context.terminalArea.writeCommandOutput('status', lines);
    },
  });

  // /drives
  registry.register({
    name: 'drives',
    aliases: ['d'],
    description: 'Show drive status',
    async execute(_args: string[], context: CommandContext): Promise<void> {
      const resp = await context.client.status();
      const drives = resp.drives;
      const labels = ['A', 'B', 'C', 'D'];
      const lines: string[] = [];

      for (let i = 0; i < Math.min(drives.length, 4); i++) {
        const drive = drives[i];
        const label = labels[i] || String(drive.id);
        if (drive.mounted && drive.filename) {
          const ro = drive.readonly ? chalk.yellow(' (R/O)') : '';
          const trk = chalk.dim(` Track ${drive.track}`);
          lines.push(`  ${label}: ${chalk.green('\u2588\u2588')} ${chalk.cyan(drive.filename)}${ro}${trk}`);
        } else {
          lines.push(`  ${label}: ${chalk.dim('\u2014\u2014')}`);
        }
      }

      context.terminalArea.writeCommandOutput('drives', lines);
    },
  });
}
