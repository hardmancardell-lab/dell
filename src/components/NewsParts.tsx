"use client";

import { useState } from "react";
import type { NewsGroup, NewsItem, NewsSection, SourceStatus, TickerNewsGroups } from "@/lib/news/news-core";
import { describeNewsTime, HUB_NOTE_AS_WRITTEN, HUB_NOTE_NOT_ADVICE } from "@/lib/news/news-core";

/**
 * Small display pieces shared by NewsHubTab and ClientNewsPanel. They show a headline, a link, the outlet name and a time
 * that says what it means. They never show article text.
 */

export function NotAdviceNote() {
  return (
    <p className="text-xs" style={{ color: "var(--text-2)" }}>
      {HUB_NOTE_NOT_ADVICE} {HUB_NOTE_AS_WRITTEN}
    </p>
  );
}

const KIND_LABEL: Record<NewsItem["kind"], string | null> = { news: null, "press-release": "Press release", filing: "SEC filing" };

export function NewsItemRow({ item, now }: { item: NewsItem; now?: number }) {
  const kind = KIND_LABEL[item.kind];
  return (
    <li className="text-sm">
      <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "var(--text-0)" }}>
        {item.title}
        <span aria-hidden="true"> {"↗"}</span>
        <span className="sr-only"> (opens the original page in a new tab)</span>
      </a>
      <div className="text-[11px] mt-0.5" style={{ color: "var(--text-2)" }}>
        <span style={{ color: "var(--text-1)" }}>{item.source}</span>
        {kind && <> {"·"} {kind}</>} {"·"} {describeNewsTime(item, now)}
        {item.opinion && <> {"·"} <span style={{ color: "var(--verdict)" }}>Opinion-style headline</span></>}
        {item.alsoFrom && item.alsoFrom.length > 0 && (
          <> {"·"} also from {item.alsoFrom.slice(0, 3).join(", ")}{item.alsoFrom.length > 3 ? ` and ${item.alsoFrom.length - 3} more` : ""}</>
        )}
      </div>
    </li>
  );
}

export function NewsList({ items, now }: { items: NewsItem[]; now?: number }) {
  return (
    <ul className="flex flex-col gap-3">
      {items.map((i) => (
        <NewsItemRow key={i.url} item={i} now={now} />
      ))}
    </ul>
  );
}

/** Says where the headlines came from and what each source is. Open by default when a source is failing. */
export function SourceList({ sources }: { sources: SourceStatus[] }) {
  if (sources.length === 0) return null;
  const anyBad = sources.some((s) => !s.ok);
  return (
    <details className="mt-4" open={anyBad}>
      <summary className="text-xs cursor-pointer" style={{ color: "var(--text-1)" }}>
        Where these headlines come from ({sources.filter((s) => s.ok).length} of {sources.length} sources working)
      </summary>
      <ul className="mt-2 flex flex-col gap-2">
        {sources.map((s) => (
          <li key={s.name} className="text-xs" style={{ color: "var(--text-2)" }}>
            <span style={{ color: s.ok ? "var(--text-0)" : "var(--verdict)" }}>
              {s.name}: {s.ok ? `${s.count} headline${s.count === 1 ? "" : "s"}` : "not working right now"}
            </span>
            <div>{s.what}</div>
            {s.note && <div style={{ color: "var(--verdict)" }}>{s.note}</div>}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function SectionFooter({ section }: { section: Pick<NewsSection, "asOf" | "notes"> }) {
  const when = new Date(section.asOf);
  const label = Number.isNaN(when.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(when);
  return (
    <div className="mt-4 flex flex-col gap-1">
      {section.notes.map((n) => (
        <p key={n} className="text-xs" style={{ color: "var(--text-1)" }}>
          {n}
        </p>
      ))}
      {label && (
        <p className="text-[11px]" style={{ color: "var(--text-2)" }}>
          List built {label}. Results are saved for a few minutes, so a new story can take a little while to appear.
        </p>
      )}
      <NotAdviceNote />
    </div>
  );
}

export function EmptyOrError({ message, tone }: { message: string; tone: "empty" | "error" }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className="jv-card text-sm"
      style={{ borderColor: tone === "error" ? "var(--danger)" : "var(--line)", color: tone === "error" ? "var(--danger)" : "var(--text-1)" }}
    >
      {message}
    </div>
  );
}

/** Plain message for a failed request. Never shows a raw error, a path or a status line. */
export async function readNewsError(res: Response): Promise<string> {
  if (res.status === 401) return "Your sign-in has ended. Sign in again to see the news.";
  if (res.status === 429) return "That was too many requests in a row. Wait a minute and try again.";
  const body = await res.json().catch(() => null);
  const msg = body && typeof body.error === "string" ? body.error : "";
  return msg.length > 0 && msg.length < 200 ? msg : "News could not be loaded right now. Try again in a few minutes.";
}

/** One labelled group (About this asset, or Market and macro) with a plain empty state and a show-more toggle. */
export function NewsGroupCard({ group, limit = 6, now }: { group: NewsGroup; limit?: number; now?: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? group.items : group.items.slice(0, limit);
  return (
    <section className="jv-card" aria-label={group.title}>
      <div className="jv-br-b" />
      <h3 className="text-sm font-semibold" style={{ color: "var(--text-0)" }}>
        {group.title} {group.items.length > 0 && <span className="text-xs font-normal" style={{ color: "var(--text-2)" }}>({group.items.length})</span>}
      </h3>
      <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>{group.description}</p>
      {group.items.length === 0 ? <EmptyOrError tone="empty" message={group.empty ?? "No headlines right now."} /> : <NewsList items={shown} now={now} />}
      {group.items.length > limit && (
        <button className="jv-btn-outline mt-3" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${group.items.length}`}
        </button>
      )}
      <SourceList sources={group.sources} />
    </section>
  );
}

/** Both groups for a ticker, with the notes and the not-advice line. Used by the hub and by the news under a chart. */
export function TickerNewsGroupsView({ data, limit = 6 }: { data: TickerNewsGroups; limit?: number }) {
  return (
    <div className="flex flex-col gap-3">
      <NewsGroupCard group={data.about} limit={limit} />
      <NewsGroupCard group={data.macro} limit={limit} />
      <SectionFooter section={{ asOf: data.asOf, notes: data.notes }} />
    </div>
  );
}
