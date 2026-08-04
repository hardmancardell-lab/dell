"use client";

import { useState } from "react";

export default function GatePage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.href = "/";
      } else {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Incorrect password.");
      }
    } catch {
      setError("Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black flex items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-xs flex flex-col gap-3">
        <h1 className="text-sm font-semibold text-center mb-2">Private</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          className="w-full text-sm border border-zinc-300 dark:border-zinc-700 rounded px-3 py-2 bg-transparent"
        />
        {error && <p className="text-xs text-red-600 dark:text-red-400 text-center">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !password}
          className="text-sm px-3 py-2 rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
        >
          {submitting ? "Checking…" : "Enter"}
        </button>
      </form>
    </div>
  );
}
