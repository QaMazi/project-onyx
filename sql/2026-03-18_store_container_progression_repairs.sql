begin;

insert into storage.buckets (id, name, public)
values ('container-images', 'container-images', true)
on conflict (id) do update
set public = excluded.public;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'container_images_public_read'
  ) then
    create policy container_images_public_read
      on storage.objects
      for select
      to public
      using (bucket_id = 'container-images');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'container_images_admin_insert'
  ) then
    create policy container_images_admin_insert
      on storage.objects
      for insert
      to authenticated
      with check (
        bucket_id = 'container-images'
        and is_admin_plus()
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'container_images_admin_update'
  ) then
    create policy container_images_admin_update
      on storage.objects
      for update
      to authenticated
      using (
        bucket_id = 'container-images'
        and is_admin_plus()
      )
      with check (
        bucket_id = 'container-images'
        and is_admin_plus()
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'container_images_admin_delete'
  ) then
    create policy container_images_admin_delete
      on storage.objects
      for delete
      to authenticated
      using (
        bucket_id = 'container-images'
        and is_admin_plus()
      );
  end if;
end
$$;

alter table public.container_cards
  add column if not exists slot_index integer;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.container_cards'::regclass
      and conname = 'container_cards_container_id_card_id_key'
  ) then
    alter table public.container_cards
      drop constraint container_cards_container_id_card_id_key;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.container_cards'::regclass
      and conname = 'container_cards_slot_index_check'
  ) then
    alter table public.container_cards
      add constraint container_cards_slot_index_check
      check (slot_index is null or slot_index >= 1);
  end if;
end
$$;

create or replace function public._normalize_container_content_mode(p_content_mode text)
returns text
language plpgsql
immutable
as $function$
declare
  v_mode text;
begin
  v_mode := lower(trim(coalesce(p_content_mode, '')));

  if v_mode in ('official', 'filtered') then
    return 'official';
  end if;

  return 'curated';
end;
$function$;

update public.containers
set
  content_mode = public._normalize_container_content_mode(content_mode),
  cards_per_open = greatest(coalesce(card_count, cards_per_open, 1), 1),
  updated_at = now()
where content_mode is distinct from public._normalize_container_content_mode(content_mode)
   or cards_per_open is distinct from greatest(coalesce(card_count, cards_per_open, 1), 1);

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.containers'::regclass
      and conname = 'containers_content_mode_check'
  ) then
    alter table public.containers
      drop constraint containers_content_mode_check;
  end if;

  alter table public.containers
    add constraint containers_content_mode_check
    check (content_mode = any (array['curated'::text, 'official'::text]));
end
$$;

update public.item_definitions
set
  is_active = false,
  is_randomly_available = false,
  is_store_purchase_locked = true,
  updated_at = now()
where category_id in (
  select id
  from public.item_categories
  where lower(code) in ('feature_tokens', 'collection_notices')
);

delete from public.store_cart_items sci
using public.item_definitions i
where sci.item_definition_id = i.id
  and i.category_id in (
    select id
    from public.item_categories
    where lower(code) in ('feature_tokens', 'collection_notices')
  );

create or replace function public._resolve_common_rarity_id()
returns uuid
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_rarity_id uuid;
begin
  select r.id
  into v_rarity_id
  from public.card_rarities r
  where lower(coalesce(r.code, '')) in ('common', 'base')
  order by
    case
      when lower(coalesce(r.code, '')) = 'common' then 0
      when lower(coalesce(r.code, '')) = 'base' then 1
      else 2
    end,
    coalesce(r.sort_order, 9999),
    r.name
  limit 1;

  if v_rarity_id is null then
    select r.id
    into v_rarity_id
    from public.card_rarities r
    where lower(coalesce(r.name, '')) in ('common', 'base')
    order by
      case
        when lower(coalesce(r.name, '')) = 'common' then 0
        when lower(coalesce(r.name, '')) = 'base' then 1
        else 2
      end,
      coalesce(r.sort_order, 9999),
      r.name
    limit 1;
  end if;

  if v_rarity_id is null then
    select r.id
    into v_rarity_id
    from public.card_rarities r
    order by coalesce(r.sort_order, 9999), r.name
    limit 1;
  end if;

  if v_rarity_id is null then
    raise exception 'No rarity rows exist in card_rarities';
  end if;

  return v_rarity_id;
end;
$function$;

create or replace function public.claim_random_starter_deck(p_series_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_user_id uuid;
  v_can_bypass boolean;
  v_common_rarity_id uuid;
  v_series_deck record;
  v_player_deck_id uuid;
begin
  v_user_id := public._assert_authenticated_user();
  v_can_bypass := public._progression_can_bypass(v_user_id);

  if not v_can_bypass then
    perform public._assert_series_member_for_claim(p_series_id, v_user_id);
  end if;

  if exists (
    select 1
    from public.player_starter_deck_claims c
    where c.series_id = p_series_id
      and c.user_id = v_user_id
  ) then
    raise exception 'You already claimed a starter deck for this series';
  end if;

  select
    ssd.id,
    ssd.series_id,
    ssd.starter_deck_template_id,
    ssd.slot_number,
    sdt.name as template_name
  into v_series_deck
  from public.series_starter_decks ssd
  join public.starter_deck_templates sdt
    on sdt.id = ssd.starter_deck_template_id
  where ssd.series_id = p_series_id
    and ssd.claimed_by_user_id is null
  order by random()
  limit 1
  for update skip locked;

  if not found then
    raise exception 'No starter decks remain in the pool';
  end if;

  v_common_rarity_id := public._resolve_common_rarity_id();

  update public.player_decks
  set
    is_active = false,
    updated_at = now()
  where user_id = v_user_id
    and series_id = p_series_id;

  insert into public.player_decks (
    user_id,
    series_id,
    deck_name,
    is_active,
    is_valid,
    validation_summary
  )
  values (
    v_user_id,
    p_series_id,
    v_series_deck.template_name,
    true,
    true,
    'Starter deck claim'
  )
  returning id into v_player_deck_id;

  insert into public.player_deck_cards (
    deck_id,
    card_id,
    section,
    quantity
  )
  select
    v_player_deck_id,
    stdc.card_id,
    stdc.section,
    stdc.quantity
  from public.starter_deck_template_cards stdc
  where stdc.starter_deck_template_id = v_series_deck.starter_deck_template_id;

  insert into public.binder_cards (
    user_id,
    series_id,
    card_id,
    rarity_id,
    quantity,
    is_trade_locked
  )
  select
    v_user_id,
    p_series_id,
    stdc.card_id,
    v_common_rarity_id,
    stdc.quantity,
    false
  from public.starter_deck_template_cards stdc
  where stdc.starter_deck_template_id = v_series_deck.starter_deck_template_id
  on conflict (user_id, series_id, card_id, rarity_id)
  do update set
    quantity = public.binder_cards.quantity + excluded.quantity,
    updated_at = now();

  insert into public.player_wallets (
    user_id,
    series_id,
    shards,
    locked_shards
  )
  values (
    v_user_id,
    p_series_id,
    500,
    0
  )
  on conflict (user_id, series_id)
  do update set
    shards = public.player_wallets.shards + 500,
    updated_at = now();

  update public.series_starter_decks
  set
    claimed_by_user_id = v_user_id,
    claimed_at = now(),
    updated_at = now()
  where id = v_series_deck.id;

  insert into public.player_starter_deck_claims (
    series_id,
    user_id,
    series_starter_deck_id,
    starter_deck_template_id,
    created_player_deck_id
  )
  values (
    p_series_id,
    v_user_id,
    v_series_deck.id,
    v_series_deck.starter_deck_template_id,
    v_player_deck_id
  );

  return jsonb_build_object(
    'success', true,
    'series_starter_deck_id', v_series_deck.id,
    'starter_deck_template_id', v_series_deck.starter_deck_template_id,
    'starter_deck_name', v_series_deck.template_name,
    'player_deck_id', v_player_deck_id,
    'shards_awarded', 500
  );
end;
$function$;

create or replace function public.begin_series_for_player(p_series_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_series record;
  v_can_bypass boolean;
  v_claim jsonb := '{}'::jsonb;
  v_auto_progress jsonb := '{}'::jsonb;
begin
  v_actor_id := public._assert_authenticated_user();
  v_can_bypass := public._progression_can_bypass(v_actor_id);

  select *
  into v_series
  from public.game_series gs
  where gs.id = p_series_id
  for update;

  if not found then
    raise exception 'Series not found';
  end if;

  if v_series.current_phase <> 'standby'
    or coalesce(v_series.round_number, 0) <> 0 then
    raise exception 'Begin Series is only available during Round 0 Standby Phase';
  end if;

  if not v_can_bypass then
    perform public._assert_series_member_for_claim(p_series_id, v_actor_id);
  end if;

  if exists (
    select 1
    from public.player_starter_deck_claims c
    where c.series_id = p_series_id
      and c.user_id = v_actor_id
  ) then
    v_claim := jsonb_build_object(
      'success', true,
      'already_claimed', true
    );
  else
    v_claim := public.claim_random_starter_deck(p_series_id);
  end if;

  insert into public.series_phase_ready_states (
    series_id,
    round_number,
    round_step,
    phase,
    user_id,
    ready_reason,
    ready_at,
    updated_at
  )
  values (
    p_series_id,
    0,
    0,
    'standby',
    v_actor_id,
    'begin_series',
    now(),
    now()
  )
  on conflict (series_id, round_number, round_step, phase, user_id)
  do update set
    ready_reason = excluded.ready_reason,
    ready_at = now(),
    updated_at = now();

  v_auto_progress := public._auto_progress_series_after_player_ready(p_series_id);

  return v_claim || jsonb_build_object(
    'ready', true,
    'phase', coalesce(v_auto_progress ->> 'current_phase', 'standby'),
    'round_number', coalesce((v_auto_progress ->> 'round_number')::integer, 0),
    'round_step',
      case
        when coalesce((v_auto_progress ->> 'round_number')::integer, 0) = 0
          and coalesce(v_auto_progress ->> 'current_phase', 'standby') = 'standby'
          then null
        else (v_auto_progress ->> 'round_step')::integer
      end,
    'auto_advanced', coalesce((v_auto_progress ->> 'auto_advanced')::boolean, false)
  );
end;
$function$;

create or replace function public.store_checkout(p_user uuid, p_series uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_cart_id uuid;
  v_total_cost integer := 0;
  v_wallet record;
  v_purchase_id uuid;
  v_invalid_item_count integer := 0;
  v_cart_item_count integer := 0;
  r record;
begin
  v_actor_id := public._assert_authenticated_user();

  if v_actor_id <> p_user then
    raise exception 'You can only checkout your own cart';
  end if;

  select *
  into v_wallet
  from public.player_wallets
  where user_id = p_user
    and series_id = p_series
  for update;

  if not found then
    raise exception 'Wallet not initialized';
  end if;

  select id
  into v_cart_id
  from public.store_carts
  where user_id = p_user
    and series_id = p_series;

  if v_cart_id is null then
    raise exception 'No active cart';
  end if;

  select count(*)
  into v_invalid_item_count
  from public.store_cart_items ci
  join public.item_definitions i
    on i.id = ci.item_definition_id
  where ci.cart_id = v_cart_id
    and (
      coalesce(i.is_active, false) = false
      or coalesce(i.is_randomly_available, true) = false
      or coalesce(i.is_store_purchase_locked, false) = true
      or (
        coalesce(i.max_purchase, 0) > 0
        and ci.quantity > i.max_purchase
      )
    );

  if v_invalid_item_count > 0 then
    raise exception 'One or more cart items are no longer available';
  end if;

  select count(*)
  into v_cart_item_count
  from public.store_cart_items ci
  join public.item_definitions i
    on i.id = ci.item_definition_id
  where ci.cart_id = v_cart_id
    and i.is_active = true
    and coalesce(i.is_randomly_available, true) = true
    and coalesce(i.is_store_purchase_locked, false) = false;

  if v_cart_item_count = 0 then
    raise exception 'Cart is empty';
  end if;

  select coalesce(sum(ci.quantity * i.store_price), 0)
  into v_total_cost
  from public.store_cart_items ci
  join public.item_definitions i
    on i.id = ci.item_definition_id
  where ci.cart_id = v_cart_id
    and i.is_active = true
    and coalesce(i.is_randomly_available, true) = true
    and coalesce(i.is_store_purchase_locked, false) = false;

  if v_wallet.shards < v_total_cost then
    raise exception 'Not enough shards';
  end if;

  update public.player_wallets
  set
    shards = shards - v_total_cost,
    updated_at = now()
  where user_id = p_user
    and series_id = p_series;

  insert into public.store_purchases (user_id, series_id, total_cost)
  values (p_user, p_series, v_total_cost)
  returning id into v_purchase_id;

  for r in
    select ci.item_definition_id, ci.quantity, i.store_price
    from public.store_cart_items ci
    join public.item_definitions i
      on i.id = ci.item_definition_id
    where ci.cart_id = v_cart_id
      and i.is_active = true
      and coalesce(i.is_randomly_available, true) = true
      and coalesce(i.is_store_purchase_locked, false) = false
  loop
    insert into public.store_purchase_items (
      purchase_id,
      item_definition_id,
      quantity,
      unit_price
    )
    values (
      v_purchase_id,
      r.item_definition_id,
      r.quantity,
      r.store_price
    );

    insert into public.player_inventory (
      user_id,
      series_id,
      item_definition_id,
      quantity,
      locked_quantity
    )
    values (
      p_user,
      p_series,
      r.item_definition_id,
      r.quantity,
      0
    )
    on conflict (user_id, series_id, item_definition_id)
    do update set
      quantity = public.player_inventory.quantity + excluded.quantity,
      updated_at = now();
  end loop;

  delete from public.store_cart_items
  where cart_id = v_cart_id;
end;
$function$;

create or replace function public.create_container_admin(
  p_name text,
  p_code text,
  p_description text,
  p_container_type_id uuid,
  p_image_url text default null,
  p_card_count integer default 5,
  p_content_mode text default 'curated',
  p_selection_count integer default null,
  p_draft_pick_count integer default null,
  p_rarity_mode text default 'normal',
  p_is_enabled boolean default true,
  p_is_locked boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_container_id uuid;
  v_cards_per_open integer := greatest(coalesce(p_card_count, 5), 1);
begin
  perform public._assert_admin_plus();

  if coalesce(trim(p_name), '') = '' then
    raise exception 'Container name is required';
  end if;

  if coalesce(trim(p_code), '') = '' then
    raise exception 'Container code is required';
  end if;

  if p_container_type_id is null then
    raise exception 'Container type is required';
  end if;

  insert into public.containers (
    name,
    code,
    description,
    container_type_id,
    image_url,
    card_count,
    cards_per_open,
    content_mode,
    selection_count,
    draft_pick_count,
    rarity_mode,
    is_enabled,
    is_locked
  )
  values (
    trim(p_name),
    trim(p_code),
    coalesce(p_description, ''),
    p_container_type_id,
    p_image_url,
    v_cards_per_open,
    v_cards_per_open,
    public._normalize_container_content_mode(p_content_mode),
    p_selection_count,
    p_draft_pick_count,
    coalesce(p_rarity_mode, 'normal'),
    coalesce(p_is_enabled, true),
    coalesce(p_is_locked, false)
  )
  returning id into v_container_id;

  perform public._sync_container_opener_item(v_container_id);

  return jsonb_build_object(
    'success', true,
    'container_id', v_container_id
  );
end;
$function$;

create or replace function public.update_container_admin(
  p_container_id uuid,
  p_name text,
  p_code text,
  p_description text,
  p_container_type_id uuid,
  p_image_url text default null,
  p_card_count integer default 5,
  p_content_mode text default 'curated',
  p_selection_count integer default null,
  p_draft_pick_count integer default null,
  p_rarity_mode text default 'normal',
  p_is_enabled boolean default true,
  p_is_locked boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_cards_per_open integer := greatest(coalesce(p_card_count, 5), 1);
begin
  perform public._assert_admin_plus();

  update public.containers
  set
    name = trim(p_name),
    code = trim(p_code),
    description = coalesce(p_description, ''),
    container_type_id = p_container_type_id,
    image_url = p_image_url,
    card_count = v_cards_per_open,
    cards_per_open = v_cards_per_open,
    content_mode = public._normalize_container_content_mode(p_content_mode),
    selection_count = p_selection_count,
    draft_pick_count = p_draft_pick_count,
    rarity_mode = coalesce(p_rarity_mode, 'normal'),
    is_enabled = coalesce(p_is_enabled, true),
    is_locked = coalesce(p_is_locked, false),
    updated_at = now()
  where id = p_container_id;

  if not found then
    raise exception 'Container not found';
  end if;

  perform public._sync_container_opener_item(p_container_id);

  return jsonb_build_object(
    'success', true,
    'container_id', p_container_id
  );
end;
$function$;

create or replace function public.save_container_cards_admin(
  p_container_id uuid,
  p_cards jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  perform public._assert_admin_plus();

  if p_container_id is null then
    raise exception 'Container is required';
  end if;

  delete from public.container_cards
  where container_id = p_container_id;

  insert into public.container_cards (
    container_id,
    card_id,
    tier_id,
    is_enabled,
    rarity_id,
    weight,
    slot_index
  )
  select
    p_container_id,
    x.card_id,
    x.tier_id,
    coalesce(x.is_enabled, true),
    x.rarity_id,
    greatest(coalesce(x.weight, 1), 1),
    case
      when x.slot_index is null or x.slot_index <= 0 then null
      else x.slot_index
    end
  from jsonb_to_recordset(coalesce(p_cards, '[]'::jsonb))
    as x(
      card_id bigint,
      tier_id uuid,
      is_enabled boolean,
      rarity_id uuid,
      weight numeric,
      slot_index integer
    )
  where x.card_id is not null
    and x.tier_id is not null;

  update public.containers
  set updated_at = now()
  where id = p_container_id;

  return jsonb_build_object(
    'success', true,
    'container_id', p_container_id
  );
end;
$function$;

create or replace function public.delete_container_admin(p_container_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_target_item_ids uuid[];
begin
  perform public._assert_admin_plus();

  if p_container_id is null then
    raise exception 'Container is required';
  end if;

  select array_agg(i.id)
  into v_target_item_ids
  from public.item_definitions i
  where i.target_kind = 'container'
    and i.target_id = p_container_id;

  if exists (
    select 1
    from public.player_inventory pi
    where pi.item_definition_id = any(coalesce(v_target_item_ids, array[]::uuid[]))
      and pi.quantity > 0
  ) then
    raise exception 'This container still has owned opener items in player inventories';
  end if;

  delete from public.store_cart_items sci
  where sci.item_definition_id = any(coalesce(v_target_item_ids, array[]::uuid[]));

  update public.item_definitions i
  set
    is_active = false,
    is_randomly_available = false,
    is_store_purchase_locked = true,
    target_id = null,
    updated_at = now()
  where i.id = any(coalesce(v_target_item_ids, array[]::uuid[]));

  delete from public.feature_box_filters
  where container_id = p_container_id;

  delete from public.containers
  where id = p_container_id;

  if not found then
    raise exception 'Container not found';
  end if;

  return jsonb_build_object(
    'success', true,
    'container_id', p_container_id
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
  v_base_rarity record;
  v_selected record;
  v_pulls jsonb := '[]'::jsonb;
  v_slot_index integer;
  v_has_slotted_rows boolean := false;
begin
  v_actor_id := public._assert_authenticated_user();

  select
    pi.id,
    pi.user_id,
    pi.series_id,
    pi.quantity,
    pi.locked_quantity,
    i.id as item_definition_id,
    i.name as item_name,
    i.behavior_code,
    i.target_kind,
    i.target_id
  into v_inventory
  from public.player_inventory pi
  join public.item_definitions i
    on i.id = pi.item_definition_id
  where pi.id = p_inventory_id
  for update;

  if not found then
    raise exception 'Inventory item not found';
  end if;

  if v_inventory.user_id <> v_actor_id then
    raise exception 'You do not own this opener';
  end if;

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
    c.id,
    c.name,
    c.description,
    c.code,
    c.card_count,
    c.cards_per_open,
    ct.code as container_type_code
  into v_container
  from public.containers c
  join public.container_types ct
    on ct.id = c.container_type_id
  where c.id = v_inventory.target_id
    and coalesce(c.is_enabled, true) = true;

  if not found then
    raise exception 'Container not found or is disabled';
  end if;

  select
    r.id,
    r.code,
    r.name
  into v_base_rarity
  from public.card_rarities r
  where r.id = public._resolve_common_rarity_id();

  v_cards_per_open := greatest(
    coalesce(v_container.cards_per_open, v_container.card_count, 1),
    1
  );

  select exists (
    select 1
    from public.container_cards cc
    where cc.container_id = v_container.id
      and coalesce(cc.is_enabled, true) = true
      and cc.slot_index is not null
  )
  into v_has_slotted_rows;

  if lower(coalesce(v_container.container_type_code, '')) in ('full_pack', 'draft_pack') then
    for v_slot_index in 1..v_cards_per_open loop
      select
        cc.card_id,
        c.name as card_name,
        c.image_url,
        cc.tier_id,
        coalesce(t.code, 'tier') as tier_code,
        coalesce(t.name, 'Unknown Tier') as tier_name,
        coalesce(cc.rarity_id, v_base_rarity.id) as rarity_id,
        coalesce(r.code, v_base_rarity.code) as rarity_code,
        coalesce(r.name, v_base_rarity.name) as rarity_name,
        cc.slot_index,
        greatest(coalesce(cc.weight, 1), 1)::numeric as weight
      into v_selected
      from public.container_cards cc
      join public.cards c
        on c.id = cc.card_id
      left join public.card_tiers t
        on t.id = cc.tier_id
      left join public.card_rarities r
        on r.id = cc.rarity_id
      where cc.container_id = v_container.id
        and coalesce(cc.is_enabled, true) = true
        and (
          not v_has_slotted_rows
          or cc.slot_index = v_slot_index
          or (
            cc.slot_index is null
            and not exists (
              select 1
              from public.container_cards slot_rows
              where slot_rows.container_id = v_container.id
                and coalesce(slot_rows.is_enabled, true) = true
                and slot_rows.slot_index = v_slot_index
            )
          )
        )
      order by
        -ln(greatest(random(), 0.000001)) /
          greatest(coalesce(cc.weight, 1)::double precision, 0.000001)
      limit 1;

      if v_selected.card_id is null then
        raise exception 'Pack slot % has no eligible cards configured', v_slot_index;
      end if;

      insert into public.binder_cards (
        user_id,
        series_id,
        card_id,
        rarity_id,
        quantity,
        is_trade_locked
      )
      values (
        v_actor_id,
        v_inventory.series_id,
        v_selected.card_id,
        v_selected.rarity_id,
        1,
        false
      )
      on conflict (user_id, series_id, card_id, rarity_id)
      do update set
        quantity = public.binder_cards.quantity + 1,
        updated_at = now();

      v_pulls := v_pulls || jsonb_build_array(
        jsonb_build_object(
          'card_id', v_selected.card_id,
          'card_name', v_selected.card_name,
          'image_url', v_selected.image_url,
          'tier_id', v_selected.tier_id,
          'tier_code', v_selected.tier_code,
          'tier_name', v_selected.tier_name,
          'rarity_id', v_selected.rarity_id,
          'rarity_code', v_selected.rarity_code,
          'rarity_name', v_selected.rarity_name,
          'slot_index', coalesce(v_selected.slot_index, v_slot_index)
        )
      );
    end loop;
  else
    select
      cc.card_id,
      c.name as card_name,
      c.image_url,
      cc.tier_id,
      coalesce(t.code, 'tier') as tier_code,
      coalesce(t.name, 'Unknown Tier') as tier_name,
      coalesce(cc.rarity_id, v_base_rarity.id) as rarity_id,
      coalesce(r.code, v_base_rarity.code) as rarity_code,
      coalesce(r.name, v_base_rarity.name) as rarity_name
    into v_selected
    from public.container_cards cc
    join public.cards c
      on c.id = cc.card_id
    left join public.card_tiers t
      on t.id = cc.tier_id
    left join public.card_rarities r
      on r.id = cc.rarity_id
    where cc.container_id = v_container.id
      and coalesce(cc.is_enabled, true) = true
    order by
      -ln(greatest(random(), 0.000001)) /
        greatest(coalesce(cc.weight, 1)::double precision, 0.000001)
    limit 1;

    if v_selected.card_id is null then
      raise exception 'This container has no eligible cards configured';
    end if;

    insert into public.binder_cards (
      user_id,
      series_id,
      card_id,
      rarity_id,
      quantity,
      is_trade_locked
    )
    values (
      v_actor_id,
      v_inventory.series_id,
      v_selected.card_id,
      v_selected.rarity_id,
      1,
      false
    )
    on conflict (user_id, series_id, card_id, rarity_id)
    do update set
      quantity = public.binder_cards.quantity + 1,
      updated_at = now();

    v_pulls := jsonb_build_array(
      jsonb_build_object(
        'card_id', v_selected.card_id,
        'card_name', v_selected.card_name,
        'image_url', v_selected.image_url,
        'tier_id', v_selected.tier_id,
        'tier_code', v_selected.tier_code,
        'tier_name', v_selected.tier_name,
        'rarity_id', v_selected.rarity_id,
        'rarity_code', v_selected.rarity_code,
        'rarity_name', v_selected.rarity_name
      )
    );
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
