import type { SignalCheckLevel } from "../types";

/**
 * Content for the Intermediate-tier "Signal Check" game — see SignalCheckLevel
 * in ../types.ts for the design rationale (variety/pace/scaffolding ramp,
 * not per-card difficulty). Every card is a single real-world money claim;
 * the player makes exactly one binary call (Signal or Noise) per card, at
 * their own pace — there is no timer anywhere in this game, unlike Quiz Mode
 * or Delta Defender, since a countdown is itself a bandwidth cost this
 * mechanic is deliberately designed not to add.
 */
export const SIGNAL_CHECK_LEVELS: SignalCheckLevel[] = [
  {
    id: "intermediate-game-signal-check-1",
    order: 1,
    title: "Signal Check — Warm-Up",
    intro:
      "One topic, one decision each: is this investing claim Signal (real, checkable) or Noise (hype, pressure, or a trap)? No timer — take your time on every card.",
    showExplanationsAlways: true,
    xpBase: 15,
    cards: [
      {
        text: "A friend says his crypto pick doubled in a week and you should buy in before it's too late.",
        isSignal: false,
        domain: "investing",
        explanation: "Urgency plus \"too late\" pressure with no real track record is hype, not research.",
      },
      {
        text: "A broad market index fund shows a 10-year average annual return of about 7%, after fees.",
        isSignal: true,
        domain: "investing",
        explanation: "A disclosed, multi-year, fee-adjusted return from a real fund is exactly the kind of verifiable data worth acting on.",
      },
      {
        text: "An ad promises \"guaranteed 20% monthly returns, no risk.\"",
        isSignal: false,
        domain: "investing",
        explanation: "No legitimate investment guarantees a fixed high return — \"guaranteed\" and \"no risk\" together is one of the clearest red flags in investing.",
      },
      {
        text: "Your 401(k) match doubles part of every dollar you contribute, up to 4% of your paycheck.",
        isSignal: true,
        domain: "investing",
        explanation: "An employer match is a real, immediate, guaranteed return — one of the few places \"guaranteed\" actually applies.",
      },
      {
        text: "A stock tip in a group chat says to buy now because \"insiders are loading up.\"",
        isSignal: false,
        domain: "investing",
        explanation: "An anonymous, unverifiable claim about insider activity is a pressure tactic, not evidence.",
      },
      {
        text: "A company's financials show more cash than debt and steady profit for five straight years.",
        isSignal: true,
        domain: "investing",
        explanation: "Verifiable, multi-year fundamentals are real signal — the opposite of a hot tip.",
      },
      {
        text: "\"Everyone is buying this coin right now, don't miss out.\"",
        isSignal: false,
        domain: "investing",
        explanation: "Fear of missing out is a marketing lever, not a reason a price will keep rising.",
      },
      {
        text: "Diversifying across different types of investments reduces how much any single bad pick can hurt you.",
        isSignal: true,
        domain: "investing",
        explanation: "This is an established risk-management principle, not a sales pitch — no urgency, no guarantee, just math.",
      },
    ],
  },
  {
    id: "intermediate-game-signal-check-2",
    order: 2,
    title: "Signal Check — Mixed Bag",
    intro:
      "Same one-tap decision, now spread across investing, credit, and budgeting claims — broader variety, not harder questions.",
    showExplanationsAlways: true,
    xpBase: 20,
    cards: [
      {
        text: "A credit card offer discloses a 24.99% APR clearly on the application.",
        isSignal: true,
        domain: "credit-debt",
        explanation: "A clearly disclosed rate is real, usable information — even a high one you can plan around.",
      },
      {
        text: "A payday loan ad says \"$200 today, pay it back on your next check\" with no rate mentioned anywhere.",
        isSignal: false,
        domain: "credit-debt",
        explanation: "Hiding the rate is the tell — real payday APRs often run into the triple digits, and a rollover trap starts exactly here.",
      },
      {
        text: "Your bank explains that paying only the minimum on a card balance sends most of your payment to interest first.",
        isSignal: true,
        domain: "credit-debt",
        explanation: "A plain explanation of how your own payment is actually applied is real, checkable information.",
      },
      {
        text: "A text says \"Your card is about to be closed — click here to verify your info immediately.\"",
        isSignal: false,
        domain: "credit-debt",
        explanation: "Urgency plus a link asking for account info is a phishing script, not your bank.",
      },
      {
        text: "A loan comparison shows three offers side by side with the APR, term, and total repayment cost for each.",
        isSignal: true,
        domain: "credit-debt",
        explanation: "Real, comparable numbers laid out for you to weigh is exactly what a decision like this needs.",
      },
      {
        text: "\"No credit check, guaranteed approval, cash today\" flashes on a billboard for a title loan.",
        isSignal: false,
        domain: "credit-debt",
        explanation: "\"Guaranteed approval\" regardless of your ability to repay is designed to get you into the loan, not to help you.",
      },
      {
        text: "A \"proven system\" promises you'll pay off all debt in 30 days no matter your income.",
        isSignal: false,
        domain: "budgeting",
        explanation: "A fixed timeline that ignores your actual income and balances is a marketing claim, not a plan.",
      },
      {
        text: "Tracking every dollar for one month before making a budget shows you where money is actually going.",
        isSignal: true,
        domain: "budgeting",
        explanation: "A real, low-cost first step grounded in your own actual spending, not someone else's formula.",
      },
      {
        text: "\"Skip your $6 coffee every day and you'll retire a millionaire!\" a post claims, doing the math on coffee alone.",
        isSignal: false,
        domain: "budgeting",
        explanation: "A single small habit almost never explains a life-changing outcome by itself — the hidden assumptions are doing the real work.",
      },
      {
        text: "Building a $500 emergency buffer first, before extra debt payments, is a common recommended order.",
        isSignal: true,
        domain: "budgeting",
        explanation: "A widely taught, grounded sequencing rule — not a gimmick, just a reason behind the order.",
      },
    ],
  },
  {
    id: "intermediate-game-signal-check-3",
    order: 3,
    title: "Signal Check — Real World",
    intro:
      "Shorter, headline-style claims across every money topic. You'll only see why you missed one — you already know why you got it right.",
    showExplanationsAlways: false,
    xpBase: 25,
    cards: [
      {
        text: "\"Up to 25% cash back!\" — fine print caps it at $6 total per month.",
        isSignal: false,
        domain: "budgeting",
        explanation: "The headline number and the real cap are two different offers — the fine print is the actual deal.",
      },
      {
        text: "Free budgeting worksheet from a nonprofit credit counseling org, income minus fixed and variable expenses.",
        isSignal: true,
        domain: "budgeting",
        explanation: "A transparent method from a stated nonprofit with nothing being sold is a real resource.",
      },
      {
        text: "Pop-up: \"Act now — this government grant offer expires in 10 minutes.\"",
        isSignal: false,
        domain: "scams",
        explanation: "Real government grants don't expire on a countdown timer inside a pop-up.",
      },
      {
        text: "The FTC's consumer site lists your state's real complaint process for a company you're unsure about.",
        isSignal: true,
        domain: "scams",
        explanation: "An official, checkable government resource is real signal.",
      },
      {
        text: "Caller claims to be the IRS, demands payment right now by gift card.",
        isSignal: false,
        domain: "scams",
        explanation: "The IRS never demands gift-card payment — this is a well-known scam script.",
      },
      {
        text: "A company's reviews and complaint responses are visible on the Better Business Bureau site.",
        isSignal: true,
        domain: "scams",
        explanation: "A verifiable, third-party record you can check yourself.",
      },
      {
        text: "\"Turn $500 into $5,000 in 30 days — DM me the secret.\"",
        isSignal: false,
        domain: "investing",
        explanation: "A private \"secret\" with an implausible return and a DM funnel is a pitch, not a strategy.",
      },
      {
        text: "S&P 500 historical average return: roughly 10%/year before inflation, per public market data.",
        isSignal: true,
        domain: "investing",
        explanation: "A sourced, long-run historical figure anyone can look up.",
      },
      {
        text: "0% APR for 15 months, then 26.99% after — printed plainly in the card's terms.",
        isSignal: true,
        domain: "credit-debt",
        explanation: "Even an expensive rate is signal when it's fully disclosed — you can plan around a number you can see.",
      },
      {
        text: "\"Beat the market every year — my system never loses,\" claims an ebook seller.",
        isSignal: false,
        domain: "investing",
        explanation: "No system \"never loses\" — a claim with no downside is the downside.",
      },
      {
        text: "Refinance offer shows current payment, new payment, and total interest saved, in writing.",
        isSignal: true,
        domain: "credit-debt",
        explanation: "Real before/after numbers you can check against your own loan.",
      },
      {
        text: "Group chat: \"get in now before whales dump, this is a sure thing.\"",
        isSignal: false,
        domain: "investing",
        explanation: "Nothing in markets is a \"sure thing\" — that phrase is doing the selling, not the evidence.",
      },
    ],
  },
  {
    id: "intermediate-game-signal-check-4",
    order: 4,
    title: "Signal Check — Fast Take",
    intro:
      "The shortest claims yet, still one tap each. No intro hints this round — just react the way you would seeing this in real life.",
    showExplanationsAlways: false,
    xpBase: 30,
    cards: [
      {
        text: "Text: \"You've been approved for $5,000 — no job verification needed.\"",
        isSignal: false,
        domain: "credit-debt",
        explanation: "Real lenders verify ability to repay — skipping that step is the trap, not a perk.",
      },
      {
        text: "Prospectus: \"Fund expense ratio: 0.03%.\"",
        isSignal: true,
        domain: "investing",
        explanation: "A disclosed, checkable cost figure straight from the fund's own filing.",
      },
      {
        text: "DM: \"I turned $1k into $40k in a month — follow my signals.\"",
        isSignal: false,
        domain: "investing",
        explanation: "An unverifiable personal claim with a follow-me pitch attached.",
      },
      {
        text: "Notice: \"Your loan's APR is 391%, as required by the Truth in Lending Act.\"",
        isSignal: true,
        domain: "credit-debt",
        explanation: "An alarming number is still real, disclosed information — required by law, and exactly what should make you say no.",
      },
      {
        text: "Ad: \"This one trick banks don't want you to know.\"",
        isSignal: false,
        domain: "scams",
        explanation: "A secret-trick hook with a vague enemy (\"banks\") and no specifics is a pure attention grab.",
      },
      {
        text: "Fact sheet: \"FDIC insures deposits up to $250,000 per depositor, per bank.\"",
        isSignal: true,
        domain: "budgeting",
        explanation: "A specific, sourced, official rule you can verify at fdic.gov.",
      },
      {
        text: "Voicemail: \"Your car warranty is about to expire — press 1 now.\"",
        isSignal: false,
        domain: "scams",
        explanation: "A classic robocall script with urgency and a vague \"warranty\" claim.",
      },
      {
        text: "Chart: S&P 500 fell over 30% in past recessions, recovered within years each time.",
        isSignal: true,
        domain: "investing",
        explanation: "Real historical data, including the uncomfortable part — that's what makes it trustworthy.",
      },
      {
        text: "Flyer: \"Debt settlement company erases your debt for pennies on the dollar.\"",
        isSignal: false,
        domain: "credit-debt",
        explanation: "\"Erase for pennies\" oversells what settlement actually does, and often damages credit along the way.",
      },
      {
        text: "App: \"34% of this month's income went to housing.\"",
        isSignal: true,
        domain: "budgeting",
        explanation: "A real number pulled from your own transactions, not a claim about you from outside.",
      },
      {
        text: "Pop-up: \"Congratulations — you're our website's 1,000,000th visitor!\"",
        isSignal: false,
        domain: "scams",
        explanation: "A prize you didn't enter for, on a site you didn't ask to win from.",
      },
      {
        text: "Terms: \"Early withdrawal penalty: 6 months of interest,\" on a CD.",
        isSignal: true,
        domain: "budgeting",
        explanation: "A specific, disclosed penalty from the product's own terms.",
      },
      {
        text: "Robocall: \"Press 1 to lower your credit card interest rate instantly.\"",
        isSignal: false,
        domain: "credit-debt",
        explanation: "Real rate negotiation happens by calling your own issuer directly, not through an inbound robocall.",
      },
      {
        text: "Statement: \"Minimum payment $35 — paying only this extends payoff to 19 years,\" per the card issuer's own disclosure.",
        isSignal: true,
        domain: "credit-debt",
        explanation: "A required, real disclosure straight from the statement — uncomfortable, but exactly the information you need.",
      },
    ],
  },
];
