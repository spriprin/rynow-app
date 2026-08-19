# HERE Sprint 1 architecture

## Product boundary

Sprint 1 separates persistent identity from temporary presence:

```text
auth.users 1—1 profiles
auth.users 1—N room_members N—1 rooms
```

`profiles` never stores a `current_room_id`. One anonymous Auth user can reuse one minimal profile across many Rooms, while every Room visit has its own idempotent membership row.

## Production versus demo

- `/r/{join_code}` uses only Supabase and fails closed when configuration is absent.
- `/organizer` uses only a permanent Supabase Auth user and database-enforced ownership.
- `/demo` retains the earlier mock interface. Its people, Interests, Matches and Chat do not enter production tables.
- `/` is a static marketing surface and links to the explicitly isolated demo.

## Join trust boundary

The `rooms` table is not publicly readable. `get_room_by_join_code` is a narrow security-definer function that accepts the unpredictable join code and returns only safe event fields. `join_room_by_code` then:

1. derives identity from `auth.uid()`;
2. requires a complete 18+ profile and owned avatar path;
3. rejects missing, draft and closed Rooms;
4. inserts or updates the canonical `(room_id, user_id)` row;
5. refreshes `last_seen_at` and `is_active`.

Clients cannot insert arbitrary membership rows because table INSERT privilege is not granted.
The Room Wall does not expose the `profiles` table to peers directly: `room_wall_profiles` returns only `id`, `display_name`, `avatar_path` and join ordering for active members of that Room.

## Organizer trust boundary

Room writes require both `organizer_id = auth.uid()` and a JWT whose `is_anonymous` claim is false. The UI’s organizer state is only presentation; PostgreSQL RLS is the authority.

Joined count is exposed through an aggregate RPC available only to the Room owner or a Room member. Organizers do not receive a policy allowing them to enumerate individual membership rows.

## Avatar trust boundary

The `avatars` bucket is private. An object path begins with the authenticated user UUID. Storage RLS validates both folder name and Storage `owner_id`. Signed URLs can be created only by the owner or another active member of a shared Room.

## Future compatibility

Future Drops, exposure scheduling, Interest budgets, Interests, Matches and Chat can reference `room_id` and `user_id` without changing the identity/presence model. Those tables and features are intentionally absent in Sprint 1.
