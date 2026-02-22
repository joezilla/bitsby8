/**
 * FDC+ REST + Socket.IO client.
 * Wraps every server endpoint for use by CLI commands.
 */

import { io, Socket } from 'socket.io-client';
import {
  ServerStatus,
  ServerConfig,
  SerialPortInfo,
  DriveStatus,
  DiskImage,
  CpmDiskInfo,
  CpmFileInfo,
  CassetteInfo,
  ScriptInfo,
  ScriptContent,
  TerminalStatus,
  TerminalConfig,
  ReplayProgress,
  ReplayOptions,
} from './types/index';

export class FdcClient {
  private serverUrl: string;
  private socket: Socket | null = null;

  constructor(serverUrl: string) {
    // Strip trailing slash
    this.serverUrl = serverUrl.replace(/\/+$/, '');
  }

  // --------------- Socket.IO ---------------

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = io(this.serverUrl, { reconnection: true });

      const onConnect = (): void => {
        cleanup();
        resolve();
      };
      const onError = (err: Error): void => {
        cleanup();
        reject(err);
      };
      const cleanup = (): void => {
        this.socket?.off('connect', onConnect);
        this.socket?.off('connect_error', onError);
      };

      this.socket.on('connect', onConnect);
      this.socket.on('connect_error', onError);
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  // --- event subscriptions ---

  onStatus(cb: (status: ServerStatus) => void): void {
    this.socket?.on('status', cb);
  }

  onTerminalData(cb: (data: number[]) => void): void {
    this.socket?.on('terminal:data', cb);
  }

  onTerminalStatus(cb: (status: TerminalStatus) => void): void {
    this.socket?.on('terminal:status', cb);
  }

  onReplayProgress(cb: (progress: ReplayProgress) => void): void {
    this.socket?.on('replay:progress', cb);
  }

  onDisconnect(cb: (reason: string) => void): void {
    this.socket?.on('disconnect', cb);
  }

  onConnect(cb: () => void): void {
    this.socket?.on('connect', cb);
  }

  // --- socket emitters ---

  terminalWrite(data: string): void {
    this.socket?.emit('terminal:write', data);
  }

  terminalControl(type: 'dtr' | 'rts', value: boolean): void {
    this.socket?.emit('terminal:control', { type, value });
  }

  requestStatus(): void {
    this.socket?.emit('request-status');
  }

  startReplay(options: ReplayOptions): void {
    this.socket?.emit('replay:start', options);
  }

  cancelReplay(): void {
    this.socket?.emit('replay:cancel');
  }

  // --------------- REST helpers ---------------

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.serverUrl}${path}`;
    const headers: Record<string, string> = {};
    let reqBody: string | undefined;

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      reqBody = JSON.stringify(body);
    }

    const res = await fetch(url, { method, headers, body: reqBody });

    if (!res.ok) {
      const text = await res.text();
      let message: string;
      try {
        message = JSON.parse(text).error || text;
      } catch {
        message = text;
      }
      throw new Error(`${method} ${path} failed (${res.status}): ${message}`);
    }

    return res.json() as Promise<T>;
  }

  private async requestRaw(
    method: string,
    path: string,
  ): Promise<Buffer> {
    const url = `${this.serverUrl}${path}`;
    const res = await fetch(url, { method });

    if (!res.ok) {
      const text = await res.text();
      let message: string;
      try {
        message = JSON.parse(text).error || text;
      } catch {
        message = text;
      }
      throw new Error(`${method} ${path} failed (${res.status}): ${message}`);
    }

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  private async upload<T>(
    path: string,
    fieldName: string,
    filePath: string,
    fileName: string,
  ): Promise<T> {
    const fs = await import('fs');
    const fileBuffer = fs.readFileSync(filePath);
    const blob = new Blob([fileBuffer]);

    const form = new FormData();
    form.append(fieldName, blob, fileName);

    const url = `${this.serverUrl}${path}`;
    const res = await fetch(url, { method: 'POST', body: form });

    if (!res.ok) {
      const text = await res.text();
      let message: string;
      try {
        message = JSON.parse(text).error || text;
      } catch {
        message = text;
      }
      throw new Error(`POST ${path} failed (${res.status}): ${message}`);
    }

    return res.json() as Promise<T>;
  }

  // --------------- Health / Status / Config ---------------

  async health(): Promise<{ status: string; timestamp: string }> {
    return this.request('GET', '/api/health');
  }

  async status(): Promise<ServerStatus> {
    return this.request('GET', '/api/status');
  }

  async getConfig(): Promise<ServerConfig> {
    return this.request('GET', '/api/config');
  }

  async setConfig(config: Partial<ServerConfig>): Promise<{ success: boolean; message: string }> {
    return this.request('POST', '/api/config', config);
  }

  // --------------- Serial ---------------

  async listPorts(): Promise<{ ports: SerialPortInfo[] }> {
    return this.request('GET', '/api/serial/ports');
  }

  async setSerialConfig(device: string, baudRate: number): Promise<{ success: boolean; serial: { device: string; baudRate: number; connected: boolean } }> {
    return this.request('PUT', '/api/serial/config', { device, baudRate });
  }

  // --------------- Drives ---------------

  async listDrives(): Promise<DriveStatus[]> {
    return this.request('GET', '/api/drives');
  }

  async mountDrive(driveId: number, filename: string): Promise<{ success: boolean; drive: number; filename: string }> {
    return this.request('POST', `/api/drives/${driveId}/mount`, { filename });
  }

  async unmountDrive(driveId: number): Promise<{ success: boolean; drive: number }> {
    return this.request('POST', `/api/drives/${driveId}/unmount`);
  }

  async setReadOnly(driveId: number, readonly: boolean): Promise<{ success: boolean; drive: number; readonly: boolean }> {
    return this.request('PUT', `/api/drives/${driveId}/readonly`, { readonly });
  }

  // --------------- Disk Images ---------------

  async listImages(): Promise<{ images: string[] }> {
    return this.request('GET', '/api/images');
  }

  async getImageDetails(): Promise<{ images: DiskImage[] }> {
    return this.request('GET', '/api/images/details');
  }

  async createImage(filename: string, format: string, extension: string): Promise<{ success: boolean; filename: string; size: number; format: string }> {
    return this.request('POST', '/api/images/create', { filename, format, extension });
  }

  async uploadImage(filePath: string, fileName: string): Promise<{ success: boolean; filename: string; size: number }> {
    return this.upload('/api/images/upload', 'diskImage', filePath, fileName);
  }

  async cloneImage(filename: string): Promise<{ success: boolean; filename: string }> {
    return this.request('POST', `/api/images/${encodeURIComponent(filename)}/clone`);
  }

  async deleteImage(filename: string): Promise<{ success: boolean; filename: string }> {
    return this.request('DELETE', `/api/images/${encodeURIComponent(filename)}`);
  }

  async setImageNotes(filename: string, description: string, notes: string): Promise<{ success: boolean; filename: string }> {
    return this.request('PUT', `/api/images/${encodeURIComponent(filename)}/notes`, { description, notes });
  }

  // --------------- CP/M ---------------

  async cpmInfo(filename: string): Promise<CpmDiskInfo> {
    return this.request('GET', `/api/images/${encodeURIComponent(filename)}/cpm/info`);
  }

  async cpmListFiles(filename: string): Promise<{ files: CpmFileInfo[] }> {
    return this.request('GET', `/api/images/${encodeURIComponent(filename)}/cpm/files`);
  }

  async cpmGetFile(diskFilename: string, cpmFile: string): Promise<Buffer> {
    return this.requestRaw('GET', `/api/images/${encodeURIComponent(diskFilename)}/cpm/files/${encodeURIComponent(cpmFile)}`);
  }

  async cpmPutFile(diskFilename: string, localPath: string, cpmFilename?: string): Promise<{ success: boolean; filename: string; size: number }> {
    const fs = await import('fs');
    const pathMod = await import('path');
    const fileBuffer = fs.readFileSync(localPath);
    const blob = new Blob([fileBuffer]);
    const origName = pathMod.basename(localPath);

    const form = new FormData();
    form.append('file', blob, origName);
    if (cpmFilename) {
      form.append('cpmFilename', cpmFilename);
    }

    const url = `${this.serverUrl}/api/images/${encodeURIComponent(diskFilename)}/cpm/files`;
    const res = await fetch(url, { method: 'POST', body: form });

    if (!res.ok) {
      const text = await res.text();
      let message: string;
      try {
        message = JSON.parse(text).error || text;
      } catch {
        message = text;
      }
      throw new Error(`POST cpm/files failed (${res.status}): ${message}`);
    }

    return res.json() as Promise<{ success: boolean; filename: string; size: number }>;
  }

  async cpmDeleteFile(diskFilename: string, cpmFile: string): Promise<{ success: boolean; filename: string }> {
    return this.request('DELETE', `/api/images/${encodeURIComponent(diskFilename)}/cpm/files/${encodeURIComponent(cpmFile)}`);
  }

  // --------------- Terminal ---------------

  async terminalOpen(device: string, config?: TerminalConfig): Promise<{ success: boolean; device: string }> {
    return this.request('POST', '/api/terminal/open', { device, config });
  }

  async terminalClose(): Promise<{ success: boolean }> {
    return this.request('POST', '/api/terminal/close');
  }

  async terminalGetStatus(): Promise<TerminalStatus> {
    return this.request('GET', '/api/terminal/status');
  }

  // --------------- Cassettes ---------------

  async listCassettes(): Promise<{ cassettes: CassetteInfo[] }> {
    return this.request('GET', '/api/cassettes/details');
  }

  async uploadCassette(filePath: string, fileName: string): Promise<{ success: boolean; filename: string; size: number }> {
    return this.upload('/api/cassettes/upload', 'cassette', filePath, fileName);
  }

  async playCassette(filename: string): Promise<{ success: boolean; message: string; filename: string }> {
    return this.request('POST', `/api/cassettes/${encodeURIComponent(filename)}/play`);
  }

  async stopCassette(): Promise<{ success: boolean; message: string }> {
    return this.request('POST', '/api/cassettes/stop');
  }

  async deleteCassette(filename: string): Promise<{ success: boolean; filename: string }> {
    return this.request('DELETE', `/api/cassettes/${encodeURIComponent(filename)}`);
  }

  async setCassetteNotes(filename: string, description: string, notes: string): Promise<{ success: boolean; filename: string }> {
    return this.request('PUT', `/api/cassettes/${encodeURIComponent(filename)}/notes`, { description, notes });
  }

  // --------------- Scripts ---------------

  async listScripts(): Promise<{ scripts: ScriptInfo[] }> {
    return this.request('GET', '/api/scripts');
  }

  async getScript(name: string): Promise<ScriptContent> {
    return this.request('GET', `/api/scripts/${encodeURIComponent(name)}`);
  }

  async createScript(name: string, content?: string): Promise<{ success: boolean; name: string }> {
    return this.request('POST', '/api/scripts', { name, content });
  }

  async updateScript(name: string, content: string): Promise<{ success: boolean; name: string }> {
    return this.request('PUT', `/api/scripts/${encodeURIComponent(name)}`, { content });
  }

  async uploadScript(filePath: string, fileName: string): Promise<{ success: boolean; name: string; size: number }> {
    return this.upload('/api/scripts/upload', 'file', filePath, fileName);
  }

  async deleteScript(name: string): Promise<{ success: boolean; name: string }> {
    return this.request('DELETE', `/api/scripts/${encodeURIComponent(name)}`);
  }

  // --------------- Replay ---------------

  async getReplayStatus(): Promise<{ active: boolean; mode?: string; progress: ReplayProgress | null }> {
    return this.request('GET', '/api/replay/status');
  }

  // --------------- Disk Serving ---------------

  async enableDiskServing(): Promise<{ success: boolean; message: string; enabled: boolean }> {
    return this.request('POST', '/api/disk-serving/enable');
  }

  async disableDiskServing(): Promise<{ success: boolean; message: string; enabled: boolean }> {
    return this.request('POST', '/api/disk-serving/disable');
  }
}
