begin;

create or replace function public.get_my_premium_state()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_tokens integer := 0;
  v_is_admin_plus boolean := false;
  v_auto_enabled boolean := true;
  v_showcase record;
begin
  v_actor_id := public._assert_authenticated_user();
  perform public._ensure_profile_premium_wallet(v_actor_id);

  select w.gentlemen_tokens
  into v_tokens
  from public.profile_premium_wallets w
  where w.user_id = v_actor_id;

  select p.global_role = 'Admin+'
  into v_is_admin_plus
  from public.profiles p
  where p.id = v_actor_id;

  select auto_main_round_tokens_enabled
  into v_auto_enabled
  from public.premium_system_settings
  where singleton = true;

  insert into public.profile_showcase_settings (user_id)
  values (v_actor_id)
  on conflict (user_id) do nothing;

  select
    s.*,
    c.name as featured_card_name,
    c.image_url as featured_card_image_url
  into v_showcase
  from public.profile_showcase_settings s
  left join public.cards c
    on c.id = s.featured_card_id
  where s.user_id = v_actor_id;

  return jsonb_build_object(
    'success', true,
    'tokens', coalesce(v_tokens, 0),
    'is_admin_plus', coalesce(v_is_admin_plus, false),
    'auto_main_round_tokens_enabled', coalesce(v_auto_enabled, true),
    'catalog',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', i.id,
              'code', i.code,
              'name', i.name,
              'description', i.description,
              'category_code', i.category_code,
              'slot_code', i.slot_code,
              'image_url', i.image_url,
              'preview_audio_url', i.preview_audio_url,
              'price', i.price,
              'sort_order', i.sort_order,
              'season_code', i.season_code,
              'metadata', i.metadata,
              'is_active', i.is_active,
              'is_owned',
                (u.id is not null or i.code in ('theme:project-onyx', 'music:egyptian-1')),
              'is_equipped', (e.premium_item_id is not null)
            )
            order by i.category_code, i.sort_order, i.name
          )
          from public.premium_store_items i
          left join public.profile_premium_unlocks u
            on u.user_id = v_actor_id
           and u.premium_item_id = i.id
          left join public.profile_premium_equips e
            on e.user_id = v_actor_id
           and e.premium_item_id = i.id
          where i.is_active = true
        ),
        '[]'::jsonb
      ),
    'equipped_by_slot',
      coalesce(
        (
          select jsonb_object_agg(
            e.slot_code,
            jsonb_build_object(
              'item_id', i.id,
              'code', i.code,
              'name', i.name,
              'metadata', i.metadata,
              'image_url', i.image_url
            )
          )
          from public.profile_premium_equips e
          join public.premium_store_items i
            on i.id = e.premium_item_id
          where e.user_id = v_actor_id
        ),
        '{}'::jsonb
      ),
    'showcase',
      jsonb_build_object(
        'is_public', coalesce(v_showcase.is_public, false),
        'headline', v_showcase.headline,
        'subheadline', v_showcase.subheadline,
        'deck_spotlight_title', v_showcase.deck_spotlight_title,
        'deck_spotlight_text', v_showcase.deck_spotlight_text,
        'featured_card_id', v_showcase.featured_card_id,
        'featured_card_name', v_showcase.featured_card_name,
        'featured_card_image_url', v_showcase.featured_card_image_url,
        'featured_card_note', v_showcase.featured_card_note,
        'flex_title', v_showcase.flex_title,
        'flex_text', v_showcase.flex_text,
        'highlight_title', v_showcase.highlight_title,
        'highlight_text', v_showcase.highlight_text,
        'updated_at', v_showcase.updated_at
      )
  );
end;
$function$;

create or replace function public.purchase_premium_item(
  p_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_item record;
  v_balance integer;
begin
  v_actor_id := public._assert_authenticated_user();

  select *
  into v_item
  from public.premium_store_items i
  where i.id = p_item_id
    and i.is_active = true
  for update;

  if not found then
    raise exception 'Premium item not found';
  end if;

  if v_item.code in ('theme:project-onyx', 'music:egyptian-1') or exists (
    select 1
    from public.profile_premium_unlocks u
    where u.user_id = v_actor_id
      and u.premium_item_id = p_item_id
  ) then
    raise exception 'Premium item is already owned';
  end if;

  v_balance := public._grant_gentlemens_tokens(
    v_actor_id,
    -coalesce(v_item.price, 0),
    'premium_purchase',
    format('Purchased %s', v_item.name),
    null,
    null,
    v_actor_id
  );

  insert into public.profile_premium_unlocks (
    user_id,
    premium_item_id,
    purchased_price
  )
  values (
    v_actor_id,
    v_item.id,
    coalesce(v_item.price, 0)
  )
  on conflict (user_id, premium_item_id) do nothing;

  return jsonb_build_object(
    'success', true,
    'item_id', v_item.id,
    'code', v_item.code,
    'remaining_tokens', v_balance
  );
end;
$function$;

create or replace function public.equip_premium_item(
  p_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_item record;
begin
  v_actor_id := public._assert_authenticated_user();

  select *
  into v_item
  from public.premium_store_items i
  where i.id = p_item_id
    and i.is_active = true;

  if not found then
    raise exception 'Premium item not found';
  end if;

  if v_item.code not in ('theme:project-onyx', 'music:egyptian-1') and not exists (
    select 1
    from public.profile_premium_unlocks u
    where u.user_id = v_actor_id
      and u.premium_item_id = p_item_id
  ) then
    raise exception 'Premium item is not owned';
  end if;

  insert into public.profile_premium_equips (
    user_id,
    slot_code,
    premium_item_id,
    updated_at
  )
  values (
    v_actor_id,
    v_item.slot_code,
    v_item.id,
    now()
  )
  on conflict (user_id, slot_code)
  do update set
    premium_item_id = excluded.premium_item_id,
    updated_at = now();

  return jsonb_build_object(
    'success', true,
    'slot_code', v_item.slot_code,
    'item_id', v_item.id,
    'code', v_item.code
  );
end;
$function$;

commit;
