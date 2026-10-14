const { database, ensureSchema } = require("./_db");

const allowedEvents = new Set(["page_view", "engagement", "cv_download", "outbound_click", "project_expand", "project_read"]);
const allowedTargets = new Set(["cv", "email", "phone", "linkedin", "project"]);

function isOwnOrigin(origin) {
  if (!origin) return true;
  return /^https:\/\/(jakubryba\.pl|www\.jakubryba\.pl|jakubryba-portfolio(?:-[a-z0-9-]+)?\.vercel\.app)$/i.test(origin);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!isOwnOrigin(req.headers.origin)) return res.status(403).json({ error: "Invalid origin" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const event = String(body.event || "");
    const sessionId = String(body.sessionId || "");
    if (!allowedEvents.has(event) || !/^[a-z0-9-]{20,80}$/i.test(sessionId)) {
      return res.status(400).json({ error: "Invalid event" });
    }

    const pathname = String(body.pathname || "/").slice(0, 120);
    const scroll = Number.isFinite(Number(body.scrollDepth)) ? Math.max(0, Math.min(100, Math.round(Number(body.scrollDepth)))) : null;
    const active = Number.isFinite(Number(body.activeSeconds)) ? Math.max(0, Math.min(24 * 60 * 60, Math.round(Number(body.activeSeconds)))) : null;
    const target = allowedTargets.has(body.target) ? body.target : null;
    const referrer = String(body.referrer || "").replace(/^https?:\/\//, "").split("/")[0].slice(0, 120);
    const project = target === "project" ? String(body.project || "").slice(0, 140) : "";
    const metadata = { ...(target ? { target } : {}), ...(project ? { project } : {}), ...(referrer ? { referrer } : {}) };

    await ensureSchema();
    const sql = database();
    await sql`INSERT INTO portfolio_events (session_id, event_type, pathname, metadata, scroll_depth, active_seconds)
      VALUES (${sessionId}, ${event}, ${pathname}, ${JSON.stringify(metadata)}::jsonb, ${scroll}, ${active})`;
    return res.status(204).end();
  } catch (error) {
    console.error("Portfolio tracking error", error);
    return res.status(500).json({ error: "Unable to record event" });
  }
};
