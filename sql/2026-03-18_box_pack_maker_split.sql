begin;

create extension if not exists pgcrypto;

create table if not exists public.pack_pool_tiers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null unique,
  sort_order integer not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.pack_pool_tiers (code, name, sort_order)
values
  ('common', 'Common', 1),
  ('rare', 'Rare', 2),
  ('super_rare', 'Super Rare', 3),
  ('ultra_rare', 'Ultra Rare', 4),
  ('secret_rare', 'Secret Rare', 5)
on conflict (code)
do update set
  name = excluded.name,
  sort_order = excluded.sort_order,
  updated_at = now();

grant select on public.pack_pool_tiers to anon, authenticated, service_role;

alter table public.containers
  add column if not exists pack_group_code text,
  add column if not exists pack_variant text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.containers'::regclass
      and conname = 'containers_pack_variant_check'
  ) then
    alter table public.containers
      add constraint containers_pack_variant_check
      check (pack_variant is null or pack_variant in ('full', 'draft'));
  end if;
end;
$$;

create unique index if not exists containers_pack_group_variant_unique_idx
  on public.containers (pack_group_code, pack_variant)
  where pack_group_code is not null
    and pack_variant is not null;

alter table public.container_cards
  add column if not exists pack_pool_tier_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.container_cards'::regclass
      and conname = 'container_cards_pack_pool_tier_id_fkey'
  ) then
    alter table public.container_cards
      add constraint container_cards_pack_pool_tier_id_fkey
      foreign key (pack_pool_tier_id)
      references public.pack_pool_tiers(id)
      on delete set null;
  end if;
end;
$$;

create table if not exists public.container_pack_slot_tiers (
  id uuid primary key default gen_random_uuid(),
  container_id uuid not null references public.containers(id) on delete cascade,
  slot_index integer not null check (slot_index between 1 and 9),
  pack_pool_tier_id uuid not null references public.pack_pool_tiers(id) on delete cascade,
  weight numeric not null default 1 check (weight > 0),
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (container_id, slot_index, pack_pool_tier_id)
);

create index if not exists container_pack_slot_tiers_container_slot_idx
  on public.container_pack_slot_tiers (container_id, slot_index);

update public.containers c
set
  pack_group_code = coalesce(
    c.pack_group_code,
    nullif(public._slugify_store_code(coalesce(c.code, c.name)), '')
  ),
  pack_variant = coalesce(
    c.pack_variant,
    case
      when lower(ct.code) = 'full_pack' then 'full'
      when lower(ct.code) = 'draft_pack' then 'draft'
      else c.pack_variant
    end
  ),
  updated_at = now()
from public.container_types ct
where ct.id = c.container_type_id
  and lower(ct.code) in ('full_pack', 'draft_pack');

do $$
declare
  v_common uuid;
  v_rare uuid;
  v_super uuid;
  v_ultra uuid;
  v_secret uuid;
  v_container record;
begin
  select id into v_common from public.pack_pool_tiers where code = 'common';
  select id into v_rare from public.pack_pool_tiers where code = 'rare';
  select id into v_super from public.pack_pool_tiers where code = 'super_rare';
  select id into v_ultra from public.pack_pool_tiers where code = 'ultra_rare';
  select id into v_secret from public.pack_pool_tiers where code = 'secret_rare';

  update public.container_cards cc
  set pack_pool_tier_id = case
    when coalesce(cc.slot_index, 1) <= 8 then v_common
    else v_rare
  end
  from public.containers c
  join public.container_types ct
    on ct.id = c.container_type_id
  where c.id = cc.container_id
    and lower(ct.code) in ('full_pack', 'draft_pack')
    and cc.pack_pool_tier_id is null;

  for v_container in
    select c.id
    from public.containers c
    join public.container_types ct
      on ct.id = c.container_type_id
    where lower(ct.code) in ('full_pack', 'draft_pack')
  loop
    insert into public.container_pack_slot_tiers (
      container_id,
      slot_index,
      pack_pool_tier_id,
      weight,
      is_enabled
    )
    select
      v_container.id,
      x.slot_index,
      x.pack_pool_tier_id,
      x.weight,
      true
    from (
      values
        (1, v_common, 1::numeric),
        (2, v_common, 1::numeric),
        (3, v_common, 1::numeric),
        (4, v_common, 1::numeric),
        (5, v_common, 1::numeric),
        (6, v_common, 1::numeric),
        (7, v_common, 1::numeric),
        (8, v_common, 1::numeric),
        (9, v_rare, 1::numeric),
        (9, v_super, 0.166667::numeric),
        (9, v_ultra, 0.083333::numeric),
        (9, v_secret, 0.041667::numeric)
    ) as x(slot_index, pack_pool_tier_id, weight)
    where x.pack_pool_tier_id is not null
      and not exists (
        select 1
        from public.container_pack_slot_tiers cps
        where cps.container_id = v_container.id
          and cps.slot_index = x.slot_index
          and cps.pack_pool_tier_id = x.pack_pool_tier_id
      );
  end loop;
end;
$$;

create or replace function public._roll_weighted_card_rarity()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_total numeric := 0;
  v_roll numeric := random();
  v_cursor numeric := 0;
  v_row record;
  v_selected jsonb := '{}'::jsonb;
begin
  for v_row in
    select id, code, name, greatest(coalesce(weight_percent, 0), 0) as weight
    from public.card_rarities
    order by coalesce(sort_order, 9999), name
  loop
    v_total := v_total + v_row.weight;
  end loop;

  if v_total <= 0 then
    select jsonb_build_object('id', r.id, 'code', r.code, 'name', r.name)
    into v_selected
    from public.card_rarities r
    where r.id = public._resolve_common_rarity_id();

    return coalesce(v_selected, '{}'::jsonb);
  end if;

  for v_row in
    select id, code, name, greatest(coalesce(weight_percent, 0), 0) as weight
    from public.card_rarities
    order by coalesce(sort_order, 9999), name
  loop
    v_cursor := v_cursor + (v_row.weight / v_total);
    if v_roll <= v_cursor then
      v_selected := jsonb_build_object('id', v_row.id, 'code', v_row.code, 'name', v_row.name);
      exit;
    end if;
  end loop;

  if v_selected = '{}'::jsonb then
    select jsonb_build_object('id', r.id, 'code', r.code, 'name', r.name)
    into v_selected
    from public.card_rarities r
    where r.id = public._resolve_common_rarity_id();
  end if;

  return coalesce(v_selected, '{}'::jsonb);
end;
$function$;

create or replace function public.get_pack_pool_tiers_admin()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  perform public._assert_admin_plus();

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'code', t.code,
        'name', t.name,
        'sort_order', t.sort_order
      )
      order by t.sort_order, t.name
    )
    from public.pack_pool_tiers t
  ), '[]'::jsonb);
end;
$function$;

create or replace function public.get_pack_products_admin()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  perform public._assert_admin_plus();

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'pack_group_code', full_container.pack_group_code,
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
      order by lower(full_container.name), lower(full_container.code)
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

create or replace function public.get_pack_product_admin(p_pack_group_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_full record;
  v_draft record;
begin
  perform public._assert_admin_plus();

  if trim(coalesce(p_pack_group_code, '')) = '' then
    raise exception 'Pack group code is required';
  end if;

  select * into v_full
  from public.containers
  where pack_group_code = trim(p_pack_group_code)
    and pack_variant = 'full'
  limit 1;

  if not found then
    raise exception 'Pack product not found';
  end if;

  select * into v_draft
  from public.containers
  where pack_group_code = trim(p_pack_group_code)
    and pack_variant = 'draft'
  limit 1;

  return jsonb_build_object(
    'pack_group_code', v_full.pack_group_code,
    'name', v_full.name,
    'code', v_full.code,
    'description', v_full.description,
    'image_url', coalesce(nullif(v_full.artwork_url, ''), nullif(v_full.image_url, '')),
    'content_mode', v_full.content_mode,
    'is_enabled', coalesce(v_full.is_enabled, true),
    'is_locked', coalesce(v_full.is_locked, false),
    'cards_per_open', coalesce(v_full.cards_per_open, v_full.card_count, 9),
    'full_container_id', v_full.id,
    'draft_container_id', v_draft.id,
    'cards', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', cc.id,
          'card_id', cc.card_id,
          'card_name', c.name,
          'pack_pool_tier_id', ppt.id,
          'pack_pool_tier_code', ppt.code,
          'pack_pool_tier_name', ppt.name,
          'weight', cc.weight,
          'is_enabled', coalesce(cc.is_enabled, true)
        )
        order by ppt.sort_order, lower(c.name)
      )
      from public.container_cards cc
      join public.cards c on c.id = cc.card_id
      join public.pack_pool_tiers ppt on ppt.id = cc.pack_pool_tier_id
      where cc.container_id = v_full.id
        and cc.pack_pool_tier_id is not null
    ), '[]'::jsonb),
    'slot_tiers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', cps.id,
          'slot_index', cps.slot_index,
          'pack_pool_tier_id', ppt.id,
          'pack_pool_tier_code', ppt.code,
          'pack_pool_tier_name', ppt.name,
          'weight', cps.weight,
          'is_enabled', coalesce(cps.is_enabled, true)
        )
        order by cps.slot_index, ppt.sort_order
      )
      from public.container_pack_slot_tiers cps
      join public.pack_pool_tiers ppt on ppt.id = cps.pack_pool_tier_id
      where cps.container_id = v_full.id
    ), '[]'::jsonb)
  );
end;
$function$;

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
begin
  perform public._assert_admin_plus();

  if trim(coalesce(p_name, '')) = '' then
    raise exception 'Pack name is required';
  end if;

  if trim(coalesce(p_code, '')) = '' then
    raise exception 'Pack code is required';
  end if;

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
    weight,
    slot_index
  )
  select
    ids.container_id,
    x.card_id,
    null,
    x.pack_pool_tier_id,
    coalesce(x.is_enabled, true),
    greatest(coalesce(x.weight, 1), 1),
    null
  from (values (v_full_id), (v_draft_id)) as ids(container_id)
  cross join jsonb_to_recordset(coalesce(p_cards, '[]'::jsonb))
    as x(card_id bigint, pack_pool_tier_id uuid, is_enabled boolean, weight numeric)
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
    greatest(coalesce(x.weight, 1), 0.000001),
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

create or replace function public.delete_pack_product_admin(p_pack_group_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_full_id uuid;
  v_draft_id uuid;
begin
  perform public._assert_admin_plus();

  if trim(coalesce(p_pack_group_code, '')) = '' then
    raise exception 'Pack group code is required';
  end if;

  select id into v_draft_id
  from public.containers
  where pack_group_code = trim(p_pack_group_code)
    and pack_variant = 'draft'
  limit 1;

  select id into v_full_id
  from public.containers
  where pack_group_code = trim(p_pack_group_code)
    and pack_variant = 'full'
  limit 1;

  if v_draft_id is null and v_full_id is null then
    raise exception 'Pack product not found';
  end if;

  if v_draft_id is not null then
    perform public.delete_container_admin(v_draft_id);
  end if;

  if v_full_id is not null then
    perform public.delete_container_admin(v_full_id);
  end if;

  return jsonb_build_object('success', true, 'pack_group_code', trim(p_pack_group_code));
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
  v_rarity jsonb := '{}'::jsonb;
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
    select 1 from public.container_cards cc
    where cc.container_id = v_container.id
      and coalesce(cc.is_enabled, true) = true
      and cc.slot_index is not null
  ) into v_has_slotted_rows;

  select exists (
    select 1 from public.container_pack_slot_tiers cps
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
        v_selected_pack_tier.tier_name
      into v_selected
      from public.container_cards cc
      join public.cards c on c.id = cc.card_id
      where cc.container_id = v_container.id
        and coalesce(cc.is_enabled, true) = true
        and cc.pack_pool_tier_id = v_selected_pack_tier.pack_pool_tier_id
      order by -ln(greatest(random(), 0.000001)) /
        greatest(coalesce(cc.weight, 1)::double precision, 0.000001)
      limit 1;

      if v_selected.card_id is null then
        raise exception 'Pack slot % has no eligible cards in % tier', v_slot_index, v_selected_pack_tier.tier_name;
      end if;

      v_rarity := public._roll_weighted_card_rarity();
      if nullif(coalesce(v_rarity ->> 'id', ''), '') is null then
        v_rarity := jsonb_build_object(
          'id', v_fallback_rarity.id,
          'code', v_fallback_rarity.code,
          'name', v_fallback_rarity.name
        );
      end if;

      insert into public.binder_cards (user_id, series_id, card_id, rarity_id, quantity, is_trade_locked)
      values (
        v_actor_id,
        v_inventory.series_id,
        v_selected.card_id,
        nullif(v_rarity ->> 'id', '')::uuid,
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
        'rarity_id', v_rarity ->> 'id',
        'rarity_code', v_rarity ->> 'code',
        'rarity_name', v_rarity ->> 'name',
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
        cc.slot_index
      into v_selected
      from public.container_cards cc
      join public.cards c on c.id = cc.card_id
      left join public.card_tiers t on t.id = cc.tier_id
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

      v_rarity := public._roll_weighted_card_rarity();
      if nullif(coalesce(v_rarity ->> 'id', ''), '') is null then
        v_rarity := jsonb_build_object(
          'id', v_fallback_rarity.id,
          'code', v_fallback_rarity.code,
          'name', v_fallback_rarity.name
        );
      end if;

      insert into public.binder_cards (user_id, series_id, card_id, rarity_id, quantity, is_trade_locked)
      values (
        v_actor_id,
        v_inventory.series_id,
        v_selected.card_id,
        nullif(v_rarity ->> 'id', '')::uuid,
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
        'rarity_id', v_rarity ->> 'id',
        'rarity_code', v_rarity ->> 'code',
        'rarity_name', v_rarity ->> 'name',
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

    v_rarity := public._roll_weighted_card_rarity();
    if nullif(coalesce(v_rarity ->> 'id', ''), '') is null then
      v_rarity := jsonb_build_object(
        'id', v_fallback_rarity.id,
        'code', v_fallback_rarity.code,
        'name', v_fallback_rarity.name
      );
    end if;

    insert into public.binder_cards (user_id, series_id, card_id, rarity_id, quantity, is_trade_locked)
    values (
      v_actor_id,
      v_inventory.series_id,
      v_selected.card_id,
      nullif(v_rarity ->> 'id', '')::uuid,
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
      'rarity_id', v_rarity ->> 'id',
      'rarity_code', v_rarity ->> 'code',
      'rarity_name', v_rarity ->> 'name'
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
