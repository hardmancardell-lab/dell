// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/crypto-asset-class.test.mts
// Offline checks of the pure pieces behind crypto as a first-class asset class: symbol normalisation, the label,
// quantity rounding, the crypto-aware guards (ORB, wash-sale), and the watchlist-scan scope.
import * as S from "../src/lib/agents/trading-agent/crypto-symbol.ts";
import { assetClassLabel } from "../src/lib/agents/trading-agent/asset-class-label.ts";
import { checkWashSaleRisk } from "../src/lib/agents/trading-agent/skills/wash-sale-check.ts";
import { scanWatchlistOrb } from "../src/lib/agents/trading-agent/skills/opening-range-breakout-watchlist.ts";
import { isCryptoSymbol } from "../src/lib/data/coinbase.ts";

let bad = 0;
const t = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail);
};

// ---------------------------------------------------------------- symbol normalisation
t("a bare coin ticker gets the USD pair", S.normalizeCryptoSymbol("btc") === "BTC-USD" && S.normalizeCryptoSymbol(" Eth ") === "ETH-USD");
t("product ids pass through, any case", S.normalizeCryptoSymbol("sol-usd") === "SOL-USD" && S.normalizeCryptoSymbol("DOGE-USD") === "DOGE-USD");
t("slash, space and underscore forms become the dashed product id", ["btc/usd", "BTC USD", "btc_usd"].every((s) => S.normalizeCryptoSymbol(s) === "BTC-USD"));
t("non-USD quotes, forex pairs and junk are rejected, not rewritten", ["BTC-EUR", "EUR/USD-X", "", "   ", "-USD", "B", "WAYTOOLONGTICKER", "BTC-USD-USD", "A.B"].every((s) => S.normalizeCryptoSymbol(s) === null),
  JSON.stringify(["BTC-EUR", "EUR/USD-X", "", "-USD", "B", "WAYTOOLONGTICKER", "BTC-USD-USD", "A.B"].map(S.normalizeCryptoSymbol)));
t("every normalised symbol is accepted by the market-data router", ["btc", "eth/usd", "XRP-USD", "ada usd"].every((s) => isCryptoSymbol(S.normalizeCryptoSymbol(s))));
t("base ticker strips the quote currency", S.cryptoBaseTicker("btc-usd") === "BTC" && S.cryptoBaseTicker("AVAX-USD") === "AVAX");

// ---------------------------------------------------------------- per-class normalisation
t("crypto class normalises, others only trim and upper-case", S.normalizeSymbolForClass("btc", "crypto") === "BTC-USD" && S.normalizeSymbolForClass(" aapl ", "equity") === "AAPL" && S.normalizeSymbolForClass("eur/usd", "forex") === "EUR/USD");
t("an invalid crypto symbol is null; an empty symbol in any class is null", S.normalizeSymbolForClass("AAPL-EUR", "crypto") === null && S.normalizeSymbolForClass("  ", "equity") === null);
t("a stock ticker typed under crypto becomes a USD pair only if it fits the pattern (user can see it and fix it)", S.normalizeSymbolForClass("AAPL", "crypto") === "AAPL-USD");

// ---------------------------------------------------------------- quantities
t("rounding strips float noise but keeps a satoshi", S.roundCryptoQuantity(0.1 + 0.2) === 0.3 && S.roundCryptoQuantity(0.3 - 0.1 - 0.2) === 0 && S.roundCryptoQuantity(0.00000001) === 0.00000001);
t("rounding to 8 decimals drops anything below a satoshi", S.roundCryptoQuantity(0.000000004) === 0);

// ---------------------------------------------------------------- label
t("label", assetClassLabel("crypto") === "Crypto");

// ---------------------------------------------------------------- wash sale
{
  const sale = { id: "s1", symbol: "BTC-USD", sharesSold: 1, salePricePerShare: 50, fee: 0, costBasisPerShare: 100, realizedPnl: -50, saleDate: "2026-10-01", createdAt: "" };
  const lot = (assetClass: string, symbol: string) => ({ id: "h" + assetClass, symbol, assetClass, shares: 1, costBasisPerShare: 60, acquiredDate: "2026-10-10" });
  t("a quick crypto repurchase is not flagged as a wash sale", checkWashSaleRisk([sale], [lot("crypto", "BTC-USD")]).length === 0);
  t("the same pattern on an equity is still flagged", checkWashSaleRisk([{ ...sale, symbol: "SPY" }], [lot("equity", "SPY")]).length === 1);
}

// ---------------------------------------------------------------- ORB never scans crypto
{
  let msg = "";
  try { await scanWatchlistOrb([{ watchlistId: "default", symbol: "BTC-USD", assetClass: "crypto" }], 15, 3, ["crypto"]); } catch (e) { msg = String(e.message); }
  t("ORB refuses a crypto-only scope with a plain reason", /does not apply to crypto/.test(msg), msg);
  let msg2 = "";
  try { await scanWatchlistOrb([{ watchlistId: "default", symbol: "BTC-USD", assetClass: "crypto" }], 15, 3, ["equity", "crypto"]); } catch (e) { msg2 = String(e.message); }
  t("crypto entries are filtered out of a mixed scope (no equity symbols left to scan)", /No equity symbols/.test(msg2), msg2);
}

console.log(bad === 0 ? "\nall passed" : `\n${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
