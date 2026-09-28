-- Pilot RC1 staging hardening.
--
-- This migration is intentionally privilege-only/configuration-only. It does
-- not delete historical Drop data or remove compatibility function
-- definitions. Production rollout still requires separate owner approval.

begin;

-- These pre-RC1 RPCs are not called by the active frontend. Keep their
-- definitions for historical compatibility while removing Data API access.
revoke all on function public.explore_state(uuid) from public, anon, authenticated;
revoke all on function public.sent_interests(uuid) from public, anon, authenticated;
revoke all on function public.send_match_message(uuid, text) from public, anon, authenticated;

comment on function public.explore_state(uuid)
  is 'Internal compatibility helper for claim_explore_batch. No direct client execution.';
comment on function public.sent_interests(uuid)
  is 'Deprecated for Pilot RC1. Historical compatibility only. No client execution.';
comment on function public.send_match_message(uuid, text)
  is 'Deprecated non-idempotent chat RPC. Use send_match_message_idempotent.';

-- Every relation/function reference in these inherited SECURITY DEFINER
-- bodies is already schema-qualified. Pin an empty search path so callers
-- cannot redirect an unqualified name to an attacker-controlled object.
alter function public.can_access_match(uuid, uuid) set search_path = '';
alter function public.get_room_by_join_code(text) set search_path = '';
alter function public.interested_in_you(uuid) set search_path = '';
alter function public.is_pair_blocked(uuid, uuid) set search_path = '';
alter function public.mark_match_messages_read(uuid) set search_path = '';
alter function public.room_joined_count(uuid) set search_path = '';
alter function public.room_matches(uuid) set search_path = '';
alter function public.send_match_message(uuid, text) set search_path = '';
alter function public.sent_interests(uuid) set search_path = '';

-- Drops are retained as historical migration data, but Pilot RC1 has no
-- client-readable Drop path. RLS remains enabled as defense in depth.
drop policy if exists "drops_read_owner_or_member" on public.drops;
revoke select on table public.drops from anon, authenticated;

comment on table public.drops
  is 'Historical pre-RC1 data. Direct client reads are disabled.';

commit;
