-- Run this in Supabase SQL Editor.
-- Purpose: persistent dashboard alerts + daily dashboard snapshots.
-- Safe to run multiple times (idempotent).

create extension if not exists pgcrypto;

create table if not exists public.dashboard_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_key text not null unique,
  source text not null default 'dashboard',
  status text not null default 'open',
  severity text not null default 'warning',
  message text not null,
  context jsonb not null default '{}'::jsonb,
  count integer not null default 1,
  created_by_user_id uuid null,
  created_by_display_name text null,
  acknowledged_by_user_id uuid null,
  acknowledged_by_display_name text null,
  acknowledged_at timestamptz null,
  resolved_by_user_id uuid null,
  resolved_by_display_name text null,
  resolved_at timestamptz null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dashboard_alerts
  add column if not exists alert_key text,
  add column if not exists source text,
  add column if not exists status text,
  add column if not exists severity text,
  add column if not exists message text,
  add column if not exists context jsonb,
  add column if not exists count integer,
  add column if not exists created_by_user_id uuid,
  add column if not exists created_by_display_name text,
  add column if not exists acknowledged_by_user_id uuid,
  add column if not exists acknowledged_by_display_name text,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists resolved_by_user_id uuid,
  add column if not exists resolved_by_display_name text,
  add column if not exists resolved_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dashboard_alerts_alert_key_key'
  ) then
    alter table public.dashboard_alerts
      add constraint dashboard_alerts_alert_key_key unique (alert_key);
  end if;
end $$;

alter table public.dashboard_alerts
  drop constraint if exists dashboard_alerts_created_by_user_id_fkey,
  drop constraint if exists dashboard_alerts_acknowledged_by_user_id_fkey,
  drop constraint if exists dashboard_alerts_resolved_by_user_id_fkey;

update public.dashboard_alerts
set
  alert_key = coalesce(nullif(alert_key, ''), 'alert-' || replace(id::text, '-', '')),
  source = coalesce(nullif(source, ''), 'dashboard'),
  status = case
    when lower(coalesce(status, '')) in ('open', 'acknowledged', 'resolved') then lower(status)
    else 'open'
  end,
  severity = case
    when lower(coalesce(severity, '')) in ('secondary', 'info', 'warning', 'danger', 'success') then lower(severity)
    else 'warning'
  end,
  message = coalesce(nullif(message, ''), '[empty alert message]'),
  context = coalesce(context, '{}'::jsonb),
  count = greatest(1, coalesce(count, 1)),
  last_seen_at = coalesce(last_seen_at, updated_at, now()),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

alter table public.dashboard_alerts
  alter column alert_key set not null,
  alter column source set default 'dashboard',
  alter column source set not null,
  alter column status set default 'open',
  alter column status set not null,
  alter column severity set default 'warning',
  alter column severity set not null,
  alter column message set not null,
  alter column context set default '{}'::jsonb,
  alter column context set not null,
  alter column count set default 1,
  alter column count set not null,
  alter column last_seen_at set default now(),
  alter column last_seen_at set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

create index if not exists idx_dashboard_alerts_status_updated
  on public.dashboard_alerts (status, updated_at desc);

create index if not exists idx_dashboard_alerts_last_seen
  on public.dashboard_alerts (last_seen_at desc);

create table if not exists public.dashboard_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  window_days integer not null default 7,
  source_scope text not null default 'all',
  decision_scope text not null default 'all',
  summary jsonb not null default '{}'::jsonb,
  generated_by_user_id uuid null,
  generated_by_display_name text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dashboard_snapshots
  add column if not exists snapshot_date date,
  add column if not exists window_days integer,
  add column if not exists source_scope text,
  add column if not exists decision_scope text,
  add column if not exists summary jsonb,
  add column if not exists generated_by_user_id uuid,
  add column if not exists generated_by_display_name text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dashboard_snapshots_scope_unique'
  ) then
    alter table public.dashboard_snapshots
      add constraint dashboard_snapshots_scope_unique
      unique (snapshot_date, window_days, source_scope, decision_scope);
  end if;
end $$;

alter table public.dashboard_snapshots
  drop constraint if exists dashboard_snapshots_generated_by_user_id_fkey;

update public.dashboard_snapshots
set
  snapshot_date = coalesce(snapshot_date, (created_at at time zone 'utc')::date, current_date),
  window_days = greatest(1, least(90, coalesce(window_days, 7))),
  source_scope = case
    when lower(coalesce(source_scope, '')) in ('all', 'supabase', 'local') then lower(source_scope)
    else 'all'
  end,
  decision_scope = case
    when lower(coalesce(decision_scope, '')) in ('all', 'go', 'revise', 'block') then lower(decision_scope)
    else 'all'
  end,
  summary = coalesce(summary, '{}'::jsonb),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

alter table public.dashboard_snapshots
  alter column snapshot_date set not null,
  alter column window_days set default 7,
  alter column window_days set not null,
  alter column source_scope set default 'all',
  alter column source_scope set not null,
  alter column decision_scope set default 'all',
  alter column decision_scope set not null,
  alter column summary set default '{}'::jsonb,
  alter column summary set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

create index if not exists idx_dashboard_snapshots_date_scope
  on public.dashboard_snapshots (snapshot_date desc, window_days, source_scope, decision_scope);

alter table public.dashboard_alerts enable row level security;
alter table public.dashboard_snapshots enable row level security;

grant usage on schema public to authenticated;
grant select on table public.dashboard_alerts to authenticated;
grant select on table public.dashboard_snapshots to authenticated;
revoke all on table public.dashboard_alerts from anon;
revoke all on table public.dashboard_snapshots from anon;

drop policy if exists "dashboard_alerts_select_authenticated" on public.dashboard_alerts;
create policy "dashboard_alerts_select_authenticated"
  on public.dashboard_alerts for select
  to authenticated
  using (true);

drop policy if exists "dashboard_snapshots_select_authenticated" on public.dashboard_snapshots;
create policy "dashboard_snapshots_select_authenticated"
  on public.dashboard_snapshots for select
  to authenticated
  using (true);

comment on table public.dashboard_alerts is
'Operational dashboard alerts (open/acknowledged/resolved) with team-friendly metadata.';

comment on table public.dashboard_snapshots is
'Daily dashboard snapshots per scope (window/source/decision) for trend comparison and reporting.';
