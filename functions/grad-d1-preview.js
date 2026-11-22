import { onRequestPost as readPilot } from "./trial-20.js";

const banks = new Map([
  ["grad", { title: "卒試過去問", source: "ONIKI_GRAD", prefix: "" }],
  ["term", { title: "期末過去問", source: "ONIKI_TERM3", prefix: "ONIKI_TERM::" }],
  ["class", { title: "授業プリント問題集", source: "ONIKI_CLASS", prefix: "ONIKI_CLASS::" }]
]);

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

export function onRequestGet({ request }) {
  const links = [...banks].map(([key, bank]) => `<a href="?bank=${key}">${bank.title}</a>`).join(" ・ ");
  const key = new URL(request.url).searchParams.get("bank") ?? "grad";
  const bank = banks.get(key);
  if (!bank) return html("問題集が見つかりません。", 404);
  return html(`<!doctype html><html lang="ja"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${bank.title} D1接続プレビュー</title>
<style>
body{margin:0;background:#f3f6fb;color:#18253a;font:16px system-ui}
main{max-width:480px;margin:12vh auto;padding:24px}
input,button{font:inherit;padding:10px;margin:8px 0;display:block}
input{box-sizing:border-box;width:100%}
</style>
<main><nav aria-label="問題集">${links}</nav><h1>${bank.title}</h1><p>D1と照合できた問題は、同期後の問題文・選択肢・正答で表示します。</p>
<form method="post"><label for="code">試験版アクセスコード</label>
<input id="code" name="code" type="password" required pattern="[a-f0-9]{32}" autocomplete="off">
<button>問題集を開く</button></form><a href="/">公開版に戻る</a></main></html>`);
}

export async function onRequestPost({ request, env }) {
  const key = new URL(request.url).searchParams.get("bank") ?? "grad";
  const bank = banks.get(key);
  if (!bank) return html("問題集が見つかりません。", 404);
  const retry = `<a href="/grad-d1-preview?bank=${key}">戻る</a>`;
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
    return html("<p>問題を読み込めませんでした。</p>" + retry, pilot.status);
  }

  try {
    const asset = await env.ASSETS.fetch(new URL("/", request.url));
    if (!asset.ok) throw new Error("App asset unavailable");
    const { results: questions } = await env.DB.prepare(
      "SELECT id, question_text, option1, option2, option3, option4, correct_answer " +
      "FROM questions_v3 WHERE source_key = ? AND option_count = 4 " +
      "AND (source_key = 'ONIKI_GRAD' OR (answer_status NOT LIKE '%要照合%' AND answer_status NOT LIKE '%推定%'))"
    ).bind(bank.source).all();
    return html(renderPreview(await asset.text(), questions, key));
  } catch (error) {
    console.error("Graduation preview could not load", error.message);
    return html("<p>問題集を読み込めませんでした。</p>" + retry, 503);
  }
}

export function renderPreview(portal, questions, key = "grad") {
  const config = banks.get(key);
  const apps = portal.match(/const APPS\s*=\s*(\{[^\r\n]+\});/)?.[1];
  const encoded = config && apps && JSON.parse(apps)[key];
  if (!encoded) throw new Error("Problem bank app not found");
  const binary = atob(encoded);
  const original = new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  const bankPattern = /const BANK\s*=\s*(\[[^\r\n]*\]);(\s*window\.ONIKI_WORKSHEET_CATALOG\s*=\s*[^\r\n]*;)?\s*window\.QUESTIONS\s*=\s*BANK;/;
  const [, bankJson, catalog = ""] = original.match(bankPattern) ?? [];
  if (!bankJson) throw new Error("Question bank not found");

  const byId = new Map(questions.map((question) => [question.id, question]));
  let count = 0;
  const originalBank = JSON.parse(bankJson);
  const bank = originalBank.map((question) => {
    const updated = byId.get(config.prefix + (key === "term" ? question.id.replace(/^TERM-/, "") : question.id));
    if (!updated) {
      if (key === "grad") throw new Error("Missing D1 question: " + question.id);
      return question;
    }
    count++;
    const opts = [updated.option1, updated.option2, updated.option3, updated.option4];
    if (!updated.question_text || opts.some((choice) => !choice) ||
        ![1, 2, 3, 4].includes(updated.correct_answer)) throw new Error("Invalid D1 question");
    return { ...question, text: updated.question_text, opts, correct: updated.correct_answer };
  });
  if (!count || bank.length !== new Set(bank.map((question) => question.id)).size) {
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
  return original.replace(bankPattern, () => "const BANK = " + serialize(bank) + ";" + catalog + "\nwindow.QUESTIONS = BANK;" +
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
    .replace("</body>", `<aside style="padding:8px;text-align:center">
D1同期対象 ${count.toLocaleString("ja-JP")}問／${bank.length.toLocaleString("ja-JP")}問
<a href="/grad-d1-preview?bank=${key}">問題集の選択へ</a></aside><script>
window.addEventListener('message', (event) => {
  if (event.source === window && event.data?.type === 'fourway-home') location.assign('/grad-d1-preview?bank=${key}');
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
