/**
 * Provider-neutral market-data shapes. Structurally identical to schwab.ts's
 * SchwabCandle/SchwabQuote/SchwabOptionContract/SchwabOptionsChain — kept as
 * separate neutral names now that there are two real providers behind
 * market-data.ts (Alpaca and dormant Schwab), so nothing in this codebase
 * has to say "Schwab" when it might actually be Alpaca data.
 */

export interface MarketCandle {
  datetime: number; // epoch ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketQuote {
  symbol: string;
  lastPrice: number;
  totalVolume: number;
}

export interface MarketOptionContract {
  strikePrice: number;
  expirationDate: string;
  daysToExpiration: number;
  bid: number;
  ask: number;
  last: number;
  openInterest: number;
  totalVolume: number;
  volatility: number; // implied volatility, as a percent
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

export interface MarketOptionsChain {
  symbol: string;
  calls: MarketOptionContract[];
  puts: MarketOptionContract[];
}
