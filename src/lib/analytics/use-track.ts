"use client";

import { useCallback, useEffect, useRef } from "react";

const SESSION_KEY = "analytics-session-id";

function getSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

interface TrackExtra {
  agent?: string;
  tab?: string;
  symbol?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Anonymous, fire-and-forget usage tracking. Never blocks the UI and never
 * surfaces a failure — analytics is opt-in infrastructure layered on top of
 * this app, not a dependency of it. See SUPABASE_INTEGRATION_NOTES.md.
 */
export function useTrackEvent() {
  const sessionIdRef = useRef<string>("");

  useEffect(() => {
    sessionIdRef.current = getSessionId();
  }, []);

  const track = useCallback((eventName: string, extra?: TrackExtra) => {
    const sessionId = sessionIdRef.current || getSessionId();
    try {
      fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, eventName, ...extra }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Analytics must never break the app.
    }
  }, []);

  return { track };
}
