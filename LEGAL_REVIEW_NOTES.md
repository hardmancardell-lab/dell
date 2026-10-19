# Open questions for the securities attorney

A running list of product decisions that were made on the founder's instruction and that need counsel's review before they go in front of real users. Nothing here is legal advice. Add to it; do not delete entries, mark them resolved with the date and the attorney's answer.

Status key: **OPEN** (not yet reviewed) · **RESOLVED** (counsel answered; record the answer).

## 1. 401(k) tracker: "top-down" fund suggestions — OPEN (2026-10-05)

**Decision (founder):** For the 401(k) feature, run the Research Agent's top-down process (macro, then sector, then ranked securities with relative KPIs inside an impacted sector), then show which funds in the user's own plan hold those securities, and let the user compare. The founder's position is that showing a wide array of ranked securities, rather than one pick, keeps this on the education side of the line. The founder said to build it this way and change it if counsel says otherwise.

**Concern recorded at the time (assistant):** Whether something is advice depends on what the feature does, not on how it is labeled. A ranked, individualized pointer to specific plan funds that "look the best" may be treated as a recommendation. Disclaimers do not settle this.

**What counsel should confirm:**
- Where this sits against the ERISA "investment advice fiduciary" test. The 2024 DOL rule was vacated in March 2026 and the 1975 five-part test applies again (regularly, for a fee, mutual understanding, primary basis for decisions, individualized).
- Whether DOL Interpretive Bulletin 96-1 (29 CFR 2509.96-1) category "interactive investment materials" covers it. Its conditions include that all material facts and assumptions accompany the output and that any specific plan option named is accompanied by a statement that other options with similar risk and return may be available. The bulletin says it does not address the fee or compensation element of fiduciary status.
- Whether charging a subscription changes the analysis (the "for a fee" element).
- Whether the product, if individualized, requires investment adviser registration (SEC or state) and how that interacts with the planned RIA.

**Fallback design if counsel objects (already worked out):**
- The user chooses the sector or scenario, or the screen's criteria are shown and adjustable.
- Show ranked securities and KPIs as screen output, then show which of the user's plan funds hold them and how much.
- Show **all** plan funds on one comparison. No "best" label, no single pick, no ranking of the user's plan funds as a recommendation.
- Every output carries its assumptions and the "other options may be available" statement.

## 2. 401(k) headline numbers and projections — OPEN
Decision: show ranges with assumptions and fee-drag arithmetic, never a "maximum expected return" headline. Ask counsel what projection disclosures apply (SEC marketing rule if registered; FINRA communications rules if a broker-dealer is involved; state rules).

## 3. Faye usage logging — OPEN
Faye logs redacted question text, topic tags and tickers (never portfolio data or account details). The privacy policy draft now has a Faye section marked for review. Needs: wording, retention period, consent mechanism before Faye is offered to anyone beyond the owner and a known collaborator.

## 4. Hands-off automated trading — OPEN (not built)
Founder wants optional automation that places the day's trade and manages stop-loss and take-profit, with a slippage disclosure and an opt-in prompt. **Scope limit:** paper (simulated) trades only. Real-money automation is discretionary trading authority and must not be built without registration, broker agreements and counsel's clearance.

## 5. Paper-trade strategy logging and "Take it" signals — OPEN
Faye can propose paper orders tied to a Guided Signal and logs the strategy and its backtested statistics. Confirm that presenting backtest statistics next to a one-click paper order is acceptable and what disclosures the page needs.

## 6. Education versus advice across the product — OPEN
The tracker, Faye and the guided signals all use educational framing. Ask counsel to review the exact fixed wording (Faye's educational line, the advice-redirect text, the signal cards) and the in-app disclosures.

## 7. Participant-data handling for the 401(k) feature — OPEN
Users enter plan details and holdings manually (no credential sharing). Holdings stay in the browser. If statement upload is ever added, decide whether it is processed on the device only, and update the privacy policy.

## 8. Client portal "Research" section — OPEN (2026-10-19)

**What it is.** A signed-in client of the advisor (after entering a personal passcode) can open a Research section inside the Portfolio view. It is read-only and reaches only that client's own holdings; the visitor can never type in a ticker. It is built from public data by fixed rules, with no human review of each output. What the client sees:
- **Valuation phase and rating against the company's own history.** For each stock held, the company is sorted into one of five business phases by a fixed rule (for example an early, fast-growing company versus a mature one). The valuation measures that fit that phase are compared with the company's own average over the past year, and the result is shown as a five-level position (from well below to well above its own past-year average, with a "close to average" middle level). The sentence shown says where today's price sits against the company's own past year and then says it does not say where the price goes next. It is not a comparison with other companies and it is not a price target.
- **Economic outlook.** A short regime label (where the economy sits in its cycle, money conditions) and a **rate-path view written by a computer model**. The rate path carries a "Model estimate" badge, an as-of date, and the sentence "It is not a promise, it can be wrong, and it is not advice about what you should do." The market-implied path and the current policy range are shown beside it for comparison.
- **Catalysts.** A dated list of scheduled events that can move markets in a window. If none is listed it says that does not mean nothing will happen.
- **Scorecard with sample size.** The outlook's own track record is shown as counts, always with the number of calls logged and graded. With none graded it says there is no record to show. With fewer than 10 graded it says that is too few to say how good the calls are and shows counts only, never a percentage. Even with 10 or more it says past results do not promise future ones.
- **News headlines** on the client's holdings (see item 9).
- A crypto market read only if the client holds crypto, and a plain-words explainer of the methods ("Classic formulas our analysts also use", with the assumptions each one makes).

**Wording guardrails already in place** (the code and the tests enforce them, but counsel should check the words themselves):
- No "buy", "sell", "cheap", "attractive", "undervalued", "overvalued", "bargain", "recommend" or "should invest" in client-facing text. The explainer states that the phase and position words only compare today with the past year and are not a view on whether to buy or sell.
- Every number shows its source and as-of time; a missing number is shown as missing, never as zero. Estimates carry an "Estimate" badge; delayed prices and older cached results are flagged.
- Reading level is held to grade 8 or lower by an automated check.
- A "Read this first: a note on forecasts" section, plus a research-and-education-not-advice notice, appear on the page.
- The owner can switch the whole section off without a deploy (environment switch CLIENT_RESEARCH_ENABLED).

**What counsel should confirm:**
- Whether a position rating against the company's own history, shown per holding to a person who holds it, is general information or an individualized recommendation once the advisor is registered. The founder's position is that it is a description of past data, not advice; that is a judgment for counsel, not a settled fact.
- Whether the model-written rate-path view, labelled as a model estimate, is acceptable in a client communication and what additional disclosure (limits of the model, how often it is updated, who reviewed it) is needed. Whether the track-record counts need a different presentation under the SEC marketing rule once the advisor is registered (the scorecard is a record of the firm's own forecasts, not of client performance).
- Whether the section needs a Form CRS or ADV cross-reference, or a recorded supervisory review, before real clients see it.
- Whether the "Estimate" label and the not-advice notice are enough, or whether each holding card needs the notice next to it.
- Who the audience is on launch (founder's own account, a known friend, or paying clients). Review should happen before the audience widens beyond people the founder knows.

## 9. News sources, including unofficial and unreviewed feeds — OPEN (2026-10-19)

**What the app shows.** Only the headline, the outlet name, the time and a link to the original page. Article text and feed descriptions are dropped when the feed is read, so nothing but the headline is stored in memory, and then only for minutes (results are cached for 5 to 10 minutes per server instance). A daily counter keeps only the number of headlines per symbol per day (with counts per outlet), never headline text or links. It is controlled by a repository switch (NEWS_LOG_ENABLED); the owner set it up on 2026-10-18, so confirm in the live settings whether it is on before telling counsel it is running.

**Where headlines come from, and the status of each source.**
- **Yahoo Finance per-symbol RSS feed** (feeds.finance.yahoo.com). This is an **unofficial** public feed, not a documented product, and Yahoo can change or stop it without notice. Its commercial terms have **not** been reviewed. It is the main source of per-symbol headlines for stocks, crypto, currency pairs and futures in the News hub, under every ticker chart, in the watchlist news, and in the client portal's "News on what you hold" panel (so clients see it).
- **SEC EDGAR** filings list (government public data): form type and date with a link. The app sends the identifying User-Agent that the SEC asks for.
- **Broad market outlets** (public RSS): CNBC, MarketWatch, BBC Business, Financial Times, The Guardian Business; the market headline list also uses Fox Business, Investing.com and CBC News Business.
- **Category RSS feeds**, used for crypto, energy, metals, farm goods and currency news: CoinDesk, Cointelegraph, Decrypt, The Block, BeInCrypto, Investing.com (crypto and currencies), OilPrice.com, Rigzone, EIA (US government), CNBC Energy, Mining.com, FXStreet, ForexLive, Farm Progress, USDA (US government). These were found by probing the sites' public RSS addresses on 2026-10-18; **their terms of use and any restrictions on commercial or automated use have not been reviewed.** Two are US government sources (EIA, USDA, plus SEC above) which are generally public information; the rest are private publishers.
- Optional background articles from GDELT (an index of news links). Only the link, domain and time are shown.
- Company news from FMP (a paid data service) is switched off at present.

**How items are chosen.** On a ticker's page the headlines are split into "About this asset" (the symbol's own feeds plus category headlines that name the asset) and "Market and macro". A fixed, published word list drops category-feed stories that are not about the asset, markets, money, rates, the economy or regulation (for example, a crypto site's non-financial stories). The list is applied by machine with no human judgment about any story's merit or tone. Opinion-style headlines are tagged "opinion" and shown as written; a note says that some outlets write opinion or promotional headlines and that we show each one as the outlet wrote it.

**What counsel should confirm:**
- Whether using each publisher's public RSS feed to display headlines and links inside a paid or client-facing product is permitted under its terms, and whether written permission or a licensed feed is needed before launch. This is the main open point for Yahoo (unofficial) and the private publishers. If any source objects, the fix is to remove that feed from the list (one line each in the category map).
- Whether showing headlines only, with outlet name and a link, is within fair use or an equivalent for headlines, and whether attribution as shown is enough.
- Whether linking third-party headlines inside a communication to advisory clients creates "adoption" or "entanglement" concerns, that is, whether the advisor could be treated as having endorsed the content, and whether a short statement that headlines are third-party and not reviewed or endorsed is needed beside the client news panel.
- Whether the keyword filter, which removes some stories, could be viewed as curation that makes the advisor responsible for what is left.
- Retention: the app holds no headline text beyond the short cache. Confirm that is the right posture, and that the privacy policy describes the daily counts.

## 10. News Impact study — OPEN (2026-10-19)

**What it is.** A statistical study of past prices, for one symbol, that asks two things: how much do dated events (SEC filings such as 8-K, 10-K, 10-Q, and scheduled macro release days such as CPI) move this asset compared with a normal day, and how much of the asset's movement is explained by the whole market and its sector. It reports sizes and ranges ("moved about 1.4 times the usual size on filing days, 95 percent range, based on n filing days") and the order in which factors were added, because that order matters.

**Guardrails in the wording and the code.** It says "moves with" and never "causes". It gives no verdict when there are too few events and says what the minimum is. A null result is described as a limit of detection ("we could miss an effect up to about 1.4 times"), never as "no effect". The page says it is a statistical study of past prices, that moves that went with news in the past may not repeat, and that correlation is not cause. A surprise move is described as a size, not a direction. No buy, sell or hold wording. It is research and education, not advice, and it is available only to signed-in app users, not on the public client page.

**What counsel should confirm:**
- That presenting an event study of a specific stock's past reactions, next to its news headlines, is not a recommendation or a prediction under the advisor's future registration, and that "moves with, not causes" plus the past-results caveat is enough.
- Whether the study should carry the same standard research notice used on the other results tabs (data source, as-of time, sample size, number of things tested).
- Whether the filing-day results, where the sample is small, need a stronger "too few events" warning in the headline.

## 11. Client passcodes are now stored salted — OPEN (2026-10-19)

**What changed.** A client's passcode used to be stored as an unsalted SHA-256 hash. New and changed passcodes are now stored with a salted, slow hash (scrypt, random 16-byte salt per passcode, in the form that keeps the parameters tagged so they can be strengthened later). Old unsalted hashes still work, so no client is locked out, and each one is **replaced with a salted hash automatically at that client's next successful sign-in**. Until a client signs in again, their stored hash is still the old kind. Passcodes are never logged or returned. A wrong guess for an unknown link costs the same time as for a known one. Sign-in attempts are rate limited and locked out after repeated failures. The session cookie after sign-in is signed, expires, is tied to that client's link and to the stored hash, so changing a passcode ends old sessions.

**What counsel should confirm:**
- Whether this meets the safeguards expectation for customer information held by an adviser (Regulation S-P and state equivalents), and whether the written information-security policy should name this control.
- Whether a deadline should be set for the remaining unsalted hashes (for example, force a reset for any client who has not signed in by a date), or leave them until next sign-in.
- Whether a shared passcode on a private link is an adequate authentication level for a page that shows a client's holdings and research, or whether a second factor is expected.
- What the incident-notice duty is if the client table were exposed (a salted hash is better than an unsalted one but a short passcode can still be guessed).

## 12. Faye local-assistant origin guard — OPEN (2026-10-19)

**What it is.** Faye is the in-app assistant. It runs as a separate local service, reachable only on the same machine (address 127.0.0.1, port 7810), not on a public address. Its server was hardened so that only the app's own web page can talk to it: a **list of allowed origins** (a request from any other website's page is refused with an error), a **host check** (a request with the wrong host name is refused), **JSON-only requests** (anything else is refused with a "wrong content type" error), a gate on its document-ingest step, and size caps (the project notes list "ingest gate, caps"; exact limits are in the Faye project). This was checked on 2026-10-19 on the hosted copy of Faye, where a bad origin and a bad host both got a refusal. The code lives in the separate Faye project, not in this repository, so it is described here from the project's own notes and test run, not re-checked from this repository.

**Related guards in this repository.** The in-app widget runs only a fixed list of read-only routes for Faye's plans, never a route that Faye names itself. A paper-order proposal from Faye is rebuilt from approved fields, range-checked, and shown on a confirm card that places only what it displays; its origin tag is forced to "faye" and cannot be set by the proposal. Paper orders are simulated, with no real money (see item 4).

**What counsel should confirm:**
- That a locally run assistant with these controls is acceptable to describe to users as private to their own machine, and what the privacy policy must say about the hosted copy (a cloud machine reached through a private tunnel) and the redacted question log (see item 3).
- Whether an assistant that can propose paper orders, even with a confirm step, needs any further disclosure beyond item 5.
