begin;

create extension if not exists pgcrypto;

create table if not exists public.profile_premium_wallets (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  gentlemen_tokens integer not null default 0 check (gentlemen_tokens >= 0),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.premium_store_items (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  category_code text not null,
  slot_code text not null,
  image_url text,
  preview_audio_url text,
  price integer not null default 0 check (price >= 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  season_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.profile_premium_unlocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  premium_item_id uuid not null references public.premium_store_items (id) on delete cascade,
  purchased_price integer not null default 0 check (purchased_price >= 0),
  purchased_at timestamp with time zone not null default now(),
  unique (user_id, premium_item_id)
);

create table if not exists public.profile_premium_equips (
  user_id uuid not null references public.profiles (id) on delete cascade,
  slot_code text not null,
  premium_item_id uuid not null references public.premium_store_items (id) on delete cascade,
  updated_at timestamp with time zone not null default now(),
  primary key (user_id, slot_code)
);

create table if not exists public.profile_premium_token_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  delta integer not null,
  balance_after integer not null check (balance_after >= 0),
  reason_code text not null,
  notes text,
  related_series_id uuid references public.game_series (id) on delete set null,
  related_round_number integer,
  created_by_user_id uuid references public.profiles (id) on delete set null,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.profile_premium_main_round_awards (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.game_series (id) on delete cascade,
  round_number integer not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  awarded_at timestamp with time zone not null default now(),
  unique (series_id, round_number, user_id)
);

create table if not exists public.premium_system_settings (
  singleton boolean primary key default true check (singleton = true),
  auto_main_round_tokens_enabled boolean not null default true,
  updated_at timestamp with time zone not null default now(),
  updated_by_user_id uuid references public.profiles (id) on delete set null
);

create table if not exists public.profile_showcase_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  is_public boolean not null default false,
  headline text,
  subheadline text,
  deck_spotlight_title text,
  deck_spotlight_text text,
  featured_card_id bigint references public.cards (id) on delete set null,
  featured_card_note text,
  flex_title text,
  flex_text text,
  highlight_title text,
  highlight_text text,
  updated_at timestamp with time zone not null default now()
);

create index if not exists idx_premium_store_items_category
  on public.premium_store_items (category_code, sort_order, name);

create index if not exists idx_profile_premium_unlocks_user
  on public.profile_premium_unlocks (user_id);

create index if not exists idx_profile_premium_equips_item
  on public.profile_premium_equips (premium_item_id);

insert into public.premium_system_settings (singleton, auto_main_round_tokens_enabled)
values (true, true)
on conflict (singleton) do nothing;

with catalog (
  code,
  name,
  description,
  category_code,
  slot_code,
  image_url,
  preview_audio_url,
  sort_order,
  season_code,
  metadata
) as (
  values
    ('theme:project-onyx', 'Project Onyx', 'Permanent theme unlock for Project Onyx.', 'themes', 'theme', '/ui/backgrounds/project_onyx_theme.png', null, 1, null, '{"themeId":"project-onyx","accent":"#d7a63e","accent2":"#f4d37a","accent3":"#6f4c16"}'::jsonb),
    ('theme:rose-dragon', 'Black Rose Dragon', 'Permanent theme unlock for Black Rose Dragon.', 'themes', 'theme', '/ui/backgrounds/rose_dragon_theme.png', null, 2, null, '{"themeId":"rose-dragon","accent":"#d93a57","accent2":"#ff6f8f","accent3":"#7b1027"}'::jsonb),
    ('theme:goblin', 'The Goblin', 'Permanent theme unlock for The Goblin.', 'themes', 'theme', '/ui/backgrounds/goblin_theme.png', null, 3, null, '{"themeId":"goblin","accent":"#9b5cff","accent2":"#d56bff","accent3":"#3d155f"}'::jsonb),
    ('theme:yugioh', 'Yu-Gi-Oh', 'Permanent theme unlock for Yu-Gi-Oh.', 'themes', 'theme', '/ui/backgrounds/yugioh_theme.png', null, 4, null, '{"themeId":"yugioh","accent":"#d8a247","accent2":"#f0c56b","accent3":"#7d4e17"}'::jsonb),
    ('theme:blue-eyes', 'Blue-Eyes', 'Permanent theme unlock for Blue-Eyes.', 'themes', 'theme', '/ui/backgrounds/blue_eyes_theme.png', null, 5, null, '{"themeId":"blue-eyes","accent":"#7fc8ff","accent2":"#dff3ff","accent3":"#2b5f97"}'::jsonb),
    ('theme:starving-venom', 'Starving Venom', 'Permanent theme unlock for Starving Venom.', 'themes', 'theme', '/ui/backgrounds/starving_venom_theme.png', null, 6, null, '{"themeId":"starving-venom","accent":"#b44cff","accent2":"#d9ff59","accent3":"#4c1772"}'::jsonb),
    ('theme:sacred-beasts', 'Sacred Beasts', 'Permanent theme unlock for Sacred Beasts.', 'themes', 'theme', '/ui/backgrounds/sacred_beasts_theme.png', null, 7, null, '{"themeId":"sacred-beasts","accent":"#ff8b2c","accent2":"#ffd257","accent3":"#7a1f12"}'::jsonb),
    ('theme:yami-yugi', 'Yami Yugi', 'Permanent theme unlock for Yami Yugi.', 'themes', 'theme', '/ui/backgrounds/yami_yugi_theme.png', null, 8, null, '{"themeId":"yami-yugi","accent":"#d3a03d","accent2":"#7f5cff","accent3":"#6b3d14"}'::jsonb),
    ('theme:kaiba', 'Kaiba', 'Permanent theme unlock for Kaiba.', 'themes', 'theme', '/ui/backgrounds/kaiba_theme.png', null, 9, null, '{"themeId":"kaiba","accent":"#7db8ff","accent2":"#e6f4ff","accent3":"#365e9b"}'::jsonb),
    ('theme:progression', 'Progression', 'Permanent theme unlock for Progression.', 'themes', 'theme', '/ui/backgrounds/progression_theme.png', null, 10, null, '{"themeId":"progression","accent":"#f2bc56","accent2":"#7bc4ff","accent3":"#8a5d19"}'::jsonb),
    ('theme:pots', 'The Pots', 'Permanent theme unlock for The Pots.', 'themes', 'theme', '/ui/backgrounds/pots_theme.png', null, 11, null, '{"themeId":"pots","accent":"#59d46b","accent2":"#9b6cff","accent3":"#2b7434"}'::jsonb),
    ('theme:ghost-girls', 'Ghost Girls', 'Permanent theme unlock for Ghost Girls.', 'themes', 'theme', '/ui/backgrounds/ghost_girls_theme.png', null, 12, null, '{"themeId":"ghost-girls","accent":"#b89cff","accent2":"#ffb3d8","accent3":"#5d4695"}'::jsonb),
    ('music:egyptian-1', 'Project Onyx', 'Permanent soundtrack unlock with 10-second preview support.', 'music', 'music_track', '/ui/onyx_logo.png', '/audio/Egyptian 1.mp3', 1, null, '{"trackId":"egyptian-1","trackFile":"/audio/Egyptian 1.mp3"}'::jsonb),
    ('music:egyptian-2', 'Onyx 1', 'Permanent soundtrack unlock with 10-second preview support.', 'music', 'music_track', '/ui/onyx_logo.png', '/audio/Egyptian 2.mp3', 2, null, '{"trackId":"egyptian-2","trackFile":"/audio/Egyptian 2.mp3"}'::jsonb),
    ('music:egyptian-3', 'Onyx 2', 'Permanent soundtrack unlock with 10-second preview support.', 'music', 'music_track', '/ui/onyx_logo.png', '/audio/Egyptian 3.mp3', 3, null, '{"trackId":"egyptian-3","trackFile":"/audio/Egyptian 3.mp3"}'::jsonb),
    ('music:egyptian-4', 'Onyx 3', 'Permanent soundtrack unlock with 10-second preview support.', 'music', 'music_track', '/ui/onyx_logo.png', '/audio/Egyptian 4.mp3', 4, null, '{"trackId":"egyptian-4","trackFile":"/audio/Egyptian 4.mp3"}'::jsonb),
    ('music:egyptian-5', 'Onyx 4', 'Permanent soundtrack unlock with 10-second preview support.', 'music', 'music_track', '/ui/onyx_logo.png', '/audio/Egyptian 5.mp3', 5, null, '{"trackId":"egyptian-5","trackFile":"/audio/Egyptian 5.mp3"}'::jsonb),
    ('music:egyptian-6', 'Onyx 5', 'Permanent soundtrack unlock with 10-second preview support.', 'music', 'music_track', '/ui/onyx_logo.png', '/audio/Egyptian 6.mp3', 6, null, '{"trackId":"egyptian-6","trackFile":"/audio/Egyptian 6.mp3"}'::jsonb),
    ('music:desert-of-set', 'Onyx 6', 'Permanent soundtrack unlock with 10-second preview support.', 'music', 'music_track', '/ui/onyx_logo.png', '/audio/Desert Of Set.mp3', 7, null, '{"trackId":"desert-of-set","trackFile":"/audio/Desert Of Set.mp3"}'::jsonb),
    ('music:obelisk-of-thunder', 'Onyx 7', 'Permanent soundtrack unlock with 10-second preview support.', 'music', 'music_track', '/ui/onyx_logo.png', '/audio/Obelisk of Thunder.mp3', 8, null, '{"trackId":"obelisk-of-thunder","trackFile":"/audio/Obelisk of Thunder.mp3"}'::jsonb),
    ('music:millennium-battle-1', 'Millennium Battle 1', 'Permanent soundtrack unlock with 10-second preview support.', 'music', 'music_track', '/ui/onyx_logo.png', '/audio/Millennium Battle 1.mp3', 9, null, '{"trackId":"millennium-battle-1","trackFile":"/audio/Millennium Battle 1.mp3"}'::jsonb),
    ('music:millennium-battle-2', 'Millennium Battle 2', 'Permanent soundtrack unlock with 10-second preview support.', 'music', 'music_track', '/ui/onyx_logo.png', '/audio/Millennium Battle 2.mp3', 10, null, '{"trackId":"millennium-battle-2","trackFile":"/audio/Millennium Battle 2.mp3"}'::jsonb),
    ('music:millennium-battle-3', 'Millennium Battle 3', 'Permanent soundtrack unlock with 10-second preview support.', 'music', 'music_track', '/ui/onyx_logo.png', '/audio/Millennium Battle 3.mp3', 11, null, '{"trackId":"millennium-battle-3","trackFile":"/audio/Millennium Battle 3.mp3"}'::jsonb),
    ('music:overlap', 'Overlap', 'Permanent soundtrack unlock with 10-second preview support.', 'music', 'music_track', '/ui/onyx_logo.png', '/audio/Overlap.mp3', 12, null, '{"trackId":"overlap","trackFile":"/audio/Overlap.mp3"}'::jsonb),
    ('music:shuffle', 'Shuffle', 'Permanent soundtrack unlock with 10-second preview support.', 'music', 'music_track', '/ui/onyx_logo.png', '/audio/Shuffle.mp3', 13, null, '{"trackId":"shuffle","trackFile":"/audio/Shuffle.mp3"}'::jsonb),
    ('music:wild-drive', 'Wild Drive', 'Permanent soundtrack unlock with 10-second preview support.', 'music', 'music_track', '/ui/onyx_logo.png', '/audio/Wild Drive.mp3', 14, null, '{"trackId":"wild-drive","trackFile":"/audio/Wild Drive.mp3"}'::jsonb),
    ('music:warriors', 'Warriors', 'Permanent soundtrack unlock with 10-second preview support.', 'music', 'music_track', '/ui/onyx_logo.png', '/audio/Warriors.mp3', 15, null, '{"trackId":"warriors","trackFile":"/audio/Warriors.mp3"}'::jsonb),
    ('music:voice', 'Voice', 'Permanent soundtrack unlock with 10-second preview support.', 'music', 'music_track', '/ui/onyx_logo.png', '/audio/Voice.mp3', 16, null, '{"trackId":"voice","trackFile":"/audio/Voice.mp3"}'::jsonb),
    ('music:eyes', 'EYES', 'Permanent soundtrack unlock with 10-second preview support.', 'music', 'music_track', '/ui/onyx_logo.png', '/audio/EYES.mp3', 17, null, '{"trackId":"eyes","trackFile":"/audio/EYES.mp3"}'::jsonb),
    ('music:ano-hi-no-gogo', 'Ano hi no Gogo', 'Permanent soundtrack unlock with 10-second preview support.', 'music', 'music_track', '/ui/onyx_logo.png', '/audio/Ano hi no Gogo.mp3', 18, null, '{"trackId":"ano-hi-no-gogo","trackFile":"/audio/Ano hi no Gogo.mp3"}'::jsonb),
    ('music:afureru-kanjou-ga-tomaranai', 'Afureru Kanjou ga Tomaranai', 'Permanent soundtrack unlock with 10-second preview support.', 'music', 'music_track', '/ui/onyx_logo.png', '/audio/Afureru Kanjou ga Tomaranai.mp3', 19, null, '{"trackId":"afureru-kanjou-ga-tomaranai","trackFile":"/audio/Afureru Kanjou ga Tomaranai.mp3"}'::jsonb),
    ('music:genki-no-shower', 'Genki no Shower', 'Permanent soundtrack unlock with 10-second preview support.', 'music', 'music_track', '/ui/onyx_logo.png', '/audio/Genki no Shower.mp3', 20, null, '{"trackId":"genki-no-shower","trackFile":"/audio/Genki no Shower.mp3"}'::jsonb),
    ('music:going-my-way', 'Going My Way', 'Permanent soundtrack unlock with 10-second preview support.', 'music', 'music_track', '/ui/onyx_logo.png', '/audio/Going My Way.mp3', 21, null, '{"trackId":"going-my-way","trackFile":"/audio/Going My Way.mp3"}'::jsonb),
    ('music:rakuen', 'Rakuen', 'Permanent soundtrack unlock with 10-second preview support.', 'music', 'music_track', '/ui/onyx_logo.png', '/audio/Rakuen.mp3', 22, null, '{"trackId":"rakuen","trackFile":"/audio/Rakuen.mp3"}'::jsonb),
    ('music:rising-weather-hallelujah', 'Rising Weather Hallelujah', 'Permanent soundtrack unlock with 10-second preview support.', 'music', 'music_track', '/ui/onyx_logo.png', '/audio/Rising Weather Hallelujah.mp3', 23, null, '{"trackId":"rising-weather-hallelujah","trackFile":"/audio/Rising Weather Hallelujah.mp3"}'::jsonb),
    ('ui:header-constellation', 'Constellation Header Lines', 'Animated header accent rails with a slow starlit sweep.', 'ui-effects', 'header_line_style', '/ui/backgrounds/project_onyx_theme.png', null, 1, null, '{"styleId":"constellation"}'::jsonb),
    ('ui:footer-afterglow', 'Afterglow Footer Lines', 'Soft footer accents that ripple outward across the chrome.', 'ui-effects', 'footer_line_style', '/ui/backgrounds/project_onyx_theme.png', null, 2, null, '{"styleId":"afterglow"}'::jsonb),
    ('ui:motion-comet', 'Comet Motion', 'Alternate accent movement for lines, reels, and chrome streaks.', 'ui-effects', 'accent_motion_style', '/ui/backgrounds/project_onyx_theme.png', null, 3, null, '{"styleId":"comet"}'::jsonb),
    ('ui:particles-starfall', 'Starfall Particles', 'Theme-aware particles scatter over the wallpaper and stage.', 'ui-effects', 'background_particle_style', '/ui/backgrounds/project_onyx_theme.png', null, 4, null, '{"styleId":"starfall"}'::jsonb),
    ('ui:border-orbit', 'Orbit Border Style', 'Panels gain a circulating border shimmer around their edges.', 'ui-effects', 'panel_border_style', '/ui/backgrounds/project_onyx_theme.png', null, 5, null, '{"styleId":"orbit"}'::jsonb),
    ('ui:glow-ember', 'Ember Glow Style', 'A richer accent glow for shells, cards, and hero panels.', 'ui-effects', 'glow_style', '/ui/backgrounds/project_onyx_theme.png', null, 6, null, '{"styleId":"ember"}'::jsonb),
    ('ui:modal-veil', 'Veil Modal Transition', 'Modals arrive with a silk veil transition and accent bloom.', 'ui-effects', 'modal_transition_style', '/ui/backgrounds/project_onyx_theme.png', null, 7, null, '{"styleId":"veil"}'::jsonb),
    ('ui:page-lens', 'Lens Page Transition', 'Page changes glide through a refracted accent lens effect.', 'ui-effects', 'page_transition_style', '/ui/backgrounds/project_onyx_theme.png', null, 8, null, '{"styleId":"lens"}'::jsonb),
    ('ui:cursor-shardtrail', 'Shardtrail Cursor', 'Cursor glints and trails inherit the active theme palette.', 'ui-effects', 'cursor_effect_style', '/ui/backgrounds/project_onyx_theme.png', null, 9, null, '{"styleId":"shardtrail"}'::jsonb),
    ('ui:sound-glass', 'Glass UI Sound Pack', 'A crystalline UI bed for premium clicks, hovers, and confirms.', 'ui-effects', 'ui_sound_pack', '/ui/onyx_logo.png', null, 10, null, '{"styleId":"glass"}'::jsonb),
    ('ui:click-relic', 'Relic Click Pack', 'Clicks land with a heavier relic-style accent.', 'ui-effects', 'menu_click_sound_pack', '/ui/onyx_logo.png', null, 11, null, '{"styleId":"relic"}'::jsonb),
    ('ui:hover-whisper', 'Whisper Hover Pack', 'Hover and select cues become airy and understated.', 'ui-effects', 'menu_hover_sound_pack', '/ui/onyx_logo.png', null, 12, null, '{"styleId":"whisper"}'::jsonb),
    ('profile:badge-regal', 'Regal Badge Frame', 'A premium frame for the identity crest in profile surfaces.', 'profile-cosmetics', 'profile_badge_frame', '/ui/project_onyx_logo.png', null, 1, null, '{"styleId":"regal"}'::jsonb),
    ('profile:avatar-reliquary', 'Reliquary Avatar Frame', 'A lacquered avatar frame with subtle inner glow.', 'profile-cosmetics', 'avatar_frame', '/ui/project_onyx_logo.png', null, 2, null, '{"styleId":"reliquary"}'::jsonb),
    ('profile:role-signet', 'Signet Role Pill', 'Transforms the role pill into a premium etched signet.', 'profile-cosmetics', 'role_pill_style', '/ui/onyx_logo.png', null, 3, null, '{"styleId":"signet"}'::jsonb),
    ('profile:token-coinpress', 'Coinpress Token Pill', 'Adds a premium stamped finish to the Gentlemen''s Token pill.', 'profile-cosmetics', 'token_pill_style', '/ui/onyx_logo.png', null, 4, null, '{"styleId":"coinpress"}'::jsonb),
    ('profile:nameplate-obsidian', 'Obsidian Nameplate', 'A dark glass nameplate with accent filigree.', 'profile-cosmetics', 'nameplate_style', '/ui/onyx_logo.png', null, 5, null, '{"styleId":"obsidian"}'::jsonb),
    ('profile:card-velvet', 'Velvet Profile Skin', 'Re-skins profile identity cards with a velvet ceremonial finish.', 'profile-cosmetics', 'profile_card_skin', '/ui/backgrounds/project_onyx_theme.png', null, 6, null, '{"styleId":"velvet"}'::jsonb),
    ('profile:emblem-onyx', 'Onyx Emblem', 'A special account emblem for profile, header, and showcase callouts.', 'profile-cosmetics', 'account_emblem', '/ui/onyx_logo.png', null, 7, null, '{"styleId":"onyx"}'::jsonb),
    ('atmosphere:runeveil', 'Runeveil Pack', 'Runic overlays, idle shimmer, and fog layers tuned to the active theme.', 'atmosphere-packs', 'atmosphere_pack', '/ui/backgrounds/project_onyx_theme.png', null, 1, null, '{"styleId":"runeveil"}'::jsonb),
    ('atmosphere:astral-silk', 'Astral Silk Pack', 'Adds silk haze, slow moving filters, and polished menu idle motion.', 'atmosphere-packs', 'atmosphere_pack', '/ui/backgrounds/project_onyx_theme.png', null, 2, null, '{"styleId":"astral-silk"}'::jsonb),
    ('atmosphere:ember-haze', 'Ember Haze Pack', 'A warmer pack with ember drift and stronger atmosphere bloom.', 'atmosphere-packs', 'atmosphere_pack', '/ui/backgrounds/project_onyx_theme.png', null, 3, null, '{"styleId":"ember-haze"}'::jsonb),
    ('showcase:frame-grand-archive', 'Grand Archive Frame', 'A premium showcase frame for the public identity card.', 'showcase-objects', 'showcase_frame', '/ui/backgrounds/project_onyx_theme.png', null, 1, null, '{"styleId":"grand-archive"}'::jsonb),
    ('showcase:pedestal-blackglass', 'Blackglass Pedestal', 'Card and flex items rest on a blackglass display stand.', 'showcase-objects', 'showcase_pedestal', '/ui/project_onyx_logo.png', null, 2, null, '{"styleId":"blackglass"}'::jsonb),
    ('showcase:panel-observatory', 'Observatory Backdrop', 'A layered background panel for the public showcase stage.', 'showcase-objects', 'showcase_background_panel', '/ui/backgrounds/project_onyx_theme.png', null, 3, null, '{"styleId":"observatory"}'::jsonb),
    ('showcase:particles-velvet-sparks', 'Velvet Spark Particles', 'Floating accent particles behind the public showcase object set.', 'showcase-objects', 'showcase_particles', '/ui/backgrounds/project_onyx_theme.png', null, 4, null, '{"styleId":"velvet-sparks"}'::jsonb),
    ('showcase:spotlight-crescent', 'Crescent Spotlight', 'A softer profile spotlight for the featured card and deck banner.', 'showcase-objects', 'showcase_spotlight', '/ui/backgrounds/project_onyx_theme.png', null, 5, null, '{"styleId":"crescent"}'::jsonb),
    ('showcase:trim-signet', 'Signet Banner Trim', 'Embossed trim for deck spotlight and flex banners.', 'showcase-objects', 'showcase_banner_trim', '/ui/backgrounds/project_onyx_theme.png', null, 6, null, '{"styleId":"signet"}'::jsonb),
    ('showcase:border-lux', 'Lux Showcase Border', 'An outer premium showcase border with accent glints.', 'showcase-objects', 'showcase_border', '/ui/backgrounds/project_onyx_theme.png', null, 7, null, '{"styleId":"lux"}'::jsonb),
    ('showcase:cardpedestal-monolith', 'Monolith Card Pedestal', 'A monolithic pedestal for the featured favorite card case.', 'showcase-objects', 'showcase_card_pedestal', '/ui/project_onyx_logo.png', null, 8, null, '{"styleId":"monolith"}'::jsonb),
    ('showcase:aura-halo', 'Halo Display Aura', 'Adds a premium aura effect behind featured showcase items.', 'showcase-objects', 'showcase_aura', '/ui/backgrounds/project_onyx_theme.png', null, 9, null, '{"styleId":"halo"}'::jsonb),
    ('showcase:decor-release-shards', 'Release Shard Decor', 'Release-themed floating shards and ceremonial trims.', 'showcase-objects', 'showcase_decoration', '/ui/backgrounds/project_onyx_theme.png', null, 10, null, '{"styleId":"release-shards"}'::jsonb),
    ('season0:release-frame', 'Season 0 Release Frame', 'Release-season identity frame for profile and showcase presentation.', 'seasonal', 'profile_badge_frame', '/ui/project_onyx_logo.png', null, 1, 'season-0-release', '{"styleId":"release-frame"}'::jsonb),
    ('season0:release-lines', 'Season 0 Release Lines', 'Release-themed accent rails for header chrome and callouts.', 'seasonal', 'header_line_style', '/ui/backgrounds/project_onyx_theme.png', null, 2, 'season-0-release', '{"styleId":"release-lines"}'::jsonb),
    ('season0:release-particles', 'Season 0 Release Particles', 'A release particle pack with sharper celebratory motion.', 'seasonal', 'background_particle_style', '/ui/backgrounds/project_onyx_theme.png', null, 3, 'season-0-release', '{"styleId":"release-particles"}'::jsonb),
    ('season0:release-nameplate', 'Season 0 Release Nameplate', 'Release-themed nameplate and title styling.', 'seasonal', 'nameplate_style', '/ui/onyx_logo.png', null, 4, 'season-0-release', '{"styleId":"release-nameplate"}'::jsonb),
    ('season0:release-atmosphere', 'Season 0 Release Atmosphere', 'A launch-era atmosphere pack with spotlight haze and sheen.', 'seasonal', 'atmosphere_pack', '/ui/backgrounds/project_onyx_theme.png', null, 5, 'season-0-release', '{"styleId":"release-atmosphere"}'::jsonb),
    ('season0:release-showcase', 'Season 0 Release Showcase Decor', 'Release-themed decorations for the public showcase system.', 'seasonal', 'showcase_decoration', '/ui/backgrounds/project_onyx_theme.png', null, 6, 'season-0-release', '{"styleId":"release-showcase"}'::jsonb),
    ('prestige:crownfire-border', 'Crownfire Border', 'A rare animated prestige border for premium profile surfaces.', 'prestige-flex', 'prestige_border', '/ui/backgrounds/project_onyx_theme.png', null, 1, null, '{"styleId":"crownfire"}'::jsonb),
    ('prestige:gilded-title', 'Gilded Title Flair', 'Adds special title treatment to nameplates and showcase headers.', 'prestige-flex', 'title_flair', '/ui/onyx_logo.png', null, 2, null, '{"styleId":"gilded"}'::jsonb),
    ('prestige:eclipse-banner', 'Eclipse Banner Effect', 'An animated banner effect for profile cards and public showcase copy.', 'prestige-flex', 'profile_banner_effect', '/ui/backgrounds/project_onyx_theme.png', null, 3, null, '{"styleId":"eclipse"}'::jsonb),
    ('prestige:grand-emblem', 'Grand Emblem', 'A flex emblem for the header, profile, and community showcase.', 'prestige-flex', 'account_emblem', '/ui/onyx_logo.png', null, 4, null, '{"styleId":"grand"}'::jsonb)
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
  preview_audio_url,
  0,
  true,
  sort_order,
  season_code,
  metadata
from catalog
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  category_code = excluded.category_code,
  slot_code = excluded.slot_code,
  image_url = excluded.image_url,
  preview_audio_url = excluded.preview_audio_url,
  is_active = true,
  sort_order = excluded.sort_order,
  season_code = excluded.season_code,
  metadata = excluded.metadata,
  updated_at = now();

with active_codes as (
  select code
  from (
    values
      ('theme:project-onyx'),
      ('theme:rose-dragon'),
      ('theme:goblin'),
      ('theme:yugioh'),
      ('theme:blue-eyes'),
      ('theme:starving-venom'),
      ('theme:sacred-beasts'),
      ('theme:yami-yugi'),
      ('theme:kaiba'),
      ('theme:progression'),
      ('theme:pots'),
      ('theme:ghost-girls'),
      ('music:egyptian-1'),
      ('music:egyptian-2'),
      ('music:egyptian-3'),
      ('music:egyptian-4'),
      ('music:egyptian-5'),
      ('music:egyptian-6'),
      ('music:desert-of-set'),
      ('music:obelisk-of-thunder'),
      ('music:millennium-battle-1'),
      ('music:millennium-battle-2'),
      ('music:millennium-battle-3'),
      ('music:overlap'),
      ('music:shuffle'),
      ('music:wild-drive'),
      ('music:warriors'),
      ('music:voice'),
      ('music:eyes'),
      ('music:ano-hi-no-gogo'),
      ('music:afureru-kanjou-ga-tomaranai'),
      ('music:genki-no-shower'),
      ('music:going-my-way'),
      ('music:rakuen'),
      ('music:rising-weather-hallelujah'),
      ('ui:header-constellation'),
      ('ui:footer-afterglow'),
      ('ui:motion-comet'),
      ('ui:particles-starfall'),
      ('ui:border-orbit'),
      ('ui:glow-ember'),
      ('ui:modal-veil'),
      ('ui:page-lens'),
      ('ui:cursor-shardtrail'),
      ('ui:sound-glass'),
      ('ui:click-relic'),
      ('ui:hover-whisper'),
      ('profile:badge-regal'),
      ('profile:avatar-reliquary'),
      ('profile:role-signet'),
      ('profile:token-coinpress'),
      ('profile:nameplate-obsidian'),
      ('profile:card-velvet'),
      ('profile:emblem-onyx'),
      ('atmosphere:runeveil'),
      ('atmosphere:astral-silk'),
      ('atmosphere:ember-haze'),
      ('showcase:frame-grand-archive'),
      ('showcase:pedestal-blackglass'),
      ('showcase:panel-observatory'),
      ('showcase:particles-velvet-sparks'),
      ('showcase:spotlight-crescent'),
      ('showcase:trim-signet'),
      ('showcase:border-lux'),
      ('showcase:cardpedestal-monolith'),
      ('showcase:aura-halo'),
      ('showcase:decor-release-shards'),
      ('season0:release-frame'),
      ('season0:release-lines'),
      ('season0:release-particles'),
      ('season0:release-nameplate'),
      ('season0:release-atmosphere'),
      ('season0:release-showcase'),
      ('prestige:crownfire-border'),
      ('prestige:gilded-title'),
      ('prestige:eclipse-banner'),
      ('prestige:grand-emblem')
  ) as rows (code)
)
update public.premium_store_items
set
  is_active = false,
  updated_at = now()
where code not in (select code from active_codes)
  and category_code in (
    'themes',
    'music',
    'ui-effects',
    'profile-cosmetics',
    'atmosphere-packs',
    'showcase-objects',
    'seasonal',
    'prestige-flex'
  );

create or replace function public._ensure_profile_premium_wallet(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  insert into public.profile_premium_wallets (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;
end;
$function$;

create or replace function public._grant_gentlemens_tokens(
  p_user_id uuid,
  p_delta integer,
  p_reason_code text,
  p_notes text default null,
  p_related_series_id uuid default null,
  p_related_round_number integer default null,
  p_created_by_user_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_wallet record;
  v_next_balance integer;
begin
  if p_user_id is null then
    raise exception 'Target user is required';
  end if;

  if p_delta is null or p_delta = 0 then
    perform public._ensure_profile_premium_wallet(p_user_id);

    select gentlemen_tokens
    into v_next_balance
    from public.profile_premium_wallets
    where user_id = p_user_id;

    return coalesce(v_next_balance, 0);
  end if;

  perform public._ensure_profile_premium_wallet(p_user_id);

  select *
  into v_wallet
  from public.profile_premium_wallets
  where user_id = p_user_id
  for update;

  v_next_balance := coalesce(v_wallet.gentlemen_tokens, 0) + p_delta;

  if v_next_balance < 0 then
    raise exception 'Insufficient Gentlemen''s Tokens';
  end if;

  update public.profile_premium_wallets
  set
    gentlemen_tokens = v_next_balance,
    updated_at = now()
  where user_id = p_user_id;

  insert into public.profile_premium_token_ledger (
    user_id,
    delta,
    balance_after,
    reason_code,
    notes,
    related_series_id,
    related_round_number,
    created_by_user_id
  )
  values (
    p_user_id,
    p_delta,
    v_next_balance,
    coalesce(p_reason_code, 'manual_adjustment'),
    p_notes,
    p_related_series_id,
    p_related_round_number,
    p_created_by_user_id
  );

  return v_next_balance;
end;
$function$;

create or replace function public._award_completed_main_round_tokens(
  p_series_id uuid,
  p_completed_round integer
)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_enabled boolean;
  v_player record;
begin
  if p_series_id is null or coalesce(p_completed_round, 0) <= 0 then
    return;
  end if;

  select auto_main_round_tokens_enabled
  into v_enabled
  from public.premium_system_settings
  where singleton = true;

  if not coalesce(v_enabled, true) then
    return;
  end if;

  for v_player in
    select sp.user_id
    from public.series_players sp
    where sp.series_id = p_series_id
  loop
    insert into public.profile_premium_main_round_awards (
      series_id,
      round_number,
      user_id
    )
    values (
      p_series_id,
      p_completed_round,
      v_player.user_id
    )
    on conflict (series_id, round_number, user_id) do nothing;

    if found then
      perform public._grant_gentlemens_tokens(
        v_player.user_id,
        1,
        'completed_main_round_pair',
        format('Completed main round %s', p_completed_round),
        p_series_id,
        p_completed_round,
        null
      );
    end if;
  end loop;
end;
$function$;

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
              'is_owned', (u.id is not null),
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

  if exists (
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

  if not exists (
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

create or replace function public.unequip_premium_slot(
  p_slot_code text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
begin
  v_actor_id := public._assert_authenticated_user();

  delete from public.profile_premium_equips
  where user_id = v_actor_id
    and slot_code = p_slot_code;

  return jsonb_build_object(
    'success', true,
    'slot_code', p_slot_code
  );
end;
$function$;

create or replace function public.save_my_profile_showcase(
  p_is_public boolean default false,
  p_headline text default null,
  p_subheadline text default null,
  p_deck_spotlight_title text default null,
  p_deck_spotlight_text text default null,
  p_featured_card_id bigint default null,
  p_featured_card_note text default null,
  p_flex_title text default null,
  p_flex_text text default null,
  p_highlight_title text default null,
  p_highlight_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
begin
  v_actor_id := public._assert_authenticated_user();

  if p_featured_card_id is not null and not exists (
    select 1
    from public.cards c
    where c.id = p_featured_card_id
  ) then
    raise exception 'Featured card not found';
  end if;

  insert into public.profile_showcase_settings (
    user_id,
    is_public,
    headline,
    subheadline,
    deck_spotlight_title,
    deck_spotlight_text,
    featured_card_id,
    featured_card_note,
    flex_title,
    flex_text,
    highlight_title,
    highlight_text,
    updated_at
  )
  values (
    v_actor_id,
    coalesce(p_is_public, false),
    nullif(trim(coalesce(p_headline, '')), ''),
    nullif(trim(coalesce(p_subheadline, '')), ''),
    nullif(trim(coalesce(p_deck_spotlight_title, '')), ''),
    nullif(trim(coalesce(p_deck_spotlight_text, '')), ''),
    p_featured_card_id,
    nullif(trim(coalesce(p_featured_card_note, '')), ''),
    nullif(trim(coalesce(p_flex_title, '')), ''),
    nullif(trim(coalesce(p_flex_text, '')), ''),
    nullif(trim(coalesce(p_highlight_title, '')), ''),
    nullif(trim(coalesce(p_highlight_text, '')), ''),
    now()
  )
  on conflict (user_id)
  do update set
    is_public = excluded.is_public,
    headline = excluded.headline,
    subheadline = excluded.subheadline,
    deck_spotlight_title = excluded.deck_spotlight_title,
    deck_spotlight_text = excluded.deck_spotlight_text,
    featured_card_id = excluded.featured_card_id,
    featured_card_note = excluded.featured_card_note,
    flex_title = excluded.flex_title,
    flex_text = excluded.flex_text,
    highlight_title = excluded.highlight_title,
    highlight_text = excluded.highlight_text,
    updated_at = now();

  return public.get_my_premium_state();
end;
$function$;

create or replace function public.search_showcase_cards(
  p_query text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
begin
  perform public._assert_authenticated_user();

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'image_url', c.image_url
        )
        order by c.name
      )
      from (
        select c.id, c.name, c.image_url
        from public.cards c
        where p_query is null
          or trim(p_query) = ''
          or c.name ilike '%' || trim(p_query) || '%'
        order by c.name
        limit 24
      ) c
    ),
    '[]'::jsonb
  );
end;
$function$;

create or replace function public.get_random_public_showcase()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_showcase record;
begin
  select
    s.*,
    p.username,
    p.avatar_url,
    c.name as featured_card_name,
    c.image_url as featured_card_image_url
  into v_showcase
  from public.profile_showcase_settings s
  join public.profiles p
    on p.id = s.user_id
  left join public.cards c
    on c.id = s.featured_card_id
  where s.is_public = true
  order by random()
  limit 1;

  if not found then
    return jsonb_build_object(
      'success', true,
      'showcase', null
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'showcase',
      jsonb_build_object(
        'user_id', v_showcase.user_id,
        'username', v_showcase.username,
        'avatar_url', v_showcase.avatar_url,
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
              where e.user_id = v_showcase.user_id
            ),
            '{}'::jsonb
          )
      )
  );
end;
$function$;

create or replace function public.admin_grant_gentlemens_tokens(
  p_target_user_id uuid,
  p_amount integer,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
  v_balance integer;
begin
  v_actor_id := public._assert_authenticated_user();
  perform public._assert_admin_plus();

  if p_target_user_id is null then
    raise exception 'Target user is required';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Grant amount must be greater than 0';
  end if;

  v_balance := public._grant_gentlemens_tokens(
    p_target_user_id,
    p_amount,
    'admin_grant',
    coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Admin+ grant'),
    null,
    null,
    v_actor_id
  );

  return jsonb_build_object(
    'success', true,
    'target_user_id', p_target_user_id,
    'amount', p_amount,
    'new_balance', v_balance
  );
end;
$function$;

create or replace function public.admin_set_premium_item_price(
  p_item_id uuid,
  p_price integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_item record;
begin
  perform public._assert_authenticated_user();
  perform public._assert_admin_plus();

  if p_price is null or p_price < 0 then
    raise exception 'Price must be 0 or greater';
  end if;

  update public.premium_store_items
  set
    price = p_price,
    updated_at = now()
  where id = p_item_id
  returning *
  into v_item;

  if not found then
    raise exception 'Premium item not found';
  end if;

  return jsonb_build_object(
    'success', true,
    'item_id', v_item.id,
    'price', v_item.price
  );
end;
$function$;

create or replace function public.admin_set_premium_auto_round_tokens_enabled(
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_actor_id uuid;
begin
  v_actor_id := public._assert_authenticated_user();
  perform public._assert_admin_plus();

  insert into public.premium_system_settings (
    singleton,
    auto_main_round_tokens_enabled,
    updated_at,
    updated_by_user_id
  )
  values (
    true,
    coalesce(p_enabled, false),
    now(),
    v_actor_id
  )
  on conflict (singleton)
  do update set
    auto_main_round_tokens_enabled = excluded.auto_main_round_tokens_enabled,
    updated_at = now(),
    updated_by_user_id = v_actor_id;

  return jsonb_build_object(
    'success', true,
    'auto_main_round_tokens_enabled', coalesce(p_enabled, false)
  );
end;
$function$;

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

create or replace function public.advance_series_phase(
  p_series_id uuid,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_series record;
  v_player_count integer;
  v_ready_count integer;
  v_round_step_value integer;
  v_existing_bracket_id uuid;
  v_remaining_matches integer;
  v_reward_result jsonb := '{}'::jsonb;
  v_next_round integer;
  v_next_step integer;
  v_previous_round integer;
begin
  perform public._assert_authenticated_user();
  perform public._assert_series_admin_or_admin_plus(p_series_id);

  select *
  into v_series
  from public.game_series gs
  where gs.id = p_series_id
  for update;

  if not found then
    raise exception 'Series not found';
  end if;

  v_previous_round := coalesce(v_series.round_number, 0);
  v_round_step_value := public._progression_round_step_value(v_series.round_step);

  select count(*)
  into v_player_count
  from public.series_players sp
  where sp.series_id = p_series_id;

  select count(*)
  into v_ready_count
  from public.series_phase_ready_states rs
  where rs.series_id = p_series_id
    and rs.round_number = v_series.round_number
    and rs.round_step = v_round_step_value
    and rs.phase = v_series.current_phase;

  if v_series.current_phase = 'standby' then
    if not p_force and v_player_count > 0 and v_ready_count < v_player_count then
      raise exception 'Not all players are ready to leave Standby Phase';
    end if;

    update public.game_series
    set
      current_phase = 'deckbuilding',
      round_step = case
        when round_number = 0 then 1
        else coalesce(round_step, 1)
      end,
      updated_at = now()
    where id = p_series_id
    returning *
    into v_series;
  elsif v_series.current_phase = 'deckbuilding' then
    if not p_force and v_player_count > 0 and v_ready_count < v_player_count then
      raise exception 'Not all players are ready to leave Deckbuilding Phase';
    end if;

    v_round_step_value := case
      when v_series.round_number = 0 then 1
      else public._progression_round_step_value(v_series.round_step)
    end;

    v_existing_bracket_id := public._get_series_current_bracket_id(
      p_series_id,
      v_series.round_number,
      v_round_step_value
    );

    if v_existing_bracket_id is null then
      perform public.generate_series_bracket(p_series_id);
    end if;

    update public.game_series
    set
      current_phase = 'dueling',
      round_step = v_round_step_value,
      updated_at = now()
    where id = p_series_id
    returning *
    into v_series;
  elsif v_series.current_phase = 'dueling' then
    v_existing_bracket_id := public._get_series_current_bracket_id(
      p_series_id,
      v_series.round_number,
      public._progression_round_step_value(v_series.round_step)
    );

    if v_existing_bracket_id is null then
      raise exception 'No bracket exists for the current duel phase';
    end if;

    select count(*)
    into v_remaining_matches
    from public.series_bracket_matches m
    where m.bracket_id = v_existing_bracket_id
      and m.status <> 'completed'
      and m.player1_user_id is not null
      and m.player2_user_id is not null;

    if v_remaining_matches > 0 then
      raise exception 'Not all duel results have been reported';
    end if;

    update public.game_series
    set
      current_phase = 'reward',
      updated_at = now()
    where id = p_series_id
    returning *
    into v_series;
  elsif v_series.current_phase = 'reward' then
    if not p_force and exists (
      select 1
      from public.series_reward_processing_errors e
      where e.series_id = p_series_id
        and e.round_number = v_series.round_number
        and e.round_step = v_round_step_value
        and e.cleared_at is null
    ) then
      raise exception 'Reward processing still has unresolved errors';
    end if;

    v_reward_result := public._process_series_round_rewards(p_series_id, p_force);

    if coalesce((v_reward_result ->> 'error_count')::integer, 0) > 0 and not p_force then
      raise exception 'Reward processing failed for one or more players';
    end if;

    if v_series.round_number = 0 then
      v_next_round := 1;
      v_next_step := 1;
    elsif public._progression_round_step_value(v_series.round_step) = 1 then
      v_next_round := v_series.round_number;
      v_next_step := 2;
    else
      v_next_round := v_series.round_number + 1;
      v_next_step := 1;
    end if;

    update public.game_series
    set
      current_phase = 'standby',
      round_number = v_next_round,
      round_step = v_next_step,
      updated_at = now()
    where id = p_series_id
    returning *
    into v_series;

    if v_next_step = 1 and v_previous_round > 0 then
      perform public._award_completed_main_round_tokens(
        p_series_id,
        v_previous_round
      );
    end if;

    if coalesce(v_series.round_number, 0) > v_previous_round then
      perform public._decrement_series_protections(p_series_id);
    end if;
  else
    raise exception 'Unsupported phase: %', v_series.current_phase;
  end if;

  return jsonb_build_object(
    'success', true,
    'current_phase', v_series.current_phase,
    'round_number', v_series.round_number,
    'round_step', v_series.round_step,
    'force', p_force,
    'reward_result', v_reward_result
  );
end;
$function$;

commit;
