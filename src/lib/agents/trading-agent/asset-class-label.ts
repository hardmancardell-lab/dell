import type { AssetClass } from "./types";

// Pure, zero-dependency helper — deliberately kept out of watchlist-scan.ts
// (which transitively imports schwab-auth.ts's node:fs/promises) so client
// components can import this without pulling server-only code into the
// browser bundle.
export function assetClassLabel(assetClass: AssetClass): string {
  switch (assetClass) {
    case "equity":
      return "Equity";
    case "bond":
      return "Bond";
    case "option":
      return "Option";
    case "future":
      return "Future";
    case "forex":
      return "Forex";
    case "commodity":
      return "Commodity";
  }
}
