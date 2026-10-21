import { JARVIS } from "@/lib/design/tokens";

/**
 * The one stylesheet behind the Faye Lab page.
 *
 * Colours come only from the Jarvis custom properties (--signal, --verdict, --danger, --ink-900, --text-1 ...). The values from
 * src/lib/design/tokens.ts are the var() fallbacks, so the page also draws correctly outside a .jarvis island. No other colour is
 * introduced. Training is teal with a solid edge; held-out exam is amber with a dashed edge, so the two never rely on colour alone.
 * Touch targets are 44 px on phones and on coarse pointers, 40 px with a mouse. Nothing animates.
 */
const J = JARVIS;

export const LAB_CSS = `
.fl{--fl-950:var(--ink-950,${J.ink950});--fl-900:var(--ink-900,${J.ink900});--fl-800:var(--ink-800,${J.ink800});--fl-700:var(--ink-700,${J.ink700});
--fl-line:var(--line,${J.line});--fl-ctl:var(--line-control,${J.lineControl});--fl-signal:var(--signal,${J.signal});--fl-signal-dim:var(--signal-dim,${J.signalDim});
--fl-verdict:var(--verdict,${J.verdict});--fl-verdict-dim:var(--verdict-dim,${J.verdictDim});--fl-danger:var(--danger,${J.danger});
--fl-t0:var(--text-0,${J.text0});--fl-t1:var(--text-1,${J.text1});--fl-t2:var(--text-2,${J.text2});--fl-focus:var(--focus-ring,${J.signal});--fl-tap:40px;
display:block;max-width:960px;margin:0 auto;padding:16px 16px 56px;color:var(--fl-t0);font-family:var(--font-ui,-apple-system,"Segoe UI",system-ui,sans-serif);font-size:15px;line-height:1.5}
.fl *{box-sizing:border-box}
.fl :focus-visible{outline:2px solid var(--fl-focus);outline-offset:2px}
.fl [hidden]{display:none!important}
.fl-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
.fl-skip{position:absolute;left:8px;top:-60px;z-index:10;padding:10px 14px;border-radius:8px;background:var(--fl-800);color:var(--fl-t0);border:1px solid var(--fl-signal);text-decoration:none}
.fl-skip:focus{top:8px}
.fl-back{display:inline-flex;align-items:center;min-height:var(--fl-tap);color:var(--fl-t1);text-decoration:none;font-size:14px}
.fl-back:hover{color:var(--fl-t0);text-decoration:underline}
.fl-hero{display:flex;align-items:center;gap:16px;padding:12px 0 16px;border-bottom:1px solid var(--fl-line)}
.fl-hero-fig{flex:none;display:flex;align-items:flex-end;justify-content:center;min-width:100px}
.fl-hero-text{flex:1 1 auto;min-width:0}
.fl-kicker{margin:0;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--fl-verdict)}
.fl-title{margin:2px 0 4px;font-size:28px;line-height:1.15;font-weight:650}
.fl-title:focus{outline:none}
.fl-lead{margin:0 0 6px;color:var(--fl-t1)}
.fl-status{margin:0 0 10px;padding:8px 12px;border:1px solid var(--fl-line);border-radius:10px;background:var(--fl-800);font-size:14px}
.fl-status[data-reason="offline"]{border-color:var(--fl-verdict-dim)}
.fl-status[data-reason="dropped"]{border-color:var(--fl-verdict)}
.fl-status[data-reason="guardrail_clear"]{border-color:var(--fl-signal-dim)}
.fl-stats{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:8px}
.fl-stat{display:inline-flex;align-items:baseline;gap:6px;padding:4px 10px;border:1px solid var(--fl-line);border-radius:999px;background:var(--fl-800);font-size:13px;color:var(--fl-t1)}
.fl-stat b{font-size:15px;color:var(--fl-t0)}
.fl-nav{display:flex;flex-wrap:wrap;gap:8px;padding:12px 0}
.fl-nav a{display:inline-flex;align-items:center;min-height:var(--fl-tap);padding:4px 14px;border:1px solid var(--fl-ctl);border-radius:999px;background:var(--fl-800);color:var(--fl-t0);text-decoration:none;font-size:14px}
.fl-nav a:hover{border-color:var(--fl-signal)}
.fl-live{margin:4px 0 8px;padding:8px 12px;border:1px solid var(--fl-line);border-radius:10px;background:var(--fl-800);font-size:14px}
.fl-live:empty{display:none}
.fl-live[data-tone="ok"]{border-color:var(--fl-signal-dim)}
.fl-live[data-tone="error"]{border-color:var(--fl-danger)}
.fl-main{display:flex;flex-direction:column;gap:20px}
.fl-sec{display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid var(--fl-line);border-radius:14px;background:var(--fl-900);scroll-margin-top:12px}
.fl-h{margin:0;font-size:20px;line-height:1.25;font-weight:600}
.fl-h:focus{outline:none}
.fl-h2{margin:0;font-size:16px;font-weight:600}
.fl-hint{margin:0;color:var(--fl-t1);font-size:14px}
.fl-small{margin:0;color:var(--fl-t2);font-size:12px}
.fl-banner{margin:0;padding:12px 14px;border:1px solid var(--fl-verdict-dim);border-radius:12px;background:var(--fl-800)}
.fl-banner strong{display:block;margin-bottom:2px;color:var(--fl-verdict)}
.fl-banner p{margin:0;color:var(--fl-t1)}
.fl-banner[data-tone="danger"]{border-color:var(--fl-danger)}
.fl-banner[data-tone="danger"] strong{color:var(--fl-danger)}
.fl-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.fl-card{padding:12px 14px;border:1px solid var(--fl-line);border-radius:12px;background:var(--fl-800)}
.fl-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.fl-card .fl-row{margin-top:10px}
.fl-chip{display:inline-flex;align-items:center;padding:1px 9px;border:1px solid var(--fl-ctl);border-radius:999px;font-size:12px;line-height:1.6;color:var(--fl-t1);background:var(--fl-950)}
.fl-chip[data-tone="good"]{border-color:var(--fl-signal-dim);color:var(--fl-signal)}
.fl-chip[data-tone="warn"]{border-color:var(--fl-verdict-dim);color:var(--fl-verdict)}
.fl-chip[data-tone="bad"]{border-color:var(--fl-danger);color:var(--fl-danger)}
.fl-quote{margin:6px 0 0;color:var(--fl-t0);overflow-wrap:anywhere;white-space:pre-wrap}
.fl-q{margin:6px 0 0;font-weight:600;overflow-wrap:anywhere;white-space:pre-wrap}
.fl-meta{margin:6px 0 0;color:var(--fl-t1);font-size:13px;overflow-wrap:anywhere;white-space:pre-wrap}
.fl-btn{font:inherit;font-size:14px;cursor:pointer;color:var(--fl-t0);background:var(--fl-800);border:1px solid var(--fl-ctl);border-radius:8px;min-height:var(--fl-tap);padding:6px 14px;display:inline-flex;align-items:center;justify-content:center;gap:6px;text-decoration:none;line-height:1.2}
.fl-btn:hover:not(:disabled):not([aria-disabled="true"]){border-color:var(--fl-signal)}
.fl-btn:disabled,.fl-btn[aria-disabled="true"]{opacity:.55;cursor:default}
.fl-btn-primary{background:var(--fl-signal-dim);border-color:var(--fl-signal-dim)}
.fl-btn-exam{border-color:var(--fl-verdict);color:var(--fl-verdict)}
.fl-btn-danger{border-color:var(--fl-danger);color:var(--fl-danger)}
.fl-field{display:flex;flex-direction:column;gap:4px;font-size:14px}
.fl-field>span{color:var(--fl-t1);font-size:13px}
.fl-input,.fl-area,.fl-select{font:inherit;font-size:15px;color:var(--fl-t0);background:var(--fl-950);border:1px solid var(--fl-ctl);border-radius:8px;padding:8px 10px;min-height:var(--fl-tap);width:100%}
.fl-area{resize:vertical;min-height:84px}
.fl-form{display:flex;flex-direction:column;gap:12px}
.fl-grid2{display:grid;grid-template-columns:1fr;gap:12px}
.fl-more{margin-top:10px;border:1px solid var(--fl-line);border-radius:10px;background:var(--fl-900);padding:0 12px}
.fl-more>summary{cursor:pointer;min-height:var(--fl-tap);display:flex;align-items:center;font-size:14px;color:var(--fl-t0)}
.fl-more[open]>summary{border-bottom:1px solid var(--fl-line);margin-bottom:10px}
.fl-more .fl-form,.fl-more .fl-row{padding-bottom:12px}
.fl-sets{display:grid;grid-template-columns:1fr;gap:16px}
.fl-set{display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:12px;background:var(--fl-800)}
.fl-set[data-set="training"]{border:1px solid var(--fl-signal-dim);border-left:6px solid var(--fl-signal)}
.fl-set[data-set="held_out"]{border:2px dashed var(--fl-verdict);background:color-mix(in srgb,var(--fl-verdict) 7%,var(--fl-800))}
.fl-badge{display:inline-flex;align-items:center;align-self:flex-start;padding:2px 10px;border-radius:6px;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase}
.fl-set[data-set="training"] .fl-badge{background:var(--fl-signal-dim);color:var(--fl-t0)}
.fl-set[data-set="held_out"] .fl-badge{background:var(--fl-verdict);color:var(--fl-950)}
.fl-set .fl-card{background:var(--fl-900)}
.fl-set[data-set="held_out"] .fl-card{border-style:dashed;border-color:var(--fl-verdict-dim)}
.fl-never{margin:8px 0 0;font-size:13px;color:var(--fl-verdict)}
.fl-chartgrid{display:grid;grid-template-columns:1fr;gap:16px}
.fl-chart{margin:0;padding:12px;border:1px solid var(--fl-line);border-radius:12px;background:var(--fl-800)}
.fl-chart figcaption{margin:0 0 6px;font-size:14px;font-weight:600}
.fl-chart svg{display:block;width:100%;height:auto}
.fl-svg-t{fill:var(--fl-t1);font-size:11px}
.fl-svg-v{fill:var(--fl-t0);font-size:11px;font-weight:600}
.fl-svg-grid{stroke:var(--fl-line);stroke-width:1}
.fl-svg-base{stroke:var(--fl-ctl);stroke-width:1.5}
.fl-bar{stroke-width:1.5}
.fl-bar[data-tone="ok"]{fill:var(--fl-signal-dim);stroke:var(--fl-signal)}
.fl-bar[data-tone="warn"]{fill:var(--fl-verdict-dim);stroke:var(--fl-verdict)}
.fl-bar[data-tone="bad"]{fill:var(--fl-danger);stroke:var(--fl-danger)}
.fl-whisk{stroke:var(--fl-t0);stroke-width:1.5}
.fl-tablewrap{overflow-x:auto;border:1px solid var(--fl-line);border-radius:12px}
.fl-table{width:100%;border-collapse:collapse;font-size:13px}
.fl-table caption{text-align:left;padding:8px 12px;font-weight:600;font-size:14px}
.fl-table th,.fl-table td{padding:8px 12px;text-align:left;border-top:1px solid var(--fl-line);white-space:nowrap}
.fl-table th{color:var(--fl-t1);font-weight:600}
.fl-table td[data-tone="bad"]{color:var(--fl-danger);font-weight:600}
.fl-check{display:flex;align-items:flex-start;gap:10px;min-height:var(--fl-tap);font-size:14px}
.fl-check input{width:22px;height:22px;margin-top:2px;flex:none}
.fl-empty{padding:14px;border:1px dashed var(--fl-ctl);border-radius:10px;text-align:center;color:var(--fl-t1);font-size:14px}
.fl-loading{padding:20px;color:var(--fl-t1)}
.fl-count{font-size:12px;color:var(--fl-t2);align-self:flex-end}
@media (min-width:720px){
.fl{padding:24px 24px 72px}
.fl-grid2{grid-template-columns:1fr 1fr}
.fl-sets{grid-template-columns:1fr 1fr;align-items:start}
.fl-chartgrid{grid-template-columns:1fr 1fr}
.fl-title{font-size:32px}
}
@media (max-width:520px){
.fl{--fl-tap:44px;padding:12px 16px calc(48px + env(safe-area-inset-bottom))}
.fl-input,.fl-area,.fl-select{font-size:16px}
.fl-hero{gap:12px}
.fl-hero-fig{min-width:84px}
.fl-title{font-size:26px}
.fl-card .fl-row .fl-btn{flex:1 1 auto}
.fl-sec{padding:14px}
}
@media (pointer:coarse){.fl{--fl-tap:44px}}
`;
