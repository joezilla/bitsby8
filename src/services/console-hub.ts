/**
 * Console abstraction (Bitsby8 Story 1.6, AD-6) — one pattern over two targets.
 *
 * A `ConsoleHub` is a per-target bidirectional byte stream with N subscribers.
 * Its source is a single-subscriber serial channel (the emulated card exposes
 * exactly one TX callback via `onOutput`); the hub becomes that one callback and
 * fans output out to every subscriber (the "shared TX multiplexer" AD-6
 * requires). Subscriber input flows back to the machine via `write`. Browser
 * (socket.io) and, later, MCP are just subscribers.
 */

/** Anything that wants console output (a browser socket, an MCP reader, a log). */
export interface ConsoleSubscriber {
  onOutput(data: Uint8Array): void;
}

/** A pluggable console source — the designated serial channel of a running
 * machine (or, structurally, the physical serial terminal). */
export interface IConsoleSource {
  /** Register the single TX callback (the hub installs itself here). */
  onOutput(cb: (byte: number) => void): void;
  /** Deliver one input byte to the machine (RX). */
  writeByte(byte: number): void;
}

/** A cursor-delimited slice of recent console output (for request/response
 * readers like MCP tools). `cursor` is a monotonic total-bytes counter. */
export interface ConsoleRead {
  data: string;
  cursor: number;
}

const MAX_CONSOLE_BUFFER = 64 * 1024;

export class ConsoleHub {
  private subscribers = new Set<ConsoleSubscriber>();
  /** Rolling recent-output buffer + a monotonic total-bytes cursor, so a
   * request/response reader (MCP) can poll output it wasn't subscribed for. */
  private buffer = '';
  private totalBytes = 0;

  constructor(private readonly source: IConsoleSource) {
    // Shared TX multiplexer: the hub is the source's single output handler.
    this.source.onOutput((byte) => {
      const b = byte & 0xff;
      // Always buffer (even with no live subscribers) so MCP can read history.
      this.buffer += String.fromCharCode(b);
      this.totalBytes++;
      if (this.buffer.length > MAX_CONSOLE_BUFFER) {
        this.buffer = this.buffer.slice(this.buffer.length - MAX_CONSOLE_BUFFER);
      }
      if (this.subscribers.size === 0) return;
      const buf = Uint8Array.of(b);
      for (const sub of this.subscribers) {
        try {
          sub.onOutput(buf);
        } catch {
          /* a bad subscriber must not stall the machine's TX */
        }
      }
    });
  }

  /** Read console output since `cursor` (0 = from the start of the buffer).
   * Returns the new bytes and the next cursor. */
  readSince(cursor = 0): ConsoleRead {
    const bufferStart = this.totalBytes - this.buffer.length;
    const from = Math.max(0, cursor - bufferStart);
    const data = from < this.buffer.length ? this.buffer.slice(from) : '';
    return { data, cursor: this.totalBytes };
  }

  /** Attach a subscriber; returns an unsubscribe function. */
  subscribe(sub: ConsoleSubscriber): () => void {
    this.subscribers.add(sub);
    return () => {
      this.subscribers.delete(sub);
    };
  }

  /** Deliver input from a subscriber to the machine (RX). */
  write(data: Uint8Array | string): void {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    for (const b of bytes) this.source.writeByte(b & 0xff);
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }
}

/** A serial channel shape shared by the seed cards' console channels. */
interface SerialChannelLike {
  onTransmit(cb: (byte: number) => void): void;
  enqueueRx(byte: number): void;
}

function isSerialChannel(v: unknown): v is SerialChannelLike {
  return (
    !!v &&
    typeof (v as SerialChannelLike).onTransmit === 'function' &&
    typeof (v as SerialChannelLike).enqueueRx === 'function'
  );
}

/**
 * Duck-type a console source out of a built card. Seed serial cards expose
 * their console channel under a known accessor (`channelA` on the IMSAI SIO,
 * `port0` on the MITS 2SIO). Returns null if the card has no console channel.
 */
export function consoleSourceFromCard(card: unknown): IConsoleSource | null {
  const c = card as Record<string, unknown>;
  const channel = [c?.channelA, c?.port0, c?.channel].find(isSerialChannel);
  if (!channel) return null;
  return {
    onOutput: (cb) => channel.onTransmit(cb),
    writeByte: (byte) => channel.enqueueRx(byte & 0xff),
  };
}
