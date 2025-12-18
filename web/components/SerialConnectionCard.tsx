import { useEffect, useState } from 'react';
import { SerialStatus } from '../types';

interface SerialConnectionCardProps {
  status: SerialStatus;
  message?: string;
  messageType?: 'success' | 'error';
  onConnect: (device: string, baudRate: number) => Promise<void>;
  onDisconnect: () => Promise<void>;
}

const baudRates = [9600, 19200, 38400, 57600, 76800, 230400, 460800];

export function SerialConnectionCard({
  status,
  message,
  messageType,
  onConnect,
  onDisconnect
}: SerialConnectionCardProps) {
  const [port, setPort] = useState(status.device || '');
  const [baudRate, setBaudRate] = useState(status.baudRate || 230400);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPort(status.device || '');
    if (status.baudRate) {
      setBaudRate(status.baudRate);
    }
  }, [status.device, status.baudRate]);

  const handleConnect = async () => {
    if (!port.trim()) {
      return;
    }
    setBusy(true);
    try {
      await onConnect(port.trim(), baudRate);
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      await onDisconnect();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>Serial Port Connection</h2>
      </div>
      <div className="card-content">
        <div className="serial-connection-controls">
          <div className="config-group">
            <label className="config-label">Port:</label>
            <input
              type="text"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              id="serialPortInput"
              placeholder="/dev/ttyUSB0"
              disabled={status.connected}
            />
          </div>
          <div className="config-group">
            <label className="config-label">Baud Rate:</label>
            <select
              id="serialBaudRate"
              value={baudRate}
              onChange={(e) => setBaudRate(parseInt(e.target.value, 10))}
              disabled={status.connected}
            >
              {baudRates.map((rate) => (
                <option key={rate} value={rate}>
                  {rate}
                </option>
              ))}
            </select>
          </div>
          <div className="config-group">
            {!status.connected && (
              <button
                id="serialConnectBtn"
                className="btn btn-primary"
                onClick={handleConnect}
                disabled={busy}
                type="button"
              >
                {busy ? 'Connecting...' : 'Connect'}
              </button>
            )}
            {status.connected && (
              <button
                id="serialDisconnectBtn"
                className="btn btn-secondary"
                onClick={handleDisconnect}
                disabled={busy}
                type="button"
              >
                {busy ? 'Disconnecting...' : 'Disconnect'}
              </button>
            )}
          </div>
        </div>
        {message && (
          <div className={`message ${messageType || 'success'}`} id="serialConnectionMessage">
            {message}
          </div>
        )}
      </div>
    </div>
  );
}
