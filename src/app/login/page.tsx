"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(signInError.message);
      } else {
        window.location.href = "/";
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
        <h1 className="text-sm font-semibold text-center mb-2">Sign in</h1>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          autoFocus
          className="w-full text-sm border border-zinc-300 dark:border-zinc-700 rounded px-3 py-2 bg-transparent"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full text-sm border border-zinc-300 dark:border-zinc-700 rounded px-3 py-2 bg-transparent"
        />
        {error && <p className="text-xs text-red-600 dark:text-red-400 text-center">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !email || !password}
          className="text-sm px-3 py-2 rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-xs text-center text-zinc-500">
          No account? <Link href="/signup" className="underline">Create one</Link>
        </p>
      </form>
    </div>
  );
}
