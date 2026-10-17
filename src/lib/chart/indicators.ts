// Pure, client-safe: the indicator catalogue for PriceChart and the function that turns one indicator id plus the bars
// into plain series specs. The chart wrapper (IndicatorManager) draws the specs; nothing here touches the chart, so each
// indicator can be built, tested and added or removed on its own.
import { INDICATOR_COLORS as C } from "@/lib/design/tokens";
import {
  atr,
  bollingerBands,
  cci,
  cmf,
  ema,
  hma,
  ichimoku,
  keltnerChannels,
  macd,
  obv,
  parabolicSar,
  roc,
  rsi,
  stochastic,
  volumeProfile,
  vwapWithBands,
  williamsR,
  type VolumeProfileResult,
} from "@/lib/agents/trading-agent/skills/technical-indicators";
import type { MarketCandle } from "@/lib/data/market-data-types";

export type IndicatorGroup = "overlay" | "oscillator";

export interface IndicatorDef {
  id: string;
  label: string;
  group: IndicatorGroup;
  /** What the line is, in one plain sentence (shown in the active-indicator legend). */
  description: string;
  /** Swatch colour for the legend. */
  color: string;
  /** Present when the plotted thing is a model or an approximation rather than a direct computation on prices. The text says why. */
  estimate?: string;
}

// Fixed canonical order. Also the order a saved layout restores in.
export const INDICATORS: readonly IndicatorDef[] = [
  { id: "ema20", label: "EMA 20", group: "overlay", description: "20-bar exponential moving average of the close", color: C.ema20 },
  { id: "ema50", label: "EMA 50", group: "overlay", description: "50-bar exponential moving average of the close", color: C.ema50 },
  { id: "bollinger", label: "Bollinger Bands (20, 2σ)", group: "overlay", description: "20-bar average of the close with bands 2 standard deviations away", color: C.bollinger },
  { id: "keltner", label: "Keltner Channels", group: "overlay", description: "EMA with bands set by average true range", color: C.keltner },
  { id: "psar", label: "Parabolic SAR", group: "overlay", description: "Trailing stop-and-reverse dots (a rule output, not a forecast)", color: C.psar },
  { id: "hma", label: "Hull MA (9)", group: "overlay", description: "9-bar Hull moving average of the close", color: C.hma },
  { id: "ichimoku", label: "Ichimoku Kinko Hyo", group: "overlay", description: "Ichimoku lines and cloud edges (Tenkan, Kijun, Span A and B, Chikou)", color: C.ichimokuTenkan },
  {
    id: "vwap",
    label: "VWAP + Bands",
    group: "overlay",
    description: "Volume-weighted average price of the bars shown, with bands",
    color: C.vwap,
    estimate: "Built from bar typical price and the feed's volume (IEX volume is one exchange), not from every trade",
  },
  {
    id: "volumeProfile",
    label: "Volume Profile",
    group: "overlay",
    description: "Point of control and value area (POC, VAH, VAL) as price lines",
    color: C.volumeProfile,
    estimate: "Approximated from OHLCV bars by spreading each bar's volume over its range, not from tick data",
  },
  { id: "rsi", label: "RSI (14)", group: "oscillator", description: "Relative strength index, 0 to 100", color: C.rsi },
  { id: "stochastic", label: "Stochastic (14, 3)", group: "oscillator", description: "Stochastic %K and %D, 0 to 100", color: C.stochK },
  { id: "cci", label: "CCI (20)", group: "oscillator", description: "Commodity channel index", color: C.cci },
  { id: "roc", label: "ROC (12)", group: "oscillator", description: "12-bar rate of change, percent", color: C.roc },
  { id: "williamsR", label: "Williams %R (14)", group: "oscillator", description: "Williams %R, -100 to 0", color: C.williamsR },
  { id: "macd", label: "MACD (12, 26, 9)", group: "oscillator", description: "MACD line, signal line and histogram", color: C.macdLine },
  { id: "atr", label: "ATR (14)", group: "oscillator", description: "14-bar average true range, in price units", color: C.atr },
  { id: "obv", label: "OBV", group: "oscillator", description: "On-balance volume (cumulative signed volume)", color: C.obv, estimate: "Uses the feed's volume; IEX volume is one exchange only" },
  { id: "cmf", label: "CMF (20)", group: "oscillator", description: "Chaikin money flow, -1 to 1", color: C.cmf, estimate: "Uses the feed's volume; IEX volume is one exchange only" },
];

export const OVERLAY_IDS: readonly string[] = INDICATORS.filter((d) => d.group === "overlay").map((d) => d.id);
export const OSCILLATOR_IDS: readonly string[] = INDICATORS.filter((d) => d.group === "oscillator").map((d) => d.id);

export function indicatorDef(id: string): IndicatorDef | undefined {
  return INDICATORS.find((d) => d.id === id);
}

export interface LineSpec {
  kind: "line";
  values: (number | null)[];
  color: string;
  style?: "solid" | "dashed" | "dotted";
  /** PSAR draws dots only. */
  pointsOnly?: boolean;
}
export interface HistogramSpec {
  kind: "histogram";
  values: (number | null)[];
}
export type SeriesSpec = LineSpec | HistogramSpec;

export interface LevelSpec {
  price: number;
  color: string;
  width: 1 | 2;
  style: "solid" | "dashed";
  title: string;
}

export interface IndicatorOutput {
  series: SeriesSpec[];
  /** Horizontal price lines on the candle series (volume profile). */
  levels: LevelSpec[];
  summary?: VolumeProfileResult;
}

const line = (values: (number | null)[], color: string, style?: LineSpec["style"], pointsOnly?: boolean): LineSpec => ({ kind: "line", values, color, style, pointsOnly });

/** Plain series specs for one indicator. Unknown ids give an empty output. */
export function computeIndicator(id: string, candles: MarketCandle[]): IndicatorOutput {
  const closes = candles.map((c) => c.close);
  const out = (series: SeriesSpec[], levels: LevelSpec[] = [], summary?: VolumeProfileResult): IndicatorOutput => ({ series, levels, summary });
  switch (id) {
    case "ema20":
      return out([line(ema(closes, 20), C.ema20)]);
    case "ema50":
      return out([line(ema(closes, 50), C.ema50)]);
    case "bollinger": {
      const bb = bollingerBands(closes);
      return out([line(bb.upper, C.bollinger, "dashed"), line(bb.lower, C.bollinger, "dashed")]);
    }
    case "keltner": {
      const kc = keltnerChannels(candles);
      return out([line(kc.upper, C.keltner, "dashed"), line(kc.lower, C.keltner, "dashed")]);
    }
    case "psar":
      return out([line(parabolicSar(candles), C.psar, undefined, true)]);
    case "hma":
      return out([line(hma(closes, 9), C.hma)]);
    case "ichimoku": {
      const i = ichimoku(candles);
      return out([
        line(i.tenkan, C.ichimokuTenkan),
        line(i.kijun, C.ichimokuKijun),
        line(i.spanA, C.ichimokuSpanA, "dotted"),
        line(i.spanB, C.ichimokuSpanB, "dotted"),
        line(i.chikou, C.ichimokuChikou, "dashed"),
      ]);
    }
    case "vwap": {
      const v = vwapWithBands(candles);
      return out([line(v.vwap, C.vwap), line(v.upper, C.vwap, "dashed"), line(v.lower, C.vwap, "dashed")]);
    }
    case "volumeProfile": {
      const vp = volumeProfile(candles);
      const levels: LevelSpec[] = [];
      if (vp.poc !== null) levels.push({ price: vp.poc, color: C.volumeProfile, width: 2, style: "solid", title: "POC (est.)" });
      if (vp.vah !== null) levels.push({ price: vp.vah, color: C.volumeProfile, width: 1, style: "dashed", title: "VAH (est.)" });
      if (vp.val !== null) levels.push({ price: vp.val, color: C.volumeProfile, width: 1, style: "dashed", title: "VAL (est.)" });
      return out([], levels, vp);
    }
    case "rsi":
      return out([line(rsi(closes), C.rsi)]);
    case "stochastic": {
      const s = stochastic(candles);
      return out([line(s.k, C.stochK), line(s.d, C.stochD)]);
    }
    case "cci":
      return out([line(cci(candles), C.cci)]);
    case "roc":
      return out([line(roc(closes), C.roc)]);
    case "williamsR":
      return out([line(williamsR(candles), C.williamsR)]);
    case "macd": {
      const m = macd(closes);
      return out([{ kind: "histogram", values: m.histogram }, line(m.macd, C.macdLine), line(m.signal, C.macdSignal)]);
    }
    case "atr":
      return out([line(atr(candles), C.atr)]);
    case "obv":
      return out([line(obv(candles), C.obv)]);
    case "cmf":
      return out([line(cmf(candles), C.cmf)]);
    default:
      return out([]);
  }
}
