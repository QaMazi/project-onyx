begin;

create or replace function public._set_series_banlist_card_status(
  p_series_id uuid,
  p_card_id bigint,
  p_status text,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_series record;
  v_actor_id uuid;
  v_existing_row record;
  v_status text := lower(trim(coalesce(p_status, '')));
begin
  v_actor_id := public._assert_authenticated_user();

  if v_status not in ('forbidden', 'limited', 'semi_limited', 'unlimited') then
    raise exception 'Unsupported banlist status';
  end if;

  select
    gs.round_number,
    public._progression_round_step_value(gs.round_step) as round_step_value
  into v_series
  from public.game_series gs
  where gs.id = p_series_id;

  if not found then
    raise exception 'Series not found';
  end if;

  select *
  into v_existing_row
  from public.series_banlist_cards existing_rows
  where existing_rows.series_id = p_series_id
    and existing_rows.card_id = p_card_id;

  if v_existing_row.id is not null
     and coalesce(v_existing_row.modified_round_number, -1) = coalesce(v_series.round_number, -1)
     and coalesce(v_existing_row.modified_round_step, -1) = coalesce(v_series.round_step_value, -1) then
    raise exception 'Bans cannot be changed during the same round they were added';
  end if;

  if v_status in ('forbidden', 'limited', 'semi_limited')
     and lower(coalesce(v_existing_row.source_kind, 'custom')) = 'era' then
    raise exception 'Era banlist cards can only be changed by choosing Unlimited';
  end if;

  if v_status = 'unlimited' then
    if v_existing_row.id is null then
      raise exception 'Choose a card that is currently on the series banlist';
    end if;

    if lower(coalesce(v_existing_row.status, '')) = 'unlimited' then
      raise exception 'That card is already Unlimited';
    end if;
  end if;

  perform public._upsert_series_banlist_entry(
    p_series_id,
    p_card_id,
    v_status,
    'custom',
    p_notes,
    v_series.round_number,
    v_series.round_step_value,
    v_actor_id
  );
end;
$function$;

with flagged_items as (
  select
    i.id,
    case
      when lower(coalesce(c.code, '')) = 'container_openers' then true
      when lower(coalesce(i.code, '')) in (
        'forbidden_edict',
        'limit_edict',
        'semi_limit_edict',
        'amnesty_edict',
        'thiefs_card'
      ) then true
      else false
    end as should_keep
  from public.item_definitions i
  left join public.item_categories c
    on c.id = i.category_id
)
update public.item_definitions i
set
  is_active = flagged_items.should_keep,
  is_store_purchase_locked = case
    when flagged_items.should_keep then i.is_store_purchase_locked
    else true
  end,
  is_randomly_available = case
    when flagged_items.should_keep then i.is_randomly_available
    else false
  end,
  updated_at = now()
from flagged_items
where flagged_items.id = i.id
  and (
    i.is_active is distinct from flagged_items.should_keep
    or (flagged_items.should_keep = false and coalesce(i.is_store_purchase_locked, false) = false)
    or (flagged_items.should_keep = false and coalesce(i.is_randomly_available, true) = true)
  );

delete from public.store_cart_items cart_items
using public.item_definitions i
left join public.item_categories c
  on c.id = i.category_id
where cart_items.item_definition_id = i.id
  and not (
    lower(coalesce(c.code, '')) = 'container_openers'
    or lower(coalesce(i.code, '')) in (
      'forbidden_edict',
      'limit_edict',
      'semi_limit_edict',
      'amnesty_edict',
      'thiefs_card'
    )
  );

commit;
