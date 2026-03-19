begin;

alter table public.containers
  add column if not exists is_reward_pack boolean;

update public.containers
set
  is_reward_pack = false,
  updated_at = now()
where is_reward_pack is null;

alter table public.containers
  alter column is_reward_pack set default false;

alter table public.containers
  alter column is_reward_pack set not null;

with reward_groups as (
  select
    c.pack_group_code,
    row_number() over (
      order by lower(coalesce(c.name, '')), lower(coalesce(c.code, '')), c.id
    ) as reward_seq
  from public.containers c
  where c.pack_group_code is not null
    and c.pack_variant = 'full'
    and upper(trim(coalesce(c.pack_number_code, ''))) = 'RWD'
)
update public.containers c
set
  is_reward_pack = true,
  pack_number_code = lpad(reward_groups.reward_seq::text, 3, '0'),
  updated_at = now()
from reward_groups
where c.pack_group_code = reward_groups.pack_group_code;

update public.containers
set
  pack_set_name = null,
  updated_at = now()
where pack_group_code is not null
  and pack_set_name is not null;

alter table public.containers
  drop constraint if exists containers_pack_number_code_check;

alter table public.containers
  add constraint containers_pack_number_code_check
  check (
    pack_number_code is null
    or trim(pack_number_code) ~ '^\\d{3}$'
  );

drop index if exists public.containers_full_pack_number_scope_uidx;

create unique index containers_full_pack_number_scope_uidx
  on public.containers (is_reward_pack, pack_number_code)
  where pack_group_code is not null
    and pack_variant = 'full'
    and pack_number_code is not null;

create or replace function public._normalize_pack_number_code(p_value text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_normalized text := trim(coalesce(p_value, ''));
begin
  if v_normalized = '' then
    raise exception 'Pack Number is required';
  end if;

  if v_normalized !~ '^\\d{3}$' then
    raise exception 'Pack Number must be exactly 3 digits from 001 to 999';
  end if;

  return v_normalized;
end;
$function$;

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
        case when full_container.is_reward_pack then 1 else 0 end,
        case
          when trim(coalesce(full_container.pack_number_code, '')) ~ '^\\d{3}$'
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
  perform public._assert_progression_admin();

  if trim(coalesce(p_pack_group_code, '')) = '' then
    raise exception 'Pack group code is required';
  end if;

  select *
  into v_full
  from public.containers
  where pack_group_code = trim(p_pack_group_code)
    and pack_variant = 'full'
  limit 1;

  if not found then
    raise exception 'Pack product not found';
  end if;

  select *
  into v_draft
  from public.containers
  where pack_group_code = trim(p_pack_group_code)
    and pack_variant = 'draft'
  limit 1;

  return jsonb_build_object(
    'pack_group_code', v_full.pack_group_code,
    'pack_number_code', nullif(trim(coalesce(v_full.pack_number_code, '')), ''),
    'is_reward_pack', v_full.is_reward_pack,
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
          'card_image_url', c.image_url,
          'pack_pool_tier_id', ppt.id,
          'pack_pool_tier_code', ppt.code,
          'pack_pool_tier_name', ppt.name,
          'rarity_id', cc.rarity_id,
          'rarity_code', r.code,
          'rarity_name', r.name,
          'weight', cc.weight,
          'is_enabled', coalesce(cc.is_enabled, true)
        )
        order by ppt.sort_order, lower(c.name), coalesce(r.sort_order, 9999), r.name
      )
      from public.container_cards cc
      join public.cards c on c.id = cc.card_id
      join public.pack_pool_tiers ppt on ppt.id = cc.pack_pool_tier_id
      left join public.card_rarities r on r.id = cc.rarity_id
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

drop function if exists public.upsert_pack_product_admin(text,text,text,text,text,text,text,text,boolean,boolean,jsonb,jsonb);

create or replace function public.upsert_pack_product_admin(
  p_pack_group_code text,
  p_name text,
  p_code text,
  p_pack_number_code text,
  p_is_reward_pack boolean,
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
  v_pack_number_code text := public._normalize_pack_number_code(p_pack_number_code);
  v_is_reward_pack boolean := coalesce(p_is_reward_pack, false);
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
      pack_set_name, pack_number_code, is_reward_pack
    )
    values (
      gen_random_uuid(), trim(p_name), p_description, 9, p_image_url,
      coalesce(p_is_enabled, true), coalesce(p_is_locked, false),
      public._normalize_container_content_mode(p_content_mode), null, null, 'pack_slots',
      v_base_code, v_full_type_id, p_image_url, 9, v_group_code, 'full',
      null, v_pack_number_code, v_is_reward_pack
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
      pack_set_name = null,
      pack_number_code = v_pack_number_code,
      is_reward_pack = v_is_reward_pack,
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
      pack_set_name, pack_number_code, is_reward_pack
    )
    values (
      gen_random_uuid(), trim(p_name) || ' Draft', p_description, 9, p_image_url,
      coalesce(p_is_enabled, true), coalesce(p_is_locked, false),
      public._normalize_container_content_mode(p_content_mode), null, null, 'pack_slots',
      v_base_code || '_DRAFT', v_draft_type_id, p_image_url, 9, v_group_code, 'draft',
      null, v_pack_number_code, v_is_reward_pack
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
      pack_set_name = null,
      pack_number_code = v_pack_number_code,
      is_reward_pack = v_is_reward_pack,
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

commit;
