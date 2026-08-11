-- Demo credentials: organizer@here.demo / demo-password
-- Guest credentials: maya@here.demo / demo-password (and every other @here.demo user below)

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  seed.id,
  'authenticated',
  'authenticated',
  seed.email,
  crypt('demo-password', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('display_name', seed.display_name, 'role', seed.account_role),
  now(),
  now()
from (values
  ('10000000-0000-4000-8000-000000000001'::uuid, 'organizer@here.demo', 'Demo Organizer', 'ORGANIZER'),
  ('10000000-0000-4000-8000-000000000002'::uuid, 'maya@here.demo', 'Maya', 'USER'),
  ('10000000-0000-4000-8000-000000000003'::uuid, 'noah@here.demo', 'Noah', 'USER'),
  ('10000000-0000-4000-8000-000000000004'::uuid, 'sofia@here.demo', 'Sofia', 'USER'),
  ('10000000-0000-4000-8000-000000000005'::uuid, 'leo@here.demo', 'Leo', 'USER'),
  ('10000000-0000-4000-8000-000000000006'::uuid, 'amelia@here.demo', 'Amelia', 'USER'),
  ('10000000-0000-4000-8000-000000000007'::uuid, 'martin@here.demo', 'Martin', 'USER'),
  ('10000000-0000-4000-8000-000000000008'::uuid, 'elena@here.demo', 'Elena', 'USER'),
  ('10000000-0000-4000-8000-000000000009'::uuid, 'oliver@here.demo', 'Oliver', 'USER'),
  ('10000000-0000-4000-8000-000000000010'::uuid, 'mia@here.demo', 'Mia', 'USER'),
  ('10000000-0000-4000-8000-000000000011'::uuid, 'theo@here.demo', 'Theo', 'USER'),
  ('10000000-0000-4000-8000-000000000012'::uuid, 'anna@here.demo', 'Anna', 'USER'),
  ('10000000-0000-4000-8000-000000000013'::uuid, 'lucas@here.demo', 'Lucas', 'USER'),
  ('10000000-0000-4000-8000-000000000014'::uuid, 'emma@here.demo', 'Emma', 'USER'),
  ('10000000-0000-4000-8000-000000000015'::uuid, 'finn@here.demo', 'Finn', 'USER'),
  ('10000000-0000-4000-8000-000000000016'::uuid, 'nora@here.demo', 'Nora', 'USER'),
  ('10000000-0000-4000-8000-000000000017'::uuid, 'liam@here.demo', 'Liam', 'USER'),
  ('10000000-0000-4000-8000-000000000018'::uuid, 'clara@here.demo', 'Clara', 'USER')
) as seed(id, email, display_name, account_role)
on conflict (id) do nothing;

update public.profiles p
set
  date_of_birth = seed.date_of_birth,
  bio = seed.bio,
  interests = seed.interests,
  purpose = seed.purpose,
  profile_photo = seed.profile_photo,
  open_to_meet = true
from (values
  ('10000000-0000-4000-8000-000000000001'::uuid, '1988-02-12'::date, 'Event producer and host.', array['Events','Music'], 'Networking', null),
  ('10000000-0000-4000-8000-000000000002'::uuid, '1998-06-14'::date, 'Creative strategist, live music person, always planning the next little adventure.', array['Music','Travel','Art'], 'Just meeting people', 'https://images.unsplash.com/photo-1531123897727-8f129e1688ce'),
  ('10000000-0000-4000-8000-000000000003'::uuid, '1997-03-18'::date, 'Product designer, vinyl collector and the person who knows the next good place.', array['Design','Startups','Music','Travel'], 'Networking', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e'),
  ('10000000-0000-4000-8000-000000000004'::uuid, '1999-01-09'::date, 'New in Riga. Here for live music and spontaneous dancing.', array['Live music','Art','Travel','Food'], 'Friends', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330'),
  ('10000000-0000-4000-8000-000000000005'::uuid, '1995-10-22'::date, 'Architect by day, amateur DJ after dark.', array['Architecture','House','Running'], 'Just meeting people', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d'),
  ('10000000-0000-4000-8000-000000000006'::uuid, '1998-05-19'::date, 'Creative producer. Gallery openings, long dinners and last-minute flights.', array['Fashion','Cinema','Food','Pilates'], 'Dating', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb'),
  ('10000000-0000-4000-8000-000000000007'::uuid, '1994-08-02'::date, 'Building climate tech. Came for the panel, stayed for the dance floor.', array['Technology','Business','Cycling'], 'Networking', 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6'),
  ('10000000-0000-4000-8000-000000000008'::uuid, '1996-11-28'::date, 'Photographer and enthusiastic beginner at almost everything.', array['Photography','Yoga','Books','Nature'], 'Friends', 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1'),
  ('10000000-0000-4000-8000-000000000009'::uuid, '1993-04-21'::date, 'Sound engineer and weekend chef.', array['Music','Food','Technology'], 'Friends', 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d'),
  ('10000000-0000-4000-8000-000000000010'::uuid, '1999-07-16'::date, 'Illustrator, runner and dog person.', array['Art','Fitness','Nature'], 'Dating', 'https://images.unsplash.com/photo-1517841905240-472988babdf9'),
  ('10000000-0000-4000-8000-000000000011'::uuid, '1996-02-03'::date, 'Founder, occasional drummer.', array['Startups','Music','Business'], 'Networking', 'https://images.unsplash.com/photo-1521119989659-a83eee488004'),
  ('10000000-0000-4000-8000-000000000012'::uuid, '1997-09-30'::date, 'Interior designer who never skips dessert.', array['Design','Food','Travel'], 'Friends', 'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df'),
  ('10000000-0000-4000-8000-000000000013'::uuid, '1992-12-12'::date, 'Film editor and basketball fan.', array['Cinema','Fitness','Gaming'], 'Just meeting people', 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7'),
  ('10000000-0000-4000-8000-000000000014'::uuid, '1998-03-07'::date, 'Brand strategist with too many playlists.', array['Music','Fashion','Business'], 'Networking', 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e'),
  ('10000000-0000-4000-8000-000000000015'::uuid, '1995-06-25'::date, 'Developer, climber, coffee enthusiast.', array['Technology','Fitness','Travel'], 'Friends', 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce'),
  ('10000000-0000-4000-8000-000000000016'::uuid, '1997-08-11'::date, 'Museum person, occasional DJ.', array['Art','Music','Fashion'], 'Dating', 'https://images.unsplash.com/photo-1534751516642-a1af1ef26a56'),
  ('10000000-0000-4000-8000-000000000017'::uuid, '1994-01-19'::date, 'Journalist who asks too many questions.', array['Books','Travel','Technology'], 'Just meeting people', 'https://images.unsplash.com/photo-1501196354995-cbb51c65aaea'),
  ('10000000-0000-4000-8000-000000000018'::uuid, '1998-10-05'::date, 'Ceramicist and city cyclist.', array['Art','Cycling','Food'], 'Friends', 'https://images.unsplash.com/photo-1544005313-94ddf0286df2')
) as seed(id, date_of_birth, bio, interests, purpose, profile_photo)
where p.id = seed.id;

insert into public.rooms (
  id, organizer_id, slug, name, event_name, venue_name, city, description,
  starts_at, ends_at, cover_image, status
)
values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'friday-social',
  'Friday Social Night',
  'Friday Social Night',
  'Lumen Club',
  'Riga',
  'A one-night room for the people sharing this place, this music and this moment.',
  now() - interval '2 hours',
  now() + interval '6 hours',
  'https://images.unsplash.com/photo-1492684223066-81342ee5ff30',
  'LIVE'
)
on conflict (id) do nothing;

insert into public.room_members (room_id, user_id, joined_at, is_visible, status)
select
  '20000000-0000-4000-8000-000000000001',
  p.id,
  now() - ((row_number() over (order by p.id)) || ' minutes')::interval,
  true,
  'ACTIVE'
from public.profiles p
where p.id between '10000000-0000-4000-8000-000000000002' and '10000000-0000-4000-8000-000000000018'
on conflict (room_id, user_id) do nothing;

insert into public.interests (room_id, sender_id, receiver_id, created_at)
values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003',now()-interval '24 minutes'),
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002',now()-interval '22 minutes'),
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004',now()-interval '18 minutes'),
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002',now()-interval '16 minutes'),
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000006',now()-interval '12 minutes')
on conflict (room_id, sender_id, receiver_id) do nothing;

insert into public.matches (id, room_id, user_a, user_b, created_at)
values
  ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003',now()-interval '22 minutes'),
  ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004',now()-interval '16 minutes')
on conflict (room_id, user_a, user_b) do nothing;

insert into public.messages (match_id, sender_id, content, created_at, read_at)
values
  ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','Hey! I think we were both near the terrace earlier 👋',now()-interval '8 minutes',now()-interval '7 minutes'),
  ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','Yes! I’m by the neon installation now. Want to say hi?',now()-interval '7 minutes',now()-interval '6 minutes'),
  ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','Perfect — coming over in two minutes.',now()-interval '6 minutes',null),
  ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004','That sounds great. See you by the bar?',now()-interval '4 minutes',null)
on conflict do nothing;
