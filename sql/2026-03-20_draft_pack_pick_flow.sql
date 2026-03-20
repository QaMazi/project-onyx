begin;

create table if not exists public.player_draft_pack_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  series_id uuid not null references public.game_series(id) on delete cascade,
  container_id uuid not null references public.containers(id) on delete cascade,
  opening_count integer not null,
  current_opening_index integer not null default 1,
  is_completed boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint player_draft_pack_sessions_opening_count_check check (opening_count > 0),
  constraint player_draft_pack_sessions_current_opening_index_check check (current_opening_index > 0)
);

create unique index if not exists player_draft_pack_sessions_one_active_per_user_series_idx
  on public.player_draft_pack_sessions (user_id, series_id)
  where is_completed = false;

create table if not exists public.player_draft_pack_openings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.player_draft_pack_sessions(id) on delete cascade,
  open_index integer not null,
  container_id uuid not null references public.containers(id) on delete cascade,
  container_name text not null,
  container_code text not null,
  container_image_url text,
  cards_per_open integer not null,
  selected_card_id bigint,
  selected_rarity_id uuid references public.card_rarities(id),
  selected_tier_id uuid,
  selected_slot_index integer,
  selected_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint player_draft_pack_openings_open_index_unique unique (session_id, open_index)
);

create table if not exists public.player_draft_pack_opening_cards (
  id uuid primary key default gen_random_uuid(),
  opening_id uuid not null references public.player_draft_pack_openings(id) on delete cascade,
  card_id bigint not null references public.cards(id) on delete cascade,
  card_name text not null,
  image_url text,
  tier_id uuid,
  tier_code text,
  tier_name text,
  rarity_id uuid references public.card_rarities(id),
  rarity_code text,
  rarity_name text,
  slot_index integer not null,
  created_at timestamp with time zone not null default now(),
  constraint player_draft_pack_opening_cards_opening_slot_unique unique (opening_id, slot_index)
);

create index if not exists player_draft_pack_openings_session_idx
  on public.player_draft_pack_openings (session_id, open_index);

create index if not exists player_draft_pack_opening_cards_opening_idx
  on public.player_draft_pack_opening_cards (opening_id, slot_index);

create or replace function public.get_my_active_draft_pack_session(p_series_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_user_id uuid;
  v_session record;
begin
  v_user_id := public._assert_authenticated_user();

  if p_series_id is null then
    raise exception 'Series is required';
  end if;

  perform public._assert_series_member(p_series_id, v_user_id);

  select
    s.*,
    greatest(
      coalesce(
        (
          select min(o.open_index) - 1
          from public.player_draft_pack_openings o
          where o.session_id = s.id
            and o.selected_card_id is null
        ),
        0
      ),
      0
    ) as active_index
  into v_session
  from public.player_draft_pack_sessions s
  where s.user_id = v_user_id
    and s.series_id = p_series_id
    and s.is_completed = false
  order by s.created_at desc
  limit 1;

  if not found then
    return null;
  end if;

  return (
    select jsonb_build_object(
      'session_id', v_session.id,
      'series_id', v_session.series_id,
      'container_id', v_session.container_id,
      'opening_count', v_session.opening_count,
      'active_index', v_session.active_index,
      'openings',
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'opening_id', o.id,
              'open_index', o.open_index,
              'container_id', o.container_id,
              'container_name', o.container_name,
              'container_code', o.container_code,
              'container_image_url', o.container_image_url,
              'cards_per_open', o.cards_per_open,
              'selected_card_id', o.selected_card_id,
              'selected_rarity_id', o.selected_rarity_id,
              'pulls',
                coalesce(
                  (
                    select jsonb_agg(
                      jsonb_build_object(
                        'card_id', oc.card_id,
                        'card_name', oc.card_name,
                        'image_url', oc.image_url,
                        'tier_id', oc.tier_id,
                        'tier_code', oc.tier_code,
                        'tier_name', oc.tier_name,
                        'rarity_id', oc.rarity_id,
                        'rarity_code', oc.rarity_code,
                        'rarity_name', oc.rarity_name,
                        'slot_index', oc.slot_index
                      )
                      order by oc.slot_index
                    )
                    from public.player_draft_pack_opening_cards oc
                    where oc.opening_id = o.id
                  ),
                  '[]'::jsonb
                )
            )
            order by o.open_index
          ),
          '[]'::jsonb
        )
    )
    from public.player_draft_pack_openings o
    where o.session_id = v_session.id
  );
end;
$function$;

create or replace function public._build_draft_pack_preview(p_container_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
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
  v_selected_card_ids bigint[] := '{}'::bigint[];
begin
  select
    c.id, c.name, c.description, c.code, c.card_count, c.cards_per_open, ct.code as container_type_code
  into v_container
  from public.containers c
  join public.container_types ct on ct.id = c.container_type_id
  where c.id = p_container_id
    and coalesce(c.is_enabled, true) = true;

  if not found then
    raise exception 'Container not found or is disabled';
  end if;

  if lower(coalesce(v_container.container_type_code, '')) <> 'draft_pack' then
    raise exception 'That container is not a draft pack';
  end if;

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

  if v_has_pack_slot_tiers then
    for v_slot_index in 1..v_cards_per_open loop
      select cps.pack_pool_tier_id, ppt.code as tier_code, ppt.name as tier_name
      into v_selected_pack_tier
      from public.container_pack_slot_tiers cps
      join public.pack_pool_tiers ppt on ppt.id = cps.pack_pool_tier_id
      where cps.container_id = v_container.id
        and cps.slot_index = v_slot_index
        and coalesce(cps.is_enabled, true) = true
        and exists (
          select 1
          from public.container_cards cc
          where cc.container_id = v_container.id
            and coalesce(cc.is_enabled, true) = true
            and cc.pack_pool_tier_id = cps.pack_pool_tier_id
            and not (cc.card_id = any(v_selected_card_ids))
        )
      order by -ln(greatest(random(), 0.000001)) /
        greatest(coalesce(cps.weight, 1)::double precision, 0.000001)
      limit 1;

      if v_selected_pack_tier.pack_pool_tier_id is null then
        raise exception 'Draft pack slot % cannot be filled without duplicate cards', v_slot_index;
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
        and not (cc.card_id = any(v_selected_card_ids))
      order by -ln(greatest(random(), 0.000001)) /
        greatest(coalesce(cc.weight, 1)::double precision, 0.000001)
      limit 1;

      if v_selected.card_id is null then
        raise exception 'Draft pack slot % cannot be filled without duplicate cards', v_slot_index;
      end if;

      v_rolled_rarity := public._resolve_pack_card_pull_rarity(v_selected.rarity_id);
      v_selected_rarity_id := coalesce(nullif(coalesce(v_rolled_rarity ->> 'id', ''), '')::uuid, v_fallback_rarity.id);
      v_selected_rarity_code := coalesce(nullif(v_rolled_rarity ->> 'code', ''), v_fallback_rarity.code);
      v_selected_rarity_name := coalesce(nullif(v_rolled_rarity ->> 'name', ''), v_fallback_rarity.name);

      v_selected_card_ids := array_append(v_selected_card_ids, v_selected.card_id);

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
  else
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
        and not (cc.card_id = any(v_selected_card_ids))
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
        raise exception 'Draft pack slot % cannot be filled without duplicate cards', v_slot_index;
      end if;

      v_rolled_rarity := public._resolve_pack_card_pull_rarity(v_selected.rarity_id);
      v_selected_rarity_id := coalesce(nullif(coalesce(v_rolled_rarity ->> 'id', ''), '')::uuid, v_fallback_rarity.id);
      v_selected_rarity_code := coalesce(nullif(v_rolled_rarity ->> 'code', ''), v_fallback_rarity.code);
      v_selected_rarity_name := coalesce(nullif(v_rolled_rarity ->> 'name', ''), v_fallback_rarity.name);

      v_selected_card_ids := array_append(v_selected_card_ids, v_selected.card_id);

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
  end if;

  return jsonb_build_object(
    'cards_per_open', v_cards_per_open,
    'pulls', coalesce(v_pulls, '[]'::jsonb)
  );
end;
$function$;

create or replace function public.open_draft_inventory_container_batch(
  p_inventory_id uuid,
  p_open_count integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_inventory record;
  v_container record;
  v_requested_count integer := greatest(coalesce(p_open_count, 1), 1);
  v_session_id uuid;
  v_open_index integer;
  v_preview jsonb := '{}'::jsonb;
  v_opening_id uuid;
begin
  v_actor_id := public._assert_authenticated_user();

  select
    pi.id,
    pi.user_id,
    pi.series_id,
    pi.quantity,
    pi.locked_quantity,
    i.behavior_code,
    i.target_kind,
    i.target_id
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
    raise exception 'You do not own this opener';
  end if;

  if v_inventory.behavior_code <> 'open_container'
    or coalesce(v_inventory.target_kind, '') <> 'container'
    or v_inventory.target_id is null then
    raise exception 'That inventory item is not a valid opener';
  end if;

  if (v_inventory.quantity - v_inventory.locked_quantity) < v_requested_count then
    raise exception 'You do not have enough opener quantity for that many draft openings';
  end if;

  perform public._assert_series_member(v_inventory.series_id, v_actor_id);
  perform public._assert_series_item_use_allowed(v_inventory.series_id, v_actor_id);

  select
    c.id,
    c.name,
    c.description,
    c.code,
    coalesce(nullif(c.artwork_url, ''), nullif(c.image_url, '')) as image_url,
    ct.code as container_type_code
  into v_container
  from public.containers c
  join public.container_types ct
    on ct.id = c.container_type_id
  where c.id = v_inventory.target_id
    and coalesce(c.is_enabled, true) = true
  limit 1;

  if not found then
    raise exception 'Container not found or is disabled';
  end if;

  if lower(coalesce(v_container.container_type_code, '')) <> 'draft_pack' then
    raise exception 'That opener is not a draft pack';
  end if;

  select s.id
  into v_session_id
  from public.player_draft_pack_sessions s
  where s.user_id = v_actor_id
    and s.series_id = v_inventory.series_id
    and s.is_completed = false
  order by s.created_at desc
  limit 1;

  if v_session_id is not null then
    return public.get_my_active_draft_pack_session(v_inventory.series_id);
  end if;

  insert into public.player_draft_pack_sessions (
    user_id,
    series_id,
    container_id,
    opening_count,
    current_opening_index,
    is_completed
  )
  values (
    v_actor_id,
    v_inventory.series_id,
    v_container.id,
    v_requested_count,
    1,
    false
  )
  returning id into v_session_id;

  for v_open_index in 1..v_requested_count loop
    v_preview := public._build_draft_pack_preview(v_container.id);

    insert into public.player_draft_pack_openings (
      session_id,
      open_index,
      container_id,
      container_name,
      container_code,
      container_image_url,
      cards_per_open
    )
    values (
      v_session_id,
      v_open_index,
      v_container.id,
      v_container.name,
      v_container.code,
      v_container.image_url,
      coalesce((v_preview ->> 'cards_per_open')::integer, 1)
    )
    returning id into v_opening_id;

    insert into public.player_draft_pack_opening_cards (
      opening_id,
      card_id,
      card_name,
      image_url,
      tier_id,
      tier_code,
      tier_name,
      rarity_id,
      rarity_code,
      rarity_name,
      slot_index
    )
    select
      v_opening_id,
      (card ->> 'card_id')::bigint,
      coalesce(card ->> 'card_name', 'Unknown Card'),
      nullif(card ->> 'image_url', ''),
      nullif(card ->> 'tier_id', '')::uuid,
      nullif(card ->> 'tier_code', ''),
      nullif(card ->> 'tier_name', ''),
      nullif(card ->> 'rarity_id', '')::uuid,
      nullif(card ->> 'rarity_code', ''),
      nullif(card ->> 'rarity_name', ''),
      coalesce((card ->> 'slot_index')::integer, 0)
    from jsonb_array_elements(coalesce(v_preview -> 'pulls', '[]'::jsonb)) as card;
  end loop;

  perform public._consume_inventory_item(p_inventory_id, v_requested_count);

  return public.get_my_active_draft_pack_session(v_inventory.series_id);
end;
$function$;

create or replace function public.claim_draft_pack_pick(
  p_opening_id uuid,
  p_card_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_opening record;
  v_pick record;
  v_next_open_index integer;
  v_session_complete boolean := false;
begin
  v_actor_id := public._assert_authenticated_user();

  if p_opening_id is null then
    raise exception 'Draft opening is required';
  end if;

  if p_card_id is null then
    raise exception 'Draft pick card is required';
  end if;

  select
    o.id,
    o.session_id,
    o.open_index,
    o.selected_card_id,
    s.user_id,
    s.series_id,
    s.is_completed
  into v_opening
  from public.player_draft_pack_openings o
  join public.player_draft_pack_sessions s
    on s.id = o.session_id
  where o.id = p_opening_id
  for update;

  if not found then
    raise exception 'Draft opening not found';
  end if;

  if v_opening.user_id <> v_actor_id then
    raise exception 'You do not own this draft pack opening';
  end if;

  if v_opening.is_completed then
    raise exception 'This draft pack session is already complete';
  end if;

  if v_opening.selected_card_id is not null then
    raise exception 'A card has already been chosen for this draft pack';
  end if;

  select
    oc.card_id,
    oc.card_name,
    oc.image_url,
    oc.tier_id,
    oc.tier_code,
    oc.tier_name,
    oc.rarity_id,
    oc.rarity_code,
    oc.rarity_name,
    oc.slot_index
  into v_pick
  from public.player_draft_pack_opening_cards oc
  where oc.opening_id = p_opening_id
    and oc.card_id = p_card_id
  limit 1;

  if v_pick.card_id is null then
    raise exception 'That card is not in this draft pack opening';
  end if;

  insert into public.binder_cards (
    user_id,
    series_id,
    card_id,
    rarity_id,
    quantity,
    is_trade_locked
  )
  values (
    v_actor_id,
    v_opening.series_id,
    v_pick.card_id,
    v_pick.rarity_id,
    1,
    false
  )
  on conflict (user_id, series_id, card_id, rarity_id)
  do update
    set quantity = public.binder_cards.quantity + 1,
        updated_at = now();

  update public.player_draft_pack_openings
  set
    selected_card_id = v_pick.card_id,
    selected_rarity_id = v_pick.rarity_id,
    selected_tier_id = v_pick.tier_id,
    selected_slot_index = v_pick.slot_index,
    selected_at = now(),
    updated_at = now()
  where id = p_opening_id;

  select min(o.open_index)
  into v_next_open_index
  from public.player_draft_pack_openings o
  where o.session_id = v_opening.session_id
    and o.selected_card_id is null;

  if v_next_open_index is null then
    update public.player_draft_pack_sessions
    set
      is_completed = true,
      current_opening_index = opening_count,
      updated_at = now()
    where id = v_opening.session_id;

    v_session_complete := true;
  else
    update public.player_draft_pack_sessions
    set
      current_opening_index = v_next_open_index,
      updated_at = now()
    where id = v_opening.session_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'session_complete', v_session_complete,
    'selected_card',
      jsonb_build_object(
        'card_id', v_pick.card_id,
        'card_name', v_pick.card_name,
        'image_url', v_pick.image_url,
        'tier_id', v_pick.tier_id,
        'tier_code', v_pick.tier_code,
        'tier_name', v_pick.tier_name,
        'rarity_id', v_pick.rarity_id,
        'rarity_code', v_pick.rarity_code,
        'rarity_name', v_pick.rarity_name,
        'slot_index', v_pick.slot_index
      ),
    'session', public.get_my_active_draft_pack_session(v_opening.series_id)
  );
end;
$function$;

grant execute on function public.get_my_active_draft_pack_session(uuid) to authenticated;
grant execute on function public.get_my_active_draft_pack_session(uuid) to service_role;

grant execute on function public._build_draft_pack_preview(uuid) to service_role;

grant execute on function public.open_draft_inventory_container_batch(uuid, integer) to authenticated;
grant execute on function public.open_draft_inventory_container_batch(uuid, integer) to service_role;

grant execute on function public.claim_draft_pack_pick(uuid, bigint) to authenticated;
grant execute on function public.claim_draft_pack_pick(uuid, bigint) to service_role;

commit;
