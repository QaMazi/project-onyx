begin;

create or replace function public._slugify_store_code(p_value text)
returns text
language sql
immutable
as $$
  select trim(both '_' from regexp_replace(lower(coalesce(p_value, '')), '[^a-z0-9]+', '_', 'g'));
$$;

insert into public.item_categories (id, code, name)
select
  gen_random_uuid(),
  spec.code,
  spec.name
from (
  values
    ('banlist', 'Banlist'),
    ('progression', 'Progression'),
    ('chaos', 'Chaos'),
    ('protection', 'Protection'),
    ('special', 'Special'),
    ('container_openers', 'Container Openers'),
    ('currency_exchange', 'Currency Exchange')
) as spec(code, name)
where not exists (
  select 1
  from public.item_categories c
  where lower(coalesce(c.code, '')) = spec.code
);

update public.item_categories
set
  name = case lower(coalesce(code, ''))
    when 'banlist' then 'Banlist'
    when 'progression' then 'Progression'
    when 'chaos' then 'Chaos'
    when 'protection' then 'Protection'
    when 'special' then 'Special'
    when 'container_openers' then 'Container Openers'
    when 'currency_exchange' then 'Currency Exchange'
    else name
  end
where lower(coalesce(code, '')) in (
  'banlist',
  'progression',
  'chaos',
  'protection',
  'special',
  'container_openers',
  'currency_exchange'
);

update public.item_definitions i
set
  category_id = container_openers.id,
  updated_at = now()
from public.item_categories container_openers
where lower(coalesce(container_openers.code, '')) = 'container_openers'
  and i.category_id in (
    select legacy.id
    from public.item_categories legacy
    where lower(coalesce(legacy.code, '')) in ('pack_openers', 'pack_keys', 'box_keys')
  );

drop table if exists tmp_store_item_spec;

create temporary table tmp_store_item_spec (
  code text primary key,
  name text not null,
  category_code text not null,
  behavior_code text not null,
  description text,
  store_order integer not null,
  max_purchase integer,
  target_kind text,
  exact_item_family text
) on commit drop;

insert into tmp_store_item_spec (
  code,
  name,
  category_code,
  behavior_code,
  description,
  store_order,
  max_purchase,
  target_kind,
  exact_item_family
)
values
  ('chaos_verdict', 'Chaos Verdict', 'banlist', 'apply_random_banlist_to_all_opponents', 'Randomly applies a banlist state to one active-deck card from every active opponent.', 10, 99, null, null),
  ('forbidden_edict', 'Forbidden Edict', 'banlist', 'set_banlist_forbidden', 'Choose one card and move it to Forbidden.', 20, 99, null, null),
  ('limit_edict', 'Limit Edict', 'banlist', 'set_banlist_limited', 'Choose one card and move it to Limited.', 30, 99, null, null),
  ('semi_limit_edict', 'Semi-Limit Edict', 'banlist', 'set_banlist_semi_limited', 'Choose one card and move it to Semi-Limited.', 40, 99, null, null),
  ('amnesty_edict', 'Amnesty Edict', 'banlist', 'set_banlist_unlimited', 'Choose one card and restore it to Unlimited.', 50, 99, null, null),
  ('deck_case', 'Deck Case', 'progression', 'grant_saved_deck_slot', 'Consume to permanently gain +1 saved deck slot for the current series.', 110, 99, null, null),
  ('card_vault', 'Card Vault', 'progression', 'grant_card_vault_slots', 'Consume to unlock the Card Vault or add +5 more vault slots.', 120, 99, null, null),
  ('hex_idol', 'Hex Idol', 'chaos', 'curse_cards_choose_opponent', 'Choose one opponent, inspect their binder, and curse three card names until the round advances.', 210, 99, null, null),
  ('random_hex_idol', 'Random Hex Idol', 'chaos', 'curse_cards_random_opponent', 'Randomly choose one opponent, inspect their binder, and curse three card names until the round advances.', 220, 99, null, null),
  ('super_hex_idol', 'Super Hex Idol', 'chaos', 'curse_cards_all_opponents', 'Choose one card name from every opponent and curse those names until the round advances.', 230, 99, null, null),
  ('thiefs_card', 'Thief''s Card', 'chaos', 'steal_card_choose_opponent', 'Choose one opponent and steal one chosen binder card at a rarity they actually own.', 240, 99, null, null),
  ('random_thiefs_card', 'Random Thief''s Card', 'chaos', 'steal_card_random_opponent', 'Randomly choose one opponent and steal one chosen binder card at a rarity they actually own.', 250, 99, null, null),
  ('super_thiefs_card', 'Super Thief''s Card', 'chaos', 'steal_card_all_opponents', 'Choose one card from every opponent and steal the selected cards.', 260, 99, null, null),
  ('forced_exchange', 'Forced Exchange', 'chaos', 'forced_exchange_choose_opponent', 'Force an immediate 2-for-2 card swap with one opponent using the rarity floor rules.', 270, 99, null, null),
  ('random_forced_exchange', 'Random Forced Exchange', 'chaos', 'forced_exchange_random_opponent', 'Randomly choose one opponent and force an immediate 2-for-2 card swap using the rarity floor rules.', 280, 99, null, null),
  ('card_extractor', 'Card Extractor', 'chaos', 'extract_card_choose_opponent', 'Choose one opponent and remove every copy of one selected card name from their binder.', 290, 99, null, null),
  ('random_card_extractor', 'Random Card Extractor', 'chaos', 'extract_card_random_opponent', 'Randomly choose one opponent and remove every copy of one selected card name from their binder.', 300, 99, null, null),
  ('super_card_extractor', 'Super Card Extractor', 'chaos', 'extract_card_all_opponents', 'Choose one card name from every opponent and remove all copies of those names from each binder.', 310, 99, null, null),
  ('warded_sigil_i', 'Warded Sigil I', 'protection', 'grant_protection_1', 'Consume to gain 1 round of protection from hostile item targeting.', 410, 99, null, null),
  ('warded_sigil_ii', 'Warded Sigil II', 'protection', 'grant_protection_2', 'Consume to gain 2 rounds of protection from hostile item targeting.', 420, 99, null, null),
  ('chaos_sigil', 'Chaos Sigil', 'protection', 'grant_protection_random_1_5', 'Consume to gain 1 to 5 rounds of protection from hostile item targeting.', 430, 99, null, null),
  ('black_market_ticket', 'Black Market Ticket', 'special', 'black_market_ticket', 'Choose one banlisted card and add it to your binder at base rarity.', 510, 99, null, null),
  ('black_market_card', 'Black Market Card', 'special', 'black_market_card', 'Choose one banlisted card, add it to your binder at base rarity, and remove it from the banlist.', 520, 99, null, null);

update public.item_definitions i
set
  name = spec.name,
  category_id = category_match.id,
  behavior_code = spec.behavior_code,
  store_order = spec.store_order,
  max_purchase = coalesce(i.max_purchase, spec.max_purchase),
  description = spec.description,
  target_kind = spec.target_kind,
  target_id = null,
  exact_item_family = spec.exact_item_family,
  is_active = true,
  updated_at = now()
from tmp_store_item_spec spec
join public.item_categories category_match
  on lower(coalesce(category_match.code, '')) = spec.category_code
where lower(coalesce(i.code, '')) = spec.code;

insert into public.item_definitions (
  id,
  name,
  code,
  image_url,
  is_active,
  category_id,
  behavior_code,
  store_order,
  max_purchase,
  store_price,
  description,
  target_kind,
  target_id,
  exact_item_family
)
select
  gen_random_uuid(),
  spec.name,
  spec.code,
  null,
  true,
  category_match.id,
  spec.behavior_code,
  spec.store_order,
  spec.max_purchase,
  0,
  spec.description,
  spec.target_kind,
  null,
  spec.exact_item_family
from tmp_store_item_spec spec
join public.item_categories category_match
  on lower(coalesce(category_match.code, '')) = spec.category_code
where not exists (
  select 1
  from public.item_definitions i
  where lower(coalesce(i.code, '')) = spec.code
);

create or replace function public._container_opener_family_for_type(p_container_type_code text)
returns text
language plpgsql
immutable
as $function$
declare
  v_code text;
begin
  v_code := lower(trim(coalesce(p_container_type_code, '')));

  if v_code in ('full_pack', 'draft_pack') then
    return 'pack_seal_breaker';
  end if;

  if v_code = 'deck_box' then
    return 'deck_box_key';
  end if;

  if v_code = 'promo_box' then
    return 'promo_box_key';
  end if;

  return null;
end;
$function$;

create or replace function public._container_opener_suffix_for_family(p_exact_item_family text)
returns text
language plpgsql
immutable
as $function$
declare
  v_family text;
begin
  v_family := lower(trim(coalesce(p_exact_item_family, '')));

  if v_family = 'pack_seal_breaker' then
    return 'Pack Seal Breaker';
  end if;

  if v_family = 'deck_box_key' then
    return 'Deck Box Key';
  end if;

  if v_family = 'promo_box_key' then
    return 'Promo Box Key';
  end if;

  return null;
end;
$function$;

create or replace function public._sync_container_opener_item(p_container_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_container record;
  v_category_id uuid;
  v_item_family text;
  v_item_suffix text;
  v_item_code text;
  v_item_name text;
  v_existing_item record;
  v_item_id uuid;
begin
  select
    c.id,
    c.name,
    c.code,
    c.image_url,
    c.artwork_url,
    ct.code as container_type_code
  into v_container
  from public.containers c
  join public.container_types ct
    on ct.id = c.container_type_id
  where c.id = p_container_id;

  if not found then
    return null;
  end if;

  v_item_family := public._container_opener_family_for_type(v_container.container_type_code);
  v_item_suffix := public._container_opener_suffix_for_family(v_item_family);

  if v_item_family is null or v_item_suffix is null then
    return null;
  end if;

  select id
  into v_category_id
  from public.item_categories
  where lower(coalesce(code, '')) = 'container_openers'
  limit 1;

  if v_category_id is null then
    raise exception 'Container Openers category is missing';
  end if;

  v_item_code := public._slugify_store_code(v_container.code || '_' || v_item_family);
  v_item_name := trim(v_container.name) || ' ' || v_item_suffix;

  select *
  into v_existing_item
  from public.item_definitions i
  where i.target_kind = 'container'
    and i.target_id = p_container_id
  order by i.updated_at desc nulls last, i.name asc
  limit 1;

  if not found then
    select *
    into v_existing_item
    from public.item_definitions i
    where lower(coalesce(i.code, '')) = v_item_code
    order by i.updated_at desc nulls last, i.name asc
    limit 1;
  end if;

  if found then
    update public.item_definitions i
    set
      name = v_item_name,
      code = v_item_code,
      category_id = v_category_id,
      behavior_code = 'open_container',
      description = format('Consume from inventory to open %s.', trim(v_container.name)),
      image_url = coalesce(nullif(i.image_url, ''), nullif(v_container.artwork_url, ''), nullif(v_container.image_url, '')),
      target_kind = 'container',
      target_id = p_container_id,
      exact_item_family = v_item_family,
      is_active = true,
      updated_at = now()
    where i.id = v_existing_item.id
    returning i.id into v_item_id;

    return v_item_id;
  end if;

  insert into public.item_definitions (
    id,
    name,
    code,
    image_url,
    is_active,
    category_id,
    behavior_code,
    store_order,
    max_purchase,
    store_price,
    description,
    target_kind,
    target_id,
    exact_item_family
  )
  values (
    gen_random_uuid(),
    v_item_name,
    v_item_code,
    coalesce(nullif(v_container.artwork_url, ''), nullif(v_container.image_url, '')),
    true,
    v_category_id,
    'open_container',
    900,
    99,
    0,
    format('Consume from inventory to open %s.', trim(v_container.name)),
    'container',
    p_container_id,
    v_item_family
  )
  returning id into v_item_id;

  return v_item_id;
end;
$function$;

create or replace function public._sync_container_opener_item_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  perform public._sync_container_opener_item(new.id);
  return new;
end;
$function$;

drop trigger if exists trg_sync_container_opener_item on public.containers;

create trigger trg_sync_container_opener_item
after insert or update of name, code, image_url, artwork_url, container_type_id
on public.containers
for each row
execute function public._sync_container_opener_item_trigger();

do $$
declare
  v_container record;
begin
  for v_container in
    select c.id
    from public.containers c
  loop
    perform public._sync_container_opener_item(v_container.id);
  end loop;
end;
$$;

drop table if exists tmp_candidate_store_items_to_retire;

create temporary table tmp_candidate_store_items_to_retire (
  id uuid primary key
) on commit drop;

insert into tmp_candidate_store_items_to_retire (id)
select i.id
from public.item_definitions i
join public.item_categories c
  on c.id = i.category_id
where lower(coalesce(c.code, '')) in (
    'banlist',
    'progression',
    'chaos',
    'protection',
    'special',
    'currency_exchange',
    'container_openers',
    'pack_openers',
    'pack_keys',
    'box_keys'
  )
  and not exists (
    select 1
    from tmp_store_item_spec spec
    where spec.code = lower(coalesce(i.code, ''))
  )
  and not (
    coalesce(i.behavior_code, '') = 'open_container'
    and coalesce(i.target_kind, '') = 'container'
    and i.target_id is not null
  )
  and lower(coalesce(i.code, '')) not like 'universal\_%' escape '\'
  and lower(coalesce(i.code, '')) not like 'lucky\_%' escape '\';

drop table if exists tmp_deletable_store_items_to_retire;

create temporary table tmp_deletable_store_items_to_retire (
  id uuid primary key
) on commit drop;

insert into tmp_deletable_store_items_to_retire (id)
select candidate.id
from tmp_candidate_store_items_to_retire candidate
where not exists (
    select 1
    from public.player_inventory pi
    where pi.item_definition_id = candidate.id
  )
  and not exists (
    select 1
    from public.player_trade_items pti
    where pti.item_definition_id = candidate.id
  )
  and not exists (
    select 1
    from public.player_gift_items pgi
    where pgi.item_definition_id = candidate.id
  )
  and not exists (
    select 1
    from public.store_cart_items sci
    where sci.item_definition_id = candidate.id
  )
  and not exists (
    select 1
    from public.store_purchase_items spi
    where spi.item_definition_id = candidate.id
  )
  and not exists (
    select 1
    from public.series_round_reward_configs cfg
    where cfg.shared_item_definition_id = candidate.id
  )
  and not exists (
    select 1
    from public.series_round_reward_config_placements placement
    where placement.specific_item_definition_id = candidate.id
  )
  and not exists (
    select 1
    from public.player_card_curses curse
    where curse.item_definition_id = candidate.id
  );

delete from public.item_definitions i
where i.id in (
  select id
  from tmp_deletable_store_items_to_retire
);

update public.item_definitions i
set
  is_active = false,
  is_store_purchase_locked = true,
  is_reward_rng_locked = true,
  is_randomly_available = false,
  updated_at = now()
where i.id in (
  select candidate.id
  from tmp_candidate_store_items_to_retire candidate
  where candidate.id not in (
    select deletable.id
    from tmp_deletable_store_items_to_retire deletable
  )
);

create or replace function public.get_series_player_visible_binder_cards(
  p_series_id uuid,
  p_target_user_id uuid default null
)
returns setof public.binder_cards_view
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_target_user_id uuid;
begin
  v_actor_id := public._assert_authenticated_user();
  v_target_user_id := coalesce(p_target_user_id, v_actor_id);

  perform public._assert_series_member(p_series_id, v_actor_id);
  perform public._assert_series_member(p_series_id, v_target_user_id);

  return query
  select view_rows.*
  from public.binder_cards_view view_rows
  where view_rows.user_id = v_target_user_id
    and view_rows.series_id = p_series_id
    and not exists (
      select 1
      from public.player_card_vault_entries vault
      where vault.user_id = v_target_user_id
        and vault.series_id = p_series_id
        and vault.card_id = view_rows.card_id
    )
  order by view_rows.card_name asc, view_rows.rarity_sort_order asc;
end;
$function$;

create or replace function public.get_my_progression_state(p_series_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_series record;
  v_series_member boolean;
  v_can_bypass boolean;
  v_is_ready boolean := false;
  v_ready_reason text := '';
  v_starter_claimed boolean := false;
  v_dueling_status text := 'idle';
  v_active_deck record;
  v_active_deck_exported boolean := false;
  v_unlocks record;
begin
  v_actor_id := public._assert_authenticated_user();

  select
    gs.*,
    public._progression_round_step_value(gs.round_step) as round_step_value
  into v_series
  from public.game_series gs
  where gs.id = p_series_id;

  if not found then
    raise exception 'Series not found';
  end if;

  v_can_bypass := public._progression_can_bypass(v_actor_id);

  select exists (
    select 1
    from public.series_players sp
    where sp.series_id = p_series_id
      and sp.user_id = v_actor_id
  )
  into v_series_member;

  if not v_series_member and not v_can_bypass then
    raise exception 'User is not a member of this series';
  end if;

  select exists (
    select 1
    from public.player_starter_deck_claims c
    where c.series_id = p_series_id
      and c.user_id = v_actor_id
  )
  into v_starter_claimed;

  select
    true,
    coalesce(rs.ready_reason, '')
  into v_is_ready, v_ready_reason
  from public.series_phase_ready_states rs
  where rs.series_id = p_series_id
    and rs.round_number = v_series.round_number
    and rs.round_step = v_series.round_step_value
    and rs.phase = v_series.current_phase
    and rs.user_id = v_actor_id
  limit 1;

  select
    d.id,
    d.is_valid
  into v_active_deck
  from public.player_decks d
  where d.series_id = p_series_id
    and d.user_id = v_actor_id
    and d.is_active = true
  limit 1;

  if v_active_deck.id is not null then
    select exists (
      select 1
      from public.series_phase_deck_exports e
      where e.series_id = p_series_id
        and e.round_number = v_series.round_number
        and e.round_step = v_series.round_step_value
        and e.phase = v_series.current_phase
        and e.user_id = v_actor_id
        and e.deck_id = v_active_deck.id
    )
    into v_active_deck_exported;
  end if;

  if v_series_member then
    v_dueling_status := public._get_player_dueling_status(p_series_id, v_actor_id);
  end if;

  select *
  into v_unlocks
  from public.player_series_unlocks u
  where u.series_id = p_series_id
    and u.user_id = v_actor_id;

  return jsonb_build_object(
    'currentPhase', coalesce(v_series.current_phase, 'standby'),
    'roundNumber', coalesce(v_series.round_number, 0),
    'roundStep',
      case
        when v_series.round_number = 0 and v_series.current_phase = 'standby' then null
        else v_series.round_step
      end,
    'starterDeckClaimed', v_starter_claimed,
    'isReady', v_is_ready,
    'readyReason', coalesce(v_ready_reason, ''),
    'canBypassLocks', v_can_bypass,
    'duelingStatus', coalesce(v_dueling_status, 'idle'),
    'activeDeckId', v_active_deck.id,
    'activeDeckValid', coalesce(v_active_deck.is_valid, false),
    'activeDeckExported', v_active_deck_exported,
    'extraSavedDeckSlots', coalesce(v_unlocks.extra_saved_deck_slots, 0),
    'cardVaultSlots', coalesce(v_unlocks.card_vault_slots, 0),
    'cardVaultUnlocked', coalesce(v_unlocks.card_vault_unlocked, false)
  );
end;
$function$;

commit;
