begin;

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

  if v_series.current_phase not in ('standby', 'deckbuilding') then
    return jsonb_build_object(
      'auto_advanced', false,
      'current_phase', v_series.current_phase,
      'round_number', v_series.round_number,
      'round_step', v_series.round_step
    );
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
      current_phase = 'deckbuilding',
      round_step = case
        when round_number = 0 then 1
        else coalesce(round_step, 1)
      end,
      updated_at = now()
    where id = p_series_id
    returning *
    into v_series;

    v_round_step_value := public._progression_round_step_value(v_series.round_step);

    if public._get_series_current_bracket_id(
      p_series_id,
      v_series.round_number,
      v_round_step_value
    ) is null then
      perform public.generate_series_bracket(p_series_id);
    end if;

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
  v_shared_shards integer := 0;
  v_extra_shards integer := 0;
  v_total_shards integer := 0;
  v_shared_feature_coins integer := 0;
  v_extra_feature_coins integer := 0;
  v_total_feature_coins integer := 0;
  v_shared_item_id uuid;
  v_shared_item_name text;
  v_shared_item_quantity integer := 0;
  v_random_item_id uuid;
  v_random_item_name text;
  v_random_item_quantity integer := 0;
  v_grants jsonb;
  v_round_label text;
  v_notes_prefix text;
  v_scoreboard jsonb;
  v_reward_error_message text;
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

  if coalesce(v_series.round_number, 0) > 0 then
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

    v_shared_shards := 0;
    v_extra_shards := 0;
    v_total_shards := 0;
    v_shared_feature_coins := 0;
    v_extra_feature_coins := 0;
    v_total_feature_coins := 0;
    v_shared_item_id := null;
    v_shared_item_name := null;
    v_shared_item_quantity := 0;
    v_random_item_id := null;
    v_random_item_name := null;
    v_random_item_quantity := 0;
    v_grants := '[]'::jsonb;
    v_reward_error_message := null;
    v_notes_prefix := format(
      'round_reward:%s:%s:%s',
      v_series.round_number,
      v_series.round_step_value,
      v_result.placement
    );

    begin
      if v_series.round_number = 0 then
        v_total_shards := 500;
        v_grants := v_grants || jsonb_build_array(
          jsonb_build_object(
            'label', 'Shards',
            'value', v_total_shards
          )
        );

        if coalesce(v_result.placement, 0) = 1 then
          v_random_item_quantity := 1;

          select i.id, i.name
          into v_random_item_id, v_random_item_name
          from public.item_definitions i
          where i.is_active = true
            and i.name in ('Universal Promo Box Key', 'Forbidden Edict')
          order by random()
          limit 1;

          if v_random_item_id is null then
            raise exception 'Round 0 first-place reward items are missing';
          end if;
        else
          v_random_item_quantity := 1;

          select i.id, i.name
          into v_random_item_id, v_random_item_name
          from public.item_definitions i
          where i.is_active = true
            and coalesce(i.is_randomly_available, true) = true
            and coalesce(i.is_reward_rng_locked, false) = false
            and coalesce(i.is_store_purchase_locked, false) = false
          order by random()
          limit 1;

          if v_random_item_id is null then
            raise exception 'No reward-eligible random item is available for Round 0 rewards';
          end if;
        end if;

        v_grants := v_grants || jsonb_build_array(
          jsonb_build_object(
            'label', coalesce(v_random_item_name, 'Item'),
            'value', v_random_item_quantity
          )
        );
      else
        select *
        into v_placement
        from public.series_round_reward_config_placements p
        where p.reward_config_id = v_config.id
          and p.placement = v_result.placement;

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

        if v_total_shards > 0 then
          v_grants := v_grants || jsonb_build_array(
            jsonb_build_object(
              'label', 'Shards',
              'value', v_total_shards
            )
          );
        end if;

        if v_total_feature_coins > 0 then
          v_grants := v_grants || jsonb_build_array(
            jsonb_build_object(
              'label', 'Feature Coins',
              'value', v_total_feature_coins
            )
          );
        end if;

        if v_config.shared_item_definition_id is not null
          and coalesce(v_config.shared_item_quantity, 0) > 0 then
          v_shared_item_id := v_config.shared_item_definition_id;
          v_shared_item_quantity := v_config.shared_item_quantity;

          select i.name
          into v_shared_item_name
          from public.item_definitions i
          where i.id = v_shared_item_id;

          if v_shared_item_name is null then
            raise exception 'Reward item definition not found';
          end if;

          v_grants := v_grants || jsonb_build_array(
            jsonb_build_object(
              'label', v_shared_item_name,
              'value', v_shared_item_quantity
            )
          );
        end if;

        if v_placement.id is not null and coalesce(v_placement.random_item_quantity, 0) > 0 then
          v_random_item_quantity := v_placement.random_item_quantity;

          if v_placement.specific_item_definition_id is not null then
            v_random_item_id := v_placement.specific_item_definition_id;

            select i.name
            into v_random_item_name
            from public.item_definitions i
            where i.id = v_random_item_id;
          else
            select i.id, i.name
            into v_random_item_id, v_random_item_name
            from public.item_definitions i
            where i.is_active = true
              and coalesce(i.is_randomly_available, true) = true
              and coalesce(i.is_reward_rng_locked, false) = false
              and coalesce(i.is_store_purchase_locked, false) = false
            order by random()
            limit 1;
          end if;

          if v_random_item_id is null or v_random_item_name is null then
            raise exception 'No eligible reward item is available';
          end if;

          v_grants := v_grants || jsonb_build_array(
            jsonb_build_object(
              'label', v_random_item_name,
              'value', v_random_item_quantity
            )
          );
        end if;
      end if;

      if v_total_shards > 0 then
        perform public._grant_series_shards(
          p_series_id,
          v_result.user_id,
          v_total_shards,
          v_actor_id,
          v_notes_prefix || ':shards'
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
      end if;

      if v_shared_item_id is not null and v_shared_item_quantity > 0 then
        perform public._grant_series_item(
          p_series_id,
          v_result.user_id,
          v_shared_item_id,
          v_shared_item_quantity,
          v_actor_id,
          v_notes_prefix || ':shared_item'
        );
      end if;

      if v_random_item_id is not null and v_random_item_quantity > 0 then
        perform public._grant_series_item(
          p_series_id,
          v_result.user_id,
          v_random_item_id,
          v_random_item_quantity,
          v_actor_id,
          v_notes_prefix || ':placement_item'
        );
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
          'scoreboard', v_scoreboard,
          'grant_status', 'complete'
        )
      )
      on conflict (series_id, user_id, round_number, round_step)
      do update set
        payload = excluded.payload;

      v_processed_count := v_processed_count + 1;
    exception
      when others then
        v_error_count := v_error_count + 1;
        v_reward_error_message := coalesce(sqlerrm, 'Reward processing failed');
        v_scoreboard := public._build_series_scoreboard_json(p_series_id);

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
          v_reward_error_message,
          jsonb_build_object(
            'series_id', p_series_id,
            'round_number', v_series.round_number,
            'round_step', v_series.round_step_value,
            'user_id', v_result.user_id,
            'placement', v_result.placement
          )
        );

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
            'scoreboard', v_scoreboard,
            'grant_status', 'manual_fix_required',
            'error_message', v_reward_error_message
          )
        )
        on conflict (series_id, user_id, round_number, round_step)
        do update set
          payload = excluded.payload;
    end;
  end loop;

  return jsonb_build_object(
    'success', v_error_count = 0,
    'processed_count', v_processed_count,
    'error_count', v_error_count
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
  v_series record;
  v_reward_result jsonb := '{}'::jsonb;
  v_next_round integer;
  v_next_step integer;
  v_auto_advanced boolean := false;
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

    update public.game_series gs
    set
      current_phase = 'reward',
      updated_at = now()
    where gs.id = v_match.series_id
      and gs.current_phase = 'dueling'
      and gs.round_number = v_match.round_number
      and public._progression_round_step_value(gs.round_step) = public._progression_round_step_value(v_match.round_step)
    returning *
    into v_series;

    if found then
      v_reward_result := public._process_series_round_rewards(v_match.series_id, false);

      if coalesce((v_reward_result ->> 'error_count')::integer, 0) = 0 then
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
        where id = v_match.series_id
        returning *
        into v_series;

        if public._get_series_current_bracket_id(
          v_match.series_id,
          v_next_round,
          v_next_step
        ) is null then
          perform public.generate_series_bracket(v_match.series_id);
        end if;

        v_auto_advanced := true;
      end if;
    end if;
  else
    v_finalize_result := jsonb_build_object(
      'success', true,
      'completed', false
    );

    select *
    into v_series
    from public.game_series gs
    where gs.id = v_match.series_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'match_id', p_match_id,
    'winner_user_id', v_winner_user_id,
    'loser_user_id', v_loser_user_id,
    'bracket_completed', coalesce((v_finalize_result ->> 'completed')::boolean, false),
    'current_phase', coalesce(v_series.current_phase, 'dueling'),
    'round_number', coalesce(v_series.round_number, v_match.round_number),
    'round_step', coalesce(v_series.round_step, v_match.round_step),
    'reward_error_count', coalesce((v_reward_result ->> 'error_count')::integer, 0),
    'auto_advanced', v_auto_advanced
  );
end;
$function$;

commit;
