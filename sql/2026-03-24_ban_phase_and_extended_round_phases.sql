begin;

create extension if not exists pgcrypto;

alter table public.series_banlist_cards
  add column if not exists source_kind text,
  add column if not exists source_round_number integer,
  add column if not exists source_round_step integer,
  add column if not exists modified_round_number integer,
  add column if not exists modified_round_step integer,
  add column if not exists modified_by_user_id uuid references auth.users (id) on delete set null;

update public.series_banlist_cards
set source_kind = 'era'
where source_kind is null;

alter table public.series_banlist_cards
  alter column source_kind set default 'era';

do $$
begin
  if exists (
    select 1
    from public.series_banlist_cards
    where source_kind is null
  ) then
    raise exception 'series_banlist_cards.source_kind still contains null values';
  end if;
end;
$$;

alter table public.series_banlist_cards
  alter column source_kind set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'series_banlist_cards_source_kind_check'
      and conrelid = 'public.series_banlist_cards'::regclass
  ) then
    alter table public.series_banlist_cards
      add constraint series_banlist_cards_source_kind_check
      check (source_kind in ('era', 'custom', 'system'));
  end if;
end;
$$;

create index if not exists idx_series_banlist_cards_series_source
  on public.series_banlist_cards (series_id, source_kind, status);

create index if not exists idx_series_banlist_cards_modified_round
  on public.series_banlist_cards (series_id, modified_round_number, modified_round_step);

create table if not exists public.series_round_ban_phase_states (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.game_series (id) on delete cascade,
  round_number integer not null,
  round_step integer not null,
  system_bans_generated_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (series_id, round_number, round_step)
);

create table if not exists public.series_round_ban_phase_turns (
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
  selected_card_id bigint,
  reward_item_definition_id uuid references public.item_definitions (id) on delete set null,
  reward_granted boolean not null default false,
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
    where conname = 'series_round_ban_phase_turns_choice_option_check'
      and conrelid = 'public.series_round_ban_phase_turns'::regclass
  ) then
    alter table public.series_round_ban_phase_turns
      add constraint series_round_ban_phase_turns_choice_option_check
      check (
        choice_option is null
        or choice_option in ('forbidden', 'limited', 'semi_limited', 'unlimited', 'pass')
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'series_round_ban_phase_turns_choice_source_check'
      and conrelid = 'public.series_round_ban_phase_turns'::regclass
  ) then
    alter table public.series_round_ban_phase_turns
      add constraint series_round_ban_phase_turns_choice_source_check
      check (
        choice_source is null
        or choice_source in ('manual', 'automatic')
      );
  end if;
end;
$$;

create index if not exists idx_series_round_ban_phase_turns_lookup
  on public.series_round_ban_phase_turns (series_id, round_number, round_step, turn_order);

create table if not exists public.series_round_ban_phase_system_bans (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.game_series (id) on delete cascade,
  round_number integer not null,
  round_step integer not null,
  target_user_id uuid not null references auth.users (id) on delete cascade,
  deck_id uuid references public.player_decks (id) on delete set null,
  card_id bigint not null,
  deck_section text,
  deck_copy_index integer,
  applied_status text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (series_id, round_number, round_step, target_user_id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'series_round_ban_phase_system_bans_status_check'
      and conrelid = 'public.series_round_ban_phase_system_bans'::regclass
  ) then
    alter table public.series_round_ban_phase_system_bans
      add constraint series_round_ban_phase_system_bans_status_check
      check (applied_status in ('forbidden', 'limited', 'semi_limited'));
  end if;
end;
$$;

create index if not exists idx_series_round_ban_phase_system_bans_lookup
  on public.series_round_ban_phase_system_bans (series_id, round_number, round_step);

create or replace function public._upsert_series_banlist_entry(
  p_series_id uuid,
  p_card_id bigint,
  p_status text,
  p_source_kind text,
  p_notes text default null,
  p_round_number integer default null,
  p_round_step integer default null,
  p_modified_by_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_status text := lower(trim(coalesce(p_status, '')));
  v_source_kind text := lower(trim(coalesce(p_source_kind, '')));
begin
  if p_card_id is null then
    raise exception 'Card is required';
  end if;

  if v_status not in ('forbidden', 'limited', 'semi_limited', 'unlimited') then
    raise exception 'Unsupported banlist status';
  end if;

  if v_source_kind not in ('era', 'custom', 'system') then
    raise exception 'Unsupported banlist source';
  end if;

  insert into public.series_banlist_cards (
    series_id,
    card_id,
    status,
    notes,
    source_kind,
    source_round_number,
    source_round_step,
    modified_round_number,
    modified_round_step,
    modified_by_user_id
  )
  values (
    p_series_id,
    p_card_id,
    v_status,
    p_notes,
    v_source_kind,
    case when v_source_kind = 'era' then null else p_round_number end,
    case when v_source_kind = 'era' then null else p_round_step end,
    case when v_source_kind = 'era' then null else p_round_number end,
    case when v_source_kind = 'era' then null else p_round_step end,
    case when v_source_kind = 'era' then null else p_modified_by_user_id end
  )
  on conflict (series_id, card_id)
  do update set
    status = excluded.status,
    notes = coalesce(excluded.notes, public.series_banlist_cards.notes),
    source_kind = excluded.source_kind,
    source_round_number = excluded.source_round_number,
    source_round_step = excluded.source_round_step,
    modified_round_number = excluded.modified_round_number,
    modified_round_step = excluded.modified_round_step,
    modified_by_user_id = excluded.modified_by_user_id,
    updated_at = now();
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
declare
  v_series record;
  v_actor_id uuid;
  v_existing_row record;
  v_status text := lower(trim(coalesce(p_status, '')));
begin
  v_actor_id := public._assert_authenticated_user();

  if v_status not in ('forbidden', 'limited', 'semi_limited', 'unlimited') then
    raise exception 'Unsupported banlist status';
  end if;

  select
    gs.round_number,
    public._progression_round_step_value(gs.round_step) as round_step_value
  into v_series
  from public.game_series gs
  where gs.id = p_series_id;

  if not found then
    raise exception 'Series not found';
  end if;

  select *
  into v_existing_row
  from public.series_banlist_cards existing_rows
  where existing_rows.series_id = p_series_id
    and existing_rows.card_id = p_card_id;

  if v_existing_row.id is not null
     and coalesce(v_existing_row.modified_round_number, -1) = coalesce(v_series.round_number, -1)
     and coalesce(v_existing_row.modified_round_step, -1) = coalesce(v_series.round_step_value, -1) then
    raise exception 'Bans cannot be changed during the same round they were added';
  end if;

  if v_status in ('forbidden', 'limited', 'semi_limited')
     and lower(coalesce(v_existing_row.source_kind, 'custom')) = 'era' then
    raise exception 'Era banlist cards can only be changed by choosing Unlimited';
  end if;

  if v_status = 'unlimited' then
    if v_existing_row.id is null then
      raise exception 'Choose a card that is currently on the series banlist';
    end if;

    if lower(coalesce(v_existing_row.status, '')) = 'unlimited' then
      raise exception 'That card is already Unlimited';
    end if;
  end if;

  perform public._upsert_series_banlist_entry(
    p_series_id,
    p_card_id,
    v_status,
    'custom',
    p_notes,
    v_series.round_number,
    v_series.round_step_value,
    v_actor_id
  );
end;
$function$;

create or replace function public._initialize_series_ban_phase(p_series_id uuid)
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

  if v_series.current_phase <> 'ban' or coalesce(v_series.round_number, 0) <= 0 then
    return;
  end if;

  insert into public.series_round_ban_phase_states (
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
    from public.series_round_ban_phase_turns t
    where t.series_id = p_series_id
      and t.round_number = v_series.round_number
      and t.round_step = v_series.round_step_value
  ) then
    return;
  end if;

  insert into public.series_round_ban_phase_turns (
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
      (entry ->> 'position')::integer as overall_position
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
          coalesce(pr.last_round_placement, pr.overall_position, 999999) desc,
          coalesce(pr.overall_position, 999999) desc,
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

create or replace function public._grant_ban_phase_pass_reward(
  p_series_id uuid,
  p_target_user_id uuid,
  p_round_number integer,
  p_round_step integer
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_item_id uuid;
  v_actor_id uuid;
begin
  select i.id
  into v_item_id
  from public.item_definitions i
  where i.code = 'random_draft_pack_key'
    and i.is_active = true
  limit 1;

  if v_item_id is null then
    return null;
  end if;

  select coalesce(auth.uid(), gs.created_by)
  into v_actor_id
  from public.game_series gs
  where gs.id = p_series_id;

  perform public._grant_series_item(
    p_series_id,
    p_target_user_id,
    v_item_id,
    1,
    v_actor_id,
    format('ban_phase_pass:%s:%s', p_round_number, p_round_step)
  );

  return v_item_id;
end;
$function$;

create or replace function public._auto_complete_series_ban_phase_remaining_passes(p_series_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_series record;
  v_total_players integer := 0;
  v_pass_limit integer := 1;
  v_taken_non_passes integer := 0;
  v_used_passes integer := 0;
  v_remaining_passes integer := 0;
  v_turn record;
  v_reward_item_id uuid;
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

  if v_series.current_phase <> 'ban' or coalesce(v_series.round_number, 0) <= 0 then
    return;
  end if;

  perform public._initialize_series_ban_phase(p_series_id);

  select count(*)
  into v_total_players
  from public.series_round_ban_phase_turns t
  where t.series_id = p_series_id
    and t.round_number = v_series.round_number
    and t.round_step = v_series.round_step_value;

  v_pass_limit := case when v_total_players = 6 then 2 else 1 end;

  select
    count(*) filter (
      where t.completed_at is not null
        and t.choice_option in ('forbidden', 'limited', 'semi_limited', 'unlimited')
    ),
    count(*) filter (
      where t.choice_option = 'pass'
    )
  into v_taken_non_passes, v_used_passes
  from public.series_round_ban_phase_turns t
  where t.series_id = p_series_id
    and t.round_number = v_series.round_number
    and t.round_step = v_series.round_step_value;

  if v_taken_non_passes < 4 then
    return;
  end if;

  v_remaining_passes := greatest(v_pass_limit - v_used_passes, 0);

  if v_remaining_passes <= 0 then
    return;
  end if;

  for v_turn in
    select *
    from public.series_round_ban_phase_turns t
    where t.series_id = p_series_id
      and t.round_number = v_series.round_number
      and t.round_step = v_series.round_step_value
      and t.completed_at is null
    order by t.turn_order
    limit v_remaining_passes
  loop
    v_reward_item_id := public._grant_ban_phase_pass_reward(
      p_series_id,
      v_turn.user_id,
      v_series.round_number,
      v_series.round_step_value
    );

    update public.series_round_ban_phase_turns
    set
      choice_option = 'pass',
      choice_source = 'automatic',
      reward_item_definition_id = v_reward_item_id,
      reward_granted = v_reward_item_id is not null,
      completed_at = now(),
      updated_at = now()
    where id = v_turn.id;
  end loop;
end;
$function$;

create or replace function public._apply_series_ban_phase_system_bans(p_series_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_series record;
  v_phase_state record;
  v_player record;
  v_random_card record;
  v_status text;
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

  if v_series.current_phase <> 'ban' or coalesce(v_series.round_number, 0) <= 0 then
    return;
  end if;

  perform public._initialize_series_ban_phase(p_series_id);

  select *
  into v_phase_state
  from public.series_round_ban_phase_states s
  where s.series_id = p_series_id
    and s.round_number = v_series.round_number
    and s.round_step = v_series.round_step_value
  for update;

  if v_phase_state.system_bans_generated_at is not null then
    return;
  end if;

  if exists (
    select 1
    from public.series_round_ban_phase_turns t
    where t.series_id = p_series_id
      and t.round_number = v_series.round_number
      and t.round_step = v_series.round_step_value
      and t.completed_at is null
  ) then
    return;
  end if;

  for v_player in
    select
      sp.user_id,
      d.id as deck_id
    from public.series_players sp
    left join public.player_decks d
      on d.series_id = sp.series_id
     and d.user_id = sp.user_id
     and d.is_active = true
    where sp.series_id = p_series_id
    order by sp.joined_at asc
  loop
    if v_player.deck_id is null then
      continue;
    end if;

    select
      candidate.card_id,
      candidate.section,
      candidate.copy_index
    into v_random_card
    from (
      select
        pdc.card_id,
        pdc.section,
        weighted.copy_index
      from public.player_deck_cards pdc
      join generate_series(1, greatest(pdc.quantity, 1)) weighted(copy_index)
        on true
      left join public.series_banlist_cards ban_rows
        on ban_rows.series_id = p_series_id
       and ban_rows.card_id = pdc.card_id
      where pdc.deck_id = v_player.deck_id
        and coalesce(ban_rows.source_kind, 'custom') <> 'era'
        and not (
          coalesce(ban_rows.modified_round_number, -1) = v_series.round_number
          and coalesce(ban_rows.modified_round_step, -1) = v_series.round_step_value
        )
      order by random()
      limit 1
    ) as candidate;

    if v_random_card.card_id is null then
      continue;
    end if;

    select chosen.status
    into v_status
    from (
      select unnest(array['forbidden', 'limited', 'semi_limited']) as status
    ) as chosen
    order by random()
    limit 1;

    perform public._upsert_series_banlist_entry(
      p_series_id,
      v_random_card.card_id,
      v_status,
      'system',
      'Round system ban',
      v_series.round_number,
      v_series.round_step_value,
      null
    );

    insert into public.series_round_ban_phase_system_bans (
      series_id,
      round_number,
      round_step,
      target_user_id,
      deck_id,
      card_id,
      deck_section,
      deck_copy_index,
      applied_status
    )
    values (
      p_series_id,
      v_series.round_number,
      v_series.round_step_value,
      v_player.user_id,
      v_player.deck_id,
      v_random_card.card_id,
      v_random_card.section,
      v_random_card.copy_index,
      v_status
    )
    on conflict (series_id, round_number, round_step, target_user_id)
    do update set
      deck_id = excluded.deck_id,
      card_id = excluded.card_id,
      deck_section = excluded.deck_section,
      deck_copy_index = excluded.deck_copy_index,
      applied_status = excluded.applied_status,
      updated_at = now();
  end loop;

  update public.series_round_ban_phase_states
  set
    system_bans_generated_at = now(),
    updated_at = now()
  where id = v_phase_state.id;
end;
$function$;

create or replace function public.get_current_ban_phase_state(p_series_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_series record;
  v_phase_state record;
  v_current_turn record;
  v_my_turn record;
  v_player_count integer := 0;
  v_ready_count integer := 0;
  v_pass_limit integer := 1;
  v_used_forbidden integer := 0;
  v_used_limited integer := 0;
  v_used_semi integer := 0;
  v_used_unlimited integer := 0;
  v_used_passes integer := 0;
  v_already_confirmed boolean := false;
  v_turns jsonb := '[]'::jsonb;
  v_system_bans jsonb := '[]'::jsonb;
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

  if v_series.current_phase <> 'ban' or coalesce(v_series.round_number, 0) <= 0 then
    return jsonb_build_object(
      'active', false,
      'current_phase', v_series.current_phase,
      'round_number', v_series.round_number,
      'round_step', v_series.round_step_value
    );
  end if;

  perform public._initialize_series_ban_phase(p_series_id);
  perform public._auto_complete_series_ban_phase_remaining_passes(p_series_id);
  perform public._apply_series_ban_phase_system_bans(p_series_id);

  select *
  into v_phase_state
  from public.series_round_ban_phase_states s
  where s.series_id = p_series_id
    and s.round_number = v_series.round_number
    and s.round_step = v_series.round_step_value;

  select count(*)
  into v_player_count
  from public.series_round_ban_phase_turns t
  where t.series_id = p_series_id
    and t.round_number = v_series.round_number
    and t.round_step = v_series.round_step_value;

  v_pass_limit := case when v_player_count = 6 then 2 else 1 end;

  select
    count(*) filter (where t.choice_option = 'forbidden'),
    count(*) filter (where t.choice_option = 'limited'),
    count(*) filter (where t.choice_option = 'semi_limited'),
    count(*) filter (where t.choice_option = 'unlimited'),
    count(*) filter (where t.choice_option = 'pass')
  into
    v_used_forbidden,
    v_used_limited,
    v_used_semi,
    v_used_unlimited,
    v_used_passes
  from public.series_round_ban_phase_turns t
  where t.series_id = p_series_id
    and t.round_number = v_series.round_number
    and t.round_step = v_series.round_step_value;

  select *
  into v_current_turn
  from public.series_round_ban_phase_turns t
  where t.series_id = p_series_id
    and t.round_number = v_series.round_number
    and t.round_step = v_series.round_step_value
    and t.completed_at is null
  order by t.turn_order
  limit 1;

  select *
  into v_my_turn
  from public.series_round_ban_phase_turns t
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
      and rs.phase = 'ban'
      and rs.user_id = v_actor_id
  )
  into v_already_confirmed;

  select count(*)
  into v_ready_count
  from public.series_phase_ready_states rs
  where rs.series_id = p_series_id
    and rs.round_number = v_series.round_number
    and rs.round_step = v_series.round_step_value
    and rs.phase = 'ban';

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
        'selected_card_id', t.selected_card_id,
        'selected_card_name', cards.name,
        'reward_item_definition_id', t.reward_item_definition_id,
        'reward_item_name', reward_item.name,
        'reward_granted', t.reward_granted,
        'completed_at', t.completed_at,
        'is_current_turn', case when v_current_turn.id is not null and t.id = v_current_turn.id then true else false end
      )
      order by t.turn_order
    ),
    '[]'::jsonb
  )
  into v_turns
  from public.series_round_ban_phase_turns t
  left join public.series_players_view spv
    on spv.series_id = t.series_id
   and spv.user_id = t.user_id
  left join public.cards
    on cards.id = t.selected_card_id
  left join public.item_definitions reward_item
    on reward_item.id = t.reward_item_definition_id
  where t.series_id = p_series_id
    and t.round_number = v_series.round_number
    and t.round_step = v_series.round_step_value;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'target_user_id', system_rows.target_user_id,
        'username', coalesce(spv.username, 'Player'),
        'card_id', system_rows.card_id,
        'card_name', cards.name,
        'deck_section', system_rows.deck_section,
        'deck_copy_index', system_rows.deck_copy_index,
        'applied_status', system_rows.applied_status
      )
      order by coalesce(spv.username, 'Player') asc, cards.name asc
    ),
    '[]'::jsonb
  )
  into v_system_bans
  from public.series_round_ban_phase_system_bans system_rows
  left join public.series_players_view spv
    on spv.series_id = system_rows.series_id
   and spv.user_id = system_rows.target_user_id
  left join public.cards
    on cards.id = system_rows.card_id
  where system_rows.series_id = p_series_id
    and system_rows.round_number = v_series.round_number
    and system_rows.round_step = v_series.round_step_value;

  if v_current_turn.id is not null and v_current_turn.user_id = v_actor_id then
    if v_my_turn.choice_option is null then
      v_my_action_state := 'choose_option';
    elsif v_my_turn.choice_option = 'pass' then
      v_my_action_state := 'waiting';
    elsif v_my_turn.completed_at is null then
      v_my_action_state := 'choose_card';
    else
      v_my_action_state := 'waiting';
    end if;
  elsif v_current_turn.id is null and v_phase_state.system_bans_generated_at is not null then
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
    'pass_limit', v_pass_limit,
    'current_turn_user_id', v_current_turn.user_id,
    'current_turn_order', v_current_turn.turn_order,
    'is_my_turn', case when v_current_turn.id is not null and v_current_turn.user_id = v_actor_id then true else false end,
    'my_choice_option', v_my_turn.choice_option,
    'my_selected_card_id', v_my_turn.selected_card_id,
    'my_action_state', v_my_action_state,
    'already_confirmed', v_already_confirmed,
    'system_bans_generated', v_phase_state.system_bans_generated_at is not null,
    'can_confirm',
      case
        when v_current_turn.id is null
          and v_phase_state.system_bans_generated_at is not null
          and not v_already_confirmed
        then true
        else false
      end,
    'available_options', jsonb_build_object(
      'forbidden', v_used_forbidden = 0,
      'limited', v_used_limited = 0,
      'semi_limited', v_used_semi = 0,
      'unlimited', v_used_unlimited = 0,
      'pass', v_used_passes < v_pass_limit
    ),
    'turns', v_turns,
    'system_bans', v_system_bans
  );
end;
$function$;

create or replace function public.choose_current_ban_phase_option(
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
  v_total_players integer := 0;
  v_pass_limit integer := 1;
  v_used_forbidden integer := 0;
  v_used_limited integer := 0;
  v_used_semi integer := 0;
  v_used_unlimited integer := 0;
  v_used_passes integer := 0;
  v_choice_option text := lower(trim(coalesce(p_choice_option, '')));
  v_reward_item_id uuid;
begin
  v_actor_id := public._assert_authenticated_user();
  perform public._assert_series_member_for_claim(p_series_id, v_actor_id);

  if v_choice_option not in ('forbidden', 'limited', 'semi_limited', 'unlimited', 'pass') then
    raise exception 'Unsupported ban phase option';
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

  if v_series.current_phase <> 'ban' or coalesce(v_series.round_number, 0) <= 0 then
    raise exception 'Ban Phase is not active';
  end if;

  perform public._initialize_series_ban_phase(p_series_id);

  select count(*)
  into v_total_players
  from public.series_round_ban_phase_turns t
  where t.series_id = p_series_id
    and t.round_number = v_series.round_number
    and t.round_step = v_series.round_step_value;

  v_pass_limit := case when v_total_players = 6 then 2 else 1 end;

  select
    count(*) filter (where t.choice_option = 'forbidden'),
    count(*) filter (where t.choice_option = 'limited'),
    count(*) filter (where t.choice_option = 'semi_limited'),
    count(*) filter (where t.choice_option = 'unlimited'),
    count(*) filter (where t.choice_option = 'pass')
  into
    v_used_forbidden,
    v_used_limited,
    v_used_semi,
    v_used_unlimited,
    v_used_passes
  from public.series_round_ban_phase_turns t
  where t.series_id = p_series_id
    and t.round_number = v_series.round_number
    and t.round_step = v_series.round_step_value;

  select *
  into v_current_turn
  from public.series_round_ban_phase_turns t
  where t.series_id = p_series_id
    and t.round_number = v_series.round_number
    and t.round_step = v_series.round_step_value
    and t.completed_at is null
  order by t.turn_order
  limit 1
  for update;

  if not found then
    raise exception 'Ban Phase choices are already complete';
  end if;

  if v_current_turn.user_id <> v_actor_id then
    raise exception 'It is not your turn to choose a ban option';
  end if;

  if v_current_turn.choice_option is not null then
    raise exception 'Your ban option is already selected';
  end if;

  if v_choice_option = 'forbidden' and v_used_forbidden > 0 then
    raise exception 'Forbidden was already chosen this round';
  end if;

  if v_choice_option = 'limited' and v_used_limited > 0 then
    raise exception 'Limited was already chosen this round';
  end if;

  if v_choice_option = 'semi_limited' and v_used_semi > 0 then
    raise exception 'Semi-Limited was already chosen this round';
  end if;

  if v_choice_option = 'unlimited' and v_used_unlimited > 0 then
    raise exception 'Unlimited was already chosen this round';
  end if;

  if v_choice_option = 'pass' and v_used_passes >= v_pass_limit then
    raise exception 'Pass is no longer available this round';
  end if;

  if v_choice_option = 'pass' then
    v_reward_item_id := public._grant_ban_phase_pass_reward(
      p_series_id,
      v_actor_id,
      v_series.round_number,
      v_series.round_step_value
    );

    update public.series_round_ban_phase_turns
    set
      choice_option = 'pass',
      choice_source = 'manual',
      reward_item_definition_id = v_reward_item_id,
      reward_granted = v_reward_item_id is not null,
      completed_at = now(),
      updated_at = now()
    where id = v_current_turn.id;

    perform public._auto_complete_series_ban_phase_remaining_passes(p_series_id);
    perform public._apply_series_ban_phase_system_bans(p_series_id);
  else
    update public.series_round_ban_phase_turns
    set
      choice_option = v_choice_option,
      choice_source = 'manual',
      updated_at = now()
    where id = v_current_turn.id;
  end if;

  return public.get_current_ban_phase_state(p_series_id);
end;
$function$;

create or replace function public.submit_current_ban_phase_card(
  p_series_id uuid,
  p_card_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_series record;
  v_turn record;
  v_existing_row record;
  v_card_name text;
begin
  v_actor_id := public._assert_authenticated_user();
  perform public._assert_series_member_for_claim(p_series_id, v_actor_id);

  if p_card_id is null then
    raise exception 'Select a card first';
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

  if v_series.current_phase <> 'ban' or coalesce(v_series.round_number, 0) <= 0 then
    raise exception 'Ban Phase is not active';
  end if;

  perform public._initialize_series_ban_phase(p_series_id);

  select *
  into v_turn
  from public.series_round_ban_phase_turns t
  where t.series_id = p_series_id
    and t.round_number = v_series.round_number
    and t.round_step = v_series.round_step_value
    and t.user_id = v_actor_id
    and t.completed_at is null
  order by t.turn_order
  limit 1
  for update;

  if not found then
    raise exception 'You do not have an active ban turn';
  end if;

  if v_turn.choice_option is null or v_turn.choice_option = 'pass' then
    raise exception 'Choose a non-pass ban option first';
  end if;

  select c.name
  into v_card_name
  from public.cards c
  where c.id = p_card_id;

  if v_card_name is null then
    raise exception 'Card not found';
  end if;

  select *
  into v_existing_row
  from public.series_banlist_cards b
  where b.series_id = p_series_id
    and b.card_id = p_card_id
  for update;

  if v_existing_row.id is not null
     and coalesce(v_existing_row.modified_round_number, -1) = v_series.round_number
     and coalesce(v_existing_row.modified_round_step, -1) = v_series.round_step_value then
    raise exception 'Bans cannot be changed during the same round they were added';
  end if;

  if v_turn.choice_option in ('forbidden', 'limited', 'semi_limited')
     and coalesce(v_existing_row.source_kind, 'custom') = 'era' then
    raise exception 'Era banlist cards can only be changed by choosing Unlimited';
  end if;

  if v_turn.choice_option = 'unlimited' then
    if v_existing_row.id is null then
      raise exception 'Choose a card that is currently on the series banlist';
    end if;

    if lower(coalesce(v_existing_row.status, '')) = 'unlimited' then
      raise exception 'That card is already Unlimited';
    end if;
  end if;

  perform public._upsert_series_banlist_entry(
    p_series_id,
    p_card_id,
    v_turn.choice_option,
    'custom',
    format('Ban Phase: %s', v_card_name),
    v_series.round_number,
    v_series.round_step_value,
    v_actor_id
  );

  update public.series_round_ban_phase_turns
  set
    selected_card_id = p_card_id,
    completed_at = now(),
    updated_at = now()
  where id = v_turn.id;

  perform public._auto_complete_series_ban_phase_remaining_passes(p_series_id);
  perform public._apply_series_ban_phase_system_bans(p_series_id);

  return public.get_current_ban_phase_state(p_series_id);
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
  v_phase_state record;
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
    into v_phase_state
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
    ) or v_phase_state.system_bans_generated_at is null then
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
  v_phase_state record;
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
    into v_phase_state
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

    if v_phase_state.system_bans_generated_at is null then
      raise exception 'System ban rolls are still being prepared';
    end if;

    v_ready_reason := 'ban_phase_confirmed';
  elsif v_series.current_phase = 'binder' then
    v_ready_reason := 'binder_ready';
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
  v_phase_state record;
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
    into v_phase_state
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

    if not p_force and coalesce(v_phase_state.system_bans_generated_at is not null, false) = false then
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
  elsif v_series.current_phase = 'binder' then
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
