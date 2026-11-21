const passcodeHash = "321fdeb78cf30fb8de34d845fb14706776ad6e0cce21b6cc5241533fb6aa545c";
const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};

export function onRequestGet() {
  return new Response(page, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}

export async function onRequestPost({ request, env }) {
  const passcode = request.headers.get("Authorization")?.match(/^Bearer ([a-f0-9]{32})$/)?.[1];
  if (!passcode) return json({ error: "試験版のアクセスコードを確認してください。" }, 401);
  const actual = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(passcode)));
  let mismatch = 0;
  for (let i = 0; i < actual.length; i++) {
    mismatch |= actual[i] ^ Number.parseInt(passcodeHash.slice(i * 2, i * 2 + 2), 16);
  }
  if (mismatch) return json({ error: "試験版のアクセスコードを確認してください。" }, 401);
  if (!env.DB) return json({ error: "試験用データベースに接続できません。" }, 503);
  const ids = Array.from({ length: 20 }, (_, i) => "ONIKI-R07-S1-AM-Q" + String(i + 1).padStart(3, "0"));
  const parameters = ids.map(() => "?").join(",");
  try {
    const { results } = await env.DB.prepare(`
      SELECT id, subject, question_number, question_text, option1, option2,
             option3, option4, correct_answer
      FROM questions_v3
      WHERE source_key = 'ONIKI_GRAD' AND sheet_gid = 0 AND id IN (${parameters})
      ORDER BY id
    `).bind(...ids).all();
    if (results.length !== ids.length) return json({ error: "試験用の20問が揃っていません。" }, 503);
    return json({ questions: results });
  } catch (error) {
    console.error("Trial question query failed", error);
    return json({ error: "問題を読み込めませんでした。" }, 503);
  }
}

function json(data, status = 200) {
  return Response.json(data, { status, headers });
}

const page = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>鬼木学園 卒試過去問 20問試験版</title>
<style>
  :root { font: 16px/1.55 system-ui, sans-serif; color: #203046; background: #f1f5fa; }
  * { box-sizing: border-box; }
  body { margin: 0; }
  main { max-width: 640px; padding: 25px 15px; margin: auto; }
  h1 { font-size: 1.35rem; margin: 0; }
  h2 { font-size: 1.15rem; }
  .card { background: white; border: 1px solid #d8e2ef; border-radius: 14px; padding: 18px; margin-top: 14px; }
  .muted { color: #4c6078; margin: 4px 0; }
  button, input { font: inherit; border-radius: 8px; min-height: 44px; padding: 8px 12px; }
  button { border: 1px solid #b8c7da; background: white; color: inherit; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  .primary { color: white; background: #165bb6; border-color: #165bb6; }
  .row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
  label.option { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 4px 10px; border: 1px solid #d8e2ef; border-radius: 8px; margin: 8px 0; }
  #passcode { width: 100%; border: 1px solid #b8c7da; margin: 8px 0; }
  #question, label.option { font-size: 14px; }
  .wide { width: 100%; }
  .nav button { flex: 1; }
  .result { font-weight: 600; min-height: 1.6em; }
  #star[aria-pressed="true"] { background: #fff4d0; border-color: #ab8011; }
</style>
</head>
<body>
<main>
  <h1>鬼木学園 卒試過去問</h1>
  <p class="muted">R7・一次午前の20問試験版</p>
  <form id="login" class="card">
    <label for="passcode">試験版アクセスコード</label>
    <input id="passcode" type="password" required autocomplete="off" spellcheck="false">
    <button class="primary wide" type="submit">問題を読み込む</button>
    <p id="message" role="status"></p>
  </form>
  <section id="home" class="card" hidden>
    <div class="row">
      <button id="start" class="primary">20問を解く</button>
      <button id="starStart">★だけ復習</button>
    </div>
    <h2>学習履歴</h2>
    <ul id="history"></ul>
    <p id="storage" class="muted"></p>
  </section>
  <section id="quiz" class="card" hidden>
    <div class="row">
      <strong id="progress"></strong>
      <button type="button" id="star" aria-pressed="false">☆ 復習マーク</button>
    </div>
    <p id="subject" class="muted"></p>
    <p id="question"></p>
    <div id="choices" role="group" aria-label="選択肢"></div>
    <button id="confirm" class="primary wide">解答を確定</button>
    <p id="feedback" class="result" role="status"></p>
    <div class="row nav"><button id="previous">← 前の問題</button><button id="next">次の問題 →</button></div>
    <p><button id="finish">終了して結果を見る</button></p>
  </section>
  <section id="result" class="card" hidden>
    <h2>演習結果</h2><p id="score" role="status"></p>
    <button id="back">最初に戻る</button>
  </section>
</main>
<script>
  'use strict';
  const byId = (id) => document.getElementById(id);
  const key = 'oniki-trial-20-v1';
  let state = { stars: [], history: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved && Array.isArray(saved.stars) && Array.isArray(saved.history)) state = saved;
  } catch {
    byId('storage').textContent = 'このブラウザでは学習データを保存できない場合があります。';
  }
  function save() {
    try { localStorage.setItem(key, JSON.stringify(state)); }
    catch { byId('storage').textContent = 'このブラウザでは学習データを保存できませんでした。'; }
  }
  const show = (section) => {
    for (const id of ['login', 'home', 'quiz', 'result']) byId(id).hidden = id !== section;
  };
  let bank = [];
  let session = [];
  let answers = new Map();
  let index = 0;
  let starredOnly = false;
  function home() {
    const count = bank.filter((q) => state.stars.includes(q.id)).length;
    byId('starStart').textContent = '★だけ復習（' + count + '問）';
    byId('starStart').disabled = !count;
    const history = byId('history');
    history.replaceChildren();
    for (const item of state.history) {
      const li = document.createElement('li');
      li.textContent = new Date(item.time).toLocaleString('ja-JP') + '　' +
        (item.starredOnly ? '★だけ復習' : '20問演習') + '　' + item.correct + '/' + item.answered + '問正解';
      history.append(li);
    }
    if (!history.children.length) {
      const li = document.createElement('li');
      li.textContent = 'まだ学習履歴はありません。';
      history.append(li);
    }
    show('home');
  }
  byId('login').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = byId('passcode');
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    byId('message').textContent = '読み込み中…';
    try {
      const response = await fetch(location.pathname, {
        method: 'POST', headers: { Authorization: 'Bearer ' + input.value.trim() }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '問題を読み込めませんでした。');
      bank = data.questions;
      input.value = '';
      home();
    } catch (error) {
      byId('message').textContent = error.message;
    } finally { button.disabled = false; }
  });
  function render() {
    const q = session[index];
    const answer = answers.get(q.id);
    byId('progress').textContent = (index + 1) + ' / ' + session.length + '問';
    byId('subject').textContent = q.subject + '　問' + q.question_number;
    byId('question').textContent = q.question_text;
    const starred = state.stars.includes(q.id);
    byId('star').textContent = starred ? '★ 復習マーク' : '☆ 復習マーク';
    byId('star').setAttribute('aria-pressed', String(starred));
    const choices = byId('choices');
    choices.replaceChildren();
    for (let i = 1; i <= 4; i++) {
      const label = document.createElement('label');
      label.className = 'option';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'answer';
      input.value = String(i);
      input.checked = answer === i;
      input.disabled = answer !== undefined;
      input.addEventListener('change', () => { byId('confirm').disabled = false; });
      label.append(input, i + '. ' + q['option' + i]);
      choices.append(label);
    }
    byId('confirm').disabled = true;
    byId('feedback').textContent = answer === undefined ? '' :
      (answer === q.correct_answer ? '正解' : '不正解。正答は ' + q.correct_answer + ' です。');
    byId('previous').disabled = index === 0;
    byId('next').disabled = index === session.length - 1;
  }
  function start(onlyStars) {
    starredOnly = onlyStars;
    session = onlyStars ? bank.filter((q) => state.stars.includes(q.id)) : bank;
    if (!session.length) return;
    answers = new Map();
    index = 0;
    render();
    show('quiz');
  }
  byId('start').onclick = () => start(false);
  byId('starStart').onclick = () => start(true);
  byId('star').onclick = () => {
    const id = session[index].id;
    if (state.stars.includes(id)) state.stars = state.stars.filter((star) => star !== id);
    else state.stars.push(id);
    save();
    const starred = state.stars.includes(id);
    byId('star').textContent = starred ? '★ 復習マーク' : '☆ 復習マーク';
    byId('star').setAttribute('aria-pressed', String(starred));
  };
  byId('confirm').onclick = () => {
    const choice = document.querySelector('input[name="answer"]:checked');
    if (!choice) return;
    answers.set(session[index].id, Number(choice.value));
    render();
  };
  byId('previous').onclick = () => { index--; render(); };
  byId('next').onclick = () => { index++; render(); };
  byId('finish').onclick = () => {
    const answered = answers.size;
    const correct = session.filter((q) => answers.get(q.id) === q.correct_answer).length;
    if (answered) {
      state.history.unshift({ time: Date.now(), correct, answered, starredOnly });
      state.history = state.history.slice(0, 20);
      save();
    }
    byId('score').textContent = answered
      ? correct + ' / ' + answered + '問正解（' + Math.round(correct / answered * 100) + '%）'
      : '解答した問題はありません。';
    show('result');
  };
  byId('back').onclick = home;
</script>
</body>
</html>`;
