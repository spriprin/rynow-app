-- GP-A through GP-I live database acceptance. This script is intentionally
-- rollback-only: it exercises the deployed functions without retaining users,
-- Rooms, assignments, Interests, Matches, messages, Blocks or Reports.

begin;

create temporary table gp_actors (
  slot integer primary key,
  user_id uuid not null unique
) on commit drop;

insert into gp_actors (slot, user_id)
select slot, extensions.gen_random_uuid()
from generate_series(1, 11) as slot;

insert into auth.users (
  id, aud, role, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_anonymous
)
select user_id, 'authenticated', 'authenticated',
       '{"provider":"anonymous","providers":["anonymous"]}'::jsonb,
       '{}'::jsonb, clock_timestamp(), clock_timestamp(), true
from gp_actors;

insert into public.profiles (
  id, display_name, avatar_path, age_confirmed_18, gender, discovery_preference
)
select user_id,
       'GP Actor ' || slot,
       user_id::text || '/gp-avatar.png',
       true,
       case
         when slot in (1, 4, 6, 8, 11) then 'male'
         when slot in (2, 3, 7) then 'female'
         when slot in (5, 9) then 'prefer_not_to_say'
         else null
       end,
       case
         when slot = 1 then 'female'
         when slot = 2 then 'male'
         when slot in (3, 4, 5, 6, 7, 8, 9) then 'everyone'
         when slot = 11 then 'female'
         else null
       end
from gp_actors;

create temporary table gp_room (
  room_id uuid primary key,
  join_code text not null
) on commit drop;

with created as (
  insert into public.rooms (
    organizer_id, name, venue_name, city, starts_at, ends_at, status, join_code
  )
  select user_id, 'GP Acceptance Room', 'GP Lab', 'Riga',
         clock_timestamp() - interval '1 minute',
         clock_timestamp() + interval '3 hours',
         'open', encode(extensions.gen_random_bytes(12), 'hex')
  from gp_actors where slot = 1
  returning id, join_code
)
insert into gp_room select id, join_code from created;

insert into public.room_members (
  room_id, user_id, joined_at, last_seen_at, is_active,
  discovery_enabled, left_at
)
select gp_room.room_id, gp_actors.user_id, clock_timestamp(), clock_timestamp(),
       true, true, null
from gp_room cross join gp_actors
where gp_actors.slot <= 10;

grant select on gp_actors, gp_room to authenticated;

-- GP-A: a complete new profile joins with its persistent gender/preference.
select set_config('request.jwt.claim.sub', (select user_id::text from gp_actors where slot = 11), true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select user_id::text from gp_actors where slot = 11),
  'role', 'authenticated', 'is_anonymous', true
)::text, true);
set local role authenticated;
select public.join_room_by_code((select join_code from gp_room));
reset role;

do $$
begin
  if not exists (
    select 1 from public.room_members rm
    join gp_actors a on a.user_id = rm.user_id and a.slot = 11
    join gp_room r on r.room_id = rm.room_id
  ) then raise exception 'GP-A failed: complete profile did not join'; end if;
end;
$$;

-- GP-F: the lightweight completion updates only the existing profile fields.
create temporary table gp_relationships (
  match_id uuid primary key
) on commit drop;

with created as (
  insert into public.matches (room_id, user_a_id, user_b_id)
  select r.room_id, least(a.user_id, b.user_id), greatest(a.user_id, b.user_id)
  from gp_room r
  join gp_actors a on a.slot = 10
  join gp_actors b on b.slot = 9
  returning id
)
insert into gp_relationships select id from created;

insert into public.messages (match_id, sender_id, body, client_message_id)
select m.match_id, a.user_id, 'GP preserved message', extensions.gen_random_uuid()
from gp_relationships m join gp_actors a on a.slot = 10;

insert into public.blocks (blocker_id, blocked_id, room_id, match_id)
select a.user_id, b.user_id, r.room_id, m.match_id
from gp_actors a
join gp_actors b on b.slot = 9
join gp_room r on true
join gp_relationships m on true
where a.slot = 10;

insert into public.reports (
  reporter_id, reported_user_id, room_id, match_id, reason, details, client_action_id
)
select a.user_id, b.user_id, r.room_id, m.match_id, 'Other',
       'GP preservation check', extensions.gen_random_uuid()
from gp_actors a
join gp_actors b on b.slot = 9
join gp_room r on true
join gp_relationships m on true
where a.slot = 10;

select set_config('request.jwt.claim.sub', (select user_id::text from gp_actors where slot = 10), true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select user_id::text from gp_actors where slot = 10),
  'role', 'authenticated', 'is_anonymous', true
)::text, true);
set local role authenticated;
update public.profiles
set gender = 'male', discovery_preference = 'female'
where id = auth.uid();
update public.profiles
set display_name = 'Forbidden update'
where id = (select user_id from gp_actors where slot = 9);
reset role;

do $$
declare
  existing_id uuid := (select user_id from gp_actors where slot = 10);
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = existing_id
      and p.display_name = 'GP Actor 10'
      and p.avatar_path = existing_id::text || '/gp-avatar.png'
      and p.age_confirmed_18
      and p.gender = 'male'
      and p.discovery_preference = 'female'
  ) then raise exception 'GP-F failed: existing profile identity/content changed'; end if;
  if (select display_name from public.profiles p join gp_actors a on a.user_id = p.id where a.slot = 9) <> 'GP Actor 9'
    then raise exception 'GP-F failed: profile RLS allowed a cross-user update'; end if;
  if (select count(*) from public.room_members where user_id = existing_id) <> 1
    then raise exception 'GP-F failed: membership changed'; end if;
  if (select count(*) from public.matches where id = (select match_id from gp_relationships)) <> 1
    then raise exception 'GP-F failed: Match changed'; end if;
  if (select count(*) from public.messages where match_id = (select match_id from gp_relationships)) <> 1
    then raise exception 'GP-F failed: chat changed'; end if;
  if (select count(*) from public.blocks where blocker_id = existing_id) <> 1
    then raise exception 'GP-F failed: Block changed'; end if;
  if (select count(*) from public.reports where reporter_id = existing_id) <> 1
    then raise exception 'GP-F failed: Report changed'; end if;
end;
$$;

-- GP-B/G: male -> women; the returned Explore payload is already filtered.
select set_config('request.jwt.claim.sub', (select user_id::text from gp_actors where slot = 1), true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select user_id::text from gp_actors where slot = 1),
  'role', 'authenticated', 'is_anonymous', true
)::text, true);
set local role authenticated;
select public.claim_explore_batch((select room_id from gp_room));
reset role;

do $$
declare viewer uuid := (select user_id from gp_actors where slot = 1);
begin
  if not exists (select 1 from public.explore_items where viewer_id = viewer and invalidated_at is null)
    then raise exception 'GP-B failed: no compatible women were assigned'; end if;
  if exists (
    select 1 from public.explore_items ei
    join public.profiles p on p.id = ei.candidate_id
    where ei.viewer_id = viewer and ei.invalidated_at is null and p.gender <> 'female'
  ) then raise exception 'GP-G failed: male viewer received an unfiltered candidate'; end if;
end;
$$;

create temporary table gp_first_batch_snapshot on commit drop as
select eb.id as batch_id,
       array_agg(ei.candidate_id order by ei.position) as candidate_ids
from public.explore_batches eb
join public.explore_items ei on ei.batch_id = eb.id and ei.invalidated_at is null
join gp_actors a on a.user_id = eb.viewer_id and a.slot = 1
group by eb.id;

-- GP-D: changing Women -> Everyone keeps the current batch stable.
select set_config('request.jwt.claim.sub', (select user_id::text from gp_actors where slot = 1), true);
set local role authenticated;
update public.profiles set discovery_preference = 'everyone' where id = auth.uid();
select public.claim_explore_batch((select room_id from gp_room));
reset role;

do $$
begin
  if not exists (
    select 1
    from gp_first_batch_snapshot s
    join lateral (
      select array_agg(ei.candidate_id order by ei.position) as candidate_ids
      from public.explore_items ei where ei.batch_id = s.batch_id and ei.invalidated_at is null
    ) current on current.candidate_ids = s.candidate_ids
  ) then raise exception 'GP-D failed: changing preference mutated the current batch'; end if;
end;
$$;

update public.explore_items ei
set first_seen_at = clock_timestamp(), action = 'passed'
where ei.batch_id = (select batch_id from gp_first_batch_snapshot);
update public.explore_batches
set completed_at = clock_timestamp() - interval '2 seconds',
    cooldown_until = clock_timestamp() - interval '1 second'
where id = (select batch_id from gp_first_batch_snapshot);

select set_config('request.jwt.claim.sub', (select user_id::text from gp_actors where slot = 1), true);
set local role authenticated;
select public.claim_explore_batch((select room_id from gp_room));
reset role;

do $$
declare viewer uuid := (select user_id from gp_actors where slot = 1);
begin
  if not exists (
    select 1 from public.explore_items ei
    join public.profiles p on p.id = ei.candidate_id
    join public.explore_batches eb on eb.id = ei.batch_id
    where ei.viewer_id = viewer and eb.sequence_number = 2
      and ei.invalidated_at is null and p.gender <> 'female'
  ) then raise exception 'GP-D failed: future Everyone batch did not use the new preference'; end if;
end;
$$;

-- GP-C: female -> men in Explore.
select set_config('request.jwt.claim.sub', (select user_id::text from gp_actors where slot = 2), true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select user_id::text from gp_actors where slot = 2),
  'role', 'authenticated', 'is_anonymous', true
)::text, true);
set local role authenticated;
select public.claim_explore_batch((select room_id from gp_room));
reset role;

do $$
declare viewer uuid := (select user_id from gp_actors where slot = 2);
begin
  if not exists (select 1 from public.explore_items where viewer_id = viewer and invalidated_at is null)
    then raise exception 'GP-C failed: no compatible men were assigned'; end if;
  if exists (
    select 1 from public.explore_items ei
    join public.profiles p on p.id = ei.candidate_id
    where ei.viewer_id = viewer and ei.invalidated_at is null and p.gender <> 'male'
  ) then raise exception 'GP-C failed: female viewer received a non-male candidate'; end if;
end;
$$;

-- GP-E: prefer_not_to_say persists with the safe Everyone default.
do $$
begin
  if not exists (
    select 1 from public.profiles p join gp_actors a on a.user_id = p.id
    where a.slot = 5 and p.gender = 'prefer_not_to_say' and p.discovery_preference = 'everyone'
  ) then raise exception 'GP-E failed: safe default was not persisted'; end if;
end;
$$;

-- Drops use the same compatible pool before Fair Exposure ranking.
select set_config('request.jwt.claim.sub', (select user_id::text from gp_actors where slot = 7), true);
set local role authenticated;
update public.profiles set discovery_preference = 'male' where id = auth.uid();
reset role;

create temporary table gp_drop (drop_id uuid primary key) on commit drop;
with created as (
  insert into public.drops (
    room_id, sequence_number, scheduled_at, opened_at,
    drop_size, min_unlock_count, interest_budget
  )
  select room_id, 1, clock_timestamp(), clock_timestamp(), 12, 1, 6 from gp_room
  returning id
)
insert into gp_drop select id from created;
grant select on gp_drop to authenticated;

select set_config('request.jwt.claim.sub', (select user_id::text from gp_actors where slot = 7), true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select user_id::text from gp_actors where slot = 7),
  'role', 'authenticated', 'is_anonymous', true
)::text, true);
set local role authenticated;
select * from public.claim_your_drop((select drop_id from gp_drop));
reset role;

do $$
declare viewer uuid := (select user_id from gp_actors where slot = 7);
begin
  if not exists (select 1 from public.drop_items where viewer_id = viewer and invalidated_at is null)
    then raise exception 'GP-G failed: no compatible Drop items were assigned'; end if;
  if exists (
    select 1 from public.drop_items di
    join public.profiles p on p.id = di.candidate_id
    where di.viewer_id = viewer and di.invalidated_at is null and p.gender <> 'male'
  ) then raise exception 'GP-G failed: Drop returned an unfiltered candidate'; end if;
end;
$$;

-- GP-I: an incoming Interest remains visible after the recipient changes Show me.
create temporary table gp_interest_drop (drop_id uuid primary key) on commit drop;
with created as (
  insert into public.drops (
    room_id, sequence_number, scheduled_at, opened_at,
    drop_size, min_unlock_count, interest_budget
  )
  select room_id, 2, clock_timestamp(), clock_timestamp(), 12, 1, 6 from gp_room
  returning id
)
insert into gp_interest_drop select id from created;
grant select on gp_interest_drop to authenticated;

select set_config('request.jwt.claim.sub', (select user_id::text from gp_actors where slot = 6), true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select user_id::text from gp_actors where slot = 6),
  'role', 'authenticated', 'is_anonymous', true
)::text, true);
set local role authenticated;
select * from public.claim_your_drop((select drop_id from gp_interest_drop));
reset role;

create temporary table gp_interest_item (drop_item_id uuid primary key) on commit drop;
insert into gp_interest_item
select di.id from public.drop_items di
join gp_interest_drop d on d.drop_id = di.drop_id
join gp_actors sender on sender.user_id = di.viewer_id and sender.slot = 6
join gp_actors recipient on recipient.user_id = di.candidate_id and recipient.slot = 1;
grant select on gp_interest_item to authenticated;

select set_config('request.jwt.claim.sub', (select user_id::text from gp_actors where slot = 6), true);
set local role authenticated;
select public.mark_drop_item_seen((select drop_item_id from gp_interest_item));
select public.send_interest((select drop_item_id from gp_interest_item));
reset role;

create temporary table gp_incoming_result (from_user_id uuid) on commit drop;
grant insert, select on gp_incoming_result to authenticated;

select set_config('request.jwt.claim.sub', (select user_id::text from gp_actors where slot = 1), true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select user_id::text from gp_actors where slot = 1),
  'role', 'authenticated', 'is_anonymous', true
)::text, true);
set local role authenticated;
update public.profiles set discovery_preference = 'female' where id = auth.uid();
insert into gp_incoming_result (from_user_id)
select from_user_id from public.interested_in_you((select room_id from gp_room));
reset role;

do $$
begin
  if not exists (
    select 1 from gp_incoming_result result
    join gp_actors sender on sender.user_id = result.from_user_id and sender.slot = 6
  ) then raise exception 'GP-I failed: changing preference hid a valid incoming Interest'; end if;
end;
$$;

select 'GP-A through GP-I' as suite, 'PASS' as status;

rollback;
