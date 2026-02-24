-- Run this in Supabase SQL Editor.
-- Purpose: storage for team-wide encrypted integration keys (e.g. TMDB API key).
-- Safe to run multiple times (idempotent).

create extension if not exists pgcrypto;

create table if not exists public.team_integration_keys (
  id uuid primary key default gen_random_uuid(),
  key_name text not null unique,
  key_ciphertext text not null,
  key_iv text not null,
  key_tag text not null,
  key_version integer not null default 1,
  key_last4 text null,
  is_active boolean not null default true,
  updated_by_user_id uuid null,
  updated_by_display_name text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.team_integration_keys
  add column if not exists key_name text,
  add column if not exists key_ciphertext text,
  add column if not exists key_iv text,
  add column if not exists key_tag text,
  add column if not exists key_version integer,
  add column if not exists key_last4 text,
  add column if not exists is_active boolean,
  add column if not exists updated_by_user_id uuid,
  add column if not exists updated_by_display_name text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'team_integration_keys_key_name_key'
  ) then
    alter table public.team_integration_keys
      add constraint team_integration_keys_key_name_key unique (key_name);
  end if;
exception
  when duplicate_object then null;
end $$;

update public.team_integration_keys
set
  key_version = coalesce(key_version, 1),
  is_active = coalesce(is_active, true),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

delete from public.team_integration_keys
where key_name is null
  or key_ciphertext is null
  or key_iv is null
  or key_tag is null;

alter table public.team_integration_keys
  alter column key_name set not null,
  alter column key_ciphertext set not null,
  alter column key_iv set not null,
  alter column key_tag set not null,
  alter column key_version set default 1,
  alter column key_version set not null,
  alter column is_active set default true,
  alter column is_active set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

create index if not exists idx_team_integration_keys_key_name
  on public.team_integration_keys (key_name);

create index if not exists idx_team_integration_keys_updated_at
  on public.team_integration_keys (updated_at desc);

alter table public.team_integration_keys enable row level security;

revoke all on table public.team_integration_keys from anon;
revoke all on table public.team_integration_keys from authenticated;

comment on table public.team_integration_keys is
'Encrypted team-wide integration keys (TMDB, etc). Access via backend service-role only.';
