// Vercel serverless function — sends assignment email with .ics calendar invite
// Called by the frontend when a cleaner is assigned to a cleaning

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'TurnCo <noreply@schedule.turnco.app>';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { cleanerEmail, cleanerName, propertyName, propertyAddress, cleaningDate, cleaningTime, notes, cleaningId, isQuickTurn } = req.body;

  if (!cleanerEmail || !propertyName || !cleaningDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!RESEND_API_KEY) {
    return res.status(500).json({ error: 'Email service not configured' });
  }

  // Format date for display
  const dateObj = new Date(cleaningDate + 'T12:00:00');
  const displayDate = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const timeDisplay = cleaningTime ? formatTime(cleaningTime) : '8:00 AM';

  // Build .ics calendar invite
  const uid = `cleaning-${cleaningId || Date.now()}@cleansync.app`;
  const dtstart = formatIcsDate(cleaningDate, cleaningTime || '08:00');
  const dtend   = formatIcsDate(cleaningDate, addHours(cleaningTime || '08:00', 3));
  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TurnCo//EN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:Cleaning - ${propertyName}`,
    `DESCRIPTION:You have been assigned a cleaning at ${propertyName}.${notes ? '\\n\\nNotes: ' + notes : ''}`,
    propertyAddress ? `LOCATION:${propertyAddress}` : '',
    `STATUS:CONFIRMED`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');

  const icsBase64 = Buffer.from(icsContent).toString('base64');

  // Build email HTML
  const html = `
    <!DOCTYPE html>
    <html>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; margin: 0; padding: 20px;">
      <div style="max-width: 480px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
        <div style="background: #2563eb; padding: 24px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 22px;">TurnCo</h1>
          <p style="color: #bfdbfe; margin: 4px 0 0; font-size: 14px;">Cleaning Assignment</p>
        </div>
        <div style="padding: 28px;">
          <p style="color: #374151; font-size: 16px; margin: 0 0 20px;">Hi ${cleanerName || 'there'},</p>
          ${isQuickTurn ? `
          <div style="background: #fff7ed; border: 2px solid #f97316; border-radius: 12px; padding: 12px 16px; margin: 0 0 16px; display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 22px;">⚡</span>
            <div>
              <p style="margin: 0; font-size: 15px; font-weight: 700; color: #9a3412;">Quick Turn — Same-Day Check-In</p>
              <p style="margin: 4px 0 0; font-size: 13px; color: #c2410c;">A new guest checks in the same day. Please prioritize and finish as early as possible.</p>
            </div>
          </div>` : ''}
          <p style="color: #374151; font-size: 15px; margin: 0 0 20px;">You've been assigned a cleaning job:</p>

          <div style="background: ${isQuickTurn ? '#fff7ed' : '#f0f9ff'}; border: 1px solid ${isQuickTurn ? '#fdba74' : '#bae6fd'}; border-radius: 12px; padding: 16px; margin: 0 0 20px;">
            <p style="margin: 0 0 8px; font-size: 17px; font-weight: 700; color: #1e3a5f;">${propertyName}</p>
            ${propertyAddress ? `<p style="margin: 0 0 6px; color: #6b7280; font-size: 14px;">📍 ${propertyAddress}</p>` : ''}
            <p style="margin: 0 0 6px; color: #374151; font-size: 15px;">📅 ${displayDate}</p>
            <p style="margin: 0; color: #374151; font-size: 15px;">⏰ ${timeDisplay}</p>
            ${notes ? `<p style="margin: 10px 0 0; color: #6b7280; font-size: 14px; font-style: italic;">Notes: ${notes}</p>` : ''}
          </div>

          <p style="color: #6b7280; font-size: 14px; margin: 0 0 4px;">📎 A calendar invite is attached — open it to add this cleaning to your calendar.</p>
        </div>
        <div style="background: #f9fafb; padding: 16px; text-align: center; border-top: 1px solid #e5e7eb;">
          <p style="color: #9ca3af; font-size: 12px; margin: 0;">Sent via TurnCo · Reply to this email with any questions</p>
        </div>
      </div>
    </body>
    </html>
  `;

  // Send via Resend
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: cleanerEmail,
      subject: `Cleaning Assignment: ${propertyName} on ${displayDate}`,
      html,
      attachments: [{
        filename: 'cleaning.ics',
        content: icsBase64,
      }],
    }),
  });

  const result = await response.json();

  if (!response.ok) {
    console.error('Resend error:', result);
    return res.status(500).json({ error: result.message || 'Failed to send email' });
  }

  return res.status(200).json({ success: true, id: result.id });
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatIcsDate(dateStr, timeStr) {
  const [y, mo, d] = dateStr.split('-');
  const [h, m] = (timeStr || '08:00').split(':');
  return `${y}${mo}${d}T${String(h).padStart(2,'0')}${String(m).padStart(2,'0')}00`;
}

function addHours(timeStr, hours) {
  const [h, m] = timeStr.split(':').map(Number);
  return `${String((h + hours) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
