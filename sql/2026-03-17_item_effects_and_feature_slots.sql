begin;

create extension if not exists pgcrypto;

create table if not exists public.player_inventory_item_use_sessions (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null
    references public.player_inventory (id)
    on delete cascade,
  series_id uuid not null
    references public.game_series (id)
    on delete cascade,
  user_id uuid not null
    references auth.users (id)
    on delete cascade,
  item_definition_id uuid not null
    references public.item_definitions (id)
    on delete cascade,
  effect_key text not null,
  resolved_payload jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone not null default (now() + interval '30 minutes'),
  used_at timestamp with time zone
);

create unique index if not exists idx_player_inventory_item_use_sessions_active
  on public.player_inventory_item_use_sessions (inventory_id, user_id)
  where used_at is null;

create table if not exists public.player_feature_slot_sessions (
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
  slot_mode text not null,
  status text not null default 'open',
  selected_category text,
  rerolls_remaining integer not null default 0,
  current_choice_count integer not null default 0,
  paid_feature_coin_cost integer not null default 0,
  paid_shard_cost integer not null default 0,
  card_amount_boosts integer not null default 0,
  rarity_boosts integer not null default 0,
  reveal_count integer not null default 0,
  offers jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  resolved_at timestamp with time zone
);

create unique index if not exists idx_player_feature_slot_sessions_open
  on public.player_feature_slot_sessions (series_id, user_id, feature_slot_id)
  where status = 'open';

create or replace function public._hostile_target_pool_json(
  p_series_id uuid,
  p_actor_id uuid
)
returns jsonb
language sql
security definer
set search_path to 'public', 'auth'
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', sp.user_id,
        'username', coalesce(spv.username, 'Unknown Duelist'),
        'avatar', coalesce(spv.avatar, '')
      )
      order by coalesce(spv.username, 'Unknown Duelist')
    ),
    '[]'::jsonb
  )
  from public.series_players sp
  left join public.series_players_view spv
    on spv.series_id = sp.series_id
   and spv.user_id = sp.user_id
  left join public.player_series_protections protection
    on protection.series_id = sp.series_id
   and protection.user_id = sp.user_id
   and protection.rounds_remaining > 0
  where sp.series_id = p_series_id
    and sp.user_id <> p_actor_id
    and protection.id is null;
$$;

create or replace function public._is_hostile_target_eligible(
  p_series_id uuid,
  p_actor_id uuid,
  p_target_user_id uuid
)
returns boolean
language sql
security definer
set search_path to 'public', 'auth'
as $$
  select exists (
    select 1
    from public.series_players sp
    left join public.player_series_protections protection
      on protection.series_id = sp.series_id
     and protection.user_id = sp.user_id
     and protection.rounds_remaining > 0
    where sp.series_id = p_series_id
      and sp.user_id = p_target_user_id
      and sp.user_id <> p_actor_id
      and protection.id is null
  );
$$;

create or replace function public._pick_random_hostile_target(
  p_series_id uuid,
  p_actor_id uuid
)
returns jsonb
language sql
security definer
set search_path to 'public', 'auth'
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'user_id', sp.user_id,
        'username', coalesce(spv.username, 'Unknown Duelist'),
        'avatar', coalesce(spv.avatar, '')
      )
      from public.series_players sp
      left join public.series_players_view spv
        on spv.series_id = sp.series_id
       and spv.user_id = sp.user_id
      left join public.player_series_protections protection
        on protection.series_id = sp.series_id
       and protection.user_id = sp.user_id
       and protection.rounds_remaining > 0
      where sp.series_id = p_series_id
        and sp.user_id <> p_actor_id
        and protection.id is null
      order by random()
      limit 1
    ),
    '{}'::jsonb
  );
$$;

create or replace function public._upsert_inventory_item_use_session(
  p_inventory_id uuid,
  p_series_id uuid,
  p_user_id uuid,
  p_item_definition_id uuid,
  p_effect_key text,
  p_resolved_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_session_id uuid;
begin
  delete from public.player_inventory_item_use_sessions
  where inventory_id = p_inventory_id
    and user_id = p_user_id
    and (
      used_at is not null
      or expires_at <= now()
    );

  update public.player_inventory_item_use_sessions
  set
    effect_key = p_effect_key,
    resolved_payload = coalesce(p_resolved_payload, '{}'::jsonb),
    updated_at = now(),
    expires_at = now() + interval '30 minutes'
  where inventory_id = p_inventory_id
    and user_id = p_user_id
    and used_at is null
  returning id into v_session_id;

  if v_session_id is null then
    insert into public.player_inventory_item_use_sessions (
      inventory_id,
      series_id,
      user_id,
      item_definition_id,
      effect_key,
      resolved_payload
    )
    values (
      p_inventory_id,
      p_series_id,
      p_user_id,
      p_item_definition_id,
      p_effect_key,
      coalesce(p_resolved_payload, '{}'::jsonb)
    )
    returning id into v_session_id;
  end if;

  return v_session_id;
end;
$function$;

create or replace function public._set_series_banlist_card_status(
  p_series_id uuid,
  p_card_id bigint,
  p_status text,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  if p_card_id is null then
    raise exception 'Card is required';
  end if;

  if p_status is null or lower(trim(p_status)) not in (
    'forbidden',
    'limited',
    'semi_limited',
    'unlimited'
  ) then
    raise exception 'Unsupported banlist status';
  end if;

  update public.series_banlist_cards
  set
    status = lower(trim(p_status)),
    notes = p_notes
  where series_id = p_series_id
    and card_id = p_card_id;

  if not found then
    insert into public.series_banlist_cards (
      series_id,
      card_id,
      status,
      notes
    )
    values (
      p_series_id,
      p_card_id,
      lower(trim(p_status)),
      p_notes
    );
  end if;
end;
$function$;

create or replace function public._revalidate_active_deck(
  p_series_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_active_deck_id uuid;
begin
  if p_series_id is null or p_user_id is null then
    return;
  end if;

  select d.id
  into v_active_deck_id
  from public.player_decks d
  where d.series_id = p_series_id
    and d.user_id = p_user_id
    and d.is_active = true
  limit 1;

  if v_active_deck_id is null then
    return;
  end if;

  perform public._validate_player_deck_for_progression(
    p_series_id,
    p_user_id,
    v_active_deck_id
  );
end;
$function$;

create or replace function public._revalidate_series_active_decks_for_card(
  p_series_id uuid,
  p_card_id bigint
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_row record;
begin
  if p_series_id is null or p_card_id is null then
    return;
  end if;

  for v_row in
    select distinct d.user_id, d.id as deck_id
    from public.player_decks d
    join public.player_deck_cards pdc
      on pdc.deck_id = d.id
    where d.series_id = p_series_id
      and d.is_active = true
      and pdc.card_id = p_card_id
  loop
    perform public._validate_player_deck_for_progression(
      p_series_id,
      v_row.user_id,
      v_row.deck_id
    );
  end loop;
end;
$function$;

create or replace function public._feature_slot_offer_cards(
  p_count integer,
  p_picker_category text default null,
  p_rarity_boosts integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_cards jsonb := '[]'::jsonb;
  v_row record;
  v_rarity jsonb;
begin
  for v_row in
    with picked as (
      select
        c.id,
        c.name,
        c.image_url,
        c.type,
        c.attribute,
        c.race,
        c.level,
        c.atk,
        c.def
      from public.cards c
      where (
        p_picker_category is null
        or lower(trim(p_picker_category)) = ''
        or lower(trim(p_picker_category)) = 'all'
        or (
          lower(trim(p_picker_category)) = 'monster'
          and (coalesce(c.type, 0) & 1) = 1
          and (coalesce(c.type, 0) & 64) = 0
          and (coalesce(c.type, 0) & 8192) = 0
          and (coalesce(c.type, 0) & 8388608) = 0
          and (coalesce(c.type, 0) & 67108864) = 0
        )
        or (
          lower(trim(p_picker_category)) = 'spell'
          and (coalesce(c.type, 0) & 2) = 2
        )
        or (
          lower(trim(p_picker_category)) = 'trap'
          and (coalesce(c.type, 0) & 4) = 4
        )
        or (
          lower(trim(p_picker_category)) = 'extra'
          and (
            (coalesce(c.type, 0) & 64) = 64
            or (coalesce(c.type, 0) & 8192) = 8192
            or (coalesce(c.type, 0) & 8388608) = 8388608
            or (coalesce(c.type, 0) & 67108864) = 67108864
          )
        )
      )
      order by random()
      limit greatest(coalesce(p_count, 1), 1)
    )
    select *
    from picked
  loop
    v_rarity := public._feature_slot_random_rarity(coalesce(p_rarity_boosts, 0));

    v_cards := v_cards || jsonb_build_array(
      jsonb_build_object(
        'card_id', v_row.id,
        'card_name', v_row.name,
        'image_url', v_row.image_url,
        'type', v_row.type,
        'attribute', v_row.attribute,
        'race', v_row.race,
        'level', v_row.level,
        'atk', v_row.atk,
        'def', v_row.def,
        'rarity_id', v_rarity ->> 'id',
        'rarity_name', v_rarity ->> 'name'
      )
    );
  end loop;

  return coalesce(v_cards, '[]'::jsonb);
end;
$function$;

create or replace function public.search_series_card_catalog(
  p_series_id uuid,
  p_search text default null,
  p_only_banlisted boolean default false,
  p_limit integer default 40
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_cards jsonb;
  v_search text := lower(trim(coalesce(p_search, '')));
begin
  v_actor_id := public._assert_authenticated_user();
  perform public._assert_series_member(p_series_id, v_actor_id);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'card_id', card_rows.card_id,
        'card_name', card_rows.card_name,
        'image_url', card_rows.image_url,
        'status', card_rows.status
      )
      order by card_rows.search_rank, card_rows.card_name
    ),
    '[]'::jsonb
  )
  into v_cards
  from (
    select
      c.id as card_id,
      c.name as card_name,
      c.image_url,
      coalesce(sb.status, 'unlimited') as status,
      case
        when v_search = '' then 2
        when lower(c.name) = v_search then 0
        when lower(c.name) like v_search || '%' then 1
        else 2
      end as search_rank
    from public.cards c
    left join public.series_banlist_cards sb
      on sb.series_id = p_series_id
     and sb.card_id = c.id
    where (
      v_search = ''
      or lower(c.name) like '%' || v_search || '%'
    )
      and (
        not coalesce(p_only_banlisted, false)
        or coalesce(sb.status, 'unlimited') <> 'unlimited'
      )
    order by
      case
        when v_search = '' then 2
        when lower(c.name) = v_search then 0
        when lower(c.name) like v_search || '%' then 1
        else 2
      end,
      c.name asc
    limit greatest(coalesce(p_limit, 40), 1)
  ) card_rows;

  return coalesce(v_cards, '[]'::jsonb);
end;
$function$;

create or replace function public.get_inventory_item_card_options(
  p_inventory_id uuid,
  p_target_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_item record;
  v_target_user_id uuid;
  v_series record;
  v_options jsonb;
begin
  v_actor_id := public._assert_authenticated_user();

  select
    pi.id,
    pi.user_id,
    pi.series_id,
    i.behavior_code
  into v_item
  from public.player_inventory pi
  join public.item_definitions i
    on i.id = pi.item_definition_id
  where pi.id = p_inventory_id;

  if not found then
    raise exception 'Inventory item not found';
  end if;

  if v_item.user_id <> v_actor_id then
    raise exception 'You do not own this inventory item';
  end if;

  perform public._assert_series_member(v_item.series_id, v_actor_id);
  perform public._assert_series_item_use_allowed(v_item.series_id, v_actor_id);

  v_target_user_id := coalesce(p_target_user_id, v_actor_id);

  if v_target_user_id <> v_actor_id
    and not public._is_hostile_target_eligible(v_item.series_id, v_actor_id, v_target_user_id) then
    raise exception 'That opponent is not eligible for this item right now';
  end if;

  select
    gs.current_phase,
    gs.round_number,
    public._progression_round_step_value(gs.round_step) as round_step_value
  into v_series
  from public.game_series gs
  where gs.id = v_item.series_id;

  with visible_rows as (
    select
      bc.id as binder_card_id,
      bc.card_id,
      c.name as card_name,
      c.image_url,
      bc.rarity_id,
      coalesce(r.name, 'Base') as rarity_name,
      coalesce(r.sort_order, 9999) as rarity_sort_order,
      coalesce(r.shard_value, 0) as rarity_shard_value,
      bc.quantity
    from public.binder_cards bc
    join public.cards c
      on c.id = bc.card_id
    left join public.card_rarities r
      on r.id = bc.rarity_id
    where bc.user_id = v_target_user_id
      and bc.series_id = v_item.series_id
      and bc.quantity > 0
      and coalesce(bc.is_trade_locked, false) = false
      and not exists (
        select 1
        from public.player_card_vault_entries vault
        where vault.user_id = v_target_user_id
          and vault.series_id = v_item.series_id
          and vault.card_id = bc.card_id
      )
  ),
  duel_locked as (
    select
      sc.card_id,
      coalesce(sum(sc.quantity), 0)::integer as locked_quantity
    from public.series_round_deck_snapshots snapshot_rows
    join public.series_round_deck_snapshot_cards sc
      on sc.snapshot_id = snapshot_rows.id
    where snapshot_rows.series_id = v_item.series_id
      and snapshot_rows.user_id = v_target_user_id
      and snapshot_rows.round_number = v_series.round_number
      and snapshot_rows.round_step = v_series.round_step_value
      and v_series.current_phase = 'dueling'
    group by sc.card_id
  ),
  grouped as (
    select
      vr.card_id,
      max(vr.card_name) as card_name,
      max(vr.image_url) as image_url,
      sum(vr.quantity)::integer as total_quantity,
      coalesce(max(dl.locked_quantity), 0)::integer as duel_locked_quantity,
      greatest(
        sum(vr.quantity)::integer - coalesce(max(dl.locked_quantity), 0)::integer,
        0
      ) as max_name_available,
      exists (
        select 1
        from public.player_card_curses curse
        where curse.series_id = v_item.series_id
          and curse.target_user_id = v_target_user_id
          and curse.card_id = vr.card_id
          and curse.is_active = true
      ) as is_cursed,
      jsonb_agg(
        jsonb_build_object(
          'binder_card_id', vr.binder_card_id,
          'rarity_id', vr.rarity_id,
          'rarity_name', vr.rarity_name,
          'rarity_sort_order', vr.rarity_sort_order,
          'rarity_shard_value', vr.rarity_shard_value,
          'quantity', vr.quantity
        )
        order by vr.rarity_sort_order asc, vr.rarity_name asc, vr.binder_card_id
      ) as rarities
    from visible_rows vr
    left join duel_locked dl
      on dl.card_id = vr.card_id
    group by vr.card_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'card_id', grouped.card_id,
        'card_name', grouped.card_name,
        'image_url', grouped.image_url,
        'total_quantity', grouped.total_quantity,
        'duel_locked_quantity', grouped.duel_locked_quantity,
        'max_name_available', grouped.max_name_available,
        'is_cursed', grouped.is_cursed,
        'rarities', grouped.rarities
      )
      order by grouped.card_name asc
    ),
    '[]'::jsonb
  )
  into v_options
  from grouped
  where grouped.total_quantity > 0
    and (
      case
        when v_item.behavior_code in (
          'curse_cards_choose_opponent',
          'curse_cards_random_opponent',
          'curse_cards_all_opponents',
          'extract_card_choose_opponent',
          'extract_card_random_opponent',
          'extract_card_all_opponents'
        ) and v_series.current_phase = 'dueling'
          then grouped.duel_locked_quantity = 0
        when v_item.behavior_code in (
          'steal_card_choose_opponent',
          'steal_card_random_opponent',
          'steal_card_all_opponents',
          'forced_exchange_choose_opponent',
          'forced_exchange_random_opponent'
        ) and v_series.current_phase = 'dueling'
          then grouped.max_name_available > 0
        else true
      end
    )
    and (
      case
        when v_target_user_id = v_actor_id then grouped.is_cursed = false
        else true
      end
    );

  return coalesce(v_options, '[]'::jsonb);
end;
$function$;

create or replace function public.use_inventory_item_with_payload(
  p_inventory_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_inventory record;
  v_series record;
  v_target_user_id uuid;
  v_card_id bigint;
  v_status text;
  v_base_rarity_id uuid;
  v_target record;
  v_row record;
  v_effect_key text := '';
  v_total_quantity integer := 0;
  v_take_tiers integer[];
  v_give_tiers integer[];
  v_take_count integer := 0;
  v_give_count integer := 0;
  v_index integer := 1;
begin
  v_actor_id := public._assert_authenticated_user();

  select
    pi.id,
    pi.user_id,
    pi.series_id,
    pi.quantity,
    pi.locked_quantity,
    pi.item_definition_id,
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

  select
    gs.current_phase,
    gs.round_number,
    public._progression_round_step_value(gs.round_step) as round_step_value
  into v_series
  from public.game_series gs
  where gs.id = v_inventory.series_id;

  if lower(coalesce(v_inventory.item_code, '')) in (
    'deck_case',
    'card_vault',
    'warded_sigil_i',
    'warded_sigil_ii',
    'chaos_sigil'
  ) or lower(coalesce(v_inventory.behavior_code, '')) in (
    'grant_saved_deck_slot',
    'grant_card_vault_slots',
    'grant_protection_1',
    'grant_protection_2',
    'grant_protection_random_1_5'
  ) then
    return public.use_inventory_item_self(p_inventory_id);
  end if;

  if v_inventory.behavior_code = 'open_container' then
    raise exception 'Openers are used from the Container Opener page';
  end if;

  if v_inventory.behavior_code = 'apply_random_banlist_to_all_opponents' then
    if v_series.current_phase = 'dueling' then
      raise exception 'Chaos Verdict cannot affect active decks during Dueling Phase';
    end if;

    v_effect_key := 'chaos_verdict';

    for v_target in
      select sp.user_id
      from public.series_players sp
      left join public.player_series_protections protection
        on protection.series_id = sp.series_id
       and protection.user_id = sp.user_id
       and protection.rounds_remaining > 0
      where sp.series_id = v_inventory.series_id
        and sp.user_id <> v_actor_id
        and protection.id is null
    loop
      select picked.card_id
      into v_card_id
      from (
        select source_rows.card_id
        from (
          select snapshot_cards.card_id, snapshot_cards.quantity
          from public.series_round_deck_snapshots snapshot_rows
          join public.series_round_deck_snapshot_cards snapshot_cards
            on snapshot_cards.snapshot_id = snapshot_rows.id
          where snapshot_rows.series_id = v_inventory.series_id
            and snapshot_rows.user_id = v_target.user_id
            and snapshot_rows.round_number = v_series.round_number
            and snapshot_rows.round_step = v_series.round_step_value
          union all
          select deck_cards.card_id, deck_cards.quantity
          from public.player_decks d
          join public.player_deck_cards deck_cards
            on deck_cards.deck_id = d.id
          where d.series_id = v_inventory.series_id
            and d.user_id = v_target.user_id
            and d.is_active = true
            and not exists (
              select 1
              from public.series_round_deck_snapshots snapshot_rows
              where snapshot_rows.series_id = v_inventory.series_id
                and snapshot_rows.user_id = v_target.user_id
                and snapshot_rows.round_number = v_series.round_number
                and snapshot_rows.round_step = v_series.round_step_value
            )
        ) source_rows
        join generate_series(1, greatest(source_rows.quantity, 1)) weighted(copy_index)
          on true
        order by random()
        limit 1
      ) picked;

      if v_card_id is null then
        continue;
      end if;

      v_status := (array['forbidden', 'limited', 'semi_limited', 'unlimited'])[
        floor(random() * 4 + 1)::integer
      ];

      perform public._set_series_banlist_card_status(
        v_inventory.series_id,
        v_card_id,
        v_status,
        format('chaos_verdict:%s', v_actor_id)
      );

      perform public._revalidate_series_active_decks_for_card(
        v_inventory.series_id,
        v_card_id
      );
    end loop;
  elsif v_inventory.behavior_code in (
    'set_banlist_forbidden',
    'set_banlist_limited',
    'set_banlist_semi_limited',
    'set_banlist_unlimited'
  ) then
    v_effect_key := lower(coalesce(v_inventory.item_code, v_inventory.behavior_code));
    v_card_id := nullif(coalesce(p_payload ->> 'card_id', ''), '')::bigint;

    if v_card_id is null then
      raise exception 'Select a card first';
    end if;

    perform public._assert_duel_snapshot_card_not_globally_targeted(
      v_inventory.series_id,
      v_card_id
    );

    v_status := case v_inventory.behavior_code
      when 'set_banlist_forbidden' then 'forbidden'
      when 'set_banlist_limited' then 'limited'
      when 'set_banlist_semi_limited' then 'semi_limited'
      else 'unlimited'
    end;

    perform public._set_series_banlist_card_status(
      v_inventory.series_id,
      v_card_id,
      v_status,
      format('%s:%s', v_inventory.behavior_code, v_actor_id)
    );

    perform public._revalidate_series_active_decks_for_card(
      v_inventory.series_id,
      v_card_id
    );
  elsif v_inventory.behavior_code in (
    'black_market_ticket',
    'black_market_card'
  ) then
    v_effect_key := lower(coalesce(v_inventory.item_code, v_inventory.behavior_code));
    v_card_id := nullif(coalesce(p_payload ->> 'card_id', ''), '')::bigint;

    if v_card_id is null then
      raise exception 'Select a banlisted card first';
    end if;

    select coalesce(status, 'unlimited')
    into v_status
    from public.series_banlist_cards ban_rows
    where ban_rows.series_id = v_inventory.series_id
      and ban_rows.card_id = v_card_id
    limit 1;

    if coalesce(v_status, 'unlimited') = 'unlimited' then
      raise exception 'That card is not currently on the banlist';
    end if;

    select r.id
    into v_base_rarity_id
    from public.card_rarities r
    order by coalesce(r.sort_order, 9999), r.name
    limit 1;

    if v_base_rarity_id is null then
      raise exception 'A base rarity must exist before Black Market items can grant cards';
    end if;

    perform public._feature_slot_grant_card(
      v_inventory.series_id,
      v_actor_id,
      v_card_id,
      v_base_rarity_id
    );

    if v_inventory.behavior_code = 'black_market_card' then
      perform public._assert_duel_snapshot_card_not_globally_targeted(
        v_inventory.series_id,
        v_card_id
      );

      perform public._set_series_banlist_card_status(
        v_inventory.series_id,
        v_card_id,
        'unlimited',
        format('black_market_card:%s', v_actor_id)
      );

      perform public._revalidate_series_active_decks_for_card(
        v_inventory.series_id,
        v_card_id
      );
    end if;

  elsif v_inventory.behavior_code in (
    'curse_cards_choose_opponent',
    'curse_cards_random_opponent'
  ) then
    v_effect_key := lower(coalesce(v_inventory.item_code, v_inventory.behavior_code));
    v_target_user_id := nullif(coalesce(p_payload ->> 'target_user_id', ''), '')::uuid;

    if v_target_user_id is null then
      v_target_user_id := nullif(
        coalesce(
          public._get_inventory_item_use_session_payload(
            p_inventory_id,
            v_actor_id,
            v_effect_key
          ) ->> 'target_user_id',
          ''
        ),
        ''
      )::uuid;
    end if;

    if v_target_user_id is null then
      raise exception 'Select an opponent first';
    end if;

    if not public._is_hostile_target_eligible(v_inventory.series_id, v_actor_id, v_target_user_id) then
      raise exception 'That opponent is no longer eligible for this item';
    end if;

    select count(*)
    into v_take_count
    from (
      select distinct selected_rows.card_id
      from jsonb_to_recordset(coalesce(p_payload -> 'card_ids', '[]'::jsonb))
        as selected_rows(card_id bigint)
    ) card_rows;

    if v_take_count <> 3 then
      raise exception 'Select exactly 3 different cards to curse';
    end if;

    for v_row in
      select distinct selected_rows.card_id
      from jsonb_to_recordset(coalesce(p_payload -> 'card_ids', '[]'::jsonb))
        as selected_rows(card_id bigint)
    loop
      if not exists (
        select 1
        from public.binder_cards bc
        where bc.user_id = v_target_user_id
          and bc.series_id = v_inventory.series_id
          and bc.card_id = v_row.card_id
          and bc.quantity > 0
          and coalesce(bc.is_trade_locked, false) = false
          and not exists (
            select 1
            from public.player_card_vault_entries vault
            where vault.user_id = v_target_user_id
              and vault.series_id = v_inventory.series_id
              and vault.card_id = bc.card_id
          )
      ) then
        raise exception 'One of the selected card names is no longer available in that binder';
      end if;

      perform public._assert_duel_snapshot_card_not_targeted(
        v_inventory.series_id,
        v_target_user_id,
        v_row.card_id
      );

      update public.player_card_curses
      set
        is_active = true,
        expires_at = null,
        round_number = v_series.round_number,
        updated_at = now()
      where series_id = v_inventory.series_id
        and target_user_id = v_target_user_id
        and card_id = v_row.card_id
        and is_active = true;

      if not found then
        insert into public.player_card_curses (
          series_id,
          target_user_id,
          source_user_id,
          item_definition_id,
          card_id,
          effect_type,
          round_number,
          is_active,
          notes
        )
        values (
          v_inventory.series_id,
          v_target_user_id,
          v_actor_id,
          v_inventory.item_definition_id,
          v_row.card_id,
          'curse',
          v_series.round_number,
          true,
          format('item_use:%s', v_inventory.behavior_code)
        );
      end if;
    end loop;

    perform public._revalidate_active_deck(v_inventory.series_id, v_target_user_id);
  elsif v_inventory.behavior_code = 'curse_cards_all_opponents' then
    v_effect_key := lower(coalesce(v_inventory.item_code, v_inventory.behavior_code));

    for v_row in
      select
        selection_rows.target_user_id,
        selection_rows.card_id
      from jsonb_to_recordset(coalesce(p_payload -> 'targets', '[]'::jsonb))
        as selection_rows(target_user_id uuid, card_id bigint)
    loop
      if v_row.target_user_id is null or v_row.card_id is null then
        raise exception 'Choose one card for every opponent';
      end if;

      if not public._is_hostile_target_eligible(
        v_inventory.series_id,
        v_actor_id,
        v_row.target_user_id
      ) then
        raise exception 'One of the selected opponents is no longer eligible';
      end if;

      if not exists (
        select 1
        from public.binder_cards bc
        where bc.user_id = v_row.target_user_id
          and bc.series_id = v_inventory.series_id
          and bc.card_id = v_row.card_id
          and bc.quantity > 0
          and coalesce(bc.is_trade_locked, false) = false
          and not exists (
            select 1
            from public.player_card_vault_entries vault
            where vault.user_id = v_row.target_user_id
              and vault.series_id = v_inventory.series_id
              and vault.card_id = bc.card_id
          )
      ) then
        raise exception 'One of the selected card names is no longer available';
      end if;

      perform public._assert_duel_snapshot_card_not_targeted(
        v_inventory.series_id,
        v_row.target_user_id,
        v_row.card_id
      );

      update public.player_card_curses
      set
        is_active = true,
        expires_at = null,
        round_number = v_series.round_number,
        updated_at = now()
      where series_id = v_inventory.series_id
        and target_user_id = v_row.target_user_id
        and card_id = v_row.card_id
        and is_active = true;

      if not found then
        insert into public.player_card_curses (
          series_id,
          target_user_id,
          source_user_id,
          item_definition_id,
          card_id,
          effect_type,
          round_number,
          is_active,
          notes
        )
        values (
          v_inventory.series_id,
          v_row.target_user_id,
          v_actor_id,
          v_inventory.item_definition_id,
          v_row.card_id,
          'curse',
          v_series.round_number,
          true,
          format('item_use:%s', v_inventory.behavior_code)
        );
      end if;

      perform public._revalidate_active_deck(v_inventory.series_id, v_row.target_user_id);
    end loop;
  elsif v_inventory.behavior_code in (
    'steal_card_choose_opponent',
    'steal_card_random_opponent'
  ) then
    v_effect_key := lower(coalesce(v_inventory.item_code, v_inventory.behavior_code));
    v_target_user_id := nullif(coalesce(p_payload ->> 'target_user_id', ''), '')::uuid;

    if v_target_user_id is null then
      v_target_user_id := nullif(
        coalesce(
          public._get_inventory_item_use_session_payload(
            p_inventory_id,
            v_actor_id,
            v_effect_key
          ) ->> 'target_user_id',
          ''
        ),
        ''
      )::uuid;
    end if;

    if v_target_user_id is null then
      raise exception 'Select an opponent first';
    end if;

    if not public._is_hostile_target_eligible(v_inventory.series_id, v_actor_id, v_target_user_id) then
      raise exception 'That opponent is no longer eligible for this item';
    end if;

    select
      bc.id,
      bc.card_id
    into v_target
    from public.binder_cards bc
    where bc.id = nullif(coalesce(p_payload ->> 'binder_card_id', ''), '')::uuid
      and bc.user_id = v_target_user_id
      and bc.series_id = v_inventory.series_id
      and bc.quantity > 0
      and coalesce(bc.is_trade_locked, false) = false
      and not exists (
        select 1
        from public.player_card_vault_entries vault
        where vault.user_id = v_target_user_id
          and vault.series_id = v_inventory.series_id
          and vault.card_id = bc.card_id
      )
    for update;

    if not found then
      raise exception 'Select a valid opponent card to steal';
    end if;

    perform public._assert_dueling_card_quantity_available(
      v_inventory.series_id,
      v_target_user_id,
      v_target.card_id,
      1
    );

    perform public._transfer_binder_cards(
      v_target.id,
      v_actor_id,
      1,
      false
    );
  elsif v_inventory.behavior_code = 'steal_card_all_opponents' then
    v_effect_key := lower(coalesce(v_inventory.item_code, v_inventory.behavior_code));

    for v_row in
      select
        selection_rows.target_user_id,
        selection_rows.binder_card_id
      from jsonb_to_recordset(coalesce(p_payload -> 'targets', '[]'::jsonb))
        as selection_rows(target_user_id uuid, binder_card_id uuid)
    loop
      if v_row.target_user_id is null or v_row.binder_card_id is null then
        raise exception 'Choose one card from every opponent';
      end if;

      if not public._is_hostile_target_eligible(
        v_inventory.series_id,
        v_actor_id,
        v_row.target_user_id
      ) then
        raise exception 'One of the selected opponents is no longer eligible';
      end if;

      select
        bc.id,
        bc.card_id
      into v_target
      from public.binder_cards bc
      where bc.id = v_row.binder_card_id
        and bc.user_id = v_row.target_user_id
        and bc.series_id = v_inventory.series_id
        and bc.quantity > 0
        and coalesce(bc.is_trade_locked, false) = false
        and not exists (
          select 1
          from public.player_card_vault_entries vault
          where vault.user_id = v_row.target_user_id
            and vault.series_id = v_inventory.series_id
            and vault.card_id = bc.card_id
        )
      for update;

      if not found then
        raise exception 'One of the selected cards is no longer available';
      end if;

      perform public._assert_dueling_card_quantity_available(
        v_inventory.series_id,
        v_row.target_user_id,
        v_target.card_id,
        1
      );

      perform public._transfer_binder_cards(
        v_target.id,
        v_actor_id,
        1,
        false
      );
    end loop;
  elsif v_inventory.behavior_code in (
    'extract_card_choose_opponent',
    'extract_card_random_opponent'
  ) then
    v_effect_key := lower(coalesce(v_inventory.item_code, v_inventory.behavior_code));
    v_target_user_id := nullif(coalesce(p_payload ->> 'target_user_id', ''), '')::uuid;

    if v_target_user_id is null then
      v_target_user_id := nullif(
        coalesce(
          public._get_inventory_item_use_session_payload(
            p_inventory_id,
            v_actor_id,
            v_effect_key
          ) ->> 'target_user_id',
          ''
        ),
        ''
      )::uuid;
    end if;

    v_card_id := nullif(coalesce(p_payload ->> 'card_id', ''), '')::bigint;

    if v_target_user_id is null then
      raise exception 'Select an opponent first';
    end if;

    if v_card_id is null then
      raise exception 'Select a card name to extract';
    end if;

    if not public._is_hostile_target_eligible(v_inventory.series_id, v_actor_id, v_target_user_id) then
      raise exception 'That opponent is no longer eligible for this item';
    end if;

    if exists (
      select 1
      from public.binder_cards bc
      where bc.user_id = v_target_user_id
        and bc.series_id = v_inventory.series_id
        and bc.card_id = v_card_id
        and coalesce(bc.is_trade_locked, false) = true
    ) then
      raise exception 'That card family has trade-locked copies and cannot be extracted right now';
    end if;

    select coalesce(sum(bc.quantity), 0)::integer
    into v_total_quantity
    from public.binder_cards bc
    where bc.user_id = v_target_user_id
      and bc.series_id = v_inventory.series_id
      and bc.card_id = v_card_id
      and not exists (
        select 1
        from public.player_card_vault_entries vault
        where vault.user_id = v_target_user_id
          and vault.series_id = v_inventory.series_id
          and vault.card_id = bc.card_id
      );

    if v_total_quantity <= 0 then
      raise exception 'That card family is no longer available in that binder';
    end if;

    perform public._assert_dueling_card_quantity_available(
      v_inventory.series_id,
      v_target_user_id,
      v_card_id,
      v_total_quantity
    );

    delete from public.binder_cards bc
    where bc.user_id = v_target_user_id
      and bc.series_id = v_inventory.series_id
      and bc.card_id = v_card_id
      and not exists (
        select 1
        from public.player_card_vault_entries vault
        where vault.user_id = v_target_user_id
          and vault.series_id = v_inventory.series_id
          and vault.card_id = bc.card_id
      );
  elsif v_inventory.behavior_code = 'extract_card_all_opponents' then
    v_effect_key := lower(coalesce(v_inventory.item_code, v_inventory.behavior_code));

    for v_row in
      select
        selection_rows.target_user_id,
        selection_rows.card_id
      from jsonb_to_recordset(coalesce(p_payload -> 'targets', '[]'::jsonb))
        as selection_rows(target_user_id uuid, card_id bigint)
    loop
      if v_row.target_user_id is null or v_row.card_id is null then
        raise exception 'Choose one card name from every opponent';
      end if;

      if not public._is_hostile_target_eligible(
        v_inventory.series_id,
        v_actor_id,
        v_row.target_user_id
      ) then
        raise exception 'One of the selected opponents is no longer eligible';
      end if;

      if exists (
        select 1
        from public.binder_cards bc
        where bc.user_id = v_row.target_user_id
          and bc.series_id = v_inventory.series_id
          and bc.card_id = v_row.card_id
          and coalesce(bc.is_trade_locked, false) = true
      ) then
        raise exception 'One of the selected card families has trade-locked copies and cannot be extracted';
      end if;

      select coalesce(sum(bc.quantity), 0)::integer
      into v_total_quantity
      from public.binder_cards bc
      where bc.user_id = v_row.target_user_id
        and bc.series_id = v_inventory.series_id
        and bc.card_id = v_row.card_id
        and not exists (
          select 1
          from public.player_card_vault_entries vault
          where vault.user_id = v_row.target_user_id
            and vault.series_id = v_inventory.series_id
            and vault.card_id = bc.card_id
        );

      if v_total_quantity <= 0 then
        raise exception 'One of the selected card families is no longer available';
      end if;

      perform public._assert_dueling_card_quantity_available(
        v_inventory.series_id,
        v_row.target_user_id,
        v_row.card_id,
        v_total_quantity
      );

      delete from public.binder_cards bc
      where bc.user_id = v_row.target_user_id
        and bc.series_id = v_inventory.series_id
        and bc.card_id = v_row.card_id
        and not exists (
          select 1
          from public.player_card_vault_entries vault
          where vault.user_id = v_row.target_user_id
            and vault.series_id = v_inventory.series_id
            and vault.card_id = bc.card_id
        );
    end loop;

  elsif v_inventory.behavior_code in (
    'forced_exchange_choose_opponent',
    'forced_exchange_random_opponent'
  ) then
    v_effect_key := lower(coalesce(v_inventory.item_code, v_inventory.behavior_code));
    v_target_user_id := nullif(coalesce(p_payload ->> 'target_user_id', ''), '')::uuid;

    if v_target_user_id is null then
      v_target_user_id := nullif(
        coalesce(
          public._get_inventory_item_use_session_payload(
            p_inventory_id,
            v_actor_id,
            v_effect_key
          ) ->> 'target_user_id',
          ''
        ),
        ''
      )::uuid;
    end if;

    if v_target_user_id is null then
      raise exception 'Select an opponent first';
    end if;

    if not public._is_hostile_target_eligible(v_inventory.series_id, v_actor_id, v_target_user_id) then
      raise exception 'That opponent is no longer eligible for this item';
    end if;

    select coalesce(sum(quantity), 0)::integer
    into v_take_count
    from jsonb_to_recordset(coalesce(p_payload -> 'take_selections', '[]'::jsonb))
      as take_rows(binder_card_id uuid, quantity integer);

    select coalesce(sum(quantity), 0)::integer
    into v_give_count
    from jsonb_to_recordset(coalesce(p_payload -> 'give_selections', '[]'::jsonb))
      as give_rows(binder_card_id uuid, quantity integer);

    if v_take_count <> 2 or v_give_count <> 2 then
      raise exception 'Forced Exchange requires exactly 2 cards taken and 2 cards given';
    end if;

    select array_agg(selection_rows.rarity_sort_order order by selection_rows.rarity_sort_order)
    into v_take_tiers
    from (
      select
        coalesce(r.sort_order, 9999) as rarity_sort_order
      from jsonb_to_recordset(coalesce(p_payload -> 'take_selections', '[]'::jsonb))
        as take_rows(binder_card_id uuid, quantity integer)
      join public.binder_cards bc
        on bc.id = take_rows.binder_card_id
      left join public.card_rarities r
        on r.id = bc.rarity_id
      where bc.user_id = v_target_user_id
        and bc.series_id = v_inventory.series_id
        and coalesce(bc.is_trade_locked, false) = false
        and bc.quantity >= greatest(coalesce(take_rows.quantity, 1), 1)
        and not exists (
          select 1
          from public.player_card_vault_entries vault
          where vault.user_id = v_target_user_id
            and vault.series_id = v_inventory.series_id
            and vault.card_id = bc.card_id
        )
    ) selection_rows;

    select array_agg(selection_rows.rarity_sort_order order by selection_rows.rarity_sort_order)
    into v_give_tiers
    from (
      select
        coalesce(r.sort_order, 9999) as rarity_sort_order
      from jsonb_to_recordset(coalesce(p_payload -> 'give_selections', '[]'::jsonb))
        as give_rows(binder_card_id uuid, quantity integer)
      join public.binder_cards bc
        on bc.id = give_rows.binder_card_id
      left join public.card_rarities r
        on r.id = bc.rarity_id
      where bc.user_id = v_actor_id
        and bc.series_id = v_inventory.series_id
        and coalesce(bc.is_trade_locked, false) = false
        and bc.quantity >= greatest(coalesce(give_rows.quantity, 1), 1)
        and not exists (
          select 1
          from public.player_card_vault_entries vault
          where vault.user_id = v_actor_id
            and vault.series_id = v_inventory.series_id
            and vault.card_id = bc.card_id
        )
    ) selection_rows;

    if coalesce(array_length(v_take_tiers, 1), 0) <> 2
      or coalesce(array_length(v_give_tiers, 1), 0) <> 2 then
      raise exception 'All selected cards must still be available';
    end if;

    while v_index <= 2 loop
      if v_give_tiers[v_index] < v_take_tiers[v_index] then
        raise exception 'You cannot give a lower rarity than what you are taking';
      end if;

      v_index := v_index + 1;
    end loop;

    for v_row in
      select
        bc.card_id,
        sum(greatest(coalesce(take_rows.quantity, 1), 1))::integer as removed_quantity
      from jsonb_to_recordset(coalesce(p_payload -> 'take_selections', '[]'::jsonb))
        as take_rows(binder_card_id uuid, quantity integer)
      join public.binder_cards bc
        on bc.id = take_rows.binder_card_id
      where bc.user_id = v_target_user_id
        and bc.series_id = v_inventory.series_id
      group by bc.card_id
    loop
      perform public._assert_dueling_card_quantity_available(
        v_inventory.series_id,
        v_target_user_id,
        v_row.card_id,
        v_row.removed_quantity
      );
    end loop;

    for v_row in
      select
        bc.card_id,
        sum(greatest(coalesce(give_rows.quantity, 1), 1))::integer as removed_quantity
      from jsonb_to_recordset(coalesce(p_payload -> 'give_selections', '[]'::jsonb))
        as give_rows(binder_card_id uuid, quantity integer)
      join public.binder_cards bc
        on bc.id = give_rows.binder_card_id
      where bc.user_id = v_actor_id
        and bc.series_id = v_inventory.series_id
      group by bc.card_id
    loop
      perform public._assert_dueling_card_quantity_available(
        v_inventory.series_id,
        v_actor_id,
        v_row.card_id,
        v_row.removed_quantity
      );
    end loop;

    for v_row in
      select
        take_rows.binder_card_id,
        greatest(coalesce(take_rows.quantity, 1), 1) as quantity
      from jsonb_to_recordset(coalesce(p_payload -> 'take_selections', '[]'::jsonb))
        as take_rows(binder_card_id uuid, quantity integer)
    loop
      perform public._transfer_binder_cards(
        v_row.binder_card_id,
        v_actor_id,
        v_row.quantity,
        false
      );
    end loop;

    for v_row in
      select
        give_rows.binder_card_id,
        greatest(coalesce(give_rows.quantity, 1), 1) as quantity
      from jsonb_to_recordset(coalesce(p_payload -> 'give_selections', '[]'::jsonb))
        as give_rows(binder_card_id uuid, quantity integer)
    loop
      perform public._transfer_binder_cards(
        v_row.binder_card_id,
        v_target_user_id,
        v_row.quantity,
        false
      );
    end loop;

  else
    raise exception 'This item still needs a dedicated use modal and backend flow before it can be consumed';
  end if;

  perform public._consume_inventory_item(p_inventory_id, 1);
  perform public._mark_inventory_item_use_session_used(p_inventory_id, v_actor_id);

  return jsonb_build_object(
    'success', true,
    'effect_key', v_effect_key,
    'item_name', v_inventory.item_name
  );
end;
$function$;

create or replace function public._get_inventory_item_use_session_payload(
  p_inventory_id uuid,
  p_user_id uuid,
  p_effect_key text default null
)
returns jsonb
language sql
security definer
set search_path to 'public', 'auth'
as $$
  select resolved_payload
  from public.player_inventory_item_use_sessions session_rows
  where session_rows.inventory_id = p_inventory_id
    and session_rows.user_id = p_user_id
    and session_rows.used_at is null
    and session_rows.expires_at > now()
    and (
      p_effect_key is null
      or session_rows.effect_key = p_effect_key
    )
  order by session_rows.updated_at desc
  limit 1;
$$;

create or replace function public._mark_inventory_item_use_session_used(
  p_inventory_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  update public.player_inventory_item_use_sessions
  set
    used_at = now(),
    updated_at = now()
  where inventory_id = p_inventory_id
    and user_id = p_user_id
    and used_at is null;
end;
$function$;

create or replace function public._consume_inventory_item(
  p_inventory_id uuid,
  p_quantity integer default 1
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_inventory record;
  v_remaining integer := 0;
begin
  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'Consumed quantity must be greater than 0';
  end if;

  select *
  into v_inventory
  from public.player_inventory pi
  where pi.id = p_inventory_id
  for update;

  if not found then
    raise exception 'Inventory item not found';
  end if;

  if (v_inventory.quantity - v_inventory.locked_quantity) < p_quantity then
    raise exception 'No available quantity remains for this item';
  end if;

  update public.player_inventory
  set
    quantity = quantity - p_quantity,
    updated_at = now()
  where id = p_inventory_id
  returning quantity into v_remaining;

  if coalesce(v_remaining, 0) <= 0 then
    delete from public.player_inventory
    where id = p_inventory_id;

    v_remaining := 0;
  end if;

  return v_remaining;
end;
$function$;

create or replace function public._feature_slot_mode(
  p_slot_type text,
  p_slot_name text
)
returns text
language plpgsql
immutable
as $function$
declare
  v_slot_type text := lower(coalesce(p_slot_type, ''));
  v_slot_name text := lower(coalesce(p_slot_name, ''));
begin
  if v_slot_type like '%draft%' or v_slot_name like '%draft%' then
    return 'drafted';
  end if;

  if v_slot_type like '%picker%' or v_slot_name like '%picker%' then
    return 'picker';
  end if;

  if v_slot_type like '%regen%' or v_slot_name like '%regen%' then
    return 'regen';
  end if;

  if v_slot_type like '%boost%' or v_slot_name like '%boost%' then
    return 'boosted';
  end if;

  return 'drafted';
end;
$function$;

create or replace function public._feature_slot_random_rarity(
  p_rarity_boosts integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_roll numeric := random();
  v_cursor numeric := 0;
  v_total_weight numeric := 0;
  v_index integer := 0;
  v_selected jsonb := '{}'::jsonb;
  v_row record;
begin
  if coalesce(p_rarity_boosts, 0) <= 0 then
    select jsonb_build_object(
      'id', r.id,
      'name', r.name
    )
    into v_selected
    from public.card_rarities r
    order by coalesce(r.sort_order, 9999), r.name
    limit 1;

    return coalesce(v_selected, '{}'::jsonb);
  end if;

  for v_row in
    select r.id, r.name, power(0.5::numeric, row_number() over (
      order by coalesce(r.sort_order, 9999), r.name
    ) - 1) as weight
    from public.card_rarities r
    order by coalesce(r.sort_order, 9999), r.name
    limit greatest(p_rarity_boosts, 0) + 1
  loop
    v_total_weight := v_total_weight + v_row.weight;
  end loop;

  if v_total_weight <= 0 then
    return '{}'::jsonb;
  end if;

  for v_row in
    select r.id, r.name, power(0.5::numeric, row_number() over (
      order by coalesce(r.sort_order, 9999), r.name
    ) - 1) as weight
    from public.card_rarities r
    order by coalesce(r.sort_order, 9999), r.name
    limit greatest(p_rarity_boosts, 0) + 1
  loop
    v_cursor := v_cursor + (v_row.weight / v_total_weight);
    v_index := v_index + 1;

    if v_roll <= v_cursor or v_index = greatest(p_rarity_boosts, 0) + 1 then
      v_selected := jsonb_build_object(
        'id', v_row.id,
        'name', v_row.name
      );
      exit;
    end if;
  end loop;

  return coalesce(v_selected, '{}'::jsonb);
end;
$function$;

create or replace function public._feature_slot_offer_cards(
  p_count integer,
  p_picker_category text default null,
  p_rarity_boosts integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_cards jsonb := '[]'::jsonb;
  v_row record;
  v_rarity jsonb;
begin
  for v_row in
    with picked as (
      select
        c.id,
        c.name,
        c.type,
        c.attribute,
        c.race,
        c.level,
        c.atk,
        c.def
      from public.cards c
      where (
        p_picker_category is null
        or lower(trim(p_picker_category)) = ''
        or lower(trim(p_picker_category)) = 'all'
        or (
          lower(trim(p_picker_category)) = 'monster'
          and (coalesce(c.type, 0) & 1) = 1
          and (coalesce(c.type, 0) & 64) = 0
          and (coalesce(c.type, 0) & 8192) = 0
          and (coalesce(c.type, 0) & 8388608) = 0
          and (coalesce(c.type, 0) & 67108864) = 0
        )
        or (
          lower(trim(p_picker_category)) = 'spell'
          and (coalesce(c.type, 0) & 2) = 2
        )
        or (
          lower(trim(p_picker_category)) = 'trap'
          and (coalesce(c.type, 0) & 4) = 4
        )
        or (
          lower(trim(p_picker_category)) = 'extra'
          and (
            (coalesce(c.type, 0) & 64) = 64
            or (coalesce(c.type, 0) & 8192) = 8192
            or (coalesce(c.type, 0) & 8388608) = 8388608
            or (coalesce(c.type, 0) & 67108864) = 67108864
          )
        )
      )
      order by random()
      limit greatest(coalesce(p_count, 1), 1)
    )
    select *
    from picked
  loop
    v_rarity := public._feature_slot_random_rarity(coalesce(p_rarity_boosts, 0));

    v_cards := v_cards || jsonb_build_array(
      jsonb_build_object(
        'card_id', v_row.id,
        'card_name', v_row.name,
        'type', v_row.type,
        'attribute', v_row.attribute,
        'race', v_row.race,
        'level', v_row.level,
        'atk', v_row.atk,
        'def', v_row.def,
        'rarity_id', v_rarity ->> 'id',
        'rarity_name', v_rarity ->> 'name'
      )
    );
  end loop;

  return coalesce(v_cards, '[]'::jsonb);
end;
$function$;

create or replace function public._feature_slot_grant_card(
  p_series_id uuid,
  p_user_id uuid,
  p_card_id bigint,
  p_rarity_id uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_base_rarity_id uuid;
begin
  select r.id
  into v_base_rarity_id
  from public.card_rarities r
  order by coalesce(r.sort_order, 9999), r.name
  limit 1;

  if coalesce(p_rarity_id, v_base_rarity_id) is null then
    raise exception 'A base rarity must exist before slot rewards can be granted';
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
    p_user_id,
    p_series_id,
    p_card_id,
    coalesce(p_rarity_id, v_base_rarity_id),
    1,
    false
  )
  on conflict (user_id, series_id, card_id, rarity_id)
  do update set
    quantity = public.binder_cards.quantity + 1,
    updated_at = now();
end;
$function$;

create or replace function public._deduct_feature_slot_wallet_costs(
  p_series_id uuid,
  p_user_id uuid,
  p_feature_coin_cost integer,
  p_shard_cost integer
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_wallet record;
begin
  select *
  into v_wallet
  from public.player_wallets w
  where w.user_id = p_user_id
    and w.series_id = p_series_id
  for update;

  if not found then
    raise exception 'Wallet not found';
  end if;

  if coalesce(v_wallet.feature_coins, 0) < greatest(coalesce(p_feature_coin_cost, 0), 0) then
    raise exception 'Not enough Feature Coins';
  end if;

  if coalesce(v_wallet.shards, 0) < greatest(coalesce(p_shard_cost, 0), 0) then
    raise exception 'Not enough shards';
  end if;

  update public.player_wallets
  set
    feature_coins = feature_coins - greatest(coalesce(p_feature_coin_cost, 0), 0),
    shards = shards - greatest(coalesce(p_shard_cost, 0), 0),
    updated_at = now()
  where user_id = p_user_id
    and series_id = p_series_id;
end;
$function$;

create or replace function public._refund_feature_slot_shards(
  p_series_id uuid,
  p_user_id uuid,
  p_refund_amount integer
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  if coalesce(p_refund_amount, 0) <= 0 then
    return;
  end if;

  update public.player_wallets
  set
    shards = shards + p_refund_amount,
    updated_at = now()
  where user_id = p_user_id
    and series_id = p_series_id;
end;
$function$;

create or replace function public._card_is_in_player_current_duel_snapshot(
  p_series_id uuid,
  p_user_id uuid,
  p_card_id bigint
)
returns boolean
language sql
security definer
set search_path to 'public', 'auth'
as $$
  with current_series as (
    select
      gs.current_phase,
      gs.round_number,
      public._progression_round_step_value(gs.round_step) as round_step
    from public.game_series gs
    where gs.id = p_series_id
  )
  select exists (
    select 1
    from current_series series_rows
    join public.series_round_deck_snapshots snapshot_rows
      on snapshot_rows.series_id = p_series_id
     and snapshot_rows.user_id = p_user_id
     and snapshot_rows.round_number = series_rows.round_number
     and snapshot_rows.round_step = series_rows.round_step
    join public.series_round_deck_snapshot_cards snapshot_cards
      on snapshot_cards.snapshot_id = snapshot_rows.id
    where series_rows.current_phase = 'dueling'
      and snapshot_cards.card_id = p_card_id
      and snapshot_cards.quantity > 0
  );
$$;

create or replace function public._card_is_in_any_current_duel_snapshot(
  p_series_id uuid,
  p_card_id bigint
)
returns boolean
language sql
security definer
set search_path to 'public', 'auth'
as $$
  with current_series as (
    select
      gs.current_phase,
      gs.round_number,
      public._progression_round_step_value(gs.round_step) as round_step
    from public.game_series gs
    where gs.id = p_series_id
  )
  select exists (
    select 1
    from current_series series_rows
    join public.series_round_deck_snapshots snapshot_rows
      on snapshot_rows.series_id = p_series_id
     and snapshot_rows.round_number = series_rows.round_number
     and snapshot_rows.round_step = series_rows.round_step
    join public.series_round_deck_snapshot_cards snapshot_cards
      on snapshot_cards.snapshot_id = snapshot_rows.id
    where series_rows.current_phase = 'dueling'
      and snapshot_cards.card_id = p_card_id
      and snapshot_cards.quantity > 0
  );
$$;

create or replace function public._assert_duel_snapshot_card_not_targeted(
  p_series_id uuid,
  p_target_user_id uuid,
  p_card_id bigint
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  if public._card_is_in_player_current_duel_snapshot(
    p_series_id,
    p_target_user_id,
    p_card_id
  ) then
    raise exception 'This card is locked by that player''s duel deck for the current round';
  end if;
end;
$function$;

create or replace function public._assert_duel_snapshot_card_not_globally_targeted(
  p_series_id uuid,
  p_card_id bigint
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  if public._card_is_in_any_current_duel_snapshot(
    p_series_id,
    p_card_id
  ) then
    raise exception 'That card is locked by an active duel deck for the current round';
  end if;
end;
$function$;

create or replace function public._set_series_banlist_card_status(
  p_series_id uuid,
  p_card_id bigint,
  p_status text,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  if p_card_id is null then
    raise exception 'Card is required';
  end if;

  if p_status is null or lower(trim(p_status)) not in (
    'forbidden',
    'limited',
    'semi_limited',
    'unlimited'
  ) then
    raise exception 'Unsupported banlist status';
  end if;

  insert into public.series_banlist_cards (
    series_id,
    card_id,
    status,
    notes
  )
  values (
    p_series_id,
    p_card_id,
    lower(trim(p_status)),
    p_notes
  )
  on conflict (series_id, card_id)
  do update set
    status = excluded.status,
    notes = excluded.notes;
end;
$function$;

create or replace function public._validate_player_deck_for_progression(
  p_series_id uuid,
  p_user_id uuid,
  p_deck_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_main_count integer := 0;
  v_extra_count integer := 0;
  v_side_count integer := 0;
  v_is_valid boolean := true;
  v_summary text := 'Valid';
  v_card_usage record;
  v_owned_quantity integer := 0;
  v_banlist_status text := 'unlimited';
  v_banlist_limit integer := 3;
begin
  if p_deck_id is null then
    return jsonb_build_object(
      'is_valid', false,
      'summary', 'You need an active deck before readying up',
      'main_count', 0,
      'extra_count', 0,
      'side_count', 0
    );
  end if;

  select coalesce(sum(case when pdc.section = 'main' then pdc.quantity else 0 end), 0)::integer,
         coalesce(sum(case when pdc.section = 'extra' then pdc.quantity else 0 end), 0)::integer,
         coalesce(sum(case when pdc.section = 'side' then pdc.quantity else 0 end), 0)::integer
  into v_main_count, v_extra_count, v_side_count
  from public.player_deck_cards pdc
  where pdc.deck_id = p_deck_id;

  for v_card_usage in
    select
      pdc.card_id,
      coalesce(sum(pdc.quantity), 0)::integer as total_used,
      coalesce(c.name, format('Card %s', pdc.card_id)) as card_name
    from public.player_deck_cards pdc
    left join public.cards c
      on c.id = pdc.card_id
    where pdc.deck_id = p_deck_id
    group by pdc.card_id, c.name
    order by coalesce(c.name, format('Card %s', pdc.card_id))
  loop
    select coalesce(sum(bc.quantity), 0)::integer
    into v_owned_quantity
    from public.binder_cards bc
    where bc.user_id = p_user_id
      and bc.series_id = p_series_id
      and bc.card_id = v_card_usage.card_id
      and not exists (
        select 1
        from public.player_card_vault_entries vault
        where vault.user_id = p_user_id
          and vault.series_id = p_series_id
          and vault.card_id = bc.card_id
      );

    if v_owned_quantity <= 0 and v_card_usage.total_used > 0 then
      v_is_valid := false;
      v_summary := format('Invalid - card no longer owned in binder: %s', v_card_usage.card_name);
      exit;
    end if;

    if v_card_usage.total_used > v_owned_quantity then
      v_is_valid := false;
      v_summary := format('Invalid - card no longer owned in enough quantity: %s', v_card_usage.card_name);
      exit;
    end if;

    select coalesce(b.status, 'unlimited')
    into v_banlist_status
    from public.series_banlist_cards b
    where b.series_id = p_series_id
      and b.card_id = v_card_usage.card_id
    limit 1;

    v_banlist_limit := case coalesce(v_banlist_status, 'unlimited')
      when 'forbidden' then 0
      when 'limited' then 1
      when 'semi_limited' then 2
      else 3
    end;

    if v_card_usage.total_used > v_banlist_limit then
      v_is_valid := false;
      v_summary := format('Invalid - banlist limit reached: %s', v_card_usage.card_name);
      exit;
    end if;

    if exists (
      select 1
      from public.player_card_curses curse
      where curse.series_id = p_series_id
        and curse.target_user_id = p_user_id
        and curse.card_id = v_card_usage.card_id
        and curse.is_active = true
    ) then
      v_is_valid := false;
      v_summary := format('Invalid - cursed card present: %s', v_card_usage.card_name);
      exit;
    end if;
  end loop;

  if v_is_valid and v_main_count < 40 then
    v_is_valid := false;
    v_summary := format(
      'Invalid - main deck must have at least 40 cards (currently %s)',
      v_main_count
    );
  end if;

  if v_is_valid and v_main_count > 60 then
    v_is_valid := false;
    v_summary := format(
      'Invalid - main deck exceeds maximum of 60 cards (currently %s)',
      v_main_count
    );
  end if;

  if v_is_valid and v_extra_count > 15 then
    v_is_valid := false;
    v_summary := format(
      'Invalid - extra deck exceeds maximum of 15 cards (currently %s)',
      v_extra_count
    );
  end if;

  if v_is_valid and v_side_count > 15 then
    v_is_valid := false;
    v_summary := format(
      'Invalid - side deck exceeds maximum of 15 cards (currently %s)',
      v_side_count
    );
  end if;

  update public.player_decks
  set
    is_valid = v_is_valid,
    validation_summary = v_summary,
    updated_at = now()
  where id = p_deck_id;

  return jsonb_build_object(
    'is_valid', v_is_valid,
    'summary', v_summary,
    'main_count', v_main_count,
    'extra_count', v_extra_count,
    'side_count', v_side_count
  );
end;
$function$;

create or replace function public._sync_active_deck_after_card_visibility_change(
  p_series_id uuid,
  p_user_id uuid,
  p_card_id bigint
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_active_deck_id uuid;
  v_visible_owned integer := 0;
  v_total_used integer := 0;
  v_excess integer := 0;
  v_section record;
  v_section_quantity integer := 0;
  v_to_remove integer := 0;
begin
  if p_series_id is null or p_user_id is null or p_card_id is null then
    return;
  end if;

  select d.id
  into v_active_deck_id
  from public.player_decks d
  where d.series_id = p_series_id
    and d.user_id = p_user_id
    and d.is_active = true
  limit 1;

  if v_active_deck_id is null then
    return;
  end if;

  select coalesce(sum(bc.quantity), 0)::integer
  into v_visible_owned
  from public.binder_cards bc
  where bc.user_id = p_user_id
    and bc.series_id = p_series_id
    and bc.card_id = p_card_id
    and not exists (
      select 1
      from public.player_card_vault_entries vault
      where vault.user_id = p_user_id
        and vault.series_id = p_series_id
        and vault.card_id = bc.card_id
    );

  select coalesce(sum(pdc.quantity), 0)::integer
  into v_total_used
  from public.player_deck_cards pdc
  where pdc.deck_id = v_active_deck_id
    and pdc.card_id = p_card_id;

  v_excess := greatest(v_total_used - v_visible_owned, 0);

  if v_excess > 0 then
    for v_section in
      select section_order.section_name
      from (
        values
          ('side', 1),
          ('extra', 2),
          ('main', 3)
      ) as section_order(section_name, display_order)
      order by section_order.display_order
    loop
      exit when v_excess <= 0;

      select coalesce(pdc.quantity, 0)
      into v_section_quantity
      from public.player_deck_cards pdc
      where pdc.deck_id = v_active_deck_id
        and pdc.card_id = p_card_id
        and pdc.section = v_section.section_name
      limit 1;

      if coalesce(v_section_quantity, 0) <= 0 then
        continue;
      end if;

      v_to_remove := least(v_section_quantity, v_excess);

      update public.player_deck_cards
      set quantity = quantity - v_to_remove
      where deck_id = v_active_deck_id
        and card_id = p_card_id
        and section = v_section.section_name;

      delete from public.player_deck_cards
      where deck_id = v_active_deck_id
        and card_id = p_card_id
        and section = v_section.section_name
        and quantity <= 0;

      v_excess := v_excess - v_to_remove;
    end loop;
  end if;

  perform public._validate_player_deck_for_progression(
    p_series_id,
    p_user_id,
    v_active_deck_id
  );
end;
$function$;

create or replace function public._handle_binder_card_visibility_change()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  if tg_op = 'DELETE' then
    perform public._sync_active_deck_after_card_visibility_change(
      old.series_id,
      old.user_id,
      old.card_id
    );
    return old;
  end if;

  perform public._sync_active_deck_after_card_visibility_change(
    new.series_id,
    new.user_id,
    new.card_id
  );

  if tg_op = 'UPDATE'
    and (
      old.card_id is distinct from new.card_id
      or old.user_id is distinct from new.user_id
      or old.series_id is distinct from new.series_id
    ) then
    perform public._sync_active_deck_after_card_visibility_change(
      old.series_id,
      old.user_id,
      old.card_id
    );
  end if;

  return new;
end;
$function$;

create or replace function public._handle_vault_card_visibility_change()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  if tg_op = 'DELETE' then
    perform public._sync_active_deck_after_card_visibility_change(
      old.series_id,
      old.user_id,
      old.card_id
    );
    return old;
  end if;

  perform public._sync_active_deck_after_card_visibility_change(
    new.series_id,
    new.user_id,
    new.card_id
  );

  return new;
end;
$function$;

drop trigger if exists trg_binder_card_visibility_change on public.binder_cards;
create trigger trg_binder_card_visibility_change
after insert or update or delete on public.binder_cards
for each row execute function public._handle_binder_card_visibility_change();

drop trigger if exists trg_vault_card_visibility_change on public.player_card_vault_entries;
create trigger trg_vault_card_visibility_change
after insert or delete on public.player_card_vault_entries
for each row execute function public._handle_vault_card_visibility_change();

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

  update public.player_card_curses
  set
    is_active = false,
    expires_at = coalesce(expires_at, now()),
    updated_at = now()
  where series_id = p_series_id
    and is_active = true;
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
  v_dueling_status text := 'idle';
begin
  if public._progression_can_bypass(p_user_id) then
    return;
  end if;

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

  if v_series.current_phase = 'deckbuilding' then
    raise exception 'Items cannot be used during Deckbuilding Phase';
  end if;

  if v_series.current_phase = 'dueling' then
    v_dueling_status := public._get_player_dueling_status(p_series_id, p_user_id);

    if v_dueling_status in ('red', 'yellow') then
      raise exception 'Items cannot be used until your duel state resolves';
    end if;

    return;
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
  v_targets jsonb := '[]'::jsonb;
  v_resolved_targets jsonb := '[]'::jsonb;
  v_random_target jsonb := '{}'::jsonb;
  v_session_payload jsonb := '{}'::jsonb;
  v_session_id uuid := null;
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
  elsif v_item.behavior_code = 'apply_random_banlist_to_all_opponents' then
    v_action_kind := 'hostile_confirm';
    v_effect_key := 'chaos_verdict';
    v_resolved_targets := public._hostile_target_pool_json(v_item.series_id, v_actor_id);
  elsif v_item.behavior_code in (
    'set_banlist_forbidden',
    'set_banlist_limited',
    'set_banlist_semi_limited',
    'set_banlist_unlimited'
  ) then
    v_action_kind := 'banlist_search';
    v_effect_key := lower(coalesce(v_item.code, v_item.behavior_code));
  elsif v_item.behavior_code in (
    'black_market_ticket',
    'black_market_card'
  ) then
    v_action_kind := 'black_market_pick';
    v_effect_key := lower(coalesce(v_item.code, v_item.behavior_code));
  elsif v_item.behavior_code in (
    'curse_cards_choose_opponent',
    'steal_card_choose_opponent',
    'extract_card_choose_opponent'
  ) then
    v_action_kind := 'opponent_card_picker';
    v_effect_key := lower(coalesce(v_item.code, v_item.behavior_code));
    v_targets := public._hostile_target_pool_json(v_item.series_id, v_actor_id);
  elsif v_item.behavior_code = 'forced_exchange_choose_opponent' then
    v_action_kind := 'forced_exchange';
    v_effect_key := lower(coalesce(v_item.code, v_item.behavior_code));
    v_targets := public._hostile_target_pool_json(v_item.series_id, v_actor_id);
  elsif v_item.behavior_code in (
    'curse_cards_random_opponent',
    'steal_card_random_opponent',
    'extract_card_random_opponent',
    'forced_exchange_random_opponent'
  ) then
    v_action_kind := case
      when v_item.behavior_code = 'forced_exchange_random_opponent' then 'forced_exchange'
      else 'opponent_card_picker'
    end;
    v_effect_key := lower(coalesce(v_item.code, v_item.behavior_code));
    v_session_payload := coalesce(
      public._get_inventory_item_use_session_payload(p_inventory_id, v_actor_id, v_effect_key),
      '{}'::jsonb
    );

    if coalesce(v_session_payload ->> 'target_user_id', '') <> '' then
      v_random_target := (
        select coalesce(target_rows.value, '{}'::jsonb)
        from jsonb_array_elements(public._hostile_target_pool_json(v_item.series_id, v_actor_id)) target_rows
        where target_rows.value ->> 'user_id' = v_session_payload ->> 'target_user_id'
        limit 1
      );
    end if;

    if coalesce(v_random_target, '{}'::jsonb) = '{}'::jsonb then
      v_random_target := public._pick_random_hostile_target(v_item.series_id, v_actor_id);
      if coalesce(v_random_target, '{}'::jsonb) <> '{}'::jsonb then
        v_session_id := public._upsert_inventory_item_use_session(
          v_item.id,
          v_item.series_id,
          v_actor_id,
          v_item.item_definition_id,
          v_effect_key,
          jsonb_build_object('target_user_id', v_random_target ->> 'user_id')
        );
      end if;
    end if;

    if coalesce(v_random_target, '{}'::jsonb) <> '{}'::jsonb then
      v_resolved_targets := jsonb_build_array(v_random_target);
    end if;
  elsif v_item.behavior_code in (
    'curse_cards_all_opponents',
    'steal_card_all_opponents',
    'extract_card_all_opponents'
  ) then
    v_action_kind := 'multi_target_card_picker';
    v_effect_key := lower(coalesce(v_item.code, v_item.behavior_code));
    v_resolved_targets := public._hostile_target_pool_json(v_item.series_id, v_actor_id);
  end if;

  if (
    v_action_kind in ('hostile_confirm', 'opponent_card_picker', 'forced_exchange', 'multi_target_card_picker')
    and jsonb_array_length(v_targets) = 0
    and jsonb_array_length(v_resolved_targets) = 0
  ) then
    v_block_reason := coalesce(v_block_reason, 'No eligible opponents can be targeted right now');
  end if;

  if v_action_kind = 'black_market_pick' and not exists (
    select 1
    from public.series_banlist_cards ban_rows
    where ban_rows.series_id = v_item.series_id
      and coalesce(ban_rows.status, 'unlimited') <> 'unlimited'
  ) then
    v_block_reason := coalesce(v_block_reason, 'There are no currently banlisted cards to choose from');
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
    'protection_rounds_remaining', coalesce(v_protection.rounds_remaining, 0),
    'eligible_targets', v_targets,
    'resolved_targets', v_resolved_targets,
    'session_id', v_session_id
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
          'rounds_added', v_rounds_to_add
        )
      )
    )
    on conflict (series_id, user_id)
    do update set
      rounds_remaining = public.player_series_protections.rounds_remaining + excluded.rounds_remaining,
      source_summary = public.player_series_protections.source_summary || excluded.source_summary,
      updated_at = now();
  end if;

  perform public._consume_inventory_item(p_inventory_id, 1);
  perform public._mark_inventory_item_use_session_used(p_inventory_id, v_actor_id);

  return jsonb_build_object(
    'success', true,
    'effect_key', v_effect_key
  );
end;
$function$;

create or replace function public._build_feature_slot_machine_state(
  p_series_id uuid,
  p_user_id uuid,
  p_feature_slot_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_slot record;
  v_wallet record;
  v_usage record;
  v_session record;
begin
  select
    fs.*,
    public._feature_slot_mode(fs.slot_type, fs.name) as resolved_mode
  into v_slot
  from public.feature_slots fs
  where fs.id = p_feature_slot_id
    and coalesce(fs.is_enabled, true) = true;

  if not found then
    raise exception 'Feature Slot not found';
  end if;

  select *
  into v_wallet
  from public.player_wallets w
  where w.user_id = p_user_id
    and w.series_id = p_series_id;

  select *
  into v_usage
  from public.player_feature_slot_usage usage
  where usage.series_id = p_series_id
    and usage.user_id = p_user_id
    and usage.feature_slot_id = p_feature_slot_id;

  select *
  into v_session
  from public.player_feature_slot_sessions session_rows
  where session_rows.series_id = p_series_id
    and session_rows.user_id = p_user_id
    and session_rows.feature_slot_id = p_feature_slot_id
    and session_rows.status = 'open'
  order by session_rows.created_at desc
  limit 1;

  return jsonb_build_object(
    'series_id', p_series_id,
    'feature_slot_id', p_feature_slot_id,
    'name', v_slot.name,
    'description', v_slot.description,
    'slot_type', v_slot.slot_type,
    'slot_mode', v_slot.resolved_mode,
    'image_url', v_slot.image_url,
    'starting_choices', v_slot.starting_choices,
    'reroll_count', v_slot.reroll_count,
    'shard_cost_per_extra', v_slot.shard_cost_per_extra,
    'pool_mode', v_slot.pool_mode,
    'min_rarity_floor', v_slot.min_rarity_floor,
    'is_enabled', coalesce(v_slot.is_enabled, true),
    'is_locked', coalesce(v_slot.is_locked, false),
    'feature_coins', coalesce(v_wallet.feature_coins, 0),
    'shards', coalesce(v_wallet.shards, 0),
    'spin_count', coalesce(v_usage.spin_count, 0),
    'next_feature_coin_cost', coalesce(v_usage.spin_count, 0),
    'open_session',
      case
        when v_session.id is null then null
        else jsonb_build_object(
          'id', v_session.id,
          'slot_mode', v_session.slot_mode,
          'status', v_session.status,
          'selected_category', v_session.selected_category,
          'rerolls_remaining', v_session.rerolls_remaining,
          'current_choice_count', v_session.current_choice_count,
          'paid_feature_coin_cost', v_session.paid_feature_coin_cost,
          'paid_shard_cost', v_session.paid_shard_cost,
          'card_amount_boosts', v_session.card_amount_boosts,
          'rarity_boosts', v_session.rarity_boosts,
          'reveal_count', v_session.reveal_count,
          'offers', v_session.offers,
          'metadata', v_session.metadata
        )
      end
  );
end;
$function$;

create or replace function public.get_feature_slot_machine_state(
  p_series_id uuid,
  p_feature_slot_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
begin
  v_actor_id := public._assert_authenticated_user();
  perform public._assert_series_member(p_series_id, v_actor_id);

  return public._build_feature_slot_machine_state(
    p_series_id,
    v_actor_id,
    p_feature_slot_id
  );
end;
$function$;

create or replace function public.open_feature_slot_machine(
  p_series_id uuid,
  p_feature_slot_id uuid,
  p_selected_category text default null,
  p_card_amount_boosts integer default 0,
  p_rarity_boosts integer default 0,
  p_reveal_count integer default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_slot record;
  v_existing_session record;
  v_usage record;
  v_feature_coin_cost integer := 0;
  v_shard_cost integer := 0;
  v_offer_count integer := 0;
  v_metadata jsonb := '{}'::jsonb;
begin
  v_actor_id := public._assert_authenticated_user();
  perform public._assert_series_member(p_series_id, v_actor_id);
  perform public._assert_series_item_use_allowed(p_series_id, v_actor_id);

  select
    fs.*,
    public._feature_slot_mode(fs.slot_type, fs.name) as resolved_mode
  into v_slot
  from public.feature_slots fs
  where fs.id = p_feature_slot_id
  for update;

  if not found or not coalesce(v_slot.is_enabled, true) then
    raise exception 'Feature Slot not found';
  end if;

  if coalesce(v_slot.is_locked, false) then
    raise exception 'This Feature Slot is currently locked';
  end if;

  select *
  into v_existing_session
  from public.player_feature_slot_sessions session_rows
  where session_rows.series_id = p_series_id
    and session_rows.user_id = v_actor_id
    and session_rows.feature_slot_id = p_feature_slot_id
    and session_rows.status = 'open'
  for update;

  if found then
    return public._build_feature_slot_machine_state(
      p_series_id,
      v_actor_id,
      p_feature_slot_id
    );
  end if;

  select *
  into v_usage
  from public.player_feature_slot_usage usage
  where usage.series_id = p_series_id
    and usage.user_id = v_actor_id
    and usage.feature_slot_id = p_feature_slot_id
  for update;

  v_feature_coin_cost := coalesce(v_usage.spin_count, 0);

  if v_slot.resolved_mode = 'drafted' then
    v_offer_count := 4;
  elsif v_slot.resolved_mode = 'picker' then
    if lower(trim(coalesce(p_selected_category, ''))) not in ('monster', 'spell', 'trap', 'extra') then
      raise exception 'Choose Monster, Spell, Trap, or Extra Deck first';
    end if;

    v_offer_count := 2;
    v_metadata := jsonb_build_object('selected_category', lower(trim(p_selected_category)));
  elsif v_slot.resolved_mode = 'boosted' then
    if coalesce(p_card_amount_boosts, 0) < 0 or coalesce(p_rarity_boosts, 0) < 0 then
      raise exception 'Boost values cannot be negative';
    end if;

    v_offer_count := 2 + coalesce(p_card_amount_boosts, 0);
    v_shard_cost := (coalesce(p_card_amount_boosts, 0) + coalesce(p_rarity_boosts, 0)) * 10;
    v_metadata := jsonb_build_object(
      'card_amount_boosts', coalesce(p_card_amount_boosts, 0),
      'rarity_boosts', coalesce(p_rarity_boosts, 0)
    );
  elsif v_slot.resolved_mode = 'regen' then
    if coalesce(p_reveal_count, 1) < 1 or coalesce(p_reveal_count, 1) > 4 then
      raise exception 'Regen Booster reveal count must be between 1 and 4';
    end if;

    v_offer_count := coalesce(p_reveal_count, 1);
    v_shard_cost := greatest(v_offer_count - 1, 0) * 10;
    v_metadata := jsonb_build_object('reveal_count', v_offer_count);
  else
    raise exception 'Unsupported Feature Slot type';
  end if;

  perform public._deduct_feature_slot_wallet_costs(
    p_series_id,
    v_actor_id,
    v_feature_coin_cost,
    v_shard_cost
  );

  insert into public.player_feature_slot_usage (
    series_id,
    user_id,
    feature_slot_id,
    spin_count,
    last_played_at
  )
  values (
    p_series_id,
    v_actor_id,
    p_feature_slot_id,
    1,
    now()
  )
  on conflict (series_id, user_id, feature_slot_id)
  do update set
    spin_count = public.player_feature_slot_usage.spin_count + 1,
    last_played_at = now(),
    updated_at = now();

  insert into public.player_feature_slot_sessions (
    series_id,
    user_id,
    feature_slot_id,
    slot_mode,
    status,
    selected_category,
    rerolls_remaining,
    current_choice_count,
    paid_feature_coin_cost,
    paid_shard_cost,
    card_amount_boosts,
    rarity_boosts,
    reveal_count,
    offers,
    metadata
  )
  values (
    p_series_id,
    v_actor_id,
    p_feature_slot_id,
    v_slot.resolved_mode,
    'open',
    case
      when v_slot.resolved_mode = 'picker' then lower(trim(p_selected_category))
      else null
    end,
    case
      when v_slot.resolved_mode = 'drafted' then 3
      when v_slot.resolved_mode = 'picker' then 2
      else 0
    end,
    v_offer_count,
    v_feature_coin_cost,
    v_shard_cost,
    greatest(coalesce(p_card_amount_boosts, 0), 0),
    greatest(coalesce(p_rarity_boosts, 0), 0),
    v_offer_count,
    public._feature_slot_offer_cards(
      v_offer_count,
      case
        when v_slot.resolved_mode = 'picker' then lower(trim(p_selected_category))
        else null
      end,
      case
        when v_slot.resolved_mode = 'boosted' then greatest(coalesce(p_rarity_boosts, 0), 0)
        else 0
      end
    ),
    v_metadata
  );

  return public._build_feature_slot_machine_state(
    p_series_id,
    v_actor_id,
    p_feature_slot_id
  );
end;
$function$;

create or replace function public.reroll_feature_slot_machine(
  p_series_id uuid,
  p_feature_slot_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_session record;
  v_next_choice_count integer := 1;
begin
  v_actor_id := public._assert_authenticated_user();
  perform public._assert_series_member(p_series_id, v_actor_id);
  perform public._assert_series_item_use_allowed(p_series_id, v_actor_id);

  select *
  into v_session
  from public.player_feature_slot_sessions session_rows
  where session_rows.series_id = p_series_id
    and session_rows.user_id = v_actor_id
    and session_rows.feature_slot_id = p_feature_slot_id
    and session_rows.status = 'open'
  for update;

  if not found then
    raise exception 'Open a Feature Slot session first';
  end if;

  if v_session.slot_mode not in ('drafted', 'picker') then
    raise exception 'This Feature Slot does not support rerolls';
  end if;

  if coalesce(v_session.rerolls_remaining, 0) <= 0 then
    raise exception 'No rerolls remain for this session';
  end if;

  v_next_choice_count := greatest(coalesce(v_session.current_choice_count, 1) - 1, 1);

  update public.player_feature_slot_sessions
  set
    rerolls_remaining = rerolls_remaining - 1,
    current_choice_count = v_next_choice_count,
    offers = public._feature_slot_offer_cards(
      v_next_choice_count,
      v_session.selected_category,
      0
    ),
    updated_at = now()
  where id = v_session.id;

  return public._build_feature_slot_machine_state(
    p_series_id,
    v_actor_id,
    p_feature_slot_id
  );
end;
$function$;

create or replace function public.claim_feature_slot_machine_card(
  p_series_id uuid,
  p_feature_slot_id uuid,
  p_offer_index integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_session record;
  v_offer jsonb;
begin
  v_actor_id := public._assert_authenticated_user();
  perform public._assert_series_member(p_series_id, v_actor_id);
  perform public._assert_series_item_use_allowed(p_series_id, v_actor_id);

  select *
  into v_session
  from public.player_feature_slot_sessions session_rows
  where session_rows.series_id = p_series_id
    and session_rows.user_id = v_actor_id
    and session_rows.feature_slot_id = p_feature_slot_id
    and session_rows.status = 'open'
  for update;

  if not found then
    raise exception 'Open a Feature Slot session first';
  end if;

  if v_session.slot_mode = 'regen' then
    raise exception 'Use the Regen Booster finalize flow instead';
  end if;

  if coalesce(p_offer_index, -1) < 0
    or coalesce(p_offer_index, -1) >= jsonb_array_length(coalesce(v_session.offers, '[]'::jsonb)) then
    raise exception 'Choose one of the revealed cards';
  end if;

  v_offer := v_session.offers -> p_offer_index;

  perform public._feature_slot_grant_card(
    p_series_id,
    v_actor_id,
    nullif(coalesce(v_offer ->> 'card_id', ''), '')::bigint,
    nullif(coalesce(v_offer ->> 'rarity_id', ''), '')::uuid
  );

  update public.player_feature_slot_sessions
  set
    status = 'resolved',
    resolved_at = now(),
    updated_at = now(),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'claimed_offer_index', p_offer_index,
      'claimed_offer', v_offer
    )
  where id = v_session.id;

  return jsonb_build_object(
    'success', true,
    'claimed_offer', v_offer,
    'machine_state', public._build_feature_slot_machine_state(
      p_series_id,
      v_actor_id,
      p_feature_slot_id
    )
  );
end;
$function$;

create or replace function public.finalize_regen_feature_slot_machine(
  p_series_id uuid,
  p_feature_slot_id uuid,
  p_selected_offer_indexes integer[] default '{}'::integer[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_session record;
  v_offer jsonb;
  v_unused_paid_cards integer := 0;
  v_selected_indexes integer[];
  v_claimed_count integer := 0;
  v_refund_amount integer := 0;
  v_index integer;
begin
  v_actor_id := public._assert_authenticated_user();
  perform public._assert_series_member(p_series_id, v_actor_id);
  perform public._assert_series_item_use_allowed(p_series_id, v_actor_id);

  select *
  into v_session
  from public.player_feature_slot_sessions session_rows
  where session_rows.series_id = p_series_id
    and session_rows.user_id = v_actor_id
    and session_rows.feature_slot_id = p_feature_slot_id
    and session_rows.status = 'open'
  for update;

  if not found then
    raise exception 'Open a Regen Booster session first';
  end if;

  if v_session.slot_mode <> 'regen' then
    raise exception 'This Feature Slot is not a Regen Booster';
  end if;

  v_selected_indexes := (
    select coalesce(array_agg(distinct idx order by idx), '{}'::integer[])
    from unnest(coalesce(p_selected_offer_indexes, '{}'::integer[])) idx
    where idx >= 0
      and idx < jsonb_array_length(coalesce(v_session.offers, '[]'::jsonb))
  );

  foreach v_index in array coalesce(v_selected_indexes, '{}'::integer[])
  loop
    v_offer := v_session.offers -> v_index;

    perform public._feature_slot_grant_card(
      p_series_id,
      v_actor_id,
      nullif(coalesce(v_offer ->> 'card_id', ''), '')::bigint,
      nullif(coalesce(v_offer ->> 'rarity_id', ''), '')::uuid
    );

    v_claimed_count := v_claimed_count + 1;
  end loop;

  v_unused_paid_cards := greatest(
    greatest(coalesce(v_session.reveal_count, 1), 1) - 1 - greatest(v_claimed_count - 1, 0),
    0
  );
  v_refund_amount := v_unused_paid_cards * 5;

  perform public._refund_feature_slot_shards(
    p_series_id,
    v_actor_id,
    v_refund_amount
  );

  update public.player_feature_slot_sessions
  set
    status = 'resolved',
    resolved_at = now(),
    updated_at = now(),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'claimed_offer_indexes', coalesce(v_selected_indexes, '{}'::integer[]),
      'refund_amount', v_refund_amount,
      'claimed_count', v_claimed_count
    )
  where id = v_session.id;

  return jsonb_build_object(
    'success', true,
    'claimed_count', v_claimed_count,
    'refund_amount', v_refund_amount,
    'machine_state', public._build_feature_slot_machine_state(
      p_series_id,
      v_actor_id,
      p_feature_slot_id
    )
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
      public._build_feature_slot_machine_state(
        p_series_id,
        v_actor_id,
        fs.id
      )
      order by fs.name
    ),
    '[]'::jsonb
  )
  into v_slots
  from public.feature_slots fs
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
    delete from public.player_feature_slot_sessions
    where series_id = p_series_id
      and user_id = p_target_user_id;

    delete from public.player_feature_slot_usage
    where series_id = p_series_id
      and user_id = p_target_user_id;
  else
    delete from public.player_feature_slot_sessions
    where series_id = p_series_id
      and user_id = p_target_user_id
      and feature_slot_id = p_feature_slot_id;

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

  delete from public.player_feature_slot_sessions
  where series_id = p_series_id;

  delete from public.player_feature_slot_usage
  where series_id = p_series_id;

  get diagnostics v_deleted_count = row_count;

  return jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count
  );
end;
$function$;

create or replace function public.ready_up_current_series_phase(p_series_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_series record;
  v_can_bypass boolean;
  v_active_deck record;
  v_export_exists boolean := false;
  v_ready_reason text;
  v_auto_progress jsonb := '{}'::jsonb;
  v_deck_validation jsonb := '{}'::jsonb;
begin
  v_actor_id := public._assert_authenticated_user();
  v_can_bypass := public._progression_can_bypass(v_actor_id);

  perform public._assert_series_member_for_claim(p_series_id, v_actor_id);

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

  if v_series.current_phase = 'reward' then
    raise exception 'Ready Up is not available during Reward Phase';
  end if;

  if v_series.current_phase = 'dueling' then
    raise exception 'Ready Up is not available during Dueling Phase';
  end if;

  if v_series.current_phase = 'standby' then
    if coalesce(v_series.round_number, 0) = 0 and not v_can_bypass then
      raise exception 'Use Begin Series during Round 0 Standby Phase';
    end if;

    v_ready_reason := 'standby_ready';
  elsif v_series.current_phase = 'deckbuilding' then
    select
      d.id,
      d.is_valid
    into v_active_deck
    from public.player_decks d
    where d.series_id = p_series_id
      and d.user_id = v_actor_id
      and d.is_active = true
    limit 1;

    if v_active_deck.id is null then
      raise exception 'You need an active deck before readying up';
    end if;

    v_deck_validation := public._validate_player_deck_for_progression(
      p_series_id,
      v_actor_id,
      v_active_deck.id
    );

    if not coalesce((v_deck_validation ->> 'is_valid')::boolean, false) and not v_can_bypass then
      raise exception '%', coalesce(
        v_deck_validation ->> 'summary',
        'Your active deck must be valid before readying up'
      );
    end if;

    select exists (
      select 1
      from public.series_phase_deck_exports e
      where e.series_id = p_series_id
        and e.round_number = v_series.round_number
        and e.round_step = v_series.round_step_value
        and e.phase = 'deckbuilding'
        and e.user_id = v_actor_id
        and e.deck_id = v_active_deck.id
    )
    into v_export_exists;

    if not v_export_exists and not v_can_bypass then
      raise exception 'Export your active deck before readying up';
    end if;

    v_ready_reason := case
      when v_export_exists then 'deck_export_ready'
      else 'admin_bypass_ready'
    end;
  else
    raise exception 'Ready Up is not available during % phase', v_series.current_phase;
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
    v_series.round_number,
    v_series.round_step_value,
    v_series.current_phase,
    v_actor_id,
    v_ready_reason,
    now(),
    now()
  )
  on conflict (series_id, round_number, round_step, phase, user_id)
  do update set
    ready_reason = excluded.ready_reason,
    ready_at = now(),
    updated_at = now();

  v_auto_progress := public._auto_progress_series_after_player_ready(p_series_id);

  return jsonb_build_object(
    'success', true,
    'phase', coalesce(v_auto_progress ->> 'current_phase', v_series.current_phase),
    'round_number', coalesce((v_auto_progress ->> 'round_number')::integer, v_series.round_number),
    'round_step', coalesce((v_auto_progress ->> 'round_step')::integer, v_series.round_step),
    'ready_reason', v_ready_reason,
    'auto_advanced', coalesce((v_auto_progress ->> 'auto_advanced')::boolean, false)
  );
end;
$function$;

commit;
