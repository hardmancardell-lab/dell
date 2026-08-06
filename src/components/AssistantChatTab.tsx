"use client";

import { useEffect, useRef, useState } from "react";
import { getOrCreateSessionId, useTrackEvent } from "@/lib/analytics/use-track";
import { useAppNavigation } from "@/lib/navigation/app-navigation";
import type { AssistantMessage } from "@/lib/agents/assistant/types";

interface PaperTradingNavigationTarget {
  target: { primaryId: string; secondaryId: string };
  prefill: {
    symbol: string;
    assetClass: string;
    optionRight: string | null;
    strikePrice: number | null;
    expirationDate: string | null;
  };
}

interface DisplayMessage extends AssistantMessage {
  toolsUsed?: string[];
  dataLimitations?: string[];
  navigationTarget?: PaperTradingNavigationTarget | null;
}

function describePrefill(prefill: PaperTradingNavigationTarget["prefill"]): string {
  if (prefill.assetClass === "option" && prefill.optionRight && prefill.strikePrice != null) {
    return `${prefill.symbol} $${prefill.strikePrice} ${prefill.optionRight === "call" ? "Call" : "Put"}${
      prefill.expirationDate ? ` · exp ${prefill.expirationDate}` : ""
    }`;
  }
  return prefill.symbol;
}

const EXAMPLE_QUESTIONS = [
  "Is AAPL a good trade right now?",
  "What does the Glossary tab explain?",
  "Find something that negatively correlates with GOOGL.",
  "What's the current macro stance and why?",
];

// Minimal ambient shape for the Web Speech API — not in TypeScript's default
// DOM lib, and only Chrome/Edge/Safari implement it (no Firefox support as
// of this writing), so this is feature-detected at runtime, never assumed.
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null;
}

export function AssistantChatTab() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(false);
  const [speechOutputSupported, setSpeechOutputSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { track } = useTrackEvent();
  const { navigateTo } = useAppNavigation();

  useEffect(() => {
    setVoiceSupported(getSpeechRecognitionCtor() !== null);
    setSpeechOutputSupported(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

  function toggleListening() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      if (transcript) setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
    track("assistant_voice_input_used", { agent: "assistant", tab: "Assistant" });
  }

  function speak(text: string) {
    if (!speakReplies || !speechOutputSupported) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }

  function prefillFeedback(lead: string) {
    setInput((prev) => (prev ? prev : lead));
    inputRef.current?.focus();
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const nextMessages: DisplayMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
          sessionId: getOrCreateSessionId(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status}).`);
        track("assistant_message_failed", { agent: "assistant", tab: "Assistant", metadata: { status: res.status } });
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.reply,
          toolsUsed: data.toolsUsed,
          dataLimitations: data.dataLimitations,
          navigationTarget: data.navigationTarget ?? null,
        },
      ]);
      speak(data.reply);
      // Message length/tool names only — never the raw question or reply text.
      track("assistant_message_sent", {
        agent: "assistant",
        tab: "Assistant",
        metadata: {
          turnCount: nextMessages.length,
          questionLength: trimmed.length,
          replyLength: typeof data.reply === "string" ? data.reply.length : null,
          toolsUsed: Array.isArray(data.toolsUsed) ? data.toolsUsed : [],
        },
      });
    } catch {
      setError("Network error reaching the assistant.");
      track("assistant_message_failed", { agent: "assistant", tab: "Assistant", metadata: { status: "network_error" } });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="jarvis">
      <p className="jv-lede">
        Answers questions about this app and, for "should I buy X" style questions, runs the real
        top-down process (macro → sector → company fundamentals → positioning) using this app's
        own live tools — never a fabricated number, and never a buy/sell directive.
      </p>

      <div
        className="p-3 text-xs mb-4"
        style={{ border: "1px dashed var(--verdict-dim)", background: "rgba(240, 168, 104, 0.06)", color: "var(--verdict)" }}
      >
        Describes what this app's real, current data shows — not investment advice or a recommendation to buy or sell.
      </div>

      <div
        className="mb-4 min-h-[280px] max-h-[520px] overflow-y-auto p-4 flex flex-col gap-4"
        style={{ border: "1px solid var(--line)", background: "var(--ink-900)" }}
      >
        {messages.length === 0 && (
          <div>
            <div className="text-sm mb-3" style={{ color: "var(--text-2)" }}>Try asking:</div>
            <div className="flex flex-col gap-2 items-start">
              {EXAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="text-sm text-left px-3 py-2"
                  style={{ border: "1px solid var(--line)", color: "var(--text-1)" }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] ${m.role === "user" ? "" : "w-full"}`}>
              <div
                className="rounded-lg px-3 py-2 text-sm whitespace-pre-wrap"
                style={
                  m.role === "user"
                    ? { background: "rgba(79, 232, 208, 0.12)", border: "1px solid var(--signal-dim)", color: "var(--text-0)" }
                    : { background: "var(--ink-900)", border: "1px solid var(--line)", color: "var(--text-0)" }
                }
              >
                {m.content}
              </div>
              {m.role === "assistant" && m.toolsUsed && m.toolsUsed.length > 0 && (
                <div className="text-xs mt-1" style={{ color: "var(--text-2)" }}>
                  Data pulled from: {m.toolsUsed.map((t) => t.replace(/^get_/, "").replace(/_/g, " ")).join(", ")}
                </div>
              )}
              {m.role === "assistant" && m.dataLimitations && m.dataLimitations.length > 0 && (
                <ul className="text-xs mt-1 list-disc list-inside" style={{ color: "var(--verdict)" }}>
                  {m.dataLimitations.map((d, di) => (
                    <li key={di}>{d}</li>
                  ))}
                </ul>
              )}
              {m.role === "assistant" && m.navigationTarget && (
                <button
                  onClick={() => {
                    const nt = m.navigationTarget!;
                    track("assistant_paper_trading_navigation_used", {
                      agent: "assistant",
                      tab: "Assistant",
                      metadata: { symbol: nt.prefill.symbol, assetClass: nt.prefill.assetClass },
                    });
                    navigateTo(nt.target.primaryId, nt.target.secondaryId);
                  }}
                  className="jv-btn mt-2"
                  style={{ padding: "6px 12px", fontSize: 12 }}
                >
                  Open Paper Trading — {describePrefill(m.navigationTarget.prefill)}
                </button>
              )}
            </div>
          </div>
        ))}

        {loading && <div className="text-sm" style={{ color: "var(--text-2)" }}>Thinking…</div>}
      </div>

      {error && (
        <div
          className="p-3 text-sm mb-4"
          style={{ border: "1px solid var(--danger)", background: "rgba(232, 99, 122, 0.08)", color: "var(--danger)" }}
        >
          {error}
        </div>
      )}

      <div className="flex items-center gap-3 mb-2 text-xs" style={{ color: "var(--text-2)" }}>
        {speechOutputSupported && (
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={speakReplies}
              onChange={(e) => {
                setSpeakReplies(e.target.checked);
                track("assistant_speak_replies_toggled", { agent: "assistant", tab: "Assistant", metadata: { enabled: e.target.checked } });
              }}
            />
            Read replies aloud
          </label>
        )}
        {!voiceSupported && (
          <span>Voice input isn&apos;t supported in this browser — try Chrome, Edge, or Safari.</span>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2"
      >
        {voiceSupported && (
          <button
            type="button"
            onClick={toggleListening}
            title={listening ? "Stop listening" : "Speak your question"}
            className={`shrink-0 px-3 py-2 text-sm ${listening ? "animate-pulse" : ""}`}
            style={
              listening
                ? { border: "1px solid var(--danger)", background: "rgba(232, 99, 122, 0.1)", color: "var(--danger)" }
                : { border: "1px solid var(--line)", color: "var(--text-1)" }
            }
          >
            {listening ? "● Listening" : "🎤"}
          </button>
        )}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about a ticker, a concept, or where to find something…"
          className="jv-input flex-1"
        />
        <button type="submit" disabled={loading || !input.trim()} className="jv-btn">
          Send
        </button>
      </form>

      <div className="flex flex-wrap gap-2 mt-3">
        <button
          onClick={() => prefillFeedback("I have a suggestion: ")}
          className="text-xs px-3 py-1"
          style={{ borderRadius: 9999, border: "1px solid var(--line)", color: "var(--text-2)" }}
        >
          💡 Suggest a feature
        </button>
        <button
          onClick={() => prefillFeedback("I ran into a problem: ")}
          className="text-xs px-3 py-1"
          style={{ borderRadius: 9999, border: "1px solid var(--line)", color: "var(--text-2)" }}
        >
          🐛 Report a problem
        </button>
        <span className="text-xs self-center" style={{ color: "var(--text-2)" }}>
          Finish the sentence and send — the assistant logs it for the team.
        </span>
      </div>
    </div>
  );
}
