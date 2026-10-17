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
        text: "Your employer matches part of what you put in your 401(k), and the sign-up form is due before the end of the month.",
        isSignal: true,
        domain: "investing",
        explanation: "An employer match is a real, written benefit, and a real deadline is normal. You can confirm both with your HR office.",
      },
      {
        text: "A broad market index fund shows a 10-year average return of about 7% a year, after fees.",
        isSignal: true,
        domain: "investing",
        explanation: "A disclosed, multi-year, after-fee return from a real fund is the kind of checkable data worth acting on.",
      },
      {
        text: "A newsletter says a fund gained 38% last year, so it will surely do the same this year.",
        isSignal: false,
        domain: "investing",
        explanation: "Past returns do not promise future ones. One hot year is not a track record.",
      },
      {
        text: "An ad promises \"guaranteed 20% monthly returns, no risk.\"",
        isSignal: false,
        domain: "investing",
        explanation: "No legitimate investment guarantees a fixed high return. \"Guaranteed\" and \"no risk\" together is one of the clearest red flags in investing.",
      },
      {
        text: "A company's reports show more cash than debt and steady profit for five years in a row.",
        isSignal: true,
        domain: "investing",
        explanation: "Checkable, multi-year numbers are real signal. They are the opposite of a hot tip.",
      },
      {
        text: "A stock tip in a group chat says to buy now because \"insiders are loading up.\"",
        isSignal: false,
        domain: "investing",
        explanation: "An anonymous claim about insider buying cannot be checked. It is a pressure tactic, not evidence.",
      },
      {
        text: "A friend says his stock gained 12% in a month, so he is sure it will keep going up.",
        isSignal: false,
        domain: "investing",
        explanation: "One good month does not predict the next. Confidence is not evidence.",
      },
      {
        text: "Spreading your money across different kinds of investments lowers how much any one bad pick can hurt you.",
        isSignal: true,
        domain: "investing",
        explanation: "This is a standard risk rule, not a sales pitch. It comes with no urgency and no guarantee.",
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
        text: "A loan ad says \"low payments from $99 a month\" and never states the APR or the total cost.",
        isSignal: false,
        domain: "credit-debt",
        explanation: "A low payment can hide a long term and a high rate. Real offers show the APR and the total you will repay.",
      },
      {
        text: "A credit card offer shows a 24.99% APR clearly on the application.",
        isSignal: true,
        domain: "credit-debt",
        explanation: "A clearly shown rate is real, usable information, even a high one you can plan around.",
      },
      {
        text: "A nonprofit credit counseling group offers a free session today and lists its nonprofit status.",
        isSignal: true,
        domain: "credit-debt",
        explanation: "A free service from a stated nonprofit, with nothing being sold, is a real resource.",
      },
      {
        text: "A text says \"Your card is about to be closed. Click here to verify your info immediately.\"",
        isSignal: false,
        domain: "credit-debt",
        explanation: "Urgency plus a link that asks for account details is a phishing script, not your bank.",
      },
      {
        text: "A \"debt relief\" company asks for $1,500 up front before it talks to your lenders.",
        isSignal: false,
        domain: "credit-debt",
        explanation: "Debt relief firms are generally not allowed to charge before they settle a debt (FTC rule). An upfront fee is a warning sign.",
      },
      {
        text: "Your bank explains that paying only the minimum on a card sends most of the payment to interest first.",
        isSignal: true,
        domain: "credit-debt",
        explanation: "A plain explanation of how your own payment is applied is real, checkable information.",
      },
      {
        text: "\"No credit check, guaranteed approval, cash today\" says a billboard for a title loan.",
        isSignal: false,
        domain: "credit-debt",
        explanation: "\"Guaranteed approval\" whatever your ability to repay is built to get you into the loan, not to help you.",
      },
      {
        text: "A post says skipping your $6 coffee will make you a millionaire.",
        isSignal: false,
        domain: "budgeting",
        explanation: "One small habit almost never explains a life-changing result. Hidden assumptions do the real work.",
      },
      {
        text: "Tracking every dollar for one month before you make a budget shows where your money really goes.",
        isSignal: true,
        domain: "budgeting",
        explanation: "This is a low-cost first step based on your own real spending, not someone else's formula.",
      },
      {
        text: "Building a $500 emergency buffer first, before extra debt payments, is a common recommended order.",
        isSignal: true,
        domain: "budgeting",
        explanation: "A widely taught order with a reason behind it, not a gimmick.",
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
        text: "S&P 500 stocks have returned about 10% a year over the long run, before inflation, with big drops along the way.",
        isSignal: true,
        domain: "investing",
        explanation: "A long-run historical figure anyone can look up, and it includes the bad years.",
      },
      {
        text: "Email: \"You won a $2,000 government grant. Send a $50 fee to claim it.\"",
        isSignal: false,
        domain: "scams",
        explanation: "Real government grants do not ask winners to pay a fee. A fee to collect a prize is a scam sign.",
      },
      {
        text: "Caller says he is the IRS and demands payment right now by gift card.",
        isSignal: false,
        domain: "scams",
        explanation: "The IRS does not demand gift-card payment. This is a well-known scam script.",
      },
      {
        text: "Free budget worksheet from a nonprofit credit counseling group.",
        isSignal: true,
        domain: "budgeting",
        explanation: "A clear method from a stated nonprofit, with nothing being sold, is a real resource.",
      },
      {
        text: "0% APR for 15 months, then 26.99%, printed in the card's terms.",
        isSignal: true,
        domain: "credit-debt",
        explanation: "Even an expensive rate is signal when it is fully disclosed. You can plan around a number you can see.",
      },
      {
        text: "\"Up to 25% cash back!\" The fine print caps it at $6 a month.",
        isSignal: false,
        domain: "budgeting",
        explanation: "The headline number and the real cap are two different offers. The fine print is the actual deal.",
      },
      {
        text: "\"Turn $500 into $5,000 in 30 days. DM me the secret.\"",
        isSignal: false,
        domain: "investing",
        explanation: "A private \"secret\" with an unlikely return and a DM funnel is a pitch, not a strategy.",
      },
      {
        text: "A refinance offer shows your current payment, the new payment, and the total interest saved, in writing.",
        isSignal: true,
        domain: "credit-debt",
        explanation: "Real before-and-after numbers you can check against your own loan.",
      },
      {
        text: "Group chat: \"Get in now before the whales dump. It's a sure thing.\"",
        isSignal: false,
        domain: "investing",
        explanation: "Nothing in markets is a \"sure thing.\" That phrase is doing the selling, not the evidence.",
      },
      {
        text: "Report a scam right now at ReportFraud.ftc.gov, the FTC's official site.",
        isSignal: true,
        domain: "scams",
        explanation: "An official, checkable government site is real signal.",
      },
      {
        text: "Before you sign with a lender, you can look up complaints about it in the CFPB's public database.",
        isSignal: true,
        domain: "scams",
        explanation: "A public, official record you can check yourself.",
      },
      {
        text: "An ebook seller says his stock system has beaten the market ten years running.",
        isSignal: false,
        domain: "investing",
        explanation: "A claim with no audited record is a sales pitch. Very few managers beat the market for ten years in a row.",
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
        text: "Text: \"You're approved for $5,000. No job check needed.\"",
        isSignal: false,
        domain: "credit-debt",
        explanation: "Real lenders check that you can repay. Skipping that step is the trap, not a perk.",
      },
      {
        text: "Flyer: \"Debt settlement can cut what you owe in half.\"",
        isSignal: false,
        domain: "credit-debt",
        explanation: "Settlement results vary a lot, fees are high, and it often damages credit along the way. A big promise with no detail is a sales hook.",
      },
      {
        text: "Fund fact sheet: \"Yearly fee (expense ratio): 0.03%.\"",
        isSignal: true,
        domain: "investing",
        explanation: "A disclosed, checkable cost figure straight from the fund's own paperwork.",
      },
      {
        text: "Loan notice: \"APR 391%, shown before you sign, as the Truth in Lending Act requires.\"",
        isSignal: true,
        domain: "credit-debt",
        explanation: "An alarming number is still real, disclosed information. The law requires it, and it is exactly what should make you say no.",
      },
      {
        text: "Website: \"This coin is up 900% this year, so buy more.\"",
        isSignal: false,
        domain: "investing",
        explanation: "A big past gain is not a reason a price will keep rising. It is a pitch built on hype.",
      },
      {
        text: "Voicemail: \"Your car warranty is about to expire. Press 1 now.\"",
        isSignal: false,
        domain: "scams",
        explanation: "A classic robocall script, with urgency and a vague \"warranty\" claim.",
      },
      {
        text: "Statement: \"Paying only the $35 minimum will take 19 years,\" per the card issuer's own disclosure.",
        isSignal: true,
        domain: "credit-debt",
        explanation: "A required disclosure straight from the statement. It is uncomfortable, but it is exactly what you need to know.",
      },
      {
        text: "DM: \"I turned $1k into $40k in a month. Follow my signals.\"",
        isSignal: false,
        domain: "investing",
        explanation: "An unverifiable personal claim with a follow-me pitch attached.",
      },
      {
        text: "Email: \"Your account will be reviewed in 5 days. Reply with your password to keep it active.\"",
        isSignal: false,
        domain: "scams",
        explanation: "No real bank asks for your password by email.",
      },
      {
        text: "FDIC fact sheet: \"Deposit insurance is free and automatic, up to $250,000 per depositor, per bank, per ownership category.\"",
        isSignal: true,
        domain: "budgeting",
        explanation: "A specific, official rule you can check at fdic.gov.",
      },
      {
        text: "App: \"34% of this month's income went to housing.\"",
        isSignal: true,
        domain: "budgeting",
        explanation: "A real number from your own transactions, not a claim about you from outside.",
      },
      {
        text: "Pop-up: \"Congratulations! You are the 1,000,000th visitor!\"",
        isSignal: false,
        domain: "scams",
        explanation: "A prize you never entered for, on a site you did not ask to win from.",
      },
      {
        text: "CD (a bank savings certificate): \"Early withdrawal penalty is 6 months of interest.\"",
        isSignal: true,
        domain: "budgeting",
        explanation: "A specific, disclosed penalty from the product's own terms.",
      },
      {
        text: "Chart: the S&P 500 fell more than 30% in past bear markets before recovering, and some recoveries took years.",
        isSignal: true,
        domain: "investing",
        explanation: "Real historical data, including the uncomfortable part. That is what makes it trustworthy.",
      },
    ],
  },
];
