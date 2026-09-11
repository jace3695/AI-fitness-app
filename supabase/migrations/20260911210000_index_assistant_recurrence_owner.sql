-- Cover the referencing columns of assistant_items_recurrence_owner_fkey.
-- This is additive and does not rewrite existing assistant items.
create index if not exists assistant_items_recurrence_owner_lookup_idx
  on public.assistant_items (user_id, recurrence_parent_id)
  where recurrence_parent_id is not null;
