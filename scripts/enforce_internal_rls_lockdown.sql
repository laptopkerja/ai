-- Run this in Supabase SQL Editor (PRIMARY and BACKUP project).
-- Purpose: enforce authenticated-only access for app tables/storage (no anon unrestricted).
-- Safe to run multiple times (idempotent).

create extension if not exists pgcrypto;

grant usage on schema public to authenticated;

do $$
begin
  -- profiles: owner-only
  if to_regclass('public.profiles') is not null then
    execute 'alter table public.profiles enable row level security';
    execute 'grant select, insert, update on table public.profiles to authenticated';
    execute 'revoke all on table public.profiles from anon';

    execute 'drop policy if exists profiles_select_own on public.profiles';
    execute 'create policy profiles_select_own on public.profiles for select to authenticated using (auth.uid() = id)';

    execute 'drop policy if exists profiles_insert_own on public.profiles';
    execute 'create policy profiles_insert_own on public.profiles for insert to authenticated with check (auth.uid() = id)';

    execute 'drop policy if exists profiles_update_own on public.profiles';
    execute 'create policy profiles_update_own on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id)';
  else
    raise notice 'public.profiles not found (skipped)';
  end if;

  -- user_provider_keys: owner-only
  if to_regclass('public.user_provider_keys') is not null then
    execute 'alter table public.user_provider_keys enable row level security';
    execute 'grant select, insert, update, delete on table public.user_provider_keys to authenticated';
    execute 'revoke all on table public.user_provider_keys from anon';

    execute 'drop policy if exists user_provider_keys_select_own on public.user_provider_keys';
    execute 'create policy user_provider_keys_select_own on public.user_provider_keys for select to authenticated using (auth.uid() = user_id)';

    execute 'drop policy if exists user_provider_keys_insert_own on public.user_provider_keys';
    execute 'create policy user_provider_keys_insert_own on public.user_provider_keys for insert to authenticated with check (auth.uid() = user_id)';

    execute 'drop policy if exists user_provider_keys_update_own on public.user_provider_keys';
    execute 'create policy user_provider_keys_update_own on public.user_provider_keys for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)';

    execute 'drop policy if exists user_provider_keys_delete_own on public.user_provider_keys';
    execute 'create policy user_provider_keys_delete_own on public.user_provider_keys for delete to authenticated using (auth.uid() = user_id)';
  else
    raise notice 'public.user_provider_keys not found (skipped)';
  end if;

  -- generations: shared read team feed, owner write
  if to_regclass('public.generations') is not null then
    execute 'alter table public.generations enable row level security';
    execute 'grant select, insert, update, delete on table public.generations to authenticated';
    execute 'revoke all on table public.generations from anon';

    execute 'drop policy if exists generations_select_team on public.generations';
    execute 'drop policy if exists generations_select_own on public.generations';
    execute 'create policy generations_select_team on public.generations for select to authenticated using (true)';

    execute 'drop policy if exists generations_insert_owner on public.generations';
    execute 'drop policy if exists generations_insert_own on public.generations';
    execute 'create policy generations_insert_owner on public.generations for insert to authenticated with check (auth.uid()::text = user_id::text)';

    execute 'drop policy if exists generations_update_owner on public.generations';
    execute 'drop policy if exists generations_update_own on public.generations';
    execute 'create policy generations_update_owner on public.generations for update to authenticated using (auth.uid()::text = user_id::text) with check (auth.uid()::text = user_id::text)';

    execute 'drop policy if exists generations_delete_owner on public.generations';
    execute 'drop policy if exists generations_delete_own on public.generations';
    execute 'create policy generations_delete_owner on public.generations for delete to authenticated using (auth.uid()::text = user_id::text)';
  else
    raise notice 'public.generations not found (skipped)';
  end if;

  -- team presets/versions: authenticated read (write via backend service-role)
  if to_regclass('public.team_presets') is not null then
    execute 'alter table public.team_presets enable row level security';
    execute 'grant select on table public.team_presets to authenticated';
    execute 'revoke all on table public.team_presets from anon';
    execute 'drop policy if exists team_presets_select_authenticated on public.team_presets';
    execute 'create policy team_presets_select_authenticated on public.team_presets for select to authenticated using (true)';
  else
    raise notice 'public.team_presets not found (skipped)';
  end if;

  if to_regclass('public.team_preset_versions') is not null then
    execute 'alter table public.team_preset_versions enable row level security';
    execute 'grant select on table public.team_preset_versions to authenticated';
    execute 'revoke all on table public.team_preset_versions from anon';
    execute 'drop policy if exists team_preset_versions_select_authenticated on public.team_preset_versions';
    execute 'create policy team_preset_versions_select_authenticated on public.team_preset_versions for select to authenticated using (true)';
  else
    raise notice 'public.team_preset_versions not found (skipped)';
  end if;

  -- dashboard tables: authenticated read (write via backend service-role)
  if to_regclass('public.dashboard_alerts') is not null then
    execute 'alter table public.dashboard_alerts enable row level security';
    execute 'grant select on table public.dashboard_alerts to authenticated';
    execute 'revoke all on table public.dashboard_alerts from anon';
    execute 'drop policy if exists dashboard_alerts_select_authenticated on public.dashboard_alerts';
    execute 'create policy dashboard_alerts_select_authenticated on public.dashboard_alerts for select to authenticated using (true)';
  else
    raise notice 'public.dashboard_alerts not found (skipped)';
  end if;

  if to_regclass('public.dashboard_snapshots') is not null then
    execute 'alter table public.dashboard_snapshots enable row level security';
    execute 'grant select on table public.dashboard_snapshots to authenticated';
    execute 'revoke all on table public.dashboard_snapshots from anon';
    execute 'drop policy if exists dashboard_snapshots_select_authenticated on public.dashboard_snapshots';
    execute 'create policy dashboard_snapshots_select_authenticated on public.dashboard_snapshots for select to authenticated using (true)';
  else
    raise notice 'public.dashboard_snapshots not found (skipped)';
  end if;
end $$;

-- storage (avatars): authenticated own-folder only
insert into storage.buckets (id, name, public, file_size_limit)
values ('avatars', 'avatars', false, 2097152)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

drop policy if exists "avatars_select_public" on storage.objects;
drop policy if exists "avatars_select_own_folder" on storage.objects;
create policy "avatars_select_own_folder"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "avatars_insert_own_folder" on storage.objects;
create policy "avatars_insert_own_folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "avatars_update_own_folder" on storage.objects;
create policy "avatars_update_own_folder"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "avatars_delete_own_folder" on storage.objects;
create policy "avatars_delete_own_folder"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);
