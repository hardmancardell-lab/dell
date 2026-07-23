# Privacy Policy — DRAFT

**Status: DRAFT. Not legal advice. Do not publish or link this from the live app until a
licensed attorney in your jurisdiction has reviewed and approved it.** This draft mirrors the
structure of privacy policies used by comparable consumer fintech/data apps and reflects what
this codebase actually collects today (verified against `src/lib/analytics/supabase.ts`,
`use-track.ts`, and the `events` table schema in `SUPABASE_INTEGRATION_NOTES.md`) — it is a
starting point for your attorney, not a finished, publishable document.

_Effective date: [FILL IN ONCE REVIEWED]_

## 1. Who we are

[Company/individual name], operator of [app name] (the "Service"), a financial research and
education tool.

## 2. What we collect

**Usage analytics** (via `/api/track`, stored in Supabase):
- A randomly generated session identifier (`crypto.randomUUID()`), stored in your browser's
  local storage. It is not tied to your name, email, account, or any other identifier we hold —
  we don't have accounts at all today.
- Which tab/section of the app you view (`tab_view` events).
- Which ticker symbols you look up or analyze (`ticker_analyzed` events) — the symbol only
  (e.g. "AAPL"), never quantities, dollar amounts, or portfolio contents.
- Small structured technical metadata attached to the above (e.g. which lookback period you
  selected) — never free-text input.

**What we do NOT collect**: names, emails, addresses, government IDs, account numbers, passwords,
portfolio holdings, dollar amounts, brokerage credentials, or any data typed into a form field
(portfolio holdings you enter live only in your browser's local storage, on your device — they
are never sent to our servers).

**If/when the alerts feature ships**: email address and/or phone number, only if you explicitly
opt in via the alerts signup form, with a separate unchecked-by-default consent checkbox. [Fill in
once that feature is live — see `ALERTS_INTEGRATION_NOTES.md`.]

## 3. How we use it

To understand which features are used, fix what's broken, and prioritize what to build next. We
do not use it to build advertising profiles, and we do not run advertising on this Service today.

## 4. Do we sell your data?

**No.** We do not sell, rent, or share the data described above with third parties for monetary
or other valuable consideration.

[If this changes in the future: California's CCPA/CPRA defines "sale" broadly — any disclosure
of personal information to a third party for money *or any other value* counts, not just a cash
transaction. Selling any data derived from Service usage would require, at minimum: (a) a "Do Not
Sell or Share My Personal Information" mechanism for California users, (b) meeting CCPA's specific
de-identification safeguards if relying on an anonymization exemption (technical measures +
a public commitment not to re-identify + contractual flow-down terms binding any buyer to the
same), and (c) review against other states' comprehensive privacy laws (Virginia, Colorado,
Connecticut, Utah, and others each have their own, not-identical rules). Get counsel before
changing this section.]

## 5. Cookies & local storage

We use browser local storage (not cookies) to remember your anonymous session ID and any
watchlists/portfolio holdings/progress you've entered — all of which stay on your device. See
Section 2 for what is and isn't sent to our servers.

## 6. Your rights

Because we don't collect account-identifying information, we have no way to look up "your" data
specifically — your session ID is not linked to anything we could use to find you. If you'd like
your locally-stored data removed, clearing your browser's local storage for this site removes it
entirely. [Attorney: confirm whether this satisfies CCPA/GDPR deletion-request obligations given
the current architecture, or whether a lookup mechanism needs to be built.]

## 7. Children's privacy

This Service is not directed to children under 13 (or the relevant age of digital consent in your
jurisdiction) and we do not knowingly collect data from them.

## 8. Financial disclaimer

This Service provides research tools and educational content. It does not provide personalized
investment advice, and nothing in the Service should be construed as a recommendation to buy or
sell any security. [Coordinate this section with whatever disclaimer language your attorney
recommends for the app's actual functionality.]

## 9. Changes to this policy

[Standard "we may update this policy, we'll post the effective date above" language — finalize
with counsel.]

## 10. Contact

[Fill in a real contact method before publishing.]

---

_Engineering note (remove before publishing): this draft was generated to reflect the actual,
current data-collection surface of the app as of 2026-07-22 — cross-check it against the code
again before publishing if the analytics pipeline changes (new event types, the alerts feature
going live, any future account system) since it will go stale otherwise._
