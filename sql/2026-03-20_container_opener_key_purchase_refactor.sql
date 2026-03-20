begin;

create or replace function public._container_opener_family_for_type(p_container_type_code text)
returns text
language plpgsql
immutable
as $function$
declare
  v_code text;
begin
  v_code := lower(trim(coalesce(p_container_type_code, '')));

  if v_code = 'full_pack' then
    return 'full_pack_key';
  end if;

  if v_code = 'draft_pack' then
    return 'draft_pack_key';
  end if;

  if v_code = 'deck_box' then
    return 'deck_box_key';
  end if;

  if v_code = 'promo_box' then
    return 'promo_box_key';
  end if;

  return null;
end;
$function$;

create or replace function public._container_opener_suffix_for_family(p_exact_item_family text)
returns text
language plpgsql
immutable
as $function$
declare
  v_family text;
begin
  v_family := lower(trim(coalesce(p_exact_item_family, '')));

  if v_family = 'full_pack_key' then
    return 'Pack Key';
  end if;

  if v_family = 'draft_pack_key' then
    return 'Draft Pack Key';
  end if;

  if v_family = 'deck_box_key' then
    return 'Deck Box Key';
  end if;

  if v_family = 'promo_box_key' then
    return 'Promo Box Key';
  end if;

  return null;
end;
$function$;

create or replace function public._resolve_random_container_type_code(p_random_key_family text)
returns text
language plpgsql
immutable
as $function$
declare
  v_family text;
begin
  v_family := lower(trim(coalesce(p_random_key_family, '')));

  if v_family = 'random_deck_box_key' then
    return 'deck_box';
  end if;

  if v_family = 'random_promo_box_key' then
    return 'promo_box';
  end if;

  if v_family = 'random_draft_pack_key' then
    return 'draft_pack';
  end if;

  if v_family = 'random_full_pack_key' then
    return 'full_pack';
  end if;

  return null;
end;
$function$;

create or replace function public._sync_container_opener_item(p_container_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_container record;
  v_category_id uuid;
  v_item_family text;
  v_item_suffix text;
  v_item_code text;
  v_item_name text;
  v_display_name text;
  v_existing_item record;
  v_item_id uuid;
begin
  select
    c.id,
    c.name,
    c.code,
    c.image_url,
    c.artwork_url,
    ct.code as container_type_code
  into v_container
  from public.containers c
  join public.container_types ct
    on ct.id = c.container_type_id
  where c.id = p_container_id;

  if not found then
    return null;
  end if;

  v_item_family := public._container_opener_family_for_type(v_container.container_type_code);
  v_item_suffix := public._container_opener_suffix_for_family(v_item_family);

  if v_item_family is null or v_item_suffix is null then
    return null;
  end if;

  select id
  into v_category_id
  from public.item_categories
  where lower(coalesce(code, '')) = 'container_openers'
  limit 1;

  if v_category_id is null then
    raise exception 'Container Openers category is missing';
  end if;

  v_display_name := trim(regexp_replace(trim(coalesce(v_container.name, '')), '\s+Draft$', '', 'i'));
  v_item_code := public._slugify_store_code(
    case
      when v_item_family in ('full_pack_key', 'draft_pack_key') then
        coalesce(v_container.code, '') || '_pack_key'
      else
        coalesce(v_container.code, '') || '_' || v_item_family
    end
  );
  v_item_name := case
    when v_item_family = 'draft_pack_key' then v_display_name || ' Draft Pack Key'
    when v_item_family = 'full_pack_key' then v_display_name || ' Pack Key'
    else trim(v_container.name) || ' ' || v_item_suffix
  end;

  select *
  into v_existing_item
  from public.item_definitions i
  where i.target_kind = 'container'
    and i.target_id = p_container_id
  order by i.updated_at desc nulls last, i.name asc
  limit 1;

  if not found then
    select *
    into v_existing_item
    from public.item_definitions i
    where lower(coalesce(i.code, '')) = lower(v_item_code)
    order by i.updated_at desc nulls last, i.name asc
    limit 1;
  end if;

  if found then
    update public.item_definitions i
    set
      name = v_item_name,
      code = v_item_code,
      category_id = v_category_id,
      behavior_code = 'open_container',
      description = format('Consume from inventory to open %s.', trim(v_container.name)),
      image_url = coalesce(nullif(i.image_url, ''), nullif(v_container.artwork_url, ''), nullif(v_container.image_url, '')),
      target_kind = 'container',
      target_id = p_container_id,
      exact_item_family = v_item_family,
      is_active = true,
      updated_at = now()
    where i.id = v_existing_item.id
    returning i.id into v_item_id;

    return v_item_id;
  end if;

  insert into public.item_definitions (
    id,
    name,
    code,
    image_url,
    is_active,
    category_id,
    behavior_code,
    store_order,
    max_purchase,
    store_price,
    description,
    target_kind,
    target_id,
    exact_item_family
  )
  values (
    gen_random_uuid(),
    v_item_name,
    v_item_code,
    coalesce(nullif(v_container.artwork_url, ''), nullif(v_container.image_url, '')),
    true,
    v_category_id,
    'open_container',
    900,
    99,
    0,
    format('Consume from inventory to open %s.', trim(v_container.name)),
    'container',
    p_container_id,
    v_item_family
  )
  returning id into v_item_id;

  return v_item_id;
end;
$function$;

create or replace function public._grant_random_unlocked_container_keys(
  p_series_id uuid,
  p_target_user_id uuid,
  p_random_key_family text,
  p_quantity integer,
  p_granted_by_user_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_quantity integer := greatest(coalesce(p_quantity, 1), 1);
  v_container_type_code text;
  v_label text;
  v_pick record;
  v_granted_items jsonb := '[]'::jsonb;
  v_index integer;
begin
  v_container_type_code := public._resolve_random_container_type_code(p_random_key_family);

  if v_container_type_code is null then
    raise exception 'Unsupported random opener family';
  end if;

  v_label := replace(initcap(replace(v_container_type_code, '_', ' ')), 'Full Pack', 'Pack');

  for v_index in 1..v_quantity loop
    select
      i.id as item_definition_id,
      i.name as item_name,
      i.code as item_code,
      c.id as container_id,
      c.name as container_name,
      c.code as container_code
    into v_pick
    from public.item_definitions i
    join public.containers c
      on c.id = i.target_id
    join public.container_types ct
      on ct.id = c.container_type_id
    where i.behavior_code = 'open_container'
      and coalesce(i.target_kind, '') = 'container'
      and i.target_id is not null
      and coalesce(i.is_active, false) = true
      and lower(coalesce(ct.code, '')) = v_container_type_code
      and coalesce(c.is_enabled, true) = true
      and coalesce(c.is_locked, false) = false
    order by random()
    limit 1;

    if v_pick.item_definition_id is null then
      raise exception 'No unlocked % options are available for a random key purchase', v_label;
    end if;

    perform public._grant_series_item(
      p_series_id,
      p_target_user_id,
      v_pick.item_definition_id,
      1,
      p_granted_by_user_id,
      coalesce(p_notes, 'opener_direct_purchase:random')
    );

    v_granted_items := v_granted_items || jsonb_build_array(
      jsonb_build_object(
        'item_definition_id', v_pick.item_definition_id,
        'item_name', v_pick.item_name,
        'item_code', v_pick.item_code,
        'container_id', v_pick.container_id,
        'container_name', v_pick.container_name,
        'container_code', v_pick.container_code
      )
    );
  end loop;

  return jsonb_build_object(
    'success', true,
    'container_type_code', v_container_type_code,
    'granted_items', coalesce(v_granted_items, '[]'::jsonb)
  );
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
  v_random_result jsonb := '{}'::jsonb;
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

  if not coalesce(v_item.is_randomly_available, true) then
    raise exception 'This opener product is not currently available';
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

  if v_item.behavior_code = 'open_container' then
    perform public._grant_series_item(
      p_series_id,
      v_actor_id,
      v_item.id,
      v_quantity,
      v_actor_id,
      'opener_direct_purchase:specific'
    );

    v_grants := jsonb_build_array(
      jsonb_build_object(
        'item_definition_id', v_item.id,
        'item_name', v_item.name,
        'item_code', v_item.code,
        'quantity', v_quantity
      )
    );
  else
    v_random_result := public._grant_random_unlocked_container_keys(
      p_series_id,
      v_actor_id,
      v_item.exact_item_family,
      v_quantity,
      v_actor_id,
      'opener_direct_purchase:random'
    );

    v_grants := coalesce(v_random_result -> 'granted_items', '[]'::jsonb);
  end if;

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

create temporary table tmp_random_container_key_spec (
  code text primary key,
  name text not null,
  description text not null,
  exact_item_family text not null,
  store_order integer not null
) on commit drop;

insert into tmp_random_container_key_spec (
  code,
  name,
  description,
  exact_item_family,
  store_order
)
values
  (
    'random_deck_box_key',
    'Random Deck Box Key',
    'Buy this to receive one random key for any unlocked Deck Box.',
    'random_deck_box_key',
    100
  ),
  (
    'random_promo_box_key',
    'Random Promo Box Key',
    'Buy this to receive one random key for any unlocked Promo Box.',
    'random_promo_box_key',
    110
  ),
  (
    'random_draft_pack_key',
    'Random Draft Pack Key',
    'Buy this to receive one random key for any unlocked Draft Pack.',
    'random_draft_pack_key',
    120
  ),
  (
    'random_pack_key',
    'Random Pack Key',
    'Buy this to receive one random key for any unlocked Pack.',
    'random_full_pack_key',
    130
  );

update public.item_definitions i
set
  name = spec.name,
  description = spec.description,
  category_id = container_openers.id,
  behavior_code = 'grant_random_container_key',
  target_kind = null,
  target_id = null,
  exact_item_family = spec.exact_item_family,
  store_order = spec.store_order,
  max_purchase = coalesce(i.max_purchase, 99),
  is_active = true,
  updated_at = now()
from tmp_random_container_key_spec spec
join public.item_categories container_openers
  on lower(coalesce(container_openers.code, '')) = 'container_openers'
where lower(coalesce(i.code, '')) = spec.code
   or lower(coalesce(i.exact_item_family, '')) = spec.exact_item_family;

insert into public.item_definitions (
  id,
  name,
  code,
  image_url,
  is_active,
  category_id,
  behavior_code,
  store_order,
  max_purchase,
  store_price,
  description,
  target_kind,
  target_id,
  exact_item_family
)
select
  gen_random_uuid(),
  spec.name,
  spec.code,
  null,
  true,
  container_openers.id,
  'grant_random_container_key',
  spec.store_order,
  99,
  0,
  spec.description,
  null,
  null,
  spec.exact_item_family
from tmp_random_container_key_spec spec
join public.item_categories container_openers
  on lower(coalesce(container_openers.code, '')) = 'container_openers'
where not exists (
  select 1
  from public.item_definitions i
  where lower(coalesce(i.code, '')) = spec.code
     or lower(coalesce(i.exact_item_family, '')) = spec.exact_item_family
);

do $$
declare
  v_container record;
begin
  for v_container in
    select c.id
    from public.containers c
  loop
    perform public._sync_container_opener_item(v_container.id);
  end loop;
end;
$$;

delete from public.store_cart_items ci
using public.store_carts sc,
      public.item_definitions i,
      public.item_categories c
where ci.cart_id = sc.id
  and i.id = ci.item_definition_id
  and c.id = i.category_id
  and lower(coalesce(c.code, '')) = 'container_openers';

grant execute on function public.purchase_container_opener_now(uuid, uuid, integer) to authenticated;
grant execute on function public.purchase_container_opener_now(uuid, uuid, integer) to service_role;

commit;
