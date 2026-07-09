import { Dependencies } from '../types';
import { getStatus } from './status';
import { IFdcTransport } from '../transport';

export async function enableDiskServing(deps: Dependencies): Promise<void> {
  if (deps.diskServingEnabled) {
    return;
  }

  const hasWs = deps.wsTransport.isOpen();
  // Prefer a connected WebSocket FDC client over a serial port that is merely
  // configured but not actually open (e.g. a placeholder `-p /dev/null`). This
  // lets a virtual FDC client take over disk serving even when a dead serial
  // port is configured.
  const hasSerial = !hasWs && !!(deps.runtimeConfig?.port || deps.serialManager.getDevice());

  if (!hasSerial && !hasWs) {
    throw new Error(
      'No transport available. Configure a serial port or connect a WebSocket FDC client first.'
    );
  }

  let transport: IFdcTransport;
  if (hasSerial) {
    if (!deps.serialManager.isOpen()) {
      const port = deps.runtimeConfig?.port || deps.serialManager.getDevice();
      const baud = deps.runtimeConfig?.baud || deps.serialManager.getBaudRate() || 230400;
      if (!port) {
        throw new Error('No serial port configured');
      }
      await deps.serialManager.openPort(port, baud as any);
    }
    transport = deps.serialManager;
  } else {
    transport = deps.wsTransport;
  }

  if (!deps.server) {
    const { createDefaultConfig } = await import('../protocol');
    const config = createDefaultConfig();
    config.port = deps.serialManager.getDevice() || null;
    config.baudRate = deps.serialManager.getBaudRate() || 230400;
    config.verbose = deps.runtimeConfig?.verbose || false;
    config.debug = deps.runtimeConfig?.debug || false;

    const { FdcServer } = await import('../server');
    deps.server = new FdcServer(
      deps.driveManager,
      transport,
      config
    );
  }

  console.log('Starting FDC server for disk serving...');
  deps.serverTask = deps.server.start().catch((error) => {
    console.error('FDC server error:', error);
    deps.serverTask = null;
    deps.diskServingEnabled = false;
    broadcastStatus(deps);
  });

  deps.diskServingEnabled = true;
  await new Promise(resolve => setTimeout(resolve, 100));
  console.log('Disk serving enabled');
  broadcastStatus(deps);
}

export async function disableDiskServing(deps: Dependencies): Promise<void> {
  if (!deps.diskServingEnabled) {
    return;
  }

  if (deps.server) {
    deps.server.stop();
    deps.serverTask = null;
    // Drop the server instance so a subsequent enable re-selects the transport
    // (e.g. rebinding from a dead serial port to a connected WebSocket client).
    deps.server = null;
  }

  await deps.serialManager.closePort();
  deps.diskServingEnabled = false;

  console.log('Disk serving disabled');
  broadcastStatus(deps);
}

export function broadcastStatus(deps: Dependencies): void {
  deps.io.emit('status', getStatus(deps));
}
