const { neon } = require("@neondatabase/serverless");

function database() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  return neon(process.env.DATABASE_URL);
}

let schemaPromise;
async function ensureSchema() {
  if (!schemaPromise) {
    const sql = database();
    schemaPromise = Promise.all([
      sql`CREATE TABLE IF NOT EXISTS portfolio_events (
        id BIGSERIAL PRIMARY KEY,
        session_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        pathname TEXT NOT NULL DEFAULT '/',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        scroll_depth SMALLINT,
        active_seconds INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      sql`CREATE INDEX IF NOT EXISTS portfolio_events_created_at_idx ON portfolio_events (created_at DESC)`,
      sql`CREATE INDEX IF NOT EXISTS portfolio_events_session_idx ON portfolio_events (session_id, created_at DESC)`
    ]);
  }
  return schemaPromise;
}

module.exports = { database, ensureSchema };
