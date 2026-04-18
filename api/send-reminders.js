// Vercel serverless function — sends night-before reminder emails
// Called by Vercel cron at 8pm every night

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mcbnmsbinjvpqtszvkvj.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'TurnCo <noreply@schedule.turnco.app>';

export default async function handler(req, res) {
  // Allow GET (from cron) or POST (manual trigger)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!RESEND_API_KEY || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Missing environment variables' });
  }

  // Get tomorrow's date
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  // Query cleanings scheduled for tomorrow with an assigned cleaner
  const cleaningsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/cleanings?cleaning_date=eq.${tomorrowStr}&status=eq.scheduled&cleaner_id=not.is.null&select=*,cleaners(name,email),properties(name,address)`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    }
  );

  const cleanings = await cleaningsRes.json();

  if (!Array.isArray(cleanings) || cleanings.length === 0) {
    return res.status(200).json({ sent: 0, message: 'No cleanings tomorrow' });
  }

  const results = [];

  for (const cleaning of cleanings) {
    const cleaner = cleaning.cleaners;
    const property = cleaning.properties;

    if (!cleaner?.email) {
      results.push({ id: cleaning.id, skipped: 'no cleaner email' });
      continue;
    }

    const dateObj = new Date(cleaning.cleaning_date + 'T12:00:00');
    const displayDate = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const timeDisplay = cleaning.cleaning_time ? formatTime(cleaning.cleaning_time) : '8:00 AM';

    const html = `
      <!DOCTYPE html>
      <html>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; margin: 0; padding: 20px;">
        <div style="max-width: 480px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
          <div style="background: #2563eb; padding: 24px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 22px;">TurnCo</h1>
            <p style="color: #bfdbfe; margin: 4px 0 0; font-size: 14px;">Reminder: Cleaning Tomorrow</p>
          </div>
          <div style="padding: 28px;">
            <p style="color: #374151; font-size: 16px; margin: 0 0 20px;">Hi ${cleaner.name || 'there'},</p>
            <p style="color: #374151; font-size: 15px; margin: 0 0 20px;">Just a reminder — you have a cleaning <strong>tomorrow</strong>:</p>

            <div style="background: #fefce8; border: 1px solid #fde047; border-radius: 12px; padding: 16px; margin: 0 0 20px;">
              <p style="margin: 0 0 8px; font-size: 17px; font-weight: 700; color: #1e3a5f;">${property?.name || 'Property'}</p>
              ${property?.address ? `<p style="margin: 0 0 6px; color: #6b7280; font-size: 14px;">📍 ${property.address}</p>` : ''}
              <p style="margin: 0 0 6px; color: #374151; font-size: 15px;">📅 ${displayDate}</p>
              <p style="margin: 0; color: #374151; font-size: 15px;">⏰ ${timeDisplay}</p>
              ${cleaning.notes ? `<p style="margin: 10px 0 0; color: #6b7280; font-size: 14px; font-style: italic;">Notes: ${cleaning.notes}</p>` : ''}
            </div>

            <p style="color: #6b7280; font-size: 14px; margin: 0;">See you there! Reply to this email with any questions.</p>
          </div>
          <div style="background: #f9fafb; padding: 16px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">Sent via TurnCo</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: cleaner.email,
        subject: `Reminder: Cleaning tomorrow at ${property?.name || 'your property'}`,
        html,
      }),
    });

    const emailResult = await emailRes.json();
    results.push({ id: cleaning.id, cleaner: cleaner.name, sent: emailRes.ok, emailId: emailResult.id });
  }

  const sent = results.filter(r => r.sent).length;
  return res.status(200).json({ sent, total: cleanings.length, results });
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}
