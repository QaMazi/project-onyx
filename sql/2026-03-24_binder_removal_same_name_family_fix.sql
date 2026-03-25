begin;

do $$
declare
  v_function_def text;
  v_old_declare_block text := $old$
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
$old$;
  v_new_declare_block text := $new$
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
$new$;
  v_old_block text := $old$
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
      raise exception 'That card is no longer available in the target binder';
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
$old$;
  v_new_block text := $new$
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
$new$;
begin
  select pg_get_functiondef('public.resolve_current_binder_phase_choice(uuid,jsonb)'::regprocedure)
  into v_function_def;

  if position(v_new_declare_block in v_function_def) = 0 then
    if position(v_old_declare_block in v_function_def) = 0 then
      raise exception 'Expected declaration block not found in resolve_current_binder_phase_choice';
    end if;

    v_function_def := replace(v_function_def, v_old_declare_block, v_new_declare_block);
  end if;

  if position(v_new_block in v_function_def) > 0 then
    execute v_function_def;
    return;
  end if;

  if position(v_old_block in v_function_def) = 0 then
    raise exception 'Expected Binder Removal block not found in resolve_current_binder_phase_choice';
  end if;

  v_function_def := replace(v_function_def, v_old_block, v_new_block);
  execute v_function_def;
end
$$;

commit;
