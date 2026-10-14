// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/crypto-portfolio.test.mts
// Offline checks of crypto in the portfolio tracker: fractional valuation, the Crypto allocation slice and its stable colour,
// rebalancing with fractional units, the analytics and shock-scan exclusions. Valuation runs in the app's mock-data mode, so no network.
process.env.MARKET_DATA_MOCK_MODE = "true";

const V = await import("../src/lib/agents/trading-agent/skills/portfolio-valuation.ts");
const C = await import("../src/lib/agents/trading-agent/allocation-colors.ts");
const R = await import("../src/lib/agents/trading-agent/skills/portfolio-rebalancing.ts");
const SHOCK = await import("../src/lib/agents/trading-agent/skills/portfolio-shock-scan.ts");
const ANALYTICS = await import("../src/lib/agents/trading-agent/skills/portfolio-analytics.ts");

let bad = 0;
const t = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail);
};
const near = (a: number | null, b: number, tol = 1e-9) => a !== null && Math.abs(a - b) <= tol;
const holding = (over = {}) => ({ id: "h1", symbol: "BTC-USD", assetClass: "crypto", shares: 0.015, costBasisPerShare: 60000, acquiredDate: "2026-04-14", ...over });

// ---------------------------------------------------------------- fractional valuation
{
  const f = V.computeValuationFigures(holding(), 90000, 183);
  t("a fractional position is cost x quantity with no rounding to whole units", near(f.costBasisTotal, 900) && near(f.currentValue, 1350), JSON.stringify(f));
  t("unrealised P&L and HPR follow", near(f.unrealizedPL, 450) && near(f.unrealizedPLPercent, 50));
  t("annualised return compounds over the 183 days held", near(f.annualizedReturnPercent, (Math.pow(1.5, 365 / 183) - 1) * 100));
  const tiny = V.computeValuationFigures(holding({ shares: 0.00000001, costBasisPerShare: 50000 }), 100000, 10);
  t("one satoshi values correctly", near(tiny.currentValue, 0.001) && near(tiny.costBasisTotal, 0.0005), JSON.stringify(tiny));
  const sub = V.computeValuationFigures(holding({ symbol: "DOGE-USD", shares: 1500.5, costBasisPerShare: 0.1 }), 0.15, 30);
  t("a sub-dollar coin keeps its precision", near(sub.currentValue, 225.075) && near(sub.costBasisTotal, 150.05), JSON.stringify(sub));
  const equity = V.computeValuationFigures({ ...holding(), symbol: "AAPL", assetClass: "equity", shares: 10, costBasisPerShare: 100 }, 110, 0);
  t("equity maths is unchanged (and a same-day holding has no annualised figure)", near(equity.currentValue, 1100) && equity.annualizedReturnPercent === null);
  const option = V.computeValuationFigures({ ...holding(), symbol: "X", assetClass: "option", shares: 2, costBasisPerShare: 1.5 }, 2, 0);
  t("option contracts keep their x100 multiplier", near(option.currentValue, 400) && near(option.costBasisTotal, 300));
}

// ---------------------------------------------------------------- end to end in mock mode
{
  const holdings = [
    holding({ id: "c1", symbol: "BTC-USD", shares: 0.25, costBasisPerShare: 50000 }),
    holding({ id: "e1", symbol: "SPY", assetClass: "equity", shares: 3, costBasisPerShare: 400 }),
    holding({ id: "bad", symbol: "AAPL-EUR", shares: 1, costBasisPerShare: 100 }), // not a USD pair
  ];
  const summary = await V.valuatePortfolio(holdings);
  const btc = summary.valuations.find((v) => v.holding.id === "c1");
  t("a crypto holding is priced from the crypto quote path", btc.error === null && btc.currentPrice > 0 && near(btc.currentValue, btc.currentPrice * 0.25), JSON.stringify(btc));
  t("crypto gets no sector and no market cap", btc.sector === null && btc.marketCapUsd === null);
  const bad1 = summary.valuations.find((v) => v.holding.id === "bad");
  t("a non-USD-pair symbol under Crypto is refused, not priced through the equity path", bad1.error !== null && /not a Coinbase USD pair/.test(bad1.error) && bad1.currentValue === null, JSON.stringify(bad1));
  const cls = summary.allocationByAssetClass;
  const crypto = cls.find((s) => s.label === "Crypto");
  t("the asset-class allocation has a Crypto slice with its share of value", crypto && near(crypto.value, btc.currentValue) && near(crypto.percent, (btc.currentValue / summary.totalValue) * 100), JSON.stringify(cls));
  t("the slices add up to 100%", near(cls.reduce((s, x) => s + x.percent, 0), 100, 1e-6));
  t("the sector chart shows Crypto as its own slice, not a 'no sector data' bucket", summary.allocationBySector.some((s) => s.label === "Crypto") && !summary.allocationBySector.some((s) => /Crypto \(no sector/.test(s.label)), JSON.stringify(summary.allocationBySector));
  t("the valuation states the crypto data caveat", summary.dataLimitations.some((d) => /Coinbase's last trade/.test(d)));
  const eqOnly = await V.valuatePortfolio([holdings[1]]);
  t("an equity-only portfolio does not mention crypto", !eqOnly.dataLimitations.some((d) => /Crypto/.test(d)));
}

// ---------------------------------------------------------------- allocation helpers and colour
{
  const mk = (sector, assetClass) => ({ sector, holding: { assetClass } });
  t("sector bucket label", V.sectorBucketLabel(mk("Technology", "equity")) === "Technology" && V.sectorBucketLabel(mk(null, "crypto")) === "Crypto" && V.sectorBucketLabel(mk(null, "forex")) === "Forex (no sector data)");
  const a = ["Equity", "Crypto", "Bond"], b = ["Crypto", "Equity", "Bond"], c = ["Equity", "Bond"];
  t("Crypto has the same colour wherever it sits in the chart", C.allocationSliceColor(a, 1) === C.allocationSliceColor(b, 0) && C.allocationSliceColor(a, 1) === "#f7931a");
  t("Crypto's colour is not one of the rotating palette colours", !C.ALLOCATION_COLORS.includes("#f7931a"));
  t("adding a Crypto slice does not recolour the others", C.allocationSliceColor(a, 0) === C.allocationSliceColor(c, 0) && C.allocationSliceColor(a, 2) === C.allocationSliceColor(c, 1));
  t("slices still get distinct colours", new Set(["A", "B", "C", "D"].map((_, i) => C.allocationSliceColor(["A", "B", "C", "D"], i))).size === 4);
}

// ---------------------------------------------------------------- rebalancing with fractional units
{
  const rows = R.computeRebalancing(
    [{ symbol: "BTC-USD", currentValue: 1000, currentPrice: 100000 }, { symbol: "SPY", currentValue: 9000, currentPrice: 500 }],
    [{ symbol: "BTC-USD", targetPercent: 20 }, { symbol: "SPY", targetPercent: 80 }]
  );
  t("rebalancing sizes a fractional coin amount", near(rows[0].deltaValue, 1000) && near(rows[0].deltaShares, 0.01) && rows[0].action === "buy", JSON.stringify(rows[0]));
  const byClass = R.computeAssetClassRebalancing([{ assetClass: "crypto", currentValue: 300 }, { assetClass: "equity", currentValue: 700 }], [{ assetClass: "crypto", targetPercent: 10 }, { assetClass: "equity", targetPercent: 90 }]);
  t("asset-class rebalancing labels and sizes the Crypto row", byClass[0].label === "Crypto" && near(byClass[0].deltaValue, -200) && byClass[0].action === "sell");
}

// ---------------------------------------------------------------- shock scan skips crypto, loudly
{
  const res = await SHOCK.runPortfolioShockScan([holding()]);
  t("a crypto-only portfolio scans nothing and says why", res.entries.length === 0 && res.dataLimitations.some((d) => /Crypto holdings are not part of this scan/.test(d)), JSON.stringify(res.dataLimitations));
}

// ---------------------------------------------------------------- analytics leaves crypto out, loudly
{
  const res = await ANALYTICS.runPortfolioAnalytics([holding(), holding({ id: "e1", symbol: "SPY", assetClass: "equity", shares: 3, costBasisPerShare: 400 })]);
  const row = res.betas.find((b) => b.symbol === "BTC-USD");
  t("crypto gets a visible 'excluded' row instead of a beta", row && row.beta === null && /Excluded/.test(row.error));
  t("crypto is not in the correlation matrix or frontier weights", !res.correlationMatrix.symbols.includes("BTC-USD") && !(res.frontier.maxSharpe && "BTC-USD" in res.frontier.maxSharpe.weights));
  t("the exclusion is explained in the limitations", res.dataLimitations.some((d) => /Crypto holdings \(BTC-USD\) are excluded/.test(d)));
  t("equity holdings are still analysed", res.betas.some((b) => b.symbol === "SPY" && b.error === null));
}

console.log(bad === 0 ? "\nall passed" : `\n${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
