const { createClerkClient, verifyToken } = require("@clerk/backend");
const { database, ensureSchema } = require("./_db");

const ADMIN_EMAIL = "jryba.94@gmail.com";

async function authenticate(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token || !process.env.CLERK_SECRET_KEY) return null;

  const claims = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
  const client = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  const user = await client.users.getUser(claims.sub);
  const primary = user.emailAddresses.find((item) => item.id === user.primaryEmailAddressId);
  return primary?.emailAddress?.toLowerCase() === ADMIN_EMAIL ? user : null;
}

function rangeFrom(req) {
  const parsed = Number.parseInt(String(req.query?.days || "30"), 10);
  const days = [1, 7, 30, 90].includes(parsed) ? parsed : 30;
  return { days, since: new Date(Date.now() - days * 24 * 60 * 60 * 1000) };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "DELETE"].includes(req.method)) return res.status(405).json({ error: "Method not allowed" });
  try {
    const user = await authenticate(req);
    if (!user) return res.status(403).json({ error: "Brak dostępu" });
    const host = (req.headers.host || "").split(":")[0];
    const domain = ["jakubryba.pl", "www.jakubryba.pl"].includes(host.toLowerCase()) ? "; Domain=jakubryba.pl" : "";
    res.setHeader("Set-Cookie", `portfolio_owner=1; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax${domain}`);
    if (req.method === "DELETE" && req.headers["x-confirm-reset"] !== "all-analytics") {
      return res.status(400).json({ error: "Wymagane potwierdzenie resetu" });
    }
    await ensureSchema();
    const sql = database();
    if (req.method === "DELETE") {
      await sql`DELETE FROM portfolio_events`;
      return res.status(200).json({ ok: true });
    }
    const { days } = rangeFrom(req);
    const page = ["/", "/new"].includes(req.query?.page) ? req.query.page : "all";
    // All variable values are bound parameters; query text is static.
    const source = `WITH events AS (
      SELECT * FROM portfolio_events
      WHERE created_at >= CASE WHEN $1::int = 1
        THEN date_trunc('day', NOW() AT TIME ZONE 'Europe/Warsaw') AT TIME ZONE 'Europe/Warsaw'
        ELSE NOW() - make_interval(days => $1::int) END
      AND ($2::text = 'all' OR rtrim(pathname, '/') = rtrim($2::text, '/'))
    ), pages AS (
      SELECT session_id, COALESCE(metadata->>'pageId', pathname) AS page_id,
        MAX(active_seconds) AS active_seconds, MAX(scroll_depth) AS scroll_depth
      FROM events GROUP BY session_id, COALESCE(metadata->>'pageId', pathname)
    ), sessions AS (
      SELECT session_id, SUM(active_seconds) AS active_seconds, MAX(scroll_depth) AS scroll_depth
      FROM pages GROUP BY session_id
    ) `;
    const query = (text) => sql.query(source + text, [days, page]);
    const [[summary], daily, recent, projects, visits, links, alerts] = await Promise.all([
      query(`SELECT
        (SELECT COUNT(*) FROM sessions)::int AS visits,
        (SELECT COUNT(DISTINCT COALESCE(metadata->>'visitorId', session_id)) FROM events)::int AS unique_visitors,
        (SELECT COUNT(*) FROM events WHERE event_type = 'page_view')::int AS page_views,
        (SELECT COUNT(*) FROM events WHERE event_type = 'cv_download')::int AS cv_downloads,
        COALESCE((SELECT ROUND(AVG(active_seconds)) FROM sessions), 0)::int AS avg_active_seconds,
        COALESCE((SELECT ROUND(AVG(scroll_depth)) FROM sessions), 0)::int AS avg_scroll,
        (SELECT COUNT(*) FROM sessions WHERE scroll_depth >= 50)::int AS scroll_50,
        (SELECT COUNT(*) FROM sessions WHERE scroll_depth >= 90)::int AS scroll_90,
        (SELECT COUNT(DISTINCT session_id) FROM events WHERE event_type = 'outbound_click')::int AS contact_clicks,
        (SELECT COUNT(DISTINCT session_id) FROM events WHERE event_type = 'cv_download')::int AS cv_visits`),
      query(`SELECT TO_CHAR(created_at AT TIME ZONE 'Europe/Warsaw', 'DD.MM') AS day,
        COUNT(DISTINCT session_id)::int AS visits,
        COUNT(*) FILTER (WHERE event_type = 'cv_download')::int AS downloads
        FROM events GROUP BY (created_at AT TIME ZONE 'Europe/Warsaw')::date,
        TO_CHAR(created_at AT TIME ZONE 'Europe/Warsaw', 'DD.MM')
        ORDER BY (created_at AT TIME ZONE 'Europe/Warsaw')::date`),
      query(`SELECT event_type, pathname, metadata, scroll_depth, active_seconds, created_at
        FROM events WHERE event_type <> 'engagement' ORDER BY created_at DESC LIMIT 30`),
      query(`SELECT metadata->>'project' AS project,
        COUNT(*) FILTER (WHERE event_type = 'project_expand')::int AS expands,
        COUNT(*) FILTER (WHERE event_type = 'project_read')::int AS reads,
        COUNT(DISTINCT COALESCE(metadata->>'visitorId', session_id)) FILTER (WHERE event_type = 'project_read')::int AS readers
        FROM events WHERE event_type IN ('project_expand', 'project_read')
        AND metadata->>'project' IS NOT NULL AND metadata->>'project' NOT LIKE '%TEST%'
        GROUP BY metadata->>'project' ORDER BY reads DESC, expands DESC`),
      query(`SELECT e.session_id, MIN(e.created_at) AS started_at, MAX(e.created_at) AS last_seen,
        ARRAY_AGG(DISTINCT e.pathname) AS paths,
        MAX(COALESCE(e.metadata->>'visitorId', e.session_id)) AS visitor_id,
        COUNT(*) FILTER (WHERE e.event_type = 'page_view')::int AS page_views,
        COUNT(*) FILTER (WHERE e.event_type = 'cv_download')::int AS downloads,
        COUNT(*) FILTER (WHERE e.event_type = 'project_expand')::int AS expands,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT e.metadata->>'target') FILTER (WHERE e.event_type = 'outbound_click'), NULL) AS contacts,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT e.metadata->>'linkLabel') FILTER (WHERE e.event_type = 'resource_click'), NULL) AS links,
        MAX(s.active_seconds)::int AS active_seconds, MAX(s.scroll_depth)::int AS scroll_depth
        FROM events e JOIN sessions s ON s.session_id = e.session_id
        GROUP BY e.session_id ORDER BY MAX(e.created_at) DESC LIMIT 30`),
      query(`SELECT metadata->>'linkUrl' AS url, MAX(metadata->>'linkLabel') AS label,
        COUNT(*)::int AS clicks, COUNT(DISTINCT session_id)::int AS visits,
        COUNT(DISTINCT COALESCE(metadata->>'visitorId', session_id))::int AS visitors,
        MAX(created_at) AS last_clicked
        FROM events WHERE event_type = 'resource_click' AND metadata->>'linkUrl' IS NOT NULL
        GROUP BY metadata->>'linkUrl' ORDER BY clicks DESC, last_clicked DESC`),
      query(`SELECT COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE status = 'limited')::int AS limited
        FROM portfolio_visit_alerts WHERE created_at >= date_trunc('day', NOW() AT TIME ZONE 'Europe/Warsaw') AT TIME ZONE 'Europe/Warsaw'`)
    ]);
    return res.status(200).json({ days, page, summary, daily, recent, projects, visits, links, notifications: { enabled: process.env.PORTFOLIO_VISIT_ALERTS === 'true' && !!process.env.RESEND_API_KEY && !!process.env.PORTFOLIO_ALERT_FROM, recipient: 'jryba.94@gmail.com', dailyLimit: 60, ...(alerts[0] || {}) }, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("Portfolio admin error", error);
    return res.status(500).json({ error: "Nie udało się pobrać analityki" });
  }
};
