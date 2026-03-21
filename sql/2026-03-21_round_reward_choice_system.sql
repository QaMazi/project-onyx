begin;

create table if not exists public.series_round_reward_entries (
  id uuid primary key default gen_random_uuid(),
  reward_config_id uuid not null references public.series_round_reward_configs(id) on delete cascade,
  placement integer null,
  entry_order integer not null default 1,
  reward_kind text not null check (reward_kind in ('set', 'random', 'choice')),
  choice_count integer not null default 1,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists idx_series_round_reward_entries_lookup
on public.series_round_reward_entries (reward_config_id, placement, entry_order);

create table if not exists public.series_round_reward_entry_options (
  id uuid primary key default gen_random_uuid(),
  reward_entry_id uuid not null references public.series_round_reward_entries(id) on delete cascade,
  option_order integer not null default 1,
  option_kind text not null check (option_kind in ('shards', 'feature_coins', 'specific_item', 'random_item')),
  exact_quantity integer not null default 1,
  quantity_min integer not null default 0,
  quantity_max integer not null default 0,
  item_definition_id uuid null references public.item_definitions(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists idx_series_round_reward_entry_options_lookup
on public.series_round_reward_entry_options (reward_entry_id, option_order);

create table if not exists public.series_round_reward_entry_option_pool_items (
  id uuid primary key default gen_random_uuid(),
  reward_entry_option_id uuid not null references public.series_round_reward_entry_options(id) on delete cascade,
  item_definition_id uuid not null references public.item_definitions(id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  unique (reward_entry_option_id, item_definition_id)
);

create index if not exists idx_series_round_reward_entry_option_pool_items_lookup
on public.series_round_reward_entry_option_pool_items (reward_entry_option_id);

create table if not exists public.player_round_reward_choice_entries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.player_round_reward_notifications(id) on delete cascade,
  reward_entry_id uuid null references public.series_round_reward_entries(id) on delete set null,
  entry_order integer not null default 1,
  choices_required integer not null default 1,
  choices_remaining integer not null default 1,
  option_snapshots jsonb not null default '[]'::jsonb,
  claim_results jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone not null default now(),
  resolved_at timestamp with time zone null
);

create index if not exists idx_player_round_reward_choice_entries_lookup
on public.player_round_reward_choice_entries (notification_id, resolved_at, entry_order);

grant select, insert, update, delete on public.series_round_reward_entries to authenticated;
grant all on public.series_round_reward_entries to service_role;
grant select, insert, update, delete on public.series_round_reward_entry_options to authenticated;
grant all on public.series_round_reward_entry_options to service_role;
grant select, insert, update, delete on public.series_round_reward_entry_option_pool_items to authenticated;
grant all on public.series_round_reward_entry_option_pool_items to service_role;
grant select on public.player_round_reward_choice_entries to authenticated;
grant all on public.player_round_reward_choice_entries to service_role;

do $$
declare
  v_config record;
  v_placement record;
  v_entry_id uuid;
  v_option_id uuid;
  v_entry_order integer;
begin
  for v_config in
    select cfg.*
    from public.series_round_reward_configs cfg
    where not exists (
      select 1
      from public.series_round_reward_entries e
      where e.reward_config_id = cfg.id
    )
  loop
    v_entry_order := 1;

    if coalesce(v_config.shared_shard_min, 0) > 0 or coalesce(v_config.shared_shard_max, 0) > 0 then
      insert into public.series_round_reward_entries (reward_config_id, placement, entry_order, reward_kind)
      values (v_config.id, null, v_entry_order, 'random')
      returning id into v_entry_id;

      insert into public.series_round_reward_entry_options (
        reward_entry_id,
        option_order,
        option_kind,
        exact_quantity,
        quantity_min,
        quantity_max
      )
      values (
        v_entry_id,
        1,
        'shards',
        0,
        greatest(coalesce(v_config.shared_shard_min, 0), 0),
        greatest(coalesce(v_config.shared_shard_max, 0), 0)
      );

      v_entry_order := v_entry_order + 1;
    end if;

    if coalesce(v_config.shared_feature_coin_min, 0) > 0 or coalesce(v_config.shared_feature_coin_max, 0) > 0 then
      insert into public.series_round_reward_entries (reward_config_id, placement, entry_order, reward_kind)
      values (v_config.id, null, v_entry_order, 'random')
      returning id into v_entry_id;

      insert into public.series_round_reward_entry_options (
        reward_entry_id,
        option_order,
        option_kind,
        exact_quantity,
        quantity_min,
        quantity_max
      )
      values (
        v_entry_id,
        1,
        'feature_coins',
        0,
        greatest(coalesce(v_config.shared_feature_coin_min, 0), 0),
        greatest(coalesce(v_config.shared_feature_coin_max, 0), 0)
      );

      v_entry_order := v_entry_order + 1;
    end if;

    if v_config.shared_item_definition_id is not null and coalesce(v_config.shared_item_quantity, 0) > 0 then
      insert into public.series_round_reward_entries (reward_config_id, placement, entry_order, reward_kind)
      values (v_config.id, null, v_entry_order, 'set')
      returning id into v_entry_id;

      insert into public.series_round_reward_entry_options (
        reward_entry_id,
        option_order,
        option_kind,
        exact_quantity,
        item_definition_id
      )
      values (
        v_entry_id,
        1,
        'specific_item',
        greatest(coalesce(v_config.shared_item_quantity, 0), 0),
        v_config.shared_item_definition_id
      );

      v_entry_order := v_entry_order + 1;
    end if;

    for v_placement in
      select *
      from public.series_round_reward_config_placements p
      where p.reward_config_id = v_config.id
      order by p.placement asc, p.created_at asc
    loop
      v_entry_order := 1;

      if coalesce(v_placement.extra_shard_min, 0) > 0 or coalesce(v_placement.extra_shard_max, 0) > 0 then
        insert into public.series_round_reward_entries (reward_config_id, placement, entry_order, reward_kind)
        values (v_config.id, v_placement.placement, v_entry_order, 'random')
        returning id into v_entry_id;

        insert into public.series_round_reward_entry_options (
          reward_entry_id,
          option_order,
          option_kind,
          exact_quantity,
          quantity_min,
          quantity_max
        )
        values (
          v_entry_id,
          1,
          'shards',
          0,
          greatest(coalesce(v_placement.extra_shard_min, 0), 0),
          greatest(coalesce(v_placement.extra_shard_max, 0), 0)
        );

        v_entry_order := v_entry_order + 1;
      end if;

      if coalesce(v_placement.extra_feature_coin_min, 0) > 0 or coalesce(v_placement.extra_feature_coin_max, 0) > 0 then
        insert into public.series_round_reward_entries (reward_config_id, placement, entry_order, reward_kind)
        values (v_config.id, v_placement.placement, v_entry_order, 'random')
        returning id into v_entry_id;

        insert into public.series_round_reward_entry_options (
          reward_entry_id,
          option_order,
          option_kind,
          exact_quantity,
          quantity_min,
          quantity_max
        )
        values (
          v_entry_id,
          1,
          'feature_coins',
          0,
          greatest(coalesce(v_placement.extra_feature_coin_min, 0), 0),
          greatest(coalesce(v_placement.extra_feature_coin_max, 0), 0)
        );

        v_entry_order := v_entry_order + 1;
      end if;

      if coalesce(v_placement.random_item_quantity, 0) > 0 then
        insert into public.series_round_reward_entries (reward_config_id, placement, entry_order, reward_kind)
        values (
          v_config.id,
          v_placement.placement,
          v_entry_order,
          case when v_placement.specific_item_definition_id is not null then 'set' else 'random' end
        )
        returning id into v_entry_id;

        insert into public.series_round_reward_entry_options (
          reward_entry_id,
          option_order,
          option_kind,
          exact_quantity,
          item_definition_id
        )
        values (
          v_entry_id,
          1,
          case when v_placement.specific_item_definition_id is not null then 'specific_item' else 'random_item' end,
          greatest(coalesce(v_placement.random_item_quantity, 0), 0),
          v_placement.specific_item_definition_id
        )
        returning id into v_option_id;

        if v_placement.specific_item_definition_id is null then
          insert into public.series_round_reward_entry_option_pool_items (
            reward_entry_option_id,
            item_definition_id
          )
          select
            v_option_id,
            pool.item_definition_id
          from public.series_round_reward_config_random_items pool
          where pool.reward_config_id = v_config.id
            and pool.placement = v_placement.placement
          on conflict (reward_entry_option_id, item_definition_id) do nothing;
        end if;
      end if;
    end loop;
  end loop;
end
$$;

create or replace function public._roll_round_reward_quantity(
  p_min integer,
  p_max integer
)
returns integer
language plpgsql
set search_path to 'public'
as $function$
declare
  v_min integer := greatest(coalesce(p_min, 0), 0);
  v_max integer := greatest(coalesce(p_max, 0), 0);
begin
  if v_max <= v_min then
    return v_min;
  end if;

  return floor(random() * (v_max - v_min + 1))::integer + v_min;
end;
$function$;

create or replace function public._grant_round_reward_option(
  p_series_id uuid,
  p_user_id uuid,
  p_actor_id uuid,
  p_notes_prefix text,
  p_reward_kind text,
  p_option_kind text,
  p_exact_quantity integer,
  p_quantity_min integer,
  p_quantity_max integer,
  p_item_definition_id uuid,
  p_pool_item_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_grants jsonb := '[]'::jsonb;
  v_quantity integer := 0;
  v_item_id uuid;
  v_item_name text;
  v_roll_index integer := 0;
begin
  if p_option_kind = 'shards' then
    v_quantity := case
      when p_reward_kind = 'random' then public._roll_round_reward_quantity(p_quantity_min, p_quantity_max)
      else greatest(coalesce(p_exact_quantity, 0), 0)
    end;

    if v_quantity > 0 then
      perform public._grant_series_shards(
        p_series_id,
        p_user_id,
        v_quantity,
        p_actor_id,
        p_notes_prefix || ':shards'
      );

      v_grants := v_grants || jsonb_build_array(
        jsonb_build_object('kind', 'shards', 'label', 'Shards', 'value', v_quantity)
      );
    end if;

    return v_grants;
  end if;

  if p_option_kind = 'feature_coins' then
    v_quantity := case
      when p_reward_kind = 'random' then public._roll_round_reward_quantity(p_quantity_min, p_quantity_max)
      else greatest(coalesce(p_exact_quantity, 0), 0)
    end;

    if v_quantity > 0 then
      perform public._grant_series_feature_coins(
        p_series_id,
        p_user_id,
        v_quantity,
        p_actor_id,
        p_notes_prefix || ':feature_coins'
      );

      v_grants := v_grants || jsonb_build_array(
        jsonb_build_object('kind', 'feature_coins', 'label', 'Feature Coins', 'value', v_quantity)
      );
    end if;

    return v_grants;
  end if;

  if p_option_kind = 'specific_item' then
    v_quantity := greatest(coalesce(p_exact_quantity, 0), 0);

    if v_quantity <= 0 or p_item_definition_id is null then
      return v_grants;
    end if;

    select i.name
    into v_item_name
    from public.item_definitions i
    where i.id = p_item_definition_id;

    if v_item_name is null then
      raise exception 'Reward item definition not found';
    end if;

    perform public._grant_series_item(
      p_series_id,
      p_user_id,
      p_item_definition_id,
      v_quantity,
      p_actor_id,
      p_notes_prefix || ':specific_item'
    );

    v_grants := v_grants || jsonb_build_array(
      jsonb_build_object(
        'kind', 'item',
        'label', v_item_name,
        'value', v_quantity,
        'item_definition_id', p_item_definition_id
      )
    );

    return v_grants;
  end if;

  if p_option_kind = 'random_item' then
    v_quantity := greatest(coalesce(p_exact_quantity, 0), 0);

    if v_quantity <= 0 then
      return v_grants;
    end if;

    for v_roll_index in 1..v_quantity loop
      v_item_id := null;
      v_item_name := null;

      if coalesce(array_length(p_pool_item_ids, 1), 0) > 0 then
        select i.id, i.name
        into v_item_id, v_item_name
        from public.item_definitions i
        where i.id = any(p_pool_item_ids)
          and i.is_active = true
        order by random()
        limit 1;
      end if;

      if v_item_id is null then
        select i.id, i.name
        into v_item_id, v_item_name
        from public.item_definitions i
        where i.is_active = true
          and coalesce(i.is_randomly_available, true) = true
          and coalesce(i.is_reward_rng_locked, false) = false
          and coalesce(i.is_store_purchase_locked, false) = false
        order by random()
        limit 1;
      end if;

      if v_item_id is null or v_item_name is null then
        raise exception 'No eligible reward item is available';
      end if;

      perform public._grant_series_item(
        p_series_id,
        p_user_id,
        v_item_id,
        1,
        p_actor_id,
        format('%s:random_item:%s', p_notes_prefix, v_roll_index)
      );

      v_grants := v_grants || jsonb_build_array(
        jsonb_build_object(
          'kind', 'item',
          'label', v_item_name,
          'value', 1,
          'item_definition_id', v_item_id
        )
      );
    end loop;

    return v_grants;
  end if;

  raise exception 'Unsupported reward option kind: %', coalesce(p_option_kind, 'null');
end;
$function$;

create or replace function public.get_series_round_reward_editor_configs(
  p_series_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_payload jsonb := '[]'::jsonb;
begin
  perform public._assert_authenticated_user();
  perform public._assert_series_admin_or_admin_plus(p_series_id);

  select coalesce(
    jsonb_agg(config_json order by (config_json ->> 'round_number')::integer, (config_json ->> 'round_step')::integer),
    '[]'::jsonb
  )
  into v_payload
  from (
    select jsonb_build_object(
      'id', cfg.id,
      'round_number', cfg.round_number,
      'round_step', cfg.round_step,
      'entries',
        coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', entry_row.id,
              'placement', entry_row.placement,
              'entry_order', entry_row.entry_order,
              'reward_kind', entry_row.reward_kind,
              'choice_count', entry_row.choice_count,
              'options',
                coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'id', opt.id,
                      'option_order', opt.option_order,
                      'option_kind', opt.option_kind,
                      'exact_quantity', opt.exact_quantity,
                      'quantity_min', opt.quantity_min,
                      'quantity_max', opt.quantity_max,
                      'item_definition_id', opt.item_definition_id,
                      'pool_item_ids',
                        coalesce((
                          select jsonb_agg(pool.item_definition_id order by pool.item_definition_id)
                          from public.series_round_reward_entry_option_pool_items pool
                          where pool.reward_entry_option_id = opt.id
                        ), '[]'::jsonb)
                    )
                    order by opt.option_order, opt.created_at
                  )
                  from public.series_round_reward_entry_options opt
                  where opt.reward_entry_id = entry_row.id
                ), '[]'::jsonb)
            )
            order by
              case when entry_row.placement is null then 0 else 1 end,
              coalesce(entry_row.placement, 0),
              entry_row.entry_order,
              entry_row.created_at
          )
          from public.series_round_reward_entries entry_row
          where entry_row.reward_config_id = cfg.id
        ), '[]'::jsonb)
    ) as config_json
    from public.series_round_reward_configs cfg
    where cfg.series_id = p_series_id
  ) config_rows;

  return v_payload;
end;
$function$;

create or replace function public.save_series_round_reward_config(
  p_series_id uuid,
  p_config_id uuid,
  p_round_number integer,
  p_round_step integer,
  p_entries jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_config_id uuid;
  v_entry_json jsonb;
  v_option_json jsonb;
  v_entry_id uuid;
  v_option_id uuid;
  v_entry_order integer := 0;
  v_option_order integer := 0;
  v_reward_kind text;
  v_option_kind text;
  v_choice_count integer;
  v_placement integer;
  v_exact_quantity integer;
  v_quantity_min integer;
  v_quantity_max integer;
  v_item_definition_id uuid;
  v_pool_item_id_text text;
  v_option_count integer;
begin
  perform public._assert_authenticated_user();
  perform public._assert_series_admin_or_admin_plus(p_series_id);

  if p_series_id is null then
    raise exception 'Series is required';
  end if;

  if p_round_number is null or p_round_number < 0 then
    raise exception 'Round number is required';
  end if;

  if p_round_step is null or p_round_step < 1 or p_round_step > 2 then
    raise exception 'Round step must be 1 or 2';
  end if;

  if exists (
    select 1
    from public.series_round_reward_configs cfg
    where cfg.series_id = p_series_id
      and cfg.round_number = p_round_number
      and cfg.round_step = p_round_step
      and cfg.id <> coalesce(p_config_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) then
    raise exception 'That round reward config already exists';
  end if;

  if p_config_id is null then
    insert into public.series_round_reward_configs (
      series_id,
      round_number,
      round_step,
      shared_shard_min,
      shared_shard_max,
      shared_item_definition_id,
      shared_item_quantity,
      shared_feature_coin_min,
      shared_feature_coin_max
    )
    values (
      p_series_id,
      p_round_number,
      p_round_step,
      0,
      0,
      null,
      0,
      0,
      0
    )
    returning id into v_config_id;
  else
    update public.series_round_reward_configs
    set
      round_number = p_round_number,
      round_step = p_round_step,
      shared_shard_min = 0,
      shared_shard_max = 0,
      shared_item_definition_id = null,
      shared_item_quantity = 0,
      shared_feature_coin_min = 0,
      shared_feature_coin_max = 0,
      updated_at = now()
    where id = p_config_id
      and series_id = p_series_id
    returning id into v_config_id;

    if v_config_id is null then
      raise exception 'Reward config not found';
    end if;
  end if;

  delete from public.series_round_reward_config_random_items
  where reward_config_id = v_config_id;

  delete from public.series_round_reward_config_placements
  where reward_config_id = v_config_id;

  delete from public.series_round_reward_entries
  where reward_config_id = v_config_id;

  if jsonb_typeof(coalesce(p_entries, '[]'::jsonb)) <> 'array' then
    raise exception 'Reward entries must be an array';
  end if;

  for v_entry_json in
    select value
    from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb))
  loop
    v_entry_order := greatest(coalesce((v_entry_json ->> 'entry_order')::integer, v_entry_order + 1), 1);
    v_reward_kind := lower(coalesce(v_entry_json ->> 'reward_kind', 'set'));
    v_choice_count := greatest(coalesce((v_entry_json ->> 'choice_count')::integer, 1), 1);
    v_placement := nullif(v_entry_json ->> 'placement', '')::integer;
    v_option_count := coalesce(jsonb_array_length(coalesce(v_entry_json -> 'options', '[]'::jsonb)), 0);

    if v_reward_kind not in ('set', 'random', 'choice') then
      raise exception 'Unsupported reward kind: %', coalesce(v_reward_kind, 'null');
    end if;

    if v_option_count = 0 then
      raise exception 'Each reward entry must have at least one option';
    end if;

    if v_reward_kind in ('set', 'random') and v_option_count <> 1 then
      raise exception 'Set and Random rewards must have exactly one option';
    end if;

    if v_reward_kind = 'choice' and v_choice_count > v_option_count then
      raise exception 'Choice rewards cannot require more picks than available options';
    end if;

    insert into public.series_round_reward_entries (
      reward_config_id,
      placement,
      entry_order,
      reward_kind,
      choice_count
    )
    values (
      v_config_id,
      v_placement,
      v_entry_order,
      v_reward_kind,
      v_choice_count
    )
    returning id into v_entry_id;

    v_option_order := 0;

    for v_option_json in
      select value
      from jsonb_array_elements(coalesce(v_entry_json -> 'options', '[]'::jsonb))
    loop
      v_option_order := v_option_order + 1;
      v_option_kind := lower(coalesce(v_option_json ->> 'option_kind', 'specific_item'));
      v_exact_quantity := greatest(coalesce((v_option_json ->> 'exact_quantity')::integer, 0), 0);
      v_quantity_min := greatest(coalesce((v_option_json ->> 'quantity_min')::integer, 0), 0);
      v_quantity_max := greatest(coalesce((v_option_json ->> 'quantity_max')::integer, 0), 0);
      v_item_definition_id := nullif(v_option_json ->> 'item_definition_id', '')::uuid;

      if v_option_kind not in ('shards', 'feature_coins', 'specific_item', 'random_item') then
        raise exception 'Unsupported reward option kind: %', coalesce(v_option_kind, 'null');
      end if;

      if v_option_kind = 'specific_item' and v_item_definition_id is null then
        raise exception 'Specific item rewards require an item';
      end if;

      insert into public.series_round_reward_entry_options (
        reward_entry_id,
        option_order,
        option_kind,
        exact_quantity,
        quantity_min,
        quantity_max,
        item_definition_id
      )
      values (
        v_entry_id,
        v_option_order,
        v_option_kind,
        v_exact_quantity,
        v_quantity_min,
        v_quantity_max,
        v_item_definition_id
      )
      returning id into v_option_id;

      for v_pool_item_id_text in
        select value
        from jsonb_array_elements_text(coalesce(v_option_json -> 'pool_item_ids', '[]'::jsonb))
      loop
        insert into public.series_round_reward_entry_option_pool_items (
          reward_entry_option_id,
          item_definition_id
        )
        values (
          v_option_id,
          v_pool_item_id_text::uuid
        )
        on conflict (reward_entry_option_id, item_definition_id) do nothing;
      end loop;
    end loop;
  end loop;

  return v_config_id;
end;
$function$;

create or replace function public.delete_series_round_reward_config(
  p_series_id uuid,
  p_config_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  perform public._assert_authenticated_user();
  perform public._assert_series_admin_or_admin_plus(p_series_id);

  delete from public.series_round_reward_configs
  where id = p_config_id
    and series_id = p_series_id;
end;
$function$;

create or replace function public.get_my_pending_round_reward_choices(
  p_notification_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_notification record;
  v_payload jsonb := '[]'::jsonb;
begin
  v_actor_id := public._assert_authenticated_user();

  select *
  into v_notification
  from public.player_round_reward_notifications
  where id = p_notification_id
    and user_id = v_actor_id;

  if not found then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', choice_row.id,
        'entry_order', choice_row.entry_order,
        'choices_required', choice_row.choices_required,
        'choices_remaining', choice_row.choices_remaining,
        'option_snapshots', choice_row.option_snapshots,
        'claim_results', choice_row.claim_results,
        'resolved_at', choice_row.resolved_at
      )
      order by choice_row.entry_order, choice_row.created_at
    ),
    '[]'::jsonb
  )
  into v_payload
  from public.player_round_reward_choice_entries choice_row
  where choice_row.notification_id = p_notification_id
    and choice_row.resolved_at is null;

  return v_payload;
end;
$function$;

create or replace function public.claim_round_reward_choice(
  p_choice_entry_id uuid,
  p_option_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_choice_entry record;
  v_notification record;
  v_option_id uuid;
  v_option_json jsonb;
  v_item_pool_ids uuid[];
  v_claim_grants jsonb := '[]'::jsonb;
  v_all_grants jsonb := '[]'::jsonb;
  v_result_payload jsonb := '{}'::jsonb;
  v_existing_option_ids uuid[] := '{}'::uuid[];
begin
  v_actor_id := public._assert_authenticated_user();

  select *
  into v_choice_entry
  from public.player_round_reward_choice_entries
  where id = p_choice_entry_id
  for update;

  if not found then
    raise exception 'Choice reward not found';
  end if;

  select *
  into v_notification
  from public.player_round_reward_notifications
  where id = v_choice_entry.notification_id
    and user_id = v_actor_id
  for update;

  if not found then
    raise exception 'Reward notification not found';
  end if;

  if v_choice_entry.resolved_at is not null or v_choice_entry.choices_remaining <= 0 then
    raise exception 'This choice reward has already been resolved';
  end if;

  if coalesce(array_length(p_option_ids, 1), 0) <> v_choice_entry.choices_remaining then
    raise exception 'Select exactly % option(s)', v_choice_entry.choices_remaining;
  end if;

  if exists (
    select 1
    from unnest(p_option_ids) selected_option
    group by selected_option
    having count(*) > 1
  ) then
    raise exception 'Each choice option can only be selected once';
  end if;

  select coalesce(
    array_agg((result_entry ->> 'option_id')::uuid),
    '{}'::uuid[]
  )
  into v_existing_option_ids
  from jsonb_array_elements(coalesce(v_choice_entry.claim_results, '[]'::jsonb)) result_entry;

  foreach v_option_id in array p_option_ids
  loop
    if v_option_id = any(v_existing_option_ids) then
      raise exception 'That choice option has already been claimed';
    end if;

    select value
    into v_option_json
    from jsonb_array_elements(coalesce(v_choice_entry.option_snapshots, '[]'::jsonb))
    where (value ->> 'id')::uuid = v_option_id
    limit 1;

    if v_option_json is null then
      raise exception 'Selected choice option was not found';
    end if;

    select coalesce(
      array_agg(value::uuid),
      '{}'::uuid[]
    )
    into v_item_pool_ids
    from jsonb_array_elements_text(coalesce(v_option_json -> 'pool_item_ids', '[]'::jsonb));

    v_claim_grants := public._grant_round_reward_option(
      v_notification.series_id,
      v_notification.user_id,
      v_actor_id,
      format(
        'round_reward_choice:%s:%s:%s',
        v_notification.round_number,
        v_notification.round_step,
        v_choice_entry.entry_order
      ),
      'choice',
      lower(coalesce(v_option_json ->> 'option_kind', 'specific_item')),
      coalesce((v_option_json ->> 'exact_quantity')::integer, 0),
      coalesce((v_option_json ->> 'quantity_min')::integer, 0),
      coalesce((v_option_json ->> 'quantity_max')::integer, 0),
      nullif(v_option_json ->> 'item_definition_id', '')::uuid,
      v_item_pool_ids
    );

    v_all_grants := v_all_grants || coalesce(v_claim_grants, '[]'::jsonb);

    update public.player_round_reward_choice_entries
    set
      claim_results = claim_results || jsonb_build_array(
        jsonb_build_object(
          'option_id', v_option_id,
          'grants', coalesce(v_claim_grants, '[]'::jsonb)
        )
      ),
      choices_remaining = greatest(choices_remaining - 1, 0),
      resolved_at = case
        when choices_remaining - 1 <= 0 then now()
        else null
      end
    where id = v_choice_entry.id
    returning * into v_choice_entry;
  end loop;

  update public.player_round_reward_notifications
  set payload = jsonb_set(
    jsonb_set(
      payload,
      '{grants}',
      coalesce(payload -> 'grants', '[]'::jsonb) || coalesce(v_all_grants, '[]'::jsonb),
      true
    ),
    '{has_pending_choices}',
    case
      when exists (
        select 1
        from public.player_round_reward_choice_entries unresolved_choice
        where unresolved_choice.notification_id = v_notification.id
          and unresolved_choice.resolved_at is null
      )
      then 'true'::jsonb
      else 'false'::jsonb
    end,
    true
  )
  where id = v_notification.id
  returning payload into v_result_payload;

  return jsonb_build_object(
    'choice_entry_id', v_choice_entry.id,
    'choices_remaining', v_choice_entry.choices_remaining,
    'grants', coalesce(v_all_grants, '[]'::jsonb),
    'payload', coalesce(v_result_payload, '{}'::jsonb)
  );
end;
$function$;

create or replace function public.dismiss_round_reward_notification(
  p_notification_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
begin
  v_actor_id := public._assert_authenticated_user();

  if exists (
    select 1
    from public.player_round_reward_choice_entries choice_row
    join public.player_round_reward_notifications notification
      on notification.id = choice_row.notification_id
    where choice_row.notification_id = p_notification_id
      and notification.user_id = v_actor_id
      and choice_row.resolved_at is null
  ) then
    raise exception 'Resolve all choice rewards before closing this panel';
  end if;

  update public.player_round_reward_notifications
  set dismissed_at = now()
  where id = p_notification_id
    and user_id = v_actor_id;
end;
$function$;

create or replace function public.purchase_container_opener_now(p_series_id uuid, p_item_definition_id uuid, p_quantity integer DEFAULT 1)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_quantity integer := greatest(coalesce(p_quantity, 1), 1);
  v_wallet record;
  v_item record;
  v_total_cost integer := 0;
  v_purchase_id uuid;
  v_grants jsonb := '[]'::jsonb;
begin
  v_actor_id := public._assert_authenticated_user();

  if p_series_id is null then
    raise exception 'Series is required';
  end if;

  if p_item_definition_id is null then
    raise exception 'Store item is required';
  end if;

  perform public._assert_series_member(p_series_id, v_actor_id);

  select *
  into v_wallet
  from public.player_wallets
  where user_id = v_actor_id
    and series_id = p_series_id
  for update;

  if not found then
    raise exception 'Wallet not initialized';
  end if;

  select
    i.*,
    c.code as category_code
  into v_item
  from public.item_definitions i
  left join public.item_categories c
    on c.id = i.category_id
  where i.id = p_item_definition_id;

  if not found or coalesce(v_item.is_active, false) = false then
    raise exception 'Store item not found';
  end if;

  if lower(coalesce(v_item.category_code, '')) <> 'container_openers' then
    raise exception 'That item is not an opener product';
  end if;

  if not coalesce(v_item.is_randomly_available, true) then
    raise exception 'This opener product is not currently available';
  end if;

  if coalesce(v_item.is_store_purchase_locked, false) then
    raise exception 'This opener product is currently purchase locked';
  end if;

  if coalesce(v_item.max_purchase, 0) > 0 and v_quantity > v_item.max_purchase then
    raise exception 'This purchase exceeds the max purchase limit for the item';
  end if;

  if v_item.behavior_code not in ('open_container', 'grant_random_container_key') then
    raise exception 'That item cannot be purchased from the opener page';
  end if;

  v_total_cost := greatest(coalesce(v_item.store_price, 0), 0) * v_quantity;

  if coalesce(v_wallet.shards, 0) < v_total_cost then
    raise exception 'Not enough shards';
  end if;

  update public.player_wallets
  set
    shards = shards - v_total_cost,
    updated_at = now()
  where user_id = v_actor_id
    and series_id = p_series_id;

  insert into public.store_purchases (
    user_id,
    series_id,
    total_cost
  )
  values (
    v_actor_id,
    p_series_id,
    v_total_cost
  )
  returning id into v_purchase_id;

  insert into public.store_purchase_items (
    purchase_id,
    item_definition_id,
    quantity,
    unit_price
  )
  values (
    v_purchase_id,
    v_item.id,
    v_quantity,
    greatest(coalesce(v_item.store_price, 0), 0)
  );

  perform public._grant_series_item(
    p_series_id,
    v_actor_id,
    v_item.id,
    v_quantity,
    v_actor_id,
    case
      when v_item.behavior_code = 'grant_random_container_key'
        then 'opener_direct_purchase:random_key_item'
      else 'opener_direct_purchase:specific'
    end
  );

  v_grants := jsonb_build_array(
    jsonb_build_object(
      'item_definition_id', v_item.id,
      'item_name', v_item.name,
      'item_code', v_item.code,
      'quantity', v_quantity
    )
  );

  return jsonb_build_object(
    'success', true,
    'item_name', v_item.name,
    'quantity', v_quantity,
    'total_cost', v_total_cost,
    'remaining_shards', greatest(coalesce(v_wallet.shards, 0) - v_total_cost, 0),
    'granted_items', coalesce(v_grants, '[]'::jsonb)
  );
end;
$function$;

create or replace function public._process_series_round_rewards(p_series_id uuid, p_force boolean DEFAULT false)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_series record;
  v_config record;
  v_entry record;
  v_result record;
  v_actor_id uuid;
  v_processed_count integer := 0;
  v_error_count integer := 0;
  v_grants jsonb;
  v_round_label text;
  v_notes_prefix text;
  v_scoreboard jsonb;
  v_reward_error_message text;
  v_option_json jsonb;
  v_pending_choice_entries jsonb := '[]'::jsonb;
  v_choice_json jsonb;
  v_pending_choice_count integer := 0;
  v_pool_item_ids uuid[];
  v_notification_id uuid;
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

    v_grants := '[]'::jsonb;
    v_pending_choice_entries := '[]'::jsonb;
    v_pending_choice_count := 0;
    v_reward_error_message := null;
    v_notes_prefix := format(
      'round_reward:%s:%s:%s',
      v_series.round_number,
      v_series.round_step_value,
      v_result.placement
    );

    begin
      for v_entry in
        select
          entry_row.*,
          coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', opt.id,
                'option_order', opt.option_order,
                'option_kind', opt.option_kind,
                'exact_quantity', opt.exact_quantity,
                'quantity_min', opt.quantity_min,
                'quantity_max', opt.quantity_max,
                'item_definition_id', opt.item_definition_id,
                'item_name', item_row.name,
                'pool_item_ids',
                  coalesce((
                    select jsonb_agg(pool.item_definition_id order by pool.item_definition_id)
                    from public.series_round_reward_entry_option_pool_items pool
                    where pool.reward_entry_option_id = opt.id
                  ), '[]'::jsonb)
              )
              order by opt.option_order, opt.created_at
            )
            from public.series_round_reward_entry_options opt
            left join public.item_definitions item_row
              on item_row.id = opt.item_definition_id
            where opt.reward_entry_id = entry_row.id
          ), '[]'::jsonb) as option_snapshots
        from public.series_round_reward_entries entry_row
        where entry_row.reward_config_id = v_config.id
          and (entry_row.placement is null or entry_row.placement = v_result.placement)
        order by
          case when entry_row.placement is null then 0 else 1 end,
          coalesce(entry_row.placement, 0),
          entry_row.entry_order,
          entry_row.created_at
      loop
        if v_entry.reward_kind = 'choice' then
          v_pending_choice_entries := v_pending_choice_entries || jsonb_build_array(
            jsonb_build_object(
              'reward_entry_id', v_entry.id,
              'entry_order', v_entry.entry_order,
              'choices_required', greatest(coalesce(v_entry.choice_count, 1), 1),
              'option_snapshots', coalesce(v_entry.option_snapshots, '[]'::jsonb)
            )
          );
          v_pending_choice_count := v_pending_choice_count + 1;
        else
          v_option_json := coalesce(v_entry.option_snapshots -> 0, '{}'::jsonb);

          if v_option_json = '{}'::jsonb then
            raise exception 'Reward entry is missing its option data';
          end if;

          select coalesce(
            array_agg(value::uuid),
            '{}'::uuid[]
          )
          into v_pool_item_ids
          from jsonb_array_elements_text(coalesce(v_option_json -> 'pool_item_ids', '[]'::jsonb));

          v_grants := v_grants || public._grant_round_reward_option(
            p_series_id,
            v_result.user_id,
            v_actor_id,
            format('%s:entry_%s', v_notes_prefix, v_entry.entry_order),
            v_entry.reward_kind,
            lower(coalesce(v_option_json ->> 'option_kind', 'specific_item')),
            coalesce((v_option_json ->> 'exact_quantity')::integer, 0),
            coalesce((v_option_json ->> 'quantity_min')::integer, 0),
            coalesce((v_option_json ->> 'quantity_max')::integer, 0),
            nullif(v_option_json ->> 'item_definition_id', '')::uuid,
            v_pool_item_ids
          );
        end if;
      end loop;

      update public.series_round_results
      set shards_awarded = coalesce((
        select sum((grant_row ->> 'value')::integer)
        from jsonb_array_elements(coalesce(v_grants, '[]'::jsonb)) grant_row
        where grant_row ->> 'kind' = 'shards'
      ), 0)
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
          'grant_status', 'complete',
          'has_pending_choices', v_pending_choice_count > 0
        )
      )
      on conflict (series_id, user_id, round_number, round_step)
      do update set
        payload = excluded.payload
      returning id into v_notification_id;

      for v_choice_json in
        select value
        from jsonb_array_elements(coalesce(v_pending_choice_entries, '[]'::jsonb))
      loop
        insert into public.player_round_reward_choice_entries (
          notification_id,
          reward_entry_id,
          entry_order,
          choices_required,
          choices_remaining,
          option_snapshots,
          claim_results
        )
        values (
          v_notification_id,
          nullif(v_choice_json ->> 'reward_entry_id', '')::uuid,
          greatest(coalesce((v_choice_json ->> 'entry_order')::integer, 1), 1),
          greatest(coalesce((v_choice_json ->> 'choices_required')::integer, 1), 1),
          greatest(coalesce((v_choice_json ->> 'choices_required')::integer, 1), 1),
          coalesce(v_choice_json -> 'option_snapshots', '[]'::jsonb),
          '[]'::jsonb
        );
      end loop;

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

grant execute on function public.get_series_round_reward_editor_configs(uuid) to authenticated;
grant execute on function public.save_series_round_reward_config(uuid, uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.delete_series_round_reward_config(uuid, uuid) to authenticated;
grant execute on function public.get_my_pending_round_reward_choices(uuid) to authenticated;
grant execute on function public.claim_round_reward_choice(uuid, uuid[]) to authenticated;
grant execute on function public.dismiss_round_reward_notification(uuid) to authenticated;

commit;
