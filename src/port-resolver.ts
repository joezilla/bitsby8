/**
 * Serial Port Path Resolver
 *
 * Provides utilities for resolving serial port paths and discovering persistent
 * device paths on Linux systems. This module helps solve the problem of USB
 * serial adapters changing their /dev/ttyUSB* names across reboots.
 *
 * Key Features:
 * - Resolves volatile (/dev/ttyUSB0) and persistent (/dev/serial/by-id/*) paths
 * - Follows symlinks to find actual device locations
 * - Discovers persistent paths for all detected serial ports
 * - Platform-aware (Linux-specific features degrade gracefully on other OSes)
 */

import { SerialPort } from 'serialport';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Comprehensive information about a serial port
 */
export interface PortInfo {
  /** Original path as configured or detected */
  path: string;

  /** Resolved actual device path (follows symlinks) */
  resolvedPath: string;

  /** Persistent device paths (Linux only) */
  persistentPaths: {
    /** /dev/serial/by-id/* path (based on device serial number) */
    byId?: string;
    /** /dev/serial/by-path/* path (based on USB port location) */
    byPath?: string;
  };

  /** Device metadata from serialport library */
  metadata: {
    manufacturer?: string;
    serialNumber?: string;
    pnpId?: string;
    vendorId?: string;
    productId?: string;
    locationId?: string;
  };

  /** Whether path exists on the filesystem */
  exists: boolean;

  /** Whether path is a symlink */
  isSymlink: boolean;
}

/**
 * Validation result for a port path
 */
export interface PortValidation {
  valid: boolean;
  reason?: string;
  suggestions?: string[];
}

/**
 * Resolves a serial port path to its actual device location
 *
 * Handles:
 * - Volatile paths like /dev/ttyUSB0
 * - Persistent paths like /dev/serial/by-id/usb-FTDI_...
 * - Symlink resolution
 * - Existence checking
 *
 * @param configuredPath - The path to resolve (from config or CLI)
 * @returns Complete port information including resolved path and metadata
 */
export async function resolvePortPath(configuredPath: string): Promise<PortInfo> {
  const portInfo: PortInfo = {
    path: configuredPath,
    resolvedPath: configuredPath,
    persistentPaths: {},
    metadata: {},
    exists: false,
    isSymlink: false,
  };

  try {
    // Check if path exists
    await fs.access(configuredPath);
    portInfo.exists = true;

    // Check if it's a symlink
    const stats = await fs.lstat(configuredPath);
    portInfo.isSymlink = stats.isSymbolicLink();

    // Resolve symlinks to actual device
    if (portInfo.isSymlink) {
      try {
        portInfo.resolvedPath = await fs.realpath(configuredPath);
      } catch (error) {
        // Handle ELOOP (symlink loop) or other resolution errors
        throw new Error(`Failed to resolve symlink ${configuredPath}: ${(error as Error).message}`);
      }
    }

    // Get metadata from serialport library
    const allPorts = await SerialPort.list();
    const matchingPort = allPorts.find(
      p => p.path === portInfo.resolvedPath || p.path === configuredPath
    );

    if (matchingPort) {
      portInfo.metadata = {
        manufacturer: matchingPort.manufacturer,
        serialNumber: matchingPort.serialNumber,
        pnpId: matchingPort.pnpId,
        vendorId: matchingPort.vendorId,
        productId: matchingPort.productId,
        locationId: matchingPort.locationId,
      };
    }

    // Discover persistent paths (Linux only)
    if (process.platform === 'linux') {
      portInfo.persistentPaths = await findPersistentPaths(portInfo.resolvedPath);
    }

  } catch (error) {
    // Path doesn't exist
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      portInfo.exists = false;
    } else {
      // Re-throw other errors
      throw error;
    }
  }

  return portInfo;
}

/**
 * Lists all available serial ports with persistent path information
 *
 * This is an enhanced version of SerialPort.list() that includes:
 * - Persistent /dev/serial/by-id/* paths
 * - Persistent /dev/serial/by-path/* paths
 * - Resolved symlink information
 *
 * @returns Array of PortInfo for all detected serial ports
 */
export async function listPortsWithPersistent(): Promise<PortInfo[]> {
  // Get all ports from serialport library
  const systemPorts = await SerialPort.list();

  // Build persistent path mappings (Linux only)
  const persistentMappings = process.platform === 'linux'
    ? await buildPersistentPathMappings()
    : new Map<string, { byId?: string; byPath?: string }>();

  // Enhance each port with persistent path info
  const enhancedPorts: PortInfo[] = systemPorts.map(port => ({
    path: port.path,
    resolvedPath: port.path,
    persistentPaths: persistentMappings.get(port.path) || {},
    metadata: {
      manufacturer: port.manufacturer,
      serialNumber: port.serialNumber,
      pnpId: port.pnpId,
      vendorId: port.vendorId,
      productId: port.productId,
      locationId: port.locationId,
    },
    exists: true,
    isSymlink: false,
  }));

  return enhancedPorts;
}

/**
 * Validates a port path and provides helpful error messages
 *
 * @param portPath - Path to validate
 * @returns Validation result with suggestions if invalid
 */
export async function validatePortPath(portPath: string): Promise<PortValidation> {
  try {
    const portInfo = await resolvePortPath(portPath);

    if (!portInfo.exists) {
      // Port doesn't exist - provide suggestions
      const allPorts = await listPortsWithPersistent();
      const suggestions = allPorts
        .map(p => p.persistentPaths.byId || p.path)
        .filter(p => p); // Filter out undefined

      return {
        valid: false,
        reason: `Port ${portPath} not found. Device may be unplugged or path may have changed.`,
        suggestions: suggestions.length > 0 ? suggestions : undefined,
      };
    }

    return { valid: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EACCES') {
      return {
        valid: false,
        reason: `Permission denied accessing ${portPath}. Add your user to the 'dialout' group: sudo usermod -a -G dialout $USER`,
      };
    }

    return {
      valid: false,
      reason: `Error validating port: ${(error as Error).message}`,
    };
  }
}

/**
 * Finds a port by matching metadata (serial number, vendor ID, etc.)
 *
 * Useful for finding a specific device even if its path has changed.
 *
 * @param serialNumber - Device serial number to match
 * @param vendorId - Optional vendor ID for additional matching
 * @returns PortInfo if found, null otherwise
 */
export async function findPortByMetadata(
  serialNumber: string,
  vendorId?: string
): Promise<PortInfo | null> {
  const allPorts = await listPortsWithPersistent();

  const matchingPort = allPorts.find(port => {
    const serialMatch = port.metadata.serialNumber === serialNumber;
    const vendorMatch = !vendorId || port.metadata.vendorId === vendorId;
    return serialMatch && vendorMatch;
  });

  return matchingPort || null;
}

/**
 * Suggests a persistent path for a given volatile path
 *
 * Helper for migration from /dev/ttyUSB* to /dev/serial/by-id/*
 *
 * @param volatilePath - Current volatile path (e.g., /dev/ttyUSB0)
 * @returns Recommended persistent path, or null if none available
 */
export async function suggestPersistentPath(volatilePath: string): Promise<string | null> {
  try {
    const portInfo = await resolvePortPath(volatilePath);

    // Prefer by-id (more stable), fall back to by-path
    return portInfo.persistentPaths.byId || portInfo.persistentPaths.byPath || null;
  } catch (error) {
    return null;
  }
}

// ============================================================================
// Internal Helper Functions
// ============================================================================

/**
 * Finds persistent paths (/dev/serial/by-id/* and /dev/serial/by-path/*)
 * that point to the given resolved device path
 *
 * @param resolvedDevicePath - Actual device path (e.g., /dev/ttyUSB0)
 * @returns Object with byId and byPath persistent paths
 */
async function findPersistentPaths(
  resolvedDevicePath: string
): Promise<{ byId?: string; byPath?: string }> {
  const result: { byId?: string; byPath?: string } = {};

  // Check /dev/serial/by-id/
  try {
    const byIdDir = '/dev/serial/by-id';
    const byIdEntries = await fs.readdir(byIdDir);

    for (const entry of byIdEntries) {
      const fullPath = path.join(byIdDir, entry);
      try {
        const target = await fs.realpath(fullPath);
        if (target === resolvedDevicePath) {
          result.byId = fullPath;
          break; // Found it
        }
      } catch (error) {
        // Skip entries we can't resolve
        continue;
      }
    }
  } catch (error) {
    // /dev/serial/by-id doesn't exist - not an error, just not available
  }

  // Check /dev/serial/by-path/
  try {
    const byPathDir = '/dev/serial/by-path';
    const byPathEntries = await fs.readdir(byPathDir);

    for (const entry of byPathEntries) {
      const fullPath = path.join(byPathDir, entry);
      try {
        const target = await fs.realpath(fullPath);
        if (target === resolvedDevicePath) {
          result.byPath = fullPath;
          break; // Found it
        }
      } catch (error) {
        // Skip entries we can't resolve
        continue;
      }
    }
  } catch (error) {
    // /dev/serial/by-path doesn't exist - not an error, just not available
  }

  return result;
}

/**
 * Builds a mapping of actual device paths to their persistent paths
 * by scanning /dev/serial/by-id/ and /dev/serial/by-path/
 *
 * @returns Map of resolved path -> {byId, byPath}
 */
async function buildPersistentPathMappings(): Promise<Map<string, { byId?: string; byPath?: string }>> {
  const mappings = new Map<string, { byId?: string; byPath?: string }>();

  // Process /dev/serial/by-id/
  try {
    const byIdDir = '/dev/serial/by-id';
    const byIdEntries = await fs.readdir(byIdDir);

    for (const entry of byIdEntries) {
      const fullPath = path.join(byIdDir, entry);
      try {
        const target = await fs.realpath(fullPath);
        const existing = mappings.get(target) || {};
        mappings.set(target, { ...existing, byId: fullPath });
      } catch (error) {
        // Skip entries we can't resolve
        continue;
      }
    }
  } catch (error) {
    // Directory doesn't exist - not an error
  }

  // Process /dev/serial/by-path/
  try {
    const byPathDir = '/dev/serial/by-path';
    const byPathEntries = await fs.readdir(byPathDir);

    for (const entry of byPathEntries) {
      const fullPath = path.join(byPathDir, entry);
      try {
        const target = await fs.realpath(fullPath);
        const existing = mappings.get(target) || {};
        mappings.set(target, { ...existing, byPath: fullPath });
      } catch (error) {
        // Skip entries we can't resolve
        continue;
      }
    }
  } catch (error) {
    // Directory doesn't exist - not an error
  }

  return mappings;
}
