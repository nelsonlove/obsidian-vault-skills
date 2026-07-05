import * as net from "node:net";
import * as fs from "node:fs";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";

/** SDK Transport for a single Unix-socket connection (newline-delimited JSON-RPC). */
export class UnixSocketConnTransport implements Transport {
  onmessage?: (m: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (e: Error) => void;

  private buf = "";
  private started = false;

  constructor(private readonly conn: net.Socket) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.conn.setEncoding("utf8");
    this.conn.on("data", (chunk: string) => {
      this.buf += chunk;
      let nl: number;
      while ((nl = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, nl).trim();
        this.buf = this.buf.slice(nl + 1);
        if (!line) continue;
        try { this.onmessage?.(JSON.parse(line) as JSONRPCMessage); }
        catch (e) { this.onerror?.(e as Error); }
      }
    });
    this.conn.on("close", () => this.onclose?.());
    this.conn.on("error", (e) => this.onerror?.(e));
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    if (this.conn.destroyed) return;
    const data = JSON.stringify(message) + "\n";
    await new Promise<void>((res, rej) => this.conn.write(data, (err) => (err ? rej(err) : res())));
  }

  async close(): Promise<void> { this.conn.destroy(); }
}

/** Listens on a Unix socket and hands each connection to `onConnection` as its own
 *  transport, so concurrent Claude Code sessions each get an independent server. */
export class UnixSocketListener {
  private server: net.Server | null = null;
  private conns = new Set<net.Socket>();

  constructor(
    private readonly socketPath: string,
    private readonly onConnection: (transport: UnixSocketConnTransport) => void,
  ) {}

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) { reject(new Error("already listening")); return; }
      try { fs.unlinkSync(this.socketPath); } catch { /* none */ }
      const server = net.createServer((conn) => {
        this.conns.add(conn);
        conn.on("close", () => this.conns.delete(conn));
        conn.on("error", () => { /* surfaced via the transport once started */ });
        this.onConnection(new UnixSocketConnTransport(conn));
      });
      this.server = server;
      const onListenErr = (e: Error) => reject(e);
      server.once("error", onListenErr);
      server.listen(this.socketPath, () => {
        server.off("error", onListenErr);
        try {
          fs.chmodSync(this.socketPath, 0o600);
        } catch (e) {
          server.close();
          this.server = null;
          try { fs.unlinkSync(this.socketPath); } catch { /* none */ }
          reject(e as Error);
          return;
        }
        server.on("error", (e) => console.error("[vault-skills] socket server error", e));
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    for (const conn of this.conns) conn.destroy();
    this.conns.clear();
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
    this.server = null;
    try { fs.unlinkSync(this.socketPath); } catch { /* already gone */ }
  }
}
