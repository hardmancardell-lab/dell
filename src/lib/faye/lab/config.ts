/** Feature flag and limits for the Faye Lab (package WP-C2). Default OFF: only the exact values "1" or "true" turn it on. */

export type Env = Record<string, string | undefined>;

export function labEnabled(env: Env = process.env): boolean {
  const v = (env.FAYE_LAB_ENABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

/** The page. The widget links here only when its `labHref` prop is set (see labHrefFor). */
export const LAB_PATH = "/faye-lab";

/**
 * The value for the chat widget's existing `labHref` prop. The widget is a client component, so the switch has to be a public
 * variable: NEXT_PUBLIC_FAYE_LAB_HREF=/faye-lab. Unset or anything else = no link anywhere. The page itself answers 404 to anyone
 * who is not the owner, so a visible link is a convenience, never the gate.
 */
export function labHrefFor(env: Env = process.env): string | undefined {
  const v = (env.NEXT_PUBLIC_FAYE_LAB_HREF ?? "").trim();
  return v === LAB_PATH ? LAB_PATH : undefined;
}

/**
 * Test suites the Lab will request (contract section 4.4 plus WP-E's guardrail_model). "full" (= --suite all, about 61 minutes) is NOT
 * offered: it is longer than the 3,600 second cap of one eval job, so the Lab asks for one suite at a time.
 */
export const EVAL_SUITES = ["guardrail", "orchestration", "guardrail_model", "heldout", "domain", "persona"] as const;
export type EvalSuite = (typeof EVAL_SUITES)[number];

/** Short, model-free or nearly so. These two may be requested with one click. */
export const DEFAULT_SUITES: readonly EvalSuite[] = ["guardrail", "orchestration"];

export function isDefaultSuite(s: string): boolean {
  return (DEFAULT_SUITES as readonly string[]).includes(s);
}

export const SUITE_LABEL: Record<EvalSuite, string> = {
  guardrail: "Guardrail",
  orchestration: "Orchestration",
  heldout: "Held-out exam",
  domain: "Domain",
  persona: "Voice",
  guardrail_model: "Guardrail with the model",
};

/** The suites in the Test console chart and table. */
export const CHART_SUITES: readonly EvalSuite[] = ["guardrail", "orchestration", "guardrail_model"];

export const LAB_LIMITS = {
  /** Whole request body a lab route will read. An answer can be 8,000 characters (up to 4 bytes each). */
  bodyBytes: 48 * 1024,
  answerChars: 8000,
  excerptChars: 200,
  noteChars: 300,
  questionMin: 8,
  questionMax: 500,
  betterMin: 5,
  betterMax: 1500,
  badExcerptChars: 200,
  keywordMax: 8,
  keywordChars: 80,
  titleMin: 3,
  titleMax: 80,
  bodyMin: 20,
  bodyMax: 1500,
  runLabelChars: 60,
} as const;

/** Per-instance, best-effort limits on top of the database (the database is the real limit). */
export const LAB_RATE = {
  readPerMinute: 120,
  writePerMinute: 60,
  /** Any eval request. */
  evalPerTenMin: 4,
  /** Every suite that reaches the model (guardrail_model, held-out, domain, voice): they take long and share the model with chat. */
  longPerDay: 6,
} as const;
