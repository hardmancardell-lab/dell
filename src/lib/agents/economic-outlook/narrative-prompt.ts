import { callClaude } from "@/lib/agents/assistant/anthropic-client";
import type { AnthropicContentBlock, AnthropicToolSchema } from "@/lib/agents/assistant/anthropic-client";
import type { EconomicOutlookInputs } from "./inputs";
import type {
  CyclePhase,
  FinancialConditionsStance,
  RiskScenario,
  SelfQaEntry,
  VolRegime,
} from "./types";

export const ECONOMIC_OUTLOOK_SYSTEM_PROMPT = `You are writing the analytical layer of a standing "Economic Outlook" — a top-down macro workstream modeled on the mock-FOMC format used in the College Fed Challenge. You will be given a block of REAL, already-fetched economic indicator readings (FRED data, fetched moments ago) — you do not fetch or estimate any numbers yourself.

Your job is the layer ON TOP of those numbers: for each indicator, state the mechanism connecting the raw reading to what it implies (how_derived) — never just restate the number. Then synthesize a regime call, a policy-path view, a risk balance, an adversarial self-Q&A round, and trading parameters.

Hard rules:
- Every "how_derived" must state an actual causal/interpretive mechanism, not just repeat the number. If you can't articulate a real mechanism for an indicator, say so honestly rather than inventing one.
- Never fabricate a number, date, or data point not present in the input you were given.
- market_implied_path: this app has NO fed-funds-futures or OIS pricing data source integrated. State that explicitly — do not estimate or guess what the market is pricing.
- Never issue investment advice or a buy/sell/hold directive of any kind.
- self_qa questions must be genuinely adversarial — the kind of follow-up a skeptical judge or PM would ask, with a concrete, checkable falsification_trigger (a specific print/threshold, not a vague condition).
- If a prior version's regime/glance is provided, the glance summary must describe the DELTA (what changed), not restate the whole picture.

Call the submit_economic_outlook_narrative tool exactly once with your complete output.`;

const submitTool: AnthropicToolSchema = {
  name: "submit_economic_outlook_narrative",
  description: "Submit the complete analytical layer of the Economic Outlook.",
  input_schema: {
    type: "object",
    required: ["regimeTag", "laborDerivations", "inflationDerivations", "growthDerivations", "policyStance", "riskBalance", "selfQa", "tradingParameters", "glance"],
    properties: {
      regimeTag: {
        type: "object",
        required: ["label", "cyclePhase", "dualMandateBalance", "financialConditionsStance"],
        properties: {
          label: { type: "string", description: "One-line regime name, e.g. 'late-cycle, disinflationary, easing bias'" },
          cyclePhase: { type: "string", enum: ["early_expansion", "mid_expansion", "late_expansion", "slowdown", "contraction", "recovery"] },
          dualMandateBalance: { type: "string" },
          financialConditionsStance: { type: "string", enum: ["tight", "neutral", "loose", "mixed"] },
        },
      },
      laborDerivations: {
        type: "array",
        description: "One entry per labor indicator given to you, in the same order, matched by 'indicator' name.",
        items: {
          type: "object",
          required: ["indicator", "roleInOutlook", "howDerived"],
          properties: {
            indicator: { type: "string" },
            roleInOutlook: { type: "string" },
            howDerived: { type: "string" },
          },
        },
      },
      inflationDerivations: {
        type: "array",
        items: {
          type: "object",
          required: ["indicator", "roleInOutlook", "howDerived"],
          properties: {
            indicator: { type: "string" },
            roleInOutlook: { type: "string" },
            howDerived: { type: "string" },
          },
        },
      },
      growthDerivations: {
        type: "array",
        items: {
          type: "object",
          required: ["indicator", "roleInOutlook", "howDerived"],
          properties: {
            indicator: { type: "string" },
            roleInOutlook: { type: "string" },
            howDerived: { type: "string" },
          },
        },
      },
      policyStance: {
        type: "object",
        required: ["currentTargetRange", "houseViewPath", "marketImpliedPath", "gapAnalysis"],
        properties: {
          currentTargetRange: { type: "string", description: "Approximate target range derived from the given effective fed funds rate, stated as approximate." },
          houseViewPath: { type: "string" },
          marketImpliedPath: { type: "string", description: "Must explicitly state this app has no futures/OIS data source — do not estimate." },
          gapAnalysis: { type: "string" },
        },
      },
      riskBalance: {
        type: "object",
        required: ["upsideRisks", "downsideRisks"],
        properties: {
          upsideRisks: {
            type: "array",
            items: {
              type: "object",
              required: ["scenario", "trigger", "marketImplication"],
              properties: { scenario: { type: "string" }, trigger: { type: "string" }, marketImplication: { type: "string" } },
            },
          },
          downsideRisks: {
            type: "array",
            items: {
              type: "object",
              required: ["scenario", "trigger", "marketImplication"],
              properties: { scenario: { type: "string" }, trigger: { type: "string" }, marketImplication: { type: "string" } },
            },
          },
        },
      },
      selfQa: {
        type: "array",
        description: "Exactly 3 adversarial question/answer/falsification-trigger entries.",
        items: {
          type: "object",
          required: ["question", "answer", "falsificationTrigger"],
          properties: { question: { type: "string" }, answer: { type: "string" }, falsificationTrigger: { type: "string" } },
        },
      },
      tradingParameters: {
        type: "object",
        required: ["volRegime", "calendarEffectsPriority", "meanReversionWindowConfidence"],
        properties: {
          volRegime: { type: "string", enum: ["low_vol_grind", "elevated_event_risk", "high_vol_regime_break"] },
          calendarEffectsPriority: { type: "array", items: { type: "string" }, description: "Ranked list, e.g. ['NFP', 'FOMC', 'CPI']" },
          meanReversionWindowConfidence: { type: "string" },
        },
      },
      glance: { type: "string", description: "One short paragraph: regime tag + delta since the prior version only (or 'first version' if none given)." },
    },
  },
};

export interface NarrativeResult {
  regimeTag: { label: string; cyclePhase: CyclePhase; dualMandateBalance: string; financialConditionsStance: FinancialConditionsStance };
  laborDerivations: { indicator: string; roleInOutlook: string; howDerived: string }[];
  inflationDerivations: { indicator: string; roleInOutlook: string; howDerived: string }[];
  growthDerivations: { indicator: string; roleInOutlook: string; howDerived: string }[];
  policyStance: { currentTargetRange: string; houseViewPath: string; marketImpliedPath: string; gapAnalysis: string };
  riskBalance: { upsideRisks: RiskScenario[]; downsideRisks: RiskScenario[] };
  selfQa: SelfQaEntry[];
  tradingParameters: { volRegime: VolRegime; calendarEffectsPriority: string[]; meanReversionWindowConfidence: string };
  glance: string;
}

export async function generateEconomicOutlookNarrative(
  inputs: EconomicOutlookInputs,
  priorVersionSummary: { versionId: string; regimeLabel: string; glance: string } | null
): Promise<NarrativeResult> {
  const dataBlock = JSON.stringify({
    fedFundsEffective: inputs.fedFundsEffective,
    labor: inputs.labor,
    inflation: inputs.inflation,
    growthAndFinancialConditions: inputs.growthAndFinancialConditions,
    macroMatrixStance: inputs.matrix.stance,
    priorVersion: priorVersionSummary,
  });

  const response = await callClaude(
    [{ role: "user", content: `Real economic data for this refresh:\n${dataBlock}\n\nSubmit the narrative.` }],
    [submitTool],
    ECONOMIC_OUTLOOK_SYSTEM_PROMPT
  );

  const toolUse = response.content.find((b): b is Extract<AnthropicContentBlock, { type: "tool_use" }> => b.type === "tool_use");
  if (!toolUse) {
    throw new Error("Claude did not return a structured narrative (no tool_use block in the response).");
  }
  return toolUse.input as unknown as NarrativeResult;
}
