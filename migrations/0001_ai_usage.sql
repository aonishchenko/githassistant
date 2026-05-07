CREATE TABLE IF NOT EXISTS ai_usage (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        INTEGER NOT NULL,
  trigger   TEXT    NOT NULL,
  username  TEXT    NOT NULL,
  model     TEXT    NOT NULL,
  input_tk  INTEGER NOT NULL,
  output_tk INTEGER NOT NULL,
  cost_usd  REAL    NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_usage_ts ON ai_usage(ts);
CREATE INDEX IF NOT EXISTS ai_usage_username ON ai_usage(username);
