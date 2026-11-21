// Read-only V3 API. The legacy /api/questions endpoint is untouched.
// Pagination is keyset-based so large banks do not load into one response.
export async function onRequestGet({ request, env }) {
  if (!env.SYNC_TOKEN) return reply({ error: "Missing SYNC_TOKEN" }, 503);
  if (request.headers.get("Authorization") !== "Bearer " + env.SYNC_TOKEN) {
    return reply({ error: "Unauthorized" }, 401);
  }
  if (!env.DB) return reply({ error: "D1 database binding DB is missing" }, 503);
  const params = new URL(request.url).searchParams;
  const requested = Number(params.get("limit") || 20);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(100, Math.floor(requested))) : 20;
  const after = (params.get("after") || "").trim();
  const sourceKey = (params.get("source_key") || "").trim();
  const subject = (params.get("subject") || "").trim();
  const rawGid = params.get("sheet_gid");
  if ([after, sourceKey, subject].some((value) => value.length > 300)) {
    return reply({ error: "Filter too long" }, 400);
  }
  const where = ["id > ?", "(source_key = 'ONIKI_GRAD' OR (answer_status NOT LIKE '%要照合%' AND answer_status NOT LIKE '%推定%'))"];
  const args = [after];
  if (sourceKey) { where.push("source_key = ?"); args.push(sourceKey); }
  if (subject) { where.push("subject = ?"); args.push(subject); }
  if (rawGid !== null && rawGid !== "") {
    const gid = Number(rawGid);
    if (!Number.isSafeInteger(gid) || gid < 0) return reply({ error: "Invalid sheet_gid" }, 400);
    where.push("sheet_gid = ?");
    args.push(gid);
  }
  try {
    const sql = `SELECT id, source_key, spreadsheet_id, sheet_gid, sheet_name,
      school, exam_type, year_label, round_label, subject, unit, question_number,
      question_text, option1, option2, option3, option4, option5, option_count,
      correct_answer, answer_status
      FROM questions_v3 WHERE ${where.join(" AND ")} ORDER BY id LIMIT ?`;
    const found = await env.DB.prepare(sql).bind(...args, limit).all();
    const questions = found.results || [];
    return reply({
      count: questions.length,
      next_after: questions.length === limit ? questions[questions.length - 1].id : null,
      questions
    });
  } catch (error) {
    console.error("V3 read failed", error);
    return reply({ error: "Could not read V3 questions" }, 500);
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
