# Ward Finder

A mobile-first Next.js application for searching electoral ward records by a person's name or relative's name. The public UI only displays name, relative name when needed, and ward number.

## Current implementation status

The interface and server-side search boundary are scaffolded. Development and local preview use clearly labeled fictional sample records; these are not electoral records. Production data import, bilingual matching quality, access-control review, and deployment verification must be completed separately before the application is presented as a live lookup service.

## Supabase configuration

The production route expects a private table or view named `public.ward_search` with only these exposed columns:

```sql
create table public.ward_search (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  relative_name text,
  ward_number text not null
);

alter table public.ward_search enable row level security;

-- Do not grant public table reads. The Next.js route uses the server-only
-- Supabase secret key and returns only the selected columns.
revoke all on public.ward_search from anon, authenticated;
```

For production, import and validate PDF-derived records through a controlled server-side process. Add normalized search columns or a reviewed RPC for Hindi and Romanized matching; do not upload raw PDFs or personal identifiers to the browser. Set `WARD_FINDER_SAMPLE_MODE=false` and configure `SUPABASE_URL` plus `SUPABASE_SECRET_KEY` (or the equivalent Vercel-managed Supabase variables). Never prefix a secret key with `NEXT_PUBLIC_`.

## Vercel deployment checklist

1. Connect the project to Vercel and confirm the Supabase integration is connected.
2. Add the server-only Supabase URL and secret/service-role key in Vercel environment settings for Production and Preview as appropriate.
3. Set `WARD_FINDER_SAMPLE_MODE=false` in production.
4. Import only verified PDF records into the private table/view and test exact, partial, Hindi, Romanized, duplicate, and no-match queries.
5. Verify RLS, secret handling, rate limits, logs, and the deployed `/api/search` response before launch.
6. Test the public site on Android-sized viewports and confirm no unrelated personal information is returned.

## Controlled CSV import workflow

The private import format is `data/ward-records.template.csv`. It contains fictional examples only and is not a processed electoral file. The header is exact and ordered:

```text
name,relative_name,ward_number,source_filename,source_page,source_record_key
```

- `name`: required Unicode person name.
- `relative_name`: relative name used to distinguish similar names; may be blank only after review.
- `ward_number`: positive integer from 1 to 9999; confirm the valid range for the election before import.
- `source_filename`: private original PDF filename.
- `source_page`: positive PDF page number.
- `source_record_key`: stable unique key such as `pdf-name-p12-004`; use this as the idempotency key.

Run validation locally or in a private trusted environment with `pnpm validate:ward-csv path/to/verified.csv review-report.json`. The command returns a non-zero status and writes a JSON report when headers, column counts, required fields, ward numbers, source pages, source keys, or duplicate records are invalid. Do not upload the report or source CSV to the public site. A clean report is still only a review prerequisite; it does not import records.

For repeatable imports, the eventual private import job must enforce a unique constraint on `source_record_key` (or a private hash of source filename/page/record key) and use an upsert inside a transaction. It must write only the public search projection (`name`, `relative_name`, `ward_number`) to `ward_search`; source metadata belongs in a private staging/audit table that is not exposed through the Data API. The current project does not include a public import endpoint.

### Android browser procedure

1. Keep the original PDFs in a private Drive folder and use a browser-based selectable-text PDF/table extractor that can export CSV. Do not use OCR unless the result is manually checked against each PDF page.
2. Export only the six columns above, then open the CSV in Google Sheets or another browser spreadsheet app.
3. Remove photos, voter IDs, ages, addresses, and any extra columns. Add a stable source key for every row and keep the original filename/page.
4. Download the CSV, run the validator in the trusted import environment, and review every error/warning against the private PDF. Do not proceed with a non-zero report.
5. Share the reviewed CSV only through the private Supabase import workflow. Verify RLS, the unique source key constraint, and sample searches before enabling real-record search.

Manual action is still required: supply the actual PDFs, perform and review extraction, confirm the election-specific ward-number range, apply the private Supabase staging/import schema and RLS policies, run the verified import, and test search accuracy/access controls. No real records have been supplied or imported.

## Private PDF import (admin only)

Page: `/admin/import` (sign-in at `/admin/login`). Access requires a Supabase-authenticated user whose email is in the server-only `WARD_FINDER_ADMIN_EMAILS`. The import API (`/api/admin/import`) re-checks this on every call, requires a same-origin JSON request, and never runs for anonymous users. There is no public import endpoint.

How it works:

1. The browser asks the API for short-lived signed upload URLs and uploads each PDF straight to the **private** `ward-import-temp` bucket (this avoids Vercel's 4.5 MB request-body limit). Limits: 50 files, 25 MB each, 250 MB per batch; non-PDF files are rejected.
2. The server reads the PDF 2 pages per request (each request is capped at 60 s, which also works if Fluid compute is off). The PDFs' own text layer has corrupted Hindi, so it is used only for layout and plain digits; **names come from OCR of the rendered page** (Tesseract Hindi model in `assets/ocr`).
3. Only person name, relative name, ward number, source filename, source page and a stable key are returned. Voter IDs, photos, ages, genders and house numbers are never read into the output.
4. The ward number must come from the document: the digits in the PDF text layer and an independent digit-only OCR of the header must agree. The filename is only compared as a warning.
5. File-level checks: serial numbers must run 1…N without gaps, and N must match a total printed on the summary page.
6. Rows are flagged for: missing/odd names, low OCR confidence, uncertain ward, duplicate keys, identical or similar name+relative pairs, and conflicting wards. Flagged rows are never approved automatically.
7. The admin compares rows with the original PDF, can correct text, ticks rows to approve, and imports. The server re-validates every row and calls `public.import_ward_staging`, a single transaction that never overwrites an existing `source_record_key` (identical rows are counted as duplicates; differing ones are reported as conflicts and skipped).
8. Temporary uploads are deleted after each file. Anything older than 2 hours is swept on the admin's next upload and by a daily Vercel Cron job (`vercel.json` → `/api/cron/cleanup-temp`, protected by `CRON_SECRET`).

Record key: `<first 12 hex of SHA-256 of the PDF bytes>:<serial>`. Re-importing the same file is idempotent, even if renamed. A re-issued PDF with different bytes gets new keys and must be reconciled by review.

Database (applied to the Supabase project, SQL in `supabase/migrations/`): `public.ward_import_staging` with RLS enabled, no policies and no grants to `anon`/`authenticated` (service role only), unique `source_record_key`, ward format `1-999`, and the private bucket above. The public `ward_search` view does **not** exist yet.

Public search: `/api/search` returns 503 in production unless `WARD_FINDER_REAL_SEARCH_ENABLED=true`. Leave it unset until the view, matching quality, and accuracy checks are done.

Setup: copy `.env.example` into Vercel environment variables. In Supabase Auth, disable public sign-ups and create the administrator user with a password.

Deployment notes: the OCR engine loads its worker and dependencies dynamically, so `next.config.mjs` lists them in `outputFileTracingIncludes` (pnpm layout). The import function is about 62 MB unzipped (Vercel limit 250 MB). Environment variables whose names start with `NEXT_PUBLIC_` are baked in at build time, so redeploy after changing them.

Known limits: OCR can drop small marks (e.g. nasal dots) or misread a letter, so every row needs human review against the PDF. OCR takes roughly 8-10 s per page on one CPU. Verified locally against the production build and a trace-only (standalone) build with a stand-in for Supabase; not yet tested on Vercel itself or against the real Supabase Auth. No rate limiting beyond Supabase Auth's own.

Tests: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm extract:test path/to.pdf`.

## Development

`pnpm dev` starts the Next.js preview. With no production environment flag, the API returns fictional sample records only. The production build currently succeeds; production data remains disabled until the manual Supabase import, RLS review, and search verification steps above are complete.
