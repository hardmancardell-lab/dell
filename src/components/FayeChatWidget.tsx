"use client";

import { useEffect, useRef, useState } from "react";
import { usePortfolio } from "@/lib/agents/trading-agent/portfolio-storage";
import type { AssetClass } from "@/lib/agents/trading-agent/types";

// Faye's server still lives at the /pilp/* routes (see Documents/Pilp_Assistant) —
// only her displayed name changed, not the underlying package/endpoints.
const FAYE_BASE_URL = "http://127.0.0.1:7810";
const STATUS_URL = `${FAYE_BASE_URL}/pilp/status`;
const CHAT_URL = `${FAYE_BASE_URL}/pilp/chat`;

type FayeStatus = "checking" | "available" | "unavailable";

type ProposedAction =
  | { type: "add_holding"; params: { symbol: string; assetClass: string; shares: number; costBasisPerShare: number; acquiredDate: string } }
  | { type: "sell_holding"; params: { symbol: string; sharesSold: number; salePricePerShare: number; fee: number; saleDate: string } }
  | { type: "remove_holding"; params: { symbol: string } };

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  kind?: "generated" | "conduct" | "guardrail" | "action_proposal";
  error?: boolean;
  action?: ProposedAction | null;
  actionStatus?: "pending" | "done" | "cancelled" | "error";
  actionResultText?: string;
}

/**
 * Faye runs entirely on the user's own machine (Flask + Ollama, localhost
 * only) — see Documents/Pilp_Assistant. This widget only shows its entry
 * point once GET /pilp/status reports AVAILABLE, per INTEGRATION.md, and
 * follows that doc's exact SSE parsing shape. state.portfolio is built from
 * the same localStorage-only holdings the Portfolio Tracker itself uses —
 * nothing here reaches a server; it flows straight from this browser to the
 * local Faye process and back.
 */
export function FayeChatWidget() {
  const [status, setStatus] = useState<FayeStatus>("checking");
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const { holdings, hydrated, addHolding, removeHolding, sellHolding } = usePortfolio();
  const scrollRef = useRef<HTMLDivElement>(null);

  async function checkStatus() {
    try {
      const res = await fetch(STATUS_URL, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error("not ok");
      const json = await res.json();
      setStatus(json?.runtime?.status === "AVAILABLE" ? "available" : "unavailable");
    } catch {
      setStatus("unavailable");
    }
  }

  useEffect(() => {
    checkStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

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

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || sending) return;
    setInput("");
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", text: question };
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: "assistant", text: "" }]);
    setSending(true);

    try {
      const res = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, state: buildState(), stream: true }),
      });
      if (!res.body) throw new Error("Faye returned no response stream.");

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let text = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const blocks = buf.split("\n\n");
        for (const block of blocks) {
          if (!block.includes("event:")) continue;
          const event = block.match(/event: (\w+)/)?.[1];
          const dataMatch = block.match(/data: (.*)/);
          const data = dataMatch ? JSON.parse(dataMatch[1]) : {};
          if (event === "chunk" && typeof data.text === "string") {
            text += data.text;
            const snapshot = text;
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: snapshot } : m)));
          } else if (event === "done") {
            const kind = data.kind as ChatMessage["kind"];
            const action = (data.action ?? null) as ProposedAction | null;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, kind, action, actionStatus: action ? "pending" : undefined }
                  : m
              )
            );
          } else if (event === "error") {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, text: data.error ?? "Something went wrong.", error: true } : m))
            );
          }
        }
        buf = buf.slice(buf.lastIndexOf("\n\n") + 2);
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, text: err instanceof Error ? err.message : "Faye is not reachable right now.", error: true }
            : m
        )
      );
      setStatus("unavailable");
    } finally {
      setSending(false);
    }
  }

  // Faye never calls a mutating function herself -- she only ever produces
  // a proposal. This is the one and only place any of these three functions
  // get called from a Faye-originated action, and only after this explicit
  // click on the real numbers shown in the card below.
  function confirmAction(messageId: string, action: ProposedAction) {
    let resultText = "";
    let ok = true;
    if (action.type === "add_holding") {
      const p = action.params;
      addHolding(p.symbol, p.assetClass as AssetClass, p.shares, p.costBasisPerShare, p.acquiredDate);
      resultText = `Added ${p.shares} share(s) of ${p.symbol}.`;
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
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId ? { ...m, actionStatus: ok ? "done" : "error", actionResultText: resultText } : m
      )
    );
  }

  function cancelAction(messageId: string) {
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, actionStatus: "cancelled" } : m)));
  }

  if (status !== "available") return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) checkStatus();
        }}
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          zIndex: 999,
          borderRadius: "999px",
          padding: "10px 18px",
          background: "#0f6e56",
          color: "white",
          border: "none",
          fontSize: 13,
          fontWeight: 500,
          cursor: "pointer",
          boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
        }}
      >
        {open ? "Close Faye" : "Ask Faye"}
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            bottom: 76,
            right: 20,
            zIndex: 999,
            width: 340,
            maxHeight: 480,
            display: "flex",
            flexDirection: "column",
            background: "var(--surface-2, #16181c)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 12,
            boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>Faye</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
              Runs on your own computer — nothing you type leaves this machine.
            </div>
          </div>

          <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, minHeight: 180 }}>
            {messages.length === 0 && (
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                Ask about your portfolio, fees, risk, or any investing concept. Faye explains — it never tells you what to buy or sell.
              </div>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  background: m.role === "user" ? "#0f6e56" : m.error ? "rgba(210,80,80,0.18)" : "rgba(255,255,255,0.08)",
                  color: m.error ? "#f3a8a8" : "#fff",
                  borderRadius: 10,
                  padding: "6px 10px",
                  fontSize: 13,
                  whiteSpace: "pre-wrap",
                }}
              >
                {m.text || (m.role === "assistant" ? "…" : "")}
                {m.kind === "guardrail" && (
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>educational redirect</div>
                )}
                {m.action && m.actionStatus === "pending" && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.15)" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => confirmAction(m.id, m.action!)}
                        style={{ background: "#0f6e56", color: "#fff", border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => cancelAction(m.id)}
                        style={{ background: "transparent", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 6, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {m.actionStatus === "done" && (
                  <div style={{ fontSize: 11, color: "#8fd9c4", marginTop: 6 }}>✓ {m.actionResultText}</div>
                )}
                {m.actionStatus === "error" && (
                  <div style={{ fontSize: 11, color: "#f3a8a8", marginTop: 6 }}>{m.actionResultText}</div>
                )}
                {m.actionStatus === "cancelled" && (
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 6 }}>Cancelled -- nothing changed.</div>
                )}
              </div>
            ))}
          </div>

          <form onSubmit={sendMessage} style={{ display: "flex", gap: 6, padding: 10, borderTop: "1px solid rgba(255,255,255,0.1)" }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Faye…"
              disabled={sending}
              style={{
                flex: 1,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 8,
                padding: "6px 10px",
                color: "#fff",
                fontSize: 13,
              }}
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              style={{
                background: "#0f6e56",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "6px 12px",
                fontSize: 13,
                cursor: sending ? "default" : "pointer",
                opacity: sending || !input.trim() ? 0.6 : 1,
              }}
            >
              {sending ? "…" : "Send"}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
