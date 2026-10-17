# Alert signups: abuse limits now, double opt-in design next

## What exists now (this batch)
`POST /api/alerts/subscribe` (login required) now validates the body (email shape, E.164 phone, channel matches the contact details given, at most 10 rules, known condition types, bounded params, 16 KB body) and rate limits per instance, best effort: 5 signups per hour and 15 per day per IP, 3 per day per target email or phone. `/api/alerts/unsubscribe` (public, in every alert email) is limited to 30 attempts per 15 minutes per IP and only accepts token-shaped input. These limits live in memory per serverless instance (see `src/lib/access/rate-limit.ts`), so they reduce casual abuse but do not stop a distributed one.

## The remaining gap
Anyone with an account can type SOMEONE ELSE'S email address or phone number. The row is created `active`, and the cron then sends alerts to that person. Consent is captured from the signer, not from the owner of the address. That is a CAN-SPAM / TCPA problem (and an SMS-pumping cost risk) that only confirmation by the address owner fixes.

## Proposed double opt-in (needs a migration and a sender, not built here)
1. Schema: add to `alert_subscriptions` `confirmed_at timestamptz null`, `confirm_token_hash text`, `confirm_sent_at timestamptz`, `confirm_attempts int default 0`. New rows are created with `active = false` and `confirmed_at = null`.
2. On subscribe: generate a random token (32 bytes), store only its SHA-256, and send ONE confirmation message: an email with a link `/api/alerts/confirm?token=...`, or an SMS "Reply YES to start Dellegate alerts. Reply STOP to cancel." Never send more than one unconfirmed message per address per 24 hours (enforced in the database, not in memory: count rows by address where `confirmed_at is null`).
3. Confirm: `GET /api/alerts/confirm?token=` (public, rate limited, constant-time compare of the hash) sets `confirmed_at = now(), active = true`. For SMS, the existing Twilio webhook handles a "YES" reply (signature already verified) and activates the row matching the sending number.
4. The cron and the survey broadcast only select `active = true and confirmed_at is not null`. Unconfirmed rows older than 7 days are deleted by the weekly sweep.
5. Keep the unsubscribe token and add a "stop all alerts to this address" path that blocks future signups for that address (a small `alert_suppressions` table keyed by lowercased email or E.164 number), so a victim can opt out of being re-subscribed by others.
6. Shared rate limits move to a database or Redis store: per-IP, per-address and a global daily cap on confirmation messages (SMS costs money).
