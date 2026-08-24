-- Cover the new Sprint 5.1 foreign-key paths used by user cleanup and
-- discovery assignment maintenance.

create index if not exists explore_batches_viewer_id_idx
  on public.explore_batches (viewer_id);

create index if not exists explore_items_batch_room_idx
  on public.explore_items (batch_id, room_id);

create index if not exists interests_explore_assignment_idx
  on public.interests (
    explore_item_id,
    explore_batch_id,
    room_id,
    from_user_id,
    to_user_id
  )
  where explore_item_id is not null;
