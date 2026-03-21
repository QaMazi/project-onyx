begin;

create or replace view public.store_catalog as
select
  i.id,
  i.category_id,
  c.code as category_code,
  c.name as category_name,
  i.code,
  i.name,
  i.description,
  i.image_url,
  i.behavior_code,
  i.store_order,
  i.max_purchase,
  i.store_price,
  i.target_kind,
  i.target_id,
  i.exact_item_family,
  i.is_active,
  coalesce(i.is_store_purchase_locked, false) as is_store_purchase_locked,
  coalesce(i.is_reward_rng_locked, false) as is_reward_rng_locked,
  coalesce(i.is_randomly_available, true) as is_randomly_available
from public.item_definitions i
join public.item_categories c
  on c.id = i.category_id
where i.is_active = true
order by c.name, i.store_order, i.name;

create or replace function public.randomize_store_item_availability(
  p_category_code text default null,
  p_enabled_ratio numeric default 0.50
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_updated_count integer := 0;
  v_shown_count integer := 0;
  v_hidden_count integer := 0;
begin
  perform public._assert_progression_admin();

  if p_enabled_ratio is null or p_enabled_ratio < 0 or p_enabled_ratio > 1 then
    raise exception 'Enabled ratio must be between 0 and 1';
  end if;

  with eligible_items as (
    select
      i.id,
      (random() <= p_enabled_ratio) as should_show
    from public.item_definitions i
    join public.item_categories c
      on c.id = i.category_id
    where (
        p_category_code is null
        or c.code = p_category_code
      )
      and coalesce(i.is_randomly_available, true) = true
  ),
  updated_items as (
    update public.item_definitions i
    set
      is_active = eligible_items.should_show,
      is_store_purchase_locked = not eligible_items.should_show,
      updated_at = now()
    from eligible_items
    where eligible_items.id = i.id
    returning case when eligible_items.should_show then 1 else 0 end as shown_flag
  )
  select
    count(*)::integer,
    coalesce(sum(shown_flag), 0)::integer,
    (count(*) - coalesce(sum(shown_flag), 0))::integer
  into v_updated_count, v_shown_count, v_hidden_count
  from updated_items;

  return jsonb_build_object(
    'success', true,
    'updated_count', v_updated_count,
    'shown_count', v_shown_count,
    'hidden_count', v_hidden_count,
    'category_code', p_category_code,
    'enabled_ratio', p_enabled_ratio
  );
end;
$function$;

create or replace function public.store_add_to_cart(
  p_user uuid,
  p_series uuid,
  p_item_definition_id uuid,
  p_quantity integer
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_cart_id uuid;
  v_item record;
  v_existing_quantity integer := 0;
begin
  v_actor_id := public._assert_authenticated_user();

  if v_actor_id <> p_user then
    raise exception 'You can only modify your own cart';
  end if;

  if p_quantity <= 0 then
    raise exception 'Quantity must be greater than 0';
  end if;

  perform public._assert_series_member(p_series, p_user);

  select
    i.id,
    i.max_purchase,
    i.is_active,
    coalesce(i.is_store_purchase_locked, false) as is_store_purchase_locked
  into v_item
  from public.item_definitions i
  where i.id = p_item_definition_id;

  if not found or not coalesce(v_item.is_active, false) then
    raise exception 'Store item not found';
  end if;

  if coalesce(v_item.is_store_purchase_locked, false) then
    raise exception 'This item is currently purchase locked';
  end if;

  select id
  into v_cart_id
  from public.store_carts
  where user_id = p_user
    and series_id = p_series
  limit 1;

  if v_cart_id is null then
    insert into public.store_carts (user_id, series_id)
    values (p_user, p_series)
    returning id into v_cart_id;
  end if;

  select coalesce(quantity, 0)
  into v_existing_quantity
  from public.store_cart_items
  where cart_id = v_cart_id
    and item_definition_id = p_item_definition_id;

  if coalesce(v_item.max_purchase, 0) > 0
    and (coalesce(v_existing_quantity, 0) + p_quantity) > v_item.max_purchase then
    raise exception 'This purchase exceeds the max purchase limit for the item';
  end if;

  insert into public.store_cart_items (cart_id, item_definition_id, quantity)
  values (v_cart_id, p_item_definition_id, p_quantity)
  on conflict (cart_id, item_definition_id)
  do update
  set quantity = public.store_cart_items.quantity + excluded.quantity;
end;
$function$;

create or replace function public.store_set_cart_quantity(
  p_user uuid,
  p_series uuid,
  p_item_definition_id uuid,
  p_quantity integer
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_cart_id uuid;
  v_item record;
begin
  v_actor_id := public._assert_authenticated_user();

  if v_actor_id <> p_user then
    raise exception 'You can only modify your own cart';
  end if;

  select id
  into v_cart_id
  from public.store_carts
  where user_id = p_user
    and series_id = p_series
  limit 1;

  if v_cart_id is null then
    raise exception 'No active cart';
  end if;

  select
    i.id,
    i.max_purchase,
    i.is_active,
    coalesce(i.is_store_purchase_locked, false) as is_store_purchase_locked
  into v_item
  from public.item_definitions i
  where i.id = p_item_definition_id;

  if not found or not coalesce(v_item.is_active, false) then
    raise exception 'Store item not found';
  end if;

  if coalesce(v_item.is_store_purchase_locked, false) then
    raise exception 'This item is currently purchase locked';
  end if;

  if p_quantity <= 0 then
    delete from public.store_cart_items
    where cart_id = v_cart_id
      and item_definition_id = p_item_definition_id;
    return;
  end if;

  if coalesce(v_item.max_purchase, 0) > 0
    and p_quantity > v_item.max_purchase then
    raise exception 'This purchase exceeds the max purchase limit for the item';
  end if;

  update public.store_cart_items
  set quantity = p_quantity
  where cart_id = v_cart_id
    and item_definition_id = p_item_definition_id;
end;
$function$;

create or replace function public.store_checkout(
  p_user uuid,
  p_series uuid
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_cart_id uuid;
  v_total_cost integer := 0;
  v_wallet record;
  v_purchase_id uuid;
  v_invalid_item_count integer := 0;
  v_cart_item_count integer := 0;
  r record;
begin
  v_actor_id := public._assert_authenticated_user();

  if v_actor_id <> p_user then
    raise exception 'You can only checkout your own cart';
  end if;

  select *
  into v_wallet
  from public.player_wallets
  where user_id = p_user
    and series_id = p_series
  for update;

  if not found then
    raise exception 'Wallet not initialized';
  end if;

  select id
  into v_cart_id
  from public.store_carts
  where user_id = p_user
    and series_id = p_series;

  if v_cart_id is null then
    raise exception 'No active cart';
  end if;

  select count(*)
  into v_invalid_item_count
  from public.store_cart_items ci
  join public.item_definitions i
    on i.id = ci.item_definition_id
  where ci.cart_id = v_cart_id
    and (
      coalesce(i.is_active, false) = false
      or coalesce(i.is_store_purchase_locked, false) = true
      or (
        coalesce(i.max_purchase, 0) > 0
        and ci.quantity > i.max_purchase
      )
    );

  if v_invalid_item_count > 0 then
    raise exception 'One or more cart items are no longer available';
  end if;

  select count(*)
  into v_cart_item_count
  from public.store_cart_items ci
  join public.item_definitions i
    on i.id = ci.item_definition_id
  where ci.cart_id = v_cart_id
    and i.is_active = true
    and coalesce(i.is_store_purchase_locked, false) = false;

  if v_cart_item_count = 0 then
    raise exception 'Cart is empty';
  end if;

  select coalesce(sum(ci.quantity * i.store_price), 0)
  into v_total_cost
  from public.store_cart_items ci
  join public.item_definitions i
    on i.id = ci.item_definition_id
  where ci.cart_id = v_cart_id
    and i.is_active = true
    and coalesce(i.is_store_purchase_locked, false) = false;

  if v_wallet.shards < v_total_cost then
    raise exception 'Not enough shards';
  end if;

  update public.player_wallets
  set
    shards = shards - v_total_cost,
    updated_at = now()
  where user_id = p_user
    and series_id = p_series;

  insert into public.store_purchases (user_id, series_id, total_cost)
  values (p_user, p_series, v_total_cost)
  returning id into v_purchase_id;

  for r in
    select ci.item_definition_id, ci.quantity, i.store_price
    from public.store_cart_items ci
    join public.item_definitions i
      on i.id = ci.item_definition_id
    where ci.cart_id = v_cart_id
      and i.is_active = true
      and coalesce(i.is_store_purchase_locked, false) = false
  loop
    insert into public.store_purchase_items (
      purchase_id,
      item_definition_id,
      quantity,
      unit_price
    )
    values (
      v_purchase_id,
      r.item_definition_id,
      r.quantity,
      r.store_price
    );

    insert into public.player_inventory (
      user_id,
      series_id,
      item_definition_id,
      quantity,
      locked_quantity
    )
    values (
      p_user,
      p_series,
      r.item_definition_id,
      r.quantity,
      0
    )
    on conflict (user_id, series_id, item_definition_id)
    do update set
      quantity = public.player_inventory.quantity + excluded.quantity,
      updated_at = now();
  end loop;

  delete from public.store_cart_items
  where cart_id = v_cart_id;
end;
$function$;

create or replace function public.purchase_container_opener_now(
  p_series_id uuid,
  p_item_definition_id uuid,
  p_quantity integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_quantity integer := greatest(coalesce(p_quantity, 1), 1);
  v_wallet record;
  v_item record;
  v_total_cost integer := 0;
  v_purchase_id uuid;
  v_grants jsonb := '[]'::jsonb;
begin
  v_actor_id := public._assert_authenticated_user();

  if p_series_id is null then
    raise exception 'Series is required';
  end if;

  if p_item_definition_id is null then
    raise exception 'Store item is required';
  end if;

  perform public._assert_series_member(p_series_id, v_actor_id);

  select *
  into v_wallet
  from public.player_wallets
  where user_id = v_actor_id
    and series_id = p_series_id
  for update;

  if not found then
    raise exception 'Wallet not initialized';
  end if;

  select
    i.*,
    c.code as category_code
  into v_item
  from public.item_definitions i
  left join public.item_categories c
    on c.id = i.category_id
  where i.id = p_item_definition_id;

  if not found or coalesce(v_item.is_active, false) = false then
    raise exception 'Store item not found';
  end if;

  if lower(coalesce(v_item.category_code, '')) <> 'container_openers' then
    raise exception 'That item is not an opener product';
  end if;

  if coalesce(v_item.is_store_purchase_locked, false) then
    raise exception 'This opener product is currently purchase locked';
  end if;

  if coalesce(v_item.max_purchase, 0) > 0 and v_quantity > v_item.max_purchase then
    raise exception 'This purchase exceeds the max purchase limit for the item';
  end if;

  if v_item.behavior_code not in ('open_container', 'grant_random_container_key') then
    raise exception 'That item cannot be purchased from the opener page';
  end if;

  v_total_cost := greatest(coalesce(v_item.store_price, 0), 0) * v_quantity;

  if coalesce(v_wallet.shards, 0) < v_total_cost then
    raise exception 'Not enough shards';
  end if;

  update public.player_wallets
  set
    shards = shards - v_total_cost,
    updated_at = now()
  where user_id = v_actor_id
    and series_id = p_series_id;

  insert into public.store_purchases (
    user_id,
    series_id,
    total_cost
  )
  values (
    v_actor_id,
    p_series_id,
    v_total_cost
  )
  returning id into v_purchase_id;

  insert into public.store_purchase_items (
    purchase_id,
    item_definition_id,
    quantity,
    unit_price
  )
  values (
    v_purchase_id,
    v_item.id,
    v_quantity,
    greatest(coalesce(v_item.store_price, 0), 0)
  );

  perform public._grant_series_item(
    p_series_id,
    v_actor_id,
    v_item.id,
    v_quantity,
    v_actor_id,
    case
      when v_item.behavior_code = 'grant_random_container_key'
        then 'opener_direct_purchase:random_key_item'
      else 'opener_direct_purchase:specific'
    end
  );

  v_grants := jsonb_build_array(
    jsonb_build_object(
      'item_definition_id', v_item.id,
      'item_name', v_item.name,
      'item_code', v_item.code,
      'quantity', v_quantity
    )
  );

  return jsonb_build_object(
    'success', true,
    'item_name', v_item.name,
    'quantity', v_quantity,
    'total_cost', v_total_cost,
    'remaining_shards', greatest(coalesce(v_wallet.shards, 0) - v_total_cost, 0),
    'granted_items', coalesce(v_grants, '[]'::jsonb)
  );
end;
$function$;

create or replace function public._grant_round_reward_option(
  p_series_id uuid,
  p_user_id uuid,
  p_actor_id uuid,
  p_notes_prefix text,
  p_reward_kind text,
  p_option_kind text,
  p_exact_quantity integer,
  p_quantity_min integer,
  p_quantity_max integer,
  p_item_definition_id uuid,
  p_pool_item_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_grants jsonb := '[]'::jsonb;
  v_quantity integer := 0;
  v_item_id uuid;
  v_item_name text;
  v_roll_index integer := 0;
begin
  if p_option_kind = 'shards' then
    v_quantity := case
      when p_reward_kind = 'random' then public._roll_round_reward_quantity(p_quantity_min, p_quantity_max)
      else greatest(coalesce(p_exact_quantity, 0), 0)
    end;

    if v_quantity > 0 then
      perform public._grant_series_shards(
        p_series_id,
        p_user_id,
        v_quantity,
        p_actor_id,
        p_notes_prefix || ':shards'
      );

      v_grants := v_grants || jsonb_build_array(
        jsonb_build_object('kind', 'shards', 'label', 'Shards', 'value', v_quantity)
      );
    end if;

    return v_grants;
  end if;

  if p_option_kind = 'feature_coins' then
    v_quantity := case
      when p_reward_kind = 'random' then public._roll_round_reward_quantity(p_quantity_min, p_quantity_max)
      else greatest(coalesce(p_exact_quantity, 0), 0)
    end;

    if v_quantity > 0 then
      perform public._grant_series_feature_coins(
        p_series_id,
        p_user_id,
        v_quantity,
        p_actor_id,
        p_notes_prefix || ':feature_coins'
      );

      v_grants := v_grants || jsonb_build_array(
        jsonb_build_object('kind', 'feature_coins', 'label', 'Feature Coins', 'value', v_quantity)
      );
    end if;

    return v_grants;
  end if;

  if p_option_kind = 'specific_item' then
    v_quantity := greatest(coalesce(p_exact_quantity, 0), 0);

    if v_quantity <= 0 or p_item_definition_id is null then
      return v_grants;
    end if;

    select i.name
    into v_item_name
    from public.item_definitions i
    where i.id = p_item_definition_id;

    if v_item_name is null then
      raise exception 'Reward item definition not found';
    end if;

    perform public._grant_series_item(
      p_series_id,
      p_user_id,
      p_item_definition_id,
      v_quantity,
      p_actor_id,
      p_notes_prefix || ':specific_item'
    );

    v_grants := v_grants || jsonb_build_array(
      jsonb_build_object(
        'kind', 'item',
        'label', v_item_name,
        'value', v_quantity,
        'item_definition_id', p_item_definition_id
      )
    );

    return v_grants;
  end if;

  if p_option_kind = 'random_item' then
    v_quantity := greatest(coalesce(p_exact_quantity, 0), 0);

    if v_quantity <= 0 then
      return v_grants;
    end if;

    for v_roll_index in 1..v_quantity loop
      v_item_id := null;
      v_item_name := null;

      if coalesce(array_length(p_pool_item_ids, 1), 0) > 0 then
        select i.id, i.name
        into v_item_id, v_item_name
        from public.item_definitions i
        where i.id = any(p_pool_item_ids)
        order by random()
        limit 1;
      end if;

      if v_item_id is null then
        select i.id, i.name
        into v_item_id, v_item_name
        from public.item_definitions i
        where coalesce(i.is_reward_rng_locked, false) = false
        order by random()
        limit 1;
      end if;

      if v_item_id is null or v_item_name is null then
        raise exception 'No eligible reward item is available';
      end if;

      perform public._grant_series_item(
        p_series_id,
        p_user_id,
        v_item_id,
        1,
        p_actor_id,
        format('%s:random_item:%s', p_notes_prefix, v_roll_index)
      );

      v_grants := v_grants || jsonb_build_array(
        jsonb_build_object(
          'kind', 'item',
          'label', v_item_name,
          'value', 1,
          'item_definition_id', v_item_id
        )
      );
    end loop;

    return v_grants;
  end if;

  raise exception 'Unsupported reward option kind: %', coalesce(p_option_kind, 'null');
end;
$function$;

commit;
