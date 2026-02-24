-- Run this in Supabase SQL Editor.
-- Purpose: add key_version column for encrypted provider keys (backward compatible).
-- Safe to run multiple times.

do $$
begin
  if to_regclass('public.user_provider_keys') is null then
    raise notice 'public.user_provider_keys tidak ditemukan; migration dilewati.';
    return;
  end if;

  execute '
    alter table public.user_provider_keys
      add column if not exists key_version integer
  ';

  execute '
    update public.user_provider_keys
    set key_version = coalesce(key_version, 1)
  ';

  execute '
    alter table public.user_provider_keys
      alter column key_version set default 1
  ';

  execute '
    alter table public.user_provider_keys
      alter column key_version set not null
  ';

  execute $sql$
    comment on column public.user_provider_keys.key_version is
    'Encryption payload schema version. Current version = 1.';
  $sql$;
end $$;

