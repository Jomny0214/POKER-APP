// A minimal, dependency-free RFC 6455 WebSocket server built on Node's
// built-in `http` and `crypto` modules. The npm registry is unreachable in
// this environment, so this replaces the `ws` package: same basic surface
// (connection, message, close events; .send()), implemented directly
// against the wire protocol.

import { createHash, randomBytes } from "crypto";
import { EventEmitter } from "events";
import { IncomingMessage } from "http";
import type { Duplex } from "stream";

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const OPCODE = {
  CONTINUATION: 0x0,
  TEXT: 0x1,
  BINARY: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xa,
} as const;

function acceptKeyFor(clientKey: string): string {
  return createHash("sha1").update(clientKey + WS_MAGIC).digest("base64");
}

function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeUInt32BE(0, 2); // high 32 bits (messages are always < 4GB here)
    header.writeUInt32BE(len, 6);
  }
  return Buffer.concat([header, payload]);
}

interface ParsedFrame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
}

/** Attempts to parse one frame from the front of `buf`. Returns null if incomplete. */
function tryParseFrame(buf: Buffer): { frame: ParsedFrame; bytesConsumed: number } | null {
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;

  if (len === 126) {
    if (buf.length < offset + 2) return null;
    len = buf.readUInt16BE(offset);
    offset += 2;
  } else if (len === 127) {
    if (buf.length < offset + 8) return null;
    const high = buf.readUInt32BE(offset);
    const low = buf.readUInt32BE(offset + 4);
    if (high !== 0) throw new Error("Frame too large");
    len = low;
    offset += 8;
  }

  let maskKey: Buffer | null = null;
  if (masked) {
    if (buf.length < offset + 4) return null;
    maskKey = buf.subarray(offset, offset + 4);
    offset += 4;
  }

  if (buf.length < offset + len) return null;
  let payload = buf.subarray(offset, offset + len);
  if (masked && maskKey) {
    const unmasked = Buffer.alloc(len);
    for (let i = 0; i < len; i++) unmasked[i] = payload[i] ^ maskKey[i % 4];
    payload = unmasked;
  }

  return { frame: { fin, opcode, payload: Buffer.from(payload) }, bytesConsumed: offset + len };
}

export class WSConnection extends EventEmitter {
  public isAlive = true;
  private recvBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private fragmentOpcode: number | null = null;
  private fragmentChunks: Buffer[] = [];
  public data: Record<string, unknown> = {};

  constructor(private socket: Duplex) {
    super();
    socket.on("data", (chunk) => this.onData(chunk));
    socket.on("close", () => this.emit("close"));
    socket.on("error", (err) => this.emit("error", err));
  }

  private onData(chunk: Buffer): void {
    this.recvBuffer = this.recvBuffer.length ? Buffer.concat([this.recvBuffer, chunk]) : chunk;
    // Drain as many complete frames as are available.
    for (;;) {
      let parsed;
      try {
        parsed = tryParseFrame(this.recvBuffer);
      } catch (err) {
        this.emit("error", err);
        this.socket.destroy();
        return;
      }
      if (!parsed) return;
      this.recvBuffer = this.recvBuffer.subarray(parsed.bytesConsumed);
      this.handleFrame(parsed.frame);
    }
  }

  private handleFrame(frame: ParsedFrame): void {
    switch (frame.opcode) {
      case OPCODE.TEXT:
      case OPCODE.BINARY:
        if (!frame.fin) {
          this.fragmentOpcode = frame.opcode;
          this.fragmentChunks = [frame.payload];
        } else {
          this.emit("message", frame.payload.toString("utf8"));
        }
        break;
      case OPCODE.CONTINUATION:
        if (this.fragmentOpcode !== null) {
          this.fragmentChunks.push(frame.payload);
          if (frame.fin) {
            const full = Buffer.concat(this.fragmentChunks);
            this.fragmentOpcode = null;
            this.fragmentChunks = [];
            this.emit("message", full.toString("utf8"));
          }
        }
        break;
      case OPCODE.CLOSE:
        this.sendRaw(OPCODE.CLOSE, Buffer.alloc(0));
        this.socket.end();
        break;
      case OPCODE.PING:
        this.sendRaw(OPCODE.PONG, frame.payload);
        break;
      case OPCODE.PONG:
        this.isAlive = true;
        break;
    }
  }

  private sendRaw(opcode: number, payload: Buffer): void {
    if (this.socket.destroyed) return;
    try {
      this.socket.write(encodeFrame(opcode, payload));
    } catch {
      // socket already gone; nothing to do
    }
  }

  send(data: string): void {
    this.sendRaw(OPCODE.TEXT, Buffer.from(data, "utf8"));
  }

  ping(): void {
    this.sendRaw(OPCODE.PING, Buffer.alloc(0));
  }

  close(): void {
    this.sendRaw(OPCODE.CLOSE, Buffer.alloc(0));
    this.socket.end();
  }
}

export class WSServer extends EventEmitter {
  private connections = new Set<WSConnection>();

  constructor(private path: string) {
    super();
  }

  /** Call from the http.Server's 'upgrade' event. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, _head: Buffer): void {
    const url = req.url ?? "";
    if (!url.startsWith(this.path)) {
      socket.destroy();
      return;
    }
    const key = req.headers["sec-websocket-key"];
    if (!key || Array.isArray(key)) {
      socket.destroy();
      return;
    }
    const accept = acceptKeyFor(key);
    const responseHeaders = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n");
    socket.write(responseHeaders);

    const conn = new WSConnection(socket);
    conn.on("error", (err) => console.error("WebSocket connection error:", err));
    conn.on("error", (err) => console.error("WebSocket connection error:", err));
    this.connections.add(conn);
    conn.on("close", () => this.connections.delete(conn));
    this.emit("connection", conn, req);
  }

  clients(): Set<WSConnection> {
    return this.connections;
  }

  /** Heartbeat: ping everyone, terminate anyone that didn't pong since the last sweep. */
  startHeartbeat(intervalMs = 30000): NodeJS.Timeout {
    return setInterval(() => {
      for (const conn of this.connections) {
        if (!conn.isAlive) {
          conn.close();
          this.connections.delete(conn);
          continue;
        }
        conn.isAlive = false;
        conn.ping();
      }
    }, intervalMs);
  }
}

export function randomSecret(bytes = 24): string {
  return randomBytes(bytes).toString("hex");
}
