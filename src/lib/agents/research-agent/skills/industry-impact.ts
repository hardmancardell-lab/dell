export interface IndustryImpact {
  id: string;
  name: string;
  primaryDrivers: string[]; // indicator-library ids most relevant to this industry
  analysis: string;
}

/**
 * Industry-by-industry macro sensitivity analysis. This is analytical
 * content, not fetched data — written once, not pulled live from any API.
 * `primaryDrivers` references ids from indicator-library.ts so the UI can
 * cross-link an industry card to the actual chart for its key drivers.
 */
export const INDUSTRY_IMPACTS: IndustryImpact[] = [
  {
    id: "technology",
    name: "Technology (Hardware & Enterprise IT)",
    primaryDrivers: ["yield-curve", "sloos-tightening", "durable-goods", "cfnai"],
    analysis:
      "Tech is a duration play before it's an operating business: most of the sector's value sits in cash flows expected years out, so its valuations are unusually sensitive to the discount rate implied by the yield curve and Fed policy — rate hikes compress tech multiples faster and harder than almost any other sector, independent of whether the underlying businesses are actually slowing. On the real-economy side, enterprise IT and hardware spending is business capex, so it tracks durable goods orders and the broader business-cycle composite (CFNAI) closely — when businesses pull back on investment, IT budgets are an early casualty. Credit tightening (SLOOS) matters doubly here: it raises financing costs for the sector's own debt-funded R&D and buybacks, and it signals the same capex pullback from its enterprise customers. Labor costs (engineering talent) are a secondary but real margin lever, particularly during wage-inflation regimes.",
  },
  {
    id: "software",
    name: "Software / SaaS",
    primaryDrivers: ["yield-curve", "sloos-tightening", "consumer-sentiment"],
    analysis:
      "Even more rate-sensitive than hardware tech, because SaaS valuations are built almost entirely on long-duration recurring-revenue projections — a move in the discount rate has an outsized effect on present value here. Unprofitable, growth-at-all-costs software names are additionally exposed to credit conditions directly: when SLOOS shows tightening, the venture debt and convertible financing many of these companies rely on gets more expensive or disappears, forcing a shift from growth to margin discipline. Enterprise software tracks business confidence and IT budget cycles (durable goods orders as a proxy for capex intent); consumer-facing SaaS instead tracks consumer sentiment and discretionary spending capacity. The common thread: software is a claim on someone else's future spending decision, so anything that makes the future look less certain — rate uncertainty, credit tightening, sentiment deterioration — hits it before it hits the real economy.",
  },
  {
    id: "semiconductors",
    name: "Semiconductors",
    primaryDrivers: ["durable-goods", "cfnai", "sloos-tightening"],
    analysis:
      "The most structurally cyclical industry in this list: semiconductor demand is a second derivative of global electronics and industrial demand, which makes the boom-bust swings more violent than the underlying economy's own cycle (a small slowdown in end-demand can turn into a sharp inventory correction up the supply chain). Because fabs cost tens of billions of dollars and take years to build, this is also one of the most capital-intensive, credit-dependent industries in existence — tightening credit conditions (SLOOS) directly threaten the financing of new capacity, while a global manufacturing slowdown (best read via durable goods orders and broad activity composites like CFNAI, since US-only data understates a genuinely global-demand industry) shows up in orders and bookings before it shows up in revenue. The industry's own book-to-bill ratio and capacity utilization (see the Sector tab) are the highest-frequency, most direct real-time signals — macro indicators here are confirming context, not the primary read.",
  },
  {
    id: "energy",
    name: "Energy (Oil & Gas)",
    primaryDrivers: ["cfnai", "core-pce"],
    analysis:
      "Energy demand is a direct function of global industrial activity — it's consumed by factories, freight, and travel, not primarily by discretionary household choice — so broad activity composites (CFNAI, and ideally global PMI data if you can source it) matter more here than US-consumer-focused indicators. The relationship with inflation runs in both directions: energy prices are themselves a major input to CPI/PPI, so this sector doesn't just react to inflation, it helps cause it, which makes the usual macro-to-sector causality backwards for this one industry specifically. On the credit side, shale and E&P drillers are meaningfully debt-financed, so tightening credit conditions raise the cost of capital for new drilling programs — but the bigger swing factor for energy is almost always geopolitical supply shocks (the user's own stated trading edge), which no domestic macro indicator captures at all.",
  },
  {
    id: "alt-energy",
    name: "Alternative / Renewable Energy",
    primaryDrivers: ["yield-curve", "sloos-tightening"],
    analysis:
      "Renewables are arguably the single most interest-rate-sensitive industry outside of real estate: solar and wind projects are essentially long-duration bonds wrapped in a physical asset — nearly all the cost is upfront capital, financed with project debt, paid back over 20-30 years of predictable cash flows. A move in long-term rates directly changes the economics of every project in the development pipeline, more mechanically than almost any valuation effect in tech. Credit conditions (SLOOS, credit spreads) matter just as much as the rate level itself, since these are debt-financed projects almost by definition. Layered on top of the purely financial sensitivity is policy risk — subsidies, tax credits, and executive orders can change project economics overnight in a way no macro indicator predicts, which is exactly the kind of catalyst-driven shock the user's own trading edge is built to play.",
  },
  {
    id: "manufacturing",
    name: "Manufacturing / Industrials",
    primaryDrivers: ["cfnai", "durable-goods", "sloos-tightening"],
    analysis:
      "This is the industry the classic leading indicators were built to track — industrial production, capacity utilization (both already in the Sector tab), durable goods orders, and broad activity composites like CFNAI are directly measuring this sector's own output and order book, not a downstream proxy. Manufacturing is capex-heavy and cyclical, so credit tightening (SLOOS) hits capacity expansion plans directly, and a sustained inversion of the yield curve has historically preceded manufacturing recessions specifically (manufacturing tends to lead the broader economy into and out of recessions). Graham's own framework applies almost literally here: low capacity utilization plus wide credit spreads is the textbook 'cyclical bargain' setup this app's Sector tab is built to flag.",
  },
  {
    id: "wholesale",
    name: "Wholesale / Distribution",
    primaryDrivers: ["real-retail-sales", "durable-goods", "cfnai"],
    analysis:
      "Wholesale is structurally a pass-through business sitting between manufacturers and retailers, so it's sensitive not to any single indicator's level but to the *mismatch* between upstream production and downstream demand — exactly what the inventory-to-sales ratio (already in the Sector tab) is built to capture. When retail sales cool faster than manufacturers cut production, inventory backs up in the wholesale channel and margins compress under forced discounting. Thin margins and long cash-conversion cycles also make this industry unusually dependent on trade credit and working-capital financing, so credit tightening squeezes wholesalers operationally, not just financially. Watch the inventory-to-sales trend alongside real retail sales and durable goods orders together, not any one in isolation.",
  },
  {
    id: "auto",
    name: "Automotive",
    primaryDrivers: ["consumer-sentiment", "sloos-tightening", "household-debt-service"],
    analysis:
      "Autos are the most credit-dependent consumer durable there is — the overwhelming majority of vehicle purchases are financed, so this industry's demand curve is a direct function of loan availability and affordability, not just sticker price. That makes it unusually exposed to three things at once: consumer sentiment (a big-ticket discretionary purchase is one of the first things households delay when confidence drops), bank lending standards for consumer auto loans (a tightening credit environment directly shrinks the pool of qualified buyers), and the household debt service ratio (an already-stretched consumer has less room to take on a new auto loan regardless of rates). Auto loan delinquency trends specifically are one of the earliest, most reliable tells of broader consumer credit stress — they tend to crack before credit card delinquencies do, because a car is easier to have repossessed than to lose a home over, so financially stretched households triage other debts first.",
  },
  {
    id: "retail",
    name: "Retail (Consumer Discretionary)",
    primaryDrivers: ["consumer-sentiment", "real-retail-sales", "household-debt-service", "personal-savings-rate"],
    analysis:
      "The most direct consumer-facing read in this entire list: discretionary retail demand moves with consumer sentiment, real income growth, and — critically — the consumer's remaining capacity to spend, which is why the household debt service ratio and personal savings rate matter as much as the sentiment and sales prints themselves. A consumer can keep spending on a deteriorating sentiment reading for a while by drawing down savings or expanding credit, which is exactly why watching consumer credit growth alongside retail sales matters (per Layer 1's existing credit framework): sales growth funded by expanding debt at a shrinking savings rate is a fragile trend, not a healthy one, even though the headline retail sales number looks identical either way. Employment and wage growth are the other lever — discretionary spending capacity ultimately comes from paycheck growth, so a cooling labor market (rising Initial Claims, falling JOLTS openings) is usually the leading edge of a retail slowdown before it shows up in sales data.",
  },
  {
    id: "consumer-staples",
    name: "Consumer Non-Discretionary (Staples)",
    primaryDrivers: ["core-pce", "real-retail-sales"],
    analysis:
      "The defensive counterpart to retail: demand for staples (household goods, personal care, everyday essentials) is inelastic, so this sector is largely insulated from swings in consumer sentiment, credit availability, or the business cycle generally — people buy toothpaste and toilet paper in recessions too. What actually moves this sector is inflation and margin dynamics: because demand doesn't flex much, pricing power (the ability to pass rising input costs through to consumers without losing volume) is the entire investment thesis, which is precisely why the PPI-vs-CPI margin-compression signal already built into Layer 1 is the single most relevant macro read for this sector specifically. Staples names with weak brand moats get squeezed in exactly the environment (rising input costs, resistant consumer pricing tolerance) where strong-moat staples names hold margins — the macro backdrop is identical for both, the company-specific pricing power is what differentiates the outcome.",
  },
  {
    id: "food-beverage",
    name: "Food & Beverage",
    primaryDrivers: ["core-pce", "real-retail-sales"],
    analysis:
      "Closely related to staples but with its own distinct input-cost exposure: agricultural commodity prices, transportation/freight costs, and packaging (often petroleum-linked) drive producer costs somewhat independently of broad PPI, so a sector-specific read on food-at-home CPI versus agricultural PPI is more informative here than the economy-wide margin-compression signal alone. Demand is largely non-discretionary for staple foods but has a real discretionary layer at the margin (dining out, premium/branded products, alcoholic beverages), so this sector sits partway between staples and discretionary retail — a squeezed consumer trades down from branded to private-label and from restaurants to grocery, which shows up as volume resilience but margin and mix deterioration well before headline sales data would suggest any weakness.",
  },
  {
    id: "financials",
    name: "Financials (Banks, Insurance, Capital Markets)",
    primaryDrivers: ["yield-curve", "sloos-tightening", "initial-claims"],
    analysis:
      "Banks are a maturity-transformation business — they borrow short and lend long — so the shape of the yield curve is close to a direct read on the sector's core profitability, not just a leading indicator of it: a steep curve rewards that spread, while an inverted curve compresses net interest margin in real time. The SLOOS tightening series is doubly relevant here, since it's literally a survey of the banks themselves reporting their own lending posture — it's simultaneously a leading indicator for the rest of the economy and a direct read on this sector's near-term loan growth and credit-quality choices. Insurance and capital-markets names inside this sector diverge from the pure-bank read: insurers benefit from higher long rates on their investment portfolios largely independent of curve shape, and capital-markets/broker-dealer revenue tracks trading volume and deal activity more than the credit cycle. Initial Claims matters as an early tell on consumer and small-business loan quality — rising claims usually precede rising delinquencies by a couple of quarters.",
  },
  {
    id: "healthcare",
    name: "Health Care (Pharma, Biotech, Providers, Insurers)",
    primaryDrivers: ["consumer-sentiment", "personal-savings-rate"],
    analysis:
      "The classic defensive sector: prescription drugs, doctor visits, and insurance premiums are close to non-discretionary, so aggregate demand here is unusually insulated from the business cycle relative to almost everything else in this list — sentiment and spending-capacity indicators matter far less than they do for retail or autos. That said, the sector isn't macro-immune: elective procedures, dental work, and out-of-pocket-heavy care are genuinely discretionary at the margin, so a squeezed consumer (falling sentiment, a depleted savings buffer) does show up as deferred elective volume at hospitals and providers, just with a longer lag and smaller amplitude than in true discretionary sectors. Biotech is the exception inside the sector — pre-revenue biotech is effectively long-duration venture-style equity, financed by capital markets rather than operating cash flow, which makes it behave more like software than like the rest of health care when credit conditions or rates move. Regulatory and reimbursement policy (drug pricing rules, FDA decisions) is the dominant catalyst-driven risk here and, like biotech financing, isn't something any of this app's macro indicators capture.",
  },
  {
    id: "materials",
    name: "Materials (Chemicals, Metals & Mining, Packaging)",
    primaryDrivers: ["durable-goods", "cfnai", "housing-starts"],
    analysis:
      "Materials sits upstream of nearly every other cyclical sector in this list — chemicals, metals, and mining feed manufacturing, construction, and packaging, so demand here is a leading-into-coincident read on industrial activity broadly (CFNAI) and durable goods orders specifically, since producers need raw inputs before they can build the durable goods those orders represent. Housing starts is a second, more specific driver: construction is one of the single largest end-markets for materials (lumber, steel, cement, copper, glass), so a housing slowdown hits this sector's volumes directly, not just through a general activity slowdown. Like semiconductors, materials companies run heavy fixed-asset bases (mines, smelters, chemical plants) with multi-year build times, so the sector is capital-intensive and cyclically amplified — small swings in end-demand translate into large swings in producer profitability because fixed costs don't flex down with volume. Commodity price levels themselves (independent of any indicator in this app) are usually the single biggest swing factor for the mining/metals sub-industry specifically.",
  },
  {
    id: "utilities",
    name: "Utilities",
    primaryDrivers: ["yield-curve", "consumer-credit"],
    analysis:
      "Utilities are the other classic bond-proxy sector alongside alt-energy and real estate: regulated, capital-intensive, debt-financed infrastructure with stable, largely rate-regulated cash flows, so utility equities trade with an unusually tight inverse relationship to long-term interest rates — when yields rise, utility dividend yields look comparatively less attractive and multiples compress, largely independent of how the underlying business is actually performing. Demand itself (electricity, gas, water) is about as inelastic as it gets — households and businesses don't meaningfully cut usage in a downturn — which is why this sector's operating fundamentals are close to macro-invariant even though its valuation is one of the most macro-sensitive in this entire list. Consumer credit conditions matter at the margin through bill-payment delinquency risk in a stretched-consumer environment, but this is a secondary effect next to the dominant rate-sensitivity story. Regulatory rate-case outcomes (state utility commissions setting allowed returns) are the sector-specific catalyst no macro indicator captures.",
  },
  {
    id: "real-estate",
    name: "Real Estate (REITs & Real Estate Services)",
    primaryDrivers: ["housing-starts", "building-permits", "yield-curve"],
    analysis:
      "Real estate is arguably the single most rate-sensitive sector in the market for two independent reasons at once: REITs are valued substantially as a spread over the risk-free rate (much like utilities and alt-energy), and the underlying property transactions themselves depend on mortgage and commercial-financing rates that move directly with the yield curve — a rate move hits both the equity valuation and the physical transaction volume simultaneously. Housing starts and building permits are the most direct, sector-specific real-economy reads available (permits lead starts by 1-2 months, both lead the broader construction cycle), and they matter differently across sub-sectors — residential-exposed names track them closely, while office, industrial, and retail REITs care more about vacancy rates and lease renewal spreads that this app doesn't yet track. Credit availability for commercial real estate specifically (a distinct financing market from residential mortgages) is a second, separate channel through which tightening bank lending standards hit this sector, on top of the general capex-financing effect that shows up everywhere else in this list.",
  },
  {
    id: "communication-services",
    name: "Communication Services (Media, Telecom, Interactive/Internet)",
    primaryDrivers: ["consumer-sentiment", "real-retail-sales"],
    analysis:
      "A genuinely split sector under GICS's 2018 reclassification: legacy telecom behaves like a bond-proxy/utility (heavy infrastructure capex, stable subscription cash flows, meaningful rate sensitivity), while media, entertainment, and interactive/internet names behave like consumer discretionary and, in the case of high-growth ad-tech and streaming platforms, like software — long-duration growth stories sensitive to the discount rate. What actually unifies the sector's real-economy exposure is advertising spend, which is one of the most cyclically sensitive corporate budget lines in existence (companies cut marketing budgets early and hard in a slowdown, well before headcount), making consumer sentiment and discretionary retail strength a reasonable proxy for the advertiser-side demand that drives media and internet-platform revenue. Subscription-based names (telecom, streaming) are more insulated on the revenue side than ad-supported names, but not immune — cord-cutting and subscription churn both accelerate when household budgets tighten, showing up as the same consumer-strength signals that drive discretionary retail.",
  },
];
