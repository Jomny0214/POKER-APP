import { Router, sendJson, readJsonBody, Ctx } from "./router";
import { register, login, createSession, destroySession, publicUser, resolveSession, isAdmin } from "../auth";
import { getBalance, credit, debit, ledgerHistory, InsufficientFundsError } from "../db/wallet";
import { tableManager } from "../table/TableManager";
import { UserExistsError, findByUsername, listAll } from "../db/users";
import {
  createDepositRequest,
  listMyDepositRequests,
  listPendingDepositRequests,
  approveDepositRequest,
  rejectDepositRequest,
} from "../db/deposits";
import {
  sendPlayerMessage,
  sendAdminMessage,
  listMessagesForUser,
  listChatThreads,
  markThreadReadByAdmin,
  markThreadReadByPlayer,
} from "../db/chat";

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
  requireAuth(ctx);python3 - << 'PY'
  path = "client/js/lobby.js"
  with open(path) as f:
      content = f.read()

      if "player-log-mount" in content:
          print("Already present, skipping.")
          else:
              import_anchor = 'import { renderDepositPanel } from "./deposits.js";'
                  call_anchor = 'renderDepositPanel(root.querySelector("#deposit-panel-mount"), currentUser);'
                      div_anchor = '<div id="deposit-panel-mount"></div>'

                          if import_anchor not in content or call_anchor not in content or div_anchor not in content:
                                  print("ANCHOR NOT FOUND -- stop and tell Claude, do not proceed further.")
                                      else:
                                              content = content.replace(
                                                          import_anchor,
                                                                      import_anchor + '\nimport { renderPlayerLog } from "./playerlog.js";'
                                                                              )
                                                                                      content = content.replace(
                                                                                                  div_anchor,
                                                                                                              div_anchor + '\n    <div id="player-log-mount"></div>'
                                                                                                                      )
                                                                                                                              content = content.replace(
                                                                                                                                          call_anchor,
                                                                                                                                                      call_anchor + '\n  renderPlayerLog(root.querySelector("#player-log-mount"), currentUser);'
                                                                                                                                                              )
                                                                                                                                                                      with open(path, "w") as f:
                                                                                                                                                                                  f.write(content)
                                                                                                                                                                                          print("lobby.js updated OK")
                                                                                                                                                                                          PY
                                                                                                                                                                                          
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

// Player submits a claim that they made a real bank transfer. This does NOT
// credit chips -- it only creates a pending request the admin reviews.
router.post("/api/deposits/request", async (ctx) => {
  const userId = requireAuth(ctx);
  const requester = resolveSession((ctx.req.headers.authorization ?? "").slice(7));
  const body = ctx.body as { amount?: number; note?: string };
  try {
    const request = createDepositRequest(userId, requester?.username ?? "", Number(body.amount), body.note);
    sendJson(ctx.res, 201, { request });
  } catch (err) {
    sendJson(ctx.res, 400, { error: (err as Error).message });
  }
});

// Player sees their own deposit requests (pending/approved/rejected).
router.get("/api/deposits/mine", async (ctx) => {
  const userId = requireAuth(ctx);
  sendJson(ctx.res, 200, { requests: listMyDepositRequests(userId) });
});

// Admin-only: every currently pending deposit request, across all players.
router.get("/api/admin/deposits/pending", async (ctx) => {
  requireAuth(ctx);
  const requester = resolveSession((ctx.req.headers.authorization ?? "").slice(7));
  if (!requester || !isAdmin(requester)) {
    sendJson(ctx.res, 403, { error: "Admin only" });
    return;
  }
  sendJson(ctx.res, 200, { requests: listPendingDepositRequests() });
});

// Admin-only: confirms the real bank transfer arrived -- credits chips.
router.post("/api/admin/deposits/:id/approve", async (ctx) => {
  requireAuth(ctx);
  const requester = resolveSession((ctx.req.headers.authorization ?? "").slice(7));
  if (!requester || !isAdmin(requester)) {
    sendJson(ctx.res, 403, { error: "Admin only" });
    return;
  }
  try {
    const request = approveDepositRequest(Number(ctx.params.id), requester.id);
    sendJson(ctx.res, 200, { request });
  } catch (err) {
    sendJson(ctx.res, 400, { error: (err as Error).message });
  }
});

// Admin-only: declines a request (no matching transfer found) -- no chips move.
router.post("/api/admin/deposits/:id/reject", async (ctx) => {
  requireAuth(ctx);
  const requester = resolveSession((ctx.req.headers.authorization ?? "").slice(7));
  if (!requester || !isAdmin(requester)) {
    sendJson(ctx.res, 403, { error: "Admin only" });
    return;
  }
  try {
    const request = rejectDepositRequest(Number(ctx.params.id), requester.id);
    sendJson(ctx.res, 200, { request });
  } catch (err) {
    sendJson(ctx.res, 400, { error: (err as Error).message });
  }
});

router.post("/api/chat/send", async (ctx) => {
  const userId = requireAuth(ctx);
  const requester = resolveSession((ctx.req.headers.authorization ?? "").slice(7));
  if (!requester) {
    sendJson(ctx.res, 401, { error: "Not authenticated" });
    return;
  }
  const body = ctx.body as { message?: string };
  try {
    const msg = sendPlayerMessage(userId, requester.username, body.message ?? "");
    sendJson(ctx.res, 200, { message: msg });
  } catch (err) {
    sendJson(ctx.res, 400, { error: (err as Error).message });
  }
});

router.get("/api/chat/mine", async (ctx) => {
  const userId = requireAuth(ctx);
  const messages = listMessagesForUser(userId);
  markThreadReadByPlayer(userId);
  sendJson(ctx.res, 200, { messages });
});

router.get("/api/admin/chat/threads", async (ctx) => {
  requireAuth(ctx);
  const requester = resolveSession((ctx.req.headers.authorization ?? "").slice(7));
  if (!requester || !isAdmin(requester)) {
    sendJson(ctx.res, 403, { error: "Admin only" });
    return;
  }
  const threads = listChatThreads();
  sendJson(ctx.res, 200, { threads });
});

router.get("/api/admin/chat/:userId", async (ctx) => {
  requireAuth(ctx);
  const requester = resolveSession((ctx.req.headers.authorization ?? "").slice(7));
  if (!requester || !isAdmin(requester)) {
    sendJson(ctx.res, 403, { error: "Admin only" });
    return;
  }
  const messages = listMessagesForUser(ctx.params.userId);
  markThreadReadByAdmin(ctx.params.userId);
  sendJson(ctx.res, 200, { messages });
});

router.post("/api/admin/chat/:userId/send", async (ctx) => {
  requireAuth(ctx);
  const requester = resolveSession((ctx.req.headers.authorization ?? "").slice(7));
  if (!requester || !isAdmin(requester)) {
    sendJson(ctx.res, 403, { error: "Admin only" });
    return;
  }
  const body = ctx.body as { message?: string; username?: string };
  try {
    const msg = sendAdminMessage(ctx.params.userId, body.username ?? "Player", body.message ?? "");
    sendJson(ctx.res, 200, { message: msg });
python3 - << 'PY'
path = "client/js/api.js"
with open(path) as f:
    content = f.read()
    
    if "chatSend:" in content:
        print("Already present, skipping.")
        else:
            addition = """
              chatSend: (message) =>
                  request("/api/chat/send", { method: "POST", body: JSON.stringify({ message }) }),
                    chatMine: () => request("/api/chat/mine"),
                      adminChatThreads: () => request("/api/admin/chat/threads"),
                        adminChatThread: (userId) => request(`/api/admin/chat/${userId}`),
                          adminChatSend: (userId, username, message) =>
                              request(`/api/admin/chat/${userId}/send`, { method: "POST", body: JSON.stringify({ username, message }) }),
                              """
                                  idx = content.rindex("};")
                                      content = content[:idx] + addition + content[idx:]
                                          with open(path, "w") as f:
                                                  f.write(content)
                                                      print("api.js updated OK (chat methods added)")
                                                      PY
                                                        } catch (err) {
    sendJson(ctx.res, 400, { error: (err as Error).message });
  }
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
