"use client";

import { useState } from "react";
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

export function AssistantChatTab() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        body: JSON.stringify({ messages: nextMessages.map((m) => ({ role: m.role, content: m.content })) }),
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

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2"
      >
        <input
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
    </div>
  );
}
