import type {
  JournalEmotionTag,
  JournalFill,
  JournalFillSide,
  JournalInstrumentType,
  JournalPosition,
  JournalSource,
  JournalStatus,
} from "@/lib/agents/trading-agent/types";

/**
 * Plain-fetch Supabase REST CRUD for journal_positions/journal_fills — same
 * header/Prefer pattern as alerts-db.ts/paper-trading-db.ts. Real,
 * manually-entered trades (not simulated, not automated), kept in its own
 * file for the same reason as paper-trading-db.ts: real financial state.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function isJournalDbConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function requireConfig(): { url: string; key: string } {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase is not configured — SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are unset.");
  }
  return { url: SUPABASE_URL, key: SUPABASE_SERVICE_ROLE_KEY };
}

async function supabaseRequest<T>(
  path: string,
  init: { method: string; body?: unknown; prefer?: string }
): Promise<T> {
  const { url, key } = requireConfig();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: init.method,
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: init.prefer ?? "return=minimal",
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase request failed (${res.status}) for ${path}: ${text}`);
  }
  if (init.prefer === "return=representation") {
    return (await res.json()) as T;
  }
  return undefined as T;
}

interface FillRow {
  id: string;
  position_id: string;
  side: JournalFillSide;
  quantity: number;
  price: number;
  filled_at: string;
  note: string | null;
}

function toFill(row: FillRow): JournalFill {
  return {
    id: row.id,
    positionId: row.position_id,
    side: row.side,
    quantity: row.quantity,
    price: row.price,
    filledAt: row.filled_at,
    note: row.note,
  };
}

interface PositionRow {
  id: string;
  session_id: string | null;
  ticker: string;
  instrument_type: JournalInstrumentType;
  strike_price: number | null;
  expiration_date: string | null;
  source: JournalSource;
  strategy: string;
  strategy_other: string | null;
  thesis: string | null;
  stop_loss: number | null;
  target_price: number | null;
  emotion_tag: JournalEmotionTag | null;
  followed_plan: boolean | null;
  mistake_tags: string[] | null;
  status: JournalStatus;
  opened_at: string;
  closed_at: string | null;
  notes: string | null;
  created_at: string;
  fills?: FillRow[];
}

function toPosition(row: PositionRow): JournalPosition {
  return {
    id: row.id,
    ticker: row.ticker,
    instrumentType: row.instrument_type,
    strikePrice: row.strike_price,
    expirationDate: row.expiration_date,
    source: row.source,
    strategy: row.strategy,
    strategyOther: row.strategy_other,
    thesis: row.thesis,
    stopLoss: row.stop_loss,
    targetPrice: row.target_price,
    emotionTag: row.emotion_tag,
    followedPlan: row.followed_plan,
    mistakeTags: row.mistake_tags ?? [],
    status: row.status,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    notes: row.notes,
    createdAt: row.created_at,
    fills: (row.fills ?? []).map(toFill),
  };
}

const POSITION_SELECT = "*,fills:journal_fills(*)";

// Every journal_positions row is scoped to the anonymous session_id that
// created it — same pattern as paper_accounts/alert_subscriptions elsewhere
// in this app (no login system anywhere; a browser-local session id is the
// only identity concept this app has). Legacy rows created before this
// column existed have session_id IS NULL and stay visible to everyone
// (grandfathered — real-world impact is zero right now since there was
// only ever one real beta user before this scoping landed), but every row
// created from here on is strictly scoped to its owner.
function ownershipFilter(sessionId: string): string {
  return `or=(session_id.eq.${encodeURIComponent(sessionId)},session_id.is.null)`;
}

export async function createJournalPosition(input: {
  sessionId: string;
  ticker: string;
  instrumentType: JournalInstrumentType;
  strikePrice: number | null;
  expirationDate: string | null;
  source: JournalSource;
  strategy: string;
  strategyOther: string | null;
  thesis: string | null;
  stopLoss: number | null;
  targetPrice: number | null;
  emotionTag: JournalEmotionTag | null;
  openedAt: string;
}): Promise<JournalPosition> {
  const rows = await supabaseRequest<PositionRow[]>("journal_positions", {
    method: "POST",
    prefer: "return=representation",
    body: {
      session_id: input.sessionId,
      ticker: input.ticker,
      instrument_type: input.instrumentType,
      strike_price: input.strikePrice,
      expiration_date: input.expirationDate,
      source: input.source,
      strategy: input.strategy,
      strategy_other: input.strategyOther,
      thesis: input.thesis,
      stop_loss: input.stopLoss,
      target_price: input.targetPrice,
      emotion_tag: input.emotionTag,
      status: "open",
      opened_at: input.openedAt,
    },
  });
  return toPosition({ ...rows[0], fills: [] });
}

export async function getJournalPositions(sessionId: string): Promise<JournalPosition[]> {
  const rows = await supabaseRequest<PositionRow[]>(
    `journal_positions?select=${encodeURIComponent(POSITION_SELECT)}&${ownershipFilter(sessionId)}&order=opened_at.desc`,
    { method: "GET", prefer: "return=representation" }
  );
  return rows.map(toPosition);
}

export async function getJournalPositionById(id: string, sessionId: string): Promise<JournalPosition | null> {
  const rows = await supabaseRequest<PositionRow[]>(
    `journal_positions?id=eq.${encodeURIComponent(id)}&${ownershipFilter(sessionId)}&select=${encodeURIComponent(POSITION_SELECT)}`,
    { method: "GET", prefer: "return=representation" }
  );
  return rows[0] ? toPosition(rows[0]) : null;
}

export async function updateJournalPosition(
  id: string,
  sessionId: string,
  fields: Partial<{
    thesis: string | null;
    notes: string | null;
    stopLoss: number | null;
    targetPrice: number | null;
    emotionTag: JournalEmotionTag | null;
    followedPlan: boolean | null;
    mistakeTags: string[];
    status: JournalStatus;
    closedAt: string | null;
  }>
): Promise<JournalPosition> {
  const body: Record<string, unknown> = {};
  if ("thesis" in fields) body.thesis = fields.thesis;
  if ("notes" in fields) body.notes = fields.notes;
  if ("stopLoss" in fields) body.stop_loss = fields.stopLoss;
  if ("targetPrice" in fields) body.target_price = fields.targetPrice;
  if ("emotionTag" in fields) body.emotion_tag = fields.emotionTag;
  if ("followedPlan" in fields) body.followed_plan = fields.followedPlan;
  if ("mistakeTags" in fields) body.mistake_tags = fields.mistakeTags;
  if ("status" in fields) body.status = fields.status;
  if ("closedAt" in fields) body.closed_at = fields.closedAt;

  await supabaseRequest(`journal_positions?id=eq.${encodeURIComponent(id)}&${ownershipFilter(sessionId)}`, { method: "PATCH", body });
  const updated = await getJournalPositionById(id, sessionId);
  if (!updated) throw new Error("Position not found after update.");
  return updated;
}

export async function deleteJournalPosition(id: string, sessionId: string): Promise<void> {
  await supabaseRequest(`journal_positions?id=eq.${encodeURIComponent(id)}&${ownershipFilter(sessionId)}`, { method: "DELETE" });
}

export async function insertJournalFill(
  positionId: string,
  fill: { side: JournalFillSide; quantity: number; price: number; filledAt: string; note: string | null }
): Promise<JournalFill> {
  const rows = await supabaseRequest<FillRow[]>("journal_fills", {
    method: "POST",
    prefer: "return=representation",
    body: {
      position_id: positionId,
      side: fill.side,
      quantity: fill.quantity,
      price: fill.price,
      filled_at: fill.filledAt,
      note: fill.note,
    },
  });
  return toFill(rows[0]);
}
