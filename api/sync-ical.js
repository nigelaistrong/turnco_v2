// Vercel cron — runs every 5 minutes
// Fetches iCal for all active properties, creates new cleanings, emails default cleaner

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mcbnmsbinjvpqtszvkvj.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'TurnCo <notifications@turnco.app>';

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
  return res.json();
}

async function sbPost(path, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(data),
  });
  return res.json();
}

async function sbPatch(path, data) {
  await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
}

function parseIcal(text) {
  const bookings = [];
  const events = text.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  const today = new Date().toISOString().split('T')[0];

  for (const ev of events) {
    const dtstart = (ev.match(/DTSTART[^:]*:(\d{8})/) || [])[1];
    const dtend   = (ev.match(/DTEND[^:]*:(\d{8})/)   || [])[1];
    const summary = (ev.match(/SUMMARY:(.+)/)           || [])[1]?.trim() || '';

    if (!dtstart || !dtend) continue;

    const checkin  = `${dtstart.slice(0,4)}-${dtstart.slice(4,6)}-${dtstart.slice(6,8)}`;
    const checkout = `${dtend.slice(0,4)}-${dtend.slice(4,6)}-${dtend.slice(6,8)}`;

    // Skip past cleanings and Airbnb blocks
    if (checkout < today) continue;
    if (summary.toLowerCase().includes('not available') || summary.toLowerCase() === 'airbnb') continue;

    bookings.push({ checkin, checkout, guest: summary });
  }

  // Sort by checkout date
  bookings.sort((a, b) => a.checkout.localeCompare(b.checkout));
  return bookings;
}

async function sendAssignmentEmail(cleaner, property, cleaning, nextCheckin) {
  if (!RESEND_API_KEY || !cleaner?.email) return;

  const dateObj = new Date(cleaning.cleaning_date + 'T12:00:00');
  const displayDate = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const isUrgent = nextCheckin && nextCheckin === cleaning.cleaning_date;

  const dtstart = cleaning.cleaning_date.replace(/-/g, '') + 'T080000';
  const dtend   = cleaning.cleaning_date.replace(/-/g, '') + 'T110000';
  const icsContent = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TurnCo//EN', 'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:cleaning-${cleaning.id || Date.now()}@turnco.app`,
    `DTSTART:${dtstart}`, `DTEND:${dtend}`,
    `SUMMARY:Cleaning - ${property.name}`,
    `DESCRIPTION:You have been assigned a cleaning at ${property.name}.${isUrgent ? '\\n\\n⚡ URGENT: Next guest checks in same day!' : ''}`,
    property.address ? `LOCATION:${property.address}` : '',
    'STATUS:CONFIRMED', 'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');

  const html = `
    <!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;background:#f9fafb;margin:0;padding:20px;">
    <div style="max-width:480px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
      <div style="background:#2563eb;padding:24px;text-align:center;">
        <h1 style="color:white;margin:0;font-size:22px;">TurnCo</h1>
        <p style="color:#bfdbfe;margin:4px 0 0;font-size:14px;">${isUrgent ? '⚡ URGENT Cleaning Assignment' : 'Cleaning Assignment'}</p>
      </div>
      <div style="padding:28px;">
        <p style="color:#374151;font-size:16px;margin:0 0 20px;">Hi ${cleaner.name || 'there'},</p>
        <p style="color:#374151;font-size:15px;margin:0 0 20px;">You've been assigned a cleaning job:</p>
        <div style="background:${isUrgent ? '#fef2f2' : '#f0f9ff'};border:1px solid ${isUrgent ? '#fca5a5' : '#bae6fd'};border-radius:12px;padding:16px;margin:0 0 20px;">
          ${isUrgent ? '<p style="margin:0 0 8px;color:#dc2626;font-weight:700;font-size:14px;">⚡ Next guest checks in same day — please prioritize!</p>' : ''}
          <p style="margin:0 0 8px;font-size:17px;font-weight:700;color:#1e3a5f;">${property.name}</p>
          ${property.address ? `<p style="margin:0 0 6px;color:#6b7280;font-size:14px;">📍 ${property.address}</p>` : ''}
          <p style="margin:0 0 6px;color:#374151;font-size:15px;">📅 ${displayDate}</p>
          ${nextCheckin ? `<p style="margin:0 0 6px;color:#374151;font-size:14px;">👤 Next guest check-in: ${new Date(nextCheckin + 'T12:00:00').toLocaleDateString('en-US', {month:'short',day:'numeric'})}</p>` : ''}
        </div>
        <p style="color:#6b7280;font-size:14px;margin:0;">📎 Calendar invite attached — tap to add to your calendar.</p>
      </div>
      <div style="background:#f9fafb;padding:16px;text-align:center;border-top:1px solid #e5e7eb;">
        <p style="color:#9ca3af;font-size:12px;margin:0;">Sent via TurnCo · Reply with any questions</p>
      </div>
    </div></body></html>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: cleaner.email,
      subject: `${isUrgent ? '⚡ URGENT: ' : ''}Cleaning Assignment: ${property.name} on ${displayDate}`,
      html,
      attachments: [{ filename: 'cleaning.ics', content: Buffer.from(icsContent).toString('base64') }],
    }),
  });
}

export default async function handler(req, res) {
  if (!SUPABASE_SERVICE_KEY) return res.status(500).json({ error: 'Missing config' });

  // Get all active properties
  const properties = await sbGet('properties?active=eq.true&select=*');
  if (!Array.isArray(properties)) return res.status(500).json({ error: 'Failed to fetch properties' });

  // Get all cleaners (for default cleaner lookup)
  const cleaners = await sbGet('cleaners?active=eq.true&select=id,name,email');
  const cleanerMap = {};
  if (Array.isArray(cleaners)) cleaners.forEach(c => { cleanerMap[c.id] = c; });

  // Attach default_cleaner to each property
  for (const prop of properties) {
    prop.default_cleaner = prop.default_cleaner_id ? (cleanerMap[prop.default_cleaner_id] || null) : null;
  }

  let created = 0;
  let errors = 0;

  for (const prop of properties) {
    if (!prop.ical_url) continue;

    try {
      const icalRes = await fetch(prop.ical_url, { headers: { 'User-Agent': 'TurnCo/1.0' } });
      const icalText = await icalRes.text();
      const bookings = parseIcal(icalText);

      // Get existing cleanings for this property
      const existing = await sbGet(`cleanings?property_id=eq.${prop.id}&select=id,checkout_date,checkin_date`);
      const existingMap = {};
      if (Array.isArray(existing)) existing.forEach(c => { existingMap[c.checkout_date] = c; });

      for (let i = 0; i < bookings.length; i++) {
        const booking = bookings[i];
        const nextCheckin = bookings[i + 1]?.checkin || null;

        // Backfill checkin_date on existing cleanings that are missing it
        if (existingMap[booking.checkout]) {
          const ex = existingMap[booking.checkout];
          if (!ex.checkin_date && booking.checkin) {
            await sbPatch(`cleanings?id=eq.${ex.id}`, { checkin_date: booking.checkin });
          }
          continue;
        }

        const payload = {
          property_id: prop.id,
          company_id: prop.company_id,
          cleaner_id: prop.default_cleaner_id || null,
          checkin_date: booking.checkin,
          checkout_date: booking.checkout,
          cleaning_date: booking.checkout,
          next_checkin_date: nextCheckin,
          status: 'scheduled',
          notes: null,
        };

        const result = await sbPost('cleanings', payload);
        const newCleaning = Array.isArray(result) ? result[0] : result;
        created++;

        // Email default cleaner if set
        if (prop.default_cleaner_id && prop.default_cleaner?.email && newCleaning) {
          await sendAssignmentEmail(prop.default_cleaner, prop, newCleaning, nextCheckin);
        }
      }

      // Always update last_synced_at after processing a property
      await sbPatch(`properties?id=eq.${prop.id}`, { last_synced_at: new Date().toISOString() });
    } catch (e) {
      console.error(`Error syncing property ${prop.id}:`, e.message);
      errors++;
    }
  }

  return res.status(204).end();
}
