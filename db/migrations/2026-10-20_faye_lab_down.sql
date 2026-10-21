-- Undo 2026-10-20_faye_lab.sql.   *** DESTRUCTIVE: deletes every Faye feedback row, correction, practice and exam question,
-- proposed note and test-run result. ***
-- Leaves the mailbox and memory tables and functions alone. Safe to run twice.
--
-- After this, the app keeps working: with FAYE_LAB_ENABLED unset or 0 no lab function is called, and the mailbox functions
-- faye_get_approved_eval_items and faye_report_eval_run answer { ok: false, code: 'not_ready' } while the tables are missing.
-- The memory trigger that refuses held-out text skips quietly when faye_eval_items is missing.

drop table if exists public.faye_eval_runs cascade;
drop table if exists public.faye_corpus_notes cascade;
drop table if exists public.faye_eval_items cascade;
drop table if exists public.faye_corrections cascade;
drop table if exists public.faye_feedback cascade;

drop function if exists public.faye_lab_list_runs(text, integer);
drop function if exists public.faye_lab_decide_note(uuid, text);
drop function if exists public.faye_lab_list_notes(text);
drop function if exists public.faye_lab_propose_note(uuid, uuid, text, text);
drop function if exists public.faye_lab_update_eval_item(uuid, text);
drop function if exists public.faye_lab_list_eval_items();
drop function if exists public.faye_lab_promote_correction(uuid, text, text, text[]);
drop function if exists public.faye_lab_decide_correction(uuid, text);
drop function if exists public.faye_lab_list_corrections(integer);
drop function if exists public.faye_lab_save_correction(text, text, text, text, uuid);
drop function if exists public.faye_lab_list_feedback(integer);
drop function if exists public.faye_lab_submit_feedback(uuid, text, text, text, text, jsonb);
drop function if exists public.faye_lab_overview();
drop function if exists public.faye_lab_is_owner();
drop function if exists public.faye_lab_owner();
drop function if exists public.faye_lab_notes_guard();
drop function if exists public.faye_lab_eval_items_guard();
drop function if exists public.faye_lab_wall_hit(uuid, text, uuid, uuid);
drop function if exists public.faye_lab_keywords_ok(text[]);
drop function if exists public.faye_lab_question_key(text);

delete from public.faye_settings
 where key in ('lab_max_feedback', 'lab_max_corrections', 'lab_max_eval_items', 'lab_max_notes', 'lab_max_runs');
