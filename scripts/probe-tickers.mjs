import { readFileSync, writeFileSync } from "node:fs";

const envContent = readFileSync(new URL("../.env.local", import.meta.url), "utf-8");
const fmpKeyLine = envContent.split("\n").find((l) => l.startsWith("FMP_API_KEY="));
const apiKey = fmpKeyLine.split("=")[1].trim();

// New candidates only — sectors/tickers already confirmed in the live app
// (Technology: AAPL,MSFT,NVDA,ADBE,CSCO pass, AVGO,ORCL,CRM fail; Consumer
// Defensive: KO,PEP,WMT,COST pass, PG,PM,MDLZ,CL fail) are excluded here to
// save budget and merged back in afterward.
const candidates = {
  "Basic Materials": ["LIN","SHW","ECL","APD","NEM","FCX","DOW","NUE","DD","PPG","VMC","MLM","ALB","CE","FMC"],
  "Communication Services": ["GOOGL","META","DIS","VZ","T","TMUS","CMCSA","NFLX","CHTR","EA","TTWO","WBD"],
  "Consumer Cyclical": ["AMZN","TSLA","HD","MCD","NKE","LOW","SBUX","TJX","BKNG","MAR","GM","F","ROST"],
  "Energy": ["XOM","CVX","COP","SLB","EOG","PSX","MPC","WMB","OXY","VLO","KMI","OKE","HES"],
  "Financial Services": ["BRK-B","JPM","V","MA","BAC","WFC","GS","MS","C","AXP","SPGI","BLK","SCHW"],
  "Healthcare": ["UNH","JNJ","LLY","ABBV","MRK","PFE","TMO","ABT","DHR","BMY","AMGN","CVS","MDT"],
  "Industrials": ["CAT","HON","UPS","RTX","BA","GE","LMT","DE","MMM","UNP","ETN","ITW","EMR"],
  "Real Estate": ["PLD","AMT","EQIX","PSA","O","SPG","WELL","DLR","CCI","AVB","EQR","VTR"],
  "Utilities": ["NEE","DUK","SO","D","AEP","EXC","SRE","XEL","ED","PEG","WEC","ES"],
  "Consumer Defensive (replacements)": ["MO","KMB","GIS","STZ","KHC","SYY"],
  "Technology (replacements)": ["ACN","IBM","TXN","QCOM","INTC","AMD"],
};

const results = {};
for (const [sector, tickers] of Object.entries(candidates)) {
  results[sector] = {};
  for (const ticker of tickers) {
    try {
      const url = `https://financialmodelingprep.com/stable/income-statement?symbol=${ticker}&period=annual&limit=1&apikey=${apiKey}`;
      const res = await fetch(url);
      const data = await res.json();
      const ok = res.ok && Array.isArray(data) && data.length > 0;
      results[sector][ticker] = ok ? "PASS" : `FAIL (${res.status})`;
    } catch (e) {
      results[sector][ticker] = `ERROR (${e.message})`;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log(`done: ${sector}`);
}

writeFileSync(new URL("./probe-results.json", import.meta.url), JSON.stringify(results, null, 2));
console.log("all done");
