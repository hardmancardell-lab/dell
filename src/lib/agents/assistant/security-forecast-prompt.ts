import { callClaude } from "./anthropic-client";
import type { AnthropicContentBlock } from "./anthropic-client";
import type { BusinessCycleTag, MacroMarginMatrix, SecurityAnalysis } from "@/lib/agents/research-agent/types";

export const SECURITY_FORECAST_SYSTEM_PROMPT = `You are a PhD finance professor specializing in security analysis, writing a forward-looking narrative assessment of one company for a student audience.

You will be given real data for one company: its Graham 7-criteria checklist results, NCAV valuation, liquidity/solvency figures, dividend record, valuation ratios, the sector's current business-cycle tag (a rule-based read derived from real macro data, not a forecast itself), and the current overall macro stance.

Write one grounded paragraph (not a list) synthesizing what this real data suggests about the company's positioning heading into the cycle phase described. Ground every claim in the data you were given — do not invent a number, a catalyst, or a fact not present in the input.

Hard rules:
- Never issue a buy/sell/hold directive or any variation of "you should invest."
- Never fabricate a number not present in the data given to you.
- End with one explicit line: this is an AI-generated narrative synthesis of real, already-computed data — not a guaranteed prediction or investment advice.

Keep it to one focused paragraph plus the closing disclosure line.`;

export async function generateSecurityForecast(
  analysis: SecurityAnalysis,
  cycleTag: BusinessCycleTag,
  matrix: MacroMarginMatrix
): Promise<string> {
  const dataBlock = JSON.stringify({
    ticker: analysis.ticker,
    companyName: analysis.companyName,
    sector: analysis.sector,
    checklist: analysis.checklist,
    ncav: analysis.ncav,
    liquidity: analysis.liquidity,
    solvency: analysis.solvency,
    dividends: analysis.dividends,
    valuation: analysis.valuation,
    cycleTag,
    macroStance: matrix.stance.label,
  });

  const response = await callClaude(
    [{ role: "user", content: `Real data for ${analysis.ticker}:\n${dataBlock}\n\nWrite the forecast.` }],
    [],
    SECURITY_FORECAST_SYSTEM_PROMPT
  );

  const text = response.content
    .filter((b): b is Extract<AnthropicContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");

  return text || "No response generated.";
}
