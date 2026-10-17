import type { GoalOption, LiteracyModule, PlacementQuestion } from "../types";

/**
 * Content data file, same pattern as trading-agent/skills/glossary.ts and
 * options-strategies.ts — plain structured data, rendered by
 * FinancialLiteracyTab.tsx. Adapted from the curriculum outline reviewed
 * with the user (see the published project-overview/curriculum artifacts).
 * Each module's "tryIt" points at a real, already-built tab elsewhere in
 * this app — descriptive only for now, not a deep link (no cross-tab
 * navigation API exists yet to jump there directly).
 *
 * Answer keys: the correct option's position is a fixed, balanced sequence
 * per set (not random at runtime) and option lengths are kept comparable, so
 * neither "always pick B" nor "pick the longest" beats chance. This is
 * enforced by scripts/quality/literacy.test.mts. Reading level is tracked by
 * scripts/quality/reading-level.mts (beginner lessons target grade 8 or less).
 */

export const LITERACY_MODULES: LiteracyModule[] = [
  // ---------- BEGINNER ----------
  {
    id: "beginner-01",
    tier: "beginner",
    order: 1,
    title: "What money does",
    body: "Money does three jobs. First, you trade it for things you need. Second, it gives every item a price, so you can compare a pizza to a movie ticket. Third, it stores value, which means it should hold its worth until you spend it.\n\nThe third job is the one that can quietly fail. Inflation is a rise in prices over time. When prices rise, the same cash buys less. Cash in a jar, or in an account that pays almost no interest, loses buying power even though the number stays the same. The rest of this course is about keeping your money working.",
    tryIt: null,
    checks: [
      {
        prompt: "You keep $500 in a jar for 3 years. Prices rise about 4% a year. What happens to what the $500 can buy?",
        options: [
          "It buys more than it did",
          "It buys about the same as before",
          "It buys less than it did",
          "It buys twice as much as before",
        ],
        correctIndex: 2,
        explanation: "The jar still holds $500. But prices rose about 12% over 3 years, so the same $500 buys less.",
      },
      {
        prompt: "A friend says, \"Gas costs $60 and a haircut costs $60, so they cost the same to me.\" Which job of money is this?",
        options: [
          "Trading it for the things that you need to buy",
          "Holding its worth over time",
          "Earning interest while it sits",
          "Giving every item a price to compare",
        ],
        correctIndex: 3,
        explanation: "Comparing two different things with one price is money's second job. Trading cash for goods is the first job. Holding worth over time is the third.",
      },
      {
        prompt: "Your checking account pays 0.1% interest. Prices are rising 3.5% a year. Which job of money is failing?",
        options: [
          "Trading it for things you need",
          "Giving items a price to compare",
          "All three jobs fail equally",
          "Holding its worth over time",
        ],
        correctIndex: 3,
        explanation: "You can still spend the money and still compare prices. What breaks is its power to hold its worth, which is the third job.",
      },
    ],
  },
  {
    id: "beginner-02",
    tier: "beginner",
    order: 2,
    title: "Budgeting without the spreadsheet fear",
    body: "A budget is your income minus your spending, tracked honestly. The 50/30/20 rule is a simple way to start. Put about 50% of your take-home pay toward needs, like rent, food and minimum debt payments. Put about 30% toward wants, which is everything optional. Put about 20% toward savings and extra debt payments.\n\nBuild an emergency fund in steps. This is money set aside for surprises, kept where you can reach it fast. Start with a small cushion, like the $500 goal in a later lesson. Then grow it toward 3 to 6 months of must-pay costs. Without it, a car repair or a lost job can push you into costly debt.",
    tryIt: null,
    checks: [
      {
        prompt: "Your take-home pay is $4,000 a month. Under 50/30/20, how much is for wants?",
        options: [
          "$2,000",
          "$1,200",
          "$800",
          "$400",
        ],
        correctIndex: 1,
        explanation: "30% of $4,000 is $1,200. Needs get 50% and savings get 20%.",
      },
      {
        prompt: "You have no emergency fund, and a $1,200 car repair bill arrives. Where was this money meant to come from?",
        options: [
          "The wants slice, since a repair bill is an optional cost",
          "A payday loan, because that is what they are for",
          "Nowhere, because repairs are not a budget issue",
          "Savings, ideally an emergency fund built earlier",
        ],
        correctIndex: 3,
        explanation: "This is what an emergency fund is for. Without one, surprise costs often end up on a credit card.",
      },
      {
        prompt: "Under 50/30/20, where does a streaming subscription belong?",
        options: [
          "Needs, the 50% slice",
          "Wants, the 30% slice",
          "Savings, the 20% slice",
          "It is not counted anywhere",
        ],
        correctIndex: 1,
        explanation: "A streaming service is optional, so it is a want. Needs are things like rent, groceries and minimum debt payments.",
      },
    ],
  },
  {
    id: "beginner-03",
    tier: "beginner",
    order: 3,
    title: "Debt and credit, honestly",
    body: "APR (annual percentage rate) is the yearly cost of borrowing, shown as a percent. On a loan it can include some fees. On a credit card it leaves out fees like the yearly fee, so add those yourself. Your credit score mostly depends on whether you pay on time and how much of your available credit you use. It changes the rates lenders offer you on cards, car loans and mortgages.\n\nThe minimum payment is a trap. On a card with a high APR, a minimum payment may cover little more than the interest. Then the balance barely drops for months or years.",
    tryIt: null,
    checks: [
      {
        prompt: "You owe $1,000 on a card with a 22% APR and pay only the $25 minimum each month. What is the biggest risk?",
        options: [
          "Interest eats most of each payment, so the debt barely shrinks",
          "Your score jumps up right away because you pay on time",
          "You will pay off the whole balance in about a year",
          "There is no real downside to this, since you pay on time each month",
        ],
        correctIndex: 0,
        explanation: "At 22% APR, about $18 of the first $25 goes to interest. Only about $7 pays down the debt.",
      },
      {
        prompt: "Card A has a 19.99% rate and a $95 yearly fee. Card B has a 21.99% rate and no fee. You will carry $2,000 all year. What should you compare?",
        options: [
          "The yearly interest plus the fee on each card",
          "Only the advertised interest rate",
          "Only which card has the lower yearly fee",
          "Fees only matter if you pay your balance late",
        ],
        correctIndex: 0,
        explanation: "Card A costs about $400 in interest plus the $95 fee, so about $495. Card B costs about $440. The card with the lower rate is the more costly one here.",
      },
      {
        prompt: "You have a $10,000 total credit limit and owe $6,000. That is 60% of your limit. What does it usually do to your credit score?",
        options: [
          "The share of your limit you use does not matter",
          "It tends to lower your score because it is high",
          "It raises your score by itself",
          "It only matters if you miss a payment",
        ],
        correctIndex: 1,
        explanation: "Credit utilization is the share of your limit that you use. After paying on time, how much you owe is one of the biggest score factors. 60% is high.",
      },
    ],
  },
  {
    id: "beginner-04",
    tier: "beginner",
    order: 4,
    title: "Saving and investing are different tools",
    body: "The big question is time. When will you need the money? Money you need within 1 to 3 years, like a down payment, belongs somewhere safe where you can get it fast. You cannot risk it being down 20% right when you need it.\n\nMoney you will not touch for 10 years or more, like retirement savings, can ride out big ups and downs. In return, it can grow much more over time. Two common mistakes are putting short-term money into risky things, and leaving long-term money in cash.",
    tryIt: null,
    checks: [
      {
        prompt: "You need $10,000 for a house down payment in 14 months. Where should it go?",
        options: [
          "A stock fund that might grow faster",
          "Cryptocurrency, for the chance of big gains",
          "A bond that does not mature for 20 years",
          "A high-yield savings account, which is safe and easy to reach",
        ],
        correctIndex: 3,
        explanation: "14 months is too short to risk a market drop. Safety and quick access matter more than growth here.",
      },
      {
        prompt: "You are 30 and keep all your retirement savings in a checking account that pays almost no interest. What is the main mistake?",
        options: [
          "With 30 or more years to go, cash gives up a lot of growth",
          "Checking accounts are the safest choice, so they suit everyone",
          "Retirement money should not be saved at all",
          "It is only a mistake after the age of 50",
        ],
        correctIndex: 0,
        explanation: "A long time frame can handle big swings in return for more growth. Cash gives that growth away.",
      },
      {
        prompt: "What one thing best decides whether money belongs in savings or in investments?",
        options: [
          "How much money you have saved up so far",
          "When you will need the money",
          "Whether you like taking risks",
          "How the stock market did last year",
        ],
        correctIndex: 1,
        explanation: "Money needed soon needs safety and quick access. Money with years ahead of it can handle ups and downs for more growth.",
      },
    ],
  },
  {
    id: "beginner-05",
    tier: "beginner",
    order: 5,
    title: "What a share of stock is",
    body: "A share of stock is a small piece of ownership in a real business. You own a slice of its property, its future profits and its risks. A stock is not a lottery ticket. Some companies pay out part of their profit to owners. That payment is called a dividend.\n\nA stock's price moves every day as people's hopes about the business change. Sometimes the price overreacts. Still, you own part of a company, not a bet against a stranger. This idea is one of the most important in the whole course.",
    tryIt: { label: "Security Analysis · Analyze Ticker" },
    checks: [
      {
        prompt: "You buy 10 shares of a company. What do you own?",
        options: [
          "A small piece of the company",
          "A loan the company must repay you",
          "A promise of a yearly payout",
          "Ownership starts only when you sell them",
        ],
        correctIndex: 0,
        explanation: "Stock is ownership, not a loan. That is the difference between a stock and a bond.",
      },
      {
        prompt: "A stock drops 8% in one day in a market-wide selloff, with no news about the company. What changed about the business?",
        options: [
          "Its assets and profits fell by about 8% too",
          "It is now worth 8% less for good",
          "Not necessarily anything; the price reflects changing mood",
          "Prices only fall when something real changes about the business",
        ],
        correctIndex: 2,
        explanation: "A price is not the same as business value from minute to minute. A broad selloff can move a price while the business stays the same that day.",
      },
      {
        prompt: "A company you own stops paying a dividend but keeps growing its profits. Do you still own part of it?",
        options: [
          "No, a dividend is what ownership means",
          "Yes, owning the shares is what makes you an owner",
          "Only if you bought it for the dividend",
          "Your ownership ends when a dividend is cut",
        ],
        correctIndex: 1,
        explanation: "A dividend is cash a company may choose to pay out. Your ownership does not depend on it.",
      },
    ],
  },
  {
    id: "beginner-06",
    tier: "beginner",
    order: 6,
    title: "What a bond is",
    body: "A bond is a loan. You lend money to a company or a government. In return you get interest payments, and you get your original money back on a set date. That original amount is the principal, and the set date is the maturity. A fixed interest payment is called the coupon.\n\nWith a bond you do not own part of the company. You are a lender. Bond prices move opposite to interest rates. When new bonds start paying more, your older bond, which pays less, is worth less to buyers. Its price falls even though nothing changed at the company.",
    tryIt: null,
    checks: [
      {
        prompt: "You own a 10-year bond that pays a fixed 3%. Interest rates then rise sharply. What happens to your bond's market price?",
        options: [
          "It falls, because new bonds now pay more than yours",
          "It rises, because higher rates help older bonds too",
          "It stays the same, since your 3% interest payment is fixed",
          "It doubles, because rates and prices rise together",
        ],
        correctIndex: 0,
        explanation: "Bond prices and interest rates move in opposite directions. Your fixed 3% is worth less once buyers can get more elsewhere.",
      },
      {
        prompt: "A company goes bankrupt. Who is usually paid first, bondholders or stockholders?",
        options: [
          "Bondholders, because they are lenders owed a set debt",
          "Stockholders, because they own the company",
          "Both groups are paid equally out of whatever is left over",
          "Neither group is owed anything in bankruptcy",
        ],
        correctIndex: 0,
        explanation: "Lenders are paid before owners. This is part of why bonds are usually less risky than stocks from the same company.",
      },
      {
        prompt: "You own a bond with a fixed 4% coupon. The company's profits double. Does your coupon payment change?",
        options: [
          "Yes, it doubles when profits double",
          "Yes, it changes up or down with the company's stock price",
          "No, a fixed coupon pays the same amount no matter what",
          "No, because bond payments depend on the company's profits",
        ],
        correctIndex: 2,
        explanation: "A fixed coupon is a promise to pay a set amount. The trade-off is that you miss out on the extra gain that a stockholder would get.",
      },
    ],
  },
  {
    id: "beginner-07",
    tier: "beginner",
    order: 7,
    title: "Risk and diversification",
    body: "People say, \"Do not put all your eggs in one basket.\" The idea is simple. If you own many things that do not all move together, one bad event will not sink you. If you own one stock, your whole result depends on that one company's news and surprises.\n\nIf you own 30 stocks in different industries, one company's bad news barely changes the total. Your ups and downs get smaller, and you have not given up much expected return. Spreading your money like this is called diversification.",
    tryIt: null,
    checks: [
      {
        prompt: "Portfolio A holds 1 stock. Portfolio B holds 30 stocks in different industries. Which is more likely to swing wildly on one company's bad news?",
        options: [
          "Portfolio A",
          "Portfolio B",
          "They are the same",
          "It cannot be known",
        ],
        correctIndex: 0,
        explanation: "With one holding, one company's news is the whole story. Diversification is what spreads that out.",
      },
      {
        prompt: "You own 15 stocks, and all 15 are technology companies. How spread out are you?",
        options: [
          "Fully, because 15 is a lot of holdings",
          "Not at all, however many stocks you own",
          "Spreading out only applies to bonds",
          "Only partly, since they can all fall on tech news",
        ],
        correctIndex: 3,
        explanation: "The count alone does not spread risk. What matters is whether the holdings face different risks. Fifteen tech companies share many of the same ones.",
      },
      {
        prompt: "You own 40 stocks across every major industry. Does that protect you from a crash of the whole market?",
        options: [
          "Yes, it takes away the risk of losing money",
          "No, it lowers company risk but not market-wide risk",
          "Only if all of the stocks come from different countries",
          "It has no effect on any kind of risk",
        ],
        correctIndex: 1,
        explanation: "Diversification reduces the risk of any one company. It cannot remove the risk that the whole market falls, though a spread-out portfolio usually falls less than one stock.",
      },
    ],
  },
  {
    id: "beginner-08",
    tier: "beginner",
    order: 8,
    title: "Compound interest and the Rule of 72",
    body: "Compound interest means you earn returns on your original money and on the returns you already earned. Growth builds on growth. The Rule of 72 is a quick shortcut. Divide 72 by the yearly return rate to guess how many years it takes your money to double.\n\nThis is why starting at 25 instead of 35 matters so much. Ten extra years of growth can be the difference between a comfortable and a hard retirement.",
    tryIt: null,
    checks: [
      {
        prompt: "Using the Rule of 72, about how long does it take money to double at 8% a year?",
        options: [
          "3 years",
          "9 years",
          "24 years",
          "72 years",
        ],
        correctIndex: 1,
        explanation: "72 divided by 8 is 9. At 8% a year, money doubles in about 9 years.",
      },
      {
        prompt: "Investor A puts in $200 a month starting at 25. Investor B puts in $200 a month starting at 35. Both stop at 65 and earn the same return. Who ends up with more?",
        options: [
          "Investor B, since waiting lets you pick better stocks",
          "Both end up with the same amount, since they pay in equally",
          "Investor A, since the money grows for 10 more years",
          "It cannot be known without the exact return earned",
        ],
        correctIndex: 2,
        explanation: "A's money has 10 more years to earn returns on its returns. That gap is bigger than the extra deposits alone would suggest.",
      },
      {
        prompt: "Using the Rule of 72, about how long does it take money to double at 4% a year?",
        options: [
          "4 years",
          "18 years",
          "9 years",
          "36 years",
        ],
        correctIndex: 1,
        explanation: "72 divided by 4 is 18. At 4%, doubling takes about twice as long as at 8%.",
      },
    ],
  },
  {
    id: "beginner-09",
    tier: "beginner",
    order: 9,
    title: "Taxes, the parts that matter now",
    body: "Money from your job is taxed as ordinary income. Profit from selling an investment is taxed as a capital gain. If you hold an investment for more than a year before you sell, the profit usually gets a lower tax rate than your paycheck.\n\nSome accounts, like a 401(k) or an IRA, are tax-advantaged. That means your money can grow without being taxed each year, the way it would in a regular brokerage account. Using these accounts first can change how much of your investing gains you keep.",
    tryIt: null,
    checks: [
      {
        prompt: "You sell a stock you held for 2 years and make a profit. How is the gain usually taxed compared with your paycheck?",
        options: [
          "At the same rate as your paycheck",
          "It is taxed only if you spend the money",
          "At double your regular income tax rate on the gain",
          "Usually at a lower long-term rate",
        ],
        correctIndex: 3,
        explanation: "Gains on investments held for more than a year usually get a lower long-term rate than ordinary income.",
      },
      {
        prompt: "You buy a stock and sell it 8 months later at a profit. How is that gain usually taxed?",
        options: [
          "As a short-term gain, at your regular income tax rate",
          "At the lower long-term rate, the same as a 2-year hold",
          "It is tax-free because the hold was short",
          "At a flat 50% rate for everyone",
        ],
        correctIndex: 0,
        explanation: "Gains on investments held one year or less are short-term. They are usually taxed like ordinary income. Passing the one-year mark is what earns the lower rate.",
      },
      {
        prompt: "What is the main tax benefit of a 401(k) or IRA compared with a regular brokerage account?",
        options: [
          "They raise your returns by a fixed 2% a year",
          "They charge lower fees than any other account",
          "You can take money out at any age with no penalty",
          "Your money can grow without yearly tax on the gains",
        ],
        correctIndex: 3,
        explanation: "Tax-advantaged accounts skip the yearly tax on gains and dividends. The trade-off is that there are usually rules and penalties for taking money out early.",
      },
    ],
  },
  {
    id: "beginner-10",
    tier: "beginner",
    order: 10,
    title: "Credit scores and credit reports",
    body: "A credit score is one number, usually from 300 to 850, that shows lenders how risky you look. The most common one is the FICO score. The biggest parts are whether you pay on time (about 35%) and how much you owe compared with your limits (about 30%). The length of your credit history, new credit applications, and the mix of account types count for less.\n\nYour credit report is different. It is the full record of your accounts, balances and payments. The score is figured from it. In the US you can check your reports for free at AnnualCreditReport.com. Checking helps you catch errors or fraud early.",
    tryIt: null,
    checks: [
      {
        prompt: "Which part is the biggest share of a typical FICO score?",
        options: [
          "How many years you have had credit accounts open",
          "Whether you pay your bills on time",
          "How many times lenders checked your credit lately",
          "How many types of accounts you have",
        ],
        correctIndex: 1,
        explanation: "Payment history is about 35% of a FICO score. Even one payment that is 30 days late can hurt.",
      },
      {
        prompt: "You have a $10,000 card limit and owe $6,000. What is this called, and why does it matter?",
        options: [
          "Credit utilization, 60%; a high share can lower your score",
          "APR, and it has no effect on your score",
          "A minimum payment ratio, which only changes the late fees you pay",
          "Credit mix, which scores do not count at all",
        ],
        correctIndex: 0,
        explanation: "Utilization is the share of your limit that you use. How much you owe, which includes utilization, is about 30% of a FICO score.",
      },
      {
        prompt: "What is the difference between a credit score and a credit report?",
        options: [
          "They are two names for the same thing",
          "The report is the full record; the score is one number from it",
          "The score lists your accounts, and the report is just one number",
          "The report costs money, and the score is free to see",
        ],
        correctIndex: 1,
        explanation: "The report is the raw record of every account, balance and payment. The score is a single number worked out from that record.",
      },
    ],
  },
  {
    id: "beginner-11",
    tier: "beginner",
    order: 11,
    title: "Paying off several debts: avalanche or snowball",
    // Source for the behavior claim: Gal and McShane (2012), Journal of Marketing Research 49: 487-501,
    // "Can Small Victories Help Win the War? Evidence from Consumer Debt Management" (summary: Kellogg Insight).
    body: "If you owe money on more than one debt, there are two well-known ways to pay them off. In the avalanche method, you put extra money toward the debt with the highest interest rate first and pay only the minimum on the rest. This costs the least interest in total.\n\nIn the snowball method, you put extra money toward the smallest balance first, whatever its rate. On paper it costs a bit more. But clearing a small debt fast feels like a win, and wins can keep you going. Some research suggests that early progress like this helps people stay with a plan.",
    tryIt: null,
    checks: [
      {
        prompt: "You owe $2,000 on a card at 24% APR, $500 on a card at 18% APR, and $8,000 on a student loan at 6% APR. With the avalanche method, which do you attack first?",
        options: [
          "The $500 card, which has an 18% APR",
          "The $8,000 student loan at 6% APR",
          "The $2,000 card at 24% APR",
          "Whichever debt has the biggest balance",
        ],
        correctIndex: 2,
        explanation: "Avalanche always goes after the highest interest rate first. Here that is the 24% card, whatever its balance.",
      },
      {
        prompt: "Same three debts. With the snowball method, which do you attack first?",
        options: [
          "The $2,000 card at 24% APR",
          "The $8,000 student loan at 6% APR",
          "Whichever debt has the highest rate",
          "The $500 card at 18% APR",
        ],
        correctIndex: 3,
        explanation: "Snowball ignores the rate and goes after the smallest balance first. Here that is the $500 card.",
      },
      {
        prompt: "Why might someone pick snowball even though avalanche usually costs less?",
        options: [
          "The law requires snowball in most states",
          "Snowball has the lower interest rate of the two",
          "There is no real difference between the two",
          "Quick wins can help you keep going with the plan",
        ],
        correctIndex: 3,
        explanation: "The edge is about behavior, not math. Early wins build momentum, and research suggests that momentum helps people finish.",
      },
    ],
  },
  {
    id: "beginner-12",
    tier: "beginner",
    order: 12,
    title: "Retirement accounts: 401(k), IRA and Roth",
    body: "A 401(k) is a retirement account you get through your job. Many employers match part of what you put in. A match is free money, and you lose it if you do not contribute enough to get all of it. A Traditional IRA is a similar account that you open yourself. It usually allows smaller yearly contributions than a 401(k).\n\nThese two are usually pre-tax. You do not pay income tax on the money going in, but you pay tax when you take it out in retirement. A Roth account (a Roth IRA or a Roth 401(k)) works the other way. You pay tax first, and qualified withdrawals later are tax-free. A Roth can make more sense if you expect to be in a higher tax bracket later than you are now.",
    tryIt: null,
    checks: [
      {
        prompt: "Your employer matches 50% of your 401(k) contributions, up to 6% of your pay. You earn $60,000 a year and put in nothing. How much free match do you miss each year?",
        options: [
          "$0",
          "$3,600",
          "$1,800",
          "$6,000",
        ],
        correctIndex: 2,
        explanation: "6% of $60,000 is $3,600. A 50% match on that is $1,800 of free money you are not collecting.",
      },
      {
        prompt: "What is the main difference between a Traditional IRA and a Roth IRA?",
        options: [
          "There is no real difference between them",
          "A Roth IRA can only be opened through your employer at work",
          "A Traditional IRA has no yearly limit at all",
          "Traditional is taxed at withdrawal; Roth is taxed up front",
        ],
        correctIndex: 3,
        explanation: "The difference is when you pay tax. Traditional puts the tax off until you take money out. Roth takes the tax now, so later withdrawals are tax-free.",
      },
      {
        prompt: "You are early in your career and expect a much higher tax rate when you retire. Which is usually the better pick?",
        options: [
          "Roth, since you pay tax now at a lower rate",
          "Traditional, since you pay no tax today",
          "Neither, because tax rates do not matter here",
          "A regular taxable account only",
        ],
        correctIndex: 0,
        explanation: "Paying tax now at a low rate and withdrawing tax-free later at a higher rate is the classic case for a Roth.",
      },
    ],
  },
  {
    id: "beginner-13",
    tier: "beginner",
    order: 13,
    title: "Index funds and ETFs",
    body: "An index fund does not try to pick winning stocks. It holds all (or a sample) of the companies in a market index, such as the S&P 500, in proportion to their size. Its goal is to match the index, not beat it. Over long periods, most funds that try to beat the market have trailed their index after fees. That is the main reason to own the whole market cheaply.\n\nAn ETF (exchange-traded fund) and a mutual fund can track the same index. An ETF trades all day like a stock. A mutual fund is priced once a day, after the market closes. The expense ratio is the fund's yearly fee. A 1% fee versus a 0.05% fee sounds small. But over decades it makes a big difference in what you end up with.",
    tryIt: null,
    checks: [
      {
        prompt: "What does an S&P 500 index fund do?",
        options: [
          "A team of managers hand-picks the best stocks in the index",
          "Holds the 500 companies in the index to match its return",
          "It holds only the one best stock in the index",
          "It pays a fixed return each year, set by the fund",
        ],
        correctIndex: 1,
        explanation: "Index funds are passive. They copy the index instead of trying to beat it.",
      },
      {
        prompt: "Fund A charges a 1.0% yearly fee. Fund B tracks the same index and charges 0.05%. You invest $10,000, and the index earns 7% a year before fees for 30 years. What is likely?",
        options: [
          "Fund A wins, since a high fee means better managers",
          "Fund B ends up with more, since low fees leave more to grow",
          "Both end up about the same after 30 years",
          "Fund A wins, since it is sure to beat the index",
        ],
        correctIndex: 1,
        explanation: "Fees come out every year. A gap of about 0.95 points a year grows into a large dollar gap over 30 years.",
      },
      {
        prompt: "How does an ETF differ from a mutual fund that tracks the same index?",
        options: [
          "An ETF trades all day; a mutual fund is priced once a day",
          "Mutual funds are the cheaper choice for most investors",
          "An ETF can only be bought once a year",
          "There is no difference between them",
        ],
        correctIndex: 0,
        explanation: "Trading during the day is the main structural difference. What each fund holds can be nearly the same.",
      },
    ],
  },
  {
    id: "beginner-14",
    tier: "beginner",
    order: 14,
    title: "Insurance basics",
    body: "Insurance pools risk. Many people pay a regular fee, called a premium. When a rare, costly event happens to one of them, the pooled money pays for it. That keeps one person from being ruined. Your deductible is what you pay yourself before the insurance starts paying a claim. A higher deductible usually means a lower premium, because you take on more of the small costs.\n\nCommon kinds are health, auto (often required by law), home or renters, and life insurance. Life insurance comes in two very different forms. Term life covers a set period, such as 20 years, and costs less. Whole life lasts your whole life and includes a savings part, so it costs much more.",
    tryIt: null,
    checks: [
      {
        prompt: "What does a higher deductible usually do to your premium?",
        options: [
          "It raises it, since you end up paying more when you file a claim",
          "It has no link to the premium",
          "It usually lowers it, since you cover more small costs",
          "It only applies to life insurance",
        ],
        correctIndex: 2,
        explanation: "You and the insurer share the risk. When you take on more of the small stuff, the insurer usually charges less.",
      },
      {
        prompt: "What is the main purpose of insurance?",
        options: [
          "To make sure you come out ahead with money",
          "To avoid ever paying for anything yourself",
          "To share risk so one costly event does not ruin one person",
          "To earn a high return on the premiums that you pay",
        ],
        correctIndex: 2,
        explanation: "Insurance is risk-sharing, not an investment. Most people who pay premiums never make a large claim. That is the system working as planned.",
      },
      {
        prompt: "What is the main difference between term and whole life insurance?",
        options: [
          "Term life pays out only if you outlive the term",
          "Whole life is the cheaper of the two, because it covers you for longer",
          "They are the same product with two names",
          "Term covers a set time and costs less; whole life lasts for life",
        ],
        correctIndex: 3,
        explanation: "Term is plain protection for a set time. Whole life adds a savings part, which is why it costs many times more for the same payout.",
      },
    ],
  },
  {
    id: "beginner-15",
    tier: "beginner",
    order: 15,
    title: "Mortgages and buying a home",
    body: "A mortgage is a loan to buy a home. The home is the security for the loan. If you stop paying, the lender can foreclose, which means taking the home. Your down payment lowers how much you borrow. If you put down less than 20%, you usually also pay private mortgage insurance (PMI) until you have built up enough equity, which is the part of the home you own.\n\nA fixed-rate mortgage keeps the same rate for the whole loan. An adjustable-rate mortgage (ARM) often starts lower but can rise later, and so can your payment. A 30-year loan has a lower monthly payment than a 15-year loan for the same amount. But you pay much more interest in total.",
    tryIt: null,
    checks: [
      {
        prompt: "You put 10% down on a home instead of 20%. What is likely?",
        options: [
          "No change, because lenders ignore the size of the down payment",
          "Your interest rate drops by itself right away",
          "You will probably pay private mortgage insurance (PMI)",
          "Your loan term gets shorter by itself",
        ],
        correctIndex: 2,
        explanation: "Lenders usually ask for PMI when the down payment is under 20%. Less money down means more of their money is at risk.",
      },
      {
        prompt: "What is the main risk of an adjustable-rate mortgage (ARM) compared with a fixed-rate one?",
        options: [
          "The rate can go up later, which raises your payment",
          "ARMs are against the law in most states",
          "An ARM usually starts with a higher rate than a fixed loan",
          "There is no real risk difference between them",
        ],
        correctIndex: 0,
        explanation: "An ARM trades a lower starting rate for the risk of a higher payment later. A fixed rate removes that risk.",
      },
      {
        prompt: "Compared with a 15-year mortgage at the same rate and amount, what is true of a 30-year mortgage?",
        options: [
          "Lower monthly payment, but much more total interest",
          "Higher monthly payment and also less total interest paid",
          "The same total interest either way",
          "It is the worse choice on payment and on interest",
        ],
        correctIndex: 0,
        explanation: "Stretching the same loan over twice the years lowers each payment. But you pay interest for much longer, so the total cost rises a lot.",
      },
    ],
  },
  {
    id: "beginner-16",
    tier: "beginner",
    order: 16,
    title: "Student loans",
    body: "Federal student loans come from the government. They usually have protections that private loans do not. One is income-driven repayment, which sets your payment based on what you earn. Another is forgiveness, such as Public Service Loan Forgiveness for some jobs. Private loans come from banks and other lenders. They usually have fewer protections.\n\nSome federal loans are subsidized. The government pays the interest while you are in school. On an unsubsidized loan, interest builds the whole time. Be careful with refinancing. If you move a federal loan to a private lender, your rate may drop. But you lose federal protections for good.",
    tryIt: null,
    checks: [
      {
        prompt: "What is one advantage federal student loans usually have over private ones?",
        options: [
          "They charge zero interest to all of their borrowers",
          "They do not have to be repaid after graduation",
          "There is no real difference between federal and private loans",
          "Income-driven repayment and forgiveness programs",
        ],
        correctIndex: 3,
        explanation: "Income-driven repayment and forgiveness are federal protections. Private lenders usually do not offer them.",
      },
      {
        prompt: "What is the difference between a subsidized and an unsubsidized federal loan?",
        options: [
          "There is no real difference between them",
          "Subsidized loans skip interest in school; unsubsidized do not",
          "Unsubsidized loans charge no interest at any point",
          "Subsidized loans are available only to graduate students",
        ],
        correctIndex: 1,
        explanation: "\"Subsidized\" means the government pays the interest while you are in school. That gap is what separates the two.",
      },
      {
        prompt: "You refinance a federal loan into a private loan to get a lower rate. What do you give up for good?",
        options: [
          "No downside; refinancing is a pure gain for you",
          "Your ability to ever borrow money again",
          "Federal repayment plans and forgiveness programs",
          "Your credit score, for the rest of your whole life",
        ],
        correctIndex: 2,
        explanation: "Refinancing federal debt into a private loan is a one-way door. You trade away every federal protection for the new rate.",
      },
    ],
  },
  {
    id: "beginner-17",
    tier: "beginner",
    order: 17,
    title: "Know your numbers",
    body: "Before a budget rule means anything, you need a true picture of what comes in and where it goes. That is hard when your income changes from week to week, as with gig work, tips or shifts. It is also hard when money arrives on benefit dates. A standard monthly budget template assumes a paycheck that looks the same every time.\n\nThe fix is simple. Write down every dollar you get and spend for 7 real days. Then set your rules. Seven days of real facts beat a template that does not fit your life.",
    tryIt: null,
    checks: [
      {
        prompt: "Why track your spending for 7 days before you set a budget?",
        options: [
          "The law requires it for anyone who budgets",
          "To see how you really spend before you set rules",
          "Longer tracking is better, so track for a year first",
          "A budget does not need any real facts about your life",
        ],
        correctIndex: 1,
        explanation: "Budgets built on guesses tend to fail. Seven real days of facts beat a rule copied from a template.",
      },
      {
        prompt: "Your pay comes as gig payouts one week and a benefit deposit the next. What does a standard monthly budget template get wrong?",
        options: [
          "It handles uneven pay on its own",
          "It assumes a steady paycheck that arrives the same way each time",
          "No problem at all; templates work well for any kind of pay pattern",
          "It only changes how much you save",
        ],
        correctIndex: 1,
        explanation: "Most templates are built around one steady paycheck. When pay is uneven or tied to benefit dates, that assumption breaks first.",
      },
      {
        prompt: "What is the goal of a \"financial X-ray,\" which means tracking every dollar for a week?",
        options: [
          "To make you feel bad about small buys",
          "To replace any need to track later on",
          "To work out your credit score for the month",
          "To find where money really leaks out",
        ],
        correctIndex: 3,
        explanation: "The point is not blame. It is to see clearly. You cannot fix a leak you have not found.",
      },
    ],
  },
  {
    id: "beginner-18",
    tier: "beginner",
    order: 18,
    title: "The scarcity trap: why this is not about willpower",
    body: "Researchers Mullainathan and Shafir studied scarcity. They found that constant money stress uses up the same mental energy you need for planning and self-control. It works like a second full-time job. So a plan that needs perfect discipline under stress often fails. That is not a flaw in the person.\n\nThe practical answer is to make fewer decisions. Set up round-up savings, automatic transfers and default settings, so you do not need to decide again each day. Fewer choices, not more willpower, is what holds up under pressure.",
    tryIt: null,
    checks: [
      {
        prompt: "What does the research say causes many poor money choices made under financial stress?",
        options: [
          "A lack of willpower that discipline would fix",
          "Weak math skills",
          "Not wanting to do well with money",
          "Less mental bandwidth from constant stress, not laziness",
        ],
        correctIndex: 3,
        explanation: "Scarcity uses up mental bandwidth the way a second job would. The fix is fewer decisions, not more willpower.",
      },
      {
        prompt: "Two people have $40 left and 3 days until payday. They choose differently. What does the research say about judging either choice?",
        options: [
          "Neither is a planning failure; scarcity forces hard trade-offs",
          "The right choice is to save the money, whatever else is due that week",
          "Whoever chose differently from you was wrong",
          "The trade-off proves the budget failed",
        ],
        correctIndex: 0,
        explanation: "Scarcity forces trade-offs between two real needs. There is no trick answer.",
      },
      {
        prompt: "Why favor automatic saving, like round-ups, over a \"just remember to save\" rule?",
        options: [
          "Automatic saving earns a higher interest rate",
          "Saving by hand is against the law in most states and cities",
          "There is no real difference between the two",
          "It removes a new decision that needs willpower each time",
        ],
        correctIndex: 3,
        explanation: "Under stress, a decision you do not have to make cannot be skipped by accident. That is the whole case for automating.",
      },
    ],
  },
  {
    id: "beginner-19",
    tier: "beginner",
    order: 19,
    title: "Building your first $500 buffer",
    // Source: Pew Charitable Trusts, "Payday Lending in America: Who Borrows, Where They Borrow, and Why" (July 2012).
    // 69% of first-time borrowers used the loan for a recurring expense (rent, utilities, credit card bills, food);
    // 16% for an unexpected expense. https://www.pewtrusts.org/en/research-and-analysis/reports/2012/07/19/who-borrows-where-they-borrow-and-why
    // The earlier text credited a "single unexpected expense" to CFPB data; the Pew data point the other way.
    body: "Many people take a payday loan when a bill hits and they have no cushion. In a 2012 Pew Charitable Trusts survey, most first-time borrowers (69%) used the loan for regular bills, like rent, utilities or food. Only 16% used it for a surprise cost, like a car repair. So the real problem is often pay that does not cover regular costs, plus no cushion for a bump.\n\nA small buffer still helps. $500 can cover many surprise costs, such as a repair, a utility spike or a medical copay, before a loan cycle begins. Experts often suggest 3 to 6 months of costs, but that is out of reach for many people. A $500 goal is smaller and easier to hit. Build it with small automatic transfers instead of one big deposit.",
    tryIt: null,
    checks: [
      {
        prompt: "What first savings goal does this lesson suggest, and why not a bigger one?",
        options: [
          "$5,000, because small goals are not worth setting",
          "6 months of full expenses, as most advice sites say",
          "$500, because it covers many surprises and is within reach",
          "No set amount, since saving does not help with surprises",
        ],
        correctIndex: 2,
        explanation: "Three to six months of costs is standard advice, but it is out of reach for many people. $500 is a start that you can actually reach.",
      },
      {
        prompt: "Which statement matches a 2012 Pew survey of payday loan borrowers?",
        options: [
          "Most used it for a one-time surprise cost, like a car repair",
          "Most used the loan for regular bills like rent or food",
          "Most used it to pay for a vacation",
          "Most used it to pay off a credit card",
        ],
        correctIndex: 1,
        explanation: "Pew found that 69% of first-time borrowers used the loan for regular bills and 16% for a surprise expense. A small cushion helps, but steady income matters too.",
      },
      {
        prompt: "Why does this lesson suggest small automatic transfers instead of one lump deposit toward $500?",
        options: [
          "It works without $500 at once or a new choice each time",
          "Automatic transfers reach the goal faster than a deposit",
          "Banks do not allow one-time lump deposits",
          "It makes no difference to the result",
        ],
        correctIndex: 0,
        explanation: "Small, automatic amounts work even when one $500 deposit never would. Small and steady beats large and hoped-for.",
      },
    ],
  },
  {
    id: "beginner-20",
    tier: "beginner",
    order: 20,
    title: "How payday loans work",
    // Sources: CFPB (2014), "Payday Loans and Deposit Advance Products": more than 80% of payday loans are rolled over
    // or followed by another loan within 14 days. APR math: 55/300 * 365/14 = 477.9%. Total interest on $300 at 15% APR
    // over 12 months is $24.93 (standard amortization; checked by script).
    // The earlier "three-quarters of loan volume from 11+ loans" claim was not verifiable as worded and was removed.
    body: "A payday loan fee looks small, often $15 to $55 on a few hundred dollars. But the loan is short, usually due in 14 days. APR shows the cost as a yearly rate, so you can compare loans. A short loan with a fee turns into a triple-digit APR, often 300% to 650% or more.\n\nThe bigger danger is the cycle. In a 2014 CFPB study, more than 80% of payday loans were rolled over or followed by another loan within 14 days. Rolling over means paying a fee to push the due date back. The short due date makes it easier to roll over than to pay off, and that is where the cost builds up.",
    tryIt: null,
    checks: [
      {
        prompt: "You borrow $300 and pay a $55 fee, due in 14 days. About what is the APR?",
        options: [
          "About 55%",
          "About 478%",
          "About 14%",
          "About 100%",
        ],
        correctIndex: 1,
        explanation: "The $55 fee is charged for only 14 days. Stretched across a full year, that rate is about 478%.",
      },
      {
        prompt: "A $300 payday loan costs a $55 fee for 14 days. A $300 loan at 15% APR, repaid over 12 months, costs about $25 in total interest. Which statement is true?",
        options: [
          "The payday loan is cheaper because its fee is smaller",
          "Both loans cost about the same in total",
          "The payday loan costs more in dollars, for a far shorter loan",
          "The 12-month loan costs more because it lasts longer",
        ],
        correctIndex: 2,
        explanation: "The $55 fee is more than twice the $25 of interest, and you borrow for only 14 days. A small-looking fee can still be the costly choice.",
      },
      {
        prompt: "In a 2014 CFPB study, about what share of payday loans were rolled over or followed by another loan within 14 days?",
        options: [
          "More than 80%",
          "About 10%",
          "About 50%",
          "Fewer than 1 in 20",
        ],
        correctIndex: 0,
        explanation: "The short due date makes rolling over more common than paying off. The real cost of a payday loan is usually the whole sequence, not the first loan.",
      },
    ],
  },
  {
    id: "beginner-21",
    tier: "beginner",
    order: 21,
    title: "Overdraft and bank fees",
    // Sources: CFPB's 2024 overdraft rule was repealed by Congress under the Congressional Review Act (signed 9 May 2025,
    // S.J.Res.18; CRS In Focus IN12513). Overdraft/NSF fee totals: Financial Health Network (about $12.1B in 2024) and
    // NCLC (about $12.4B in 2025). The earlier "$35,000-$65,000 income band" claim was not found and was removed.
    body: "Overdraft and NSF (non-sufficient funds) fees take a lot of money from households. Consumer groups have put the total at about $12 billion a year recently. It does not feel like borrowing. But a $35 fee on a $10 shortfall costs about as much as a very expensive loan.\n\nIn late 2024 the CFPB finished a rule meant to lower overdraft fees at large banks. Congress reversed it in 2025 before it took effect. The practical step is to check your bank's overdraft coverage setting. Many banks sign customers up by default, and you can often turn it off.",
    tryIt: null,
    checks: [
      {
        prompt: "What happened to the CFPB's rule on overdraft fees?",
        options: [
          "It became law in 2024 and caps fees nationwide",
          "It only ever applied to small credit unions and co-ops",
          "It raised the lowest overdraft fee to $5",
          "Congress repealed it before it took effect",
        ],
        correctIndex: 3,
        explanation: "The rule was reversed by Congress in 2025. Fees at some banks have since stayed the same or gone up.",
      },
      {
        prompt: "A bank charges a $35 overdraft fee to cover a $10 shortfall. Why is that like a costly loan?",
        options: [
          "The bank refunds the fee in full when you deposit money later",
          "You pay $35 to cover $10, a huge cost for a very short time",
          "Banks only charge the fee on cash withdrawals",
          "The bank pays the fee, so the cost is not yours",
        ],
        correctIndex: 1,
        explanation: "Paying $35 to cover $10 for a few days is a very high price. That is why overdraft fees can cost as much as a payday loan.",
      },
      {
        prompt: "What is a good first step to cut your risk of overdraft fees?",
        options: [
          "Close your checking account right away",
          "Leave the setting alone, since these fees cannot be avoided",
          "Check your overdraft coverage setting and turn it off if you can",
          "Use only cash for the rest of your life",
        ],
        correctIndex: 2,
        explanation: "Many banks turn on overdraft coverage by default. With it, a purchase goes through and you pay a fee. Opting out is often possible.",
      },
    ],
  },
  {
    id: "beginner-22",
    tier: "beginner",
    order: 22,
    title: "Buy now, pay later",
    // Sources: Federal Reserve FEDS Note, "The Only Way I Could Afford It: Who Uses BNPL and Why" (Dec 2024), and the
    // Fed's annual SHED report. The earlier exact figures (25% vs 18% of households, "78% only way", "40% pay late") could not be
    // verified as worded (SHED reports roughly a quarter of users paying late, 2025), so only the qualitative findings are kept.
    body: "Buy now, pay later (BNPL) splits a purchase into a few payments, often with no interest on a single plan. It is still debt, even if it does not feel like a loan at checkout. Surveys by the Federal Reserve find that BNPL users are more likely to have lower incomes. Many say they used it because they could not otherwise afford the purchase.\n\nThe main risk is stacking plans. Each plan alone looks free, but together they can add up to a big monthly bill. Some users also pay late, which can bring fees. A good habit is to check the total you owe across all plans, not just the one in front of you.",
    tryIt: null,
    checks: [
      {
        prompt: "You are at checkout, and BNPL offers to split a $200 purchase into 4 payments of $50 with no interest. You already have 2 other BNPL plans. What is the smartest move?",
        options: [
          "Go ahead and use it, since this one plan charges no interest",
          "Avoid buy now, pay later, even when it is cheaper",
          "Add up what all 3 plans cost you this month, then decide",
          "Ask the store to raise your credit limit",
        ],
        correctIndex: 2,
        explanation: "Stacked plans are the real risk. No interest on one plan hides the total monthly bill across all of them.",
      },
      {
        prompt: "Why is \"no interest\" on one BNPL plan not the full story?",
        options: [
          "Plans with no interest are free for any shopper",
          "Banks must cover any late fees for you",
          "A single plan has no way to hurt your finances",
          "Several plans together can make a big monthly bill",
        ],
        correctIndex: 3,
        explanation: "Each plan can look small. But the payments from all of your plans land on you together.",
      },
      {
        prompt: "You miss a BNPL payment. What can happen?",
        options: [
          "You may be charged a late fee or other cost",
          "No cost, because the plan has no interest charge",
          "The store makes the payment for you",
          "Your debt is erased after 30 days",
        ],
        correctIndex: 0,
        explanation: "\"No interest\" does not mean \"no cost.\" A missed payment can bring a fee and can hurt your finances.",
      },
    ],
  },
  {
    id: "beginner-23",
    tier: "beginner",
    order: 23,
    title: "Reading the fine print",
    body: "The Truth in Lending Act (TILA) is a US law. It requires lenders to show you three numbers on a loan agreement. They are the APR, the total finance charge (the full dollar cost of borrowing) and the total of payments (everything you will have paid by the end). This is a legal rule, not a sales slogan.\n\nThe skill lasts longer than any list of bad products. New products will still have to show the same three numbers. Learning to find and read them helps you with any loan, whatever it is called.",
    tryIt: null,
    checks: [
      {
        prompt: "Which US law requires lenders to show the APR and the total finance charge?",
        options: [
          "The Fair Debt Collection Practices Act (FDCPA)",
          "The Equal Credit Opportunity Act (ECOA)",
          "The Gramm-Leach-Bliley Act (GLBA)",
          "The Truth in Lending Act (TILA)",
        ],
        correctIndex: 3,
        explanation: "TILA makes lenders show the real cost. Knowing it exists tells you what to look for on any agreement.",
      },
      {
        prompt: "Which three items must appear on a loan agreement under TILA?",
        options: [
          "The lender's slogan, address, and phone number",
          "The lender's yearly profit and number of staff",
          "APR, finance charge, and total of payments",
          "A list of the other customers who use the lender",
        ],
        correctIndex: 2,
        explanation: "These three numbers are the core disclosures. If one is missing or unclear, that is a red flag, whatever the product is called.",
      },
      {
        prompt: "Why does this lesson teach you to find the three numbers instead of a list of products to avoid?",
        options: [
          "Lists of products are more useful than one skill",
          "The same rule covers any loan, now or in the future",
          "APR does not apply to newer products",
          "Both approaches work about the same way",
        ],
        correctIndex: 1,
        explanation: "A skill that carries over lasts longer than a list that goes out of date when a new product appears.",
      },
    ],
  },
  {
    id: "beginner-24",
    tier: "beginner",
    order: 24,
    title: "Grocery math: beating food price increases",
    // Sources: USDA ERS Food Price Outlook (restaurant/away-from-home food has risen faster than grocery/at-home food in
    // 2025 forecasts; beef prices ran well above average). https://ers.usda.gov/data-products/food-price-outlook/summary-findings
    // Exact percentages were removed: the figures vary by forecast month and the old text mixed vintages.
    body: "Food prices do not rise evenly. Lately, restaurant and takeout food has risen faster than groceries. Within the grocery store, some items, like beef, have risen much faster than others, while fruits and vegetables have stayed cheaper. The Thrifty Food Plan from the US Department of Agriculture (USDA) is the government's own guide for a healthy, lower-cost weekly grocery list. It gives you a real target, not just advice to eat cheaper.\n\nThe best move is not clipping every coupon. It is to shift your basket away from whatever is rising fastest and toward items that are not. The price gap between items can matter more than any one discount. Check current prices, because the fast risers change over time.",
    tryIt: null,
    checks: [
      {
        prompt: "Lately, which has risen faster in price, restaurant and takeout food or groceries?",
        options: [
          "Food bought at the grocery store",
          "Both rose by about the same amount",
          "Restaurant and takeout food",
          "Both have fallen in price",
        ],
        correctIndex: 2,
        explanation: "Eating at home has risen less. That is a real reason cooking at home matters more than usual.",
      },
      {
        prompt: "What is the USDA Thrifty Food Plan?",
        options: [
          "The government's guide to a healthy, lower-cost grocery list",
          "A coupon app that finds the best sales",
          "A tax credit for grocery purchases",
          "A plan that only covers meals you buy at a restaurant or cafe",
        ],
        correctIndex: 0,
        explanation: "A real government benchmark gives you a number to plan against, instead of vague advice to spend less.",
      },
      {
        prompt: "What is the best way to cut your food bill, according to this lesson?",
        options: [
          "Clip all the coupons you can find",
          "Buy only the costliest name brands, since they are the best value",
          "Stop buying fruits and vegetables",
          "Shift your basket toward foods whose prices are not rising fast",
        ],
        correctIndex: 3,
        explanation: "The price gap between items can be bigger than any one discount. Moving away from the fast risers saves the most.",
      },
    ],
  },
  {
    id: "beginner-25",
    tier: "beginner",
    order: 25,
    title: "Energy bill triage",
    // Source: Lawrence Berkeley National Laboratory, "Leaking Electricity" (standby power is roughly 5-10% of residential
    // electricity use, an informal best estimate): https://www2.lbl.gov/Science-Articles/Archive/leaking-watts.html
    // The earlier "gasoline rose 26.7% in a recent stretch" figure had no named period or source and was removed.
    body: "Energy costs have been a big driver of inflation in recent years, and gasoline in particular has swung widely. Big fixes like solar panels are not realistic for most households under pressure. The best moves are free or nearly free. Set your water heater to 120°F. Change your HVAC filter. Unplug devices that use power even when they are off or idle. That use is called standby power.\n\nStudies by Lawrence Berkeley National Laboratory suggest that standby power may be about 5% to 10% of a home's electricity use. A power strip and a new habit cost little. That makes it one of the easiest ways to save.",
    tryIt: null,
    checks: [
      {
        prompt: "About what share of a home's electricity may come from standby power, which is devices that are plugged in but not in use?",
        options: [
          "About 5% to 10%",
          "About 50%",
          "About 1%",
          "About 30%",
        ],
        correctIndex: 0,
        explanation: "That sounds small. But a power strip and a habit change is a very cheap way to trim a bill.",
      },
      {
        prompt: "Why does this lesson focus on free fixes instead of big ones like solar panels?",
        options: [
          "Free fixes are things a stretched household can do now",
          "Solar panels do not save any money",
          "Free fixes save more money than any other kind of fix",
          "Energy costs are not really rising",
        ],
        correctIndex: 0,
        explanation: "Advice you cannot act on is not useful. Triage means ranking fixes by what is within reach.",
      },
      {
        prompt: "Which of these is a free or nearly free way to cut an energy bill?",
        options: [
          "Install a full set of solar panels",
          "Replace all of your appliances at once",
          "Set the water heater to 120°F",
          "Run the dryer more to warm the home",
        ],
        correctIndex: 2,
        explanation: "Water heater temperature, a clean filter and unplugging idle devices cost little or nothing.",
      },
    ],
  },
  {
    id: "beginner-26",
    tier: "beginner",
    order: 26,
    title: "When government benefits change",
    // Sources: OBBBA (2025) widened SNAP work requirements (ages 18-64) and removed some exemptions, e.g. for veterans
    // (Stateline, 12 Aug 2025). SAVE ended and the Repayment Assistance Plan (RAP) is replacing it (NerdWallet student-loan
    // coverage). The earlier "over 3.5 million people lost benefits" claim was an all-cause enrollment drop, not work-rule only,
    // and the "90-day choose a plan" window has probably closed, so both specifics were removed.
    body: "Benefit rules change, and the changes can hit people who did not see them coming. In 2025, a new federal law widened SNAP (food assistance) work rules to cover more adults. Some groups that used to be exempt, such as certain veterans, lost that exemption. Rules also changed for student loans. The SAVE repayment plan ended, and a new plan called the Repayment Assistance Plan (RAP) is replacing it. Dates and details keep shifting.\n\nThe pattern is the same each time. A policy change that once was someone else's problem can suddenly apply to you. A few minutes of checking costs less than missing a deadline. Always check the official source, such as your state SNAP office or StudentAid.gov.",
    tryIt: null,
    checks: [
      {
        prompt: "What changed for SNAP work rules in the 2025 federal law?",
        options: [
          "They cover more adults, and some exempt groups lost that status",
          "The work rules were dropped for all adults in the program",
          "They now apply only to people over 60",
          "No change was made to the rules",
        ],
        correctIndex: 0,
        explanation: "Groups that used to be exempt now have to track their hours. It is a real change that affects real people.",
      },
      {
        prompt: "What is replacing the SAVE student loan repayment plan?",
        options: [
          "A new plan called the Repayment Assistance Plan (RAP)",
          "No change; SAVE is still open to new borrowers",
          "Forgiveness of all student loans for everyone",
          "A rule that all loans must be refinanced privately",
        ],
        correctIndex: 0,
        explanation: "SAVE borrowers have to move to another plan. Check StudentAid.gov for the current rules and dates.",
      },
      {
        prompt: "What is the best way to stay ahead of changing benefit rules?",
        options: [
          "Wait for a friend to tell you about changes",
          "Check the official source, like your state agency or StudentAid.gov",
          "Assume the rules stay the same each year",
          "Rely on social media posts and videos for the latest rules and dates",
        ],
        correctIndex: 1,
        explanation: "Official sources have the current rules. A few minutes of checking is cheaper than losing a benefit or missing a deadline.",
      },
    ],
  },
  {
    id: "beginner-27",
    tier: "beginner",
    order: 27,
    title: "Getting out of debt: snowball or avalanche",
    // Sources: Gal and McShane (2012), J. Marketing Research 49:487-501 (about 6,000 people; paying off whole accounts early
    // raised the chance of becoming debt-free); Kettle, Trudel, Blanchard and Haeubl (2016), J. Consumer Research 43(3):460-477
    // (concentrating payments on one account raised motivation, most for the smallest account).
    // The earlier "73% vs 61% adherence over 6 months" statistic could not be traced to any study and was removed.
    body: "The debt avalanche method pays off the highest-interest debt first. It saves more interest than the snowball method, which pays off the smallest balance first. That is just math. But the best plan is the one you stick with.\n\nStudies of real people suggest that early, visible wins help. In one study of about 6,000 people, those who paid off whole accounts early were more likely to become debt-free (Gal and McShane, 2012). Another found that putting payments on one account made people more motivated (Kettle and others, 2016). This links to the scarcity idea from earlier. A plan that shows progress soon is easier to keep under stress. That is why this course starts with snowball.",
    tryIt: null,
    checks: [
      {
        prompt: "Which debt method saves more in total interest, snowball or avalanche?",
        options: [
          "Snowball, and it is also easier to keep up",
          "They cost about the same in most cases",
          "Avalanche, though it can be harder to stick with",
          "Neither one changes how much interest you end up paying",
        ],
        correctIndex: 2,
        explanation: "Avalanche is the best on paper. This course still starts with snowball because sticking with a plan matters more.",
      },
      {
        prompt: "What did research on real borrowers find about early wins?",
        options: [
          "Early wins made people more likely to quit",
          "Paying off whole accounts early helped people become debt-free",
          "Early wins had no link to finishing",
          "Only the highest-rate debt should ever be paid first",
        ],
        correctIndex: 1,
        explanation: "A study of about 6,000 people found that clearing whole accounts early raised the chance of becoming debt-free.",
      },
      {
        prompt: "How does this connect to the scarcity research from earlier?",
        options: [
          "It does not connect; the topics are unrelated",
          "Scarcity research proves avalanche is the best plan",
          "A plan with early progress is easier to keep under stress",
          "Sticking with a plan is unrelated to how much stress you face",
        ],
        correctIndex: 2,
        explanation: "Under stress, a plan that shows progress soon takes less willpower than one that pays off only later.",
      },
    ],
  },
  {
    id: "beginner-28",
    tier: "beginner",
    order: 28,
    title: "Credit basics without the jargon",
    // Source: the FTC enforces the Credit Repair Organizations Act, which bars credit repair companies from charging fees
    // before they have done the work (advance-fee credit repair is a scam pattern).
    body: "Two things drive most of a credit score: paying on time and how much of your credit limit you use. Your income is not part of most scoring models. That surprises people.\n\nA low score can cost you more than a higher loan rate. It can affect rental applications, and in some states it can come up in job background checks. Beware one scam. Some companies promise to erase accurate negative items from your credit report for an upfront fee. True information cannot be erased for a fee. It is a well-known scam that targets people who are trying to rebuild credit.",
    tryIt: null,
    checks: [
      {
        prompt: "Which two factors count most in a typical credit score?",
        options: [
          "How long you have had credit and new applications",
          "The mix of accounts and the number of accounts",
          "Your income and your age",
          "Paying on time and how much of your limit you use",
        ],
        correctIndex: 3,
        explanation: "Income is not even a factor in most scoring models. On-time payments and low balances matter most.",
      },
      {
        prompt: "A company calls and promises to erase accurate negative items from your report for an upfront fee. What is this?",
        options: [
          "A real service that works for any report if you pay a fee",
          "A common scam aimed at people rebuilding credit",
          "A government program for credit repair",
          "A normal bank service for all customers",
        ],
        correctIndex: 1,
        explanation: "True negative information cannot be erased for a fee. This is a well-documented scam.",
      },
      {
        prompt: "Besides loan rates, what else can a low credit score affect?",
        options: [
          "No effect; scores affect only loan rates",
          "Whether you are allowed to vote",
          "Whether you qualify for food assistance",
          "Rental applications and, in some states, job background checks",
        ],
        correctIndex: 3,
        explanation: "Credit reaches further than most people expect. That is one more reason to avoid repair scams and build your score.",
      },
    ],
  },
  {
    id: "beginner-29",
    tier: "beginner",
    order: 29,
    title: "Know your rights: debt collectors",
    // Sources: 15 U.S.C. 1692c and Regulation F (12 CFR 1006.6): calls before 8 a.m. or after 9 p.m. local time are presumed
    // inconvenient; consumers may request validation information for a debt.
    body: "The Fair Debt Collection Practices Act (FDCPA) protects you when a debt collector contacts you. For example, collectors generally may not call before 8 a.m. or after 9 p.m. You also have the right to ask for written proof of the debt, called validation, before you talk about paying. Knowing this gives you real legal footing on a stressful call.\n\nIf a collector pushes you to pay right now, your best first move is to ask for the debt in writing. Do not pay on the spot, and do not just ignore the calls. Asking for proof slows things down so you can decide calmly.",
    tryIt: null,
    checks: [
      {
        prompt: "Under the FDCPA, when may debt collectors generally not call you?",
        options: [
          "Only on weekends",
          "Before 8 a.m. or after 9 p.m.",
          "Only on public holidays and weekends",
          "There is no time limit",
        ],
        correctIndex: 1,
        explanation: "Knowing this rule turns a scary call into one where you have legal footing.",
      },
      {
        prompt: "A debt collector pushes you to pay by debit card right now. What is the smartest first move?",
        options: [
          "Pay now so the calls stop",
          "Hang up and ignore all later calls",
          "Ask them to send written proof of the debt first",
          "Give them your bank account number to confirm who you are",
        ],
        correctIndex: 2,
        explanation: "Asking for proof is your right. It slows the call down so you are not pushed into a rushed choice.",
      },
      {
        prompt: "Why ask for written proof instead of ignoring collection calls?",
        options: [
          "Ignoring the calls is against the law",
          "Proof is only useful for debts that you already know are fake",
          "Ignoring a real debt can make it worse; proof gets you facts",
          "Both choices work equally well in most cases",
        ],
        correctIndex: 2,
        explanation: "Avoiding feels safer for a moment but solves nothing. Asking for proof gets you real facts without paying under pressure.",
      },
    ],
  },
  {
    id: "beginner-30",
    tier: "beginner",
    order: 30,
    title: "Setting a real goal",
    body: "Most money advice ends with \"set a budget.\" That is too vague to act on. A real goal is specific. It might be a security deposit, a debt-free date, an emergency fund amount, or one purchase. Then break it into one dollar amount per week.\n\nPick check-in days that match when you get paid or when benefits arrive. Weekly, every two weeks or monthly all work. You then review your progress when you have new money to act on. A calendar date that matches nothing in your finances gives you nothing new to act on.",
    tryIt: null,
    checks: [
      {
        prompt: "Why is a weekly dollar amount better than just naming a goal, like \"save for a deposit\"?",
        options: [
          "You can track it and see each week if you hit it",
          "The law requires weekly amounts for savings goals",
          "Naming the goal is enough by itself",
          "Weekly amounts only work with a steady paycheck",
        ],
        correctIndex: 0,
        explanation: "\"Save for a deposit\" is hard to act on in any given week. A weekly dollar amount is something you can check yourself against.",
      },
      {
        prompt: "Why should your check-in days match your pay or benefit dates?",
        options: [
          "It makes no difference which check-in days you pick",
          "Calendar dates are a more accurate way to check",
          "Benefits are paid monthly, so the day does not matter",
          "You review when there is new money to act on",
        ],
        correctIndex: 3,
        explanation: "A check-in that lines up with when money moves is one you can act on right away.",
      },
      {
        prompt: "This lesson builds your goal from your own earlier numbers. Why does that matter?",
        options: [
          "Any starting numbers work just as well",
          "It is only a formality with no effect",
          "A goal built on your real numbers fits your real life",
          "Federal law requires using your own data",
        ],
        correctIndex: 2,
        explanation: "This is the same idea as lesson 17, \"Know your numbers.\" Real data beats a copied template at every step.",
      },
    ],
  },

  // ---------- INTERMEDIATE ----------
  {
    id: "intermediate-01",
    tier: "intermediate",
    order: 1,
    title: "Reading the three statements",
    body: "A company reports its results in three statements. The income statement shows revenue (money from sales) and profit over a period of time. The balance sheet is a snapshot. It shows what the company owns and owes on one day. The cash flow statement shows the real cash moving in and out.\n\nCash is the hardest number to fake. A company can show a profit on paper while its cash shrinks, for example when customers have not paid yet. If you see a profit but falling cash, look at receivables (money customers still owe) and inventory (goods not yet sold) before you trust the headline number.",
    tryIt: { label: "Security Analysis · Value Checklist" },
    checks: [
      {
        prompt: "A company reports a profit on its income statement, but its cash flow statement shows cash actually declining. What should that make you check?",
        options: [
          "Whether the profit is backed by cash or by unpaid sales",
          "No need to check, because profit on paper is cash in hand",
          "Whether the company is committing fraud on its books",
          "Whether the balance sheet can now be ignored",
        ],
        correctIndex: 0,
        explanation: "Profit is an accounting figure; cash flow shows what actually moved. A gap between them is exactly what the cash flow statement exists to surface.",
      },
      {
        prompt: "You want to know what a company owes in total debt right now, today. Which statement answers that?",
        options: [
          "The income statement, which covers a whole period of activity",
          "The balance sheet, a snapshot of what is owned and owed now",
          "The cash flow statement, which tracks cash coming in and going out",
          "Debt levels do not appear on any of the three statements",
        ],
        correctIndex: 1,
        explanation: "The balance sheet is a snapshot at a single point in time — assets, liabilities, and equity as they stand right now — unlike the income statement and cash flow statement, which both cover a period.",
      },
      {
        prompt: "A company's revenue is growing, but its accounts receivable (money owed by customers) is growing even faster. What might that suggest?",
        options: [
          "No concern, since faster receivables growth is a good sign",
          "The company is committing accounting fraud on its books",
          "Receivables have no connection to revenue at all",
          "It may be booking sales it has not collected cash for yet",
        ],
        correctIndex: 3,
        explanation: "Receivables growing faster than revenue can mean customers are taking longer to pay, or sales are being recognized before cash actually arrives — not proof of a problem, but a real flag worth checking against the cash flow statement.",
      },
    ],
  },
  {
    id: "intermediate-02",
    tier: "intermediate",
    order: 2,
    title: "Valuation: what \"cheap\" and \"expensive\" mean",
    body: "Two common ways to judge a price are P/E and P/B. P/E is the stock price divided by the company's yearly profit per share. P/B is the price divided by book value per share, which is the company's net worth on paper. A high P/E can mean a stock is overpriced. It can also mean investors expect much faster growth.\n\nDo not compare P/E ratios across very different industries. A software company and a utility have different growth and risk, so their normal P/E ranges are far apart. Compare a company with its own industry first.",
    tryIt: null,
    checks: [
      {
        prompt: "Company X has a P/E of 40. Its industry average P/E is 15. What's the correct first question?",
        options: [
          "Why X trades at a premium: growth, accounting or overvaluation",
          "X is clearly overpriced, so avoid it without further checks",
          "P/E does not matter when comparing two companies",
          "X should only ever be compared with the overall market",
        ],
        correctIndex: 0,
        explanation: "A large premium isn't automatically wrong — it demands an explanation (growth expectations, accounting differences, or real overvaluation) before you draw a conclusion.",
      },
      {
        prompt: "You compare a software company's P/E of 35 to a utility company's P/E of 15 and conclude the software company is overpriced. What's wrong with that comparison?",
        options: [
          "No problem; the comparison is valid for any pair of firms",
          "P/E should not be used for software companies at all",
          "Utility companies do not have a P/E ratio to compare",
          "The sectors differ in growth and risk, so normal P/Es differ",
        ],
        correctIndex: 3,
        explanation: "Comparing P/E across fundamentally different sectors is a classic mistake — a fast-growing software company and a slow, stable utility have different baseline \"normal\" multiples, so the comparison alone tells you little.",
      },
      {
        prompt: "A bank's P/E looks reasonable, but you also want to check its price against its book value. Why might P/B matter especially for a financial company?",
        options: [
          "P/B is irrelevant for banks, so it should be ignored",
          "P/B only applies to technology companies, not to banks",
          "Bank value is tied to balance sheet assets, so P/B helps",
          "P/B and P/E tell you the same thing about a bank",
        ],
        correctIndex: 2,
        explanation: "For asset-heavy financial companies, book value (the balance sheet's net worth) is often a more meaningful anchor than for, say, a software company whose value is mostly intangible — P/B is a standard complementary check there.",
      },
    ],
  },
  {
    id: "intermediate-03",
    tier: "intermediate",
    order: 3,
    title: "Market structure, briefly",
    body: "Stocks trade on exchanges. Market makers post two prices. The bid is what buyers will pay. The ask is what sellers want. The gap between them is the spread. If you buy at market, you pay the ask, not the middle price. If you sell at market, you get the bid.\n\nThis matters most for stocks that trade rarely. Their spreads can be wide, so the cost can be more than a few cents a share.",
    tryIt: null,
    checks: [
      {
        prompt: "You see a stock quoted at $50.00 bid / $50.05 ask. If you buy at market price right now, roughly what do you pay?",
        options: [
          "$50.00",
          "$50.025",
          "$49.95",
          "$50.05",
        ],
        correctIndex: 3,
        explanation: "A market buy order fills at the ask — the price sellers are currently willing to accept.",
      },
      {
        prompt: "You want to sell a stock right now at market price, quoted $50.00 bid / $50.05 ask. What price do you actually receive?",
        options: [
          "$50.05, the ask",
          "$50.025, the midpoint",
          "Any price you name",
          "$50.00, the bid",
        ],
        correctIndex: 3,
        explanation: "A market sell order fills at the bid — the price buyers are currently offering — the mirror image of a market buy filling at the ask.",
      },
      {
        prompt: "A thinly-traded small stock shows a $10.00 bid / $10.40 ask — a much wider spread than a heavily-traded large-cap. What does that wide spread cost you?",
        options: [
          "A real cost: a quick buy and resale loses about the spread",
          "No cost, because a spread does not change your actual return",
          "It signals that the stock is likely to go up soon",
          "Wide spreads only exist for options, not for stocks",
        ],
        correctIndex: 0,
        explanation: "A wide bid-ask spread is a real transaction cost — buying at the ask and selling at the bid loses that gap's worth of value even if the \"true\" price never moves, which matters most for thinly-traded names.",
      },
    ],
  },
  {
    id: "intermediate-04",
    tier: "intermediate",
    order: 4,
    title: "Building an actual diversified portfolio",
    body: "Real diversification is about correlation. Correlation shows how closely two holdings move together. It runs from -1 (opposite moves) to +1 (in lockstep). Two stocks in different industries can still move together if the same forces drive both.\n\nDo not just check that the company names look different. Check how closely the holdings actually move together. That is the difference between a portfolio that is truly spread out and one that only looks that way on paper.",
    tryIt: { label: "Portfolio Tracker · Correlation Finder" },
    checks: [
      {
        prompt: "You own stock in 3 different airlines. Are you well-diversified?",
        options: [
          "Yes, because three different companies make a diversified portfolio",
          "Diversification only counts once you own 10 or more holdings",
          "No, they likely move together on the same industry risks",
          "Airlines are generally uncorrelated with one another",
        ],
        correctIndex: 2,
        explanation: "Same industry usually means shared exposure to fuel costs, travel demand, and labor costs — 3 tickers, one real risk factor.",
      },
      {
        prompt: "Which pair is more likely to be genuinely diversifying against each other: (a) a grocery chain and a regional bank, or (b) two regional banks in the same state?",
        options: [
          "(b), since both are banks and so are safer together",
          "(a), since a grocer and a bank face different risks",
          "Both pairs diversify equally well, since all four firms differ",
          "Neither pair can ever provide any diversification",
        ],
        correctIndex: 1,
        explanation: "Two banks in the same region likely share overlapping exposure to local economic conditions and interest-rate sensitivity — a grocery chain's risks are meaningfully different, which is what real diversification is chasing.",
      },
      {
        prompt: "Two of your holdings show a correlation of 0.95. What does that number tell you?",
        options: [
          "They are almost uncorrelated, which is great diversification",
          "They move together almost in lockstep, so little benefit",
          "One stock's price move causes the other to move",
          "A 0.95 correlation means a 95% chance of profit",
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
    body: "The Federal Reserve (the Fed) sets short-term interest rates. Those rates change borrowing costs across the whole economy. When rates rise, the value today of future profits falls. This is called discounting. Growth stocks are hit hardest, because most of their profit is far in the future.\n\nThe yield curve compares short-term and long-term Treasury yields (the interest rates on US government bonds). When short-term yields rise above long-term yields, the curve is inverted. An inverted curve has come before every US recession since 1955, usually by 6 to 24 months, with one false alarm (San Francisco Fed, 2018).",
    tryIt: { label: "Top-Down Economic Analysis · Macro" },
    checks: [
      {
        prompt: "The Fed raises interest rates. All else equal, what typically happens to the present value of a company's far-future expected earnings?",
        options: [
          "It rises, since higher rates raise all future profits",
          "It is unchanged, since rates affect borrowing only",
          "It falls, since future cash flows are discounted more",
          "It becomes unlimited in size once the Fed raises rates",
        ],
        correctIndex: 2,
        explanation: "Higher discount rates reduce the present value of cash flows expected far in the future — which is why growth stocks are especially rate-sensitive.",
      },
      {
        prompt: "The Fed raises rates sharply. Which type of stock is typically hit harder: a high-growth company whose profits are expected mostly in 10+ years, or a stable company generating most of its profit today?",
        options: [
          "The stable firm, since it earns most of its profit today",
          "The high-growth firm, as more of its value lies far ahead",
          "Neither one is affected by interest rate changes",
          "Both are affected in about the same way by rate rises",
        ],
        correctIndex: 1,
        explanation: "Discounting hits distant cash flows harder than near-term ones — a growth stock's value leans heavily on profits expected years out, making it more rate-sensitive than a company already generating most of its profit now.",
      },
      {
        prompt: "The yield curve inverts — short-term Treasury yields rise above long-term yields. What has this historically tended to precede?",
        options: [
          "US recessions, though it is a pattern and not a sure thing",
          "A strong stock market rally in the next year",
          "No pattern at all, since the curve has no record as a signal",
          "An immediate return to normal short-term rates",
        ],
        correctIndex: 0,
        explanation: "An inverted curve has come before every US recession since 1955, usually by 6 to 24 months, with one false alarm (San Francisco Fed, 2018). It is a pattern, not a guaranteed forecast.",
      },
    ],
  },
  {
    id: "intermediate-06",
    tier: "intermediate",
    order: 6,
    title: "Sector rotation",
    body: "Sectors lead at different times in the economic cycle. Some sectors are called defensive: staples (food and basics), utilities and healthcare. People still buy these products in a recession, so the sectors tend to hold up. Other sectors are called cyclical: discretionary goods (things you can skip), homebuilders and industrials. They tend to lead when the economy recovers.\n\nThis is not a strict rule. But the pattern helps you tell \"the market is down\" from \"the market is rotating.\"",
    tryIt: { label: "Top-Down Economic Analysis · Sector" },
    checks: [
      {
        prompt: "The economy is entering a recession. Which sector has historically tended to hold up better?",
        options: [
          "Consumer discretionary, like luxury goods and travel",
          "Consumer staples, like groceries and household basics",
          "Homebuilders, since housing demand is steady in a downturn",
          "Airlines, since travel demand holds up in a downturn",
        ],
        correctIndex: 1,
        explanation: "People keep buying groceries and basics in a downturn in a way they don't keep buying luxury goods or new homes — that demand stability is what makes staples defensive.",
      },
      {
        prompt: "The economy is showing early signs of recovery after a recession. Which sector has historically tended to lead first?",
        options: [
          "Consumer staples, since people keep on buying food",
          "Utilities, since the demand for electricity is constant through the cycle",
          "Cyclical sectors, which gain as spending and output recover",
          "Healthcare, since illness ignores the economic cycle",
        ],
        correctIndex: 2,
        explanation: "Cyclical sectors — the ones most tied to discretionary spending and production — have historically tended to lead coming out of a downturn, the mirror image of defensives holding up better going into one.",
      },
      {
        prompt: "During a recession, a grocery chain's earnings barely move while a luxury car maker's earnings fall sharply. What does this illustrate?",
        options: [
          "Grocery chains are better investments than car makers",
          "Defensive and cyclical sectors react differently to recessions",
          "Luxury car makers do not recover from a recession",
          "Earnings do not depend on a company's sector at all",
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
    body: "Support and resistance are not magic lines. They mark prices where many buyers or sellers acted before. If a stock keeps bouncing at $40, real demand has shown up there more than once. That does not mean $40 has a special power.\n\nVolume is how many shares trade. It can back up or weaken a price move. A breakout on heavy volume shows strong conviction. The same move on thin volume is easier to doubt.",
    tryIt: { label: "Trading Analysis · Charts" },
    checks: [
      {
        prompt: "A stock keeps bouncing off $40 every time it drops there, then rising. What does $40 likely represent?",
        options: [
          "A random coincidence with no real meaning behind it at all",
          "A hard floor price that the stock is unable to break",
          "The exact book value of the company per share",
          "A support level, where real buy orders tend to cluster",
        ],
        correctIndex: 3,
        explanation: "Support reflects a real pattern of buying interest at that price — useful information, but never a guarantee the level holds next time.",
      },
      {
        prompt: "A stock has tried and failed to rise above $75 three separate times over the past few months. What does $75 likely represent?",
        options: [
          "A support level, where buy orders cluster in the stock",
          "A random number with no real significance for the stock",
          "A resistance level, where sellers keep showing up",
          "A hard ceiling price that the stock is unable to cross",
        ],
        correctIndex: 2,
        explanation: "Resistance is the mirror image of support — a price where selling interest has repeatedly shown up, worth noting as real information, never treated as an unbreakable ceiling.",
      },
      {
        prompt: "A stock breaks above its $75 resistance level, but on unusually light trading volume. How should that affect your confidence in the breakout?",
        options: [
          "Full confidence, since any breakout is equally meaningful",
          "Volume does not matter when you read a price chart",
          "Lower, because light volume shows weaker conviction",
          "Light volume means the breakout will fail within a day",
        ],
        correctIndex: 2,
        explanation: "Volume is what separates a conviction-backed move from a thin, easily-reversed one — the same breakout on heavy volume is generally read as more meaningful than on light volume.",
      },
    ],
  },
  {
    id: "intermediate-08",
    tier: "intermediate",
    order: 8,
    title: "Why \"backtested\" isn't proof",
    body: "A strategy that wins 9 of 10 trades sounds great. But 10 trades is too few to tell a real edge from a lucky streak. To judge a strategy well, you need three things. First, a large sample. Second, a correction for testing many ideas at once. Third, proof that the pattern also holds on data it was not built on.\n\nThis app's backtests follow that rule. Every result shows its sample size, because that number often separates a real signal from noise.",
    tryIt: { label: "Trading Analysis · Backtest" },
    checks: [
      {
        prompt: "A strategy shows a 90% win rate over 10 trades. How much should that convince you it's a real edge?",
        options: [
          "Fully, since a 90% win rate is a high win rate",
          "It proves that the strategy will keep working in the future",
          "Sample size does not matter if the win rate is high",
          "Very little, since 10 trades is too small to rule out luck",
        ],
        correctIndex: 3,
        explanation: "Small samples can easily produce an impressive-looking win rate by chance — real confidence needs a much larger, statistically evaluated sample.",
      },
      {
        prompt: "The same strategy that showed a 90% win rate over 10 trades is retested over 500 trades and the win rate settles at 54%. What does this illustrate?",
        options: [
          "The strategy lost its edge as more time went by",
          "Even 500 trades is still too small to trust any result",
          "The 10-trade sample was too small to show the real edge",
          "Win rate means little, even over many trades",
        ],
        correctIndex: 2,
        explanation: "This is exactly why small samples mislead — 10 trades can easily produce a flattering result by chance, while a much larger sample converges toward the strategy's real, often less impressive, edge.",
      },
      {
        prompt: "A trading rule is tuned using years of historical data until it performs great specifically on that data, then never tested on any other period. What's the risk?",
        options: [
          "Overfitting: the rule may memorize quirks of that data",
          "Low risk, since strong past results are proof enough",
          "The rule is sure to keep working once it fits the past",
          "This is the proper way to build any trading strategy",
        ],
        correctIndex: 0,
        explanation: "A rule tuned tightly to one historical dataset with no out-of-sample check risks overfitting — looking great on the data it was built from while capturing noise rather than a real, repeatable edge.",
      },
    ],
  },
  {
    id: "intermediate-09",
    tier: "intermediate",
    order: 9,
    title: "Options, before the Greeks",
    body: "A call option is a bet that a stock will rise above a set price, called the strike, before a set date. A put option is the reverse. It is a bet that the stock will fall below the strike. You pay a price up front to buy an option. That price is the premium. Every option has an expiration date. After that date it is worthless if the bet did not pay off.\n\nA call only makes money if the stock ends above the strike by more than the premium you paid. A put needs the stock to fall below the strike by more than the premium. This lesson stops before the Greeks (delta, gamma, theta and vega). Those come in the Expert tier. For now, focus on the shape of the payoff.",
    tryIt: null,
    checks: [
      {
        prompt: "You buy a call option on a stock. What are you betting on?",
        options: [
          "The stock price falling below the strike before expiration",
          "The stock price rising above the strike before expiration",
          "The company going bankrupt before the expiration date",
          "No view at all, since calls carry no directional bet on price",
        ],
        correctIndex: 1,
        explanation: "A call gains when the stock rises above the strike before expiration. To profit overall, the rise has to be bigger than the premium you paid. A put is the mirror image.",
      },
      {
        prompt: "You buy a put option on a stock. What are you betting on?",
        options: [
          "The stock price falling below the strike before expiration",
          "The stock price rising above the strike before expiration",
          "The company paying out a larger dividend before expiration",
          "No view at all, since puts carry no directional bet like calls do",
        ],
        correctIndex: 0,
        explanation: "A put gains when the stock falls below the strike before expiration. To profit overall, the fall has to be bigger than the premium you paid. A call is the mirror image.",
      },
      {
        prompt: "You hold a call option with a strike price of $100. At expiration, the stock is trading at $95. What happens to your option?",
        options: [
          "It expires worthless, since the stock stayed below $100",
          "It is exercised automatically, and you buy the stock at $100 anyway",
          "You are paid the gap in cash whatever the price is",
          "The expiration date extends itself automatically by a month",
        ],
        correctIndex: 0,
        explanation: "A call only has value if the stock is above the strike price — at $95 against a $100 strike, there's no reason to exercise it, so it simply expires worthless.",
      },
    ],
  },
  {
    id: "intermediate-10",
    tier: "intermediate",
    order: 10,
    title: "The biases that wreck a good plan",
    body: "Loss aversion means a loss hurts more than an equal gain feels good. The disposition effect is one result. Investors sell winners too early, to lock in a good feeling. They hold losers too long, hoping for a comeback. That is the opposite of \"cut losses, let winners run.\"\n\nTwo other biases are common. Recency bias means giving too much weight to what just happened and assuming a recent trend will go on. Confirmation bias means favoring facts that agree with what you already believe. For most investors, these biases cause more avoidable losses than a lack of market knowledge does.",
    tryIt: null,
    checks: [
      {
        prompt: "You sell a winning stock quickly to lock in the gain, but hold a losing stock far too long hoping it will come back. What bias is this closest to?",
        options: [
          "Recency bias, from overweighting recent events",
          "Loss aversion, shown as the disposition effect",
          "Confirmation bias, from seeking supporting news",
          "Anchoring, from fixing on the first price seen",
        ],
        correctIndex: 1,
        explanation: "Selling winners too soon and holding losers too long is the textbook disposition effect, rooted in loss aversion (Shefrin and Statman, 1985; Odean, 1998).",
      },
      {
        prompt: "A stock has risen for 6 straight months, and an investor assumes it will \"obviously\" keep rising forever, ignoring any signs of slowing. What bias is this?",
        options: [
          "Recency bias, which treats a recent trend as permanent",
          "Loss aversion, which weighs losses more than gains",
          "Anchoring, which fixes on the first number you have seen",
          "The disposition effect, which sells winners too soon",
        ],
        correctIndex: 0,
        explanation: "Recency bias is exactly this pattern — extrapolating a recent trend forward as though it's guaranteed to continue, rather than weighing the full range of outcomes.",
      },
      {
        prompt: "An investor who already owns a stock only reads articles that praise the company and dismisses every negative report as \"fake news.\" What bias is this?",
        options: [
          "Recency bias, which overweights whatever just happened lately",
          "Loss aversion, which weighs losses more than gains",
          "Anchoring, which fixes on the first number seen",
          "Confirmation bias, which favors facts that agree with you",
        ],
        correctIndex: 3,
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
    body: "Delta, gamma, theta and vega describe how an option's value changes. Delta is the change when the stock price moves. Gamma is how fast delta changes. Theta is the value lost as time passes. Vega is the effect of a change in volatility. Added up across a whole options chain, these numbers show how options dealers are positioned. Dealers are the firms that usually take the other side of customer trades.\n\nWhen dealers are net short gamma, their hedging adds to price moves. They sell into declines and buy into rallies to stay hedged. When they are net long gamma, their hedging calms price moves. This is what this app's GEX signal is built to show. It rests on assumptions about how dealers are positioned, so treat it as a model, not a fact.",
    tryIt: { label: "Options · GEX & Dealer Positioning" },
    checks: [
      {
        prompt: "Dealers are net short gamma on a stock. As the price falls, what does their hedging typically do to that move?",
        options: [
          "Amplifies it, since they sell into the decline",
          "Dampens it, since they buy dips to stay hedged",
          "Has no effect on the stock's price in any real way",
          "Only affects the options market, not the stock",
        ],
        correctIndex: 0,
        explanation: "Short-gamma dealers must trade in the same direction as the move to stay hedged — selling into a decline, buying into a rally — which can amplify the move.",
      },
      {
        prompt: "Dealers are net long gamma on a stock. As the price rises, what does their hedging typically do to that move?",
        options: [
          "Amplifies it, since they chase the rally higher and higher",
          "Dampens it, since they sell rallies and buy dips",
          "Has no effect on the stock price in any case",
          "Long gamma only matters for puts, not for calls",
        ],
        correctIndex: 1,
        explanation: "Long-gamma dealers hedge in the opposite direction of the move — selling as price rises, buying as it falls — which tends to dampen volatility, the mirror image of the short-gamma amplification case.",
      },
      {
        prompt: "An option loses value every day purely from the passage of time, even if the stock price doesn't move at all. Which Greek describes this?",
        options: [
          "Delta, which measures price sensitivity",
          "Gamma, which measures how delta changes",
          "Vega, which measures volatility sensitivity",
          "Theta, the measure of time decay",
        ],
        correctIndex: 3,
        explanation: "Theta measures an option's rate of value decay purely from time passing, holding everything else constant — it's why option buyers are effectively fighting a clock, not just a price direction.",
      },
    ],
  },
  {
    id: "expert-02",
    tier: "expert",
    order: 2,
    title: "Portfolio theory in depth",
    body: "The Sharpe ratio measures return per unit of risk. Take the expected return, subtract the risk-free rate (the return on a very safe asset, such as short-term Treasury bills), and divide by volatility. A higher Sharpe ratio means the portfolio earned more for the risk it took, not just more in total.\n\nThe efficient frontier is the set of portfolios with the best expected return for each level of risk. A portfolio below the frontier is leaving return on the table for the risk it takes.",
    tryIt: { label: "Portfolio Tracker · Modern Portfolio Theory" },
    checks: [
      {
        prompt: "Two portfolios have the same expected return, but Portfolio A has lower volatility. Which has the higher Sharpe ratio?",
        options: [
          "Portfolio B, the one with higher volatility",
          "They are equal when the return is the same",
          "Sharpe ratio does not use volatility at all",
          "Portfolio A, the one with lower volatility",
        ],
        correctIndex: 3,
        explanation: "Same return, less risk taken to get it — that's a strictly better risk-adjusted outcome, which the Sharpe ratio is built to capture.",
      },
      {
        prompt: "A portfolio sits well below the efficient frontier. What does that mean?",
        options: [
          "It has the best possible risk-adjusted return available",
          "It is a portfolio that carries no risk of loss",
          "A frontier portfolio could earn more for the same risk",
          "The frontier does not apply to real portfolios",
        ],
        correctIndex: 2,
        explanation: "The efficient frontier represents the best expected-return-per-unit-of-risk achievable — a portfolio below it is taking on risk without being compensated as well as it could be for that same risk level.",
      },
      {
        prompt: "Portfolio A returns 12% with 20% volatility; Portfolio B returns 9% with 10% volatility (risk-free rate 2%). Which likely has the higher Sharpe ratio?",
        options: [
          "Portfolio A, since its raw return of 12% is the higher one",
          "They are identical, since both beat the risk-free rate",
          "Portfolio B, with 0.70 against A's 0.50 per unit of risk",
          "Sharpe ratios cannot be compared across portfolios at all",
        ],
        correctIndex: 2,
        explanation: "Sharpe ratio = (return − risk-free rate) ÷ volatility. A: (12−2)/20 = 0.50. B: (9−2)/10 = 0.70 — B delivered more return per unit of risk, even though its raw return was lower.",
      },
    ],
  },
  {
    id: "expert-03",
    tier: "expert",
    order: 3,
    title: "Evaluating a strategy like a statistician",
    body: "Suppose you test many trading signals and report only the one that looks significant. This is the multiple-comparisons trap. With enough tests, some will look significant by pure chance. Methods such as Benjamini-Hochberg FDR (false discovery rate) raise the bar for significance based on how many tests you ran.\n\nTwo more ideas matter. Out-of-sample testing checks whether a pattern holds on data it was not built on. Overfitting is a strategy tuned so tightly to past data that it fails on new data. Together, these decide whether you can take a backtest seriously.",
    tryIt: { label: "Glossary · Statistics terms" },
    checks: [
      {
        prompt: "You test 20 different trading signals and 1 comes back statistically significant at p<0.05. Should you trust it as a real edge?",
        options: [
          "Yes, trust it, because p below 0.05 means it is real",
          "No correction is ever needed when you run many tests",
          "P-values do not apply to trading strategies at all",
          "Be skeptical: with 20 tests, one false positive is expected",
        ],
        correctIndex: 3,
        explanation: "This is exactly what FDR correction exists to guard against — at a 5% significance threshold, roughly 1 in 20 tests will look significant purely by chance.",
      },
      {
        prompt: "A strategy performs great on 2015-2020 data. Before trusting it, what's the key next step?",
        options: [
          "Deploy it right away with a large amount of real money",
          "Test it on a separate period it was not built on",
          "No more testing is needed since the past result is proof",
          "Re-run the same test again on the same 2015-2020 data",
        ],
        correctIndex: 1,
        explanation: "Out-of-sample testing — checking whether a pattern holds on data it wasn't built or tuned on — is the standard next step to distinguish a real, repeatable edge from a strategy that was simply fit to noise in one period.",
      },
      {
        prompt: "Why does testing many signals at once require a stricter significance bar (like FDR correction) than testing just one?",
        options: [
          "It does not; one signal and many should use the same bar",
          "More signals make the results more reliable overall",
          "FDR correction is only used in medicine, not in finance",
          "More signals raise the odds that one looks good by chance",
        ],
        correctIndex: 3,
        explanation: "The more signals you test, the more opportunities for a false positive to slip through by pure chance — FDR-style correction raises the bar for significance in proportion to how many tests were run, to keep the false-positive rate honest.",
      },
    ],
  },
  {
    id: "expert-04",
    tier: "expert",
    order: 4,
    title: "Macro-to-position synthesis, cross-asset",
    body: "Fiscal policy (government spending and taxes) and monetary policy (central bank rates) do not only move stocks. They also move currencies, commodities and interest rates, and the mechanics differ in each. A stronger dollar, often caused by higher US rates, tends to push down commodities priced in dollars. It takes fewer dollars to buy the same amount of oil or gold.\n\nThe goal is to understand these links between markets. Knowing that \"rates went up and stocks went down\" is only headline reaction. Knowing why each market moves is real macro analysis.",
    tryIt: { label: "Currency / Futures / Commodities tabs" },
    checks: [
      {
        prompt: "The dollar strengthens sharply due to Fed policy. All else equal, what's the typical initial pressure on dollar-denominated commodities like oil and gold?",
        options: [
          "Upward pressure, since a strong dollar attracts buyers",
          "There is no relationship between them at all",
          "Commodities move with the dollar, not against it, in most cases",
          "Downward pressure, since fewer dollars buy the same amount",
        ],
        correctIndex: 3,
        explanation: "Commodities priced in dollars get more expensive in other currencies when the dollar strengthens, typically pressuring dollar-priced demand and price lower.",
      },
      {
        prompt: "The dollar weakens sharply. All else equal, what's the typical initial effect on dollar-denominated commodities like oil and gold?",
        options: [
          "Downward pressure, mirroring the effect of a strong dollar",
          "Upward pressure, since it takes more dollars per unit",
          "No relationship exists between currency and commodity prices",
          "Commodity prices do not react to any moves in currencies",
        ],
        correctIndex: 1,
        explanation: "This is the mirror image of the strong-dollar case — a weaker dollar means the same physical quantity of a globally-priced commodity now costs more in dollar terms, typically supporting higher dollar-denominated prices.",
      },
      {
        prompt: "The U.S. raises interest rates while other major economies hold theirs steady. All else equal, what does this rate differential typically do to the dollar?",
        options: [
          "It tends to strengthen it, as higher yields attract capital",
          "It weakens it, since higher rates make borrowing costly for everyone",
          "It has no effect on the value of any currency",
          "It only affects bond prices and not currencies",
        ],
        correctIndex: 0,
        explanation: "Higher relative interest rates tend to attract capital seeking yield, increasing demand for the currency offering it — a core mechanism behind how rate differentials move currency valuations.",
      },
    ],
  },
  {
    id: "expert-05",
    tier: "expert",
    order: 5,
    title: "Market microstructure",
    body: "Liquidity is how easily you can trade without moving the price. It is not constant. It is thin in the pre-market and in stocks that trade rarely. It is thick at the open and close of a liquid large-cap. A big order moves the price more in a thin order book than in a deep one, because fewer resting orders can absorb it.\n\nThis app says plainly what it cannot verify. It has no tick-level or order-book data at this budget tier. Anything beyond simple snapshot signals, like same-day options volume and open interest (the number of contracts still open), is left out instead of faked.",
    tryIt: null,
    checks: [
      {
        prompt: "A large sell order hits a stock with thin order-book liquidity at that moment. Compared to hitting during a liquid, high-volume window, what's more likely?",
        options: [
          "A larger price impact, since fewer orders absorb the trade",
          "The same price impact whatever the liquidity is",
          "No price impact at all, since the exchange sets prices",
          "Liquidity only matters for options, not for stocks",
        ],
        correctIndex: 0,
        explanation: "Thin liquidity means fewer orders sitting at nearby prices to absorb a large trade, so the same order size moves the price further.",
      },
      {
        prompt: "A large order is placed in the pre-market session versus the same size order placed during the 9:30-10:00am opening window. Which is more likely to move the price further?",
        options: [
          "The 9:30 to 10:00 order, since more people are watching at that time",
          "Both have the same impact whatever the time of day",
          "The pre-market order, since liquidity is much thinner then",
          "Pre-market has no liquidity at all, so no trades occur",
        ],
        correctIndex: 2,
        explanation: "Liquidity isn't constant throughout the day — it's characteristically thin in the pre-market and thickest around the open/close of regular trading, so the same order size can move price much more when liquidity is thin.",
      },
      {
        prompt: "This app has no tick-level or order-book data source. How does it handle claims that would need that kind of data?",
        options: [
          "It makes up believable numbers to fill in the data gap",
          "It stays out of scope instead of faking such claims",
          "It ignores the gap and shows estimates as real data",
          "It switches to a different, less accurate provider instead",
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
    body: "The Net Current Asset Value (NCAV) method compares a stock's price with current assets minus all liabilities. It ignores long-term assets and goodwill (the extra amount paid for a company above the value of its assets). The result is a cautious, liquidation-style floor. It shows what might be left for shareholders if the company were wound down today, counting only the most liquid assets.\n\nThis app's Value Checklist uses the full 7-criteria version of this method. It leaves out analyst price targets on purpose. Forecasting is not part of this classic value approach.",
    tryIt: { label: "Security Analysis · full Checklist" },
    checks: [
      {
        prompt: "What does the NCAV approach deliberately exclude from a company's valuation?",
        options: [
          "All current liabilities that the company owes to its lenders",
          "All of the current assets that the company holds in stock",
          "Long-term assets and goodwill, giving a cautious floor",
          "The cash held on the company's balance sheet",
        ],
        correctIndex: 2,
        explanation: "NCAV is deliberately conservative — it only counts current assets against all liabilities, ignoring long-term assets and goodwill that might not hold their value in a real liquidation.",
      },
      {
        prompt: "Why is the NCAV approach described as a conservative 'liquidation-style floor' rather than a full valuation?",
        options: [
          "It credits only liquid current assets and ignores shaky ones",
          "It counts all assets the company owns at full value",
          "It gives a higher value than most other methods do",
          "It is not conservative; it is the most aggressive method",
        ],
        correctIndex: 0,
        explanation: "NCAV deliberately strips out long-term/fixed assets and goodwill — the assets least certain to retain their book value in an actual liquidation — leaving a conservative floor rather than a full going-concern valuation.",
      },
      {
        prompt: "This app's Value Checklist deliberately excludes analyst price targets. Why?",
        options: [
          "Forecasting is not part of this classic value approach",
          "Analyst price targets are illegal to use in an app",
          "Analyst targets are wrong too often, so they are skipped",
          "No reason; leaving them out is simply an oversight",
        ],
        correctIndex: 0,
        explanation: "This classic value approach is deliberately grounded in current, verifiable facts about a business — forecasting future prices was never part of it, so this app's checklist stays consistent with that by excluding forward price targets.",
      },
    ],
  },
  {
    id: "expert-07",
    tier: "expert",
    order: 7,
    title: "Portfolio-level risk management",
    body: "You can hedge a concentrated position (a large share of your money in one holding) without selling it. A protective put sets a floor under your losses while keeping the upside, minus the cost of the put. Real risk management is about sizing: how much protection to buy, at what cost, against how much of the position.\n\nDrawdown is the fall from a portfolio's peak. Limiting it matters because recovering takes a bigger gain than the loss. A 50% loss needs a 100% gain just to break even.",
    tryIt: { label: "Portfolio Tracker · Risk & Rebalancing" },
    checks: [
      {
        prompt: "You hold a concentrated position and want to limit downside without selling. What's the direct hedging tool for that?",
        options: [
          "Buy more shares of the same stock to average down",
          "Buy a protective put (or something similar) on the position",
          "Ignore it, since protecting a concentrated position is not needed",
          "Switch the whole position into a savings account",
        ],
        correctIndex: 1,
        explanation: "A protective put caps downside risk on a held position while leaving the position itself — and its upside — intact.",
      },
      {
        prompt: "A portfolio falls 50% from its peak. How much of a gain is needed just to get back to breakeven?",
        options: [
          "50%, since the gain needed matches the loss itself",
          "25%, since the market usually helps a recovery",
          "100%, since big losses need much bigger gains",
          "No gain, since it recovers over time by itself",
        ],
        correctIndex: 2,
        explanation: "Losses and the gains needed to recover from them aren't symmetric — a $100 position that falls 50% to $50 needs a 100% gain just to get back to $100, exactly why limiting large drawdowns matters so much.",
      },
      {
        prompt: "A protective put caps downside risk on a held position. What's the direct tradeoff for that protection?",
        options: [
          "The premium paid, which cuts returns if the stock rises",
          "No cost; protective puts are free to buy and hold",
          "You permanently lose the right to sell the stock later",
          "It automatically doubles the size of your position",
        ],
        correctIndex: 0,
        explanation: "Buying a protective put isn't free — its premium is a real cost that eats into returns if the downside protection ends up not being needed, the standard tradeoff of any insurance-like hedge.",
      },
    ],
  },
  {
    id: "expert-08",
    tier: "expert",
    order: 8,
    title: "Building a full top-down thesis",
    body: "This is the capstone lesson. A real investment thesis links three layers into one clear argument that could be proven wrong: the macro and fiscal backdrop, the sector, and the company's fundamentals and chart. No single layer is enough. A cheap P/E means little if the sector is shrinking for good. A great macro backdrop means little for a company whose business is getting worse.\n\nThis is the chain this app's assistant walks when asked \"should I buy this?\" It shows what each layer of real data says. It does not give a buy or sell order.",
    tryIt: null,
    checks: [
      {
        prompt: "You're evaluating whether a defense-sector stock is attractive right now. Which single fact, alone, is enough to decide?",
        options: [
          "The stock's P/E ratio, taken on its own with no context",
          "None alone; a thesis links macro, sector and company facts",
          "Whichever pick a friend recommended to you",
          "The stock's price change over the past day",
        ],
        correctIndex: 1,
        explanation: "A real thesis is a synthesis across layers — no single number, however important, substitutes for connecting macro, sector, and company-level evidence.",
      },
      {
        prompt: "A sector has a highly favorable macro backdrop right now, but the specific company you're evaluating has deteriorating margins and rising debt. Is a favorable sector macro read enough to make the stock attractive?",
        options: [
          "Yes, since the macro backdrop alone decides each buy",
          "Company fundamentals do not matter if the sector is strong",
          "This does not occur, since macro and company results move together",
          "No; a good macro read cannot offset weak company fundamentals",
        ],
        correctIndex: 3,
        explanation: "This is exactly the trap a top-down thesis guards against — a favorable macro or sector backdrop doesn't rescue a company whose own fundamentals are genuinely deteriorating; all three layers have to line up.",
      },
      {
        prompt: "When this app's assistant is asked \"should I buy this stock,\" what is it built to do?",
        options: [
          "Give you a direct buy or sell recommendation",
          "Refuse to answer any question about stocks, no matter how it is asked",
          "Walk the top-down chain and show what each data layer says",
          "Guess from the stock's recent price action alone",
        ],
        correctIndex: 2,
        explanation: "The assistant is built to run the same top-down synthesis a real thesis requires — presenting the real data at each layer — while stopping short of a buy/sell directive, matching this app's consistent boundary against giving personalized investment advice.",
      },
    ],
  },
];

export const PLACEMENT_QUESTIONS: PlacementQuestion[] = [
  // Beginner probes
  {
    tier: "beginner",
    prompt: "Prices are rising faster than the interest your savings account pays. What is happening to your money?",
    options: [
      "It buys less each year, even as the balance grows",
      "It grows faster than prices are rising",
      "It is fully protected against rising prices and inflation",
      "It doubles in value in each year that passes",
    ],
    correctIndex: 0,
  },
  {
    tier: "beginner",
    prompt: "What does it mean to diversify your investments?",
    options: [
      "Put all of your money into the single best stock that you can find",
      "Buy only shares of the company where you work",
      "Spread your money across many holdings so a single loss is survivable",
      "Keep all of your money in cash at home",
    ],
    correctIndex: 2,
  },
  {
    tier: "beginner",
    prompt: "Which of these is usually called good debt?",
    options: [
      "A mortgage on a home you can afford, at a fair rate",
      "A payday loan with a 300% APR",
      "Maxing out a credit card on a vacation",
      "All debt is the same, and all of it is bad, so avoid it",
    ],
    correctIndex: 0,
  },
  {
    tier: "beginner",
    prompt: "Your paycheck is smaller than your salary suggests. What is the best reason?",
    options: [
      "Your employer made a math mistake on it",
      "Taxes and other items are taken out before you are paid",
      "New workers are paid less than the salary says they are",
      "A paycheck should match your salary to the dollar",
    ],
    correctIndex: 1,
  },
  {
    tier: "beginner",
    prompt: "What is the main idea of the 50/30/20 budget rule?",
    options: [
      "Spend half of your pay on fun and games",
      "Save half of your pay, no matter what bills you owe each month",
      "Split your pay between needs, wants and savings on purpose",
      "Only people with high pay can use it",
    ],
    correctIndex: 2,
  },
  {
    tier: "beginner",
    prompt: "What is the main job of an emergency fund?",
    options: [
      "To invest hard for the highest possible return",
      "To replace your regular savings account for good and all",
      "To work in the same way as a retirement account does",
      "To pay for surprise costs without going into debt",
    ],
    correctIndex: 3,
  },
  // Intermediate probes
  {
    tier: "intermediate",
    prompt: "A stock's P/E ratio (its price divided by its yearly profit per share) is 40. Its industry average is 15. What does that tell you by itself?",
    options: [
      "The stock is a bad buy and should be sold",
      "The company will grow its profit by 40% next year",
      "P/E ratios do not tell you anything about a stock",
      "Not much alone; you need growth and industry context",
    ],
    correctIndex: 3,
  },
  {
    tier: "intermediate",
    prompt: "Two companies are in very different industries. Why might their stock prices still move together?",
    options: [
      "That cannot happen across different industries",
      "They can react to the same big economic forces",
      "Prices only move together inside one industry",
      "Individual stocks do not move together at all",
    ],
    correctIndex: 1,
  },
  {
    tier: "intermediate",
    prompt: "A trading strategy won 8 times in a row in a test on past data. What should you check before you trust it?",
    options: [
      "No checks are needed; 8 wins is plenty of proof",
      "Whether there are enough trades, and whether it works on new data",
      "How much money it would have made in the test on past data",
      "Whether the price chart looks good",
    ],
    correctIndex: 1,
  },
  {
    tier: "intermediate",
    prompt: "The share of your credit limit that you use jumps from 10% to 80% on one card. What is the most likely effect on your credit score?",
    options: [
      "No effect, since use of your limit does not matter",
      "It goes up on its own",
      "It will probably drop, since high use looks risky",
      "It only matters if you miss a payment",
    ],
    correctIndex: 2,
  },
  {
    tier: "intermediate",
    prompt: "What is the main job of a stop-loss order?",
    options: [
      "To sell automatically if the price falls to a set level",
      "To lock in a profit no matter what happens",
      "To buy more shares automatically as the price rises over time",
      "To remove all risk from the position",
    ],
    correctIndex: 0,
  },
  {
    tier: "intermediate",
    prompt: "All else equal, how does a bond's time to maturity affect how much its price moves when interest rates change?",
    options: [
      "Longer bonds move more when rates change",
      "Longer bonds move less when rates change",
      "Time to maturity has no effect on price moves",
      "Bond prices do not react to rate changes at all",
    ],
    correctIndex: 0,
  },
  // Expert probes
  {
    tier: "expert",
    prompt: "Options dealers hold a large \"short gamma\" position, so they must sell as the price falls and buy as it rises. What does that hedging tend to do to price swings?",
    options: [
      "It calms swings, since they trade against the move, not with it",
      "It has no effect on the stock at all",
      "It only matters on options expiration day",
      "It can amplify swings, since they trade with the move",
    ],
    correctIndex: 3,
  },
  {
    tier: "expert",
    prompt: "You run 15 statistical tests to look for a trading edge, and one is significant at p<0.05. What should worry you most?",
    options: [
      "A false positive: some tests look significant by chance",
      "No worry at all; p<0.05 means the result is real",
      "P-values do not apply to finance",
      "The test must be right, since its p-value is below 0.05",
    ],
    correctIndex: 0,
  },
  {
    tier: "expert",
    prompt: "What does the Net Current Asset Value (NCAV) method leave out of a company's value?",
    options: [
      "All of the company's current liabilities, as well as its debts",
      "All of its current assets, such as cash",
      "Long-term assets and goodwill, giving a cautious floor",
      "Only the cash held on its balance sheet",
    ],
    correctIndex: 2,
  },
  {
    tier: "expert",
    prompt: "A portfolio's 95% one-day Value at Risk (VaR) is $10,000. What does that mean?",
    options: [
      "It cannot lose more than $10,000 in a single day, whatever happens",
      "On most days loss stays under $10,000; bad days can be far worse",
      "It will lose about $10,000 tomorrow, no more or less",
      "The most it can lose is capped at $10,000 for the year",
    ],
    correctIndex: 1,
  },
  {
    tier: "expert",
    prompt: "On the efficient frontier, what does the maximum-Sharpe-ratio portfolio give you?",
    options: [
      "The highest return, with risk ignored",
      "The lowest risk, whatever the return turns out to be",
      "An equal share of all of the assets available to buy",
      "The most return for each unit of risk taken",
    ],
    correctIndex: 3,
  },
  {
    tier: "expert",
    prompt: "Short-term Treasury yields rise above long-term yields (an inverted yield curve). What has this historically come before?",
    options: [
      "A recession in about 12 months, on a fixed schedule",
      "US recessions, usually 6 to 24 months later, with one false alarm",
      "A sure rise in stock prices over the next year",
      "No link; it has had no tie to recessions in any period",
    ],
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
