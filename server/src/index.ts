import http from "http";
import path from "path";
import "./db/database"; // ensure schema is created on boot
import { handleApi } from "./http/routes";
import { serveStatic } from "./http/static";
import { WSServer } from "./ws/websocket";
import { handleConnection } from "./ws/handlers";
import { Ctx } from "./http/router";

const PORT = Number(process.env.PORT ?? 8080);
const CLIENT_DIR = path.join(__dirname, "..", "..", "client");

const serveClientFile = serveStatic(CLIENT_DIR);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://internal");
  if (url.pathname.startsWith("/api/")) {
    const ctx: Ctx = { req, res, params: {}, query: url.searchParams, userId: null, body: undefined };
    const handled = await handleApi(ctx);
    if (!handled) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    }
    return;
  }

  if (serveClientFile(req, res)) return;

  // SPA fallback: unknown non-API, non-file paths get index.html
  const indexCtxHandled = serveStatic(CLIENT_DIR)({ ...req, url: "/index.html" } as any, res);
  if (!indexCtxHandled) {
    res.writeHead(404);
    res.end("Not found");
  }
});

const wss = new WSServer("/ws");
server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head);
});
wss.on("connection", (conn) => handleConnection(conn));
wss.startHeartbeat();

server.listen(PORT, () => {
  console.log(`Poker server listening on http://0.0.0.0:${PORT}`);
  console.log(`WebSocket endpoint: ws://0.0.0.0:${PORT}/ws`);
});
