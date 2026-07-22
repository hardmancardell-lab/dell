import type { GoalOption, LiteracyModule, PlacementQuestion } from "../types";

/**
 * Content data file, same pattern as trading-agent/skills/glossary.ts and
 * options-strategies.ts — plain structured data, rendered by
 * FinancialLiteracyTab.tsx. Adapted from the curriculum outline reviewed
 * with the user (see the published project-overview/curriculum artifacts).
 * Each module's "tryIt" points at a real, already-built tab elsewhere in
 * this app — descriptive only for now, not a deep link (no cross-tab
 * navigation API exists yet to jump there directly).
 */

export const LITERACY_MODULES: LiteracyModule[] = [
  // ---------- BEGINNER ----------
  {
    id: "beginner-01",
    tier: "beginner",
    order: 1,
    title: "What money actually does",
    body: "Money does three jobs: it's a medium of exchange (you can trade it for anything), a unit of account (it lets you compare the price of wildly different things), and a store of value (it's supposed to hold its worth over time).\n\nThat third job is the one that quietly breaks. Inflation means prices rise over time, so cash sitting still — under a mattress, in a checking account paying near-zero interest — loses purchasing power even while the number on the balance stays the same. This is the single idea the rest of this course exists to respond to: money that isn't working somehow is quietly shrinking.",
    tryIt: null,
    checks: [
      {
        prompt: "You keep $500 in a jar for 3 years while inflation runs about 4% a year. What happened to what that $500 can actually buy?",
        options: ["It can buy more now", "It can buy about the same", "It can buy less now", "It doubled"],
        correctIndex: 2,
        explanation: "The number stayed $500, but prices rose roughly 12% over 3 years — so that same $500 buys noticeably less than it did.",
      },
      {
        prompt: "A friend says \"gas costs $60 and a haircut costs $60, so they're worth the same to me.\" Which job of money are they using?",
        options: ["Medium of exchange", "Unit of account", "Store of value", "None of these"],
        correctIndex: 1,
        explanation: "Comparing the price of two totally different things using one shared number is money acting as a unit of account — the medium-of-exchange job is actually handing over the cash, and store-of-value is about holding worth over time.",
      },
      {
        prompt: "Your checking account pays 0.1% interest while inflation runs 3.5%. Which job of money is failing here?",
        options: ["Medium of exchange", "Unit of account", "Store of value", "All three equally"],
        correctIndex: 2,
        explanation: "Money is still spendable (medium of exchange) and still lets you compare prices (unit of account) — what's breaking is its ability to hold purchasing power over time, the store-of-value job.",
      },
    ],
  },
  {
    id: "beginner-02",
    tier: "beginner",
    order: 2,
    title: "Budgeting without the spreadsheet phobia",
    body: "A budget is just income minus expenses, tracked honestly. The 50/30/20 framework is a reasonable starting split: roughly 50% of take-home pay to needs (rent, groceries, minimum debt payments), 30% to wants (everything discretionary), and 20% to savings and extra debt paydown.\n\nBefore anything else on this list, build a real emergency fund — 3 to 6 months of essential expenses, sitting somewhere liquid. It's not exciting, but it's what stops a car repair or a lost job from turning into high-interest debt.",
    tryIt: null,
    checks: [
      {
        prompt: "Under the 50/30/20 framework, if your take-home pay is $4,000/month, what's the target amount for wants?",
        options: ["$4,000", "$2,000", "$1,200", "$800"],
        correctIndex: 2,
        explanation: "30% of $4,000 is $1,200 — the discretionary slice, separate from the 50% for needs and 20% for savings.",
      },
      {
        prompt: "You have no emergency fund and a $1,200 car repair bill just hit. What does the 50/30/20 framework say you should have used?",
        options: [
          "The 20% savings slice, ideally already built into an emergency fund",
          "The 30% wants slice, since car repairs are optional",
          "A payday loan, since that's what emergencies are for",
          "None of the above — car repairs aren't a budgeting concern",
        ],
        correctIndex: 0,
        explanation: "This is exactly the scenario an emergency fund exists to absorb — without one, an unexpected cost like this tends to land on a credit card instead.",
      },
      {
        prompt: "Under 50/30/20, which category does a streaming subscription fall into?",
        options: ["Needs (50%)", "Wants (30%)", "Savings (20%)", "It doesn't count in any category"],
        correctIndex: 1,
        explanation: "A streaming subscription is discretionary spending — it belongs in the 30% wants slice, not the 50% needs slice reserved for rent, groceries, and minimum debt payments.",
      },
    ],
  },
  {
    id: "beginner-03",
    tier: "beginner",
    order: 3,
    title: "Debt and credit, honestly",
    body: "APR is the real annual cost of borrowing, including most fees — always compare APRs, not just headline interest rates. Your credit score is mostly driven by payment history and how much of your available credit you're using, and it directly determines what rates you're offered on everything from cards to mortgages.\n\nThe minimum-payment trap is real: paying only the minimum on a high-APR balance can mean the interest charged nearly matches (or exceeds) what you're paying down, so the balance barely moves for months or years.",
    tryIt: null,
    checks: [
      {
        prompt: "You carry a $1,000 credit card balance at 22% APR and only pay the $25 minimum each month. What's the biggest risk?",
        options: [
          "Your credit score improves immediately",
          "You'll pay it off in about a year",
          "Interest can outpace your payments and the balance barely shrinks",
          "There's no real downside since you're paying on time",
        ],
        correctIndex: 2,
        explanation: "At 22% APR, a large chunk of each minimum payment goes to interest, not principal — the balance can take years to clear this way.",
      },
      {
        prompt: "Card A advertises a 19.99% interest rate but has a $95 annual fee. Card B advertises 21.99% with no fee. For a $2,000 balance carried all year, what should you actually compare?",
        options: [
          "Only the advertised interest rate",
          "The APR, which folds in fees like the annual fee to show the real cost",
          "Whichever card has the lower fee, regardless of rate",
          "Neither — fees and rates don't matter if you pay on time",
        ],
        correctIndex: 1,
        explanation: "APR is built specifically to fold most fees into one comparable annual cost figure — comparing headline rates alone can hide which card is actually cheaper.",
      },
      {
        prompt: "You have a $10,000 total credit limit across your cards and currently carry a $6,000 balance. What does that 60% utilization typically do to your credit score?",
        options: [
          "Nothing, utilization doesn't matter",
          "It tends to hurt your score — high utilization relative to your limit is a negative factor",
          "It automatically improves your score",
          "It only matters if you miss a payment",
        ],
        correctIndex: 1,
        explanation: "Credit utilization — the share of your available credit currently in use — is one of the biggest drivers of your score after payment history; 60% is generally considered high.",
      },
    ],
  },
  {
    id: "beginner-04",
    tier: "beginner",
    order: 4,
    title: "Saving and investing are different tools",
    body: "The variable that decides which one you need is time horizon, not how much you want to grow your money. Money you need within the next 1-3 years — a down payment, an upcoming expense — belongs somewhere low-risk and liquid, because you can't afford for it to be down 20% right when you need it.\n\nMoney you won't touch for 10+ years (retirement is the classic case) can tolerate real short-term swings in exchange for meaningfully higher long-run growth. Confusing the two — investing short-term money aggressively, or leaving long-term money in cash — is one of the most common beginner mistakes.",
    tryIt: null,
    checks: [
      {
        prompt: "You need $10,000 for a house down payment in 14 months. Where does that money belong?",
        options: [
          "A diversified stock portfolio",
          "A high-yield savings account or similar low-risk, liquid option",
          "Cryptocurrency, for higher growth",
          "Long-term bonds",
        ],
        correctIndex: 1,
        explanation: "14 months is too short a horizon to risk a market downturn right before you need the cash — liquidity and stability matter more than growth here.",
      },
      {
        prompt: "You're 30 years old and putting your retirement contributions entirely into a checking account earning near-zero interest. What's the core mistake?",
        options: [
          "None — checking accounts are always the safest choice",
          "Leaving a 30+ year horizon in cash gives up decades of growth it could tolerate the ups and downs to capture",
          "Retirement money should never be saved at all",
          "This is only a mistake if you're over 50",
        ],
        correctIndex: 1,
        explanation: "A multi-decade horizon can absorb real short-term swings in exchange for meaningfully higher long-run growth — parking it in cash is the mirror-image mistake of investing short-term money aggressively.",
      },
      {
        prompt: "What's the single variable that decides whether money belongs in savings or in investments?",
        options: ["How much money you have", "Your time horizon — when you'll actually need the money", "Whether you like risk", "The current stock market's performance"],
        correctIndex: 1,
        explanation: "Time horizon is the deciding variable — money needed soon needs stability and liquidity; money with a long runway can tolerate volatility for higher expected growth.",
      },
    ],
  },
  {
    id: "beginner-05",
    tier: "beginner",
    order: 5,
    title: "What a share of stock actually is",
    body: "A share of stock is a small, real, fractional ownership stake in an actual business — its assets, its future earnings, its risks. It is not a scratch ticket or a number that moves for no reason; price changes reflect (often messily, often overreacting) changing expectations about that business's future.\n\nThis is the single most load-bearing reframe in the whole beginner tier: if you own the stock, you own a sliver of the company, not a bet placed against a stranger.",
    tryIt: { label: "Security Analysis · Analyze Ticker" },
    checks: [
      {
        prompt: "You buy 10 shares of a company. What do you actually own?",
        options: [
          "A loan to the company that must be repaid",
          "A tiny fractional ownership stake in the company's future earnings",
          "A guaranteed dividend payment",
          "Nothing until you sell",
        ],
        correctIndex: 1,
        explanation: "Stock is ownership, not a loan — that's what separates it from a bond, and it's why a stock's value ultimately tracks the business's real performance.",
      },
      {
        prompt: "A company's stock price drops 8% in a day on no company-specific news, just a broad market selloff. What actually changed about the business you own a piece of?",
        options: [
          "The company's real assets and future earnings power changed by exactly 8%",
          "Nothing about the business necessarily changed — the price reflects shifting market expectations, which can move independently of the business itself",
          "The company is now worth 8% less forever",
          "Stock prices only move when the business changes",
        ],
        correctIndex: 1,
        explanation: "Price and business value aren't the same thing minute-to-minute — a broad selloff can move a stock's price without anything about the underlying business actually changing that day.",
      },
      {
        prompt: "A company you own stock in stops paying a dividend but keeps growing its earnings. Do you still own part of the company?",
        options: [
          "No — dividends are what ownership actually is",
          "Yes — ownership is the shares themselves, not whether the company currently pays a dividend",
          "Only if you bought the stock specifically for its dividend",
          "Ownership expires when a dividend is cut",
        ],
        correctIndex: 1,
        explanation: "A dividend is a discretionary cash distribution a company chooses to make — your ownership stake exists independently of whether that particular payout continues.",
      },
    ],
  },
  {
    id: "beginner-06",
    tier: "beginner",
    order: 6,
    title: "What a bond actually is",
    body: "A bond is a loan — you're lending money to a company or government in exchange for regular interest payments and your principal back at maturity. Unlike a stock, you don't own anything; you're a creditor, not an owner.\n\nBond prices move opposite to interest rates: when new bonds start paying more, your older, lower-paying bond becomes less attractive and its market price falls, even though nothing about the issuer changed.",
    tryIt: null,
    checks: [
      {
        prompt: "Interest rates rise sharply after you buy a 10-year bond paying a fixed 3%. What happens to your existing bond's market price?",
        options: [
          "It rises, since rates rose too",
          "It falls, since new bonds now pay more and yours looks less attractive",
          "It's unaffected",
          "It doubles",
        ],
        correctIndex: 1,
        explanation: "Bond prices and interest rates move in opposite directions — your fixed 3% is worth less once the market can get more elsewhere.",
      },
      {
        prompt: "A company goes bankrupt. All else equal, who typically has a stronger legal claim on what's left — its bondholders or its stockholders?",
        options: [
          "Stockholders, since they're the owners",
          "Bondholders, since they're creditors owed a specific debt, paid before any leftover value reaches owners",
          "They have identical claims",
          "Neither has any claim in bankruptcy",
        ],
        correctIndex: 1,
        explanation: "Bondholders are creditors, not owners — creditors are paid out ahead of stockholders in a bankruptcy, part of why bonds are generally considered lower-risk than stocks from the same issuer.",
      },
      {
        prompt: "You buy a bond paying a fixed 4% coupon. If the company's profits double next year, does your coupon payment change?",
        options: [
          "Yes, it doubles along with profits",
          "No — a fixed coupon pays the same stated amount regardless of how the business performs",
          "It depends on the stock price that year",
          "Bonds don't have coupon payments",
        ],
        correctIndex: 1,
        explanation: "A fixed coupon is a contractual promise to pay a set amount, unrelated to how well or poorly the business does that year — the tradeoff for that certainty is missing out on the upside a stockholder would get.",
      },
    ],
  },
  {
    id: "beginner-07",
    tier: "beginner",
    order: 7,
    title: "Risk and diversification, quantified",
    body: "\"Don't put all your eggs in one basket\" is really a statement about correlation: if you hold many different things that don't all move together, one bad outcome doesn't sink the whole portfolio. Holding 1 stock means your entire result depends on that one company's news, lawsuits, and earnings surprises.\n\nHolding 30 stocks across different industries means any single company's bad news barely dents the total — the portfolio's swings shrink even though you haven't given up much expected return.",
    tryIt: null,
    checks: [
      {
        prompt: "Portfolio A holds 1 stock. Portfolio B holds 30 stocks across different industries. Which is more likely to swing wildly on one company's bad news?",
        options: ["Portfolio B", "Portfolio A", "They're identical", "Can't tell without more info"],
        correctIndex: 1,
        explanation: "A single holding means one company's news is the whole story for Portfolio A — diversification is precisely what dilutes that.",
      },
      {
        prompt: "You own 15 stocks, but all 15 are technology companies. How diversified are you really?",
        options: [
          "Fully diversified — 15 is a large number of holdings",
          "Only partially — sharing one industry means they can still move together on tech-specific news",
          "Not diversified at all regardless of count",
          "Diversification only applies to bonds",
        ],
        correctIndex: 1,
        explanation: "Count alone doesn't diversify a portfolio — what matters is whether the holdings are exposed to different risks; 15 companies in the same industry still share a lot of common risk.",
      },
      {
        prompt: "You own 40 stocks across every major industry. Does this protect you from a broad market-wide crash?",
        options: [
          "Yes, completely — diversification eliminates all risk",
          "No — diversification reduces company-specific risk, but broad market-wide downturns still affect a diversified portfolio",
          "Only if all 40 stocks are in different countries",
          "Diversification has no effect on any kind of risk",
        ],
        correctIndex: 1,
        explanation: "Diversification dilutes company-specific (idiosyncratic) risk, not market-wide (systematic) risk — a genuinely diversified portfolio can still fall in a broad downturn, just usually less than a single concentrated stock would.",
      },
    ],
  },
  {
    id: "beginner-08",
    tier: "beginner",
    order: 8,
    title: "Compound interest and the Rule of 72",
    body: "Compound interest means you earn returns not just on your original money, but on the returns it already made — growth on growth. The Rule of 72 is a fast mental-math shortcut: divide 72 by your annual return rate to estimate how many years it takes money to double.\n\nThis is why starting at 25 instead of 35 matters so much more than most people expect — a decade of extra compounding, even at a modest contribution rate, can end up being roughly the difference between a comfortable and an uncomfortable retirement.",
    tryIt: null,
    checks: [
      {
        prompt: "Using the Rule of 72, roughly how many years does it take money to double at a steady 8% annual return?",
        options: ["3 years", "9 years", "24 years", "72 years"],
        correctIndex: 1,
        explanation: "72 ÷ 8 = 9 — at 8% annual growth, the money roughly doubles in about 9 years.",
      },
      {
        prompt: "Investor A starts investing $200/month at age 25. Investor B starts investing the same $200/month at age 35, both retiring at 65. Who ends up with more, assuming the same return, and why?",
        options: [
          "Investor B, since they started with more life experience",
          "Investor A, because those extra 10 years let compound growth work on both a larger contribution base and more time",
          "They end up with exactly the same amount",
          "It's impossible to know without more information",
        ],
        correctIndex: 1,
        explanation: "Compound interest earns returns on returns already made — an extra decade of compounding, even at the same contribution rate, produces a meaningfully larger gap than the raw extra contributions alone would suggest.",
      },
      {
        prompt: "Using the Rule of 72, roughly how many years does it take money to double at a steady 4% annual return?",
        options: ["4 years", "9 years", "18 years", "36 years"],
        correctIndex: 2,
        explanation: "72 ÷ 4 = 18 — at a lower 4% annual growth rate, doubling takes about twice as long as the 9 years it takes at 8%.",
      },
    ],
  },
  {
    id: "beginner-09",
    tier: "beginner",
    order: 9,
    title: "Taxes, the parts that matter now",
    body: "Ordinary income (your paycheck) is taxed differently than capital gains (profit from selling an investment). Hold an investment over a year before selling and the profit typically qualifies for lower long-term capital gains rates than your regular income tax rate.\n\nTax-advantaged accounts like a 401(k) or IRA let contributions grow without being taxed every year the way a regular brokerage account is — understanding this now, even at a beginner level, changes how much of your investing you'd want to route through those accounts first.",
    tryIt: null,
    checks: [
      {
        prompt: "You sell a stock you held for 2 years at a profit. Compared to your regular paycheck income, how is that gain typically taxed?",
        options: [
          "Exactly the same as your paycheck",
          "Usually at a lower long-term capital gains rate",
          "It's never taxed",
          "At double your income tax rate",
        ],
        correctIndex: 1,
        explanation: "Gains on investments held over a year generally qualify for preferential long-term capital gains rates, lower than ordinary income tax brackets.",
      },
      {
        prompt: "You buy a stock and sell it 8 months later for a profit. How is that gain typically taxed compared to a stock held over a year?",
        options: [
          "Identically — holding period doesn't matter",
          "As a short-term gain, generally taxed at your regular (often higher) income tax rate rather than the lower long-term rate",
          "It's tax-free since it was a small window",
          "At a fixed 50% rate regardless of income",
        ],
        correctIndex: 1,
        explanation: "Gains on investments held one year or less are short-term and typically taxed as ordinary income — crossing the one-year mark is what qualifies a gain for the lower long-term capital gains rate.",
      },
      {
        prompt: "What's the main tax advantage of routing investments through a 401(k) or IRA instead of a regular brokerage account?",
        options: [
          "Guaranteed higher returns",
          "Contributions and growth aren't taxed every year the way a regular brokerage account's gains can be",
          "No fees are ever charged",
          "You can withdraw the money penalty-free at any age",
        ],
        correctIndex: 1,
        explanation: "Tax-advantaged accounts let money grow without an annual tax drag on gains/dividends the way a regular taxable brokerage account can have — the tradeoff is usually restrictions on when you can withdraw without penalty.",
      },
    ],
  },

  // ---------- INTERMEDIATE ----------
  {
    id: "intermediate-01",
    tier: "intermediate",
    order: 1,
    title: "Reading the three statements",
    body: "The income statement shows revenue and profit over a period. The balance sheet shows what a company owns and owes at a single point in time. The cash flow statement shows actual cash moving in and out — and it's the one that's hardest to fake, because accounting profit can include revenue that hasn't actually been collected yet.\n\nA company can report a genuine accounting profit while its cash position quietly deteriorates — usually a sign to look at receivables and inventory before trusting the headline number.",
    tryIt: { label: "Security Analysis · Graham Checklist" },
    checks: [
      {
        prompt: "A company reports a profit on its income statement, but its cash flow statement shows cash actually declining. What should that make you check?",
        options: [
          "Nothing, profit is profit",
          "Whether that profit is backed by real cash coming in, or sitting in unpaid receivables/inventory",
          "The stock is definitely a fraud",
          "The balance sheet is irrelevant now",
        ],
        correctIndex: 1,
        explanation: "Profit is an accounting figure; cash flow shows what actually moved. A gap between them is exactly what the cash flow statement exists to surface.",
      },
      {
        prompt: "You want to know what a company owes in total debt right now, today. Which statement answers that?",
        options: [
          "The income statement, since it shows a period of activity",
          "The balance sheet, since it's a snapshot of what's owned and owed at one point in time",
          "The cash flow statement",
          "None of the three show debt levels",
        ],
        correctIndex: 1,
        explanation: "The balance sheet is a snapshot at a single point in time — assets, liabilities, and equity as they stand right now — unlike the income statement and cash flow statement, which both cover a period.",
      },
      {
        prompt: "A company's revenue is growing, but its accounts receivable (money owed by customers) is growing even faster. What might that suggest?",
        options: [
          "Nothing — receivables growth is always a good sign",
          "The company may be booking sales it hasn't actually collected cash for yet, worth investigating further",
          "The company is definitely committing fraud",
          "Receivables have nothing to do with revenue",
        ],
        correctIndex: 1,
        explanation: "Receivables growing faster than revenue can mean customers are taking longer to pay, or sales are being recognized before cash actually arrives — not proof of a problem, but a real flag worth checking against the cash flow statement.",
      },
    ],
  },
  {
    id: "intermediate-02",
    tier: "intermediate",
    order: 2,
    title: "Valuation: what \"cheap\" and \"expensive\" mean",
    body: "P/E (price divided by earnings per share) and P/B (price divided by book value per share) are the most common starting valuation ratios. A high P/E can mean a stock is genuinely overpriced — or it can mean the market expects much faster growth, which changes what a \"fair\" multiple even looks like.\n\nComparing a P/E across two completely different sectors is a classic beginner-dressed-as-analyst mistake — a software company and a utility company have structurally different growth and risk profiles, so their \"normal\" P/E ranges are nowhere near the same.",
    tryIt: null,
    checks: [
      {
        prompt: "Company X has a P/E of 40. Its industry average P/E is 15. What's the correct first question?",
        options: [
          "X is obviously overpriced, avoid it",
          "Why is X trading at a premium — faster growth, different accounting, or genuine overvaluation?",
          "P/E doesn't matter for comparing companies",
          "X should be compared to the overall market only",
        ],
        correctIndex: 1,
        explanation: "A large premium isn't automatically wrong — it demands an explanation (growth expectations, accounting differences, or real overvaluation) before you draw a conclusion.",
      },
      {
        prompt: "You compare a software company's P/E of 35 to a utility company's P/E of 15 and conclude the software company is overpriced. What's wrong with that comparison?",
        options: [
          "Nothing, the comparison is valid",
          "Software and utility companies have structurally different growth and risk profiles, so their \"normal\" P/E ranges aren't comparable to begin with",
          "P/E should never be used for software companies",
          "Utilities never have a P/E ratio",
        ],
        correctIndex: 1,
        explanation: "Comparing P/E across fundamentally different sectors is a classic mistake — a fast-growing software company and a slow, stable utility have different baseline \"normal\" multiples, so the comparison alone tells you little.",
      },
      {
        prompt: "A bank's P/E looks reasonable, but you also want to check its price against its book value. Why might P/B matter especially for a financial company?",
        options: [
          "P/B is irrelevant for banks",
          "Financial companies' value is closely tied to their balance sheet assets (loans, securities), making P/B an especially relevant cross-check",
          "P/B only applies to technology companies",
          "P/B and P/E always give an identical read",
        ],
        correctIndex: 1,
        explanation: "For asset-heavy financial companies, book value (the balance sheet's net worth) is often a more meaningful anchor than for, say, a software company whose value is mostly intangible — P/B is a standard complementary check there.",
      },
    ],
  },
  {
    id: "intermediate-03",
    tier: "intermediate",
    order: 3,
    title: "Market structure, briefly",
    body: "Stocks trade on exchanges through market makers who quote a bid (what buyers offer) and an ask (what sellers want) — the gap between them is the spread. A quoted price isn't quite the price you'll get: buying at market means paying the ask, not the midpoint.\n\nThis matters most for thinly-traded stocks, where wide spreads can quietly cost you more than a few cents per share.",
    tryIt: null,
    checks: [
      {
        prompt: "You see a stock quoted at $50.00 bid / $50.05 ask. If you buy at market price right now, roughly what do you pay?",
        options: ["$50.00", "$50.05", "$50.025 exactly, no more", "It's random"],
        correctIndex: 1,
        explanation: "A market buy order fills at the ask — the price sellers are currently willing to accept.",
      },
      {
        prompt: "You want to sell a stock right now at market price, quoted $50.00 bid / $50.05 ask. What price do you actually receive?",
        options: ["$50.05, the ask", "$50.00, the bid — the price buyers are currently willing to pay", "$50.025, the midpoint", "Whatever price you name"],
        correctIndex: 1,
        explanation: "A market sell order fills at the bid — the price buyers are currently offering — the mirror image of a market buy filling at the ask.",
      },
      {
        prompt: "A thinly-traded small stock shows a $10.00 bid / $10.40 ask — a much wider spread than a heavily-traded large-cap. What does that wide spread cost you?",
        options: [
          "Nothing — spread never affects your actual return",
          "A real, immediate cost: buying and quickly reselling would lose roughly the spread's worth even with no price movement at all",
          "It means the stock is guaranteed to go up",
          "Wide spreads only exist for options, not stocks",
        ],
        correctIndex: 1,
        explanation: "A wide bid-ask spread is a real transaction cost — buying at the ask and selling at the bid loses that gap's worth of value even if the \"true\" price never moves, which matters most for thinly-traded names.",
      },
    ],
  },
  {
    id: "intermediate-04",
    tier: "intermediate",
    order: 4,
    title: "Building an actual diversified portfolio",
    body: "True diversification is about correlation, not just \"different companies.\" Two stocks in different industries can still move together if they share the same underlying economic sensitivity — this is the mistake this module exists to prevent.\n\nChecking real correlation between holdings, not just eyeballing that the tickers look different, is the difference between a portfolio that's actually diversified and one that only looks that way on paper.",
    tryIt: { label: "Portfolio Tracker · Correlation Finder" },
    checks: [
      {
        prompt: "You own stock in 3 different airlines. Are you well-diversified?",
        options: [
          "Yes, 3 different companies is diversified",
          "No — they're likely highly correlated since they share the same industry risks",
          "Diversification only matters with 10+ holdings",
          "Airlines are always uncorrelated with each other",
        ],
        correctIndex: 1,
        explanation: "Same industry usually means shared exposure to fuel costs, travel demand, and labor costs — 3 tickers, one real risk factor.",
      },
      {
        prompt: "Which pair is more likely to be genuinely diversifying against each other: (a) a grocery chain and a regional bank, or (b) two regional banks in the same state?",
        options: [
          "(b), since both are banks and therefore safer",
          "(a), since a grocery chain and a bank are exposed to fairly different economic risks, while two same-state banks likely share local economic and interest-rate exposure",
          "They're equally diversifying",
          "Neither pair is ever diversifying",
        ],
        correctIndex: 1,
        explanation: "Two banks in the same region likely share overlapping exposure to local economic conditions and interest-rate sensitivity — a grocery chain's risks are meaningfully different, which is what real diversification is chasing.",
      },
      {
        prompt: "Two of your holdings show a correlation of 0.95. What does that number tell you?",
        options: [
          "They're almost completely uncorrelated — great diversification",
          "They move together almost in lockstep — holding both provides very little diversification benefit",
          "One causes the other's price to move",
          "Correlation of 0.95 means a 95% chance of profit",
        ],
        correctIndex: 1,
        explanation: "Correlation runs from -1 (move perfectly opposite) to +1 (move perfectly together) — 0.95 is very close to lockstep, meaning holding both barely reduces portfolio risk versus holding just one.",
      },
    ],
  },
  {
    id: "intermediate-05",
    tier: "intermediate",
    order: 5,
    title: "Macro basics: rates, the Fed, the yield curve",
    body: "The Federal Reserve sets short-term interest rates, which ripples through borrowing costs across the whole economy. Higher rates mean future cash flows are discounted more heavily when valuing a company — so growth stocks, whose value depends heavily on earnings far in the future, are typically hit hardest when rates rise.\n\nThe yield curve (the relationship between short- and long-term Treasury yields) is one of the most closely watched macro signals precisely because an inverted curve has preceded most U.S. recessions historically.",
    tryIt: { label: "Top-Down Economic Analysis · Macro" },
    checks: [
      {
        prompt: "The Fed raises interest rates. All else equal, what typically happens to the present value of a company's far-future expected earnings?",
        options: ["It rises", "It falls, since future cash flows are discounted at a higher rate", "No effect", "It becomes infinite"],
        correctIndex: 1,
        explanation: "Higher discount rates reduce the present value of cash flows expected far in the future — which is why growth stocks are especially rate-sensitive.",
      },
      {
        prompt: "The Fed raises rates sharply. Which type of stock is typically hit harder: a high-growth company whose profits are expected mostly in 10+ years, or a stable company generating most of its profit today?",
        options: [
          "The stable, near-term-profit company",
          "The high-growth company, since more of its value depends on cash flows far in the future, which get discounted more heavily",
          "Neither is affected by interest rates",
          "Both are affected identically",
        ],
        correctIndex: 1,
        explanation: "Discounting hits distant cash flows harder than near-term ones — a growth stock's value leans heavily on profits expected years out, making it more rate-sensitive than a company already generating most of its profit now.",
      },
      {
        prompt: "The yield curve inverts — short-term Treasury yields rise above long-term yields. What has this historically tended to precede?",
        options: [
          "A guaranteed stock market rally",
          "Most U.S. recessions, though it's a historical pattern, not a certainty",
          "Nothing — the yield curve has no track record as a signal",
          "An immediate return to normal rates",
        ],
        correctIndex: 1,
        explanation: "An inverted yield curve has preceded most U.S. recessions historically, which is why it's one of the most closely watched macro signals — though \"historically preceded\" isn't the same as a guaranteed forecast.",
      },
    ],
  },
  {
    id: "intermediate-06",
    tier: "intermediate",
    order: 6,
    title: "Sector rotation",
    body: "Different sectors historically lead at different points in the economic cycle. Defensive sectors — consumer staples, utilities, healthcare — tend to hold up better in a slowdown because demand for their products doesn't disappear in a recession. Cyclical sectors — consumer discretionary, homebuilders, industrials — tend to lead coming out of one.\n\nThis isn't a rigid rulebook, but understanding the pattern is what separates \"the market is down\" from \"the market is rotating.\"",
    tryIt: { label: "Top-Down Economic Analysis · Sector" },
    checks: [
      {
        prompt: "The economy is entering a recession. Which sector has historically tended to hold up better?",
        options: ["Consumer discretionary (luxury goods)", "Consumer staples (groceries, household basics)", "Homebuilders", "Airlines"],
        correctIndex: 1,
        explanation: "People keep buying groceries and basics in a downturn in a way they don't keep buying luxury goods or new homes — that demand stability is what makes staples defensive.",
      },
      {
        prompt: "The economy is showing early signs of recovery after a recession. Which sector has historically tended to lead first?",
        options: [
          "Consumer staples, since people never stop buying groceries",
          "Cyclical sectors like consumer discretionary and industrials, which benefit as spending and production pick back up",
          "Utilities, since electricity demand is constant",
          "Healthcare, since illness doesn't follow the economic cycle",
        ],
        correctIndex: 1,
        explanation: "Cyclical sectors — the ones most tied to discretionary spending and production — have historically tended to lead coming out of a downturn, the mirror image of defensives holding up better going into one.",
      },
      {
        prompt: "During a recession, a grocery chain's earnings barely move while a luxury car maker's earnings fall sharply. What does this illustrate?",
        options: [
          "Grocery chains are always better investments",
          "The defensive-vs-cyclical distinction: demand for necessities is stable across the cycle, demand for discretionary/luxury goods is not",
          "Car makers never recover from a recession",
          "Earnings have nothing to do with sector classification",
        ],
        correctIndex: 1,
        explanation: "This is the defensive-vs-cyclical pattern in action — staples-type demand holds steady regardless of the economy, while discretionary/luxury demand swings much harder with it.",
      },
    ],
  },
  {
    id: "intermediate-07",
    tier: "intermediate",
    order: 7,
    title: "Reading a chart without superstition",
    body: "Support and resistance aren't magic lines — they represent real clusters of buy or sell orders at prices where enough market participants previously acted. A stock that keeps bouncing at $40 is showing you that real demand has repeatedly shown up there, not that $40 has some mystical property.\n\nVolume confirms or undermines a price move: a breakout on heavy volume reflects real conviction; the same move on thin volume is easier to dismiss.",
    tryIt: { label: "Trading Analysis · Charts" },
    checks: [
      {
        prompt: "A stock keeps bouncing off $40 every time it drops there, then rising. What does $40 likely represent?",
        options: [
          "A random coincidence with no meaning",
          "A support level — real buy orders tend to cluster there",
          "A guaranteed floor that can never break",
          "The company's book value",
        ],
        correctIndex: 1,
        explanation: "Support reflects a real pattern of buying interest at that price — useful information, but never a guarantee the level holds next time.",
      },
      {
        prompt: "A stock has tried and failed to rise above $75 three separate times over the past few months. What does $75 likely represent?",
        options: ["A support level", "A resistance level — a price where real sell orders have repeatedly clustered", "A random number with no significance", "A guaranteed ceiling the stock can never cross"],
        correctIndex: 1,
        explanation: "Resistance is the mirror image of support — a price where selling interest has repeatedly shown up, worth noting as real information, never treated as an unbreakable ceiling.",
      },
      {
        prompt: "A stock breaks above its $75 resistance level, but on unusually light trading volume. How should that affect your confidence in the breakout?",
        options: [
          "Full confidence — any breakout is equally meaningful",
          "Lower confidence — light volume suggests weaker conviction behind the move, easier to reverse than a heavy-volume breakout",
          "Volume never matters for chart reading",
          "Light volume always means the breakout will fail",
        ],
        correctIndex: 1,
        explanation: "Volume is what separates a conviction-backed move from a thin, easily-reversed one — the same breakout on heavy volume is generally read as more meaningful than on light volume.",
      },
    ],
  },
  {
    id: "intermediate-08",
    tier: "intermediate",
    order: 8,
    title: "Why \"backtested\" isn't proof",
    body: "A strategy that wins 9 of 10 trades sounds convincing — until you realize 10 trades is nowhere near enough to distinguish a real, repeatable edge from a lucky streak. Real statistical evaluation requires a large enough sample, correction for testing many ideas at once, and confirmation that the pattern holds on data it wasn't built on.\n\nThis is the exact discipline this app's own backtest engines are built around — every result reports its sample size honestly, specifically because that number is the difference between a signal and noise.",
    tryIt: { label: "Trading Analysis · Backtest" },
    checks: [
      {
        prompt: "A strategy shows a 90% win rate over 10 trades. How much should that convince you it's a real edge?",
        options: [
          "Completely — 90% is 90%",
          "Very little — 10 trades is far too small a sample to distinguish a real edge from luck",
          "It proves the strategy works forever",
          "Sample size doesn't matter if the win rate is high enough",
        ],
        correctIndex: 1,
        explanation: "Small samples can easily produce an impressive-looking win rate by chance — real confidence needs a much larger, statistically evaluated sample.",
      },
      {
        prompt: "The same strategy that showed a 90% win rate over 10 trades is retested over 500 trades and the win rate settles at 54%. What does this illustrate?",
        options: [
          "The strategy got worse over time",
          "The original 10-trade sample was too small to reveal the strategy's real, more modest edge — larger samples give a truer picture",
          "500 trades is still too small to trust",
          "Win rate is meaningless regardless of sample size",
        ],
        correctIndex: 1,
        explanation: "This is exactly why small samples mislead — 10 trades can easily produce a flattering result by chance, while a much larger sample converges toward the strategy's real, often less impressive, edge.",
      },
      {
        prompt: "A trading rule is tuned using years of historical data until it performs great specifically on that data, then never tested on any other period. What's the risk?",
        options: [
          "There's no risk — good historical performance is proof enough",
          "Overfitting — the rule may just be memorizing quirks of that specific dataset rather than capturing a real, repeatable pattern",
          "The rule is guaranteed to work forever once it fits historical data well",
          "This is exactly the right way to build a trading strategy",
        ],
        correctIndex: 1,
        explanation: "A rule tuned tightly to one historical dataset with no out-of-sample check risks overfitting — looking great on the data it was built from while capturing noise rather than a real, repeatable edge.",
      },
    ],
  },
  {
    id: "intermediate-09",
    tier: "intermediate",
    order: 9,
    title: "Options, before the Greeks",
    body: "A call option is a bet that a stock will rise above a certain price (the strike) before a certain date. A put option is the mirror image — a bet the stock falls below the strike. Both come with an expiration date, after which the option is worthless if the bet didn't pay off.\n\nThis module deliberately stops before the Greeks (delta, gamma, theta, vega) — those come in the Expert tier. For now, the shape of the payoff is the important part.",
    tryIt: null,
    checks: [
      {
        prompt: "You buy a call option on a stock. What are you betting on?",
        options: [
          "The stock price falling",
          "The stock price rising above the strike price before expiration",
          "The company going bankrupt",
          "Nothing — calls have no directional bet",
        ],
        correctIndex: 1,
        explanation: "A call profits when the stock rises above the strike price before expiration — the mirror image of a put, which profits on a decline.",
      },
      {
        prompt: "You buy a put option on a stock. What are you betting on?",
        options: [
          "The stock price rising above the strike price",
          "The stock price falling below the strike price before expiration",
          "The company issuing a dividend",
          "Puts have no directional bet, unlike calls",
        ],
        correctIndex: 1,
        explanation: "A put profits when the stock falls below the strike price before expiration — the mirror image of a call, which profits on a rise.",
      },
      {
        prompt: "You hold a call option with a strike price of $100. At expiration, the stock is trading at $95. What happens to your option?",
        options: [
          "It's automatically exercised and you buy the stock at $100 anyway",
          "It expires worthless, since the stock never rose above the strike",
          "You're paid the difference in cash regardless of the stock price",
          "The option's expiration date automatically extends",
        ],
        correctIndex: 1,
        explanation: "A call only has value if the stock is above the strike price — at $95 against a $100 strike, there's no reason to exercise it, so it simply expires worthless.",
      },
    ],
  },
  {
    id: "intermediate-10",
    tier: "intermediate",
    order: 10,
    title: "The biases that wreck a good plan",
    body: "Loss aversion (the disposition effect, specifically) shows up as selling winners too early to lock in a good feeling, while holding losers far too long hoping they'll come back — the exact opposite of a disciplined \"cut losses, let winners run\" approach. Recency bias means overweighting whatever just happened, assuming a recent trend will continue indefinitely.\n\nFor most intermediate investors, these biases — not a lack of market knowledge — are the single biggest source of avoidable underperformance.",
    tryIt: null,
    checks: [
      {
        prompt: "You sell a losing stock quickly to \"stop the pain,\" but hold a winning stock far too long hoping for more. What bias is this closest to?",
        options: ["Recency bias", "Loss aversion / disposition effect", "Confirmation bias", "Anchoring"],
        correctIndex: 1,
        explanation: "This asymmetric treatment of gains and losses — quick to sell winners, slow to sell losers — is the textbook disposition effect, rooted in loss aversion.",
      },
      {
        prompt: "A stock has risen for 6 straight months, and an investor assumes it will \"obviously\" keep rising forever, ignoring any signs of slowing. What bias is this?",
        options: ["Loss aversion", "Recency bias — overweighting a recent trend as if it will continue indefinitely", "Anchoring", "The disposition effect"],
        correctIndex: 1,
        explanation: "Recency bias is exactly this pattern — extrapolating a recent trend forward as though it's guaranteed to continue, rather than weighing the full range of outcomes.",
      },
      {
        prompt: "An investor who already owns a stock only reads articles that praise the company and dismisses every negative report as \"fake news.\" What bias is this?",
        options: ["Recency bias", "Confirmation bias — seeking out and favoring information that supports a belief you already hold, while dismissing what contradicts it", "Loss aversion", "Anchoring"],
        correctIndex: 1,
        explanation: "Confirmation bias shows up exactly this way — selectively favoring evidence that confirms an existing position and discounting evidence against it, which can blind an investor to real warning signs.",
      },
    ],
  },

  // ---------- EXPERT ----------
  {
    id: "expert-01",
    tier: "expert",
    order: 1,
    title: "Options Greeks and dealer positioning",
    body: "Delta, gamma, theta, and vega describe how an option's value responds to the underlying price, the rate of that response, time decay, and volatility, respectively. Aggregated across an entire options chain, these describe how options dealers — who are usually on the other side of customer trades — are positioned.\n\nWhen dealers are net short gamma, their hedging tends to amplify price moves (sell into declines, buy into rallies, to stay hedged). When they're net long gamma, hedging tends to dampen moves. This mechanism is what this app's GEX signal is built to surface.",
    tryIt: { label: "Options · GEX & Dealer Positioning" },
    checks: [
      {
        prompt: "Dealers are net short gamma on a stock. As the price falls, what does their hedging typically do to that move?",
        options: [
          "Dampens it (they buy dips to stay hedged)",
          "Amplifies it (they must sell into the decline to stay hedged)",
          "Has no effect on price",
          "Only affects the options market, never the stock",
        ],
        correctIndex: 1,
        explanation: "Short-gamma dealers must trade in the same direction as the move to stay hedged — selling into a decline, buying into a rally — which can amplify the move.",
      },
      {
        prompt: "Dealers are net long gamma on a stock. As the price rises, what does their hedging typically do to that move?",
        options: [
          "Amplifies it, by buying into the rally",
          "Dampens it — long-gamma dealers tend to sell into a rally and buy into a decline to stay hedged, working against the move",
          "Has no effect on price",
          "Long gamma only matters for puts, not calls",
        ],
        correctIndex: 1,
        explanation: "Long-gamma dealers hedge in the opposite direction of the move — selling as price rises, buying as it falls — which tends to dampen volatility, the mirror image of the short-gamma amplification case.",
      },
      {
        prompt: "An option loses value every day purely from the passage of time, even if the stock price doesn't move at all. Which Greek describes this?",
        options: ["Delta", "Gamma", "Theta — time decay", "Vega"],
        correctIndex: 2,
        explanation: "Theta measures an option's rate of value decay purely from time passing, holding everything else constant — it's why option buyers are effectively fighting a clock, not just a price direction.",
      },
    ],
  },
  {
    id: "expert-02",
    tier: "expert",
    order: 2,
    title: "Portfolio theory in depth",
    body: "The Sharpe ratio measures return earned per unit of risk taken — expected return minus the risk-free rate, divided by volatility. A higher Sharpe ratio means a portfolio delivered more return for the risk it carried, not just more return in absolute terms.\n\nThe efficient frontier is the set of portfolios offering the best possible expected return for each level of risk — everything below it is leaving return on the table for the risk being taken.",
    tryIt: { label: "Portfolio Tracker · Modern Portfolio Theory" },
    checks: [
      {
        prompt: "Two portfolios have the same expected return, but Portfolio A has lower volatility. Which has the higher Sharpe ratio?",
        options: ["Portfolio B (higher volatility)", "Portfolio A (lower volatility)", "They're always equal", "Sharpe ratio doesn't use volatility"],
        correctIndex: 1,
        explanation: "Same return, less risk taken to get it — that's a strictly better risk-adjusted outcome, which the Sharpe ratio is built to capture.",
      },
      {
        prompt: "A portfolio sits well below the efficient frontier. What does that mean?",
        options: [
          "It has the best possible risk-adjusted return available",
          "For the risk it's taking, a portfolio on the frontier could offer a higher expected return — it's leaving return on the table",
          "It has zero risk",
          "The efficient frontier doesn't apply to real portfolios",
        ],
        correctIndex: 1,
        explanation: "The efficient frontier represents the best expected-return-per-unit-of-risk achievable — a portfolio below it is taking on risk without being compensated as well as it could be for that same risk level.",
      },
      {
        prompt: "Portfolio A returns 12% with 20% volatility; Portfolio B returns 9% with 10% volatility (risk-free rate 2%). Which likely has the higher Sharpe ratio?",
        options: [
          "Portfolio A (0.50 vs Portfolio B's 0.70)",
          "Portfolio B — despite the lower raw return, its Sharpe ratio (0.70) is higher than A's (0.50) because it earned more return per unit of risk taken",
          "They're identical",
          "Sharpe ratio can't be compared across different portfolios",
        ],
        correctIndex: 1,
        explanation: "Sharpe ratio = (return − risk-free rate) ÷ volatility. A: (12−2)/20 = 0.50. B: (9−2)/10 = 0.70 — B delivered more return per unit of risk, even though its raw return was lower.",
      },
    ],
  },
  {
    id: "expert-03",
    tier: "expert",
    order: 3,
    title: "Evaluating a strategy like a statistician",
    body: "Testing many trading signals at once and reporting only the one that looks significant is a classic multiple-comparisons trap — with enough tests, some will look significant purely by chance. Correction methods like Benjamini-Hochberg FDR adjust the bar for significance based on how many things you tested.\n\nOut-of-sample testing (checking whether a pattern holds on data it wasn't built on) and overfitting (a strategy tuned so precisely to historical data that it fails on new data) are the other two pillars of taking a backtest seriously.",
    tryIt: { label: "Glossary · Statistics terms" },
    checks: [
      {
        prompt: "You test 20 different trading signals and 1 comes back statistically significant at p<0.05. Should you trust it as a real edge?",
        options: [
          "Yes, p<0.05 is p<0.05",
          "Be skeptical — testing 20 signals means you'd expect about 1 false positive by chance alone",
          "No correction is ever needed for multiple tests",
          "p-values don't apply to trading strategies",
        ],
        correctIndex: 1,
        explanation: "This is exactly what FDR correction exists to guard against — at a 5% significance threshold, roughly 1 in 20 tests will look significant purely by chance.",
      },
      {
        prompt: "A strategy performs great on 2015-2020 data. Before trusting it, what's the key next step?",
        options: [
          "Deploy it immediately with real money",
          "Test it on a separate period it wasn't built or tuned on (out-of-sample) to see if the pattern holds up on new data",
          "Nothing further is needed — the historical result is sufficient proof",
          "Re-run the exact same test on the exact same 2015-2020 data again",
        ],
        correctIndex: 1,
        explanation: "Out-of-sample testing — checking whether a pattern holds on data it wasn't built or tuned on — is the standard next step to distinguish a real, repeatable edge from a strategy that was simply fit to noise in one period.",
      },
      {
        prompt: "Why does testing many signals at once require a stricter significance bar (like FDR correction) than testing just one?",
        options: [
          "It doesn't — one signal and many signals should use the same bar",
          "Testing more signals increases the chance that at least one looks significant purely by chance, so the bar needs to adjust upward to compensate",
          "More signals always means more reliable results with no adjustment needed",
          "FDR correction is only used in medicine, not finance",
        ],
        correctIndex: 1,
        explanation: "The more signals you test, the more opportunities for a false positive to slip through by pure chance — FDR-style correction raises the bar for significance in proportion to how many tests were run, to keep the false-positive rate honest.",
      },
    ],
  },
  {
    id: "expert-04",
    tier: "expert",
    order: 4,
    title: "Macro-to-position synthesis, cross-asset",
    body: "Fiscal and monetary policy don't just move stocks — they thread through currencies, commodities, and rates with different mechanics in each. A stronger dollar (often driven by relatively higher U.S. rates) tends to pressure globally-priced, dollar-denominated commodities lower, since it takes fewer dollars to buy the same physical amount.\n\nUnderstanding these cross-asset transmission mechanisms — not just \"rates went up, stocks went down\" — is what separates genuine macro analysis from headline reaction.",
    tryIt: { label: "Currency / Futures / Commodities tabs" },
    checks: [
      {
        prompt: "The dollar strengthens sharply due to Fed policy. All else equal, what's the typical initial pressure on dollar-denominated commodities like oil and gold?",
        options: [
          "Upward pressure, since a strong dollar makes commodities more attractive",
          "Downward pressure, since it takes fewer dollars to buy the same amount of a globally-priced commodity",
          "No relationship exists",
          "Commodities always move with the dollar, not against it",
        ],
        correctIndex: 1,
        explanation: "Commodities priced in dollars get more expensive in other currencies when the dollar strengthens, typically pressuring dollar-priced demand and price lower.",
      },
      {
        prompt: "The dollar weakens sharply. All else equal, what's the typical initial effect on dollar-denominated commodities like oil and gold?",
        options: [
          "Downward pressure, mirroring a strong dollar's effect",
          "Upward pressure — it takes more dollars to buy the same globally-priced amount, which can support higher dollar-denominated prices",
          "No relationship exists",
          "Commodities are unaffected by currency moves",
        ],
        correctIndex: 1,
        explanation: "This is the mirror image of the strong-dollar case — a weaker dollar means the same physical quantity of a globally-priced commodity now costs more in dollar terms, typically supporting higher dollar-denominated prices.",
      },
      {
        prompt: "The U.S. raises interest rates while other major economies hold theirs steady. All else equal, what does this rate differential typically do to the dollar?",
        options: [
          "Weakens it, since higher rates make borrowing more expensive",
          "Tends to strengthen it — higher relative U.S. rates make dollar-denominated assets more attractive to global capital seeking yield",
          "Has no effect on currency valuation",
          "Only affects bond prices, never currencies",
        ],
        correctIndex: 1,
        explanation: "Higher relative interest rates tend to attract capital seeking yield, increasing demand for the currency offering it — a core mechanism behind how rate differentials move currency valuations.",
      },
    ],
  },
  {
    id: "expert-05",
    tier: "expert",
    order: 5,
    title: "Market microstructure",
    body: "Liquidity isn't constant throughout the day or across stocks — it's thin in the pre-market, thin in thinly-traded names, and thick at the open and close of a liquid large-cap. A large order hitting a thin order book moves the price more than the same order hitting a deep one, simply because there are fewer resting orders to absorb it.\n\nThis app is explicit about where it can't verify microstructure claims — no tick-level or order-book data is available at this budget tier, so anything beyond descriptive, snapshot-level signals (like same-day options volume/OI) stays out of scope rather than being faked.",
    tryIt: null,
    checks: [
      {
        prompt: "A large sell order hits a stock with thin order-book liquidity at that moment. Compared to hitting during a liquid, high-volume window, what's more likely?",
        options: [
          "Identical price impact regardless of liquidity",
          "A larger price impact / slippage, since there are fewer resting orders to absorb it",
          "No price impact ever, since price is 'set' by the exchange",
          "Liquidity only matters for options, not stocks",
        ],
        correctIndex: 1,
        explanation: "Thin liquidity means fewer orders sitting at nearby prices to absorb a large trade, so the same order size moves the price further.",
      },
      {
        prompt: "A large order is placed in the pre-market session versus the same size order placed during the 9:30-10:00am opening window. Which is more likely to move the price further?",
        options: [
          "The 9:30-10:00am order, since more people are watching",
          "The pre-market order, since liquidity is typically much thinner outside regular trading hours, meaning fewer resting orders to absorb it",
          "Both have identical impact regardless of timing",
          "Pre-market sessions have no liquidity at all, so no trades are possible",
        ],
        correctIndex: 1,
        explanation: "Liquidity isn't constant throughout the day — it's characteristically thin in the pre-market and thickest around the open/close of regular trading, so the same order size can move price much more when liquidity is thin.",
      },
      {
        prompt: "This app has no tick-level or order-book data source. How does it handle claims that would require that kind of data?",
        options: [
          "It fabricates plausible-looking numbers to fill the gap",
          "It stays out of scope on anything beyond descriptive, snapshot-level signals it can actually verify, rather than faking microstructure claims",
          "It ignores the issue and presents estimates as if they were real data",
          "It uses a different, less accurate provider instead",
        ],
        correctIndex: 1,
        explanation: "This app is explicit about the boundary of what it can verify — genuine tick-level/order-book claims stay out of scope entirely rather than being approximated and presented as real.",
      },
    ],
  },
  {
    id: "expert-06",
    tier: "expert",
    order: 6,
    title: "Deep-value methodology",
    body: "Benjamin Graham's Net Current Asset Value (NCAV) approach values a company against current assets minus all liabilities — deliberately ignoring long-term/fixed assets and goodwill entirely. It's a conservative, liquidation-style floor: what would be left for shareholders if the company were wound down today, using only the most liquid assets.\n\nThis app's Graham Checklist implements the full 7-criteria version of this methodology, and deliberately excludes analyst price targets — not as an oversight, but because forecasting isn't part of Graham's method.",
    tryIt: { label: "Security Analysis · full Checklist" },
    checks: [
      {
        prompt: "What does Graham's NCAV approach deliberately exclude from a company's valuation?",
        options: [
          "Current liabilities",
          "Long-term/fixed assets and goodwill — it's a conservative, liquidation-style floor",
          "Current assets",
          "Cash on the balance sheet",
        ],
        correctIndex: 1,
        explanation: "NCAV is deliberately conservative — it only counts current assets against all liabilities, ignoring long-term assets and goodwill that might not hold their value in a real liquidation.",
      },
      {
        prompt: "Why is Graham's NCAV approach described as a conservative 'liquidation-style floor' rather than a full valuation?",
        options: [
          "Because it counts every asset the company owns at full value",
          "Because it only credits the most liquid current assets against all liabilities, deliberately ignoring assets that might not hold their value if the company were actually wound down",
          "Because it always produces a higher value than other valuation methods",
          "NCAV isn't actually conservative — it's the most aggressive valuation method",
        ],
        correctIndex: 1,
        explanation: "NCAV deliberately strips out long-term/fixed assets and goodwill — the assets least certain to retain their book value in an actual liquidation — leaving a conservative floor rather than a full going-concern valuation.",
      },
      {
        prompt: "This app's Graham Checklist deliberately excludes analyst price targets. Why?",
        options: [
          "Analyst price targets are illegal to use",
          "Forecasting isn't part of Graham's method — it's built around present, verifiable financial facts, not forward guesses about where a price might go",
          "Analyst targets are always wrong",
          "There's no reason — it's simply an oversight",
        ],
        correctIndex: 1,
        explanation: "Graham's method is deliberately grounded in current, verifiable facts about a business — forecasting future prices was never part of the approach, so this app's checklist stays consistent with that by excluding forward price targets.",
      },
    ],
  },
  {
    id: "expert-07",
    tier: "expert",
    order: 7,
    title: "Portfolio-level risk management",
    body: "Hedging a concentrated position doesn't require selling it — a protective put, for instance, caps downside on a held position while leaving upside intact (minus the cost of the hedge). Real risk management is a sizing discipline: how much protection, at what cost, against how much of the position.\n\nDrawdown management — actively limiting how far a portfolio falls from its peak — matters because recovering from a large drawdown requires a disproportionately larger gain (a 50% loss needs a 100% gain just to break even).",
    tryIt: { label: "Portfolio Tracker · Risk & Rebalancing" },
    checks: [
      {
        prompt: "You hold a concentrated position and want to limit downside without selling. What's the direct hedging tool for that?",
        options: [
          "Buying more of the same stock",
          "Buying a protective put (or similar) on the position",
          "Ignoring it since diversification isn't needed",
          "Switching to a savings account",
        ],
        correctIndex: 1,
        explanation: "A protective put caps downside risk on a held position while leaving the position itself — and its upside — intact.",
      },
      {
        prompt: "A portfolio falls 50% from its peak. How much of a gain is needed just to get back to breakeven?",
        options: ["50%", "100% — recovering from a large loss requires a disproportionately larger percentage gain", "25%", "It automatically recovers over time with no gain needed"],
        correctIndex: 1,
        explanation: "Losses and the gains needed to recover from them aren't symmetric — a $100 position that falls 50% to $50 needs a 100% gain just to get back to $100, exactly why limiting large drawdowns matters so much.",
      },
      {
        prompt: "A protective put caps downside risk on a held position. What's the direct tradeoff for that protection?",
        options: [
          "There is no tradeoff — protective puts are free",
          "The cost of buying the put (the premium), which reduces net returns if the stock doesn't fall",
          "You permanently give up the ability to sell the stock",
          "It doubles your position size automatically",
        ],
        correctIndex: 1,
        explanation: "Buying a protective put isn't free — its premium is a real cost that eats into returns if the downside protection ends up not being needed, the standard tradeoff of any insurance-like hedge.",
      },
    ],
  },
  {
    id: "expert-08",
    tier: "expert",
    order: 8,
    title: "Building a full top-down thesis",
    body: "The capstone module: a real investment thesis connects macro/fiscal backdrop, sector positioning, and company-level fundamentals and technicals into one coherent, falsifiable argument — not any single layer in isolation. A cheap P/E means nothing if the sector is structurally declining; a great macro backdrop means nothing for a company with deteriorating fundamentals.\n\nThis is the exact chain this app's planned assistant is meant to walk when asked \"should I buy this\" — presenting what each real layer of data shows, not issuing a directive.",
    tryIt: null,
    checks: [
      {
        prompt: "You're evaluating whether a defense-sector stock is attractive right now. Which single fact, alone, is enough to decide?",
        options: [
          "The stock's P/E ratio alone",
          "No single layer alone — a real thesis connects macro/geopolitical backdrop, sector read, and company fundamentals together",
          "Whatever a friend recommended",
          "The stock's 1-day price change",
        ],
        correctIndex: 1,
        explanation: "A real thesis is a synthesis across layers — no single number, however important, substitutes for connecting macro, sector, and company-level evidence.",
      },
      {
        prompt: "A sector has a highly favorable macro backdrop right now, but the specific company you're evaluating has deteriorating margins and rising debt. Is a favorable sector macro read enough to make the stock attractive?",
        options: [
          "Yes — macro backdrop alone always determines whether a stock is a good buy",
          "No — a real thesis has to connect macro, sector, and company-level fundamentals together; a great macro read doesn't offset genuinely deteriorating company fundamentals",
          "Company fundamentals never matter if the sector is strong",
          "This scenario is impossible — macro and company fundamentals always move together",
        ],
        correctIndex: 1,
        explanation: "This is exactly the trap a top-down thesis guards against — a favorable macro or sector backdrop doesn't rescue a company whose own fundamentals are genuinely deteriorating; all three layers have to line up.",
      },
      {
        prompt: "When this app's assistant is asked \"should I buy this stock,\" what is it built to do?",
        options: [
          "Issue a direct buy or sell recommendation",
          "Walk the real top-down chain — presenting what macro, sector, and company-level data actually show — without issuing a directive",
          "Refuse to answer entirely",
          "Guess based on the stock's recent price action alone",
        ],
        correctIndex: 1,
        explanation: "The assistant is built to run the same top-down synthesis a real thesis requires — presenting the real data at each layer — while stopping short of a buy/sell directive, matching this app's consistent boundary against giving personalized investment advice.",
      },
    ],
  },
];

export const PLACEMENT_QUESTIONS: PlacementQuestion[] = [
  // Beginner probes
  {
    tier: "beginner",
    prompt: "If inflation runs higher than the interest rate your savings account pays, what's happening to your money's real value over time?",
    options: ["Growing faster than prices", "Losing purchasing power even though the balance grows", "Completely protected", "Doubling every year"],
    correctIndex: 1,
  },
  {
    tier: "beginner",
    prompt: "What does it mean to diversify a portfolio?",
    options: [
      "Put all your money in the single best stock you can find",
      "Spread investments across different assets so one bad outcome doesn't sink you",
      "Only invest in your employer's stock",
      "Keep everything in cash",
    ],
    correctIndex: 1,
  },
  {
    tier: "beginner",
    prompt: "Which of these is generally considered \"good debt\" in most financial literacy frameworks?",
    options: ["A payday loan at 300% APR", "A mortgage on a home you can afford, at a reasonable rate", "Maxing out a credit card for a vacation", "All debt is equally bad"],
    correctIndex: 1,
  },
  // Intermediate probes
  {
    tier: "intermediate",
    prompt: "A stock's P/E ratio is 40 while its industry average is 15. On its own, what does that tell you?",
    options: [
      "The stock is definitely a bad investment",
      "Not much by itself — it needs context like growth rate or industry norms before it means anything",
      "The company is guaranteed to grow 40% next year",
      "P/E ratios are meaningless",
    ],
    correctIndex: 1,
  },
  {
    tier: "intermediate",
    prompt: "Why might two companies in totally different industries still be highly correlated in a portfolio?",
    options: [
      "That's impossible if industries differ",
      "They can share the same broad market/economic sensitivity even in different industries",
      "Correlation only applies within the same industry",
      "Correlation doesn't apply to individual stocks",
    ],
    correctIndex: 1,
  },
  {
    tier: "intermediate",
    prompt: "A backtest shows a trading strategy worked great over the last 8 occurrences. What's most important to check before trusting it?",
    options: [
      "Nothing, 8 wins is convincing",
      "Whether the sample size is large enough and whether it holds up out-of-sample",
      "How much money you'd have made",
      "Whether the chart looks nice",
    ],
    correctIndex: 1,
  },
  // Expert probes
  {
    tier: "expert",
    prompt: "Dealers holding negative (short) gamma on a large options position are hedging. What does that typically do to realized volatility in the underlying?",
    options: ["Dampens it", "Can amplify it, since they must trade in the same direction as the move to stay hedged", "Has zero effect on the underlying", "Only matters at options expiration"],
    correctIndex: 1,
  },
  {
    tier: "expert",
    prompt: "You run 15 separate statistical tests looking for a trading edge and one comes back significant at p<0.05. What should you immediately be worried about?",
    options: [
      "Nothing, it's significant",
      "A false positive from multiple comparisons — roughly 1 in 20 tests looks significant by chance alone",
      "p-values don't apply to finance",
      "The test is definitely correct since p<0.05",
    ],
    correctIndex: 1,
  },
  {
    tier: "expert",
    prompt: "What does Graham's Net Current Asset Value (NCAV) approach deliberately exclude from a company's valuation?",
    options: ["Current liabilities", "Long-term/fixed assets and goodwill — a conservative, liquidation-style floor", "Current assets", "Cash on the balance sheet"],
    correctIndex: 1,
  },
];

export const GOAL_OPTIONS: GoalOption[] = [
  {
    id: "personal-finance",
    label: "Understand my own money",
    description: "Budgeting, saving, debt, and the basics of building financial security.",
  },
  {
    id: "evaluate-companies",
    label: "Evaluate companies & sectors",
    description: "Read financial statements, judge valuation, and understand what's driving a sector.",
  },
  {
    id: "build-portfolio",
    label: "Build & manage a portfolio",
    description: "Diversification, correlation, risk, and constructing a real portfolio.",
  },
  {
    id: "trade-with-signals",
    label: "Trade with real signals",
    description: "Technical analysis, backtesting rigor, options mechanics, and macro-driven strategy.",
  },
];
