begin;

alter table public.containers
  drop constraint if exists containers_pack_number_code_check;

alter table public.containers
  add constraint containers_pack_number_code_check
  check (
    pack_number_code is null
    or trim(pack_number_code) ~ '^(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2})$'
  );

create or replace function public._normalize_pack_number_code(p_value text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_normalized text := trim(coalesce(p_value, ''));
begin
  if v_normalized = '' then
    raise exception 'Pack Number is required';
  end if;

  if v_normalized !~ '^(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2})$' then
    raise exception 'Pack Number must be exactly 3 digits from 001 to 999';
  end if;

  return v_normalized;
end;
$function$;

create or replace function public.get_pack_products_admin()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  perform public._assert_progression_admin();

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'pack_group_code', full_container.pack_group_code,
        'pack_number_code', nullif(trim(coalesce(full_container.pack_number_code, '')), ''),
        'is_reward_pack', full_container.is_reward_pack,
        'name', full_container.name,
        'code', full_container.code,
        'description', full_container.description,
        'image_url', coalesce(nullif(full_container.artwork_url, ''), nullif(full_container.image_url, '')),
        'content_mode', full_container.content_mode,
        'is_enabled', coalesce(full_container.is_enabled, true),
        'is_locked', coalesce(full_container.is_locked, false),
        'cards_per_open', coalesce(full_container.cards_per_open, full_container.card_count, 9),
        'full_container_id', full_container.id,
        'draft_container_id', draft_container.id
      )
      order by
        case when full_container.is_reward_pack then 1 else 0 end,
        case
          when trim(coalesce(full_container.pack_number_code, '')) ~ '^(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2})$'
            then trim(full_container.pack_number_code)::integer
          else 9999
        end,
        lower(full_container.name),
        lower(full_container.code)
    )
    from public.containers full_container
    left join public.containers draft_container
      on draft_container.pack_group_code = full_container.pack_group_code
     and draft_container.pack_variant = 'draft'
    where full_container.pack_group_code is not null
      and full_container.pack_variant = 'full'
  ), '[]'::jsonb);
end;
$function$;

commit;
