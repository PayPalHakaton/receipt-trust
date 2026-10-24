// Receipt Trust — AI-verified receipts for charity fundraisers + PayPal Sandbox donations.
// Fictional organisation and data. PayPal runs in SANDBOX only (test money).
try { process.loadEnvFile('.env'); } catch (_) { /* .env is optional */ }

const path = require('path');

const PORT = process.env.PORT || 3000;
const PP_BASE = 'https://api-m.sandbox.paypal.com';
const PP_ID = process.env.PAYPAL_CLIENT_ID || '';
const PP_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';
const AI_KEY = process.env.ANTHROPIC_API_KEY || '';
const AI_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

// ---------- in-memory demo data (fictional) ----------
const campaign = {
  id: 'winter-warmth',
  org: 'Hope Harbor (fictional demo charity)',
  title: 'Warm Winter for 40 Families',
  goal: 2000,
  currency: 'USD',
  // The AI checks every receipt against what this fundraiser promised to buy.
  allowedCategories: ['food', 'clothing', 'blankets', 'heating', 'medicine', 'hygiene'],
};
const receipts = [];
const donations = [];

const money = (n) => Math.round(n * 100) / 100;
const summary = () => {
  const raised = money(donations.reduce((s, d) => s + d.amount, 0));
  const verified = money(receipts.filter(r => r.status === 'verified').reduce((s, r) => s + r.total, 0));
  const flagged = receipts.filter(r => r.status === 'flagged').length;
  return { campaign, raised, verifiedSpent: verified, flaggedCount: flagged, receipts, donations };
};

// ---------- AI receipt reading ----------
const PROMPT = `You are an auditor for a charity. Read this shop receipt image and answer with ONLY a JSON object:
{"merchant":string,"date":"YYYY-MM-DD","currency":string,"total":number,
 "items":[{"name":string,"qty":number,"price":number,"category":"food|clothing|blankets|heating|medicine|hygiene|other"}],
 "readable":boolean,"notes":string}
Categorise each item. If the image is not a receipt or is unreadable set "readable" to false.`;

async function parseWithClaude(base64, mediaType) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': AI_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 1200,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: PROMPT },
      ] }],
    }),
  });
  if (!r.ok) throw new Error('AI error ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const data = await r.json();
  const text = data.content.map(c => c.text || '').join('');
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(json);
}

// Used when no API key is set so judges can still run the whole flow.
function demoParse(variant) {
  const good = {
    merchant: 'Green Market (demo)', date: '2026-10-20', currency: 'USD', total: 68.4, readable: true,
    notes: 'Demo parser: no AI key configured.',
    items: [
      { name: 'Wool blankets x4', qty: 4, price: 12.5, category: 'blankets' },
      { name: 'Canned soup x12', qty: 12, price: 1.2, category: 'food' },
      { name: 'Soap', qty: 5, price: 0.8, category: 'hygiene' },
    ],
  };
  const bad = {
    merchant: 'Night Lounge (demo)', date: '2026-10-21', currency: 'USD', total: 48.0, readable: true,
    notes: 'Demo parser: no AI key configured.',
    items: [{ name: 'Cocktails x6', qty: 6, price: 8, category: 'other' }],
  };
  return variant === 'bad' ? bad : good;
}

// Compare the receipt with the promise made to donors.
function audit(parsed) {
  const reasons = [];
  if (!parsed.readable) reasons.push('Receipt is not readable');
  const sum = money((parsed.items || []).reduce((s, i) => s + i.qty * i.price, 0));
  if (parsed.readable && Math.abs(sum - parsed.total) > 0.5)
    reasons.push(`Items add up to ${sum}, but receipt total is ${parsed.total}`);
  const off = (parsed.items || []).filter(i => !campaign.allowedCategories.includes(i.category));
  if (off.length) reasons.push('Outside fundraiser purpose: ' + off.map(i => i.name).join(', '));
  const dup = receipts.find(r => r.merchant === parsed.merchant && r.date === parsed.date && r.total === parsed.total);
  if (dup) reasons.push('Possible duplicate of an earlier receipt');
  return { status: reasons.length ? 'flagged' : 'verified', reasons };
}

// ---------- PayPal Sandbox ----------
async function ppToken() {
  const r = await fetch(PP_BASE + '/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(PP_ID + ':' + PP_SECRET).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error('PayPal auth failed: ' + r.status);
  return (await r.json()).access_token;
}

// ---------- app (zero dependencies: plain Node http) ----------
const http = require('http');
const fs = require('fs');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

const readBody = (req) => new Promise((resolve, reject) => {
  let n = 0; const chunks = [];
  req.on('data', c => { n += c.length; if (n > 12e6) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch (e) { reject(e); } });
  req.on('error', reject);
});
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

const routes = {
  'GET /api/config': async () => [200, { paypalClientId: PP_ID, paypalReady: !!(PP_ID && PP_SECRET), aiReady: !!AI_KEY }],
  'GET /api/summary': async () => [200, summary()],

  'POST /api/receipts': async (body) => {
    const { image, mediaType, volunteer, demoVariant } = body;
    const useAI = !!(AI_KEY && image);
    const parsed = useAI ? await parseWithClaude(image, mediaType || 'image/jpeg') : demoParse(demoVariant);
    const { status, reasons } = audit(parsed);
    const rec = { id: receipts.length + 1, volunteer: volunteer || 'Volunteer', ...parsed, status, reasons,
      source: useAI ? 'ai' : 'demo', createdAt: new Date().toISOString() };
    receipts.unshift(rec);
    return [200, rec];
  },

  'POST /api/paypal/create-order': async (body) => {
    const amount = money(Number(body.amount));
    if (!(amount >= 1 && amount <= 1000)) return [400, { error: 'Amount must be 1-1000' }];
    const token = await ppToken();
    const r = await fetch(PP_BASE + '/v2/checkout/orders', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: 'CAPTURE', purchase_units: [{
        description: campaign.title, custom_id: campaign.id,
        amount: { currency_code: campaign.currency, value: amount.toFixed(2) } }] }),
    });
    return [r.status, await r.json()];
  },

  'POST /api/paypal/capture-order': async (body) => {
    const token = await ppToken();
    const r = await fetch(`${PP_BASE}/v2/checkout/orders/${encodeURIComponent(body.orderID)}/capture`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
    const data = await r.json();
    const cap = data?.purchase_units?.[0]?.payments?.captures?.[0];
    if (r.ok && cap && cap.status === 'COMPLETED') {
      donations.unshift({ id: cap.id, amount: Number(cap.amount.value), donor: data.payer?.name?.given_name || 'Anonymous',
        at: new Date().toISOString() });
    }
    return [r.status, data];
  },

  // Demo helper: only works when PayPal credentials are NOT configured.
  'POST /api/demo-donation': async (body) => {
    if (PP_ID && PP_SECRET) return [403, { error: 'PayPal is configured; use PayPal.' }];
    donations.unshift({ id: 'DEMO-' + Date.now(), amount: money(Number(body.amount) || 10), donor: 'Demo donor', at: new Date().toISOString() });
    return [200, { ok: true }];
  },
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const handler = routes[req.method + ' ' + url.pathname];
  if (handler) {
    try { const [code, obj] = await handler(req.method === 'POST' ? await readBody(req) : {}); send(res, code, obj); }
    catch (e) { send(res, 500, { error: e.message }); }
    return;
  }
  // static files
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.join(__dirname, 'public', rel);
  if (!file.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Receipt Trust on http://localhost:${PORT}  (PayPal: ${PP_ID ? 'sandbox' : 'off'}, AI: ${AI_KEY ? 'on' : 'demo'})`));
