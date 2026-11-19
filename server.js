/* ============================================================
   ARC+ Gateway — server
   - The dashboard is OPEN: anyone can see the tools and press "Open App".
   - Gateway users (admins) sign in to approve ACCESS REQUESTS, manage users and see live alerts.
   - Payroll / Inventory send "Request access" here (server to server, signed with SSO_SECRET);
     admins are notified live (Server-Sent Events); when one approves, the tool lets the person in.

   Environment variables (Railway):
     DATABASE_URL    Postgres (users + access requests)
     ADMIN_USER      first Super Admin email/username   (APP_USER also works; only used when there are no users yet)
     ADMIN_PASSWORD  first Super Admin password, 8+ chars (APP_PASSWORD also works)
     SESSION_SECRET  random string that signs the Gateway session cookie
     SSO_SECRET      random string shared with Payroll + Inventory
     APPROVER_KEY    secret for the private approver link  /approver?key=...  (open it once per device to approve requests)
     ACCESS_HOURS    how long an approved request lasts (default 12)
   ============================================================ */
const express = require('express');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const { promisify } = require('util');
const { Pool } = require('pg');
const scrypt = promisify(crypto.scrypt);

// The first Super Admin can come from ADMIN_USER / ADMIN_PASSWORD, or from APP_USER / APP_PASSWORD.
if (!process.env.ADMIN_USER && process.env.APP_USER) process.env.ADMIN_USER = process.env.APP_USER;
if (!process.env.ADMIN_PASSWORD && process.env.APP_PASSWORD) process.env.ADMIN_PASSWORD = process.env.APP_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.SSO_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET && !process.env.SSO_SECRET) console.warn('No SESSION_SECRET set — admin sessions reset on every restart.');
const SSO_SECRET = process.env.SSO_SECRET || '';
const ACCESS_HOURS = Math.min(Math.max(parseInt(process.env.ACCESS_HOURS, 10) || 12, 1), 24 * 30);
const SESSION_MS = 12 * 3600 * 1000;
const COOKIE = 'gw_session';
// Private approver link: /approver?key=APPROVER_KEY sets a cookie on that device so it can approve access requests (no username/password).
const APPROVER_COOKIE = 'gw_approver';
const APPROVER_KEY = process.env.APPROVER_KEY || '';
const APPROVER_MS = 180 * 24 * 3600 * 1000;
const APPROVER_USER = { id: -2, username: 'approver', display_name: 'Super Admin', role: 'approver', tools: ['*'], active: true };

/* ---------- tools (shared with the front end) ---------- */
function loadTools() {
  try { return vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'tools.js'), 'utf8') + '\n;GATEWAY_TOOLS'); }
  catch (e) { console.error('Could not read tools.js:', e.message); return []; }
}
const toolName = id => (loadTools().find(t => t.id === id) || { name: id }).name;

/* ---------- signing helpers ---------- */
const b64u = b => Buffer.from(b).toString('base64url');
function sign(payload, secret) {
  const body = b64u(JSON.stringify(payload));
  return body + '.' + crypto.createHmac('sha256', secret).update(body).digest('base64url');
}
function verify(token, secret) {
  if (typeof token !== 'string' || !secret) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const want = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch (e) { return null; }
}
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
async function hashPw(pw) { const salt = crypto.randomBytes(16).toString('hex'); const h = (await scrypt(pw, salt, 64)).toString('hex'); return `scrypt$${salt}$${h}`; }
async function checkPw(pw, stored) {
  const [alg, salt, h] = String(stored).split('$'); if (alg !== 'scrypt' || !salt || !h) return false;
  const got = await scrypt(pw, salt, 64), want = Buffer.from(h, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
const parseCookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim()).filter(Boolean).map(s => { const i = s.indexOf('='); return [s.slice(0, i), decodeURIComponent(s.slice(i + 1))]; }));
function setCookie(req, res, name, value, maxAgeMs) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.secure;
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure ? '; Secure' : ''}`);
}

/* ---------- database ---------- */
const pool = process.env.DATABASE_URL ? (() => {
  let ssl = false;
  try { const h = new URL(process.env.DATABASE_URL).hostname; if (!/\.railway\.internal$|^localhost$|^127\.0\.0\.1$/.test(h)) ssl = { rejectUnauthorized: false }; } catch (e) { ssl = { rejectUnauthorized: false }; }
  return new Pool({ connectionString: process.env.DATABASE_URL, ssl, max: 5, idleTimeoutMillis: 30000 });
})() : null;
let dbReady = false;
// Settings an approver can change on the Gateway's Settings page (saved in Postgres)
const SETTINGS = { acceptRequests: true, defaultHours: [1, 12, 24, 168].includes(ACCESS_HOURS) ? ACCESS_HOURS : 12 };
async function initDb() {
  if (!pool) { console.warn('No DATABASE_URL — users and access requests need a database.'); return; }
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS gw_users(
      id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', tools JSONB NOT NULL DEFAULT '[]',
      active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS gw_access(
      id TEXT PRIMARY KEY, tool TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', key_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), decided_at TIMESTAMPTZ, decided_by TEXT, expires_at TIMESTAMPTZ)`);
    await pool.query('CREATE TABLE IF NOT EXISTS gw_settings(key TEXT PRIMARY KEY, value JSONB NOT NULL)');
    await pool.query(`CREATE TABLE IF NOT EXISTS gw_log(
      id SERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT now(), action TEXT NOT NULL, actor TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '', tool TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '')`);
    await pool.query(`CREATE TABLE IF NOT EXISTS gw_resets(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TIMESTAMPTZ NOT NULL, ip TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    try { for (const r of (await pool.query('SELECT key, value FROM gw_settings')).rows) SETTINGS[r.key] = typeof r.value === 'string' ? JSON.parse(r.value) : r.value; } catch (e) { console.error('settings load failed:', e.message); }
    const n = (await pool.query('SELECT count(*)::int AS n FROM gw_users')).rows[0].n;
    if (!n && process.env.ADMIN_USER && process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length >= 8) {
      await pool.query('INSERT INTO gw_users(username, display_name, password_hash, role, tools) VALUES($1,$2,$3,$4,$5)',
        [process.env.ADMIN_USER.toLowerCase(), 'Super Admin', await hashPw(process.env.ADMIN_PASSWORD), 'admin', JSON.stringify(['*'])]);
      console.log('Created first Super Admin "' + process.env.ADMIN_USER.toLowerCase() + '".');
    } else if (!n) console.warn('No Gateway users yet — set ADMIN_USER and ADMIN_PASSWORD (8+ chars) so someone can approve access requests.');
    dbReady = true; console.log('PostgreSQL connected — gw_users, gw_access ready.');
  } catch (e) { dbReady = false; console.error('DB init failed:', e.message); setTimeout(initDb, 5000); }
}
initDb();
/* ---------- activity log: who did what, when, from which IP ---------- */
async function audit(action, o = {}) {
  if (!pool || !dbReady) return;
  try {
    await pool.query('INSERT INTO gw_log(action, actor, email, tool, ip, detail) VALUES($1,$2,$3,$4,$5,$6)', [action, clean(o.actor, 80), clean(o.email, 120), clean(o.tool, 40), clean(o.ip, 64), clean(o.detail, 300)]);
    if (Math.random() < 0.02) await pool.query("DELETE FROM gw_log WHERE ts < now() - interval '365 days'");
  } catch (e) { console.error('audit failed:', e.message); }
}
const pub = u => ({ id: u.id, username: u.username, name: u.display_name || u.username, role: u.role, tools: u.tools, active: u.active, created_at: u.created_at });
async function findUser(username) {
  if (pool && dbReady) return (await pool.query('SELECT * FROM gw_users WHERE username = $1', [String(username).toLowerCase()])).rows[0] || null;
  return null;
}
/* no database: allow only the env admin so the portal itself is never unreachable */
async function envAdmin(username, password) {
  if (!process.env.ADMIN_USER || !process.env.ADMIN_PASSWORD) return null;
  const okU = username.toLowerCase() === process.env.ADMIN_USER.toLowerCase();
  const a = Buffer.from(password), b = Buffer.from(process.env.ADMIN_PASSWORD);
  const okP = a.length === b.length && crypto.timingSafeEqual(a, b);
  return okU && okP ? { id: 0, username: process.env.ADMIN_USER.toLowerCase(), display_name: 'Super Admin', role: 'admin', tools: ['*'], active: true } : null;
}

/* ---------- live events to signed-in admins (Server-Sent Events) ---------- */
const sseClients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of sseClients) { try { c.write(msg); } catch (e) { sseClients.delete(c); } }
}
setInterval(() => { for (const c of sseClients) { try { c.write(': ping\n\n'); } catch (e) { sseClients.delete(c); } } }, 25000).unref();

/* ---------- app ---------- */
const app = express();
// Express 4 does not catch errors thrown inside async handlers: forward them to the error handler instead of hanging.
for (const m of ['get', 'post', 'put', 'delete']) {
  const orig = app[m].bind(app);
  app[m] = (p, ...h) => orig(p, ...h.map(f => typeof f === 'function' && f.constructor.name === 'AsyncFunction' ? (req, res, next) => f(req, res, next).catch(next) : f));
}
app.set('trust proxy', true);
app.use(express.json({ limit: '100kb' }));

const tries = new Map();                                   // naive login rate limit: 10 failures / 10 min / IP
const limited = ip => { const t = tries.get(ip); return t && t.n >= 10 && Date.now() - t.ts < 600000; };
const fail = ip => { const t = tries.get(ip); if (!t || Date.now() - t.ts >= 600000) tries.set(ip, { n: 1, ts: Date.now() }); else t.n++; };

app.get('/api/health', (req, res) => res.json({ ok: true, db: dbReady }));

async function sessionUser(req) {
  const ck = parseCookies(req);
  const s = verify(ck[COOKIE], SESSION_SECRET);
  if (!s) {                                           // not a signed-in admin: maybe an approver device?
    const a = APPROVER_KEY ? verify(ck[APPROVER_COOKIE], SESSION_SECRET) : null;
    return a && a.r === 'approver' && a.k === sha(APPROVER_KEY).slice(0, 16) ? APPROVER_USER : null;   // changing APPROVER_KEY signs out every approver device
  }
  if (s.id === 0) {                                   // env-admin fallback session (database not connected)
    return !dbReady && process.env.ADMIN_USER && s.u === process.env.ADMIN_USER.toLowerCase()
      ? { id: 0, username: s.u, display_name: 'Super Admin', role: 'admin', tools: ['*'], active: true } : null;
  }
  const u = await findUser(s.u); return u && u.active ? u : null;
}
// everyone can reach the dashboard; if a valid admin session cookie is present we know who it is
/* SIGN-IN (default): visitors see the tools; approvers and admins sign in (/login) or use the private approver link.
   OPEN MODE (opt-in): set GATEWAY_OPEN=1 on the Gateway service and every visitor acts as the approver, no sign-in. */
const OPEN = process.env.GATEWAY_OPEN === '1';
app.use(async (req, res, next) => { try { req.user = await sessionUser(req); } catch (e) { req.user = null; } if (!req.user && OPEN) req.user = { ...APPROVER_USER, open: true }; next(); });

app.post('/api/login', async (req, res) => {
  const ip = req.ip, { username, password } = req.body || {};
  if (limited(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) return res.status(400).json({ error: 'Enter your username and password.' });
  try {
    let u = await findUser(username);
    if (u) { if (!u.active || !(await checkPw(password, u.password_hash))) u = null; }
    else if (!dbReady) u = await envAdmin(username, password);
    else await scrypt(password, 'x', 64);                                // keep timing similar for unknown users
    if (!u) { fail(ip); audit('gateway.signin_failed', { actor: 'unknown', email: username, ip: req.ip }); return res.status(401).json({ error: 'Wrong username or password.' }); }
    tries.delete(ip);
    audit('gateway.signin', { actor: u.display_name || u.username, email: u.username, ip: req.ip });
    setCookie(req, res, COOKIE, sign({ id: u.id, u: u.username, exp: Date.now() + SESSION_MS }, SESSION_SECRET), SESSION_MS);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Sign-in failed. Try again.' }); }
});
app.post('/api/logout', (req, res) => { setCookie(req, res, COOKIE, '', 0); setCookie(req, res, APPROVER_COOKIE, '', 0); res.json({ ok: true }); });
const badLink = new Map();
app.get('/approver', (req, res) => {
  if (OPEN) return res.redirect('/requests');
  const a = Buffer.from(sha(String(req.query.key || ''))), b = Buffer.from(sha(APPROVER_KEY));
  if (!APPROVER_KEY || !crypto.timingSafeEqual(a, b)) {
    const last = badLink.get(req.ip) || 0;                                  // log failed attempts at most once a minute per IP
    if (Date.now() - last > 60000) { badLink.set(req.ip, Date.now()); audit('approver.link_failed', { actor: 'unknown', ip: req.ip, detail: 'wrong or missing key' }); }
    return res.status(404).send('Not found');
  }
  audit('approver.link_opened', { actor: 'Super Admin', ip: req.ip, detail: 'a device was set up to approve requests' });
  setCookie(req, res, APPROVER_COOKIE, sign({ r: 'approver', k: sha(APPROVER_KEY).slice(0, 16), exp: Date.now() + APPROVER_MS }, SESSION_SECRET), APPROVER_MS);
  res.redirect('/requests');
});
app.get(['/login', '/login.html'], (req, res) => res.sendFile(path.join(__dirname, 'login.html')));

const needUser = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Not signed in.' });
const admin = (req, res, next) => !req.user ? res.status(401).json({ error: 'Not signed in.' }) : req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Super Admin only.' });
const approver = (req, res, next) => !req.user ? res.status(401).json({ error: 'Not signed in.' }) : ['admin', 'approver'].includes(req.user.role) ? next() : res.status(403).json({ error: 'Approvers only.' });
const needDb = (req, res, next) => pool && dbReady ? next() : res.status(503).json({ error: 'The database is not connected.' });
const canOpen = (u, id) => !u || u.role === 'admin' || (u.tools || []).includes('*') || (u.tools || []).includes(id);

app.get('/api/me', async (req, res) => {
  const tools = loadTools().filter(t => canOpen(req.user, t.id)).map(t => t.id);
  if (!req.user) return res.json({ signedIn: false, role: 'guest', name: 'Guest', tools, dbReady });
  let pending = 0;
  if (['admin', 'approver'].includes(req.user.role) && pool && dbReady) { try { pending = (await pool.query("SELECT count(*)::int AS n FROM gw_access WHERE status = 'pending'")).rows[0].n; } catch (e) { } }
  res.json({ ...pub(req.user), signedIn: true, open: OPEN, tools, dbReady, pending });
});

app.get('/launch/:id', (req, res) => {
  const t = loadTools().find(x => x.id === req.params.id);
  if (!t || !t.url) return res.status(404).send('That tool is not available yet.');
  if (!canOpen(req.user, t.id)) return res.status(403).send('You do not have access to this tool.');
  const base = t.url.replace(/\/$/, '');
  if (!req.user || req.user.open || !SSO_SECRET) return res.redirect(base + '/');          // visitors go to the tool's own sign-in / Request access page
  const token = sign({ t: t.id, sub: req.user.username, name: req.user.display_name || req.user.username, ap: ['admin', 'approver'].includes(req.user.role), exp: Date.now() + 60000 }, SSO_SECRET);
  res.redirect(`${base}/sso?token=${encodeURIComponent(token)}`);       // signed-in Gateway users go straight in
});

app.post('/api/password', needUser, async (req, res) => {
  const { current, next } = req.body || {};
  if (!pool || !dbReady || req.user.id <= 0) return res.status(400).json({ error: 'Password changes need the database account.' });
  if (typeof next !== 'string' || next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  if (!(await checkPw(String(current || ''), req.user.password_hash))) return res.status(400).json({ error: 'Current password is wrong.' });
  await pool.query('UPDATE gw_users SET password_hash = $1 WHERE id = $2', [await hashPw(next), req.user.id]);
  audit('password.changed', { actor: req.user.display_name || req.user.username, email: req.user.username, ip: req.ip, detail: 'changed from Settings' });
  res.json({ ok: true });
});

/* =====================  FORGOT / RESET PASSWORD  =====================
   "Forgot password?" on the sign-in page emails a single-use link, valid 30 minutes, to the ARC email
   (RESET_EMAIL, default arcdesignconstructionservices@gmail.com) at once; opening it lets the owner of that
   account choose a new password. Needs SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS (same as Procurement).
   The link always points at GATEWAY_PUBLIC_URL, never at the Host header of the request. */
const RESET_TO = String(process.env.RESET_EMAIL || 'arcdesignconstructionservices@gmail.com').trim().toLowerCase();
const PUBLIC_URL = String(process.env.GATEWAY_PUBLIC_URL || 'https://gateway.arcdesignconstructions.com').replace(/\/$/, '');
const mailReady = () => !!process.env.SMTP_HOST;
async function sendMail(o) {
  const t = require('nodemailer').createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 587, secure: Number(process.env.SMTP_PORT) === 465, auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined });
  await t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, ...o });
}
const maskEmail = e => { const [n, d] = String(e).split('@'); return n.slice(0, 2) + '***@' + (d || ''); };
const forgotHits = new Map(); let forgotAll = [];
const resetTries = new Map();
app.post('/api/forgot', async (req, res) => {
  const ip = req.ip, now = Date.now();
  const mine = (forgotHits.get(ip) || []).filter(t => now - t < 900000);
  forgotAll = forgotAll.filter(t => now - t < 3600000);
  if (mine.length >= 3 || forgotAll.length >= 8) return res.status(429).json({ error: 'A reset link was just sent. Check the ARC email, or try again in a few minutes.' });
  if (!mailReady()) return res.status(501).json({ error: 'Email is not set up on the Gateway yet (SMTP settings are missing in Railway).' });
  if (!pool || !dbReady) return res.status(503).json({ error: 'The database is not connected.' });
  mine.push(now); forgotHits.set(ip, mine); forgotAll.push(now);
  try {
    const u = await findUser(RESET_TO);
    audit('password.reset_requested', { actor: 'unknown', email: RESET_TO, ip, detail: u && u.active ? 'reset link emailed' : 'no active account uses this email' });
    if (u && u.active) {
      const token = crypto.randomBytes(32).toString('hex');
      await pool.query('DELETE FROM gw_resets WHERE user_id = $1 OR expires_at < now()', [u.id]);
      await pool.query("INSERT INTO gw_resets(token_hash, user_id, expires_at, ip) VALUES($1, $2, now() + interval '30 minutes', $3)", [sha(token), u.id, ip]);
      const link = PUBLIC_URL + '/reset?token=' + token, when = new Date().toUTCString();
      await sendMail({
        to: RESET_TO, subject: 'ARC+ Gateway: request to change password',
        text: 'Someone asked to change the ARC+ Gateway password.\n\nRequested: ' + when + '\nFrom IP address: ' + ip + '\n\nTo choose a new password, open this link (it works once and expires in 30 minutes):\n' + link + '\n\nIf this was not you, ignore this email: nothing changes unless the link is used.',
        html: '<div style="font-family:Arial,sans-serif;font-size:14px;color:#14110d;max-width:520px"><h2 style="margin:0 0 12px">Change your ARC+ Gateway password</h2><p>Someone asked to change the ARC+ Gateway password.</p><p style="color:#6f685c;font-size:13px">Requested: ' + when + '<br>From IP address: ' + ip + '</p><p><a href="' + link + '" style="display:inline-block;background:#ffa203;color:#000;font-weight:bold;text-decoration:none;padding:11px 20px;border-radius:6px">Choose a new password</a></p><p style="color:#6f685c;font-size:13px">The link works once and expires in 30 minutes. If this was not you, ignore this email: nothing changes unless the link is used.</p></div>'
      });
    }
    res.json({ ok: true, to: maskEmail(RESET_TO) });
  } catch (e) { console.error('forgot failed:', e.message); res.status(502).json({ error: 'Could not send the email. Check the Gateway email settings.' }); }
});
const validReset = async token => {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token) || !pool || !dbReady) return null;
  const r = await pool.query('SELECT r.token_hash, r.user_id, u.username FROM gw_resets r JOIN gw_users u ON u.id = r.user_id WHERE r.token_hash = $1 AND r.expires_at > now() AND u.active', [sha(token)]);
  return r.rows[0] || null;
};
app.get('/api/reset/check', async (req, res) => { try { res.json({ valid: !!(await validReset(String(req.query.token || ''))) }); } catch (e) { res.json({ valid: false }); } });
app.post('/api/reset', async (req, res) => {
  const ip = req.ip, now = Date.now(), t = (resetTries.get(ip) || []).filter(x => now - x < 600000);
  if (t.length >= 10) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  t.push(now); resetTries.set(ip, t);
  const { token, password } = req.body || {};
  if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'The new password must be at least 8 characters.' });
  try {
    const r = await validReset(token);
    if (!r) return res.status(400).json({ error: 'This link has expired or was already used. Go back and choose "Forgot password?" again.' });
    await pool.query('UPDATE gw_users SET password_hash = $1 WHERE id = $2', [await hashPw(password), r.user_id]);
    await pool.query('DELETE FROM gw_resets WHERE user_id = $1', [r.user_id]);
    audit('password.reset_done', { actor: 'password reset link', email: r.username, ip, detail: 'password changed with the emailed link' });
    res.json({ ok: true });
  } catch (e) { console.error('reset failed:', e.message); res.status(500).json({ error: 'Could not change the password. Try again.' }); }
});

/* =====================  ACCESS REQUESTS  ===================== */
const accessPub = r => ({ id: r.id, tool: r.tool, toolName: toolName(r.tool), name: r.name, email: r.email, note: r.note, ip: r.ip, status: effStatus(r), created_at: r.created_at, decided_at: r.decided_at, decided_by: r.decided_by, expires_at: r.expires_at });
function effStatus(r) { return r.status === 'approved' && r.expires_at && new Date(r.expires_at).getTime() <= Date.now() ? 'expired' : r.status; }
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/* ---- tool -> Gateway (server to server; bearer token signed with SSO_SECRET, valid 60 s) ---- */
function toolAuth(req, res, next) {
  if (!SSO_SECRET) return res.status(503).json({ error: 'Access requests are not configured (SSO_SECRET).' });
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  const p = m && verify(m[1], SSO_SECRET);
  if (!p || !p.t || !loadTools().some(t => t.id === p.t)) return res.status(401).json({ error: 'Bad tool token.' });
  req.tool = p.t; next();
}
app.post('/api/tool/access', toolAuth, needDb, async (req, res) => {
  if (!SETTINGS.acceptRequests) return res.status(403).json({ error: 'Access requests are paused right now. Please contact an administrator.' });
  const b = req.body || {}, name = clean(b.name, 80), email = clean(b.email, 120).toLowerCase(), note = clean(b.note, 200), ip = clean(b.ip, 64);
  if (name.length < 2) return res.status(400).json({ error: 'Please enter your name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  const recent = (await pool.query("SELECT count(*)::int AS n FROM gw_access WHERE email = $1 AND created_at > now() - interval '1 hour'", [email])).rows[0].n;
  if (recent >= 5) return res.status(429).json({ error: 'Too many requests from this email. Please wait a while.' });
  const pend = (await pool.query("SELECT count(*)::int AS n FROM gw_access WHERE status = 'pending'")).rows[0].n;
  if (pend >= 100) return res.status(429).json({ error: 'The request queue is full. Please contact an administrator.' });
  await pool.query("UPDATE gw_access SET status = 'superseded' WHERE status = 'pending' AND tool = $1 AND email = $2", [req.tool, email]);
  const id = crypto.randomBytes(9).toString('hex'), key = crypto.randomBytes(24).toString('hex');
  const r = (await pool.query('INSERT INTO gw_access(id, tool, name, email, note, ip, key_hash) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *', [id, req.tool, name, email, note, ip, sha(key)])).rows[0];
  broadcast('request', accessPub(r));
  audit('request.created', { actor: name, email, tool: req.tool, ip, detail: note });
  res.json({ id, key });
});
async function ownRequest(req, res) {
  const r = (await pool.query('SELECT * FROM gw_access WHERE id = $1', [String(req.params.id)])).rows[0];
  if (!r || r.tool !== req.tool) { res.status(404).json({ error: 'No such request.' }); return null; }
  return r;
}
app.get('/api/tool/access/:id', toolAuth, needDb, async (req, res) => {          // the waiting page polls this (needs the secret key)
  const r = await ownRequest(req, res); if (!r) return;
  const a = Buffer.from(sha(req.query.key || '')), b = Buffer.from(r.key_hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(403).json({ error: 'Wrong key.' });
  res.json({ status: effStatus(r), name: r.name, email: r.email, expires_at: r.expires_at });
});
app.get('/api/tool/access/:id/valid', toolAuth, needDb, async (req, res) => {    // tools re-check an approved session every ~30 s (revoke / expiry)
  const r = await ownRequest(req, res); if (!r) return;
  res.json({ valid: effStatus(r) === 'approved', expires_at: r.expires_at });
});

/* ---- admins: see, approve, deny, revoke, live feed ---- */
app.get('/api/access', approver, needDb, async (req, res) => {          // ?view=pending|recent&page=1&size=10
  const view = req.query.view === 'recent' ? 'recent' : 'pending';
  const size = Math.min(Math.max(parseInt(req.query.size, 10) || 10, 1), 50);
  const where = view === 'pending' ? "status = 'pending'" : "status NOT IN ('pending', 'superseded')";
  const total = (await pool.query('SELECT count(*)::int AS n FROM gw_access WHERE ' + where)).rows[0].n;
  const pages = Math.max(1, Math.ceil(total / size)), page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), pages);
  const rows = (await pool.query('SELECT * FROM gw_access WHERE ' + where + ' ORDER BY created_at DESC LIMIT $1 OFFSET $2', [size, (page - 1) * size])).rows;
  res.json({ items: rows.map(accessPub), total, page, pages, size });
});

/* ---- live tool status (public: green/red dots on the dashboard) ---- */
let statusCache = { ts: 0, data: [] };
app.get('/api/status', async (req, res) => {
  if (Date.now() - statusCache.ts < 15000) return res.json(statusCache.data);
  const data = await Promise.all(loadTools().filter(t => t.url).map(async t => {
    const t0 = Date.now(), ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 4000);
    try { const r = await fetch(t.url.replace(/\/$/, '') + '/api/health', { signal: ctl.signal }); return { id: t.id, up: r.ok, ms: Date.now() - t0 }; }
    catch (e) { return { id: t.id, up: false, ms: null }; } finally { clearTimeout(to); }
  }));
  statusCache = { ts: Date.now(), data }; res.json(data);
});
/* ---- dashboard numbers for approvers ---- */
app.get('/api/stats', approver, needDb, async (req, res) => {
  const n = async sql => (await pool.query(sql)).rows[0].n;
  const day = "ts > now() - interval '24 hours'";
  res.json({
    pending: await n("SELECT count(*)::int AS n FROM gw_access WHERE status = 'pending'"),
    approvedToday: await n("SELECT count(*)::int AS n FROM gw_log WHERE action = 'request.approved' AND " + day),
    enteredToday: await n("SELECT count(*)::int AS n FROM gw_log WHERE action IN ('visitor.entered','gateway.link_entry','owner.signin') AND " + day),
    failedToday: await n("SELECT count(*)::int AS n FROM gw_log WHERE action IN ('owner.signin_failed','gateway.signin_failed') AND " + day)
  });
});
/* ---- Activity log (approvers): ?page=1&size=20&q=text&action=request.approved ---- */
function logQuery(req) {
  const conds = [], params = [];
  const q = clean(req.query.q, 60).toLowerCase(), action = clean(req.query.action, 40);
  if (action) { params.push(action); conds.push('action = $' + params.length); }
  if (q) { params.push('%' + q.replace(/[%_]/g, ' ') + '%'); const n = '$' + params.length; conds.push('(actor ILIKE ' + n + ' OR email ILIKE ' + n + ' OR ip ILIKE ' + n + ' OR detail ILIKE ' + n + ' OR tool ILIKE ' + n + ' OR action ILIKE ' + n + ')'); }
  return { where: conds.length ? ' WHERE ' + conds.join(' AND ') : '', params };
}
app.get('/api/logs', approver, needDb, async (req, res) => {
  const { where, params } = logQuery(req);
  const size = Math.min(Math.max(parseInt(req.query.size, 10) || 20, 1), 100);
  const total = (await pool.query('SELECT count(*)::int AS n FROM gw_log' + where, params)).rows[0].n;
  const pages = Math.max(1, Math.ceil(total / size)), page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), pages);
  const rows = (await pool.query('SELECT * FROM gw_log' + where + ' ORDER BY id DESC LIMIT ' + size + ' OFFSET ' + (page - 1) * size, params)).rows;
  res.json({ items: rows.map(r => ({ ...r, toolName: r.tool ? toolName(r.tool) : '' })), total, page, pages, size });
});
app.get('/api/logs.csv', approver, needDb, async (req, res) => {
  const { where, params } = logQuery(req);
  const rows = (await pool.query('SELECT * FROM gw_log' + where + ' ORDER BY id DESC LIMIT 5000', params)).rows;
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const csv = ['Time (UTC),Event,Who,Email,Tool,IP,Details'].concat(rows.map(r => [new Date(r.ts).toISOString(), r.action, r.actor, r.email, r.tool, r.ip, r.detail].map(q).join(','))).join('\r\n');
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="arc-gateway-activity-' + new Date().toISOString().slice(0, 10) + '.csv"' }).send('\ufeff' + csv);
});

/* ---- Settings (approvers) ---- */
app.get('/api/settings', approver, (req, res) => {
  const origin = (req.headers['x-forwarded-proto'] || req.protocol) + '://' + req.get('host');
  res.json({ ...SETTINGS, hasKey: !!APPROVER_KEY, open: OPEN, approverLink: APPROVER_KEY ? origin + '/approver?key=' + APPROVER_KEY : '', db: dbReady });
});
app.put('/api/settings', approver, needDb, async (req, res) => {
  const b = req.body || {}, next = {};
  if (b.acceptRequests !== undefined) { if (typeof b.acceptRequests !== 'boolean') return res.status(400).json({ error: 'Bad value.' }); next.acceptRequests = b.acceptRequests; }
  if (b.defaultHours !== undefined) { if (![1, 12, 24, 168].includes(+b.defaultHours)) return res.status(400).json({ error: 'Choose 1 hour, 12 hours, 24 hours or 7 days.' }); next.defaultHours = +b.defaultHours; }
  for (const [k, v] of Object.entries(next)) {
    await pool.query('INSERT INTO gw_settings(key, value) VALUES($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [k, JSON.stringify(v)]);
    SETTINGS[k] = v;
  }
  if (Object.keys(next).length) audit('settings.changed', { actor: req.user.display_name || req.user.username, ip: req.ip, detail: JSON.stringify(next) });
  res.json({ ...SETTINGS });
});
async function decide(req, res, from, to, extra) {
  const id = String(req.params.id);
  const cur = (await pool.query('SELECT * FROM gw_access WHERE id = $1', [id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'No such request.' });
  if (!from.includes(effStatus(cur))) return res.status(409).json({ error: 'This request is already ' + effStatus(cur) + '.' });
  const r = (await pool.query('UPDATE gw_access SET status = $1, decided_at = now(), decided_by = $2, expires_at = $3 WHERE id = $4 RETURNING *', [to, req.decider || (req.user && (req.user.display_name || req.user.username)) || 'Super Admin', extra ? extra.expires : null, id])).rows[0];
  broadcast('update', accessPub(r));
  audit('request.' + (to === 'approved' ? 'approved' : to === 'denied' ? 'denied' : 'revoked'), { actor: r.decided_by, email: cur.email, tool: cur.tool, ip: req.auditIp || req.ip,
    detail: (to === 'approved' ? 'for ' + Math.round((new Date(r.expires_at) - Date.now()) / 3600000) + ' h' : '') + (req.via ? (to === 'approved' ? ' ' : '') + 'via ' + req.via : '') });
  res.json(accessPub(r));
}
app.post('/api/access/:id/approve', approver, needDb, (req, res) => {
  const hours = [1, 12, 24, 168].includes(+((req.body || {}).hours)) ? +req.body.hours : SETTINGS.defaultHours;
  return decide(req, res, ['pending'], 'approved', { expires: new Date(Date.now() + hours * 3600 * 1000) });
});
app.post('/api/access/:id/deny', approver, needDb, (req, res) => decide(req, res, ['pending'], 'denied'));
app.post('/api/access/:id/revoke', approver, needDb, (req, res) => decide(req, res, ['approved'], 'revoked'));
function openStream(req, res) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders && res.flushHeaders();
  res.write('retry: 3000\n\nevent: hello\ndata: {}\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
}
app.get('/api/events', approver, openStream);

/* ---- tools (Payroll, Inventory ...) show requests in their header bell: the tool verifies its user is an approver, then calls these ---- */
app.get('/api/tool/pending', toolAuth, needDb, async (req, res) => {
  const rows = (await pool.query("SELECT * FROM gw_access WHERE status = 'pending' ORDER BY created_at DESC LIMIT 50")).rows;
  res.json({ requests: rows.map(accessPub) });
});
app.post('/api/tool/decide', toolAuth, needDb, (req, res) => {
  const b = req.body || {};
  if (!['approve', 'deny'].includes(b.action) || typeof b.id !== 'string') return res.status(400).json({ error: 'Bad request.' });
  req.params = { id: b.id }; req.decider = clean(b.by, 60) || 'Super Admin'; req.auditIp = clean(b.ip, 64); req.via = toolName(req.tool);
  if (b.action === 'deny') return decide(req, res, ['pending'], 'denied');
  const hours = [1, 12, 24, 168].includes(+b.hours) ? +b.hours : SETTINGS.defaultHours;
  return decide(req, res, ['pending'], 'approved', { expires: new Date(Date.now() + hours * 3600 * 1000) });
});
app.get('/api/tool/events', toolAuth, openStream);
const TOOL_EVENTS = ['owner.signin', 'owner.signin_failed', 'visitor.entered', 'gateway.link_entry'];
app.post('/api/tool/log', toolAuth, needDb, async (req, res) => {
  const b = req.body || {};
  if (!TOOL_EVENTS.includes(b.action)) return res.status(400).json({ error: 'Unknown event.' });
  await audit(b.action, { actor: b.actor, email: b.email, tool: req.tool, ip: b.ip, detail: b.detail });
  res.json({ ok: true });
});

/* ---- Admin Console API (Super Admin only) ---- */
const cleanTools = t => Array.isArray(t) ? [...new Set(t.map(String))].filter(x => x === '*' || loadTools().some(k => k.id === x)) : [];
app.get('/api/users', admin, needDb, async (req, res) => res.json((await pool.query('SELECT * FROM gw_users ORDER BY username')).rows.map(pub)));
app.post('/api/users', admin, needDb, async (req, res) => {
  const b = req.body || {}, username = String(b.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._+@-]{3,64}$/.test(username)) return res.status(400).json({ error: 'Use an email or username: 3–64 letters, numbers and . _ - + @ (no spaces).' });
  if (typeof b.password !== 'string' || b.password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  try {
    const r = await pool.query('INSERT INTO gw_users(username, display_name, password_hash, role, tools) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [username, String(b.name || '').trim() || username, await hashPw(b.password), b.role === 'admin' ? 'admin' : 'user', JSON.stringify(cleanTools(b.tools))]);
    audit('user.created', { actor: req.user.display_name || req.user.username, email: username, ip: req.ip, detail: (b.role === 'admin' ? 'Super Admin' : 'User') });
    res.json(pub(r.rows[0]));
  } catch (e) { res.status(e.code === '23505' ? 409 : 500).json({ error: e.code === '23505' ? 'That username already exists.' : 'Could not create the user.' }); }
});
app.put('/api/users/:id', admin, needDb, async (req, res) => {
  const id = parseInt(req.params.id, 10), b = req.body || {};
  const cur = (await pool.query('SELECT * FROM gw_users WHERE id = $1', [id])).rows[0]; if (!cur) return res.status(404).json({ error: 'No such user.' });
  const role = b.role === 'admin' ? 'admin' : b.role === 'user' ? 'user' : cur.role, active = typeof b.active === 'boolean' ? b.active : cur.active;
  if (cur.id === req.user.id && (!active || role !== 'admin')) return res.status(400).json({ error: 'You cannot remove your own admin access.' });
  if (cur.role === 'admin' && cur.active && (role !== 'admin' || !active)) {
    const left = (await pool.query("SELECT count(*)::int AS n FROM gw_users WHERE role='admin' AND active AND id <> $1", [id])).rows[0].n;
    if (!left) return res.status(400).json({ error: 'There must be at least one active Super Admin.' });
  }
  if (b.password !== undefined && b.password !== '' && (typeof b.password !== 'string' || b.password.length < 8)) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const r = await pool.query('UPDATE gw_users SET display_name=$1, role=$2, active=$3, tools=$4, password_hash=$5 WHERE id=$6 RETURNING *',
    [b.name !== undefined ? String(b.name).trim() || cur.username : cur.display_name, role, active, JSON.stringify(b.tools !== undefined ? cleanTools(b.tools) : cur.tools), b.password ? await hashPw(b.password) : cur.password_hash, id]);
  audit('user.updated', { actor: req.user.display_name || req.user.username, email: cur.username, ip: req.ip, detail: [b.password ? 'password reset' : '', typeof b.active === 'boolean' && b.active !== cur.active ? (b.active ? 'enabled' : 'disabled') : '', b.role && b.role !== cur.role ? 'role: ' + b.role : ''].filter(Boolean).join(', ') });
  res.json(pub(r.rows[0]));
});
app.delete('/api/users/:id', admin, needDb, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete yourself.' });
  const cur = (await pool.query('SELECT * FROM gw_users WHERE id = $1', [id])).rows[0]; if (!cur) return res.status(404).json({ error: 'No such user.' });
  if (cur.role === 'admin' && cur.active) {
    const left = (await pool.query("SELECT count(*)::int AS n FROM gw_users WHERE role='admin' AND active AND id <> $1", [id])).rows[0].n;
    if (!left) return res.status(400).json({ error: 'There must be at least one active Super Admin.' });
  }
  await pool.query('DELETE FROM gw_users WHERE id = $1', [id]);
  audit('user.deleted', { actor: req.user.display_name || req.user.username, email: cur.username, ip: req.ip });
  res.json({ ok: true });
});

app.use((req, res, next) => /^\/(server\.js|package(-lock)?\.json|node_modules|README\.md)/.test(req.path) ? res.status(404).end() : next());
app.use(express.static(__dirname, { extensions: ['html'], index: 'index.html', dotfiles: 'ignore', setHeaders: (res, p) => { if (/\.(js|css|html)$/i.test(p)) res.setHeader('Cache-Control', 'no-cache'); } }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.use((err, req, res, next) => { console.error(err); if (!res.headersSent) res.status(500).json({ error: 'Something went wrong.' }); });
process.on('unhandledRejection', e => console.error('unhandledRejection', e));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('ARC+ Gateway listening on port ' + PORT + ' (open dashboard; admin sign-in for approvals)'));
