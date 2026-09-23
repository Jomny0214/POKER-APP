import { Router, sendJson, readJsonBody, Ctx } from "./router";
import { register, login, createSession, destroySession, publicUser, resolveSession, isAdmin } from "../auth";
import { getBalance, credit, debit, ledgerHistory, InsufficientFundsError } from "../db/wallet";
import { tableManager } from "../table/TableManager";
import { UserExistsError, findByUsername, listAll } from "../db/users";

export const router = new Router();

export function requireAuth(ctx: Ctx): string {
  if (!ctx.userId) throw new HttpError(401, "Not authenticated");
  return ctx.userId;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

router.post("/api/auth/register", async (ctx) => {
  const body = ctx.body as { email?: string; username?: string; password?: string };
  try {
    const user = register(body.email ?? "", body.username ?? "", body.password ?? "");
    const token = createSession(user.id);
    sendJson(ctx.res, 201, { user: publicUser(user), token, balance: getBalance(user.id) });
  } catch (err) {
    const status = err instanceof UserExistsError ? 409 : 400;
    sendJson(ctx.res, status, { error: (err as Error).message });
  }
});

router.post("/api/auth/login", async (ctx) => {
  const body = ctx.body as { email?: string; password?: string };
  try {
    const user = login(body.email ?? "", body.password ?? "");
    const token = createSession(user.id);
    sendJson(ctx.res, 200, { user: publicUser(user), token, balance: getBalance(user.id) });
  } catch (err) {
    sendJson(ctx.res, 401, { error: (err as Error).message });
  }
});

router.post("/api/auth/logout", async (ctx) => {
  const auth = ctx.req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
  if (token) destroySession(token);
  sendJson(ctx.res, 200, { ok: true });
});

router.get("/api/me", async (ctx) => {
  const userId = requireAuth(ctx);
  const user = resolveSession((ctx.req.headers.authorization ?? "").slice(7));
  sendJson(ctx.res, 200, { user: user ? publicUser(user) : null, balance: getBalance(userId) });
});

router.get("/api/wallet/balance", async (ctx) => {
  const userId = requireAuth(ctx);
  sendJson(ctx.res, 200, { balance: getBalance(userId) });
});

router.get("/api/wallet/history", async (ctx) => {
  const userId = requireAuth(ctx);
  sendJson(ctx.res, 200, { entries: ledgerHistory(userId) });
});

router.post("/api/wallet/deposit", async (ctx) => {
  const userId = requireAuth(ctx);
  const requester = resolveSession((ctx.req.headers.authorization ?? "").slice(7));
  if (!requester || !isAdmin(requester)) {
    sendJson(ctx.res, 403, { error: "Deposits are managed by the site admin. Ask them to credit your account." });
    return;
  }
  const body = ctx.body as { amount?: number };
  const amount = Math.floor(Number(body.amount));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    sendJson(ctx.res, 400, { error: "Invalid amount" });
    return;
  }
  const balance = credit(userId, "deposit", amount, "simulated-deposit");
  sendJson(ctx.res, 200, { balance });
});

// Admin-only: list every registered player and their current balance, so the
// admin can see exactly who exists before crediting them.
router.get("/api/admin/players", async (ctx) => {
  requireAuth(ctx);
  const requester = resolveSession((ctx.req.headers.authorization ?? "").slice(7));
  if (!requester || !isAdmin(requester)) {
    sendJson(ctx.res, 403, { error: "Admin only" });
    return;
  }
  const players = listAll().map((u) => ({ username: u.username, balance: getBalance(u.id) }));
  sendJson(ctx.res, 200, { players });
});

router.post("/api/admin/credit", async (ctx) => {
  requireAuth(ctx);
  const requester = resolveSession((ctx.req.headers.authorization ?? "").slice(7));
  if (!requester || !isAdmin(requester)) {
    sendJson(ctx.res, 403, { error: "Admin only" });
    return;
  }
  const body = ctx.body as { username?: string; amount?: number };
  const username = (body.username ?? "").trim();
  const amount = Math.floor(Number(body.amount));
  if (!username) {
    sendJson(ctx.res, 400, { error: "Username required" });
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    sendJson(ctx.res, 400, { error: "Invalid amount" });
    return;
  }
  const target = findByUsername(username);
  if (!target) {
    sendJson(ctx.res, 404, { error: "No player with that username" });
    return;
  }
  const balance = credit(target.id, "deposit", amount, `admin-credit-by-${requester.id}`);
  sendJson(ctx.res, 200, { balance, username: target.username });
});

router.post("/api/wallet/withdraw", async (ctx) => {
  const userId = requireAuth(ctx);
  const body = ctx.body as { amount?: number };
  const amount = Math.floor(Number(body.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    sendJson(ctx.res, 400, { error: "Invalid amount" });
    return;
  }
  try {
    const balance = debit(userId, "withdrawal", amount, "simulated-withdrawal");
    sendJson(ctx.res, 200, { balance });
  } catch (err) {
    if (err instanceof InsufficientFundsError) {
      sendJson(ctx.res, 400, { error: "Insufficient balance" });
    } else {
      sendJson(ctx.res, 500, { error: "Withdrawal failed" });
    }
  }
});

router.get("/api/tables", async (ctx) => {
  sendJson(ctx.res, 200, { tables: tableManager.list() });
});

export async function handleApi(ctx: Ctx): Promise<boolean> {
  const url = new URL(ctx.req.url ?? "/", "http://internal");
  const match = router.match(ctx.req.method ?? "GET", url.pathname);
  if (!match) return false;

  ctx.params = match.params;
  ctx.query = url.searchParams;

  const auth = ctx.req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
  ctx.userId = token ? resolveSession(token)?.id ?? null : null;

  if (ctx.req.method === "POST" || ctx.req.method === "PUT") {
    try {
      ctx.body = await readJsonBody(ctx.req);
    } catch (err) {
      sendJson(ctx.res, 400, { error: (err as Error).message });
      return true;
    }
  }

  try {
    await match.handler(ctx);
  } catch (err) {
    if (err instanceof HttpError) {
      sendJson(ctx.res, err.status, { error: err.message });
    } else {
      console.error(err);
      sendJson(ctx.res, 500, { error: "Internal server error" });
    }
  }
  return true;
}
