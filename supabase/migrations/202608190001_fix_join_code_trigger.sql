-- Hotfix for projects that applied 202608110001_initial.sql before this change.
-- Generate the public join code inside a privileged trigger, never as a
-- client-evaluated column default.

create or replace function public.rooms_set_join_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  loop
    new.join_code := public.generate_join_code();
    exit when not exists (
      select 1 from public.rooms where join_code = new.join_code
    );
  end loop;
  return new;
end;
$$;

alter table public.rooms alter column join_code drop default;
