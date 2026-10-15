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
    const domain = /^(www\\.)?jakubryba\\.pl$/i.test(host) ? "; Domain=jakubryba.pl" : "";
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
    const { days, since } = rangeFrom(req);

    const [summary] = await sql`
      WITH sessions AS (
        SELECT session_id, MAX(scroll_depth) AS scroll_depth, MAX(active_seconds) AS active_seconds
        FROM portfolio_events WHERE created_at >= ${since}
        GROUP BY session_id
      )
      SELECT
        (SELECT COUNT(*) FROM sessions)::int AS visits,
        (SELECT COUNT(*) FROM portfolio_events WHERE created_at >= ${since} AND event_type = 'page_view')::int AS page_views,
        (SELECT COUNT(*) FROM portfolio_events WHERE created_at >= ${since} AND event_type = 'cv_download')::int AS cv_downloads,
        COALESCE((SELECT ROUND(AVG(active_seconds)) FROM sessions), 0)::int AS avg_active_seconds,
        COALESCE((SELECT ROUND(AVG(scroll_depth)) FROM sessions), 0)::int AS avg_scroll,
        (SELECT COUNT(*) FROM sessions WHERE scroll_depth >= 50)::int AS scroll_50,
        (SELECT COUNT(*) FROM sessions WHERE scroll_depth >= 90)::int AS scroll_90,
        (SELECT COUNT(DISTINCT session_id) FROM portfolio_events WHERE created_at >= ${since} AND event_type = 'outbound_click')::int AS contact_clicks`;

    const daily = await sql`
      SELECT TO_CHAR(DATE(created_at), 'DD.MM') AS day,
             COUNT(DISTINCT session_id)::int AS visits,
             COUNT(*) FILTER (WHERE event_type = 'cv_download')::int AS downloads
      FROM portfolio_events WHERE created_at >= ${since}
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at)`;

    const recent = await sql`
      SELECT event_type, pathname, metadata, scroll_depth, active_seconds, created_at
      FROM portfolio_events WHERE created_at >= ${since}
      ORDER BY created_at DESC LIMIT 20`;

    const projects = await sql`
      SELECT metadata->>'project' AS project,
             COUNT(*) FILTER (WHERE event_type = 'project_expand')::int AS expands,
             COUNT(*) FILTER (WHERE event_type = 'project_read')::int AS reads,
             COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'project_read')::int AS readers
      FROM portfolio_events
      WHERE created_at >= ${since}
        AND event_type IN ('project_expand', 'project_read')
        AND metadata->>'project' IS NOT NULL
        AND metadata->>'project' NOT LIKE '%TEST%'
      GROUP BY metadata->>'project'
      ORDER BY reads DESC, expands DESC`;

    return res.status(200).json({ days, summary, daily, recent, projects, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("Portfolio admin error", error);
    return res.status(500).json({ error: "Nie udało się pobrać analityki" });
  }
};
