"use client";

import { useEffect, useState } from "react";

interface ViewAsStatus {
  slug: string;
  clientName: string;
}

export function AdminViewAsBanner() {
  const [status, setStatus] = useState<ViewAsStatus | null>(null);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    fetch("/api/admin/view-as/status")
      .then((r) => r.json())
      .then((json) => setStatus(json.viewingAs ?? null))
      .catch(() => {});
  }, []);

  if (!status) return null;

  async function exit() {
    setExiting(true);
    try {
      await fetch("/api/admin/view-as/exit", { method: "POST" });
    } finally {
      window.location.href = "/admin/clients";
    }
  }

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 9999,
        background: "var(--verdict, #b45309)",
        color: "#fff",
        fontSize: "0.75rem",
        padding: "0.5rem 1rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.75rem",
      }}
    >
      <span>
        Admin viewing as <strong>{status.clientName}</strong> — read-only
      </span>
      <button
        onClick={exit}
        disabled={exiting}
        style={{
          background: "rgba(255,255,255,0.15)",
          border: "1px solid rgba(255,255,255,0.4)",
          borderRadius: "0.25rem",
          color: "#fff",
          padding: "0.15rem 0.6rem",
          cursor: "pointer",
        }}
      >
        {exiting ? "Exiting…" : "Exit"}
      </button>
    </div>
  );
}
