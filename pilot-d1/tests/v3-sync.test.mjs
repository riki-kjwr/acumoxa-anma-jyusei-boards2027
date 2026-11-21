import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequestPost } from '../../functions/api/v3/admin/sync.js';
import { onRequestGet } from '../../functions/api/v3/questions.js';

// Use real SQLite to catch schema, SQL syntax, and upsert regressions.
class TestD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec(readFileSync(new URL('../schema_v3.sql', import.meta.url), 'utf8'));
  }
  prepare(sql) {
    return {
      bind: (...args) => ({
        all: async () => ({ results: this.sqlite.prepare(sql).all(...args) }),
        execute: () => {
          const result = this.sqlite.prepare(sql).run(...args);
          return { meta: { changes: result.changes } };
        }
      })
    };
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const results = statements.map((stmt) => stmt.execute());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}
const base = {
  id: 'ONIKI_CLASS::TEST-001',
  source_key: 'ONIKI_CLASS',
  spreadsheet_id: '11DB9yg4Dy9exhvAAKqv9GCXDpXTd8eff64JAk5HVN00',
  sheet_gid: 2001,
  sheet_name: '生理',
  school: '鬼木学園',
  exam_type: '授業プリント問題集',
  year_label: '',
  round_label: '第1章',
  subject: '生理学',
  unit: '神経',
  question_number: 1,
  question_text: '細胞膜について正しいのはどれか。',
  option1: 'A', option2: 'B', option3: 'C', option4: 'D', option5: '',
  option_count: 4,
  correct_answer: 2,
  answer_status: '原本の解答記載を確認'
};
function sender(env, questions, token = 'test-secret') {
  const request = new Request('https://example.test/api/v3/admin/sync', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: JSON.stringify({ questions })
  });
  return onRequestPost({ request, env });
}
async function json(response) { return await response.json(); }
test('V3 inserts, no-ops, updates, paginates, and refuses cross-tab ID collisions', async () => {
  const database = new TestD1();
  const env = { DB: database, SYNC_TOKEN: 'test-secret' };
  const denied = await sender(env, [base], 'wrong');
  assert.equal(denied.status, 401);
  let response = await sender(env, [base]);
  let result = await json(response);
  assert.equal(response.status, 200);
  assert.equal(result.upserted, 1);
  assert.equal(result.written, 1);
  assert.equal(result.unchanged, 0);
  response = await sender(env, [base]);
  result = await json(response);
  assert.equal(result.written, 0);
  assert.equal(result.unchanged, 1);
  response = await sender(env, [{ ...base, question_text: '改訂版の問題文' }]);
  result = await json(response);
  assert.equal(result.written, 1);
  assert.equal(database.sqlite.prepare('SELECT question_text FROM questions_v3 WHERE id=?').get(base.id).question_text, '改訂版の問題文');
  response = await sender(env, [{ ...base, sheet_gid: 99999, question_text: '別タブからの上書き' }]);
  assert.equal(response.status, 409);
  assert.equal(database.sqlite.prepare('SELECT question_text FROM questions_v3 WHERE id=?').get(base.id).question_text, '改訂版の問題文');
  response = await sender(env, [base, base]);
  assert.equal(response.status, 409);
  response = await sender(env, [{ ...base, id: 'ONIKI_CLASS::TEST-002', question_number: 2 }]);
  assert.equal(response.status, 200);

  const get = async (query) => {
    const request = new Request('https://example.test/api/v3/questions?' + query, {
      headers: { Authorization: 'Bearer test-secret' }
    });
    const res = await onRequestGet({ request, env });
    assert.equal(res.status, 200);
    return json(res);
  };
  const first = await get('source_key=ONIKI_CLASS&subject=%E7%94%9F%E7%90%86%E5%AD%A6&limit=1');
  assert.equal(first.count, 1);
  assert.equal(first.questions[0].id, base.id);
  assert.equal(first.next_after, base.id);
  const second = await get('source_key=ONIKI_CLASS&limit=1&after=' + encodeURIComponent(first.next_after));
  assert.equal(second.count, 1);
  assert.equal(second.questions[0].id, 'ONIKI_CLASS::TEST-002');
  const empty = await get('source_key=ONIKI_TERM3');
  assert.equal(empty.count, 0);
});

test('V3 reads require the configured token before accessing D1', async () => {
  const url = 'https://example.test/api/v3/questions';
  const env = { SYNC_TOKEN: 'test-secret' };
  for (const headers of [{}, { Authorization: 'Bearer wrong' }]) {
    const response = await onRequestGet({ request: new Request(url, { headers }), env });
    assert.equal(response.status, 401);
    assert.deepEqual(await json(response), { error: 'Unauthorized' });
  }
  const response = await onRequestGet({ request: new Request(url), env: {} });
  assert.equal(response.status, 503);
});

test('replaying a full 20-question batch leaves every row unchanged', async () => {
  const database = new TestD1();
  const env = { DB: database, SYNC_TOKEN: 'test-secret' };
  const questions = Array.from({ length: 20 }, (_, i) => ({ ...base, id: 'PILOT-' + i }));
  const first = await sender(env, questions);
  assert.equal(first.status, 200);
  assert.equal((await json(first)).written, 20);
  const replay = await sender(env, questions);
  assert.equal(replay.status, 200);
  const result = await json(replay);
  assert.equal(result.written, 0);
  assert.equal(result.unchanged, 20);
});
