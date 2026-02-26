-- Run this in Supabase SQL Editor.
-- Purpose: store real platform performance metrics (retention/CTR/ranking live).
-- Safe to run multiple times (idempotent).

create extension if not exists pgcrypto;

create table if not exists public.platform_performance_metrics (
  id uuid primary key default gen_random_uuid(),
  observed_at timestamptz not null default now(),
  platform text not null,
  channel_id text null,
  content_id text null,
  period text not null default 'daily',
  retention_rate numeric(6, 2) null,
  ctr numeric(6, 2) null,
  ranking_live numeric(10, 2) null,
  impressions bigint null,
  views bigint null,
  clicks bigint null,
  watch_time_seconds bigint null,
  source text not null default 'manual',
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid null,
  created_by_display_name text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.platform_performance_metrics
  add column if not exists observed_at timestamptz,
  add column if not exists platform text,
  add column if not exists channel_id text,
  add column if not exists content_id text,
  add column if not exists period text,
  add column if not exists retention_rate numeric(6, 2),
  add column if not exists ctr numeric(6, 2),
  add column if not exists ranking_live numeric(10, 2),
  add column if not exists impressions bigint,
  add column if not exists views bigint,
  add column if not exists clicks bigint,
  add column if not exists watch_time_seconds bigint,
  add column if not exists source text,
  add column if not exists metadata jsonb,
  add column if not exists created_by_user_id uuid,
  add column if not exists created_by_display_name text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

update public.platform_performance_metrics
set
  observed_at = coalesce(observed_at, created_at, now()),
  platform = coalesce(nullif(platform, ''), 'TikTok'),
  period = case
    when lower(coalesce(period, '')) in ('hourly', 'daily', 'weekly', 'monthly', 'lifetime') then lower(period)
    else 'daily'
  end,
  retention_rate = case
    when retention_rate is null then null
    when retention_rate < 0 then 0
    when retention_rate > 100 then 100
    else retention_rate
  end,
  ctr = case
    when ctr is null then null
    when ctr < 0 then 0
    when ctr > 100 then 100
    else ctr
  end,
  ranking_live = case
    when ranking_live is null then null
    when ranking_live < 1 then null
    else ranking_live
  end,
  impressions = case
    when impressions is null then null
    when impressions < 0 then 0
    else impressions
  end,
  views = case
    when views is null then null
    when views < 0 then 0
    else views
  end,
  clicks = case
    when clicks is null then null
    when clicks < 0 then 0
    else clicks
  end,
  watch_time_seconds = case
    when watch_time_seconds is null then null
    when watch_time_seconds < 0 then 0
    else watch_time_seconds
  end,
  source = coalesce(nullif(source, ''), 'manual'),
  metadata = coalesce(metadata, '{}'::jsonb),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

alter table public.platform_performance_metrics
  alter column observed_at set default now(),
  alter column observed_at set not null,
  alter column platform set not null,
  alter column period set default 'daily',
  alter column period set not null,
  alter column source set default 'manual',
  alter column source set not null,
  alter column metadata set default '{}'::jsonb,
  alter column metadata set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

create index if not exists idx_platform_performance_metrics_platform_observed
  on public.platform_performance_metrics (platform, observed_at desc);

create index if not exists idx_platform_performance_metrics_observed
  on public.platform_performance_metrics (observed_at desc);

alter table public.platform_performance_metrics enable row level security;

grant usage on schema public to authenticated;
grant select on table public.platform_performance_metrics to authenticated;
revoke all on table public.platform_performance_metrics from anon;

drop policy if exists "platform_performance_metrics_select_authenticated" on public.platform_performance_metrics;
create policy "platform_performance_metrics_select_authenticated"
  on public.platform_performance_metrics for select
  to authenticated
  using (true);

comment on table public.platform_performance_metrics is
'Real platform performance metrics import (retention, CTR, ranking live) for cross-platform audit.';
