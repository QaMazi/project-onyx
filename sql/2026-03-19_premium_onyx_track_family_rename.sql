update public.premium_store_items
set
  name = case code
    when 'music:egyptian-1' then 'Project Onyx'
    when 'music:egyptian-2' then 'Onyx 1'
    when 'music:egyptian-3' then 'Onyx 2'
    when 'music:egyptian-4' then 'Onyx 3'
    when 'music:egyptian-5' then 'Onyx 4'
    when 'music:egyptian-6' then 'Onyx 5'
    when 'music:desert-of-set' then 'Onyx 6'
    when 'music:obelisk-of-thunder' then 'Onyx 7'
    else name
  end,
  updated_at = now()
where code in (
  'music:egyptian-1',
  'music:egyptian-2',
  'music:egyptian-3',
  'music:egyptian-4',
  'music:egyptian-5',
  'music:egyptian-6',
  'music:desert-of-set',
  'music:obelisk-of-thunder'
);
