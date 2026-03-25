begin;

create extension if not exists pgcrypto;

create table if not exists public.series_round_feature_phase_states (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.game_series (id) on delete cascade,
  round_number integer not null,
  round_step integer not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (series_id, round_number, round_step)
);

create table if not exists public.series_round_feature_phase_turns (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.game_series (id) on delete cascade,
  round_number integer not null,
  round_step integer not null,
  turn_order integer not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  overall_position integer,
  last_round_placement integer,
  choice_option text,
  choice_source text,
  selected_container_id uuid references public.containers (id) on delete set null,
  selected_bonus_collectors_box_id uuid references public.containers (id) on delete set null,
  selected_bonus_promo_box_id uuid references public.containers (id) on delete set null,
  feature_slot_id uuid references public.feature_slots (id) on delete set null,
  resolved_payload jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone,
  unique (series_id, round_number, round_step, user_id),
  unique (series_id, round_number, round_step, turn_order)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'series_round_feature_phase_turns_choice_option_check'
      and conrelid = 'public.series_round_feature_phase_turns'::regclass
  ) then
    alter table public.series_round_feature_phase_turns
      add constraint series_round_feature_phase_turns_choice_option_check
      check (
        choice_option is null
        or choice_option in (
          'monster',
          'spell',
          'trap',
          'extra',
          'random_promo_box_key',
          'box_open'
        )
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'series_round_feature_phase_turns_choice_source_check'
      and conrelid = 'public.series_round_feature_phase_turns'::regclass
  ) then
    alter table public.series_round_feature_phase_turns
      add constraint series_round_feature_phase_turns_choice_source_check
      check (
        choice_source is null
        or choice_source in ('manual', 'automatic')
      );
  end if;
end;
$$;

create index if not exists idx_series_round_feature_phase_turns_lookup
  on public.series_round_feature_phase_turns (series_id, round_number, round_step, turn_order);

create or replace function public._is_special_progression_round(p_round_number integer)
returns boolean
language sql
immutable
as $function$
  select coalesce(p_round_number, 0) > 0
    and mod(coalesce(p_round_number, 0), 6) = 0;
$function$;

create or replace function public._feature_phase_picker_slot_id()
returns uuid
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_slot_id uuid;
begin
  select fs.id
  into v_slot_id
  from public.feature_slots fs
  where coalesce(fs.is_enabled, true) = true
    and coalesce(fs.is_locked, false) = false
    and public._feature_slot_mode(fs.slot_type, fs.name) = 'picker'
  order by fs.created_at asc, fs.name asc
  limit 1;

  return v_slot_id;
end;
$function$;

create or replace function public._feature_phase_unlocked_box_pool_json(
  p_box_type_code text
)
returns jsonb
language sql
security definer
set search_path to 'public', 'auth'
as $function$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'code', c.code,
        'image_url', coalesce(nullif(c.artwork_url, ''), nullif(c.image_url, '')),
        'container_type_code', ct.code,
        'number_code',
          case
            when ct.code in ('deck_box', 'promo_box', 'collectors_box')
              then coalesce(c.box_number_code, '')
            else coalesce(c.pack_number_code, '')
          end
      )
      order by
        case
          when ct.code = 'deck_box' then 0
          when ct.code = 'promo_box' then 1
          when ct.code = 'collectors_box' then 2
          else 9
        end,
        case
          when ct.code in ('deck_box', 'promo_box', 'collectors_box')
            then coalesce(c.box_number_code, '')
          else coalesce(c.pack_number_code, '')
        end,
        c.code,
        c.name
    ),
    '[]'::jsonb
  )
  from public.containers c
  join public.container_types ct
    on ct.id = c.container_type_id
  where lower(coalesce(ct.code, '')) = lower(coalesce(p_box_type_code, ''))
    and coalesce(c.is_enabled, true) = true
    and coalesce(c.is_locked, false) = false;
$function$;

create or replace function public._feature_phase_available_x1_options_json(
  p_series_id uuid,
  p_round_number integer,
  p_round_step integer,
  p_turn_order integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_has_random_key boolean := false;
  v_option_count integer := 4;
  v_cycle_index integer := 0;
begin
  select exists (
    select 1
    from public.item_definitions i
    where lower(coalesce(i.code, '')) = 'random_promo_box_key'
      and coalesce(i.is_active, true) = true
  )
  and exists (
    select 1
    from public.containers c
    join public.container_types ct
      on ct.id = c.container_type_id
    where ct.code = 'promo_box'
      and coalesce(c.is_enabled, true) = true
      and coalesce(c.is_locked, false) = false
  )
  into v_has_random_key;

  v_option_count := case when v_has_random_key then 5 else 4 end;
  v_cycle_index := greatest(coalesce(p_turn_order, 1) - 1, 0) / greatest(v_option_count, 1);

  return (
    with options as (
      select *
      from (
        values
          ('monster', 0, 'Monster', 'Open a free Monster-only Feature Slot picker session.'),
          ('spell', 1, 'Spell', 'Open a free Spell-only Feature Slot picker session.'),
          ('trap', 2, 'Trap', 'Open a free Trap-only Feature Slot picker session.'),
          ('extra', 3, 'Extra Deck', 'Open a free Extra Deck-only Feature Slot picker session.'),
          ('random_promo_box_key', 4, 'Random Promo Box Key', 'Receive 1 Random Promo Box Key in your inventory.')
      ) as rows (choice_option, sort_order, label, description)
      where choice_option <> 'random_promo_box_key' or v_has_random_key
    ),
    used_choices as (
      select distinct lower(coalesce(t.choice_option, '')) as choice_option
      from public.series_round_feature_phase_turns t
      where t.series_id = p_series_id
        and t.round_number = p_round_number
        and t.round_step = p_round_step
        and t.turn_order < p_turn_order
        and (greatest(t.turn_order - 1, 0) / greatest(v_option_count, 1)) = v_cycle_index
        and t.choice_option is not null
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'choice_option', options.choice_option,
          'label', options.label,
          'description', options.description
        )
        order by options.sort_order
      ),
      '[]'::jsonb
    )
    from options
    where not exists (
      select 1
      from used_choices
      where used_choices.choice_option = options.choice_option
    )
  );
end;
$function$;

create or replace function public._feature_phase_available_main_boxes_json(
  p_series_id uuid,
  p_round_number integer,
  p_round_step integer,
  p_turn_order integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_option_count integer := 0;
  v_cycle_index integer := 0;
begin
  select count(*)
  into v_option_count
  from public.containers c
  join public.container_types ct
    on ct.id = c.container_type_id
  where ct.code in ('deck_box', 'promo_box')
    and coalesce(c.is_enabled, true) = true
    and coalesce(c.is_locked, false) = false;

  if coalesce(v_option_count, 0) <= 0 then
    return '[]'::jsonb;
  end if;

  v_cycle_index := greatest(coalesce(p_turn_order, 1) - 1, 0) / v_option_count;

  return (
    with boxes as (
      select
        c.id,
        c.name,
        c.code,
        coalesce(nullif(c.artwork_url, ''), nullif(c.image_url, '')) as image_url,
        ct.code as container_type_code,
        coalesce(c.box_number_code, '') as number_code
      from public.containers c
      join public.container_types ct
        on ct.id = c.container_type_id
      where ct.code in ('deck_box', 'promo_box')
        and coalesce(c.is_enabled, true) = true
        and coalesce(c.is_locked, false) = false
    ),
    used_boxes as (
      select distinct t.selected_container_id
      from public.series_round_feature_phase_turns t
      where t.series_id = p_series_id
        and t.round_number = p_round_number
        and t.round_step = p_round_step
        and t.turn_order < p_turn_order
        and (greatest(t.turn_order - 1, 0) / v_option_count) = v_cycle_index
        and t.selected_container_id is not null
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', boxes.id,
          'name', boxes.name,
          'code', boxes.code,
          'image_url', boxes.image_url,
          'container_type_code', boxes.container_type_code,
          'number_code', boxes.number_code
        )
        order by
          case
            when boxes.container_type_code = 'deck_box' then 0
            else 1
          end,
          boxes.number_code,
          boxes.code,
          boxes.name
      ),
      '[]'::jsonb
    )
    from boxes
    where not exists (
      select 1
      from used_boxes
      where used_boxes.selected_container_id = boxes.id
    )
  );
end;
$function$;

create or replace function public._open_box_direct_for_user(
  p_series_id uuid,
  p_target_user_id uuid,
  p_container_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_container record;
  v_selected record;
  v_selected_box_tier jsonb := '{}'::jsonb;
  v_selected_box_tier_id uuid;
  v_fallback_rarity record;
  v_rolled_rarity jsonb := '{}'::jsonb;
  v_selected_rarity_id uuid;
  v_selected_rarity_code text;
  v_selected_rarity_name text;
begin
  perform public._assert_series_member(p_series_id, p_target_user_id);

  select
    c.id,
    c.name,
    c.description,
    c.code,
    coalesce(nullif(c.artwork_url, ''), nullif(c.image_url, '')) as image_url,
    ct.code as container_type_code
  into v_container
  from public.containers c
  join public.container_types ct
    on ct.id = c.container_type_id
  where c.id = p_container_id
    and ct.code in ('promo_box', 'deck_box', 'collectors_box')
    and coalesce(c.is_enabled, true) = true
    and coalesce(c.is_locked, false) = false;

  if not found then
    raise exception 'Selected box is not available';
  end if;

  select r.id, r.code, r.name
  into v_fallback_rarity
  from public.card_rarities r
  where r.id = public._resolve_common_rarity_id();

  v_selected_box_tier := public._roll_enabled_box_tier(v_container.id);
  v_selected_box_tier_id := nullif(coalesce(v_selected_box_tier ->> 'id', ''), '')::uuid;

  if v_selected_box_tier_id is null then
    raise exception 'This box has no eligible tier pools configured';
  end if;

  select
    cc.card_id,
    c.name as card_name,
    c.image_url,
    cc.tier_id,
    coalesce(t.code, nullif(v_selected_box_tier ->> 'code', ''), 'tier') as tier_code,
    coalesce(t.name, nullif(v_selected_box_tier ->> 'name', ''), 'Unknown Tier') as tier_name
  into v_selected
  from public.container_cards cc
  join public.cards c
    on c.id = cc.card_id
  left join public.card_tiers t
    on t.id = cc.tier_id
  where cc.container_id = v_container.id
    and coalesce(cc.is_enabled, true) = true
    and cc.tier_id = v_selected_box_tier_id
  order by random()
  limit 1;

  if v_selected.card_id is null then
    raise exception 'The selected box tier has no eligible cards configured';
  end if;

  v_rolled_rarity := public._roll_weighted_card_rarity();
  v_selected_rarity_id := coalesce(nullif(coalesce(v_rolled_rarity ->> 'id', ''), '')::uuid, v_fallback_rarity.id);
  v_selected_rarity_code := coalesce(nullif(v_rolled_rarity ->> 'code', ''), v_fallback_rarity.code);
  v_selected_rarity_name := coalesce(nullif(v_rolled_rarity ->> 'name', ''), v_fallback_rarity.name);

  insert into public.binder_cards (user_id, series_id, card_id, rarity_id, quantity, is_trade_locked)
  values (
    p_target_user_id,
    p_series_id,
    v_selected.card_id,
    v_selected_rarity_id,
    1,
    false
  )
  on conflict (user_id, series_id, card_id, rarity_id)
  do update set quantity = public.binder_cards.quantity + 1, updated_at = now();

  return jsonb_build_object(
    'success', true,
    'container_id', v_container.id,
    'container_name', v_container.name,
    'container_description', v_container.description,
    'container_code', v_container.code,
    'container_type_code', v_container.container_type_code,
    'container_image_url', v_container.image_url,
    'cards_per_open', 1,
    'pulls', jsonb_build_array(
      jsonb_build_object(
        'card_id', v_selected.card_id,
        'card_name', v_selected.card_name,
        'image_url', v_selected.image_url,
        'tier_id', v_selected.tier_id,
        'tier_code', v_selected.tier_code,
        'tier_name', v_selected.tier_name,
        'rarity_id', v_selected_rarity_id,
        'rarity_code', v_selected_rarity_code,
        'rarity_name', v_selected_rarity_name
      )
    )
  );
end;
$function$;

create or replace function public._open_box_direct_batch_for_user(
  p_series_id uuid,
  p_target_user_id uuid,
  p_container_id uuid,
  p_open_count integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_requested_count integer := greatest(coalesce(p_open_count, 1), 1);
  v_open_index integer;
  v_open_result jsonb := '{}'::jsonb;
  v_openings jsonb := '[]'::jsonb;
  v_container record;
begin
  select
    c.id,
    c.name,
    c.description,
    c.code,
    coalesce(nullif(c.artwork_url, ''), nullif(c.image_url, '')) as image_url,
    ct.code as container_type_code
  into v_container
  from public.containers c
  join public.container_types ct
    on ct.id = c.container_type_id
  where c.id = p_container_id
    and ct.code in ('promo_box', 'deck_box', 'collectors_box')
    and coalesce(c.is_enabled, true) = true
    and coalesce(c.is_locked, false) = false
  limit 1;

  if not found then
    raise exception 'Selected box is not available';
  end if;

  for v_open_index in 1..v_requested_count loop
    v_open_result := public._open_box_direct_for_user(
      p_series_id,
      p_target_user_id,
      p_container_id
    );

    v_openings := v_openings || jsonb_build_array(
      jsonb_build_object(
        'open_index', v_open_index,
        'container_id', v_container.id,
        'container_name', v_container.name,
        'container_description', v_container.description,
        'container_code', v_container.code,
        'container_type_code', v_container.container_type_code,
        'container_image_url', v_container.image_url,
        'cards_per_open', 1,
        'pulls', coalesce(v_open_result -> 'pulls', '[]'::jsonb)
      )
    );
  end loop;

  return jsonb_build_object(
    'success', true,
    'container_id', v_container.id,
    'container_name', v_container.name,
    'container_image_url', v_container.image_url,
    'container_type_code', v_container.container_type_code,
    'opened_quantity', v_requested_count,
    'openings', coalesce(v_openings, '[]'::jsonb)
  );
end;
$function$;

create or replace function public._initialize_series_feature_phase(p_series_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_series record;
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

  if v_series.current_phase <> 'feature' or coalesce(v_series.round_number, 0) <= 0 then
    return;
  end if;

  insert into public.series_round_feature_phase_states (
    series_id,
    round_number,
    round_step
  )
  values (
    p_series_id,
    v_series.round_number,
    v_series.round_step_value
  )
  on conflict (series_id, round_number, round_step) do nothing;

  if exists (
    select 1
    from public.series_round_feature_phase_turns t
    where t.series_id = p_series_id
      and t.round_number = v_series.round_number
      and t.round_step = v_series.round_step_value
  ) then
    return;
  end if;

  insert into public.series_round_feature_phase_turns (
    series_id,
    round_number,
    round_step,
    turn_order,
    user_id,
    overall_position,
    last_round_placement
  )
  with latest_round as (
    select rr.round_number, rr.round_step
    from public.series_round_results rr
    where rr.series_id = p_series_id
      and (
        rr.round_number < v_series.round_number
        or (rr.round_number = v_series.round_number and rr.round_step < v_series.round_step_value)
      )
    order by rr.round_number desc, rr.round_step desc
    limit 1
  ),
  overall_positions as (
    select
      (entry ->> 'user_id')::uuid as user_id,
      nullif(entry ->> 'position', '')::integer as overall_position
    from jsonb_array_elements(public._build_series_scoreboard_json(p_series_id)) entry
  ),
  player_rows as (
    select
      sp.user_id,
      sp.joined_at,
      coalesce(spv.username, 'Player') as username,
      overall.overall_position,
      rr.placement as last_round_placement
    from public.series_players sp
    left join public.series_players_view spv
      on spv.series_id = sp.series_id
     and spv.user_id = sp.user_id
    left join overall_positions overall
      on overall.user_id = sp.user_id
    left join latest_round lr
      on true
    left join public.series_round_results rr
      on rr.series_id = p_series_id
     and rr.user_id = sp.user_id
     and rr.round_number = lr.round_number
     and rr.round_step = lr.round_step
    where sp.series_id = p_series_id
  ),
  ordered as (
    select
      pr.*,
      row_number() over (
        order by
          case when pr.last_round_placement is null then 1 else 0 end,
          coalesce(pr.last_round_placement, pr.overall_position, 999999) asc,
          coalesce(pr.overall_position, 999999) asc,
          pr.username asc,
          pr.joined_at asc
      ) as turn_order
    from player_rows pr
  )
  select
    p_series_id,
    v_series.round_number,
    v_series.round_step_value,
    ordered.turn_order,
    ordered.user_id,
    ordered.overall_position,
    ordered.last_round_placement
  from ordered
  order by ordered.turn_order;
end;
$function$;

create or replace function public._open_feature_phase_picker_reward_session(
  p_series_id uuid,
  p_user_id uuid,
  p_selected_category text,
  p_turn_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_slot record;
  v_existing_session record;
  v_session_id uuid;
  v_category text := lower(trim(coalesce(p_selected_category, '')));
begin
  if v_category not in ('monster', 'spell', 'trap', 'extra') then
    raise exception 'Choose Monster, Spell, Trap, or Extra Deck';
  end if;

  select
    fs.*,
    public._feature_slot_mode(fs.slot_type, fs.name) as resolved_mode
  into v_slot
  from public.feature_slots fs
  where fs.id = public._feature_phase_picker_slot_id()
  for update;

  if not found or v_slot.resolved_mode <> 'picker' then
    raise exception 'Picker Feature Slot Machine is not configured';
  end if;

  select *
  into v_existing_session
  from public.player_feature_slot_sessions session_rows
  where session_rows.series_id = p_series_id
    and session_rows.user_id = p_user_id
    and session_rows.feature_slot_id = v_slot.id
    and session_rows.status = 'open'
  for update;

  if found and coalesce(v_existing_session.metadata ->> 'feature_phase_turn_id', '') = coalesce(p_turn_id::text, '') then
    return v_existing_session.id;
  end if;

  if found then
    update public.player_feature_slot_sessions
    set
      status = 'resolved',
      resolved_at = now(),
      updated_at = now()
    where id = v_existing_session.id;
  end if;

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
    p_user_id,
    v_slot.id,
    'picker',
    'open',
    v_category,
    2,
    2,
    0,
    0,
    0,
    0,
    2,
    public._feature_slot_offer_cards(2, v_category, 0),
    jsonb_build_object(
      'selected_category', v_category,
      'feature_phase_turn_id', p_turn_id,
      'feature_phase_reward', true
    )
  )
  returning id into v_session_id;

  return v_session_id;
end;
$function$;

create or replace function public._feature_phase_auto_advance_if_complete(p_series_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_series record;
begin
  select
    gs.*,
    public._progression_round_step_value(gs.round_step) as round_step_value
  into v_series
  from public.game_series gs
  where gs.id = p_series_id
  for update;

  if not found then
    return;
  end if;

  if v_series.current_phase <> 'feature' or coalesce(v_series.round_number, 0) <= 0 then
    return;
  end if;

  perform public._initialize_series_feature_phase(p_series_id);

  if exists (
    select 1
    from public.series_round_feature_phase_turns t
    where t.series_id = p_series_id
      and t.round_number = v_series.round_number
      and t.round_step = v_series.round_step_value
      and t.completed_at is null
  ) then
    return;
  end if;

  update public.game_series
  set
    current_phase = 'draft',
    updated_at = now()
  where id = p_series_id;
end;
$function$;

create or replace function public.get_current_feature_phase_state(p_series_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_series record;
  v_current_turn record;
  v_my_turn record;
  v_phase_variant text := 'x1';
  v_is_special_round boolean := false;
  v_turns jsonb := '[]'::jsonb;
  v_available_options jsonb := '[]'::jsonb;
  v_available_main_boxes jsonb := '[]'::jsonb;
  v_bonus_collectors_boxes jsonb := '[]'::jsonb;
  v_bonus_promo_boxes jsonb := '[]'::jsonb;
  v_pending_reward_session jsonb := null;
  v_my_action_state text := 'waiting';
begin
  v_actor_id := public._assert_authenticated_user();
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

  if v_series.current_phase <> 'feature' or coalesce(v_series.round_number, 0) <= 0 then
    return jsonb_build_object(
      'active', false,
      'current_phase', v_series.current_phase,
      'round_number', v_series.round_number,
      'round_step', v_series.round_step_value
    );
  end if;

  perform public._initialize_series_feature_phase(p_series_id);

  v_phase_variant := case when v_series.round_step_value = 1 then 'x1' else 'x2' end;
  v_is_special_round := public._is_special_progression_round(v_series.round_number);

  select *
  into v_current_turn
  from public.series_round_feature_phase_turns t
  where t.series_id = p_series_id
    and t.round_number = v_series.round_number
    and t.round_step = v_series.round_step_value
    and t.completed_at is null
  order by t.turn_order
  limit 1;

  select *
  into v_my_turn
  from public.series_round_feature_phase_turns t
  where t.series_id = p_series_id
    and t.round_number = v_series.round_number
    and t.round_step = v_series.round_step_value
    and t.user_id = v_actor_id
  limit 1;

  if v_my_turn.id is not null and v_my_turn.choice_option in ('monster', 'spell', 'trap', 'extra') and v_my_turn.completed_at is null then
    select
      jsonb_build_object(
        'id', session_rows.id,
        'feature_slot_id', session_rows.feature_slot_id,
        'selected_category', session_rows.selected_category,
        'metadata', session_rows.metadata
      )
    into v_pending_reward_session
    from public.player_feature_slot_sessions session_rows
    where session_rows.series_id = p_series_id
      and session_rows.user_id = v_actor_id
      and session_rows.status = 'open'
      and coalesce(session_rows.metadata ->> 'feature_phase_turn_id', '') = coalesce(v_my_turn.id::text, '')
    order by session_rows.created_at desc
    limit 1;
  end if;

  if v_current_turn.id is not null and v_current_turn.user_id = v_actor_id then
    if v_phase_variant = 'x1' then
      v_available_options := public._feature_phase_available_x1_options_json(
        p_series_id,
        v_series.round_number,
        v_series.round_step_value,
        v_current_turn.turn_order
      );
    else
      v_available_main_boxes := public._feature_phase_available_main_boxes_json(
        p_series_id,
        v_series.round_number,
        v_series.round_step_value,
        v_current_turn.turn_order
      );
    end if;
  end if;

  if v_is_special_round then
    v_bonus_collectors_boxes := public._feature_phase_unlocked_box_pool_json('collectors_box');
    v_bonus_promo_boxes := public._feature_phase_unlocked_box_pool_json('promo_box');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'turn_order', t.turn_order,
        'user_id', t.user_id,
        'username', coalesce(spv.username, 'Player'),
        'avatar', coalesce(spv.avatar, ''),
        'overall_position', t.overall_position,
        'last_round_placement', t.last_round_placement,
        'choice_option', t.choice_option,
        'choice_source', t.choice_source,
        'selected_container_id', t.selected_container_id,
        'selected_bonus_collectors_box_id', t.selected_bonus_collectors_box_id,
        'selected_bonus_promo_box_id', t.selected_bonus_promo_box_id,
        'feature_slot_id', t.feature_slot_id,
        'resolved_payload', coalesce(t.resolved_payload, '{}'::jsonb),
        'completed_at', t.completed_at,
        'is_current_turn',
          case
            when v_current_turn.id is not null and t.id = v_current_turn.id then true
            else false
          end
      )
      order by t.turn_order
    ),
    '[]'::jsonb
  )
  into v_turns
  from public.series_round_feature_phase_turns t
  left join public.series_players_view spv
    on spv.series_id = t.series_id
   and spv.user_id = t.user_id
  where t.series_id = p_series_id
    and t.round_number = v_series.round_number
    and t.round_step = v_series.round_step_value;

  if v_current_turn.id is not null and v_current_turn.user_id = v_actor_id then
    if v_pending_reward_session is not null then
      v_my_action_state := 'claim_slot_reward';
    else
      v_my_action_state := 'choose';
    end if;
  elsif v_current_turn.id is null then
    v_my_action_state := 'complete';
  end if;

  return jsonb_build_object(
    'active', true,
    'current_phase', v_series.current_phase,
    'round_number', v_series.round_number,
    'round_step', v_series.round_step_value,
    'phase_variant', v_phase_variant,
    'is_special_round', v_is_special_round,
    'current_turn_user_id', v_current_turn.user_id,
    'current_turn_order', v_current_turn.turn_order,
    'is_my_turn',
      case
        when v_current_turn.id is not null and v_current_turn.user_id = v_actor_id then true
        else false
      end,
    'my_choice_option', v_my_turn.choice_option,
    'my_action_state', v_my_action_state,
    'available_options', v_available_options,
    'available_main_boxes', v_available_main_boxes,
    'bonus_collectors_boxes', v_bonus_collectors_boxes,
    'bonus_promo_boxes', v_bonus_promo_boxes,
    'pending_reward_session', v_pending_reward_session,
    'picker_feature_slot_id', public._feature_phase_picker_slot_id(),
    'turns', v_turns
  );
end;
$function$;

create or replace function public.resolve_current_feature_phase_choice(
  p_series_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_series record;
  v_current_turn record;
  v_choice_option text := lower(trim(coalesce(p_payload ->> 'choice_option', '')));
  v_phase_variant text := 'x1';
  v_is_special_round boolean := false;
  v_main_container_id uuid := nullif(coalesce(p_payload ->> 'container_id', ''), '')::uuid;
  v_bonus_collectors_box_id uuid := nullif(coalesce(p_payload ->> 'bonus_collectors_box_id', ''), '')::uuid;
  v_bonus_promo_box_id uuid := nullif(coalesce(p_payload ->> 'bonus_promo_box_id', ''), '')::uuid;
  v_reward_item_id uuid;
  v_picker_session_id uuid;
  v_bonus_payload jsonb := '{}'::jsonb;
  v_main_open_result jsonb := '{}'::jsonb;
  v_available_options jsonb := '[]'::jsonb;
  v_available_main_boxes jsonb := '[]'::jsonb;
begin
  v_actor_id := public._assert_authenticated_user();
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

  if v_series.current_phase <> 'feature' or coalesce(v_series.round_number, 0) <= 0 then
    raise exception 'Feature Phase is not active';
  end if;

  perform public._initialize_series_feature_phase(p_series_id);

  select *
  into v_current_turn
  from public.series_round_feature_phase_turns t
  where t.series_id = p_series_id
    and t.round_number = v_series.round_number
    and t.round_step = v_series.round_step_value
    and t.completed_at is null
  order by t.turn_order
  limit 1
  for update;

  if not found then
    raise exception 'Feature Phase is already complete';
  end if;

  if v_current_turn.user_id <> v_actor_id then
    raise exception 'It is not your turn to resolve Feature Phase rewards';
  end if;

  if v_current_turn.completed_at is not null then
    raise exception 'Your Feature Phase turn is already complete';
  end if;

  if v_current_turn.choice_option in ('monster', 'spell', 'trap', 'extra')
     and exists (
       select 1
       from public.player_feature_slot_sessions session_rows
       where session_rows.series_id = p_series_id
         and session_rows.user_id = v_actor_id
         and session_rows.status = 'open'
         and coalesce(session_rows.metadata ->> 'feature_phase_turn_id', '') = coalesce(v_current_turn.id::text, '')
     ) then
    raise exception 'Finish your Feature Slot reward session before choosing something else';
  end if;

  v_phase_variant := case when v_series.round_step_value = 1 then 'x1' else 'x2' end;
  v_is_special_round := public._is_special_progression_round(v_series.round_number);

  if v_is_special_round then
    if v_bonus_collectors_box_id is null or v_bonus_promo_box_id is null then
      raise exception 'Choose both the bonus Collectors Box and bonus Promo Box for this special round';
    end if;

    if not exists (
      select 1
      from public.containers c
      join public.container_types ct
        on ct.id = c.container_type_id
      where c.id = v_bonus_collectors_box_id
        and ct.code = 'collectors_box'
        and coalesce(c.is_enabled, true) = true
        and coalesce(c.is_locked, false) = false
    ) then
      raise exception 'Selected bonus Collectors Box is not unlocked';
    end if;

    if not exists (
      select 1
      from public.containers c
      join public.container_types ct
        on ct.id = c.container_type_id
      where c.id = v_bonus_promo_box_id
        and ct.code = 'promo_box'
        and coalesce(c.is_enabled, true) = true
        and coalesce(c.is_locked, false) = false
    ) then
      raise exception 'Selected bonus Promo Box is not unlocked';
    end if;

    v_bonus_payload := jsonb_build_object(
      'bonus_collectors_open_result',
        public._open_box_direct_batch_for_user(p_series_id, v_actor_id, v_bonus_collectors_box_id, 5),
      'bonus_promo_open_result',
        public._open_box_direct_batch_for_user(p_series_id, v_actor_id, v_bonus_promo_box_id, 3),
      'selected_bonus_collectors_box_id', v_bonus_collectors_box_id,
      'selected_bonus_promo_box_id', v_bonus_promo_box_id
    );
  end if;

  if v_phase_variant = 'x1' then
    if v_choice_option not in ('monster', 'spell', 'trap', 'extra', 'random_promo_box_key') then
      raise exception 'Choose Monster, Spell, Trap, Extra Deck, or Random Promo Box Key';
    end if;

    v_available_options := public._feature_phase_available_x1_options_json(
      p_series_id,
      v_series.round_number,
      v_series.round_step_value,
      v_current_turn.turn_order
    );

    if not exists (
      select 1
      from jsonb_array_elements(v_available_options) option_rows
      where lower(coalesce(option_rows ->> 'choice_option', '')) = v_choice_option
    ) then
      raise exception 'That Feature Phase option is not currently available';
    end if;

    if v_choice_option = 'random_promo_box_key' then
      select i.id
      into v_reward_item_id
      from public.item_definitions i
      where lower(coalesce(i.code, '')) = 'random_promo_box_key'
        and coalesce(i.is_active, true) = true
      limit 1;

      if v_reward_item_id is null then
        raise exception 'Random Promo Box Key item definition is missing';
      end if;

      perform public._grant_series_item(
        p_series_id,
        v_actor_id,
        v_reward_item_id,
        1,
        v_actor_id,
        format('feature_phase:%s:%s:random_promo_box_key', v_series.round_number, v_series.round_step_value)
      );

      update public.series_round_feature_phase_turns
      set
        choice_option = v_choice_option,
        choice_source = 'manual',
        selected_bonus_collectors_box_id = v_bonus_collectors_box_id,
        selected_bonus_promo_box_id = v_bonus_promo_box_id,
        resolved_payload = v_bonus_payload || jsonb_build_object(
          'grants',
          jsonb_build_array(
            jsonb_build_object(
              'type', 'item',
              'item_definition_id', v_reward_item_id,
              'label', 'Random Promo Box Key',
              'quantity', 1
            )
          )
        ),
        completed_at = now(),
        updated_at = now()
      where id = v_current_turn.id;
    else
      v_picker_session_id := public._open_feature_phase_picker_reward_session(
        p_series_id,
        v_actor_id,
        v_choice_option,
        v_current_turn.id
      );

      update public.series_round_feature_phase_turns
      set
        choice_option = v_choice_option,
        choice_source = 'manual',
        selected_bonus_collectors_box_id = v_bonus_collectors_box_id,
        selected_bonus_promo_box_id = v_bonus_promo_box_id,
        feature_slot_id = public._feature_phase_picker_slot_id(),
        resolved_payload = v_bonus_payload || jsonb_build_object(
          'feature_slot_session_id', v_picker_session_id,
          'feature_slot_category', v_choice_option
        ),
        updated_at = now()
      where id = v_current_turn.id;
    end if;
  else
    v_available_main_boxes := public._feature_phase_available_main_boxes_json(
      p_series_id,
      v_series.round_number,
      v_series.round_step_value,
      v_current_turn.turn_order
    );

    if v_main_container_id is null then
      raise exception 'Choose a Promo Box or Deck Box to open';
    end if;

    if not exists (
      select 1
      from jsonb_array_elements(v_available_main_boxes) box_rows
      where nullif(coalesce(box_rows ->> 'id', ''), '')::uuid = v_main_container_id
    ) then
      raise exception 'That box is not currently available';
    end if;

    v_main_open_result := public._open_box_direct_batch_for_user(
      p_series_id,
      v_actor_id,
      v_main_container_id,
      1
    );

    update public.series_round_feature_phase_turns
    set
      choice_option = 'box_open',
      choice_source = 'manual',
      selected_container_id = v_main_container_id,
      selected_bonus_collectors_box_id = v_bonus_collectors_box_id,
      selected_bonus_promo_box_id = v_bonus_promo_box_id,
      resolved_payload = v_bonus_payload || jsonb_build_object(
        'main_open_result', v_main_open_result
      ),
      completed_at = now(),
      updated_at = now()
    where id = v_current_turn.id;
  end if;

  perform public._feature_phase_auto_advance_if_complete(p_series_id);

  return public.get_current_feature_phase_state(p_series_id);
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
  v_series record;
  v_feature_coin_cost integer := 0;
  v_shard_cost integer := 0;
  v_offer_count integer := 0;
  v_metadata jsonb := '{}'::jsonb;
begin
  v_actor_id := public._assert_authenticated_user();
  perform public._assert_series_member(p_series_id, v_actor_id);
  perform public._assert_series_item_use_allowed(p_series_id, v_actor_id);

  select
    gs.current_phase,
    gs.round_number
  into v_series
  from public.game_series gs
  where gs.id = p_series_id;

  if coalesce(v_series.round_number, 0) > 0 and v_series.current_phase = 'feature' then
    raise exception 'Feature Slot openings during Feature Phase are granted from the Feature Phase turn flow';
  end if;

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
  v_feature_phase_turn_id uuid;
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

  v_feature_phase_turn_id := nullif(coalesce(v_session.metadata ->> 'feature_phase_turn_id', ''), '')::uuid;

  if v_feature_phase_turn_id is not null then
    update public.series_round_feature_phase_turns
    set
      resolved_payload = coalesce(resolved_payload, '{}'::jsonb) || jsonb_build_object(
        'feature_slot_claim', jsonb_build_object(
          'feature_slot_id', p_feature_slot_id,
          'claimed_offer_index', p_offer_index,
          'claimed_offer', v_offer
        )
      ),
      completed_at = now(),
      updated_at = now()
    where id = v_feature_phase_turn_id
      and user_id = v_actor_id
      and completed_at is null;

    perform public._feature_phase_auto_advance_if_complete(p_series_id);
  end if;

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

create or replace function public._auto_progress_series_after_player_ready(p_series_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_series record;
  v_player_count integer := 0;
  v_ready_count integer := 0;
  v_round_step_value integer := 0;
  v_auto_advanced boolean := false;
  v_ban_phase_state record;
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

  if v_series.current_phase not in ('standby', 'ban', 'binder', 'feature', 'draft', 'deckbuilding') then
    return jsonb_build_object(
      'auto_advanced', false,
      'current_phase', v_series.current_phase,
      'round_number', v_series.round_number,
      'round_step', v_series.round_step
    );
  end if;

  if v_series.current_phase = 'feature' and coalesce(v_series.round_number, 0) > 0 then
    return jsonb_build_object(
      'auto_advanced', false,
      'current_phase', v_series.current_phase,
      'round_number', v_series.round_number,
      'round_step', v_series.round_step
    );
  end if;

  if v_series.current_phase = 'ban' and coalesce(v_series.round_number, 0) > 0 then
    perform public._initialize_series_ban_phase(p_series_id);
    perform public._auto_complete_series_ban_phase_remaining_passes(p_series_id);
    perform public._apply_series_ban_phase_system_bans(p_series_id);

    select *
    into v_ban_phase_state
    from public.series_round_ban_phase_states s
    where s.series_id = p_series_id
      and s.round_number = v_series.round_number
      and s.round_step = v_series.round_step_value;

    if exists (
      select 1
      from public.series_round_ban_phase_turns t
      where t.series_id = p_series_id
        and t.round_number = v_series.round_number
        and t.round_step = v_series.round_step_value
        and t.completed_at is null
    ) or v_ban_phase_state.system_bans_generated_at is null then
      return jsonb_build_object(
        'auto_advanced', false,
        'current_phase', v_series.current_phase,
        'round_number', v_series.round_number,
        'round_step', v_series.round_step
      );
    end if;
  end if;

  if v_series.current_phase = 'binder' and coalesce(v_series.round_number, 0) > 0 then
    perform public._initialize_series_binder_phase(p_series_id);

    if exists (
      select 1
      from public.series_round_binder_phase_turns t
      where t.series_id = p_series_id
        and t.round_number = v_series.round_number
        and t.round_step = v_series.round_step_value
        and t.completed_at is null
    ) then
      return jsonb_build_object(
        'auto_advanced', false,
        'current_phase', v_series.current_phase,
        'round_number', v_series.round_number,
        'round_step', v_series.round_step
      );
    end if;
  end if;

  select count(*)
  into v_player_count
  from public.series_players sp
  where sp.series_id = p_series_id;

  select count(*)
  into v_ready_count
  from public.series_phase_ready_states rs
  where rs.series_id = p_series_id
    and rs.round_number = v_series.round_number
    and rs.round_step = v_series.round_step_value
    and rs.phase = v_series.current_phase;

  if v_player_count <= 0 or v_ready_count < v_player_count then
    return jsonb_build_object(
      'auto_advanced', false,
      'current_phase', v_series.current_phase,
      'round_number', v_series.round_number,
      'round_step', v_series.round_step
    );
  end if;

  if v_series.current_phase = 'standby' then
    update public.game_series
    set
      current_phase = case
        when round_number = 0 then 'deckbuilding'
        else 'ban'
      end,
      round_step = case
        when round_number = 0 then 1
        else coalesce(round_step, 1)
      end,
      updated_at = now()
    where id = p_series_id
    returning *
    into v_series;

    if v_series.current_phase = 'ban' then
      perform public._initialize_series_ban_phase(p_series_id);
    end if;

    v_auto_advanced := true;
  elsif v_series.current_phase = 'ban' then
    update public.game_series
    set
      current_phase = 'binder',
      updated_at = now()
    where id = p_series_id
    returning *
    into v_series;

    perform public._initialize_series_binder_phase(p_series_id);
    v_auto_advanced := true;
  elsif v_series.current_phase = 'binder' then
    update public.game_series
    set
      current_phase = 'feature',
      updated_at = now()
    where id = p_series_id
    returning *
    into v_series;

    perform public._initialize_series_feature_phase(p_series_id);
    v_auto_advanced := true;
  elsif v_series.current_phase = 'draft' then
    update public.game_series
    set
      current_phase = 'deckbuilding',
      updated_at = now()
    where id = p_series_id
    returning *
    into v_series;

    v_auto_advanced := true;
  elsif v_series.current_phase = 'deckbuilding' then
    v_round_step_value := case
      when v_series.round_number = 0 then 1
      else public._progression_round_step_value(v_series.round_step)
    end;

    if public._get_series_current_bracket_id(
      p_series_id,
      v_series.round_number,
      v_round_step_value
    ) is null then
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

    v_auto_advanced := true;
  end if;

  return jsonb_build_object(
    'auto_advanced', v_auto_advanced,
    'current_phase', v_series.current_phase,
    'round_number', v_series.round_number,
    'round_step', v_series.round_step
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
  v_ban_phase_state record;
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
  elsif v_series.current_phase = 'ban' then
    if coalesce(v_series.round_number, 0) <= 0 then
      raise exception 'Ban Phase is only used during normal rounds';
    end if;

    perform public._initialize_series_ban_phase(p_series_id);
    perform public._auto_complete_series_ban_phase_remaining_passes(p_series_id);
    perform public._apply_series_ban_phase_system_bans(p_series_id);

    select *
    into v_ban_phase_state
    from public.series_round_ban_phase_states s
    where s.series_id = p_series_id
      and s.round_number = v_series.round_number
      and s.round_step = v_series.round_step_value;

    if exists (
      select 1
      from public.series_round_ban_phase_turns t
      where t.series_id = p_series_id
        and t.round_number = v_series.round_number
        and t.round_step = v_series.round_step_value
        and t.completed_at is null
    ) then
      raise exception 'Finish all Ban Phase selections before confirming the banlist';
    end if;

    if v_ban_phase_state.system_bans_generated_at is null then
      raise exception 'System ban rolls are still being prepared';
    end if;

    v_ready_reason := 'ban_phase_confirmed';
  elsif v_series.current_phase = 'binder' then
    if coalesce(v_series.round_number, 0) <= 0 then
      raise exception 'Binder Phase is only used during normal rounds';
    end if;

    perform public._initialize_series_binder_phase(p_series_id);

    if exists (
      select 1
      from public.series_round_binder_phase_turns t
      where t.series_id = p_series_id
        and t.round_number = v_series.round_number
        and t.round_step = v_series.round_step_value
        and t.completed_at is null
    ) then
      raise exception 'Finish all Binder Phase selections before confirming the binder results';
    end if;

    v_ready_reason := 'binder_phase_confirmed';
  elsif v_series.current_phase = 'feature' then
    raise exception 'Feature Phase resolves from the Feature Slots page and does not use Ready Up';
  elsif v_series.current_phase = 'draft' then
    v_ready_reason := 'draft_ready';
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
  v_completed_step integer;
  v_ban_phase_state record;
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

  if v_series.current_phase = 'lobby' then
    update public.game_series
    set
      current_phase = 'standby',
      round_number = 0,
      round_step = 0,
      updated_at = now()
    where id = p_series_id
    returning *
    into v_series;
  elsif v_series.current_phase = 'standby' then
    if not p_force and v_player_count > 0 and v_ready_count < v_player_count then
      raise exception 'Not all players are ready to leave Standby Phase';
    end if;

    update public.game_series
    set
      current_phase = case
        when round_number = 0 then 'deckbuilding'
        else 'ban'
      end,
      round_step = case
        when round_number = 0 then 1
        else coalesce(round_step, 1)
      end,
      updated_at = now()
    where id = p_series_id
    returning *
    into v_series;

    if v_series.current_phase = 'ban' then
      perform public._initialize_series_ban_phase(p_series_id);
    end if;
  elsif v_series.current_phase = 'ban' then
    perform public._initialize_series_ban_phase(p_series_id);
    perform public._auto_complete_series_ban_phase_remaining_passes(p_series_id);
    perform public._apply_series_ban_phase_system_bans(p_series_id);

    select *
    into v_ban_phase_state
    from public.series_round_ban_phase_states s
    where s.series_id = p_series_id
      and s.round_number = v_series.round_number
      and s.round_step = v_round_step_value;

    if not p_force and exists (
      select 1
      from public.series_round_ban_phase_turns t
      where t.series_id = p_series_id
        and t.round_number = v_series.round_number
        and t.round_step = v_round_step_value
        and t.completed_at is null
    ) then
      raise exception 'Not all Ban Phase turns are complete';
    end if;

    if not p_force and coalesce(v_ban_phase_state.system_bans_generated_at is not null, false) = false then
      raise exception 'System bans have not been generated yet';
    end if;

    if not p_force and v_player_count > 0 and v_ready_count < v_player_count then
      raise exception 'Not all players have confirmed the Ban Phase';
    end if;

    update public.game_series
    set
      current_phase = 'binder',
      updated_at = now()
    where id = p_series_id
    returning *
    into v_series;

    perform public._initialize_series_binder_phase(p_series_id);
  elsif v_series.current_phase = 'binder' then
    perform public._initialize_series_binder_phase(p_series_id);

    if not p_force and exists (
      select 1
      from public.series_round_binder_phase_turns t
      where t.series_id = p_series_id
        and t.round_number = v_series.round_number
        and t.round_step = v_round_step_value
        and t.completed_at is null
    ) then
      raise exception 'Not all Binder Phase turns are complete';
    end if;

    if not p_force and v_player_count > 0 and v_ready_count < v_player_count then
      raise exception 'Not all players are ready to leave Binder Phase';
    end if;

    update public.game_series
    set
      current_phase = 'feature',
      updated_at = now()
    where id = p_series_id
    returning *
    into v_series;

    perform public._initialize_series_feature_phase(p_series_id);
  elsif v_series.current_phase = 'feature' then
    perform public._initialize_series_feature_phase(p_series_id);

    if not p_force and exists (
      select 1
      from public.series_round_feature_phase_turns t
      where t.series_id = p_series_id
        and t.round_number = v_series.round_number
        and t.round_step = v_round_step_value
        and t.completed_at is null
    ) then
      raise exception 'Not all Feature Phase turns are complete';
    end if;

    update public.game_series
    set
      current_phase = 'draft',
      updated_at = now()
    where id = p_series_id
    returning *
    into v_series;
  elsif v_series.current_phase = 'draft' then
    if not p_force and v_player_count > 0 and v_ready_count < v_player_count then
      raise exception 'Not all players are ready to leave Draft Phase';
    end if;

    update public.game_series
    set
      current_phase = 'deckbuilding',
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
    v_completed_step := case
      when v_previous_round = 0 then 1
      else greatest(1, least(2, public._progression_round_step_value(v_series.round_step)))
    end;

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

    perform public._award_completed_main_round_tokens(
      p_series_id,
      v_previous_round,
      v_completed_step
    );

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

revoke all on function public._open_box_direct_for_user(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public._open_box_direct_batch_for_user(uuid, uuid, uuid, integer) from public, anon, authenticated;

commit;
