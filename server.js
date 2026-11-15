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
  const s = verify(parseCookies(req)[COOKIE], SESSION_SECRET); if (!s) return null;
  if (s.id === 0) {                                   // env-admin fallback session (database not connected)
    return !dbReady && process.env.ADMIN_USER && s.u === process.env.ADMIN_USER.toLowerCase()
      ? { id: 0, username: s.u, display_name: 'Super Admin', role: 'admin', tools: ['*'], active: true } : null;
  }
  const u = await findUser(s.u); return u && u.active ? u : null;
}
// everyone can reach the dashboard; if a valid admin session cookie is present we know who it is
app.use(async (req, res, next) => { try { req.user = await sessionUser(req); } catch (e) { req.user = null; } next(); });

app.post('/api/login', async (req, res) => {
  const ip = req.ip, { username, password } = req.body || {};
  if (limited(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) return res.status(400).json({ error: 'Enter your username and password.' });
  try {
    let u = await findUser(username);
    if (u) { if (!u.active || !(await checkPw(password, u.password_hash))) u = null; }
    else if (!dbReady) u = await envAdmin(username, password);
    else await scrypt(password, 'x', 64);                                // keep timing similar for unknown users
    if (!u) { fail(ip); return res.status(401).json({ error: 'Wrong username or password.' }); }
    tries.delete(ip);
    setCookie(req, res, COOKIE, sign({ id: u.id, u: u.username, exp: Date.now() + SESSION_MS }, SESSION_SECRET), SESSION_MS);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Sign-in failed. Try again.' }); }
});
app.post('/api/logout', (req, res) => { setCookie(req, res, COOKIE, '', 0); res.json({ ok: true }); });
app.get(['/login', '/login.html'], (req, res) => res.sendFile(path.join(__dirname, 'login.html')));

const needUser = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Not signed in.' });
const admin = (req, res, next) => !req.user ? res.status(401).json({ error: 'Not signed in.' }) : req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Super Admin only.' });
const needDb = (req, res, next) => pool && dbReady ? next() : res.status(503).json({ error: 'The database is not connected.' });
const canOpen = (u, id) => !u || u.role === 'admin' || (u.tools || []).includes('*') || (u.tools || []).includes(id);

app.get('/api/me', async (req, res) => {
  const tools = loadTools().filter(t => canOpen(req.user, t.id)).map(t => t.id);
  if (!req.user) return res.json({ signedIn: false, role: 'guest', name: 'Guest', tools, dbReady });
  let pending = 0;
  if (req.user.role === 'admin' && pool && dbReady) { try { pending = (await pool.query("SELECT count(*)::int AS n FROM gw_access WHERE status = 'pending'")).rows[0].n; } catch (e) { } }
  res.json({ ...pub(req.user), signedIn: true, tools, dbReady, pending });
});

app.get('/launch/:id', (req, res) => {
  const t = loadTools().find(x => x.id === req.params.id);
  if (!t || !t.url) return res.status(404).send('That tool is not available yet.');
  if (!canOpen(req.user, t.id)) return res.status(403).send('You do not have access to this tool.');
  const base = t.url.replace(/\/$/, '');
  if (!req.user || !SSO_SECRET) return res.redirect(base + '/');          // visitors go to the tool's own sign-in / Request access page
  const token = sign({ t: t.id, sub: req.user.username, name: req.user.display_name || req.user.username, exp: Date.now() + 60000 }, SSO_SECRET);
  res.redirect(`${base}/sso?token=${encodeURIComponent(token)}`);       // signed-in Gateway users go straight in
});

app.post('/api/password', needUser, async (req, res) => {
  const { current, next } = req.body || {};
  if (!pool || !dbReady || req.user.id === 0) return res.status(400).json({ error: 'Password changes need the database account.' });
  if (typeof next !== 'string' || next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  if (!(await checkPw(String(current || ''), req.user.password_hash))) return res.status(400).json({ error: 'Current password is wrong.' });
  await pool.query('UPDATE gw_users SET password_hash = $1 WHERE id = $2', [await hashPw(next), req.user.id]);
  res.json({ ok: true });
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
  res.json({ status: effStatus(r), name: r.name, expires_at: r.expires_at });
});
app.get('/api/tool/access/:id/valid', toolAuth, needDb, async (req, res) => {    // tools re-check an approved session every ~30 s (revoke / expiry)
  const r = await ownRequest(req, res); if (!r) return;
  res.json({ valid: effStatus(r) === 'approved', expires_at: r.expires_at });
});

/* ---- admins: see, approve, deny, revoke, live feed ---- */
app.get('/api/access', admin, needDb, async (req, res) => {
  const rows = (await pool.query("SELECT * FROM gw_access WHERE status <> 'superseded' ORDER BY (status = 'pending') DESC, created_at DESC LIMIT 100")).rows;
  res.json(rows.map(accessPub));
});
async function decide(req, res, from, to, extra) {
  const id = String(req.params.id);
  const cur = (await pool.query('SELECT * FROM gw_access WHERE id = $1', [id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'No such request.' });
  if (!from.includes(effStatus(cur))) return res.status(409).json({ error: 'This request is already ' + effStatus(cur) + '.' });
  const r = (await pool.query('UPDATE gw_access SET status = $1, decided_at = now(), decided_by = $2, expires_at = $3 WHERE id = $4 RETURNING *', [to, req.user.display_name || req.user.username, extra ? extra.expires : null, id])).rows[0];
  broadcast('update', accessPub(r));
  res.json(accessPub(r));
}
app.post('/api/access/:id/approve', admin, needDb, (req, res) => {
  const hours = [1, 12, 24, 168].includes(+((req.body || {}).hours)) ? +req.body.hours : ACCESS_HOURS;
  return decide(req, res, ['pending'], 'approved', { expires: new Date(Date.now() + hours * 3600 * 1000) });
});
app.post('/api/access/:id/deny', admin, needDb, (req, res) => decide(req, res, ['pending'], 'denied'));
app.post('/api/access/:id/revoke', admin, needDb, (req, res) => decide(req, res, ['approved'], 'revoked'));
app.get('/api/events', admin, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders && res.flushHeaders();
  res.write('retry: 3000\n\nevent: hello\ndata: {}\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
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
  await pool.query('DELETE FROM gw_users WHERE id = $1', [id]); res.json({ ok: true });
});

app.use((req, res, next) => /^\/(server\.js|package(-lock)?\.json|node_modules|README\.md)/.test(req.path) ? res.status(404).end() : next());
app.use(express.static(__dirname, { extensions: ['html'], index: 'index.html', dotfiles: 'ignore' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.use((err, req, res, next) => { console.error(err); if (!res.headersSent) res.status(500).json({ error: 'Something went wrong.' }); });
process.on('unhandledRejection', e => console.error('unhandledRejection', e));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('ARC+ Gateway listening on port ' + PORT + ' (open dashboard; admin sign-in for approvals)'));
