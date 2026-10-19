/**
 * The one call/put colour pair for every options view (Options Chain, Gamma Heat Map, Intraday Put/Call Flow).
 *
 *   calls = Jarvis signal teal (--signal, #4fe8d0)      puts = Jarvis verdict amber (--verdict, #f0a868)
 *
 * Why this pair: it differs along the blue-yellow axis, which red-green colour blindness keeps, so the two stay apart for
 * the common colour-vision differences. It deliberately avoids the danger red (--danger), which in this app means loss
 * or down, and a put is not a loss. Colour is never the only cue: every use also carries the words Call or Put.
 * Do not use this pair for anything that is not a call or a put (up and down moves, gain and loss, volume series).
 */
export const CALL_COLOR = "var(--signal)";
export const PUT_COLOR = "var(--verdict)";

/** A small key for the pair, with shapes as well as colours so it does not rely on colour alone. */
export function CallPutLegend({ className }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-4 text-xs ${className ?? ""}`} style={{ color: "var(--text-1)" }} aria-label="Colour key: teal circle is calls, amber square is puts" role="group">
      <span className="inline-flex items-center gap-1.5">
        <svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4.5" fill={CALL_COLOR} /></svg>
        Calls
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="10" height="10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" fill={PUT_COLOR} /></svg>
        Puts
      </span>
    </div>
  );
}
