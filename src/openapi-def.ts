/**
 * OpenAPI 3.0 base definition for FDC+ Serial Drive Server
 */

import type { Options } from 'swagger-jsdoc';
import * as path from 'path';

export const openapiDefinition: Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'FDC+ Serial Drive Server API',
      version: '2.0.0',
      description:
        'REST API for the Altair 8800 FDC+ Serial Drive Server web interface. ' +
        'Manages disk image serving, CP/M filesystem browsing, cassette audio, ' +
        'terminal serial connections, script replay, and XMODEM transfers.\n\n' +
        '## Socket.IO Events\n\n' +
        'The server also exposes real-time events via Socket.IO (not covered by OpenAPI).\n\n' +
        '### Server → Client\n\n' +
        '| Event | Payload | Description |\n' +
        '|-------|---------|-------------|\n' +
        '| `status` | `ServerStatus` | Periodic server status broadcast (1s interval) |\n' +
        '| `terminal:data` | `number[]` | Incoming serial data as byte array |\n' +
        '| `terminal:status` | `TerminalStatus` | Terminal connection status change |\n' +
        '| `terminal:error` | `{message: string}` | Terminal error |\n' +
        '| `replay:progress` | `ReplayProgress` | Transfer progress update |\n' +
        '| `replay:status` | `{active, mode, progress}` | Transfer status on connect |\n\n' +
        '### Client → Server\n\n' +
        '| Event | Payload | Description |\n' +
        '|-------|---------|-------------|\n' +
        '| `request-status` | _(none)_ | Request current server status |\n' +
        '| `terminal:write` | `string` | Send keyboard input to terminal serial port |\n' +
        '| `terminal:control` | `{type, value}` | Set DTR/RTS control signals |\n' +
        '| `replay:start` | `ReplayStartParams` | Start raw replay or XMODEM send |\n' +
        '| `replay:cancel` | _(none)_ | Cancel active transfer |',
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Local development server',
      },
    ],
    tags: [
      { name: 'Health', description: 'Health check and server status' },
      { name: 'Config', description: 'Runtime configuration' },
      { name: 'Serial', description: 'Primary serial port management' },
      { name: 'Disk Serving', description: 'Enable/disable FDC disk serving' },
      { name: 'Drives', description: 'Drive mount/unmount and status' },
      { name: 'Images', description: 'Disk image management' },
      { name: 'Snapshots', description: 'Point-in-time disk image snapshots and rollback' },
      { name: 'Settings', description: 'Operator-facing runtime feature settings (DB-backed, live)' },
      { name: 'Clients', description: 'Per-client drive-bay overrides and friendly names (multi-client serving)' },
      { name: 'Instances', description: 'Virtual S-100 Machine Instances — lifecycle + console I/O (Bitsby8)' },
      { name: 'CP/M', description: 'CP/M filesystem browser' },
      { name: 'Cassettes', description: 'Cassette audio management' },
      { name: 'Terminal', description: 'Terminal serial port management' },
      { name: 'Scripts', description: 'Script file management' },
      { name: 'Replay', description: 'Raw replay and XMODEM transfer' },
    ],
    components: {
      schemas: {
        ErrorResponse: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Something went wrong' },
          },
          required: ['error'],
        },
        DriveState: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 0 },
            mounted: { type: 'boolean' },
            filename: { type: 'string', nullable: true, example: 'cpm63k.dsk' },
            fullPath: { type: 'string', nullable: true },
            readonly: { type: 'boolean' },
            headLoaded: { type: 'boolean' },
            track: { type: 'integer', example: 0 },
            lastIo: {
              type: 'integer',
              nullable: true,
              description: 'Epoch ms of most recent successful read/write; null if no I/O yet.',
            },
            transient: {
              type: 'boolean',
              description: 'Read-only image backed by a copy-on-write scratch; writes go to the scratch and the master stays pristine.',
            },
            dirty: {
              type: 'boolean',
              description: 'A transient-backed drive that has received at least one write since mount.',
            },
          },
        },
        CardDefinition: {
          type: 'object',
          description: 'A Catalog Card Definition (Bitsby8) — a versioned Primitive identified by name@version + digest.',
          properties: {
            id: { type: 'string', example: 'mits-88-2sio@1.0.0', description: 'Identity: name@version.' },
            name: { type: 'string', example: 'mits-88-2sio' },
            version: { type: 'string', example: '1.0.0' },
            digest: { type: 'string', example: 'sha256:…', description: 'Content digest (basic sha256; full rule in a later release).' },
            type: { type: 'string', example: 'serial' },
            maker: { type: 'string', nullable: true, example: 'MITS' },
            summary: { type: 'string', nullable: true },
            capabilities: {
              type: 'array',
              items: { type: 'string' },
              example: ['serial-io'],
              description: 'Derived capability tags (from the manifest) — a browse/filter facet.',
            },
            manifest: { type: 'object', description: 'The CardManifest (config schema, etc.).', additionalProperties: true },
            entry: { type: 'string', nullable: true, description: 'Reference to the pre-built behavior module.' },
            source: { type: 'string', example: 'seed', description: "Provenance: 'seed' | 'imported' | 'signed'." },
            createdAt: { type: 'string' },
          },
        },
        CardDetail: {
          type: 'object',
          description: "A card's datasheet (Bitsby8) — definition + footprint + Skills file + versions + used-by.",
          properties: {
            card: { $ref: '#/components/schemas/CardDefinition' },
            footprint: {
              type: 'object',
              nullable: true,
              description: 'Default bus footprint (null if not derivable).',
              properties: {
                ports: { type: 'array', items: { type: 'integer' }, example: [16, 17, 18, 19] },
                irq: { type: 'integer', nullable: true },
              },
            },
            skills: { type: 'string', description: 'Generated Skills file (human- and agent-readable markdown).' },
            versions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  version: { type: 'string' },
                  digest: { type: 'string' },
                  source: { type: 'string' },
                  createdAt: { type: 'string' },
                },
              },
            },
            usedBy: {
              type: 'array',
              items: { type: 'string' },
              description: 'Machine Profiles referencing this card (populated once Profiles exist).',
            },
          },
        },
        MachineInstance: {
          type: 'object',
          description: 'A virtual S-100 Machine Instance (Bitsby8) — a running or defined emulated machine.',
          properties: {
            id: { type: 'string', description: 'Instance id (uuid).' },
            clientId: { type: 'string', example: 'inst:…', description: 'Reserved FDC serving clientId (inst:<uuid>).' },
            profileRef: { type: 'string', example: 'preset:imsai-cpm', description: 'Where the profile came from (preset:<id> | inline).' },
            transient: { type: 'boolean', description: 'Memory-only; leaves no DB/splinter residue on destroy.' },
            status: { type: 'string', enum: ['defined', 'running', 'stopped'] },
            driver: { type: 'string', enum: ['operator', 'api', 'mcp'], description: 'Provenance — who drove it into existence.' },
            cpuKind: { type: 'string', example: 'i8080' },
            effectiveHz: { type: 'number', nullable: true },
            targetHz: { oneOf: [{ type: 'number' }, { type: 'string', enum: ['max'] }], nullable: true },
          },
        },
        InstanceCreateRequest: {
          type: 'object',
          description: 'Create a Machine Instance from a preset id or an inline MachineProfile (exactly one).',
          properties: {
            preset: { type: 'string', example: 'imsai-cpm', description: 'Built-in preset id (see GET /api/instances/presets).' },
            profile: { type: 'object', additionalProperties: true, description: 'Inline MachineProfile (cpuKind, clock, resetVector, memory[], cards[], consoleCardId).' },
          },
        },
        SystemInfo: {
          type: 'object',
          properties: {
            version: { type: 'string', example: '2.0.0', description: 'Upstream semver (from package.json).' },
            build: { type: 'string', nullable: true, example: '149+g76c38eb', description: 'Debian revision derived at build time from git; null in dev builds.' },
            commit: { type: 'string', nullable: true, example: '76c38eb', description: 'Short SHA of HEAD when the .deb was built; null in dev builds.' },
            dirty: { type: 'boolean', example: false, description: 'True when the working tree had uncommitted changes at build time.' },
            builtAt: { type: 'string', format: 'date-time', nullable: true, example: '2026-07-04T21:16:33Z', description: 'ISO-8601 UTC build timestamp; null in dev builds.' },
            uptimeSeconds: { type: 'integer', example: 3600 },
          },
        },
        DiskImageInfo: {
          type: 'object',
          properties: {
            name: { type: 'string', example: 'cpm63k.dsk' },
            size: { type: 'integer', example: 337568 },
            description: { type: 'string' },
            notes: { type: 'string' },
          },
        },
        Snapshot: {
          type: 'object',
          properties: {
            id: { type: 'string', example: '9f8c1a2b3d4e5f60718293a4b5c6d7e8' },
            disk_filename: { type: 'string', example: 'cpm63k.dsk' },
            label: { type: 'string', example: 'before format' },
            size_bytes: { type: 'integer', example: 337568 },
            created_at: { type: 'string', example: '2026-07-09 14:03:11' },
          },
        },
        CpmFileInfo: {
          type: 'object',
          properties: {
            user: { type: 'integer', example: 0 },
            filename: { type: 'string', example: 'ASM     ' },
            extension: { type: 'string', example: 'COM' },
            size: { type: 'integer', example: 8192 },
            readonly: { type: 'boolean' },
            system: { type: 'boolean' },
            extents: { type: 'integer', example: 1 },
          },
        },
        ReplayProgress: {
          type: 'object',
          properties: {
            state: { type: 'string', enum: ['sending', 'completed', 'cancelled', 'error'] },
            bytesSent: { type: 'integer' },
            totalBytes: { type: 'integer' },
            percentComplete: { type: 'number' },
            fileName: { type: 'string' },
            error: { type: 'string' },
          },
        },
        SerialPortInfo: {
          type: 'object',
          properties: {
            path: { type: 'string', example: '/dev/ttyUSB0' },
            resolvedPath: { type: 'string' },
            persistentPaths: {
              type: 'object',
              properties: {
                byId: { type: 'string', nullable: true },
                byPath: { type: 'string', nullable: true },
              },
            },
            manufacturer: { type: 'string' },
            serialNumber: { type: 'string' },
            pnpId: { type: 'string' },
            vendorId: { type: 'string' },
            productId: { type: 'string' },
            recommended: { type: 'string' },
          },
        },
        CassetteInfo: {
          type: 'object',
          properties: {
            name: { type: 'string', example: 'killthebits.wav' },
            size: { type: 'integer' },
            description: { type: 'string' },
            notes: { type: 'string' },
          },
        },
        ScriptInfo: {
          type: 'object',
          properties: {
            name: { type: 'string', example: 'hello.txt' },
            size: { type: 'integer' },
          },
        },
      },
    },
  },
  apis: [
    path.resolve(__dirname, 'web-server.{ts,js}'),
    path.resolve(__dirname, 'routes/*.{ts,js}'),
  ],
};
