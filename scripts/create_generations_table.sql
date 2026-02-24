-- Run this in Supabase SQL Editor.
-- Purpose: create/repair `public.generations` with proper RLS + privileges.
-- Safe to run multiple times (idempotent).

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

-- RLS policies:
-- - select: public for all authenticated users (team feed)
-- - insert/update/delete: owner only
drop policy if exists generations_select_own on public.generations;
create policy generations_select_own on public.generations
  for select to authenticated
  using (true);

drop policy if exists generations_insert_own on public.generations;
create policy generations_insert_own on public.generations
  for insert to authenticated
  with check (auth.uid()::text = user_id::text);

drop policy if exists generations_update_own on public.generations;
create policy generations_update_own on public.generations
  for update to authenticated
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

drop policy if exists generations_delete_own on public.generations;
create policy generations_delete_own on public.generations
  for delete to authenticated
  using (auth.uid()::text = user_id::text);

comment on table public.generations is
'Public team generation history feed (read by all authenticated users); write/delete restricted to owner via auth.uid() = user_id.';
