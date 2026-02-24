-- Run this in Supabase SQL Editor (backup project).
-- Purpose: ensure base auth/profile/provider-key tables exist before other migrations.
-- Safe to run multiple times (idempotent).

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key,
  email text null,
  avatar_url text null,
  display_name text null,
  phone text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists email text,
  add column if not exists avatar_url text,
  add column if not exists display_name text,
  add column if not exists phone text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

update public.profiles
set
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

alter table public.profiles
  alter column created_at set default now(),
  alter column updated_at set default now(),
  alter column created_at set not null,
  alter column updated_at set not null;

create index if not exists idx_profiles_email on public.profiles (email);

alter table public.profiles
  drop constraint if exists profiles_id_fkey;

create table if not exists public.user_provider_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  provider text not null,
  key_ciphertext text not null,
  key_iv text not null,
  key_tag text not null,
  key_version integer not null default 1,
  key_last4 text null,
  is_active boolean not null default true,
  user_display_name text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_provider_keys
  add column if not exists user_id uuid,
  add column if not exists provider text,
  add column if not exists key_ciphertext text,
  add column if not exists key_iv text,
  add column if not exists key_tag text,
  add column if not exists key_version integer,
  add column if not exists key_last4 text,
  add column if not exists is_active boolean,
  add column if not exists user_display_name text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

update public.user_provider_keys
set
  key_version = coalesce(key_version, 1),
  is_active = coalesce(is_active, true),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

alter table public.user_provider_keys
  alter column key_version set default 1,
  alter column is_active set default true,
  alter column created_at set default now(),
  alter column updated_at set default now(),
  alter column key_version set not null,
  alter column is_active set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_provider_keys_user_provider_unique'
  ) then
    alter table public.user_provider_keys
      add constraint user_provider_keys_user_provider_unique unique (user_id, provider);
  end if;
exception
  when duplicate_object then null;
end $$;

alter table public.user_provider_keys
  drop constraint if exists user_provider_keys_user_id_fkey;

create index if not exists idx_user_provider_keys_user_id on public.user_provider_keys (user_id);
create index if not exists idx_user_provider_keys_provider on public.user_provider_keys (provider);

alter table public.profiles enable row level security;
alter table public.user_provider_keys enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.user_provider_keys to authenticated;

revoke all on table public.profiles from anon;
revoke all on table public.user_provider_keys from anon;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists user_provider_keys_select_own on public.user_provider_keys;
create policy user_provider_keys_select_own on public.user_provider_keys
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists user_provider_keys_insert_own on public.user_provider_keys;
create policy user_provider_keys_insert_own on public.user_provider_keys
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists user_provider_keys_update_own on public.user_provider_keys;
create policy user_provider_keys_update_own on public.user_provider_keys
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists user_provider_keys_delete_own on public.user_provider_keys;
create policy user_provider_keys_delete_own on public.user_provider_keys
  for delete to authenticated
  using (auth.uid() = user_id);

comment on table public.profiles is
'User profile table for auth-linked app metadata (display_name, avatar_url, phone).';

comment on table public.user_provider_keys is
'Encrypted per-user provider API keys. Plaintext key is never stored.';
