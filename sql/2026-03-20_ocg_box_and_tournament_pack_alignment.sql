begin;

insert into public.container_types (
  id,
  name,
  code,
  description,
  is_enabled,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  'OCG Box',
  'ocg_box',
  'OCG box products and keys.',
  true,
  now(),
  now()
where not exists (
  select 1
  from public.container_types
  where lower(code) = 'ocg_box'
);

update public.containers
set
  pack_type_code = case
    when pack_group_code is null then pack_type_code
    when lower(trim(coalesce(pack_type_code, ''))) = 'tournament' then 'tournament'
    when lower(trim(coalesce(pack_type_code, ''))) = 'ocg' then 'reward'
    when lower(trim(coalesce(pack_type_code, ''))) = 'reward'
         and greatest(coalesce(cards_per_open, card_count, 0), 0) = 3 then 'tournament'
    when lower(trim(coalesce(pack_type_code, ''))) = 'reward' then 'reward'
    when coalesce(is_reward_pack, false) = true
         and greatest(coalesce(cards_per_open, card_count, 0), 0) = 3 then 'tournament'
    when coalesce(is_reward_pack, false) = true then 'reward'
    when greatest(coalesce(cards_per_open, card_count, 0), 0) = 5 then 'reward'
    when greatest(coalesce(cards_per_open, card_count, 0), 0) = 3 then 'tournament'
    else 'tcg'
  end,
  updated_at = now()
where pack_group_code is not null;

alter table public.containers
  drop constraint if exists containers_pack_type_code_check;

alter table public.containers
  add constraint containers_pack_type_code_check
  check (
    pack_group_code is null
    or lower(trim(coalesce(pack_type_code, ''))) in ('tcg', 'reward', 'tournament')
  );

create or replace function public._normalize_pack_type_code(p_value text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_normalized text := lower(trim(coalesce(p_value, '')));
begin
  if v_normalized = '' then
    raise exception 'Pack Type is required';
  end if;

  if v_normalized not in ('tcg', 'reward', 'tournament') then
    raise exception 'Pack Type must be TCG, Reward, or Tournament';
  end if;

  return v_normalized;
end;
$function$;

create or replace function public._pack_cards_per_open_for_type(p_pack_type_code text)
returns integer
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_pack_type_code text := public._normalize_pack_type_code(p_pack_type_code);
begin
  if v_pack_type_code = 'reward' then
    return 5;
  end if;

  if v_pack_type_code = 'tournament' then
    return 3;
  end if;

  return 9;
end;
$function$;

create or replace function public._pack_key_prefix_for_type(p_pack_type_code text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_pack_type_code text := public._normalize_pack_type_code(p_pack_type_code);
begin
  if v_pack_type_code = 'reward' then
    return 'RWD';
  end if;

  if v_pack_type_code = 'tournament' then
    return 'TOR';
  end if;

  return 'TCG';
end;
$function$;

update public.containers
set
  pack_group_code = case
    when pack_group_code is not null and pack_number_code is not null
      then public._pack_group_code_for_identity(pack_type_code, pack_number_code)
    else pack_group_code
  end,
  card_count = public._pack_cards_per_open_for_type(pack_type_code),
  cards_per_open = public._pack_cards_per_open_for_type(pack_type_code),
  is_reward_pack = (public._normalize_pack_type_code(pack_type_code) = 'reward'),
  updated_at = now()
where pack_group_code is not null;

create or replace function public.get_pack_products_admin()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  perform public._assert_progression_admin();

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'pack_group_code', full_container.pack_group_code,
        'pack_number_code', nullif(trim(coalesce(full_container.pack_number_code, '')), ''),
        'pack_type_code', full_container.pack_type_code,
        'is_reward_pack', full_container.is_reward_pack,
        'name', full_container.name,
        'code', full_container.code,
        'description', full_container.description,
        'image_url', coalesce(nullif(full_container.artwork_url, ''), nullif(full_container.image_url, '')),
        'content_mode', full_container.content_mode,
        'is_enabled', coalesce(full_container.is_enabled, true),
        'is_locked', coalesce(full_container.is_locked, false),
        'cards_per_open', coalesce(full_container.cards_per_open, full_container.card_count, 9),
        'full_container_id', full_container.id,
        'draft_container_id', draft_container.id
      )
      order by
        case lower(coalesce(full_container.pack_type_code, ''))
          when 'tcg' then 0
          when 'reward' then 1
          when 'tournament' then 2
          else 9
        end,
        case
          when trim(coalesce(full_container.pack_number_code, '')) ~ '^\d{3}$'
            then trim(full_container.pack_number_code)::integer
          else 9999
        end,
        lower(full_container.name),
        lower(full_container.code)
    )
    from public.containers full_container
    left join public.containers draft_container
      on draft_container.pack_group_code = full_container.pack_group_code
     and draft_container.pack_variant = 'draft'
    where full_container.pack_group_code is not null
      and full_container.pack_variant = 'full'
  ), '[]'::jsonb);
end;
$function$;

create or replace function public._box_key_prefix_for_category(p_box_category_code text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_box_category_code text := lower(trim(coalesce(p_box_category_code, '')));
begin
  if v_box_category_code = 'deck_box' then
    return 'DCK';
  end if;

  if v_box_category_code = 'promo_box' then
    return 'PRO';
  end if;

  if v_box_category_code = 'ocg_box' then
    return 'OCG';
  end if;

  raise exception 'Unsupported box category for key label';
end;
$function$;

create or replace function public._box_identity_label(
  p_box_category_code text,
  p_box_number_code text
)
returns text
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_box_category_code text := lower(trim(coalesce(p_box_category_code, '')));
  v_box_number_code text := public._normalize_box_number_code(p_box_number_code);
begin
  if v_box_number_code is null then
    raise exception 'Box Number is required for key labels';
  end if;

  return format(
    '%s-%s',
    public._box_key_prefix_for_category(v_box_category_code),
    v_box_number_code
  );
end;
$function$;

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

  if v_code = 'ocg_box' then
    return 'ocg_box_key';
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

  if v_family = 'ocg_box_key' then
    return 'OCG Box Key';
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

  if v_family = 'random_ocg_box_key' then
    return 'ocg_box';
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
  v_pack_identity_label text;
  v_box_identity_label text;
  v_existing_item record;
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
  elsif v_item_family in ('deck_box_key', 'promo_box_key', 'ocg_box_key')
     and trim(coalesce(v_container.box_number_code, '')) <> '' then
    v_box_identity_label := public._box_identity_label(
      v_container.container_type_code,
      v_container.box_number_code
    );
    v_item_code := public._slugify_store_code(
      case
        when v_item_family = 'deck_box_key' then v_box_identity_label || '_deck_box_key'
        when v_item_family = 'promo_box_key' then v_box_identity_label || '_promo_box_key'
        else v_box_identity_label || '_ocg_box_key'
      end
    );
    v_item_name := case
      when v_item_family = 'deck_box_key' then v_box_identity_label || ' Deck Box Key'
      when v_item_family = 'promo_box_key' then v_box_identity_label || ' Promo Box Key'
      else v_box_identity_label || ' OCG Box Key'
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

create or replace function public.get_box_products_admin()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  perform public._assert_progression_admin();

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'container_id', c.id,
        'box_number_code', nullif(trim(coalesce(c.box_number_code, '')), ''),
        'box_category_code', ct.code,
        'box_category_label', ct.name,
        'name', c.name,
        'code', c.code,
        'description', c.description,
        'image_url', coalesce(nullif(c.artwork_url, ''), nullif(c.image_url, '')),
        'content_mode', c.content_mode,
        'cards_per_open', coalesce(c.cards_per_open, c.card_count, 1),
        'is_enabled', coalesce(c.is_enabled, true),
        'is_locked', coalesce(c.is_locked, false),
        'total_cards', (
          select count(*)
          from public.container_cards cc
          where cc.container_id = c.id
        )
      )
      order by
        case lower(ct.code)
          when 'deck_box' then 0
          when 'promo_box' then 1
          when 'ocg_box' then 2
          else 9
        end,
        case
          when trim(coalesce(c.box_number_code, '')) ~ '^(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2})$'
            then trim(c.box_number_code)::integer
          else 9999
        end,
        lower(c.name),
        lower(c.code)
    )
    from public.containers c
    join public.container_types ct
      on ct.id = c.container_type_id
    where lower(ct.code) in ('deck_box', 'promo_box', 'ocg_box')
  ), '[]'::jsonb);
end;
$function$;

create or replace function public.get_box_product_admin(p_container_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_box record;
begin
  perform public._assert_progression_admin();

  if p_container_id is null then
    raise exception 'Box product is required';
  end if;

  select
    c.*,
    ct.code as box_category_code,
    ct.name as box_category_label
  into v_box
  from public.containers c
  join public.container_types ct
    on ct.id = c.container_type_id
  where c.id = p_container_id
    and lower(ct.code) in ('deck_box', 'promo_box', 'ocg_box')
  limit 1;

  if not found then
    raise exception 'Box product not found';
  end if;

  return jsonb_build_object(
    'container_id', v_box.id,
    'box_number_code', nullif(trim(coalesce(v_box.box_number_code, '')), ''),
    'box_category_code', v_box.box_category_code,
    'box_category_label', v_box.box_category_label,
    'name', v_box.name,
    'code', v_box.code,
    'description', v_box.description,
    'image_url', coalesce(nullif(v_box.artwork_url, ''), nullif(v_box.image_url, '')),
    'content_mode', v_box.content_mode,
    'cards_per_open', coalesce(v_box.cards_per_open, v_box.card_count, 1),
    'is_enabled', coalesce(v_box.is_enabled, true),
    'is_locked', coalesce(v_box.is_locked, false),
    'cards', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', cc.id,
          'card_id', cc.card_id,
          'card_name', cards.name,
          'card_image_url', cards.image_url,
          'tier_id', tiers.id,
          'tier_code', tiers.code,
          'tier_name', tiers.name,
          'weight', cc.weight,
          'is_enabled', coalesce(cc.is_enabled, true)
        )
        order by tiers.sort_order, lower(cards.name), cc.id
      )
      from public.container_cards cc
      join public.cards
        on cards.id = cc.card_id
      join public.card_tiers tiers
        on tiers.id = cc.tier_id
      where cc.container_id = v_box.id
        and cc.tier_id is not null
    ), '[]'::jsonb)
  );
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
begin
  perform public._assert_progression_admin();

  if trim(coalesce(p_name, '')) = '' then
    raise exception 'Box name is required';
  end if;

  if v_code = '' then
    raise exception 'Box code is required';
  end if;

  if v_box_category_code not in ('deck_box', 'promo_box', 'ocg_box') then
    raise exception 'Box category must be Deck Box, Promo Box, or OCG Box';
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

create or replace function public.get_box_reel_preview_cards(
  p_container_id uuid,
  p_card_limit integer default 48
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_container_type_code text;
  v_limit integer := greatest(coalesce(p_card_limit, 48), 12);
begin
  if p_container_id is null then
    raise exception 'Container is required';
  end if;

  select lower(ct.code)
  into v_container_type_code
  from public.containers c
  join public.container_types ct
    on ct.id = c.container_type_id
  where c.id = p_container_id
    and coalesce(c.is_enabled, true) = true
  limit 1;

  if v_container_type_code is null then
    raise exception 'Box not found or is disabled';
  end if;

  if v_container_type_code not in ('promo_box', 'deck_box', 'ocg_box') then
    raise exception 'That container is not a box';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'card_id', reel.card_id,
          'card_name', reel.card_name,
          'image_url', reel.image_url,
          'tier_id', reel.tier_id,
          'tier_code', reel.tier_code,
          'tier_name', reel.tier_name
        )
        order by reel.sort_index
      )
      from (
        select
          sampled.card_id,
          sampled.card_name,
          sampled.image_url,
          sampled.tier_id,
          sampled.tier_code,
          sampled.tier_name,
          row_number() over () as sort_index
        from (
          select
            cc.card_id,
            c.name as card_name,
            c.image_url,
            cc.tier_id,
            coalesce(t.code, 'tier1') as tier_code,
            coalesce(t.name, 'Bulk') as tier_name
          from public.container_cards cc
          join public.cards c
            on c.id = cc.card_id
          left join public.card_tiers t
            on t.id = cc.tier_id
          where cc.container_id = p_container_id
            and coalesce(cc.is_enabled, true) = true
          order by random()
          limit v_limit
        ) sampled
      ) reel
    ),
    '[]'::jsonb
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
    'random_ocg_box_key',
    'Random OCG Box Key',
    'Buy this to receive one random key for any unlocked OCG Box.',
    'random_ocg_box_key',
    120
  ),
  (
    'random_draft_pack_key',
    'Random Draft Pack Key',
    'Buy this to receive one random key for any unlocked Draft Pack.',
    'random_draft_pack_key',
    130
  ),
  (
    'random_pack_key',
    'Random Pack Key',
    'Buy this to receive one random key for any unlocked Pack.',
    'random_full_pack_key',
    140
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
  v_container_id uuid;
begin
  for v_container_id in
    select id
    from public.containers
  loop
    perform public._sync_container_opener_item(v_container_id);
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;
