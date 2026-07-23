"use client";

import { useState } from "react";
import type { AlertChannel, AlertConditionType, AlertRuleInput, AssetClass } from "@/lib/agents/trading-agent/types";

const ASSET_CLASSES: AssetClass[] = ["equity", "bond", "option", "future", "forex", "commodity"];

const CONDITION_TYPES: { value: AlertConditionType; label: string }[] = [
  { value: "price_threshold", label: "Price Threshold" },
  { value: "volume_displacement", label: "Volume Displacement" },
  { value: "momentum", label: "Momentum (3-Day Green Streak)" },
  { value: "mean_reversion", label: "Mean Reversion (Z-Score)" },
  { value: "orb_breakout", label: "Opening Range Breakout" },
  { value: "unusual_options", label: "Unusual Options Activity" },
  { value: "macro_news_spike", label: "Macro/Geopolitical News Spike" },
];

interface RuleRow {
  key: string;
  ticker: string;
  assetClass: AssetClass;
  conditionType: AlertConditionType;
  targetPrice: string;
  direction: "above" | "below";
  openingRangeMinutes: "5" | "15" | "30";
  query: string;
}

function newRow(): RuleRow {
  return {
    key: crypto.randomUUID(),
    ticker: "",
    assetClass: "equity",
    conditionType: "price_threshold",
    targetPrice: "",
    direction: "above",
    openingRangeMinutes: "15",
    query: "",
  };
}

function toRuleInput(row: RuleRow): AlertRuleInput | { error: string } {
  const ticker = row.ticker.trim().toUpperCase();
  if (!ticker) return { error: "Every row needs a ticker." };

  let params: Record<string, unknown> = {};
  if (row.conditionType === "price_threshold") {
    const targetPrice = Number(row.targetPrice);
    if (!row.targetPrice || !Number.isFinite(targetPrice)) {
      return { error: `${ticker}: a numeric target price is required.` };
    }
    params = { targetPrice, direction: row.direction };
  } else if (row.conditionType === "orb_breakout") {
    params = { openingRangeMinutes: Number(row.openingRangeMinutes) };
  } else if (row.conditionType === "macro_news_spike") {
    params = row.query.trim() ? { query: row.query.trim() } : {};
  }

  return { ticker, assetClass: row.assetClass, conditionType: row.conditionType, params };
}

export function AlertsSubscribeTab() {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState<AlertChannel>("email");
  const [rows, setRows] = useState<RuleRow[]>([newRow()]);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function updateRow(key: string, patch: Partial<RuleRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!consent) {
      setError("You must check the consent box to subscribe.");
      return;
    }
    if (!email.trim() && !phone.trim()) {
      setError("Enter an email address and/or a phone number.");
      return;
    }

    const ruleInputs: AlertRuleInput[] = [];
    for (const row of rows) {
      const result = toRuleInput(row);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      ruleInputs.push(result);
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/alerts/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim() || null,
          phone: phone.trim() || null,
          channel,
          consent: true,
          rules: ruleInputs,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Unknown error");
      } else {
        setSuccess(true);
        setRows([newRow()]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="jarvis">
      <p className="jv-eyebrow">Trading Agent &middot; Alerts</p>
      <h1 className="jv-title">Push Alerts</h1>
      <p className="jv-lede">
        Get an email and/or text the moment a real condition fires — price thresholds, volume
        displacement, momentum, mean reversion, opening-range breakouts, unusual options activity,
        or a macro/geopolitical news coverage spike. Checked every 15 minutes during market hours
        (9:30am-4:00pm ET, weekdays).
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-8 mt-6">
        <section>
          <div className="jv-strip-title">Contact Info</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">
              <span className="jv-label" style={{ marginBottom: 0 }}>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="jv-input"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="jv-label" style={{ marginBottom: 0 }}>Phone (SMS)</span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+15551234567"
                className="jv-input"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="jv-label" style={{ marginBottom: 0 }}>Channel</span>
              <select value={channel} onChange={(e) => setChannel(e.target.value as AlertChannel)} className="jv-select">
                <option value="email">Email only</option>
                <option value="sms">SMS only</option>
                <option value="both">Both</option>
              </select>
            </label>
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-2">
            <div className="jv-strip-title" style={{ marginBottom: 0 }}>Alert Rules</div>
            <button type="button" onClick={() => setRows((prev) => [...prev, newRow()])} className="jv-btn-outline">
              + Add Rule
            </button>
          </div>
          <div className="flex flex-col gap-3">
            {rows.map((row) => (
              <div key={row.key} className="jv-card">
                <div className="jv-br-b" />
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="jv-label" style={{ marginBottom: 0 }}>Ticker</span>
                    <input
                      value={row.ticker}
                      onChange={(e) => updateRow(row.key, { ticker: e.target.value })}
                      placeholder="AAPL"
                      className="jv-input"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="jv-label" style={{ marginBottom: 0 }}>Asset Class</span>
                    <select
                      value={row.assetClass}
                      onChange={(e) => updateRow(row.key, { assetClass: e.target.value as AssetClass })}
                      className="jv-select"
                    >
                      {ASSET_CLASSES.map((a) => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 sm:col-span-2">
                    <span className="jv-label" style={{ marginBottom: 0 }}>Condition</span>
                    <select
                      value={row.conditionType}
                      onChange={(e) => updateRow(row.key, { conditionType: e.target.value as AlertConditionType })}
                      className="jv-select"
                    >
                      {CONDITION_TYPES.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </label>

                  {row.conditionType === "price_threshold" && (
                    <>
                      <label className="flex flex-col gap-1">
                        <span className="jv-label" style={{ marginBottom: 0 }}>Target Price</span>
                        <input
                          type="number"
                          step="any"
                          value={row.targetPrice}
                          onChange={(e) => updateRow(row.key, { targetPrice: e.target.value })}
                          placeholder="150.00"
                          className="jv-input"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="jv-label" style={{ marginBottom: 0 }}>Direction</span>
                        <select
                          value={row.direction}
                          onChange={(e) => updateRow(row.key, { direction: e.target.value as "above" | "below" })}
                          className="jv-select"
                        >
                          <option value="above">Price rises above</option>
                          <option value="below">Price falls below</option>
                        </select>
                      </label>
                    </>
                  )}

                  {row.conditionType === "orb_breakout" && (
                    <label className="flex flex-col gap-1">
                      <span className="jv-label" style={{ marginBottom: 0 }}>Opening Range</span>
                      <select
                        value={row.openingRangeMinutes}
                        onChange={(e) => updateRow(row.key, { openingRangeMinutes: e.target.value as "5" | "15" | "30" })}
                        className="jv-select"
                      >
                        <option value="5">5 min</option>
                        <option value="15">15 min</option>
                        <option value="30">30 min</option>
                      </select>
                    </label>
                  )}

                  {row.conditionType === "macro_news_spike" && (
                    <label className="flex flex-col gap-1 sm:col-span-2">
                      <span className="jv-label" style={{ marginBottom: 0 }}>
                        News Query (optional, defaults to ticker)
                      </span>
                      <input
                        value={row.query}
                        onChange={(e) => updateRow(row.key, { query: e.target.value })}
                        placeholder={`e.g. "Federal Reserve" OR inflation`}
                        className="jv-input"
                      />
                    </label>
                  )}
                </div>

                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
                    className="text-xs mt-3"
                    style={{ color: "var(--text-2)" }}
                  >
                    Remove this rule
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        <label className="flex items-start gap-2 text-sm" style={{ color: "var(--text-1)" }}>
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-1"
          />
          <span>
            I agree to receive alert emails and/or text messages at the contact info above. Message
            and data rates may apply for SMS. Reply STOP to any text to unsubscribe, or use the
            unsubscribe link in any email. I can withdraw consent at any time.
          </span>
        </label>

        {error && (
          <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
            {error}
          </div>
        )}
        {success && (
          <div className="jv-card" style={{ borderColor: "var(--signal-dim)", color: "var(--signal)" }}>
            Subscribed. You&apos;ll get an alert the next time one of these conditions fires during market hours.
          </div>
        )}

        <button type="submit" disabled={submitting} className="jv-btn self-start">
          {submitting ? "Subscribing…" : "Subscribe to Alerts"}
        </button>
      </form>
    </div>
  );
}
