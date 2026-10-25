-- Applied to Supabase project "ward-finder" (ref twhnzhrmkcxkigticmuc) as "create_ward_import_temp_bucket".
-- Private temporary bucket for admin PDF uploads (deleted after extraction).
-- No storage.objects policies are created, so anon/authenticated clients cannot read or
-- write it; uploads happen only through short-lived signed URLs issued by the admin API.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ward-import-temp', 'ward-import-temp', false, 26214400, array['application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = 26214400, allowed_mime_types = array['application/pdf'];
