begin;

create or replace function public._assert_pack_slot_percentages(
  p_slot_tiers jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_slot_index integer;
  v_enabled_count integer;
  v_total numeric;
begin
  for v_slot_index in 1..9 loop
    select
      count(*) filter (
        where x.pack_pool_tier_id is not null
          and coalesce(x.is_enabled, true) = true
          and coalesce(x.weight, 0) > 0
      ),
      coalesce(sum(
        case
          when x.pack_pool_tier_id is not null
            and coalesce(x.is_enabled, true) = true
          then coalesce(x.weight, 0)
          else 0
        end
      ), 0)
    into v_enabled_count, v_total
    from jsonb_to_recordset(coalesce(p_slot_tiers, '[]'::jsonb))
      as x(
        slot_index integer,
        pack_pool_tier_id uuid,
        weight numeric,
        is_enabled boolean
      )
    where x.slot_index = v_slot_index;

    if coalesce(v_enabled_count, 0) <= 0 then
      raise exception 'Pack slot % must have at least one active tier', v_slot_index;
    end if;

    if abs(coalesce(v_total, 0) - 100::numeric) > 0.01 then
      raise exception
        'Pack slot % must total 100%% (currently %%%)',
        v_slot_index,
        trim(to_char(coalesce(v_total, 0), 'FM999990.00'));
    end if;
  end loop;
end;
$function$;

do $$
declare
  v_slot record;
  v_row record;
  v_total numeric;
  v_running numeric;
  v_next_weight numeric;
begin
  for v_slot in
    select distinct container_id, slot_index
    from public.container_pack_slot_tiers
  loop
    select coalesce(sum(weight), 0)
    into v_total
    from public.container_pack_slot_tiers
    where container_id = v_slot.container_id
      and slot_index = v_slot.slot_index
      and coalesce(is_enabled, true) = true;

    if v_total <= 0 then
      continue;
    end if;

    v_running := 0;

    for v_row in
      select
        id,
        weight,
        row_number() over (order by id) as row_number,
        count(*) over () as total_rows
      from public.container_pack_slot_tiers
      where container_id = v_slot.container_id
        and slot_index = v_slot.slot_index
        and coalesce(is_enabled, true) = true
      order by id
    loop
      if v_row.row_number = v_row.total_rows then
        v_next_weight := round(100 - v_running, 2);
      else
        v_next_weight := round((coalesce(v_row.weight, 0) / v_total) * 100, 2);
        v_running := v_running + v_next_weight;
      end if;

      update public.container_pack_slot_tiers
      set
        weight = greatest(v_next_weight, 0),
        updated_at = now()
      where id = v_row.id;
    end loop;
  end loop;
end;
$$;

create or replace function public.upsert_pack_product_admin(
  p_pack_group_code text,
  p_name text,
  p_code text,
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
  v_default_pack_rarity_id uuid;
begin
  perform public._assert_admin_plus();

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

  v_default_pack_rarity_id := public._resolve_common_rarity_id();
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
      container_type_id, artwork_url, cards_per_open, pack_group_code, pack_variant
    )
    values (
      gen_random_uuid(), trim(p_name), p_description, 9, p_image_url,
      coalesce(p_is_enabled, true), coalesce(p_is_locked, false),
      public._normalize_container_content_mode(p_content_mode), null, null, 'pack_slots',
      v_base_code, v_full_type_id, p_image_url, 9, v_group_code, 'full'
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
      container_type_id, artwork_url, cards_per_open, pack_group_code, pack_variant
    )
    values (
      gen_random_uuid(), trim(p_name) || ' Draft', p_description, 9, p_image_url,
      coalesce(p_is_enabled, true), coalesce(p_is_locked, false),
      public._normalize_container_content_mode(p_content_mode), null, null, 'pack_slots',
      v_base_code || '_DRAFT', v_draft_type_id, p_image_url, 9, v_group_code, 'draft'
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
    null,
    x.pack_pool_tier_id,
    coalesce(x.is_enabled, true),
    coalesce(x.rarity_id, v_default_pack_rarity_id),
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

commit;
