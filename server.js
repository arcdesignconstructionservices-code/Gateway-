/* ============================================================
   ARC+ Gateway — server
   - sign-in (users stored in Postgres, passwords hashed with scrypt)
   - Admin Console API (Super Admin only)
   - /launch/:tool  → sends the signed-in user to a tool with a short-lived
     signed token (SSO); Payroll / Inventory verify it with the shared SSO_SECRET

   Environment variables (Railway):
     DATABASE_URL    Postgres for the users table
     ADMIN_USER      first Super Admin email/username (only used when there are no users yet; APP_USER also works)
     ADMIN_PASSWORD  first Super Admin password (min 8 chars; APP_PASSWORD also works)
     SESSION_SECRET  random string that signs the Gateway session cookie
     SSO_SECRET      random string shared with Payroll + Inventory (signs launch tokens)
   ============================================================ */
const express = require('express');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const { promisify } = require('util');
const { Pool } = require('pg');
const scrypt = promisify(crypto.scrypt);

// The first Super Admin can come from ADMIN_USER / ADMIN_PASSWORD, or from APP_USER / APP_PASSWORD
// (the same variable names Payroll and Inventory use).
if (!process.env.ADMIN_USER && process.env.APP_USER) process.env.ADMIN_USER = process.env.APP_USER;
if (!process.env.ADMIN_PASSWORD && process.env.APP_PASSWORD) process.env.ADMIN_PASSWORD = process.env.APP_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.SSO_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET && !process.env.SSO_SECRET) console.warn('No SESSION_SECRET set — sessions reset on every restart.');
const SSO_SECRET = process.env.SSO_SECRET || '';
// Sign-in on the Gateway itself is OFF by default (the tools - Payroll, Inventory - have their own sign-in).
// Set REQUIRE_LOGIN=1 on the Gateway service to turn the Gateway sign-in + Admin Console on.
const AUTH_ON = process.env.REQUIRE_LOGIN === '1';
const OPEN_USER = { id: -1, username: 'open', display_name: 'ARC+', role: 'user', tools: ['*'], active: true };
const SESSION_MS = 12 * 3600 * 1000;
const COOKIE = 'gw_session';

/* ---------- tools (shared with the front end) ---------- */
function loadTools() {
  try { return vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'tools.js'), 'utf8') + '\n;GATEWAY_TOOLS'); }
  catch (e) { console.error('Could not read tools.js:', e.message); return []; }
}

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

/* ---------- database / users ---------- */
const pool = process.env.DATABASE_URL ? (() => {
  let ssl = false;
  try { const h = new URL(process.env.DATABASE_URL).hostname; if (!/\.railway\.internal$|^localhost$|^127\.0\.0\.1$/.test(h)) ssl = { rejectUnauthorized: false }; } catch (e) { ssl = { rejectUnauthorized: false }; }
  return new Pool({ connectionString: process.env.DATABASE_URL, ssl, max: 5, idleTimeoutMillis: 30000 });
})() : null;
let dbReady = false;
async function initDb() {
  if (!pool) { console.warn('No DATABASE_URL — only the ADMIN_USER account can sign in.'); return; }
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS gw_users(
      id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', tools JSONB NOT NULL DEFAULT '[]',
      active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const n = (await pool.query('SELECT count(*)::int AS n FROM gw_users')).rows[0].n;
    if (!n && process.env.ADMIN_USER && process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length >= 8) {
      await pool.query('INSERT INTO gw_users(username, display_name, password_hash, role, tools) VALUES($1,$2,$3,$4,$5)',
        [process.env.ADMIN_USER.toLowerCase(), 'Super Admin', await hashPw(process.env.ADMIN_PASSWORD), 'admin', JSON.stringify(['*'])]);
      console.log('Created first Super Admin "' + process.env.ADMIN_USER.toLowerCase() + '".');
    } else if (!n) console.warn('No users yet — set ADMIN_USER and ADMIN_PASSWORD (8+ chars) to create the first Super Admin.');
    dbReady = true; console.log('PostgreSQL connected — gw_users ready.');
  } catch (e) { dbReady = false; console.error('DB init failed:', e.message); setTimeout(initDb, 5000); }
}
initDb();
const pub = u => ({ id: u.id, username: u.username, name: u.display_name || u.username, role: u.role, tools: u.tools, active: u.active, created_at: u.created_at });
async function findUser(username) {
  if (pool && dbReady) return (await pool.query('SELECT * FROM gw_users WHERE username = $1', [String(username).toLowerCase()])).rows[0] || null;
  return null;
}
/* no database: allow only the env admin so you are never locked out of the portal itself */
async function envAdmin(username, password) {
  if (!process.env.ADMIN_USER || !process.env.ADMIN_PASSWORD) return null;
  const okU = username.toLowerCase() === process.env.ADMIN_USER.toLowerCase();
  const a = Buffer.from(password), b = Buffer.from(process.env.ADMIN_PASSWORD);
  const okP = a.length === b.length && crypto.timingSafeEqual(a, b);
  return okU && okP ? { id: 0, username: process.env.ADMIN_USER.toLowerCase(), display_name: 'Super Admin', role: 'admin', tools: ['*'], active: true } : null;
}

/* ---------- app ---------- */
const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '100kb' }));

const tries = new Map();                                   // naive login rate limit: 10 failures / 10 min / IP
const limited = ip => { const t = tries.get(ip); return t && t.n >= 10 && Date.now() - t.ts < 600000; };
const fail = ip => { const t = tries.get(ip); if (!t || Date.now() - t.ts >= 600000) tries.set(ip, { n: 1, ts: Date.now() }); else t.n++; };

app.get('/api/health', (req, res) => res.json({ ok: true, db: dbReady }));

app.post('/api/login', async (req, res) => {
  if (!AUTH_ON) return res.status(404).json({ error: 'Sign-in is turned off on the Gateway.' });
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

/* ---- everything below needs a session ---- */
const PUBLIC = /^\/(login(\.html)?|gateway\.css|logo[\w]*\.png|favicon\.png|apple-touch-icon\.png|icon-512\.png|manifest\.webmanifest|signin-\d\.jpg)$/;
async function sessionUser(req) {
  const s = verify(parseCookies(req)[COOKIE], SESSION_SECRET); if (!s) return null;
  if (s.id === 0) {                                   // env-admin fallback session (database not connected)
    return !dbReady && process.env.ADMIN_USER && s.u === process.env.ADMIN_USER.toLowerCase()
      ? { id: 0, username: s.u, display_name: 'Super Admin', role: 'admin', tools: ['*'], active: true } : null;
  }
  const u = await findUser(s.u); return u && u.active ? u : null;
}
app.use(async (req, res, next) => {
  if (!AUTH_ON) { req.user = OPEN_USER; return next(); }
  if (PUBLIC.test(req.path)) return next();
  try { req.user = await sessionUser(req); } catch (e) { req.user = null; }
  if (req.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not signed in.' });
  res.redirect('/login');
});
app.get(['/login', '/login.html'], (req, res) => AUTH_ON ? res.sendFile(path.join(__dirname, 'login.html')) : res.redirect('/'));

const canOpen = (u, id) => u.role === 'admin' || (u.tools || []).includes('*') || (u.tools || []).includes(id);
app.get('/api/me', (req, res) => {
  const tools = loadTools().filter(t => canOpen(req.user, t.id)).map(t => t.id);
  res.json({ ...pub(req.user), tools, dbReady, authOff: !AUTH_ON });
});

app.get('/launch/:id', (req, res) => {
  const t = loadTools().find(x => x.id === req.params.id);
  if (!t || !t.url) return res.status(404).send('That tool is not available yet.');
  if (!canOpen(req.user, t.id)) return res.status(403).send('You do not have access to this tool. Ask a Super Admin.');
  const base = t.url.replace(/\/$/, '');
  if (!AUTH_ON || !SSO_SECRET) return res.redirect(base + '/');
  const token = sign({ t: t.id, sub: req.user.username, name: req.user.display_name || req.user.username, exp: Date.now() + 60000 }, SSO_SECRET);
  res.redirect(`${base}/sso?token=${encodeURIComponent(token)}`);
});

app.post('/api/password', async (req, res) => {
  const { current, next } = req.body || {};
  if (!pool || !dbReady || req.user.id === 0) return res.status(400).json({ error: 'Password changes need the database account.' });
  if (typeof next !== 'string' || next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  if (!(await checkPw(String(current || ''), req.user.password_hash))) return res.status(400).json({ error: 'Current password is wrong.' });
  await pool.query('UPDATE gw_users SET password_hash = $1 WHERE id = $2', [await hashPw(next), req.user.id]);
  res.json({ ok: true });
});

/* ---- Admin Console API (Super Admin only) ---- */
const admin = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Super Admin only.' });
const needDb = (req, res, next) => pool && dbReady ? next() : res.status(503).json({ error: 'The database is not connected.' });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('ARC+ Gateway listening on port ' + PORT + (AUTH_ON ? ' (sign-in ON)' : ' (open launcher: sign-in OFF)')));
