// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/faye-aboutme.test.mts
// Faye About-me panel and memory wiring (package WP-C1b): the browser-side memory client and the panel's state machine run against a
// FAKE memory API that mirrors the route contracts in team_audits/2026-10-20/faye-wp-f-report.md section 2 (list, add, edit, delete one
// with undo, approve and reject, pause, export, delete all, erase, remember, the reauth_required answer, the flag-off behaviour).
// The screen is server-rendered to static markup to check what it shows (grouping, proposals first, empty / error / paused / flag-off
// states, plain-text rendering of hostile note text, labels and roles). The widget wiring (remember BEFORE the chat job, a failed call
// never blocks chat, the "Used N notes" line) is checked on the source here and in a real hidden browser run described in the report.
// No browser, no network, no Supabase.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

const MC = await import("../src/lib/faye/memory-client.ts");
const AM = await import("../src/components/faye/AboutMe.tsx");
const AV = await import("../src/components/faye/AboutMeView.tsx");
const NU = await import("../src/components/faye/AboutMeNotesUsed.tsx");
const ST = await import("../src/components/faye/AboutMeStyles.tsx");
const TR = await import("../src/lib/faye/transport.ts");

let failed = 0;
const t = (name: string, ok: unknown, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? " :: " + String(detail).slice(0, 300) : ""}`);
};
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ------------------------------------------------------------------ a fake memory API (mirrors the real route contracts)
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function makeApi(opts: any = {}) {
  const api: any = {
    enabled: opts.enabled ?? true,
    recent: opts.recent ?? true, // signed in within the last 30 minutes
    settings: { learning_paused: false, show_used_notes: true },
    items: [] as any[],
    calls: [] as any[],
    clock: 1_760_000_000_000,
    undoMinutes: 10,
    failNext: null as any, // { match: RegExp, status, body }
    next: 100,
    holdNext: null as null | Promise<void>,
  };
  const iso = (ms: number) => new Date(ms).toISOString();
  const mk = (o: any) => ({
    id: UUID(api.next++), category: "style", slot: null, fact: "x", source: "stated", source_ref: null, status: "approved", confidence: 95, effective_confidence: 95, faded: false,
    evidence_count: 1, approved_by: "owner", created_at: iso(api.clock - 86_400_000), updated_at: iso(api.clock), approved_at: iso(api.clock), last_used_at: null, use_count: 0,
    expires_at: null, supersedes: null, deleted_at: null, ...o,
  });
  api.add = (o: any) => {
    const it = mk(o);
    api.items.push(it);
    return it;
  };
  const json = (status: number, body: any, headers: any = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  const err = (code: string, status: number, detail?: string) => json(status, { ok: false, code, error: "server sentence that must never be shown", ...(detail ? { detail } : {}) });
  const live = () => api.items.filter((i: any) => !i.deleted_at || api.clock - Date.parse(i.deleted_at) < api.undoMinutes * 60_000);
  const find = (id: string) => api.items.find((i: any) => i.id === id && !i.purged);
  const screen = (text: string) => (/password|sk-[a-z0-9]{6,}|\b\d{13,19}\b/i.test(text) ? "credential" : /ignore .*rules|always say buy/i.test(text) ? "instruction" : null);

  api.fetch = async (url: string, init: any = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const u = new URL(url, "http://localhost");
    const path = u.pathname.replace("/api/faye/memory", "") || "/";
    let body: any = {};
    if (method !== "GET") {
      try {
        body = JSON.parse(init.body ?? "{}");
      } catch {
        body = {};
      }
    }
    api.calls.push({ method, path, query: u.search, body, init });
    if (api.holdNext) {
      const w = api.holdNext;
      api.holdNext = null;
      await w;
    }
    if (api.failNext && api.failNext.match.test(`${method} ${path}`)) {
      const f = api.failNext;
      api.failNext = null;
      if (f.throw) throw new TypeError("network down");
      return json(f.status, f.body);
    }
    // purge deleted rows past the undo window, as the database does on the next call
    for (const i of api.items) if (i.deleted_at && api.clock - Date.parse(i.deleted_at) >= api.undoMinutes * 60_000) i.purged = true;

    if (method === "GET" && path === "/") {
      const inc = u.searchParams.get("include_deleted") === "1";
      const rows = api.items.filter((i: any) => !i.purged && (inc || !i.deleted_at));
      const counts = { proposed: 0, approved: 0, rejected: 0, retired: 0 };
      for (const i of rows) if (!i.deleted_at) counts[i.status]++;
      return json(200, { ok: true, enabled: api.enabled, settings: api.settings, counts, items: rows });
    }
    if (method === "POST" && path === "/") {
      if (!api.enabled) return err("disabled", 503);
      if (typeof body.fact !== "string" || body.fact.length < 3) return err("bad_request", 400, "bad_fact");
      const why = screen(body.fact);
      if (why) return err("text_rejected", 422, why);
      if (api.items.some((i: any) => !i.purged && !i.deleted_at && i.fact.toLowerCase() === body.fact.toLowerCase())) return json(200, { ok: true, id: "dup", duplicate: true, superseded: false, item: null });
      const it = api.add({ fact: body.fact, category: body.category ?? "context", source: "taught" });
      return json(201, { ok: true, id: it.id, duplicate: false, superseded: false, item: it });
    }
    const m = /^\/([0-9a-f-]{36})(\/decision)?$/.exec(path);
    if (m) {
      const it = find(m[1]);
      if (!it) return err("not_found", 404);
      if (method === "PATCH") {
        if (!api.enabled) return err("disabled", 503);
        const why = body.fact ? screen(body.fact) : null;
        if (why) return err("text_rejected", 422, why);
        if (body.fact) it.fact = body.fact;
        if (body.category) it.category = body.category;
        return json(200, { ok: true, item: it });
      }
      if (method === "DELETE") {
        it.deleted_at = iso(api.clock);
        return json(200, { ok: true, permanent: false, undo_minutes: api.undoMinutes });
      }
      if (method === "POST" && m[2]) {
        const d = body.decision;
        if ((d === "approve" || d === "revive") && !api.enabled) return err("disabled", 503);
        if (d === "approve") {
          if (it.status !== "proposed") return err("conflict", 409);
          it.status = "approved";
        } else if (d === "reject") it.status = "rejected";
        else if (d === "revive") it.status = "approved";
        else if (d === "undelete") it.deleted_at = null;
        else return err("bad_request", 400, "bad_decision");
        return json(200, { ok: true, item: it });
      }
    }
    if (method === "POST" && path === "/settings") {
      if (body.learning_paused !== undefined) api.settings.learning_paused = body.learning_paused;
      if (body.show_used_notes !== undefined) api.settings.show_used_notes = body.show_used_notes;
      return json(200, { ok: true, settings: api.settings });
    }
    if (method === "POST" && path === "/export") {
      if (!api.recent) return err("reauth_required", 403);
      const rows = api.items.filter((i: any) => !i.purged && !i.deleted_at);
      return json(200, { format: "faye-memory-export", version: 1, exported_at: iso(api.clock), items: rows, settings: api.settings }, { "content-disposition": 'attachment; filename="faye-memory-2025-10-09.json"' });
    }
    if (method === "POST" && (path === "/delete-all" || path === "/erase")) {
      if (!api.recent) return err("reauth_required", 403);
      if (body.confirm !== "DELETE") return err("bad_request", 400, "confirm_required");
      const n = api.items.filter((i: any) => !i.purged).length;
      api.items = [];
      return json(200, { ok: true, deleted: { faye_memory_items: n, faye_usage_stats: 2 } });
    }
    if (method === "POST" && path === "/remember") {
      if (!api.enabled) return json(200, { ok: true, handled: false, enabled: false });
      if (body.from !== "typed") return err("bad_request", 400, "from_required");
      const msg: string = body.message;
      let r = /^remember that (.+)$/i.exec(msg);
      if (r) {
        const it = api.add({ fact: `Likes ${r[1]}`, source: "stated" });
        return json(200, { ok: true, handled: true, enabled: true, action: "saved", reply: `Saved: ${it.fact} Undo?`, item: it, undo: { id: it.id } });
      }
      r = /^forget that (.+)$/i.exec(msg);
      if (r) {
        const it = api.items.find((i: any) => !i.deleted_at && i.fact.toLowerCase().includes(r[1].toLowerCase()));
        if (!it) return json(200, { ok: true, handled: true, enabled: true, action: "ambiguous", reply: "I could not tell which note you mean. Open About me to pick it." });
        it.deleted_at = iso(api.clock);
        return json(200, { ok: true, handled: true, enabled: true, action: "forgotten", reply: "Gone. You can undo that for a few minutes in About me.", undo: { id: it.id, decision: "undelete" } });
      }
      if (api.settings.learning_paused) return json(200, { ok: true, handled: false, enabled: true, learning_paused: true, proposed: 0 });
      if (/i usually/i.test(msg)) {
        api.add({ fact: "Usually asks about options.", status: "proposed", source: "observed", confidence: 55, approved_at: null, approved_by: null, category: "habit" });
        return json(200, { ok: true, handled: false, enabled: true, proposed: 1 });
      }
      return json(200, { ok: true, handled: false, enabled: true, proposed: 0 });
    }
    return err("not_found", 404);
  };
  return api;
}

function setup(opts: any = {}) {
  const api = makeApi(opts);
  const client = MC.createMemoryClient({ fetchImpl: api.fetch, timeZone: () => "America/Chicago", now: () => api.clock });
  const saved: any[] = [];
  const store = AM.createAboutMeStore({ client, now: () => api.clock, save: (f: any) => (saved.push(f), opts.saveOk !== false) });
  return { api, client, store, saved };
}
const seed = (api: any) => {
  api.add({ category: "style", fact: "Likes the number first, then one line of why.", source: "stated" });
  api.add({ category: "style", fact: "Keeps answers short.", source: "taught" });
  api.add({ category: "habit", fact: "Often asks about options.", source: "observed", confidence: 60, effective_confidence: 60 });
  api.add({ category: "goal", fact: "Is studying for a buy-side path.", source: "stated" });
  api.add({ category: "tendency", fact: "Usually opens Faye on weekday mornings.", source: "observed", status: "proposed", confidence: 50, approved_at: null, approved_by: null });
  api.add({ category: "preference", fact: "Prefers weekly swing setups.", source: "proposed_by_model", status: "proposed", confidence: 40, approved_at: null, approved_by: null });
  api.add({ category: "context", fact: "Old note that faded.", source: "observed", status: "retired", confidence: 20, effective_confidence: 20 });
  api.add({ category: "avoid", fact: "No jokes about risk.", source: "stated", status: "rejected" });
};
const render = (state: any, store: any = null, extra: any = {}) => renderToStaticMarkup(h(AV.AboutMeView, { state, store: store ?? setup().store, onClose: () => {}, ...extra }));
const noStyle = (s: string) => s.replace(/<style[\s\S]*?<\/style>/g, "");
const ready = (patch: any = {}) => ({ ...AM.initialState(1_760_000_000_000), load: "ready", enabled: true, ...patch });

// ------------------------------------------------------------------ list and grouping
{
  const { api, store } = setup();
  seed(api);
  const ok = await store.load();
  const s = store.getState();
  t("load: ok, flag on, settings read", ok && s.load === "ready" && s.enabled && s.settings.learningPaused === false && s.settings.showUsedNotes === true);
  t("load: proposals (2), approved notes (4), faded (1), rejected (1) are split", s.proposals.length === 2 && s.notes.length === 4 && s.faded.length === 1 && s.rejected.length === 1);
  t("load: asks for the list including deleted rows (so the Undo list survives a refresh) and sends no body", api.calls[0].method === "GET" && api.calls[0].query === "?include_deleted=1" && api.calls[0].init.body === undefined);
  t("load: same-origin cookie session and no cache", api.calls[0].init.credentials === "same-origin" && api.calls[0].init.cache === "no-store");
  const g = MC.groupByCategory(s.notes);
  t("grouping: categories come in the fixed order and only non-empty ones show", g.map((x: any) => x.category).join(",") === "style,habit,goal" && g[0].items.length === 2);
  t("a note keeps its source and confidence", s.notes.some((n: any) => n.source === "observed" && n.confidence === 60));
}

// ------------------------------------------------------------------ approve / reject / edit
{
  const { api, store } = setup();
  seed(api);
  await store.load();
  const prop = store.getState().proposals[0];
  t("approve: moves a proposal into the notes with a spoken result", (await store.approve(prop.id)) && store.getState().notes.some((n: any) => n.id === prop.id) && store.getState().proposals.length === 1 && /Approved/.test(store.getState().notice.text));
  const dec = api.calls.find((c: any) => c.path.endsWith("/decision"));
  t("approve: POST /decision with {decision:'approve'} as JSON", dec.method === "POST" && dec.body.decision === "approve" && dec.init.headers["Content-Type"] === "application/json");
  const p2 = store.getState().proposals[0];
  t("reject: removes the proposal and says Faye will not use it", (await store.reject(p2.id)) && store.getState().proposals.length === 0 && store.getState().rejected.some((n: any) => n.id === p2.id) && /will not use/.test(store.getState().notice.text));
  const n = store.getState().notes.find((x: any) => x.fact.startsWith("Keeps answers"));
  t("edit: changes the text and the type, says so", (await store.edit(n.id, "Keeps answers very short.", "preference")) && store.getState().notes.find((x: any) => x.id === n.id).fact === "Keeps answers very short." && store.getState().notes.find((x: any) => x.id === n.id).category === "preference" && /Saved your change/.test(store.getState().notice.text));
  const patchCall = api.calls.find((c: any) => c.method === "PATCH");
  t("edit: PATCH with fact and category", patchCall.body.fact === "Keeps answers very short." && patchCall.body.category === "preference");
  const before = api.calls.length;
  t("edit: under 3 characters never reaches the server", !(await store.edit(n.id, "ab")) && api.calls.length === before && /at least 3/.test(store.getState().notice.text) && store.getState().notice.tone === "error");
  // save and approve for a proposal
  api.add({ category: "habit", fact: "Reads the news first.", source: "observed", status: "proposed", approved_at: null });
  await store.load();
  const pr = store.getState().proposals[0];
  t("edit + approve (Save and approve): the edited note ends up approved", (await store.edit(pr.id, "Reads the news before the open.", undefined, true)) && store.getState().notes.some((x: any) => x.id === pr.id && x.fact === "Reads the news before the open."));
  // refused text
  const r = await store.edit(n.id, "my password is hunter22");
  const msg = store.getState().notice.text;
  t("a refused note shows a friendly sentence from the rule name and never repeats the text or the server's sentence", !r && /key, a password or an account number/.test(msg) && !/hunter22/.test(msg) && !/server sentence/.test(msg));
}

// ------------------------------------------------------------------ delete one with a 10 minute undo
{
  const { api, store } = setup();
  seed(api);
  await store.load();
  const n = store.getState().notes[0];
  const first = store.remove(n.id);
  const second = store.remove(n.id); // a double tap
  const ok = await first;
  t("delete: a double tap sends one request", ok && !(await second) && api.calls.filter((c: any) => c.method === "DELETE").length === 1);
  const s = store.getState();
  t("delete: the note leaves the list and lands in 'Recently deleted' with the undo minutes", !s.notes.some((x: any) => x.id === n.id) && s.deleted.some((x: any) => x.id === n.id) && s.undoMinutes === 10);
  t("delete: the message says you can undo for 10 minutes", /undo this for 10 minutes/.test(s.notice.text));
  const left = MC.undoSecondsLeft(s.deleted[0].deletedAt, s.undoMinutes, api.clock);
  t("delete: about 10 minutes (600 s) left, and the label says so in words", left === 600 && /about 10 more minutes/.test(MC.undoLabel(left)) && /about 1 more minute\b/.test(MC.undoLabel(30)) && /has passed/.test(MC.undoLabel(0)));
  api.clock += 4 * 60_000;
  store.tick();
  t("delete: after 4 minutes the Undo is still offered", store.getState().deleted.length === 1 && /about 6 more minutes/.test(MC.undoLabel(MC.undoSecondsLeft(store.getState().deleted[0].deletedAt, 10, api.clock))));
  t("undo: brings the note back (POST /decision undelete)", (await store.undo(n.id)) && store.getState().notes.some((x: any) => x.id === n.id) && store.getState().deleted.length === 0 && api.calls.some((c: any) => c.body?.decision === "undelete"));
  // let the window pass
  const m = store.getState().notes[1];
  await store.remove(m.id);
  api.clock += 11 * 60_000;
  store.tick();
  t("after 10 minutes the Undo disappears from the screen (tick) and the server has purged it (load)", store.getState().deleted.length === 0 && (await store.load(true)) && store.getState().deleted.length === 0 && !store.getState().notes.some((x: any) => x.id === m.id));
  t("undo of a purged note is a friendly 'already gone'", !(await store.undo(m.id)) && /already gone/.test(store.getState().notice.text));
}

// ------------------------------------------------------------------ add a note, flag off, errors
{
  const { api, store } = setup();
  await store.load();
  t("empty state: no notes, nothing waiting", store.getState().notes.length === 0 && store.getState().proposals.length === 0 && store.getState().load === "ready");
  t("add: a note appears and is announced", (await store.add("I like the number first")) && store.getState().notes.length === 1 && /Added/.test(store.getState().notice.text));
  t("add: sends the fact and (when chosen) the type", api.calls.find((c: any) => c.method === "POST" && c.path === "/").body.fact === "I like the number first");
  t("add: the same note twice says you already have it", (await store.add("I like the number first")) && /already have/.test(store.getState().notice.text));
  t("add: a password is refused with the rule's sentence", !(await store.add("my password is hunter22")) && /password/.test(store.getState().notice.text) && !/hunter22/.test(store.getState().notice.text));
  t("add: too short never reaches the server", (() => { const n = api.calls.length; return store.add("ab").then((r: any) => !r && api.calls.length === n); })());
  await new Promise((r) => setTimeout(r, 5));
}
{
  const { api, store, saved } = setup({ enabled: false });
  seed(api);
  await store.load();
  const s = store.getState();
  t("flag off: the list still loads and shows what is stored", s.load === "ready" && s.enabled === false && s.notes.length === 4);
  t("flag off: adding says notes are not turned on, and changes nothing", !(await store.add("hello there")) && /not turned on/.test(store.getState().notice.text) && store.getState().notes.length === 4);
  t("flag off: approve is refused with the same friendly sentence", !(await store.approve(s.proposals[0].id)) && /not turned on/.test(store.getState().notice.text));
  t("flag off: reject, delete, undo, pause, export, delete all and erase still work", (await store.reject(s.proposals[0].id)) && (await store.remove(s.notes[0].id)) && (await store.undo(s.notes[0].id)) && (await store.setPaused(true)) && (await store.exportAll()) && saved.length === 1 && (await store.deleteAll()) && store.getState().notes.length === 0);
  const html = render(store.getState());
  t("flag off: the screen says notes are not on for answers yet and hides Add and Approve and Edit", /Notes are not turned on for answers yet/.test(html) && !/Add a note/.test(html) && !/>Approve</.test(html) && !/>Edit</.test(html));
}
{
  const { api, store } = setup();
  api.failNext = { match: /GET \//, throw: true };
  await store.load();
  t("load error: friendly message and a Try again button, nothing invented", store.getState().load === "error" && /could not reach the app/.test(store.getState().loadError));
  const html = render(store.getState(), store);
  t("load error screen has the sentence and Try again", /Could not load your notes/.test(html) && />Try again</.test(html));
  api.failNext = null;
  t("Try again works", (await store.load()) && store.getState().load === "ready");
  api.failNext = { match: /POST \/settings/, status: 429, body: { ok: false, code: "rate_limited", error: "x" } };
  t("rate limit: friendly sentence and the old setting stays", !(await store.setPaused(true)) && /wait a moment/i.test(store.getState().notice.text) && store.getState().settings.learningPaused === false);
  api.failNext = { match: /POST \/settings/, status: 401, body: { ok: false, code: "auth_required" } };
  t("signed out: tells you to sign in again", !(await store.setPaused(true)) && /Sign in again/.test(store.getState().notice.text));
  api.failNext = { match: /GET \//, status: 200, body: "not json" };
  t("a garbage answer is an error, not a crash", (await store.load()) === false && store.getState().load === "error");
}

// ------------------------------------------------------------------ pause
{
  const { api, store } = setup();
  seed(api);
  await store.load();
  t("pause: sets learning_paused, says paused means no notes are used in answers", (await store.setPaused(true)) && store.getState().settings.learningPaused && /not use your notes in answers/.test(store.getState().notice.text) && api.calls.find((c: any) => c.path === "/settings").body.learning_paused === true);
  const html = noStyle(render(store.getState(), store));
  t("pause: the switch is on and the paused banner is shown", /role="switch"[^>]*aria-checked="true"/.test(html) && /Learning is paused/.test(html) && /does not use your notes in answers/.test(html));
  t("resume: turns it back on", (await store.setPaused(false)) && !store.getState().settings.learningPaused && /on again/.test(store.getState().notice.text));
  t("show used notes: a second switch, saved to the server", (await store.setShowUsed(false)) && store.getState().settings.showUsedNotes === false && api.calls.at(-2).body.show_used_notes === false);
  t("approving while paused tells you notes are not used right now", (await store.setPaused(true)) && (await store.approve(store.getState().proposals[0].id)) && /Learning is paused/.test(store.getState().notice.text));
}

// ------------------------------------------------------------------ export, delete all, erase, reauth
{
  const { api, store, saved } = setup({ recent: false });
  seed(api);
  await store.load();
  t("export without a recent sign-in: reauth_required is handled, nothing is saved", !(await store.exportAll()) && store.getState().reauth === "export" && saved.length === 0);
  const msg = store.getState().notice.text;
  const html = noStyle(render(store.getState(), store));
  t("reauth: the live region says to sign in again; the block on screen explains the 30 minute rule in plain words", /sign in again/i.test(msg) && store.getState().notice.tone === "error" && /sign-in from the last 30 minutes/.test(html));
  t("reauth: a visible block with a sign-in link that opens in a new tab safely and a way to dismiss", /data-testid="aboutme-reauth"/.test(html) && /<a [^>]*href="\/login"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/.test(html) && /Please sign in again first/.test(html) && /Not now/.test(html));
  t("reauth: the block names the button to press again", /Export my notes/.test(html.match(/data-testid="aboutme-reauth"[\s\S]*?<\/div><\/div>/)?.[0] ?? ""));
  api.recent = true; // the owner signed in again
  t("export after signing in: saves a JSON file named by the server and clears the reauth block", (await store.exportAll()) && saved.length === 1 && saved[0].filename === "faye-memory-2025-10-09.json" && JSON.parse(saved[0].text).format === "faye-memory-export" && saved[0].count === 8 && store.getState().reauth === null);
  t("export: says what was saved", /Saved faye-memory-2025-10-09\.json with 8 notes/.test(store.getState().notice.text));
}
{
  const { api, store, saved } = setup({ saveOk: false });
  seed(api);
  await store.load();
  t("export when the browser blocks the download: says so", !(await store.exportAll()) && /did not allow the download/.test(store.getState().notice.text));
}
{
  const { api, store } = setup({ recent: false });
  seed(api);
  await store.load();
  t("delete all without a recent sign-in: reauth block, notes untouched", !(await store.deleteAll()) && store.getState().reauth === "delete_all" && store.getState().notes.length === 4);
  t("the confirm word DELETE is sent by the client, not typed text", api.calls.at(-1).body.confirm === "DELETE");
  api.recent = true;
  t("delete all after signing in: empties the screen and says so", (await store.deleteAll()) && store.getState().notes.length === 0 && store.getState().proposals.length === 0 && /Deleted all your notes/.test(store.getState().notice.text) && store.getState().reauth === null);
  seed(api);
  api.recent = false;
  await store.load();
  t("erase without a recent sign-in asks to sign in", !(await store.erase()) && store.getState().reauth === "erase");
  api.recent = true;
  t("erase after signing in: removes everything and says so", (await store.erase()) && store.getState().notes.length === 0 && /Erased all your data/.test(store.getState().notice.text) && api.calls.some((c: any) => c.path === "/erase"));
  t("Not now clears the reauth block", (() => { store.clearReauth(); return store.getState().reauth === null; })());
}

// ------------------------------------------------------------------ the screen (static markup)
{
  const { api, store } = setup();
  seed(api);
  await store.load();
  const html = noStyle(render(store.getState(), store));
  const idx = (s: string) => html.indexOf(s);
  t("screen: proposals come first, then notes, then settings, then data", idx("Waiting for your OK") > 0 && idx("Waiting for your OK") < idx("Your notes") && idx("Your notes") < idx("Settings") && idx("Settings") < idx("Your data"));
  t("screen: each proposal has Approve, Edit and Reject with the note named in the label", /aria-label="Approve: Usually opens Faye on weekday morning/.test(html) && /aria-label="Edit: Prefers weekly swing setups\."/.test(html) && /aria-label="Reject: Prefers weekly swing setups\."/.test(html));
  t("screen: notes are grouped under category headings", /<h4[^>]*>How you like answers<\/h4>/.test(html) && /<h4[^>]*>Your habits<\/h4>/.test(html) && /<h4[^>]*>Your goals<\/h4>/.test(html));
  t("screen: source, confidence and approved are visible per note", /Said by you/.test(html) && /Noticed from your habits/.test(html) && /Suggested by Faye/.test(html) && /60% sure/.test(html) && /Approved/.test(html) && /Waiting for your OK/.test(html));
  t("screen: faded and rejected notes sit in a collapsed section with Bring back", /<details class="fam-more">/.test(html) && !/<details class="fam-more" open/.test(html) && /Bring back: Old note that faded\./.test(html));
  t("screen: the quiet never-stored line names passwords, keys, account numbers and the 24 hours", /Faye never keeps passwords, keys, card numbers or account numbers/.test(html) && /deleted after 24 hours/.test(html));
  t("screen: Export, Delete all and Erase are separate buttons", />Export</.test(html) && />Delete all notes</.test(html) && />Erase all data</.test(html));
  t("screen: a Back button, labelled for a screen reader", /aria-label="Back to the chat"/.test(html));
  t("screen: exactly one polite live region", (html.match(/aria-live="polite"/g) ?? []).length === 1 && (html.match(/role="status"/g) ?? []).length === 1);
  t("screen: the title is a focusable h2 and the panel is named by it", /<h2[^>]*tabindex="-1"[^>]*data-h="title"|<h2[^>]*data-h="title"[^>]*tabindex="-1"/.test(html) && /<section[^>]*aria-labelledby="[^"]+"/.test(html));
  t("screen: switches have a role, a state, a label and a description", (html.match(/role="switch"/g) ?? []).length === 2 && (html.match(/role="switch"[^>]*aria-labelledby="[^"]+"[^>]*aria-describedby="[^"]+"|aria-checked="(?:true|false)"/g) ?? []).length >= 2 && /Pause learning/.test(html) && /does not use your notes in answers/.test(html));
  const empty = noStyle(render(ready()));
  t("empty state: friendly text with an example, no list", /No notes yet/.test(empty) && /remember that I like the number first/.test(empty) && !/<h4/.test(empty));
  t("empty state: still shows the privacy controls", /Export my notes/.test(empty) && /Pause learning/.test(empty));
  const loading = noStyle(render(AM.initialState()));
  t("loading state: says it is loading and shows no controls that could do harm", /Loading your notes/.test(loading) && !/Delete all notes/.test(loading));
}

// ------------------------------------------------------------------ never HTML from note text
{
  const evil = [`<img src=x onerror=alert(1)>`, `<script>alert("x")</script>`, `</li><button>pwn</button>`, `&lt;b&gt;bold&lt;/b&gt; & "quotes" 'single'`, `javascript:alert(1)`];
  const items = evil.map((fact, i) => MC.parseItem({ id: UUID(900 + i), category: "style", fact, source: "stated", status: i === 0 ? "proposed" : "approved", confidence: 90, created_at: "2025-10-01T00:00:00Z" }));
  const state = ready({ notes: items.slice(1), proposals: items.slice(0, 1), deleted: [{ ...items[1], deletedAt: new Date(1_760_000_000_000 - 1000).toISOString() }] });
  const html = noStyle(render(state));
  t("hostile note text is escaped everywhere (note, proposal, label, deleted list)", !/<img|<script|<\/li><button>pwn|<button>pwn/.test(html) && /&lt;img src=x onerror=alert\(1\)&gt;/.test(html) && /&lt;script&gt;/.test(html));
  t("an entity typed by the owner stays literal (double escaped), so nothing is decoded", /&amp;lt;b&amp;gt;bold/.test(html));
  const nu = renderToStaticMarkup(h(NU.NotesUsedLine, { count: 2, ids: [UUID(1), UUID(2)], client: setup().client }));
  t("'Used N notes' is collapsed by default and has no note text until opened", /<details[^>]*data-testid="faye-notes-used"/.test(nu) && !/<details[^>]*\bopen\b/.test(nu) && /Used 2 notes/.test(nu) && !/<li/.test(nu));
  const plain = renderToStaticMarkup(h(NU.NotesUsedLine, { count: 1, ids: [], client: null }));
  t("'Used 1 note' without a client is a plain count", /Used 1 note</.test(plain) && !/<details/.test(plain));
  const src = ["AboutMe.tsx", "AboutMeView.tsx", "AboutMeNotesUsed.tsx", "AboutMeStyles.tsx"].map((f) => stripComments(read(`../src/components/faye/${f}`))).join("\n") + stripComments(read("../src/lib/faye/memory-client.ts"));
  t("no innerHTML, dangerouslySetInnerHTML, eval or document.write in the panel or the client", !/innerHTML|dangerouslySetInnerHTML|eval\(|new Function|document\.write/.test(src));
  t("no logging of anything in the panel or the client", !/console\.(log|info|warn|error|debug)/.test(src));
}

// ------------------------------------------------------------------ the confirm dialog (static)
{
  const html = noStyle(renderToStaticMarkup(h(AV.ConfirmDialog, { title: AV.ABOUT_ME_COPY.confirmErase.title, body: AV.ABOUT_ME_COPY.confirmErase.body, confirmLabel: "Erase all data", working: false, onConfirm() {}, onCancel() {} })));
  t("dialog: role, aria-modal, name and description", /role="dialog"/.test(html) && /aria-modal="true"/.test(html) && /aria-labelledby="[^"]+"/.test(html) && /aria-describedby="[^"]+"/.test(html));
  t("dialog: the destructive button starts disabled until DELETE is typed; Cancel is always there", /<button[^>]*disabled=""[^>]*>Erase all data/.test(html) && />Cancel</.test(html) && /Type DELETE to confirm/.test(html));
  const src = stripComments(read("../src/components/faye/AboutMeView.tsx"));
  t("dialog: Escape closes it without closing Faye, Tab is trapped, focus goes to the field and comes back", /e\.key === "Escape"[\s\S]{0,120}e\.stopPropagation\(\)/.test(src) && /e\.key !== "Tab"/.test(src) && /querySelector<HTMLElement>\("input"\)\?\.focus\(\)/.test(src) && /focusFirst\(opener, sectionKey\("title"\)\)/.test(src) && /\[data-delete-all-btn\]/.test(src));
  t("dialog: the page behind it is inert", (src.match(/inert=\{dialog \? true : undefined\}/g) ?? []).length === 2);
  t("dialog: the confirm word is a constant 'DELETE' compared exactly", /typed === "DELETE"/.test(src));
  t("Escape in the panel goes back to the chat and never closes the whole window", /if \(e\.key !== "Escape" \|\| e\.defaultPrevented\) return;\s*e\.stopPropagation\(\)/.test(src));
}

// ------------------------------------------------------------------ the remember call (chat hook)
{
  const { api, client } = setup();
  const r = await client.remember("remember that the number goes first");
  const call = api.calls.at(-1);
  t("remember: POST /remember with {message, from:'typed', tz} as JSON", call.method === "POST" && call.path === "/remember" && call.body.message === "remember that the number goes first" && call.body.from === "typed" && call.body.tz === "America/Chicago" && call.init.headers["Content-Type"] === "application/json" && call.init.credentials === "same-origin");
  t("remember: a command is handled with a reply and an undo id", r.handled && r.action === "saved" && /^Saved: /.test(r.reply) && /^[0-9a-f-]{36}$/.test(r.undo.id));
  t("remember: the note line says 'Saved a note.'", MC.rememberNote(r) === "Saved a note.");
  const plain = await client.remember("what is gamma?");
  t("remember: an ordinary question is not handled and says nothing", !plain.handled && plain.proposed === 0 && MC.rememberNote(plain) === "");
  const prop = await client.remember("I usually trade options in the morning");
  t("remember: a proposal says 'Proposed a note for you to approve.'", !prop.handled && prop.proposed === 1 && MC.rememberNote(prop) === "Proposed a note for you to approve.");
  t("remember: several proposals are counted in the sentence", MC.rememberNote({ handled: false, enabled: true, proposed: 3, learningPaused: false }) === "Proposed 3 notes for you to approve.");
  const forgot = await client.remember("forget that the number goes first");
  t("remember: 'forget that' gives an undo that brings it back", forgot.handled && forgot.action === "forgotten" && forgot.undo.decision === "undelete" && MC.rememberNote(forgot) === "");
  api.settings.learning_paused = true;
  const paused = await client.remember("I usually trade options");
  t("remember: paused learning says nothing was learned", !paused.handled && paused.learningPaused && paused.proposed === 0 && MC.rememberNote(paused) === "");
  api.settings.learning_paused = false;
  api.enabled = false;
  const off = await client.remember("remember that x y z");
  t("remember: flag off answers not handled, enabled false, no note line", !off.handled && !off.enabled && MC.rememberNote(off) === "");
  api.enabled = true;
  // never throws, never blocks
  api.failNext = { match: /remember/, throw: true };
  t("remember: a network failure returns null and never throws", (await client.remember("hello there")) === null);
  api.failNext = { match: /remember/, status: 500, body: { ok: false, code: "server_error" } };
  t("remember: a server error returns null", (await client.remember("hello there")) === null);
  api.failNext = { match: /remember/, status: 403, body: { ok: false, code: "not_allowed" } };
  t("remember: a 403 returns null", (await client.remember("hello there")) === null);
  api.failNext = { match: /remember/, status: 200, body: "<html>login</html>" };
  t("remember: a non-JSON answer returns null", (await client.remember("hello there")) === null);
  const slow = MC.createMemoryClient({ fetchImpl: (url: string, init: any) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))), rememberTimeoutMs: 30 });
  const t0 = Date.now();
  t("remember: a hung server is given up on after the short timeout (chat is not held)", (await slow.remember("hello there")) === null && Date.now() - t0 < 1500);
  const ac = new AbortController();
  const pending = slow.remember("hello again", ac.signal);
  ac.abort();
  t("remember: the Stop button aborts it", (await pending) === null);
  t("remember: an over-long reply from the route is cut", MC.parseRemember({ ok: true, handled: true, enabled: true, action: "saved", reply: "x".repeat(5000) }).reply.length === 600);
  t("remember: a reply without text is never 'handled' (the chat job still runs)", MC.parseRemember({ ok: true, handled: true, enabled: true }).handled === false);
  t("remember: an unknown action is dropped", MC.parseRemember({ ok: true, handled: true, enabled: true, action: "format_disk", reply: "hi" }).action === undefined);
  t("remember: a bad undo id is dropped", MC.parseRemember({ ok: true, handled: true, enabled: true, reply: "hi", undo: { id: "../../x" } }).undo === undefined);
}

// ------------------------------------------------------------------ the widget wiring (source)
{
  const w = read("../src/components/FayeChatWidget.tsx");
  const code = stripComments(w);
  const send = code.slice(code.indexOf("async function sendMessage"), code.indexOf("async function placePaperOrder"));
  const iRem = send.indexOf("memoryClient.remember(question");
  const iRun = send.indexOf("await runQuestion(");
  t("widget: remember is called with the typed question BEFORE the chat job is queued", iRem > 0 && iRun > iRem);
  t("widget: only the owner's typed question is sent to remember (never answers, tool output or page text)", (code.match(/memoryClient\.remember\(/g) ?? []).length === 1 && /memoryClient\.remember\(question, ac\.signal\)/.test(send));
  t("widget: remember runs only with the mailbox transport for an allowed owner and when aboutMe is not switched off", /props\.aboutMe !== false && transport\.kind === "mailbox" && \(status === "available" \|\| status === "offline"\)/.test(code) && /if \(memEligible\) \{\s*const rem/.test(send));
  t("widget: a failed remember does not stop the chat (the call returns null, the job still runs; there is no early return on null)", /if \(rem && rem\.handled && rem\.reply\)/.test(send) && !/if \(!rem\)\s*(return|throw)/.test(send));
  t("widget: a handled command shows Faye's reply and queues NO job", /rem\.handled && rem\.reply[\s\S]{0,500}return;[\s\S]{0,200}const out = await runQuestion/.test(send));
  t("widget: the Saved / Proposed line goes under the owner's own message", /patch\(userMsg\.id, \{ memNote \}\)/.test(send) && /data-testid="faye-memnote"/.test(code));
  t("widget: the Stop button also stops the remember call", /memoryClient\.remember\(question, ac\.signal\)[\s\S]{0,200}ac\.signal\.aborted/.test(send));
  t("widget: About me renders only for an eligible owner; the slot hook is still there", /memEligible && aboutOpen \? <AboutMe/.test(code) && /props\.aboutMeSlot \?\? null/.test(code) && /memEligible \? \(\s*<button\s+ref=\{aboutBtnRef\}/.test(code));
  t("widget: the conversation is hidden (not unmounted) while About me is open, so a running answer keeps going", (code.match(/hidden=\{aboutOpen\}/g) ?? []).length >= 5 && /\.fw \[hidden\]\{display:none!important\}/.test(w));
  t("widget: the 'Used N notes' line is on whenever memory is on and the owner's setting allows it, and lists notes on demand", /const notesLineOn = showNotesUsed \|\| \(memEligible && \(mem\?\.showUsedNotes \?\? true\)\)/.test(code) && /<NotesUsedLine count=\{m\.notesUsed!\} ids=\{m\.noteIds \?\? \[\]\}/.test(code));
  t("widget: notesExist is true when the owner has approved notes, so the offline line says 'Your notes are still here.'", /const haveNotes = notesExist \|\| \(mem\?\.approved \?\? 0\) > 0/.test(code) && /memRef\.current\?\.approved/.test(code));
  t("widget: the About me button names how many notes are waiting", /notes? (is|are) waiting for your OK|\$\{mem!\.proposed\} \$\{mem!\.proposed === 1 \? "note is" : "notes are"\} waiting for your OK/.test(code));
  t("widget: focus goes to the About me title when it opens and back to the About me button when it closes", /\[data-faye-aboutme\] \[data-h="title"\]/.test(code) && /aboutBtnRef\.current\?\.focus\(\)/.test(code));
  t("widget: Undo under a saved note removes it again; under a forgotten one it brings it back", /decision === "undelete" \? await memoryClient\.decide\(undo\.id, "undelete"\) : await memoryClient\.remove\(undo\.id\)/.test(code));
  t("widget: no HTML is ever set from memory text", !/dangerouslySetInnerHTML|innerHTML/.test(code));
}

// ------------------------------------------------------------------ transport: the note ids behind 'Used N notes'
{
  t("transport: noteIdList keeps strings only, drops repeats, at most 6", TR.noteIdList({ memory_ids: ["a", "a", 5, "b", null, "c", "d", "e", "f", "g", "h"] }).join(",") === "a,b,c,d,e,f" && TR.noteIdList(null).length === 0 && TR.noteIdList({ memory_ids: "x" }).length === 0);
  t("transport: noteIdList never carries text-length values", TR.noteIdList({ memory_ids: ["x".repeat(65)] }).length === 0);
}

// ------------------------------------------------------------------ plain language: grade 8 or lower
function grade(text: string) {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const words = text.match(/[A-Za-z']+/g) ?? [];
  const syl = (w: string) => {
    w = w.toLowerCase().replace(/'/g, "");
    if (w.length <= 3) return 1;
    w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
    return Math.max(1, (w.match(/[aeiouy]{1,2}/g) ?? []).length);
  };
  const sy = words.reduce((s, w) => s + syl(w), 0);
  return 0.39 * (words.length / Math.max(1, sentences.length)) + 11.8 * (sy / Math.max(1, words.length)) - 15.59;
}
{
  const texts: Record<string, string> = {};
  const walk = (o: any, p: string) => {
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string") texts[`${p}.${k}`] = v as string;
      else if (v && typeof v === "object") walk(v, `${p}.${k}`);
    }
  };
  walk(AV.ABOUT_ME_COPY, "copy");
  for (const code of ["reauth_required", "disabled", "limit_reached", "conflict", "paused", "auth_required", "not_allowed", "rate_limited", "not_found", "unavailable", "too_large", "bad_request", "network", "server_error"]) texts[`error.${code}`] = MC.friendlyError(code);
  for (const d of ["instruction", "secret", "money", "contact", "sensitive_topic", "length", "empty", "markup"]) texts[`reject.${d}`] = MC.friendlyError("text_rejected", d);
  Object.entries(MC.CATEGORY_LABEL).forEach(([k, v]) => (texts[`category.${k}`] = v as string));
  Object.entries(MC.SOURCE_LABEL).forEach(([k, v]) => (texts[`source.${k}`] = v as string));
  let worst = 0;
  const bad: string[] = [];
  // The Flesch-Kincaid formula is meaningless for a two-word label, so labels (5 words or fewer) are checked word by word instead:
  // no word longer than 3 syllables, no jargon. Everything longer must score grade 8 or lower.
  const syllables = (w: string) => Math.max(1, (w.toLowerCase().replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").match(/[aeiouy]{1,2}/g) ?? []).length);
  for (const [k, v] of Object.entries(texts)) {
    const words = v.match(/[A-Za-z']+/g) ?? [];
    if (words.length <= 5) {
      if (words.some((w) => syllables(w) > 3)) bad.push(`${k} has a long word`);
      continue;
    }
    const g = grade(v);
    worst = Math.max(worst, g);
    if (g > 8) bad.push(`${k} ${g.toFixed(1)}`);
  }
  t(`reading level: all ${Object.keys(texts).length} fixed texts are plain (sentences grade 8 or lower, worst ${worst.toFixed(1)}; labels have no long words)`, bad.length === 0, bad.join("; "));
  t("copy: pause explains that paused also means no notes are used in answers", /does not learn new notes/.test(AV.ABOUT_ME_COPY.pauseBody) && /does not use your notes in answers/.test(AV.ABOUT_ME_COPY.pauseBody));
  t("copy: the never-stored line says 24 hours for raw chat text", /chat messages are deleted after 24 hours/.test(AV.ABOUT_ME_COPY.never));
  t("copy: the flag-off line says memory is not on for answers yet", /not turned on for answers yet/.test(AV.ABOUT_ME_COPY.flagOff.title));
  t("copy: no server sentence is ever shown (friendlyError ignores the server text)", !/server sentence/.test(Object.values(texts).join(" ")));
  t("copy: no emoji and no jargon words (JSON, API, RLS, token, endpoint) in anything the owner reads", !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(Object.values(texts).join("")) && !/\b(JSON|API|RLS|token|endpoint|payload)\b/i.test(Object.values(texts).join(" ")));
}

// ------------------------------------------------------------------ design: tokens only, 44 px targets, phone sheet, reduced motion
{
  const css = ST.ABOUT_ME_CSS.replace(/\n/g, "");
  const srcAll = ["AboutMe.tsx", "AboutMeView.tsx", "AboutMeNotesUsed.tsx", "AboutMeStyles.tsx"].map((f) => stripComments(read(`../src/components/faye/${f}`))).join("\n");
  t("tokens: no quoted hex colour and no rgb() in the panel files", !/["'`]#[0-9a-fA-F]{3,8}["'`]/.test(srcAll) && !/\brgba?\(/.test(srcAll));
  t("tokens: every colour in the stylesheet is a Jarvis var() with a token fallback (no hex in the CSS text outside fallbacks)", ![...css.replace(/var\(--[a-z0-9-]+,#[0-9a-f]{6}\)/gi, "").matchAll(/#[0-9a-fA-F]{3,8}\b/g)].length);
  t("touch targets: 40 px with a mouse, 44 px on phones and coarse pointers", /--am-tap:40px/.test(css) && /@media \(max-width:520px\)\{\.fam\{--am-tap:44px\}/.test(css) && /@media \(pointer:coarse\)\{\.fam\{--am-tap:44px\}\}/.test(css) && /\.fam-btn\{[^}]*min-height:var\(--am-tap\)/.test(css));
  t("phone: inputs are 16 px (no iOS zoom) and the confirm dialog is a bottom sheet", /\.fam-input,\.fam-area,\.fam-select\{font-size:16px\}/.test(css) && /\.fam-dialog\{max-width:none;border-radius:16px 16px 0 0/.test(css));
  t("nothing animates (no transition, animation or keyframes)", !/transition|animation|@keyframes/.test(css));
  t("focus ring on every control", /\.fam :focus-visible\{outline:2px solid/.test(css));
  t("hidden really hides (author display rules cannot override it)", /\.fam \[hidden\]\{display:none!important\}/.test(css));
  const widgetCss = read("../src/components/FayeChatWidget.tsx");
  t("widget: the panel widens a little for About me on desktop and stays full width on phones (the phone rule comes later)", /\.fw-panel-wide\{width:min\(440px/.test(widgetCss) && widgetCss.indexOf(".fw-panel-wide{") < widgetCss.indexOf("@media (max-width:520px){"));
  t("the stylesheet is injected once, by href (React dedupes it)", /<style href="faye-aboutme-v1" precedence="default">/.test(read("../src/components/faye/AboutMeView.tsx")));
}

// ------------------------------------------------------------------ labels: every field has one
{
  const { api, store } = setup();
  seed(api);
  await store.load();
  const html = noStyle(render(store.getState(), store));
  const fields = [...html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)];
  const ok = fields.every((f) => {
    const id = /id="([^"]+)"/.exec(f[2])?.[1];
    return (id && new RegExp(`<label[^>]*for="${id}"`).test(html)) || /aria-label=/.test(f[2]);
  });
  t(`labels: all ${fields.length} form fields on the screen have a label`, fields.length >= 2 && ok);
  const buttons = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)];
  t("labels: no button is empty", buttons.every((b) => b[1].replace(/<[^>]*>/g, "").trim().length > 0 || /aria-label=|aria-labelledby=/.test(b[0])));
}

console.log(failed ? `\n${failed} FAILED` : "\nall faye-aboutme checks passed");
process.exit(failed ? 1 : 0);
