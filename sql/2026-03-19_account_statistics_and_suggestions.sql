begin;

create extension if not exists pgcrypto;

create table if not exists public.user_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  message text not null,
  status text not null default 'new',
  admin_note text null,
  reviewed_at timestamp with time zone null,
  reviewed_by_user_id uuid null references public.profiles (id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint user_suggestions_message_length_check
    check (char_length(btrim(message)) between 5 and 2000),
  constraint user_suggestions_status_check
    check (status in ('new', 'reviewing', 'planned', 'implemented', 'declined'))
);

create index if not exists idx_user_suggestions_user_created
  on public.user_suggestions (user_id, created_at desc);

create index if not exists idx_user_suggestions_status_created
  on public.user_suggestions (status, created_at desc);

alter table public.user_suggestions enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_suggestions'
      and policyname = 'user_suggestions_owner_select'
  ) then
    create policy user_suggestions_owner_select
      on public.user_suggestions
      for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_suggestions'
      and policyname = 'user_suggestions_owner_insert'
  ) then
    create policy user_suggestions_owner_insert
      on public.user_suggestions
      for insert
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_suggestions'
      and policyname = 'user_suggestions_admin_plus_all'
  ) then
    create policy user_suggestions_admin_plus_all
      on public.user_suggestions
      for all
      using (public.is_admin_plus_auth())
      with check (public.is_admin_plus_auth());
  end if;
end;
$$;

create or replace function public.get_my_account_statistics()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_user_id uuid;
begin
  v_user_id := public._assert_authenticated_user();

  return jsonb_build_object(
    'success', true,
    'progression',
      jsonb_build_object(
        'series_joined',
          coalesce(
            (
              select count(distinct sp.series_id)::integer
              from public.series_players sp
              where sp.user_id = v_user_id
            ),
            0
          ),
        'first_place_finishes',
          coalesce(
            (
              select count(*)::integer
              from public.series_round_results rr
              where rr.user_id = v_user_id
                and rr.placement = 1
            ),
            0
          ),
        'top_three_finishes',
          coalesce(
            (
              select count(*)::integer
              from public.series_round_results rr
              where rr.user_id = v_user_id
                and rr.placement between 1 and 3
            ),
            0
          ),
        'round_results_recorded',
          coalesce(
            (
              select count(*)::integer
              from public.series_round_results rr
              where rr.user_id = v_user_id
            ),
            0
          ),
        'total_score_awarded',
          coalesce(
            (
              select sum(coalesce(rr.score_awarded, 0))::integer
              from public.series_round_results rr
              where rr.user_id = v_user_id
            ),
            0
          ),
        'total_shards_awarded',
          coalesce(
            (
              select sum(coalesce(rr.shards_awarded, 0))::integer
              from public.series_round_results rr
              where rr.user_id = v_user_id
            ),
            0
          ),
        'reward_grants_received',
          coalesce(
            (
              select count(*)::integer
              from public.player_reward_grants prg
              where prg.granted_to_user_id = v_user_id
            ),
            0
          ),
        'matches_won',
          coalesce(
            (
              select sum(
                case
                  when sbm.player1_user_id = v_user_id then coalesce(sbm.player1_score, 0)
                  when sbm.player2_user_id = v_user_id then coalesce(sbm.player2_score, 0)
                  else 0
                end
              )::integer
              from public.series_bracket_matches sbm
              where sbm.winner_user_id = v_user_id
                and sbm.status = 'completed'
            ),
            0
          ),
        'decks_created',
          coalesce(
            (
              select count(*)::integer
              from public.player_decks d
              where d.user_id = v_user_id
            ),
            0
          ),
        'active_decks',
          coalesce(
            (
              select count(*)::integer
              from public.player_decks d
              where d.user_id = v_user_id
                and d.is_active = true
            ),
            0
          ),
        'valid_decks',
          coalesce(
            (
              select count(*)::integer
              from public.player_decks d
              where d.user_id = v_user_id
                and d.is_valid = true
            ),
            0
          ),
        'current_series',
          coalesce(
            (
              select jsonb_build_object(
                'series_id', o.series_id,
                'series_name', o.series_name,
                'current_phase', o.current_phase,
                'joined_at', o.joined_at,
                'shards', o.shards,
                'binder_unique_cards', o.binder_unique_cards,
                'binder_total_cards', o.binder_total_cards,
                'deck_count', o.deck_count,
                'active_deck_count', o.active_deck_count
              )
              from public.my_active_series_overview_view o
              limit 1
            ),
            'null'::jsonb
          )
      ),
    'deck_game',
      jsonb_build_object(
        'tracked', false,
        'message', 'Deck Game stat tracking is not live yet.'
      ),
    'mini_games',
      jsonb_build_object(
        'tracked', false,
        'message', 'Mini-game stat tracking is not live yet.'
      ),
    'premium',
      jsonb_build_object(
        'tokens',
          coalesce(
            (
              select w.gentlemen_tokens::integer
              from public.profile_premium_wallets w
              where w.user_id = v_user_id
            ),
            0
          ),
        'owned_total',
          coalesce(
            (
              select count(*)::integer
              from public.premium_store_items i
              where i.is_active = true
                and (
                  i.code in ('theme:project-onyx', 'music:egyptian-1')
                  or exists (
                    select 1
                    from public.profile_premium_unlocks u
                    where u.user_id = v_user_id
                      and u.premium_item_id = i.id
                  )
                )
            ),
            0
          ),
        'available_total',
          coalesce(
            (
              select count(*)::integer
              from public.premium_store_items i
              where i.is_active = true
            ),
            0
          ),
        'equipped_total',
          coalesce(
            (
              select count(*)::integer
              from public.profile_premium_equips e
              where e.user_id = v_user_id
            ),
            0
          ),
        'categories',
          coalesce(
            (
              select jsonb_object_agg(
                s.category_code,
                jsonb_build_object(
                  'owned', s.owned_count,
                  'total', s.total_count
                )
              )
              from (
                select
                  i.category_code,
                  count(*)::integer as total_count,
                  count(*) filter (
                    where i.code in ('theme:project-onyx', 'music:egyptian-1')
                      or exists (
                        select 1
                        from public.profile_premium_unlocks u
                        where u.user_id = v_user_id
                          and u.premium_item_id = i.id
                      )
                  )::integer as owned_count
                from public.premium_store_items i
                where i.is_active = true
                group by i.category_code
              ) s
            ),
            '{}'::jsonb
          )
      )
  );
end;
$function$;

create or replace function public.submit_user_suggestion(p_message text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_user_id uuid;
  v_message text;
  v_row public.user_suggestions%rowtype;
begin
  v_user_id := public._assert_authenticated_user();
  v_message := nullif(btrim(coalesce(p_message, '')), '');

  if v_message is null then
    raise exception 'Suggestion text is required';
  end if;

  if char_length(v_message) < 5 then
    raise exception 'Suggestion must be at least 5 characters';
  end if;

  if char_length(v_message) > 2000 then
    raise exception 'Suggestion must be 2000 characters or fewer';
  end if;

  insert into public.user_suggestions (
    user_id,
    message
  )
  values (
    v_user_id,
    v_message
  )
  returning *
  into v_row;

  return jsonb_build_object(
    'success', true,
    'suggestion',
      jsonb_build_object(
        'id', v_row.id,
        'message', v_row.message,
        'status', v_row.status,
        'admin_note', v_row.admin_note,
        'created_at', v_row.created_at,
        'updated_at', v_row.updated_at,
        'reviewed_at', v_row.reviewed_at
      )
  );
end;
$function$;

create or replace function public.get_my_user_suggestions()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_user_id uuid;
begin
  v_user_id := public._assert_authenticated_user();

  return jsonb_build_object(
    'success', true,
    'suggestions',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', s.id,
              'message', s.message,
              'status', s.status,
              'admin_note', s.admin_note,
              'created_at', s.created_at,
              'updated_at', s.updated_at,
              'reviewed_at', s.reviewed_at
            )
            order by s.created_at desc
          )
          from public.user_suggestions s
          where s.user_id = v_user_id
        ),
        '[]'::jsonb
      )
  );
end;
$function$;

create or replace function public.get_admin_user_suggestions()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  perform public._assert_admin_plus();

  return jsonb_build_object(
    'success', true,
    'suggestions',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', s.id,
              'user_id', s.user_id,
              'username', p.username,
              'avatar_url', coalesce(p.avatar_url, p.avatar),
              'message', s.message,
              'status', s.status,
              'admin_note', s.admin_note,
              'created_at', s.created_at,
              'updated_at', s.updated_at,
              'reviewed_at', s.reviewed_at,
              'reviewed_by_user_id', s.reviewed_by_user_id,
              'reviewed_by_username', reviewer.username
            )
            order by s.created_at desc
          )
          from public.user_suggestions s
          join public.profiles p
            on p.id = s.user_id
          left join public.profiles reviewer
            on reviewer.id = s.reviewed_by_user_id
        ),
        '[]'::jsonb
      )
  );
end;
$function$;

create or replace function public.update_user_suggestion_admin(
  p_suggestion_id uuid,
  p_status text default null,
  p_admin_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_admin_id uuid;
  v_status text;
  v_row public.user_suggestions%rowtype;
begin
  perform public._assert_admin_plus();
  v_admin_id := public._assert_authenticated_user();
  v_status := lower(nullif(btrim(coalesce(p_status, '')), ''));

  if p_suggestion_id is null then
    raise exception 'Suggestion id is required';
  end if;

  if v_status is not null
    and v_status not in ('new', 'reviewing', 'planned', 'implemented', 'declined') then
    raise exception 'Invalid suggestion status';
  end if;

  update public.user_suggestions s
  set
    status = coalesce(v_status, s.status),
    admin_note = case
      when p_admin_note is null then s.admin_note
      else nullif(btrim(p_admin_note), '')
    end,
    reviewed_at = now(),
    reviewed_by_user_id = v_admin_id,
    updated_at = now()
  where s.id = p_suggestion_id
  returning *
  into v_row;

  if v_row.id is null then
    raise exception 'Suggestion not found';
  end if;

  return jsonb_build_object(
    'success', true,
    'suggestion',
      jsonb_build_object(
        'id', v_row.id,
        'message', v_row.message,
        'status', v_row.status,
        'admin_note', v_row.admin_note,
        'created_at', v_row.created_at,
        'updated_at', v_row.updated_at,
        'reviewed_at', v_row.reviewed_at,
        'reviewed_by_user_id', v_row.reviewed_by_user_id
      )
  );
end;
$function$;

commit;
