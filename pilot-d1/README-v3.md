# V3 pilot sync setup

This is an additive pilot. It adds a separate `questions_v3` table and an authenticated Pages Function at `POST /api/v3/admin/sync`. The existing `questions` table, existing `/api/questions` endpoint, and `index.html` are not changed.

## Setup order

1. In Cloudflare D1 Studio, select the test database `exam-questions-test` and run the SQL in `pilot-d1/schema_v3.sql`. This creates only `questions_v3` and its indexes.
2. Merge the code change to `main` to deploy the new Pages Function. The endpoint requires the existing Cloudflare secret `SYNC_TOKEN`; it does not accept requests without a matching `Authorization: Bearer ...` value.
3. In the Apps Script project properties, confirm `CLOUDFLARE_PAGES_URL` is the Pages project URL and `D1_SYNC_TOKEN` matches the Cloudflare secret. Never paste the token into a chat, sheet, source file, or screenshot.
4. Run `syncMultiSourceV3Pilot` only after the schema and endpoint are deployed. It sends up to 20 eligible questions from each source (at most 60 total). Re-running the same pilot upserts by stable ID; it does not delete rows.
5. In D1 Studio, verify the pilot:
   ```sql
   SELECT source_key, COUNT(*) AS rows
   FROM questions_v3
   GROUP BY source_key
   ORDER BY source_key;

   SELECT id, source_key, sheet_name, subject, question_number,
          question_text, option_count, correct_answer
   FROM questions_v3
   ORDER BY source_key, id
   LIMIT 10;
   ```

Do not run the Apps Script writer before steps 1–3. This pilot does not yet implement full-history pagination, deletion handling, or incremental synchronization.
