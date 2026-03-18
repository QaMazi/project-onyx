create or replace function public._assert_progression_admin()
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.is_admin_auth() then
    raise exception 'Admin required';
  end if;
end;
$function$;

do $sql$
declare
  v_target regprocedure;
  v_sql text;
  v_targets regprocedure[] := array[
    'public.assign_series_starter_decks(uuid,uuid[])'::regprocedure,
    'public.upsert_starter_deck_template(uuid,text,text,jsonb)'::regprocedure,
    'public.delete_starter_deck_template(uuid)'::regprocedure,
    'public.give_series_player_shards(uuid,uuid,integer)'::regprocedure,
    'public.give_series_player_feature_coins(uuid,uuid,integer)'::regprocedure,
    'public.give_series_player_item(uuid,uuid,uuid,integer)'::regprocedure,
    'public.give_series_player_card(uuid,uuid,bigint,uuid,integer)'::regprocedure,
    'public.get_container_type_options_admin()'::regprocedure,
    'public.create_container_admin(text,text,text,uuid,text,integer,text,integer,integer,text,boolean,boolean)'::regprocedure,
    'public.update_container_admin(uuid,text,text,text,uuid,text,integer,text,integer,integer,text,boolean,boolean)'::regprocedure,
    'public.set_container_lock_admin(uuid,boolean)'::regprocedure,
    'public.delete_container_admin(uuid)'::regprocedure,
    'public.get_pack_products_admin()'::regprocedure,
    'public.get_pack_pool_tiers_admin()'::regprocedure,
    'public.get_pack_product_admin(text)'::regprocedure,
    'public.upsert_pack_product_admin(text,text,text,text,text,text,text,boolean,boolean,jsonb,jsonb)'::regprocedure,
    'public.delete_pack_product_admin(text)'::regprocedure,
    'public.set_store_item_admin_state(uuid,integer,boolean,boolean,boolean)'::regprocedure,
    'public.randomize_store_item_availability(text,numeric)'::regprocedure
  ];
begin
  foreach v_target in array v_targets loop
    v_sql := replace(
      pg_get_functiondef(v_target),
      'perform public._assert_admin_plus();',
      'perform public._assert_progression_admin();'
    );

    execute v_sql;
  end loop;
end;
$sql$;
