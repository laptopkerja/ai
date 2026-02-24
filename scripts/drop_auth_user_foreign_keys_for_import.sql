-- Run this in Supabase SQL Editor BEFORE importing cross-project backup data.
-- Purpose: remove auth.users FK constraints so CSV/SQL import from another project
-- does not fail on unmatched user UUIDs.
-- Safe to run multiple times.

alter table if exists public.team_presets
  drop constraint if exists team_presets_created_by_user_id_fkey,
  drop constraint if exists team_presets_updated_by_user_id_fkey;

alter table if exists public.team_preset_versions
  drop constraint if exists team_preset_versions_actor_user_id_fkey;

alter table if exists public.dashboard_alerts
  drop constraint if exists dashboard_alerts_created_by_user_id_fkey,
  drop constraint if exists dashboard_alerts_acknowledged_by_user_id_fkey,
  drop constraint if exists dashboard_alerts_resolved_by_user_id_fkey;

alter table if exists public.dashboard_snapshots
  drop constraint if exists dashboard_snapshots_generated_by_user_id_fkey;

alter table if exists public.user_provider_keys
  drop constraint if exists user_provider_keys_user_id_fkey;

alter table if exists public.profiles
  drop constraint if exists profiles_id_fkey;

comment on table public.team_presets is
'Shared presets for trusted team users. Auth-user FK removed for cross-project import portability.';
