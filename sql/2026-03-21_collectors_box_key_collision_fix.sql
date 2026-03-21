begin;

delete from public.item_definitions i
where i.target_kind = 'container'
  and i.target_id is null
  and not exists (
    select 1
    from public.player_inventory x
    where x.item_definition_id = i.id
  )
  and not exists (
    select 1
    from public.store_cart_items x
    where x.item_definition_id = i.id
  )
  and not exists (
    select 1
    from public.store_purchase_items x
    where x.item_definition_id = i.id
  )
  and not exists (
    select 1
    from public.player_trade_items x
    where x.item_definition_id = i.id
  )
  and not exists (
    select 1
    from public.player_gift_items x
    where x.item_definition_id = i.id
  )
  and not exists (
    select 1
    from public.player_reward_grants x
    where x.item_definition_id = i.id
  )
  and not exists (
    select 1
    from public.player_inventory_item_use_sessions x
    where x.item_definition_id = i.id
  )
  and not exists (
    select 1
    from public.series_round_reward_configs x
    where x.shared_item_definition_id = i.id
  )
  and not exists (
    select 1
    from public.series_round_reward_config_placements x
    where x.specific_item_definition_id = i.id
  )
  and not exists (
    select 1
    from public.series_round_reward_config_random_items x
    where x.item_definition_id = i.id
  );

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
  v_pack_identity_label text;
  v_box_identity_label text;
  v_existing_item record;
  v_conflicting_item record;
  v_item_id uuid;
begin
  select
    c.id,
    c.name,
    c.code,
    c.image_url,
    c.artwork_url,
    c.pack_type_code,
    c.pack_number_code,
    c.box_number_code,
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

  if v_item_family in ('full_pack_key', 'draft_pack_key')
     and trim(coalesce(v_container.pack_type_code, '')) <> ''
     and trim(coalesce(v_container.pack_number_code, '')) <> '' then
    v_pack_identity_label := public._pack_identity_label(
      v_container.pack_type_code,
      v_container.pack_number_code
    );
    v_item_code := public._slugify_store_code(
      case
        when v_item_family = 'draft_pack_key' then v_pack_identity_label || '_draft_pack_key'
        else v_pack_identity_label || '_pack_key'
      end
    );
    v_item_name := case
      when v_item_family = 'draft_pack_key' then v_pack_identity_label || ' Draft Pack Key'
      else v_pack_identity_label || ' Pack Key'
    end;
  elsif v_item_family in ('deck_box_key', 'promo_box_key', 'collectors_box_key')
     and trim(coalesce(v_container.box_number_code, '')) <> '' then
    v_box_identity_label := public._box_identity_label(
      v_container.container_type_code,
      v_container.box_number_code
    );
    v_item_code := public._slugify_store_code(
      case
        when v_item_family = 'deck_box_key' then v_box_identity_label || '_deck_box_key'
        when v_item_family = 'promo_box_key' then v_box_identity_label || '_promo_box_key'
        else v_box_identity_label || '_collectors_box_key'
      end
    );
    v_item_name := case
      when v_item_family = 'deck_box_key' then v_box_identity_label || ' Deck Box Key'
      when v_item_family = 'promo_box_key' then v_box_identity_label || ' Promo Box Key'
      else v_box_identity_label || ' Collectors Box Key'
    end;
  else
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
  end if;

  select *
  into v_existing_item
  from public.item_definitions i
  where i.target_kind = 'container'
    and i.target_id = p_container_id
  order by i.updated_at desc nulls last, i.name asc
  limit 1;

  if v_existing_item.id is null then
    select *
    into v_existing_item
    from public.item_definitions i
    where lower(coalesce(i.code, '')) = lower(v_item_code)
    order by
      case
        when i.target_kind = 'container' and i.target_id is null then 0
        else 1
      end,
      i.updated_at desc nulls last,
      i.name asc
    limit 1;

    if v_existing_item.id is not null
       and v_existing_item.target_kind = 'container'
       and v_existing_item.target_id is not null
       and v_existing_item.target_id <> p_container_id then
      raise exception 'Container opener code % is already used by another container item', v_item_code;
    end if;
  else
    select *
    into v_conflicting_item
    from public.item_definitions i
    where lower(coalesce(i.code, '')) = lower(v_item_code)
      and i.id <> v_existing_item.id
    order by
      case
        when i.target_kind = 'container' and i.target_id is null then 0
        else 1
      end,
      i.updated_at desc nulls last,
      i.name asc
    limit 1;

    if v_conflicting_item.id is not null then
      if v_conflicting_item.target_kind = 'container'
         and v_conflicting_item.target_id is null then
        delete from public.item_definitions
        where id = v_conflicting_item.id;
      else
        raise exception 'Container opener code % is already used by another item definition', v_item_code;
      end if;
    end if;
  end if;

  if v_existing_item.id is not null then
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

notify pgrst, 'reload schema';

commit;
