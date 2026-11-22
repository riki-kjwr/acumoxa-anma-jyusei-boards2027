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
<main><h1>卒試過去問</h1><p>R7一次午前の最初の20問をD1から読み込みます。</p>
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
    const { questions } = await pilot.json();
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
  const bank = JSON.parse(bankJson).map((question) => {
    const updated = byId.get(question.id);
    if (!updated) return question;
    count++;
    const opts = [updated.option1, updated.option2, updated.option3, updated.option4];
    if (!updated.question_text || opts.some((choice) => !choice) ||
        ![1, 2, 3, 4].includes(updated.correct_answer)) throw new Error("Invalid D1 question");
    return { ...question, text: updated.question_text, opts, correct: updated.correct_answer };
  });
  if (count !== 20 || byId.size !== 20) throw new Error("D1 sample does not match the app");

  const serialized = JSON.stringify(bank).replaceAll("<", "\\u003c");
  return original.replace(bankPattern, () => "const BANK = " + serialized + ";\nwindow.QUESTIONS = BANK;")
    .replace("</body>", `<script>
window.addEventListener('message', (event) => {
  if (event.source === window && event.data?.type === 'fourway-home') location.assign('/');
});
</script></body>`);
}
