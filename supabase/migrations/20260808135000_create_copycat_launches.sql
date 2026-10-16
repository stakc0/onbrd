create table if not exists public.copycat_launches (
  id uuid primary key default gen_random_uuid(),
  trigger_signature text unique not null,
  buyer_wallet text,
  sol_amount numeric not null default 0,
  status text not null default 'queued' check (status in ('queued','processing','launched','ignored','failed')),
  launch_index integer,
  launched_mint text,
  launch_signature text,
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists copycat_launches_status_created_idx on public.copycat_launches(status, created_at);

create or replace function public.get_copycat_launch_stats()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'queued', count(*) filter (where status = 'queued'),
    'processing', count(*) filter (where status = 'processing'),
    'launched', count(*) filter (where status = 'launched'),
    'failed', count(*) filter (where status = 'failed'),
    'ignored', count(*) filter (where status = 'ignored'),
    'latest', coalesce(jsonb_agg(to_jsonb(t) order by created_at desc) filter (where rn <= 10), '[]'::jsonb)
  )
  from (
    select *, row_number() over (order by created_at desc) rn
    from public.copycat_launches
  ) t;
$$;


grant select on public.copycat_launches to anon, authenticated;
grant execute on function public.get_copycat_launch_stats() to anon, authenticated;
