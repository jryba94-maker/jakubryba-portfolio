const { database, ensureSchema } = require("./_db");
const { notifyVisit } = require("./_visit-alert");

const allowedEvents = new Set(["page_view", "engagement", "cv_download", "outbound_click", "project_expand", "project_read", "resource_click"]);
const allowedTargets = new Set(["cv", "email", "phone", "linkedin", "project", "resource"]);

function isOwnOrigin(origin) {
  if (!origin) return true;
  return /^https:\/\/(jakubryba\.pl|www\.jakubryba\.pl|jakubryba-portfolio(?:-[a-z0-9-]+)?\.vercel\.app)$/i.test(origin);
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!isOwnOrigin(req.headers.origin)) return res.status(403).json({ error: "Invalid origin" });

  const owner = (req.headers.cookie || "").split(";").some((cookie) => cookie.trim() === "portfolio_owner=1");
  if (owner) return res.status(204).end();

  const agent = req.headers["user-agent"] || "";
  if (/bot|crawler|spider|headless|lighthouse|python-urllib|curl\//i.test(agent)) return res.status(204).end();

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
    const visitorId = /^[a-z0-9-]{20,80}$/i.test(String(body.visitorId || "")) ? String(body.visitorId) : sessionId;
    const validId = (value) => /^[a-z0-9-]{20,80}$/i.test(String(value || ""));
    const eventId = validId(body.eventId) ? String(body.eventId) : null;
    const pageId = validId(body.pageId) ? String(body.pageId) : null;
    let linkUrl = null;
    if (event === 'resource_click') {
      try {
        const url = new URL(String(body.linkUrl || ''));
        if (target !== 'resource' || url.protocol !== 'https:' || url.href.length > 1000) throw new Error('Invalid link');
        linkUrl = url.origin + url.pathname;
      } catch { return res.status(400).json({ error: 'Invalid link' }); }
    }
    const linkLabel = linkUrl ? String(body.linkLabel || new URL(linkUrl).hostname).slice(0, 100) : null;
    const metadata = { visitorId, ...(linkUrl ? { linkUrl, linkLabel } : {}), ...(eventId ? { eventId } : {}), ...(pageId ? { pageId } : {}), ...(target ? { target } : {}), ...(project ? { project } : {}), ...(referrer ? { referrer } : {}) };

    await ensureSchema();
    const sql = database();
    await sql`INSERT INTO portfolio_events (session_id, event_type, pathname, metadata, scroll_depth, active_seconds)
      VALUES (${sessionId}, ${event}, ${pathname}, ${JSON.stringify(metadata)}::jsonb, ${scroll}, ${active}) ON CONFLICT DO NOTHING`;
    try { await notifyVisit({ sessionId, pathname, referrer }); }
    catch { console.error('Portfolio visit notification unavailable; analytics event retained'); }
    return res.status(204).end();
  } catch (error) {
    console.error("Portfolio tracking error", error);
    return res.status(500).json({ error: "Unable to record event" });
  }
};
