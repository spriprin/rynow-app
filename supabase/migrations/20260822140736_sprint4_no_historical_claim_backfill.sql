-- Do not create Sprint 4 claim instrumentation while merely restoring an
-- assignment that already existed before instrumentation was deployed.

create or replace function private.guard_new_claim_instrumentation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.drop_items di
    where di.drop_id = new.drop_id
      and di.viewer_id = new.viewer_id
  ) then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function private.guard_new_claim_instrumentation()
  from public, anon, authenticated;

drop trigger if exists guard_new_claim_instrumentation
  on private.drop_claim_states;
create trigger guard_new_claim_instrumentation
before insert on private.drop_claim_states
for each row execute function private.guard_new_claim_instrumentation();

-- The response depends on database time, so retain the default VOLATILE
-- contract rather than promising STABLE semantics to the planner.
alter function public.room_analytics(uuid) volatile;
