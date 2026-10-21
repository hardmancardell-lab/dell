"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { usePortfolio } from "@/lib/agents/trading-agent/portfolio-storage";
import type { AssetClass } from "@/lib/agents/trading-agent/types";
import { getOrCreateSessionId } from "@/lib/analytics/use-track";
import { JARVIS } from "@/lib/design/tokens";
import type { ValidatedAction } from "@/lib/faye/action-validation";
import { FayeAvatar } from "@/components/faye/FayeAvatar";
import { FayeFullBody } from "@/components/faye/FayeFullBody";
import { AboutMe, type AboutMeSummary } from "@/components/faye/AboutMe";
import { NotesUsedLine } from "@/components/faye/AboutMeNotesUsed";
import { createMemoryClient, rememberNote, type MemoryClient } from "@/lib/faye/memory-client";
import {
  COPY_EMPTY,
  COPY_LOCAL,
  COPY_LOCAL_SHORT,
  COPY_MAILBOX,
  COPY_MAILBOX_SHORT,
  COPY_NOT_ALLOWED,
  FAYE_MESSAGES,
  FayeTransportError,
  NOTES_STILL_HERE,
  OFFLINE_CODES,
  createTransport,
  deriveMood,
  nextOfflineRecheckMs,
  runQuestion,
  type AvatarMood,
  type FayeTransport,
  type RunPhase,
  type TurnKind,
  type WidgetStatus,
} from "@/lib/faye/transport";

/**
 * Faye's chat widget.
 *
 * HOW IT TALKS TO FAYE is decided in src/lib/faye/transport.ts by NEXT_PUBLIC_FAYE_TRANSPORT:
 *   local (default)  the browser talks to Faye on this computer (127.0.0.1:7810), as it always did;
 *   mailbox          the browser talks to this app's /api/faye/* routes and a worker answers from the database.
 * Roll back to local: set NEXT_PUBLIC_FAYE_TRANSPORT=local (or remove it).
 *
 * Every guard sits AFTER the transport (runQuestion in transport.ts): plan sanitiser, read-only tool allowlist and
 * paper-order validation behave the same through both. state.portfolio is built from the same localStorage holdings the
 * Portfolio Tracker itself uses and is sent with the question (locally to the loopback server; under the mailbox it goes
 * through the app's database for up to 24 hours, which the header copy says plainly).
 *
 * All text from Faye is plain text and is drawn as React text nodes. Nothing here sets HTML.
 */

type FeedbackKind = "good" | "wrong" | "too_long" | "off_voice";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  kind?: TurnKind;
  toolLog?: string[];
  error?: boolean;
  stopped?: boolean;
  retracted?: boolean;
  notesUsed?: number;
  noteIds?: string[];
  /** Small line under the owner's own message: "Saved a note." / "Proposed a note for you to approve." (from the remember call). */
  memNote?: string;
  /** Set on Faye's reply when the owner's message was a memory command ("remember that ...") handled without a chat job. */
  memReply?: { undo?: { id: string; decision?: "undelete" }; state: "idle" | "working" | "done" | "error"; resultText?: string };
  // Rebuilt by validateProposedAction(): the card text and the executed values both come from this, never from server text.
  action?: ValidatedAction | null;
  actionStatus?: "pending" | "placing" | "done" | "cancelled" | "error";
  actionResultText?: string;
  feedback?: FeedbackKind;
}

export interface FayeChatWidgetProps {
  /** Override the transport (tests and the offline visual preview). Default: chosen by NEXT_PUBLIC_FAYE_TRANSPORT. */
  transport?: FayeTransport;
  /** Draw a graceful "not available for this account" widget for non-owners. Default false: the widget hides itself (contract 3.1). */
  showWhenNotAllowed?: boolean;
  /** Start with the panel open (tests and the visual preview). */
  defaultOpen?: boolean;
  /** Feedback buttons (good, wrong, too long, off-voice). INERT SHELL: hidden unless true; presses go to onFeedback and do nothing else. */
  feedback?: boolean;
  onFeedback?: (messageId: string, kind: FeedbackKind) => void;
  /** Force the "Used N notes" line on. By default it shows whenever memory is on (mailbox transport) and the owner's "Show which notes were used" setting is on. N comes from provenance.memory_ids. */
  showNotesUsed?: boolean;
  /** Force true to make the offline line say "Your notes are still here." By default the widget knows from the owner's own approved notes. */
  notesExist?: boolean;
  /** Faye's memory (WP-F) in the widget: the About-me panel, the remember call before every typed message, "Saved a note" lines and the "Used N notes" list.
   * Default true, but it only runs with the mailbox transport for an allowed owner. Set false to switch every memory call and the panel off. */
  aboutMe?: boolean;
  /** Replace the memory API client (tests and the visual preview). Default: this app's /api/faye/memory routes. */
  memoryClient?: MemoryClient;
  /** HOOK for the Lab (WP-C2, design 5.1): when the owner has the Lab, pass its path and a link appears in the header. Inert when unset. */
  labHref?: string;
  /** Optional extra content between the header and the conversation (the built-in About-me panel replaces the conversation when it is open). Inert when unset. */
  aboutMeSlot?: ReactNode;
  /** Default "head" (unchanged: the aperture-face icon everywhere). "full" shows Faye as a full-body character above the messages in the open panel, on tall wide screens only (CSS media query); phones and the launcher keep the head icon. */
  variant?: "head" | "full";
}

const MOOD_WORD: Record<AvatarMood, string> = {
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Answering",
  unsure: "Not sure",
  celebrating: "Done",
  offline: "Resting",
  error: "Something went wrong",
};

const FEEDBACK_LABELS: Record<FeedbackKind, string> = { good: "Good", wrong: "Wrong", too_long: "Too long", off_voice: "Off-voice" };
const CELEBRATE_MS = 2000;
const ANNOUNCE_MAX = 1200;

const J = JARVIS;
/** Colours come only from the Jarvis custom properties; the tokens.ts values are the var() fallbacks, so the widget also draws correctly outside a .jarvis island. */
export const FAYE_WIDGET_CSS = `
.fw{--fw-950:var(--ink-950,${J.ink950});--fw-900:var(--ink-900,${J.ink900});--fw-800:var(--ink-800,${J.ink800});--fw-700:var(--ink-700,${J.ink700});
--fw-line:var(--line,${J.line});--fw-ctl:var(--line-control,${J.lineControl});--fw-signal:var(--signal,${J.signal});--fw-signal-dim:var(--signal-dim,${J.signalDim});
--fw-verdict:var(--verdict,${J.verdict});--fw-danger:var(--danger,${J.danger});--fw-t0:var(--text-0,${J.text0});--fw-t1:var(--text-1,${J.text1});--fw-t2:var(--text-2,${J.text2});
--fw-focus:var(--focus-ring,${J.signal});--fw-gap:max(16px,env(safe-area-inset-right));--fw-lift:56px;
font-family:var(--font-ui,-apple-system,"Segoe UI",system-ui,sans-serif);color:var(--fw-t0)}
.fw *{box-sizing:border-box}
.fw :focus-visible{outline:2px solid var(--fw-focus);outline-offset:2px}
.fw [hidden]{display:none!important}
.fw-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
.fw-btn{font:inherit;cursor:pointer;color:var(--fw-t0);background:var(--fw-800);border:1px solid var(--fw-ctl);border-radius:8px;min-height:36px;padding:6px 12px;font-size:13px}
.fw-btn:hover:not(:disabled){border-color:var(--fw-signal)}
.fw-btn:disabled{opacity:.55;cursor:default}
.fw-btn-primary{background:var(--fw-signal-dim);border-color:var(--fw-signal-dim)}
.fw-launch{position:fixed;z-index:999;right:var(--fw-gap);bottom:calc(max(16px,env(safe-area-inset-bottom)) + var(--fw-lift));display:inline-flex;align-items:center;gap:8px;
min-height:48px;padding:6px 18px 6px 8px;border-radius:999px;background:var(--fw-900);border:1px solid var(--fw-ctl);color:var(--fw-t0);font:500 14px/1 var(--font-ui,system-ui,sans-serif);cursor:pointer;
box-shadow:0 2px 14px color-mix(in srgb,var(--fw-950) 80%,transparent)}
.fw-launch:hover{border-color:var(--fw-signal)}
.fw-panel{position:fixed;z-index:999;right:var(--fw-gap);bottom:calc(max(16px,env(safe-area-inset-bottom)) + var(--fw-lift) + 60px);width:360px;
max-height:calc(100vh - 156px);max-height:min(580px,calc(100dvh - 156px));display:flex;flex-direction:column;background:var(--fw-900);border:1px solid var(--fw-ctl);border-radius:14px;
box-shadow:0 10px 36px color-mix(in srgb,var(--fw-950) 85%,transparent);overflow:hidden}
.fw-panel-wide{width:min(440px,calc(100vw - 32px))}
.fw-stage{display:none}
@media (min-height:760px) and (min-width:520px){
.fw-full .fw-stage{display:flex;justify-content:center;padding:8px 0 2px;border-bottom:1px solid var(--fw-line);background:var(--fw-950)}
.fw-full .fw-head .fayeav,.fw-full .fw-empty .fayeav{display:none}
}
.fw-head{display:flex;align-items:center;gap:10px;padding:10px 8px 8px 12px;border-bottom:1px solid var(--fw-line)}
.fw-head-text{flex:1;min-width:0}
.fw-title{margin:0;font-size:15px;font-weight:600;line-height:1.2}
.fw-moodword{font-size:12px;color:var(--fw-t1);line-height:1.3}
.fw-iconbtn{flex:none;width:44px;height:44px;display:inline-flex;align-items:center;justify-content:center;background:transparent;border:0;border-radius:10px;color:var(--fw-t1);font-size:22px;line-height:1;cursor:pointer}
.fw-iconbtn:hover{color:var(--fw-t0);background:var(--fw-800)}
.fw-link{color:var(--fw-signal);font-size:12px}
.fw-about{flex:none;min-height:44px;padding:6px 12px;display:inline-flex;align-items:center;gap:6px}
.fw-about[aria-pressed="true"]{border-color:var(--fw-signal);color:var(--fw-signal)}
.fw-badge{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:var(--fw-verdict);color:var(--fw-950);font-size:12px;font-weight:600;line-height:1}
.fw-notes{margin-top:6px;font-size:12px;color:var(--fw-t1);white-space:normal}
.fw-notes summary{cursor:pointer;color:var(--fw-t2);list-style-position:inside}
.fw-notes-list{margin:6px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:3px;overflow-wrap:anywhere;color:var(--fw-t0)}
.fw-notes-line{margin:6px 0 0}
.fw-notes-open{margin-top:8px;min-height:32px;font-size:12px}
.fw-memrow{margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;white-space:normal}
.fw-memrow .fw-btn{min-height:36px;font-size:12px;padding:3px 10px}
.fw-note{margin:0;padding:6px 14px;border-bottom:1px solid var(--fw-line);font-size:12px;line-height:1.45;color:var(--fw-t1)}
.fw-note summary{cursor:pointer;list-style-position:inside}
.fw-note p{margin:6px 0 2px;color:var(--fw-t1)}
.fw-msgs{flex:1 1 auto;min-height:160px;overflow-y:auto;overscroll-behavior:contain;padding:12px;display:flex;flex-direction:column;gap:10px;-webkit-overflow-scrolling:touch}
.fw-empty{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;padding:8px 10px;font-size:13px;line-height:1.5;color:var(--fw-t1)}
.fw-msg{display:flex;flex-direction:column;max-width:88%}
.fw-msg-user{align-self:flex-end}
.fw-msg-faye{align-self:flex-start}
.fw-bubble{padding:8px 12px;border-radius:12px;font-size:14px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid transparent}
.fw-msg-user .fw-bubble{background:var(--fw-signal-dim);color:var(--fw-t0)}
.fw-msg-faye .fw-bubble{background:var(--fw-800);border-color:var(--fw-line)}
.fw-msg-faye .fw-bubble-error{border-color:var(--fw-danger);background:color-mix(in srgb,var(--fw-danger) 12%,var(--fw-800))}
.fw-msg-faye .fw-bubble-unsure{border-color:var(--fw-verdict)}
.fw-meta{margin-top:4px;font-size:12px;color:var(--fw-t2)}
.fw-tools{margin-top:8px;font-size:12px;color:var(--fw-t1);white-space:normal}
.fw-tools summary{cursor:pointer}
.fw-tools-log{font-family:var(--font-mono,ui-monospace,Consolas,monospace);margin-top:4px;display:flex;flex-direction:column;gap:2px;overflow-wrap:anywhere}
.fw-tools-fail{color:var(--fw-danger)}
.fw-card{margin-top:8px;padding-top:8px;border-top:1px solid var(--fw-line)}
.fw-card-sum{font-size:13px;font-weight:600;margin-bottom:8px}
.fw-row{display:flex;gap:8px;flex-wrap:wrap}
.fw-ok{margin-top:6px;font-size:12px;color:var(--fw-signal)}
.fw-bad{margin-top:6px;font-size:12px;color:var(--fw-danger)}
.fw-dim{margin-top:6px;font-size:12px;color:var(--fw-t2)}
.fw-fb{margin-top:6px;display:flex;gap:6px;flex-wrap:wrap}
.fw-fb .fw-btn{min-height:32px;padding:3px 10px;font-size:12px}
.fw-fb .fw-btn[aria-pressed="true"]{border-color:var(--fw-signal);color:var(--fw-signal)}
.fw-status{padding:0 14px 6px;font-size:12px;color:var(--fw-t1);min-height:20px}
.fw-offline{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 12px 8px;padding:8px 12px;border:1px solid var(--fw-line);border-radius:10px;background:var(--fw-800);font-size:13px;line-height:1.45;color:var(--fw-t0)}
.fw-composer{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--fw-line)}
.fw-input{flex:1;min-width:0;min-height:44px;background:var(--fw-950);border:1px solid var(--fw-ctl);border-radius:10px;padding:8px 12px;color:var(--fw-t0);font:inherit;font-size:14px}
.fw-input::placeholder{color:var(--fw-t2)}
.fw-input:disabled{opacity:.6}
.fw-composer .fw-btn{min-height:44px;min-width:64px;font-size:14px}
@media (max-width:520px){
.fw-panel{left:0;right:0;bottom:0;width:auto;max-height:calc(100vh - 12px);max-height:calc(100dvh - 12px - env(safe-area-inset-top));border-radius:16px 16px 0 0;border-left:0;border-right:0;border-bottom:0;
padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right);padding-bottom:env(safe-area-inset-bottom)}
.fw-launch-open{display:none}
.fw-input{font-size:16px}
.fw-msg{max-width:94%}
.fw-btn{min-height:44px}
.fw-fb .fw-btn{min-height:40px}
.fw-memrow .fw-btn{min-height:44px}
.fw-notes-open{min-height:44px}
}
`;

export function FayeChatWidget(props: FayeChatWidgetProps = {}) {
  const { showWhenNotAllowed = false, feedback = false, showNotesUsed = false, notesExist = false } = props;
  const transport = useMemo(() => props.transport ?? createTransport(), [props.transport]);
  const memoryClient = useMemo(() => props.memoryClient ?? createMemoryClient(), [props.memoryClient]);
  const [status, setStatus] = useState<WidgetStatus>("checking");
  const [questionChars, setQuestionChars] = useState(4000);
  const [open, setOpen] = useState(!!props.defaultOpen);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const [sending, setSending] = useState(false);
  const [phase, setPhase] = useState<RunPhase>(null);
  const [queuePos, setQueuePos] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [unsure, setUnsure] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [liveText, setLiveText] = useState("");
  const [recheck, setRecheck] = useState(0);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [mem, setMem] = useState<AboutMeSummary | null>(null);
  const { holdings, hydrated, addHolding, removeHolding, sellHolding } = usePortfolio();

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const launchRef = useRef<HTMLButtonElement>(null);
  const aboutBtnRef = useRef<HTMLButtonElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const celebrateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);
  const statusRef = useRef<WidgetStatus>("checking");
  statusRef.current = status;
  // Memory (the About-me panel and the remember call) runs only with the mailbox transport, for someone Faye's status route allows.
  const memEligible = props.aboutMe !== false && transport.kind === "mailbox" && (status === "available" || status === "offline");
  const memRef = useRef<AboutMeSummary | null>(null);
  memRef.current = mem;
  const memEligibleRef = useRef(false);
  memEligibleRef.current = memEligible;
  const ids = useId();
  const panelId = `${ids}-panel`;
  const inputId = `${ids}-input`;
  const titleId = `${ids}-title`;

  async function refreshStatus(wake: boolean) {
    const st = await transport.status({ wake });
    if (!aliveRef.current) return;
    // A widget that was already on screen does not vanish when the status check fails later: it shows the resting face.
    const next: WidgetStatus = st.state === "hidden" && statusRef.current !== "checking" ? "offline" : st.state;
    setStatus(next);
    if (st.questionChars && st.questionChars > 0) setQuestionChars(Math.min(st.questionChars, 4000));
  }

  useEffect(() => {
    aliveRef.current = true;
    void refreshStatus(false);
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
      if (celebrateTimer.current) clearTimeout(celebrateTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport]);

  // While the panel is open and Faye is resting, look again every few seconds for a while, then wait for the button.
  useEffect(() => {
    if (!open || status !== "offline") return;
    const delay = nextOfflineRecheckMs(recheck);
    if (delay === null) return;
    const t = setTimeout(async () => {
      await refreshStatus(false);
      if (aliveRef.current) setRecheck((n) => n + 1);
    }, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, status, recheck]);

  // Quietly learn how many notes there are (for the "Your notes are still here." line and the badge) whenever the panel opens.
  async function refreshMemSummary() {
    if (!memEligibleRef.current) return;
    const r = await memoryClient.list();
    if (!aliveRef.current || !r.ok) return;
    setMem({ enabled: r.data.enabled, approved: r.data.counts.approved, proposed: r.data.counts.proposed, paused: r.data.settings.learningPaused, showUsedNotes: r.data.settings.showUsedNotes });
  }
  useEffect(() => {
    if (open && memEligible) void refreshMemSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, memEligible]);

  // Whenever the panel opens, put focus in the input (or on the panel itself while the input is disabled), so keyboard and screen reader users start in the right place.
  useEffect(() => {
    if (!open) return;
    const f = requestAnimationFrame(() => {
      const el = inputRef.current && !inputRef.current.disabled ? inputRef.current : panelRef.current;
      el?.focus();
    });
    return () => cancelAnimationFrame(f);
  }, [open, status]);

  // Opening About me moves focus to its title; closing it gives focus back to the About me button.
  const aboutWasOpen = useRef(false);
  useEffect(() => {
    if (aboutOpen) {
      const f = requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>('[data-faye-aboutme] [data-h="title"]')?.focus());
      aboutWasOpen.current = true;
      return () => cancelAnimationFrame(f);
    }
    if (aboutWasOpen.current) {
      aboutWasOpen.current = false;
      const f = requestAnimationFrame(() => aboutBtnRef.current?.focus());
      return () => cancelAnimationFrame(f);
    }
  }, [aboutOpen]);

  // Keep the newest text in view, unless the reader has scrolled up to re-read something.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTo({ top: el.scrollHeight });
  }, [messages]);

  function onMsgsScroll() {
    const el = scrollRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  function openPanel() {
    setOpen(true);
    setRecheck(0);
    void refreshStatus(true); // wake=1 tells the mailbox to expect a question soon (a no-op for the local transport)
  }

  function openAbout() {
    setAboutOpen(true);
  }

  function closeAbout() {
    setAboutOpen(false);
    void refreshMemSummary();
  }

  function closePanel() {
    setOpen(false);
    setAboutOpen(false);
    requestAnimationFrame(() => launchRef.current?.focus());
  }

  function celebrate() {
    setCelebrating(true);
    if (celebrateTimer.current) clearTimeout(celebrateTimer.current);
    celebrateTimer.current = setTimeout(() => setCelebrating(false), CELEBRATE_MS);
  }

  function buildState() {
    const positions = hydrated
      ? holdings.map((h) => ({
          symbol: h.symbol,
          assetClass: h.assetClass,
          shares: h.shares,
          costBasisValue: Number((h.shares * h.costBasisPerShare).toFixed(2)),
        }))
      : [];
    return { page: "Dellegate", portfolio: { positions } };
  }

  const patch = (id: string, change: Partial<ChatMessage>) => setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...change } : m)));

  function stop() {
    abortRef.current?.abort();
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || sending || status !== "available") return;
    setInput("");
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", text: question };
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: "assistant", text: "" }]);
    stickRef.current = true;
    setSending(true);
    setPhase("thinking");
    setQueuePos(null);
    setUnsure(false);
    setErrorCode(null);
    setLiveText("Faye is thinking.");
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      // Memory first (WP-F contract): EVERY message the owner types goes to /api/faye/memory/remember BEFORE the chat job is queued.
      // The call is bounded to a few seconds and never throws: if it fails for any reason the chat carries on as if it had not been made.
      // Only the owner's own typed words are sent -- never Faye's answers, tool results or page text.
      if (memEligible) {
        const rem = await memoryClient.remember(question, ac.signal);
        if (ac.signal.aborted) throw new FayeTransportError("cancelled");
        const memNote = rememberNote(rem);
        if (memNote) {
          patch(userMsg.id, { memNote });
          setLiveText(`${memNote} Faye is thinking.`);
        }
        if (rem && rem.handled && rem.reply) {
          // A command such as "remember that ...": answered at once by the route, so no chat job is queued.
          patch(assistantId, { text: rem.reply.replace(/\s*Undo\?\s*$/, ""), memReply: { undo: rem.undo, state: "idle" } });
          setLiveText(`${memNote ? `${memNote} ` : ""}${rem.reply.replace(/\s*Undo\?\s*$/, "")}`.slice(0, ANNOUNCE_MAX));
          if (rem.action === "saved" || rem.action === "updated") celebrate();
          void refreshMemSummary();
          return;
        }
        if (rem && rem.proposed > 0) void refreshMemSummary();
      }
      const out = await runQuestion({
        transport,
        question,
        state: buildState(),
        signal: ac.signal,
        events: {
          onPhase: (p, info) => {
            setPhase(p);
            setQueuePos(p === "queued" ? (info?.position ?? null) : null);
          },
          onText: (text, n) => {
            if (text) setPhase((cur) => (cur === "tools" ? cur : "speaking"));
            setTick(n);
            patch(assistantId, { text });
          },
          onRetract: (text) => patch(assistantId, { text, retracted: true }),
          onStep: (text, toolLog) => patch(assistantId, { text, toolLog }),
        },
      });
      patch(assistantId, {
        text: out.text,
        kind: out.kind,
        toolLog: out.toolLog.length ? out.toolLog : undefined,
        retracted: out.retracted,
        notesUsed: out.notesUsed,
        noteIds: out.noteIds,
        action: out.action,
        actionStatus: out.action ? "pending" : undefined,
      });
      setUnsure(out.unsure);
      setLiveText(`Faye answered. ${out.text.length > ANNOUNCE_MAX ? `${out.text.slice(0, ANNOUNCE_MAX)} ... The rest is in the conversation.` : out.text}`);
    } catch (err) {
      if (err instanceof FayeTransportError && err.code === "cancelled") {
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: m.text ? `${m.text}\n\n(Stopped.)` : FAYE_MESSAGES.cancelled, stopped: true } : m)));
        setLiveText("Stopped.");
      } else {
        const code = err instanceof FayeTransportError ? err.code : "client";
        const text = err instanceof FayeTransportError ? err.message : err instanceof Error ? err.message : FAYE_MESSAGES.unreachable;
        const shown = code === "faye_offline" && (notesExist || (memRef.current?.approved ?? 0) > 0) && !text.includes(NOTES_STILL_HERE) ? text + NOTES_STILL_HERE : text;
        patch(assistantId, { text: shown, error: true });
        setErrorCode(code);
        setLiveText(shown);
        if (OFFLINE_CODES.has(code)) {
          setStatus("offline");
          setRecheck(0);
        }
      }
    } finally {
      abortRef.current = null;
      setSending(false);
      setPhase(null);
      setQueuePos(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  // Faye never calls a mutating function herself -- she only ever produces
  // a proposal. This is the one and only place any of these three functions
  // get called from a Faye-originated action, and only after this explicit
  // click on the real numbers shown in the card below.
  // A paper order goes through the app's own paper-trading route, which fills
  // it at the simulator's price and writes the trade log. The strategy and KPIs
  // in the proposal travel with the order so the log can attribute the fill.
  async function placePaperOrder(messageId: string, validated: Extract<ValidatedAction, { type: "paper_order" }>["params"]) {
    const setResult = (actionStatus: ChatMessage["actionStatus"], actionResultText: string) => patch(messageId, { actionStatus, actionResultText });
    setResult("placing", "Placing the paper order…");
    const v = { ok: true as const, order: validated };
    try {
      const res = await fetch("/api/paper-trading/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ sessionId: getOrCreateSessionId(), order: v.order }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setResult("error", `The paper order was not placed: ${data?.error ?? `HTTP ${res.status}`}`);
        return;
      }
      const o = v.order;
      const what = o.assetClass === "option"
        ? `${o.quantity} contract(s) of ${o.underlyingSymbol} ${o.expirationDate} ${o.strikePrice} ${o.optionRight?.toUpperCase()}`
        : `${o.quantity} share(s) of ${o.symbol}`;
      const strategy = typeof o.attribution.strategyLabel === "string" ? ` Logged under "${o.attribution.strategyLabel}".` : " Logged as a manual trade.";
      setResult(
        "done",
        data?.filled
          ? `Paper ${o.side} of ${what} filled.${strategy}`
          : `Paper ${o.side} of ${what} is resting as a pending order.${strategy}`
      );
      celebrate();
    } catch (e) {
      setResult("error", `The paper order was not placed: ${e instanceof Error ? e.message : "request failed"}`);
    }
  }

  function confirmAction(messageId: string, action: ValidatedAction) {
    if (action.type === "paper_order") {
      void placePaperOrder(messageId, action.params);
      return;
    }
    let resultText = "";
    let ok = true;
    if (action.type === "add_holding") {
      const p = action.params;
      const added = addHolding(p.symbol, p.assetClass as AssetClass, p.shares, p.costBasisPerShare, p.acquiredDate);
      ok = added;
      resultText = added ? `Added ${p.shares} share(s) of ${p.symbol}.` : `Could not add ${p.symbol} -- nothing changed (crypto needs a Coinbase USD pair like BTC-USD).`;
    } else {
      const matches = holdings.filter((h) => h.symbol === action.params.symbol);
      if (matches.length === 0) {
        ok = false;
        resultText = `No holding found for ${action.params.symbol} -- nothing changed.`;
      } else if (matches.length > 1) {
        ok = false;
        resultText = `You have multiple ${action.params.symbol} lots, so I can't tell which one you mean -- use the Portfolio Tracker directly for this one.`;
      } else if (action.type === "remove_holding") {
        removeHolding(matches[0].id);
        resultText = `Removed ${action.params.symbol} from your portfolio.`;
      } else if (action.type === "sell_holding") {
        const p = action.params;
        const sale = sellHolding(matches[0].id, p.sharesSold, p.salePricePerShare, p.fee, p.saleDate);
        if (!sale) {
          ok = false;
          resultText = `You only hold ${matches[0].shares} share(s) of ${p.symbol} -- can't sell ${p.sharesSold}.`;
        } else {
          resultText = `Recorded the sale of ${p.sharesSold} share(s) of ${p.symbol}.`;
        }
      }
    }
    patch(messageId, { actionStatus: ok ? "done" : "error", actionResultText: resultText });
    if (ok) celebrate();
  }

  function cancelAction(messageId: string) {
    patch(messageId, { actionStatus: "cancelled" });
  }

  // "Undo" under a note Faye just saved or removed from a chat command. Saved: take the note away again (it can still be brought back from
  // About me for a few minutes). Removed: bring it back.
  async function undoMemReply(messageId: string, undo: { id: string; decision?: "undelete" }) {
    const mark = (state: "working" | "done" | "error", resultText?: string) =>
      setMessages((prev) => prev.map((m) => (m.id === messageId && m.memReply ? { ...m, memReply: { ...m.memReply, state, resultText } } : m)));
    mark("working");
    const r = undo.decision === "undelete" ? await memoryClient.decide(undo.id, "undelete") : await memoryClient.remove(undo.id);
    if (!aliveRef.current) return;
    const text = r.ok ? (undo.decision === "undelete" ? "Brought the note back." : "Removed that note. You can bring it back in About me for a few minutes.") : r.message;
    mark(r.ok ? "done" : "error", text);
    setLiveText(text);
    void refreshMemSummary();
  }

  function pressFeedback(messageId: string, kind: FeedbackKind) {
    patch(messageId, { feedback: kind });
    props.onFeedback?.(messageId, kind);
    if (kind === "good") celebrate();
  }

  if (status === "checking" || status === "hidden") return null;
  if (status === "not_allowed" && !showWhenNotAllowed) return null;

  const mood = deriveMood({ status, sending, phase, typing: focused && input.trim().length > 0, celebrating, errorCode, unsure });
  const privacyShort = transport.kind === "mailbox" ? COPY_MAILBOX_SHORT : COPY_LOCAL_SHORT;
  const privacyFull = transport.kind === "mailbox" ? COPY_MAILBOX : COPY_LOCAL;
  const haveNotes = notesExist || (mem?.approved ?? 0) > 0;
  const offlineText = haveNotes ? FAYE_MESSAGES.faye_offline + NOTES_STILL_HERE : FAYE_MESSAGES.faye_offline;
  const notesLineOn = showNotesUsed || (memEligible && (mem?.showUsedNotes ?? true));
  const usable = status === "available";
  const working = phase === "queued" ? `Waiting for Faye${queuePos ? ` (${queuePos} ahead)` : ""}…` : phase === "tools" ? "Faye is reading the app's tools…" : phase === "thinking" ? "Faye is thinking…" : "";

  return (
    <div className={`fw${props.variant === "full" ? " fw-full" : ""}`} data-faye-widget data-transport={transport.kind}>
      <style href="faye-widget-v1" precedence="default">
        {FAYE_WIDGET_CSS}
      </style>

      <button
        ref={launchRef}
        type="button"
        className={`fw-launch${open ? " fw-launch-open" : ""}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? closePanel() : openPanel())}
      >
        <FayeAvatar mood={mood} size={32} decorative />
        <span>{open ? "Close Faye" : "Ask Faye"}</span>
        {status === "offline" && !open && <span className="fw-sr"> (resting right now)</span>}
      </button>

      {open && (
        <section
          ref={panelRef}
          id={panelId}
          className={`fw-panel${aboutOpen ? " fw-panel-wide" : ""}`}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              closePanel();
            }
          }}
        >
          <header className="fw-head">
            <FayeAvatar mood={mood} size={44} chunkTick={tick} decorative />
            <div className="fw-head-text">
              <h2 className="fw-title" id={titleId}>Faye</h2>
              <div className="fw-moodword" data-testid="faye-mood" data-mood={mood}>{MOOD_WORD[mood]}</div>
              {props.labHref ? (
                <a className="fw-link" href={props.labHref}>
                  Train Faye
                </a>
              ) : null}
            </div>
            {memEligible ? (
              <button
                ref={aboutBtnRef}
                type="button"
                className="fw-btn fw-about"
                aria-pressed={aboutOpen}
                aria-label={(mem?.proposed ?? 0) > 0 ? `About me, ${mem!.proposed} ${mem!.proposed === 1 ? "note is" : "notes are"} waiting for your OK` : "About me"}
                onClick={() => (aboutOpen ? closeAbout() : openAbout())}
              >
                About me
                {(mem?.proposed ?? 0) > 0 ? (
                  <span className="fw-badge" aria-hidden="true">
                    {mem!.proposed}
                  </span>
                ) : null}
              </button>
            ) : null}
            <button type="button" className="fw-iconbtn" aria-label="Close Faye" onClick={closePanel}>
              <span aria-hidden="true">×</span>
            </button>
          </header>

          <details className="fw-note">
            <summary>{privacyShort}</summary>
            <p>{privacyFull}</p>
          </details>

          {props.aboutMeSlot ?? null}

          {memEligible && aboutOpen ? <AboutMe client={memoryClient} onClose={closeAbout} onSummary={setMem} /> : null}

          {props.variant === "full" ? (
            <div className="fw-stage" data-testid="faye-fullbody-stage" hidden={aboutOpen}>
              <FayeFullBody mood={mood} height={168} chunkTick={tick} decorative />
            </div>
          ) : null}

          <div
            ref={scrollRef}
            className="fw-msgs"
            role="log"
            aria-live="off"
            hidden={aboutOpen}
            aria-label="Conversation with Faye"
            tabIndex={0}
            onScroll={onMsgsScroll}
          >
            {messages.length === 0 && (
              <div className="fw-empty">
                <FayeAvatar mood={status === "offline" ? "offline" : "idle"} size={96} decorative />
                <div>{status === "not_allowed" ? COPY_NOT_ALLOWED : COPY_EMPTY}</div>
              </div>
            )}
            {messages.map((m, i) => {
              const isUser = m.role === "user";
              const lastFaye = !isUser && i === messages.length - 1;
              const waiting = lastFaye && sending && !m.text;
              return (
                <div key={m.id} className={`fw-msg ${isUser ? "fw-msg-user" : "fw-msg-faye"}`}>
                  <div className={`fw-bubble${m.error ? " fw-bubble-error" : ""}${!isUser && !m.error && m.retracted ? " fw-bubble-unsure" : ""}`}>
                    <span className="fw-sr">{isUser ? "You said: " : m.error ? "Faye had a problem: " : "Faye said: "}</span>
                    {m.text}
                    {waiting && <span aria-hidden="true">…</span>}
                    {m.toolLog && m.toolLog.length > 0 && (
                      <details className="fw-tools">
                        <summary>
                          {m.kind === "final" ? "Tools run" : "Running tools"} ({m.toolLog.length})
                        </summary>
                        <div className="fw-tools-log">
                          {m.toolLog.map((line, k) => (
                            <div key={k} className={line.includes("failed") ? "fw-tools-fail" : undefined}>
                              {line}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                    {m.kind === "guardrail" && <div className="fw-meta">educational redirect</div>}
                    {notesLineOn && (m.notesUsed ?? 0) > 0 && (
                      // "Used N notes": collapsed; opening it lists which notes (looked up by id in About me). Hidden when the owner turns it off in About me.
                      <NotesUsedLine count={m.notesUsed!} ids={m.noteIds ?? []} client={memEligible ? memoryClient : null} onOpenAboutMe={memEligible ? openAbout : undefined} />
                    )}
                    {m.memReply?.undo && m.memReply.state !== "done" && (
                      <div className="fw-memrow">
                        <button type="button" className="fw-btn" disabled={m.memReply.state === "working"} onClick={() => void undoMemReply(m.id, m.memReply!.undo!)}>
                          {m.memReply.undo.decision === "undelete" ? "Bring it back" : "Undo"}
                        </button>
                        <button type="button" className="fw-btn" onClick={openAbout}>
                          Open About me
                        </button>
                      </div>
                    )}
                    {m.memReply?.resultText && <div className={m.memReply.state === "error" ? "fw-bad" : "fw-ok"}>{m.memReply.resultText}</div>}
                    {m.action && m.actionStatus === "pending" && (
                      <div className="fw-card">
                        <div className="fw-card-sum" data-testid="faye-validated-summary">
                          {m.action.summary}
                        </div>
                        <div className="fw-row">
                          <button type="button" className="fw-btn fw-btn-primary" onClick={() => confirmAction(m.id, m.action!)}>
                            Confirm
                          </button>
                          <button type="button" className="fw-btn" onClick={() => cancelAction(m.id)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                    {m.actionStatus === "placing" && <div className="fw-dim">{m.actionResultText}</div>}
                    {m.actionStatus === "done" && <div className="fw-ok">✓ {m.actionResultText}</div>}
                    {m.actionStatus === "error" && <div className="fw-bad">{m.actionResultText}</div>}
                    {m.actionStatus === "cancelled" && <div className="fw-dim">Cancelled -- nothing changed.</div>}
                  </div>
                  {isUser && m.memNote ? (
                    <div className="fw-meta" data-testid="faye-memnote">
                      {m.memNote}
                    </div>
                  ) : null}
                  {feedback && !isUser && m.kind && !m.error && !(sending && lastFaye) && (
                    // INERT SHELL: appears only when the `feedback` prop is on. A press marks the button and calls onFeedback; nothing is stored here.
                    <div className="fw-fb" role="group" aria-label="Rate this answer">
                      {(Object.keys(FEEDBACK_LABELS) as FeedbackKind[]).map((k) => (
                        <button key={k} type="button" className="fw-btn" aria-pressed={m.feedback === k} onClick={() => pressFeedback(m.id, k)}>
                          {FEEDBACK_LABELS[k]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="fw-status" aria-hidden="true" hidden={aboutOpen}>{working}</div>

          {status === "offline" && (
            <div className="fw-offline" role="status" data-testid="faye-offline" hidden={aboutOpen}>
              <span>{offlineText}</span>
              <button
                type="button"
                className="fw-btn"
                onClick={() => {
                  setRecheck(0);
                  void refreshStatus(true);
                }}
              >
                Check again
              </button>
            </div>
          )}
          {status === "not_allowed" && (
            <div className="fw-offline" role="status" data-testid="faye-not-allowed">
              <span>{COPY_NOT_ALLOWED}</span>
            </div>
          )}

          {/* One polite live region: "Faye is thinking." then the finished answer, once. Streamed text is never announced chunk by chunk. */}
          <div className="fw-sr" role="status" aria-live="polite" aria-atomic="true" data-testid="faye-live">
            {liveText}
          </div>

          <form className="fw-composer" onSubmit={sendMessage} hidden={aboutOpen}>
            <label className="fw-sr" htmlFor={inputId}>
              Ask Faye
            </label>
            <input
              id={inputId}
              ref={inputRef}
              className="fw-input"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (errorCode) setErrorCode(null);
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={usable ? "Ask Faye…" : "Faye is resting"}
              maxLength={questionChars}
              readOnly={sending}
              disabled={!usable}
              autoComplete="off"
              enterKeyHint="send"
              aria-busy={sending}
            />
            {sending ? (
              <button type="button" className="fw-btn" onClick={stop} aria-label="Stop Faye's answer">
                Stop
              </button>
            ) : (
              <button type="submit" className="fw-btn fw-btn-primary" disabled={!usable || !input.trim()}>
                Send
              </button>
            )}
          </form>
        </section>
      )}
    </div>
  );
}
