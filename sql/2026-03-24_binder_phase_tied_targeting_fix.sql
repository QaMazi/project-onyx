create or replace function public._is_binder_phase_target_eligible(
  p_series_id uuid,
  p_actor_id uuid,
  p_target_user_id uuid,
  p_actor_overall_position integer default null
)
returns boolean
language sql
security definer
set search_path to 'public', 'auth'
as $function$
  with scoreboard as (
    select
      (entry ->> 'user_id')::uuid as user_id,
      nullif(entry ->> 'position', '')::integer as overall_position,
      nullif(entry ->> 'points', '')::integer as total_points,
      nullif(entry ->> 'shards', '')::integer as total_shards
    from jsonb_array_elements(public._build_series_scoreboard_json(p_series_id)) entry
  ),
  actor_row as (
    select
      coalesce(p_actor_overall_position, scoreboard.overall_position) as actor_overall_position,
      scoreboard.total_points as actor_total_points,
      scoreboard.total_shards as actor_total_shards
    from scoreboard
    where scoreboard.user_id = p_actor_id
    limit 1
  )
  select exists (
    select 1
    from public.series_players sp
    join scoreboard target_row
      on target_row.user_id = sp.user_id
    cross join actor_row
    left join public.player_series_protections protection
      on protection.series_id = sp.series_id
     and protection.user_id = sp.user_id
     and protection.rounds_remaining > 0
    where sp.series_id = p_series_id
      and sp.user_id = p_target_user_id
      and sp.user_id <> p_actor_id
      and protection.id is null
      and actor_row.actor_overall_position is not null
      and target_row.overall_position is not null
      and (
        target_row.overall_position < actor_row.actor_overall_position
        or (
          target_row.total_points is not null
          and actor_row.actor_total_points is not null
          and target_row.total_shards is not null
          and actor_row.actor_total_shards is not null
          and target_row.total_points = actor_row.actor_total_points
          and target_row.total_shards = actor_row.actor_total_shards
        )
      )
  );
$function$;

create or replace function public._binder_phase_target_pool_json(
  p_series_id uuid,
  p_actor_id uuid,
  p_actor_overall_position integer default null
)
returns jsonb
language sql
security definer
set search_path to 'public', 'auth'
as $function$
  with scoreboard as (
    select
      (entry ->> 'user_id')::uuid as user_id,
      nullif(entry ->> 'position', '')::integer as overall_position,
      nullif(entry ->> 'points', '')::integer as total_points,
      nullif(entry ->> 'shards', '')::integer as total_shards
    from jsonb_array_elements(public._build_series_scoreboard_json(p_series_id)) entry
  ),
  actor_row as (
    select
      coalesce(p_actor_overall_position, scoreboard.overall_position) as actor_overall_position,
      scoreboard.total_points as actor_total_points,
      scoreboard.total_shards as actor_total_shards
    from scoreboard
    where scoreboard.user_id = p_actor_id
    limit 1
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', sp.user_id,
        'username', coalesce(spv.username, 'Unknown Duelist'),
        'avatar', coalesce(spv.avatar, ''),
        'overall_position', scoreboard.overall_position
      )
      order by scoreboard.overall_position asc, coalesce(spv.username, 'Unknown Duelist') asc
    ),
    '[]'::jsonb
  )
  from public.series_players sp
  join scoreboard
    on scoreboard.user_id = sp.user_id
  cross join actor_row
  left join public.series_players_view spv
    on spv.series_id = sp.series_id
   and spv.user_id = sp.user_id
  left join public.player_series_protections protection
    on protection.series_id = sp.series_id
   and protection.user_id = sp.user_id
   and protection.rounds_remaining > 0
  where sp.series_id = p_series_id
    and sp.user_id <> p_actor_id
    and protection.id is null
    and actor_row.actor_overall_position is not null
    and scoreboard.overall_position is not null
    and (
      scoreboard.overall_position < actor_row.actor_overall_position
      or (
        scoreboard.total_points is not null
        and actor_row.actor_total_points is not null
        and scoreboard.total_shards is not null
        and actor_row.actor_total_shards is not null
        and scoreboard.total_points = actor_row.actor_total_points
        and scoreboard.total_shards = actor_row.actor_total_shards
      )
    );
$function$;
