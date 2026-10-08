-- Keep the existing version accepted while the staging frontend rolls out.
-- The new UI requires guests to acknowledge the revised 60-day draft.
create or replace function public.accept_pilot_terms(p_version text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare accepted timestamptz := clock_timestamp();
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_version not in ('pilot-rc1-draft-2026-09-14','pilot-rc1-draft-2026-10-08')
    then raise exception 'Unsupported document version'; end if;
  update public.profiles
    set accepted_document_version=p_version, accepted_at=accepted, updated_at=accepted
    where id=auth.uid() and age_confirmed_18=true;
  if not found then raise exception 'Complete the 18+ profile first'; end if;
  return accepted;
end;
$$;
