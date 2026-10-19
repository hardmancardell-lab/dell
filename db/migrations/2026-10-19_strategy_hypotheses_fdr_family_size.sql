-- Strategy ledger: how many hypotheses were corrected together (the Benjamini-Hochberg "family") when a row was judged.
-- Run once in the Supabase SQL editor. Safe to re-run. The app works with or without it: until this runs, the family
-- size is kept only as text in each row's exit_rule ("Corrected for N hypotheses tested together in this run.").
--
-- What it does:
--   1. Adds a nullable integer column fdr_family_size (null, or 1 or more).
--   2. Fills it for existing rows by reading N from that exit_rule text. Rows without the text stay null.
--      Null therefore means "judged before the statistics fix" (the older, weaker test). The app treats such rows as
--      legacy: they are labelled "Validated under an older, weaker test" and never reach Guided Trade Signals.
-- It does not change or delete any row's status, p-value or text.
-- (The adjusted p-value already lives in p_value_fdr, so no second column is added.)

alter table public.strategy_hypotheses
  add column if not exists fdr_family_size integer
  constraint strategy_hypotheses_fdr_family_size_check check (fdr_family_size is null or fdr_family_size >= 1);

comment on column public.strategy_hypotheses.fdr_family_size is
  'How many hypotheses were corrected together (Benjamini-Hochberg family) when this row was judged. Null = judged before the statistics fix (older, weaker test) or not recorded.';

update public.strategy_hypotheses
set fdr_family_size = (substring(exit_rule from 'Corrected for ([0-9]{1,9}) hypotheses tested together'))::integer
where fdr_family_size is null
  and exit_rule ~ 'Corrected for [0-9]{1,9} hypotheses tested together'
  and (substring(exit_rule from 'Corrected for ([0-9]{1,9}) hypotheses tested together'))::bigint between 1 and 2147483647;

-- Check (read-only): how many rows got a family size, and how many are still null (older rule).
select
  count(*)                                       as total_rows,
  count(fdr_family_size)                         as with_family_size,
  count(*) - count(fdr_family_size)              as legacy_rule_rows,
  count(*) filter (where status = 'validated' and fdr_family_size is null) as legacy_validated_rows
from public.strategy_hypotheses;
