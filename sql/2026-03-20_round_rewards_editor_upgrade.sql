begin;

create table if not exists public.series_round_reward_config_random_items (
  id uuid primary key default gen_random_uuid(),
  reward_config_id uuid not null references public.series_round_reward_configs(id) on delete cascade,
  placement integer not null check (placement between 1 and 6),
  item_definition_id uuid not null references public.item_definitions(id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  unique (reward_config_id, placement, item_definition_id)
);

create index if not exists idx_series_round_reward_config_random_items_lookup
  on public.series_round_reward_config_random_items (reward_config_id, placement);

grant select, insert, update, delete on public.series_round_reward_config_random_items to authenticated;
grant all on public.series_round_reward_config_random_items to service_role;

create or replace function public._process_series_round_rewards(p_series_id uuid, p_force boolean default false)
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
          from public.series_round_reward_config_random_items pool
          join public.item_definitions i
            on i.id = pool.item_definition_id
          where pool.reward_config_id = v_config.id
            and pool.placement = v_result.placement
            and i.is_active = true
          order by random()
          limit 1;

          if v_random_item_id is null then
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

commit;
