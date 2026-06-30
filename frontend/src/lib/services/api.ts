/** Typed REST API client wrapping fetch. */

import type {
  ServerStatus,
  DiskImageInfo,
  CassetteInfo,
  ScriptInfo,
  SerialPortInfo,
  CpmFileInfo,
} from '$lib/types/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
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
  getConfig: () => request<any>('/api/config'),
  updateConfig: (updates: any) =>
    request('/api/config', {
      method: 'POST',
      body: JSON.stringify(updates),
    }),
};
