# D1 connection pilot — 20 questions, isolated from current app

**Nothing in the existing `index.html` is modified by this branch.** The pilot creates a test API and a separate `/test-d1.html` page.

Source spreadsheet: `https://docs.google.com/spreadsheets/d/1Bhd-2leIdMHywC0nWPqmhSq7FVLB8_OvvP5fIl2fwgE/edit` — tab `問題マスター１（R7）`.

## Before merging this branch

1. In Cloudflare, create a D1 database named `exam-questions-test`.
2. In its Console, execute the SQL in `pilot-d1/schema.sql`.
3. In the existing Pages project's Settings > Bindings, add a D1 binding with variable name **DB**, linked to `exam-questions-test`.
4. Set a private Cloudflare secret named **SYNC_TOKEN**. Do not store it in GitHub, HTML, or a public Sheet.
5. After configuration, merge the PR to deploy the new Pages Functions while leaving the existing app unchanged.
6. In the source Spreadsheet, open Extensions > Apps Script and paste `pilot-d1/sync20.gs`. In Script properties configure:
   - `CLOUDFLARE_PAGES_URL`: the deployed `https://your-project.pages.dev` URL
   - `D1_SYNC_TOKEN`: same private value as Cloudflare's `SYNC_TOKEN`
7. Run `sync20QuestionsToD1` once; approve the Google permissions only after inspecting the script. Log should show `{"ok":true,"upserted":20}`.
8. Open `https://your-project.pages.dev/test-d1.html` and press **20問を読み込む**.

## What it does and does not do

- The sync endpoint **upserts** by stable question ID. It does not delete records.
- API `GET /api/questions?limit=20` reads 1–100 questions, optionally filtered by `subject` or `source`, with `after` pagination.
- Existing `index.html`, user stars, learning history and Netlify deployment are not modified.
- This is a test, **not** a full 100,000-question synchronization system. Full-scale sync should add incrementals, deletion handling, backups, stable question IDs, filtering, monitoring, and load testing.
- Keep the PR unmerged until Cloudflare D1 and secrets are configured.
