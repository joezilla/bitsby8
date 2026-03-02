/**
 * Script management and replay commands for FDC+ CLI.
 * /scripts, /script, /replay, /xmodem
 */

import chalk from 'chalk';
import { CommandRegistry, CommandContext } from './registry';

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function registerScriptCommands(registry: CommandRegistry): void {
  // /scripts — list available scripts
  registry.register({
    name: 'scripts',
    aliases: ['sc'],
    description: 'List available scripts',
    async execute(_args: string[], context: CommandContext): Promise<void> {
      const resp = await context.client.listScripts();
      const scripts = resp.scripts;

      if (scripts.length === 0) {
        context.terminalArea.writeCommandOutput('scripts', [
          chalk.dim('No scripts found.'),
        ]);
        return;
      }

      const lines: string[] = [
        `  ${chalk.dim('NAME'.padEnd(30))}${chalk.dim('SIZE')}`,
      ];

      for (const s of scripts) {
        const name = chalk.cyan(s.name.padEnd(30));
        const size = formatSize(s.size);
        lines.push(`  ${name}${size}`);
      }

      lines.push('');
      lines.push(chalk.dim(`  ${scripts.length} script(s)`));

      context.terminalArea.writeCommandOutput('scripts', lines);
    },
  });

  // /script <subcommand>
  registry.register({
    name: 'script',
    aliases: [],
    description: 'Manage scripts (show, upload, delete)',
    usage: 'script <show|upload|delete> <name>',
    async execute(args: string[], context: CommandContext): Promise<void> {
      if (args.length < 1) {
        context.terminalArea.writeCommandOutput('script', [
          chalk.yellow('Usage: script <subcommand> [args]'),
          '',
          `  ${chalk.cyan('show')}   <name>         Show script content`,
          `  ${chalk.cyan('upload')} <path>         Upload script file`,
          `  ${chalk.cyan('delete')} <name>         Delete script`,
        ]);
        return;
      }

      const sub = args[0].toLowerCase();
      const rest = args.slice(1);

      switch (sub) {
        case 'show':
        case 'cat': {
          if (rest.length < 1) {
            context.terminalArea.writeCommandOutput('script show', [
              chalk.yellow('Usage: script show <name>'),
            ]);
            return;
          }
          const script = await context.client.getScript(rest[0]);
          const lines: string[] = [];
          lines.push(`  Name:   ${chalk.cyan(script.name)}`);
          lines.push(`  Size:   ${formatSize(script.size)}`);
          lines.push(`  Binary: ${script.binary ? 'yes' : 'no'}`);
          if (script.content && !script.binary) {
            lines.push('');
            const contentLines = script.content.split('\n');
            const maxShow = 30;
            const showing = contentLines.slice(0, maxShow);
            for (let i = 0; i < showing.length; i++) {
              lines.push(`  ${chalk.dim(String(i + 1).padStart(3))}  ${showing[i]}`);
            }
            if (contentLines.length > maxShow) {
              lines.push(chalk.dim(`  ... ${contentLines.length - maxShow} more lines`));
            }
          }
          context.terminalArea.writeCommandOutput('script show', lines);
          break;
        }

        case 'upload': {
          if (rest.length < 1) {
            context.terminalArea.writeCommandOutput('script upload', [
              chalk.yellow('Usage: script upload <path>'),
            ]);
            return;
          }
          const path = await import('path');
          const filePath = rest[0];
          const fileName = path.basename(filePath);
          const result = await context.client.uploadScript(filePath, fileName);
          context.terminalArea.writeCommandOutput('script upload', [
            chalk.green(`\u2713 Uploaded ${result.name} (${formatSize(result.size)})`),
          ]);
          break;
        }

        case 'delete':
        case 'rm': {
          if (rest.length < 1) {
            context.terminalArea.writeCommandOutput('script delete', [
              chalk.yellow('Usage: script delete <name>'),
            ]);
            return;
          }
          await context.client.deleteScript(rest[0]);
          context.terminalArea.writeCommandOutput('script delete', [
            chalk.green(`\u2713 Deleted ${rest[0]}`),
          ]);
          break;
        }

        default:
          context.terminalArea.writeCommandOutput('script', [
            chalk.red(`Unknown subcommand: ${sub}. Use show, upload, or delete.`),
          ]);
      }
    },
  });

  // /replay <name> [options]
  registry.register({
    name: 'replay',
    aliases: ['r'],
    description: 'Replay a script to the terminal',
    usage: 'replay <name> [--delay N] [--line-delay N] [--ending cr|lf|crlf|raw] [--chunk N]',
    async execute(args: string[], context: CommandContext): Promise<void> {
      if (args.length < 1) {
        context.terminalArea.writeCommandOutput('replay', [
          chalk.yellow('Usage: replay <name> [options]'),
          '',
          '  Options:',
          `    ${chalk.cyan('--delay N')}        Inter-byte delay in ms (default: server setting)`,
          `    ${chalk.cyan('--line-delay N')}   Inter-line delay in ms`,
          `    ${chalk.cyan('--ending TYPE')}    Line ending: cr, lf, crlf, raw`,
          `    ${chalk.cyan('--chunk N')}        Chunk size in bytes`,
          '',
          `  ${chalk.cyan('replay cancel')}    Cancel running replay`,
          `  ${chalk.cyan('replay status')}    Show replay status`,
        ]);
        return;
      }

      // Handle subcommands
      const sub = args[0].toLowerCase();
      if (sub === 'cancel' || sub === 'stop') {
        context.client.cancelReplay();
        context.terminalArea.writeCommandOutput('replay', [
          chalk.yellow('Cancelling replay...'),
        ]);
        return;
      }

      if (sub === 'status') {
        const status = await context.client.getReplayStatus();
        if (!status.active || !status.progress) {
          context.terminalArea.writeCommandOutput('replay status', [
            chalk.dim('No replay in progress.'),
          ]);
        } else {
          const p = status.progress;
          context.terminalArea.writeCommandOutput('replay status', [
            `  File:     ${chalk.cyan(p.fileName)}`,
            `  Mode:     ${status.mode || 'raw'}`,
            `  Progress: ${p.percentComplete}% (${formatSize(p.bytesSent)} / ${formatSize(p.totalBytes)})`,
            `  State:    ${p.state}`,
          ]);
        }
        return;
      }

      // Parse options
      const scriptName = args[0];
      let interByteDelayMs: number | undefined;
      let interLineDelayMs: number | undefined;
      let lineEnding: 'cr' | 'lf' | 'crlf' | 'raw' | undefined;
      let chunkSize: number | undefined;

      for (let i = 1; i < args.length; i++) {
        const opt = args[i];
        if ((opt === '--delay' || opt === '-d') && args[i + 1]) {
          interByteDelayMs = parseInt(args[++i], 10);
        } else if ((opt === '--line-delay' || opt === '-l') && args[i + 1]) {
          interLineDelayMs = parseInt(args[++i], 10);
        } else if ((opt === '--ending' || opt === '-e') && args[i + 1]) {
          lineEnding = args[++i] as 'cr' | 'lf' | 'crlf' | 'raw';
        } else if ((opt === '--chunk' || opt === '-c') && args[i + 1]) {
          chunkSize = parseInt(args[++i], 10);
        }
      }

      context.client.startReplay({
        scriptName,
        mode: 'raw',
        interByteDelayMs,
        interLineDelayMs,
        lineEnding,
        chunkSize,
      });

      context.terminalArea.writeCommandOutput('replay', [
        chalk.green(`\u2713 Started replay of ${scriptName}`),
        chalk.dim('  Progress shown in status bar. Use "replay cancel" to stop.'),
      ]);
    },
  });

  // /xmodem <name> [--crc]
  registry.register({
    name: 'xmodem',
    aliases: ['xm'],
    description: 'Send file via XMODEM transfer',
    usage: 'xmodem <name> [--crc]',
    async execute(args: string[], context: CommandContext): Promise<void> {
      if (args.length < 1) {
        context.terminalArea.writeCommandOutput('xmodem', [
          chalk.yellow('Usage: xmodem <name> [--crc]'),
          chalk.dim('  Sends a script/file via XMODEM protocol.'),
          chalk.dim('  --crc  Use CRC-16 instead of checksum'),
        ]);
        return;
      }

      const scriptName = args[0];
      const useCrc = args.includes('--crc');

      context.client.startReplay({
        scriptName,
        mode: 'xmodem',
        useCrc,
      });

      context.terminalArea.writeCommandOutput('xmodem', [
        chalk.green(`\u2713 Started XMODEM transfer of ${scriptName}${useCrc ? ' (CRC)' : ''}`),
        chalk.dim('  Progress shown in status bar. Use "replay cancel" to stop.'),
      ]);
    },
  });
}
