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
import { convertLineEndings, LineEnding } from './replay-engine';
import { safeResolvePath } from './utils/safe-path';
import { isDiskMounted } from './utils/drive-status';
import { getClientMountRegistry } from './client-mount-registry';
import { getMultiClientSettings, applyMultiClientSettings } from './services/multi-client-settings';
import {
  listClients,
  setClientName,
  setClientDrive,
  clearClientDrive,
  forgetClient,
} from './services/client-service';
import { commitTransientDrive, saveTransientSnapshot } from './services/transient-service';
import { commitClientSplinter, saveClientSplinterSnapshot, saveClientSplinterAsDisk } from './services/splinter-service';
import {
  createSnapshot,
  listSnapshots,
  rollbackSnapshot,
  deleteSnapshot,
  deleteSnapshotsForDisk,
} from './services/disk-snapshots';
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

        // Drop any snapshots of this image so they don't orphan.
        await deleteSnapshotsForDisk(deps, filename);

        // Drop any per-image write policy.
        await deps.database.deleteDiskPolicy(filename);

        // Drop any persistent per-client splinters forked from this image.
        const splinterPaths = await deps.database.deleteClientSplintersForBase(filename);
        await Promise.all(splinterPaths.map((p) => fs.unlink(p).catch(() => { /* best-effort */ })));

        // Drop any per-client drive-bay overrides pointing at this image.
        await deps.database.deleteClientMountsForBase(filename);
        getClientMountRegistry().clearByBasename(filename);
        await deps.connectionManager?.syncAll();

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
  // Tools 13c–13f: disk snapshots
  // ===========================================================================

  server.tool(
    'snapshot_disk_image',
    'Create a point-in-time snapshot (full copy) of a disk image. Allowed while the disk is mounted. Snapshots can be listed, rolled back to, and deleted.',
    {
      filename: z.string().describe('Disk image filename to snapshot (e.g. cpm22.dsk)'),
      label: z.string().optional().describe('Optional human-readable label for the snapshot'),
    },
    async ({ filename, label }) => {
      try {
        const snapshot = await createSnapshot(deps, filename, label ?? '');
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, snapshot }, null, 2) }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'list_disk_snapshots',
    'List all snapshots for a disk image, newest first',
    {
      filename: z.string().describe('Disk image filename'),
    },
    async ({ filename }) => {
      try {
        const snapshots = await listSnapshots(deps, filename);
        return {
          content: [{ type: 'text', text: JSON.stringify({ snapshots }, null, 2) }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'rollback_disk_image',
    'Roll a disk image back to a snapshot, overwriting its current contents. Fails if the disk is mounted on any drive.',
    {
      filename: z.string().describe('Disk image filename to roll back'),
      snapshotId: z.string().describe('Snapshot id (from list_disk_snapshots)'),
    },
    async ({ filename, snapshotId }) => {
      try {
        await rollbackSnapshot(deps, filename, snapshotId);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, filename, snapshotId }, null, 2) }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'delete_disk_snapshot',
    'Delete a single snapshot of a disk image',
    {
      filename: z.string().describe('Disk image filename the snapshot belongs to'),
      snapshotId: z.string().describe('Snapshot id (from list_disk_snapshots)'),
    },
    async ({ filename, snapshotId }) => {
      try {
        await deleteSnapshot(deps, filename, snapshotId);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, snapshotId }, null, 2) }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'get_disk_write_policy',
    "Get a disk image's behavior when the guest writes to it while mounted read-only: 'inherit' (follow the global default), 'error' (fail writes), or 'transient' (redirect writes to a throwaway copy-on-write scratch, keeping the master pristine).",
    {
      filename: z.string().describe('Disk image filename'),
    },
    async ({ filename }) => {
      try {
        if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
          throw new Error('Invalid filename');
        }
        const onReadonlyWrite = await deps.database.getDiskPolicy(filename);
        return {
          content: [{ type: 'text', text: JSON.stringify({ filename, onReadonlyWrite }, null, 2) }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'set_disk_write_policy',
    "Set a disk image's read-only-write policy. 'transient' backs the read-only image with a copy-on-write scratch so guest writes succeed without changing the master; 'error' fails such writes; 'inherit' follows the global readonlyWritePolicy default.",
    {
      filename: z.string().describe('Disk image filename'),
      onReadonlyWrite: z.enum(['inherit', 'error', 'transient']).describe('Policy to apply'),
    },
    async ({ filename, onReadonlyWrite }) => {
      try {
        if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
          throw new Error('Invalid filename');
        }
        await deps.database.setDiskPolicy(filename, onReadonlyWrite);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, filename, onReadonlyWrite }, null, 2) }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Multi-client serving: settings, per-client drive bays, transient keep.
  // NOTE: mutating tools update the DB + registry; the running daemon's live
  // sessions re-sync only when this MCP server runs in-process (MCP-over-HTTP).
  // Over stdio (a separate process) the changes persist but won't live-update a
  // separately-running daemon until it reloads.
  // ===========================================================================

  server.tool(
    'get_multi_client_settings',
    'Get multi-client disk serving settings: whether multiple virtual clients may connect at once (each with its own copy-on-write disk fork), and which client writes the base image directly (writeMaster: a clientId, "serial", or "none").',
    {},
    async () => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(await getMultiClientSettings(deps), null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'set_multi_client_settings',
    'Update multi-client serving settings. Disabling is refused while more than one client is connected. writeMaster names the client that writes the base image directly (others splinter).',
    {
      multiClientServing: z.boolean().optional().describe('Enable/disable concurrent multi-client serving'),
      writeMaster: z.string().optional().describe('clientId, "serial" (default), or "none"'),
    },
    async ({ multiClientServing, writeMaster }) => {
      try {
        const result = await applyMultiClientSettings(deps, { multiClientServing, writeMaster });
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, ...result }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'list_clients',
    'List known + connected virtual clients with their per-drive effective mounts (override vs inherited global), connected/master flags, and dirty splinter state.',
    {},
    async () => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(await listClients(deps), null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'set_client_name',
    'Set a friendly name for a persistent client id.',
    {
      clientId: z.string().describe('Persistent client id'),
      name: z.string().describe('Friendly name'),
    },
    async ({ clientId, name }) => {
      try {
        await setClientName(deps, clientId, name);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, clientId, name }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'set_client_drive',
    "Set a client's per-drive mount override (wins over the global mount for that client). Validates the image exists. Drives are 0-3.",
    {
      clientId: z.string().describe('Persistent client id'),
      drive: z.number().int().describe('Drive number (0-3)'),
      filename: z.string().describe('Disk image filename to mount for this client'),
      readonly: z.boolean().optional().describe('Mount read-only (default false)'),
    },
    async ({ clientId, drive, filename, readonly }) => {
      try {
        await setClientDrive(deps, clientId, drive, filename, !!readonly);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, clientId, drive, filename, readonly: !!readonly }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'clear_client_drive',
    "Clear a client's per-drive override so that drive inherits the global mount again.",
    {
      clientId: z.string().describe('Persistent client id'),
      drive: z.number().int().describe('Drive number (0-3)'),
    },
    async ({ clientId, drive }) => {
      try {
        await clearClientDrive(deps, clientId, drive);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, clientId, drive }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'forget_client',
    "Forget a client: clear its drive overrides, discard its splinters (files + rows), and remove its name.",
    {
      clientId: z.string().describe('Persistent client id'),
    },
    async ({ clientId }) => {
      try {
        await forgetClient(deps, clientId);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, clientId }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'commit_client_splinter',
    "Commit a client's private copy-on-write splinter for a drive back onto its shared master image (hot-swap in place: live readers are reloaded onto the new contents, and client splinters re-attach keeping their own writes). Refused only when the base is held read-write by a live master-write path (an operator drive mounted read-write, or the connected master-write client).",
    {
      clientId: z.string().describe('Persistent client id'),
      drive: z.number().int().describe('Drive number backed by a persistent splinter'),
    },
    async ({ clientId, drive }) => {
      try {
        const result = await commitClientSplinter(deps, clientId, drive);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, ...result }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'save_client_splinter_as_disk',
    "Save a client's copy-on-write splinter for a drive as a brand-new named disk image in the library, without touching the live master. The name is suffixed on collision; the extension defaults to the master's if omitted.",
    {
      clientId: z.string().describe('Persistent client id'),
      drive: z.number().int().describe('Drive number backed by a persistent splinter'),
      name: z.string().describe('New disk image name (e.g. game-edited or game-edited.dsk)'),
    },
    async ({ clientId, drive, name }) => {
      try {
        const result = await saveClientSplinterAsDisk(deps, clientId, drive, name);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, ...result }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'save_client_splinter_snapshot',
    "Save a client's current copy-on-write splinter for a drive as a snapshot of its master image, without touching the master or the splinter.",
    {
      clientId: z.string().describe('Persistent client id'),
      drive: z.number().int().describe('Drive number backed by a persistent splinter'),
      label: z.string().optional().describe('Optional snapshot label'),
    },
    async ({ clientId, drive, label }) => {
      try {
        const snapshot = await saveClientSplinterSnapshot(deps, clientId, drive, label ?? '');
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, snapshot }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'commit_transient',
    "Commit a transient (copy-on-write) drive's changes back onto its master image. Refused if the same master is mounted on another drive.",
    {
      drive: z.number().int().describe('Drive number backed by a transient scratch'),
    },
    async ({ drive }) => {
      try {
        const result = await commitTransientDrive(deps, drive);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, ...result }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'save_transient_snapshot',
    "Save a transient drive's current copy-on-write scratch as a snapshot of its master image, without touching the master.",
    {
      drive: z.number().int().describe('Drive number backed by a transient scratch'),
      label: z.string().optional().describe('Optional snapshot label'),
    },
    async ({ drive, label }) => {
      try {
        const snapshot = await saveTransientSnapshot(deps, drive, label ?? '');
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, snapshot }, null, 2) }] };
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
    'Write a file to a CP/M disk image from inline base64 data. ' +
      'PREFER write_cpm_file_from_upload for anything but a few hundred bytes: ' +
      'this tool requires the entire file to be passed as a base64 string in the ' +
      '`data` argument, which the calling model must generate token-by-token. ' +
      'A 16 KB file expands to ~22,000 base64 characters (~8,700 output tokens), ' +
      'so large writes are slow and expensive even though the server-side write ' +
      'is instant. Use this tool only for small, model-generated content.',
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
  // Tool 18b: list_uploads
  // ===========================================================================

  server.tool(
    'list_uploads',
    'List files staged in the server\'s uploads directory. These files can be ' +
      'written into a CP/M disk image with write_cpm_file_from_upload WITHOUT ' +
      'transferring their bytes through the model. Drop a file into the uploads ' +
      'directory (or POST it to the REST upload endpoint) first, then reference ' +
      'it here by name.',
    async () => {
      try {
        const uploadsDir = deps.config.uploadsDir;
        if (!uploadsDir) {
          throw new Error('Uploads directory is not configured on this server.');
        }
        if (!existsSync(uploadsDir)) {
          return { content: [{ type: 'text', text: JSON.stringify({ uploadsDir, files: [] }, null, 2) }] };
        }

        const names = await fs.readdir(uploadsDir);
        const files = [];
        for (const name of names) {
          const resolved = safeResolvePath(uploadsDir, name);
          if (!resolved) continue; // skip symlink escapes / vanished entries
          const st = await fs.stat(resolved);
          if (!st.isFile()) continue;
          files.push({ name, size: st.size });
        }

        return { content: [{ type: 'text', text: JSON.stringify({ uploadsDir, files }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 18c: write_cpm_file_from_upload
  // ===========================================================================

  server.tool(
    'write_cpm_file_from_upload',
    'Write a file to a CP/M disk image by copying it from the server\'s uploads ' +
      'directory. This is the PREFERRED way to put a real file onto a disk: the ' +
      'file bytes never pass through the model, so it is fast and cheap regardless ' +
      'of file size (unlike write_cpm_file, which needs inline base64). ' +
      'Workflow for a Claude Code client: (1) place the source file in the server\'s ' +
      'uploads directory — either drop it there directly or POST it to the REST ' +
      'upload endpoint; (2) call list_uploads to confirm the name; ' +
      '(3) call this tool with uploadFilename set to that name. The disk image must ' +
      'not be mounted on a drive.',
    {
      diskFilename: z.string().describe('Destination disk image filename (in the disks directory)'),
      cpmFilename: z.string().describe('CP/M filename to create (e.g. HELLO.BAS or 0:HELLO.BAS)'),
      uploadFilename: z.string().describe('Name of the source file in the uploads directory (see list_uploads)'),
    },
    async ({ diskFilename, cpmFilename, uploadFilename }) => {
      try {
        // Writing to a mounted disk is unsafe — the daemon may be serving it.
        const mountedDrive = isDiskMounted(deps, diskFilename);
        if (mountedDrive !== false) {
          throw new Error(`Cannot modify: disk image is mounted on drive ${mountedDrive}`);
        }

        const uploadsDir = deps.config.uploadsDir;
        if (!uploadsDir) {
          throw new Error('Uploads directory is not configured on this server.');
        }

        // Confine the source to the uploads directory (blocks traversal / symlink escape).
        const sourcePath = safeResolvePath(uploadsDir, uploadFilename);
        if (!sourcePath) {
          throw new Error(`Upload not found: ${uploadFilename}`);
        }

        const filePath = safeResolvePath(deps.config.disksDir, diskFilename);
        if (!filePath) {
          throw new Error(`Disk image not found: ${diskFilename}`);
        }

        const fileData = await fs.readFile(sourcePath);
        const imageData = await fs.readFile(filePath);
        const cpmFs = new CpmFilesystem(imageData);
        const parsed = CpmFilesystem.parseFilenameParam(cpmFilename);

        cpmFs.writeFile(parsed.filename, parsed.extension, fileData, parsed.user);

        await fs.writeFile(filePath, cpmFs.getImageData());

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              diskFilename,
              cpmFilename: `${parsed.filename.trimEnd()}.${parsed.extension.trimEnd()}`,
              uploadFilename,
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
    'Send text to the Altair 8800 via the terminal serial port. A CR (0x0D) is appended automatically so CP/M executes the command — send "DIR", not "DIR\\n". Use lineEnding="raw" to suppress all conversion.',
    {
      text: z.string().describe('Text to send (e.g. "DIR"). A line terminator is appended automatically unless lineEnding is "raw".'),
      lineEnding: z.enum(['cr', 'lf', 'crlf', 'raw']).optional().describe('Line ending mode: cr (default, CP/M), lf, crlf, raw (no conversion, no append)'),
    },
    async ({ text, lineEnding }) => {
      try {
        if (!deps.terminalManager.isOpen()) {
          throw new Error('Terminal serial port is not open');
        }

        const mode = (lineEnding ?? 'cr') as LineEnding;
        let buf = convertLineEndings(Buffer.from(text), mode);

        // Ensure the buffer ends with the target line terminator so bare commands
        // like "DIR" are executed by CP/M (convertLineEndings only converts existing
        // newlines — it does not append one when the text has no trailing newline).
        if (mode !== 'raw') {
          const terminator = mode === 'lf'   ? Buffer.from([0x0A])
                           : mode === 'crlf' ? Buffer.from([0x0D, 0x0A])
                           :                   Buffer.from([0x0D]);
          if (!buf.slice(-terminator.length).equals(terminator)) {
            buf = Buffer.concat([buf, terminator]);
          }
        }

        await deps.terminalManager.write(buf);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              bytesSent: buf.length,
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 25: clear_terminal_buffer
  // ===========================================================================

  server.tool(
    'clear_terminal_buffer',
    'Clear the MCP terminal receive buffer. Call this before sending a command so read_terminal_output only returns output from that command.',
    async () => {
      try {
        deps.terminalManager.clearMcpBuffer();
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 26: read_terminal_output
  // ===========================================================================

  server.tool(
    'read_terminal_output',
    'Read bytes received from the Altair terminal serial port. Optionally waits for output to arrive and settle. Typical agentic flow: clear_terminal_buffer → send_to_terminal → read_terminal_output(waitMs=5000).',
    {
      clearFirst: z.boolean().optional().describe('Flush the buffer before waiting (default false)'),
      waitMs: z.number().min(0).max(30000).optional().describe('Total milliseconds to wait for output (default 0 = return immediately)'),
      idleMs: z.number().min(50).max(10000).optional().describe('Settle time: return once no new bytes arrive for this many ms (default 500)'),
    },
    async ({ clearFirst, waitMs, idleMs }) => {
      try {
        if (clearFirst) deps.terminalManager.clearMcpBuffer();

        if (waitMs && waitMs > 0) {
          const settle = idleMs ?? 500;
          let tap: ((data: Buffer) => void) | null = null;
          await new Promise<void>((resolve) => {
            let idleTimer: ReturnType<typeof setTimeout> | null = null;
            const hardTimer = setTimeout(() => {
              if (idleTimer) clearTimeout(idleTimer);
              resolve();
            }, waitMs);

            const resetIdle = () => {
              if (idleTimer) clearTimeout(idleTimer);
              idleTimer = setTimeout(() => {
                clearTimeout(hardTimer);
                resolve();
              }, settle);
            };

            tap = () => resetIdle();
            deps.terminalManager.addMcpDataListener(tap);
            resetIdle();
          });
          if (tap) deps.terminalManager.removeMcpDataListener(tap);
        }

        const raw = deps.terminalManager.readMcpBuffer();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              bytes: raw.length,
              output: raw.toString('latin1'),
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
      }
    }
  );

  // ===========================================================================
  // Tool 27: list_scripts
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
