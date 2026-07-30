import type { EconomicOutlook, ScorecardEntry } from "./types";

/**
 * Plain-fetch Supabase REST persistence for versioned Economic Outlook
 * snapshots — same header/Prefer pattern as analytics/supabase.ts and
 * alerts-db.ts. Snapshots are append-only (a "refresh" always inserts a new
 * row, never updates a past one) — see economic_outlook_schema.json's own
 * meta.prior_version_id field, which is what makes this a real version
 * history rather than an overwritten "current state."
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function isEconomicOutlookDbConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function requireConfig(): { url: string; key: string } {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase is not configured — SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are unset. See ECONOMIC_OUTLOOK_INTEGRATION_NOTES.md for the required tables.");
  }
  return { url: SUPABASE_URL, key: SUPABASE_SERVICE_ROLE_KEY };
}

async function supabaseRequest<T>(path: string, init: { method: string; body?: unknown; prefer?: string }): Promise<T> {
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
    cache: "no-store",
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

interface OutlookVersionRow {
  version_id: string;
  as_of_date: string;
  refresh_reason: string;
  prior_version_id: string | null;
  regime_label: string;
  data: EconomicOutlook;
  created_at: string;
}

export async function saveOutlookVersion(outlook: EconomicOutlook): Promise<void> {
  await supabaseRequest("economic_outlook_versions", {
    method: "POST",
    body: {
      version_id: outlook.meta.versionId,
      as_of_date: outlook.meta.asOfDate,
      refresh_reason: outlook.meta.refreshReason,
      prior_version_id: outlook.meta.priorVersionId,
      regime_label: outlook.regimeTag.label,
      data: outlook,
    },
  });
}

export async function getLatestOutlookVersion(): Promise<EconomicOutlook | null> {
  const rows = await supabaseRequest<OutlookVersionRow[]>("economic_outlook_versions?select=*&order=created_at.desc&limit=1", {
    method: "GET",
    prefer: "return=representation",
  });
  return rows[0]?.data ?? null;
}

export async function getOutlookVersionById(versionId: string): Promise<EconomicOutlook | null> {
  const rows = await supabaseRequest<OutlookVersionRow[]>(
    `economic_outlook_versions?select=*&version_id=eq.${encodeURIComponent(versionId)}&limit=1`,
    { method: "GET", prefer: "return=representation" }
  );
  return rows[0]?.data ?? null;
}

export async function listOutlookVersions(limit = 20): Promise<{ versionId: string; asOfDate: string; regimeLabel: string; createdAt: string }[]> {
  const rows = await supabaseRequest<OutlookVersionRow[]>(
    `economic_outlook_versions?select=version_id,as_of_date,regime_label,created_at&order=created_at.desc&limit=${limit}`,
    { method: "GET", prefer: "return=representation" }
  );
  return rows.map((r) => ({ versionId: r.version_id, asOfDate: r.as_of_date, regimeLabel: r.regime_label, createdAt: r.created_at }));
}

interface ScorecardRow {
  version_id: string;
  logged_date: string;
  regime_tag_at_call: string;
  house_view_path_at_call: string;
  key_falsification_triggers: string[];
  grading: ScorecardEntry["grading"];
}

function toScorecardEntry(row: ScorecardRow): ScorecardEntry {
  return {
    versionId: row.version_id,
    loggedDate: row.logged_date,
    regimeTagAtCall: row.regime_tag_at_call,
    houseViewPathAtCall: row.house_view_path_at_call,
    keyFalsificationTriggers: row.key_falsification_triggers,
    grading: row.grading,
  };
}

export async function appendScorecardEntry(entry: ScorecardEntry): Promise<void> {
  await supabaseRequest("economic_outlook_scorecard", {
    method: "POST",
    body: {
      version_id: entry.versionId,
      logged_date: entry.loggedDate,
      regime_tag_at_call: entry.regimeTagAtCall,
      house_view_path_at_call: entry.houseViewPathAtCall,
      key_falsification_triggers: entry.keyFalsificationTriggers,
      grading: entry.grading,
    },
  });
}

export async function listScorecardEntries(): Promise<ScorecardEntry[]> {
  const rows = await supabaseRequest<ScorecardRow[]>("economic_outlook_scorecard?select=*&order=logged_date.desc", {
    method: "GET",
    prefer: "return=representation",
  });
  return rows.map(toScorecardEntry);
}

/** Append-only: grading updates the SAME row (it's the outcome of a call already logged, not a new call), matched by version_id. */
export async function gradeScorecardEntry(versionId: string, grading: ScorecardEntry["grading"]): Promise<void> {
  await supabaseRequest(`economic_outlook_scorecard?version_id=eq.${encodeURIComponent(versionId)}`, {
    method: "PATCH",
    body: { grading },
  });
}
