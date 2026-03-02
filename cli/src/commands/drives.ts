/**
 * Disk management commands for FDC+ CLI.
 * /mount, /unmount, /protect, /unprotect, /images, /image
 */

import chalk from 'chalk';
import { CommandRegistry, CommandContext } from './registry';

function parseDriveId(arg: string): number | null {
  const upper = arg.toUpperCase();
  if (upper === 'A') return 0;
  if (upper === 'B') return 1;
  if (upper === 'C') return 2;
  if (upper === 'D') return 3;
  const num = parseInt(arg, 10);
  if (!isNaN(num) && num >= 0 && num <= 3) return num;
  return null;
}

const DRIVE_LABELS = ['A', 'B', 'C', 'D'];

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function registerDriveCommands(registry: CommandRegistry): void {
  // /mount <A-D> <image>
  registry.register({
    name: 'mount',
    aliases: ['m'],
    description: 'Mount disk image on drive',
    usage: 'mount <A-D> <image>',
    async execute(args: string[], context: CommandContext): Promise<void> {
      if (args.length < 2) {
        context.terminalArea.writeCommandOutput('mount', [
          chalk.yellow('Usage: mount <A-D> <image>'),
          chalk.dim('  Example: mount A cpm22.dsk'),
        ]);
        return;
      }

      const driveId = parseDriveId(args[0]);
      if (driveId === null) {
        context.terminalArea.writeCommandOutput('mount', [
          chalk.red(`Invalid drive: ${args[0]}. Use A-D or 0-3.`),
        ]);
        return;
      }

      const filename = args.slice(1).join(' ');
      const result = await context.client.mountDrive(driveId, filename);
      context.terminalArea.writeCommandOutput('mount', [
        chalk.green(`\u2713 Mounted ${result.filename} on Drive ${DRIVE_LABELS[driveId]}`),
      ]);
    },
  });

  // /unmount <A-D>
  registry.register({
    name: 'unmount',
    aliases: ['u', 'umount'],
    description: 'Unmount drive',
    usage: 'unmount <A-D>',
    async execute(args: string[], context: CommandContext): Promise<void> {
      if (args.length < 1) {
        context.terminalArea.writeCommandOutput('unmount', [
          chalk.yellow('Usage: unmount <A-D>'),
        ]);
        return;
      }

      const driveId = parseDriveId(args[0]);
      if (driveId === null) {
        context.terminalArea.writeCommandOutput('unmount', [
          chalk.red(`Invalid drive: ${args[0]}. Use A-D or 0-3.`),
        ]);
        return;
      }

      await context.client.unmountDrive(driveId);
      context.terminalArea.writeCommandOutput('unmount', [
        chalk.green(`\u2713 Unmounted Drive ${DRIVE_LABELS[driveId]}`),
      ]);
    },
  });

  // /protect <A-D>
  registry.register({
    name: 'protect',
    aliases: ['ro'],
    description: 'Set drive read-only',
    usage: 'protect <A-D>',
    async execute(args: string[], context: CommandContext): Promise<void> {
      if (args.length < 1) {
        context.terminalArea.writeCommandOutput('protect', [
          chalk.yellow('Usage: protect <A-D>'),
        ]);
        return;
      }

      const driveId = parseDriveId(args[0]);
      if (driveId === null) {
        context.terminalArea.writeCommandOutput('protect', [
          chalk.red(`Invalid drive: ${args[0]}. Use A-D or 0-3.`),
        ]);
        return;
      }

      await context.client.setReadOnly(driveId, true);
      context.terminalArea.writeCommandOutput('protect', [
        chalk.green(`\u2713 Drive ${DRIVE_LABELS[driveId]} set to read-only`),
      ]);
    },
  });

  // /unprotect <A-D>
  registry.register({
    name: 'unprotect',
    aliases: ['rw'],
    description: 'Set drive read-write',
    usage: 'unprotect <A-D>',
    async execute(args: string[], context: CommandContext): Promise<void> {
      if (args.length < 1) {
        context.terminalArea.writeCommandOutput('unprotect', [
          chalk.yellow('Usage: unprotect <A-D>'),
        ]);
        return;
      }

      const driveId = parseDriveId(args[0]);
      if (driveId === null) {
        context.terminalArea.writeCommandOutput('unprotect', [
          chalk.red(`Invalid drive: ${args[0]}. Use A-D or 0-3.`),
        ]);
        return;
      }

      await context.client.setReadOnly(driveId, false);
      context.terminalArea.writeCommandOutput('unprotect', [
        chalk.green(`\u2713 Drive ${DRIVE_LABELS[driveId]} set to read-write`),
      ]);
    },
  });

  // /images
  registry.register({
    name: 'images',
    aliases: ['i'],
    description: 'List disk images',
    async execute(_args: string[], context: CommandContext): Promise<void> {
      const resp = await context.client.getImageDetails();
      const images = resp.images;

      if (images.length === 0) {
        context.terminalArea.writeCommandOutput('images', [
          chalk.dim('No disk images found.'),
        ]);
        return;
      }

      const lines: string[] = [
        `  ${chalk.dim('NAME'.padEnd(22))}${chalk.dim('SIZE'.padEnd(10))}${chalk.dim('DESCRIPTION')}`,
      ];

      for (const img of images) {
        const name = chalk.cyan(img.name.padEnd(22));
        const size = formatSize(img.size).padEnd(10);
        const desc = img.description ? chalk.dim(img.description) : '';
        lines.push(`  ${name}${size}${desc}`);
      }

      lines.push('');
      lines.push(chalk.dim(`  ${images.length} image(s)`));

      context.terminalArea.writeCommandOutput('images', lines);
    },
  });

  // /image <subcommand>
  registry.register({
    name: 'image',
    aliases: [],
    description: 'Manage disk images (create, clone, delete, info)',
    usage: 'image <create|clone|delete|info> ...',
    async execute(args: string[], context: CommandContext): Promise<void> {
      if (args.length < 1) {
        context.terminalArea.writeCommandOutput('image', [
          chalk.yellow('Usage: image <subcommand> [args]'),
          '',
          `  ${chalk.cyan('create')} <name> [8inch|minidisk|8mb]  Create blank disk image`,
          `  ${chalk.cyan('clone')}  <name>                       Clone existing image`,
          `  ${chalk.cyan('delete')} <name>                       Delete image`,
          `  ${chalk.cyan('info')}   <name>                       Show CP/M filesystem info`,
        ]);
        return;
      }

      const sub = args[0].toLowerCase();
      const rest = args.slice(1);

      switch (sub) {
        case 'create': {
          if (rest.length < 1) {
            context.terminalArea.writeCommandOutput('image create', [
              chalk.yellow('Usage: image create <name> [8inch|minidisk|8mb]'),
            ]);
            return;
          }
          const name = rest[0];
          const format = rest[1] || '8inch';
          const ext = '.dsk';
          const result = await context.client.createImage(name, format, ext);
          context.terminalArea.writeCommandOutput('image create', [
            chalk.green(`\u2713 Created ${result.filename} (${formatSize(result.size)}, ${result.format})`),
          ]);
          break;
        }

        case 'clone': {
          if (rest.length < 1) {
            context.terminalArea.writeCommandOutput('image clone', [
              chalk.yellow('Usage: image clone <name>'),
            ]);
            return;
          }
          const result = await context.client.cloneImage(rest[0]);
          context.terminalArea.writeCommandOutput('image clone', [
            chalk.green(`\u2713 Cloned to ${result.filename}`),
          ]);
          break;
        }

        case 'delete':
        case 'rm': {
          if (rest.length < 1) {
            context.terminalArea.writeCommandOutput('image delete', [
              chalk.yellow('Usage: image delete <name>'),
            ]);
            return;
          }
          await context.client.deleteImage(rest[0]);
          context.terminalArea.writeCommandOutput('image delete', [
            chalk.green(`\u2713 Deleted ${rest[0]}`),
          ]);
          break;
        }

        case 'info': {
          if (rest.length < 1) {
            context.terminalArea.writeCommandOutput('image info', [
              chalk.yellow('Usage: image info <name>'),
            ]);
            return;
          }
          const info = await context.client.cpmInfo(rest[0]);
          const lines: string[] = [];
          lines.push(`  Image:     ${chalk.cyan(rest[0])}`);
          lines.push(`  Format:    ${info.params.tracks} tracks, ${info.params.sectrk} sec/trk, ${formatSize(info.params.blocksize)} blocks`);
          lines.push(`  Files:     ${info.fileCount}`);
          lines.push(`  Free:      ${formatSize(info.freeSpace.freeBytes)} (${info.freeSpace.freeBlocks} blocks)`);
          lines.push(`  Dir free:  ${info.freeSpace.directoryEntriesFree}/${info.freeSpace.directoryEntriesTotal} entries`);
          if (typeof info.mounted === 'number') {
            lines.push(`  Mounted:   ${chalk.yellow(`Drive ${DRIVE_LABELS[info.mounted] || info.mounted}`)}`);
          }
          context.terminalArea.writeCommandOutput('image info', lines);
          break;
        }

        default:
          context.terminalArea.writeCommandOutput('image', [
            chalk.red(`Unknown subcommand: ${sub}. Use create, clone, delete, or info.`),
          ]);
      }
    },
  });

  // /swap <A-D> <A-D>
  registry.register({
    name: 'swap',
    aliases: [],
    description: 'Swap images between two drives',
    usage: 'swap <A-D> <A-D>',
    async execute(args: string[], context: CommandContext): Promise<void> {
      if (args.length < 2) {
        context.terminalArea.writeCommandOutput('swap', [
          chalk.yellow('Usage: swap <A-D> <A-D>'),
        ]);
        return;
      }

      const id1 = parseDriveId(args[0]);
      const id2 = parseDriveId(args[1]);
      if (id1 === null || id2 === null) {
        context.terminalArea.writeCommandOutput('swap', [
          chalk.red('Invalid drive letter. Use A-D or 0-3.'),
        ]);
        return;
      }

      // Get current state
      const status = await context.client.status();
      const drive1 = status.drives[id1];
      const drive2 = status.drives[id2];

      // Unmount both
      if (drive1?.mounted) await context.client.unmountDrive(id1);
      if (drive2?.mounted) await context.client.unmountDrive(id2);

      // Remount swapped
      if (drive2?.mounted && drive2.filename) {
        await context.client.mountDrive(id1, drive2.filename);
      }
      if (drive1?.mounted && drive1.filename) {
        await context.client.mountDrive(id2, drive1.filename);
      }

      context.terminalArea.writeCommandOutput('swap', [
        chalk.green(`\u2713 Swapped Drive ${DRIVE_LABELS[id1]} \u2194 Drive ${DRIVE_LABELS[id2]}`),
      ]);
    },
  });
}
