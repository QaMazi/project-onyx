begin;

alter table public.player_wallets
  add column if not exists feature_coins integer not null default 0;

alter table public.item_definitions
  add column if not exists is_store_purchase_locked boolean not null default false,
  add column if not exists is_reward_rng_locked boolean not null default false,
  add column if not exists is_randomly_available boolean not null default true;

alter table public.series_round_reward_configs
  add column if not exists shared_feature_coin_min integer not null default 0,
  add column if not exists shared_feature_coin_max integer not null default 0;

alter table public.series_round_reward_config_placements
  add column if not exists extra_feature_coin_min integer not null default 0,
  add column if not exists extra_feature_coin_max integer not null default 0;

create table if not exists public.series_currency_exchange_settings (
  series_id uuid primary key
    references public.game_series (id)
    on delete cascade,
  shards_per_feature_coin numeric(10, 2) not null default 10,
  feature_coin_to_shards_rate numeric(10, 2) not null default 10,
  fee_percent numeric(5, 2) not null default 10,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

insert into public.series_currency_exchange_settings (
  series_id,
  shards_per_feature_coin,
  feature_coin_to_shards_rate,
  fee_percent
)
select
  gs.id,
  10,
  10,
  10
from public.game_series gs
on conflict (series_id) do nothing;

create table if not exists public.player_feature_slot_usage (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null
    references public.game_series (id)
    on delete cascade,
  user_id uuid not null
    references auth.users (id)
    on delete cascade,
  feature_slot_id uuid not null
    references public.feature_slots (id)
    on delete cascade,
  spin_count integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  last_played_at timestamp with time zone
);

create unique index if not exists player_feature_slot_usage_series_user_slot_key
  on public.player_feature_slot_usage (series_id, user_id, feature_slot_id);

create table if not exists public.player_series_unlocks (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null
    references public.game_series (id)
    on delete cascade,
  user_id uuid not null
    references auth.users (id)
    on delete cascade,
  extra_saved_deck_slots integer not null default 0,
  card_vault_slots integer not null default 0,
  card_vault_unlocked boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index if not exists player_series_unlocks_series_user_key
  on public.player_series_unlocks (series_id, user_id);

create table if not exists public.player_series_protections (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null
    references public.game_series (id)
    on delete cascade,
  user_id uuid not null
    references auth.users (id)
    on delete cascade,
  rounds_remaining integer not null default 0,
  source_summary jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index if not exists player_series_protections_series_user_key
  on public.player_series_protections (series_id, user_id);

create or replace view public.player_inventory_view as
select
  pi.id,
  pi.user_id,
  pi.series_id,
  pi.item_definition_id,
  pi.quantity,
  pi.locked_quantity,
  pi.quantity - pi.locked_quantity as available_quantity,
  i.code as item_code,
  i.name as item_name,
  i.description,
  i.image_url,
  i.behavior_code,
  i.store_price,
  i.target_kind,
  i.target_id,
  i.exact_item_family,
  c.id as category_id,
  c.code as category_code,
  c.name as category_name,
  coalesce(i.is_store_purchase_locked, false) as is_store_purchase_locked,
  coalesce(i.is_reward_rng_locked, false) as is_reward_rng_locked,
  coalesce(i.is_randomly_available, true) as is_randomly_available
from public.player_inventory pi
join public.item_definitions i
  on i.id = pi.item_definition_id
join public.item_categories c
  on c.id = i.category_id;

create or replace view public.store_catalog as
select
  i.id,
  i.category_id,
  c.code as category_code,
  c.name as category_name,
  i.code,
  i.name,
  i.description,
  i.image_url,
  i.behavior_code,
  i.store_order,
  i.max_purchase,
  i.store_price,
  i.target_kind,
  i.target_id,
  i.exact_item_family,
  i.is_active,
  coalesce(i.is_store_purchase_locked, false) as is_store_purchase_locked,
  coalesce(i.is_reward_rng_locked, false) as is_reward_rng_locked,
  coalesce(i.is_randomly_available, true) as is_randomly_available
from public.item_definitions i
join public.item_categories c
  on c.id = i.category_id
where i.is_active = true
  and coalesce(i.is_randomly_available, true) = true
order by c.name, i.store_order, i.name;

create or replace function public._grant_series_feature_coins(
  p_series_id uuid,
  p_target_user_id uuid,
  p_feature_coin_amount integer,
  p_granted_by_user_id uuid,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  if coalesce(p_feature_coin_amount, 0) <= 0 then
    return;
  end if;

  insert into public.player_wallets (
    user_id,
    series_id,
    shards,
    locked_shards,
    feature_coins
  )
  values (
    p_target_user_id,
    p_series_id,
    0,
    0,
    p_feature_coin_amount
  )
  on conflict (user_id, series_id)
  do update set
    feature_coins = public.player_wallets.feature_coins + excluded.feature_coins,
    updated_at = now();

  insert into public.player_reward_grants (
    series_id,
    granted_to_user_id,
    granted_by_user_id,
    reward_type,
    quantity,
    notes
  )
  values (
    p_series_id,
    p_target_user_id,
    p_granted_by_user_id,
    'feature_coins',
    p_feature_coin_amount,
    p_notes
  );
end;
$function$;

create or replace function public.give_series_player_feature_coins(
  p_series_id uuid,
  p_target_user_id uuid,
  p_feature_coins integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  perform public._assert_admin_plus();

  if p_series_id is null then
    raise exception 'Series is required';
  end if;

  if p_target_user_id is null then
    raise exception 'Target user is required';
  end if;

  if p_feature_coins is null or p_feature_coins <= 0 then
    raise exception 'Feature Coins must be greater than 0';
  end if;

  if not exists (
    select 1
    from public.series_players sp
    where sp.series_id = p_series_id
      and sp.user_id = p_target_user_id
  ) then
    raise exception 'Target user is not in this series';
  end if;

  perform public._grant_series_feature_coins(
    p_series_id,
    p_target_user_id,
    p_feature_coins,
    auth.uid(),
    'admin_reward_giver:feature_coins'
  );

  return jsonb_build_object(
    'success', true,
    'series_id', p_series_id,
    'target_user_id', p_target_user_id,
    'feature_coins_given', p_feature_coins
  );
end;
$function$;

create or replace function public.get_series_currency_exchange_config(p_series_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_settings record;
begin
  v_actor_id := public._assert_authenticated_user();
  perform public._assert_series_member(p_series_id, v_actor_id);

  insert into public.series_currency_exchange_settings (
    series_id
  )
  values (p_series_id)
  on conflict (series_id) do nothing;

  select *
  into v_settings
  from public.series_currency_exchange_settings s
  where s.series_id = p_series_id;

  return jsonb_build_object(
    'series_id', p_series_id,
    'shards_per_feature_coin', v_settings.shards_per_feature_coin,
    'feature_coin_to_shards_rate', v_settings.feature_coin_to_shards_rate,
    'fee_percent', v_settings.fee_percent
  );
end;
$function$;

create or replace function public.upsert_series_currency_exchange_config(
  p_series_id uuid,
  p_shards_per_feature_coin numeric,
  p_feature_coin_to_shards_rate numeric,
  p_fee_percent numeric
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_settings record;
begin
  perform public._assert_authenticated_user();
  perform public._assert_series_admin_or_admin_plus(p_series_id);

  if coalesce(p_shards_per_feature_coin, 0) <= 0 then
    raise exception 'Shards to Feature Coin rate must be greater than 0';
  end if;

  if coalesce(p_feature_coin_to_shards_rate, 0) <= 0 then
    raise exception 'Feature Coin to Shards rate must be greater than 0';
  end if;

  if p_fee_percent is null or p_fee_percent < 0 or p_fee_percent >= 100 then
    raise exception 'Fee percent must be between 0 and 99.99';
  end if;

  insert into public.series_currency_exchange_settings (
    series_id,
    shards_per_feature_coin,
    feature_coin_to_shards_rate,
    fee_percent,
    updated_at
  )
  values (
    p_series_id,
    p_shards_per_feature_coin,
    p_feature_coin_to_shards_rate,
    p_fee_percent,
    now()
  )
  on conflict (series_id)
  do update set
    shards_per_feature_coin = excluded.shards_per_feature_coin,
    feature_coin_to_shards_rate = excluded.feature_coin_to_shards_rate,
    fee_percent = excluded.fee_percent,
    updated_at = now()
  returning *
  into v_settings;

  return jsonb_build_object(
    'success', true,
    'series_id', p_series_id,
    'shards_per_feature_coin', v_settings.shards_per_feature_coin,
    'feature_coin_to_shards_rate', v_settings.feature_coin_to_shards_rate,
    'fee_percent', v_settings.fee_percent
  );
end;
$function$;

create or replace function public.exchange_series_wallet_currency(
  p_series_id uuid,
  p_from_currency text,
  p_amount integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_wallet record;
  v_settings record;
  v_direction text;
  v_gross_output integer := 0;
  v_fee integer := 0;
  v_net_output integer := 0;
begin
  v_actor_id := public._assert_authenticated_user();
  perform public._assert_series_member(p_series_id, v_actor_id);

  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Exchange amount must be greater than 0';
  end if;

  insert into public.series_currency_exchange_settings (series_id)
  values (p_series_id)
  on conflict (series_id) do nothing;

  select *
  into v_settings
  from public.series_currency_exchange_settings s
  where s.series_id = p_series_id
  for update;

  select *
  into v_wallet
  from public.player_wallets w
  where w.user_id = v_actor_id
    and w.series_id = p_series_id
  for update;

  if not found then
    raise exception 'Wallet not found';
  end if;

  v_direction := lower(trim(coalesce(p_from_currency, '')));

  if v_direction = 'shards' then
    if v_wallet.shards < p_amount then
      raise exception 'Not enough shards';
    end if;

    v_gross_output := floor(p_amount::numeric / v_settings.shards_per_feature_coin)::integer;
    if v_gross_output <= 0 then
      raise exception 'Amount is too small for the current shard to coin rate';
    end if;

    v_fee := floor(v_gross_output::numeric * (v_settings.fee_percent / 100.0))::integer;
    v_net_output := greatest(v_gross_output - v_fee, 0);

    if v_net_output <= 0 then
      raise exception 'Exchange fee consumed the entire payout';
    end if;

    update public.player_wallets
    set
      shards = shards - p_amount,
      feature_coins = feature_coins + v_net_output,
      updated_at = now()
    where user_id = v_actor_id
      and series_id = p_series_id;
  elsif v_direction = 'feature_coins' then
    if v_wallet.feature_coins < p_amount then
      raise exception 'Not enough Feature Coins';
    end if;

    v_gross_output := floor(p_amount::numeric * v_settings.feature_coin_to_shards_rate)::integer;
    if v_gross_output <= 0 then
      raise exception 'Amount is too small for the current coin to shard rate';
    end if;

    v_fee := floor(v_gross_output::numeric * (v_settings.fee_percent / 100.0))::integer;
    v_net_output := greatest(v_gross_output - v_fee, 0);

    if v_net_output <= 0 then
      raise exception 'Exchange fee consumed the entire payout';
    end if;

    update public.player_wallets
    set
      feature_coins = feature_coins - p_amount,
      shards = shards + v_net_output,
      updated_at = now()
    where user_id = v_actor_id
      and series_id = p_series_id;
  else
    raise exception 'Exchange source must be shards or feature_coins';
  end if;

  return jsonb_build_object(
    'success', true,
    'from_currency', v_direction,
    'amount_in', p_amount,
    'gross_output', v_gross_output,
    'fee_amount', v_fee,
    'net_output', v_net_output
  );
end;
$function$;

create or replace function public._assert_series_item_use_allowed(
  p_series_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_series record;
begin
  select
    gs.current_phase,
    gs.round_number,
    public._progression_round_step_value(gs.round_step) as round_step
  into v_series
  from public.game_series gs
  where gs.id = p_series_id;

  if not found then
    raise exception 'Series not found';
  end if;

  if v_series.current_phase = 'reward' then
    raise exception 'Items cannot be used during Reward Phase';
  end if;

  if v_series.current_phase = 'dueling' then
    raise exception 'Items cannot be used during Dueling Phase';
  end if;

  if exists (
    select 1
    from public.series_phase_ready_states rs
    where rs.series_id = p_series_id
      and rs.round_number = v_series.round_number
      and rs.round_step = v_series.round_step
      and rs.phase = v_series.current_phase
      and rs.user_id = p_user_id
  ) then
    raise exception 'You already readied up for this phase';
  end if;
end;
$function$;

create or replace function public._decrement_series_protections(p_series_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  update public.player_series_protections
  set
    rounds_remaining = greatest(rounds_remaining - 1, 0),
    updated_at = now()
  where series_id = p_series_id
    and rounds_remaining > 0;

  delete from public.player_series_protections
  where series_id = p_series_id
    and rounds_remaining <= 0;
end;
$function$;

create or replace function public.get_inventory_item_use_preview(p_inventory_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_item record;
  v_unlocks record;
  v_protection record;
  v_action_kind text := 'unsupported';
  v_effect_key text := '';
  v_block_reason text := null;
begin
  v_actor_id := public._assert_authenticated_user();

  select
    pi.id,
    pi.user_id,
    pi.series_id,
    pi.quantity,
    pi.locked_quantity,
    i.id as item_definition_id,
    i.code,
    i.name,
    i.behavior_code,
    i.target_kind,
    i.target_id,
    i.exact_item_family
  into v_item
  from public.player_inventory pi
  join public.item_definitions i
    on i.id = pi.item_definition_id
  where pi.id = p_inventory_id
  for update;

  if not found then
    raise exception 'Inventory item not found';
  end if;

  if v_item.user_id <> v_actor_id then
    raise exception 'You do not own this inventory item';
  end if;

  perform public._assert_series_member(v_item.series_id, v_actor_id);

  begin
    perform public._assert_series_item_use_allowed(v_item.series_id, v_actor_id);
  exception
    when others then
      v_block_reason := sqlerrm;
  end;

  select *
  into v_unlocks
  from public.player_series_unlocks u
  where u.series_id = v_item.series_id
    and u.user_id = v_actor_id;

  select *
  into v_protection
  from public.player_series_protections p
  where p.series_id = v_item.series_id
    and p.user_id = v_actor_id;

  if v_item.behavior_code = 'open_container' and v_item.target_kind = 'container' then
    v_action_kind := 'open_in_opener';
    v_effect_key := 'open_container';
  elsif lower(coalesce(v_item.code, '')) = 'deck_case'
    or lower(coalesce(v_item.behavior_code, '')) = 'grant_saved_deck_slot' then
    v_action_kind := 'self_confirm';
    v_effect_key := 'deck_case';
  elsif lower(coalesce(v_item.code, '')) = 'card_vault'
    or lower(coalesce(v_item.behavior_code, '')) = 'grant_card_vault_slots' then
    v_action_kind := 'self_confirm';
    v_effect_key := 'card_vault';
  elsif lower(coalesce(v_item.code, '')) in ('warded_sigil_i', 'warded_sigil_ii', 'chaos_sigil')
    or lower(coalesce(v_item.behavior_code, '')) in (
      'grant_protection_1',
      'grant_protection_2',
      'grant_protection_random_1_5'
    ) then
    v_action_kind := 'self_confirm';
    v_effect_key := 'protection';
  end if;

  return jsonb_build_object(
    'inventory_id', v_item.id,
    'series_id', v_item.series_id,
    'item_definition_id', v_item.item_definition_id,
    'item_code', v_item.code,
    'item_name', v_item.name,
    'behavior_code', v_item.behavior_code,
    'available_quantity', greatest(v_item.quantity - v_item.locked_quantity, 0),
    'action_kind', v_action_kind,
    'effect_key', v_effect_key,
    'can_use', v_block_reason is null and greatest(v_item.quantity - v_item.locked_quantity, 0) > 0,
    'block_reason', v_block_reason,
    'extra_saved_deck_slots', coalesce(v_unlocks.extra_saved_deck_slots, 0),
    'card_vault_slots', coalesce(v_unlocks.card_vault_slots, 0),
    'card_vault_unlocked', coalesce(v_unlocks.card_vault_unlocked, false),
    'protection_rounds_remaining', coalesce(v_protection.rounds_remaining, 0)
  );
end;
$function$;

create or replace function public.use_inventory_item_self(p_inventory_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_inventory record;
  v_rounds_to_add integer := 0;
  v_unlocks record;
  v_effect_key text := '';
begin
  v_actor_id := public._assert_authenticated_user();

  select
    pi.*,
    i.code as item_code,
    i.name as item_name,
    i.behavior_code
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
    raise exception 'You do not own this inventory item';
  end if;

  if (v_inventory.quantity - v_inventory.locked_quantity) <= 0 then
    raise exception 'No available quantity remains for this item';
  end if;

  perform public._assert_series_member(v_inventory.series_id, v_actor_id);
  perform public._assert_series_item_use_allowed(v_inventory.series_id, v_actor_id);

  if v_inventory.behavior_code = 'open_container' then
    raise exception 'Openers are used from the Container Opener page';
  elsif lower(coalesce(v_inventory.item_code, '')) = 'deck_case'
    or lower(coalesce(v_inventory.behavior_code, '')) = 'grant_saved_deck_slot' then
    v_effect_key := 'deck_case';

    insert into public.player_series_unlocks (
      series_id,
      user_id,
      extra_saved_deck_slots,
      card_vault_slots,
      card_vault_unlocked
    )
    values (
      v_inventory.series_id,
      v_actor_id,
      1,
      0,
      false
    )
    on conflict (series_id, user_id)
    do update set
      extra_saved_deck_slots = public.player_series_unlocks.extra_saved_deck_slots + 1,
      updated_at = now();
  elsif lower(coalesce(v_inventory.item_code, '')) = 'card_vault'
    or lower(coalesce(v_inventory.behavior_code, '')) = 'grant_card_vault_slots' then
    v_effect_key := 'card_vault';

    insert into public.player_series_unlocks (
      series_id,
      user_id,
      extra_saved_deck_slots,
      card_vault_slots,
      card_vault_unlocked
    )
    values (
      v_inventory.series_id,
      v_actor_id,
      0,
      5,
      true
    )
    on conflict (series_id, user_id)
    do update set
      card_vault_slots = public.player_series_unlocks.card_vault_slots + 5,
      card_vault_unlocked = true,
      updated_at = now();
  elsif lower(coalesce(v_inventory.item_code, '')) = 'warded_sigil_i'
    or lower(coalesce(v_inventory.behavior_code, '')) = 'grant_protection_1' then
    v_effect_key := 'protection';
    v_rounds_to_add := 1;
  elsif lower(coalesce(v_inventory.item_code, '')) = 'warded_sigil_ii'
    or lower(coalesce(v_inventory.behavior_code, '')) = 'grant_protection_2' then
    v_effect_key := 'protection';
    v_rounds_to_add := 2;
  elsif lower(coalesce(v_inventory.item_code, '')) = 'chaos_sigil'
    or lower(coalesce(v_inventory.behavior_code, '')) = 'grant_protection_random_1_5' then
    v_effect_key := 'protection';
    v_rounds_to_add := floor(random() * 5 + 1)::integer;
  else
    raise exception 'This item needs a dedicated use modal and backend flow before it can be consumed';
  end if;

  if v_rounds_to_add > 0 then
    insert into public.player_series_protections (
      series_id,
      user_id,
      rounds_remaining,
      source_summary
    )
    values (
      v_inventory.series_id,
      v_actor_id,
      v_rounds_to_add,
      jsonb_build_array(
        jsonb_build_object(
          'item_definition_id', v_inventory.item_definition_id,
          'item_code', v_inventory.item_code,
          'item_name', v_inventory.item_name,
          'rounds_added', v_rounds_to_add,
          'used_at', now()
        )
      )
    )
    on conflict (series_id, user_id)
    do update set
      rounds_remaining = public.player_series_protections.rounds_remaining + excluded.rounds_remaining,
      source_summary = public.player_series_protections.source_summary || excluded.source_summary,
      updated_at = now();
  end if;

  update public.player_inventory
  set
    quantity = quantity - 1,
    updated_at = now()
  where id = p_inventory_id;

  delete from public.player_inventory
  where id = p_inventory_id
    and quantity <= 0;

  select *
  into v_unlocks
  from public.player_series_unlocks u
  where u.series_id = v_inventory.series_id
    and u.user_id = v_actor_id;

  return jsonb_build_object(
    'success', true,
    'effect_key', v_effect_key,
    'item_name', v_inventory.item_name,
    'rounds_added', v_rounds_to_add,
    'extra_saved_deck_slots', coalesce(v_unlocks.extra_saved_deck_slots, 0),
    'card_vault_slots', coalesce(v_unlocks.card_vault_slots, 0),
    'card_vault_unlocked', coalesce(v_unlocks.card_vault_unlocked, false)
  );
end;
$function$;

create or replace function public.get_my_feature_slot_state(p_series_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_wallet record;
  v_protection record;
  v_unlocks record;
  v_slots jsonb;
begin
  v_actor_id := public._assert_authenticated_user();
  perform public._assert_series_member(p_series_id, v_actor_id);

  select *
  into v_wallet
  from public.player_wallets w
  where w.user_id = v_actor_id
    and w.series_id = p_series_id;

  select *
  into v_protection
  from public.player_series_protections p
  where p.series_id = p_series_id
    and p.user_id = v_actor_id;

  select *
  into v_unlocks
  from public.player_series_unlocks u
  where u.series_id = p_series_id
    and u.user_id = v_actor_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', fs.id,
        'name', fs.name,
        'description', fs.description,
        'slot_type', fs.slot_type,
        'image_url', fs.image_url,
        'starting_choices', fs.starting_choices,
        'reroll_count', fs.reroll_count,
        'shard_cost_per_extra', fs.shard_cost_per_extra,
        'pool_mode', fs.pool_mode,
        'min_rarity_floor', fs.min_rarity_floor,
        'spin_count', coalesce(usage.spin_count, 0),
        'next_feature_coin_cost', coalesce(usage.spin_count, 0),
        'is_enabled', coalesce(fs.is_enabled, true),
        'is_locked', coalesce(fs.is_locked, false)
      )
      order by fs.name
    ),
    '[]'::jsonb
  )
  into v_slots
  from public.feature_slots fs
  left join public.player_feature_slot_usage usage
    on usage.series_id = p_series_id
   and usage.user_id = v_actor_id
   and usage.feature_slot_id = fs.id
  where coalesce(fs.is_enabled, true) = true;

  return jsonb_build_object(
    'series_id', p_series_id,
    'shards', coalesce(v_wallet.shards, 0),
    'feature_coins', coalesce(v_wallet.feature_coins, 0),
    'protection_rounds_remaining', coalesce(v_protection.rounds_remaining, 0),
    'extra_saved_deck_slots', coalesce(v_unlocks.extra_saved_deck_slots, 0),
    'card_vault_slots', coalesce(v_unlocks.card_vault_slots, 0),
    'card_vault_unlocked', coalesce(v_unlocks.card_vault_unlocked, false),
    'slots', v_slots
  );
end;
$function$;

create or replace function public.reset_player_feature_slot_usage(
  p_series_id uuid,
  p_target_user_id uuid,
  p_feature_slot_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_deleted_count integer := 0;
begin
  perform public._assert_authenticated_user();
  perform public._assert_series_admin_or_admin_plus(p_series_id);

  if p_target_user_id is null then
    raise exception 'Target user is required';
  end if;

  if p_feature_slot_id is null then
    delete from public.player_feature_slot_usage
    where series_id = p_series_id
      and user_id = p_target_user_id;
  else
    delete from public.player_feature_slot_usage
    where series_id = p_series_id
      and user_id = p_target_user_id
      and feature_slot_id = p_feature_slot_id;
  end if;

  get diagnostics v_deleted_count = row_count;

  return jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count
  );
end;
$function$;

create or replace function public.reset_series_feature_slot_usage(p_series_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_deleted_count integer := 0;
begin
  perform public._assert_authenticated_user();
  perform public._assert_series_admin_or_admin_plus(p_series_id);

  delete from public.player_feature_slot_usage
  where series_id = p_series_id;

  get diagnostics v_deleted_count = row_count;

  return jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count
  );
end;
$function$;

create or replace function public.set_store_item_admin_state(
  p_item_definition_id uuid,
  p_store_price integer default null,
  p_is_store_purchase_locked boolean default null,
  p_is_reward_rng_locked boolean default null,
  p_is_randomly_available boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_item record;
begin
  perform public._assert_admin_plus();

  update public.item_definitions i
  set
    store_price = coalesce(p_store_price, i.store_price),
    is_store_purchase_locked = coalesce(p_is_store_purchase_locked, i.is_store_purchase_locked),
    is_reward_rng_locked = coalesce(p_is_reward_rng_locked, i.is_reward_rng_locked),
    is_randomly_available = coalesce(p_is_randomly_available, i.is_randomly_available),
    updated_at = now()
  where i.id = p_item_definition_id
  returning *
  into v_item;

  if not found then
    raise exception 'Store item not found';
  end if;

  return jsonb_build_object(
    'success', true,
    'item_definition_id', v_item.id,
    'store_price', v_item.store_price,
    'is_store_purchase_locked', v_item.is_store_purchase_locked,
    'is_reward_rng_locked', v_item.is_reward_rng_locked,
    'is_randomly_available', v_item.is_randomly_available
  );
end;
$function$;

create or replace function public.randomize_store_item_availability(
  p_category_code text default null,
  p_enabled_ratio numeric default 0.50
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_updated_count integer := 0;
begin
  perform public._assert_admin_plus();

  if p_enabled_ratio is null or p_enabled_ratio < 0 or p_enabled_ratio > 1 then
    raise exception 'Enabled ratio must be between 0 and 1';
  end if;

  with updated_items as (
    update public.item_definitions i
    set
      is_randomly_available = (random() <= p_enabled_ratio),
      updated_at = now()
    from public.item_categories c
    where c.id = i.category_id
      and i.is_active = true
      and (
        p_category_code is null
        or c.code = p_category_code
      )
    returning i.id
  )
  select count(*)
  into v_updated_count
  from updated_items;

  return jsonb_build_object(
    'success', true,
    'updated_count', v_updated_count,
    'category_code', p_category_code,
    'enabled_ratio', p_enabled_ratio
  );
end;
$function$;

create or replace function public.store_add_to_cart(
  p_user uuid,
  p_series uuid,
  p_item_definition_id uuid,
  p_quantity integer
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_cart_id uuid;
  v_item record;
  v_existing_quantity integer := 0;
begin
  v_actor_id := public._assert_authenticated_user();

  if v_actor_id <> p_user then
    raise exception 'You can only modify your own cart';
  end if;

  if p_quantity <= 0 then
    raise exception 'Quantity must be greater than 0';
  end if;

  perform public._assert_series_member(p_series, p_user);

  select
    i.id,
    i.max_purchase,
    i.is_active,
    coalesce(i.is_store_purchase_locked, false) as is_store_purchase_locked,
    coalesce(i.is_randomly_available, true) as is_randomly_available
  into v_item
  from public.item_definitions i
  where i.id = p_item_definition_id;

  if not found or not coalesce(v_item.is_active, false) then
    raise exception 'Store item not found';
  end if;

  if not coalesce(v_item.is_randomly_available, true) then
    raise exception 'This item is not currently available in the store';
  end if;

  if coalesce(v_item.is_store_purchase_locked, false) then
    raise exception 'This item is currently purchase locked';
  end if;

  select id
  into v_cart_id
  from public.store_carts
  where user_id = p_user
    and series_id = p_series
  limit 1;

  if v_cart_id is null then
    insert into public.store_carts (user_id, series_id)
    values (p_user, p_series)
    returning id into v_cart_id;
  end if;

  select coalesce(quantity, 0)
  into v_existing_quantity
  from public.store_cart_items
  where cart_id = v_cart_id
    and item_definition_id = p_item_definition_id;

  if coalesce(v_item.max_purchase, 0) > 0
    and (coalesce(v_existing_quantity, 0) + p_quantity) > v_item.max_purchase then
    raise exception 'This purchase exceeds the max purchase limit for the item';
  end if;

  insert into public.store_cart_items (cart_id, item_definition_id, quantity)
  values (v_cart_id, p_item_definition_id, p_quantity)
  on conflict (cart_id, item_definition_id)
  do update
  set quantity = public.store_cart_items.quantity + excluded.quantity;
end;
$function$;

create or replace function public.store_set_cart_quantity(
  p_user uuid,
  p_series uuid,
  p_item_definition_id uuid,
  p_quantity integer
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_cart_id uuid;
  v_item record;
begin
  v_actor_id := public._assert_authenticated_user();

  if v_actor_id <> p_user then
    raise exception 'You can only modify your own cart';
  end if;

  select id
  into v_cart_id
  from public.store_carts
  where user_id = p_user
    and series_id = p_series
  limit 1;

  if v_cart_id is null then
    raise exception 'No active cart';
  end if;

  select
    i.id,
    i.max_purchase,
    i.is_active,
    coalesce(i.is_store_purchase_locked, false) as is_store_purchase_locked,
    coalesce(i.is_randomly_available, true) as is_randomly_available
  into v_item
  from public.item_definitions i
  where i.id = p_item_definition_id;

  if not found or not coalesce(v_item.is_active, false) then
    raise exception 'Store item not found';
  end if;

  if not coalesce(v_item.is_randomly_available, true) then
    raise exception 'This item is not currently available in the store';
  end if;

  if coalesce(v_item.is_store_purchase_locked, false) then
    raise exception 'This item is currently purchase locked';
  end if;

  if p_quantity <= 0 then
    delete from public.store_cart_items
    where cart_id = v_cart_id
      and item_definition_id = p_item_definition_id;
    return;
  end if;

  if coalesce(v_item.max_purchase, 0) > 0
    and p_quantity > v_item.max_purchase then
    raise exception 'This purchase exceeds the max purchase limit for the item';
  end if;

  update public.store_cart_items
  set quantity = p_quantity
  where cart_id = v_cart_id
    and item_definition_id = p_item_definition_id;
end;
$function$;

create or replace function public.store_checkout(
  p_user uuid,
  p_series uuid
)
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

  select coalesce(sum(ci.quantity * i.store_price), 0)
  into v_total_cost
  from public.store_cart_items ci
  join public.item_definitions i
    on i.id = ci.item_definition_id
  where ci.cart_id = v_cart_id
    and i.is_active = true
    and coalesce(i.is_randomly_available, true) = true
    and coalesce(i.is_store_purchase_locked, false) = false;

  if v_total_cost = 0 then
    raise exception 'Cart is empty';
  end if;

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

create or replace function public._process_series_round_rewards(
  p_series_id uuid,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_series record;
  v_config record;
  v_placement record;
  v_result record;
  v_actor_id uuid;
  v_processed_count integer := 0;
  v_error_count integer := 0;
  v_shared_shards integer;
  v_extra_shards integer;
  v_total_shards integer;
  v_shared_feature_coins integer;
  v_extra_feature_coins integer;
  v_total_feature_coins integer;
  v_reward_item_id uuid;
  v_reward_item_name text;
  v_grants jsonb;
  v_round_label text;
  v_notes_prefix text;
  v_scoreboard jsonb;
begin
  select
    gs.*,
    public._progression_round_step_value(gs.round_step) as round_step_value
  into v_series
  from public.game_series gs
  where gs.id = p_series_id
  for update;

  if not found then
    raise exception 'Series not found';
  end if;

  if v_series.current_phase <> 'reward' then
    raise exception 'Rewards can only be processed during Reward Phase';
  end if;

  v_actor_id := coalesce(auth.uid(), v_series.created_by);

  select *
  into v_config
  from public.series_round_reward_configs cfg
  where cfg.series_id = p_series_id
    and cfg.round_number = v_series.round_number
    and cfg.round_step = v_series.round_step_value
  limit 1;

  if not found then
    if not exists (
      select 1
      from public.series_reward_processing_errors e
      where e.series_id = p_series_id
        and e.round_number = v_series.round_number
        and e.round_step = v_series.round_step_value
        and e.user_id is null
        and e.cleared_at is null
    ) then
      insert into public.series_reward_processing_errors (
        series_id,
        round_number,
        round_step,
        user_id,
        message,
        error_payload
      )
      values (
        p_series_id,
        v_series.round_number,
        v_series.round_step_value,
        null,
        'Round reward config is missing for this phase',
        jsonb_build_object(
          'series_id', p_series_id,
          'round_number', v_series.round_number,
          'round_step', v_series.round_step_value
        )
      );
    end if;

    return jsonb_build_object(
      'success', false,
      'processed_count', 0,
      'error_count', 1,
      'missing_config', true
    );
  end if;

  if v_series.round_number = 0 then
    v_round_label := '0';
  else
    v_round_label := format('%s-%s', v_series.round_number, v_series.round_step_value);
  end if;

  for v_result in
    select rr.*
    from public.series_round_results rr
    where rr.series_id = p_series_id
      and rr.round_number = v_series.round_number
      and rr.round_step = v_series.round_step_value
    order by rr.placement asc, rr.created_at asc
  loop
    if exists (
      select 1
      from public.player_round_reward_notifications n
      where n.series_id = p_series_id
        and n.user_id = v_result.user_id
        and n.round_number = v_series.round_number
        and n.round_step = v_series.round_step_value
    ) then
      v_processed_count := v_processed_count + 1;
      continue;
    end if;

    begin
      select *
      into v_placement
      from public.series_round_reward_config_placements p
      where p.reward_config_id = v_config.id
        and p.placement = v_result.placement;

      v_shared_shards := 0;
      if coalesce(v_config.shared_shard_max, 0) > 0
        or coalesce(v_config.shared_shard_min, 0) > 0 then
        v_shared_shards := floor(
          random()
          * (
            greatest(v_config.shared_shard_max, v_config.shared_shard_min)
            - least(v_config.shared_shard_max, v_config.shared_shard_min)
            + 1
          )
        )::integer + least(v_config.shared_shard_max, v_config.shared_shard_min);
      end if;

      v_extra_shards := 0;
      if v_placement.id is not null and (
        coalesce(v_placement.extra_shard_max, 0) > 0
        or coalesce(v_placement.extra_shard_min, 0) > 0
      ) then
        v_extra_shards := floor(
          random()
          * (
            greatest(v_placement.extra_shard_max, v_placement.extra_shard_min)
            - least(v_placement.extra_shard_max, v_placement.extra_shard_min)
            + 1
          )
        )::integer + least(v_placement.extra_shard_max, v_placement.extra_shard_min);
      end if;

      v_shared_feature_coins := 0;
      if coalesce(v_config.shared_feature_coin_max, 0) > 0
        or coalesce(v_config.shared_feature_coin_min, 0) > 0 then
        v_shared_feature_coins := floor(
          random()
          * (
            greatest(v_config.shared_feature_coin_max, v_config.shared_feature_coin_min)
            - least(v_config.shared_feature_coin_max, v_config.shared_feature_coin_min)
            + 1
          )
        )::integer + least(v_config.shared_feature_coin_max, v_config.shared_feature_coin_min);
      end if;

      v_extra_feature_coins := 0;
      if v_placement.id is not null and (
        coalesce(v_placement.extra_feature_coin_max, 0) > 0
        or coalesce(v_placement.extra_feature_coin_min, 0) > 0
      ) then
        v_extra_feature_coins := floor(
          random()
          * (
            greatest(v_placement.extra_feature_coin_max, v_placement.extra_feature_coin_min)
            - least(v_placement.extra_feature_coin_max, v_placement.extra_feature_coin_min)
            + 1
          )
        )::integer + least(v_placement.extra_feature_coin_max, v_placement.extra_feature_coin_min);
      end if;

      v_total_shards := coalesce(v_shared_shards, 0) + coalesce(v_extra_shards, 0);
      v_total_feature_coins := coalesce(v_shared_feature_coins, 0) + coalesce(v_extra_feature_coins, 0);
      v_grants := '[]'::jsonb;
      v_notes_prefix := format(
        'round_reward:%s:%s:%s',
        v_series.round_number,
        v_series.round_step_value,
        v_result.placement
      );

      if v_total_shards > 0 then
        perform public._grant_series_shards(
          p_series_id,
          v_result.user_id,
          v_total_shards,
          v_actor_id,
          v_notes_prefix || ':shards'
        );

        v_grants := v_grants || jsonb_build_array(
          jsonb_build_object(
            'label', 'Shards',
            'value', v_total_shards
          )
        );
      end if;

      if v_total_feature_coins > 0 then
        perform public._grant_series_feature_coins(
          p_series_id,
          v_result.user_id,
          v_total_feature_coins,
          v_actor_id,
          v_notes_prefix || ':feature_coins'
        );

        v_grants := v_grants || jsonb_build_array(
          jsonb_build_object(
            'label', 'Feature Coins',
            'value', v_total_feature_coins
          )
        );
      end if;

      if coalesce(v_config.shared_item_definition_id, null) is not null
        and coalesce(v_config.shared_item_quantity, 0) > 0 then
        v_reward_item_name := public._grant_series_item(
          p_series_id,
          v_result.user_id,
          v_config.shared_item_definition_id,
          v_config.shared_item_quantity,
          v_actor_id,
          v_notes_prefix || ':shared_item'
        );

        v_grants := v_grants || jsonb_build_array(
          jsonb_build_object(
            'label', coalesce(v_reward_item_name, 'Item'),
            'value', v_config.shared_item_quantity
          )
        );
      end if;

      if v_placement.id is not null and coalesce(v_placement.random_item_quantity, 0) > 0 then
        if v_placement.specific_item_definition_id is not null then
          v_reward_item_id := v_placement.specific_item_definition_id;
        else
          select i.id
          into v_reward_item_id
          from public.item_definitions i
          where i.is_active = true
            and coalesce(i.is_randomly_available, true) = true
            and coalesce(i.is_reward_rng_locked, false) = false
          order by random()
          limit 1;
        end if;

        if v_reward_item_id is not null then
          v_reward_item_name := public._grant_series_item(
            p_series_id,
            v_result.user_id,
            v_reward_item_id,
            v_placement.random_item_quantity,
            v_actor_id,
            v_notes_prefix || ':placement_item'
          );

          v_grants := v_grants || jsonb_build_array(
            jsonb_build_object(
              'label', coalesce(v_reward_item_name, 'Item'),
              'value', v_placement.random_item_quantity
            )
          );
        end if;
      end if;

      update public.series_round_results
      set shards_awarded = v_total_shards
      where id = v_result.id;

      v_scoreboard := public._build_series_scoreboard_json(p_series_id);

      insert into public.player_round_reward_notifications (
        series_id,
        user_id,
        round_number,
        round_step,
        placement,
        payload
      )
      values (
        p_series_id,
        v_result.user_id,
        v_series.round_number,
        v_series.round_step_value,
        v_result.placement,
        jsonb_build_object(
          'round_label', v_round_label,
          'placement', v_result.placement,
          'points_awarded', v_result.score_awarded,
          'grants', v_grants,
          'scoreboard', v_scoreboard
        )
      );

      v_processed_count := v_processed_count + 1;
    exception
      when others then
        v_error_count := v_error_count + 1;

        insert into public.series_reward_processing_errors (
          series_id,
          round_number,
          round_step,
          bracket_id,
          user_id,
          placement,
          message,
          error_payload
        )
        values (
          p_series_id,
          v_series.round_number,
          v_series.round_step_value,
          v_result.bracket_id,
          v_result.user_id,
          v_result.placement,
          coalesce(sqlerrm, 'Reward processing failed'),
          jsonb_build_object(
            'series_id', p_series_id,
            'round_number', v_series.round_number,
            'round_step', v_series.round_step_value,
            'user_id', v_result.user_id,
            'placement', v_result.placement
          )
        );
    end;
  end loop;

  return jsonb_build_object(
    'success', v_error_count = 0,
    'processed_count', v_processed_count,
    'error_count', v_error_count
  );
end;
$function$;

create or replace function public.advance_series_phase(
  p_series_id uuid,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_series record;
  v_player_count integer;
  v_ready_count integer;
  v_round_step_value integer;
  v_existing_bracket_id uuid;
  v_remaining_matches integer;
  v_reward_result jsonb := '{}'::jsonb;
  v_next_round integer;
  v_next_step integer;
  v_previous_round integer;
begin
  perform public._assert_authenticated_user();
  perform public._assert_series_admin_or_admin_plus(p_series_id);

  select *
  into v_series
  from public.game_series gs
  where gs.id = p_series_id
  for update;

  if not found then
    raise exception 'Series not found';
  end if;

  v_previous_round := coalesce(v_series.round_number, 0);
  v_round_step_value := public._progression_round_step_value(v_series.round_step);

  select count(*)
  into v_player_count
  from public.series_players sp
  where sp.series_id = p_series_id;

  select count(*)
  into v_ready_count
  from public.series_phase_ready_states rs
  where rs.series_id = p_series_id
    and rs.round_number = v_series.round_number
    and rs.round_step = v_round_step_value
    and rs.phase = v_series.current_phase;

  if v_series.current_phase = 'standby' then
    if not p_force and v_player_count > 0 and v_ready_count < v_player_count then
      raise exception 'Not all players are ready to leave Standby Phase';
    end if;

    update public.game_series
    set
      current_phase = 'deckbuilding',
      round_step = case
        when round_number = 0 then 1
        else coalesce(round_step, 1)
      end,
      updated_at = now()
    where id = p_series_id
    returning *
    into v_series;
  elsif v_series.current_phase = 'deckbuilding' then
    if not p_force and v_player_count > 0 and v_ready_count < v_player_count then
      raise exception 'Not all players are ready to leave Deckbuilding Phase';
    end if;

    v_round_step_value := case
      when v_series.round_number = 0 then 1
      else public._progression_round_step_value(v_series.round_step)
    end;

    v_existing_bracket_id := public._get_series_current_bracket_id(
      p_series_id,
      v_series.round_number,
      v_round_step_value
    );

    if v_existing_bracket_id is null then
      perform public.generate_series_bracket(p_series_id);
    end if;

    update public.game_series
    set
      current_phase = 'dueling',
      round_step = v_round_step_value,
      updated_at = now()
    where id = p_series_id
    returning *
    into v_series;
  elsif v_series.current_phase = 'dueling' then
    v_existing_bracket_id := public._get_series_current_bracket_id(
      p_series_id,
      v_series.round_number,
      public._progression_round_step_value(v_series.round_step)
    );

    if v_existing_bracket_id is null then
      raise exception 'No bracket exists for the current duel phase';
    end if;

    select count(*)
    into v_remaining_matches
    from public.series_bracket_matches m
    where m.bracket_id = v_existing_bracket_id
      and m.status <> 'completed'
      and m.player1_user_id is not null
      and m.player2_user_id is not null;

    if v_remaining_matches > 0 then
      raise exception 'Not all duel results have been reported';
    end if;

    update public.game_series
    set
      current_phase = 'reward',
      updated_at = now()
    where id = p_series_id
    returning *
    into v_series;
  elsif v_series.current_phase = 'reward' then
    if not p_force and exists (
      select 1
      from public.series_reward_processing_errors e
      where e.series_id = p_series_id
        and e.round_number = v_series.round_number
        and e.round_step = v_round_step_value
        and e.cleared_at is null
    ) then
      raise exception 'Reward processing still has unresolved errors';
    end if;

    v_reward_result := public._process_series_round_rewards(p_series_id, p_force);

    if coalesce((v_reward_result ->> 'error_count')::integer, 0) > 0 and not p_force then
      raise exception 'Reward processing failed for one or more players';
    end if;

    if v_series.round_number = 0 then
      v_next_round := 1;
      v_next_step := 1;
    elsif public._progression_round_step_value(v_series.round_step) = 1 then
      v_next_round := v_series.round_number;
      v_next_step := 2;
    else
      v_next_round := v_series.round_number + 1;
      v_next_step := 1;
    end if;

    update public.game_series
    set
      current_phase = 'standby',
      round_number = v_next_round,
      round_step = v_next_step,
      updated_at = now()
    where id = p_series_id
    returning *
    into v_series;

    if coalesce(v_series.round_number, 0) > v_previous_round then
      perform public._decrement_series_protections(p_series_id);
    end if;
  else
    raise exception 'Unsupported phase: %', v_series.current_phase;
  end if;

  return jsonb_build_object(
    'success', true,
    'current_phase', v_series.current_phase,
    'round_number', v_series.round_number,
    'round_step', v_series.round_step,
    'force', p_force,
    'reward_result', v_reward_result
  );
end;
$function$;

commit;
