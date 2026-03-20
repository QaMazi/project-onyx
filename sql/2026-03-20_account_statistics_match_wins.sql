begin;

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

commit;
