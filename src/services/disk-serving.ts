import { Dependencies } from '../types';
import { getStatus } from './status';

export async function enableDiskServing(deps: Dependencies): Promise<void> {
  if (deps.diskServingEnabled) {
    return;
  }

  if (!deps.runtimeConfig?.port && !deps.serialManager.getDevice()) {
    throw new Error('No serial port configured. Please configure a port first.');
  }

  if (!deps.serialManager.isOpen()) {
    const port = deps.runtimeConfig?.port || deps.serialManager.getDevice();
    const baud = deps.runtimeConfig?.baud || deps.serialManager.getBaudRate() || 230400;
    if (!port) {
      throw new Error('No serial port configured');
    }
    await deps.serialManager.openPort(port, baud as any);
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
      deps.serialManager,
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
  }

  await deps.serialManager.closePort();
  deps.diskServingEnabled = false;

  console.log('Disk serving disabled');
  broadcastStatus(deps);
}

export function broadcastStatus(deps: Dependencies): void {
  deps.io.emit('status', getStatus(deps));
}
