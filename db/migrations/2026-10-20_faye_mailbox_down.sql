-- Undo for 2026-10-20_faye_mailbox.sql.   *** DESTRUCTIVE: deletes every Faye job, chunk, worker token and access row. ***
-- Run in the Supabase SQL editor only if you want the mailbox gone. The memory and lab migrations (if run) are NOT touched;
-- drop those with their own down scripts first, because their tables point at nothing here but their functions do not.
-- Safe to re-run. Nothing outside the faye_* names is touched.

drop function if exists public.faye_claim_job(text, text);
drop function if exists public.faye_append_chunks(text, text, uuid, jsonb);
drop function if exists public.faye_complete_job(text, text, uuid, jsonb);
drop function if exists public.faye_fail_job(text, text, uuid, text, text);
drop function if exists public.faye_submit_memory_proposals(text, text, uuid, jsonb);
drop function if exists public.faye_get_approved_eval_items(text, text, uuid);
drop function if exists public.faye_report_eval_run(text, text, uuid, jsonb);

drop function if exists public.faye_status(boolean);
drop function if exists public.faye_submit_job(text, text, jsonb, uuid);
drop function if exists public.faye_poll_job(uuid, integer);
drop function if exists public.faye_cancel_job(uuid);
drop function if exists public.faye_erase_me(text);

drop function if exists public.faye_seed_owner(text);
drop function if exists public.faye_revoke_access(text);
drop function if exists public.faye_create_worker_token(text);
drop function if exists public.faye_list_worker_tokens();
drop function if exists public.faye_revoke_worker_token(uuid);

drop function if exists public.faye_reap(uuid);
drop function if exists public.faye_assert_worker(text, text);
drop function if exists public.faye_worker_online();

-- The policies depend on faye_is_allowed(), so drop the tables (and with them the policies) before the function.
drop table if exists public.faye_job_chunks;
drop table if exists public.faye_jobs;
drop table if exists public.faye_worker_tokens;
drop table if exists public.faye_runtime;
drop table if exists public.faye_settings;
drop table if exists public.faye_access;

drop function if exists public.faye_is_allowed();
drop function if exists public.faye_user_role(uuid);
drop function if exists public.faye_cfg(text, integer);
