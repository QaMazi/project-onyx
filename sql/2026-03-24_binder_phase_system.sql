begin;

create extension if not exists pgcrypto;

create table if not exists public.series_round_binder_phase_states (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.game_series (id) on delete cascade,
  round_number integer not null,
  round_step integer not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (series_id, round_number, round_step)
);

create table if not exists public.series_round_binder_phase_turns (
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
    where conname = 'series_round_binder_phase_turns_choice_option_check'
      and conrelid = 'public.series_round_binder_phase_turns'::regclass
  ) then
    alter table public.series_round_binder_phase_turns
      add constraint series_round_binder_phase_turns_choice_option_check
      check (
        choice_option is null
        or choice_option in (
          'binder_removal',
          'forced_trade',
          'card_lockout',
          'gambled_removal',
          'binder_stack',
          'ban_list_cards',
          'promo_box_open',
          'draft_pack_keys'
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
    where conname = 'series_round_binder_phase_turns_choice_source_check'
      and conrelid = 'public.series_round_binder_phase_turns'::regclass
  ) then
    alter table public.series_round_binder_phase_turns
      add constraint series_round_binder_phase_turns_choice_source_check
      check (
        choice_source is null
        or choice_source in ('manual', 'automatic')
      );
  end if;
end;
$$;

create index if not exists idx_series_round_binder_phase_turns_lookup
  on public.series_round_binder_phase_turns (series_id, round_number, round_step, turn_order);

create or replace function public._is_binder_phase_target_eligible(
  p_series_id uuid,
  p_actor_id uuid,
  p_target_user_id uuid,
  p_actor_overall_position integer default null
)
returns boolean
language sql
security definer
set search_path to 'public', 'auth'
as $function$
  with scoreboard as (
    select
      (entry ->> 'user_id')::uuid as user_id,
      nullif(entry ->> 'position', '')::integer as overall_position,
      nullif(entry ->> 'points', '')::integer as total_points,
      nullif(entry ->> 'shards', '')::integer as total_shards
    from jsonb_array_elements(public._build_series_scoreboard_json(p_series_id)) entry
  ),
  actor_row as (
    select
      coalesce(p_actor_overall_position, scoreboard.overall_position) as actor_overall_position,
      scoreboard.total_points as actor_total_points,
      scoreboard.total_shards as actor_total_shards
    from scoreboard
    where scoreboard.user_id = p_actor_id
    limit 1
  )
  select exists (
    select 1
    from public.series_players sp
    join scoreboard target_row
      on target_row.user_id = sp.user_id
    cross join actor_row
    left join public.player_series_protections protection
      on protection.series_id = sp.series_id
     and protection.user_id = sp.user_id
     and protection.rounds_remaining > 0
    where sp.series_id = p_series_id
      and sp.user_id = p_target_user_id
      and sp.user_id <> p_actor_id
      and protection.id is null
      and actor_row.actor_overall_position is not null
      and target_row.overall_position is not null
      and (
        target_row.overall_position < actor_row.actor_overall_position
        or (
          target_row.total_points is not null
          and actor_row.actor_total_points is not null
          and target_row.total_shards is not null
          and actor_row.actor_total_shards is not null
          and target_row.total_points = actor_row.actor_total_points
          and target_row.total_shards = actor_row.actor_total_shards
        )
      )
  );
$function$;

create or replace function public._binder_phase_target_pool_json(
  p_series_id uuid,
  p_actor_id uuid,
  p_actor_overall_position integer default null
)
returns jsonb
language sql
security definer
set search_path to 'public', 'auth'
as $function$
  with scoreboard as (
    select
      (entry ->> 'user_id')::uuid as user_id,
      nullif(entry ->> 'position', '')::integer as overall_position,
      nullif(entry ->> 'points', '')::integer as total_points,
      nullif(entry ->> 'shards', '')::integer as total_shards
    from jsonb_array_elements(public._build_series_scoreboard_json(p_series_id)) entry
  ),
  actor_row as (
    select
      coalesce(p_actor_overall_position, scoreboard.overall_position) as actor_overall_position,
      scoreboard.total_points as actor_total_points,
      scoreboard.total_shards as actor_total_shards
    from scoreboard
    where scoreboard.user_id = p_actor_id
    limit 1
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', sp.user_id,
        'username', coalesce(spv.username, 'Unknown Duelist'),
        'avatar', coalesce(spv.avatar, ''),
        'overall_position', scoreboard.overall_position
      )
      order by scoreboard.overall_position asc, coalesce(spv.username, 'Unknown Duelist') asc
    ),
    '[]'::jsonb
  )
  from public.series_players sp
  join scoreboard
    on scoreboard.user_id = sp.user_id
  cross join actor_row
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
    and actor_row.actor_overall_position is not null
    and scoreboard.overall_position is not null
    and (
      scoreboard.overall_position < actor_row.actor_overall_position
      or (
        scoreboard.total_points is not null
        and actor_row.actor_total_points is not null
        and scoreboard.total_shards is not null
        and actor_row.actor_total_shards is not null
        and scoreboard.total_points = actor_row.actor_total_points
        and scoreboard.total_shards = actor_row.actor_total_shards
      )
    );
$function$;

create or replace function public._initialize_series_binder_phase(p_series_id uuid)
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

  if v_series.current_phase <> 'binder' or coalesce(v_series.round_number, 0) <= 0 then
    return;
  end if;

  insert into public.series_round_binder_phase_states (
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
    from public.series_round_binder_phase_turns t
    where t.series_id = p_series_id
      and t.round_number = v_series.round_number
      and t.round_step = v_series.round_step_value
  ) then
    return;
  end if;

  insert into public.series_round_binder_phase_turns (
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

create or replace function public._open_promo_box_direct_for_user(
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
    and ct.code = 'promo_box'
    and coalesce(c.is_enabled, true) = true
    and coalesce(c.is_locked, false) = false;

  if not found then
    raise exception 'Promo Box not found or is locked';
  end if;

  select r.id, r.code, r.name
  into v_fallback_rarity
  from public.card_rarities r
  where r.id = public._resolve_common_rarity_id();

  v_selected_box_tier := public._roll_enabled_box_tier(v_container.id);
  v_selected_box_tier_id := nullif(coalesce(v_selected_box_tier ->> 'id', ''), '')::uuid;

  if v_selected_box_tier_id is null then
    raise exception 'This Promo Box has no eligible tier pools configured';
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
    raise exception 'The selected Promo Box tier has no eligible cards configured';
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

create or replace function public._open_promo_box_direct_batch_for_user(
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
    and ct.code = 'promo_box'
    and coalesce(c.is_enabled, true) = true
    and coalesce(c.is_locked, false) = false
  limit 1;

  if not found then
    raise exception 'Promo Box not found or is locked';
  end if;

  for v_open_index in 1..v_requested_count loop
    v_open_result := public._open_promo_box_direct_for_user(
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

revoke all on function public._open_promo_box_direct_for_user(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public._open_promo_box_direct_batch_for_user(uuid, uuid, uuid, integer) from public, anon, authenticated;

create or replace function public.get_current_binder_phase_visible_binder_cards(
  p_series_id uuid,
  p_target_user_id uuid default null
)
returns setof public.binder_cards_view
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_target_user_id uuid;
  v_series record;
  v_my_turn record;
begin
  v_actor_id := public._assert_authenticated_user();
  v_target_user_id := coalesce(p_target_user_id, v_actor_id);

  perform public._assert_series_member(p_series_id, v_actor_id);
  perform public._assert_series_member(p_series_id, v_target_user_id);

  select
    gs.*,
    public._progression_round_step_value(gs.round_step) as round_step_value
  into v_series
  from public.game_series gs
  where gs.id = p_series_id;

  if not found then
    raise exception 'Series not found';
  end if;

  if v_series.current_phase <> 'binder' or coalesce(v_series.round_number, 0) <= 0 then
    raise exception 'Binder Phase is not active';
  end if;

  perform public._initialize_series_binder_phase(p_series_id);

  select *
  into v_my_turn
  from public.series_round_binder_phase_turns t
  where t.series_id = p_series_id
    and t.round_number = v_series.round_number
    and t.round_step = v_series.round_step_value
    and t.user_id = v_actor_id
  limit 1;

  if v_target_user_id <> v_actor_id
     and not public._is_binder_phase_target_eligible(
       p_series_id,
       v_actor_id,
       v_target_user_id,
       v_my_turn.overall_position
     ) then
    raise exception 'That opponent is not eligible for Binder Phase effects right now';
  end if;

  return query
  select view_rows.*
  from public.binder_cards_view view_rows
  where view_rows.user_id = v_target_user_id
    and view_rows.series_id = p_series_id
    and not exists (
      select 1
      from public.player_card_vault_entries vault
      where vault.user_id = v_target_user_id
        and vault.series_id = p_series_id
        and vault.card_id = view_rows.card_id
    )
  order by view_rows.card_name asc, view_rows.rarity_sort_order asc;
end;
$function$;

create or replace function public._resolve_binder_phase_stack_cap_rarity_id()
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
  where lower(coalesce(r.name, '')) = 'infused'
  order by coalesce(r.sort_order, 9999), r.name
  limit 1;

  if v_rarity_id is not null then
    return v_rarity_id;
  end if;

  select r.id
  into v_rarity_id
  from public.card_rarities r
  order by coalesce(r.sort_order, 9999), r.name
  offset 3
  limit 1;

  return v_rarity_id;
end;
$function$;

create or replace function public.get_current_binder_phase_state(p_series_id uuid)
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
  v_player_count integer := 0;
  v_ready_count integer := 0;
  v_already_confirmed boolean := false;
  v_turns jsonb := '[]'::jsonb;
  v_hostile_targets jsonb := '[]'::jsonb;
  v_promo_boxes jsonb := '[]'::jsonb;
  v_banlist_cards jsonb := '[]'::jsonb;
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

  if v_series.current_phase <> 'binder' or coalesce(v_series.round_number, 0) <= 0 then
    return jsonb_build_object(
      'active', false,
      'current_phase', v_series.current_phase,
      'round_number', v_series.round_number,
      'round_step', v_series.round_step_value
    );
  end if;

  perform public._initialize_series_binder_phase(p_series_id);

  select count(*)
  into v_player_count
  from public.series_round_binder_phase_turns t
  where t.series_id = p_series_id
    and t.round_number = v_series.round_number
    and t.round_step = v_series.round_step_value;

  select *
  into v_current_turn
  from public.series_round_binder_phase_turns t
  where t.series_id = p_series_id
    and t.round_number = v_series.round_number
    and t.round_step = v_series.round_step_value
    and t.completed_at is null
  order by t.turn_order
  limit 1;

  select *
  into v_my_turn
  from public.series_round_binder_phase_turns t
  where t.series_id = p_series_id
    and t.round_number = v_series.round_number
    and t.round_step = v_series.round_step_value
    and t.user_id = v_actor_id
  limit 1;

  select exists (
    select 1
    from public.series_phase_ready_states rs
    where rs.series_id = p_series_id
      and rs.round_number = v_series.round_number
      and rs.round_step = v_series.round_step_value
      and rs.phase = 'binder'
      and rs.user_id = v_actor_id
  )
  into v_already_confirmed;

  select count(*)
  into v_ready_count
  from public.series_phase_ready_states rs
  where rs.series_id = p_series_id
    and rs.round_number = v_series.round_number
    and rs.round_step = v_series.round_step_value
    and rs.phase = 'binder';

  if v_my_turn.id is not null then
    v_hostile_targets := public._binder_phase_target_pool_json(
      p_series_id,
      v_actor_id,
      v_my_turn.overall_position
    );
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'code', c.code,
        'image_url', coalesce(nullif(c.artwork_url, ''), nullif(c.image_url, ''))
      )
      order by c.code asc, c.name asc
    ),
    '[]'::jsonb
  )
  into v_promo_boxes
  from public.containers c
  join public.container_types ct
    on ct.id = c.container_type_id
  where ct.code = 'promo_box'
    and coalesce(c.is_enabled, true) = true
    and coalesce(c.is_locked, false) = false;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'card_id', b.card_id,
        'card_name', cards.name,
        'status', b.status,
        'source_kind', b.source_kind
      )
      order by cards.name asc
    ),
    '[]'::jsonb
  )
  into v_banlist_cards
  from public.series_banlist_cards b
  join public.cards
    on cards.id = b.card_id
  where b.series_id = p_series_id
    and b.status in ('forbidden', 'limited', 'semi_limited');

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
  from public.series_round_binder_phase_turns t
  left join public.series_players_view spv
    on spv.series_id = t.series_id
   and spv.user_id = t.user_id
  where t.series_id = p_series_id
    and t.round_number = v_series.round_number
    and t.round_step = v_series.round_step_value;

  if v_current_turn.id is not null and v_current_turn.user_id = v_actor_id then
    if v_my_turn.choice_option is null then
      v_my_action_state := 'choose_option';
    elsif v_my_turn.completed_at is null then
      v_my_action_state := 'resolve_choice';
    else
      v_my_action_state := 'waiting';
    end if;
  elsif v_current_turn.id is null then
    if v_already_confirmed then
      v_my_action_state := 'confirmed';
    else
      v_my_action_state := 'confirm';
    end if;
  end if;

  return jsonb_build_object(
    'active', true,
    'current_phase', v_series.current_phase,
    'round_number', v_series.round_number,
    'round_step', v_series.round_step_value,
    'player_count', v_player_count,
    'confirmation_count', v_ready_count,
    'current_turn_user_id', v_current_turn.user_id,
    'current_turn_order', v_current_turn.turn_order,
    'is_my_turn',
      case
        when v_current_turn.id is not null and v_current_turn.user_id = v_actor_id then true
        else false
      end,
    'my_choice_option', v_my_turn.choice_option,
    'my_action_state', v_my_action_state,
    'already_confirmed', v_already_confirmed,
    'can_confirm',
      case
        when v_current_turn.id is null and not v_already_confirmed then true
        else false
      end,
    'hostile_targets', v_hostile_targets,
    'promo_boxes', v_promo_boxes,
    'banlist_cards', v_banlist_cards,
    'turns', v_turns
  );
end;
$function$;

create or replace function public.choose_current_binder_phase_option(
  p_series_id uuid,
  p_choice_option text
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
  v_choice_option text := lower(trim(coalesce(p_choice_option, '')));
  v_reward_item_id uuid;
  v_hostile_target_count integer := 0;
  v_promo_box_count integer := 0;
  v_banlist_count integer := 0;
begin
  v_actor_id := public._assert_authenticated_user();
  perform public._assert_series_member_for_claim(p_series_id, v_actor_id);

  if v_choice_option not in (
    'binder_removal',
    'forced_trade',
    'card_lockout',
    'gambled_removal',
    'binder_stack',
    'ban_list_cards',
    'promo_box_open',
    'draft_pack_keys'
  ) then
    raise exception 'Unsupported binder phase option';
  end if;

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

  if v_series.current_phase <> 'binder' or coalesce(v_series.round_number, 0) <= 0 then
    raise exception 'Binder Phase is not active';
  end if;

  perform public._initialize_series_binder_phase(p_series_id);

  select *
  into v_current_turn
  from public.series_round_binder_phase_turns t
  where t.series_id = p_series_id
    and t.round_number = v_series.round_number
    and t.round_step = v_series.round_step_value
    and t.completed_at is null
  order by t.turn_order
  limit 1
  for update;

  if not found then
    raise exception 'Binder Phase choices are already complete';
  end if;

  if v_current_turn.user_id <> v_actor_id then
    raise exception 'It is not your turn to choose a Binder Phase option';
  end if;

  if v_current_turn.choice_option is not null then
    raise exception 'You already selected a Binder Phase option';
  end if;

  if v_choice_option in ('binder_removal', 'forced_trade', 'card_lockout', 'gambled_removal') then
    select jsonb_array_length(
      public._binder_phase_target_pool_json(
        p_series_id,
        v_actor_id,
        v_current_turn.overall_position
      )
    )
    into v_hostile_target_count;

    if coalesce(v_hostile_target_count, 0) <= 0 then
      raise exception 'No eligible opponents are ahead of you or tied with you on the overall scoreboard';
    end if;
  end if;

  if v_choice_option in ('gambled_removal', 'promo_box_open') then
    select count(*)
    into v_promo_box_count
    from public.containers c
    join public.container_types ct
      on ct.id = c.container_type_id
    where ct.code = 'promo_box'
      and coalesce(c.is_enabled, true) = true
      and coalesce(c.is_locked, false) = false;

    if v_promo_box_count <= 0 then
      raise exception 'No promo boxes are currently available';
    end if;
  end if;

  if v_choice_option = 'ban_list_cards' then
    select count(*)
    into v_banlist_count
    from public.series_banlist_cards b
    where b.series_id = p_series_id
      and b.status in ('forbidden', 'limited', 'semi_limited');

    if v_banlist_count <= 0 then
      raise exception 'There are no current banlist cards to claim';
    end if;
  end if;

  if v_choice_option = 'draft_pack_keys' then
    select i.id
    into v_reward_item_id
    from public.item_definitions i
    where i.code = 'random_draft_pack_key'
    limit 1;

    if v_reward_item_id is null then
      raise exception 'Random Draft Pack Key item definition is missing';
    end if;

    perform public._grant_series_item(
      p_series_id,
      v_actor_id,
      v_reward_item_id,
      4,
      v_actor_id,
      format('binder_phase:%s:%s:draft_pack_keys', v_series.round_number, v_series.round_step_value)
    );

    update public.series_round_binder_phase_turns
    set
      choice_option = v_choice_option,
      choice_source = 'manual',
      resolved_payload = jsonb_build_object(
        'grants',
        jsonb_build_array(
          jsonb_build_object(
            'type', 'item',
            'item_definition_id', v_reward_item_id,
            'label', 'Random Draft Pack Key',
            'quantity', 4
          )
        )
      ),
      completed_at = now(),
      updated_at = now()
    where id = v_current_turn.id;
  else
    update public.series_round_binder_phase_turns
    set
      choice_option = v_choice_option,
      choice_source = 'manual',
      resolved_payload = '{}'::jsonb,
      updated_at = now()
    where id = v_current_turn.id;
  end if;

  return public.get_current_binder_phase_state(p_series_id);
end;
$function$;

create or replace function public.resolve_current_binder_phase_choice(
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
  v_target_user_id uuid;
  v_target_username text;
  v_container_id uuid;
  v_card_ids bigint[];
  v_card_id bigint;
  v_binder_card_row_id uuid;
  v_card_name text;
  v_selected_card_name text;
  v_removed_quantity integer;
  v_total_owned integer;
  v_add_quantity integer;
  v_cap_rarity_id uuid;
  v_cap_rarity_name text;
  v_cap_sort_order integer := 9999;
  v_selected_binder_row record;
  v_open_result jsonb := '{}'::jsonb;
  v_resolved_payload jsonb := '{}'::jsonb;
  v_take_total integer := 0;
  v_give_total integer := 0;
  v_take_orders integer[];
  v_give_orders integer[];
  v_take_details jsonb := '[]'::jsonb;
  v_give_details jsonb := '[]'::jsonb;
  v_index integer := 1;
  v_option_count integer := 0;
  v_affected_card record;
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

  if v_series.current_phase <> 'binder' or coalesce(v_series.round_number, 0) <= 0 then
    raise exception 'Binder Phase is not active';
  end if;

  perform public._initialize_series_binder_phase(p_series_id);

  select *
  into v_current_turn
  from public.series_round_binder_phase_turns t
  where t.series_id = p_series_id
    and t.round_number = v_series.round_number
    and t.round_step = v_series.round_step_value
    and t.completed_at is null
  order by t.turn_order
  limit 1
  for update;

  if not found then
    raise exception 'Binder Phase choices are already complete';
  end if;

  if v_current_turn.user_id <> v_actor_id then
    raise exception 'It is not your turn to resolve a Binder Phase option';
  end if;

  if v_current_turn.choice_option is null then
    raise exception 'Choose a Binder Phase option first';
  end if;

  if v_current_turn.completed_at is not null then
    raise exception 'Your Binder Phase option is already complete';
  end if;

  if v_current_turn.choice_option = 'binder_removal' then
    v_target_user_id := nullif(coalesce(p_payload ->> 'target_user_id', ''), '')::uuid;
    v_card_id := nullif(coalesce(p_payload ->> 'card_id', ''), '')::bigint;

    if v_target_user_id is null or v_card_id is null then
      raise exception 'Choose an opponent and one binder card to remove';
    end if;

    if not public._is_binder_phase_target_eligible(
      p_series_id,
      v_actor_id,
      v_target_user_id,
      v_current_turn.overall_position
    ) then
      raise exception 'That opponent is not eligible for Binder Removal';
    end if;

    select cards.name
    into v_selected_card_name
    from public.cards
    where cards.id = v_card_id
    limit 1;

    if v_selected_card_name is null then
      raise exception 'That card is no longer valid';
    end if;

    select
      coalesce(sum(bc.quantity), 0)::integer,
      v_selected_card_name
    into v_removed_quantity, v_card_name
    from public.binder_cards bc
    join public.cards
      on cards.id = bc.card_id
    where bc.user_id = v_target_user_id
      and bc.series_id = p_series_id
      and cards.name = v_selected_card_name
      and not exists (
        select 1
        from public.player_card_vault_entries vault
        where vault.user_id = v_target_user_id
          and vault.series_id = p_series_id
          and vault.card_id = bc.card_id
      );

    if coalesce(v_removed_quantity, 0) <= 0 then
      raise exception 'That card is no longer available in the target binder';
    end if;

    for v_affected_card in
      select
        bc.card_id,
        coalesce(sum(bc.quantity), 0)::integer as quantity
      from public.binder_cards bc
      join public.cards
        on cards.id = bc.card_id
      where bc.user_id = v_target_user_id
        and bc.series_id = p_series_id
        and cards.name = v_selected_card_name
        and not exists (
          select 1
          from public.player_card_vault_entries vault
          where vault.user_id = v_target_user_id
            and vault.series_id = p_series_id
            and vault.card_id = bc.card_id
        )
      group by bc.card_id
    loop
      perform public._assert_dueling_card_quantity_available(
        p_series_id,
        v_target_user_id,
        v_affected_card.card_id,
        v_affected_card.quantity
      );
    end loop;

    delete from public.binder_cards bc
    using public.cards
    where bc.user_id = v_target_user_id
      and bc.series_id = p_series_id
      and cards.id = bc.card_id
      and cards.name = v_selected_card_name;

    perform public._revalidate_active_deck(p_series_id, v_target_user_id);

    select coalesce(spv.username, 'Player')
    into v_target_username
    from public.series_players_view spv
    where spv.series_id = p_series_id
      and spv.user_id = v_target_user_id;

    v_resolved_payload := jsonb_build_object(
      'type', 'binder_removal',
      'target_user_id', v_target_user_id,
      'target_username', v_target_username,
      'removed_card_id', v_card_id,
      'removed_card_name', v_card_name,
      'removed_quantity', v_removed_quantity
    );
  elsif v_current_turn.choice_option = 'forced_trade' then
    v_target_user_id := nullif(coalesce(p_payload ->> 'target_user_id', ''), '')::uuid;

    if v_target_user_id is null then
      raise exception 'Choose an opponent for Forced Trade';
    end if;

    if not public._is_binder_phase_target_eligible(
      p_series_id,
      v_actor_id,
      v_target_user_id,
      v_current_turn.overall_position
    ) then
      raise exception 'That opponent is not eligible for Forced Trade';
    end if;

    with give_inputs as (
      select
        input_rows.binder_card_id,
        sum(greatest(coalesce(input_rows.quantity, 0), 0))::integer as quantity
      from jsonb_to_recordset(coalesce(p_payload -> 'give_selections', '[]'::jsonb))
        as input_rows(binder_card_id uuid, quantity integer)
      group by input_rows.binder_card_id
    )
    select
      coalesce(sum(give_inputs.quantity), 0)::integer,
      coalesce(
        array_agg(coalesce(r.sort_order, 9999) order by coalesce(r.sort_order, 9999) desc),
        '{}'::integer[]
      ),
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'binder_card_id', bc.id,
            'card_id', bc.card_id,
            'card_name', cards.name,
            'rarity_id', bc.rarity_id,
            'rarity_name', coalesce(r.name, 'Unknown'),
            'rarity_sort_order', coalesce(r.sort_order, 9999),
            'quantity', give_inputs.quantity
          )
          order by cards.name asc
        ),
        '[]'::jsonb
      )
    into v_give_total, v_give_orders, v_give_details
    from give_inputs
    join public.binder_cards bc
      on bc.id = give_inputs.binder_card_id
    join public.cards
      on cards.id = bc.card_id
    left join public.card_rarities r
      on r.id = bc.rarity_id
    where bc.user_id = v_actor_id
      and bc.series_id = p_series_id
      and bc.quantity >= give_inputs.quantity
      and not exists (
        select 1
        from public.player_card_vault_entries vault
        where vault.user_id = v_actor_id
          and vault.series_id = p_series_id
          and vault.card_id = bc.card_id
      );

    with take_inputs as (
      select
        input_rows.binder_card_id,
        sum(greatest(coalesce(input_rows.quantity, 0), 0))::integer as quantity
      from jsonb_to_recordset(coalesce(p_payload -> 'take_selections', '[]'::jsonb))
        as input_rows(binder_card_id uuid, quantity integer)
      group by input_rows.binder_card_id
    )
    select
      coalesce(sum(take_inputs.quantity), 0)::integer,
      coalesce(
        array_agg(coalesce(r.sort_order, 9999) order by coalesce(r.sort_order, 9999) desc),
        '{}'::integer[]
      ),
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'binder_card_id', bc.id,
            'card_id', bc.card_id,
            'card_name', cards.name,
            'rarity_id', bc.rarity_id,
            'rarity_name', coalesce(r.name, 'Unknown'),
            'rarity_sort_order', coalesce(r.sort_order, 9999),
            'quantity', take_inputs.quantity
          )
          order by cards.name asc
        ),
        '[]'::jsonb
      )
    into v_take_total, v_take_orders, v_take_details
    from take_inputs
    join public.binder_cards bc
      on bc.id = take_inputs.binder_card_id
    join public.cards
      on cards.id = bc.card_id
    left join public.card_rarities r
      on r.id = bc.rarity_id
    where bc.user_id = v_target_user_id
      and bc.series_id = p_series_id
      and bc.quantity >= take_inputs.quantity
      and not exists (
        select 1
        from public.player_card_vault_entries vault
        where vault.user_id = v_target_user_id
          and vault.series_id = p_series_id
          and vault.card_id = bc.card_id
      );

    if v_give_total <> 2 or v_take_total <> 2 then
      raise exception 'Forced Trade needs exactly 2 cards from each player';
    end if;

    if array_length(v_take_orders, 1) <> array_length(v_give_orders, 1) then
      raise exception 'Forced Trade rarity comparison failed';
    end if;

    for v_index in 1..coalesce(array_length(v_take_orders, 1), 0) loop
      if coalesce(v_take_orders[v_index], 9999) > coalesce(v_give_orders[v_index], 9999) then
        raise exception 'You must take equal or lower rarities in Forced Trade';
      end if;
    end loop;

    for v_binder_card_row_id, v_removed_quantity in
      with give_inputs as (
        select
          input_rows.binder_card_id,
          sum(greatest(coalesce(input_rows.quantity, 0), 0))::integer as quantity
        from jsonb_to_recordset(coalesce(p_payload -> 'give_selections', '[]'::jsonb))
          as input_rows(binder_card_id uuid, quantity integer)
        group by input_rows.binder_card_id
      )
      select give_inputs.binder_card_id, give_inputs.quantity
      from give_inputs
    loop
      perform public._assert_dueling_card_quantity_available(
        p_series_id,
        v_actor_id,
        (
          select bc.card_id
          from public.binder_cards bc
          where bc.id = v_binder_card_row_id
        ),
        v_removed_quantity
      );

      perform public._transfer_binder_cards(v_binder_card_row_id, v_target_user_id, v_removed_quantity, false);
    end loop;

    for v_binder_card_row_id, v_removed_quantity in
      with take_inputs as (
        select
          input_rows.binder_card_id,
          sum(greatest(coalesce(input_rows.quantity, 0), 0))::integer as quantity
        from jsonb_to_recordset(coalesce(p_payload -> 'take_selections', '[]'::jsonb))
          as input_rows(binder_card_id uuid, quantity integer)
        group by input_rows.binder_card_id
      )
      select take_inputs.binder_card_id, take_inputs.quantity
      from take_inputs
    loop
      perform public._assert_dueling_card_quantity_available(
        p_series_id,
        v_target_user_id,
        (
          select bc.card_id
          from public.binder_cards bc
          where bc.id = v_binder_card_row_id
        ),
        v_removed_quantity
      );

      perform public._transfer_binder_cards(v_binder_card_row_id, v_actor_id, v_removed_quantity, false);
    end loop;

    perform public._revalidate_active_deck(p_series_id, v_actor_id);
    perform public._revalidate_active_deck(p_series_id, v_target_user_id);

    select coalesce(spv.username, 'Player')
    into v_target_username
    from public.series_players_view spv
    where spv.series_id = p_series_id
      and spv.user_id = v_target_user_id;

    v_resolved_payload := jsonb_build_object(
      'type', 'forced_trade',
      'target_user_id', v_target_user_id,
      'target_username', v_target_username,
      'gave', v_give_details,
      'received', v_take_details
    );
  elsif v_current_turn.choice_option = 'card_lockout' then
    v_target_user_id := nullif(coalesce(p_payload ->> 'target_user_id', ''), '')::uuid;
    v_card_ids := array(
      select distinct nullif(value, '')::bigint
      from jsonb_array_elements_text(coalesce(p_payload -> 'card_ids', '[]'::jsonb))
    );

    if v_target_user_id is null or coalesce(array_length(v_card_ids, 1), 0) <> 3 then
      raise exception 'Choose one eligible opponent and 3 different card names';
    end if;

    if not public._is_binder_phase_target_eligible(
      p_series_id,
      v_actor_id,
      v_target_user_id,
      v_current_turn.overall_position
    ) then
      raise exception 'That opponent is not eligible for Card Lockout';
    end if;

    foreach v_card_id in array v_card_ids loop
      if not exists (
        select 1
        from public.binder_cards bc
        where bc.user_id = v_target_user_id
          and bc.series_id = p_series_id
          and bc.card_id = v_card_id
          and bc.quantity > 0
          and not exists (
            select 1
            from public.player_card_vault_entries vault
            where vault.user_id = v_target_user_id
              and vault.series_id = p_series_id
              and vault.card_id = bc.card_id
          )
      ) then
        raise exception 'One of the selected card names is no longer available';
      end if;

      update public.player_card_curses
      set
        is_active = true,
        expires_at = null,
        round_number = v_series.round_number,
        updated_at = now(),
        source_user_id = v_actor_id,
        item_definition_id = null,
        notes = format('binder_phase:%s:%s:card_lockout', v_series.round_number, v_series.round_step_value)
      where series_id = p_series_id
        and target_user_id = v_target_user_id
        and card_id = v_card_id
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
          p_series_id,
          v_target_user_id,
          v_actor_id,
          null,
          v_card_id,
          'curse',
          v_series.round_number,
          true,
          format('binder_phase:%s:%s:card_lockout', v_series.round_number, v_series.round_step_value)
        );
      end if;
    end loop;

    perform public._revalidate_active_deck(p_series_id, v_target_user_id);

    select coalesce(spv.username, 'Player')
    into v_target_username
    from public.series_players_view spv
    where spv.series_id = p_series_id
      and spv.user_id = v_target_user_id;

    v_resolved_payload := jsonb_build_object(
      'type', 'card_lockout',
      'target_user_id', v_target_user_id,
      'target_username', v_target_username,
      'card_ids', to_jsonb(v_card_ids)
    );
  elsif v_current_turn.choice_option = 'gambled_removal' then
    v_target_user_id := nullif(coalesce(p_payload ->> 'target_user_id', ''), '')::uuid;
    v_container_id := nullif(coalesce(p_payload ->> 'container_id', ''), '')::uuid;
    v_card_ids := array(
      select distinct nullif(value, '')::bigint
      from jsonb_array_elements_text(coalesce(p_payload -> 'card_ids', '[]'::jsonb))
    );

    if v_target_user_id is null or v_container_id is null or coalesce(array_length(v_card_ids, 1), 0) <> 2 then
      raise exception 'Choose one opponent, two different card names, and one promo box';
    end if;

    if not public._is_binder_phase_target_eligible(
      p_series_id,
      v_actor_id,
      v_target_user_id,
      v_current_turn.overall_position
    ) then
      raise exception 'That opponent is not eligible for Gambled Removal';
    end if;

    select count(*)
    into v_option_count
    from public.containers c
    join public.container_types ct
      on ct.id = c.container_type_id
    where c.id = v_container_id
      and ct.code = 'promo_box'
      and coalesce(c.is_enabled, true) = true
      and coalesce(c.is_locked, false) = false;

    if v_option_count <= 0 then
      raise exception 'That promo box is not available';
    end if;

    v_resolved_payload := jsonb_build_object(
      'type', 'gambled_removal',
      'removed', '[]'::jsonb
    );

    foreach v_card_id in array v_card_ids loop
      select
        coalesce(sum(bc.quantity), 0)::integer,
        max(cards.name)
      into v_removed_quantity, v_card_name
      from public.binder_cards bc
      join public.cards
        on cards.id = bc.card_id
      where bc.user_id = v_target_user_id
        and bc.series_id = p_series_id
        and bc.card_id = v_card_id
        and not exists (
          select 1
          from public.player_card_vault_entries vault
          where vault.user_id = v_target_user_id
            and vault.series_id = p_series_id
            and vault.card_id = bc.card_id
        );

      if coalesce(v_removed_quantity, 0) <= 0 then
        raise exception 'One of the selected cards is no longer available';
      end if;

      perform public._assert_dueling_card_quantity_available(
        p_series_id,
        v_target_user_id,
        v_card_id,
        v_removed_quantity
      );

      delete from public.binder_cards bc
      where bc.user_id = v_target_user_id
        and bc.series_id = p_series_id
        and bc.card_id = v_card_id;

      v_resolved_payload := jsonb_set(
        v_resolved_payload,
        '{removed}',
        coalesce(v_resolved_payload -> 'removed', '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object(
            'card_id', v_card_id,
            'card_name', v_card_name,
            'removed_quantity', v_removed_quantity
          )
        )
      );
    end loop;

    perform public._revalidate_active_deck(p_series_id, v_target_user_id);

    v_open_result := public._open_promo_box_direct_batch_for_user(
      p_series_id,
      v_target_user_id,
      v_container_id,
      2
    );

    select coalesce(spv.username, 'Player')
    into v_target_username
    from public.series_players_view spv
    where spv.series_id = p_series_id
      and spv.user_id = v_target_user_id;

    v_resolved_payload := v_resolved_payload || jsonb_build_object(
      'target_user_id', v_target_user_id,
      'target_username', v_target_username,
      'promo_box_open_result', v_open_result
    );
  elsif v_current_turn.choice_option = 'binder_stack' then
    select
      bc.*,
      cards.name as card_name,
      coalesce(r.name, 'Unknown') as rarity_name,
      coalesce(r.sort_order, 9999) as rarity_sort_order
    into v_selected_binder_row
    from public.binder_cards bc
    join public.cards
      on cards.id = bc.card_id
    left join public.card_rarities r
      on r.id = bc.rarity_id
    where bc.id = nullif(coalesce(p_payload ->> 'binder_card_id', ''), '')::uuid
      and bc.user_id = v_actor_id
      and bc.series_id = p_series_id
      and not exists (
        select 1
        from public.player_card_vault_entries vault
        where vault.user_id = v_actor_id
          and vault.series_id = p_series_id
          and vault.card_id = bc.card_id
      )
    for update;

    if v_selected_binder_row.id is null then
      raise exception 'Choose one of your binder cards to stack';
    end if;

    v_cap_rarity_id := public._resolve_binder_phase_stack_cap_rarity_id();

    select coalesce(r.sort_order, 9999), coalesce(r.name, 'Infused')
    into v_cap_sort_order, v_cap_rarity_name
    from public.card_rarities r
    where r.id = v_cap_rarity_id;

    if v_selected_binder_row.rarity_sort_order > v_cap_sort_order then
      raise exception 'Binder Stack is capped at % rarity', v_cap_rarity_name;
    end if;

    select coalesce(sum(bc.quantity), 0)::integer
    into v_total_owned
    from public.binder_cards bc
    where bc.user_id = v_actor_id
      and bc.series_id = p_series_id
      and bc.card_id = v_selected_binder_row.card_id;

    if v_total_owned >= 3 then
      raise exception 'You already own 3 or more copies of that card';
    end if;

    v_add_quantity := 3 - v_total_owned;

    update public.binder_cards
    set
      quantity = quantity + v_add_quantity,
      updated_at = now()
    where id = v_selected_binder_row.id;

    v_resolved_payload := jsonb_build_object(
      'type', 'binder_stack',
      'card_id', v_selected_binder_row.card_id,
      'card_name', v_selected_binder_row.card_name,
      'rarity_id', v_selected_binder_row.rarity_id,
      'rarity_name', v_selected_binder_row.rarity_name,
      'added_quantity', v_add_quantity,
      'final_total', 3
    );
  elsif v_current_turn.choice_option = 'ban_list_cards' then
    v_card_ids := array(
      select nullif(value, '')::bigint
      from jsonb_array_elements_text(coalesce(p_payload -> 'card_ids', '[]'::jsonb))
    );

    if coalesce(array_length(v_card_ids, 1), 0) <> 2 then
      raise exception 'Choose exactly 2 banlist cards';
    end if;

    v_resolved_payload := jsonb_build_object(
      'type', 'ban_list_cards',
      'grants', '[]'::jsonb
    );

    foreach v_card_id in array v_card_ids loop
      select cards.name
      into v_card_name
      from public.series_banlist_cards b
      join public.cards
        on cards.id = b.card_id
      where b.series_id = p_series_id
        and b.card_id = v_card_id
        and b.status in ('forbidden', 'limited', 'semi_limited')
      limit 1;

      if v_card_name is null then
        raise exception 'One of the chosen banlist cards is no longer valid';
      end if;

      perform public._feature_slot_grant_card(p_series_id, v_actor_id, v_card_id, null);

      v_resolved_payload := jsonb_set(
        v_resolved_payload,
        '{grants}',
        coalesce(v_resolved_payload -> 'grants', '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object(
            'card_id', v_card_id,
            'card_name', v_card_name,
            'quantity', 1,
            'rarity_name', 'Base'
          )
        )
      );
    end loop;
  elsif v_current_turn.choice_option = 'promo_box_open' then
    v_container_id := nullif(coalesce(p_payload ->> 'container_id', ''), '')::uuid;

    if v_container_id is null then
      raise exception 'Choose a promo box to open';
    end if;

    select count(*)
    into v_option_count
    from public.containers c
    join public.container_types ct
      on ct.id = c.container_type_id
    where c.id = v_container_id
      and ct.code = 'promo_box'
      and coalesce(c.is_enabled, true) = true
      and coalesce(c.is_locked, false) = false;

    if v_option_count <= 0 then
      raise exception 'That promo box is not available';
    end if;

    v_open_result := public._open_promo_box_direct_batch_for_user(
      p_series_id,
      v_actor_id,
      v_container_id,
      2
    );

    v_resolved_payload := jsonb_build_object(
      'type', 'promo_box_open',
      'open_result', v_open_result
    );
  else
    raise exception 'This Binder Phase option does not need manual resolution';
  end if;

  update public.series_round_binder_phase_turns
  set
    resolved_payload = v_resolved_payload,
    completed_at = now(),
    updated_at = now()
  where id = v_current_turn.id;

  return public.get_current_binder_phase_state(p_series_id);
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

    v_auto_advanced := true;
  elsif v_series.current_phase = 'feature' then
    update public.game_series
    set
      current_phase = 'draft',
      updated_at = now()
    where id = p_series_id
    returning *
    into v_series;

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
    v_ready_reason := 'feature_ready';
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
  elsif v_series.current_phase = 'feature' then
    if not p_force and v_player_count > 0 and v_ready_count < v_player_count then
      raise exception 'Not all players are ready to leave Feature Phase';
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

commit;
