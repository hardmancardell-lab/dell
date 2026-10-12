import { cryptoPublic, type CryptoPublic, type SourceResult } from "@/lib/data/crypto-public";
import { CRYPTO_REGIME_METHOD, scoreCryptoRegime, seriesChange, sma, type CryptoRegime, type RegimeInputs } from "./crypto-regime";

export interface RegimeSourceStatus {
  key: "stablecoin-supply" | "etf-flows" | "btc-dominance" | "btc-200d" | "us10y" | "fear-greed";
  label: string;
  status: "ok" | "error" | "typed-in";
  source: string;
  asOf?: string;
  detail?: string;
}

export interface CryptoRegimeResult {
  methodVersion: typeof CRYPTO_REGIME_METHOD;
  asOf: string;
  regime: CryptoRegime;
  inputs: RegimeInputs;
  sources: RegimeSourceStatus[];
  dataLimitations: string[];
}

export interface CryptoRegimeOptions {
  /** Net ETF flows month to date in $M, typed in by the user. Used instead of the scraped table when given. */
  etfFlowsMtdMusd?: number;
  now?: () => number;
}

const BASE_LIMITATIONS = [
  "Market-level research read, not investment advice. It describes six liquidity and trend conditions and what the score has meant historically; it does not predict prices, and the app has no crypto trading signals for it to gate.",
  "Free public data: CoinGecko is rate limited (so a read can take several seconds and is cached for 15 minutes) and the 10-year yield is Yahoo's delayed ^TNX quote. There is no free API for US spot BTC ETF flows: the app tries Farside's public page, which often blocks scripted requests, so the reliable route is to type the month-to-date total in from farside.co.uk/btc. Check Farside's terms before relying on its data commercially.",
  "BTC's last daily close is the current running price, as on the Crypto Research Desk dashboard.",
];

function describe<T>(key: RegimeSourceStatus["key"], label: string, r: SourceResult<T>): RegimeSourceStatus {
  return r.ok ? { key, label, status: "ok", source: r.source, asOf: r.asOf } : { key, label, status: "error", source: r.source, detail: r.error };
}

/**
 * Reads the six inputs from keyless public sources and scores them. CoinGecko calls run one after another (they are
 * spaced out inside the adapter); the other sources run alongside. A source that fails leaves its condition
 * "unavailable" and is listed in `sources`; the read still comes back.
 */
export async function getCryptoRegime(options: CryptoRegimeOptions = {}, data: CryptoPublic = cryptoPublic): Promise<CryptoRegimeResult> {
  const now = options.now ?? Date.now;
  const others = Promise.all([data.stablecoinSupply(), data.fearGreed(), data.us10y(), options.etfFlowsMtdMusd === undefined ? data.etfFlowsMonthToDate() : Promise.resolve(null)]);
  const dominance = await data.btcDominance();
  const btc = await data.btcDailyCloses();
  const [stables, fng, tnx, etf] = await others;

  const stablecoinChange30d = stables.ok ? seriesChange(stables.value.supply, 30) : null;
  const closes = btc.ok ? btc.value.closes : null;
  const inputs: RegimeInputs = {
    stablecoinChange30d,
    etfFlowsMtdMusd: options.etfFlowsMtdMusd !== undefined ? options.etfFlowsMtdMusd : etf && etf.ok ? etf.value.totalMusd : null,
    btcDominance: dominance.ok ? dominance.value : null,
    btcClose: closes ? closes[closes.length - 1] : null,
    btcSma200: closes ? sma(closes, 200) : null,
    us10yPct: tnx.ok ? tnx.value : null,
    fearGreed: fng.ok ? fng.value : null,
  };

  const sources: RegimeSourceStatus[] = [
    describe("stablecoin-supply", "Stablecoin supply", stables),
    options.etfFlowsMtdMusd !== undefined
      ? { key: "etf-flows", label: "Spot BTC ETF flows", status: "typed-in", source: "Entered by you", detail: "Net flows month to date, in $M, as typed." }
      : etf
        ? { ...describe("etf-flows", "Spot BTC ETF flows", etf), detail: etf.ok ? `${etf.value.days} trading days posted, through ${etf.value.lastDay}` : etf.error }
        : { key: "etf-flows", label: "Spot BTC ETF flows", status: "error", source: "Farside Investors (scraped table)", detail: "not requested" },
    describe("btc-dominance", "BTC dominance", dominance),
    describe("btc-200d", "BTC daily closes", btc),
    describe("us10y", "10-year yield", tnx),
    describe("fear-greed", "Fear & Greed", fng),
  ];
  if (stablecoinChange30d === null && stables.ok) sources[0] = { ...sources[0], status: "error", detail: "not enough history to compute a 30-day change" };

  const regime = scoreCryptoRegime(inputs);
  const failed = sources.filter((s) => s.status === "error");
  const dataLimitations = [...BASE_LIMITATIONS];
  if (failed.length > 0) dataLimitations.unshift(`${failed.length} source(s) could not be read (${failed.map((f) => f.label).join(", ")}), so those conditions are unavailable and never count as met.${failed.some((f) => f.key === "etf-flows") ? " For the ETF flows, type the month-to-date total from farside.co.uk/btc into the box and read again." : ""}`);
  if (stables.ok && stablecoinChange30d !== null && Math.abs(stablecoinChange30d - 0.02) < 0.001) dataLimitations.push("Stablecoin supply growth is within 0.1 point of its +2% threshold, so the reading could flip on the next update.");
  return { methodVersion: CRYPTO_REGIME_METHOD, asOf: new Date(now()).toISOString(), regime, inputs, sources, dataLimitations };
}
