begin;

create or replace function public.get_box_reel_preview_cards(
  p_container_id uuid,
  p_card_limit integer default 48
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_container_type_code text;
  v_limit integer := greatest(coalesce(p_card_limit, 48), 12);
begin
  if p_container_id is null then
    raise exception 'Container is required';
  end if;

  select lower(ct.code)
  into v_container_type_code
  from public.containers c
  join public.container_types ct
    on ct.id = c.container_type_id
  where c.id = p_container_id
    and coalesce(c.is_enabled, true) = true
  limit 1;

  if v_container_type_code is null then
    raise exception 'Box not found or is disabled';
  end if;

  if v_container_type_code not in ('promo_box', 'deck_box') then
    raise exception 'That container is not a box';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'card_id', reel.card_id,
          'card_name', reel.card_name,
          'image_url', reel.image_url,
          'tier_id', reel.tier_id,
          'tier_code', reel.tier_code,
          'tier_name', reel.tier_name
        )
        order by reel.sort_index
      )
      from (
        select
          sampled.card_id,
          sampled.card_name,
          sampled.image_url,
          sampled.tier_id,
          sampled.tier_code,
          sampled.tier_name,
          row_number() over () as sort_index
        from (
          select
            cc.card_id,
            c.name as card_name,
            c.image_url,
            cc.tier_id,
            coalesce(t.code, 'tier1') as tier_code,
            coalesce(t.name, 'Bulk') as tier_name
          from public.container_cards cc
          join public.cards c
            on c.id = cc.card_id
          left join public.card_tiers t
            on t.id = cc.tier_id
          where cc.container_id = p_container_id
            and coalesce(cc.is_enabled, true) = true
          order by random()
          limit v_limit
        ) sampled
      ) reel
    ),
    '[]'::jsonb
  );
end;
$function$;

grant execute on function public.get_box_reel_preview_cards(uuid, integer) to authenticated;
grant execute on function public.get_box_reel_preview_cards(uuid, integer) to service_role;

commit;
