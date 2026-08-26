"use client";

import { useEffect, useState } from "react";
import { assetClassLabel } from "@/lib/agents/trading-agent/asset-class-label";
import type { AdvisorClient, AssetClass, PortfolioHolding } from "@/lib/agents/trading-agent/types";

const ASSET_CLASSES: AssetClass[] = ["equity", "bond", "option", "future", "forex", "commodity"];

function fmtUsd(v: number): string {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function AdvisorClientsManager() {
  const [clients, setClients] = useState<AdvisorClient[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [passcode, setPasscode] = useState("");
  const [cashBalance, setCashBalance] = useState("");
  const [linkedEmail, setLinkedEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [cashEditSlug, setCashEditSlug] = useState<string | null>(null);
  const [cashEditValue, setCashEditValue] = useState("");
  const [cashSaving, setCashSaving] = useState(false);
  const [emailEditSlug, setEmailEditSlug] = useState<string | null>(null);
  const [emailEditValue, setEmailEditValue] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [holdings, setHoldings] = useState<PortfolioHolding[] | null>(null);
  const [holdingsError, setHoldingsError] = useState<string | null>(null);

  const [symbol, setSymbol] = useState("");
  const [assetClass, setAssetClass] = useState<AssetClass>("equity");
  const [shares, setShares] = useState("");
  const [costBasis, setCostBasis] = useState("");
  const [acquiredDate, setAcquiredDate] = useState(() => new Date().toISOString().slice(0, 10));

  async function loadClients() {
    setError(null);
    try {
      const res = await fetch("/api/advisor/clients");
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Unknown error");
      else setClients(json.clients as AdvisorClient[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  useEffect(() => {
    loadClients();
  }, []);

  async function createClient(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !passcode.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/advisor/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          passcode: passcode.trim(),
          cashBalance: Number(cashBalance) || 0,
          linkedEmail: linkedEmail.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Unknown error");
      else {
        setName("");
        setPasscode("");
        setCashBalance("");
        setLinkedEmail("");
        await loadClients();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setCreating(false);
    }
  }

  function startCashEdit(client: AdvisorClient) {
    setCashEditSlug(client.slug);
    setCashEditValue(String(client.cashBalance));
  }

  async function saveCashEdit(slug: string) {
    const value = Number(cashEditValue);
    if (!Number.isFinite(value) || value < 0) return;
    setCashSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/advisor/clients/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cashBalance: value }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Unknown error");
      else {
        setCashEditSlug(null);
        await loadClients();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setCashSaving(false);
    }
  }

  function startEmailEdit(client: AdvisorClient) {
    setEmailEditSlug(client.slug);
    setEmailEditValue(client.linkedEmail ?? "");
  }

  async function saveEmailEdit(slug: string) {
    setEmailSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/advisor/clients/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedEmail: emailEditValue.trim() || null }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Unknown error");
      else {
        setEmailEditSlug(null);
        await loadClients();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setEmailSaving(false);
    }
  }

  const [viewAsLoadingSlug, setViewAsLoadingSlug] = useState<string | null>(null);

  async function viewAsClient(slug: string) {
    setViewAsLoadingSlug(slug);
    setError(null);
    try {
      const res = await fetch(`/api/admin/view-as/${slug}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Unknown error");
        return;
      }
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setViewAsLoadingSlug(null);
    }
  }

  async function removeClient(slug: string) {
    if (!confirm("Delete this client link and all its holdings? This can't be undone.")) return;
    await fetch(`/api/advisor/clients/${slug}`, { method: "DELETE" });
    if (selectedSlug === slug) {
      setSelectedSlug(null);
      setHoldings(null);
    }
    await loadClients();
  }

  async function loadHoldings(slug: string) {
    setSelectedSlug(slug);
    setHoldings(null);
    setHoldingsError(null);
    try {
      const res = await fetch(`/api/advisor/clients/${slug}/holdings`);
      const json = await res.json();
      if (!res.ok) setHoldingsError(json.error ?? "Unknown error");
      else setHoldings(json.holdings as PortfolioHolding[]);
    } catch (err) {
      setHoldingsError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  async function addHolding(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSlug) return;
    const sharesNum = Number(shares);
    const costBasisNum = Number(costBasis);
    if (!symbol.trim() || !Number.isFinite(sharesNum) || sharesNum <= 0 || !Number.isFinite(costBasisNum)) return;
    setHoldingsError(null);
    try {
      const res = await fetch(`/api/advisor/clients/${selectedSlug}/holdings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: symbol.trim(), assetClass, shares: sharesNum, costBasisPerShare: costBasisNum, acquiredDate }),
      });
      const json = await res.json();
      if (!res.ok) setHoldingsError(json.error ?? "Unknown error");
      else {
        setSymbol("");
        setShares("");
        setCostBasis("");
        await loadHoldings(selectedSlug);
      }
    } catch (err) {
      setHoldingsError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  async function removeHolding(holdingId: string) {
    if (!selectedSlug) return;
    await fetch(`/api/advisor/clients/${selectedSlug}/holdings/${holdingId}`, { method: "DELETE" });
    await loadHoldings(selectedSlug);
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 px-6 py-10">
      <div className="max-w-3xl mx-auto flex flex-col gap-8">
        <div>
          <a href="/admin/analytics" className="text-xs text-teal-400 hover:underline">→ Usage Analytics</a>
          <h1 className="text-xl font-semibold text-zinc-50 mt-1">Client Dashboards</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Create a private, passcode-protected link for a specific client. They see a read-only view of the
            holdings/valuation you enter here — real market data, same engine as the Portfolio Tracker.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">{error}</div>
        )}

        <form onSubmit={createClient} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Client name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. John Smith"
              className="text-sm border border-zinc-700 rounded px-3 py-2 bg-transparent"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Passcode</label>
            <input
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="Passcode they'll enter"
              className="text-sm border border-zinc-700 rounded px-3 py-2 bg-transparent"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Cash reserve ($)</label>
            <input
              value={cashBalance}
              onChange={(e) => setCashBalance(e.target.value)}
              placeholder="e.g. 2250"
              type="number"
              min="0"
              step="any"
              className="text-sm border border-zinc-700 rounded px-3 py-2 bg-transparent w-32"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Client email (optional)</label>
            <input
              value={linkedEmail}
              onChange={(e) => setLinkedEmail(e.target.value)}
              placeholder="auto-links their real account"
              type="email"
              className="text-sm border border-zinc-700 rounded px-3 py-2 bg-transparent w-56"
            />
          </div>
          <button
            type="submit"
            disabled={creating || !name.trim() || !passcode.trim()}
            className="text-sm px-4 py-2 rounded bg-zinc-100 text-zinc-900 disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create Client Link"}
          </button>
        </form>

        <div className="flex flex-col gap-3">
          {clients === null && <p className="text-sm text-zinc-500">Loading…</p>}
          {clients?.length === 0 && <p className="text-sm text-zinc-500">No clients yet — create one above.</p>}
          {clients?.map((c) => {
            const link = `${origin}/client/${c.slug}`;
            return (
              <div key={c.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-zinc-50">{c.name}</div>
                    <a href={link} target="_blank" rel="noopener noreferrer" className="text-xs text-teal-400 hover:underline">
                      {link}
                    </a>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => viewAsClient(c.slug)}
                      disabled={viewAsLoadingSlug === c.slug}
                      className="text-xs text-teal-400 hover:text-teal-300 underline disabled:opacity-50"
                      title="Open the real app scoped to this client's data — read-only, for walking them through a problem live"
                    >
                      {viewAsLoadingSlug === c.slug ? "Opening…" : "View as"}
                    </button>
                    <button
                      onClick={() => (selectedSlug === c.slug ? setSelectedSlug(null) : loadHoldings(c.slug))}
                      className="text-xs text-zinc-300 hover:text-zinc-100 underline"
                    >
                      {selectedSlug === c.slug ? "Hide holdings" : "Manage holdings"}
                    </button>
                    <button onClick={() => removeClient(c.slug)} className="text-xs text-red-400 hover:text-red-300">
                      Delete
                    </button>
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-2">
                  {cashEditSlug === c.slug ? (
                    <>
                      <span className="text-xs text-zinc-500">Cash reserve $</span>
                      <input
                        value={cashEditValue}
                        onChange={(e) => setCashEditValue(e.target.value)}
                        type="number"
                        min="0"
                        step="any"
                        autoFocus
                        className="text-xs border border-zinc-700 rounded px-2 py-1 bg-transparent w-24"
                      />
                      <button
                        onClick={() => saveCashEdit(c.slug)}
                        disabled={cashSaving}
                        className="text-xs text-teal-400 hover:text-teal-300 disabled:opacity-50"
                      >
                        {cashSaving ? "Saving…" : "Save"}
                      </button>
                      <button onClick={() => setCashEditSlug(null)} className="text-xs text-zinc-500 hover:text-zinc-300">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-xs text-zinc-500">Cash reserve: {fmtUsd(c.cashBalance)}</span>
                      <button onClick={() => startCashEdit(c)} className="text-xs text-zinc-400 hover:text-zinc-200 underline">
                        Edit
                      </button>
                    </>
                  )}
                </div>

                <div className="mt-1 flex items-center gap-2">
                  {emailEditSlug === c.slug ? (
                    <>
                      <span className="text-xs text-zinc-500">Client email</span>
                      <input
                        value={emailEditValue}
                        onChange={(e) => setEmailEditValue(e.target.value)}
                        type="email"
                        autoFocus
                        placeholder="their real login email"
                        className="text-xs border border-zinc-700 rounded px-2 py-1 bg-transparent w-56"
                      />
                      <button
                        onClick={() => saveEmailEdit(c.slug)}
                        disabled={emailSaving}
                        className="text-xs text-teal-400 hover:text-teal-300 disabled:opacity-50"
                      >
                        {emailSaving ? "Saving…" : "Save"}
                      </button>
                      <button onClick={() => setEmailEditSlug(null)} className="text-xs text-zinc-500 hover:text-zinc-300">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-xs text-zinc-500">
                        Linked email: {c.linkedEmail ?? <span className="italic">none — set one so their real account auto-links</span>}
                      </span>
                      <button onClick={() => startEmailEdit(c)} className="text-xs text-zinc-400 hover:text-zinc-200 underline">
                        Edit
                      </button>
                    </>
                  )}
                </div>

                {selectedSlug === c.slug && (
                  <div className="mt-4 pt-4 border-t border-zinc-800">
                    <form onSubmit={addHolding} className="flex flex-wrap items-end gap-3 mb-4">
                      <input
                        value={symbol}
                        onChange={(e) => setSymbol(e.target.value)}
                        placeholder="Symbol"
                        className="text-sm border border-zinc-700 rounded px-2 py-1.5 bg-transparent w-24"
                      />
                      <select
                        value={assetClass}
                        onChange={(e) => setAssetClass(e.target.value as AssetClass)}
                        className="text-sm border border-zinc-700 rounded px-2 py-1.5 bg-transparent"
                      >
                        {ASSET_CLASSES.map((ac) => (
                          <option key={ac} value={ac}>{assetClassLabel(ac)}</option>
                        ))}
                      </select>
                      <input
                        value={shares}
                        onChange={(e) => setShares(e.target.value)}
                        placeholder="Shares"
                        type="number"
                        step="any"
                        className="text-sm border border-zinc-700 rounded px-2 py-1.5 bg-transparent w-24"
                      />
                      <input
                        value={costBasis}
                        onChange={(e) => setCostBasis(e.target.value)}
                        placeholder="Cost/share"
                        type="number"
                        step="any"
                        className="text-sm border border-zinc-700 rounded px-2 py-1.5 bg-transparent w-28"
                      />
                      <input
                        value={acquiredDate}
                        onChange={(e) => setAcquiredDate(e.target.value)}
                        type="date"
                        className="text-sm border border-zinc-700 rounded px-2 py-1.5 bg-transparent"
                      />
                      <button type="submit" className="text-sm px-3 py-1.5 rounded bg-zinc-100 text-zinc-900">
                        Add
                      </button>
                    </form>

                    {holdingsError && <p className="text-xs text-red-400 mb-2">{holdingsError}</p>}
                    {holdings === null ? (
                      <p className="text-xs text-zinc-500">Loading holdings…</p>
                    ) : holdings.length === 0 ? (
                      <p className="text-xs text-zinc-500">No holdings yet.</p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-zinc-500">
                            <th className="pb-1 font-normal">Symbol</th>
                            <th className="pb-1 font-normal">Class</th>
                            <th className="pb-1 font-normal text-right">Shares</th>
                            <th className="pb-1 font-normal text-right">Cost/Share</th>
                            <th className="pb-1 font-normal">Acquired</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {holdings.map((h) => (
                            <tr key={h.id} className="border-t border-zinc-800/60">
                              <td className="py-1.5 text-zinc-100 font-medium">{h.symbol}</td>
                              <td className="py-1.5 text-zinc-400">{assetClassLabel(h.assetClass)}</td>
                              <td className="py-1.5 text-right tabular-nums text-zinc-300">{h.shares}</td>
                              <td className="py-1.5 text-right tabular-nums text-zinc-300">{fmtUsd(h.costBasisPerShare)}</td>
                              <td className="py-1.5 text-zinc-400">{h.acquiredDate}</td>
                              <td className="py-1.5 text-right">
                                <button onClick={() => removeHolding(h.id)} className="text-zinc-500 hover:text-red-400">
                                  &times;
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
