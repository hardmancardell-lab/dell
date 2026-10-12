import type { AssetGroup } from "./retirement-math";

/**
 * Example rows copied from a real, public Fidelity-administered plan
 * disclosure: the Hamilton College 403(b) Participant Disclosure Notice (plan
 * data as of August 2022). The names and gross expense ratios are exactly as
 * printed in that notice. It is a DIFFERENT plan from the user's, so the page
 * labels it as an example and never presents it as the user's own menu.
 *
 * Fund types are deliberately not filled in here. The notice does not say how
 * most of these funds are managed, so the app only suggests a type from the
 * fund's name and asks the user to confirm.
 */
export const FIDELITY_EXAMPLE_SOURCE =
  "Hamilton College 403(b) Participant Disclosure Notice, administered with Fidelity (plan data as of Aug 2022). A different plan from yours.";

export const FIDELITY_EXAMPLE_ROWS: { name: string; assetGroup: AssetGroup; expenseRatioPct: number }[] = [
  { name: "Fidelity® 500 Index Fund", assetGroup: "stocks", expenseRatioPct: 0.015 },
  { name: "Fidelity® Blue Chip Growth Fund", assetGroup: "stocks", expenseRatioPct: 0.79 },
  { name: "Fidelity® Contrafund®", assetGroup: "stocks", expenseRatioPct: 0.81 },
  { name: "Fidelity® Diversified International Fund", assetGroup: "stocks", expenseRatioPct: 1.01 },
  { name: "Fidelity® Dividend Growth Fund", assetGroup: "stocks", expenseRatioPct: 0.49 },
  { name: "Fidelity® Emerging Markets Index Fund", assetGroup: "stocks", expenseRatioPct: 0.075 },
  { name: "Fidelity® Emerging Markets Fund", assetGroup: "stocks", expenseRatioPct: 0.88 },
  { name: "Fidelity Freedom® 2040 Fund", assetGroup: "blended", expenseRatioPct: 0.75 },
  { name: "Fidelity Freedom® Index 2040 Fund Institutional Premium Class", assetGroup: "blended", expenseRatioPct: 0.08 },
];
