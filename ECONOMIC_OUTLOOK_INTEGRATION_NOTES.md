# Economic Outlook — Integration Notes

Same Supabase project as everything else in this app (`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, already configured). Two new tables, both append-only — a "refresh" always inserts a new row, never overwrites a past one, which is what makes the version history and the scorecard log real.

## One-time setup: create the tables

Run this in the Supabase SQL Editor:

```sql
create table if not exists economic_outlook_versions (
  id uuid primary key default gen_random_uuid(),
  version_id text not null unique,
  as_of_date date not null,
  refresh_reason text not null,
  prior_version_id text,
  regime_label text not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists economic_outlook_scorecard (
  id uuid primary key default gen_random_uuid(),
  version_id text not null,
  logged_date date not null,
  regime_tag_at_call text not null,
  house_view_path_at_call text not null,
  key_falsification_triggers jsonb not null,
  grading jsonb not null,
  created_at timestamptz not null default now()
);
```

## How it works

- **Refresh** (`POST /api/economic-outlook/refresh`) pulls ~20 real FRED series (dual-mandate scorecard + growth/financial-conditions), then makes one Claude call (reusing the Assistant's existing `anthropic-client.ts`) to synthesize the qualitative layer — regime tag, each indicator's `how_derived` mechanism, policy-stance narrative, risk balance, adversarial self-Q&A, and trading parameters — strictly grounded in the real numbers just fetched. Never fabricates a number; if a real data source doesn't exist (r-star, fed-funds-futures pricing, a live FOMC calendar), the field says so explicitly instead of guessing.
- **Latest** (`GET /api/economic-outlook/latest`) and **Versions** (`GET /api/economic-outlook/versions`) read from the append-only history.
- **Scorecard** (`GET/POST/PATCH /api/economic-outlook/scorecard`) logs a call at refresh time and lets you grade it later (intended cadence: 6-8 weeks after logging, once enough outcome data exists).

## Known, honest gaps (see each version's own `dataLimitations`)

- **No live FOMC calendar** — `next_scheduled_refresh` is a fixed ~6-week estimate, not a real meeting date. `event_vol_catalysts` starts empty every refresh; populate manually if you have a real forward calendar.
- **No fed-funds-futures/OIS data source** — `market_implied_path` is always stated as unavailable, never estimated.
- **No r-star series** — flagged as unavailable (the NY Fed's HLW estimate isn't published as a simple FRED series); read the effective fed funds rate qualitatively instead.

## Verify once the tables exist

1. `POST /api/economic-outlook/refresh` with `{"refreshReason": "ad_hoc_material_change"}` — confirm a real version comes back with populated `how_derived` fields, not boilerplate.
2. `GET /api/economic-outlook/latest` — confirm it returns the same version.
3. Refresh a second time — confirm `meta.priorVersionId` points at the first version's `versionId`, and `outputLayers.glance` actually describes a delta rather than repeating the whole picture.
