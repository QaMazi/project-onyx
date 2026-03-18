begin;

create or replace function public._feature_slot_raise_rarity_floor(
  p_base_rarity_id uuid default null,
  p_steps integer default 0
)
returns jsonb
language sql
security definer
set search_path to 'public', 'auth'
as $function$
  with ordered as (
    select
      r.id,
      r.code,
      r.name,
      row_number() over (
        order by coalesce(r.sort_order, 9999), r.name
      ) as rn
    from public.card_rarities r
  ),
  base_row as (
    select coalesce(
      (select o.rn from ordered o where o.id = p_base_rarity_id),
      (select o.rn from ordered o where o.id = public._resolve_common_rarity_id()),
      1
    ) as base_rn
  ),
  chosen as (
    select o.id, o.code, o.name
    from ordered o
    cross join base_row b
    where o.rn = least(
      b.base_rn + greatest(coalesce(p_steps, 0), 0),
      coalesce((select max(rn) from ordered), b.base_rn)
    )
  )
  select coalesce(
    (select jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name) from chosen c),
    '{}'::jsonb
  );
$function$;

create or replace function public._roll_weighted_card_rarity_with_floor(
  p_min_rarity_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_roll numeric := random();
  v_cursor numeric := 0;
  v_total numeric := 0;
  v_min_sort integer := 9999;
  v_selected jsonb := '{}'::jsonb;
  v_row record;
begin
  select coalesce(r.sort_order, 9999)
  into v_min_sort
  from public.card_rarities r
  where r.id = coalesce(p_min_rarity_id, public._resolve_common_rarity_id())
  limit 1;

  if v_min_sort is null then
    select coalesce(r.sort_order, 9999)
    into v_min_sort
    from public.card_rarities r
    order by coalesce(r.sort_order, 9999), r.name
    limit 1;
  end if;

  for v_row in
    select
      r.id,
      r.code,
      r.name,
      greatest(coalesce(r.weight_percent, 0), 0)::numeric as weight
    from public.card_rarities r
    where coalesce(r.sort_order, 9999) >= coalesce(v_min_sort, 9999)
    order by coalesce(r.sort_order, 9999), r.name
  loop
    v_total := v_total + v_row.weight;
  end loop;

  if v_total <= 0 then
    select jsonb_build_object('id', r.id, 'code', r.code, 'name', r.name)
    into v_selected
    from public.card_rarities r
    where coalesce(r.sort_order, 9999) >= coalesce(v_min_sort, 9999)
    order by coalesce(r.sort_order, 9999), r.name
    limit 1;

    if v_selected = '{}'::jsonb then
      select jsonb_build_object('id', r.id, 'code', r.code, 'name', r.name)
      into v_selected
      from public.card_rarities r
      where r.id = public._resolve_common_rarity_id();
    end if;

    return coalesce(v_selected, '{}'::jsonb);
  end if;

  for v_row in
    select
      r.id,
      r.code,
      r.name,
      greatest(coalesce(r.weight_percent, 0), 0)::numeric as weight
    from public.card_rarities r
    where coalesce(r.sort_order, 9999) >= coalesce(v_min_sort, 9999)
    order by coalesce(r.sort_order, 9999), r.name
  loop
    v_cursor := v_cursor + (v_row.weight / v_total);

    if v_roll <= v_cursor then
      v_selected := jsonb_build_object(
        'id', v_row.id,
        'code', v_row.code,
        'name', v_row.name
      );
      exit;
    end if;
  end loop;

  if v_selected = '{}'::jsonb then
    select jsonb_build_object('id', r.id, 'code', r.code, 'name', r.name)
    into v_selected
    from public.card_rarities r
    where coalesce(r.sort_order, 9999) >= coalesce(v_min_sort, 9999)
    order by coalesce(r.sort_order, 9999), r.name
    limit 1;
  end if;

  return coalesce(v_selected, '{}'::jsonb);
end;
$function$;

create or replace function public._roll_weighted_card_rarity()
returns jsonb
language sql
security definer
set search_path to 'public', 'auth'
as $function$
  select public._roll_weighted_card_rarity_with_floor(null);
$function$;

create or replace function public._feature_slot_random_rarity(
  p_rarity_boosts integer default 0
)
returns jsonb
language sql
security definer
set search_path to 'public', 'auth'
as $function$
  select public._roll_weighted_card_rarity_with_floor(
    nullif(coalesce(public._feature_slot_raise_rarity_floor(null, greatest(coalesce(p_rarity_boosts, 0), 0)) ->> 'id', ''), '')::uuid
  );
$function$;

create or replace function public._feature_slot_offer_cards(
  p_count integer,
  p_picker_category text default null,
  p_min_rarity_id uuid default null
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
    v_rarity := public._roll_weighted_card_rarity_with_floor(p_min_rarity_id);

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
        'rarity_code', v_rarity ->> 'code',
        'rarity_name', v_rarity ->> 'name'
      )
    );
  end loop;

  return coalesce(v_cards, '[]'::jsonb);
end;
$function$;

create or replace function public._feature_slot_offer_cards(
  p_count integer,
  p_picker_category text default null,
  p_rarity_boosts integer default 0
)
returns jsonb
language sql
security definer
set search_path to 'public', 'auth'
as $function$
  select public._feature_slot_offer_cards(
    p_count,
    p_picker_category,
    nullif(
      coalesce(
        public._feature_slot_raise_rarity_floor(null, greatest(coalesce(p_rarity_boosts, 0), 0)) ->> 'id',
        ''
      ),
      ''
    )::uuid
  );
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
  v_slot_floor jsonb := '{}'::jsonb;
begin
  select
    fs.*,
    public._feature_slot_mode(fs.slot_type, fs.name) as resolved_mode
  into v_slot
  from public.feature_slots fs
  where fs.id = p_feature_slot_id;

  if not found then
    raise exception 'Feature Slot not found';
  end if;

  v_slot_floor := public._feature_slot_raise_rarity_floor(v_slot.min_rarity_floor, 0);

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
    'min_rarity_floor_name', nullif(coalesce(v_slot_floor ->> 'name', ''), ''),
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
          'minimum_rarity_id', nullif(coalesce(v_session.metadata ->> 'minimum_rarity_id', ''), ''),
          'minimum_rarity_name', nullif(coalesce(v_session.metadata ->> 'minimum_rarity_name', ''), ''),
          'offers', v_session.offers,
          'metadata', v_session.metadata
        )
      end
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
  v_effective_min_rarity jsonb := '{}'::jsonb;
  v_floor_steps integer := 0;
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
  v_effective_min_rarity := public._feature_slot_raise_rarity_floor(v_slot.min_rarity_floor, 0);

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
    v_floor_steps := greatest(coalesce(p_rarity_boosts, 0), 0);
    v_shard_cost := (coalesce(p_card_amount_boosts, 0) + v_floor_steps) * 10;
    v_effective_min_rarity := public._feature_slot_raise_rarity_floor(
      v_slot.min_rarity_floor,
      v_floor_steps
    );
    v_metadata := jsonb_build_object(
      'card_amount_boosts', coalesce(p_card_amount_boosts, 0),
      'rarity_boosts', v_floor_steps
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

  v_metadata := coalesce(v_metadata, '{}'::jsonb) || jsonb_build_object(
    'minimum_rarity_id', nullif(coalesce(v_effective_min_rarity ->> 'id', ''), ''),
    'minimum_rarity_name', nullif(coalesce(v_effective_min_rarity ->> 'name', ''), '')
  );

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
      nullif(coalesce(v_effective_min_rarity ->> 'id', ''), '')::uuid
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
  v_min_rarity_id uuid;
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

  v_min_rarity_id := nullif(coalesce(v_session.metadata ->> 'minimum_rarity_id', ''), '')::uuid;
  v_next_choice_count := greatest(coalesce(v_session.current_choice_count, 1) - 1, 1);

  update public.player_feature_slot_sessions
  set
    rerolls_remaining = rerolls_remaining - 1,
    current_choice_count = v_next_choice_count,
    offers = public._feature_slot_offer_cards(
      v_next_choice_count,
      v_session.selected_category,
      v_min_rarity_id
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

create or replace function public.get_pack_product_admin(p_pack_group_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_full record;
  v_draft record;
begin
  perform public._assert_admin_plus();

  if trim(coalesce(p_pack_group_code, '')) = '' then
    raise exception 'Pack group code is required';
  end if;

  select * into v_full
  from public.containers
  where pack_group_code = trim(p_pack_group_code)
    and pack_variant = 'full'
  limit 1;

  if not found then
    raise exception 'Pack product not found';
  end if;

  select * into v_draft
  from public.containers
  where pack_group_code = trim(p_pack_group_code)
    and pack_variant = 'draft'
  limit 1;

  return jsonb_build_object(
    'pack_group_code', v_full.pack_group_code,
    'name', v_full.name,
    'code', v_full.code,
    'description', v_full.description,
    'image_url', coalesce(nullif(v_full.artwork_url, ''), nullif(v_full.image_url, '')),
    'content_mode', v_full.content_mode,
    'is_enabled', coalesce(v_full.is_enabled, true),
    'is_locked', coalesce(v_full.is_locked, false),
    'cards_per_open', coalesce(v_full.cards_per_open, v_full.card_count, 9),
    'full_container_id', v_full.id,
    'draft_container_id', v_draft.id,
    'cards', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', cc.id,
          'card_id', cc.card_id,
          'card_name', c.name,
          'pack_pool_tier_id', ppt.id,
          'pack_pool_tier_code', ppt.code,
          'pack_pool_tier_name', ppt.name,
          'rarity_id', cc.rarity_id,
          'rarity_code', r.code,
          'rarity_name', r.name,
          'weight', cc.weight,
          'is_enabled', coalesce(cc.is_enabled, true)
        )
        order by ppt.sort_order, lower(c.name), coalesce(r.sort_order, 9999), r.name
      )
      from public.container_cards cc
      join public.cards c on c.id = cc.card_id
      join public.pack_pool_tiers ppt on ppt.id = cc.pack_pool_tier_id
      left join public.card_rarities r on r.id = cc.rarity_id
      where cc.container_id = v_full.id
        and cc.pack_pool_tier_id is not null
    ), '[]'::jsonb),
    'slot_tiers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', cps.id,
          'slot_index', cps.slot_index,
          'pack_pool_tier_id', ppt.id,
          'pack_pool_tier_code', ppt.code,
          'pack_pool_tier_name', ppt.name,
          'weight', cps.weight,
          'is_enabled', coalesce(cps.is_enabled, true)
        )
        order by cps.slot_index, ppt.sort_order
      )
      from public.container_pack_slot_tiers cps
      join public.pack_pool_tiers ppt on ppt.id = cps.pack_pool_tier_id
      where cps.container_id = v_full.id
    ), '[]'::jsonb)
  );
end;
$function$;

create or replace function public.upsert_pack_product_admin(
  p_pack_group_code text,
  p_name text,
  p_code text,
  p_description text,
  p_image_url text,
  p_content_mode text,
  p_is_enabled boolean,
  p_is_locked boolean,
  p_cards jsonb,
  p_slot_tiers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_full_type_id uuid;
  v_draft_type_id uuid;
  v_group_code text;
  v_base_code text;
  v_full_id uuid;
  v_draft_id uuid;
  v_default_pack_rarity_id uuid;
begin
  perform public._assert_admin_plus();

  if trim(coalesce(p_name, '')) = '' then
    raise exception 'Pack name is required';
  end if;

  if trim(coalesce(p_code, '')) = '' then
    raise exception 'Pack code is required';
  end if;

  select id into v_full_type_id
  from public.container_types
  where lower(code) = 'full_pack'
  limit 1;

  select id into v_draft_type_id
  from public.container_types
  where lower(code) = 'draft_pack'
  limit 1;

  if v_full_type_id is null or v_draft_type_id is null then
    raise exception 'Pack container types are missing';
  end if;

  v_default_pack_rarity_id := public._resolve_common_rarity_id();
  v_base_code := trim(both '_' from regexp_replace(upper(trim(p_code)), '[^A-Z0-9]+', '_', 'g'));
  v_group_code := coalesce(nullif(trim(p_pack_group_code), ''), public._slugify_store_code(v_base_code));

  select id into v_full_id
  from public.containers
  where pack_group_code = v_group_code
    and pack_variant = 'full'
  limit 1;

  if v_full_id is null then
    insert into public.containers (
      id, name, description, card_count, image_url, is_enabled, is_locked,
      content_mode, selection_count, draft_pick_count, rarity_mode, code,
      container_type_id, artwork_url, cards_per_open, pack_group_code, pack_variant
    )
    values (
      gen_random_uuid(), trim(p_name), p_description, 9, p_image_url,
      coalesce(p_is_enabled, true), coalesce(p_is_locked, false),
      public._normalize_container_content_mode(p_content_mode), null, null, 'pack_slots',
      v_base_code, v_full_type_id, p_image_url, 9, v_group_code, 'full'
    )
    returning id into v_full_id;
  else
    update public.containers
    set
      name = trim(p_name),
      description = p_description,
      card_count = 9,
      image_url = p_image_url,
      is_enabled = coalesce(p_is_enabled, true),
      is_locked = coalesce(p_is_locked, false),
      content_mode = public._normalize_container_content_mode(p_content_mode),
      selection_count = null,
      draft_pick_count = null,
      rarity_mode = 'pack_slots',
      code = v_base_code,
      container_type_id = v_full_type_id,
      artwork_url = p_image_url,
      cards_per_open = 9,
      pack_group_code = v_group_code,
      pack_variant = 'full',
      updated_at = now()
    where id = v_full_id;
  end if;

  select id into v_draft_id
  from public.containers
  where pack_group_code = v_group_code
    and pack_variant = 'draft'
  limit 1;

  if v_draft_id is null then
    insert into public.containers (
      id, name, description, card_count, image_url, is_enabled, is_locked,
      content_mode, selection_count, draft_pick_count, rarity_mode, code,
      container_type_id, artwork_url, cards_per_open, pack_group_code, pack_variant
    )
    values (
      gen_random_uuid(), trim(p_name) || ' Draft', p_description, 9, p_image_url,
      coalesce(p_is_enabled, true), coalesce(p_is_locked, false),
      public._normalize_container_content_mode(p_content_mode), null, null, 'pack_slots',
      v_base_code || '_DRAFT', v_draft_type_id, p_image_url, 9, v_group_code, 'draft'
    )
    returning id into v_draft_id;
  else
    update public.containers
    set
      name = trim(p_name) || ' Draft',
      description = p_description,
      card_count = 9,
      image_url = p_image_url,
      is_enabled = coalesce(p_is_enabled, true),
      is_locked = coalesce(p_is_locked, false),
      content_mode = public._normalize_container_content_mode(p_content_mode),
      selection_count = null,
      draft_pick_count = null,
      rarity_mode = 'pack_slots',
      code = v_base_code || '_DRAFT',
      container_type_id = v_draft_type_id,
      artwork_url = p_image_url,
      cards_per_open = 9,
      pack_group_code = v_group_code,
      pack_variant = 'draft',
      updated_at = now()
    where id = v_draft_id;
  end if;

  delete from public.container_cards
  where container_id in (v_full_id, v_draft_id);

  insert into public.container_cards (
    container_id,
    card_id,
    tier_id,
    pack_pool_tier_id,
    is_enabled,
    rarity_id,
    weight,
    slot_index
  )
  select
    ids.container_id,
    x.card_id,
    null,
    x.pack_pool_tier_id,
    coalesce(x.is_enabled, true),
    coalesce(x.rarity_id, v_default_pack_rarity_id),
    greatest(coalesce(x.weight, 1), 1),
    null
  from (values (v_full_id), (v_draft_id)) as ids(container_id)
  cross join jsonb_to_recordset(coalesce(p_cards, '[]'::jsonb))
    as x(card_id bigint, pack_pool_tier_id uuid, rarity_id uuid, is_enabled boolean, weight numeric)
  where x.card_id is not null
    and x.pack_pool_tier_id is not null;

  delete from public.container_pack_slot_tiers
  where container_id in (v_full_id, v_draft_id);

  insert into public.container_pack_slot_tiers (
    container_id,
    slot_index,
    pack_pool_tier_id,
    weight,
    is_enabled
  )
  select
    ids.container_id,
    x.slot_index,
    x.pack_pool_tier_id,
    greatest(coalesce(x.weight, 1), 0.000001),
    coalesce(x.is_enabled, true)
  from (values (v_full_id), (v_draft_id)) as ids(container_id)
  cross join jsonb_to_recordset(coalesce(p_slot_tiers, '[]'::jsonb))
    as x(slot_index integer, pack_pool_tier_id uuid, weight numeric, is_enabled boolean)
  where x.slot_index between 1 and 9
    and x.pack_pool_tier_id is not null
    and coalesce(x.is_enabled, true) = true
    and coalesce(x.weight, 0) > 0;

  perform public._sync_container_opener_item(v_full_id);
  perform public._sync_container_opener_item(v_draft_id);

  return jsonb_build_object(
    'success', true,
    'pack_group_code', v_group_code,
    'full_container_id', v_full_id,
    'draft_container_id', v_draft_id
  );
end;
$function$;

update public.container_cards cc
set
  rarity_id = public._resolve_common_rarity_id(),
  updated_at = now()
from public.containers c
join public.container_types ct on ct.id = c.container_type_id
where c.id = cc.container_id
  and lower(ct.code) in ('full_pack', 'draft_pack')
  and cc.rarity_id is null;

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
  v_selected record;
  v_selected_pack_tier record;
  v_fallback_rarity record;
  v_rolled_rarity jsonb := '{}'::jsonb;
  v_selected_rarity_id uuid;
  v_selected_rarity_code text;
  v_selected_rarity_name text;
  v_pulls jsonb := '[]'::jsonb;
  v_slot_index integer;
  v_has_slotted_rows boolean := false;
  v_has_pack_slot_tiers boolean := false;
begin
  v_actor_id := public._assert_authenticated_user();

  select
    pi.id, pi.user_id, pi.series_id, pi.quantity, pi.locked_quantity,
    i.id as item_definition_id, i.name as item_name, i.behavior_code, i.target_kind, i.target_id
  into v_inventory
  from public.player_inventory pi
  join public.item_definitions i on i.id = pi.item_definition_id
  where pi.id = p_inventory_id
  for update;

  if not found then raise exception 'Inventory item not found'; end if;
  if v_inventory.user_id <> v_actor_id then raise exception 'You do not own this opener'; end if;
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
    c.id, c.name, c.description, c.code, c.card_count, c.cards_per_open, ct.code as container_type_code
  into v_container
  from public.containers c
  join public.container_types ct on ct.id = c.container_type_id
  where c.id = v_inventory.target_id
    and coalesce(c.is_enabled, true) = true;

  if not found then raise exception 'Container not found or is disabled'; end if;

  select r.id, r.code, r.name
  into v_fallback_rarity
  from public.card_rarities r
  where r.id = public._resolve_common_rarity_id();

  v_cards_per_open := greatest(coalesce(v_container.cards_per_open, v_container.card_count, 1), 1);

  select exists (
    select 1
    from public.container_cards cc
    where cc.container_id = v_container.id
      and coalesce(cc.is_enabled, true) = true
      and cc.slot_index is not null
  ) into v_has_slotted_rows;

  select exists (
    select 1
    from public.container_pack_slot_tiers cps
    where cps.container_id = v_container.id
      and coalesce(cps.is_enabled, true) = true
  ) into v_has_pack_slot_tiers;

  if lower(coalesce(v_container.container_type_code, '')) in ('full_pack', 'draft_pack')
     and v_has_pack_slot_tiers then
    for v_slot_index in 1..v_cards_per_open loop
      select cps.pack_pool_tier_id, ppt.code as tier_code, ppt.name as tier_name
      into v_selected_pack_tier
      from public.container_pack_slot_tiers cps
      join public.pack_pool_tiers ppt on ppt.id = cps.pack_pool_tier_id
      where cps.container_id = v_container.id
        and cps.slot_index = v_slot_index
        and coalesce(cps.is_enabled, true) = true
      order by -ln(greatest(random(), 0.000001)) /
        greatest(coalesce(cps.weight, 1)::double precision, 0.000001)
      limit 1;

      if v_selected_pack_tier.pack_pool_tier_id is null then
        raise exception 'Pack slot % has no eligible tier pools configured', v_slot_index;
      end if;

      select
        cc.card_id,
        c.name as card_name,
        c.image_url,
        v_selected_pack_tier.pack_pool_tier_id as tier_id,
        v_selected_pack_tier.tier_code,
        v_selected_pack_tier.tier_name,
        cc.rarity_id,
        coalesce(r.code, v_fallback_rarity.code) as rarity_code,
        coalesce(r.name, v_fallback_rarity.name) as rarity_name
      into v_selected
      from public.container_cards cc
      join public.cards c on c.id = cc.card_id
      left join public.card_rarities r on r.id = cc.rarity_id
      where cc.container_id = v_container.id
        and coalesce(cc.is_enabled, true) = true
        and cc.pack_pool_tier_id = v_selected_pack_tier.pack_pool_tier_id
      order by -ln(greatest(random(), 0.000001)) /
        greatest(coalesce(cc.weight, 1)::double precision, 0.000001)
      limit 1;

      if v_selected.card_id is null then
        raise exception 'Pack slot % has no eligible cards in % tier', v_slot_index, v_selected_pack_tier.tier_name;
      end if;

      v_selected_rarity_id := coalesce(v_selected.rarity_id, v_fallback_rarity.id);
      v_selected_rarity_code := coalesce(v_selected.rarity_code, v_fallback_rarity.code);
      v_selected_rarity_name := coalesce(v_selected.rarity_name, v_fallback_rarity.name);

      insert into public.binder_cards (user_id, series_id, card_id, rarity_id, quantity, is_trade_locked)
      values (
        v_actor_id,
        v_inventory.series_id,
        v_selected.card_id,
        v_selected_rarity_id,
        1,
        false
      )
      on conflict (user_id, series_id, card_id, rarity_id)
      do update set quantity = public.binder_cards.quantity + 1, updated_at = now();

      v_pulls := v_pulls || jsonb_build_array(jsonb_build_object(
        'card_id', v_selected.card_id,
        'card_name', v_selected.card_name,
        'image_url', v_selected.image_url,
        'tier_id', v_selected.tier_id,
        'tier_code', v_selected.tier_code,
        'tier_name', v_selected.tier_name,
        'rarity_id', v_selected_rarity_id,
        'rarity_code', v_selected_rarity_code,
        'rarity_name', v_selected_rarity_name,
        'slot_index', v_slot_index
      ));
    end loop;
  elsif lower(coalesce(v_container.container_type_code, '')) in ('full_pack', 'draft_pack') then
    for v_slot_index in 1..v_cards_per_open loop
      select
        cc.card_id,
        c.name as card_name,
        c.image_url,
        cc.tier_id,
        coalesce(t.code, 'tier') as tier_code,
        coalesce(t.name, 'Unknown Tier') as tier_name,
        cc.rarity_id,
        coalesce(r.code, v_fallback_rarity.code) as rarity_code,
        coalesce(r.name, v_fallback_rarity.name) as rarity_name,
        cc.slot_index
      into v_selected
      from public.container_cards cc
      join public.cards c on c.id = cc.card_id
      left join public.card_tiers t on t.id = cc.tier_id
      left join public.card_rarities r on r.id = cc.rarity_id
      where cc.container_id = v_container.id
        and coalesce(cc.is_enabled, true) = true
        and (
          not v_has_slotted_rows
          or cc.slot_index = v_slot_index
          or (
            cc.slot_index is null and not exists (
              select 1
              from public.container_cards slot_rows
              where slot_rows.container_id = v_container.id
                and coalesce(slot_rows.is_enabled, true) = true
                and slot_rows.slot_index = v_slot_index
            )
          )
        )
      order by -ln(greatest(random(), 0.000001)) /
        greatest(coalesce(cc.weight, 1)::double precision, 0.000001)
      limit 1;

      if v_selected.card_id is null then
        raise exception 'Pack slot % has no eligible cards configured', v_slot_index;
      end if;

      v_selected_rarity_id := coalesce(v_selected.rarity_id, v_fallback_rarity.id);
      v_selected_rarity_code := coalesce(v_selected.rarity_code, v_fallback_rarity.code);
      v_selected_rarity_name := coalesce(v_selected.rarity_name, v_fallback_rarity.name);

      insert into public.binder_cards (user_id, series_id, card_id, rarity_id, quantity, is_trade_locked)
      values (
        v_actor_id,
        v_inventory.series_id,
        v_selected.card_id,
        v_selected_rarity_id,
        1,
        false
      )
      on conflict (user_id, series_id, card_id, rarity_id)
      do update set quantity = public.binder_cards.quantity + 1, updated_at = now();

      v_pulls := v_pulls || jsonb_build_array(jsonb_build_object(
        'card_id', v_selected.card_id,
        'card_name', v_selected.card_name,
        'image_url', v_selected.image_url,
        'tier_id', v_selected.tier_id,
        'tier_code', v_selected.tier_code,
        'tier_name', v_selected.tier_name,
        'rarity_id', v_selected_rarity_id,
        'rarity_code', v_selected_rarity_code,
        'rarity_name', v_selected_rarity_name,
        'slot_index', coalesce(v_selected.slot_index, v_slot_index)
      ));
    end loop;
  else
    select
      cc.card_id,
      c.name as card_name,
      c.image_url,
      cc.tier_id,
      coalesce(t.code, 'tier') as tier_code,
      coalesce(t.name, 'Unknown Tier') as tier_name
    into v_selected
    from public.container_cards cc
    join public.cards c on c.id = cc.card_id
    left join public.card_tiers t on t.id = cc.tier_id
    where cc.container_id = v_container.id
      and coalesce(cc.is_enabled, true) = true
    order by -ln(greatest(random(), 0.000001)) /
      greatest(coalesce(cc.weight, 1)::double precision, 0.000001)
    limit 1;

    if v_selected.card_id is null then
      raise exception 'This container has no eligible cards configured';
    end if;

    v_rolled_rarity := public._roll_weighted_card_rarity();
    v_selected_rarity_id := coalesce(nullif(coalesce(v_rolled_rarity ->> 'id', ''), '')::uuid, v_fallback_rarity.id);
    v_selected_rarity_code := coalesce(nullif(v_rolled_rarity ->> 'code', ''), v_fallback_rarity.code);
    v_selected_rarity_name := coalesce(nullif(v_rolled_rarity ->> 'name', ''), v_fallback_rarity.name);

    insert into public.binder_cards (user_id, series_id, card_id, rarity_id, quantity, is_trade_locked)
    values (
      v_actor_id,
      v_inventory.series_id,
      v_selected.card_id,
      v_selected_rarity_id,
      1,
      false
    )
    on conflict (user_id, series_id, card_id, rarity_id)
    do update set quantity = public.binder_cards.quantity + 1, updated_at = now();

    v_pulls := jsonb_build_array(jsonb_build_object(
      'card_id', v_selected.card_id,
      'card_name', v_selected.card_name,
      'image_url', v_selected.image_url,
      'tier_id', v_selected.tier_id,
      'tier_code', v_selected.tier_code,
      'tier_name', v_selected.tier_name,
      'rarity_id', v_selected_rarity_id,
      'rarity_code', v_selected_rarity_code,
      'rarity_name', v_selected_rarity_name
    ));
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
