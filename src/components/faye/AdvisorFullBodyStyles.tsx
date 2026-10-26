/**
 * The one stylesheet behind AdvisorFullBody.
 *
 * Colours: only the `--fb-*` custom properties, which AdvisorFullBody sets inline from the character rig (each one is
 * `var(--<token>, <tokens.ts value>)`, for Jarvis tokens and for the CHARACTER palette alike). No colour literal here.
 *
 * Motion: transform and opacity only. Rotating or scaling groups sit inside a translate() wrapper so the pivot is the
 * local origin (`transform-box:view-box; transform-origin:0 0`). `prefers-reduced-motion: reduce` and the `ab-static`
 * class (the `reducedMotion` prop) switch every animation off; each pose is a complete static drawing on its own.
 */
export const ADVISOR_FULLBODY_CSS = `
.advfb{position:relative;display:inline-block;flex:none;line-height:0;vertical-align:middle}
.advfb .ab-stage{position:absolute;inset:0;display:block}
.advfb svg.ab-layer{position:absolute;left:0;top:0;width:100%;height:100%;display:block;overflow:visible}
.advfb .ab-head{position:absolute;display:block;transform-origin:50% 100%}
.advfb .ab-head-in{display:block;width:100%;height:100%}
.advfb .ab-head svg{display:block;width:100%;height:100%;overflow:visible}
.advfb .ab-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

.ab-pad{fill:var(--fb-piping);fill-opacity:.08}
.ab-padring{fill:none;stroke:var(--fb-piping);stroke-width:1.2;stroke-opacity:.4}
.ab-skin{fill:var(--fb-skin)}
.ab-skin-shade{fill:var(--fb-skin-shade)}
.ab-jacket{stroke:var(--fb-outline);stroke-width:1}
.ab-sleeve{fill:var(--fb-jacket);stroke:var(--fb-outline);stroke-width:1}
.ab-lapel{fill:var(--fb-lapel);stroke:var(--fb-piping);stroke-width:.9;stroke-linejoin:round}
.ab-blouse{fill:var(--fb-shirt)}
.ab-blouse-fold{fill:none;stroke:var(--fb-skin-shade);stroke-width:.7;stroke-opacity:.45}
.ab-trousers{fill:var(--fb-trousers);stroke:var(--fb-outline);stroke-width:1}
.ab-crease{fill:none;stroke:var(--fb-trousers-shade);stroke-width:1.2;stroke-opacity:.9}
.ab-shoe{fill:var(--fb-shoes);stroke:var(--fb-outline);stroke-width:.8}
.ab-seam{fill:none;stroke:var(--fb-jacket-shade);stroke-width:1.1;stroke-linecap:round;stroke-opacity:.9}
.ab-pipe{fill:none;stroke:var(--fb-piping);stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round;stroke-opacity:.9}
.ab-pipe-thin{fill:none;stroke:var(--fb-piping);stroke-width:.9;stroke-linecap:round;stroke-opacity:.8}
.ab-button{fill:var(--fb-piping);stroke:var(--fb-jacket-shade);stroke-width:.8}
.ab-chain{fill:none;stroke:var(--fb-glasses);stroke-width:.9;stroke-linecap:round}
.ab-pendant{fill:var(--fb-glasses)}
.ab-fgap{stroke:var(--fb-skin-shade);stroke-width:.9;stroke-linecap:round;opacity:.8}
.ab-stop-a{stop-color:var(--fb-jacket)}
.ab-stop-b{stop-color:var(--fb-jacket-shade)}
.ab-stop-s1{stop-color:var(--fb-skin-shade)}
.ab-stop-s2{stop-color:var(--fb-skin)}

/* head */
.ab-hair-edge{fill:var(--fb-outline);stroke:var(--fb-outline);stroke-width:2}
.ab-hair{fill:var(--fb-hair)}
.ab-sheen{fill:none;stroke:var(--fb-hair-sheen);stroke-linecap:round;stroke-opacity:.5}
.ab-curl{fill:none;stroke:var(--fb-hair-sheen);stroke-linecap:round;stroke-opacity:.38}
.ab-face-edge{fill:none;stroke:var(--fb-outline);stroke-width:1}
.ab-eye-white{fill:var(--fb-eye-white)}
.ab-iris{fill:var(--fb-iris)}
.ab-glint{fill:var(--fb-eye-white)}
.ab-lid{fill:none;stroke:var(--fb-iris);stroke-width:1.6;stroke-linecap:round}
.ab-brow{fill:none;stroke:var(--fb-hair);stroke-width:2.3;stroke-linecap:round}
.ab-nose{fill:none;stroke:var(--fb-skin-shade);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.ab-blush{fill:var(--fb-lips);fill-opacity:.2}
.ab-lips{fill:var(--fb-lips)}
.ab-lipline{fill:none;stroke:var(--fb-lips);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.ab-mouth{fill:var(--fb-iris)}
.ab-teeth{fill:var(--fb-eye-white)}
.ab-frame{fill:none;stroke:var(--fb-glasses);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.ab-lens{fill:var(--fb-eye-white);fill-opacity:.1}
.ab-lens-glint{fill:none;stroke:var(--fb-eye-white);stroke-width:1.1;stroke-linecap:round;stroke-opacity:.6}
.ab-stud{fill:var(--fb-glasses)}

/* the chart she presents to */
.ab-chart-card{fill:var(--fb-ink);fill-opacity:.92;stroke:var(--fb-signal);stroke-width:.9;stroke-opacity:.6}
.ab-chart-bar{fill:var(--fb-signal);fill-opacity:.85}
.ab-chart-line{fill:none;stroke:var(--fb-verdict);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}

.ab-breathe,.ab-bob,.ab-gest,.ab-shrug,.ab-cheer,.ab-point,.ab-talk{transform-box:view-box;transform-origin:0 0}
.ab-eyes{transform-box:fill-box;transform-origin:50% 50%}
.ab-talk{transform-box:fill-box;transform-origin:50% 0}
.ab-breathe{animation:ab-breathe 5.2s ease-in-out infinite}
.ab-head-in.ab-bob{animation:ab-bob 5.2s ease-in-out infinite}
.ab-gest{animation:ab-gest 1.1s ease-in-out infinite alternate}
.ab-point{animation:ab-point 2.6s ease-in-out infinite alternate}
.ab-shrug{animation:ab-shrug .7s cubic-bezier(.2,.8,.2,1) 1}
.ab-cheer{animation:ab-cheer .8s cubic-bezier(.2,.9,.25,1.15) 1}
.ab-eyes{animation:ab-blink 5.6s ease-in-out infinite;animation-delay:var(--ab-blink-o,0s)}
.ab-talk{animation:ab-talk .45s ease-in-out infinite alternate}
.advfb[data-pose="celebrating"] .ab-stage{animation:ab-hop .7s ease-out 1}

@keyframes ab-breathe{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.012)}}
@keyframes ab-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.2%)}}
@keyframes ab-gest{from{transform:rotate(-4deg)}to{transform:rotate(6deg)}}
@keyframes ab-point{from{transform:rotate(-2deg)}to{transform:rotate(3deg)}}
@keyframes ab-shrug{0%{transform:translateY(7px)}100%{transform:translateY(0)}}
@keyframes ab-cheer{0%{transform:rotate(var(--fb-dr,60deg))}100%{transform:rotate(0deg)}}
@keyframes ab-blink{0%,94%,100%{transform:scaleY(1)}96.5%{transform:scaleY(.08)}}
@keyframes ab-talk{from{transform:scaleY(.7)}to{transform:scaleY(1.1)}}
@keyframes ab-hop{0%{transform:translateY(0)}35%{transform:translateY(-1.8%)}100%{transform:translateY(0)}}

@media (prefers-reduced-motion: reduce){
  .advfb *,.advfb .ab-stage{animation:none !important}
}
.advfb.ab-static *,.advfb.ab-static .ab-stage{animation:none !important}
`;

/** Rendered once per page: React 19 hoists a <style href precedence> into <head> and de-duplicates it by href. */
export function AdvisorFullBodyStyles() {
  return (
    <style href="advisor-fullbody-v1" precedence="default">
      {ADVISOR_FULLBODY_CSS}
    </style>
  );
}
