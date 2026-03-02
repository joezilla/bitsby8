/**
 * Main application controller for FDC+ Console.
 * Owns all components and wires them together.
 */

import { FdcClient } from './client';
import { ScreenRenderer } from './screen/renderer';
import { TerminalArea } from './screen/terminal-area';
import { StatusBar } from './screen/status-bar';
import { InputLine } from './screen/input-line';
import { CommandRegistry } from './commands/registry';
import { registerGeneralCommands } from './commands/general';
import { registerDriveCommands } from './commands/drives';
import { registerScriptCommands } from './commands/scripts';
import { registerTerminalCommands } from './commands/terminal';
import { CommandHistory } from './history';
import { ServerStatus, TerminalStatus, ReplayProgress } from './types/index';
import chalk from 'chalk';

export class App {
  private readonly client: FdcClient;
  private readonly screen: ScreenRenderer;
  private readonly terminalArea: TerminalArea;
  private readonly statusBar: StatusBar;
  private readonly inputLine: InputLine;
  private readonly registry: CommandRegistry;
  private readonly history: CommandHistory;
  private readonly serverUrl: string;

  private latestStatus: ServerStatus | null = null;
  private latestTerminalStatus: TerminalStatus | null = null;
  private latestReplay: ReplayProgress | null = null;
  private shuttingDown = false;

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
    this.client = new FdcClient(serverUrl);
    this.screen = new ScreenRenderer(serverUrl);
    this.terminalArea = new TerminalArea(this.screen);
    this.statusBar = new StatusBar(this.screen);
    this.history = new CommandHistory();

    // Command registry
    this.registry = new CommandRegistry();
    registerGeneralCommands(this.registry);
    registerDriveCommands(this.registry);
    registerScriptCommands(this.registry);
    registerTerminalCommands(this.registry);

    // Input line with callbacks
    this.inputLine = new InputLine(this.screen, {
      onTerminalWrite: (data: string) => {
        this.client.terminalWrite(data);
      },
      onCommand: (line: string) => {
        this.handleCommand(line);
      },
      onComplete: (partial: string) => {
        return this.registry.getCompletions(partial);
      },
      onHistoryPrev: () => {
        return this.history.prev();
      },
      onHistoryNext: () => {
        return this.history.next();
      },
    });
  }

  async start(): Promise<void> {
    // Load command history
    this.history.load();

    // Connect to server
    process.stdout.write(`Connecting to ${this.serverUrl}...\n`);
    try {
      await this.client.connect();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(chalk.red(`Failed to connect: ${msg}\n`));
      process.exit(1);
    }

    // Enter full-screen TUI
    this.screen.enterScreen();

    // Draw initial status bar (disconnected until first status event)
    this.statusBar.renderDisconnected(this.serverUrl);

    // Draw initial input line
    this.inputLine.render();

    // Show cursor for terminal mode
    this.screen.write('\x1b[?25h');

    // Wire up Socket.IO events
    this.client.onStatus((status: ServerStatus) => {
      this.latestStatus = status;
      this.renderStatusBar();
    });

    this.client.onTerminalStatus((status: TerminalStatus) => {
      this.latestTerminalStatus = status;
      this.renderStatusBar();
    });

    this.client.onTerminalData((data: number[]) => {
      this.terminalArea.write(data);
    });

    this.client.onReplayProgress((progress: ReplayProgress) => {
      this.latestReplay = progress;
      if (progress.state !== 'running') {
        // Clear replay from status bar after completion
        setTimeout(() => {
          if (this.latestReplay === progress) {
            this.latestReplay = null;
            this.renderStatusBar();
          }
        }, 3000);
      }
      this.renderStatusBar();
    });

    this.client.onDisconnect(() => {
      this.statusBar.renderDisconnected(this.serverUrl);
      this.inputLine.render();
    });

    this.client.onConnect(() => {
      this.client.requestStatus();
    });

    // Request initial status
    this.client.requestStatus();

    // Handle terminal resize
    process.stdout.on('resize', () => {
      this.screen.onResize();
      this.renderStatusBar();
      this.inputLine.render();
    });

    // Handle raw stdin
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.on('data', (data: Buffer) => {
      if (this.shuttingDown) return;
      this.inputLine.handleKey(data);
    });

    // Handle SIGINT (Ctrl+C) gracefully
    process.on('SIGINT', () => {
      this.shutdown();
    });

    process.on('SIGTERM', () => {
      this.shutdown();
    });

    // Show welcome message in terminal area
    this.terminalArea.writeCommandOutput('connected', [
      chalk.green(`Connected to ${this.serverUrl}`),
      chalk.dim('Type to interact with the Altair. Press / or Escape for commands. /help for list.'),
    ]);
    this.inputLine.render();
  }

  shutdown(): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    // Save history
    this.history.save();

    // Disconnect client
    this.client.disconnect();

    // Restore terminal
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();

    // Leave full-screen
    this.screen.leaveScreen();

    process.stdout.write('Goodbye.\n');
    process.exit(0);
  }

  private handleCommand(line: string): void {
    this.history.add(line);
    this.history.reset();

    const context = {
      client: this.client,
      app: { shutdown: () => this.shutdown() },
      terminalArea: this.terminalArea,
    };

    // Dispatch asynchronously, re-render input line when done
    this.registry.dispatch(line, context).then(() => {
      this.inputLine.render();
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.terminalArea.writeCommandOutput('error', [chalk.red(msg)]);
      this.inputLine.render();
    });
  }

  private renderStatusBar(): void {
    if (this.latestStatus && this.latestTerminalStatus) {
      this.statusBar.render(
        this.latestStatus,
        this.latestTerminalStatus,
        this.latestReplay ?? undefined,
      );
    } else if (this.latestStatus) {
      // Use a default terminal status if we haven't received one yet
      const defaultTermStatus: TerminalStatus = {
        connected: false,
        device: '',
        config: {},
        preferred: {},
      };
      this.statusBar.render(
        this.latestStatus,
        defaultTermStatus,
        this.latestReplay ?? undefined,
      );
    }
    // Ensure input line cursor is restored after status bar update
    this.inputLine.render();
  }
}
