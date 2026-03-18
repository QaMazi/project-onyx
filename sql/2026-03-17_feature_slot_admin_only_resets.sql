begin;

create or replace function public.reset_player_feature_slot_usage(
  p_series_id uuid,
  p_target_user_id uuid,
  p_feature_slot_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_deleted_count integer := 0;
  v_actor_id uuid;
  v_actor_role text;
begin
  v_actor_id := public._assert_authenticated_user();

  select p.global_role
  into v_actor_role
  from public.profiles p
  where p.id = v_actor_id;

  if coalesce(v_actor_role, '') not in ('Admin', 'Admin+') then
    raise exception 'Only admins can reset feature slot usage';
  end if;

  if p_target_user_id is null then
    raise exception 'Target user is required';
  end if;

  if p_feature_slot_id is null then
    delete from public.player_feature_slot_sessions
    where series_id = p_series_id
      and user_id = p_target_user_id;

    delete from public.player_feature_slot_usage
    where series_id = p_series_id
      and user_id = p_target_user_id;
  else
    delete from public.player_feature_slot_sessions
    where series_id = p_series_id
      and user_id = p_target_user_id
      and feature_slot_id = p_feature_slot_id;

    delete from public.player_feature_slot_usage
    where series_id = p_series_id
      and user_id = p_target_user_id
      and feature_slot_id = p_feature_slot_id;
  end if;

  get diagnostics v_deleted_count = row_count;

  return jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count
  );
end;
$function$;

create or replace function public.reset_series_feature_slot_usage(p_series_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_deleted_count integer := 0;
  v_actor_id uuid;
  v_actor_role text;
begin
  v_actor_id := public._assert_authenticated_user();

  select p.global_role
  into v_actor_role
  from public.profiles p
  where p.id = v_actor_id;

  if coalesce(v_actor_role, '') not in ('Admin', 'Admin+') then
    raise exception 'Only admins can reset feature slot usage';
  end if;

  delete from public.player_feature_slot_sessions
  where series_id = p_series_id;

  delete from public.player_feature_slot_usage
  where series_id = p_series_id;

  get diagnostics v_deleted_count = row_count;

  return jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count
  );
end;
$function$;

commit;
