const { neon } = require("@neondatabase/serverless");

function database() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  return neon(process.env.DATABASE_URL);
}

let schemaPromise;
async function ensureSchema() {
  if (!schemaPromise) {
    const sql = database();
    schemaPromise = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS portfolio_events (
        id BIGSERIAL PRIMARY KEY,
        session_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        pathname TEXT NOT NULL DEFAULT '/',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        scroll_depth SMALLINT,
        active_seconds INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
      await sql`CREATE INDEX IF NOT EXISTS portfolio_events_created_at_idx ON portfolio_events (created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS portfolio_events_session_idx ON portfolio_events (session_id, created_at DESC)`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS portfolio_events_event_id_idx ON portfolio_events ((metadata->>'eventId')) WHERE metadata ? 'eventId'`;
      await sql`CREATE TABLE IF NOT EXISTS portfolio_visit_alerts (
        session_id TEXT PRIMARY KEY, pathname TEXT NOT NULL, referrer TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_attempt TIMESTAMPTZ NOT NULL DEFAULT NOW(), sent_at TIMESTAMPTZ
      )`;
      await sql`CREATE TABLE IF NOT EXISTS portfolio_alert_limits (day DATE PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0)`;
    })();
  }
  return schemaPromise;
}

module.exports = { database, ensureSchema };
