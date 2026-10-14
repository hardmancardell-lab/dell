"use client";

import { useState } from "react";
import { useTrackEvent } from "@/lib/analytics/use-track";
import { PriceChart } from "./PriceChart";

const COINS = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "ADA-USD", "AVAX-USD", "LINK-USD"];

/**
 * Multi-timeframe candlestick chart for any Coinbase USD pair. Real exchange trades, 24/7, from Coinbase's public
 * market-data API (no key). Read-only: the paper-trading engine prices equities, forex and futures, not crypto.
 */
export function CryptoChartsTab() {
  const [symbol, setSymbol] = useState("BTC-USD");
  const [input, setInput] = useState("");
  const { track } = useTrackEvent();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = input.trim().toUpperCase().replace(/\s+/g, "");
    if (!t) return;
    // "BTC" and "btc-usd" both work: a bare coin ticker gets the USD pair.
    const pair = t.includes("-") ? t : `${t}-USD`;
    setSymbol(pair);
    track("ticker_analyzed", { agent: "trading", tab: "Crypto Charts", symbol: pair });
  }

  return (
    <div className="jarvis">
      <p className="jv-lede">
        Multi-timeframe candlestick chart of real Coinbase trades, around the clock. Crypto has no market close, so daily candles run from
        00:00 to 24:00 UTC and volume is in coins on this one exchange. Pick a coin or type any Coinbase USD pair.
      </p>

      <form onSubmit={submit} className="flex gap-3 mb-3">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Coin, e.g. BTC or ETH-USD" className="jv-input flex-1" aria-label="Coin or Coinbase USD pair" />
        <button type="submit" className="jv-btn">Load Chart</button>
      </form>

      <div className="flex flex-wrap gap-2 mb-6">
        {COINS.map((c) => (
          <button key={c} onClick={() => setSymbol(c)} className={symbol === c ? "jv-btn" : "jv-btn-outline"} style={{ padding: "4px 12px", fontSize: 12 }}>
            {c}
          </button>
        ))}
      </div>

      <PriceChart key={symbol} symbol={symbol} assetClass="equity" readOnly />
    </div>
  );
}
