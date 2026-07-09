/**
 * Drive-status helpers shared across routes, MCP tools, and services.
 */

import * as path from 'path';
import { Dependencies } from '../types';
import { MAX_DRIVES } from '../protocol';

/**
 * Check whether a disk image file is currently mounted on any drive.
 * Returns the drive number if mounted, or false if not.
 */
export function isDiskMounted(deps: Dependencies, filename: string): number | false {
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
