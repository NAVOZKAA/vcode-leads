const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const tls = require('tls');
const net = require('net');

const root = __dirname;
// Small dependency-free .env loader. The file is gitignored and stays on this server.
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !match[2].startsWith('#') && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

const port = process.env.PORT || 3000;
const dataFile = path.join(root, 'data.json');
const instantlyBase = 'https://api.instantly.ai/api/v2';

// In-memory active session tokens for verified activation keys
const validSessions = new Set();
const serverSecret = crypto.randomUUID();

function generateSessionToken() {
  const token = crypto.randomBytes(32).toString('hex');
  validSessions.add(token);
  return token;
}

function verifyAuth(req) {
  const activationKey = process.env.APP_ACTIVATION_KEY;
  if (!activationKey) return true; // If not configured, allow access

  const headerKey = req.headers['x-activation-key'];
  if (headerKey && headerKey === activationKey) return true;

  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (validSessions.has(token)) return true;
  }

  return false;
}

function readData() {
  try {
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    data.leads ||= [];
    data.activity ||= [];
    data.emails ||= [];
    data.outreach ||= [];
    data.teamSubscribers ||= [];
    // Preserve legacy data while correcting old prototype's model mix-up
    for (const lead of data.leads.filter(x => x.instantlyId)) {
      if (!data.outreach.some(x => x.email?.toLowerCase() === lead.email?.toLowerCase())) {
        data.outreach.push({
          id: lead.id,
          email: lead.email,
          name: lead.name,
          company: lead.company,
          status: lead.status,
          instantlyId: lead.instantlyId,
          campaignId: lead.campaignId,
          createdAt: lead.updatedAt || lead.createdAt
        });
      }
    }
    return data;
  } catch {
    return { leads: [], activity: [], emails: [], outreach: [], teamSubscribers: [] };
  }
}

function writeData(data) {
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': `${type}; charset=utf-8` });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function body(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => {
      raw += c;
      if (raw.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

function addActivity(data, item) {
  data.activity.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), ...item });
  data.activity = data.activity.slice(0, 250);
}

function upsertLead(data, email, patch = {}) {
  if (!email) return null;
  let lead = data.leads.find(x => x.email.toLowerCase() === email.toLowerCase());
  if (!lead) {
    lead = {
      id: crypto.randomUUID(),
      name: '',
      company: '',
      jobTitle: '',
      email,
      phone: '',
      website: '',
      linkedin: '',
      country: '',
      city: '',
      industry: '',
      source: '',
      notes: '',
      origin: 'crm',
      createdAt: new Date().toISOString()
    };
    data.leads.push(lead);
  }
  Object.assign(lead, patch, { updatedAt: new Date().toISOString() });
  return lead;
}

function upsertOutreach(data, remote) {
  let record = data.outreach.find(x => x.email?.toLowerCase() === remote.email?.toLowerCase());
  const status = vcodeStatus(remote.lt_interest_status);
  if (!record) {
    record = { id: crypto.randomUUID(), email: remote.email, createdAt: new Date().toISOString() };
    data.outreach.push(record);
  }
  Object.assign(record, {
    name: [remote.first_name, remote.last_name].filter(Boolean).join(' '),
    company: remote.company_name || '',
    status,
    instantlyId: remote.id,
    campaignId: remote.campaign || null,
    updatedAt: new Date().toISOString()
  });
  return record;
}

async function instantly(endpoint, method, payload) {
  if (!process.env.INSTANTLY_API_KEY) return { skipped: true };
  const response = await fetch(`${instantlyBase}${endpoint}`, {
    method,
    headers: { authorization: `Bearer ${process.env.INSTANTLY_API_KEY}`, 'content-type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined
  });
  if (!response.ok) throw new Error(`Instantly returned ${response.status}`);
  return response.json().catch(() => ({}));
}

function vcodeStatus(value) {
  return value === 1 ? 'interested' : value === -1 ? 'not_interested' : null;
}

// Native SMTP email sender for sending real emails
function sendSmtpEmail({ host, port, user, pass, from, to, subject, text, html }) {
  return new Promise((resolve, reject) => {
    if (!host || !user || !pass) {
      console.log(`[Email Dispatcher] SMTP not configured in .env. Logged notification for ${to}: "${subject}"`);
      return resolve({ simulated: true });
    }

    const isSecure = Number(port) === 465;
    const socket = isSecure
      ? tls.connect(Number(port), host, { rejectUnauthorized: false })
      : net.connect(Number(port), host);

    let stage = 0;
    let authStage = 0;

    socket.setTimeout(12000, () => {
      socket.destroy(new Error('SMTP connection timed out'));
    });

    socket.on('error', err => reject(err));

    socket.on('data', data => {
      const msg = data.toString();
      const code = parseInt(msg.slice(0, 3), 10);

      if (code >= 400 && code !== 535) {
        socket.destroy();
        return reject(new Error(`SMTP error: ${msg.trim()}`));
      }

      if (stage === 0 && code === 220) {
        socket.write(`EHLO ${host}\r\n`);
        stage = 1;
      } else if (stage === 1 && code === 250) {
        socket.write('AUTH LOGIN\r\n');
        stage = 2;
      } else if (stage === 2 && code === 334) {
        if (authStage === 0) {
          socket.write(Buffer.from(user).toString('base64') + '\r\n');
          authStage = 1;
        } else if (authStage === 1) {
          socket.write(Buffer.from(pass).toString('base64') + '\r\n');
          authStage = 2;
          stage = 3;
        }
      } else if (stage === 3 && code === 235) {
        const fromEmail = from.includes('<') ? from.match(/<([^>]+)>/)[1] : from;
        socket.write(`MAIL FROM:<${fromEmail}>\r\n`);
        stage = 4;
      } else if (stage === 4 && code === 250) {
        socket.write(`RCPT TO:<${to}>\r\n`);
        stage = 5;
      } else if (stage === 5 && code === 250) {
        socket.write('DATA\r\n');
        stage = 6;
      } else if (stage === 6 && code === 354) {
        const boundary = '----=_Part_' + crypto.randomUUID();
        const headers = [
          `From: ${from}`,
          `To: ${to}`,
          `Subject: ${subject}`,
          'MIME-Version: 1.0',
          `Content-Type: multipart/alternative; boundary="${boundary}"`,
          `Date: ${new Date().toUTCString()}`,
          '\r\n'
        ].join('\r\n');

        const body = [
          `--${boundary}`,
          'Content-Type: text/plain; charset=UTF-8',
          '\r\n',
          text || '',
          '\r\n',
          `--${boundary}`,
          'Content-Type: text/html; charset=UTF-8',
          '\r\n',
          html || `<p>${(text || '').replace(/\n/g, '<br>')}</p>`,
          '\r\n',
          `--${boundary}--`,
          '\r\n.\r\n'
        ].join('\r\n');

        socket.write(headers + body);
        stage = 7;
      } else if (stage === 7 && code === 250) {
        socket.write('QUIT\r\n');
        stage = 8;
        resolve({ success: true });
      }
    });
  });
}

// Dispatches real email alerts to all subscribed team emails when an 'interested' lead is identified
async function notifyTeamOnInterested(data, lead) {
  const subscribers = (data.teamSubscribers || []).filter(Boolean);
  if (!subscribers.length) return;

  const leadName = lead.name || lead.company || lead.email;
  const subject = `🔥 Hot Lead Alert: ${leadName} is Interested!`;
  const text = `Great news! A lead has responded with interest in VCode web & software services.

Lead Information:
• Name: ${lead.name || '—'}
• Company: ${lead.company || '—'}
• Email: ${lead.email}
• Phone: ${lead.phone || '—'}
• Notes: ${lead.notes || '—'}
• Status: Interested

Open VCode Workspace to view conversation:
${process.env.PUBLIC_URL || 'http://localhost:3000'}/#emails

Best regards,
VCode Lead Automation System
`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8f9fa; margin: 0; padding: 30px 10px;">
      <div style="max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
        <div style="background: #111217; padding: 20px 24px; color: #ffffff; display: flex; align-items: center; justify-content: space-between;">
          <span style="font-size: 18px; font-weight: 800; letter-spacing: -0.5px;"><span style="color: #ef4444; font-family: monospace; font-weight: 700; margin-right: 6px;">&lt;/&gt;</span>VCode Leads</span>
          <span style="background: rgba(16,185,129,0.2); color: #34d399; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 12px; text-transform: uppercase;">Interested</span>
        </div>
        <div style="padding: 28px 24px;">
          <h2 style="margin: 0 0 8px; font-size: 20px; color: #0f172a;">🎉 New Interested Lead!</h2>
          <p style="margin: 0 0 20px; color: #64748b; font-size: 14px;">A prospect replied with interest to your outreach campaign.</p>
          
          <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 24px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
            <tr>
              <td style="padding: 10px 14px; color: #64748b; font-weight: 600; width: 90px; border-bottom: 1px solid #e2e8f0;">Name</td>
              <td style="padding: 10px 14px; color: #0f172a; font-weight: 700; border-bottom: 1px solid #e2e8f0;">${lead.name || '—'}</td>
            </tr>
            <tr>
              <td style="padding: 10px 14px; color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Company</td>
              <td style="padding: 10px 14px; color: #0f172a; border-bottom: 1px solid #e2e8f0;">${lead.company || '—'}</td>
            </tr>
            <tr>
              <td style="padding: 10px 14px; color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Email</td>
              <td style="padding: 10px 14px; color: #2563eb; font-weight: 600; border-bottom: 1px solid #e2e8f0;"><a href="mailto:${lead.email}" style="color: #2563eb; text-decoration: none;">${lead.email}</a></td>
            </tr>
            <tr>
              <td style="padding: 10px 14px; color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Phone</td>
              <td style="padding: 10px 14px; color: #0f172a; border-bottom: 1px solid #e2e8f0;">${lead.phone || '—'}</td>
            </tr>
            <tr>
              <td style="padding: 10px 14px; color: #64748b; font-weight: 600;">Notes</td>
              <td style="padding: 10px 14px; color: #334155;">${lead.notes || '—'}</td>
            </tr>
          </table>

          <div style="text-align: center; margin-top: 24px;">
            <a href="${process.env.PUBLIC_URL || 'http://localhost:3000'}/#emails" style="display: inline-block; background: #0f172a; color: #ffffff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 14px;">Open in VCode Workspace →</a>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  for (const subscriber of subscribers) {
    try {
      await sendSmtpEmail({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT || 465,
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
        from: process.env.SMTP_FROM || `VCode Alerts <${process.env.SMTP_USER || 'alerts@vcode.com'}>`,
        to: subscriber,
        subject,
        text,
        html
      });
      addActivity(data, { type: 'real_email_sent', email: lead.email, to: subscriber, text: `Real email alert dispatched to ${subscriber}` });
    } catch (err) {
      console.error(`Failed to send email alert to ${subscriber}:`, err.message);
      addActivity(data, { type: 'email_error', email: lead.email, to: subscriber, text: `Email alert failed for ${subscriber}: ${err.message}` });
    }
  }
}

async function syncInstantly(data) {
  let cursor;
  let page = 0;
  let imported = 0;
  let changed = 0;
  
  do {
    const result = await instantly('/leads/list', 'POST', { limit: 100, starting_after: cursor });
    const items = result.items || [];
    for (const remote of items) {
      const status = vcodeStatus(remote.lt_interest_status);
      if (!status || !remote.email) continue;
      const existing = data.outreach.find(x => x.email?.toLowerCase() === remote.email.toLowerCase());
      const response = upsertOutreach(data, remote);
      if (!existing) imported++;
      if (!existing || existing.status !== status) {
        changed++;
        addActivity(data, { type: 'instantly_sync', email: response.email, status, text: `Instantly marked ${status.replace('_', ' ')}` });
        if (status === 'interested') {
          notifyTeamOnInterested(data, response);
        }
      }
    }
    cursor = result.next_starting_after;
    page++;
    if (items.length < 100) break;
  } while (cursor && page < 10);

  addActivity(data, { type: 'sync_complete', text: `Instantly sync complete: ${imported} imported, ${changed} status changes` });
  return { imported, changed, pages: page };
}

async function syncEmails(data) {
  const result = await instantly('/emails', 'GET');
  const existing = new Map((data.emails || []).map(email => [email.id, email]));
  for (const email of result.items || []) {
    existing.set(email.id, {
      id: email.id,
      from: email.from_address_email || '',
      to: email.to_address_email_list || '',
      subject: email.subject || '(No subject)',
      text: email.body?.text || email.body?.html || '',
      html: email.body?.html || '',
      receivedAt: email.timestamp_email || email.timestamp_created || new Date().toISOString(),
      replyTo: email.id,
      eaccount: email.eaccount || ''
    });
  }
  data.emails = [...existing.values()].sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt)).slice(0, 100);
  addActivity(data, { type: 'emails_synced', text: `${result.items?.length || 0} email message(s) checked` });
  return { fetched: result.items?.length || 0, stored: data.emails.length };
}

function publicFile(url) {
  const file = url === '/' ? 'index.html' : url.replace(/^\//, '');
  const full = path.resolve(root, 'public', file);
  return full.startsWith(path.join(root, 'public')) ? full : null;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    // 1. Activation Verification Endpoint (Publicly accessible)
    if (req.method === 'POST' && url.pathname === '/api/auth/verify') {
      const input = await body(req);
      const configuredKey = process.env.APP_ACTIVATION_KEY;
      if (!configuredKey || input.activationKey === configuredKey) {
        const token = generateSessionToken();
        return send(res, 200, { success: true, token });
      }
      return send(res, 401, { error: 'Invalid activation key. Please contact your team admin.' });
    }

    // 2. Webhooks (Public with optional secret check)
    if (req.method === 'POST' && url.pathname === '/api/webhooks/instantly') {
      if (process.env.WEBHOOK_SECRET && url.searchParams.get('secret') !== process.env.WEBHOOK_SECRET) {
        return send(res, 401, { error: 'Unauthorized' });
      }
      const event = await body(req);
      const data = readData();
      const email = event.lead_email;
      const statuses = { lead_interested: 'interested', lead_not_interested: 'not_interested' };
      const status = statuses[event.event_type];
      const lead = upsertLead(data, email, status ? { status } : {});
      addActivity(data, {
        type: event.event_type || 'webhook',
        email,
        status: lead?.status,
        reply: event.reply_text || event.reply_text_snippet || '',
        replyTo: event.email_id || '',
        campaign: event.campaign_name || ''
      });
      if (status === 'interested' && lead) {
        notifyTeamOnInterested(data, lead);
      }
      writeData(data);
      return send(res, 200, { received: true });
    }

    // 3. Static Files (Public)
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      const full = publicFile(url.pathname);
      if (full && fs.existsSync(full) && fs.statSync(full).isFile()) {
        const ext = path.extname(full);
        const types = {
          '.html': 'text/html; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.js': 'application/javascript; charset=utf-8',
          '.svg': 'image/svg+xml',
          '.gif': 'image/gif',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.webp': 'image/webp'
        };
        return send(res, 200, fs.readFileSync(full), types[ext] || 'application/octet-stream');
      }
      return send(res, 404, { error: 'Not found' });
    }

    // 4. API Endpoints (Protected by Activation Key / Token)
    if (url.pathname.startsWith('/api/')) {
      if (!verifyAuth(req)) {
        return send(res, 401, { error: 'Unauthorized. Activation key required.' });
      }

      if (req.method === 'GET' && url.pathname === '/api/state') {
        const data = readData();
        return send(res, 200, {
          ...data,
          leads: data.leads.filter(x => x.origin !== 'instantly' && !x.instantlyId)
        });
      }

      // Team Email Subscribers
      if (req.method === 'GET' && url.pathname === '/api/notifications/subscribers') {
        const data = readData();
        return send(res, 200, { subscribers: data.teamSubscribers || [] });
      }

      if (req.method === 'POST' && url.pathname === '/api/notifications/subscribers') {
        const input = await body(req);
        const data = readData();
        const email = String(input.email || '').trim().toLowerCase();
        if (!email || !email.includes('@')) return send(res, 422, { error: 'Valid email required.' });
        data.teamSubscribers = data.teamSubscribers || [];
        if (!data.teamSubscribers.includes(email)) {
          data.teamSubscribers.push(email);
          addActivity(data, { type: 'subscriber_added', email, text: `Team member ${email} subscribed to interested alerts` });
          writeData(data);
        }
        return send(res, 200, { subscribers: data.teamSubscribers });
      }

      if (req.method === 'DELETE' && url.pathname === '/api/notifications/subscribers') {
        const input = await body(req);
        const data = readData();
        const email = String(input.email || '').trim().toLowerCase();
        data.teamSubscribers = (data.teamSubscribers || []).filter(x => x !== email);
        addActivity(data, { type: 'subscriber_removed', email, text: `Team member ${email} unsubscribed` });
        writeData(data);
        return send(res, 200, { subscribers: data.teamSubscribers });
      }

      if (req.method === 'POST' && url.pathname === '/api/leads') {
        const input = await body(req);
        const data = readData();
        if (!input.email) return send(res, 422, { error: 'Email is required.' });
        const lead = upsertLead(data, input.email, input);
        addActivity(data, { type: 'lead_added', email: lead.email, text: 'Lead added manually' });
        if (lead.status === 'interested') {
          notifyTeamOnInterested(data, lead);
        }
        writeData(data);
        return send(res, 201, lead);
      }

      if (req.method === 'DELETE' && url.pathname === '/api/leads') {
        const input = await body(req);
        const data = readData();
        const ids = new Set(input.ids || []);
        data.leads = data.leads.filter(x => !ids.has(x.id));
        writeData(data);
        return send(res, 200, { deleted: ids.size });
      }

      if (req.method === 'POST' && url.pathname === '/api/instantly/sync') {
        if (!process.env.INSTANTLY_API_KEY) return send(res, 503, { error: 'Set INSTANTLY_API_KEY on the server first.' });
        const data = readData();
        const result = await syncInstantly(data);
        writeData(data);
        return send(res, 200, result);
      }

      if (req.method === 'POST' && url.pathname === '/api/instantly/emails/sync') {
        if (!process.env.INSTANTLY_API_KEY) return send(res, 503, { error: 'Set INSTANTLY_API_KEY on the server first.' });
        const data = readData();
        const result = await syncEmails(data);
        writeData(data);
        return send(res, 200, result);
      }

      if (req.method === 'GET' && url.pathname.startsWith('/api/outreach/') && url.pathname.endsWith('/emails')) {
        const id = decodeURIComponent(url.pathname.split('/')[3]);
        const data = readData();
        const response = data.outreach.find(x => x.id === id);
        if (!response) return send(res, 404, { error: 'Email response not found.' });
        const result = await instantly(`/emails?lead=${encodeURIComponent(response.email)}&limit=100`, 'GET');
        const messages = (result.items || [])
          .filter(email => email.from_address_email && email.from_address_email !== email.eaccount && !email.is_auto_reply)
          .sort((a, b) => new Date(a.timestamp_email || a.timestamp_created) - new Date(b.timestamp_email || b.timestamp_created))
          .map(email => ({
            id: email.id,
            from: email.from_address_email || '',
            to: email.to_address_email_list || '',
            subject: email.subject || '(No subject)',
            text: email.body?.text || email.body?.html || '',
            receivedAt: email.timestamp_email || email.timestamp_created,
            threadId: email.thread_id || ''
          }));
        return send(res, 200, { response, messages: messages.slice(0, 1) });
      }

      if (req.method === 'PATCH' && url.pathname.startsWith('/api/leads/')) {
        const id = decodeURIComponent(url.pathname.split('/').pop());
        const input = await body(req);
        const data = readData();
        const lead = data.leads.find(x => x.id === id);
        if (!lead) return send(res, 404, { error: 'Lead not found.' });
        const prevStatus = lead.status;
        Object.assign(lead, input, { updatedAt: new Date().toISOString() });
        addActivity(data, { type: 'status_changed', email: lead.email, status: lead.status, text: `Marked ${lead.status}` });
        if (lead.status === 'interested' && prevStatus !== 'interested') {
          notifyTeamOnInterested(data, lead);
        }
        writeData(data);
        return send(res, 200, lead);
      }

      if (req.method === 'POST' && url.pathname === '/api/reply') {
        const input = await body(req);
        if (!input.reply_to_uuid || !input.body) return send(res, 422, { error: 'reply_to_uuid and body are required.' });
        const result = await instantly('/emails/reply', 'POST', { reply_to_uuid: input.reply_to_uuid, body: input.body });
        return send(res, 200, result);
      }
    }

    send(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    send(res, 500, { error: error.message || 'Server error' });
  }
}).listen(port, () => console.log(`VCode Leads running on http://localhost:${port}`));
