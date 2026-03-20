begin;

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
  v_selected_box_tier jsonb := '{}'::jsonb;
  v_selected_box_tier_id uuid;
  v_fallback_rarity record;
  v_rolled_rarity jsonb := '{}'::jsonb;
  v_selected_rarity_id uuid;
  v_selected_rarity_code text;
  v_selected_rarity_name text;
  v_pulls jsonb := '[]'::jsonb;
  v_slot_index integer;
  v_has_slotted_rows boolean := false;
  v_has_pack_slot_tiers boolean := false;
  v_selected_card_ids bigint[] := '{}'::bigint[];
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
        and exists (
          select 1
          from public.container_cards cc
          where cc.container_id = v_container.id
            and coalesce(cc.is_enabled, true) = true
            and cc.pack_pool_tier_id = cps.pack_pool_tier_id
            and not (cc.card_id = any(v_selected_card_ids))
        )
      order by -ln(greatest(random(), 0.000001)) /
        greatest(coalesce(cps.weight, 1)::double precision, 0.000001)
      limit 1;

      if v_selected_pack_tier.pack_pool_tier_id is null then
        raise exception 'Pack slot % cannot be filled without duplicate cards', v_slot_index;
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
        and not (cc.card_id = any(v_selected_card_ids))
      order by -ln(greatest(random(), 0.000001)) /
        greatest(coalesce(cc.weight, 1)::double precision, 0.000001)
      limit 1;

      if v_selected.card_id is null then
        raise exception 'Pack slot % cannot be filled without duplicate cards', v_slot_index;
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

      v_selected_card_ids := array_append(v_selected_card_ids, v_selected.card_id);

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
        and not (cc.card_id = any(v_selected_card_ids))
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
        raise exception 'Pack slot % cannot be filled without duplicate cards', v_slot_index;
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

      v_selected_card_ids := array_append(v_selected_card_ids, v_selected.card_id);

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
    v_selected_box_tier := public._roll_enabled_box_tier(v_container.id);
    v_selected_box_tier_id := nullif(coalesce(v_selected_box_tier ->> 'id', ''), '')::uuid;

    if v_selected_box_tier_id is null then
      raise exception 'This box has no eligible tier pools configured';
    end if;

    select
      cc.card_id,
      c.name as card_name,
      c.image_url,
      cc.tier_id,
      coalesce(t.code, nullif(v_selected_box_tier ->> 'code', ''), 'tier') as tier_code,
      coalesce(t.name, nullif(v_selected_box_tier ->> 'name', ''), 'Unknown Tier') as tier_name
    into v_selected
    from public.container_cards cc
    join public.cards c on c.id = cc.card_id
    left join public.card_tiers t on t.id = cc.tier_id
    where cc.container_id = v_container.id
      and coalesce(cc.is_enabled, true) = true
      and cc.tier_id = v_selected_box_tier_id
    order by random()
    limit 1;

    if v_selected.card_id is null then
      raise exception 'The selected box tier has no eligible cards configured';
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
