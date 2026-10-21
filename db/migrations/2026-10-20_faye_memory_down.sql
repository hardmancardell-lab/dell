-- Undo 2026-10-20_faye_memory.sql.   *** DESTRUCTIVE: deletes every Faye memory note, setting, audit row and usage count. ***
-- Export first if you want to keep anything (About me, then Export). Leaves the mailbox tables and functions alone.
-- Safe to run twice. Run it BEFORE the lab down script if the lab policies use faye_memory_is_owner() (they do not today).
--
-- After this, the app keeps working: with FAYE_MEMORY_ENABLED unset or 0 no memory function is called, and the mailbox
-- function faye_submit_memory_proposals answers { ok: false, code: 'not_ready' } while the table is missing.

drop table if exists public.faye_usage_stats cascade;
drop table if exists public.faye_memory_events cascade;
drop table if exists public.faye_memory_settings cascade;
drop table if exists public.faye_memory_items cascade;

drop function if exists public.faye_memory_note_erased(integer);
drop function if exists public.faye_memory_note_dropped(integer, text);
drop function if exists public.faye_usage_recent(integer);
drop function if exists public.faye_usage_bump(date, jsonb, jsonb, integer);
drop function if exists public.faye_memory_touch(uuid[]);
drop function if exists public.faye_memory_candidates(integer);
drop function if exists public.faye_memory_export();
drop function if exists public.faye_memory_update_settings(boolean, boolean);
drop function if exists public.faye_memory_delete_all(text);
drop function if exists public.faye_memory_restore(uuid);
drop function if exists public.faye_memory_delete(uuid, boolean);
drop function if exists public.faye_memory_decide(uuid, text);
drop function if exists public.faye_memory_edit(uuid, text, text);
drop function if exists public.faye_memory_add(text, text, text, text, text, integer, text);
drop function if exists public.faye_memory_list(boolean);
drop function if exists public.faye_memory_is_owner();
drop function if exists public.faye_memory_owner();
drop function if exists public.faye_memory_supersede(uuid, uuid, text);
drop function if exists public.faye_memory_scrub_jobs(uuid, uuid[]);
drop function if exists public.faye_memory_purge(uuid);
drop function if exists public.faye_memory_item_json(public.faye_memory_items);
drop function if exists public.faye_memory_log(uuid, text, uuid, uuid, integer, text);
drop function if exists public.faye_memory_items_audit();
drop function if exists public.faye_memory_items_guard();
drop function if exists public.faye_memory_text_problem(text);
drop function if exists public.faye_jsonb_add(jsonb, jsonb);
drop function if exists public.faye_stats_counts_ok(jsonb, text, integer);
drop function if exists public.faye_luhn_ok(text);

delete from public.faye_settings
 where key in ('memory_max_items', 'memory_undo_minutes', 'memory_proposal_expiry_days', 'memory_events_retention_days', 'memory_stats_retention_days');
