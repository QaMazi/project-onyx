begin;

create or replace function public._normalize_box_number_code(p_value text)
returns text
language plpgsql
as $function$
declare
  v_value text := trim(coalesce(p_value, ''));
begin
  if v_value = '' then
    return null;
  end if;

  if v_value !~ '^(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2})$' then
    raise exception 'Box Number must be exactly 3 digits from 001 to 999';
  end if;

  return v_value;
end;
$function$;

alter table public.containers
  add column if not exists box_number_code text;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'containers_box_number_code_check'
      and conrelid = 'public.containers'::regclass
  ) then
    alter table public.containers
      drop constraint containers_box_number_code_check;
  end if;

  alter table public.containers
    add constraint containers_box_number_code_check
    check (
      box_number_code is null
      or trim(box_number_code) ~ '^(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2})$'
    );
end;
$$;

create unique index if not exists containers_box_number_scope_uidx
  on public.containers (container_type_id, box_number_code)
  where box_number_code is not null;

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
        case when lower(ct.code) = 'deck_box' then 0 else 1 end,
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
    where lower(ct.code) in ('deck_box', 'promo_box')
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
    and lower(ct.code) in ('deck_box', 'promo_box')
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

  if v_box_category_code not in ('deck_box', 'promo_box') then
    raise exception 'Box category must be Deck Box or Promo Box';
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

create or replace function public.delete_box_product_admin(p_container_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  perform public._assert_progression_admin();

  return public.delete_container_admin(p_container_id);
end;
$function$;

commit;
