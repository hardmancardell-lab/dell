"use client";

import { useCallback, useEffect, useRef } from "react";

const SESSION_KEY = "analytics-session-id";
const FIRST_TOUCH_KEY = "analytics-first-touch-captured";

/** Shared anonymous session id — same one used for analytics events, reused by feedback capture so a submitted suggestion can be correlated with that session's other activity without collecting any identity. */
export function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

/**
 * First-touch UTM/referrer capture — returns the metadata to send with a
 * `session_start` event exactly once per browser (a localStorage flag is set
 * synchronously before returning, so if several components mount their own
 * useTrackEvent() at once on the same page load, only the first to run this
 * wins the race — acceptable for best-effort analytics). session_id already
 * persists indefinitely across visits, so this is a true first-touch model:
 * a later visit via a different link on the same browser won't re-attribute.
 */
function captureFirstTouchMetadata(): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  if (window.localStorage.getItem(FIRST_TOUCH_KEY)) return null;
  window.localStorage.setItem(FIRST_TOUCH_KEY, "1");
  const params = new URLSearchParams(window.location.search);
  return {
    utmSource: params.get("utm_source"),
    utmMedium: params.get("utm_medium"),
    utmCampaign: params.get("utm_campaign"),
    referrer: document.referrer || null,
    landingPath: window.location.pathname,
  };
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

  const track = useCallback((eventName: string, extra?: TrackExtra) => {
    const sessionId = sessionIdRef.current || getOrCreateSessionId();
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

  useEffect(() => {
    sessionIdRef.current = getOrCreateSessionId();
    const firstTouch = captureFirstTouchMetadata();
    if (firstTouch) {
      track("session_start", { metadata: firstTouch });
    }
  }, [track]);

  return { track };
}
