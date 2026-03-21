begin;

with tier_mapping as (
  select
    src.id as source_tier_id,
    dst.id as target_tier_id
  from public.card_tiers src
  join public.card_tiers dst
    on dst.sort_order = case src.sort_order
      when 2 then 1
      when 4 then 3
      when 6 then 5
      when 8 then 7
      when 10 then 9
      else src.sort_order
    end
  where src.sort_order in (2, 4, 6, 8, 10)
)
update public.container_cards cc
set tier_id = tier_mapping.target_tier_id
from tier_mapping
cross join public.containers c
cross join public.container_types ct
where cc.tier_id = tier_mapping.source_tier_id
  and c.id = cc.container_id
  and ct.id = c.container_type_id
  and lower(ct.code) in ('deck_box', 'collectors_box');

create or replace function public._roll_enabled_box_tier(p_container_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_row record;
  v_total numeric := 0;
  v_cursor numeric := 0;
  v_roll numeric := random();
  v_selected jsonb := '{}'::jsonb;
  v_container_type_code text;
begin
  select lower(ct.code)
  into v_container_type_code
  from public.containers c
  join public.container_types ct
    on ct.id = c.container_type_id
  where c.id = p_container_id
  limit 1;

  if v_container_type_code is null then
    return '{}'::jsonb;
  end if;

  for v_row in
    select
      t.id,
      t.code,
      t.name,
      case
        when v_container_type_code in ('deck_box', 'collectors_box') then
          case coalesce(t.sort_order, 0)
            when 1 then 30::numeric
            when 3 then 25::numeric
            when 5 then 20::numeric
            when 7 then 15::numeric
            when 9 then 10::numeric
            else 0::numeric
          end
        else greatest(coalesce(t.weight_percent, 0), 0)::numeric
      end as weight
    from public.card_tiers t
    where exists (
      select 1
      from public.container_cards cc
      where cc.container_id = p_container_id
        and coalesce(cc.is_enabled, true) = true
        and cc.tier_id = t.id
    )
      and (
        v_container_type_code not in ('deck_box', 'collectors_box')
        or coalesce(t.sort_order, 9999) in (1, 3, 5, 7, 9)
      )
    order by coalesce(t.sort_order, 9999), t.name
  loop
    v_total := v_total + v_row.weight;
  end loop;

  if v_total <= 0 then
    select jsonb_build_object(
      'id', t.id,
      'code', t.code,
      'name', t.name
    )
    into v_selected
    from public.card_tiers t
    where exists (
      select 1
      from public.container_cards cc
      where cc.container_id = p_container_id
        and coalesce(cc.is_enabled, true) = true
        and cc.tier_id = t.id
    )
      and (
        v_container_type_code not in ('deck_box', 'collectors_box')
        or coalesce(t.sort_order, 9999) in (1, 3, 5, 7, 9)
      )
    order by coalesce(t.sort_order, 9999), t.name
    limit 1;

    return coalesce(v_selected, '{}'::jsonb);
  end if;

  for v_row in
    select
      t.id,
      t.code,
      t.name,
      case
        when v_container_type_code in ('deck_box', 'collectors_box') then
          case coalesce(t.sort_order, 0)
            when 1 then 30::numeric
            when 3 then 25::numeric
            when 5 then 20::numeric
            when 7 then 15::numeric
            when 9 then 10::numeric
            else 0::numeric
          end
        else greatest(coalesce(t.weight_percent, 0), 0)::numeric
      end as weight
    from public.card_tiers t
    where exists (
      select 1
      from public.container_cards cc
      where cc.container_id = p_container_id
        and coalesce(cc.is_enabled, true) = true
        and cc.tier_id = t.id
    )
      and (
        v_container_type_code not in ('deck_box', 'collectors_box')
        or coalesce(t.sort_order, 9999) in (1, 3, 5, 7, 9)
      )
    order by coalesce(t.sort_order, 9999), t.name
  loop
    v_cursor := v_cursor + (v_row.weight / v_total);

    if v_roll <= v_cursor then
      v_selected := jsonb_build_object(
        'id', v_row.id,
        'code', v_row.code,
        'name', v_row.name
      );
      exit;
    end if;
  end loop;

  if v_selected = '{}'::jsonb then
    select jsonb_build_object(
      'id', t.id,
      'code', t.code,
      'name', t.name
    )
    into v_selected
    from public.card_tiers t
    where exists (
      select 1
      from public.container_cards cc
      where cc.container_id = p_container_id
        and coalesce(cc.is_enabled, true) = true
        and cc.tier_id = t.id
    )
      and (
        v_container_type_code not in ('deck_box', 'collectors_box')
        or coalesce(t.sort_order, 9999) in (1, 3, 5, 7, 9)
      )
    order by coalesce(t.sort_order, 9999), t.name
    limit 1;
  end if;

  return coalesce(v_selected, '{}'::jsonb);
end;
$function$;

create or replace function public.upsert_box_product_admin(
  p_container_id uuid,
  p_name text,
  p_code text,
  p_box_number_code text,
  p_box_category_code text,
  p_description text,
  p_image_url text,
  p_content_mode text,
  p_card_count integer,
  p_is_enabled boolean,
  p_is_locked boolean,
  p_cards jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_container_id uuid := p_container_id;
  v_box_type_id uuid;
  v_box_category_code text := lower(trim(coalesce(p_box_category_code, '')));
  v_box_number_code text := public._normalize_box_number_code(p_box_number_code);
  v_card_count integer := greatest(coalesce(p_card_count, 1), 1);
  v_code text := trim(coalesce(p_code, ''));
  v_deck_box_tier_violation_count integer := 0;
begin
  perform public._assert_progression_admin();

  if trim(coalesce(p_name, '')) = '' then
    raise exception 'Box name is required';
  end if;

  if v_code = '' then
    raise exception 'Box code is required';
  end if;

  if v_box_category_code not in ('deck_box', 'promo_box', 'collectors_box') then
    raise exception 'Box category must be Deck Box, Promo Box, or Collectors Box';
  end if;

  if v_box_category_code in ('deck_box', 'collectors_box') then
    select count(*)
    into v_deck_box_tier_violation_count
    from jsonb_to_recordset(coalesce(p_cards, '[]'::jsonb))
      as x(card_id bigint, tier_id uuid, is_enabled boolean, weight numeric)
    join public.card_tiers tiers
      on tiers.id = x.tier_id
    where x.card_id is not null
      and x.tier_id is not null
      and coalesce(tiers.sort_order, 9999) not in (1, 3, 5, 7, 9);

    if v_deck_box_tier_violation_count > 0 then
      raise exception 'Deck Boxes and Collectors Boxes only support Bulk, Solid, Elite, HighChase, and Legendary tiers';
    end if;
  end if;

  select id
  into v_box_type_id
  from public.container_types
  where lower(code) = v_box_category_code
  limit 1;

  if v_box_type_id is null then
    raise exception 'Selected box category type is missing';
  end if;

  if exists (
    select 1
    from public.containers c
    where c.container_type_id = v_box_type_id
      and c.box_number_code = v_box_number_code
      and c.id <> coalesce(v_container_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) then
    raise exception 'Box Number % is already used for this box category', v_box_number_code;
  end if;

  if v_container_id is null then
    insert into public.containers (
      id,
      name,
      description,
      card_count,
      image_url,
      is_enabled,
      is_locked,
      content_mode,
      selection_count,
      draft_pick_count,
      rarity_mode,
      code,
      container_type_id,
      artwork_url,
      cards_per_open,
      pack_group_code,
      pack_variant,
      pack_set_name,
      pack_number_code,
      is_reward_pack,
      box_number_code
    )
    values (
      gen_random_uuid(),
      trim(p_name),
      coalesce(p_description, ''),
      v_card_count,
      p_image_url,
      coalesce(p_is_enabled, true),
      coalesce(p_is_locked, false),
      public._normalize_container_content_mode(p_content_mode),
      null,
      null,
      'normal',
      v_code,
      v_box_type_id,
      p_image_url,
      v_card_count,
      null,
      null,
      null,
      null,
      false,
      v_box_number_code
    )
    returning id into v_container_id;
  else
    update public.containers
    set
      name = trim(p_name),
      description = coalesce(p_description, ''),
      card_count = v_card_count,
      image_url = p_image_url,
      is_enabled = coalesce(p_is_enabled, true),
      is_locked = coalesce(p_is_locked, false),
      content_mode = public._normalize_container_content_mode(p_content_mode),
      selection_count = null,
      draft_pick_count = null,
      rarity_mode = 'normal',
      code = v_code,
      container_type_id = v_box_type_id,
      artwork_url = p_image_url,
      cards_per_open = v_card_count,
      pack_group_code = null,
      pack_variant = null,
      pack_set_name = null,
      pack_number_code = null,
      is_reward_pack = false,
      box_number_code = v_box_number_code,
      updated_at = now()
    where id = v_container_id;

    if not found then
      raise exception 'Box product not found';
    end if;
  end if;

  delete from public.container_cards
  where container_id = v_container_id;

  insert into public.container_cards (
    container_id,
    card_id,
    tier_id,
    is_enabled,
    rarity_id,
    weight,
    slot_index,
    pack_pool_tier_id
  )
  select
    v_container_id,
    x.card_id,
    x.tier_id,
    coalesce(x.is_enabled, true),
    null,
    greatest(coalesce(x.weight, 1), 1),
    null,
    null
  from jsonb_to_recordset(coalesce(p_cards, '[]'::jsonb))
    as x(card_id bigint, tier_id uuid, is_enabled boolean, weight numeric)
  where x.card_id is not null
    and x.tier_id is not null;

  perform public._sync_container_opener_item(v_container_id);

  return jsonb_build_object(
    'success', true,
    'container_id', v_container_id
  );
end;
$function$;

notify pgrst, 'reload schema';

commit;
