/** Typed REST API client wrapping fetch. */

import type {
  ServerStatus,
  DiskImageInfo,
  CassetteInfo,
  ScriptInfo,
  SerialPortInfo,
  CpmFileInfo,
  ConfigDoc,
  ConfigStatus,
  SerialSection,
  WebSection,
  McpSection,
  TerminalSection,
  LoggingSection,
  DataSection,
  GpioSection,
} from '$lib/types/api';

// -----------------------------------------------------------------------
// API key storage
// -----------------------------------------------------------------------
// When the daemon's runtime config has `apiKey` set, every /api/* call
// needs `Authorization: Bearer <key>` or the auth middleware returns
// 401. We stash the key in localStorage the moment the user saves it
// through the UI (`saveWeb` → `setStoredApiKey`) so the browser can
// continue to reach the backend across restarts / reloads. If the key
// stops working (401) the caller clears it; the user then has to
// re-enter it in the Web & API section.

const API_KEY_STORAGE_KEY = 'fdc.apiKey';

export function getStoredApiKey(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(API_KEY_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredApiKey(key: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (key) window.localStorage.setItem(API_KEY_STORAGE_KEY, key);
    else window.localStorage.removeItem(API_KEY_STORAGE_KEY);
  } catch {
    /* localStorage disabled — nothing we can do */
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  // Spread options first, then set headers last — otherwise a caller
  // that passes `headers: { 'If-Match': ... }` silently drops the
  // default Content-Type: application/json, Express's express.json()
  // middleware refuses to parse the body, and every section PUT
  // ships an empty {} to disk.
  const apiKey = getStoredApiKey();
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...options?.headers,
    },
  });
  if (res.status === 401 || res.status === 403) {
    // Stored key is missing or stale — clear it so the user isn't
    // stuck with a broken token silently attached to every request.
    // The Config page shows "not set" and prompts them to re-enter.
    setStoredApiKey(null);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

// Health & Status
export const api = {
  getStatus: () => request<ServerStatus>('/api/status'),

  // Serial
  listSerialPorts: () => request<{ ports: SerialPortInfo[] }>('/api/serial/ports'),
  configureSerial: (device: string, baudRate: number) =>
    request('/api/serial/config', {
      method: 'PUT',
      body: JSON.stringify({ device, baudRate }),
    }),

  // Disk serving
  enableDiskServing: () => request('/api/disk-serving/enable', { method: 'POST' }),
  disableDiskServing: () => request('/api/disk-serving/disable', { method: 'POST' }),

  // Drives
  listDrives: () => request<any[]>('/api/drives'),
  mountDrive: (id: number, filename: string) =>
    request(`/api/drives/${id}/mount`, {
      method: 'POST',
      body: JSON.stringify({ filename }),
    }),
  unmountDrive: (id: number) =>
    request(`/api/drives/${id}/unmount`, { method: 'POST' }),
  setReadonly: (id: number, readonly: boolean) =>
    request(`/api/drives/${id}/readonly`, {
      method: 'PUT',
      body: JSON.stringify({ readonly }),
    }),

  // Disk images
  listImages: () => request<{ images: string[] }>('/api/images'),
  listImagesDetailed: () => request<{ images: DiskImageInfo[] }>('/api/images/details'),
  uploadImage: (file: File) => {
    const form = new FormData();
    form.append('diskImage', file);
    return fetch('/api/images/upload', { method: 'POST', body: form }).then(r => r.json());
  },
  cloneImage: (filename: string) =>
    request(`/api/images/${encodeURIComponent(filename)}/clone`, { method: 'POST' }),
  createImage: (filename: string, format: string, extension: string) =>
    request('/api/images/create', {
      method: 'POST',
      body: JSON.stringify({ filename, format, extension }),
    }),
  deleteImage: (filename: string) =>
    request(`/api/images/${encodeURIComponent(filename)}`, { method: 'DELETE' }),
  formatImage: (filename: string, format?: string) =>
    request<{ success: boolean; filename: string; size: number; format: string }>(
      `/api/images/${encodeURIComponent(filename)}/format`,
      {
        method: 'POST',
        body: JSON.stringify(format ? { format } : {}),
      },
    ),
  updateImageNotes: (filename: string, description: string, notes: string) =>
    request(`/api/images/${encodeURIComponent(filename)}/notes`, {
      method: 'PUT',
      body: JSON.stringify({ description, notes }),
    }),
  renameImage: (filename: string, newFilename: string) =>
    request<{ success: boolean; filename: string }>(
      `/api/images/${encodeURIComponent(filename)}/rename`,
      {
        method: 'PUT',
        body: JSON.stringify({ newFilename }),
      }
    ),

  // CP/M
  getCpmInfo: (filename: string) =>
    request<{
      params: { tracks: number; sectrk: number; blocksize: number; maxdir: number; boottrk: number };
      freeSpace: {
        freeBlocks: number;
        freeBytes: number;
        totalBlocks: number;
        totalBytes: number;
        usedBlocks: number;
        usedBytes: number;
        directoryEntriesFree: number;
        directoryEntriesTotal: number;
      };
      fileCount: number;
      mounted: number | false;
    }>(`/api/images/${encodeURIComponent(filename)}/cpm/info`),
  listCpmFiles: (filename: string) =>
    request<{ files: CpmFileInfo[] }>(`/api/images/${encodeURIComponent(filename)}/cpm/files`),
  downloadCpmFile: (diskFilename: string, cpmFile: string) =>
    fetch(`/api/images/${encodeURIComponent(diskFilename)}/cpm/files/${encodeURIComponent(cpmFile)}`),
  deleteCpmFile: (diskFilename: string, cpmFile: string) =>
    request(`/api/images/${encodeURIComponent(diskFilename)}/cpm/files/${encodeURIComponent(cpmFile)}`, { method: 'DELETE' }),
  uploadCpmFile: async (diskFilename: string, file: File, cpmFilename?: string) => {
    const form = new FormData();
    form.append('file', file);
    if (cpmFilename) form.append('cpmFilename', cpmFilename);
    const res = await fetch(
      `/api/images/${encodeURIComponent(diskFilename)}/cpm/files`,
      { method: 'POST', body: form }
    );
    const body = await res.json().catch(() => ({ error: res.statusText }));
    if (!res.ok) throw new Error(body.error || res.statusText);
    return body as { success: boolean; filename: string; size: number };
  },

  // Cassettes
  listCassettes: () => request<{ cassettes: CassetteInfo[] }>('/api/cassettes/details'),
  deleteCassette: (filename: string) =>
    request(`/api/cassettes/${encodeURIComponent(filename)}`, { method: 'DELETE' }),
  updateCassetteNotes: (filename: string, description: string, notes: string) =>
    request(`/api/cassettes/${encodeURIComponent(filename)}/notes`, {
      method: 'PUT',
      body: JSON.stringify({ description, notes }),
    }),
  playCassette: (filename: string) =>
    request(`/api/cassettes/${encodeURIComponent(filename)}/play`, { method: 'POST' }),
  stopCassette: () =>
    request('/api/cassettes/stop', { method: 'POST' }),

  // Terminal
  listTerminalPorts: () => request<{ ports: SerialPortInfo[] }>('/api/terminal/ports'),
  openTerminal: (device: string, config?: any) =>
    request('/api/terminal/open', {
      method: 'POST',
      body: JSON.stringify({ device, config }),
    }),
  closeTerminal: () =>
    request('/api/terminal/close', { method: 'POST' }),
  updateTerminalConfig: (config: any) =>
    request('/api/terminal/config', {
      method: 'PUT',
      body: JSON.stringify({ config }),
    }),

  // Scripts
  listScripts: () => request<{ scripts: ScriptInfo[] }>('/api/scripts'),
  getScript: (name: string) =>
    request<{ name: string; content?: string; size: number; binary: boolean }>(
      `/api/scripts/${encodeURIComponent(name)}`
    ),
  createScript: (name: string, content: string) =>
    request('/api/scripts', {
      method: 'POST',
      body: JSON.stringify({ name, content }),
    }),
  updateScript: (name: string, content: string) =>
    request(`/api/scripts/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),
  deleteScript: (name: string) =>
    request(`/api/scripts/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  // Replay
  startReplay: (scriptName: string, mode = 'raw', options?: any) =>
    request('/api/replay/start', {
      method: 'POST',
      body: JSON.stringify({ scriptName, mode, ...options }),
    }),
  cancelReplay: () =>
    request('/api/replay/cancel', { method: 'POST' }),
  getReplayStatus: () =>
    request('/api/replay/status'),

  // Config
  getConfig: () => request<ConfigDoc>('/api/config'),
  updateConfig: (updates: any) =>
    request('/api/config', {
      method: 'POST',
      body: JSON.stringify(updates),
    }),
  getConfigStatus: () => request<ConfigStatus>('/api/config/status'),
  getConfigSchema: () => request<any>('/api/config/schema'),
  putSerialConfig: (patch: Partial<SerialSection>, ifMatch?: string) =>
    request<{ success: true; config: ConfigDoc; mtimeMs: number }>('/api/config/serial', {
      method: 'PUT',
      body: JSON.stringify(patch),
      headers: ifMatch ? { 'If-Match': ifMatch } : {},
    }),
  putWebConfig: (patch: Partial<WebSection>, ifMatch?: string) =>
    request<{ success: true; config: ConfigDoc; mtimeMs: number }>('/api/config/web', {
      method: 'PUT',
      body: JSON.stringify(patch),
      headers: ifMatch ? { 'If-Match': ifMatch } : {},
    }),
  putMcpConfig: (patch: Partial<McpSection>, ifMatch?: string) =>
    request<{ success: true; config: ConfigDoc; mtimeMs: number; restartRequired: false }>(
      '/api/config/mcp',
      {
        method: 'PUT',
        body: JSON.stringify(patch),
        headers: ifMatch ? { 'If-Match': ifMatch } : {},
      },
    ),
  putTerminalConfig: (patch: Partial<TerminalSection>, ifMatch?: string) =>
    request<{ success: true; config: ConfigDoc; mtimeMs: number }>('/api/config/terminal', {
      method: 'PUT',
      body: JSON.stringify(patch),
      headers: ifMatch ? { 'If-Match': ifMatch } : {},
    }),
  putLoggingConfig: (patch: Partial<LoggingSection>, ifMatch?: string) =>
    request<{ success: true; config: ConfigDoc; mtimeMs: number }>('/api/config/logging', {
      method: 'PUT',
      body: JSON.stringify(patch),
      headers: ifMatch ? { 'If-Match': ifMatch } : {},
    }),
  putDataConfig: (patch: Partial<DataSection>, ifMatch?: string) =>
    request<{ success: true; config: ConfigDoc; mtimeMs: number }>('/api/config/data', {
      method: 'PUT',
      body: JSON.stringify(patch),
      headers: ifMatch ? { 'If-Match': ifMatch } : {},
    }),
  putGpioConfig: (patch: { gpioLeds: GpioSection }, ifMatch?: string) =>
    request<{ success: true; config: ConfigDoc; mtimeMs: number }>('/api/config/gpio', {
      method: 'PUT',
      body: JSON.stringify(patch),
      headers: ifMatch ? { 'If-Match': ifMatch } : {},
    }),
  restartDaemon: () =>
    request<{
      success?: boolean;
      startupEpoch?: number;
      manualCommand?: string;
      systemdManaged?: boolean;
    }>('/api/config/restart?confirm=1', { method: 'POST' }),
  reloadConfig: () =>
    request<{ success: boolean; applied: string[] }>('/api/config/reload', { method: 'POST' }),
  rollbackConfig: () =>
    request<{ success: boolean; config: ConfigDoc; mtimeMs: number }>(
      '/api/config/rollback?confirm=1',
      { method: 'POST' },
    ),
};
