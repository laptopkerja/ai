-- Run this in Supabase SQL Editor.
-- Purpose: add owner display name label on provider keys table.
-- Safe to run multiple times and safe when dependent tables are missing.

do $$
begin
  if to_regclass('public.user_provider_keys') is null then
    raise notice 'public.user_provider_keys tidak ditemukan; migration dilewati.';
    return;
  end if;

  execute '
    alter table public.user_provider_keys
      add column if not exists user_display_name text
  ';

  if to_regclass('public.profiles') is not null then
    execute $sql$
      update public.user_provider_keys k
      set user_display_name = coalesce(
        nullif(k.user_display_name, ''),
        nullif(
          trim(coalesce(
            to_jsonb(p)->>'display_name',
            to_jsonb(p)->>'Display Name',
            to_jsonb(p)->>'display name',
            to_jsonb(p)->>'full_name',
            to_jsonb(p)->>'Full Name',
            to_jsonb(p)->>'name',
            to_jsonb(p)->>'Name'
          )),
          ''
        ),
        nullif(
          trim(coalesce(
            to_jsonb(p)->>'email',
            to_jsonb(p)->>'Email'
          )),
          ''
        )
      )
      from public.profiles p
      where p.id = k.user_id
        and coalesce(nullif(k.user_display_name, ''), '') = '';
    $sql$;
  else
    raise notice 'public.profiles tidak ditemukan; backfill user_display_name dilewati.';
  end if;

  execute $sql$
    comment on column public.user_provider_keys.user_display_name is
    'Display name owner API key. For label/audit visibility in team table view.';
  $sql$;
end $$;
