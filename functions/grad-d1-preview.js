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
      "SELECT id, sheet_name, exam_type, year_label, round_label, subject, question_number, question_text, option1, option2, option3, option4, correct_answer " +
      "FROM questions_v3 WHERE source_key = ? AND option_count = 4 " +
      "AND (source_key = 'ONIKI_GRAD' OR (answer_status NOT LIKE '%要照合%' AND answer_status NOT LIKE '%推定%')) ORDER BY id"
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
  const matched = new Set();
  const groups = catalog ? JSON.parse(catalog.trim().slice("window.ONIKI_WORKSHEET_CATALOG".length).replace(/^\s*=\s*/, "").replace(/;$/, "")) : [];
  const grouped = new Map(groups.map((group) => [group.key, group]));
  const bank = originalBank.map((question) => {
    const updated = byId.get(config.prefix + (key === "term" ? question.id.replace(/^TERM-/, "") : question.id));
    if (!updated) {
      if (key === "grad") throw new Error("Missing D1 question: " + question.id);
      return question;
    }
    count++;
    matched.add(updated.id);
    const opts = [updated.option1, updated.option2, updated.option3, updated.option4];
    if (!updated.question_text || opts.some((choice) => !choice) ||
        ![1, 2, 3, 4].includes(updated.correct_answer)) throw new Error("Invalid D1 question");
    return { ...question, text: updated.question_text, opts, correct: updated.correct_answer };
  });
  for (const row of questions) {
    if (matched.has(row.id)) continue;
    const question = toNewQuestion(row, key, config.prefix, grouped);
    if (question) {
      bank.push(question);
      count++;
    }
  }
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
  return original.replace(bankPattern, () => "const BANK = " + serialize(bank) + ";" + (catalog ? "\nwindow.ONIKI_WORKSHEET_CATALOG = " + serialize([...grouped.values()]) + ";" : "") + "\nwindow.QUESTIONS = BANK;" +
      "\nwindow.onikiLegacyEditBaseline = new Map(" + serialize(legacyBaseline) + ");" +
      "\nwindow.onikiResolveEdit = " + resolveEdit.toString() + ";")
    .replace(/years:\[("[^"\r\n]+"(?:,"[^"\r\n]+")*)\]/g,
      (all, years) => key === "class" ? all : "years:[...new Set([" + years + ",...DATA.map(q=>q.year)])]")
    .replace(/years:new Set\(\[("[^"\r\n]+"(?:,"[^"\r\n]+")*)\]\)/g,
      (all, years) => key === "class" ? all : "years:new Set([" + years + ",...DATA.map(q=>q.year).filter(year=>year!=='R5追加')])")
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
  if (!edit) return base;
  if (!snapshot || !Array.isArray(snapshot.opts) || snapshot.opts.length !== 4) {
    // Older records without a baseline only have the complete saved question.
    return { ...base, text: edit.text, opts: edit.opts, correct: edit.correct };
  }
  // The saved baseline identifies which fields the user edited.
  return {
    ...base,
    text: edit.text !== snapshot.text ? edit.text : base.text,
    opts: base.opts.map((choice, i) => edit.opts[i] !== snapshot.opts[i] ? edit.opts[i] : choice),
    correct: edit.correct !== snapshot.correct ? edit.correct : base.correct
  };
}


function toNewQuestion(row, key, prefix, groups) {
  if (!row.id.startsWith(prefix)) return null;
  const rawId = row.id.slice(prefix.length);
  const opts = [row.option1, row.option2, row.option3, row.option4];
  if (!rawId || !row.question_text || opts.some((option) => !option) ||
      ![1, 2, 3, 4].includes(row.correct_answer)) return null;
  const subject = row.subject || "";
  const yearMatch = (row.year_label || "").normalize("NFKC").match(/(?:R|令和)\s*0?(\d+)/i);
  const year = yearMatch ? "R" + yearMatch[1] : "";
  const round = (row.round_label || "").normalize("NFKC");
  const question = { id: rawId, subject, num: row.question_number,
    text: row.question_text, opts, correct: row.correct_answer };

  if (key === "grad") {
    const exam = (row.exam_type || "").normalize("NFKC");
    const stage = /[2二]次/.test(exam) ? "二次" : /[1一]次/.test(exam) ? "一次" : "";
    const period = round.match(/午[前後]/)?.[0];
    const gradYear = /追加/.test(row.sheet_name || "") ? "R5追加" : year;
    return gradYear && stage && period && subject ? { ...question, year: gradYear, stage, period } : null;
  }

  const tab = row.sheet_name || "";
  const labels = [
    [/^解剖/, "解剖"], [/^生理/, "生理"], [/^(経穴|経絡経穴)/, "経穴"],
    [/^(東臨|東洋医学臨床)/, key === "term" ? "東洋医学臨床論" : "東臨"],
    [/^(臨各1|.*林先生)/, "臨各1"], [/^(臨各2|.*西野先生)/, "臨各2"]
  ];
  const label = labels.find(([pattern]) => pattern.test(tab.normalize("NFKC")))?.[1];
  if (!label) return null;
  if (key === "term") {
    const term = round.match(/^[12]/)?.[0];
    return year && term ? { ...question, id: "TERM-" + rawId, subject: label,
      year, stage: term + "学期", period: "期末" } : null;
  }

  const stage = round || "問題集";
  const kind = /小テスト|確認テスト/.test(stage) ? "小テスト" : "問題集";
  const existing = [...groups.values()].find((group) => group.subject === label &&
    group.kind === kind && (group.label === stage || group.original === stage));
  const fileKey = existing?.key ?? JSON.stringify([label, kind, stage]);
  if (!existing) groups.set(fileKey, { key: fileKey, subject: label, kind,
    label: stage, original: stage });
  return { ...question, subject: label, year: kind, stage, kind, period: "授業プリント",
    fileKey, sourceFile: stage, originalFile: stage };
}
