-- Applied to Supabase project "ward-finder" (ref twhnzhrmkcxkigticmuc, ap-south-1)
-- as migration "create_ward_import_staging".

-- Private staging table for admin-reviewed PDF import rows.
create table public.ward_import_staging (
  id                uuid primary key default gen_random_uuid(),
  source_record_key text not null,
  person_name       text not null,
  relative_name     text,
  ward_number       text not null,
  source_filename   text not null,
  source_page       integer not null,
  status            text not null default 'staged',
  imported_by       text not null,
  created_at        timestamptz not null default now(),
  reviewed_at       timestamptz,
  reviewed_by       text,
  constraint ward_import_staging_source_record_key_key unique (source_record_key),
  constraint ward_import_staging_key_not_blank check (length(btrim(source_record_key)) > 0),
  constraint ward_import_staging_person_not_blank check (length(btrim(person_name)) > 0),
  constraint ward_import_staging_relative_not_blank check (relative_name is null or length(btrim(relative_name)) > 0),
  constraint ward_import_staging_ward_format check (ward_number ~ '^[1-9][0-9]{0,2}$'),
  constraint ward_import_staging_page_positive check (source_page >= 1),
  constraint ward_import_staging_status_valid check (status in ('staged', 'verified', 'rejected'))
);

create index ward_import_staging_status_idx on public.ward_import_staging (status);

-- RLS on, no policies, and no table privileges for client roles:
-- anon and authenticated cannot read or write. Only the server-side service role can.
alter table public.ward_import_staging enable row level security;
revoke all on public.ward_import_staging from public, anon, authenticated;

-- Atomic, idempotent batch import. One call = one transaction.
-- Existing keys are never overwritten: identical rows are counted as duplicates,
-- differing rows are reported as conflicts and skipped.
create or replace function public.import_ward_staging(p_rows jsonb, p_admin text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r record;
  v_inserted  integer := 0;
  v_identical integer := 0;
  v_conflicts jsonb   := '[]'::jsonb;
begin
  if p_admin is null or length(btrim(p_admin)) = 0 then
    raise exception 'admin identity required';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 5000 then
    raise exception 'p_rows must be a JSON array of 1 to 5000 rows';
  end if;

  for r in select value as j from jsonb_array_elements(p_rows) loop
    insert into public.ward_import_staging
      (source_record_key, person_name, relative_name, ward_number, source_filename, source_page, imported_by)
    values (
      r.j->>'source_record_key',
      r.j->>'person_name',
      nullif(r.j->>'relative_name', ''),
      r.j->>'ward_number',
      r.j->>'source_filename',
      (r.j->>'source_page')::integer,
      p_admin
    )
    on conflict (source_record_key) do nothing;

    if found then
      v_inserted := v_inserted + 1;
    elsif exists (
      select 1 from public.ward_import_staging s
      where s.source_record_key = r.j->>'source_record_key'
        and s.person_name = r.j->>'person_name'
        and s.relative_name is not distinct from nullif(r.j->>'relative_name', '')
        and s.ward_number = r.j->>'ward_number'
    ) then
      v_identical := v_identical + 1;
    else
      v_conflicts := v_conflicts || jsonb_build_array(r.j->>'source_record_key');
    end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'duplicates', v_identical, 'conflicts', v_conflicts);
end;
$$;

revoke all on function public.import_ward_staging(jsonb, text) from public, anon, authenticated;
grant execute on function public.import_ward_staging(jsonb, text) to service_role;
