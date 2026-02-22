/**
 * CLI configuration manager.
 * Persists settings to ~/.fdcplus/config.json.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CliConfig } from './types/index';

export const CONFIG_DIR = path.join(os.homedir(), '.fdcplus');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULTS: CliConfig = {
  defaultServer: 'http://localhost:3000',
  servers: {},
};

export function load(): CliConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return { ...DEFAULTS, ...JSON.parse(raw) };
    }
  } catch {
    // Corrupted or unreadable config -- fall back to defaults
  }
  return { ...DEFAULTS };
}

export function save(config: CliConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/**
 * Resolve the server URL to use.
 * Priority: CLI argument > FDC_SERVER env var > config.defaultServer > fallback.
 */
export function getServerUrl(cliArg?: string): string {
  if (cliArg) return cliArg;

  const envUrl = process.env.FDC_SERVER;
  if (envUrl) return envUrl;

  const config = load();
  return config.defaultServer || 'http://localhost:3000';
}
