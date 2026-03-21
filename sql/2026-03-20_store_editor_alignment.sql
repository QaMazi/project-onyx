begin;

drop function if exists public.set_store_item_admin_state(uuid, integer, boolean, boolean, boolean);

create or replace function public.set_store_item_admin_state(
  p_item_definition_id uuid,
  p_store_price integer default null,
  p_is_store_purchase_locked boolean default null,
  p_is_reward_rng_locked boolean default null,
  p_is_randomly_available boolean default null,
  p_is_active boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_item record;
begin
  perform public._assert_progression_admin();

  update public.item_definitions i
  set
    store_price = coalesce(p_store_price, i.store_price),
    is_store_purchase_locked = coalesce(p_is_store_purchase_locked, i.is_store_purchase_locked),
    is_reward_rng_locked = coalesce(p_is_reward_rng_locked, i.is_reward_rng_locked),
    is_randomly_available = coalesce(p_is_randomly_available, i.is_randomly_available),
    is_active = coalesce(p_is_active, i.is_active),
    updated_at = now()
  where i.id = p_item_definition_id
  returning *
  into v_item;

  if not found then
    raise exception 'Store item not found';
  end if;

  return jsonb_build_object(
    'success', true,
    'item_definition_id', v_item.id,
    'store_price', v_item.store_price,
    'is_store_purchase_locked', v_item.is_store_purchase_locked,
    'is_reward_rng_locked', v_item.is_reward_rng_locked,
    'is_randomly_available', v_item.is_randomly_available,
    'is_active', v_item.is_active
  );
end;
$function$;

grant execute on function public.set_store_item_admin_state(
  uuid,
  integer,
  boolean,
  boolean,
  boolean,
  boolean
) to authenticated;

grant execute on function public.set_store_item_admin_state(
  uuid,
  integer,
  boolean,
  boolean,
  boolean,
  boolean
) to service_role;

notify pgrst, 'reload schema';

commit;
