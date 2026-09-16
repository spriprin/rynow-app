-- PILOT RC1 / Phase 2A. PREPARED ONLY: validate on isolated staging first.
-- Additive, forward-only product infrastructure. No retention cleanup executes.
begin;

alter table public.profiles
  add column if not exists accepted_document_version text,
  add column if not exists accepted_at timestamptz;
alter table public.rooms
  add column if not exists total_attendance integer
    check(total_attendance is null or total_attendance >= 0);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles for insert to authenticated
  with check(
    id=(select auth.uid())
    and age_confirmed_18=true
    and avatar_path is not null
    and split_part(avatar_path,'/',1)=(select auth.uid())::text
    and accepted_document_version is null
    and accepted_at is null
  );
revoke update on public.profiles from authenticated;
grant update(display_name,avatar_path,gender,discovery_preference,updated_at) on public.profiles to authenticated;

create or replace function public.accept_pilot_terms(p_version text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare accepted timestamptz:=clock_timestamp();
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_version <> 'pilot-rc1-draft-2026-09-14' then raise exception 'Unsupported document version'; end if;
  update public.profiles set accepted_document_version=p_version,accepted_at=accepted,updated_at=accepted
    where id=auth.uid() and age_confirmed_18=true;
  if not found then raise exception 'Complete the 18+ profile first'; end if;
  return accepted;
end;
$$;

create table public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null check(kind in ('interest','match','message')),
  source_id uuid not null,
  room_id uuid references public.rooms(id) on delete set null,
  match_id uuid references public.matches(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz,
  unique(recipient_id,kind,source_id)
);
create index user_notifications_recipient_unread_idx
  on public.user_notifications(recipient_id,created_at desc) where read_at is null;
alter table public.user_notifications enable row level security;
revoke all on public.user_notifications from public,anon,authenticated;

create or replace function private.create_rc1_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target public.matches; recipient uuid;
begin
  if tg_table_name='interests' then
    insert into public.user_notifications(recipient_id,actor_id,kind,source_id,room_id)
      values(new.to_user_id,new.from_user_id,'interest',new.id,new.room_id) on conflict do nothing;
  elsif tg_table_name='matches' then
    insert into public.user_notifications(recipient_id,actor_id,kind,source_id,room_id,match_id)
      values(new.user_a_id,new.user_b_id,'match',new.id,new.room_id,new.id),
            (new.user_b_id,new.user_a_id,'match',new.id,new.room_id,new.id) on conflict do nothing;
  elsif tg_table_name='messages' then
    select * into target from public.matches where id=new.match_id;
    recipient:=case when target.user_a_id=new.sender_id then target.user_b_id else target.user_a_id end;
    insert into public.user_notifications(recipient_id,actor_id,kind,source_id,room_id,match_id)
      values(recipient,new.sender_id,'message',new.id,target.room_id,target.id) on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger rc1_interest_notification after insert on public.interests
  for each row execute function private.create_rc1_notification();
create trigger rc1_match_notification after insert on public.matches
  for each row execute function private.create_rc1_notification();
create trigger rc1_message_notification after insert on public.messages
  for each row execute function private.create_rc1_notification();

create or replace function public.notification_state()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'interest',count(*) filter(where kind='interest' and read_at is null),
    'match',count(*) filter(where kind='match' and read_at is null),
    'message',count(*) filter(where kind='message' and read_at is null),
    'total',count(*) filter(where read_at is null),
    'server_now',clock_timestamp())
  from public.user_notifications n
  where n.recipient_id=auth.uid()
    and (n.actor_id is null or not public.is_pair_blocked(auth.uid(),n.actor_id));
$$;
create or replace function public.mark_notifications_read(p_kind text default null,p_room_id uuid default null,p_match_id uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_kind is not null and p_kind not in ('interest','match','message') then raise exception 'Invalid notification type'; end if;
  update public.user_notifications set read_at=coalesce(read_at,clock_timestamp())
  where recipient_id=auth.uid() and read_at is null
    and (p_kind is null or kind=p_kind)
    and (p_room_id is null or room_id=p_room_id)
    and (p_match_id is null or match_id=p_match_id);
  get diagnostics changed=row_count;
  return changed;
end;
$$;

create table public.match_irl_feedback (
  match_id uuid not null references public.matches(id) on delete cascade,
  respondent_id uuid not null references auth.users(id) on delete cascade,
  answer text check(answer is null or answer in ('yes','no','not_yet','prefer_not_to_say')),
  prompted_at timestamptz not null default clock_timestamp(),
  answered_at timestamptz,
  primary key(match_id,respondent_id),
  constraint feedback_answer_timestamp check((answer is null)=(answered_at is null))
);
create index match_irl_feedback_answered_idx on public.match_irl_feedback(match_id,answer)
  where answered_at is not null;
alter table public.match_irl_feedback enable row level security;
create policy feedback_read_self on public.match_irl_feedback for select to authenticated
  using(respondent_id=(select auth.uid()) and public.can_access_match(match_id,(select auth.uid())));
revoke all on public.match_irl_feedback from public,anon,authenticated;
grant select on public.match_irl_feedback to authenticated;

create or replace function public.record_match_irl_feedback(p_match_id uuid,p_answer text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare target public.matches; answered timestamptz:=clock_timestamp(); existing text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_answer not in ('yes','no','not_yet','prefer_not_to_say') then raise exception 'Invalid feedback answer'; end if;
  select * into target from public.matches where id=p_match_id for update;
  if target.id is null or (auth.uid()<>target.user_a_id and auth.uid()<>target.user_b_id) then raise exception 'Match access required'; end if;
  if not exists(select 1 from public.rooms r where r.id=target.room_id and (r.status='closed' or r.ends_at<=answered))
    then raise exception 'Feedback is available after the event'; end if;
  select answer into existing from public.match_irl_feedback
    where match_id=p_match_id and respondent_id=auth.uid() for update;
  if existing is not null then
    if existing<>p_answer then raise exception 'Feedback was already submitted'; end if;
    return (select answered_at from public.match_irl_feedback where match_id=p_match_id and respondent_id=auth.uid());
  end if;
  insert into public.match_irl_feedback(match_id,respondent_id,answer,answered_at)
    values(p_match_id,auth.uid(),p_answer,answered)
  on conflict(match_id,respondent_id) do update set
    answer=excluded.answer,answered_at=excluded.answered_at
    where public.match_irl_feedback.answer is null;
  return answered;
end;
$$;

create or replace function public.user_connections()
returns table(
  match_id uuid,room_id uuid,room_name text,room_join_code text,room_status text,
  room_ends_at timestamptz,other_user_id uuid,display_name text,avatar_path text,
  matched_at timestamptz,last_message_at timestamptz,last_message_body text,
  unread_count integer,feedback_due boolean,feedback_answer text
) language sql stable security definer set search_path = '' as $$
  select m.id,r.id,r.name,r.join_code,r.status,r.ends_at,
    case when m.user_a_id=auth.uid() then m.user_b_id else m.user_a_id end,
    p.display_name,p.avatar_path,m.created_at,m.last_message_at,
    (select body from public.messages where match_id=m.id order by created_at desc,id desc limit 1),
    (select count(*)::integer from public.messages where match_id=m.id and sender_id<>auth.uid() and read_at is null),
    (r.status='closed' or r.ends_at<=now()) and f.answer is null,
    f.answer
  from public.matches m join public.rooms r on r.id=m.room_id
  join public.profiles p on p.id=case when m.user_a_id=auth.uid() then m.user_b_id else m.user_a_id end
  left join public.match_irl_feedback f on f.match_id=m.id and f.respondent_id=auth.uid()
  where m.status='active' and (auth.uid()=m.user_a_id or auth.uid()=m.user_b_id)
    and not public.is_pair_blocked(m.user_a_id,m.user_b_id)
  order by coalesce(m.last_message_at,m.created_at) desc limit 100;
$$;

alter table public.reports drop constraint if exists valid_report_reason;
alter table public.reports drop constraint if exists valid_report_status;
update public.reports set reason=case reason
  when 'Harassment' then 'Harassment / inappropriate behaviour'
  when 'Inappropriate behavior' then 'Inappropriate profile/content'
  when 'Fake profile' then 'Fake profile / impersonation' else reason end;
update public.reports set status=case status
  when 'submitted' then 'open' when 'reviewing' then 'reviewed' when 'dismissed' then 'resolved' else status end;
alter table public.reports
  alter column status set default 'open',
  add column if not exists block_requested boolean not null default false,
  add column if not exists event_staff_share_consent boolean not null default false,
  add column if not exists reviewed_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add constraint valid_report_reason check(reason in(
    'Harassment / inappropriate behaviour','Spam','Fake profile / impersonation',
    'Inappropriate profile/content','Safety concern','Other')),
  add constraint valid_report_status check(status in('open','reviewed','resolved'));

create or replace function private.rc1_apply_block(p_blocker uuid,p_blocked uuid,p_room uuid,p_match uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.blocks(blocker_id,blocked_id,room_id,match_id)
    values(p_blocker,p_blocked,p_room,p_match)
    on conflict(blocker_id,blocked_id) do update set room_id=coalesce(public.blocks.room_id,excluded.room_id),
      match_id=coalesce(public.blocks.match_id,excluded.match_id);
  update public.explore_items set invalidated_at=coalesce(invalidated_at,clock_timestamp())
    where action is null and invalidated_at is null
      and ((viewer_id=p_blocker and candidate_id=p_blocked) or (viewer_id=p_blocked and candidate_id=p_blocker));
  update public.interests set status='declined',responded_at=coalesce(responded_at,clock_timestamp())
    where status='pending' and ((from_user_id=p_blocker and to_user_id=p_blocked)
      or (from_user_id=p_blocked and to_user_id=p_blocker));
end;
$$;

create or replace function private.rc1_resolve_safety_room(p_actor uuid,p_target uuid,p_room uuid,p_match uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare resolved uuid;
begin
  if p_actor is null or p_target is null or p_actor=p_target then raise exception 'Invalid safety target'; end if;
  if p_match is not null then
    select room_id into resolved from public.matches where id=p_match
      and (p_actor=user_a_id or p_actor=user_b_id)
      and (p_target=user_a_id or p_target=user_b_id);
    if resolved is null or (p_room is not null and p_room<>resolved) then raise exception 'Invalid Match context'; end if;
  else resolved:=p_room;
  end if;
  if not exists(select 1 from public.room_members a join public.room_members b using(room_id)
    where a.room_id=resolved and a.user_id=p_actor and b.user_id=p_target)
    then raise exception 'Invalid Room context'; end if;
  return resolved;
end;
$$;

create or replace function public.block_user_rc1(p_blocked_id uuid,p_room_id uuid,p_match_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare resolved uuid;
begin
  resolved:=private.rc1_resolve_safety_room(auth.uid(),p_blocked_id,p_room_id,p_match_id);
  perform private.rc1_apply_block(auth.uid(),p_blocked_id,resolved,p_match_id);
end;
$$;
create or replace function public.submit_report_rc1(
  p_reported_user_id uuid,p_room_id uuid,p_match_id uuid,p_category text,p_details text default null,
  p_block boolean default false,p_share_with_event_staff boolean default false,p_client_action_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare u uuid:=auth.uid(); resolved uuid; clean text:=nullif(btrim(p_details),''); saved public.reports;
begin
  if u is null then raise exception 'Authentication required'; end if;
  if p_client_action_id is null then raise exception 'Report request ID required'; end if;
  if p_category not in('Harassment / inappropriate behaviour','Spam','Fake profile / impersonation',
    'Inappropriate profile/content','Safety concern','Other') then raise exception 'Invalid report category'; end if;
  if clean is not null and char_length(clean)>1000 then raise exception 'Report details are too long'; end if;
  resolved:=private.rc1_resolve_safety_room(u,p_reported_user_id,p_room_id,p_match_id);
  perform pg_advisory_xact_lock(hashtext(u::text),hashtext(p_client_action_id::text));
  select * into saved from public.reports where reporter_id=u and client_action_id=p_client_action_id;
  if saved.id is not null then
    if saved.reported_user_id<>p_reported_user_id or saved.room_id<>resolved
      or saved.match_id is distinct from p_match_id or saved.reason<>p_category
      or saved.details is distinct from clean or saved.block_requested<>p_block
      or saved.event_staff_share_consent<>p_share_with_event_staff
      then raise exception 'Report request ID already used'; end if;
    return saved.id;
  end if;
  insert into public.reports(reporter_id,reported_user_id,room_id,match_id,reason,details,status,
    block_requested,event_staff_share_consent,client_action_id)
  values(u,p_reported_user_id,resolved,p_match_id,p_category,clean,'open',
    p_block,p_share_with_event_staff,p_client_action_id) returning * into saved;
  if p_block then perform private.rc1_apply_block(u,p_reported_user_id,resolved,p_match_id); end if;
  return saved.id;
end;
$$;

create table private.platform_admins(
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp()
);
create table private.report_moderation_audit(
  id bigint generated always as identity primary key,
  report_id uuid not null references public.reports(id) on delete cascade,
  admin_id uuid references auth.users(id) on delete set null,
  from_status text not null,to_status text not null,
  changed_at timestamptz not null default clock_timestamp()
);
revoke all on private.platform_admins,private.report_moderation_audit from public,anon,authenticated;
create or replace function private.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean,true)
    and exists(select 1 from private.platform_admins where user_id=auth.uid());
$$;
create or replace function public.admin_operations_rooms()
returns table(room_id uuid,room_name text,status text,joined bigint,recently_active bigint,
  discovery_eligible bigint,explore_users bigint,profiles_viewed bigint,interests bigint,matches bigint,
  conversations_started bigint,blocks bigint,reports bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Platform admin access required'; end if;
  return query select r.id,r.name,r.status,
    (select count(*) from public.room_members x where x.room_id=r.id),
    (select count(*) from public.room_members x where x.room_id=r.id and x.is_active and x.discovery_enabled and x.left_at is null and x.last_seen_at>=now()-interval '10 minutes'),
    (select count(*) from public.room_members x where x.room_id=r.id and private.is_discovery_eligible(r.id,x.user_id,now())),
    (select count(distinct viewer_id) from public.explore_batches x where x.room_id=r.id),
    (select count(*) from public.explore_items x where x.room_id=r.id and x.first_seen_at is not null),
    (select count(*) from public.interests x where x.room_id=r.id),
    (select count(*) from public.matches x where x.room_id=r.id),
    (select count(*) from public.matches x where x.room_id=r.id and exists(select 1 from public.messages z where z.match_id=x.id)),
    (select count(*) from public.blocks x where x.room_id=r.id),
    (select count(*) from public.reports x where x.room_id=r.id)
  from public.rooms r order by case r.status when 'open' then 0 else 1 end,r.starts_at desc limit 200;
end;
$$;
create or replace function public.admin_report_queue(p_status text default null)
returns table(report_id uuid,category text,room_id uuid,room_name text,reported_user_id uuid,
  reported_display_name text,created_at timestamptz,details text,status text,event_staff_share_consent boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Platform admin access required'; end if;
  if p_status is not null and p_status not in('open','reviewed','resolved') then raise exception 'Invalid moderation state'; end if;
  return query select rp.id,rp.reason,rp.room_id,r.name,rp.reported_user_id,p.display_name,
    rp.created_at,rp.details,rp.status,rp.event_staff_share_consent
  from public.reports rp left join public.rooms r on r.id=rp.room_id
    join public.profiles p on p.id=rp.reported_user_id
  where p_status is null or rp.status=p_status order by rp.created_at desc limit 500;
end;
$$;
create or replace function public.admin_set_report_status(p_report_id uuid,p_status text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare old text; changed timestamptz:=clock_timestamp();
begin
  if not private.is_platform_admin() then raise exception 'Platform admin access required'; end if;
  if p_status not in('open','reviewed','resolved') then raise exception 'Invalid moderation state'; end if;
  select status into old from public.reports where id=p_report_id for update;
  if old is null then raise exception 'Report not found'; end if;
  update public.reports set status=p_status,
    reviewed_at=case when p_status='reviewed' then coalesce(reviewed_at,changed) else reviewed_at end,
    resolved_at=case when p_status='resolved' then coalesce(resolved_at,changed) else resolved_at end
    where id=p_report_id;
  if old<>p_status then insert into private.report_moderation_audit(report_id,admin_id,from_status,to_status)
    values(p_report_id,auth.uid(),old,p_status); end if;
  return changed;
end;
$$;

create table public.user_data_deletion_requests(
  user_id uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default clock_timestamp(),
  status text not null default 'pending' check(status in('pending','reviewing','completed','cancelled'))
);
alter table public.user_data_deletion_requests enable row level security;
create policy deletion_request_read_self on public.user_data_deletion_requests for select to authenticated
  using(user_id=(select auth.uid()));
revoke all on public.user_data_deletion_requests from public,anon,authenticated;
grant select on public.user_data_deletion_requests to authenticated;
create or replace function public.request_my_data_deletion()
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare requested timestamptz:=clock_timestamp();
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  insert into public.user_data_deletion_requests(user_id,requested_at,status)
    values(auth.uid(),requested,'pending')
  on conflict(user_id) do update set requested_at=excluded.requested_at,status='pending';
  return requested;
end;
$$;

create or replace function public.organizer_set_total_attendance(p_room_id uuid,p_total integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or coalesce(((select auth.jwt())->>'is_anonymous')::boolean,true)
    or p_total<0 then raise exception 'Organizer access required'; end if;
  update public.rooms set total_attendance=p_total where id=p_room_id and organizer_id=auth.uid();
  if not found then raise exception 'Organizer access required'; end if;
end;
$$;
create or replace function public.room_analytics(p_room_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.rooms; result jsonb;
begin
  if auth.uid() is null or coalesce(((select auth.jwt())->>'is_anonymous')::boolean,true)
    then raise exception 'Permanent organizer account required'; end if;
  select * into r from public.rooms where id=p_room_id and organizer_id=auth.uid();
  if r.id is null then raise exception 'Organizer access required'; end if;
  select jsonb_build_object(
    'room_id',r.id,'last_updated',clock_timestamp(),
    'summary',jsonb_build_object(
      'total_attendance',r.total_attendance,
      'joined_memberships',(select count(*) from public.room_members where room_id=r.id),
      'active_memberships',(select count(*) from public.room_members where room_id=r.id and is_active and discovery_enabled and left_at is null and last_seen_at>=now()-interval '10 minutes'),
      'discovery_eligible_memberships',(select count(*) from public.room_members m where m.room_id=r.id and private.is_discovery_eligible(r.id,m.user_id,now())),
      'explore_users',(select count(distinct viewer_id) from public.explore_batches where room_id=r.id),
      'profiles_viewed',(select count(*) from public.explore_items where room_id=r.id and first_seen_at is not null),
      'interests_sent',(select count(*) from public.interests where room_id=r.id),
      'matches_created',(select count(*) from public.matches where room_id=r.id),
      'conversations_started',(select count(*) from public.matches m where m.room_id=r.id and exists(select 1 from public.messages z where z.match_id=m.id)),
      'blocks_count',(select count(*) from public.blocks where room_id=r.id),
      'reports_count',(select count(*) from public.reports where room_id=r.id),
      'irl_yes',(select count(*) from public.match_irl_feedback f join public.matches m on m.id=f.match_id where m.room_id=r.id and f.answer='yes'),
      'irl_no',(select count(*) from public.match_irl_feedback f join public.matches m on m.id=f.match_id where m.room_id=r.id and f.answer='no'),
      'irl_not_yet',(select count(*) from public.match_irl_feedback f join public.matches m on m.id=f.match_id where m.room_id=r.id and f.answer='not_yet'),
      'irl_prefer_not_to_say',(select count(*) from public.match_irl_feedback f join public.matches m on m.id=f.match_id where m.room_id=r.id and f.answer='prefer_not_to_say'),
      'median_match_to_first_message_seconds',(select percentile_cont(.5) within group(order by extract(epoch from(first.created_at-m.created_at)))
        from public.matches m join lateral(select created_at from public.messages where match_id=m.id order by created_at limit 1) first on true where m.room_id=r.id)
    ),
    'rates',jsonb_build_object(
      'join_rate',case when r.total_attendance>0 then round(100.0*(select count(*) from public.room_members where room_id=r.id)/r.total_attendance,1) end,
      'explore_rate',case when (select count(*) from public.room_members where room_id=r.id)>0 then round(100.0*(select count(distinct viewer_id) from public.explore_batches where room_id=r.id)/(select count(*) from public.room_members where room_id=r.id),1) end,
      'match_to_conversation_rate',case when (select count(*) from public.matches where room_id=r.id)>0 then round(100.0*(select count(*) from public.matches m where m.room_id=r.id and exists(select 1 from public.messages z where z.match_id=m.id))/(select count(*) from public.matches where room_id=r.id),1) end
    )
  ) into result;
  return result;
end;
$$;

-- Supabase Realtime is optional; polling remains the source-of-truth fallback.
do $$ begin
  if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime')
    and not exists(select 1 from pg_catalog.pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='user_notifications') then
    alter publication supabase_realtime add table public.user_notifications;
  end if;
end $$;

-- Remove all legacy safety RPC paths that still mutate Drop rows.
revoke all on function public.block_user_in_context(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.submit_report_idempotent(uuid,uuid,uuid,text,text,boolean,uuid) from public,anon,authenticated;
revoke all on function public.block_user(uuid) from public,anon,authenticated;
revoke all on function public.submit_report(uuid,uuid,uuid,text,text,boolean) from public,anon,authenticated;
revoke all on function private.create_rc1_notification(),private.rc1_apply_block(uuid,uuid,uuid,uuid),
  private.rc1_resolve_safety_room(uuid,uuid,uuid,uuid),private.is_platform_admin() from public,anon,authenticated;
revoke all on function public.accept_pilot_terms(text),public.notification_state(),
  public.mark_notifications_read(text,uuid,uuid),public.record_match_irl_feedback(uuid,text),
  public.user_connections(),public.block_user_rc1(uuid,uuid,uuid),
  public.submit_report_rc1(uuid,uuid,uuid,text,text,boolean,boolean,uuid),
  public.admin_operations_rooms(),public.admin_report_queue(text),public.admin_set_report_status(uuid,text),
  public.request_my_data_deletion(),public.organizer_set_total_attendance(uuid,integer),public.room_analytics(uuid)
  from public,anon,authenticated;
grant execute on function public.accept_pilot_terms(text),public.notification_state(),
  public.mark_notifications_read(text,uuid,uuid),public.record_match_irl_feedback(uuid,text),
  public.user_connections(),public.block_user_rc1(uuid,uuid,uuid),
  public.submit_report_rc1(uuid,uuid,uuid,text,text,boolean,boolean,uuid),
  public.admin_operations_rooms(),public.admin_report_queue(text),public.admin_set_report_status(uuid,text),
  public.request_my_data_deletion(),public.organizer_set_total_attendance(uuid,integer),public.room_analytics(uuid)
  to authenticated;
commit;
