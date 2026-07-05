import * as path from 'path';
import { Dependencies } from '../types';
import { compareSemver, getLatestRelease } from './release-check';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json') as { version: string };

// build-info.json is written by the Makefile before `pnpm run build` runs.
// It carries the git-derived Debian revision, commit sha, and build time
// so /api/status can report what's actually running. Not committed to git;
// absent in dev builds where the Makefile hasn't run — hence the fallback.
interface BuildInfo {
  version: string;   // "2.0.0-149+g76c38eb.dirty.1783199368" (full Debian version)
  upstream: string;  // "2.0.0" (base semver)
  revision: string;  // "149+g76c38eb.dirty.1783199368" (Debian revision only)
  commit: string;    // "76c38eb"
  dirty: boolean;
  builtAt: string;   // ISO-8601 UTC, e.g. "2026-07-04T21:16:33Z"
}

let buildInfo: BuildInfo | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  buildInfo = require('../../build-info.json') as BuildInfo;
} catch {
  // Missing in dev — fine, we fall back to package.json values below.
  buildInfo = null;
}

export function getStatus(deps: Dependencies) {
  return {
    serial: {
      connected: deps.serialManager.isOpen(),
      device: deps.serialManager.getDevice(),
      baudRate: deps.serialManager.getBaudRate(),
      configuredPort: deps.runtimeConfig?.port || deps.serialManager.getDevice(),
      configuredBaudRate: deps.runtimeConfig?.baud || deps.serialManager.getBaudRate(),
    },
    diskServing: {
      enabled: deps.diskServingEnabled,
      running: deps.server !== null && deps.serverTask !== null,
    },
    drives: getDrivesStatus(deps),
    system: {
      version: buildInfo?.upstream ?? pkg.version,
      build: buildInfo?.revision ?? null,
      commit: buildInfo?.commit ?? null,
      dirty: buildInfo?.dirty ?? false,
      builtAt: buildInfo?.builtAt ?? null,
      uptimeSeconds: Math.floor(process.uptime()),
      ...getUpdateStatus(buildInfo?.upstream ?? pkg.version),
    },
    timestamp: new Date().toISOString(),
  };
}

interface UpdateStatus {
  latestVersion: string | null;
  latestUrl: string | null;
  updateAvailable: boolean;
  updateCheckedAt: string | null;
}

function getUpdateStatus(runningVersion: string): UpdateStatus {
  const latest = getLatestRelease();
  if (!latest) {
    return { latestVersion: null, latestUrl: null, updateAvailable: false, updateCheckedAt: null };
  }
  return {
    latestVersion: latest.version,
    latestUrl: latest.htmlUrl,
    updateAvailable: compareSemver(latest.version, runningVersion) > 0,
    updateCheckedAt: latest.checkedAt,
  };
}

export function getDrivesStatus(deps: Dependencies) {
  const drives: any[] = [];
  for (let i = 0; i < 4; i++) {
    const state = deps.driveManager.getDriveState(i);
    if (state) {
      drives.push({
        id: i,
        mounted: state.mounted,
        filename: state.filename ? path.basename(state.filename) : null,
        fullPath: state.filename,
        readonly: state.readonly,
        headLoaded: state.hdld,
        track: state.track,
        lastIo: state.lastIo,
      });
    }
  }
  return drives;
}

export function getTerminalStatus(deps: Dependencies) {
  return {
    connected: deps.terminalManager.isOpen(),
    device: deps.terminalManager.getDevice(),
    config: deps.terminalManager.getConfig(),
    preferred: deps.preferredTerminalSettings,
  };
}
