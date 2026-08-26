import type { BuybackOperation } from "../agents/trading-agent/types";

/**
 * U.S. Treasury's own public Fiscal Data API — real, keyless, no auth.
 * Confirmed live: https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/buybacks_operations
 * Endpoint/field names verified against the actual JSON response, not
 * guessed. Treasury's own `operation_type` field on every 20Y-30Y record
 * observed so far reads "Liquidity Support" (one early 2024 "Small Value"
 * test operation aside) — that is Treasury's stated purpose, not "yield
 * suppression"; this client makes no claim about intent, it only fetches
 * the real operation-level data for the caller to test empirically.
 */

const BASE_URL = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/buybacks_operations";

interface RawBuybackRow {
  operation_date: string;
  operation_type: string;
  maturity_bucket: string;
  total_par_amt_accepted: string | null;
  total_par_amt_offered: string | null;
  nbr_issues_accepted: string | null;
}

interface RawBuybackResponse {
  data: RawBuybackRow[];
}

/**
 * Fetches every real buyback operation in the given maturity bucket (Treasury's
 * own bucket labels, e.g. "20Y to 30Y") with a real, non-null accepted amount —
 * operations with a null total_par_amt_accepted haven't settled/reported yet
 * and carry no real buyback-size signal.
 */
export async function fetchBuybackOperations(maturityBucket: string): Promise<BuybackOperation[]> {
  const url = new URL(BASE_URL);
  url.searchParams.set("filter", `maturity_bucket:eq:${maturityBucket}`);
  url.searchParams.set("sort", "operation_date");
  url.searchParams.set("page[size]", "200");
  url.searchParams.set(
    "fields",
    "operation_date,operation_type,maturity_bucket,total_par_amt_accepted,total_par_amt_offered,nbr_issues_accepted"
  );

  const res = await fetch(url.toString(), { next: { revalidate: 60 * 60 * 12 } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Treasury Fiscal Data request failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as RawBuybackResponse;

  return json.data
    .filter((row) => row.total_par_amt_accepted !== null && row.total_par_amt_accepted !== "null")
    .map((row) => ({
      operationDate: row.operation_date,
      operationType: row.operation_type,
      maturityBucket: row.maturity_bucket,
      totalParAmtAccepted: Number(row.total_par_amt_accepted),
      totalParAmtOffered: row.total_par_amt_offered ? Number(row.total_par_amt_offered) : null,
      nbrIssuesAccepted: row.nbr_issues_accepted ? Number(row.nbr_issues_accepted) : null,
    }));
}
