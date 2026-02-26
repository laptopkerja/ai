-- Run this in Supabase SQL Editor (backup project).
-- Purpose: quick verification for backup readiness.
-- Safe read-only checks.

-- 1) Table existence check (required app tables)
select
  to_regclass('public.profiles') as profiles,
  to_regclass('public.user_provider_keys') as user_provider_keys,
  to_regclass('public.generations') as generations,
  to_regclass('public.team_presets') as team_presets,
  to_regclass('public.team_preset_versions') as team_preset_versions,
  to_regclass('public.dashboard_alerts') as dashboard_alerts,
  to_regclass('public.dashboard_snapshots') as dashboard_snapshots,
  to_regclass('public.platform_performance_metrics') as platform_performance_metrics;

-- 1b) Critical column check for provider key table
select
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_provider_keys'
      and column_name = 'key_version'
  ) as user_provider_keys_has_key_version,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_provider_keys'
      and column_name = 'user_display_name'
  ) as user_provider_keys_has_user_display_name;

-- 2) Row counts (data readiness)
select 'profiles' as table_name, count(*) as total_rows from public.profiles
union all
select 'user_provider_keys' as table_name, count(*) as total_rows from public.user_provider_keys
union all
select 'generations' as table_name, count(*) as total_rows from public.generations
union all
select 'team_presets' as table_name, count(*) as total_rows from public.team_presets
union all
select 'team_preset_versions' as table_name, count(*) as total_rows from public.team_preset_versions
union all
select 'dashboard_alerts' as table_name, count(*) as total_rows from public.dashboard_alerts
union all
select 'dashboard_snapshots' as table_name, count(*) as total_rows from public.dashboard_snapshots
union all
select 'platform_performance_metrics' as table_name, count(*) as total_rows from public.platform_performance_metrics
order by table_name;

-- 3) RLS enabled check
select
  schemaname,
  tablename,
  rowsecurity as rls_enabled
from pg_tables
where schemaname = 'public'
  and tablename in (
    'profiles',
    'user_provider_keys',
    'generations',
    'team_presets',
    'team_preset_versions',
    'dashboard_alerts',
    'dashboard_snapshots',
    'platform_performance_metrics'
  )
order by tablename;

-- 4) Policy list check
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles',
    'user_provider_keys',
    'generations',
    'team_presets',
    'team_preset_versions',
    'dashboard_alerts',
    'dashboard_snapshots',
    'platform_performance_metrics'
  )
order by tablename, policyname;

-- 5) Avatar bucket check
select
  id,
  name,
  public,
  file_size_limit
from storage.buckets
where id = 'avatars';

-- 6) Storage policies for avatars bucket
select
  policyname,
  cmd,
  roles,
  permissive
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname like 'avatars_%'
order by policyname;
