begin;

create extension if not exists pgcrypto;

alter table public.player_round_reward_notifications
  add column if not exists notification_kind text;

update public.player_round_reward_notifications
set notification_kind = 'round_reward'
where notification_kind is null
   or trim(coalesce(notification_kind, '')) = '';

alter table public.player_round_reward_notifications
  alter column notification_kind set default 'round_reward';

alter table public.player_round_reward_notifications
  alter column notification_kind set not null;

alter table public.player_round_reward_notifications
  drop constraint if exists player_round_reward_notifications_series_id_user_id_round_number_round_step_key;

alter table public.player_round_reward_notifications
  drop constraint if exists player_round_reward_notifications_notification_kind_check;

alter table public.player_round_reward_notifications
  add constraint player_round_reward_notifications_notification_kind_check
  check (notification_kind in ('round_reward', 'draft_phase'));

create unique index if not exists player_round_reward_notifications_kind_uidx
  on public.player_round_reward_notifications (
    series_id,
    user_id,
    round_number,
    round_step,
    notification_kind
  );

create table if not exists public.series_round_draft_phase_states (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.game_series(id) on delete cascade,
  round_number integer not null,
  round_step integer not null,
  distribution_mode text not null,
  pack_number_code text not null,
  container_id uuid references public.containers(id) on delete set null,
  item_definition_id uuid references public.item_definitions(id) on delete set null,
  key_quantity integer not null default 30,
  payload jsonb not null default '{}'::jsonb,
  distributed_at timestamp with time zone,
  resumed_standby_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (series_id, round_number, round_step)
);

alter table public.series_round_draft_phase_states
  drop constraint if exists series_round_draft_phase_states_distribution_mode_check;

alter table public.series_round_draft_phase_states
  add constraint series_round_draft_phase_states_distribution_mode_check
  check (distribution_mode in ('full', 'draft'));

create index if not exists idx_series_round_draft_phase_states_lookup
  on public.series_round_draft_phase_states (series_id, round_number, round_step);

create or replace function public._format_progression_round_label(
  p_round_number integer,
  p_round_step integer
)
returns text
language sql
immutable
as $function$
  select case
    when coalesce(p_round_number, 0) <= 0 then '0'
    else format('%s-%s', p_round_number, greatest(coalesce(p_round_step, 1), 1))
  end;
$function$;

create or replace function public._create_series_player_notification(
  p_series_id uuid,
  p_user_id uuid,
  p_round_number integer,
  p_round_step integer,
  p_notification_kind text,
  p_payload jsonb,
  p_placement integer default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_notification_id uuid;
begin
  insert into public.player_round_reward_notifications (
    series_id,
    user_id,
    round_number,
    round_step,
    placement,
    notification_kind,
    payload,
    dismissed_at
  )
  values (
    p_series_id,
    p_user_id,
    p_round_number,
    p_round_step,
    p_placement,
    lower(trim(coalesce(p_notification_kind, 'round_reward'))),
    coalesce(p_payload, '{}'::jsonb),
    null
  )
  on conflict (series_id, user_id, round_number, round_step, notification_kind)
  do update set
    placement = excluded.placement,
    payload = excluded.payload,
    dismissed_at = null
  returning id into v_notification_id;

  return v_notification_id;
end;
$function$;

create or replace function public._resolve_progression_round_draft_phase_pack(
  p_round_number integer,
  p_round_step integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_pack_number_code text;
  v_container_type_code text;
  v_distribution_mode text;
  v_container record;
  v_item record;
begin
  if coalesce(p_round_number, 0) <= 0 then
    raise exception 'Draft Phase only exists for normal rounds';
  end if;

  v_pack_number_code := lpad(p_round_number::text, 3, '0');
  v_distribution_mode := case when greatest(coalesce(p_round_step, 1), 1) = 1 then 'full' else 'draft' end;
  v_container_type_code := case when v_distribution_mode = 'full' then 'full_pack' else 'draft_pack' end;

  select
    c.id,
    c.name,
    c.code,
    c.pack_number_code,
    c.pack_type_code,
    ct.code as container_type_code,
    coalesce(nullif(c.artwork_url, ''), nullif(c.image_url, '')) as image_url
  into v_container
  from public.containers c
  join public.container_types ct
    on ct.id = c.container_type_id
  where ct.code = v_container_type_code
    and lower(coalesce(c.pack_type_code, '')) = 'tcg'
    and trim(coalesce(c.pack_number_code, '')) = v_pack_number_code
  order by
    coalesce(c.is_enabled, true) desc,
    coalesce(c.is_locked, false) asc,
    c.updated_at desc,
    c.created_at desc
  limit 1;

  if v_container.id is null then
    raise exception 'No TCG % exists for round pack number %', v_container_type_code, v_pack_number_code;
  end if;

  select
    i.id,
    i.name,
    i.code
  into v_item
  from public.item_definitions i
  where i.behavior_code = 'open_container'
    and coalesce(i.target_kind, '') = 'container'
    and i.target_id = v_container.id
    and coalesce(i.is_active, true) = true
  order by i.updated_at desc, i.created_at desc
  limit 1;

  if v_item.id is null then
    raise exception 'No exact key item exists for draft phase container %', v_container.name;
  end if;

  return jsonb_build_object(
    'distribution_mode', v_distribution_mode,
    'pack_number_code', v_pack_number_code,
    'container_id', v_container.id,
    'container_name', v_container.name,
    'container_code', v_container.code,
    'container_type_code', v_container.container_type_code,
    'image_url', v_container.image_url,
    'item_definition_id', v_item.id,
    'item_name', v_item.name,
    'item_code', v_item.code
  );
end;
$function$;

create or replace function public._open_round_reward_feature_picker_session(
  p_series_id uuid,
  p_user_id uuid,
  p_selected_category text,
  p_notification_id uuid default null
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

  perform public._assert_series_member(p_series_id, p_user_id);

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

  if found
     and coalesce(v_existing_session.metadata ->> 'round_reward_notification_id', '') = coalesce(p_notification_id::text, '')
     and coalesce(v_existing_session.selected_category, '') = v_category then
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
      'round_reward_notification_id', p_notification_id,
      'round_reward_feature_picker', true
    )
  )
  returning id into v_session_id;

  return v_session_id;
end;
$function$;

create or replace function public._get_round_reward_first_place_promo_box_id(
  p_series_id uuid,
  p_round_number integer,
  p_round_step integer
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_container_id uuid;
begin
  select nullif(option_snapshot ->> 'container_id', '')::uuid
  into v_container_id
  from public.player_round_reward_notifications notification_rows
  join public.player_round_reward_choice_entries choice_rows
    on choice_rows.notification_id = notification_rows.id
  cross join lateral jsonb_array_elements(coalesce(choice_rows.claim_results, '[]'::jsonb)) claim_result
  cross join lateral jsonb_array_elements(coalesce(choice_rows.option_snapshots, '[]'::jsonb)) option_snapshot
  where notification_rows.series_id = p_series_id
    and notification_rows.round_number = p_round_number
    and notification_rows.round_step = p_round_step
    and notification_rows.notification_kind = 'round_reward'
    and notification_rows.placement = 1
    and (claim_result ->> 'option_id')::uuid = (option_snapshot ->> 'id')::uuid
    and lower(coalesce(option_snapshot ->> 'option_kind', '')) = 'promo_box'
  order by choice_rows.entry_order
  limit 1;

  return v_container_id;
end;
$function$;

create or replace function public._grant_round_reward_random_active_deck_steal(
  p_series_id uuid,
  p_user_id uuid,
  p_actor_id uuid,
  p_notes_prefix text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_target_user_id uuid;
  v_target_username text;
  v_target_deck_id uuid;
  v_card_id bigint;
  v_card_name text;
  v_binder_row_id uuid;
  v_rarity_name text;
begin
  select
    d.user_id,
    d.id,
    coalesce(spv.username, 'Player')
  into v_target_user_id, v_target_deck_id, v_target_username
  from public.player_decks d
  left join public.series_players_view spv
    on spv.series_id = d.series_id
   and spv.user_id = d.user_id
  where d.series_id = p_series_id
    and d.is_active = true
    and d.user_id <> p_user_id
    and exists (
      select 1
      from public.player_deck_cards pdc
      where pdc.deck_id = d.id
        and pdc.quantity > 0
        and exists (
          select 1
          from public.binder_cards bc
          where bc.user_id = d.user_id
            and bc.series_id = p_series_id
            and bc.card_id = pdc.card_id
            and bc.quantity > 0
            and not exists (
              select 1
              from public.player_card_vault_entries vault
              where vault.user_id = d.user_id
                and vault.series_id = p_series_id
                and vault.card_id = pdc.card_id
            )
        )
    )
  order by random()
  limit 1;

  if v_target_deck_id is null then
    return jsonb_build_array(
      jsonb_build_object(
        'kind', 'card',
        'label', 'Deck Steal',
        'value', 'No eligible opponent deck was available'
      )
    );
  end if;

  select
    pdc.card_id,
    cards.name
  into v_card_id, v_card_name
  from public.player_deck_cards pdc
  join public.cards
    on cards.id = pdc.card_id
  where pdc.deck_id = v_target_deck_id
    and pdc.quantity > 0
    and exists (
      select 1
      from public.binder_cards bc
      where bc.user_id = v_target_user_id
        and bc.series_id = p_series_id
        and bc.card_id = pdc.card_id
        and bc.quantity > 0
        and not exists (
          select 1
          from public.player_card_vault_entries vault
          where vault.user_id = v_target_user_id
            and vault.series_id = p_series_id
            and vault.card_id = pdc.card_id
        )
    )
  order by random()
  limit 1;

  if v_card_id is null then
    return jsonb_build_array(
      jsonb_build_object(
        'kind', 'card',
        'label', 'Deck Steal',
        'value', 'No stealable deck card was available'
      )
    );
  end if;

  select
    bc.id,
    coalesce(r.name, 'Base')
  into v_binder_row_id, v_rarity_name
  from public.binder_cards bc
  left join public.card_rarities r
    on r.id = bc.rarity_id
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
  order by coalesce(r.sort_order, 9999) asc, bc.created_at asc
  limit 1
  for update;

  if v_binder_row_id is null then
    return jsonb_build_array(
      jsonb_build_object(
        'kind', 'card',
        'label', 'Deck Steal',
        'value', 'The selected deck card was no longer transferable'
      )
    );
  end if;

  perform public._transfer_binder_cards(v_binder_row_id, p_user_id, 1, false);
  perform public._revalidate_active_deck(p_series_id, v_target_user_id);

  return jsonb_build_array(
    jsonb_build_object(
      'kind', 'card',
      'label', coalesce(v_card_name, 'Unknown Card'),
      'value', format('Stolen from %s', coalesce(v_target_username, 'Player')),
      'card_id', v_card_id,
      'rarity_name', coalesce(v_rarity_name, 'Base')
    )
  );
end;
$function$;

create or replace function public._grant_series_reward_option_json(
  p_series_id uuid,
  p_user_id uuid,
  p_actor_id uuid,
  p_notes_prefix text,
  p_option_json jsonb,
  p_notification_id uuid default null,
  p_notification_round_number integer default null,
  p_notification_round_step integer default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_option_kind text := lower(trim(coalesce(p_option_json ->> 'option_kind', '')));
  v_pool_item_ids uuid[] := '{}'::uuid[];
  v_basic_grants jsonb := '[]'::jsonb;
  v_container_id uuid;
  v_container record;
  v_card_id bigint;
  v_card_name text;
  v_open_count integer := greatest(coalesce((p_option_json ->> 'open_count')::integer, 1), 1);
  v_open_result jsonb := '{}'::jsonb;
  v_session_id uuid;
  v_selected_category text;
  v_reserved_promo_id uuid;
begin
  if v_option_kind in ('shards', 'feature_coins', 'specific_item', 'random_item') then
    select coalesce(array_agg(value::uuid), '{}'::uuid[])
    into v_pool_item_ids
    from jsonb_array_elements_text(coalesce(p_option_json -> 'pool_item_ids', '[]'::jsonb));

    v_basic_grants := public._grant_round_reward_option(
      p_series_id,
      p_user_id,
      p_actor_id,
      p_notes_prefix,
      lower(trim(coalesce(p_option_json ->> 'reward_kind', 'set'))),
      v_option_kind,
      coalesce((p_option_json ->> 'exact_quantity')::integer, 0),
      coalesce((p_option_json ->> 'quantity_min')::integer, 0),
      coalesce((p_option_json ->> 'quantity_max')::integer, 0),
      nullif(p_option_json ->> 'item_definition_id', '')::uuid,
      v_pool_item_ids
    );

    return coalesce(v_basic_grants, '[]'::jsonb);
  end if;

  if v_option_kind in ('promo_box', 'deck_box') then
    v_container_id := nullif(coalesce(p_option_json ->> 'container_id', ''), '')::uuid;

    if v_container_id is null then
      raise exception 'Choose a valid box reward';
    end if;

    select
      c.id,
      c.name,
      ct.code as container_type_code
    into v_container
    from public.containers c
    join public.container_types ct
      on ct.id = c.container_type_id
    where c.id = v_container_id
      and coalesce(c.is_enabled, true) = true
      and coalesce(c.is_locked, false) = false
    limit 1;

    if v_container.id is null then
      raise exception 'Selected reward box is not available';
    end if;

    if v_option_kind = 'promo_box' and v_container.container_type_code <> 'promo_box' then
      raise exception 'Choose a Promo Box reward';
    end if;

    if v_option_kind = 'deck_box' and v_container.container_type_code <> 'deck_box' then
      raise exception 'Choose a Deck Box reward';
    end if;

    if coalesce((p_option_json ->> 'exclude_first_place_pick')::boolean, false) then
      v_reserved_promo_id := public._get_round_reward_first_place_promo_box_id(
        p_series_id,
        coalesce(p_notification_round_number, 0),
        coalesce(p_notification_round_step, 0)
      );

      if v_reserved_promo_id is null then
        raise exception '1st place must claim their Promo Box before this reward can be resolved';
      end if;

      if v_reserved_promo_id = v_container_id then
        raise exception 'That Promo Box was already chosen by 1st place';
      end if;
    end if;

    v_open_result := public._open_box_direct_batch_for_user(
      p_series_id,
      p_user_id,
      v_container_id,
      v_open_count
    );

    return (
      select coalesce(
        jsonb_build_array(
          jsonb_build_object(
            'kind', 'box_open',
            'label', coalesce(v_container.name, 'Box Reward'),
            'value', format('%sx opened', v_open_count),
            'container_id', v_container.id,
            'container_type_code', v_container.container_type_code,
            'open_result', v_open_result
          )
        ) || coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'kind', 'card',
                'label', coalesce(pull ->> 'card_name', 'Unknown Card'),
                'value', coalesce(pull ->> 'rarity_name', 'Base'),
                'card_id', nullif(pull ->> 'card_id', '')::bigint
              )
            )
            from jsonb_array_elements(coalesce(v_open_result -> 'openings', '[]'::jsonb)) opening_row,
                 jsonb_array_elements(coalesce(opening_row -> 'pulls', '[]'::jsonb)) pull
          ),
          '[]'::jsonb
        ),
        '[]'::jsonb
      )
    );
  end if;

  if v_option_kind = 'banlist_card' then
    v_card_id := nullif(coalesce(p_option_json ->> 'card_id', ''), '')::bigint;

    if v_card_id is null then
      raise exception 'Choose a valid Ban List card reward';
    end if;

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
      raise exception 'That Ban List card is no longer eligible';
    end if;

    perform public._feature_slot_grant_card(p_series_id, p_user_id, v_card_id, null);

    return jsonb_build_array(
      jsonb_build_object(
        'kind', 'card',
        'label', v_card_name,
        'value', 'Base',
        'card_id', v_card_id
      )
    );
  end if;

  if v_option_kind = 'feature_picker' then
    v_selected_category := lower(trim(coalesce(p_option_json ->> 'category', '')));

    v_session_id := public._open_round_reward_feature_picker_session(
      p_series_id,
      p_user_id,
      v_selected_category,
      p_notification_id
    );

    return jsonb_build_array(
      jsonb_build_object(
        'kind', 'feature_reward',
        'label', coalesce(p_option_json ->> 'label', 'Feature Reward'),
        'value', 'Visit Feature Slots to claim',
        'session_id', v_session_id,
        'category', v_selected_category
      )
    );
  end if;

  if v_option_kind = 'deck_steal_random' then
    return public._grant_round_reward_random_active_deck_steal(
      p_series_id,
      p_user_id,
      p_actor_id,
      p_notes_prefix
    );
  end if;

  raise exception 'Unsupported fixed reward option kind: %', coalesce(v_option_kind, 'null');
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

    v_claim_grants := public._grant_series_reward_option_json(
      v_notification.series_id,
      v_notification.user_id,
      v_actor_id,
      format(
        '%s:%s:%s:%s',
        coalesce(v_notification.notification_kind, 'round_reward'),
        v_notification.round_number,
        v_notification.round_step,
        v_choice_entry.entry_order
      ),
      v_option_json,
      v_notification.id,
      v_notification.round_number,
      v_notification.round_step
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

create or replace function public._process_series_round_rewards(p_series_id uuid, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_series record;
  v_result record;
  v_actor_id uuid;
  v_processed_count integer := 0;
  v_error_count integer := 0;
  v_grants jsonb;
  v_round_label text;
  v_scoreboard jsonb;
  v_reward_error_message text;
  v_notification_id uuid;
  v_option_snapshots jsonb;
  v_pending_choice_count integer;
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
  v_round_label := public._format_progression_round_label(v_series.round_number, v_series.round_step_value);

  if coalesce(v_series.round_number, 0) <= 0 then
    return jsonb_build_object(
      'success', true,
      'processed_count', 0,
      'error_count', 0,
      'skipped', 'round_zero'
    );
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
      from public.player_round_reward_notifications notification_rows
      where notification_rows.series_id = p_series_id
        and notification_rows.user_id = v_result.user_id
        and notification_rows.round_number = v_series.round_number
        and notification_rows.round_step = v_series.round_step_value
        and notification_rows.notification_kind = 'round_reward'
    ) then
      v_processed_count := v_processed_count + 1;
      continue;
    end if;

    v_grants := '[]'::jsonb;
    v_pending_choice_count := 0;
    v_reward_error_message := null;

    begin
      if v_result.placement = 1 then
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'id', gen_random_uuid(),
              'option_kind', 'promo_box',
              'container_id', c.id,
              'label', c.name,
              'choice_group_label', 'Choose 1 Promo Box',
              'open_count', 1
            )
            order by c.box_number_code, c.code, c.name
          ),
          '[]'::jsonb
        )
        into v_option_snapshots
        from public.containers c
        join public.container_types ct
          on ct.id = c.container_type_id
        where ct.code = 'promo_box'
          and coalesce(c.is_enabled, true) = true
          and coalesce(c.is_locked, false) = false;

        if jsonb_array_length(v_option_snapshots) <= 0 then
          raise exception 'No unlocked Promo Boxes are available for 1st place rewards';
        end if;

        v_pending_choice_count := 1;
      elsif v_result.placement = 2 then
        if public._feature_phase_picker_slot_id() is null then
          raise exception 'Picker Feature Slot Machine is not configured for 2nd place rewards';
        end if;

        select jsonb_agg(
          jsonb_build_object(
            'id', gen_random_uuid(),
            'option_kind', 'feature_picker',
            'category', choice_rows.category,
            'label', choice_rows.label,
            'choice_group_label', 'Choose 1 Feature Reward'
          )
          order by choice_rows.sort_order
        )
        into v_option_snapshots
        from (
          values
            ('monster', 'Monster Feature Reward', 0),
            ('spell', 'Spell Feature Reward', 1),
            ('trap', 'Trap Feature Reward', 2),
            ('extra', 'Extra Deck Feature Reward', 3)
        ) as choice_rows(category, label, sort_order);

        v_pending_choice_count := 1;
      elsif v_result.placement = 3 then
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'id', gen_random_uuid(),
              'option_kind', 'banlist_card',
              'card_id', b.card_id,
              'label', cards.name,
              'choice_group_label', 'Choose 1 Ban List Card'
            )
            order by cards.name asc
          ),
          '[]'::jsonb
        )
        into v_option_snapshots
        from public.series_banlist_cards b
        join public.cards
          on cards.id = b.card_id
        where b.series_id = p_series_id
          and b.status in ('forbidden', 'limited', 'semi_limited');

        if jsonb_array_length(v_option_snapshots) <= 0 then
          raise exception 'No Ban List cards are available for 3rd place rewards';
        end if;

        v_pending_choice_count := 1;
      elsif v_result.placement = 4 then
        v_grants := public._grant_series_reward_option_json(
          p_series_id,
          v_result.user_id,
          v_actor_id,
          format('round_reward:%s:%s:%s', v_series.round_number, v_series.round_step_value, v_result.placement),
          jsonb_build_object(
            'option_kind', 'deck_steal_random',
            'label', 'Random Active Deck Steal'
          ),
          null,
          v_series.round_number,
          v_series.round_step_value
        );
      elsif v_result.placement = 5 then
        v_pending_choice_count := 2;
      elsif v_result.placement = 6 then
        v_grants := public._grant_series_reward_option_json(
          p_series_id,
          v_result.user_id,
          v_actor_id,
          format('round_reward:%s:%s:%s', v_series.round_number, v_series.round_step_value, v_result.placement),
          jsonb_build_object(
            'option_kind', 'shards',
            'reward_kind', 'set',
            'exact_quantity', 100
          ),
          null,
          v_series.round_number,
          v_series.round_step_value
        );
      end if;

      update public.series_round_results
      set shards_awarded = coalesce((
        select sum(
          case
            when grant_row ->> 'kind' = 'shards' then (grant_row ->> 'value')::integer
            else 0
          end
        )
        from jsonb_array_elements(coalesce(v_grants, '[]'::jsonb)) grant_row
      ), 0)
      where id = v_result.id;

      v_scoreboard := public._build_series_scoreboard_json(p_series_id);

      v_notification_id := public._create_series_player_notification(
        p_series_id,
        v_result.user_id,
        v_series.round_number,
        v_series.round_step_value,
        'round_reward',
        jsonb_build_object(
          'notification_kind', 'round_reward',
          'round_label', v_round_label,
          'placement', v_result.placement,
          'points_awarded', v_result.score_awarded,
          'grants', coalesce(v_grants, '[]'::jsonb),
          'scoreboard', v_scoreboard,
          'grant_status', 'complete',
          'has_pending_choices', v_pending_choice_count > 0
        ),
        v_result.placement
      );

      if v_result.placement in (1, 2, 3) then
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
          null,
          1,
          1,
          1,
          v_option_snapshots,
          '[]'::jsonb
        );
      elsif v_result.placement = 5 then
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'id', gen_random_uuid(),
              'option_kind', 'promo_box',
              'container_id', c.id,
              'label', c.name,
              'choice_group_label', 'Choose 1 Promo Box',
              'exclude_first_place_pick', true,
              'open_count', 1
            )
            order by c.box_number_code, c.code, c.name
          ),
          '[]'::jsonb
        )
        into v_option_snapshots
        from public.containers c
        join public.container_types ct
          on ct.id = c.container_type_id
        where ct.code = 'promo_box'
          and coalesce(c.is_enabled, true) = true
          and coalesce(c.is_locked, false) = false;

        if jsonb_array_length(v_option_snapshots) <= 0 then
          raise exception 'No unlocked Promo Boxes are available for 5th place rewards';
        end if;

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
          null,
          1,
          1,
          1,
          v_option_snapshots,
          '[]'::jsonb
        );

        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'id', gen_random_uuid(),
              'option_kind', 'deck_box',
              'container_id', c.id,
              'label', c.name,
              'choice_group_label', 'Choose 1 Deck Box',
              'open_count', 1
            )
            order by c.box_number_code, c.code, c.name
          ),
          '[]'::jsonb
        )
        into v_option_snapshots
        from public.containers c
        join public.container_types ct
          on ct.id = c.container_type_id
        where ct.code = 'deck_box'
          and coalesce(c.is_enabled, true) = true
          and coalesce(c.is_locked, false) = false;

        if jsonb_array_length(v_option_snapshots) <= 0 then
          raise exception 'No unlocked Deck Boxes are available for 5th place rewards';
        end if;

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
          null,
          2,
          1,
          1,
          v_option_snapshots,
          '[]'::jsonb
        );
      end if;

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

        perform public._create_series_player_notification(
          p_series_id,
          v_result.user_id,
          v_series.round_number,
          v_series.round_step_value,
          'round_reward',
          jsonb_build_object(
            'notification_kind', 'round_reward',
            'round_label', v_round_label,
            'placement', v_result.placement,
            'points_awarded', v_result.score_awarded,
            'grants', coalesce(v_grants, '[]'::jsonb),
            'scoreboard', v_scoreboard,
            'grant_status', 'manual_fix_required',
            'error_message', v_reward_error_message
          ),
          v_result.placement
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

create or replace function public._distribute_series_round_draft_phase_keys(p_series_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_series record;
  v_state record;
  v_pack_payload jsonb := '{}'::jsonb;
  v_distribution_mode text;
  v_pack_number_code text;
  v_container_id uuid;
  v_item_definition_id uuid;
  v_item_name text;
  v_key_quantity integer := 30;
  v_player record;
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

  if coalesce(v_series.round_number, 0) <= 0 then
    raise exception 'Draft Phase distribution is only used during normal rounds';
  end if;

  insert into public.series_round_draft_phase_states (
    series_id,
    round_number,
    round_step,
    distribution_mode,
    pack_number_code,
    key_quantity
  )
  values (
    p_series_id,
    v_series.round_number,
    v_series.round_step_value,
    case when v_series.round_step_value = 1 then 'full' else 'draft' end,
    lpad(v_series.round_number::text, 3, '0'),
    v_key_quantity
  )
  on conflict (series_id, round_number, round_step) do nothing;

  select *
  into v_state
  from public.series_round_draft_phase_states state_rows
  where state_rows.series_id = p_series_id
    and state_rows.round_number = v_series.round_number
    and state_rows.round_step = v_series.round_step_value
  for update;

  if v_state.distributed_at is null then
    v_pack_payload := public._resolve_progression_round_draft_phase_pack(
      v_series.round_number,
      v_series.round_step_value
    );

    v_distribution_mode := coalesce(v_pack_payload ->> 'distribution_mode', v_state.distribution_mode);
    v_pack_number_code := coalesce(v_pack_payload ->> 'pack_number_code', v_state.pack_number_code);
    v_container_id := nullif(coalesce(v_pack_payload ->> 'container_id', ''), '')::uuid;
    v_item_definition_id := nullif(coalesce(v_pack_payload ->> 'item_definition_id', ''), '')::uuid;
    v_item_name := coalesce(v_pack_payload ->> 'item_name', 'Draft Phase Key');

    update public.series_round_draft_phase_states
    set
      distribution_mode = v_distribution_mode,
      pack_number_code = v_pack_number_code,
      container_id = v_container_id,
      item_definition_id = v_item_definition_id,
      payload = v_pack_payload,
      distributed_at = now(),
      updated_at = now()
    where id = v_state.id
    returning * into v_state;

    for v_player in
      select sp.user_id
      from public.series_players sp
      where sp.series_id = p_series_id
    loop
      perform public._grant_series_item(
        p_series_id,
        v_player.user_id,
        v_item_definition_id,
        v_key_quantity,
        coalesce(auth.uid(), v_series.created_by),
        format('draft_phase:%s:%s:round_keys', v_series.round_number, v_series.round_step_value)
      );

      perform public._create_series_player_notification(
        p_series_id,
        v_player.user_id,
        v_series.round_number,
        v_series.round_step_value,
        'draft_phase',
        jsonb_build_object(
          'notification_kind', 'draft_phase',
          'kicker', 'DRAFT PHASE',
          'title', format('Round %s Draft Keys', public._format_progression_round_label(v_series.round_number, v_series.round_step_value)),
          'round_label', public._format_progression_round_label(v_series.round_number, v_series.round_step_value),
          'description',
            format(
              'You received %s %s for %s. Use the Container Opener page, then ready up again when you are finished.',
              v_key_quantity,
              case when v_distribution_mode = 'draft' then 'Draft Pack Keys' else 'Pack Keys' end,
              coalesce(v_pack_payload ->> 'container_name', 'this round')
            ),
          'grants',
            jsonb_build_array(
              jsonb_build_object(
                'kind', 'item',
                'label', v_item_name,
                'value', v_key_quantity,
                'item_definition_id', v_item_definition_id
              )
            ),
          'has_pending_choices', false,
          'grant_status', 'complete',
          'draft_phase',
            jsonb_build_object(
              'distribution_mode', v_distribution_mode,
              'pack_number_code', v_pack_number_code,
              'container_id', v_container_id,
              'container_name', coalesce(v_pack_payload ->> 'container_name', ''),
              'container_code', coalesce(v_pack_payload ->> 'container_code', ''),
              'container_type_code', coalesce(v_pack_payload ->> 'container_type_code', ''),
              'image_url', coalesce(v_pack_payload ->> 'image_url', ''),
              'key_quantity', v_key_quantity
            )
        ),
        null
      );
    end loop;
  end if;

  delete from public.series_phase_ready_states rs
  where rs.series_id = p_series_id
    and rs.round_number = v_series.round_number
    and rs.round_step = v_series.round_step_value
    and rs.phase = 'standby';

  update public.game_series
  set
    current_phase = 'standby',
    updated_at = now()
  where id = p_series_id
  returning *
  into v_series;

  update public.series_round_draft_phase_states
  set
    resumed_standby_at = now(),
    updated_at = now()
  where id = v_state.id
  returning * into v_state;

  return jsonb_build_object(
    'success', true,
    'current_phase', v_series.current_phase,
    'round_number', v_series.round_number,
    'round_step', v_series.round_step,
    'distribution_mode', v_state.distribution_mode,
    'pack_number_code', v_state.pack_number_code,
    'container_id', v_state.container_id,
    'item_definition_id', v_state.item_definition_id,
    'key_quantity', v_state.key_quantity
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
        when exists (
          select 1
          from public.series_round_draft_phase_states draft_state
          where draft_state.series_id = p_series_id
            and draft_state.round_number = v_series.round_number
            and draft_state.round_step = v_series.round_step_value
            and draft_state.distributed_at is not null
        ) then 'deckbuilding'
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

    perform public._distribute_series_round_draft_phase_keys(p_series_id);

    select *
    into v_series
    from public.game_series gs
    where gs.id = p_series_id;

    v_auto_advanced := true;
  elsif v_series.current_phase = 'draft' then
    perform public._distribute_series_round_draft_phase_keys(p_series_id);

    select *
    into v_series
    from public.game_series gs
    where gs.id = p_series_id;

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
        when exists (
          select 1
          from public.series_round_draft_phase_states draft_state
          where draft_state.series_id = p_series_id
            and draft_state.round_number = v_series.round_number
            and draft_state.round_step = v_round_step_value
            and draft_state.distributed_at is not null
        ) then 'deckbuilding'
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

    perform public._distribute_series_round_draft_phase_keys(p_series_id);

    select *
    into v_series
    from public.game_series gs
    where gs.id = p_series_id;
  elsif v_series.current_phase = 'draft' then
    if not p_force and v_player_count > 0 and v_ready_count < v_player_count then
      raise exception 'Not all players are ready to leave Draft Phase';
    end if;

    perform public._distribute_series_round_draft_phase_keys(p_series_id);

    select *
    into v_series
    from public.game_series gs
    where gs.id = p_series_id;
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

  perform public._distribute_series_round_draft_phase_keys(p_series_id);
end;
$function$;

commit;
