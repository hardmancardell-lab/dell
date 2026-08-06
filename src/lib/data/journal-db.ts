import type { JournalEntry, JournalInstrumentType, JournalStatus } from "@/lib/agents/trading-agent/types";

/**
 * Plain-fetch Supabase REST CRUD for journal_entries — same header/Prefer
 * pattern as alerts-db.ts/paper-trading-db.ts. Real, manually-entered
 * discretionary trades (not simulated, not automated), kept in its own file
 * for the same reason as paper-trading-db.ts: real financial state.
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

interface JournalRow {
  id: string;
  ticker: string;
  instrument_type: JournalInstrumentType;
  strike_price: number | null;
  expiration_date: string | null;
  quantity: number;
  entry_price: number;
  entry_date: string;
  thesis: string | null;
  exit_price: number | null;
  exit_date: string | null;
  status: JournalStatus;
  realized_pnl: number | null;
  notes: string | null;
  created_at: string;
}

function toEntry(row: JournalRow): JournalEntry {
  return {
    id: row.id,
    ticker: row.ticker,
    instrumentType: row.instrument_type,
    strikePrice: row.strike_price,
    expirationDate: row.expiration_date,
    quantity: row.quantity,
    entryPrice: row.entry_price,
    entryDate: row.entry_date,
    thesis: row.thesis,
    exitPrice: row.exit_price,
    exitDate: row.exit_date,
    status: row.status,
    realizedPnl: row.realized_pnl,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export async function createJournalEntry(input: {
  ticker: string;
  instrumentType: JournalInstrumentType;
  strikePrice: number | null;
  expirationDate: string | null;
  quantity: number;
  entryPrice: number;
  entryDate: string;
  thesis: string | null;
}): Promise<JournalEntry> {
  const rows = await supabaseRequest<JournalRow[]>("journal_entries", {
    method: "POST",
    prefer: "return=representation",
    body: {
      ticker: input.ticker,
      instrument_type: input.instrumentType,
      strike_price: input.strikePrice,
      expiration_date: input.expirationDate,
      quantity: input.quantity,
      entry_price: input.entryPrice,
      entry_date: input.entryDate,
      thesis: input.thesis,
      status: "open",
    },
  });
  return toEntry(rows[0]);
}

export async function getJournalEntries(): Promise<JournalEntry[]> {
  const rows = await supabaseRequest<JournalRow[]>("journal_entries?order=entry_date.desc", {
    method: "GET",
    prefer: "return=representation",
  });
  return rows.map(toEntry);
}

export async function getJournalEntryById(id: string): Promise<JournalEntry | null> {
  const rows = await supabaseRequest<JournalRow[]>(`journal_entries?id=eq.${encodeURIComponent(id)}`, {
    method: "GET",
    prefer: "return=representation",
  });
  return rows[0] ? toEntry(rows[0]) : null;
}

export async function closeJournalEntry(
  id: string,
  fields: { exitPrice: number; exitDate: string; realizedPnl: number; notes: string | null }
): Promise<JournalEntry> {
  const rows = await supabaseRequest<JournalRow[]>(`journal_entries?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: {
      exit_price: fields.exitPrice,
      exit_date: fields.exitDate,
      realized_pnl: fields.realizedPnl,
      notes: fields.notes,
      status: "closed",
    },
  });
  return toEntry(rows[0]);
}

export async function updateJournalEntry(
  id: string,
  fields: Partial<{ thesis: string | null; notes: string | null }>
): Promise<JournalEntry> {
  const body: Record<string, unknown> = {};
  if ("thesis" in fields) body.thesis = fields.thesis;
  if ("notes" in fields) body.notes = fields.notes;
  const rows = await supabaseRequest<JournalRow[]>(`journal_entries?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    prefer: "return=representation",
    body,
  });
  return toEntry(rows[0]);
}

export async function deleteJournalEntry(id: string): Promise<void> {
  await supabaseRequest(`journal_entries?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
}
