import { JARVIS } from "@/lib/design/tokens";

/**
 * The one stylesheet behind the About-me panel.
 *
 * Colours come only from the Jarvis custom properties (--signal, --ink-900, --text-1 ...). The values from src/lib/design/tokens.ts are
 * the var() fallbacks, so the panel also draws correctly outside a .jarvis island. No other colour is introduced.
 * Touch targets are 44 px on phones and on coarse pointers, 40 px with a mouse. Nothing animates.
 */
const J = JARVIS;

export const ABOUT_ME_CSS = `
.fam{--am-950:var(--ink-950,${J.ink950});--am-900:var(--ink-900,${J.ink900});--am-800:var(--ink-800,${J.ink800});--am-700:var(--ink-700,${J.ink700});
--am-line:var(--line,${J.line});--am-ctl:var(--line-control,${J.lineControl});--am-signal:var(--signal,${J.signal});--am-signal-dim:var(--signal-dim,${J.signalDim});
--am-verdict:var(--verdict,${J.verdict});--am-verdict-dim:var(--verdict-dim,${J.verdictDim});--am-danger:var(--danger,${J.danger});
--am-t0:var(--text-0,${J.text0});--am-t1:var(--text-1,${J.text1});--am-t2:var(--text-2,${J.text2});--am-focus:var(--focus-ring,${J.signal});--am-tap:40px;
position:relative;display:flex;flex-direction:column;flex:1 1 auto;min-height:0;background:var(--am-900);color:var(--am-t0);
font-family:var(--font-ui,-apple-system,"Segoe UI",system-ui,sans-serif);font-size:14px;line-height:1.5}
.fam *{box-sizing:border-box}
.fam :focus-visible{outline:2px solid var(--am-focus);outline-offset:2px}
.fam [hidden]{display:none!important}
.fam-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
.fam-head{display:flex;align-items:center;gap:6px;padding:6px 10px 6px 6px;border-bottom:1px solid var(--am-line);flex:none}
.fam-title{margin:0;font-size:16px;font-weight:600;line-height:1.2}
.fam-title:focus{outline:none}
.fam-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:12px 14px 20px;display:flex;flex-direction:column;gap:16px;-webkit-overflow-scrolling:touch}
.fam-intro{margin:0;color:var(--am-t1);font-size:13px}
.fam-btn{font:inherit;font-size:13px;cursor:pointer;color:var(--am-t0);background:var(--am-800);border:1px solid var(--am-ctl);border-radius:8px;min-height:var(--am-tap);padding:6px 12px;display:inline-flex;align-items:center;justify-content:center;gap:6px;text-decoration:none;line-height:1.2}
.fam-btn:hover:not(:disabled):not([aria-disabled="true"]){border-color:var(--am-signal)}
.fam-btn:disabled,.fam-btn[aria-disabled="true"]{opacity:.55;cursor:default}
.fam-btn-primary{background:var(--am-signal-dim);border-color:var(--am-signal-dim)}
.fam-btn-danger{border-color:var(--am-danger);color:var(--am-danger)}
.fam-btn-danger-solid{background:var(--am-danger);border-color:var(--am-danger);color:var(--am-950);font-weight:600}
.fam-back{background:transparent;border-color:transparent;color:var(--am-t1);padding-left:8px}
.fam-back:hover:not(:disabled){color:var(--am-t0)}
.fam-live{flex:none;margin:8px 14px 4px;padding:8px 12px;border:1px solid var(--am-line);border-radius:10px;background:var(--am-800);font-size:13px;color:var(--am-t0)}
.fam-live:empty{display:none}
.fam-live[data-tone="ok"]{border-color:var(--am-signal-dim)}
.fam-live[data-tone="error"]{border-color:var(--am-danger)}
.fam-banner{margin:0;padding:10px 12px;border:1px solid var(--am-verdict-dim);border-radius:10px;background:var(--am-800);font-size:13px;color:var(--am-t0)}
.fam-banner strong{display:block;margin-bottom:2px;color:var(--am-verdict)}
.fam-banner p{margin:0;color:var(--am-t1)}
.fam-reauth{border-color:var(--am-danger)}
.fam-reauth strong{color:var(--am-t0)}
.fam-reauth .fam-row{margin-top:10px}
.fam-sec{display:flex;flex-direction:column;gap:8px}
.fam-h{margin:0;font-size:15px;font-weight:600;line-height:1.3}
.fam-h:focus{outline:none}
.fam-h small{font-weight:400;color:var(--am-t2);font-size:12px}
.fam-sub{margin:4px 0 0;font-size:12px;font-weight:600;color:var(--am-t1);text-transform:none}
.fam-hint{margin:0;font-size:12px;color:var(--am-t1)}
.fam-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.fam-note{padding:10px 12px;border:1px solid var(--am-line);border-radius:10px;background:var(--am-800)}
.fam-note-prop{border-color:var(--am-verdict-dim)}
.fam-fact{margin:0;font-size:14px;overflow-wrap:anywhere;white-space:pre-wrap}
.fam-meta{margin:4px 0 0;font-size:12px;color:var(--am-t1)}
.fam-meta [data-flag]{color:var(--am-verdict)}
.fam-row{display:flex;flex-wrap:wrap;gap:8px}
.fam-note .fam-row{margin-top:8px}
.fam-field{display:flex;flex-direction:column;gap:4px;font-size:13px}
.fam-field>span{color:var(--am-t1);font-size:12px}
.fam-input,.fam-area,.fam-select{font:inherit;font-size:14px;color:var(--am-t0);background:var(--am-950);border:1px solid var(--am-ctl);border-radius:8px;padding:8px 10px;min-height:var(--am-tap);width:100%}
.fam-area{resize:vertical;min-height:72px}
.fam-count{font-size:12px;color:var(--am-t2);align-self:flex-end}
.fam-more{border:1px solid var(--am-line);border-radius:10px;background:var(--am-800);padding:0 12px}
.fam-more>summary{cursor:pointer;min-height:var(--am-tap);display:flex;align-items:center;font-size:13px;color:var(--am-t1);list-style-position:inside}
.fam-more[open]>summary{border-bottom:1px solid var(--am-line);margin-bottom:10px}
.fam-more .fam-list{padding-bottom:12px}
.fam-switch{display:flex;align-items:flex-start;gap:12px;padding:10px 12px;border:1px solid var(--am-line);border-radius:10px;background:var(--am-800)}
.fam-switch-text{flex:1;min-width:0}
.fam-switch-text b{display:block;font-weight:600;font-size:14px}
.fam-switch-text span{display:block;font-size:12px;color:var(--am-t1);margin-top:2px}
.fam-tog{flex:none;position:relative;width:52px;min-width:52px;height:var(--am-tap);min-height:var(--am-tap);padding:0;background:transparent;border:0;cursor:pointer}
.fam-tog:disabled{opacity:.55;cursor:default}
.fam-tog-track{position:absolute;left:0;top:50%;width:52px;height:28px;margin-top:-14px;border-radius:14px;border:1px solid var(--am-ctl);background:var(--am-950)}
.fam-tog[aria-checked="true"] .fam-tog-track{background:var(--am-signal-dim);border-color:var(--am-signal)}
.fam-tog-knob{position:absolute;left:3px;top:50%;width:20px;height:20px;margin-top:-10px;border-radius:50%;background:var(--am-t1)}
.fam-tog[aria-checked="true"] .fam-tog-knob{left:27px;background:var(--am-t0)}
.fam-tog-word{position:absolute;right:0;bottom:-2px;font-size:11px;color:var(--am-t2)}
.fam-tog-state{font-size:12px;color:var(--am-t1);margin-top:2px;display:block}
.fam-empty{padding:14px;border:1px dashed var(--am-ctl);border-radius:10px;text-align:center;color:var(--am-t1);font-size:13px}
.fam-empty p{margin:0 0 4px}
.fam-quiet{margin:0;padding-top:12px;border-top:1px solid var(--am-line);font-size:12px;color:var(--am-t2)}
.fam-data{display:flex;flex-direction:column;gap:8px}
.fam-data-item{padding:10px 12px;border:1px solid var(--am-line);border-radius:10px;background:var(--am-800)}
.fam-data-item p{margin:0 0 8px;font-size:12px;color:var(--am-t1)}
.fam-data-item b{display:block;font-size:14px;margin-bottom:2px;color:var(--am-t0)}
.fam-scrim{position:absolute;inset:0;z-index:5;display:flex;align-items:flex-end;justify-content:center;padding:12px;background:color-mix(in srgb,var(--am-950) 78%,transparent)}
.fam-dialog{width:100%;max-width:420px;max-height:100%;overflow-y:auto;padding:16px;border:1px solid var(--am-ctl);border-radius:14px;background:var(--am-900);display:flex;flex-direction:column;gap:10px}
.fam-dialog h3{margin:0;font-size:16px}
.fam-dialog p{margin:0;font-size:13px;color:var(--am-t1)}
.fam-dialog ul{margin:0;padding-left:18px;font-size:13px;color:var(--am-t1)}
.fam-loading{padding:14px;color:var(--am-t1);font-size:13px}
@media (max-width:520px){
.fam{--am-tap:44px}
.fam-scroll{padding:12px 16px calc(20px + env(safe-area-inset-bottom))}
.fam-input,.fam-area,.fam-select{font-size:16px}
.fam-btn{font-size:14px}
.fam-note .fam-row .fam-btn{flex:1 1 auto}
.fam-scrim{align-items:flex-end;padding:0}
.fam-dialog{max-width:none;border-radius:16px 16px 0 0;border-left:0;border-right:0;border-bottom:0;padding-bottom:calc(16px + env(safe-area-inset-bottom))}
}
@media (pointer:coarse){.fam{--am-tap:44px}}
`;
