import { useEffect, useState } from 'react';
import { ConfigOverrides, NotificationKind } from '../types';

interface ConfigFormProps {
  config: ConfigOverrides;
  onSave: (config: ConfigOverrides) => Promise<void>;
  onReload: () => Promise<void>;
  onNotify: (message: string, type: NotificationKind) => void;
}

interface ConfigFormState {
  port: string;
  baud: number;
  terminalPort: string;
  terminalBaud: number;
  terminalAutoconnect: boolean;
  webPort: number;
  webHost: string;
  gpioEnabled: boolean;
  gpioPins: number[];
  gpioActivity: number;
  gpioActiveHigh: boolean;
  logFile: string;
  verbose: boolean;
  debug: boolean;
  headless: boolean;
}

const defaultState: ConfigFormState = {
  port: '',
  baud: 115200,
  terminalPort: '',
  terminalBaud: 115200,
  terminalAutoconnect: false,
  webPort: 3000,
  webHost: '0.0.0.0',
  gpioEnabled: false,
  gpioPins: [0, 0, 0, 0],
  gpioActivity: 0,
  gpioActiveHigh: false,
  logFile: '',
  verbose: false,
  debug: false,
  headless: false
};

export function ConfigForm({ config, onSave, onReload, onNotify }: ConfigFormProps) {
  const [state, setState] = useState<ConfigFormState>(defaultState);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setState({
      port: config.port || '',
      baud: config.baud || defaultState.baud,
      terminalPort: config.terminalPort || '',
      terminalBaud: config.terminalBaud || defaultState.terminalBaud,
      terminalAutoconnect: config.terminalAutoconnect ?? defaultState.terminalAutoconnect,
      webPort: config.webPort || defaultState.webPort,
      webHost: config.webHost || defaultState.webHost,
      gpioEnabled: config.gpioLeds?.enabled ?? defaultState.gpioEnabled,
      gpioPins: config.gpioLeds?.pins ?? defaultState.gpioPins,
      gpioActivity: config.gpioLeds?.activity ?? defaultState.gpioActivity,
      gpioActiveHigh: config.gpioLeds?.activeHigh ?? defaultState.gpioActiveHigh,
      logFile: config.logFile || '',
      verbose: config.verbose ?? defaultState.verbose,
      debug: config.debug ?? defaultState.debug,
      headless: config.headless ?? defaultState.headless
    });
  }, [config]);

  const updateState = (key: keyof ConfigFormState, value: any) => {
    setState((prev) => ({ ...prev, [key]: value }));
  };

  const saveConfiguration = async () => {
    setBusy(true);
    const payload: ConfigOverrides = {
      port: state.port,
      baud: state.baud,
      terminalPort: state.terminalPort,
      terminalBaud: state.terminalBaud,
      terminalAutoconnect: state.terminalAutoconnect,
      webPort: state.webPort,
      webHost: state.webHost,
      gpioLeds: {
        enabled: state.gpioEnabled,
        pins: state.gpioPins,
        activity: state.gpioActivity,
        activeHigh: state.gpioActiveHigh
      },
      logFile: state.logFile,
      verbose: state.verbose,
      debug: state.debug,
      headless: state.headless
    };

    try {
      await onSave(payload);
    } finally {
      setBusy(false);
    }
  };

  const reloadConfiguration = async () => {
    setBusy(true);
    try {
      await onReload();
    } catch (error: any) {
      onNotify(`Failed to reload config: ${error.message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page active" id="page-config">
      <header className="page-header">
        <h1>Configuration</h1>
        <button className="btn-primary" onClick={saveConfiguration} type="button" disabled={busy}>
          Save Configuration
        </button>
      </header>

      <div className="config-section">
        <h2>Serial Port Settings</h2>
        <div className="form-grid">
          <div className="form-group">
            <label htmlFor="configPort">Serial Port</label>
            <input
              type="text"
              id="configPort"
              placeholder="/dev/ttyUSB0"
              value={state.port}
              onChange={(e) => updateState('port', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="configBaudRate">Baud Rate</label>
            <select
              id="configBaudRate"
              value={state.baud}
              onChange={(e) => updateState('baud', parseInt(e.target.value, 10))}
            >
              {[9600, 19200, 38400, 57600, 115200].map((rate) => (
                <option key={rate} value={rate}>
                  {rate}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="config-section">
        <h2>Terminal Settings</h2>
        <div className="form-grid">
          <div className="form-group">
            <label htmlFor="configTerminalPort">Terminal Port</label>
            <input
              type="text"
              id="configTerminalPort"
              placeholder="/dev/ttyACM0"
              value={state.terminalPort}
              onChange={(e) => updateState('terminalPort', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="configTerminalBaud">Terminal Baud Rate</label>
            <select
              id="configTerminalBaud"
              value={state.terminalBaud}
              onChange={(e) => updateState('terminalBaud', parseInt(e.target.value, 10))}
            >
              {[9600, 19200, 38400, 57600, 115200].map((rate) => (
                <option key={rate} value={rate}>
                  {rate}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                id="configTerminalAutoconnect"
                checked={state.terminalAutoconnect}
                onChange={(e) => updateState('terminalAutoconnect', e.target.checked)}
              />
              Auto-connect Terminal
            </label>
          </div>
        </div>
      </div>

      <div className="config-section">
        <h2>Web Server Settings</h2>
        <div className="form-grid">
          <div className="form-group">
            <label htmlFor="configWebPort">Web Port</label>
            <input
              type="number"
              id="configWebPort"
              value={state.webPort}
              onChange={(e) => updateState('webPort', parseInt(e.target.value, 10))}
            />
          </div>
          <div className="form-group">
            <label htmlFor="configWebHost">Web Host</label>
            <input
              type="text"
              id="configWebHost"
              value={state.webHost}
              onChange={(e) => updateState('webHost', e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="config-section">
        <h2>GPIO LED Configuration</h2>
        <div className="form-grid">
          <div className="form-group full-width">
            <label>
              <input
                type="checkbox"
                id="configGpioEnabled"
                checked={state.gpioEnabled}
                onChange={(e) => updateState('gpioEnabled', e.target.checked)}
              />
              Enable GPIO LEDs
            </label>
          </div>
          {state.gpioPins.map((pin, idx) => (
            <div className="form-group" key={`gpioPin-${idx}`}>
              <label htmlFor={`configGpioDrive${idx}`}>Drive {idx} LED Pin</label>
              <input
                type="number"
                id={`configGpioDrive${idx}`}
                value={pin}
                onChange={(e) => {
                  const pins = [...state.gpioPins];
                  pins[idx] = parseInt(e.target.value || '0', 10);
                  updateState('gpioPins', pins);
                }}
              />
            </div>
          ))}
          <div className="form-group">
            <label htmlFor="configGpioActivity">Activity LED Pin</label>
            <input
              type="number"
              id="configGpioActivity"
              value={state.gpioActivity}
              onChange={(e) => updateState('gpioActivity', parseInt(e.target.value || '0', 10))}
            />
          </div>
          <div className="form-group full-width">
            <label>
              <input
                type="checkbox"
                id="configGpioActiveHigh"
                checked={state.gpioActiveHigh}
                onChange={(e) => updateState('gpioActiveHigh', e.target.checked)}
              />
              Active High (uncheck for Active Low)
            </label>
          </div>
        </div>
      </div>

      <div className="config-section">
        <h2>Logging & Display</h2>
        <div className="form-grid">
          <div className="form-group">
            <label htmlFor="configLogFile">Log File Path</label>
            <input
              type="text"
              id="configLogFile"
              placeholder="/var/log/fdcplus.log"
              value={state.logFile}
              onChange={(e) => updateState('logFile', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                id="configVerbose"
                checked={state.verbose}
                onChange={(e) => updateState('verbose', e.target.checked)}
              />
              Verbose Logging
            </label>
          </div>
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                id="configDebug"
                checked={state.debug}
                onChange={(e) => updateState('debug', e.target.checked)}
              />
              Debug Mode
            </label>
          </div>
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                id="configHeadless"
                checked={state.headless}
                onChange={(e) => updateState('headless', e.target.checked)}
              />
              Headless Mode (disable TUI)
            </label>
          </div>
        </div>
      </div>

      <div className="config-actions">
        <button className="btn-primary" onClick={saveConfiguration} type="button" disabled={busy}>
          Save Configuration
        </button>
        <button className="btn-secondary" onClick={reloadConfiguration} type="button" disabled={busy}>
          Reload
        </button>
      </div>
    </div>
  );
}
