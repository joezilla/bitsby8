import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { ConfigForm } from '../components/ConfigForm';
import { DiskManagementPage } from '../components/DiskManagementPage';
import { DriveStatusBanner } from '../components/DriveStatusBanner';
import { Notification } from '../components/Notification';
import { SerialConnectionCard } from '../components/SerialConnectionCard';
import { Sidebar } from '../components/Sidebar';
import { StatusHeader } from '../components/StatusHeader';
import type { TerminalPanelProps } from '../components/TerminalPanel';
import {
  ConfigOverrides,
  DiskMetadata,
  NotificationKind,
  PageName,
  PortInfo,
  PreferredTerminalSettings,
  SerialStatus,
  ServerStatus,
  StartupMount,
  TerminalStatus
} from '../types';

const TerminalPanel = dynamic<TerminalPanelProps>(
  () => import('../components/TerminalPanel').then((mod) => mod.TerminalPanel),
  { ssr: false }
);

function defaultStartupMounts(): StartupMount[] {
  return [0, 1, 2, 3].map((driveId) => ({ driveId, diskFilename: null, readonly: false }));
}

function normalizeStartupMounts(mounts: any[]): StartupMount[] {
  const defaults = defaultStartupMounts();
  mounts?.forEach((mount: any) => {
    if (typeof mount.driveId === 'number' && defaults[mount.driveId]) {
      defaults[mount.driveId] = {
        driveId: mount.driveId,
        diskFilename: mount.diskFilename || null,
        readonly: !!mount.readonly
      };
    }
  });
  return defaults;
}

export default function IndexPage() {
  const [page, setPage] = useState<PageName>('home');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [serialStatus, setSerialStatus] = useState<SerialStatus>({ connected: false });
  const [terminalStatus, setTerminalStatus] = useState<TerminalStatus>({ connected: false, device: null });
  const [preferredTerminal, setPreferredTerminal] = useState<PreferredTerminalSettings | undefined>(undefined);
  const [config, setConfig] = useState<ConfigOverrides>({});
  const [availablePorts, setAvailablePorts] = useState<PortInfo[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [diskMetadata, setDiskMetadata] = useState<Record<string, DiskMetadata>>({});
  const [startupMounts, setStartupMounts] = useState<StartupMount[]>(defaultStartupMounts());
  const [notification, setNotification] = useState<{ message: string; type: NotificationKind } | null>(null);
  const [serialMessage, setSerialMessage] = useState<{ text: string; type?: 'success' | 'error' } | null>(null);

  const showNotification = useCallback((message: string, type: NotificationKind = 'success') => {
    setNotification({ message, type });
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = (await res.json()) as ServerStatus;
        setStatus(data);
        setSerialStatus(data.serial);
      }
    } catch (error) {
      console.error('Failed to fetch status', error);
    }
  }, []);

  const refreshPorts = useCallback(async () => {
    try {
      const res = await fetch('/api/terminal/ports');
      if (res.ok) {
        const data = await res.json();
        setAvailablePorts(data.ports || []);
      }
    } catch (error) {
      console.error('Failed to load ports', error);
    }
  }, []);

  const refreshConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
      }
    } catch (error) {
      console.error('Failed to load config', error);
      showNotification('Failed to load configuration', 'error');
    }
  }, [showNotification]);

  const refreshDiskData = useCallback(async () => {
    try {
      const [imagesRes, metadataRes, mountsRes] = await Promise.all([
        fetch('/api/images'),
        fetch('/api/disks/metadata'),
        fetch('/api/startup-mounts')
      ]);

      if (imagesRes.ok) {
        const imagesData = await imagesRes.json();
        setImages(imagesData.images || []);
      }

      if (metadataRes.ok) {
        const metadataData = await metadataRes.json();
        setDiskMetadata(metadataData || {});
      }

      if (mountsRes.ok) {
        const mountsData = await mountsRes.json();
        setStartupMounts(normalizeStartupMounts(mountsData || []));
      } else {
        setStartupMounts(defaultStartupMounts());
      }
    } catch (error) {
      console.error('Failed to load disk data', error);
      showNotification('Failed to load disk data', 'error');
    }
  }, [showNotification]);

  const refreshSerialStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/serial/status');
      if (res.ok) {
        const data = await res.json();
        setSerialStatus({
          connected: data.connected,
          device: data.device || null,
          baudRate: data.baudRate || null
        });
      }
    } catch (error) {
      console.error('Failed to load serial status', error);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    refreshSerialStatus();
    refreshPorts();
    if (page === 'disks') {
      refreshDiskData();
    }
    if (page === 'config') {
      refreshConfig();
    }
  }, [fetchStatus, refreshSerialStatus, refreshPorts, refreshDiskData, refreshConfig, page]);

  useEffect(() => {
    const client = io();
    setSocket(client);

    client.on('connect', () => {
      client.emit('request-status');
    });

    client.on('status', (payload: ServerStatus) => {
      setStatus(payload);
      setSerialStatus(payload.serial);
    });

    client.on('terminal:status', (payload: TerminalStatus) => {
      setTerminalStatus(payload);
      setPreferredTerminal(payload.preferred);
    });

    client.on('serial:status', (payload: SerialStatus) => {
      setSerialStatus(payload);
    });

    return () => {
      client.disconnect();
      setSocket(null);
    };
  }, []);

  const handleSerialConnect = useCallback(
    async (device: string, baudRate: number) => {
      try {
        const response = await fetch('/api/serial/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device, baudRate })
        });
        const data = await response.json();

        if (response.ok) {
          showNotification(`Connected to ${device} @ ${baudRate} baud`, 'success');
          setSerialMessage({ text: `Connected to ${device} @ ${baudRate} baud`, type: 'success' });
          setSerialStatus({ connected: true, device, baudRate });
        } else {
          setSerialMessage({ text: `Connection failed: ${data.error}`, type: 'error' });
        }
      } catch (error: any) {
        setSerialMessage({ text: `Connection error: ${error.message}`, type: 'error' });
      }
    },
    [showNotification]
  );

  const handleSerialDisconnect = useCallback(async () => {
    try {
      const response = await fetch('/api/serial/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await response.json();

      if (response.ok) {
        showNotification('Disconnected from serial port', 'success');
        setSerialMessage({ text: 'Disconnected from serial port', type: 'success' });
        setSerialStatus({ connected: false, device: null });
      } else {
        setSerialMessage({ text: `Disconnect failed: ${data.error}`, type: 'error' });
      }
    } catch (error: any) {
      setSerialMessage({ text: `Disconnect error: ${error.message}`, type: 'error' });
    }
  }, [showNotification]);

  const saveConfiguration = useCallback(
    async (payload: ConfigOverrides) => {
      try {
        const response = await fetch('/api/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          showNotification('Configuration saved successfully. Some settings may require restart.', 'success');
          setConfig(payload);
        } else {
          const data = await response.json();
          showNotification(`Failed to save: ${data.error}`, 'error');
        }
      } catch (error: any) {
        showNotification(`Error: ${error.message}`, 'error');
      }
    },
    [showNotification]
  );

  const uploadDisk = useCallback(
    async (file: File) => {
      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) {
        showNotification('File too large. Maximum size is 10MB.', 'error');
        return;
      }

      const formData = new FormData();
      formData.append('disk', file);

      try {
        const response = await fetch('/api/images/upload', {
          method: 'POST',
          body: formData
        });
        const data = await response.json();

        if (response.ok) {
          showNotification('Disk image uploaded successfully', 'success');
          await refreshDiskData();
        } else {
          showNotification(`Upload failed: ${data.error}`, 'error');
        }
      } catch (error: any) {
        showNotification(`Upload error: ${error.message}`, 'error');
      }
    },
    [refreshDiskData, showNotification]
  );

  const deleteDisk = useCallback(
    async (filename: string) => {
      try {
        const response = await fetch(`/api/images/${encodeURIComponent(filename)}`, { method: 'DELETE' });
        const data = await response.json();

        if (response.ok) {
          showNotification('Disk image deleted', 'success');
          await refreshDiskData();
        } else {
          showNotification(`Delete failed: ${data.error}`, 'error');
        }
      } catch (error: any) {
        showNotification(`Delete error: ${error.message}`, 'error');
      }
    },
    [refreshDiskData, showNotification]
  );

  const saveMetadata = useCallback(
    async (filename: string, description: string) => {
      try {
        const response = await fetch(`/api/images/${encodeURIComponent(filename)}/metadata`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description })
        });

        if (response.ok) {
          showNotification('Description updated', 'success');
          await refreshDiskData();
        } else {
          const data = await response.json();
          showNotification(`Failed: ${data.error}`, 'error');
        }
      } catch (error: any) {
        showNotification(`Error: ${error.message}`, 'error');
      }
    },
    [refreshDiskData, showNotification]
  );

  const saveStartupMounts = useCallback(
    async (mounts: StartupMount[]) => {
      try {
        const response = await fetch('/api/startup-mounts', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mounts })
        });

        if (response.ok) {
          showNotification('Startup mounts saved successfully', 'success');
          setStartupMounts(mounts);
        } else {
          const data = await response.json();
          showNotification(`Failed: ${data.error}`, 'error');
        }
      } catch (error: any) {
        showNotification(`Error: ${error.message}`, 'error');
      }
    },
    [showNotification]
  );

  const pageContent = useMemo(() => {
    if (page === 'config') {
      return (
        <ConfigForm config={config} onSave={saveConfiguration} onReload={refreshConfig} onNotify={showNotification} />
      );
    }

    if (page === 'disks') {
      return (
        <DiskManagementPage
          images={images}
          metadata={diskMetadata}
          startupMounts={startupMounts}
          onRefresh={refreshDiskData}
          onUpload={uploadDisk}
          onDelete={deleteDisk}
          onSaveMetadata={saveMetadata}
          onSaveStartupMounts={saveStartupMounts}
        />
      );
    }

    return (
      <div className="page active" id="page-home">
        <StatusHeader status={status} />
        <SerialConnectionCard
          status={serialStatus}
          message={serialMessage?.text}
          messageType={serialMessage?.type}
          onConnect={handleSerialConnect}
          onDisconnect={handleSerialDisconnect}
        />
        <TerminalPanel
          socket={socket}
          status={terminalStatus}
          preferred={preferredTerminal}
          ports={availablePorts}
          onRefreshPorts={refreshPorts}
          onStatusChange={(next) => setTerminalStatus((prev) => ({ ...prev, ...next }))}
          onNotify={showNotification}
        />
        <footer>
          <p>FDC+ Serial Drive Server v2.0 - TypeScript Edition</p>
          <p>Real-time updates via WebSocket</p>
        </footer>
      </div>
    );
  }, [
    page,
    config,
    status,
    serialStatus,
    serialMessage,
    terminalStatus,
    preferredTerminal,
    availablePorts,
    startupMounts,
    images,
    diskMetadata,
    socket,
    refreshPorts,
    handleSerialConnect,
    handleSerialDisconnect,
    saveConfiguration,
    refreshConfig,
    uploadDisk,
    deleteDisk,
    saveMetadata,
    saveStartupMounts,
    refreshDiskData
  ]);

  return (
    <div className="app-container">
      <Sidebar activePage={page} onNavigate={setPage} />
      <div className="main-content" id="mainContent">
        <DriveStatusBanner drives={status?.drives || []} />
        <div className="page-container">{pageContent}</div>
      </div>
      {notification && (
        <Notification
          message={notification.message}
          type={notification.type}
          onHide={() => setNotification(null)}
        />
      )}
    </div>
  );
}
