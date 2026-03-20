begin;

with desired_categories as (
  select *
  from (
    values
      ('thiefs_cards', 'Thief''s Cards'),
      ('hex_idols', 'Hex Idols'),
      ('card_extractors', 'Card Extractors'),
      ('forced_exchanges', 'Forced Exchanges')
  ) as rows(code, name)
)
update public.item_categories as categories
set name = desired_categories.name
from desired_categories
where lower(coalesce(categories.code, '')) = desired_categories.code
  and categories.name is distinct from desired_categories.name;

with desired_categories as (
  select *
  from (
    values
      ('thiefs_cards', 'Thief''s Cards'),
      ('hex_idols', 'Hex Idols'),
      ('card_extractors', 'Card Extractors'),
      ('forced_exchanges', 'Forced Exchanges')
  ) as rows(code, name)
)
insert into public.item_categories (
  id,
  name,
  code,
  created_at
)
select
  gen_random_uuid(),
  desired_categories.name,
  desired_categories.code,
  now()
from desired_categories
where not exists (
  select 1
  from public.item_categories categories
  where lower(coalesce(categories.code, '')) = desired_categories.code
);

with category_targets as (
  select
    items.id,
    case
      when lower(coalesce(items.behavior_code, '')) like 'steal_card%' then 'thiefs_cards'
      when lower(coalesce(items.behavior_code, '')) like 'curse_cards%' then 'hex_idols'
      when lower(coalesce(items.behavior_code, '')) like 'extract_card%' then 'card_extractors'
      when lower(coalesce(items.behavior_code, '')) like 'forced_exchange%' then 'forced_exchanges'
      else null
    end as category_code
  from public.item_definitions items
)
update public.item_definitions as items
set
  category_id = categories.id,
  updated_at = now()
from category_targets
join public.item_categories categories
  on lower(coalesce(categories.code, '')) = category_targets.category_code
where items.id = category_targets.id
  and category_targets.category_code is not null
  and items.category_id is distinct from categories.id;

create or replace function public.get_inventory_item_use_preview(p_inventory_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_item record;
  v_unlocks record;
  v_protection record;
  v_action_kind text := 'unsupported';
  v_effect_key text := '';
  v_block_reason text := null;
  v_targets jsonb := '[]'::jsonb;
  v_resolved_targets jsonb := '[]'::jsonb;
  v_random_target jsonb := '{}'::jsonb;
  v_session_payload jsonb := '{}'::jsonb;
  v_session_id uuid := null;
  v_random_container_type_code text := null;
begin
  v_actor_id := public._assert_authenticated_user();

  select
    pi.id,
    pi.user_id,
    pi.series_id,
    pi.quantity,
    pi.locked_quantity,
    i.id as item_definition_id,
    i.code,
    i.name,
    i.behavior_code,
    i.target_kind,
    i.target_id,
    i.exact_item_family
  into v_item
  from public.player_inventory pi
  join public.item_definitions i
    on i.id = pi.item_definition_id
  where pi.id = p_inventory_id
  for update;

  if not found then
    raise exception 'Inventory item not found';
  end if;

  if v_item.user_id <> v_actor_id then
    raise exception 'You do not own this inventory item';
  end if;

  perform public._assert_series_member(v_item.series_id, v_actor_id);

  begin
    perform public._assert_series_item_use_allowed(v_item.series_id, v_actor_id);
  exception
    when others then
      v_block_reason := sqlerrm;
  end;

  select *
  into v_unlocks
  from public.player_series_unlocks u
  where u.series_id = v_item.series_id
    and u.user_id = v_actor_id;

  select *
  into v_protection
  from public.player_series_protections p
  where p.series_id = v_item.series_id
    and p.user_id = v_actor_id;

  if v_item.behavior_code = 'open_container' and v_item.target_kind = 'container' then
    v_action_kind := 'open_in_opener';
    v_effect_key := 'open_container';
  elsif lower(coalesce(v_item.code, '')) = 'deck_case'
    or lower(coalesce(v_item.behavior_code, '')) = 'grant_saved_deck_slot' then
    v_action_kind := 'self_confirm';
    v_effect_key := 'deck_case';
  elsif lower(coalesce(v_item.code, '')) = 'card_vault'
    or lower(coalesce(v_item.behavior_code, '')) = 'grant_card_vault_slots' then
    v_action_kind := 'self_confirm';
    v_effect_key := 'card_vault';
  elsif lower(coalesce(v_item.code, '')) in ('warded_sigil_i', 'warded_sigil_ii', 'chaos_sigil')
    or lower(coalesce(v_item.behavior_code, '')) in (
      'grant_protection_1',
      'grant_protection_2',
      'grant_protection_random_1_5'
    ) then
    v_action_kind := 'self_confirm';
    v_effect_key := 'protection';
  elsif lower(coalesce(v_item.behavior_code, '')) = 'grant_random_container_key' then
    v_action_kind := 'self_confirm';
    v_effect_key := 'random_container_key';
    v_random_container_type_code := public._resolve_random_container_type_code(v_item.exact_item_family);

    if v_random_container_type_code is null then
      v_block_reason := coalesce(
        v_block_reason,
        'This random key item is missing its target container type configuration'
      );
    elsif not exists (
      select 1
      from public.item_definitions opener_items
      join public.containers containers
        on containers.id = opener_items.target_id
      join public.container_types container_types
        on container_types.id = containers.container_type_id
      where opener_items.behavior_code = 'open_container'
        and coalesce(opener_items.target_kind, '') = 'container'
        and opener_items.target_id is not null
        and coalesce(opener_items.is_active, false) = true
        and lower(coalesce(container_types.code, '')) = v_random_container_type_code
        and coalesce(containers.is_enabled, true) = true
        and coalesce(containers.is_locked, false) = false
    ) then
      v_block_reason := coalesce(
        v_block_reason,
        format(
          'No unlocked %s options are available right now',
          replace(initcap(replace(v_random_container_type_code, '_', ' ')), 'Full Pack', 'Pack')
        )
      );
    end if;
  elsif v_item.behavior_code = 'apply_random_banlist_to_all_opponents' then
    v_action_kind := 'hostile_confirm';
    v_effect_key := 'chaos_verdict';
    v_resolved_targets := public._hostile_target_pool_json(v_item.series_id, v_actor_id);
  elsif v_item.behavior_code in (
    'set_banlist_forbidden',
    'set_banlist_limited',
    'set_banlist_semi_limited',
    'set_banlist_unlimited'
  ) then
    v_action_kind := 'banlist_search';
    v_effect_key := lower(coalesce(v_item.code, v_item.behavior_code));
  elsif v_item.behavior_code in (
    'black_market_ticket',
    'black_market_card'
  ) then
    v_action_kind := 'black_market_pick';
    v_effect_key := lower(coalesce(v_item.code, v_item.behavior_code));
  elsif v_item.behavior_code in (
    'curse_cards_choose_opponent',
    'steal_card_choose_opponent',
    'extract_card_choose_opponent'
  ) then
    v_action_kind := 'opponent_card_picker';
    v_effect_key := lower(coalesce(v_item.code, v_item.behavior_code));
    v_targets := public._hostile_target_pool_json(v_item.series_id, v_actor_id);
  elsif v_item.behavior_code = 'forced_exchange_choose_opponent' then
    v_action_kind := 'forced_exchange';
    v_effect_key := lower(coalesce(v_item.code, v_item.behavior_code));
    v_targets := public._hostile_target_pool_json(v_item.series_id, v_actor_id);
  elsif v_item.behavior_code in (
    'curse_cards_random_opponent',
    'steal_card_random_opponent',
    'extract_card_random_opponent',
    'forced_exchange_random_opponent'
  ) then
    v_action_kind := case
      when v_item.behavior_code = 'forced_exchange_random_opponent' then 'forced_exchange'
      else 'opponent_card_picker'
    end;
    v_effect_key := lower(coalesce(v_item.code, v_item.behavior_code));
    v_session_payload := coalesce(
      public._get_inventory_item_use_session_payload(p_inventory_id, v_actor_id, v_effect_key),
      '{}'::jsonb
    );

    if coalesce(v_session_payload ->> 'target_user_id', '') <> '' then
      v_random_target := (
        select coalesce(target_rows.value, '{}'::jsonb)
        from jsonb_array_elements(public._hostile_target_pool_json(v_item.series_id, v_actor_id)) target_rows
        where target_rows.value ->> 'user_id' = v_session_payload ->> 'target_user_id'
        limit 1
      );
    end if;

    if coalesce(v_random_target, '{}'::jsonb) = '{}'::jsonb then
      v_random_target := public._pick_random_hostile_target(v_item.series_id, v_actor_id);
      if coalesce(v_random_target, '{}'::jsonb) <> '{}'::jsonb then
        v_session_id := public._upsert_inventory_item_use_session(
          v_item.id,
          v_item.series_id,
          v_actor_id,
          v_item.item_definition_id,
          v_effect_key,
          jsonb_build_object('target_user_id', v_random_target ->> 'user_id')
        );
      end if;
    end if;

    if coalesce(v_random_target, '{}'::jsonb) <> '{}'::jsonb then
      v_resolved_targets := jsonb_build_array(v_random_target);
    end if;
  elsif v_item.behavior_code in (
    'curse_cards_all_opponents',
    'steal_card_all_opponents',
    'extract_card_all_opponents'
  ) then
    v_action_kind := 'multi_target_card_picker';
    v_effect_key := lower(coalesce(v_item.code, v_item.behavior_code));
    v_resolved_targets := public._hostile_target_pool_json(v_item.series_id, v_actor_id);
  end if;

  if (
    v_action_kind in ('hostile_confirm', 'opponent_card_picker', 'forced_exchange', 'multi_target_card_picker')
    and jsonb_array_length(v_targets) = 0
    and jsonb_array_length(v_resolved_targets) = 0
  ) then
    v_block_reason := coalesce(v_block_reason, 'No eligible opponents can be targeted right now');
  end if;

  if v_action_kind = 'black_market_pick' and not exists (
    select 1
    from public.series_banlist_cards ban_rows
    where ban_rows.series_id = v_item.series_id
      and coalesce(ban_rows.status, 'unlimited') <> 'unlimited'
  ) then
    v_block_reason := coalesce(v_block_reason, 'There are no currently banlisted cards to choose from');
  end if;

  return jsonb_build_object(
    'inventory_id', v_item.id,
    'series_id', v_item.series_id,
    'item_definition_id', v_item.item_definition_id,
    'item_code', v_item.code,
    'item_name', v_item.name,
    'behavior_code', v_item.behavior_code,
    'available_quantity', greatest(v_item.quantity - v_item.locked_quantity, 0),
    'action_kind', v_action_kind,
    'effect_key', v_effect_key,
    'can_use', v_block_reason is null and greatest(v_item.quantity - v_item.locked_quantity, 0) > 0,
    'block_reason', v_block_reason,
    'extra_saved_deck_slots', coalesce(v_unlocks.extra_saved_deck_slots, 0),
    'card_vault_slots', coalesce(v_unlocks.card_vault_slots, 0),
    'card_vault_unlocked', coalesce(v_unlocks.card_vault_unlocked, false),
    'protection_rounds_remaining', coalesce(v_protection.rounds_remaining, 0),
    'eligible_targets', v_targets,
    'resolved_targets', v_resolved_targets,
    'session_id', v_session_id
  );
end;
$function$;

create or replace function public.use_inventory_item_self(p_inventory_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_inventory record;
  v_rounds_to_add integer := 0;
  v_effect_key text := '';
  v_random_key_result jsonb := '{}'::jsonb;
begin
  v_actor_id := public._assert_authenticated_user();

  select
    pi.*,
    i.code as item_code,
    i.name as item_name,
    i.behavior_code,
    i.exact_item_family
  into v_inventory
  from public.player_inventory pi
  join public.item_definitions i
    on i.id = pi.item_definition_id
  where pi.id = p_inventory_id
  for update;

  if not found then
    raise exception 'Inventory item not found';
  end if;

  if v_inventory.user_id <> v_actor_id then
    raise exception 'You do not own this inventory item';
  end if;

  if (v_inventory.quantity - v_inventory.locked_quantity) <= 0 then
    raise exception 'No available quantity remains for this item';
  end if;

  perform public._assert_series_member(v_inventory.series_id, v_actor_id);
  perform public._assert_series_item_use_allowed(v_inventory.series_id, v_actor_id);

  if v_inventory.behavior_code = 'open_container' then
    raise exception 'Openers are used from the Container Opener page';
  elsif lower(coalesce(v_inventory.item_code, '')) = 'deck_case'
    or lower(coalesce(v_inventory.behavior_code, '')) = 'grant_saved_deck_slot' then
    v_effect_key := 'deck_case';

    insert into public.player_series_unlocks (
      series_id,
      user_id,
      extra_saved_deck_slots,
      card_vault_slots,
      card_vault_unlocked
    )
    values (
      v_inventory.series_id,
      v_actor_id,
      1,
      0,
      false
    )
    on conflict (series_id, user_id)
    do update set
      extra_saved_deck_slots = public.player_series_unlocks.extra_saved_deck_slots + 1,
      updated_at = now();
  elsif lower(coalesce(v_inventory.item_code, '')) = 'card_vault'
    or lower(coalesce(v_inventory.behavior_code, '')) = 'grant_card_vault_slots' then
    v_effect_key := 'card_vault';

    insert into public.player_series_unlocks (
      series_id,
      user_id,
      extra_saved_deck_slots,
      card_vault_slots,
      card_vault_unlocked
    )
    values (
      v_inventory.series_id,
      v_actor_id,
      0,
      5,
      true
    )
    on conflict (series_id, user_id)
    do update set
      card_vault_slots = public.player_series_unlocks.card_vault_slots + 5,
      card_vault_unlocked = true,
      updated_at = now();
  elsif lower(coalesce(v_inventory.item_code, '')) = 'warded_sigil_i'
    or lower(coalesce(v_inventory.behavior_code, '')) = 'grant_protection_1' then
    v_effect_key := 'protection';
    v_rounds_to_add := 1;
  elsif lower(coalesce(v_inventory.item_code, '')) = 'warded_sigil_ii'
    or lower(coalesce(v_inventory.behavior_code, '')) = 'grant_protection_2' then
    v_effect_key := 'protection';
    v_rounds_to_add := 2;
  elsif lower(coalesce(v_inventory.item_code, '')) = 'chaos_sigil'
    or lower(coalesce(v_inventory.behavior_code, '')) = 'grant_protection_random_1_5' then
    v_effect_key := 'protection';
    v_rounds_to_add := floor(random() * 5 + 1)::integer;
  elsif lower(coalesce(v_inventory.behavior_code, '')) = 'grant_random_container_key' then
    v_effect_key := 'random_container_key';
    v_random_key_result := public._grant_random_unlocked_container_keys(
      v_inventory.series_id,
      v_actor_id,
      v_inventory.exact_item_family,
      1,
      v_actor_id,
      format('inventory_use:%s', coalesce(v_inventory.item_code, 'random_container_key'))
    );
  else
    raise exception 'This item needs a dedicated use modal and backend flow before it can be consumed';
  end if;

  if v_rounds_to_add > 0 then
    insert into public.player_series_protections (
      series_id,
      user_id,
      rounds_remaining,
      source_summary
    )
    values (
      v_inventory.series_id,
      v_actor_id,
      v_rounds_to_add,
      jsonb_build_array(
        jsonb_build_object(
          'item_definition_id', v_inventory.item_definition_id,
          'item_code', v_inventory.item_code,
          'item_name', v_inventory.item_name,
          'rounds_added', v_rounds_to_add
        )
      )
    )
    on conflict (series_id, user_id)
    do update set
      rounds_remaining = public.player_series_protections.rounds_remaining + excluded.rounds_remaining,
      source_summary = public.player_series_protections.source_summary || excluded.source_summary,
      updated_at = now();
  end if;

  perform public._consume_inventory_item(p_inventory_id, 1);
  perform public._mark_inventory_item_use_session_used(p_inventory_id, v_actor_id);

  return jsonb_build_object(
    'success', true,
    'effect_key', v_effect_key,
    'granted_items', coalesce(v_random_key_result -> 'granted_items', '[]'::jsonb)
  );
end;
$function$;

grant execute on function public.get_inventory_item_use_preview(uuid) to authenticated;
grant execute on function public.get_inventory_item_use_preview(uuid) to service_role;
grant execute on function public.use_inventory_item_self(uuid) to authenticated;
grant execute on function public.use_inventory_item_self(uuid) to service_role;

commit;
