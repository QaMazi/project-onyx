begin;

create extension if not exists pgcrypto;

create table if not exists public.series_phase_ready_states (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.game_series (id) on delete cascade,
  round_number integer not null,
  round_step integer not null default 0,
  phase text not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  ready_reason text,
  ready_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (series_id, round_number, round_step, phase, user_id)
);

create table if not exists public.series_phase_deck_exports (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.game_series (id) on delete cascade,
  round_number integer not null,
  round_step integer not null,
  phase text not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  deck_id uuid not null references public.player_decks (id) on delete cascade,
  exported_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (series_id, round_number, round_step, phase, user_id)
);

create table if not exists public.series_round_deck_snapshots (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.game_series (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  round_number integer not null,
  round_step integer not null,
  deck_id uuid not null references public.player_decks (id) on delete cascade,
  exported_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (series_id, user_id, round_number, round_step)
);

create table if not exists public.series_round_deck_snapshot_cards (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.series_round_deck_snapshots (id) on delete cascade,
  card_id bigint not null,
  section text not null,
  quantity integer not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (snapshot_id, card_id, section)
);

create table if not exists public.series_round_reward_configs (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.game_series (id) on delete cascade,
  round_number integer not null,
  round_step integer not null,
  shared_shard_min integer not null default 0,
  shared_shard_max integer not null default 0,
  shared_item_definition_id uuid references public.item_definitions (id) on delete set null,
  shared_item_quantity integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (series_id, round_number, round_step)
);

create table if not exists public.series_round_reward_config_placements (
  id uuid primary key default gen_random_uuid(),
  reward_config_id uuid not null references public.series_round_reward_configs (id) on delete cascade,
  placement integer not null,
  random_item_quantity integer not null default 0,
  extra_shard_min integer not null default 0,
  extra_shard_max integer not null default 0,
  specific_item_definition_id uuid references public.item_definitions (id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (reward_config_id, placement)
);

create table if not exists public.series_reward_processing_errors (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.game_series (id) on delete cascade,
  round_number integer not null,
  round_step integer not null,
  bracket_id uuid references public.series_brackets (id) on delete set null,
  user_id uuid references public.profiles (id) on delete set null,
  placement integer,
  message text not null,
  error_payload jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  cleared_at timestamp with time zone,
  cleared_by_user_id uuid references public.profiles (id) on delete set null
);

create table if not exists public.player_round_reward_notifications (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.game_series (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  round_number integer not null,
  round_step integer not null,
  placement integer,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  dismissed_at timestamp with time zone,
  unique (series_id, user_id, round_number, round_step)
);

create index if not exists idx_series_phase_ready_states_lookup
  on public.series_phase_ready_states (series_id, round_number, round_step, phase, user_id);

create index if not exists idx_series_phase_deck_exports_lookup
  on public.series_phase_deck_exports (series_id, round_number, round_step, phase, user_id);

create index if not exists idx_series_round_deck_snapshots_lookup
  on public.series_round_deck_snapshots (series_id, user_id, round_number, round_step);

create index if not exists idx_series_round_reward_configs_lookup
  on public.series_round_reward_configs (series_id, round_number, round_step);

create index if not exists idx_series_reward_processing_errors_lookup
  on public.series_reward_processing_errors (series_id, round_number, round_step, cleared_at);

create index if not exists idx_player_round_reward_notifications_lookup
  on public.player_round_reward_notifications (series_id, user_id, round_number, round_step, dismissed_at);

create or replace function public._progression_round_step_value(p_round_step integer)
returns integer
language sql
immutable
as $$
  select coalesce(p_round_step, 0);
$$;

create or replace function public._progression_can_bypass(p_user_id uuid)
returns boolean
language sql
security definer
set search_path to 'public', 'auth'
as $$
  select coalesce(
    (
      select p.global_role = 'Admin+'
      from public.profiles p
      where p.id = p_user_id
      limit 1
    ),
    false
  );
$$;

create or replace function public._get_series_current_bracket_id(
  p_series_id uuid,
  p_round_number integer,
  p_round_step integer
)
returns uuid
language sql
security definer
set search_path to 'public', 'auth'
as $$
  select b.id
  from public.series_brackets b
  where b.series_id = p_series_id
    and b.round_number = p_round_number
    and b.round_step = p_round_step
  order by b.created_at desc
  limit 1;
$$;

create or replace function public._get_player_dueling_status(p_series_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_series record;
  v_bracket_id uuid;
  v_current_match record;
begin
  select
    gs.current_phase,
    gs.round_number,
    public._progression_round_step_value(gs.round_step) as round_step
  into v_series
  from public.game_series gs
  where gs.id = p_series_id;

  if not found or v_series.current_phase <> 'dueling' then
    return 'idle';
  end if;

  v_bracket_id := public._get_series_current_bracket_id(
    p_series_id,
    v_series.round_number,
    v_series.round_step
  );

  if v_bracket_id is null then
    return 'idle';
  end if;

  select *
  into v_current_match
  from public.series_bracket_matches m
  where m.bracket_id = v_bracket_id
    and m.status = 'pending'
    and m.player1_user_id is not null
    and m.player2_user_id is not null
  order by m.display_order asc
  limit 1;

  if found and (
    v_current_match.player1_user_id = p_user_id
    or v_current_match.player2_user_id = p_user_id
  ) then
    return 'red';
  end if;

  if exists (
    select 1
    from public.series_bracket_matches m
    where m.bracket_id = v_bracket_id
      and m.status = 'pending'
      and (
        m.player1_user_id = p_user_id
        or m.player2_user_id = p_user_id
      )
  ) then
    return 'yellow';
  end if;

  if exists (
    select 1
    from public.series_round_results rr
    where rr.bracket_id = v_bracket_id
      and rr.user_id = p_user_id
  ) then
    return 'green';
  end if;

  if exists (
    select 1
    from public.series_bracket_matches m
    where m.bracket_id = v_bracket_id
      and (
        m.player1_user_id = p_user_id
        or m.player2_user_id = p_user_id
        or m.winner_user_id = p_user_id
        or m.loser_user_id = p_user_id
      )
  ) then
    return 'yellow';
  end if;

  return 'idle';
end;
$function$;

create or replace function public._capture_series_round_deck_snapshot(
  p_series_id uuid,
  p_user_id uuid,
  p_deck_id uuid,
  p_round_number integer,
  p_round_step integer
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_snapshot_id uuid;
begin
  insert into public.series_round_deck_snapshots (
    series_id,
    user_id,
    round_number,
    round_step,
    deck_id,
    exported_at,
    updated_at
  )
  values (
    p_series_id,
    p_user_id,
    p_round_number,
    p_round_step,
    p_deck_id,
    now(),
    now()
  )
  on conflict (series_id, user_id, round_number, round_step)
  do update set
    deck_id = excluded.deck_id,
    exported_at = now(),
    updated_at = now()
  returning id into v_snapshot_id;

  delete from public.series_round_deck_snapshot_cards
  where snapshot_id = v_snapshot_id;

  insert into public.series_round_deck_snapshot_cards (
    snapshot_id,
    card_id,
    section,
    quantity
  )
  select
    v_snapshot_id,
    pdc.card_id,
    pdc.section,
    pdc.quantity
  from public.player_deck_cards pdc
  where pdc.deck_id = p_deck_id;

  return v_snapshot_id;
end;
$function$;

create or replace function public._assert_dueling_card_quantity_available(
  p_series_id uuid,
  p_user_id uuid,
  p_card_id bigint,
  p_removed_quantity integer
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_series record;
  v_locked_quantity integer;
  v_total_owned integer;
begin
  if coalesce(p_removed_quantity, 0) <= 0 then
    return;
  end if;

  select
    gs.current_phase,
    gs.round_number,
    public._progression_round_step_value(gs.round_step) as round_step
  into v_series
  from public.game_series gs
  where gs.id = p_series_id;

  if not found or v_series.current_phase <> 'dueling' then
    return;
  end if;

  select coalesce(sum(sc.quantity), 0)::integer
  into v_locked_quantity
  from public.series_round_deck_snapshots s
  join public.series_round_deck_snapshot_cards sc
    on sc.snapshot_id = s.id
  where s.series_id = p_series_id
    and s.user_id = p_user_id
    and s.round_number = v_series.round_number
    and s.round_step = v_series.round_step
    and sc.card_id = p_card_id;

  if coalesce(v_locked_quantity, 0) <= 0 then
    return;
  end if;

  select coalesce(sum(bc.quantity), 0)::integer
  into v_total_owned
  from public.binder_cards bc
  where bc.user_id = p_user_id
    and bc.series_id = p_series_id
    and bc.card_id = p_card_id;

  if coalesce(v_total_owned, 0) - p_removed_quantity < v_locked_quantity then
    raise exception 'This card is locked by your exported duel deck for the current round';
  end if;
end;
$function$;

create or replace function public._build_series_scoreboard_json(p_series_id uuid)
returns jsonb
language sql
security definer
set search_path to 'public', 'auth'
as $$
  with totals as (
    select
      sp.user_id,
      coalesce(spv.username, 'Player') as username,
      coalesce(sum(rr.score_awarded), 0)::integer as total_points,
      coalesce(sum(rr.shards_awarded), 0)::integer as total_shards
    from public.series_players sp
    left join public.series_players_view spv
      on spv.series_id = sp.series_id
     and spv.user_id = sp.user_id
    left join public.series_round_results rr
      on rr.series_id = sp.series_id
     and rr.user_id = sp.user_id
    where sp.series_id = p_series_id
    group by sp.user_id, spv.username
  ),
  ranked as (
    select
      t.user_id,
      t.username,
      t.total_points,
      t.total_shards,
      row_number() over (
        order by t.total_points desc, t.total_shards desc, t.username asc
      ) as position
    from totals t
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'position', r.position,
        'user_id', r.user_id,
        'username', r.username,
        'points', r.total_points,
        'shards', r.total_shards
      )
      order by r.position
    ),
    '[]'::jsonb
  )
  from ranked r;
$$;

create or replace function public._grant_series_shards(
  p_series_id uuid,
  p_target_user_id uuid,
  p_shard_amount integer,
  p_granted_by_user_id uuid,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  if coalesce(p_shard_amount, 0) <= 0 then
    return;
  end if;

  insert into public.player_wallets (
    user_id,
    series_id,
    shards,
    locked_shards
  )
  values (
    p_target_user_id,
    p_series_id,
    p_shard_amount,
    0
  )
  on conflict (user_id, series_id)
  do update set
    shards = public.player_wallets.shards + excluded.shards,
    updated_at = now();

  insert into public.player_reward_grants (
    series_id,
    granted_to_user_id,
    granted_by_user_id,
    reward_type,
    shard_amount,
    quantity,
    notes
  )
  values (
    p_series_id,
    p_target_user_id,
    p_granted_by_user_id,
    'shards',
    p_shard_amount,
    1,
    p_notes
  );
end;
$function$;

create or replace function public._grant_series_item(
  p_series_id uuid,
  p_target_user_id uuid,
  p_item_definition_id uuid,
  p_quantity integer,
  p_granted_by_user_id uuid,
  p_notes text default null
)
returns text
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_item_name text;
begin
  if p_item_definition_id is null or coalesce(p_quantity, 0) <= 0 then
    return null;
  end if;

  select i.name
  into v_item_name
  from public.item_definitions i
  where i.id = p_item_definition_id;

  if v_item_name is null then
    raise exception 'Reward item definition not found';
  end if;

  insert into public.player_inventory (
    user_id,
    series_id,
    item_definition_id,
    quantity,
    locked_quantity
  )
  values (
    p_target_user_id,
    p_series_id,
    p_item_definition_id,
    p_quantity,
    0
  )
  on conflict (user_id, series_id, item_definition_id)
  do update set
    quantity = public.player_inventory.quantity + excluded.quantity,
    updated_at = now();

  insert into public.player_reward_grants (
    series_id,
    granted_to_user_id,
    granted_by_user_id,
    reward_type,
    item_definition_id,
    quantity,
    notes
  )
  values (
    p_series_id,
    p_target_user_id,
    p_granted_by_user_id,
    'item',
    p_item_definition_id,
    p_quantity,
    p_notes
  );

  return v_item_name;
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

      v_total_shards := coalesce(v_shared_shards, 0) + coalesce(v_extra_shards, 0);
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

create or replace function public.get_my_progression_state(p_series_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_series record;
  v_series_member boolean;
  v_can_bypass boolean;
  v_is_ready boolean := false;
  v_ready_reason text := '';
  v_starter_claimed boolean := false;
  v_dueling_status text := 'idle';
  v_active_deck record;
  v_active_deck_exported boolean := false;
begin
  v_actor_id := public._assert_authenticated_user();

  select
    gs.*,
    public._progression_round_step_value(gs.round_step) as round_step_value
  into v_series
  from public.game_series gs
  where gs.id = p_series_id;

  if not found then
    raise exception 'Series not found';
  end if;

  v_can_bypass := public._progression_can_bypass(v_actor_id);

  select exists (
    select 1
    from public.series_players sp
    where sp.series_id = p_series_id
      and sp.user_id = v_actor_id
  )
  into v_series_member;

  if not v_series_member and not v_can_bypass then
    raise exception 'User is not a member of this series';
  end if;

  select exists (
    select 1
    from public.player_starter_deck_claims c
    where c.series_id = p_series_id
      and c.user_id = v_actor_id
  )
  into v_starter_claimed;

  select
    true,
    coalesce(rs.ready_reason, '')
  into v_is_ready, v_ready_reason
  from public.series_phase_ready_states rs
  where rs.series_id = p_series_id
    and rs.round_number = v_series.round_number
    and rs.round_step = v_series.round_step_value
    and rs.phase = v_series.current_phase
    and rs.user_id = v_actor_id
  limit 1;

  select
    d.id,
    d.is_valid
  into v_active_deck
  from public.player_decks d
  where d.series_id = p_series_id
    and d.user_id = v_actor_id
    and d.is_active = true
  limit 1;

  if v_active_deck.id is not null then
    select exists (
      select 1
      from public.series_phase_deck_exports e
      where e.series_id = p_series_id
        and e.round_number = v_series.round_number
        and e.round_step = v_series.round_step_value
        and e.phase = v_series.current_phase
        and e.user_id = v_actor_id
        and e.deck_id = v_active_deck.id
    )
    into v_active_deck_exported;
  end if;

  if v_series_member then
    v_dueling_status := public._get_player_dueling_status(p_series_id, v_actor_id);
  end if;

  return jsonb_build_object(
    'currentPhase', coalesce(v_series.current_phase, 'standby'),
    'roundNumber', coalesce(v_series.round_number, 0),
    'roundStep',
      case
        when v_series.round_number = 0 and v_series.current_phase = 'standby' then null
        else v_series.round_step
      end,
    'starterDeckClaimed', v_starter_claimed,
    'isReady', v_is_ready,
    'readyReason', coalesce(v_ready_reason, ''),
    'canBypassLocks', v_can_bypass,
    'duelingStatus', coalesce(v_dueling_status, 'idle'),
    'activeDeckId', v_active_deck.id,
    'activeDeckValid', coalesce(v_active_deck.is_valid, false),
    'activeDeckExported', v_active_deck_exported
  );
end;
$function$;

create or replace function public.get_series_progression_status_strip(p_series_id uuid)
returns table (
  user_id uuid,
  username text,
  avatar text,
  is_ready boolean,
  ready_reason text,
  phase_status text,
  dueling_status text,
  role text,
  starter_claimed boolean
)
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
    return;
  end if;

  return query
  select
    sp.user_id,
    coalesce(spv.username, 'Unknown Duelist')::text as username,
    coalesce(spv.avatar, '')::text as avatar,
    (rs.id is not null) as is_ready,
    coalesce(rs.ready_reason, '')::text as ready_reason,
    (
      case
        when v_series.current_phase = 'reward' then 'reward'
        when rs.id is not null then 'ready'
        when v_series.current_phase = 'dueling' then 'dueling'
        when v_series.round_number = 0 and v_series.current_phase = 'standby' and c.id is not null
          then 'waiting'
        else 'waiting'
      end
    )::text as phase_status,
    public._get_player_dueling_status(p_series_id, sp.user_id)::text as dueling_status,
    coalesce(sp.role, 'duelist')::text as role,
    (c.id is not null) as starter_claimed
  from public.series_players sp
  left join public.series_players_view spv
    on spv.series_id = sp.series_id
   and spv.user_id = sp.user_id
  left join public.series_phase_ready_states rs
    on rs.series_id = sp.series_id
   and rs.round_number = v_series.round_number
   and rs.round_step = v_series.round_step
   and rs.phase = v_series.current_phase
   and rs.user_id = sp.user_id
  left join public.player_starter_deck_claims c
    on c.series_id = sp.series_id
   and c.user_id = sp.user_id
  where sp.series_id = p_series_id
  order by sp.is_owner desc, sp.joined_at asc, coalesce(spv.username, 'Unknown Duelist') asc;
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

  if not v_can_bypass then
    perform public._assert_series_member_for_claim(p_series_id, v_actor_id);

    if v_series.current_phase <> 'standby' or coalesce(v_series.round_number, 0) <> 0 then
      raise exception 'Begin Series is only available during Round 0 Standby Phase';
    end if;
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

  return v_claim || jsonb_build_object(
    'ready', true,
    'phase', 'standby',
    'round_number', 0,
    'round_step', null
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

    if not coalesce(v_active_deck.is_valid, false) and not v_can_bypass then
      raise exception 'Your active deck must be valid before readying up';
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

    v_ready_reason := case when v_export_exists then 'deck_export_ready' else 'admin_bypass_ready' end;
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

  return jsonb_build_object(
    'success', true,
    'phase', v_series.current_phase,
    'round_number', v_series.round_number,
    'round_step', v_series.round_step,
    'ready_reason', v_ready_reason
  );
end;
$function$;

create or replace function public.record_active_deck_export(p_series_id uuid, p_deck_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_series record;
  v_can_bypass boolean;
  v_deck record;
  v_snapshot_id uuid;
begin
  v_actor_id := public._assert_authenticated_user();
  v_can_bypass := public._progression_can_bypass(v_actor_id);

  perform public._assert_series_member_for_claim(p_series_id, v_actor_id);

  select
    gs.*,
    public._progression_round_step_value(gs.round_step) as round_step_value
  into v_series
  from public.game_series gs
  where gs.id = p_series_id;

  if not found then
    raise exception 'Series not found';
  end if;

  if v_series.current_phase <> 'deckbuilding' and not v_can_bypass then
    raise exception 'Deck exports are only tracked during Deckbuilding Phase';
  end if;

  select
    d.id,
    d.is_active,
    d.is_valid
  into v_deck
  from public.player_decks d
  where d.id = p_deck_id
    and d.series_id = p_series_id
    and d.user_id = v_actor_id
  limit 1;

  if v_deck.id is null then
    raise exception 'Deck not found';
  end if;

  if not coalesce(v_deck.is_active, false) then
    raise exception 'Only the active deck can be exported for progression';
  end if;

  if not coalesce(v_deck.is_valid, false) and not v_can_bypass then
    raise exception 'Only a valid active deck can be exported';
  end if;

  v_snapshot_id := public._capture_series_round_deck_snapshot(
    p_series_id,
    v_actor_id,
    p_deck_id,
    v_series.round_number,
    v_series.round_step_value
  );

  insert into public.series_phase_deck_exports (
    series_id,
    round_number,
    round_step,
    phase,
    user_id,
    deck_id,
    exported_at,
    updated_at
  )
  values (
    p_series_id,
    v_series.round_number,
    v_series.round_step_value,
    v_series.current_phase,
    v_actor_id,
    p_deck_id,
    now(),
    now()
  )
  on conflict (series_id, round_number, round_step, phase, user_id)
  do update set
    deck_id = excluded.deck_id,
    exported_at = now(),
    updated_at = now();

  return jsonb_build_object(
    'success', true,
    'snapshot_id', v_snapshot_id,
    'deck_id', p_deck_id,
    'phase', v_series.current_phase,
    'round_number', v_series.round_number,
    'round_step', v_series.round_step
  );
end;
$function$;

create or replace function public.clear_series_reward_processing_error(p_error_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_error record;
begin
  v_actor_id := public._assert_authenticated_user();

  select *
  into v_error
  from public.series_reward_processing_errors e
  where e.id = p_error_id
  for update;

  if not found then
    raise exception 'Reward processing error not found';
  end if;

  perform public._assert_series_admin_or_admin_plus(v_error.series_id);

  update public.series_reward_processing_errors
  set
    cleared_at = now(),
    cleared_by_user_id = v_actor_id
  where id = p_error_id;

  return jsonb_build_object(
    'success', true,
    'error_id', p_error_id
  );
end;
$function$;

create or replace function public._finalize_series_bracket(p_bracket_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_bracket record;
  v_gf record;
begin
  select *
  into v_bracket
  from public.series_brackets b
  where b.id = p_bracket_id
  for update;

  if not found then
    raise exception 'Bracket not found';
  end if;

  if exists (
    select 1
    from public.series_round_results rr
    where rr.bracket_id = p_bracket_id
  ) then
    return jsonb_build_object(
      'success', true,
      'already_finalized', true,
      'bracket_id', p_bracket_id
    );
  end if;

  select *
  into v_gf
  from public.series_bracket_matches m
  where m.bracket_id = p_bracket_id
    and m.match_key = 'GF'
  limit 1;

  if not found or v_gf.winner_user_id is null or v_gf.loser_user_id is null then
    raise exception 'Grand final must be completed before finalizing';
  end if;

  with elimination_order as (
    select
      m.loser_user_id as user_id,
      max(m.display_order) as last_loss_order
    from public.series_bracket_matches m
    where m.bracket_id = p_bracket_id
      and m.loser_user_id is not null
      and m.loser_user_id not in (v_gf.winner_user_id, v_gf.loser_user_id)
    group by m.loser_user_id
  ),
  placements as (
    select 1 as placement, v_gf.winner_user_id as user_id
    union all
    select 2 as placement, v_gf.loser_user_id as user_id
    union all
    select row_number() over (order by e.last_loss_order desc) + 2, e.user_id
    from elimination_order e
  )
  insert into public.series_round_results (
    series_id,
    bracket_id,
    round_number,
    round_step,
    user_id,
    placement,
    score_awarded,
    shards_awarded
  )
  select
    v_bracket.series_id,
    p_bracket_id,
    v_bracket.round_number,
    v_bracket.round_step,
    p.user_id,
    p.placement,
    case p.placement
      when 1 then 10
      when 2 then 8
      when 3 then 6
      when 4 then 4
      when 5 then 2
      else 0
    end as score_awarded,
    0 as shards_awarded
  from placements p
  order by p.placement asc;

  update public.series_brackets
  set
    status = 'completed',
    completed_at = now(),
    updated_at = now()
  where id = p_bracket_id;

  return jsonb_build_object(
    'success', true,
    'bracket_id', p_bracket_id,
    'completed', true,
    'player_count', v_bracket.player_count
  );
end;
$function$;

create or replace function public.report_series_bracket_result(
  p_match_id uuid,
  p_player1_score integer,
  p_player2_score integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_match record;
  v_winner_user_id uuid;
  v_loser_user_id uuid;
  v_finalize_result jsonb;
  v_remaining_matches integer;
begin
  perform public._assert_authenticated_user();

  select
    m.*,
    b.series_id,
    b.round_number,
    b.round_step,
    b.id as resolved_bracket_id
  into v_match
  from public.series_bracket_matches m
  join public.series_brackets b
    on b.id = m.bracket_id
  where m.id = p_match_id
  for update;

  if not found then
    raise exception 'Bracket match not found';
  end if;

  perform public._assert_series_admin_or_admin_plus(v_match.series_id);

  if v_match.player1_user_id is null or v_match.player2_user_id is null then
    raise exception 'Both players must be assigned before reporting a result';
  end if;

  if v_match.status = 'completed' then
    raise exception 'This match has already been reported';
  end if;

  if p_player1_score is null or p_player2_score is null or p_player1_score = p_player2_score then
    raise exception 'Reported match results must have a winner';
  end if;

  if p_player1_score > p_player2_score then
    v_winner_user_id := v_match.player1_user_id;
    v_loser_user_id := v_match.player2_user_id;
  else
    v_winner_user_id := v_match.player2_user_id;
    v_loser_user_id := v_match.player1_user_id;
  end if;

  update public.series_bracket_matches
  set
    player1_score = p_player1_score,
    player2_score = p_player2_score,
    winner_user_id = v_winner_user_id,
    loser_user_id = v_loser_user_id,
    status = 'completed',
    updated_at = now()
  where id = p_match_id;

  perform public._set_bracket_match_slot(
    v_match.bracket_id,
    v_match.next_winner_match_key,
    v_match.next_winner_slot,
    v_winner_user_id
  );

  perform public._set_bracket_match_slot(
    v_match.bracket_id,
    v_match.next_loser_match_key,
    v_match.next_loser_slot,
    v_loser_user_id
  );

  select count(*)
  into v_remaining_matches
  from public.series_bracket_matches m
  where m.bracket_id = v_match.bracket_id
    and m.status <> 'completed'
    and m.player1_user_id is not null
    and m.player2_user_id is not null;

  if v_remaining_matches = 0 then
    v_finalize_result := public._finalize_series_bracket(v_match.bracket_id);
  else
    v_finalize_result := jsonb_build_object(
      'success', true,
      'completed', false
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'match_id', p_match_id,
    'winner_user_id', v_winner_user_id,
    'loser_user_id', v_loser_user_id,
    'bracket_completed', coalesce((v_finalize_result ->> 'completed')::boolean, false)
  );
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
  v_common_rarity_id uuid;
  v_series_deck record;
  v_player_deck_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  perform public._assert_series_member_for_claim(p_series_id, v_user_id);

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

create or replace function public.send_gift(
  p_series_id uuid,
  p_sent_to_user_id uuid,
  p_sent_shards integer default 0,
  p_message text default null,
  p_gift_cards jsonb default '[]'::jsonb,
  p_gift_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_sender_id uuid;
  v_sender_wallet record;
  v_gift_id bigint;
  v_card record;
  v_item record;
  v_binder record;
  v_inventory record;
  v_has_any boolean := false;
begin
  v_sender_id := public._assert_authenticated_user();

  if p_sent_to_user_id is null then
    raise exception 'Recipient is required';
  end if;

  if p_sent_to_user_id = v_sender_id then
    raise exception 'Cannot gift yourself';
  end if;

  if p_sent_shards < 0 then
    raise exception 'Gift shards must be >= 0';
  end if;

  perform public._assert_series_member(p_series_id, v_sender_id);
  perform public._assert_series_member(p_series_id, p_sent_to_user_id);

  if p_sent_shards > 0 then
    v_has_any := true;
  end if;

  select *
  into v_sender_wallet
  from public.player_wallets w
  where w.user_id = v_sender_id
    and w.series_id = p_series_id
  for update;

  if not found then
    raise exception 'Sender wallet not found';
  end if;

  if (v_sender_wallet.shards - v_sender_wallet.locked_shards) < p_sent_shards then
    raise exception 'Insufficient available shards for gift';
  end if;

  for v_card in
    select
      x.binder_card_id,
      sum(x.quantity)::integer as quantity
    from jsonb_to_recordset(coalesce(p_gift_cards, '[]'::jsonb))
      as x(binder_card_id uuid, quantity integer)
    group by x.binder_card_id
  loop
    v_has_any := true;

    if v_card.quantity <= 0 then
      raise exception 'Gift card quantity must be > 0';
    end if;

    select *
    into v_binder
    from public.binder_cards bc
    where bc.id = v_card.binder_card_id
    for update;

    if not found then
      raise exception 'Gift binder row not found';
    end if;

    if v_binder.user_id <> v_sender_id or v_binder.series_id <> p_series_id then
      raise exception 'Gift binder row ownership mismatch';
    end if;

    if v_binder.is_trade_locked then
      raise exception 'Gift binder row is trade locked';
    end if;

    perform public._assert_dueling_card_quantity_available(
      p_series_id,
      v_sender_id,
      v_binder.card_id,
      v_card.quantity
    );

    if v_binder.quantity < v_card.quantity then
      raise exception 'Insufficient gift card quantity';
    end if;
  end loop;

  for v_item in
    select
      x.player_inventory_id,
      sum(x.quantity)::integer as quantity
    from jsonb_to_recordset(coalesce(p_gift_items, '[]'::jsonb))
      as x(player_inventory_id uuid, quantity integer)
    group by x.player_inventory_id
  loop
    v_has_any := true;

    if v_item.quantity <= 0 then
      raise exception 'Gift item quantity must be > 0';
    end if;

    select *
    into v_inventory
    from public.player_inventory pi
    where pi.id = v_item.player_inventory_id
    for update;

    if not found then
      raise exception 'Gift inventory row not found';
    end if;

    if v_inventory.user_id <> v_sender_id or v_inventory.series_id <> p_series_id then
      raise exception 'Gift inventory ownership mismatch';
    end if;

    if (v_inventory.quantity - v_inventory.locked_quantity) < v_item.quantity then
      raise exception 'Insufficient gift item quantity';
    end if;
  end loop;

  if not v_has_any then
    raise exception 'Gift must include at least one asset';
  end if;

  insert into public.player_gifts (
    series_id,
    sent_by_user_id,
    sent_to_user_id,
    sent_shards,
    message,
    is_read
  )
  values (
    p_series_id,
    v_sender_id,
    p_sent_to_user_id,
    p_sent_shards,
    p_message,
    false
  )
  returning id into v_gift_id;

  if p_sent_shards > 0 then
    update public.player_wallets
    set
      shards = shards - p_sent_shards,
      updated_at = now()
    where user_id = v_sender_id
      and series_id = p_series_id;

    update public.player_wallets
    set
      shards = shards + p_sent_shards,
      updated_at = now()
    where user_id = p_sent_to_user_id
      and series_id = p_series_id;
  end if;

  for v_card in
    select
      x.binder_card_id,
      sum(x.quantity)::integer as quantity
    from jsonb_to_recordset(coalesce(p_gift_cards, '[]'::jsonb))
      as x(binder_card_id uuid, quantity integer)
    group by x.binder_card_id
  loop
    insert into public.player_gift_cards (
      gift_id,
      card_id,
      rarity_id,
      quantity
    )
    select
      v_gift_id,
      bc.card_id,
      bc.rarity_id,
      v_card.quantity
    from public.binder_cards bc
    where bc.id = v_card.binder_card_id;

    perform public._transfer_binder_cards(
      v_card.binder_card_id,
      p_sent_to_user_id,
      v_card.quantity,
      false
    );
  end loop;

  for v_item in
    select
      x.player_inventory_id,
      sum(x.quantity)::integer as quantity
    from jsonb_to_recordset(coalesce(p_gift_items, '[]'::jsonb))
      as x(player_inventory_id uuid, quantity integer)
    group by x.player_inventory_id
  loop
    insert into public.player_gift_items (
      gift_id,
      item_definition_id,
      quantity
    )
    select
      v_gift_id,
      pi.item_definition_id,
      v_item.quantity
    from public.player_inventory pi
    where pi.id = v_item.player_inventory_id;

    perform public._transfer_inventory_items(
      v_item.player_inventory_id,
      p_sent_to_user_id,
      v_item.quantity,
      0
    );
  end loop;

  return jsonb_build_object(
    'success', true,
    'gift_id', v_gift_id
  );
end;
$function$;

create or replace function public.send_trade(
  p_series_id uuid,
  p_offered_to_user_id uuid,
  p_offered_shards integer default 0,
  p_requested_shards integer default 0,
  p_message text default null,
  p_offered_cards jsonb default '[]'::jsonb,
  p_requested_cards jsonb default '[]'::jsonb,
  p_offered_items jsonb default '[]'::jsonb,
  p_requested_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_sender_id uuid;
  v_trade_id bigint;
  v_sender_wallet record;
  v_card record;
  v_item record;
  v_has_any boolean := false;
begin
  v_sender_id := public._assert_authenticated_user();

  if p_offered_to_user_id is null then
    raise exception 'Recipient is required';
  end if;

  if p_offered_to_user_id = v_sender_id then
    raise exception 'Cannot trade with yourself';
  end if;

  if p_offered_shards < 0 or p_requested_shards < 0 then
    raise exception 'Shard amounts must be >= 0';
  end if;

  perform public._assert_series_member(p_series_id, v_sender_id);
  perform public._assert_series_member(p_series_id, p_offered_to_user_id);

  if p_offered_shards > 0 or p_requested_shards > 0 then
    v_has_any := true;
  end if;

  select *
  into v_sender_wallet
  from public.player_wallets w
  where w.series_id = p_series_id
    and w.user_id = v_sender_id
  for update;

  if not found then
    raise exception 'Sender wallet not found';
  end if;

  if (v_sender_wallet.shards - v_sender_wallet.locked_shards) < p_offered_shards then
    raise exception 'Insufficient available shards';
  end if;

  for v_card in
    select
      x.binder_card_id,
      sum(x.quantity)::integer as quantity
    from jsonb_to_recordset(coalesce(p_offered_cards, '[]'::jsonb))
      as x(binder_card_id uuid, quantity integer)
    group by x.binder_card_id
  loop
    declare
      v_binder record;
    begin
      v_has_any := true;

      if v_card.quantity <= 0 then
        raise exception 'Offered card quantity must be > 0';
      end if;

      select *
      into v_binder
      from public.binder_cards bc
      where bc.id = v_card.binder_card_id
      for update;

      if not found then
        raise exception 'Offered binder row not found: %', v_card.binder_card_id;
      end if;

      if v_binder.user_id <> v_sender_id or v_binder.series_id <> p_series_id then
        raise exception 'Offered binder row does not belong to sender in this series';
      end if;

      if v_binder.is_trade_locked then
        raise exception 'Offered binder row is already trade locked';
      end if;

      perform public._assert_dueling_card_quantity_available(
        p_series_id,
        v_sender_id,
        v_binder.card_id,
        v_card.quantity
      );

      if v_binder.quantity < v_card.quantity then
        raise exception 'Insufficient offered card quantity';
      end if;
    end;
  end loop;

  for v_item in
    select
      x.player_inventory_id,
      sum(x.quantity)::integer as quantity
    from jsonb_to_recordset(coalesce(p_offered_items, '[]'::jsonb))
      as x(player_inventory_id uuid, quantity integer)
    group by x.player_inventory_id
  loop
    declare
      v_inventory record;
    begin
      v_has_any := true;

      if v_item.quantity <= 0 then
        raise exception 'Offered item quantity must be > 0';
      end if;

      select *
      into v_inventory
      from public.player_inventory pi
      where pi.id = v_item.player_inventory_id
      for update;

      if not found then
        raise exception 'Offered inventory row not found: %', v_item.player_inventory_id;
      end if;

      if v_inventory.user_id <> v_sender_id or v_inventory.series_id <> p_series_id then
        raise exception 'Offered inventory row does not belong to sender in this series';
      end if;

      if (v_inventory.quantity - v_inventory.locked_quantity) < v_item.quantity then
        raise exception 'Insufficient offered item quantity';
      end if;
    end;
  end loop;

  for v_card in
    select
      x.binder_card_id,
      sum(x.quantity)::integer as quantity
    from jsonb_to_recordset(coalesce(p_requested_cards, '[]'::jsonb))
      as x(binder_card_id uuid, quantity integer)
    group by x.binder_card_id
  loop
    declare
      v_binder record;
    begin
      v_has_any := true;

      if v_card.quantity <= 0 then
        raise exception 'Requested card quantity must be > 0';
      end if;

      select *
      into v_binder
      from public.binder_cards bc
      where bc.id = v_card.binder_card_id;

      if not found then
        raise exception 'Requested binder row not found: %', v_card.binder_card_id;
      end if;

      if v_binder.user_id <> p_offered_to_user_id or v_binder.series_id <> p_series_id then
        raise exception 'Requested binder row does not belong to recipient in this series';
      end if;
    end;
  end loop;

  for v_item in
    select
      x.player_inventory_id,
      sum(x.quantity)::integer as quantity
    from jsonb_to_recordset(coalesce(p_requested_items, '[]'::jsonb))
      as x(player_inventory_id uuid, quantity integer)
    group by x.player_inventory_id
  loop
    declare
      v_inventory record;
    begin
      v_has_any := true;

      if v_item.quantity <= 0 then
        raise exception 'Requested item quantity must be > 0';
      end if;

      select *
      into v_inventory
      from public.player_inventory pi
      where pi.id = v_item.player_inventory_id;

      if not found then
        raise exception 'Requested inventory row not found: %', v_item.player_inventory_id;
      end if;

      if v_inventory.user_id <> p_offered_to_user_id or v_inventory.series_id <> p_series_id then
        raise exception 'Requested inventory row does not belong to recipient in this series';
      end if;
    end;
  end loop;

  if not v_has_any then
    raise exception 'Trade must include at least one offered or requested asset';
  end if;

  insert into public.player_trades (
    series_id,
    offered_by_user_id,
    offered_to_user_id,
    status,
    offered_shards,
    requested_shards,
    message
  )
  values (
    p_series_id,
    v_sender_id,
    p_offered_to_user_id,
    'pending',
    p_offered_shards,
    p_requested_shards,
    p_message
  )
  returning id into v_trade_id;

  if p_offered_shards > 0 then
    update public.player_wallets
    set
      locked_shards = locked_shards + p_offered_shards,
      updated_at = now()
    where user_id = v_sender_id
      and series_id = p_series_id;
  end if;

  for v_card in
    select
      x.binder_card_id,
      sum(x.quantity)::integer as quantity
    from jsonb_to_recordset(coalesce(p_offered_cards, '[]'::jsonb))
      as x(binder_card_id uuid, quantity integer)
    group by x.binder_card_id
  loop
    insert into public.player_trade_cards (
      trade_id,
      direction,
      binder_card_id,
      card_id,
      rarity_id,
      quantity
    )
    select
      v_trade_id,
      'offered',
      bc.id,
      bc.card_id,
      bc.rarity_id,
      v_card.quantity
    from public.binder_cards bc
    where bc.id = v_card.binder_card_id;

    update public.binder_cards
    set
      is_trade_locked = true,
      updated_at = now()
    where id = v_card.binder_card_id;
  end loop;

  for v_item in
    select
      x.player_inventory_id,
      sum(x.quantity)::integer as quantity
    from jsonb_to_recordset(coalesce(p_offered_items, '[]'::jsonb))
      as x(player_inventory_id uuid, quantity integer)
    group by x.player_inventory_id
  loop
    insert into public.player_trade_items (
      trade_id,
      direction,
      player_inventory_id,
      item_definition_id,
      quantity
    )
    select
      v_trade_id,
      'offered',
      pi.id,
      pi.item_definition_id,
      v_item.quantity
    from public.player_inventory pi
    where pi.id = v_item.player_inventory_id;

    update public.player_inventory
    set
      locked_quantity = locked_quantity + v_item.quantity,
      updated_at = now()
    where id = v_item.player_inventory_id;
  end loop;

  for v_card in
    select
      x.binder_card_id,
      sum(x.quantity)::integer as quantity
    from jsonb_to_recordset(coalesce(p_requested_cards, '[]'::jsonb))
      as x(binder_card_id uuid, quantity integer)
    group by x.binder_card_id
  loop
    insert into public.player_trade_cards (
      trade_id,
      direction,
      binder_card_id,
      card_id,
      rarity_id,
      quantity
    )
    select
      v_trade_id,
      'requested',
      bc.id,
      bc.card_id,
      bc.rarity_id,
      v_card.quantity
    from public.binder_cards bc
    where bc.id = v_card.binder_card_id;
  end loop;

  for v_item in
    select
      x.player_inventory_id,
      sum(x.quantity)::integer as quantity
    from jsonb_to_recordset(coalesce(p_requested_items, '[]'::jsonb))
      as x(player_inventory_id uuid, quantity integer)
    group by x.player_inventory_id
  loop
    insert into public.player_trade_items (
      trade_id,
      direction,
      player_inventory_id,
      item_definition_id,
      quantity
    )
    select
      v_trade_id,
      'requested',
      pi.id,
      pi.item_definition_id,
      v_item.quantity
    from public.player_inventory pi
    where pi.id = v_item.player_inventory_id;
  end loop;

  return jsonb_build_object(
    'success', true,
    'trade_id', v_trade_id,
    'status', 'pending'
  );
end;
$function$;

create or replace function public.accept_trade(p_trade_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_trade record;
  v_sender_wallet record;
  v_recipient_wallet record;
  v_card record;
  v_item record;
  v_binder record;
  v_inventory record;
begin
  v_actor_id := public._assert_authenticated_user();

  select *
  into v_trade
  from public.player_trades t
  where t.id = p_trade_id
  for update;

  if not found then
    raise exception 'Trade not found';
  end if;

  if v_trade.offered_to_user_id <> v_actor_id then
    raise exception 'Only the recipient can accept this trade';
  end if;

  if v_trade.status <> 'pending' then
    raise exception 'Only pending trades can be accepted';
  end if;

  select *
  into v_sender_wallet
  from public.player_wallets w
  where w.user_id = v_trade.offered_by_user_id
    and w.series_id = v_trade.series_id
  for update;

  if not found then
    raise exception 'Sender wallet not found';
  end if;

  select *
  into v_recipient_wallet
  from public.player_wallets w
  where w.user_id = v_trade.offered_to_user_id
    and w.series_id = v_trade.series_id
  for update;

  if not found then
    raise exception 'Recipient wallet not found';
  end if;

  if v_sender_wallet.locked_shards < v_trade.offered_shards then
    raise exception 'Sender locked shards are invalid';
  end if;

  if v_recipient_wallet.shards < v_trade.requested_shards then
    raise exception 'Recipient no longer has enough shards';
  end if;

  for v_card in
    select *
    from public.player_trade_cards ptc
    where ptc.trade_id = p_trade_id
      and ptc.direction = 'requested'
  loop
    select *
    into v_binder
    from public.binder_cards bc
    where bc.id = v_card.binder_card_id
    for update;

    if not found then
      raise exception 'Requested binder row no longer exists';
    end if;

    if v_binder.user_id <> v_trade.offered_to_user_id then
      raise exception 'Requested binder row ownership mismatch';
    end if;

    if v_binder.series_id <> v_trade.series_id then
      raise exception 'Requested binder row series mismatch';
    end if;

    if v_binder.is_trade_locked then
      raise exception 'Requested binder row is currently locked';
    end if;

    perform public._assert_dueling_card_quantity_available(
      v_trade.series_id,
      v_trade.offered_to_user_id,
      v_binder.card_id,
      v_card.quantity
    );

    if v_binder.quantity < v_card.quantity then
      raise exception 'Recipient no longer has requested card quantity';
    end if;
  end loop;

  for v_item in
    select *
    from public.player_trade_items pti
    where pti.trade_id = p_trade_id
      and pti.direction = 'requested'
  loop
    select *
    into v_inventory
    from public.player_inventory pi
    where pi.id = v_item.player_inventory_id
    for update;

    if not found then
      raise exception 'Requested inventory row no longer exists';
    end if;

    if v_inventory.user_id <> v_trade.offered_to_user_id then
      raise exception 'Requested inventory ownership mismatch';
    end if;

    if v_inventory.series_id <> v_trade.series_id then
      raise exception 'Requested inventory series mismatch';
    end if;

    if (v_inventory.quantity - v_inventory.locked_quantity) < v_item.quantity then
      raise exception 'Recipient no longer has requested item quantity';
    end if;
  end loop;

  if v_trade.offered_shards > 0 then
    update public.player_wallets
    set
      shards = shards - v_trade.offered_shards,
      locked_shards = locked_shards - v_trade.offered_shards,
      updated_at = now()
    where user_id = v_trade.offered_by_user_id
      and series_id = v_trade.series_id;

    update public.player_wallets
    set
      shards = shards + v_trade.offered_shards,
      updated_at = now()
    where user_id = v_trade.offered_to_user_id
      and series_id = v_trade.series_id;
  end if;

  if v_trade.requested_shards > 0 then
    update public.player_wallets
    set
      shards = shards - v_trade.requested_shards,
      updated_at = now()
    where user_id = v_trade.offered_to_user_id
      and series_id = v_trade.series_id;

    update public.player_wallets
    set
      shards = shards + v_trade.requested_shards,
      updated_at = now()
    where user_id = v_trade.offered_by_user_id
      and series_id = v_trade.series_id;
  end if;

  for v_card in
    select *
    from public.player_trade_cards ptc
    where ptc.trade_id = p_trade_id
      and ptc.direction = 'offered'
  loop
    perform public._transfer_binder_cards(
      v_card.binder_card_id,
      v_trade.offered_to_user_id,
      v_card.quantity,
      true
    );
  end loop;

  for v_card in
    select *
    from public.player_trade_cards ptc
    where ptc.trade_id = p_trade_id
      and ptc.direction = 'requested'
  loop
    perform public._transfer_binder_cards(
      v_card.binder_card_id,
      v_trade.offered_by_user_id,
      v_card.quantity,
      false
    );
  end loop;

  for v_item in
    select *
    from public.player_trade_items pti
    where pti.trade_id = p_trade_id
      and pti.direction = 'offered'
  loop
    perform public._transfer_inventory_items(
      v_item.player_inventory_id,
      v_trade.offered_to_user_id,
      v_item.quantity,
      v_item.quantity
    );
  end loop;

  for v_item in
    select *
    from public.player_trade_items pti
    where pti.trade_id = p_trade_id
      and pti.direction = 'requested'
  loop
    perform public._transfer_inventory_items(
      v_item.player_inventory_id,
      v_trade.offered_by_user_id,
      v_item.quantity,
      0
    );
  end loop;

  update public.player_trades
  set
    status = 'accepted',
    responded_at = now()
  where id = p_trade_id;

  return jsonb_build_object(
    'success', true,
    'trade_id', p_trade_id,
    'status', 'accepted'
  );
end;
$function$;

commit;
