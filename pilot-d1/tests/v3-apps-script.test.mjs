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
