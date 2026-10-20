import { JARVIS } from "@/lib/design/tokens";

/**
 * The one stylesheet behind FayeAvatar and AgentMark.
 *
 * Colours come only from the Jarvis custom properties (--signal, --verdict, --ink-900, --text-2 ...). The values
 * from src/lib/design/tokens.ts are used as var() fallbacks so the avatar still draws correctly outside a .jarvis
 * island (the floating chat widget may sit outside one). No other colour is ever introduced.
 *
 * Motion is limited to transform and opacity (compositor only). Every animation is switched off by
 * `prefers-reduced-motion: reduce` and by the `fa-static` class (the `reducedMotion` prop); meaning then comes from
 * the static shape alone (eyes, mouth, ring gaps), never from motion or colour alone.
 */
export const FAYE_AVATAR_CSS = `
.fayeav,.agentmark{
  --fa-signal:var(--signal,${JARVIS.signal});
  --fa-verdict:var(--verdict,${JARVIS.verdict});
  --fa-ink:var(--ink-900,${JARVIS.ink900});
  --fa-bezel:var(--line-bright,${JARVIS.lineBright});
  --fa-dim:var(--text-2,${JARVIS.text2});
  --fa-danger:var(--danger,${JARVIS.danger});
  --fa-c:var(--fa-signal);
  --fa-sw:3.6;--fa-mw:3.6;
  display:inline-block;flex:none;line-height:0;position:relative;vertical-align:middle;
}
.fayeav[data-detail="full"],.agentmark[data-detail="full"]{--fa-sw:2.8;--fa-mw:2.8}
.fayeav[data-mood="unsure"],.agentmark[data-mood="unsure"]{--fa-c:var(--fa-verdict)}
.agentmark{--fa-c:var(--fa-verdict)}
.fayeav[data-mood="offline"],.fayeav[data-mood="error"],
.agentmark[data-mood="offline"],.agentmark[data-mood="error"]{--fa-c:var(--fa-dim)}
.fayeav svg,.agentmark svg{width:100%;height:100%;display:block;overflow:visible}

.fa-disc{fill:var(--fa-ink)}
.fa-ring{fill:none;stroke:var(--fa-c);stroke-width:var(--fa-sw);stroke-linecap:round}
.fa-ring.fa-butt{stroke-linecap:butt}
.fa-eye{fill:var(--fa-c)}
.fa-line{fill:none;stroke:var(--fa-c);stroke-width:var(--fa-mw);stroke-linecap:round;stroke-linejoin:round}
.fa-thin{fill:none;stroke:var(--fa-c);stroke-width:1.7;stroke-linecap:round;opacity:.6}
.fa-dot{fill:var(--fa-c)}
.fa-bezel{stroke:var(--fa-bezel);stroke-width:.9;stroke-linecap:round;opacity:.9}
.fa-glow-stop{stop-color:var(--fa-c)}
.fa-danger{fill:none;stroke:var(--fa-danger);stroke-width:3;stroke-linecap:round}
.fa-danger-fill{fill:var(--fa-ink);stroke:var(--fa-danger);stroke-width:2}
.fa-tick{stroke:var(--fa-c);stroke-width:2.4;stroke-linecap:round}
.agentmark .fa-hollow{fill:none;stroke:var(--fa-c);stroke-width:2.6}
.fayeav .fa-sr,.agentmark .fa-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

.fa-blink{transform-box:fill-box;transform-origin:center;animation:fa-blink var(--fa-blink-d,6s) linear var(--fa-blink-o,0s) infinite}
.fa-breathe{animation:fa-breathe 6s ease-in-out infinite}
.fa-orbit{transform-origin:32px 32px;animation:fa-spin 3.2s linear infinite}
.fa-gap{transform-origin:32px 32px;animation:fa-spin 1.6s linear infinite}
.fa-dots circle{animation:fa-dot 1.2s ease-in-out infinite}
.fa-dots circle:nth-child(2){animation-delay:.2s}
.fa-dots circle:nth-child(3){animation-delay:.4s}
.fa-jump{transform-box:view-box;transform-origin:32px 44px;animation:fa-jump .28s ease-out}
.fa-talk{transform-origin:32px 44px;animation:fa-talk .7s ease-in-out infinite alternate}
.fa-pulse{transform-origin:32px 32px;animation:fa-pulse .32s ease-out}
.fa-nod{animation:fa-nod .5s ease-in-out 1}
.fa-hop{animation:fa-hop .6s ease-out 1}
.fa-burst{transform-origin:32px 32px;animation:fa-burst 1.2s ease-out 1 forwards}
.fa-heart{transform-origin:32px 32px;animation:fa-heart 1.4s ease-in-out infinite}
.fa-heart-once{transform-origin:32px 32px;animation:fa-heart-once .32s ease-out}

@keyframes fa-blink{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.08)}}
@keyframes fa-breathe{0%,100%{opacity:.82}50%{opacity:1}}
@keyframes fa-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
@keyframes fa-dot{0%,100%{opacity:.25}50%{opacity:1}}
@keyframes fa-jump{0%{transform:scaleY(.5)}35%{transform:scaleY(1.7)}100%{transform:scaleY(1)}}
@keyframes fa-talk{from{transform:scaleY(.75)}to{transform:scaleY(1.2)}}
@keyframes fa-pulse{0%{transform:scale(1)}40%{transform:scale(1.05)}100%{transform:scale(1)}}
@keyframes fa-nod{0%,100%{transform:translateY(0)}40%{transform:translateY(1.6px)}}
@keyframes fa-hop{0%{transform:translateY(0)}35%{transform:translateY(-1.8px)}100%{transform:translateY(0)}}
@keyframes fa-burst{0%{opacity:0;transform:scale(.8)}20%{opacity:1}100%{opacity:0;transform:scale(1.1)}}
@keyframes fa-heart{0%,100%{transform:scale(1)}50%{transform:scale(1.35)}}
@keyframes fa-heart-once{0%{transform:scale(1)}40%{transform:scale(1.5)}100%{transform:scale(1)}}

@media (prefers-reduced-motion: reduce){
  .fayeav *,.agentmark *{animation:none !important}
}
.fayeav.fa-static *,.agentmark.fa-static *{animation:none !important}
`;

/**
 * Renders the stylesheet once per page. React 19 hoists a <style href precedence> into <head> and de-duplicates it by
 * `href`, so a chat with fifty bubbles still carries a single copy.
 */
export function FayeAvatarStyles() {
  return (
    <style href="faye-avatar-v1" precedence="default">
      {FAYE_AVATAR_CSS}
    </style>
  );
}
