import { onRequestPost as readPilot } from "./trial-20.js";

const headers = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
};

function html(body, status = 200) {
  return new Response(body, { status, headers });
}

export function onRequestGet() {
  return html(`<!doctype html><html lang="ja"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>卒試過去問 D1接続プレビュー</title>
<style>
body{margin:0;background:#f3f6fb;color:#18253a;font:16px system-ui}
main{max-width:480px;margin:12vh auto;padding:24px}
input,button{font:inherit;padding:10px;margin:8px 0;display:block}
input{box-sizing:border-box;width:100%}
</style>
<main><h1>卒試過去問</h1><p>卒試の問題文・選択肢・正答をD1から読み込みます。</p>
<form method="post"><label for="code">試験版アクセスコード</label>
<input id="code" name="code" type="password" required pattern="[a-f0-9]{32}" autocomplete="off">
<button>卒試アプリを開く</button></form><a href="/">公開版に戻る</a></main></html>`);
}

export async function onRequestPost({ request, env }) {
  let code;
  try {
    code = (await request.formData()).get("code");
  } catch {
    return html("アクセスコードを入力してください。", 400);
  }
  const auth = new Headers();
  if (typeof code === "string" && /^[a-f0-9]{32}$/.test(code)) {
    auth.set("Authorization", "Bearer " + code);
  }
  const pilot = await readPilot({ request: new Request(request.url, { headers: auth }), env });
  if (!pilot.ok) {
    return html('<p>問題を読み込めませんでした。</p><a href="/grad-d1-preview">戻る</a>', pilot.status);
  }

  try {
    const asset = await env.ASSETS.fetch(new URL("/", request.url));
    if (!asset.ok) throw new Error("App asset unavailable");
    const { results: questions } = await env.DB.prepare(
      "SELECT id, question_text, option1, option2, option3, option4, correct_answer " +
      "FROM questions_v3 WHERE source_key = ? AND option_count = 4"
    ).bind("ONIKI_GRAD").all();
    return html(renderPreview(await asset.text(), questions));
  } catch (error) {
    console.error("Graduation preview could not load", error.message);
    return html('<p>卒試アプリを読み込めませんでした。</p><a href="/grad-d1-preview">戻る</a>', 503);
  }
}

export function renderPreview(portal, questions) {
  const encoded = portal.match(/const APPS\s*=\s*\{\s*"grad"\s*:\s*"([A-Za-z0-9+/=]+)"/)?.[1];
  if (!encoded) throw new Error("Graduation app not found");
  const binary = atob(encoded);
  const original = new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  const bankPattern = /const BANK\s*=\s*(\[[^\r\n]*\]);\s*window\.QUESTIONS\s*=\s*BANK;/;
  const bankJson = original.match(bankPattern)?.[1];
  if (!bankJson) throw new Error("Question bank not found");

  const byId = new Map(questions.map((question) => [question.id, question]));
  let count = 0;
  const originalBank = JSON.parse(bankJson);
  const bank = originalBank.map((question) => {
    const updated = byId.get(question.id);
    if (!updated) throw new Error("Missing D1 question: " + question.id);
    count++;
    const opts = [updated.option1, updated.option2, updated.option3, updated.option4];
    if (!updated.question_text || opts.some((choice) => !choice) ||
        ![1, 2, 3, 4].includes(updated.correct_answer)) throw new Error("Invalid D1 question");
    return { ...question, text: updated.question_text, opts, correct: updated.correct_answer };
  });
  if (!count || count !== new Set(bank.map((question) => question.id)).size) {
    throw new Error("Invalid graduation bank IDs");
  }

  const serialize = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");
  const legacyBaseline = originalBank.map(({ id, text, opts, correct }) => [id, { text, opts, correct }]);
  const applyPattern = /function applyEdits\(edits = \{\}\)\{[\s\S]*?\n\}(?=\nfunction answerKey)/;
  const saveAnchor = "const edits={...db.edits};";
  const editedQuestion = "byId[q.id]={...base,...edit};";
  if (!applyPattern.test(original) || !original.includes(saveAnchor) || !original.includes(editedQuestion)) {
    throw new Error("Graduation edit hooks not found");
  }
  return original.replace(bankPattern, () => "const BANK = " + serialize(bank) + ";\nwindow.QUESTIONS = BANK;" +
      "\nwindow.onikiLegacyEditBaseline = new Map(" + serialize(legacyBaseline) + ");" +
      "\nwindow.onikiResolveEdit = " + resolveEdit.toString() + ";")
    .replace(applyPattern, () => `function applyEdits(edits = {}){
 for(const [i,q] of DATA.entries()){
  const base = originalQuestions.get(q.id);
  const edit = Object.hasOwn(edits,q.id) ? edits[q.id] : null;
  DATA[i] = window.onikiResolveEdit(base, edit, window.onikiLegacyEditBaseline.get(q.id));
 }
}`)
    .replace(saveAnchor, () => `edit.sheetBase = {text:base.text, opts:[...base.opts], correct:base.correct};
 const edits={...db.edits};`)
    .replace(editedQuestion, () => "byId[q.id]={...base,text:edit.text,opts:edit.opts,correct:edit.correct};")
    .replace("</body>", `<script>
window.addEventListener('message', (event) => {
  if (event.source === window && event.data?.type === 'fourway-home') location.assign('/');
});
</script></body>`);
}


export function resolveEdit(base, edit, legacyBaseline) {
  const snapshot = edit?.sheetBase ?? legacyBaseline;
  if (!edit || !snapshot || !Array.isArray(snapshot.opts) || snapshot.opts.length !== 4) return base;
  // Apply the personal field only while its shared baseline is current.
  return {
    ...base,
    text: snapshot.text === base.text ? edit.text : base.text,
    opts: base.opts.map((choice, i) => snapshot.opts[i] === choice ? edit.opts[i] : choice),
    correct: snapshot.correct === base.correct ? edit.correct : base.correct
  };
}
