import { IncomingMessage, ServerResponse } from "http";
import fs from "fs";
import path from "path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export function serveStatic(root: string) {
  const absRoot = path.resolve(root);
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    const url = new URL(req.url ?? "/", "http://internal");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";
    const filePath = path.join(absRoot, pathname);
    if (!filePath.startsWith(absRoot)) {
      res.writeHead(403);
      res.end("Forbidden");
      return true;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return false;
    }
    const ext = path.extname(filePath);
    const contentType = MIME[ext] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(res);
    return true;
  };
}
