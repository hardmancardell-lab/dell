import { NextResponse } from "next/server";
import { getOptionsCalculation } from "@/lib/agents/trading-agent/skills/options-calculator";

function parseRequired(searchParams: URLSearchParams, key: string): number {
  const raw = searchParams.get(key);
  if (raw === null) throw new Error(`Missing required '${key}' query param.`);
  const value = Number(raw);
  if (Number.isNaN(value)) throw new Error(`'${key}' must be a number.`);
  return value;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  try {
    const spotPrice = parseRequired(searchParams, "spot");
    const strikePrice = parseRequired(searchParams, "strike");
    const daysToExpiration = parseRequired(searchParams, "dte");
    const impliedVolatility = parseRequired(searchParams, "iv");
    const riskFreeRate = parseRequired(searchParams, "r");

    const result = await getOptionsCalculation({
      spotPrice,
      strikePrice,
      daysToExpiration,
      impliedVolatility,
      riskFreeRate,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Missing required") || message.includes("must be") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
