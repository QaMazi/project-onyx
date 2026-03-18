begin;

drop table if exists tmp_final_store_item_codes;

create temporary table tmp_final_store_item_codes (
  code text primary key
) on commit drop;

insert into tmp_final_store_item_codes (code)
values
  ('chaos_verdict'),
  ('forbidden_edict'),
  ('limit_edict'),
  ('semi_limit_edict'),
  ('amnesty_edict'),
  ('deck_case'),
  ('card_vault'),
  ('hex_idol'),
  ('random_hex_idol'),
  ('super_hex_idol'),
  ('thiefs_card'),
  ('random_thiefs_card'),
  ('super_thiefs_card'),
  ('forced_exchange'),
  ('random_forced_exchange'),
  ('card_extractor'),
  ('random_card_extractor'),
  ('super_card_extractor'),
  ('warded_sigil_i'),
  ('warded_sigil_ii'),
  ('chaos_sigil'),
  ('black_market_ticket'),
  ('black_market_card');

drop table if exists tmp_non_spec_store_items;

create temporary table tmp_non_spec_store_items (
  id uuid primary key
) on commit drop;

insert into tmp_non_spec_store_items (id)
select i.id
from public.item_definitions i
left join public.item_categories c
  on c.id = i.category_id
where coalesce(i.is_active, false) = true
  and not exists (
    select 1
    from tmp_final_store_item_codes allowed
    where allowed.code = lower(coalesce(i.code, ''))
  )
  and not (
    coalesce(i.behavior_code, '') = 'open_container'
    and coalesce(i.target_kind, '') = 'container'
    and i.target_id is not null
  )
  and lower(coalesce(c.code, '')) in (
    'banlist',
    'progression',
    'chaos',
    'protection',
    'special',
    'currency_exchange',
    'container_openers',
    'pack_openers',
    'pack_keys',
    'box_keys',
    'feature_slots'
  );

delete from public.store_cart_items sci
where sci.item_definition_id in (
  select id
  from tmp_non_spec_store_items
);

update public.item_definitions i
set
  is_active = false,
  is_store_purchase_locked = true,
  is_reward_rng_locked = true,
  is_randomly_available = false,
  updated_at = now()
where i.id in (
  select id
  from tmp_non_spec_store_items
);

commit;
