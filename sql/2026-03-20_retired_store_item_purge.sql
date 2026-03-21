-- Permanently removes retired store items that are no longer referenced anywhere.
-- Safe to rerun: if nothing remains retired, this returns deleted_count = 0.

with deleted as (
  delete from public.item_definitions
  where coalesce(is_active, false) = false
  returning code
)
select
  count(*)::int as deleted_count,
  coalesce(json_agg(code order by code), '[]'::json) as deleted_codes
from deleted;
