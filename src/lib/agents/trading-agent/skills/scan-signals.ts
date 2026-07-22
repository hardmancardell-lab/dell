import {
  MOMENTUM_WINDOW_DAYS,
  VOLUME_DISPLACEMENT_LOOKBACK_DAYS,
  VOLUME_DISPLACEMENT_MULTIPLE,
} from "../constants";
import type { DailyBar, MomentumSignal, VolumeDisplacementSignal } from "../types";

/**
 * Today's volume vs. the trailing lookback-day average (excluding today).
 * Full-session daily volume, not premarket-only — unlike PM-volume-tracker's
 * signal, this applies uniformly across equities/futures/forex/commodities,
 * none of which reliably have the same premarket-session concept equities do.
 */
export function computeVolumeDisplacement(bars: DailyBar[]): VolumeDisplacementSignal {
  if (bars.length < 2) {
    return {
      triggered: false,
      todayVolume: bars[0]?.volume ?? 0,
      rollingAverageVolume: null,
      multiple: null,
      threshold: VOLUME_DISPLACEMENT_MULTIPLE,
    };
  }

  const today = bars[bars.length - 1];
  const priorBars = bars.slice(0, -1).slice(-VOLUME_DISPLACEMENT_LOOKBACK_DAYS);
  const rollingAverageVolume =
    priorBars.length > 0 ? priorBars.reduce((sum, b) => sum + b.volume, 0) / priorBars.length : null;
  const multiple =
    rollingAverageVolume && rollingAverageVolume > 0 ? today.volume / rollingAverageVolume : null;

  return {
    triggered: multiple !== null && multiple >= VOLUME_DISPLACEMENT_MULTIPLE,
    todayVolume: today.volume,
    rollingAverageVolume,
    multiple,
    threshold: VOLUME_DISPLACEMENT_MULTIPLE,
  };
}

/**
 * Last MOMENTUM_WINDOW_DAYS bars all closed green (close > prior close,
 * consistent with the "green" convention already used in
 * historical-composite.ts) AND volume strictly increasing each day.
 */
export function computeMomentum(bars: DailyBar[]): MomentumSignal {
  const window = bars.slice(-MOMENTUM_WINDOW_DAYS - 1); // need one extra bar for the first day's "prior close"

  if (window.length < MOMENTUM_WINDOW_DAYS + 1) {
    return { triggered: false, closesGreen: [], volumes: [], volumeIncreasing: false, daysGreenSoFar: 0 };
  }

  const recentDays = window.slice(1); // the MOMENTUM_WINDOW_DAYS days being evaluated
  const closesGreen = recentDays.map((day, i) => day.close > window[i].close); // window[i] is the prior day
  const volumes = recentDays.map((d) => d.volume);
  const volumeIncreasing = volumes.every((v, i) => i === 0 || v > volumes[i - 1]);
  const triggered = closesGreen.every(Boolean) && volumeIncreasing;

  let daysGreenSoFar = 0;
  for (let i = closesGreen.length - 1; i >= 0; i--) {
    if (!closesGreen[i]) break;
    daysGreenSoFar++;
  }

  return { triggered, closesGreen, volumes, volumeIncreasing, daysGreenSoFar };
}
