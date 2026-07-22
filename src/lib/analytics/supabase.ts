const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

export interface AnalyticsEvent {
  sessionId: string;
  eventName: string;
  agent?: string | null;
  tab?: string | null;
  symbol?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Direct REST insert via Supabase's PostgREST API — same plain-fetch, no-SDK
 * convention as every other data provider client in this app (alpaca.ts,
 * tradier.ts, oanda.ts). See SUPABASE_INTEGRATION_NOTES.md for the table
 * schema this expects.
 */
export async function insertAnalyticsEvent(event: AnalyticsEvent): Promise<void> {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured — SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are unset.");
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY as string,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      session_id: event.sessionId,
      event_name: event.eventName,
      agent: event.agent ?? null,
      tab: event.tab ?? null,
      symbol: event.symbol ?? null,
      metadata: event.metadata ?? null,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase insert failed (${res.status}): ${text}`);
  }
}
