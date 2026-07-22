"use client";

import { useEffect, useRef, useState } from "react";
import { getOrCreateSessionId } from "@/lib/analytics/use-track";
import type { AssistantMessage } from "@/lib/agents/assistant/types";

interface DisplayMessage extends AssistantMessage {
  toolsUsed?: string[];
  dataLimitations?: string[];
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
        return;
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply, toolsUsed: data.toolsUsed, dataLimitations: data.dataLimitations },
      ]);
      speak(data.reply);
    } catch {
      setError("Network error reaching the assistant.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <p className="text-zinc-500 mb-4">
        Answers questions about this app and, for "should I buy X" style questions, runs the real
        top-down process (macro → sector → company fundamentals → positioning) using this app's
        own live tools — never a fabricated number, and never a buy/sell directive.
      </p>

      <div className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-400 mb-4">
        Describes what this app's real, current data shows — not investment advice or a recommendation to buy or sell.
      </div>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 mb-4 min-h-[280px] max-h-[520px] overflow-y-auto p-4 flex flex-col gap-4">
        {messages.length === 0 && (
          <div>
            <div className="text-sm text-zinc-400 mb-3">Try asking:</div>
            <div className="flex flex-col gap-2 items-start">
              {EXAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="text-sm text-left rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-2 hover:border-zinc-400 dark:hover:border-zinc-600"
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
                className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black"
                    : "bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
                }`}
              >
                {m.content}
              </div>
              {m.role === "assistant" && m.toolsUsed && m.toolsUsed.length > 0 && (
                <div className="text-xs text-zinc-400 mt-1">
                  Data pulled from: {m.toolsUsed.map((t) => t.replace(/^get_/, "").replace(/_/g, " ")).join(", ")}
                </div>
              )}
              {m.role === "assistant" && m.dataLimitations && m.dataLimitations.length > 0 && (
                <ul className="text-xs text-amber-700 dark:text-amber-500 mt-1 list-disc list-inside">
                  {m.dataLimitations.map((d, di) => (
                    <li key={di}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}

        {loading && <div className="text-sm text-zinc-400">Thinking…</div>}
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/20 p-3 text-sm text-red-700 dark:text-red-400 mb-4">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3 mb-2 text-xs text-zinc-500">
        {speechOutputSupported && (
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={speakReplies} onChange={(e) => setSpeakReplies(e.target.checked)} />
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
            className={`shrink-0 rounded-lg border px-3 py-2 text-sm ${
              listening
                ? "border-red-400 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 animate-pulse"
                : "border-zinc-200 dark:border-zinc-800"
            }`}
          >
            {listening ? "● Listening" : "🎤"}
          </button>
        )}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about a ticker, a concept, or where to find something…"
          className="flex-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-5 py-2 text-sm font-medium disabled:opacity-50"
        >
          Send
        </button>
      </form>

      <div className="flex flex-wrap gap-2 mt-3">
        <button
          onClick={() => prefillFeedback("I have a suggestion: ")}
          className="text-xs rounded-full border border-zinc-200 dark:border-zinc-800 px-3 py-1 text-zinc-500 hover:border-zinc-400 dark:hover:border-zinc-600"
        >
          💡 Suggest a feature
        </button>
        <button
          onClick={() => prefillFeedback("I ran into a problem: ")}
          className="text-xs rounded-full border border-zinc-200 dark:border-zinc-800 px-3 py-1 text-zinc-500 hover:border-zinc-400 dark:hover:border-zinc-600"
        >
          🐛 Report a problem
        </button>
        <span className="text-xs text-zinc-400 self-center">
          Finish the sentence and send — the assistant logs it for the team.
        </span>
      </div>
    </div>
  );
}
