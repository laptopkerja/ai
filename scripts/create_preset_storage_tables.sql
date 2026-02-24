-- Run this in Supabase SQL Editor.
-- Purpose: team-shared preset storage (single source of truth) + lightweight version history.
-- Safe to run multiple times (idempotent).

create extension if not exists pgcrypto;

-- Optional cleanup (uncomment only if you are sure old tables are no longer used):
-- drop table if exists public.public_preset_catalog cascade;
-- drop table if exists public.user_preset_workflows cascade;
-- drop table if exists public.user_preset_versions cascade;
-- drop table if exists public.user_presets cascade;

create table if not exists public.team_presets (
  id uuid primary key default gen_random_uuid(),
  preset_id text not null unique,
  title text not null,
  preset jsonb not null,
  version integer not null default 1,
  created_by_user_id uuid null,
  created_by_display_name text null,
  updated_by_user_id uuid null,
  updated_by_display_name text null,
  last_action text not null default 'create',
  last_action_at timestamptz null,
  last_cloned_from_preset_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.team_presets
  add column if not exists preset_id text,
  add column if not exists title text,
  add column if not exists preset jsonb,
  add column if not exists version integer,
  add column if not exists created_by_user_id uuid,
  add column if not exists created_by_display_name text,
  add column if not exists updated_by_user_id uuid,
  add column if not exists updated_by_display_name text,
  add column if not exists last_action text,
  add column if not exists last_action_at timestamptz,
  add column if not exists last_cloned_from_preset_id text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'team_presets_preset_id_key'
  ) then
    alter table public.team_presets
      add constraint team_presets_preset_id_key unique (preset_id);
  end if;
end $$;

alter table public.team_presets
  drop constraint if exists team_presets_created_by_user_id_fkey,
  drop constraint if exists team_presets_updated_by_user_id_fkey;

alter table public.team_presets
  alter column version set default 1,
  alter column last_action set default 'create',
  alter column created_at set default now(),
  alter column updated_at set default now();

update public.team_presets
set
  preset_id = coalesce(nullif(preset_id, ''), 'preset-' || replace(id::text, '-', '')),
  title = coalesce(
    nullif(title, ''),
    nullif(preset->>'title', ''),
    coalesce(nullif(preset_id, ''), 'preset-' || replace(id::text, '-', ''))
  ),
  version = coalesce(version, 1),
  last_action = coalesce(nullif(last_action, ''), 'create'),
  created_by_display_name = coalesce(
    nullif(created_by_display_name, ''),
    nullif(preset->'meta'->>'createdBy', '')
  ),
  updated_by_display_name = coalesce(
    nullif(updated_by_display_name, ''),
    nullif(created_by_display_name, ''),
    nullif(preset->'meta'->>'createdBy', '')
  ),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now()),
  last_action_at = coalesce(
    last_action_at,
    updated_at,
    created_at,
    now()
  );

do $$
begin
  if to_regclass('public.profiles') is not null then
    execute $sql$
      update public.team_presets t
      set created_by_display_name = coalesce(
        nullif(t.created_by_display_name, ''),
        nullif(
          trim(coalesce(
            to_jsonb(p)->>'user_display_name',
            to_jsonb(p)->>'User Display Name',
            to_jsonb(p)->>'user display name',
            to_jsonb(p)->>'display_name',
            to_jsonb(p)->>'Display Name',
            to_jsonb(p)->>'display name',
            to_jsonb(p)->>'full_name',
            to_jsonb(p)->>'Full Name',
            to_jsonb(p)->>'name',
            to_jsonb(p)->>'Name',
            to_jsonb(p)->>'email',
            to_jsonb(p)->>'Email'
          )),
          ''
        )
      )
      from public.profiles p
      where p.id = t.created_by_user_id
        and coalesce(nullif(t.created_by_display_name, ''), '') = '';
    $sql$;

    execute $sql$
      update public.team_presets t
      set updated_by_display_name = coalesce(
        nullif(t.updated_by_display_name, ''),
        nullif(
          trim(coalesce(
            to_jsonb(p)->>'user_display_name',
            to_jsonb(p)->>'User Display Name',
            to_jsonb(p)->>'user display name',
            to_jsonb(p)->>'display_name',
            to_jsonb(p)->>'Display Name',
            to_jsonb(p)->>'display name',
            to_jsonb(p)->>'full_name',
            to_jsonb(p)->>'Full Name',
            to_jsonb(p)->>'name',
            to_jsonb(p)->>'Name',
            to_jsonb(p)->>'email',
            to_jsonb(p)->>'Email'
          )),
          ''
        )
      )
      from public.profiles p
      where p.id = t.updated_by_user_id
        and coalesce(nullif(t.updated_by_display_name, ''), '') = '';
    $sql$;
  else
    raise notice 'public.profiles tidak ditemukan; backfill display name preset dilewati.';
  end if;
end $$;

delete from public.team_presets
where preset is null;

alter table public.team_presets
  alter column preset_id set not null,
  alter column title set not null,
  alter column preset set not null,
  alter column version set not null,
  alter column last_action set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

create table if not exists public.team_preset_versions (
  id uuid primary key default gen_random_uuid(),
  team_preset_id uuid not null references public.team_presets(id) on delete cascade,
  snapshot_version integer not null default 1,
  action text not null default 'edit',
  snapshot jsonb not null,
  actor_user_id uuid null,
  actor_display_name text null,
  created_at timestamptz not null default now()
);

alter table public.team_preset_versions
  add column if not exists team_preset_id uuid,
  add column if not exists snapshot_version integer,
  add column if not exists action text,
  add column if not exists snapshot jsonb,
  add column if not exists actor_user_id uuid,
  add column if not exists actor_display_name text,
  add column if not exists created_at timestamptz;

alter table public.team_preset_versions
  alter column snapshot_version set default 1,
  alter column action set default 'edit',
  alter column created_at set default now();

alter table public.team_preset_versions
  drop constraint if exists team_preset_versions_actor_user_id_fkey;

update public.team_preset_versions
set
  snapshot_version = coalesce(snapshot_version, 1),
  action = coalesce(nullif(action, ''), 'edit'),
  created_at = coalesce(created_at, now());

update public.team_presets t
set
  updated_by_display_name = coalesce(
    nullif(t.updated_by_display_name, ''),
    nullif(v.actor_display_name, '')
  ),
  created_by_display_name = coalesce(
    nullif(t.created_by_display_name, ''),
    nullif(v.actor_display_name, '')
  ),
  last_action = coalesce(
    nullif(t.last_action, ''),
    nullif(v.action, ''),
    'edit'
  ),
  last_action_at = coalesce(t.last_action_at, v.created_at, t.updated_at, t.created_at, now())
from (
  select distinct on (team_preset_id)
    team_preset_id,
    actor_display_name,
    action,
    created_at
  from public.team_preset_versions
  where coalesce(nullif(actor_display_name, ''), '') <> ''
  order by team_preset_id, created_at desc
) v
where v.team_preset_id = t.id
  and (
    coalesce(nullif(t.updated_by_display_name, ''), '') = '' or
    coalesce(nullif(t.created_by_display_name, ''), '') = '' or
    t.last_action_at is null
  );

update public.team_presets
set
  created_by_display_name = coalesce(nullif(created_by_display_name, ''), 'unknown'),
  updated_by_display_name = coalesce(nullif(updated_by_display_name, ''), created_by_display_name, 'unknown'),
  last_action = coalesce(nullif(last_action, ''), 'edit'),
  last_action_at = coalesce(last_action_at, updated_at, created_at, now());

delete from public.team_preset_versions v
where v.team_preset_id is null
  or v.snapshot is null
  or not exists (
    select 1
    from public.team_presets p
    where p.id = v.team_preset_id
  );

alter table public.team_preset_versions
  alter column snapshot_version set not null,
  alter column action set not null,
  alter column snapshot set not null,
  alter column created_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'team_preset_versions_team_preset_id_fkey'
  ) then
    alter table public.team_preset_versions
      add constraint team_preset_versions_team_preset_id_fkey
      foreign key (team_preset_id) references public.team_presets(id) on delete cascade;
  end if;
exception
  when duplicate_object then null;
end $$;

create index if not exists idx_team_presets_updated_at
  on public.team_presets (updated_at desc);

create index if not exists idx_team_presets_preset_id
  on public.team_presets (preset_id);

create index if not exists idx_team_preset_versions_team_created
  on public.team_preset_versions (team_preset_id, created_at desc);

alter table public.team_presets enable row level security;
alter table public.team_preset_versions enable row level security;

grant usage on schema public to authenticated;
grant select on table public.team_presets to authenticated;
grant select on table public.team_preset_versions to authenticated;
revoke all on table public.team_presets from anon;
revoke all on table public.team_preset_versions from anon;

drop policy if exists "team_presets_select_authenticated" on public.team_presets;
create policy "team_presets_select_authenticated"
  on public.team_presets for select
  to authenticated
  using (true);

drop policy if exists "team_preset_versions_select_authenticated" on public.team_preset_versions;
create policy "team_preset_versions_select_authenticated"
  on public.team_preset_versions for select
  to authenticated
  using (true);

comment on table public.team_presets is
'Shared presets for trusted team users. Includes title + creator/editor display names + last action metadata.';
comment on table public.team_preset_versions is
'Version snapshots for team_presets. Keep latest N in backend (default 20).';
