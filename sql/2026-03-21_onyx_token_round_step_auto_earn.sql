begin;

alter table public.profile_premium_main_round_awards
  add column if not exists round_step integer;

update public.profile_premium_main_round_awards
set round_step = 2
where round_step is null;

alter table public.profile_premium_main_round_awards
  alter column round_step set not null;

alter table public.profile_premium_main_round_awards
  drop constraint if exists profile_premium_main_round_aw_series_id_round_number_user_i_key;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profile_premium_main_round_awards_round_step_check'
      and conrelid = 'public.profile_premium_main_round_awards'::regclass
  ) then
    alter table public.profile_premium_main_round_awards
      add constraint profile_premium_main_round_awards_round_step_check
      check (round_step in (1, 2));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profile_premium_main_round_aw_series_id_round_number_round_ste_key'
      and conrelid = 'public.profile_premium_main_round_awards'::regclass
  ) then
    alter table public.profile_premium_main_round_awards
      add constraint profile_premium_main_round_aw_series_id_round_number_round_ste_key
      unique (series_id, round_number, round_step, user_id);
  end if;
end;
$$;

create or replace function public._award_completed_main_round_tokens(
  p_series_id uuid,
  p_completed_round integer,
  p_completed_step integer
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_enabled boolean;
  v_effective_step integer;
  v_player record;
begin
  if p_series_id is null or p_completed_round is null or p_completed_round < 0 then
    return;
  end if;

  v_effective_step := case
    when p_completed_round = 0 then 1
    else greatest(1, least(2, coalesce(p_completed_step, 1)))
  end;

  select auto_main_round_tokens_enabled
  into v_enabled
  from public.premium_system_settings
  where singleton = true;

  if not coalesce(v_enabled, true) then
    return;
  end if;

  for v_player in
    select sp.user_id
    from public.series_players sp
    where sp.series_id = p_series_id
  loop
    insert into public.profile_premium_main_round_awards (
      series_id,
      round_number,
      round_step,
      user_id
    )
    values (
      p_series_id,
      p_completed_round,
      v_effective_step,
      v_player.user_id
    )
    on conflict (series_id, round_number, round_step, user_id) do nothing;

    if found then
      perform public._grant_gentlemens_tokens(
        v_player.user_id,
        1,
        'completed_round_step',
        format('Completed round %s-%s', p_completed_round, v_effective_step),
        p_series_id,
        p_completed_round,
        null
      );
    end if;
  end loop;
end;
$function$;

create or replace function public._award_completed_main_round_tokens(
  p_series_id uuid,
  p_completed_round integer
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  perform public._award_completed_main_round_tokens(
    p_series_id,
    p_completed_round,
    case
      when coalesce(p_completed_round, 0) = 0 then 1
      else 2
    end
  );
end;
$function$;

create or replace function public.advance_series_phase(p_series_id uuid, p_force boolean DEFAULT false)
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
