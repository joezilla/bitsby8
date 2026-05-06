import * as path from 'path';
import { Dependencies } from '../types';

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
    timestamp: new Date().toISOString(),
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
