import { randomBytes, createHash } from "crypto";
import type { AdvisorClient, PortfolioHolding } from "@/lib/agents/trading-agent/types";

/**
 * Plain-fetch Supabase REST CRUD for advisor_clients/advisor_client_holdings
 * — same header/Prefer pattern as journal-db.ts/alerts-db.ts/paper-trading-db.ts.
 * Real, per-client server-side holdings (not the anonymous/localStorage-only
 * Portfolio Tracker) so a client link works from the client's own device,
 * not just the advisor's browser.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function isAdvisorClientsDbConfigured(): boolean {
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

/** A lightweight PIN gate for a client link, not a full auth system — sha256 is enough for this threat model (a leaked link, not a targeted attack on stored credentials). */
export function hashPasscode(passcode: string): string {
  return createHash("sha256").update(passcode.trim()).digest("hex");
}

function generateSlug(): string {
  // URL-safe, unguessable, short enough to read out loud/paste into a text — 8 bytes as base64url.
  return randomBytes(8).toString("base64url");
}

interface ClientRow {
  id: string;
  slug: string;
  name: string;
  passcode_hash: string;
  cash_balance: number;
  linked_email: string | null;
  user_id: string | null;
  created_at: string;
}

function rowToClient(row: ClientRow): AdvisorClient {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    cashBalance: Number(row.cash_balance) || 0,
    linkedEmail: row.linked_email,
    createdAt: row.created_at,
  };
}

export async function createAdvisorClient(
  name: string,
  passcode: string,
  cashBalance = 0,
  linkedEmail: string | null = null
): Promise<AdvisorClient> {
  const rows = await supabaseRequest<ClientRow[]>("advisor_clients", {
    method: "POST",
    prefer: "return=representation",
    body: {
      slug: generateSlug(),
      name,
      passcode_hash: hashPasscode(passcode),
      cash_balance: cashBalance,
      linked_email: linkedEmail ? linkedEmail.trim().toLowerCase() : null,
    },
  });
  return rowToClient(rows[0]);
}

export async function updateAdvisorClient(
  slug: string,
  updates: { cashBalance?: number; linkedEmail?: string | null }
): Promise<AdvisorClient> {
  const body: Record<string, unknown> = {};
  if (updates.cashBalance !== undefined) body.cash_balance = updates.cashBalance;
  if (updates.linkedEmail !== undefined) {
    body.linked_email = updates.linkedEmail ? updates.linkedEmail.trim().toLowerCase() : null;
  }
  const rows = await supabaseRequest<ClientRow[]>("advisor_clients?slug=eq." + encodeURIComponent(slug), {
    method: "PATCH",
    prefer: "return=representation",
    body,
  });
  return rowToClient(rows[0]);
}

/**
 * Self-service lookup for a logged-in (Supabase Auth) user: returns the
 * advisor client already linked to them (user_id match), or — the first
 * time they ever hit this after signing up — one matching their email via
 * linked_email, which is then permanently linked (user_id set) so this
 * fallback only ever fires once per client. Lazy linking done here instead
 * of a DB trigger so it self-heals regardless of trigger timing/casing.
 */
export async function getAdvisorClientByUser(userId: string, email: string): Promise<AdvisorClient | null> {
  const byUserId = await supabaseRequest<ClientRow[]>(
    `advisor_clients?user_id=eq.${encodeURIComponent(userId)}&select=*`,
    { method: "GET", prefer: "return=representation" }
  );
  if (byUserId.length > 0) return rowToClient(byUserId[0]);

  const byEmail = await supabaseRequest<ClientRow[]>(
    `advisor_clients?linked_email=eq.${encodeURIComponent(email.trim().toLowerCase())}&user_id=is.null&select=*`,
    { method: "GET", prefer: "return=representation" }
  );
  if (byEmail.length === 0) return null;
  if (byEmail.length > 1) {
    // Two unlinked client rows share this email — auto-linking to either one
    // would risk handing this user someone else's portfolio. Refuse and
    // require an advisor to resolve the duplicate manually.
    throw new Error(
      `${byEmail.length} unlinked advisor_clients rows share the email ${email.trim().toLowerCase()} — refusing to auto-link. Resolve the duplicate linked_email manually.`
    );
  }

  const linked = await supabaseRequest<ClientRow[]>(
    `advisor_clients?id=eq.${encodeURIComponent(byEmail[0].id)}`,
    { method: "PATCH", prefer: "return=representation", body: { user_id: userId } }
  );
  return rowToClient(linked[0]);
}

export async function listAdvisorClients(): Promise<AdvisorClient[]> {
  const rows = await supabaseRequest<ClientRow[]>("advisor_clients?select=*&order=created_at.desc", {
    method: "GET",
    prefer: "return=representation",
  });
  return rows.map(rowToClient);
}

export async function getAdvisorClientBySlug(slug: string): Promise<(AdvisorClient & { passcodeHash: string }) | null> {
  const rows = await supabaseRequest<ClientRow[]>(`advisor_clients?slug=eq.${encodeURIComponent(slug)}&select=*`, {
    method: "GET",
    prefer: "return=representation",
  });
  if (rows.length === 0) return null;
  return { ...rowToClient(rows[0]), passcodeHash: rows[0].passcode_hash };
}

export async function deleteAdvisorClient(slug: string): Promise<void> {
  await supabaseRequest("advisor_clients?slug=eq." + encodeURIComponent(slug), { method: "DELETE" });
}

interface HoldingRow {
  id: string;
  client_id: string;
  symbol: string;
  asset_class: string;
  shares: number;
  cost_basis_per_share: number;
  acquired_date: string;
  option_right: string | null;
  strike_price: number | null;
  expiration_date: string | null;
  underlying_symbol: string | null;
  contract_multiplier: number | null;
}

function rowToHolding(row: HoldingRow): PortfolioHolding {
  return {
    id: row.id,
    symbol: row.symbol,
    assetClass: row.asset_class as PortfolioHolding["assetClass"],
    shares: row.shares,
    costBasisPerShare: row.cost_basis_per_share,
    acquiredDate: row.acquired_date,
    optionRight: (row.option_right as PortfolioHolding["optionRight"]) ?? null,
    strikePrice: row.strike_price,
    expirationDate: row.expiration_date,
    underlyingSymbol: row.underlying_symbol,
    contractMultiplier: row.contract_multiplier,
  };
}

export async function listClientHoldings(clientId: string): Promise<PortfolioHolding[]> {
  const rows = await supabaseRequest<HoldingRow[]>(
    `advisor_client_holdings?client_id=eq.${encodeURIComponent(clientId)}&select=*&order=created_at.asc`,
    { method: "GET", prefer: "return=representation" }
  );
  return rows.map(rowToHolding);
}

export async function createClientHolding(
  clientId: string,
  input: Omit<PortfolioHolding, "id">
): Promise<PortfolioHolding> {
  const rows = await supabaseRequest<HoldingRow[]>("advisor_client_holdings", {
    method: "POST",
    prefer: "return=representation",
    body: {
      client_id: clientId,
      symbol: input.symbol,
      asset_class: input.assetClass,
      shares: input.shares,
      cost_basis_per_share: input.costBasisPerShare,
      acquired_date: input.acquiredDate,
      option_right: input.optionRight ?? null,
      strike_price: input.strikePrice ?? null,
      expiration_date: input.expirationDate ?? null,
      underlying_symbol: input.underlyingSymbol ?? null,
      contract_multiplier: input.contractMultiplier ?? null,
    },
  });
  return rowToHolding(rows[0]);
}

export async function deleteClientHolding(holdingId: string): Promise<void> {
  await supabaseRequest("advisor_client_holdings?id=eq." + encodeURIComponent(holdingId), { method: "DELETE" });
}
