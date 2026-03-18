begin;

create extension if not exists pgcrypto;

with desired_slots as (
  select *
  from (
    values
      (
        'Drafted Feature Slot Machine',
        'Shows 4 random cards, starts at 0 Feature Coins for a fresh series, and loses one reveal each time you reroll until you must keep the final card.',
        'drafted',
        3,
        4,
        0,
        'all_cards'
      ),
      (
        'Picker Feature Slot Machine',
        'Choose Monster, Spell, Trap, or Extra Deck first, then spin a 2-card machine with 2 rerolls inside that category only.',
        'picker',
        2,
        2,
        0,
        'all_cards'
      ),
      (
        'Boosted Slots',
        'Starts with 2 random cards. Spend Shards before the pull to add more cards or expand the rarity range above base rarity.',
        'boosted',
        0,
        2,
        10,
        'all_cards'
      ),
      (
        'Regen Booster',
        'Pick a reveal count from 1 to 4, pay 10 Shards for each extra reveal after the first, then keep any of the revealed cards and refund half the cost of unused extras.',
        'regen',
        0,
        4,
        10,
        'all_cards'
      )
  ) as rows (
    slot_name,
    description,
    slot_type,
    reroll_count,
    starting_choices,
    shard_cost_per_extra,
    pool_mode
  )
)
update public.feature_slots as fs
set
  description = desired_slots.description,
  slot_type = desired_slots.slot_type,
  reroll_count = desired_slots.reroll_count,
  starting_choices = desired_slots.starting_choices,
  shard_cost_per_extra = desired_slots.shard_cost_per_extra,
  pool_mode = desired_slots.pool_mode,
  is_enabled = true,
  updated_at = now()
from desired_slots
where lower(fs.name) = lower(desired_slots.slot_name);

with desired_slots as (
  select *
  from (
    values
      (
        'Drafted Feature Slot Machine',
        'Shows 4 random cards, starts at 0 Feature Coins for a fresh series, and loses one reveal each time you reroll until you must keep the final card.',
        'drafted',
        3,
        4,
        0,
        'all_cards'
      ),
      (
        'Picker Feature Slot Machine',
        'Choose Monster, Spell, Trap, or Extra Deck first, then spin a 2-card machine with 2 rerolls inside that category only.',
        'picker',
        2,
        2,
        0,
        'all_cards'
      ),
      (
        'Boosted Slots',
        'Starts with 2 random cards. Spend Shards before the pull to add more cards or expand the rarity range above base rarity.',
        'boosted',
        0,
        2,
        10,
        'all_cards'
      ),
      (
        'Regen Booster',
        'Pick a reveal count from 1 to 4, pay 10 Shards for each extra reveal after the first, then keep any of the revealed cards and refund half the cost of unused extras.',
        'regen',
        0,
        4,
        10,
        'all_cards'
      )
  ) as rows (
    slot_name,
    description,
    slot_type,
    reroll_count,
    starting_choices,
    shard_cost_per_extra,
    pool_mode
  )
)
insert into public.feature_slots (
  id,
  name,
  description,
  slot_type,
  reroll_count,
  starting_choices,
  shard_cost_per_extra,
  image_url,
  is_enabled,
  is_locked,
  created_at,
  updated_at,
  pool_mode,
  min_rarity_floor
)
select
  gen_random_uuid(),
  desired_slots.slot_name,
  desired_slots.description,
  desired_slots.slot_type,
  desired_slots.reroll_count,
  desired_slots.starting_choices,
  desired_slots.shard_cost_per_extra,
  null,
  true,
  false,
  now(),
  now(),
  desired_slots.pool_mode,
  null
from desired_slots
where not exists (
  select 1
  from public.feature_slots fs
  where lower(fs.name) = lower(desired_slots.slot_name)
);

commit;
