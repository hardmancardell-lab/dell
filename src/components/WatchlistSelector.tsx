"use client";

import { useState } from "react";
import { useWatchlist } from "@/lib/agents/trading-agent/watchlist-storage";

/** Self-contained — calls useWatchlist() itself, no props needed. Drop this into any tab that reads from the shared watchlist. */
export function WatchlistSelector() {
  const { watchlists, activeWatchlistId, setActiveWatchlistId, createWatchlist } = useWatchlist();
  const [newName, setNewName] = useState("");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    createWatchlist(newName);
    setNewName("");
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <span className="jv-label" style={{ marginBottom: 0 }}>
        Watchlist
      </span>
      <select
        value={activeWatchlistId}
        onChange={(e) => setActiveWatchlistId(e.target.value)}
        className="jv-select"
      >
        {watchlists.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
      <form onSubmit={handleCreate} className="flex items-center gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New watchlist name"
          className="jv-input w-40"
        />
        <button
          type="submit"
          disabled={!newName.trim()}
          className="jv-btn-outline"
        >
          Create
        </button>
      </form>
    </div>
  );
}
