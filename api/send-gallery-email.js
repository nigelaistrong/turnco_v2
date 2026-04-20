// Vercel serverless function — sends gallery link to owner after cleaner uploads photos
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'TurnCo <noreply@schedule.turnco.app>';
const APP_URL = process.env.APP_URL || 'https://v2.turnco.app';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { cleaningId, ownerEmail, propertyName, cleaningDate, cleanerName } = req.body;

  if (!cleaningId || !ownerEmail || !propertyName || !cleaningDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!RESEND_API_KEY) {
    return res.status(500).json({ error: 'Email service not configured' });
  }

  const dateObj = new Date(cleaningDate + 'T12:00:00');
  const displayDate = dateObj.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const galleryUrl = `${APP_URL}/gallery?id=${cleaningId}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; margin: 0; padding: 20px;">
      <div style="max-width: 480px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
        <div style="background: #2563eb; padding: 24px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 22px;">TurnCo</h1>
          <p style="color: #bfdbfe; margin: 4px 0 0; font-size: 14px;">Cleaning Complete</p>
        </div>
        <div style="padding: 28px;">
          <p style="color: #374151; font-size: 16px; margin: 0 0 16px;">
            Your cleaning at <strong>${propertyName}</strong> on ${displayDate} has been marked complete${cleanerName ? ` by <strong>${cleanerName}</strong>` : ''}.
          </p>
          <p style="color: #374151; font-size: 15px; margin: 0 0 24px;">Photos were uploaded. View the full before/after gallery here:</p>
          <div style="text-align: center; margin: 0 0 24px;">
            <a href="${galleryUrl}" style="display: inline-block; background: #2563eb; color: white; font-weight: 600; font-size: 15px; padding: 14px 28px; border-radius: 12px; text-decoration: none;">
              View Photo Gallery →
            </a>
          </div>
          <p style="color: #9ca3af; font-size: 13px; margin: 0; text-align: center;">
            <a href="${galleryUrl}" style="color: #6b7280; word-break: break-all;">${galleryUrl}</a>
          </p>
        </div>
        <div style="background: #f9fafb; padding: 16px; text-align: center; border-top: 1px solid #e5e7eb;">
          <p style="color: #9ca3af; font-size: 12px; margin: 0;">Sent via TurnCo</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: ownerEmail,
      subject: `Cleaning complete: ${propertyName} — ${displayDate}`,
      html,
    }),
  });

  const result = await response.json();

  if (!response.ok) {
    console.error('Resend error:', result);
    return res.status(500).json({ error: result.message || 'Failed to send email' });
  }

  return res.status(200).json({ success: true, id: result.id });
}
