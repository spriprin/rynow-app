-- Sprint 5.1 follow-up: an unseen invalidated Explore assignment keeps its
-- audit row, but must not reserve the visible position needed by its safe
-- replacement in the viewer's persistent batch.

alter table public.explore_items
  drop constraint if exists explore_items_viewer_position_unique;

create unique index if not exists explore_items_active_viewer_position_uidx
  on public.explore_items (batch_id, viewer_id, position)
  where invalidated_at is null;
