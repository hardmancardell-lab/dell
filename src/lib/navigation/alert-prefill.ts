/**
 * Chart-to-alert: a horizontal line drawn on a chart becomes a pre-filled Price Threshold row on the Alerts tab.
 * The prefill travels in the navigation state (and so in the URL) as one value: "SYMBOL:above|below:price",
 * for example ?agent=trading&section=alerts&alert=AAPL:above:150.5. Pure functions, tested under plain Node.
 */
import type { AssetClass } from "@/lib/agents/trading-agent/types";
import { inferAssetClass } from "./study-routes";

export interface AlertPrefill {
  symbol: string;
  direction: "above" | "below";
  price: number;
  assetClass: AssetClass;
}

const ALERT_RE = /^([A-Za-z0-9^][A-Za-z0-9.=/^-]{0,19}):(above|below):(\d{1,9}(?:\.\d{1,8})?)$/;

export function formatAlertPrefill(a: { symbol: string; direction: "above" | "below"; price: number }): string | undefined {
  if (!Number.isFinite(a.price) || a.price <= 0 || a.price >= 1e9) return undefined;
  const price = Number(a.price.toFixed(6)).toString(); // plain decimal, no exponent
  const value = `${a.symbol.trim().toUpperCase()}:${a.direction}:${price}`;
  return ALERT_RE.test(value) ? value : undefined;
}

export function parseAlertPrefill(value: string | null | undefined, assetClass?: AssetClass): AlertPrefill | undefined {
  if (!value) return undefined;
  const m = ALERT_RE.exec(value);
  if (!m) return undefined;
  const symbol = m[1].toUpperCase();
  return { symbol, direction: m[2] as "above" | "below", price: Number(m[3]), assetClass: assetClass ?? inferAssetClass(symbol) };
}
