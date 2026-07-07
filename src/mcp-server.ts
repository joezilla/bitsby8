/**
 * MCP (Model Context Protocol) Server for FDC+ Serial Drive Server
 *
 * Exposes all FDC+ operations as MCP tools, allowing any AI assistant
 * to operate the Altair 8800 via the FDC+ controller.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Dependencies } from './types';
import { getStatus, getDrivesStatus, getTerminalStatus } from './services/status';
import { enableDiskServing, disableDiskServing, broadcastStatus } from './services/disk-serving';
import { listDiskImagesWithDetails, listCassettesWithDetails } from './services/file-listing';
import { startRawReplay, startXmodemSend, cancelActiveTransfer } from './services/transfer';
import { safeResolvePath } from './utils/safe-path';
import {
  DISK_IMAGE_EXTENSIONS,
  MAX_DISK_IMAGE_SIZE,
  isAllowedDiskImageExtension,
  detectForbiddenMagic,
} from './utils/disk-image-validation';
import { TerminalSerialManager } from './terminal-serial';
import { BaudRate, MAX_DRIVES } from './protocol';
import { CpmFilesystem, paramsForFormat, inferFormatFromSize } from './cpm-filesystem';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';

// Track size constant for disk image creation (must match protocol.ts)
const TRACK_SIZE = 137 * 32;

/**
 * Valid baud rate values from the BaudRate enum.
 */
const VALID_BAUD_RATES = Object.values(BaudRate).filter(
  (v): v is number => typeof v === 'number'
);

/**
 * Check whether a disk image file is currently mounted on any drive.
 * Returns the drive number if mounted, or false if not.
 */
function isDiskMounted(deps: Dependencies, filename: string): number | false {
  for (let i = 0; i < MAX_DRIVES; i++) {
    const driveState = deps.driveManager.getDriveState(i);
    if (driveState && driveState.mounted && driveState.filename) {
      if (path.basename(driveState.filename) === filename) {
        return i;
      }
    }
  }
  return false;
}

/**
 * Create and configure the MCP server with all FDC+ tools and resources.
 */
export function createMcpServer(deps: Dependencies): McpServer {
  const server = new McpServer({
    name: 'fdcplus',
    version: '2.0.0',
  });

  // ===========================================================================
  // Resources
  // ===========================================================================

  server.resource('status', 'fdcplus://status', async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'application/json',
      text: JSON.stringify(getStatus(deps)),
    }],
  }));

  server.resource('drives', 'fdcplus://drives', async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'application/json',
      text: JSON.stringify(getDrivesStatus(deps)),
    }],
  }));

  server.resource('images', 'fdcplus://images', async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'application/json',
      text: JSON.stringify(await listDiskImagesWithDetails(deps)),
    }],
  }));

  server.resource('terminal', 'fdcplus://terminal', async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'application/json',
      text: JSON.stringify(getTerminalStatus(deps)),
    }],
  }));

  // ===========================================================================
  // Tool 1: get_status
  // ===========================================================================

  server.tool(
    'get_status',
    'Get the current FDC+ server status including serial port, drive states, and disk serving status',
    async () => {
      try {
        const status = getStatus(deps);
        return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 2: list_serial_ports
  // ===========================================================================

  server.tool(
    'list_serial_ports',
    'List all available serial ports on the system',
    async () => {
      try {
        const ports = await TerminalSerialManager.listPorts();
        return { content: [{ type: 'text', text: JSON.stringify(ports, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 3: configure_serial
  // ===========================================================================

  server.tool(
    'configure_serial',
    'Configure the primary serial port for FDC+ controller communication',
    {
      device: z.string().describe('Serial port device path (e.g. /dev/ttyUSB0)'),
      baudRate: z.number().describe('Baud rate (9600, 19200, 38400, 57600, 76800, 230400, 403200, 460800)'),
    },
    async ({ device, baudRate }) => {
      try {
        if (!VALID_BAUD_RATES.includes(baudRate)) {
          throw new Error(`Baud rate ${baudRate} is not supported. Valid rates: ${VALID_BAUD_RATES.join(', ')}`);
        }

        // Pause the FDC server if running
        if (deps.server && deps.diskServingEnabled) {
          deps.server.stop();
          deps.serverTask = null;
          deps.diskServingEnabled = false;
        }

        // Close existing port if open
        if (deps.serialManager.isOpen()) {
          await deps.serialManager.closePort();
        }

        // Open with new settings
        await deps.serialManager.openPort(device, baudRate as BaudRate);

        // Update runtime config
        if (deps.runtimeConfig) {
          deps.runtimeConfig.port = device;
          deps.runtimeConfig.baud = baudRate;
        } else {
          deps.runtimeConfig = { port: device, baud: baudRate };
        }

        broadcastStatus(deps);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              device,
              baudRate,
              connected: deps.serialManager.isOpen(),
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 4: enable_disk_serving
  // ===========================================================================

  server.tool(
    'enable_disk_serving',
    'Start FDC+ disk serving mode to allow the Altair 8800 to access mounted disk images',
    async () => {
      try {
        await enableDiskServing(deps);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, diskServing: { enabled: true } }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 5: disable_disk_serving
  // ===========================================================================

  server.tool(
    'disable_disk_serving',
    'Stop FDC+ disk serving mode',
    async () => {
      try {
        await disableDiskServing(deps);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, diskServing: { enabled: false } }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 6: list_drives
  // ===========================================================================

  server.tool(
    'list_drives',
    'List the state of all FDC+ drives (mounted image, read-only status, head position)',
    async () => {
      try {
        const drives = getDrivesStatus(deps);
        return { content: [{ type: 'text', text: JSON.stringify(drives, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 7: mount_disk
  // ===========================================================================

  server.tool(
    'mount_disk',
    'Mount a disk image file to a specific FDC+ drive',
    {
      drive: z.number().describe('Drive number (0-15)'),
      filename: z.string().describe('Disk image filename (e.g. cpm22.dsk)'),
    },
    async ({ drive, filename }) => {
      try {
        if (drive < 0 || drive >= MAX_DRIVES) {
          throw new Error(`Invalid drive number: ${drive}. Must be 0-${MAX_DRIVES - 1}.`);
        }

        // Validate filename: no path separators or traversal
        if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
          throw new Error('Invalid filename: path traversal is not allowed');
        }

        const resolvedPath = safeResolvePath(deps.config.disksDir, filename);
        if (!resolvedPath) {
          throw new Error(`Disk image not found: ${filename}`);
        }

        // Unmount current image if drive is already mounted
        const currentState = deps.driveManager.getDriveState(drive);
        if (currentState && currentState.mounted) {
          await deps.driveManager.unmountDrive(drive);
          await deps.database.clearDriveAssignment(drive);
        }

        // Mount the new image
        await deps.driveManager.mountDrive(drive, resolvedPath);

        // Save to database
        const driveState = deps.driveManager.getDriveState(drive);
        await deps.database.saveDriveAssignment(
          drive,
          filename,
          driveState?.readonly || false
        );

        broadcastStatus(deps);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              drive,
              filename,
              readonly: driveState?.readonly || false,
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 8: unmount_disk
  // ===========================================================================

  server.tool(
    'unmount_disk',
    'Unmount the disk image from a specific FDC+ drive',
    {
      drive: z.number().describe('Drive number (0-15)'),
    },
    async ({ drive }) => {
      try {
        if (drive < 0 || drive >= MAX_DRIVES) {
          throw new Error(`Invalid drive number: ${drive}. Must be 0-${MAX_DRIVES - 1}.`);
        }

        await deps.driveManager.unmountDrive(drive);
        await deps.database.clearDriveAssignment(drive);
        broadcastStatus(deps);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, drive, mounted: false }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 9: set_drive_readonly
  // ===========================================================================

  server.tool(
    'set_drive_readonly',
    'Set or clear write protection on a specific FDC+ drive',
    {
      drive: z.number().describe('Drive number (0-15)'),
      readonly: z.boolean().describe('True to write-protect, false to allow writes'),
    },
    async ({ drive, readonly }) => {
      try {
        if (drive < 0 || drive >= MAX_DRIVES) {
          throw new Error(`Invalid drive number: ${drive}. Must be 0-${MAX_DRIVES - 1}.`);
        }

        await deps.driveManager.writeProtect(drive, readonly);

        // Update database if drive is mounted
        const driveState = deps.driveManager.getDriveState(drive);
        if (driveState && driveState.mounted && driveState.filename) {
          await deps.database.saveDriveAssignment(
            drive,
            path.basename(driveState.filename),
            readonly
          );
        }

        broadcastStatus(deps);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, drive, readonly }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 10: list_disk_images
  // ===========================================================================

  server.tool(
    'list_disk_images',
    'List all available disk image files with sizes, descriptions, and notes',
    async () => {
      try {
        const images = await listDiskImagesWithDetails(deps);
        return { content: [{ type: 'text', text: JSON.stringify(images, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 11: create_disk_image
  // ===========================================================================

  server.tool(
    'create_disk_image',
    'Create a new blank disk image file',
    {
      filename: z.string().describe('Name for the new disk image (without extension)'),
      format: z.enum(['8inch', 'minidisk', '8mb']).describe('Disk format: 8inch = 8-inch floppy (77 tracks, 330 KB), minidisk = 5.25" mini-disk (17 tracks, 75 KB), 8mb = 8 MB hard disk (1863 tracks, ~7.8 MB)'),
      extension: z.enum(['.dsk', '.img', '.ima']).describe('File extension for the disk image'),
    },
    async ({ filename, format, extension }) => {
      try {
        // Validate filename
        if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
          throw new Error('Invalid filename');
        }

        const fullFilename = filename.endsWith(extension) ? filename : filename + extension;
        const filePath = path.join(deps.config.disksDir, fullFilename);

        if (existsSync(filePath)) {
          throw new Error(`Disk image already exists: ${fullFilename}`);
        }

        // Calculate size based on format
        let tracks: number;
        switch (format) {
          case '8inch':
            tracks = 77;
            break;
          case 'minidisk':
            tracks = 17;
            break;
          case '8mb':
            tracks = 1863;
            break;
          default:
            throw new Error(`Unknown disk format: ${format}`);
        }

        const size = TRACK_SIZE * tracks;
        const buffer = Buffer.alloc(size, 0);

        await fs.mkdir(deps.config.disksDir, { recursive: true });
        await fs.writeFile(filePath, buffer);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              filename: fullFilename,
              format,
              tracks,
              size,
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 11b: upload_disk_image
  // ===========================================================================

  server.tool(
    'upload_disk_image',
    'Import a disk image from base64-encoded bytes into the server\'s disks directory. Use this to install a pre-built .dsk/.img/.ima image (max 10 MB); for a blank image use create_disk_image instead.',
    {
      filename: z.string().describe('Target filename including extension (.dsk, .img, or .ima)'),
      data: z.string().describe('Base64-encoded contents of the disk image file'),
    },
    async ({ filename, data }) => {
      try {
        // Same filename guard as create_disk_image: no traversal / separators.
        if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
          throw new Error('Invalid filename');
        }
        if (!isAllowedDiskImageExtension(filename)) {
          throw new Error(`Invalid extension. Allowed: ${DISK_IMAGE_EXTENSIONS.join(', ')}`);
        }

        const filePath = path.join(deps.config.disksDir, filename);
        if (existsSync(filePath)) {
          throw new Error(`Disk image already exists: ${filename}. Delete it first or choose another name.`);
        }

        // Node's base64 decoder silently drops invalid characters, which
        // would let a typo'd payload write a corrupt image. Validate the
        // charset first, then decode.
        const stripped = data.replace(/\s/g, '');
        if (stripped.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(stripped)) {
          throw new Error('Invalid base64 data');
        }
        const buffer = Buffer.from(stripped, 'base64');
        if (buffer.length === 0) {
          throw new Error('Decoded disk image is empty');
        }
        if (buffer.length > MAX_DISK_IMAGE_SIZE) {
          throw new Error(`Disk image too large: ${buffer.length} bytes (max ${MAX_DISK_IMAGE_SIZE}).`);
        }

        // Reject executables/archives disguised as disk images.
        const forbiddenLabel = detectForbiddenMagic(buffer.subarray(0, 8));
        if (forbiddenLabel) {
          throw new Error(`Rejected: file appears to be a ${forbiddenLabel} file`);
        }

        await fs.mkdir(deps.config.disksDir, { recursive: true });
        await fs.writeFile(filePath, buffer);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              filename,
              size: buffer.length,
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 12: clone_disk_image
  // ===========================================================================

  server.tool(
    'clone_disk_image',
    'Create a copy of an existing disk image',
    {
      filename: z.string().describe('Disk image filename to clone'),
    },
    async ({ filename }) => {
      try {
        if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
          throw new Error('Invalid filename');
        }

        const sourcePath = safeResolvePath(deps.config.disksDir, filename);
        if (!sourcePath) {
          throw new Error(`Disk image not found: ${filename}`);
        }

        // Generate clone name
        const ext = path.extname(filename);
        const base = path.basename(filename, ext);
        let cloneName = `${base}_copy${ext}`;
        let counter = 1;
        while (existsSync(path.join(deps.config.disksDir, cloneName))) {
          counter++;
          cloneName = `${base}_copy${counter}${ext}`;
        }

        const destPath = path.join(deps.config.disksDir, cloneName);
        await fs.copyFile(sourcePath, destPath);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              source: filename,
              clone: cloneName,
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 13: delete_disk_image
  // ===========================================================================

  server.tool(
    'delete_disk_image',
    'Delete a disk image file (fails if currently mounted on any drive)',
    {
      filename: z.string().describe('Disk image filename to delete'),
    },
    async ({ filename }) => {
      try {
        if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
          throw new Error('Invalid filename');
        }

        // Check if mounted
        const mountedDrive = isDiskMounted(deps, filename);
        if (mountedDrive !== false) {
          throw new Error(`Cannot delete: disk image is mounted on drive ${mountedDrive}`);
        }

        const filePath = safeResolvePath(deps.config.disksDir, filename);
        if (!filePath) {
          throw new Error(`Disk image not found: ${filename}`);
        }

        await fs.unlink(filePath);

        // Clean up database notes
        await deps.database.deleteDiskNote(filename);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, deleted: filename }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 13b: format_disk_image
  // ===========================================================================

  server.tool(
    'format_disk_image',
    'Erase a disk image and lay down a fresh, empty CP/M filesystem. Destroys ALL data on the image. Fails if the image is mounted on any drive. Omit `format` to keep the image\'s current geometry.',
    {
      filename: z.string().describe('Disk image filename to format (e.g. cpm22.dsk)'),
      format: z.enum(['8inch', 'minidisk', '8mb']).optional()
        .describe('Target format. Omit to infer from the current image size (keeps existing geometry).'),
    },
    async ({ filename, format }) => {
      try {
        if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
          throw new Error('Invalid filename');
        }

        // Refuse if mounted anywhere — same guard as delete_disk_image
        // and the HTTP reformat route.
        const mountedDrive = isDiskMounted(deps, filename);
        if (mountedDrive !== false) {
          throw new Error(`Cannot format: disk image is mounted on drive ${mountedDrive}. Unmount it first.`);
        }

        const filePath = safeResolvePath(deps.config.disksDir, filename);
        if (!filePath) {
          throw new Error(`Disk image not found: ${filename}`);
        }

        // Explicit format wins; otherwise infer from current size so a
        // reformat preserves the image's existing geometry.
        let fmt = format as string | undefined;
        if (!fmt) {
          const stats = await fs.stat(filePath);
          fmt = inferFormatFromSize(stats.size) ?? undefined;
        }
        const params = fmt ? paramsForFormat(fmt) : null;
        if (!params) {
          throw new Error('Could not determine disk format from size — pass format explicitly: 8inch, minidisk, or 8mb.');
        }

        const image = CpmFilesystem.formatImage(params);
        await fs.writeFile(filePath, image);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, filename, format: fmt, size: image.length }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 14: update_disk_notes
  // ===========================================================================

  server.tool(
    'update_disk_notes',
    'Update the description and/or notes metadata for a disk image',
    {
      filename: z.string().describe('Disk image filename'),
      description: z.string().optional().describe('Short description of the disk image'),
      notes: z.string().optional().describe('Longer notes about the disk image contents'),
    },
    async ({ filename, description, notes }) => {
      try {
        if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
          throw new Error('Invalid filename');
        }

        // Verify the disk image exists
        const filePath = safeResolvePath(deps.config.disksDir, filename);
        if (!filePath) {
          throw new Error(`Disk image not found: ${filename}`);
        }

        // Get existing notes to preserve unset fields
        const existing = await deps.database.getDiskNote(filename);
        const newDescription = description !== undefined ? description : (existing?.description || '');
        const newNotes = notes !== undefined ? notes : (existing?.notes || '');

        await deps.database.upsertDiskNote(filename, newDescription, newNotes);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              filename,
              description: newDescription,
              notes: newNotes,
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 15: get_cpm_disk_info
  // ===========================================================================

  server.tool(
    'get_cpm_disk_info',
    'Get CP/M filesystem information (parameters, free space) for a disk image',
    {
      diskFilename: z.string().describe('Disk image filename'),
    },
    async ({ diskFilename }) => {
      try {
        const filePath = safeResolvePath(deps.config.disksDir, diskFilename);
        if (!filePath) {
          throw new Error(`Disk image not found: ${diskFilename}`);
        }

        const imageData = await fs.readFile(filePath);
        const cpmFs = new CpmFilesystem(imageData);
        const params = cpmFs.getParams();
        const freeSpace = cpmFs.getFreeSpace();

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              filename: diskFilename,
              params,
              freeSpace,
              mounted: isDiskMounted(deps, diskFilename),
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 16: list_cpm_files
  // ===========================================================================

  server.tool(
    'list_cpm_files',
    'List all files on a CP/M disk image with sizes and attributes',
    {
      diskFilename: z.string().describe('Disk image filename'),
    },
    async ({ diskFilename }) => {
      try {
        const filePath = safeResolvePath(deps.config.disksDir, diskFilename);
        if (!filePath) {
          throw new Error(`Disk image not found: ${diskFilename}`);
        }

        const imageData = await fs.readFile(filePath);
        const cpmFs = new CpmFilesystem(imageData);
        const files = cpmFs.listFiles();

        const result = files.map(f => ({
          user: f.user,
          filename: f.filename.trimEnd(),
          extension: f.extension.trimEnd(),
          name: `${f.filename.trimEnd()}.${f.extension.trimEnd()}`,
          size: f.size,
          readonly: f.readonly,
          system: f.system,
          archive: f.archive,
        }));

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 17: read_cpm_file
  // ===========================================================================

  server.tool(
    'read_cpm_file',
    'Read a file from a CP/M disk image (returns content as base64)',
    {
      diskFilename: z.string().describe('Disk image filename'),
      cpmFilename: z.string().describe('CP/M filename (e.g. HELLO.BAS or 0:HELLO.BAS)'),
    },
    async ({ diskFilename, cpmFilename }) => {
      try {
        const filePath = safeResolvePath(deps.config.disksDir, diskFilename);
        if (!filePath) {
          throw new Error(`Disk image not found: ${diskFilename}`);
        }

        const imageData = await fs.readFile(filePath);
        const cpmFs = new CpmFilesystem(imageData);
        const parsed = CpmFilesystem.parseFilenameParam(cpmFilename);
        const fileData = cpmFs.readFile(parsed.filename, parsed.extension, parsed.user);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              diskFilename,
              cpmFilename: `${parsed.filename.trimEnd()}.${parsed.extension.trimEnd()}`,
              user: parsed.user,
              size: fileData.length,
              data: fileData.toString('base64'),
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 18: write_cpm_file
  // ===========================================================================

  server.tool(
    'write_cpm_file',
    'Write a file to a CP/M disk image (data must be base64-encoded)',
    {
      diskFilename: z.string().describe('Disk image filename'),
      cpmFilename: z.string().describe('CP/M filename (e.g. HELLO.BAS or 0:HELLO.BAS)'),
      data: z.string().describe('File content as a base64-encoded string'),
    },
    async ({ diskFilename, cpmFilename, data }) => {
      try {
        // Check if the disk is mounted - writing to a mounted disk is unsafe
        const mountedDrive = isDiskMounted(deps, diskFilename);
        if (mountedDrive !== false) {
          throw new Error(`Cannot modify: disk image is mounted on drive ${mountedDrive}`);
        }

        const filePath = safeResolvePath(deps.config.disksDir, diskFilename);
        if (!filePath) {
          throw new Error(`Disk image not found: ${diskFilename}`);
        }

        const imageData = await fs.readFile(filePath);
        const cpmFs = new CpmFilesystem(imageData);
        const parsed = CpmFilesystem.parseFilenameParam(cpmFilename);
        const fileData = Buffer.from(data, 'base64');

        cpmFs.writeFile(parsed.filename, parsed.extension, fileData, parsed.user);

        // Write the modified image back to disk
        await fs.writeFile(filePath, cpmFs.getImageData());

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              diskFilename,
              cpmFilename: `${parsed.filename.trimEnd()}.${parsed.extension.trimEnd()}`,
              user: parsed.user,
              size: fileData.length,
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 19: delete_cpm_file
  // ===========================================================================

  server.tool(
    'delete_cpm_file',
    'Delete a file from a CP/M disk image',
    {
      diskFilename: z.string().describe('Disk image filename'),
      cpmFilename: z.string().describe('CP/M filename to delete (e.g. HELLO.BAS or 0:HELLO.BAS)'),
    },
    async ({ diskFilename, cpmFilename }) => {
      try {
        // Check if the disk is mounted
        const mountedDrive = isDiskMounted(deps, diskFilename);
        if (mountedDrive !== false) {
          throw new Error(`Cannot modify: disk image is mounted on drive ${mountedDrive}`);
        }

        const filePath = safeResolvePath(deps.config.disksDir, diskFilename);
        if (!filePath) {
          throw new Error(`Disk image not found: ${diskFilename}`);
        }

        const imageData = await fs.readFile(filePath);
        const cpmFs = new CpmFilesystem(imageData);
        const parsed = CpmFilesystem.parseFilenameParam(cpmFilename);

        cpmFs.deleteFile(parsed.filename, parsed.extension, parsed.user);

        // Write the modified image back to disk
        await fs.writeFile(filePath, cpmFs.getImageData());

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              diskFilename,
              deleted: `${parsed.filename.trimEnd()}.${parsed.extension.trimEnd()}`,
              user: parsed.user,
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 20: get_terminal_status
  // ===========================================================================

  server.tool(
    'get_terminal_status',
    'Get the terminal serial port connection state and configuration',
    async () => {
      try {
        const status = getTerminalStatus(deps);
        return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 21: list_terminal_ports
  // ===========================================================================

  server.tool(
    'list_terminal_ports',
    'List available serial ports for terminal connection',
    async () => {
      try {
        const ports = await TerminalSerialManager.listPorts();
        return { content: [{ type: 'text', text: JSON.stringify(ports, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 22: open_terminal
  // ===========================================================================

  server.tool(
    'open_terminal',
    'Open a terminal serial port connection to the Altair 8800',
    {
      device: z.string().describe('Serial port device path (e.g. /dev/ttyUSB1)'),
      baudRate: z.number().optional().describe('Baud rate (default: 9600)'),
    },
    async ({ device, baudRate }) => {
      try {
        const config: { baudRate?: number } = {};
        if (baudRate !== undefined) {
          config.baudRate = baudRate;
        }

        await deps.terminalManager.openPort(device, config as any);

        // Save preferred settings
        deps.preferredTerminalSettings.port = device;
        if (baudRate !== undefined) {
          deps.preferredTerminalSettings.baud = baudRate;
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              device,
              baudRate: deps.terminalManager.getConfig().baudRate,
              connected: deps.terminalManager.isOpen(),
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 23: close_terminal
  // ===========================================================================

  server.tool(
    'close_terminal',
    'Close the terminal serial port connection',
    async () => {
      try {
        await deps.terminalManager.closePort();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, connected: false }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 24: send_to_terminal
  // ===========================================================================

  server.tool(
    'send_to_terminal',
    'Send text to the Altair 8800 via the terminal serial port',
    {
      text: z.string().describe('Text to send to the terminal'),
    },
    async ({ text }) => {
      try {
        if (!deps.terminalManager.isOpen()) {
          throw new Error('Terminal serial port is not open');
        }

        await deps.terminalManager.write(Buffer.from(text));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              bytesSent: Buffer.from(text).length,
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 25: list_scripts
  // ===========================================================================

  server.tool(
    'list_scripts',
    'List available script files that can be replayed to the terminal',
    async () => {
      try {
        await fs.mkdir(deps.config.scriptsDir, { recursive: true });
        const files = await fs.readdir(deps.config.scriptsDir);
        const scripts = await Promise.all(
          files.filter(f => !f.startsWith('.')).map(async (name) => {
            try {
              const stat = await fs.stat(path.join(deps.config.scriptsDir, name));
              return { name, size: stat.size };
            } catch {
              return { name, size: 0 };
            }
          })
        );
        return { content: [{ type: 'text', text: JSON.stringify(scripts, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 25b: read_script
  // ===========================================================================

  server.tool(
    'read_script',
    'Read a script file from the scripts directory. Returns the text for .txt scripts; other (binary) scripts return metadata only.',
    {
      scriptName: z.string().describe('Script filename to read (e.g. boot.txt)'),
    },
    async ({ scriptName }) => {
      try {
        if (!scriptName || scriptName.includes('/') || scriptName.includes('\\') || scriptName.includes('..')) {
          throw new Error('Invalid script name');
        }
        const filePath = safeResolvePath(deps.config.scriptsDir, scriptName);
        if (!filePath) {
          throw new Error(`Script not found: ${scriptName}`);
        }
        const stat = await fs.stat(filePath);
        // Mirror the HTTP GET semantics: text content only for .txt;
        // binary scripts return metadata (their bytes are meant to be
        // sent via raw/xmodem replay, not read as text).
        if (scriptName.endsWith('.txt')) {
          const content = await fs.readFile(filePath, 'utf-8');
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ name: scriptName, size: stat.size, binary: false, content }, null, 2),
            }],
          };
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              name: scriptName,
              size: stat.size,
              binary: true,
              note: 'Binary script — content not returned. Send it with start_replay (raw or xmodem).',
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 25c: write_script
  // ===========================================================================

  server.tool(
    'write_script',
    'Create or overwrite a text script in the scripts directory. Refuses to clobber an existing script unless overwrite is true. Binary scripts must be uploaded over HTTP, not written here.',
    {
      scriptName: z.string().describe('Script filename to write (e.g. boot.txt)'),
      content: z.string().describe('UTF-8 text content of the script'),
      overwrite: z.boolean().optional().describe('Set true to replace an existing script (default false)'),
    },
    async ({ scriptName, content, overwrite }) => {
      try {
        if (!scriptName || scriptName.includes('/') || scriptName.includes('\\') || scriptName.includes('..')) {
          throw new Error('Invalid script name');
        }
        await fs.mkdir(deps.config.scriptsDir, { recursive: true });
        const filePath = path.join(deps.config.scriptsDir, scriptName);
        const existed = existsSync(filePath);
        if (existed && !overwrite) {
          throw new Error(`Script already exists: ${scriptName}. Pass overwrite=true to replace it.`);
        }
        await fs.writeFile(filePath, content ?? '', 'utf-8');
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              name: scriptName,
              bytes: Buffer.byteLength(content ?? '', 'utf-8'),
              created: !existed,
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 26: start_replay
  // ===========================================================================

  server.tool(
    'start_replay',
    'Start replaying a script file to the terminal (raw text or XMODEM transfer)',
    {
      scriptName: z.string().describe('Script filename to replay'),
      mode: z.enum(['raw', 'xmodem']).optional().describe('Transfer mode: raw (default) or xmodem'),
    },
    async ({ scriptName, mode }) => {
      try {
        if (!deps.terminalManager.isOpen()) {
          throw new Error('Terminal serial port is not open');
        }

        if (!scriptName || scriptName.includes('/') || scriptName.includes('\\') || scriptName.includes('..')) {
          throw new Error('Invalid script name');
        }

        const filePath = safeResolvePath(deps.config.scriptsDir, scriptName);
        if (!filePath) {
          throw new Error(`Script not found: ${scriptName}`);
        }

        const transferMode = mode || 'raw';

        if (transferMode === 'xmodem') {
          startXmodemSend(deps, filePath, scriptName);
        } else {
          startRawReplay(deps, filePath, scriptName);
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              scriptName,
              mode: transferMode,
              status: 'started',
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 27: cancel_replay
  // ===========================================================================

  server.tool(
    'cancel_replay',
    'Cancel an active script replay or file transfer',
    async () => {
      try {
        cancelActiveTransfer(deps);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, status: 'cancelled' }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 28: get_replay_status
  // ===========================================================================

  server.tool(
    'get_replay_status',
    'Get the current status and progress of an active script replay or file transfer',
    async () => {
      try {
        let status: any = { active: false };

        if (deps.replayEngine && deps.replayEngine.isRunning()) {
          status = {
            active: true,
            type: 'raw',
            progress: deps.replayEngine.getLastProgress(),
          };
        } else if (deps.xmodemSender && deps.xmodemSender.isRunning()) {
          status = {
            active: true,
            type: 'xmodem',
            progress: deps.xmodemSender.getLastProgress(),
          };
        }

        return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 29: list_cassettes
  // ===========================================================================

  server.tool(
    'list_cassettes',
    'List available cassette audio files with details',
    async () => {
      try {
        const cassettes = await listCassettesWithDetails(deps);
        return { content: [{ type: 'text', text: JSON.stringify(cassettes, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  return server;
}

/**
 * Start the MCP server with stdio transport.
 * This is the entry point for running the MCP server standalone.
 */
export async function startMcpStdio(deps: Dependencies): Promise<void> {
  const server = createMcpServer(deps);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
