/** Typed REST API client wrapping fetch. */

import type {
  ServerStatus,
  DiskImageInfo,
  SnapshotInfo,
  ReadonlyWritePolicy,
  ClientBay,
  CassetteInfo,
  ScriptInfo,
  SerialPortInfo,
  CpmFileInfo,
  ConfigDoc,
  ConfigStatus,
  CatalogListing,
  CardDefinition,
  CardDetail,
  CpuInfo,
  MachineProfile,
  MachinePresetInfo,
  ProfileValidation,
  ProfileCardInstance,
  InstanceStatus,
  InstanceSnapshot,
  SerialSection,
  WebSection,
  McpSection,
  DiskServingSection,
  TerminalSection,
  LoggingSection,
  DataSection,
  GpioSection,
} from '$lib/types/api';

// -----------------------------------------------------------------------
// Auth model
// -----------------------------------------------------------------------
// UI auth is session-cookie-based: POST /api/auth/login sets an
// HttpOnly SameSite=Lax `fdcSession` cookie, and the browser attaches
// it to every subsequent request. No client-side storage; no Bearer
// header on API calls from the UI.
//
// API keys never enter the browser — they're for machine clients
// (MCP HTTP, curl scripts). ConfigPage shows apiKey as write-only:
// generate, copy once at set-time, then the field displays "currently
// set" and the plaintext is never echoed back.
//
// If a request returns 401/403 mid-session (session expired, daemon
// rotated credentials), we hard-reload — AuthGate re-renders and the
// operator logs in again. Cleaner than leaving the SPA mounted with
// every future call failing silently.

// Legacy cleanup: earlier builds stashed an API key here. Remove any
// lingering value so a stale token doesn't confuse debug sessions.
if (typeof window !== 'undefined') {
  try {
    window.localStorage.removeItem('fdc.apiKey');
  } catch {
    /* localStorage disabled — nothing we can do */
  }
}

/**
 * AuthGate populates this after its boot probe so `request()` knows
 * whether a 401 reload would achieve anything. If the daemon isn't
 * accepting logins (loginRequired: false), reloading is pointless and
 * causes a tight loop — every rehydrated page instantly refires the
 * same failing API calls.
 */
let cachedLoginRequired: boolean | null = null;
export function setLoginRequired(value: boolean): void {
  cachedLoginRequired = value;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  // credentials: 'include' — required so the session cookie flows on
  // same-origin XHR / fetch, including CORS-preflighted verbs. Without
  // this, PUT/DELETE from an origin that differs from Host header
  // silently sheds cookies and every save 401s.
  //
  // Spread options first, then set headers last — otherwise a caller
  // that passes `headers: { 'If-Match': ... }` silently drops the
  // default Content-Type: application/json, Express's express.json()
  // middleware refuses to parse the body, and every section PUT
  // ships an empty {} to disk.
  const res = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (res.status === 401 || res.status === 403) {
    // Only trigger the reload-to-AuthGate flow when the daemon
    // actually accepts logins. Without a login endpoint there's
    // nothing a reload can recover from — every reload just refires
    // the same failing requests and hits the /api/* rate limiter.
    // Also skip on the probe/login endpoints themselves so an
    // inline wrong-password error doesn't infinite-loop.
    if (
      typeof window !== 'undefined' &&
      cachedLoginRequired === true &&
      !url.includes('/api/auth/info') &&
      !url.includes('/api/auth/login')
    ) {
      setTimeout(() => window.location.reload(), 0);
    }
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

// Health & Status
export const api = {
  // Auth
  getAuthInfo: () =>
    request<{ loginRequired: boolean; apiKeyRequired: boolean; authRequired: boolean }>(
      '/api/auth/info',
    ),
  login: (password: string) =>
    request<{ success: true }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  logout: () =>
    request<{ success: true }>('/api/auth/logout', { method: 'POST' }),
  changePassword: (oldPassword: string, newPassword: string) =>
    request<{ success: true }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
    }),

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

  // Snapshots
  listSnapshots: (filename: string) =>
    request<{ snapshots: SnapshotInfo[] }>(
      `/api/images/${encodeURIComponent(filename)}/snapshots`,
    ),
  createSnapshot: (filename: string, label?: string) =>
    request<{ success: boolean; snapshot: SnapshotInfo }>(
      `/api/images/${encodeURIComponent(filename)}/snapshots`,
      {
        method: 'POST',
        body: JSON.stringify({ label: label ?? '' }),
      },
    ),
  restoreSnapshot: (filename: string, id: string) =>
    request(
      `/api/images/${encodeURIComponent(filename)}/snapshots/${encodeURIComponent(id)}/restore`,
      { method: 'POST' },
    ),
  deleteSnapshot: (filename: string, id: string) =>
    request(
      `/api/images/${encodeURIComponent(filename)}/snapshots/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    ),

  // Read-only-write policy (transient copy-on-write)
  getDiskPolicy: (filename: string) =>
    request<{ filename: string; onReadonlyWrite: ReadonlyWritePolicy }>(
      `/api/images/${encodeURIComponent(filename)}/policy`,
    ),
  setDiskPolicy: (filename: string, onReadonlyWrite: ReadonlyWritePolicy) =>
    request(`/api/images/${encodeURIComponent(filename)}/policy`, {
      method: 'PUT',
      body: JSON.stringify({ onReadonlyWrite }),
    }),
  // Runtime feature settings (DB-backed, live)
  getSettings: () => request<{ multiClientServing: boolean; writeMaster: string }>('/api/settings'),
  putSettings: (patch: { multiClientServing?: boolean; writeMaster?: string }) =>
    request<{ success: boolean; multiClientServing: boolean; writeMaster: string }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  // Per-client drive bays
  getClients: () =>
    request<{ clients: ClientBay[]; anonymous: { id: string; connectedAt: number }[] }>('/api/clients'),
  setClientName: (clientId: string, name: string) =>
    request(`/api/clients/${encodeURIComponent(clientId)}/name`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    }),
  setClientDrive: (clientId: string, drive: number, filename: string, readonly: boolean) =>
    request(`/api/clients/${encodeURIComponent(clientId)}/drives/${drive}`, {
      method: 'PUT',
      body: JSON.stringify({ filename, readonly }),
    }),
  clearClientDrive: (clientId: string, drive: number) =>
    request(`/api/clients/${encodeURIComponent(clientId)}/drives/${drive}`, { method: 'DELETE' }),
  forgetClient: (clientId: string) =>
    request(`/api/clients/${encodeURIComponent(clientId)}`, { method: 'DELETE' }),
  commitClientSplinter: (clientId: string, drive: number) =>
    request<{ success: boolean; clientId: string; drive: number; filename: string; hotSwapped: boolean; reloadedDrives: number[] }>(
      `/api/clients/${encodeURIComponent(clientId)}/drives/${drive}/splinter/commit`,
      { method: 'POST' },
    ),
  saveClientSplinterSnapshot: (clientId: string, drive: number, label?: string) =>
    request<{ success: boolean; snapshot: SnapshotInfo }>(
      `/api/clients/${encodeURIComponent(clientId)}/drives/${drive}/splinter/save-snapshot`,
      { method: 'POST', body: JSON.stringify({ label: label ?? '' }) },
    ),
  saveClientSplinterAsDisk: (clientId: string, drive: number, name: string) =>
    request<{ success: boolean; filename: string }>(
      `/api/clients/${encodeURIComponent(clientId)}/drives/${drive}/splinter/save-as-disk`,
      { method: 'POST', body: JSON.stringify({ name }) },
    ),
  commitTransient: (driveId: number) =>
    request(`/api/drives/${driveId}/transient/commit`, { method: 'POST' }),
  saveTransientSnapshot: (driveId: number, label?: string) =>
    request<{ success: boolean; snapshot: SnapshotInfo }>(
      `/api/drives/${driveId}/transient/save-snapshot`,
      { method: 'POST', body: JSON.stringify({ label: label ?? '' }) },
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
  // Reveal the current plaintext API key for copy-out. Auth-gated like
  // every /api/* route; the key is stored plaintext (unlike the bcrypt
  // adminPassword hash), so it can be read back on demand.
  getApiKey: () => request<{ apiKey: string | null }>('/api/config/web/apikey'),
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
  putDiskServingConfig: (patch: Partial<DiskServingSection>, ifMatch?: string) =>
    request<{ success: true; config: ConfigDoc; mtimeMs: number; restartRequired: false }>(
      '/api/config/disk-serving',
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
  shutdownDaemon: () =>
    request<{
      success?: boolean;
      message?: string;
      manualCommand?: string;
      systemdManaged?: boolean;
    }>('/api/config/shutdown?confirm=1', { method: 'POST' }),
  reloadConfig: () =>
    request<{ success: boolean; applied: string[] }>('/api/config/reload', { method: 'POST' }),
  rollbackConfig: () =>
    request<{ success: boolean; config: ConfigDoc; mtimeMs: number }>(
      '/api/config/rollback?confirm=1',
      { method: 'POST' },
    ),

  // Catalog (Bitsby8) — browse Card Definitions with optional facet filters.
  browseCatalog: (filter: { type?: string; maker?: string; capability?: string; q?: string } = {}) => {
    const qs = new URLSearchParams();
    if (filter.type) qs.set('type', filter.type);
    if (filter.maker) qs.set('maker', filter.maker);
    if (filter.capability) qs.set('capability', filter.capability);
    if (filter.q) qs.set('q', filter.q);
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<CatalogListing>(`/api/catalog/cards${suffix}`);
  },
  getCardDetail: (id: string) =>
    request<CardDetail>(`/api/catalog/cards/${encodeURIComponent(id)}/detail`),
  listCpus: () => request<{ cpus: CpuInfo[] }>('/api/catalog/cpus'),
  listCardKernels: () =>
    request<{ kernels: { id: string; label: string; type: string; binding?: string; configSchema: Record<string, { type: string; default?: number | string; min?: number; max?: number; enum?: (number | string)[]; description?: string }> }[] }>(
      '/api/catalog/kernels',
    ),
  authorCard: (body: {
    name: string;
    version?: string;
    maker?: string;
    summary?: string;
    behavior: { resolvesTo: 'memory'; memKind: 'ram' | 'rom' } | { resolvesTo: 'cpu'; cpuKind: 'i8080' | 'z80' };
    defaults?: { base?: number; size?: number; resetVector?: number };
  }) => request<CardDefinition>('/api/catalog/cards', { method: 'POST', body: JSON.stringify(body) }),
  deleteCard: (id: string) =>
    request<{ deleted: true }>(`/api/catalog/cards/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Machine Profiles (Bitsby8) — versioned declarative machines.
  listProfiles: () => request<{ profiles: MachineProfile[] }>('/api/profiles'),
  getProfile: (id: string) =>
    request<{ profile: MachineProfile }>(`/api/profiles/${encodeURIComponent(id)}`),
  listProfileVersions: (name: string) =>
    request<{ versions: MachineProfile[] }>(`/api/profiles/${encodeURIComponent(name)}/versions`),
  createProfile: (body: Record<string, unknown>) =>
    request<{ profile: MachineProfile }>('/api/profiles', { method: 'POST', body: JSON.stringify(body) }),
  updateProfile: (id: string, patch: Record<string, unknown>) =>
    request<{ profile: MachineProfile }>(`/api/profiles/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  cloneProfile: (id: string, name: string) =>
    request<{ profile: MachineProfile }>(`/api/profiles/${encodeURIComponent(id)}/clone`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  deleteProfile: (id: string) =>
    request(`/api/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  exportProfile: (id: string) =>
    request<Record<string, unknown>>(`/api/profiles/${encodeURIComponent(id)}/export`),
  importProfileBundle: (bundle: unknown, name?: string) =>
    request<{ profile: MachineProfile; cards: unknown[]; warnings: string[] }>('/api/profiles/import', {
      method: 'POST',
      body: JSON.stringify({ bundle, name }),
    }),
  burnEprom: (
    id: string,
    cardId: string,
    body: { image: string; addressing: 'file' | 'base'; format?: 'bin' | 'ihex'; filename?: string },
  ) =>
    request<{ profile: MachineProfile; summary: string; region: { id: string; base: number; size: number } }>(
      `/api/profiles/${encodeURIComponent(id)}/cards/${encodeURIComponent(cardId)}/burn`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  eraseEprom: (id: string, cardId: string) =>
    request<{ profile: MachineProfile; erased: boolean }>(
      `/api/profiles/${encodeURIComponent(id)}/cards/${encodeURIComponent(cardId)}/rom`,
      { method: 'DELETE' },
    ),

  validateProfileBody: (body: { memory?: unknown[]; cards?: unknown[] }) =>
    request<ProfileValidation>('/api/profiles/validate', { method: 'POST', body: JSON.stringify(body) }),
  autoAssignProfile: (body: { memory?: unknown[]; cards?: unknown[] }) =>
    request<{ content: { cards: ProfileCardInstance[] }; unresolved: string[]; changes: unknown[] }>(
      '/api/profiles/auto-assign',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  // Machine Instances (Bitsby8) — the Machines dashboard.
  listInstances: () => request<{ instances: InstanceStatus[] }>('/api/instances'),
  getInstance: (id: string) =>
    request<{ instance: InstanceStatus }>(`/api/instances/${encodeURIComponent(id)}`),
  startInstance: (id: string) =>
    request<{ instance: InstanceStatus }>(`/api/instances/${encodeURIComponent(id)}/start`, { method: 'POST' }),
  stopInstance: (id: string) =>
    request<{ instance: InstanceStatus }>(`/api/instances/${encodeURIComponent(id)}/stop`, { method: 'POST' }),
  setInstanceSpeed: (id: string, speed: number | 'max') =>
    request<{ instance: InstanceStatus }>(`/api/instances/${encodeURIComponent(id)}/speed`, {
      method: 'POST',
      body: JSON.stringify({ speed }),
    }),
  destroyInstance: (id: string) =>
    request(`/api/instances/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  listInstanceSnapshots: (id: string) =>
    request<{ snapshots: InstanceSnapshot[] }>(`/api/instances/${encodeURIComponent(id)}/snapshots`),
  snapshotInstance: (id: string, label?: string) =>
    request<{ snapshot: InstanceSnapshot }>(`/api/instances/${encodeURIComponent(id)}/snapshots`, {
      method: 'POST',
      body: JSON.stringify({ label }),
    }),
  listInstanceGpio: (id: string) =>
    request<{ ports: { cardId: string; direction: 'out' | 'in' | 'inout'; output: number }[] }>(
      `/api/instances/${encodeURIComponent(id)}/gpio`,
    ),
  setInstanceGpioInput: (id: string, cardId: string, value: number) =>
    request<{ cardId: string; input: number }>(
      `/api/instances/${encodeURIComponent(id)}/gpio/${encodeURIComponent(cardId)}/input`,
      { method: 'POST', body: JSON.stringify({ value }) },
    ),
  restoreInstanceSnapshot: (snapshotId: string) =>
    request<{ instanceId: string; restored: number[] }>(
      `/api/instance-snapshots/${encodeURIComponent(snapshotId)}/restore`,
      { method: 'POST' },
    ),
  deleteInstanceSnapshot: (snapshotId: string) =>
    request(`/api/instance-snapshots/${encodeURIComponent(snapshotId)}`, { method: 'DELETE' }),

  listMachinePresets: () => request<{ presets: MachinePresetInfo[] }>('/api/instances/presets'),
  launchTransient: (profileRef: string, speed?: number | 'max') =>
    request<{ instance: { id: string } }>('/api/instances/transient', {
      method: 'POST',
      body: JSON.stringify({ profileRef, speed }),
    }),
};
