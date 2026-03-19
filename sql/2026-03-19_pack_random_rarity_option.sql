begin;

create or replace function public._resolve_pack_card_pull_rarity(
  p_curated_rarity_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_selected jsonb := '{}'::jsonb;
begin
  if p_curated_rarity_id is not null then
    select jsonb_build_object(
      'id', r.id,
      'code', r.code,
      'name', r.name
    )
    into v_selected
    from public.card_rarities r
    where r.id = p_curated_rarity_id
    limit 1;

    if coalesce(v_selected, '{}'::jsonb) <> '{}'::jsonb then
      return v_selected;
    end if;
  end if;

  v_selected := public._roll_weighted_card_rarity();

  if nullif(coalesce(v_selected ->> 'id', ''), '') is null then
    select jsonb_build_object(
      'id', r.id,
      'code', r.code,
      'name', r.name
    )
    into v_selected
    from public.card_rarities r
    where r.id = public._resolve_common_rarity_id()
    limit 1;
  end if;

  return coalesce(v_selected, '{}'::jsonb);
end;
$function$;

create or replace function public.upsert_pack_product_admin(
  p_pack_group_code text,
  p_name text,
  p_code text,
  p_pack_set_name text,
  p_description text,
  p_image_url text,
  p_content_mode text,
  p_is_enabled boolean,
  p_is_locked boolean,
  p_cards jsonb,
  p_slot_tiers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_full_type_id uuid;
  v_draft_type_id uuid;
  v_group_code text;
  v_base_code text;
  v_full_id uuid;
  v_draft_id uuid;
  v_pack_set_name text := nullif(trim(coalesce(p_pack_set_name, '')), '');
begin
  perform public._assert_progression_admin();

  if trim(coalesce(p_name, '')) = '' then
    raise exception 'Pack name is required';
  end if;

  if trim(coalesce(p_code, '')) = '' then
    raise exception 'Pack code is required';
  end if;

  perform public._assert_pack_slot_percentages(p_slot_tiers);

  select id into v_full_type_id
  from public.container_types
  where lower(code) = 'full_pack'
  limit 1;

  select id into v_draft_type_id
  from public.container_types
  where lower(code) = 'draft_pack'
  limit 1;

  if v_full_type_id is null or v_draft_type_id is null then
    raise exception 'Pack container types are missing';
  end if;

  v_base_code := trim(both '_' from regexp_replace(upper(trim(p_code)), '[^A-Z0-9]+', '_', 'g'));
  v_group_code := coalesce(nullif(trim(p_pack_group_code), ''), public._slugify_store_code(v_base_code));

  select id into v_full_id
  from public.containers
  where pack_group_code = v_group_code
    and pack_variant = 'full'
  limit 1;

  if v_full_id is null then
    insert into public.containers (
      id, name, description, card_count, image_url, is_enabled, is_locked,
      content_mode, selection_count, draft_pick_count, rarity_mode, code,
      container_type_id, artwork_url, cards_per_open, pack_group_code, pack_variant,
      pack_set_name
    )
    values (
      gen_random_uuid(), trim(p_name), p_description, 9, p_image_url,
      coalesce(p_is_enabled, true), coalesce(p_is_locked, false),
      public._normalize_container_content_mode(p_content_mode), null, null, 'pack_slots',
      v_base_code, v_full_type_id, p_image_url, 9, v_group_code, 'full',
      v_pack_set_name
    )
    returning id into v_full_id;
  else
    update public.containers
    set
      name = trim(p_name),
      description = p_description,
      card_count = 9,
      image_url = p_image_url,
      is_enabled = coalesce(p_is_enabled, true),
      is_locked = coalesce(p_is_locked, false),
      content_mode = public._normalize_container_content_mode(p_content_mode),
      selection_count = null,
      draft_pick_count = null,
      rarity_mode = 'pack_slots',
      code = v_base_code,
      container_type_id = v_full_type_id,
      artwork_url = p_image_url,
      cards_per_open = 9,
      pack_group_code = v_group_code,
      pack_variant = 'full',
      pack_set_name = v_pack_set_name,
      updated_at = now()
    where id = v_full_id;
  end if;

  select id into v_draft_id
  from public.containers
  where pack_group_code = v_group_code
    and pack_variant = 'draft'
  limit 1;

  if v_draft_id is null then
    insert into public.containers (
      id, name, description, card_count, image_url, is_enabled, is_locked,
      content_mode, selection_count, draft_pick_count, rarity_mode, code,
      container_type_id, artwork_url, cards_per_open, pack_group_code, pack_variant,
      pack_set_name
    )
    values (
      gen_random_uuid(), trim(p_name) || ' Draft', p_description, 9, p_image_url,
      coalesce(p_is_enabled, true), coalesce(p_is_locked, false),
      public._normalize_container_content_mode(p_content_mode), null, null, 'pack_slots',
      v_base_code || '_DRAFT', v_draft_type_id, p_image_url, 9, v_group_code, 'draft',
      v_pack_set_name
    )
    returning id into v_draft_id;
  else
    update public.containers
    set
      name = trim(p_name) || ' Draft',
      description = p_description,
      card_count = 9,
      image_url = p_image_url,
      is_enabled = coalesce(p_is_enabled, true),
      is_locked = coalesce(p_is_locked, false),
      content_mode = public._normalize_container_content_mode(p_content_mode),
      selection_count = null,
      draft_pick_count = null,
      rarity_mode = 'pack_slots',
      code = v_base_code || '_DRAFT',
      container_type_id = v_draft_type_id,
      artwork_url = p_image_url,
      cards_per_open = 9,
      pack_group_code = v_group_code,
      pack_variant = 'draft',
      pack_set_name = v_pack_set_name,
      updated_at = now()
    where id = v_draft_id;
  end if;

  delete from public.container_cards
  where container_id in (v_full_id, v_draft_id);

  insert into public.container_cards (
    container_id,
    card_id,
    tier_id,
    pack_pool_tier_id,
    is_enabled,
    rarity_id,
    weight,
    slot_index
  )
  select
    ids.container_id,
    x.card_id,
    public._resolve_pack_pool_card_tier_id(x.pack_pool_tier_id),
    x.pack_pool_tier_id,
    coalesce(x.is_enabled, true),
    x.rarity_id,
    greatest(coalesce(x.weight, 1), 1),
    null
  from (values (v_full_id), (v_draft_id)) as ids(container_id)
  cross join jsonb_to_recordset(coalesce(p_cards, '[]'::jsonb))
    as x(card_id bigint, pack_pool_tier_id uuid, rarity_id uuid, is_enabled boolean, weight numeric)
  where x.card_id is not null
    and x.pack_pool_tier_id is not null;

  delete from public.container_pack_slot_tiers
  where container_id in (v_full_id, v_draft_id);

  insert into public.container_pack_slot_tiers (
    container_id,
    slot_index,
    pack_pool_tier_id,
    weight,
    is_enabled
  )
  select
    ids.container_id,
    x.slot_index,
    x.pack_pool_tier_id,
    round(greatest(coalesce(x.weight, 1), 0.000001), 2),
    coalesce(x.is_enabled, true)
  from (values (v_full_id), (v_draft_id)) as ids(container_id)
  cross join jsonb_to_recordset(coalesce(p_slot_tiers, '[]'::jsonb))
    as x(slot_index integer, pack_pool_tier_id uuid, weight numeric, is_enabled boolean)
  where x.slot_index between 1 and 9
    and x.pack_pool_tier_id is not null
    and coalesce(x.is_enabled, true) = true
    and coalesce(x.weight, 0) > 0;

  perform public._sync_container_opener_item(v_full_id);
  perform public._sync_container_opener_item(v_draft_id);

  return jsonb_build_object(
    'success', true,
    'pack_group_code', v_group_code,
    'full_container_id', v_full_id,
    'draft_container_id', v_draft_id
  );
end;
$function$;

create or replace function public.open_inventory_container(p_inventory_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_inventory record;
  v_container record;
  v_cards_per_open integer;
  v_selected record;
  v_selected_pack_tier record;
  v_fallback_rarity record;
  v_rolled_rarity jsonb := '{}'::jsonb;
  v_selected_rarity_id uuid;
  v_selected_rarity_code text;
  v_selected_rarity_name text;
  v_pulls jsonb := '[]'::jsonb;
  v_slot_index integer;
  v_has_slotted_rows boolean := false;
  v_has_pack_slot_tiers boolean := false;
begin
  v_actor_id := public._assert_authenticated_user();

  select
    pi.id, pi.user_id, pi.series_id, pi.quantity, pi.locked_quantity,
    i.id as item_definition_id, i.name as item_name, i.behavior_code, i.target_kind, i.target_id
  into v_inventory
  from public.player_inventory pi
  join public.item_definitions i on i.id = pi.item_definition_id
  where pi.id = p_inventory_id
  for update;

  if not found then raise exception 'Inventory item not found'; end if;
  if v_inventory.user_id <> v_actor_id then raise exception 'You do not own this opener'; end if;
  if (v_inventory.quantity - v_inventory.locked_quantity) <= 0 then
    raise exception 'No available opener quantity remains';
  end if;
  if v_inventory.behavior_code <> 'open_container'
    or coalesce(v_inventory.target_kind, '') <> 'container'
    or v_inventory.target_id is null then
    raise exception 'That inventory item is not a valid opener';
  end if;

  perform public._assert_series_member(v_inventory.series_id, v_actor_id);
  perform public._assert_series_item_use_allowed(v_inventory.series_id, v_actor_id);

  select
    c.id, c.name, c.description, c.code, c.card_count, c.cards_per_open, ct.code as container_type_code
  into v_container
  from public.containers c
  join public.container_types ct on ct.id = c.container_type_id
  where c.id = v_inventory.target_id
    and coalesce(c.is_enabled, true) = true;

  if not found then raise exception 'Container not found or is disabled'; end if;

  select r.id, r.code, r.name
  into v_fallback_rarity
  from public.card_rarities r
  where r.id = public._resolve_common_rarity_id();

  v_cards_per_open := greatest(coalesce(v_container.cards_per_open, v_container.card_count, 1), 1);

  select exists (
    select 1
    from public.container_cards cc
    where cc.container_id = v_container.id
      and coalesce(cc.is_enabled, true) = true
      and cc.slot_index is not null
  ) into v_has_slotted_rows;

  select exists (
    select 1
    from public.container_pack_slot_tiers cps
    where cps.container_id = v_container.id
      and coalesce(cps.is_enabled, true) = true
  ) into v_has_pack_slot_tiers;

  if lower(coalesce(v_container.container_type_code, '')) in ('full_pack', 'draft_pack')
     and v_has_pack_slot_tiers then
    for v_slot_index in 1..v_cards_per_open loop
      select cps.pack_pool_tier_id, ppt.code as tier_code, ppt.name as tier_name
      into v_selected_pack_tier
      from public.container_pack_slot_tiers cps
      join public.pack_pool_tiers ppt on ppt.id = cps.pack_pool_tier_id
      where cps.container_id = v_container.id
        and cps.slot_index = v_slot_index
        and coalesce(cps.is_enabled, true) = true
      order by -ln(greatest(random(), 0.000001)) /
        greatest(coalesce(cps.weight, 1)::double precision, 0.000001)
      limit 1;

      if v_selected_pack_tier.pack_pool_tier_id is null then
        raise exception 'Pack slot % has no eligible tier pools configured', v_slot_index;
      end if;

      select
        cc.card_id,
        c.name as card_name,
        c.image_url,
        v_selected_pack_tier.pack_pool_tier_id as tier_id,
        v_selected_pack_tier.tier_code,
        v_selected_pack_tier.tier_name,
        cc.rarity_id,
        coalesce(r.code, v_fallback_rarity.code) as rarity_code,
        coalesce(r.name, v_fallback_rarity.name) as rarity_name
      into v_selected
      from public.container_cards cc
      join public.cards c on c.id = cc.card_id
      left join public.card_rarities r on r.id = cc.rarity_id
      where cc.container_id = v_container.id
        and coalesce(cc.is_enabled, true) = true
        and cc.pack_pool_tier_id = v_selected_pack_tier.pack_pool_tier_id
      order by -ln(greatest(random(), 0.000001)) /
        greatest(coalesce(cc.weight, 1)::double precision, 0.000001)
      limit 1;

      if v_selected.card_id is null then
        raise exception 'Pack slot % has no eligible cards in % tier', v_slot_index, v_selected_pack_tier.tier_name;
      end if;

      v_rolled_rarity := public._resolve_pack_card_pull_rarity(v_selected.rarity_id);
      v_selected_rarity_id := coalesce(nullif(coalesce(v_rolled_rarity ->> 'id', ''), '')::uuid, v_fallback_rarity.id);
      v_selected_rarity_code := coalesce(nullif(v_rolled_rarity ->> 'code', ''), v_fallback_rarity.code);
      v_selected_rarity_name := coalesce(nullif(v_rolled_rarity ->> 'name', ''), v_fallback_rarity.name);

      insert into public.binder_cards (user_id, series_id, card_id, rarity_id, quantity, is_trade_locked)
      values (
        v_actor_id,
        v_inventory.series_id,
        v_selected.card_id,
        v_selected_rarity_id,
        1,
        false
      )
      on conflict (user_id, series_id, card_id, rarity_id)
      do update set quantity = public.binder_cards.quantity + 1, updated_at = now();

      v_pulls := v_pulls || jsonb_build_array(jsonb_build_object(
        'card_id', v_selected.card_id,
        'card_name', v_selected.card_name,
        'image_url', v_selected.image_url,
        'tier_id', v_selected.tier_id,
        'tier_code', v_selected.tier_code,
        'tier_name', v_selected.tier_name,
        'rarity_id', v_selected_rarity_id,
        'rarity_code', v_selected_rarity_code,
        'rarity_name', v_selected_rarity_name,
        'slot_index', v_slot_index
      ));
    end loop;
  elsif lower(coalesce(v_container.container_type_code, '')) in ('full_pack', 'draft_pack') then
    for v_slot_index in 1..v_cards_per_open loop
      select
        cc.card_id,
        c.name as card_name,
        c.image_url,
        cc.tier_id,
        coalesce(t.code, 'tier') as tier_code,
        coalesce(t.name, 'Unknown Tier') as tier_name,
        cc.rarity_id,
        coalesce(r.code, v_fallback_rarity.code) as rarity_code,
        coalesce(r.name, v_fallback_rarity.name) as rarity_name,
        cc.slot_index
      into v_selected
      from public.container_cards cc
      join public.cards c on c.id = cc.card_id
      left join public.card_tiers t on t.id = cc.tier_id
      left join public.card_rarities r on r.id = cc.rarity_id
      where cc.container_id = v_container.id
        and coalesce(cc.is_enabled, true) = true
        and (
          not v_has_slotted_rows
          or cc.slot_index = v_slot_index
          or (
            cc.slot_index is null and not exists (
              select 1
              from public.container_cards slot_rows
              where slot_rows.container_id = v_container.id
                and coalesce(slot_rows.is_enabled, true) = true
                and slot_rows.slot_index = v_slot_index
            )
          )
        )
      order by -ln(greatest(random(), 0.000001)) /
        greatest(coalesce(cc.weight, 1)::double precision, 0.000001)
      limit 1;

      if v_selected.card_id is null then
        raise exception 'Pack slot % has no eligible cards configured', v_slot_index;
      end if;

      v_rolled_rarity := public._resolve_pack_card_pull_rarity(v_selected.rarity_id);
      v_selected_rarity_id := coalesce(nullif(coalesce(v_rolled_rarity ->> 'id', ''), '')::uuid, v_fallback_rarity.id);
      v_selected_rarity_code := coalesce(nullif(v_rolled_rarity ->> 'code', ''), v_fallback_rarity.code);
      v_selected_rarity_name := coalesce(nullif(v_rolled_rarity ->> 'name', ''), v_fallback_rarity.name);

      insert into public.binder_cards (user_id, series_id, card_id, rarity_id, quantity, is_trade_locked)
      values (
        v_actor_id,
        v_inventory.series_id,
        v_selected.card_id,
        v_selected_rarity_id,
        1,
        false
      )
      on conflict (user_id, series_id, card_id, rarity_id)
      do update set quantity = public.binder_cards.quantity + 1, updated_at = now();

      v_pulls := v_pulls || jsonb_build_array(jsonb_build_object(
        'card_id', v_selected.card_id,
        'card_name', v_selected.card_name,
        'image_url', v_selected.image_url,
        'tier_id', v_selected.tier_id,
        'tier_code', v_selected.tier_code,
        'tier_name', v_selected.tier_name,
        'rarity_id', v_selected_rarity_id,
        'rarity_code', v_selected_rarity_code,
        'rarity_name', v_selected_rarity_name,
        'slot_index', coalesce(v_selected.slot_index, v_slot_index)
      ));
    end loop;
  else
    select
      cc.card_id,
      c.name as card_name,
      c.image_url,
      cc.tier_id,
      coalesce(t.code, 'tier') as tier_code,
      coalesce(t.name, 'Unknown Tier') as tier_name
    into v_selected
    from public.container_cards cc
    join public.cards c on c.id = cc.card_id
    left join public.card_tiers t on t.id = cc.tier_id
    where cc.container_id = v_container.id
      and coalesce(cc.is_enabled, true) = true
    order by -ln(greatest(random(), 0.000001)) /
      greatest(coalesce(cc.weight, 1)::double precision, 0.000001)
    limit 1;

    if v_selected.card_id is null then
      raise exception 'This container has no eligible cards configured';
    end if;

    v_rolled_rarity := public._roll_weighted_card_rarity();
    v_selected_rarity_id := coalesce(nullif(coalesce(v_rolled_rarity ->> 'id', ''), '')::uuid, v_fallback_rarity.id);
    v_selected_rarity_code := coalesce(nullif(v_rolled_rarity ->> 'code', ''), v_fallback_rarity.code);
    v_selected_rarity_name := coalesce(nullif(v_rolled_rarity ->> 'name', ''), v_fallback_rarity.name);

    insert into public.binder_cards (user_id, series_id, card_id, rarity_id, quantity, is_trade_locked)
    values (
      v_actor_id,
      v_inventory.series_id,
      v_selected.card_id,
      v_selected_rarity_id,
      1,
      false
    )
    on conflict (user_id, series_id, card_id, rarity_id)
    do update set quantity = public.binder_cards.quantity + 1, updated_at = now();

    v_pulls := jsonb_build_array(jsonb_build_object(
      'card_id', v_selected.card_id,
      'card_name', v_selected.card_name,
      'image_url', v_selected.image_url,
      'tier_id', v_selected.tier_id,
      'tier_code', v_selected.tier_code,
      'tier_name', v_selected.tier_name,
      'rarity_id', v_selected_rarity_id,
      'rarity_code', v_selected_rarity_code,
      'rarity_name', v_selected_rarity_name
    ));
  end if;

  perform public._consume_inventory_item(p_inventory_id, 1);

  return jsonb_build_object(
    'success', true,
    'container_id', v_container.id,
    'container_name', v_container.name,
    'cards_per_open', v_cards_per_open,
    'pulls', coalesce(v_pulls, '[]'::jsonb)
  );
end;
$function$;

commit;
