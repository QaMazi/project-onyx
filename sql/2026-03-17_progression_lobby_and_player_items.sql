begin;

update public.item_definitions
set
  is_active = false,
  updated_at = now()
where behavior_code = 'rarity_reforge';

delete from public.store_cart_items sci
using public.store_carts sc, public.item_definitions i
where sci.cart_id = sc.id
  and sci.item_definition_id = i.id
  and i.behavior_code = 'rarity_reforge';

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

    if v_next_step = 1 and v_previous_round > 0 then
      perform public._award_completed_main_round_tokens(
        p_series_id,
        v_previous_round
      );
    end if;

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

create or replace function public.admin_get_series_player_item_snapshot(
  p_series_id uuid,
  p_target_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
begin
  v_actor_id := public._assert_authenticated_user();
  perform public._assert_series_admin_or_admin_plus(p_series_id);

  if p_target_user_id is null then
    raise exception 'Target user is required';
  end if;

  if not exists (
    select 1
    from public.series_players sp
    where sp.series_id = p_series_id
      and sp.user_id = p_target_user_id
  ) then
    raise exception 'Target user is not in this series';
  end if;

  return jsonb_build_object(
    'inventory',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', x.id,
              'item_definition_id', x.item_definition_id,
              'item_code', x.item_code,
              'item_name', x.item_name,
              'category_code', x.category_code,
              'category_name', x.category_name,
              'description', x.description,
              'quantity', x.quantity,
              'locked_quantity', x.locked_quantity,
              'available_quantity', x.available_quantity
            )
            order by x.category_name, x.item_name
          )
          from (
            select *
            from public.player_inventory_view pi
            where pi.series_id = p_series_id
              and pi.user_id = p_target_user_id
          ) x
        ),
        '[]'::jsonb
      ),
    'binder',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', x.id,
              'card_id', x.card_id,
              'card_name', x.card_name,
              'image_url', x.image_url,
              'rarity_id', x.rarity_id,
              'rarity_code', x.rarity_code,
              'rarity_name', x.rarity_name,
              'rarity_sort_order', x.rarity_sort_order,
              'quantity', x.quantity,
              'is_trade_locked', x.is_trade_locked
            )
            order by x.card_name, x.rarity_sort_order
          )
          from (
            select bc.*
            from public.binder_cards_view bc
            where bc.series_id = p_series_id
              and bc.user_id = p_target_user_id
              and not exists (
                select 1
                from public.player_card_vault_entries v
                where v.series_id = p_series_id
                  and v.user_id = p_target_user_id
                  and v.card_id = bc.card_id
              )
          ) x
        ),
        '[]'::jsonb
      ),
    'vault',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', x.id,
              'card_id', x.card_id,
              'card_name', x.card_name,
              'image_url', x.image_url
            )
            order by x.card_name
          )
          from (
            select
              v.id,
              v.card_id,
              c.name as card_name,
              c.image_url
            from public.player_card_vault_entries v
            join public.cards c
              on c.id = v.card_id
            where v.series_id = p_series_id
              and v.user_id = p_target_user_id
          ) x
        ),
        '[]'::jsonb
      ),
    'decks',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', d.id,
              'deck_name', d.deck_name,
              'is_active', d.is_active,
              'is_valid', d.is_valid,
              'validation_summary', d.validation_summary,
              'main_count', d.main_count,
              'extra_count', d.extra_count,
              'side_count', d.side_count,
              'total_cards', d.total_cards,
              'cards',
                coalesce(
                  (
                    select jsonb_agg(
                      jsonb_build_object(
                        'id', dc.id,
                        'card_id', dc.card_id,
                        'card_name', dc.card_name,
                        'card_image_url', dc.card_image_url,
                        'section', dc.section,
                        'quantity', dc.quantity
                      )
                      order by
                        case dc.section
                          when 'main' then 1
                          when 'extra' then 2
                          else 3
                        end,
                        dc.card_name
                    )
                    from public.player_deck_cards_view dc
                    where dc.deck_id = d.id
                  ),
                  '[]'::jsonb
                )
            )
            order by d.is_active desc, d.deck_name
          )
          from public.player_decks_view d
          where d.series_id = p_series_id
            and d.user_id = p_target_user_id
        ),
        '[]'::jsonb
      )
  );
end;
$function$;

create or replace function public.admin_remove_player_inventory_row(
  p_series_id uuid,
  p_inventory_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_row record;
begin
  perform public._assert_authenticated_user();
  perform public._assert_series_admin_or_admin_plus(p_series_id);

  select
    pi.*,
    i.name as item_name
  into v_row
  from public.player_inventory pi
  join public.item_definitions i
    on i.id = pi.item_definition_id
  where pi.id = p_inventory_id
    and pi.series_id = p_series_id
  for update;

  if not found then
    raise exception 'Inventory row not found';
  end if;

  if coalesce(v_row.locked_quantity, 0) > 0 then
    raise exception 'Cannot remove an inventory row that is currently locked';
  end if;

  delete from public.player_inventory
  where id = p_inventory_id;

  return jsonb_build_object(
    'success', true,
    'removed_kind', 'inventory',
    'removed_id', p_inventory_id,
    'label', v_row.item_name
  );
end;
$function$;

create or replace function public.admin_remove_player_binder_row(
  p_series_id uuid,
  p_binder_card_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_row record;
begin
  perform public._assert_authenticated_user();
  perform public._assert_series_admin_or_admin_plus(p_series_id);

  select
    bc.*,
    c.name as card_name
  into v_row
  from public.binder_cards bc
  join public.cards c
    on c.id = bc.card_id
  where bc.id = p_binder_card_id
    and bc.series_id = p_series_id
  for update;

  if not found then
    raise exception 'Binder row not found';
  end if;

  if coalesce(v_row.is_trade_locked, false) then
    raise exception 'Cannot remove a trade-locked binder row';
  end if;

  delete from public.player_card_vault_entries
  where series_id = p_series_id
    and user_id = v_row.user_id
    and card_id = v_row.card_id;

  delete from public.binder_cards
  where id = p_binder_card_id;

  perform public._sync_active_deck_after_card_visibility_change(
    p_series_id,
    v_row.user_id,
    v_row.card_id
  );

  return jsonb_build_object(
    'success', true,
    'removed_kind', 'binder',
    'removed_id', p_binder_card_id,
    'label', v_row.card_name
  );
end;
$function$;

create or replace function public.admin_remove_player_vault_entry(
  p_series_id uuid,
  p_vault_entry_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_row record;
begin
  perform public._assert_authenticated_user();
  perform public._assert_series_admin_or_admin_plus(p_series_id);

  select
    v.*,
    c.name as card_name
  into v_row
  from public.player_card_vault_entries v
  join public.cards c
    on c.id = v.card_id
  where v.id = p_vault_entry_id
    and v.series_id = p_series_id
  for update;

  if not found then
    raise exception 'Vault entry not found';
  end if;

  if exists (
    select 1
    from public.binder_cards bc
    where bc.series_id = p_series_id
      and bc.user_id = v_row.user_id
      and bc.card_id = v_row.card_id
      and bc.is_trade_locked = true
  ) then
    raise exception 'Cannot remove a vaulted card family while one of its binder rows is trade locked';
  end if;

  delete from public.player_card_vault_entries
  where id = p_vault_entry_id;

  delete from public.binder_cards
  where series_id = p_series_id
    and user_id = v_row.user_id
    and card_id = v_row.card_id;

  perform public._sync_active_deck_after_card_visibility_change(
    p_series_id,
    v_row.user_id,
    v_row.card_id
  );

  return jsonb_build_object(
    'success', true,
    'removed_kind', 'vault',
    'removed_id', p_vault_entry_id,
    'label', v_row.card_name
  );
end;
$function$;

create or replace function public.admin_remove_player_deck(
  p_series_id uuid,
  p_deck_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_row record;
begin
  perform public._assert_authenticated_user();
  perform public._assert_series_admin_or_admin_plus(p_series_id);

  select *
  into v_row
  from public.player_decks d
  where d.id = p_deck_id
    and d.series_id = p_series_id
  for update;

  if not found then
    raise exception 'Deck not found';
  end if;

  if coalesce(v_row.is_active, false) then
    raise exception 'Cannot remove the active deck from this admin tool';
  end if;

  delete from public.player_deck_cards
  where deck_id = p_deck_id;

  delete from public.player_decks
  where id = p_deck_id;

  return jsonb_build_object(
    'success', true,
    'removed_kind', 'deck',
    'removed_id', p_deck_id,
    'label', v_row.deck_name
  );
end;
$function$;

create or replace function public.admin_remove_player_deck_card(
  p_series_id uuid,
  p_deck_card_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_row record;
  v_series_phase text;
begin
  perform public._assert_authenticated_user();
  perform public._assert_series_admin_or_admin_plus(p_series_id);

  select current_phase
  into v_series_phase
  from public.game_series
  where id = p_series_id;

  select
    pdc.*,
    d.user_id,
    d.deck_name,
    d.is_active,
    c.name as card_name
  into v_row
  from public.player_deck_cards pdc
  join public.player_decks d
    on d.id = pdc.deck_id
  join public.cards c
    on c.id = pdc.card_id
  where pdc.id = p_deck_card_id
    and d.series_id = p_series_id
  for update;

  if not found then
    raise exception 'Deck card row not found';
  end if;

  if coalesce(v_row.is_active, false) and coalesce(v_series_phase, '') = 'dueling' then
    raise exception 'Cannot remove cards from the active deck during Dueling Phase';
  end if;

  delete from public.player_deck_cards
  where id = p_deck_card_id;

  update public.player_decks
  set updated_at = now()
  where id = v_row.deck_id;

  if coalesce(v_row.is_active, false) then
    perform public._revalidate_active_deck(p_series_id, v_row.user_id);
  end if;

  return jsonb_build_object(
    'success', true,
    'removed_kind', 'deck_card',
    'removed_id', p_deck_card_id,
    'label', v_row.card_name,
    'deck_name', v_row.deck_name
  );
end;
$function$;

commit;
