begin;

create or replace function public.get_container_collection_progress(p_series_id uuid)
returns table (
  container_id uuid,
  owned_unique_cards integer,
  total_unique_cards integer
)
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_user_id uuid;
begin
  v_user_id := public._assert_authenticated_user();

  if p_series_id is null then
    raise exception 'Series is required';
  end if;

  perform public._assert_series_member(p_series_id, v_user_id);

  return query
  select
    c.id as container_id,
    count(distinct bc.card_id)::integer as owned_unique_cards,
    count(distinct cc.card_id)::integer as total_unique_cards
  from public.containers c
  left join public.container_cards cc
    on cc.container_id = c.id
   and coalesce(cc.is_enabled, true) = true
  left join public.binder_cards bc
    on bc.user_id = v_user_id
   and bc.series_id = p_series_id
   and bc.quantity > 0
   and bc.card_id = cc.card_id
  group by c.id;
end;
$function$;

grant execute on function public.get_container_collection_progress(uuid) to authenticated;
grant execute on function public.get_container_collection_progress(uuid) to service_role;

commit;
