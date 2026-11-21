import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

// Apps Script global functions can be exercised without a Google account.
const source = readFileSync(new URL('../MultiSourceSyncV3Incremental.gs', import.meta.url), 'utf8');
const sandbox = createContext({ console });
runInContext(source, sandbox);
const src = {
  key:'ONIKI_CLASS', format:'class',
  id:'11DB9yg4Dy9exhvAAKqv9GCXDpXTd8eff64JAk5HVN00'
};
const sheet = { getSheetId:() => 2001, getName:() => '生理' };
const row = {
  '問題ID':'PHY-C01-001',
  'テスト回':'第1章 生理学',
  '問題番号':'1',
  '分野':'細胞',
  '問題文（原文）':'細胞内呼吸に関与するのはどれか。',
  '選択肢1':'ミトコンドリア',
  '選択肢2':'細胞膜',
  '選択肢3':'ゴルジ装置',
  '選択肢4':'リソソーム',
  '選択肢5':'',
  '正答（原文）':'① ミトコンドリア',
  '照合状態':'原本の解答記載を確認'
};
const get = (values) => (label) => values[label] || '';
test('verified class questions with circled answers are imported', () => {
  const question = sandbox.v3AutoMap_(src, sheet, get(row));
  assert.ok(question);
  assert.equal(question.id, 'ONIKI_CLASS::PHY-C01-001');
  assert.equal(question.subject, '生理学');
  assert.equal(question.option_count, 4);
  assert.equal(question.correct_answer, 1);
});
test('verification must be positive and not contain a recheck warning', () => {
  assert.ok(sandbox.v3AutoMap_(src, sheet,
    get({ ...row, '照合状態':'国試問題と照合' })));
  assert.ok(sandbox.v3AutoMap_(src, sheet,
    get({ ...row, '照合状態':'原本の解答解説で照合' })));
  assert.equal(sandbox.v3AutoMap_(src, sheet,
    get({ ...row, '照合状態':'要再確認' })), null);
  assert.equal(sandbox.v3AutoMap_(src, sheet,
    get({ ...row, '照合状態':'未確認' })), null);
  assert.equal(sandbox.v3AutoMap_(src, sheet,
    get({ ...row, '選択肢3':'' })), null);
});
test('approved spreadsheet question tabs are discovered using headers', () => {
  const headers = Object.fromEntries([
    '問題ID','テスト回','問題番号','分野','問題文（原文）',
    '選択肢1','選択肢2','選択肢3','選択肢4',
    '選択肢5','正答（原文）','照合状態'
  ].map((v,i)=>[v,i]));
  assert.equal(sandbox.v3AutoIsQuestionTab_(src, headers), true);
  assert.equal(sandbox.v3AutoIsQuestionTab_(src, {'問題ID':0}), false);
});

test('pilot previews and sends precisely the same 20 rows twice without checkpoints', () => {
  const labels = runInContext('D1_V3_AUTO_REQUIRED.grad', sandbox);
  const rows = Array.from({length:20}, (_, i) => labels.map((label) => ({
    '問題ID':'PILOT-' + i, '問番号':i + 1, '問題文（原文）':'Question',
    '選択肢1（原文）':'A', '選択肢2（原文）':'B', '選択肢3（原文）':'C',
    '選択肢4（原文）':'D', '正答番号':1
  })[label] ?? ''));
  const posts = [];
  const messages = [];
  let released = false;
  const pilotSheet = {
    getSheetId:() => 0, getName:() => '問題マスター１（R7）',
    getLastRow:() => 1000, getLastColumn:() => labels.length,
    getRange(start, column, count, width) {
      assert.equal(column, 1);
      assert.equal(width, labels.length);
      if (start === 1 && count === 1) return {getDisplayValues:() => [labels]};
      assert.deepEqual([start, count], [2, 20]);
      return {getValues:() => rows};
    }
  };
  sandbox.SpreadsheetApp = {openById:() => ({getSheetById:() => pilotSheet})};
  sandbox.Logger = {log:(entry) => messages.push(JSON.parse(entry))};
  sandbox.LockService = {getScriptLock:() => ({
    tryLock:() => true, releaseLock:() => {released = true;}
  })};
  sandbox.PropertiesService = {getScriptProperties:() => ({
    getProperty:(key) => ({
      CLOUDFLARE_PAGES_URL:'https://example.test',
      D1_SYNC_TOKEN:'test-secret'
    })[key]
  })};
  sandbox.UrlFetchApp = {fetch(url, request) {
    assert.equal(url, 'https://example.test/api/v3/admin/sync');
    posts.push(request.payload);
    const written = posts.length === 1 ? 20 : 0;
    return {getResponseCode:() => 200, getContentText:() => JSON.stringify({
      ok:true, table:'questions_v3', upserted:20, written, unchanged:20-written
    })};
  }};
  sandbox.previewMultiSourceV3Pilot20();
  assert.equal(posts.length, 0);
  assert.equal(messages[0].eligible, 20);
  sandbox.syncMultiSourceV3Pilot20();
  assert.equal(posts.length, 2);
  assert.equal(posts[0], posts[1]);
  assert.equal(JSON.parse(posts[0]).questions.length, 20);
  assert.deepEqual(messages[2], {attempt:2, upserted:20, written:0, unchanged:20});
  assert.equal(released, true);
  rows[19] = rows[0];
  assert.throws(() => sandbox.syncMultiSourceV3Pilot20(), /重複ID/);
  assert.equal(posts.length, 2);
});

test('review warnings cannot turn provisional answers into verified questions', () => {
  for (const status of ['推定正答・本文要照合','正答要確認・本文要照合','模範解答照合済・本文要確認','本文要照合']) {
    assert.equal(sandbox.v3AutoVerified_(status), false);
  }
  assert.equal(sandbox.v3AutoVerified_('模範解答照合済'), true);
});
