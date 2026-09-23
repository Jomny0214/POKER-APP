import { router, requireAuth, HttpError } from "./routes";
import { sendJson, Ctx } from "./router";
import { resolveSession, isAdmin } from "../auth";
import { findById } from "../db/users";
import {
  tournamentManager,
  TOURNAMENT_VARIANTS,
  TournamentRow,
  EntryRow,
} from "../tournament/TournamentManager";
import { BLIND_PRESETS, BLIND_PRESET_LABELS } from "../tournament/blindSchedules";
import { paidSpots, computePayouts } from "../tournament/payouts";

function requester(ctx: Ctx) {
  const auth = ctx.req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
  return token ? resolveSession(token) : null;
}

function requireAdmin(ctx: Ctx) {
  const user = requester(ctx);
  if (!user || !isAdmin(user)) throw new HttpError(403, "Admin only");
  return user;
}

function entryCounts(entries: EntryRow[]) {
  return {
    registered: entries.filter((e) => e.status === "registered").length,
    active: entries.filter((e) => e.status === "active").length,
    busted: entries.filter((e) => e.status === "busted").length,
    total: entries.length,
  };
}

function summarize(t: TournamentRow) {
  const entries = tournamentManager.entries(t.id);
  const levels = JSON.parse(t.blind_schedule);
  return {
    id: t.id,
    name: t.name,
    variantId: t.variant_id,
    tableSize: t.table_size,
    buyin: t.buyin,
    startingStack: t.starting_stack,
    rebuyAllowed: !!t.rebuy_allowed,
    rebuyPrice: t.rebuy_price,
    rebuyPeriodType: t.rebuy_period_type,
    rebuyPeriodValue: t.rebuy_period_value,
    maxTables: t.max_tables,
    scheduledStartAt: t.scheduled_start_at,
    status: t.status,
    currentLevel: t.current_level,
    levelStartedAt: t.level_started_at,
    currentLevelInfo: levels[Math.min(t.current_level, levels.length - 1)] ?? null,
    totalLevels: levels.length,
    prizePool: t.prize_pool,
    startedAt: t.started_at,
    finishedAt: t.finished_at,
    entrants: entryCounts(entries),
    paidSpots: paidSpots(entries.length),
  };
}

router.get("/api/tournaments/meta", async (ctx) => {
  sendJson(ctx.res, 200, {
    variants: TOURNAMENT_VARIANTS,
    presets: Object.entries(BLIND_PRESETS).map(([id, levels]) => ({
      id,
      label: BLIND_PRESET_LABELS[id],
      levels,
    })),
  });
});

router.get("/api/tournaments", async (ctx) => {
  const list = tournamentManager.list().map(summarize);
  sendJson(ctx.res, 200, { tournaments: list });
});

router.get("/api/tournaments/:id", async (ctx) => {
  const t = tournamentManager.get(ctx.params.id);
  if (!t) throw new HttpError(404, "Tournament not found");
  const entries = tournamentManager.entries(t.id);
  const standings = entries
    .slice()
    .sort((a, b) => {
      if (a.finish_rank && b.finish_rank) return a.finish_rank - b.finish_rank;
      if (a.finish_rank) return 1;
      if (b.finish_rank) return -1;
      return b.stack - a.stack;
    })
    .map((e) => ({
      username: e.username,
      status: e.status,
      stack: e.stack,
      tableNo: e.table_no,
      finishRank: e.finish_rank,
      payout: e.payout,
      rebuysUsed: e.rebuys_used,
    }));

  let you: { registered: boolean; status?: string; tableId?: string; finishRank?: number | null; payout?: number | null } = {
    registered: false,
  };
  if (ctx.userId) {
    const entry = tournamentManager.entryFor(t.id, ctx.userId);
    if (entry) {
      const table = tournamentManager.tableFor(t.id, ctx.userId);
      you = {
        registered: true,
        status: entry.status,
        tableId: table?.id,
        finishRank: entry.finish_rank,
        payout: entry.payout,
      };
    }
  }

  sendJson(ctx.res, 200, {
    ...summarize(t),
    blindSchedule: JSON.parse(t.blind_schedule),
    payoutPreview: computePayouts(t.prize_pool, Math.max(entries.length, 1)),
    standings,
    you,
  });
});

router.post("/api/admin/tournaments", async (ctx) => {
  requireAuth(ctx);
  const admin = requireAdmin(ctx);
  const body = ctx.body as {
    name?: string;
    variantId?: string;
    tableSize?: number;
    buyin?: number;
    startingStack?: number;
    rebuyAllowed?: boolean;
    rebuyPrice?: number;
    rebuyPeriodType?: "levels" | "minutes";
    rebuyPeriodValue?: number;
    maxTables?: number;
    scheduledStartAt?: number;
    blindPreset?: string;
    customBlindSchedule?: unknown;
  };
  try {
    const t = tournamentManager.create(admin.id, {
      name: body.name ?? "",
      variantId: body.variantId ?? "",
      tableSize: Number(body.tableSize),
      buyin: Number(body.buyin),
      startingStack: Number(body.startingStack),
      rebuyAllowed: !!body.rebuyAllowed,
      rebuyPrice: body.rebuyPrice !== undefined ? Number(body.rebuyPrice) : undefined,
      rebuyPeriodType: body.rebuyPeriodType,
      rebuyPeriodValue: body.rebuyPeriodValue !== undefined ? Number(body.rebuyPeriodValue) : undefined,
      maxTables: Number(body.maxTables),
      scheduledStartAt: Number(body.scheduledStartAt),
      blindPreset: body.blindPreset,
      customBlindSchedule: body.customBlindSchedule as any,
    });
    sendJson(ctx.res, 201, summarize(t));
  } catch (err) {
    sendJson(ctx.res, 400, { error: (err as Error).message });
  }
});

router.post("/api/admin/tournaments/:id/force-end", async (ctx) => {
  requireAuth(ctx);
  requireAdmin(ctx);
  try {
    tournamentManager.forceEnd(ctx.params.id);
    sendJson(ctx.res, 200, summarize(tournamentManager.get(ctx.params.id)!));
  } catch (err) {
    sendJson(ctx.res, 400, { error: (err as Error).message });
  }
});

router.post("/api/tournaments/:id/register", async (ctx) => {
  const userId = requireAuth(ctx);
  const user = findById(userId);
  if (!user) throw new HttpError(401, "Not authenticated");
  try {
    const t = tournamentManager.register(ctx.params.id, userId, user.username);
    sendJson(ctx.res, 200, summarize(t));
  } catch (err) {
    sendJson(ctx.res, 400, { error: (err as Error).message });
  }
});

router.post("/api/tournaments/:id/unregister", async (ctx) => {
  const userId = requireAuth(ctx);
  try {
    const t = tournamentManager.unregister(ctx.params.id, userId);
    sendJson(ctx.res, 200, summarize(t));
  } catch (err) {
    sendJson(ctx.res, 400, { error: (err as Error).message });
  }
});

router.post("/api/tournaments/:id/rebuy", async (ctx) => {
  const userId = requireAuth(ctx);
  try {
    const entry = tournamentManager.rebuy(ctx.params.id, userId);
    sendJson(ctx.res, 200, { entry });
  } catch (err) {
    sendJson(ctx.res, 400, { error: (err as Error).message });
  }
});
