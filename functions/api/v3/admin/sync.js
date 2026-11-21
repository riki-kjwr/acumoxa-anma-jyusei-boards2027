// V3 pilot writer. Writes only to questions_v3; never touches the legacy questions table.
// SYNC_TOKEN is a Cloudflare secret and must not be committed.
const APPROVED_SOURCES = {
  ONIKI_GRAD: "1Bhd-2leIdMHywC0nWPqmhSq7FVLB8_OvvP5fIl2fwgE",
  ONIKI_TERM3: "1ITqgsWSnv9hrzPxoOHwnPisLvCCvEfb98iq6crnwZGI",
  ONIKI_CLASS: "11DB9yg4Dy9exhvAAKqv9GCXDpXTd8eff64JAk5HVN00"
};

export async function onRequestPost({ request, env }) {
  if (!env.DB || !env.SYNC_TOKEN) {
    return reply({ error: "Missing DB or SYNC_TOKEN" }, 503);
  }

  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ") ||
      authorization.slice(7) !== env.SYNC_TOKEN) {
    return reply({ error: "Unauthorized" }, 401);
  }

  const raw = await request.text();
  if (raw.length > 120000) return reply({ error: "Batch too large" }, 413);

  let incoming;
  try {
    incoming = JSON.parse(raw);
  } catch {
    return reply({ error: "Invalid JSON" }, 400);
  }

  if (!incoming || !Array.isArray(incoming.questions) ||
      incoming.questions.length < 1 || incoming.questions.length > 20) {
    return reply({ error: "Send 1–20 questions per batch" }, 400);
  }

  const sql = `INSERT INTO questions_v3 (
    id, source_key, spreadsheet_id, sheet_gid, sheet_name, school,
    exam_type, year_label, round_label, subject, unit, question_number,
    question_text, option1, option2, option3, option4, option5,
    option_count, correct_answer, answer_status, updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
  ON CONFLICT(id) DO UPDATE SET
    source_key=excluded.source_key,
    spreadsheet_id=excluded.spreadsheet_id,
    sheet_gid=excluded.sheet_gid,
    sheet_name=excluded.sheet_name,
    school=excluded.school,
    exam_type=excluded.exam_type,
    year_label=excluded.year_label,
    round_label=excluded.round_label,
    subject=excluded.subject,
    unit=excluded.unit,
    question_number=excluded.question_number,
    question_text=excluded.question_text,
    option1=excluded.option1,
    option2=excluded.option2,
    option3=excluded.option3,
    option4=excluded.option4,
    option5=excluded.option5,
    option_count=excluded.option_count,
    correct_answer=excluded.correct_answer,
    answer_status=excluded.answer_status,
    updated_at=CURRENT_TIMESTAMP`;

  const statements = [];
  const counts = {};
  for (const q of incoming.questions) {
    if (!q || typeof q !== "object" || Array.isArray(q)) {
      return reply({ error: "Invalid question object" }, 400);
    }

    const text = (key) => String(q[key] ?? "").trim();
    const id = text("id");
    const sourceKey = text("source_key");
    const spreadsheetId = text("spreadsheet_id");
    const sheetName = text("sheet_name");
    const sheetGid = Number(q.sheet_gid);
    const questionText = text("question_text");
    const optionCount = Number(q.option_count);
    const correctAnswer = Number(q.correct_answer);
    const questionNumber = q.question_number == null
      ? null
      : Number(q.question_number);
    const options = [1, 2, 3, 4, 5].map((n) => text("option" + n));

    if (!id || id.length > 180 ||
        !Object.hasOwn(APPROVED_SOURCES, sourceKey) ||
        APPROVED_SOURCES[sourceKey] !== spreadsheetId ||
        !Number.isInteger(sheetGid) || sheetGid < 0 ||
        !sheetName || !questionText ||
        !Number.isInteger(optionCount) || ![4, 5].includes(optionCount) ||
        options.slice(0, 4).some((value) => !value) ||
        (optionCount === 5 && !options[4]) ||
        !Number.isInteger(correctAnswer) ||
        correctAnswer < 1 || correctAnswer > optionCount ||
        (questionNumber !== null &&
          (!Number.isInteger(questionNumber) || questionNumber < 0))) {
      return reply({ error: "Invalid question: " + (id || "(no ID)") }, 400);
    }

    const values = [
      id, sourceKey, spreadsheetId, sheetGid, sheetName,
      text("school"), text("exam_type"), text("year_label"),
      text("round_label"), text("subject"), text("unit"), questionNumber,
      questionText, ...options, optionCount, correctAnswer, text("answer_status")
    ];
    statements.push(env.DB.prepare(sql).bind(...values));
    counts[sourceKey] = (counts[sourceKey] || 0) + 1;
  }

  try {
    await env.DB.batch(statements);
    return reply({
      ok: true,
      table: "questions_v3",
      upserted: statements.length,
      by_source: counts
    });
  } catch (error) {
    console.error("V3 sync write failed", error);
    return reply({ error: "Database write failed" }, 500);
  }
}

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
