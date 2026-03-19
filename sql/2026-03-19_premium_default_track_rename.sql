update public.premium_store_items
set
  name = case code
    when 'music:egyptian-1' then 'Project Onyx'
    when 'music:egyptian-2' then 'Egyptian 1'
    when 'music:egyptian-3' then 'Egyptian 2'
    when 'music:egyptian-4' then 'Egyptian 3'
    when 'music:egyptian-5' then 'Egyptian 4'
    when 'music:egyptian-6' then 'Egyptian 5'
    else name
  end,
  updated_at = now()
where code in (
  'music:egyptian-1',
  'music:egyptian-2',
  'music:egyptian-3',
  'music:egyptian-4',
  'music:egyptian-5',
  'music:egyptian-6'
);
