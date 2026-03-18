begin;

create table if not exists public.player_card_vault_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    references auth.users (id)
    on delete cascade,
  series_id uuid not null
    references public.game_series (id)
    on delete cascade,
  card_id bigint not null
    references public.cards (id)
    on delete cascade,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (user_id, series_id, card_id)
);

create or replace function public.get_series_player_protection_strip(p_series_id uuid)
returns table (
  user_id uuid,
  rounds_remaining integer
)
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
begin
  v_actor_id := public._assert_authenticated_user();
  perform public._assert_series_member(p_series_id, v_actor_id);

  return query
  select
    p.user_id,
    p.rounds_remaining
  from public.player_series_protections p
  where p.series_id = p_series_id
    and p.rounds_remaining > 0;
end;
$function$;

create or replace function public.get_my_binder_cards(p_series_id uuid)
returns setof public.binder_cards_view
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
begin
  v_actor_id := public._assert_authenticated_user();
  perform public._assert_series_member(p_series_id, v_actor_id);

  return query
  select view_rows.*
  from public.binder_cards_view view_rows
  where view_rows.user_id = v_actor_id
    and view_rows.series_id = p_series_id
    and not exists (
      select 1
      from public.player_card_vault_entries vault
      where vault.user_id = v_actor_id
        and vault.series_id = p_series_id
        and vault.card_id = view_rows.card_id
    )
  order by view_rows.card_name asc, view_rows.rarity_sort_order asc;
end;
$function$;

create or replace function public.get_my_vault_cards(p_series_id uuid)
returns setof public.binder_cards_view
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
begin
  v_actor_id := public._assert_authenticated_user();
  perform public._assert_series_member(p_series_id, v_actor_id);

  return query
  select view_rows.*
  from public.binder_cards_view view_rows
  where view_rows.user_id = v_actor_id
    and view_rows.series_id = p_series_id
    and exists (
      select 1
      from public.player_card_vault_entries vault
      where vault.user_id = v_actor_id
        and vault.series_id = p_series_id
        and vault.card_id = view_rows.card_id
    )
  order by view_rows.card_name asc, view_rows.rarity_sort_order asc;
end;
$function$;

create or replace function public.get_my_vault_summary(p_series_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_unlocks record;
  v_used_slots integer := 0;
begin
  v_actor_id := public._assert_authenticated_user();
  perform public._assert_series_member(p_series_id, v_actor_id);

  select *
  into v_unlocks
  from public.player_series_unlocks u
  where u.series_id = p_series_id
    and u.user_id = v_actor_id;

  select count(*)
  into v_used_slots
  from public.player_card_vault_entries vault
  where vault.user_id = v_actor_id
    and vault.series_id = p_series_id;

  return jsonb_build_object(
    'series_id', p_series_id,
    'vault_unlocked', coalesce(v_unlocks.card_vault_unlocked, false),
    'vault_slots_total', coalesce(v_unlocks.card_vault_slots, 0),
    'vault_slots_used', coalesce(v_used_slots, 0),
    'vault_slots_remaining', greatest(coalesce(v_unlocks.card_vault_slots, 0) - coalesce(v_used_slots, 0), 0)
  );
end;
$function$;

create or replace function public.move_binder_card_family_to_vault(p_binder_card_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_target record;
  v_unlocks record;
  v_used_slots integer := 0;
begin
  v_actor_id := public._assert_authenticated_user();

  select
    bc.id,
    bc.user_id,
    bc.series_id,
    bc.card_id
  into v_target
  from public.binder_cards bc
  where bc.id = p_binder_card_id;

  if not found then
    raise exception 'Binder card not found';
  end if;

  if v_target.user_id <> v_actor_id then
    raise exception 'You do not own this binder card';
  end if;

  perform public._assert_series_member(v_target.series_id, v_actor_id);

  if exists (
    select 1
    from public.binder_cards bc
    where bc.user_id = v_actor_id
      and bc.series_id = v_target.series_id
      and bc.card_id = v_target.card_id
      and bc.is_trade_locked = true
  ) then
    raise exception 'Trade-locked copies cannot be moved into the vault';
  end if;

  select *
  into v_unlocks
  from public.player_series_unlocks u
  where u.series_id = v_target.series_id
    and u.user_id = v_actor_id;

  if not coalesce(v_unlocks.card_vault_unlocked, false) then
    raise exception 'Your Card Vault is not unlocked yet';
  end if;

  if exists (
    select 1
    from public.player_card_vault_entries vault
    where vault.user_id = v_actor_id
      and vault.series_id = v_target.series_id
      and vault.card_id = v_target.card_id
  ) then
    return jsonb_build_object(
      'success', true,
      'already_vaulted', true,
      'card_id', v_target.card_id
    );
  end if;

  select count(*)
  into v_used_slots
  from public.player_card_vault_entries vault
  where vault.user_id = v_actor_id
    and vault.series_id = v_target.series_id;

  if v_used_slots >= coalesce(v_unlocks.card_vault_slots, 0) then
    raise exception 'Your Card Vault is full';
  end if;

  insert into public.player_card_vault_entries (
    user_id,
    series_id,
    card_id
  )
  values (
    v_actor_id,
    v_target.series_id,
    v_target.card_id
  )
  on conflict (user_id, series_id, card_id)
  do update set
    updated_at = now();

  return public.get_my_vault_summary(v_target.series_id);
end;
$function$;

create or replace function public.move_vault_card_family_to_binder(p_binder_card_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_target record;
begin
  v_actor_id := public._assert_authenticated_user();

  select
    bc.id,
    bc.user_id,
    bc.series_id,
    bc.card_id
  into v_target
  from public.binder_cards bc
  where bc.id = p_binder_card_id;

  if not found then
    raise exception 'Binder card not found';
  end if;

  if v_target.user_id <> v_actor_id then
    raise exception 'You do not own this binder card';
  end if;

  perform public._assert_series_member(v_target.series_id, v_actor_id);

  delete from public.player_card_vault_entries
  where user_id = v_actor_id
    and series_id = v_target.series_id
    and card_id = v_target.card_id;

  return public.get_my_vault_summary(v_target.series_id);
end;
$function$;

commit;
