"use client";

import { useCallback } from "react";
import { useAppNavigationOptional } from "@/lib/navigation/app-navigation";

type ChartAlert = { symbol: string; price: number; direction: "above" | "below" };

/**
 * The handler to pass to PriceChart's `onCreateAlert` prop: it opens the Alerts tab with a Price Threshold row pre-filled from the
 * horizontal line the user drew. Undefined outside the navigation provider, in which case PriceChart simply hides the action.
 * The returned function is stable between renders, so it never makes the chart re-run its effects.
 */
export function useChartAlert(): ((a: ChartAlert) => void) | undefined {
  const nav = useAppNavigationOptional();
  const createAlert = nav?.createAlert;
  const handler = useCallback((a: ChartAlert) => void createAlert?.(a), [createAlert]);
  return createAlert ? handler : undefined;
}
