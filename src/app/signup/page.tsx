"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) {
        setError(signUpError.message);
      } else if (data.session) {
        // Email confirmation is off for this project — session is active immediately.
        window.location.href = "/";
      } else {
        // Email confirmation is required before the account is usable.
        setCheckEmail(true);
      }
    } catch {
      setError("Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (checkEmail) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-black flex items-center justify-center px-6">
        <div className="w-full max-w-xs text-center">
          <h1 className="text-sm font-semibold mb-2">Check your email</h1>
          <p className="text-xs text-zinc-500">We sent a confirmation link to {email}. Click it, then come back and sign in.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black flex items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-xs flex flex-col gap-3">
        <h1 className="text-sm font-semibold text-center mb-2">Create account</h1>
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
          placeholder="Password (min 6 characters)"
          minLength={6}
          className="w-full text-sm border border-zinc-300 dark:border-zinc-700 rounded px-3 py-2 bg-transparent"
        />
        {error && <p className="text-xs text-red-600 dark:text-red-400 text-center">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !email || password.length < 6}
          className="text-sm px-3 py-2 rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create account"}
        </button>
        <p className="text-xs text-center text-zinc-500">
          Already have one? <Link href="/login" className="underline">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
