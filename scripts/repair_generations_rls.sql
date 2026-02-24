-- Run this in Supabase SQL Editor (project aktif yang dipakai app).
-- Purpose: fix 403 Forbidden on insert/select/update/delete for public.generations.
-- Safe to run multiple times.

create extension if not exists pgcrypto;

create table if not exists public.generations (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  user_display_name text null,
  topic text not null default '',
  platform text not null default '',
  provider text not null default '',
  result jsonb,
  created_at timestamptz not null default now()
);

alter table public.generations
  add column if not exists user_display_name text;

create index if not exists idx_generations_user_created_at
  on public.generations(user_id, created_at desc);

alter table public.generations enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.generations to authenticated;
revoke all on table public.generations from anon;

-- Drop all existing policies first (some old policy names may differ).
do $$
declare p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'generations'
  loop
    execute format('drop policy if exists %I on public.generations', p.policyname);
  end loop;
end $$;

-- Recreate clean policies.
create policy generations_select_team
  on public.generations
  for select
  to authenticated
  using (true);

create policy generations_insert_owner
  on public.generations
  for insert
  to authenticated
  with check (auth.uid()::text = user_id::text);

create policy generations_update_owner
  on public.generations
  for update
  to authenticated
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

create policy generations_delete_owner
  on public.generations
  for delete
  to authenticated
  using (auth.uid()::text = user_id::text);

comment on table public.generations is
'Public team generation history feed (read by all authenticated users); write/delete restricted to owner via auth.uid().';
