# V3 next step — safe resumable sync (review before deployment)

**Status:** proposed change on a separate GitHub branch. The currently deployed app, existing `questions` table, old `/api/questions` endpoint, and user's local stars/history are untouched.

## What this revision adds

1. `functions/api/v3/admin/sync.js` rejects repeated IDs within a batch and refuses to overwrite an ID owned by another source/tab. Repeated identical rows do not change `updated_at`.
2. `functions/api/v3/questions.js`: read-only `GET /api/v3/questions?limit=20&source_key=ONIKI_CLASS&subject=生理学&after=...` requires the existing `SYNC_TOKEN` as an Authorization bearer token and uses keyset pagination (max 100 records).
3. `pilot-d1/MultiSourceSyncV3Incremental.gs`: an additional Apps Script source file, **not** a replacement for `コード.gs`, `MultiSourceSync.gs`, or the first V3 pilot file.

## Why the earlier pilot omitted valid questions

The first V3 pilot hard-coded a short list of approved tab IDs, excluding e.g. 生理, 経穴, and newly created tabs. It also accepted only statuses containing 「照合済」「確認済」「確定」, while real source data has 「原本の解答記載を確認」「原本の解答解説で照合」「国試問題と照合」. The new reader identifies question tabs by their header structure, regardless of tab renaming, and accepts positive confirmation/verification wording while excluding 「未確認」「要確認」「再確認」「保留」, etc. It skips blank/incomplete rows without fabricating answers.

## Deployment (perform in this order)

1. Verify `questions_v3` exists in the **test** D1 database `exam-questions-test` and that the Pages `DB` binding points at it. Do not modify the legacy `questions` table.
2. Review and merge the PR. Cloudflare Pages should deploy the new API. No app HTML changes are included.
3. In the existing Google Apps Script project, **add a new script file** named `MultiSourceSyncV3Incremental.gs` using the file in this repository. Do not overwrite previous `.gs` files. The new function names and constants are distinct.
4. In Apps Script Project Settings → Script properties, verify `CLOUDFLARE_PAGES_URL` and `D1_SYNC_TOKEN`. The latter must match the Cloudflare `SYNC_TOKEN` secret. Rotate leaked values; **never paste or commit any token**.
5. Run `previewMultiSourceV3Auto` (read-only). Check that the expected question tabs appear as 対象 and that the non-question study tabs are excluded.
6. Run `previewMultiSourceV3Pilot20`. It reads rows 2–21 in 「問題マスター１（R7）」 (gid 0) from 「鬼木学園　卒試対策」. The workbook also contains 「あはき国試過去問」, whose headers do not qualify for graduation sync.
7. After confirming the Pages URL in Apps Script points to the deployment bound to `exam-questions-test`, run `syncMultiSourceV3Pilot20` once. It sends the exact same payload in two requests and uses no incremental checkpoints. Confirm the second log reports `written: 0` and `unchanged: 20`.
8. In D1 Studio, check:

   ```sql
   SELECT source_key, COUNT(*) AS rows FROM questions_v3 GROUP BY source_key;
   SELECT sheet_name, COUNT(*) FROM questions_v3
     WHERE source_key = 'ONIKI_CLASS' GROUP BY sheet_name ORDER BY sheet_name;
   SELECT id, source_key, sheet_gid, option_count, correct_answer
     FROM questions_v3 ORDER BY updated_at DESC LIMIT 20;
   ```

9. Verify an unauthenticated request returns 401. With the existing bearer token, inspect `/api/v3/questions?limit=20`. It returns `count`, `next_after`, and `questions`. Pass `next_after` into the following request as `after` for pagination. The live exam app is **not yet** switched to this API.

## Operational guarantees and limits

- **No source sheet writes. No D1 deletes. No modification to the legacy app or table.**
- A source Spreadsheet whose Drive modified timestamp has not changed since a completed sweep is skipped. If the file changes, rows in eligible tabs are rescanned, with only changed records actually updated in D1. This avoids repeat work on unchanged files, but is **not true row-level change detection**. For a frequently edited 100k-row single workbook, a better row-level change journal or an upstream edit queue will be needed.
- A new or renamed tab is considered only if its headers match an approved question *format*. Question text, 4/5 options, a parseable answer, and for term/class a positive verification status are still required.
- The existing ID format is intentionally preserved. Cross-tab reuse of a raw ID is rejected with HTTP 409 (fail closed) rather than silently overwriting another question. Fix source IDs rather than forcing the API to accept collisions.
- Deleted source rows are **not** removed from D1. Deletion/tombstone support requires its own separate reviewed phase, with backups.
- Only the three existing source keys (`ONIKI_GRAD`, `ONIKI_TERM3`, `ONIKI_CLASS`) are allowed by the present `questions_v3` schema/API. **日本医専** and other new sources are not enrolled yet.
- Running the V3 pilot and incremental writer at the same time is not recommended. The new function uses a script lock to avoid concurrent instances of **itself**, not the old pilot.
- If Sheets are being edited continuously, the first complete sweep can take several runs. Changes detected during a sweep cause one more complete reconciliation before marking the source done.
- Keep the shared sync token in server-side settings. The read endpoint uses that existing secret.

## Acceptance criteria before relying on it

- Confirm source tab coverage (including 生理, 経穴, 東臨) from Apps Script preview and D1 counts.
- Test the **same** 20 questions twice: the second upload should report `written: 0` and `unchanged: 20`.
- Test duplicate IDs across different tabs: API must return 409, with no cross-tab overwrite.
- Verify a failed request does not advance the sheet cursor past unsynced rows.
- Verify a brand-new tab appears when its header matches a supported format.
- Confirm the old app UI, D1 `questions` table, and endpoint remain unchanged.
