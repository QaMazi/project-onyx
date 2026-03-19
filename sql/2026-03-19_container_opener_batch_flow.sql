begin;

create or replace function public.open_inventory_container_batch(
  p_inventory_id uuid,
  p_open_count integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_inventory record;
  v_container record;
  v_requested_count integer := greatest(coalesce(p_open_count, 1), 1);
  v_open_index integer;
  v_open_result jsonb := '{}'::jsonb;
  v_openings jsonb := '[]'::jsonb;
  v_remaining_quantity integer := 0;
begin
  v_actor_id := public._assert_authenticated_user();

  select
    pi.id,
    pi.user_id,
    pi.series_id,
    pi.quantity,
    pi.locked_quantity,
    i.behavior_code,
    i.target_kind,
    i.target_id
  into v_inventory
  from public.player_inventory pi
  join public.item_definitions i
    on i.id = pi.item_definition_id
  where pi.id = p_inventory_id
  for update;

  if not found then
    raise exception 'Inventory item not found';
  end if;

  if v_inventory.user_id <> v_actor_id then
    raise exception 'You do not own this opener';
  end if;

  if v_inventory.behavior_code <> 'open_container'
    or coalesce(v_inventory.target_kind, '') <> 'container'
    or v_inventory.target_id is null then
    raise exception 'That inventory item is not a valid opener';
  end if;

  if (v_inventory.quantity - v_inventory.locked_quantity) < v_requested_count then
    raise exception 'You do not have enough opener quantity for that many openings';
  end if;

  select
    c.id,
    c.name,
    c.description,
    c.code,
    coalesce(nullif(c.artwork_url, ''), nullif(c.image_url, '')) as image_url,
    ct.code as container_type_code
  into v_container
  from public.containers c
  join public.container_types ct
    on ct.id = c.container_type_id
  where c.id = v_inventory.target_id
  limit 1;

  if not found then
    raise exception 'Container not found';
  end if;

  for v_open_index in 1..v_requested_count loop
    v_open_result := public.open_inventory_container(p_inventory_id);

    v_openings := v_openings || jsonb_build_array(
      jsonb_build_object(
        'open_index', v_open_index,
        'container_id', v_container.id,
        'container_name', coalesce(v_open_result ->> 'container_name', v_container.name),
        'container_description', v_container.description,
        'container_code', v_container.code,
        'container_type_code', v_container.container_type_code,
        'container_image_url', v_container.image_url,
        'cards_per_open', coalesce((v_open_result ->> 'cards_per_open')::integer, 1),
        'pulls', coalesce(v_open_result -> 'pulls', '[]'::jsonb)
      )
    );
  end loop;

  select greatest(quantity - locked_quantity, 0)
  into v_remaining_quantity
  from public.player_inventory
  where id = p_inventory_id;

  return jsonb_build_object(
    'success', true,
    'container_id', v_container.id,
    'container_name', v_container.name,
    'container_image_url', v_container.image_url,
    'container_type_code', v_container.container_type_code,
    'opened_quantity', v_requested_count,
    'remaining_available_quantity', coalesce(v_remaining_quantity, 0),
    'openings', coalesce(v_openings, '[]'::jsonb)
  );
end;
$function$;

commit;
