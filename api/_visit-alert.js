const { database } = require('./_db');

// Only the public homepage generates visit alerts; /new remains a working preview.
async function notifyVisit({ sessionId, pathname, referrer = '' }) {
  if (process.env.PORTFOLIO_VISIT_ALERTS !== 'true' || process.env.VERCEL_ENV !== 'production' || pathname !== '/') return;
  const key = process.env.RESEND_API_KEY;
  const from = process.env.PORTFOLIO_ALERT_FROM;
  if (!key || !from) return;
  const sql = database();
  const [alert] = await sql`INSERT INTO portfolio_visit_alerts (session_id, pathname, referrer)
    VALUES (${sessionId}, ${pathname}, ${referrer})
    ON CONFLICT (session_id) DO UPDATE SET status = 'pending', attempts = portfolio_visit_alerts.attempts + 1, last_attempt = NOW()
    WHERE portfolio_visit_alerts.status IN ('failed', 'pending')
      AND portfolio_visit_alerts.attempts < 3 AND portfolio_visit_alerts.last_attempt < NOW() - INTERVAL '2 minutes'
    RETURNING session_id, pathname, referrer, created_at, attempts`;
  if (!alert) return;
  // Keep notification abuse from consuming the existing mail account's daily quota.
  const [budget] = await sql`INSERT INTO portfolio_alert_limits (day, used)
    VALUES ((NOW() AT TIME ZONE 'Europe/Warsaw')::date, 1)
    ON CONFLICT (day) DO UPDATE SET used = portfolio_alert_limits.used + 1
    WHERE portfolio_alert_limits.used < 60 RETURNING used`;
  if (!budget) {
    await sql`UPDATE portfolio_visit_alerts SET status = 'limited' WHERE session_id = ${sessionId}`;
    return;
  }
  const time = new Date(alert.created_at).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
  const text = `Nowa wizyta na jakubryba.pl\n\nKiedy: ${time}\nStrona: https://jakubryba.pl${alert.pathname}\nŹródło: ${alert.referrer || 'wejście bezpośrednie lub nieznane'}\n\nAktywność, kliknięcia CV, sklepu i katalogów sprawdzisz w panelu:\nhttps://jakubryba.pl/admin\n\nTo powiadomienie o wizycie, nie o zidentyfikowanej osobie. Odświeżenie strony podczas tej samej wizyty nie wywołuje kolejnego alertu.`;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `portfolio-visit/${sessionId}` },
      body: JSON.stringify({ from, to: ['jryba.94@gmail.com'], subject: 'Nowa wizyta na jakubryba.pl', text }),
      signal: AbortSignal.timeout(7000)
    });
    if (!response.ok) throw new Error(`mail_http_${response.status}`);
    await sql`UPDATE portfolio_visit_alerts SET status = 'sent', sent_at = NOW() WHERE session_id = ${sessionId}`;
  } catch {
    await sql`UPDATE portfolio_visit_alerts SET status = 'failed' WHERE session_id = ${sessionId}`;
    console.error('Portfolio visit notification failed; analytics event retained');
  }
}
module.exports = { notifyVisit };
