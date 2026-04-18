// Validates an iCal URL by fetching it server-side (avoids CORS issues)
export default async function handler(req, res) {
  const url = req.query.url;
  if (!url) return res.status(400).json({ valid: false, error: 'No URL provided' });

  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'TurnCo/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    const text = await r.text();
    const valid = text.includes('BEGIN:VCALENDAR');
    return res.status(200).json({ valid });
  } catch (e) {
    return res.status(200).json({ valid: false, error: e.message });
  }
}
