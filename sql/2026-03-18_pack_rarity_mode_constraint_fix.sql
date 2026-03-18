do $sql$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'containers_rarity_mode_check'
      and conrelid = 'public.containers'::regclass
  ) then
    execute 'alter table public.containers drop constraint containers_rarity_mode_check';
  end if;

  execute $stmt$
    alter table public.containers
      add constraint containers_rarity_mode_check
      check (
        rarity_mode = any (
          array[
            'normal'::text,
            'common_only'::text,
            'boosted'::text,
            'pack_slots'::text
          ]
        )
      )
  $stmt$;
end;
$sql$;
