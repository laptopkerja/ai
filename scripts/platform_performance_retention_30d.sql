-- Run this in Supabase SQL Editor.
-- Purpose: keep only latest 30 days of platform_performance_metrics.
-- Safe to run multiple times (idempotent).

-- 1) Cleanup function (can be called manually or by scheduler)
create or replace function public.cleanup_platform_performance_metrics_30d()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
begin
  delete from public.platform_performance_metrics
  where observed_at < now() - interval '30 days';

  get diagnostics deleted_count = row_count;
  return coalesce(deleted_count, 0);
end;
$$;

comment on function public.cleanup_platform_performance_metrics_30d() is
'Delete platform_performance_metrics rows older than 30 days (rolling retention).';

-- Restrict function execution to service role (for scheduler/secure backend only).
do $$
begin
  revoke all on function public.cleanup_platform_performance_metrics_30d() from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.cleanup_platform_performance_metrics_30d() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.cleanup_platform_performance_metrics_30d() from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.cleanup_platform_performance_metrics_30d() to service_role;
  end if;
end $$;

-- 2) Run once now (manual immediate cleanup)
select public.cleanup_platform_performance_metrics_30d() as deleted_rows_now;

-- 3) Optional: register daily cron job at 02:17 UTC.
-- This block is defensive: if pg_cron is unavailable, script still succeeds.
do $$
declare
  has_pg_cron boolean := false;
begin
  select exists (
    select 1
    from pg_extension
    where extname = 'pg_cron'
  ) into has_pg_cron;

  if not has_pg_cron then
    begin
      create extension if not exists pg_cron;
      has_pg_cron := true;
    exception
      when others then
        raise notice 'pg_cron unavailable (%). Cleanup remains manual.', sqlerrm;
    end;
  end if;

  if has_pg_cron then
    if to_regclass('cron.job') is null then
      raise notice 'cron.job not found. Cleanup remains manual.';
    elsif not exists (
      select 1
      from cron.job
      where jobname = 'cleanup_platform_performance_metrics_30d_daily'
    ) then
      perform cron.schedule(
        'cleanup_platform_performance_metrics_30d_daily',
        '17 2 * * *',
        $job$select public.cleanup_platform_performance_metrics_30d();$job$
      );
      raise notice 'Cron job cleanup_platform_performance_metrics_30d_daily created.';
    else
      raise notice 'Cron job cleanup_platform_performance_metrics_30d_daily already exists.';
    end if;
  end if;
end $$;
