CREATE TABLE IF NOT EXISTS questions (
 id TEXT PRIMARY KEY,
 source_sheet TEXT NOT NULL,
 school TEXT, exam_type TEXT, year_label TEXT, round_label TEXT,
 subject TEXT, unit TEXT, question_number INTEGER,
 question_text TEXT NOT NULL,
 option1 TEXT NOT NULL, option2 TEXT NOT NULL, option3 TEXT NOT NULL, option4 TEXT NOT NULL,
 correct_answer INTEGER NOT NULL CHECK (correct_answer BETWEEN 1 AND 4),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_questions_subject_id ON questions(subject,id);
CREATE INDEX IF NOT EXISTS idx_questions_source_id ON questions(source_sheet,id);