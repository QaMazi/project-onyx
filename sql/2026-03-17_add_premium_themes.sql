begin;

with catalog (
  code,
  name,
  description,
  category_code,
  slot_code,
  image_url,
  sort_order,
  metadata
) as (
  values
    (
      'theme:cyber-dragon',
      'Cyber Dragon',
      'Permanent theme unlock for Cyber Dragon.',
      'themes',
      'theme',
      '/ui/backgrounds/cyber_dragon_theme.png',
      13,
      '{"themeId":"cyber-dragon","accent":"#63d5ff","accent2":"#ff9f4f","accent3":"#253766"}'::jsonb
    ),
    (
      'theme:egyptian-god',
      'Egyptian God',
      'Permanent theme unlock for Egyptian God.',
      'themes',
      'theme',
      '/ui/backgrounds/egyptian_god_theme.png',
      14,
      '{"themeId":"egyptian-god","accent":"#f4cf6d","accent2":"#fff1d2","accent3":"#5f6fb5"}'::jsonb
    ),
    (
      'theme:kuriboh',
      'Kuriboh',
      'Permanent theme unlock for Kuriboh.',
      'themes',
      'theme',
      '/ui/backgrounds/kuriboh_theme.png',
      15,
      '{"themeId":"kuriboh","accent":"#bb7c45","accent2":"#b7d8ff","accent3":"#7c5aa8"}'::jsonb
    ),
    (
      'theme:traptrix',
      'Traptrix',
      'Permanent theme unlock for Traptrix.',
      'themes',
      'theme',
      '/ui/backgrounds/traptrix_theme.png',
      16,
      '{"themeId":"traptrix","accent":"#f18aa0","accent2":"#9fca59","accent3":"#734229"}'::jsonb
    )
)
insert into public.premium_store_items (
  code,
  name,
  description,
  category_code,
  slot_code,
  image_url,
  preview_audio_url,
  price,
  is_active,
  sort_order,
  season_code,
  metadata
)
select
  code,
  name,
  description,
  category_code,
  slot_code,
  image_url,
  null,
  0,
  true,
  sort_order,
  null,
  metadata
from catalog
on conflict (code)
do update set
  name = excluded.name,
  description = excluded.description,
  category_code = excluded.category_code,
  slot_code = excluded.slot_code,
  image_url = excluded.image_url,
  is_active = true,
  sort_order = excluded.sort_order,
  metadata = excluded.metadata,
  updated_at = now();

commit;
