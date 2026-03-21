begin;

alter table public.series_currency_exchange_settings
  alter column shards_per_feature_coin set default 150,
  alter column feature_coin_to_shards_rate set default 140,
  alter column fee_percent set default 0;

update public.series_currency_exchange_settings
set
  shards_per_feature_coin = 150,
  feature_coin_to_shards_rate = 140,
  fee_percent = 0,
  updated_at = now();

create or replace function public.get_series_currency_exchange_config(p_series_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_settings record;
begin
  v_actor_id := public._assert_authenticated_user();
  perform public._assert_series_member(p_series_id, v_actor_id);

  insert into public.series_currency_exchange_settings (
    series_id
  )
  values (p_series_id)
  on conflict (series_id) do nothing;

  select *
  into v_settings
  from public.series_currency_exchange_settings s
  where s.series_id = p_series_id;

  return jsonb_build_object(
    'series_id', p_series_id,
    'shards_per_feature_coin', v_settings.shards_per_feature_coin,
    'feature_coin_to_shards_rate', v_settings.feature_coin_to_shards_rate
  );
end;
$function$;

drop function if exists public.upsert_series_currency_exchange_config(uuid, numeric, numeric, numeric);

create or replace function public.upsert_series_currency_exchange_config(
  p_series_id uuid,
  p_shards_per_feature_coin numeric,
  p_feature_coin_to_shards_rate numeric
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_settings record;
begin
  perform public._assert_authenticated_user();
  perform public._assert_series_admin_or_admin_plus(p_series_id);

  if coalesce(p_shards_per_feature_coin, 0) <= 0 then
    raise exception 'Shards to Feature Coin rate must be greater than 0';
  end if;

  if coalesce(p_feature_coin_to_shards_rate, 0) <= 0 then
    raise exception 'Feature Coin to Shards rate must be greater than 0';
  end if;

  insert into public.series_currency_exchange_settings (
    series_id,
    shards_per_feature_coin,
    feature_coin_to_shards_rate,
    fee_percent,
    updated_at
  )
  values (
    p_series_id,
    p_shards_per_feature_coin,
    p_feature_coin_to_shards_rate,
    0,
    now()
  )
  on conflict (series_id)
  do update set
    shards_per_feature_coin = excluded.shards_per_feature_coin,
    feature_coin_to_shards_rate = excluded.feature_coin_to_shards_rate,
    fee_percent = 0,
    updated_at = now()
  returning *
  into v_settings;

  return jsonb_build_object(
    'success', true,
    'series_id', p_series_id,
    'shards_per_feature_coin', v_settings.shards_per_feature_coin,
    'feature_coin_to_shards_rate', v_settings.feature_coin_to_shards_rate
  );
end;
$function$;

create or replace function public.exchange_series_wallet_currency(
  p_series_id uuid,
  p_from_currency text,
  p_amount integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_wallet record;
  v_settings record;
  v_direction text;
  v_output integer := 0;
begin
  v_actor_id := public._assert_authenticated_user();
  perform public._assert_series_member(p_series_id, v_actor_id);

  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Exchange amount must be greater than 0';
  end if;

  insert into public.series_currency_exchange_settings (series_id)
  values (p_series_id)
  on conflict (series_id) do nothing;

  update public.series_currency_exchange_settings
  set fee_percent = 0,
      updated_at = now()
  where series_id = p_series_id
    and coalesce(fee_percent, 0) <> 0;

  select *
  into v_settings
  from public.series_currency_exchange_settings s
  where s.series_id = p_series_id
  for update;

  select *
  into v_wallet
  from public.player_wallets w
  where w.user_id = v_actor_id
    and w.series_id = p_series_id
  for update;

  if not found then
    raise exception 'Wallet not found';
  end if;

  v_direction := lower(trim(coalesce(p_from_currency, '')));

  if v_direction = 'shards' then
    if v_wallet.shards < p_amount then
      raise exception 'Not enough shards';
    end if;

    v_output := floor(p_amount::numeric / v_settings.shards_per_feature_coin)::integer;
    if v_output <= 0 then
      raise exception 'Amount is too small for the current shard to coin rate';
    end if;

    update public.player_wallets
    set
      shards = shards - p_amount,
      feature_coins = feature_coins + v_output,
      updated_at = now()
    where user_id = v_actor_id
      and series_id = p_series_id;
  elsif v_direction = 'feature_coins' then
    if v_wallet.feature_coins < p_amount then
      raise exception 'Not enough Feature Coins';
    end if;

    v_output := floor(p_amount::numeric * v_settings.feature_coin_to_shards_rate)::integer;
    if v_output <= 0 then
      raise exception 'Amount is too small for the current coin to shard rate';
    end if;

    update public.player_wallets
    set
      feature_coins = feature_coins - p_amount,
      shards = shards + v_output,
      updated_at = now()
    where user_id = v_actor_id
      and series_id = p_series_id;
  else
    raise exception 'Exchange source must be shards or feature_coins';
  end if;

  return jsonb_build_object(
    'success', true,
    'from_currency', v_direction,
    'amount_in', p_amount,
    'output_amount', v_output
  );
end;
$function$;

notify pgrst, 'reload schema';

commit;
