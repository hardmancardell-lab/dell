// Validates a model-supplied tool input against the tool's declared input_schema plus per-field rules the JSON
// schema cannot express (ticker shape, numeric ranges, string lengths). Model output is untrusted input: a
// hallucinated, malformed or prompt-injected call must come back as a tool ERROR the model can read, never run a
// skill with String(undefined) or an arbitrary string.

import type { LlmToolSchema } from "./llm-client";

export type ValidationResult = { ok: true; input: Record<string, unknown> } | { ok: false; error: string };

/** Equity/forex/crypto/futures symbols: letters, digits, . - = / ^ , up to 15 characters. */
export const TICKER_PATTERN = /^[A-Z0-9][A-Z0-9.\-=/^]{0,14}$/;

interface FieldRule {
  kind?: "ticker";
  maxLength?: number;
  minLength?: number;
  pattern?: RegExp;
  min?: number;
  max?: number;
  integer?: boolean;
  maxItems?: number;
}

const TICKER: FieldRule = { kind: "ticker" };

export const FIELD_RULES: Record<string, Record<string, FieldRule>> = {
  get_sector_fundamentals: { sector: { minLength: 1, maxLength: 60, pattern: /^[A-Za-z][A-Za-z &,.\-]*$/ } },
  get_security_analysis: { ticker: TICKER },
  get_sector_peer_ranking: { ticker: TICKER },
  get_quote: { ticker: TICKER },
  get_gex_signal: { ticker: TICKER },
  get_options_chain_summary: { ticker: TICKER },
  get_rolling_move_stats: { ticker: TICKER },
  get_correlations: { baseSymbol: TICKER, candidates: { maxItems: 12 } },
  get_crypto_regime: { etfFlowsMtdMusd: { min: -1_000_000, max: 1_000_000 } },
  get_catalyst_calendar: { days: { min: 1, max: 366, integer: true }, symbol: TICKER },
  open_paper_trading_ticket: {
    symbol: TICKER,
    strikePrice: { min: 0.0001, max: 1_000_000 },
    expirationDate: { pattern: /^\d{4}-\d{2}-\d{2}$/, maxLength: 10 },
  },
  submit_feedback: { message: { minLength: 1, maxLength: 2000 } },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function checkString(name: string, value: unknown, rule: FieldRule | undefined): string | { error: string } {
  if (typeof value !== "string") return { error: `'${name}' must be a string.` };
  let v = value.trim();
  if (rule?.kind === "ticker") {
    v = v.toUpperCase();
    if (!TICKER_PATTERN.test(v)) return { error: `'${name}' must be a ticker symbol such as AAPL, BTC-USD or GBP/JPY (letters, digits and . - = / ^ only, up to 15 characters).` };
    return v;
  }
  if (rule?.minLength !== undefined && v.length < rule.minLength) return { error: `'${name}' must not be empty.` };
  if (rule?.maxLength !== undefined && v.length > rule.maxLength) return { error: `'${name}' is too long (max ${rule.maxLength} characters).` };
  if (rule?.pattern && !rule.pattern.test(v)) return { error: `'${name}' has an invalid format.` };
  return v;
}

export function validateToolInput(schema: LlmToolSchema, toolName: string, raw: unknown): ValidationResult {
  if (raw === undefined || raw === null) raw = {};
  if (!isPlainObject(raw)) return { ok: false, error: "Tool input must be a JSON object." };
  const props = schema.input_schema.properties as Record<string, { type?: string; enum?: unknown[]; items?: { type?: string } }>;
  const rules = FIELD_RULES[toolName] ?? {};
  const out: Record<string, unknown> = {};

  for (const required of schema.input_schema.required ?? []) {
    if (raw[required] === undefined || raw[required] === null || raw[required] === "") {
      return { ok: false, error: `Missing required input '${required}'.` };
    }
  }

  for (const [name, def] of Object.entries(props)) {
    const value = raw[name];
    if (value === undefined || value === null) continue;
    const rule = rules[name];

    if (def.type === "string") {
      const checked = checkString(name, value, rule);
      if (typeof checked !== "string") return { ok: false, error: checked.error };
      if (def.enum && !def.enum.includes(checked)) return { ok: false, error: `'${name}' must be one of: ${def.enum.join(", ")}.` };
      out[name] = checked;
    } else if (def.type === "number" || def.type === "integer") {
      if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, error: `'${name}' must be a finite number.` };
      if (rule?.integer && !Number.isInteger(value)) return { ok: false, error: `'${name}' must be a whole number.` };
      if (rule?.min !== undefined && value < rule.min) return { ok: false, error: `'${name}' must be at least ${rule.min}.` };
      if (rule?.max !== undefined && value > rule.max) return { ok: false, error: `'${name}' must be at most ${rule.max}.` };
      out[name] = value;
    } else if (def.type === "array") {
      if (!Array.isArray(value)) return { ok: false, error: `'${name}' must be an array.` };
      if (rule?.maxItems !== undefined && value.length > rule.maxItems) return { ok: false, error: `'${name}' has too many items (max ${rule.maxItems}).` };
      const items: string[] = [];
      for (const item of value) {
        const checked = checkString(`${name}[]`, item, TICKER);
        if (typeof checked !== "string") return { ok: false, error: checked.error };
        items.push(checked);
      }
      out[name] = items;
    } else {
      return { ok: false, error: `Unsupported schema type for '${name}'.` };
    }
  }
  return { ok: true, input: out };
}
