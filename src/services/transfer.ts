import { Dependencies } from '../types';
import { ReplayEngine, ReplayProgress } from '../replay-engine';
import { XmodemSender } from '../xmodem-sender';

export function startRawReplay(
  deps: Dependencies,
  filePath: string,
  fileName: string,
  chunkSize?: number,
  interByteDelayMs?: number,
  interLineDelayMs?: number,
  lineEnding?: string,
): void {
  if (!deps.replayEngine) {
    deps.replayEngine = new ReplayEngine(deps.terminalManager);
    deps.replayEngine.on('progress', (progress: ReplayProgress) => {
      deps.io.emit('replay:progress', progress);
    });
  }

  deps.replayEngine.replay({
    filePath,
    fileName,
    chunkSize,
    interByteDelayMs,
    interLineDelayMs,
    lineEnding: lineEnding as 'cr' | 'lf' | 'crlf' | 'raw' | undefined,
    verbose: deps.runtimeConfig?.verbose || false,
  }).catch((err) => {
    console.error('Replay error:', err);
  });
}

export function startXmodemSend(
  deps: Dependencies,
  filePath: string,
  fileName: string,
  useCrc?: boolean,
): void {
  if (!deps.xmodemSender) {
    deps.xmodemSender = new XmodemSender(deps.terminalManager);
    deps.xmodemSender.on('progress', (progress: ReplayProgress) => {
      deps.io.emit('replay:progress', progress);
    });
  }

  deps.xmodemSender.send({
    filePath,
    fileName,
    useCrc,
  }).catch((err) => {
    console.error('XMODEM error:', err);
  });
}

export function cancelActiveTransfer(deps: Dependencies): void {
  if (deps.replayEngine && deps.replayEngine.isRunning()) {
    deps.replayEngine.cancel();
  }
  if (deps.xmodemSender && deps.xmodemSender.isRunning()) {
    deps.xmodemSender.cancel();
  }
}
