/**
 * The one stylesheet behind FayeFullBody.
 *
 * Colours: only the `--fb-*` custom properties, which FayeFullBody sets inline from the character rig (each one is
 * `var(--<jarvis token>, <tokens.ts value>)`). No colour literal appears here. The head's own colours live in
 * FayeAvatarStyles and are not touched.
 *
 * Motion: transform and opacity only (compositor). Every rotating or scaling group sits inside a translate() wrapper
 * so its pivot is the local origin (`transform-box:view-box; transform-origin:0 0`), which keeps the keyframes free of
 * per-element pixel maths. `prefers-reduced-motion: reduce` and the `fb-static` class (the `reducedMotion` prop) switch
 * every animation off; each pose is a static shape on its own, so meaning never depends on motion or colour alone.
 */
export const FAYE_FULLBODY_CSS = `
.fayefb{position:relative;display:inline-block;flex:none;line-height:0;vertical-align:middle;
  --fb-accent:var(--fb-piping)}
.fayefb[data-mood="unsure"]{--fb-accent:var(--fb-verdict)}
.fayefb[data-mood="offline"],.fayefb[data-mood="error"]{--fb-accent:var(--fb-dim)}
.fayefb .fb-stage{position:absolute;inset:0;display:block}
.fayefb svg.fb-layer{position:absolute;left:0;top:0;width:100%;height:100%;display:block;overflow:visible}
.fayefb .fb-head{position:absolute;display:flex;align-items:center;justify-content:center;transform-origin:50% 100%}
.fayefb .fb-head-in{display:flex}
.fayefb .fb-head .fayeav{display:block}
.fayefb .fb-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

.fb-pad{fill:var(--fb-accent);fill-opacity:.07}
.fb-padring{fill:none;stroke:var(--fb-accent);stroke-width:1.2;stroke-opacity:.4}
.fb-skin{fill:var(--fb-skin)}
.fb-skin-shade{fill:var(--fb-skin-shade)}
.fb-jacket{stroke:var(--fb-outline);stroke-width:1}
.fb-sleeve{fill:var(--fb-jacket);stroke:var(--fb-outline);stroke-width:1}
.fb-lapel{fill:var(--fb-lapel);stroke:var(--fb-outline);stroke-width:.8}
.fb-shirt{fill:var(--fb-shirt);fill-opacity:.9}
.fb-trousers{fill:var(--fb-trousers);stroke:var(--fb-outline);stroke-width:1}
.fb-trousers-shade{fill:var(--fb-trousers-shade);stroke:var(--fb-outline);stroke-width:1}
.fb-crease{fill:none;stroke:var(--fb-outline);stroke-width:.8;stroke-opacity:.55}
.fb-shoe{fill:var(--fb-shoes);stroke:var(--fb-outline);stroke-width:1}
.fb-pipe{fill:none;stroke:var(--fb-accent);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.fb-pipe-thin{fill:none;stroke:var(--fb-accent);stroke-width:1;stroke-linecap:round;stroke-opacity:.85}
.fb-button{fill:var(--fb-outline);stroke:var(--fb-accent);stroke-width:.8}
.fb-dock{fill:var(--fb-trousers-shade);stroke:var(--fb-outline);stroke-width:1}
.fb-orbit-dot{fill:var(--fb-signal)}
.fb-standby{fill:none;stroke:var(--fb-dim);stroke-width:2;stroke-linecap:round}
.fb-zz{fill:none;stroke:var(--fb-dim);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.fb-danger{fill:none;stroke:var(--fb-danger);stroke-width:2.4;stroke-linecap:round}
.fb-fgap{stroke:var(--fb-skin-shade);stroke-width:.9;stroke-linecap:round;opacity:.8}
.fb-stop-a{stop-color:var(--fb-jacket)}
.fb-stop-b{stop-color:var(--fb-jacket-shade)}
.fb-stop-s1{stop-color:var(--fb-skin-shade)}
.fb-stop-s2{stop-color:var(--fb-skin)}
.fayefb[data-mood="offline"] .fb-stage,.fayefb[data-mood="error"] .fb-stage{opacity:.8}

.fb-spin,.fb-bob,.fb-gest,.fb-tap,.fb-shrug,.fb-cheer,.fb-breathe,.fb-pulse{transform-box:view-box;transform-origin:0 0}
.fb-breathe{animation:fb-breathe 5.2s ease-in-out infinite}
.fb-head-in.fb-bob{animation:fb-bob 5.2s ease-in-out infinite}
.fb-spin{animation:fb-spin 7s linear infinite}
.fb-gest{animation:fb-gest 1.1s ease-in-out infinite alternate}
.fb-tap{animation:fb-tap 1.8s ease-in-out infinite alternate}
.fb-shrug{animation:fb-shrug .7s cubic-bezier(.2,.8,.2,1) 1}
.fb-cheer{animation:fb-cheer .8s cubic-bezier(.2,.9,.25,1.15) 1}
.fb-pulse{animation:fb-pulse 3.6s ease-in-out infinite}
.fayefb[data-mood="celebrating"] .fb-stage{animation:fb-hop .7s ease-out 1}

@keyframes fb-breathe{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.012)}}
@keyframes fb-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.4%)}}
@keyframes fb-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
@keyframes fb-gest{from{transform:rotate(-5deg)}to{transform:rotate(7deg)}}
@keyframes fb-tap{from{transform:rotate(0deg)}to{transform:rotate(-3deg)}}
@keyframes fb-shrug{0%{transform:translateY(7px)}100%{transform:translateY(0)}}
@keyframes fb-cheer{0%{transform:rotate(var(--fb-dr,60deg))}100%{transform:rotate(0deg)}}
@keyframes fb-pulse{0%,100%{opacity:.45}50%{opacity:1}}
@keyframes fb-hop{0%{transform:translateY(0)}35%{transform:translateY(-1.8%)}100%{transform:translateY(0)}}

@media (prefers-reduced-motion: reduce){
  .fayefb *,.fayefb .fb-stage{animation:none !important}
}
.fayefb.fb-static *,.fayefb.fb-static .fb-stage{animation:none !important}
`;

/** Rendered once per page: React 19 hoists a <style href precedence> into <head> and de-duplicates it by href. */
export function FayeFullBodyStyles() {
  return (
    <style href="faye-fullbody-v1" precedence="default">
      {FAYE_FULLBODY_CSS}
    </style>
  );
}
