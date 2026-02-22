/**
 * Command registration and dispatch for FDC+ CLI.
 */

import chalk from 'chalk';
import { FdcClient } from '../client';
import { TerminalArea } from '../screen/terminal-area';

export interface CommandContext {
  client: FdcClient;
  app: {
    shutdown(): void;
  };
  terminalArea: TerminalArea;
}

export interface CommandDef {
  name: string;
  aliases: string[];
  description: string;
  usage?: string;
  execute(args: string[], context: CommandContext): Promise<void>;
}

export class CommandRegistry {
  private commands: Map<string, CommandDef> = new Map();

  /** Register a command definition. */
  register(cmd: CommandDef): void {
    this.commands.set(cmd.name, cmd);
  }

  /** Parse and dispatch a command line. */
  async dispatch(line: string, context: CommandContext): Promise<void> {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;

    const parts = trimmed.split(/\s+/);
    const name = parts[0].toLowerCase();
    const args = parts.slice(1);

    const cmd = this.findCommand(name);
    if (!cmd) {
      context.terminalArea.writeCommandOutput(name, [
        chalk.red(`Unknown command: ${name}. Type "help" for available commands.`),
      ]);
      return;
    }

    try {
      await cmd.execute(args, context);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      context.terminalArea.writeCommandOutput(name, [chalk.red(`Error: ${message}`)]);
    }
  }

  /** Return all registered commands. */
  getAll(): CommandDef[] {
    return Array.from(this.commands.values());
  }

  /** Return command names/aliases matching a partial string. */
  getCompletions(partial: string): string[] {
    const lower = partial.toLowerCase();
    const matches: string[] = [];

    for (const cmd of this.commands.values()) {
      if (cmd.name.startsWith(lower)) {
        matches.push(cmd.name);
      }
      for (const alias of cmd.aliases) {
        if (alias.startsWith(lower)) {
          matches.push(alias);
        }
      }
    }

    return matches.sort();
  }

  /** Find a command by name or alias. */
  private findCommand(name: string): CommandDef | undefined {
    // Direct name match
    const direct = this.commands.get(name);
    if (direct) return direct;

    // Alias match
    for (const cmd of this.commands.values()) {
      if (cmd.aliases.includes(name)) return cmd;
    }

    return undefined;
  }
}
