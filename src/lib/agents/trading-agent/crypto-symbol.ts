// Pure, zero-dependency helpers for crypto symbols, kept out of src/lib/data/coinbase.ts so client components can
// import them without pulling server-side fetch code into the browser bundle. The product-id shape here matches
// coinbase.isCryptoSymbol exactly ("BTC-USD": a coin ticker, a dash and USD).

const PRODUCT_ID = /^[A-Z0-9]{2,10}-USD$/;

/**
 * Turns whatever a user types into a Coinbase USD product id, or null when it cannot be one. "btc", "BTC", "btc/usd",
 * "BTC USD" and "eth-usd" all work; a bare coin ticker gets the USD pair. Only USD pairs are supported (that is all the
 * market-data layer routes to Coinbase), so "BTC-EUR" and "EUR/USD" return null rather than being rewritten.
 */
export function normalizeCryptoSymbol(raw: string): string | null {
  const t = raw.trim().toUpperCase().replace(/[\s/_]+/g, "-");
  if (!t) return null;
  const pair = t.includes("-") ? t : `${t}-USD`;
  return PRODUCT_ID.test(pair) ? pair : null;
}

/** The coin ticker without the quote currency: "BTC-USD" -> "BTC". */
export function cryptoBaseTicker(productId: string): string {
  return productId.trim().toUpperCase().replace(/-USD$/, "");
}

/**
 * Normalizes a symbol for storage under an asset class: crypto symbols become product ids (BTC -> BTC-USD), every other
 * class is just trimmed and upper-cased exactly as before. Returns null for crypto input that is not a valid USD pair.
 */
export function normalizeSymbolForClass(raw: string, assetClass: string): string | null {
  if (assetClass === "crypto") return normalizeCryptoSymbol(raw);
  const trimmed = raw.trim().toUpperCase();
  return trimmed || null;
}

/** Share and coin quantities are kept to 8 decimals (one satoshi), which also strips float noise like 0.30000000000000004. */
export function roundCryptoQuantity(q: number): number {
  return Math.round(q * 1e8) / 1e8;
}
