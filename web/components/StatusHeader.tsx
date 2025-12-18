import { ServerStatus } from '../types';

interface StatusHeaderProps {
  status: ServerStatus | null;
}

export function StatusHeader({ status }: StatusHeaderProps) {
  const serial = status?.serial;
  const lastUpdate = status?.timestamp
    ? new Date(status.timestamp).toLocaleTimeString()
    : '-';
  const serialClass = serial?.connected ? 'status-dot connected' : 'status-dot disconnected';

  return (
    <header className="page-header">
      <h1>FDC+ Serial Drive Server</h1>
      <div className="status-bar">
        <div className="status-item">
          <span className={serialClass} id="serialStatus" />
          <span>
            Serial:{' '}
            <strong id="serialDevice">
              {serial?.connected ? serial.device || 'Connected' : 'Not Connected'}
            </strong>
          </span>
        </div>
        <div className="status-item">
          <span>
            Baud Rate:{' '}
            <strong id="baudRate">
              {serial?.connected && serial?.baudRate ? serial.baudRate : '-'}
            </strong>
          </span>
        </div>
        <div className="status-item">
          <span>
            Last Update: <strong id="lastUpdate">{lastUpdate}</strong>
          </span>
        </div>
      </div>
    </header>
  );
}
