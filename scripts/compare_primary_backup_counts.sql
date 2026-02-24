-- Run this in BOTH projects (Primary and Backup), then compare the result manually.
-- Purpose: quick data parity check before failover drill.
-- Safe read-only query.
-- This version is schema-tolerant (won't fail if some timestamp columns are missing).

drop table if exists _compare_stats;
create temporary table _compare_stats (
  table_name text,
  total_rows bigint,
  distinct_users bigint,
  min_created_at timestamptz,
  max_updated_at timestamptz
);

do $$
declare
  rec record;
  has_user_col boolean;
  has_created_at boolean;
  has_updated_at boolean;
  user_expr text;
  min_expr text;
  max_expr text;
  sql text;
begin
  for rec in
    select * from (values
      ('profiles', 'id'),
      ('user_provider_keys', 'user_id'),
      ('generations', 'user_id'),
      ('team_presets', 'created_by_user_id'),
      ('team_preset_versions', 'actor_user_id'),
      ('dashboard_alerts', 'created_by_user_id'),
      ('dashboard_snapshots', 'generated_by_user_id')
    ) as t(table_name, user_col)
  loop
    if to_regclass('public.' || rec.table_name) is null then
      continue;
    end if;

    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = rec.table_name
        and column_name = rec.user_col
    ) into has_user_col;

    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = rec.table_name
        and column_name = 'created_at'
    ) into has_created_at;

    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = rec.table_name
        and column_name = 'updated_at'
    ) into has_updated_at;

    user_expr := case
      when has_user_col then format('count(distinct %I)::bigint', rec.user_col)
      else '0::bigint'
    end;

    min_expr := case
      when has_created_at then 'min(created_at)'
      when has_updated_at then 'min(updated_at)'
      else 'null::timestamptz'
    end;

    max_expr := case
      when has_updated_at then 'max(updated_at)'
      when has_created_at then 'max(created_at)'
      else 'null::timestamptz'
    end;

    sql := format(
      'insert into _compare_stats(table_name,total_rows,distinct_users,min_created_at,max_updated_at) ' ||
      'select %L, count(*)::bigint, %s, %s, %s from public.%I',
      rec.table_name,
      user_expr,
      min_expr,
      max_expr,
      rec.table_name
    );
    execute sql;
  end loop;
end $$;

select
  table_name,
  total_rows,
  distinct_users,
  min_created_at,
  max_updated_at
from _compare_stats
order by table_name;

-- Optional detail: distribution of generations by provider (schema-tolerant).
drop table if exists _compare_gen_provider;
create temporary table _compare_gen_provider (
  provider text,
  total_rows bigint,
  latest_created_at timestamptz
);

do $$
begin
  if to_regclass('public.generations') is not null
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'generations'
         and column_name = 'provider'
     ) then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'generations'
        and column_name = 'created_at'
    ) then
      execute $sql$
        insert into _compare_gen_provider(provider,total_rows,latest_created_at)
        select
          coalesce(nullif(provider, ''), '(empty)') as provider,
          count(*)::bigint as total_rows,
          max(created_at) as latest_created_at
        from public.generations
        group by 1
      $sql$;
    else
      execute $sql$
        insert into _compare_gen_provider(provider,total_rows,latest_created_at)
        select
          coalesce(nullif(provider, ''), '(empty)') as provider,
          count(*)::bigint as total_rows,
          null::timestamptz as latest_created_at
        from public.generations
        group by 1
      $sql$;
    end if;
  end if;
end $$;

select
  provider,
  total_rows,
  latest_created_at
from _compare_gen_provider
order by total_rows desc, provider asc;

-- Optional detail: status distribution of alerts (schema-tolerant).
drop table if exists _compare_alert_status;
create temporary table _compare_alert_status (
  status text,
  total_rows bigint
);

do $$
begin
  if to_regclass('public.dashboard_alerts') is not null
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'dashboard_alerts'
         and column_name = 'status'
     ) then
    execute $sql$
      insert into _compare_alert_status(status,total_rows)
      select
        coalesce(nullif(status, ''), '(empty)') as status,
        count(*)::bigint as total_rows
      from public.dashboard_alerts
      group by 1
    $sql$;
  end if;
end $$;

select
  status,
  total_rows
from _compare_alert_status
order by total_rows desc, status asc;
