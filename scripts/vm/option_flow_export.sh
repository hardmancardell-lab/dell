#!/bin/bash
# Saves each finished session's stored option-flow rows (per-contract detail included) as compressed files, so the detail survives
# the prune job (OPTION_FLOW_CONFIG.detailRetentionDays). Run by cron on the Oracle VM at 23:10 UTC on weekdays, after the session
# in both daylight and standard time. Read-only against the app: it only calls GET /api/cron/option-flow-export.
# The secret lives only in ~/.dellegate_cron_secret (permissions 600). Nothing here prints it.
SECRET_FILE="$HOME/.dellegate_cron_secret"
LOG="$HOME/option_flow_export.log"
OUT="$HOME/option_flow_archive"
BASE="https://dell-black-ten.vercel.app/api/cron/option-flow-export"

mkdir -p "$OUT"
[ -s "$SECRET_FILE" ] || { echo "$(date -u +%FT%TZ) no secret file, skipping" >> "$LOG"; exit 0; }
export EXPORT_SECRET=$(tr -d '\r\n ' < "$SECRET_FILE")

python3 -I - "$BASE" "$OUT" "$LOG" <<'PY'
import gzip, json, os, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone

base, out, log = sys.argv[1:4]
secret = os.environ["EXPORT_SECRET"]
PAGE = 40

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):  # a redirect to /login must not look like success
        return None
opener = urllib.request.build_opener(NoRedirect)

def get(query):
    last = None
    for wait in (0, 3, 10):
        time.sleep(wait)
        req = urllib.request.Request(base + "?" + urllib.parse.urlencode(query), headers={"Authorization": "Bearer " + secret})
        try:
            with opener.open(req, timeout=60) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            last = "HTTP %d" % e.code
            if e.code < 500 and e.code != 429:
                break
        except Exception as e:  # network trouble: retry
            last = type(e).__name__
    raise RuntimeError(last)

def say(msg):
    with open(log, "a") as f:
        f.write(datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ ") + msg + "\n")

now = datetime.now(timezone.utc)
today = now.strftime("%Y-%m-%d")
saved = skipped = failed = 0
try:
    listing = get({"list": "1"})
except Exception as e:
    say("list failed: %s" % e)
    sys.exit(1)

for symbol in listing["symbols"]:
    for date in listing["dates"].get(symbol, []):
        path = os.path.join(out, "%s_%s.json.gz" % (symbol, date))
        if os.path.exists(path):
            skipped += 1
            continue
        if date >= today and now.hour < 22:  # the session may still be running: never save a partial day
            skipped += 1
            continue
        try:
            rows, offset = [], 0
            while True:
                page = get({"symbol": symbol, "date": date, "offset": offset, "limit": PAGE})
                rows += page["rows"]
                if page["count"] < PAGE:
                    break
                offset += PAGE
            if not rows:
                skipped += 1
                continue
            tmp = path + ".tmp"
            with gzip.open(tmp, "wt", encoding="utf-8") as f:
                json.dump({"symbol": symbol, "date": date, "exported_at": now.isoformat(), "row_count": len(rows), "rows": rows}, f, separators=(",", ":"))
            os.replace(tmp, path)
            saved += 1
        except Exception as e:
            failed += 1
            say("%s %s failed: %s" % (symbol, date, e))

say("export done: saved=%d already_had=%d failed=%d" % (saved, skipped, failed))
sys.exit(1 if failed else 0)
PY

# Keep the log small: last 1000 lines.
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 2000 ]; then tail -n 1000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi
