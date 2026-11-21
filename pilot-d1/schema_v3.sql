-- Additive pilot schema. Leaves the existing questions table untouched.
CREATE TABLE IF NOT EXISTS questions_v3 (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL CHECK (source_key IN ('ONIKI_GRAD', 'ONIKI_TERM3', 'ONIKI_CLASS')),
  spreadsheet_id TEXT NOT NULL,
  sheet_gid INTEGER NOT NULL,
  sheet_name TEXT NOT NULL,
  school TEXT NOT NULL DEFAULT '',
  exam_type TEXT NOT NULL DEFAULT '',
  year_label TEXT NOT NULL DEFAULT '',
  round_label TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  question_number INTEGER,
  question_text TEXT NOT NULL,
  option1 TEXT NOT NULL,
  option2 TEXT NOT NULL,
  option3 TEXT NOT NULL,
  option4 TEXT NOT NULL,
  option5 TEXT NOT NULL DEFAULT '',
  option_count INTEGER NOT NULL CHECK (option_count IN (4, 5)),
  correct_answer INTEGER NOT NULL CHECK (correct_answer BETWEEN 1 AND 5),
  answer_status TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (correct_answer <= option_count),
  CHECK (option_count = 4 OR length(trim(option5)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_questions_v3_source_id
  ON questions_v3(source_key, id);
CREATE INDEX IF NOT EXISTS idx_questions_v3_subject_id
  ON questions_v3(subject, id);
CREATE INDEX IF NOT EXISTS idx_questions_v3_spreadsheet_sheet
  ON questions_v3(spreadsheet_id, sheet_gid, id);
