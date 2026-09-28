import { Router, sendJson, readJsonBody, Ctx } from "./router";
import { register, login, createSession, destroySession, publicUser, resolveSession, isAdmin } from "../auth";
import { getBalance, credit, debit, ledgerHistory, InsufficientFundsError } from "../db/wallet";
import { totalHouseRevenue, houseRevenueHistory } from "../db/houseRevenue";
import { getPublicKeyPem, verifyHandSignature } from "../db/handSigning";
import { recordLoginFingerprint, getClientIp, listCollusionFlags, resolveCollusionFlag } from "../db/collusion";
import { db } from "../db/database";
import { tableManager } from "../table/TableManager";
import { UserExistsError, findByUsername, listAll } from "../db/users";
import {
  createDepositRequest,
  listMyDepositRequests,
  listPendingDepositRequests,
  approveDepositRequest,
  rejectDepositRequest,
} from "../db/deposits";
import { submitKyc, getMyLatestKyc, listPendingKyc, getKycDetail, approveKyc, rejectKyc, KycError } from "../db/kyc";
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
    recordLoginFingerprint(user.id, getClientIp(ctx.req), ctx.req.headers["user-agent"] ?? "");
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
    recordLoginFingerprint(user.id, getClientIp(ctx.req), ctx.req.headers["user-agent"] ?? "");
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

// Admin-only: the house's running take from cash-game rake and tournament
// registration fees, plus a recent activity feed for auditing.
router.get("/api/admin/house-revenue", async (ctx) => {
  requireAuth(ctx);
  const requester = resolveSession((ctx.req.headers.authorization ?? "").slice(7));
  if (!requester || !isAdmin(requester)) {
    sendJson(ctx.res, 403, { error: "Admin only" });
    return;
  }
  const totals = totalHouseRevenue();
  const recent = houseRevenueHistory(100);
  sendJson(ctx.res, 200, { totals, recent });
});

// Public: the server's Ed25519 public signing key, so anyone -- a player,
// an independent auditor -- can verify a hand's signature themselves
// without having to trust this server's own /verify endpoint below.
router.get("/api/verify/publickey", async (ctx) => {
  sendJson(ctx.res, 200, { algorithm: "ed25519", publicKey: getPublicKeyPem() });
});

// Public: re-hashes a stored hand record and checks it against its stored
// signature. A mismatch means the row was altered after the hand settled.
router.get("/api/hands/:id/verify", async (ctx) => {
  const row = db
    .prepare(`SELECT id, table_id, variant, started_at, ended_at, data, hash, signature FROM hand_history WHERE id = ?`)
    .get(ctx.params.id) as
    | { id: string; table_id: string; variant: string; started_at: number; ended_at: number; data: string; hash: string | null; signature: string | null }
    | undefined;
  if (!row) {
    sendJson(ctx.res, 404, { error: "Hand not found" });
    return;
  }
  if (!row.hash || !row.signature) {
    sendJson(ctx.res, 200, { handId: row.id, valid: false, reason: "unsigned" });
    return;
  }
  const valid = verifyHandSignature(row.data, row.hash, row.signature);
  sendJson(ctx.res, 200, {
    handId: row.id,
    tableId: row.table_id,
    variant: row.variant,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    hash: row.hash,
    signature: row.signature,
    valid,
  });
});

// Admin-only: anti-collusion / anti-multi-accounting flags (shared-IP
// seating, one-directional chip-dumping between two accounts). These are
// signals for human review, not automated enforcement -- see db/collusion.ts.
router.get("/api/admin/collusion-flags", async (ctx) => {
  requireAuth(ctx);
  const requester = resolveSession((ctx.req.headers.authorization ?? "").slice(7));
  if (!requester || !isAdmin(requester)) {
    sendJson(ctx.res, 403, { error: "Admin only" });
    return;
  }
  sendJson(ctx.res, 200, { flags: listCollusionFlags(100) });
});

router.post("/api/admin/collusion-flags/:id/resolve", async (ctx) => {
  requireAuth(ctx);
  const requester = resolveSession((ctx.req.headers.authorization ?? "").slice(7));
  if (!requester || !isAdmin(requester)) {
    sendJson(ctx.res, 403, { error: "Admin only" });
    return;
  }
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) {
    sendJson(ctx.res, 400, { error: "Invalid flag id" });
    return;
  }
  resolveCollusionFlag(id);
  sendJson(ctx.res, 200, { ok: true });
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

// Simple in-house identity verification -- a player submits their details
// and an ID photo; an admin reviews and approves/rejects by eye (see
// db/kyc.ts). Not a third-party KYC/AML vendor integration, by design.
router.post("/api/kyc/submit", async (ctx) => {
  const userId = requireAuth(ctx);
  const requester = resolveSession((ctx.req.headers.authorization ?? "").slice(7));
  const body = ctx.body as {
    fullName?: string;
    dateOfBirth?: string;
    address?: string;
    idType?: string;
    idNumber?: string;
    idImageData?: string;
  };
  try {
    const submission = submitKyc(userId, requester?.username ?? "", {
      fullName: body.fullName ?? "",
      dateOfBirth: body.dateOfBirth ?? "",
      address: body.address ?? "",
      idType: body.idType ?? "",
      idNumber: body.idNumber ?? "",
      idImageData: body.idImageData ?? "",
    });
    sendJson(ctx.res, 201, {
      submission: { id: submission.id, status: submission.status, submittedAt: submission.submitted_at },
    });
  } catch (err) {
    const status = err instanceof KycError ? 400 : 500;
    sendJson(ctx.res, status, { error: (err as Error).message });
  }
});

// Player's own latest verification status (and their submitted details, so
// they can see what they sent and why it might have been rejected).
router.get("/api/kyc/mine", async (ctx) => {
  const userId = requireAuth(ctx);
  const submission = getMyLatestKyc(userId);
  if (!submission) {
    sendJson(ctx.res, 200, { status: "unverified", submission: null });
    return;
  }
  sendJson(ctx.res, 200, {
    status: submission.status,
    submission: {
      id: submission.id,
      fullName: submission.full_name,
      dateOfBirth: submission.date_of_birth,
      address: submission.address,
      idType: submission.id_type,
      idNumber: submission.id_number,
      idImageData: submission.id_image_data,
      submittedAt: submission.submitted_at,
      resolvedAt: submission.resolved_at,
      rejectionReason: submission.rejection_reason,
    },
  });
});

// Admin-only: the review queue -- pending submissions, without the (large)
// image payload. See /api/admin/kyc/:id for the full detail + photo.
router.get("/api/admin/kyc/pending", async (ctx) => {
  requireAuth(ctx);
  const requester = resolveSession((ctx.req.headers.authorization ?? "").slice(7));
  if (!requester || !isAdmin(requester)) {
    sendJson(ctx.res, 403, { error: "Admin only" });
    return;
  }
  sendJson(ctx.res, 200, { pending: listPendingKyc() });
});

// Admin-only: full detail for one submission, including the ID photo.
router.get("/api/admin/kyc/:id", async (ctx) => {
  requireAuth(ctx);
  const requester = resolveSession((ctx.req.headers.authorization ?? "").slice(7));
  if (!requester || !isAdmin(requester)) {
    sendJson(ctx.res, 403, { error: "Admin only" });
    return;
  }
  const id = Number(ctx.params.id);
  const submission = Number.isFinite(id) ? getKycDetail(id) : null;
  if (!submission) {
    sendJson(ctx.res, 404, { error: "Submission not found" });
    return;
  }
  sendJson(ctx.res, 200, {
    submission: {
      id: submission.id,
      username: submission.username,
      fullName: submission.full_name,
      dateOfBirth: submission.date_of_birth,
      address: submission.address,
      idType: submission.id_type,
      idNumber: submission.id_number,
      idImageData: submission.id_image_data,
      status: submission.status,
      submittedAt: submission.submitted_at,
    },
  });
});

router.post("/api/admin/kyc/:id/approve", async (ctx) => {
  requireAuth(ctx);
  const requester = resolveSession((ctx.req.headers.authorization ?? "").slice(7));
  if (!requester || !isAdmin(requester)) {
    sendJson(ctx.res, 403, { error: "Admin only" });
    return;
  }
  const id = Number(ctx.params.id);
  try {
    const submission = approveKyc(id, requester.id);
    sendJson(ctx.res, 200, { status: submission.status });
  } catch (err) {
    sendJson(ctx.res, 400, { error: (err as Error).message });
  }
});

router.post("/api/admin/kyc/:id/reject", async (ctx) => {
  requireAuth(ctx);
  const requester = resolveSession((ctx.req.headers.authorization ?? "").slice(7));
  if (!requester || !isAdmin(requester)) {
    sendJson(ctx.res, 403, { error: "Admin only" });
    return;
  }
  const id = Number(ctx.params.id);
  const body = ctx.body as { reason?: string };
  try {
    const submission = rejectKyc(id, requester.id, body.reason ?? "");
    sendJson(ctx.res, 200, { status: submission.status });
  } catch (err) {
    sendJson(ctx.res, 400, { error: (err as Error).message });
  }
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
    // KYC submissions carry a base64-encoded ID photo, which blows well past
    // the default 1MB body cap -- everything else stays at the tight default.
    const maxBytes = url.pathname === "/api/kyc/submit" ? 7_000_000 : undefined;
    try {
      ctx.body = await readJsonBody(ctx.req, maxBytes);
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
