import { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import { FitAddon } from 'xterm-addon-fit';
import { Terminal } from 'xterm';
import { NotificationKind, PortInfo, PreferredTerminalSettings, TerminalStatus } from '../types';

export interface TerminalPanelProps {
  socket: Socket | null;
  status: TerminalStatus;
  preferred?: PreferredTerminalSettings;
  ports: PortInfo[];
  onRefreshPorts: () => Promise<void>;
  onStatusChange: (status: TerminalStatus) => void;
  onNotify: (message: string, type: NotificationKind) => void;
}

export function TerminalPanel({
  socket,
  status,
  preferred,
  ports,
  onRefreshPorts,
  onStatusChange,
  onNotify
}: TerminalPanelProps) {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const [selectedPort, setSelectedPort] = useState('');
  const [baudRate, setBaudRate] = useState(115200);
  const [dataBits, setDataBits] = useState(8);
  const [stopBits, setStopBits] = useState(1);
  const [parity, setParity] = useState('none');
  const [flowControl, setFlowControl] = useState('none');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!terminalRef.current || termRef.current) {
      return;
    }

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"Courier New", Courier, monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#f0f0f0',
        cursor: '#f0f0f0',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5'
      },
      cols: 80,
      rows: 24
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    term.onData((data) => {
      if (status.connected && socket) {
        socket.emit('terminal:write', data);
      }
    });

    const handleResize = () => {
      fitAddon.fit();
    };

    window.addEventListener('resize', handleResize);

    term.writeln('\x1b[1;32m=== FDC+ Serial Terminal (VT102) ===\x1b[0m');
    term.writeln('\x1b[36mSelect a serial port and click Connect to begin.\x1b[0m');
    term.writeln('');

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [socket, status.connected]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const handleData = (data: number[]) => {
      if (termRef.current) {
        termRef.current.write(new Uint8Array(data));
      }
    };

    const handleError = (error: { message: string }) => {
      onNotify(`Terminal error: ${error.message}`, 'error');
    };

    socket.on('terminal:data', handleData);
    socket.on('terminal:error', handleError);

    return () => {
      socket.off('terminal:data', handleData);
      socket.off('terminal:error', handleError);
    };
  }, [socket, onNotify]);

  useEffect(() => {
    if (status.device) {
      setSelectedPort(status.device);
    }
    if (status.config?.baudRate) setBaudRate(status.config.baudRate);
    if (status.config?.dataBits) setDataBits(status.config.dataBits);
    if (status.config?.stopBits) setStopBits(status.config.stopBits);
    if (status.config?.parity) setParity(status.config.parity);
    if (status.config?.flowControl) setFlowControl(status.config.flowControl);
  }, [status]);

  useEffect(() => {
    if (preferred?.port && !selectedPort) {
      setSelectedPort(preferred.port);
    }
    if (preferred?.baud && !status.connected) {
      setBaudRate(preferred.baud);
    }
  }, [preferred, status.connected, selectedPort]);

  const refreshPorts = async () => {
    await onRefreshPorts();
  };

  const connectTerminal = async () => {
    if (!selectedPort) {
      onNotify('Please select a serial port', 'error');
      return;
    }

    const config = { baudRate, dataBits, stopBits, parity, flowControl };
    setBusy(true);

    try {
      const response = await fetch('/api/terminal/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device: selectedPort, config })
      });
      const data = await response.json();

      if (response.ok) {
        onNotify('Terminal connected successfully', 'success');
        onStatusChange({ connected: true, device: selectedPort, config });
        termRef.current?.writeln(`\x1b[1;32m✓ Connected to ${selectedPort}\x1b[0m`);
        termRef.current?.writeln('');
      } else {
        onNotify(`Error: ${data.error}`, 'error');
        termRef.current?.writeln(`\x1b[1;31m✗ Connection failed: ${data.error}\x1b[0m`);
      }
    } catch (error: any) {
      onNotify(`Failed to connect: ${error.message}`, 'error');
      termRef.current?.writeln(`\x1b[1;31m✗ Connection failed: ${error.message}\x1b[0m`);
    } finally {
      setBusy(false);
    }
  };

  const disconnectTerminal = async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/terminal/close', { method: 'POST' });
      const data = await response.json();

      if (response.ok) {
        onNotify('Terminal disconnected', 'success');
        onStatusChange({ connected: false, device: null });
        termRef.current?.writeln('');
        termRef.current?.writeln('\x1b[1;33m✓ Disconnected\x1b[0m');
      } else {
        onNotify(`Error: ${data.error}`, 'error');
      }
    } catch (error: any) {
      onNotify(`Failed to disconnect: ${error.message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const clearTerminal = () => {
    termRef.current?.clear();
  };

  const statusDotClass = status.connected ? 'status-dot connected' : 'status-dot disconnected';

  return (
    <div className="terminal-section">
      <div className="terminal-header">
        <div className="terminal-title">Serial Terminal (VT102)</div>
        <div className="terminal-status">
          <span className={statusDotClass} id="terminalStatus" />
          <span id="terminalDevice">{status.device || 'Not Connected'}</span>
        </div>
      </div>
      <div className="terminal-controls">
        <div className="config-group">
          <span className="config-label">Port:</span>
          <select
            id="terminalPortSelect"
            value={selectedPort}
            onChange={(e) => setSelectedPort(e.target.value)}
          >
            <option value="">Select port...</option>
            {ports.map((port) => (
              <option key={port.path} value={port.path}>
                {port.path}
                {port.manufacturer ? ` - ${port.manufacturer}` : ''}
              </option>
            ))}
          </select>
          <button className="btn-secondary" onClick={refreshPorts} type="button" disabled={busy}>
            Refresh
          </button>
        </div>
        <div className="config-group">
          <span className="config-label">Baud:</span>
          <select
            id="terminalBaudRate"
            value={baudRate}
            onChange={(e) => setBaudRate(parseInt(e.target.value, 10))}
          >
            {[9600, 19200, 38400, 57600, 115200].map((rate) => (
              <option key={rate} value={rate}>
                {rate}
              </option>
            ))}
          </select>
        </div>
        <div className="config-group">
          <span className="config-label">Data:</span>
          <select
            id="terminalDataBits"
            value={dataBits}
            onChange={(e) => setDataBits(parseInt(e.target.value, 10))}
          >
            {[5, 6, 7, 8].map((bits) => (
              <option key={bits} value={bits}>
                {bits}
              </option>
            ))}
          </select>
        </div>
        <div className="config-group">
          <span className="config-label">Stop:</span>
          <select
            id="terminalStopBits"
            value={stopBits}
            onChange={(e) => setStopBits(parseInt(e.target.value, 10))}
          >
            {[1, 2].map((bits) => (
              <option key={bits} value={bits}>
                {bits}
              </option>
            ))}
          </select>
        </div>
        <div className="config-group">
          <span className="config-label">Parity:</span>
          <select
            id="terminalParity"
            value={parity}
            onChange={(e) => setParity(e.target.value)}
          >
            <option value="none">None</option>
            <option value="even">Even</option>
            <option value="odd">Odd</option>
            <option value="mark">Mark</option>
            <option value="space">Space</option>
          </select>
        </div>
        <div className="config-group">
          <span className="config-label">Flow:</span>
          <select
            id="terminalFlowControl"
            value={flowControl}
            onChange={(e) => setFlowControl(e.target.value)}
          >
            <option value="none">None</option>
            <option value="hardware">Hardware</option>
            <option value="software">Software</option>
          </select>
        </div>
        <button
          className="btn-success"
          id="terminalConnect"
          onClick={connectTerminal}
          disabled={busy || status.connected}
          type="button"
        >
          Connect
        </button>
        <button
          className="btn-danger"
          id="terminalDisconnect"
          onClick={disconnectTerminal}
          disabled={busy || !status.connected}
          type="button"
        >
          Disconnect
        </button>
        <button className="btn-warning" onClick={clearTerminal} type="button">
          Clear
        </button>
      </div>
      <div className="terminal-container">
        <div id="terminal" ref={terminalRef} />
      </div>
    </div>
  );
}
