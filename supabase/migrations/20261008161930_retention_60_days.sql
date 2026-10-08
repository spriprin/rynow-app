-- Staging-first, forward-only 60-day retention. The worker remains disabled
-- until the trusted scheduler and Storage/Auth cleanup have been verified.
begin;

update private.pilot_settings
set operational_retention_days = 60,
    connection_retention_days = 60,
    safety_retention_days = 60
where singleton;

create index if not exists rooms_ends_at_retention_idx on public.rooms(ends_at);
create index if not exists profiles_updated_at_retention_idx on public.profiles(updated_at);

-- The previous CHECK forced cleanup to remain off. Keep the default off while
-- allowing an explicit, separately reviewed activation after staging tests.
alter table private.pilot_settings
  drop constraint pilot_settings_cleanup_enabled_check;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table private.retention_worker_config (
  singleton boolean primary key default true check (singleton),
  endpoint text not null check (endpoint ~ '^https://[a-z0-9-]+[.]supabase[.]co/functions/v1/retention-cleanup$'),
  token_secret_id uuid not null,
  enabled boolean not null default false
);
revoke all on private.retention_worker_config from public, anon, authenticated;

-- Each room's event-scoped records are removed 60 days after the event ends.
-- Explicit deletes are essential for rows whose FK uses ON DELETE SET NULL.
create function private.retention_delete_expired_rooms(p_limit integer default 25)
returns integer language plpgsql security definer set search_path = '' as $$
declare due record; removed integer := 0; cutoff timestamptz;
begin
  if not coalesce((select cleanup_enabled from private.pilot_settings where singleton), false)
    then return 0; end if;
  if p_limit not between 1 and 100 then raise exception 'Invalid batch size'; end if;
  cutoff := clock_timestamp() - interval '60 days';
  for due in
    select id from public.rooms where ends_at < cutoff
    order by ends_at, id limit p_limit for update skip locked
  loop
    delete from public.reports
      where room_id = due.id
         or match_id in (select id from public.matches where room_id = due.id);
    delete from public.blocks
      where room_id = due.id
         or match_id in (select id from public.matches where room_id = due.id);
    delete from public.user_notifications where room_id = due.id;
    delete from public.rooms where id = due.id;
    removed := removed + 1;
  end loop;
  return removed;
end;
$$;

-- Rows disconnected from a Room must not survive the same 60-day ceiling.
create function private.retention_prune_detached()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cutoff timestamptz := clock_timestamp() - interval '60 days';
  report_count integer; block_count integer; notification_count integer;
begin
  if not coalesce((select cleanup_enabled from private.pilot_settings where singleton), false)
    then return '{"reports":0,"blocks":0,"notifications":0}'::jsonb; end if;
  delete from public.reports where room_id is null and created_at < cutoff;
  get diagnostics report_count = row_count;
  delete from public.blocks where room_id is null and created_at < cutoff;
  get diagnostics block_count = row_count;
  delete from public.user_notifications where room_id is null and created_at < cutoff;
  get diagnostics notification_count = row_count;
  return jsonb_build_object('reports', report_count, 'blocks', block_count,
    'notifications', notification_count);
end;
$$;

-- An anonymous identity is eligible only after all event memberships and
-- shared references are gone. Storage objects must be deleted by the API
-- before auth.admin.deleteUser is called by the trusted Edge worker.
create function private.retention_user_due(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select u.is_anonymous is true
      and u.created_at < now() - interval '60 days'
      and coalesce(u.last_sign_in_at, u.created_at) < now() - interval '60 days'
      and not exists (select 1 from public.profiles p where p.id=u.id
        and p.updated_at >= now() - interval '60 days')
      and not exists (select 1 from public.room_members m where m.user_id=u.id)
      and not exists (select 1 from public.rooms r where r.organizer_id=u.id)
      and not exists (select 1 from public.matches m where m.user_a_id=u.id or m.user_b_id=u.id)
      and not exists (select 1 from public.reports r where r.reporter_id=u.id or r.reported_user_id=u.id)
      and not exists (select 1 from public.blocks b where b.blocker_id=u.id or b.blocked_id=u.id)
      and not exists (select 1 from public.user_notifications n where n.recipient_id=u.id or n.actor_id=u.id)
      and not exists (select 1 from private.platform_admins a where a.user_id=u.id)
    from auth.users u where u.id=p_user_id
  ), false)
  and coalesce((select cleanup_enabled from private.pilot_settings where singleton), false);
$$;

create function private.retention_due_anonymous_users(p_limit integer default 25)
returns table(user_id uuid) language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce((select cleanup_enabled from private.pilot_settings where singleton), false)
    then return; end if;
  if p_limit not between 1 and 100 then raise exception 'Invalid batch size'; end if;
  return query
    select u.id from auth.users u
    where private.retention_user_due(u.id)
    order by u.created_at, u.id limit p_limit;
end;
$$;

-- These wrappers are in the API-exposed schema, but callable only with the
-- server-side service role. No browser key can execute retention operations.
create function public.retention_delete_expired_rooms(p_limit integer default 25)
returns integer language sql security definer set search_path = '' as $$
  select private.retention_delete_expired_rooms(p_limit);
$$;
create function public.retention_prune_detached()
returns jsonb language sql security definer set search_path = '' as $$
  select private.retention_prune_detached();
$$;
create function public.retention_due_anonymous_users(p_limit integer default 25)
returns table(user_id uuid) language sql stable security definer set search_path = '' as $$
  select * from private.retention_due_anonymous_users(p_limit);
$$;
create function public.retention_user_due(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.retention_user_due(p_user_id);
$$;

-- The cron token lives in Vault; neither it nor the service key is committed.
create function public.retention_worker_authorized(p_token text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.retention_worker_config c
    join vault.decrypted_secrets s on s.id=c.token_secret_id
    where c.singleton and c.enabled and s.decrypted_secret=p_token
  );
$$;

revoke all on function private.retention_delete_expired_rooms(integer),
  private.retention_prune_detached(), private.retention_due_anonymous_users(integer),
  private.retention_user_due(uuid),
  public.retention_delete_expired_rooms(integer), public.retention_prune_detached(),
  public.retention_due_anonymous_users(integer), public.retention_user_due(uuid),
  public.retention_worker_authorized(text) from public, anon, authenticated;
grant execute on function public.retention_delete_expired_rooms(integer),
  public.retention_prune_detached(), public.retention_due_anonymous_users(integer),
  public.retention_user_due(uuid),
  public.retention_worker_authorized(text) to service_role;

create function private.retention_dispatch()
returns bigint language plpgsql security definer set search_path = '' as $$
declare c private.retention_worker_config; token text; request_id bigint;
begin
  if not coalesce((select cleanup_enabled from private.pilot_settings where singleton), false)
    then return null; end if;
  select * into c from private.retention_worker_config where singleton and enabled;
  if c.endpoint is null then return null; end if;
  select decrypted_secret into token from vault.decrypted_secrets where id=c.token_secret_id;
  if token is null then raise exception 'Retention worker token is missing'; end if;
  select net.http_post(
    url := c.endpoint,
    headers := jsonb_build_object('Content-Type','application/json','x-retention-token',token),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  ) into request_id;
  return request_id;
end;
$$;
revoke all on function private.retention_dispatch() from public, anon, authenticated;

-- This schedule is harmless until the staging config and cleanup switch are
-- explicitly enabled; on a new project it returns without making a request.
select cron.schedule('rynow-retention-daily', '17 3 * * *',
  'select private.retention_dispatch()');

commit;
