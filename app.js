/* ARC+ Gateway — launcher, sign-in session and Admin Console. Tools come from tools.js. */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KEY = 'arc-gateway-v1';

const ICONS = {
  dash: '<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  payroll: '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M8 2v4M16 2v4M3 10h18M8 15h3"/>',
  inventory: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
  open: '<path d="M7 17 17 7M8 7h9v9"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'
};
const svg = n => `<svg viewBox="0 0 24 24">${ICONS[n] || ICONS.doc}</svg>`;

/* ---------- session ---------- */
let ME = null;
async function api(url, opt) {
  const r = await fetch(url, opt && opt.body ? { ...opt, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opt.body) } : opt);
  if (r.status === 401) { location.href = '/login'; throw new Error('signed out'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong.');
  return j;
}
const myTools = () => GATEWAY_TOOLS.filter(t => ME && ME.tools.includes(t.id));

/* ---------- favourites (kept in this browser) ---------- */
let favs = [];
try { favs = JSON.parse(localStorage.getItem(KEY + '-favs')) || []; } catch (e) { favs = []; }
const saveFavs = () => { try { localStorage.setItem(KEY + '-favs', JSON.stringify(favs)); } catch (e) { } };
const isFav = id => favs.includes(id);

/* ---------- tool cards ---------- */
let query = '';
const match = t => { const q = query.trim().toLowerCase(); return !q || (t.name + ' ' + t.desc + ' ' + t.group).toLowerCase().includes(q); };
function card(t) {
  const live = !!t.url;
  return `<article class="card">
    <div class="card-top"><div class="tico">${svg(t.icon)}</div><span class="status${live ? '' : ' soon'}"><i></i>${live ? 'Active' : 'Coming soon'}</span></div>
    <h3>${esc(t.name)}</h3>
    <p>${esc(t.desc)}</p>
    <div class="chips"><span class="chip">${esc(t.group)}</span>${live ? '<span class="chip ok">Access granted</span>' : ''}</div>
    <div class="card-act">
      <a class="open${live ? '' : ' disabled'}" ${live ? `href="/launch/${esc(t.id)}" target="_blank" rel="noopener"` : 'aria-disabled="true"'}>Open App ${svg('open')}</a>
      <button class="star${isFav(t.id) ? ' on' : ''}" data-fav="${esc(t.id)}" title="${isFav(t.id) ? 'Remove from My Tools' : 'Add to My Tools'}" aria-label="Toggle favourite">${svg('star')}</button>
    </div>
  </article>`;
}
function renderTools(mine) {
  const list = myTools().filter(t => (!mine || isFav(t.id)) && match(t));
  $('#view').innerHTML = `<h1>${mine ? 'My Tools' : 'Your Tools'}</h1>
    <p class="sub">${mine ? 'Tools you starred. Click the star on any card to add or remove it.' : 'Tools you can open right now. Each one launches in a new tab.'}</p>
    ${list.length ? `<div class="grid">${list.map(card).join('')}</div>`
      : `<div class="empty">${mine && !query ? 'No favourites yet — star a tool on the dashboard.' : (!myTools().length ? 'You have no tools yet. Ask a Super Admin to give you access.' : 'No tools match your search.')}</div>`}`;
  $('#view').querySelectorAll('[data-fav]').forEach(b => b.onclick = () => {
    const id = b.dataset.fav; favs = isFav(id) ? favs.filter(x => x !== id) : [...favs, id]; saveFavs(); render();
  });
}

/* ---------- Dashboard: hero, live numbers, tools, activity, gallery ---------- */
const PHOTOS = [1, 2, 3, 4, 5];
let heroTimer = null, clockTimer = null, statusData = [], statsData = null;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function greeting() { const h = new Date().getHours(); return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }
function countUp(el) {
  const to = +el.dataset.count || 0; if (reduced() || to === 0) { el.textContent = to; return; }
  const t0 = performance.now(), dur = 900;
  const step = n => { const p = Math.min(1, (n - t0) / dur); el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function paintStatus() {
  document.querySelectorAll('[data-st]').forEach(el => {
    const s = statusData.find(x => x.id === el.dataset.st); if (!s) return;
    el.classList.toggle('down', !s.up); el.lastChild.textContent = s.up ? 'Online' : 'Offline';
  });
  const up = statusData.filter(x => x.up).length, k = $('#kTools');
  if (k && statusData.length) { k.dataset.count = up; k.parentNode.querySelector('small').textContent = 'of ' + statusData.length + ' tools online'; countUp(k); }
}
async function loadDashLive() {
  try { statusData = await api('/api/status'); paintStatus(); } catch (e) { }
  if (!(ME.role === 'admin' || ME.role === 'approver')) return;
  try { statsData = await api('/api/stats'); } catch (e) { return; }
  [['kPend', statsData.pending], ['kApp', statsData.approvedToday], ['kIn', statsData.enteredToday], ['kFail', statsData.failedToday]].forEach(([id, n]) => { const el = document.getElementById(id); if (el) { el.dataset.count = n; countUp(el); } });
  try {
    const d = await api('/api/logs?page=1&size=6'), el = $('#feed'); if (!el) return;
    const ago = ts => { const m = Math.max(0, Math.round((Date.now() - new Date(ts)) / 60000)); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
    el.innerHTML = d.items.length ? d.items.map((r, i) => { const e = EV[r.action] || [r.action, '']; return `<li style="--i:${i}"><span class="dot ${e[1]}"></span><div><b>${esc(e[0])}</b><small>${esc([r.actor || r.email, r.toolName].filter(Boolean).join(' · ') || '—')}</small></div><time>${esc(ago(r.ts))}</time></li>`; }).join('') : '<li class="none">Nothing has happened yet.</li>';
  } catch (e) { }
}
function renderDashboard() {
  clearInterval(heroTimer); clearInterval(clockTimer);
  const appr = ME.role === 'admin' || ME.role === 'approver', tools = myTools().filter(match);
  const first = ME.signedIn && ME.role !== 'approver' ? ME.name.split(' ')[0] : '';
  const kpi = (id, label, sub, n, cls) => `<div class="kpi ${cls || ''}"><div class="kv" id="${id}" data-count="${n}">0</div><div class="kl">${label}</div><small>${sub}</small></div>`;
  $('#view').innerHTML = `
    <section class="hero">
      <div class="hero-bg">${PHOTOS.map((n, i) => `<i class="${i === 0 ? 'on' : ''}" style="background-image:url(/signin-${n}.jpg)"></i>`).join('')}</div>
      <div class="hero-in">
        <div class="hero-clock"><b id="hClock"></b><span id="hDate"></span></div>
        <h1>${greeting()}${first ? ', ' + esc(first) : ''}.</h1>
        <p>Everything ARC Design &amp; Construction Services runs on, in one place.</p>
        <div class="hero-act">${myTools().filter(t => t.url).map(t => `<a class="open" href="/launch/${esc(t.id)}" target="_blank" rel="noopener">${esc(t.name)} ${svg('open')}</a>`).join('')}
        ${appr ? `<a class="ghost" href="/requests"><i class="ping"></i><span id="hPend">${pendingCount ? pendingCount + ' waiting for approval' : 'No requests waiting'}</span></a>` : ''}</div>
      </div>
    </section>
    <div class="kpis">
      ${kpi('kTools', 'Tools', 'checking…', 0)}
      ${appr ? kpi('kPend', 'Waiting', 'requests to review', 0, 'warm') + kpi('kApp', 'Approved', 'in the last 24 h', 0) + kpi('kIn', 'Entries', 'in the last 24 h', 0) + kpi('kFail', 'Failed sign-ins', 'in the last 24 h', 0, 'bad') : ''}
    </div>
    <div class="sect"><h2>Your tools</h2><span class="muted">Each one opens in a new tab.</span></div>
    ${tools.length ? `<div class="grid">${tools.map((t, i) => card(t).replace('<article class="card"', `<article class="card rise" style="--i:${i}"`).replace(/<span class="status([^"]*)"><i><\/i>(Active|Coming soon)<\/span>/, (m, c, w) => w === 'Active' ? `<span class="status" data-st="${esc(t.id)}"><i></i>Checking…</span>` : m)).join('')}</div>`
      : `<div class="empty">${!myTools().length ? 'You have no tools yet.' : 'No tools match your search.'}</div>`}
    <div class="duo">
      ${appr ? `<section class="panel rise" style="--i:3"><div class="sect s2"><h2>Recent activity</h2><a href="/settings/activity">See all</a></div><ul class="feed" id="feed"><li class="none">Loading…</li></ul></section>` : ''}
      <section class="panel rise${appr ? '' : ' wide'}" style="--i:4"><div class="sect s2"><h2>Our work</h2></div><div class="gal">${PHOTOS.map(n => `<figure style="--i:${n}"><img loading="lazy" src="/signin-${n}.jpg" alt="ARC project ${n}"></figure>`).join('')}</div></section>
    </div>`;
  $('#view').querySelectorAll('[data-fav]').forEach(b => b.onclick = () => { const id = b.dataset.fav; favs = isFav(id) ? favs.filter(x => x !== id) : [...favs, id]; saveFavs(); b.classList.toggle('on', isFav(id)); });
  const tick = () => { const n = new Date(), c = $('#hClock'); if (!c) return; c.textContent = n.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); $('#hDate').textContent = n.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }); };
  tick(); clockTimer = setInterval(() => { if (!$('#hClock')) return clearInterval(clockTimer); tick(); }, 15000);
  const bg = [...document.querySelectorAll('.hero-bg i')]; let k = 0;
  if (!reduced()) heroTimer = setInterval(() => { if (!$('.hero-bg')) return clearInterval(heroTimer); bg[k].classList.remove('on'); k = (k + 1) % bg.length; bg[k].classList.add('on'); }, 6000);
  document.querySelectorAll('.kv').forEach(el => { if (el.id === 'kTools') el.textContent = '–'; });
  loadDashLive();
}
/* ---------- Admin Console ---------- */
async function renderAdmin() {
  $('#view').innerHTML = `<div class="row"><div><h1>Admin Console</h1><p class="sub">Create users and choose which tools each person can open.</p></div><span class="spacer"></span><button class="open sm" id="addU">Add user</button></div><div id="uList"><div class="empty">Loading…</div></div>`;
  $('#addU').onclick = () => userDialog(null);
  try {
    const users = await api('/api/users');
    $('#uList').innerHTML = `<div class="tbl"><table><thead><tr><th>User</th><th>Role</th><th>Tools</th><th>Status</th><th></th></tr></thead><tbody>${users.map(u => `<tr>
      <td><b>${esc(u.name)}</b><div class="muted">${esc(u.username)}</div></td>
      <td>${u.role === 'admin' ? 'Super Admin' : 'User'}</td>
      <td>${u.role === 'admin' || u.tools.includes('*') ? 'All tools' : (u.tools.map(id => (GATEWAY_TOOLS.find(t => t.id === id) || { name: id }).name).join(', ') || '<span class="muted">None</span>')}</td>
      <td>${u.active ? '<span class="pill ok">Active</span>' : '<span class="pill">Disabled</span>'}</td>
      <td class="r"><button class="sm" data-u="${u.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>`;
    $('#uList').querySelectorAll('[data-u]').forEach(b => b.onclick = () => userDialog(users.find(u => u.id === +b.dataset.u)));
  } catch (e) { $('#uList').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
function userDialog(u) {
  const d = $('#dlg'), f = $('#dlgForm'), isNew = !u;
  f.innerHTML = `<h3>${isNew ? 'Add user' : 'Edit ' + esc(u.username)}</h3>
    ${isNew ? `<label>Email (used to sign in)<input name="username" type="text" required autocapitalize="none" spellcheck="false" placeholder="e.g. maria@arcdesign.com"></label>` : ''}
    <label>Display name<input name="name" value="${esc(u ? u.name : '')}" placeholder="e.g. Maria Santos"></label>
    <label>${isNew ? 'Password (8+ characters)' : 'New password (leave blank to keep the current one)'}<div class="pwrow"><input name="password" id="pwIn" type="password" autocomplete="new-password" ${isNew ? 'required' : ''} minlength="8"><button type="button" class="sm" id="pwShow">Show</button><button type="button" class="sm" id="pwGen">Generate</button><button type="button" class="sm" id="pwCopy">Copy</button></div></label>
    <label>Role<select name="role"><option value="user"${u && u.role === 'user' || isNew ? ' selected' : ''}>User</option><option value="admin"${u && u.role === 'admin' ? ' selected' : ''}>Super Admin (everything + Admin Console)</option></select></label>
    <fieldset><legend>Tools this user can open</legend>${GATEWAY_TOOLS.map(t => `<label class="chk"><input type="checkbox" name="tool" value="${esc(t.id)}"${u && (u.tools.includes(t.id) || u.tools.includes('*')) ? ' checked' : ''}> ${esc(t.name)}</label>`).join('')}</fieldset>
    ${isNew ? '' : `<label class="chk"><input type="checkbox" name="active"${u.active ? ' checked' : ''}> Account active</label>`}
    <div class="err" id="dErr"></div>
    <div class="row">${isNew ? '' : '<button type="button" class="danger" id="dDel">Delete</button>'}<span class="spacer"></span><button type="button" id="dCancel">Cancel</button><button class="open sm" id="dSave">Save</button></div>`;
  const pw = $('#pwIn'), pwShow = $('#pwShow'), pwCopy = $('#pwCopy');
  pwShow.onclick = () => { pw.type = pw.type === 'password' ? 'text' : 'password'; pwShow.textContent = pw.type === 'password' ? 'Show' : 'Hide'; };
  $('#pwGen').onclick = () => {
    const al = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', r = crypto.getRandomValues(new Uint32Array(14));
    pw.value = [...r].map(x => al[x % al.length]).join(''); pw.type = 'text'; pwShow.textContent = 'Hide';
  };
  pwCopy.onclick = async () => {
    if (!pw.value) return;
    try { await navigator.clipboard.writeText(pw.value); pwCopy.textContent = 'Copied'; setTimeout(() => { pwCopy.textContent = 'Copy'; }, 1500); } catch (e) { pw.type = 'text'; pw.select(); }
  };  $('#dCancel').onclick = () => d.close();
  if (!isNew) $('#dDel').onclick = async () => {
    if (!confirm(`Delete ${u.username}? This cannot be undone.`)) return;
    try { await api('/api/users/' + u.id, { method: 'DELETE' }); d.close(); renderAdmin(); } catch (e) { $('#dErr').textContent = e.message; }
  };
  f.onsubmit = async ev => {
    ev.preventDefault(); const fd = new FormData(f), tools = fd.getAll('tool');
    const body = { name: fd.get('name'), role: fd.get('role'), tools };
    if (fd.get('password')) body.password = fd.get('password');
    if (isNew) { body.username = fd.get('username'); } else body.active = !!fd.get('active');
    try { await api(isNew ? '/api/users' : '/api/users/' + u.id, { method: isNew ? 'POST' : 'PUT', body }); d.close(); renderAdmin(); }
    catch (e) { $('#dErr').textContent = e.message; }
  };
  d.showModal();
}
function passwordDialog() {
  const d = $('#dlg'), f = $('#dlgForm');
  f.innerHTML = `<h3>Change password</h3>
    <label>Current password<input name="current" type="password" autocomplete="current-password" required></label>
    <label>New password (8+ characters)<input name="next" type="password" autocomplete="new-password" required minlength="8"></label>
    <div class="err" id="dErr"></div>
    <div class="row"><span class="spacer"></span><button type="button" id="dCancel">Cancel</button><button class="open sm">Save</button></div>`;
  $('#dCancel').onclick = () => d.close();
  f.onsubmit = async ev => { ev.preventDefault(); const fd = new FormData(f);
    try { await api('/api/password', { method: 'POST', body: { current: fd.get('current'), next: fd.get('next') } }); d.close(); alert('Password changed.'); }
    catch (e) { $('#dErr').textContent = e.message; } };
  d.showModal();
}

/* ---------- Access requests (live) ---------- */
let reqs = [], pendingCount = 0, es = null, audioCtx = null;
const initials = n => String(n || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const toolOf = id => GATEWAY_TOOLS.find(t => t.id === id) || { icon: 'doc', name: id };
const ago = ts => { const s = Math.max(1, Math.round((Date.now() - new Date(ts)) / 1000)); if (s < 60) return 'just now'; const m = Math.round(s / 60); if (m < 60) return m + ' min ago'; const h = Math.round(m / 60); return h < 24 ? h + ' h ago' : Math.round(h / 24) + ' d ago'; };
const when = ts => ts ? new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const isReqPage = () => routeParts()[0] === 'requests';

function setBadge(n) {
  pendingCount = Math.max(0, n);
  const b = $('#bellBadge'); if (b) { b.textContent = pendingCount > 9 ? '9+' : pendingCount; b.hidden = !pendingCount; }
  const nb = $('#navBadge'); if (nb) { nb.textContent = pendingCount; nb.hidden = !pendingCount; }
  document.title = (pendingCount ? '(' + pendingCount + ') ' : '') + 'ARC+ Gateway';
}
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime;
    [[880, 0], [1175, .17]].forEach(([f, d]) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.2, t + d + .02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + .3);
      o.connect(g); g.connect(audioCtx.destination); o.start(t + d); o.stop(t + d + .32);
    });
  } catch (e) { }
}
addEventListener('pointerdown', () => { try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) { } });

function note(text, bad) {
  const el = document.createElement('div'); el.className = 'rtoast small' + (bad ? ' bad' : ''); el.textContent = text;
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), 3500);
}
function popup(r, force) {
  const box = $('#toasts'); if (!box || box.querySelector('.rtoast[data-id="' + r.id + '"]')) return;
  if (!force && !pref('popup')) return;
  const el = document.createElement('div'); el.className = 'rtoast'; el.dataset.id = r.id;
  el.innerHTML = `<div class="rt-top"><b>New access request</b><button class="rt-x" aria-label="Dismiss">&times;</button></div>
    <div class="rt-body"><b>${esc(r.name)}</b> wants to open <b>${esc(r.toolName)}</b><div class="muted">${esc(r.email)}${r.note ? ' &middot; ' + esc(r.note) : ''}</div></div>
    ${r.test ? '<div class="rt-act"><span class="muted">Test alert &mdash; nothing to approve.</span></div>' : '<div class="rt-act"><button class="open sm" data-a="approve">Approve</button><button class="sm" data-a="deny">Deny</button><a class="rt-link" href="/requests">Review all</a></div>'}`;
  el.querySelector('.rt-x').onclick = () => el.remove();
  const rl = el.querySelector('.rt-link'); if (rl) rl.onclick = () => el.remove();
  if (r.test) setTimeout(() => el.remove(), 6000);
  el.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { await api('/api/access/' + r.id + '/' + b.dataset.a, { method: 'POST', body: {} }); el.remove(); note(b.dataset.a === 'approve' ? r.name + ' approved — they are being let in.' : r.name + ' was declined.'); }
    catch (e) { b.disabled = false; note(e.message, true); }
  });
  while (box.querySelectorAll('.rtoast:not(.small)').length >= 4) box.querySelector('.rtoast:not(.small)').remove();
  box.appendChild(el);
}
async function refreshPending() { try { const m = await api('/api/me'); setBadge(m.pending || 0); } catch (e) { } }
function live() {
  if (es) return;
  es = new EventSource('/api/events');
  es.addEventListener('hello', () => { refreshPending(); onLive(); });
  es.addEventListener('request', ev => { const r = JSON.parse(ev.data); setBadge(pendingCount + 1); popup(r); if (pref('sound')) beep(); onLive(); });
  es.addEventListener('update', ev => {
    const r = JSON.parse(ev.data);
    document.querySelectorAll('.rtoast[data-id="' + r.id + '"]').forEach(e => e.remove());
    refreshPending(); onLive();
  });
}

async function renderRequests() {
  $('#view').innerHTML = `<h1>Access requests</h1><p class="sub">People asking to open a tool. You are told here the moment someone asks; approve and they are let in automatically.</p><div id="rList"><div class="empty">Loading…</div></div>`;
  await loadRequests();
}
/* ---------- pagination (10 per page) ---------- */
const PAGE = 10, pg = { pending: 1, recent: 1 };
let DEFAULT_HOURS = 12;
const pref = k => { try { return localStorage.getItem(KEY + '-pref-' + k) !== '0'; } catch (e) { return true; } };
const setPref = (k, v) => { try { localStorage.setItem(KEY + '-pref-' + k, v ? '1' : '0'); } catch (e) { } };
function pager(view, d) {
  if (!d || d.total <= d.size) return '';
  const a = (d.page - 1) * d.size + 1, b = Math.min(d.page * d.size, d.total);
  return `<div class="pager"><span class="muted">Showing ${a}&ndash;${b} of ${d.total}</span><span class="spacer"></span>
    <button class="sm" data-pg="${view}" data-to="${d.page - 1}"${d.page <= 1 ? ' disabled' : ''}>&lsaquo; Prev</button>
    <span class="pgno">Page ${d.page} of ${d.pages}</span>
    <button class="sm" data-pg="${view}" data-to="${d.page + 1}"${d.page >= d.pages ? ' disabled' : ''}>Next &rsaquo;</button></div>`;
}
async function loadRequests() {
  const el = $('#rList'); if (!el) return;
  let P, R;
  try { [P, R] = await Promise.all([api(`/api/access?view=pending&page=${pg.pending}&size=${PAGE}`), api(`/api/access?view=recent&page=${pg.recent}&size=${PAGE}`)]); }
  catch (e) { el.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  pg.pending = P.page; pg.recent = R.page; setBadge(P.total);
  const pill = s => `<span class="pill ${s === 'approved' ? 'ok' : s === 'pending' ? 'warn' : ''}">${esc(s)}</span>`;
  const opt = (h, t) => `<option value="${h}"${h === DEFAULT_HOURS ? ' selected' : ''}>${t}</option>`;
  el.innerHTML = `<h2 class="h2">Waiting for you ${P.total ? `<span class="pill warn">${P.total}</span>` : ''}</h2>
    ${P.items.length ? `<div class="rgrid">${P.items.map(r => `<article class="rcard">
      <div class="rc-top"><span class="avatar sm">${esc(initials(r.name))}</span><div style="min-width:0"><b>${esc(r.name)}</b><div class="muted">${esc(r.email)}</div></div><span class="rc-time">${esc(ago(r.created_at))}</span></div>
      <div class="rc-tool">${svg(toolOf(r.tool).icon)} ${esc(r.toolName)}${r.ip ? `<span class="rc-ip">${esc(r.ip)}</span>` : ''}</div>
      ${r.note ? `<p class="rc-note">&ldquo;${esc(r.note)}&rdquo;</p>` : ''}
      <div class="rc-act"><select data-h="${esc(r.id)}" aria-label="How long">${opt(12, '12 hours')}${opt(1, '1 hour')}${opt(24, '24 hours')}${opt(168, '7 days')}</select>
        <button class="open sm" data-approve="${esc(r.id)}">Approve</button><button class="sm" data-deny="${esc(r.id)}">Deny</button></div></article>`).join('')}</div>${pager('pending', P)}`
      : '<div class="empty">No one is waiting. New requests appear here instantly.</div>'}
    <h2 class="h2">Recent ${R.total ? `<span class="pill">${R.total}</span>` : ''}</h2>
    ${R.items.length ? `<div class="tbl"><table><thead><tr><th>Person</th><th>Tool</th><th>Status</th><th>Decided by</th><th>Access until</th><th></th></tr></thead><tbody>${R.items.map(r => `<tr>
      <td><b>${esc(r.name)}</b><div class="muted">${esc(r.email)}</div></td><td>${esc(r.toolName)}</td><td>${pill(r.status)}</td>
      <td>${esc(r.decided_by || '—')}</td><td>${r.status === 'approved' ? esc(when(r.expires_at)) : '—'}</td>
      <td class="r">${r.status === 'approved' ? `<button class="sm danger" data-revoke="${esc(r.id)}">Revoke</button>` : ''}</td></tr>`).join('')}</tbody></table></div>${pager('recent', R)}` : '<div class="empty">Nothing yet.</div>'}`;
  const act = async (id, what, body, msg) => { try { await api('/api/access/' + id + '/' + what, { method: 'POST', body: body || {} }); note(msg); } catch (e) { note(e.message, true); } loadRequests(); };
  el.querySelectorAll('[data-approve]').forEach(b => b.onclick = () => act(b.dataset.approve, 'approve', { hours: +el.querySelector('[data-h="' + b.dataset.approve + '"]').value }, 'Approved — they are being let in.'));
  el.querySelectorAll('[data-deny]').forEach(b => b.onclick = () => act(b.dataset.deny, 'deny', {}, 'Request declined.'));
  el.querySelectorAll('[data-revoke]').forEach(b => b.onclick = () => { if (confirm('Revoke this person\'s access now? They will be signed out within about 30 seconds.')) act(b.dataset.revoke, 'revoke', {}, 'Access revoked.'); });
  el.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => { pg[b.dataset.pg] = +b.dataset.to; loadRequests(); });
}

/* ---------- Settings: General + Activity log ---------- */
function routeParts() { return location.pathname.replace(/^\/+|\/+$/g, '').split('/'); }
const isActivity = () => routeParts()[0] === 'settings' && routeParts()[1] === 'activity';
const onLive = () => { if (isReqPage()) loadRequests(); if (isActivity()) loadLogs(); if ($('#feed')) { loadDashLive(); const h = $('#hPend'); if (h) h.textContent = pendingCount ? pendingCount + ' waiting for approval' : 'No requests waiting'; } };
const lg = { page: 1, q: '', action: '' };
const EV = {
  'request.created': ['Request received', ''], 'request.approved': ['Approved', 'ok'], 'request.denied': ['Declined', ''], 'request.revoked': ['Access revoked', 'bad'],
  'visitor.entered': ['Visitor entered', 'ok'], 'owner.signin': ['Owner signed in', 'ok'], 'owner.signin_failed': ['Failed sign-in', 'bad'], 'gateway.link_entry': ['Opened from Gateway', ''],
  'approver.link_opened': ['Approver device added', 'warn'], 'approver.link_failed': ['Bad approver link', 'bad'], 'gateway.signin': ['Gateway sign-in', 'ok'], 'gateway.signin_failed': ['Gateway sign-in failed', 'bad'],
  'settings.changed': ['Settings changed', 'warn'], 'user.created': ['User created', ''], 'user.updated': ['User updated', ''], 'user.deleted': ['User deleted', 'bad']
};
async function renderSettings() {
  const tab = isActivity() ? 'activity' : 'general';
  $('#view').innerHTML = `<h1>Settings</h1><p class="sub">Notifications, how access requests behave, and a trail of everything that happens.</p>
    <div class="tabs"><a href="/settings" class="${tab === 'general' ? 'on' : ''}">General</a><a href="/settings/activity" class="${tab === 'activity' ? 'on' : ''}">Activity log</a></div><div id="setBody"></div>`;
  if (tab === 'activity') return renderLogs();
  const body = $('#setBody');
  let S; try { S = await api('/api/settings'); } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  DEFAULT_HOURS = S.defaultHours;
  const sw = (id, on, label, hint) => `<label class="sw"><input type="checkbox" id="${id}"${on ? ' checked' : ''}><span class="sw-t"><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span></label>`;
  body.innerHTML = `<div class="setgrid">
    <section class="setcard"><h2>Notifications on this device</h2>
      ${sw('sSound', pref('sound'), 'Play a sound', 'A short two-tone chime when a new request arrives.')}
      ${sw('sPopup', pref('popup'), 'Show a pop-up', 'A card with Approve and Deny in the corner of the screen.')}
      <button class="sm" id="sTest">Send a test alert</button>
      <p class="muted">The bell and the number badge always update. Requests also appear in the bell inside Payroll and Inventory.</p></section>
    <section class="setcard"><h2>Access requests</h2>
      ${sw('sAccept', S.acceptRequests, 'Accept new requests', 'Turn off to pause: visitors will see that requests are paused.')}
      <label class="fld">Default access length<select id="sHours">${[[1, '1 hour'], [12, '12 hours'], [24, '24 hours'], [168, '7 days']].map(([h, t]) => `<option value="${h}"${h === S.defaultHours ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      <p class="muted">Used when you approve from the bell inside Payroll or Inventory, and as the preselected choice on the Access requests page.</p></section>
    ${S.open ? '<section class="setcard"><h2>Access to this page</h2><p class="muted">The Gateway is open: nobody needs to sign in, and anyone who opens this address can approve requests.</p></section>' : `<section class="setcard"><h2>Approve from another device</h2>
      ${S.hasKey ? `<p class="muted">Open this private link once on another phone or computer and it can approve requests too. Anyone who has it can approve, so keep it private.</p>
      <div class="pwrow"><input readonly id="sLink" value="${esc(S.approverLink)}"><button class="sm" id="sCopy">Copy</button></div>
      <p class="muted">To sign out every approver device at once, change <b>APPROVER_KEY</b> on the Gateway service in Railway.</p>` : '<p class="muted">No approver link is configured (APPROVER_KEY is not set on the Gateway service).</p>'}</section>`}
    ${S.open ? '' : `<section class="setcard"><h2>This device</h2>
      <p class="muted">Signed in as <b>${esc(ME.name)}</b>. Stopping removes this device&rsquo;s approver access until you open the private link again.</p>
      <button class="sm danger" id="sOut">Stop approving on this device</button></section>`}</div>`;
  const put = async (patch, msg) => { try { const r = await api('/api/settings', { method: 'PUT', body: patch }); DEFAULT_HOURS = r.defaultHours; note(msg || 'Saved.'); } catch (e) { note(e.message, true); renderSettings(); } };
  $('#sSound').onchange = e => { setPref('sound', e.target.checked); note('Saved.'); if (e.target.checked) beep(); };
  $('#sPopup').onchange = e => { setPref('popup', e.target.checked); note('Saved.'); };
  $('#sTest').onclick = () => { popup({ id: 'test-' + Date.now(), name: 'Test Person', toolName: 'ARC+ Payroll', email: 'test@example.com', note: 'This is only a test', test: true }, true); if (pref('sound')) beep(); };
  $('#sAccept').onchange = e => put({ acceptRequests: e.target.checked }, e.target.checked ? 'Requests are being accepted.' : 'Requests are paused.');
  $('#sHours').onchange = e => put({ defaultHours: +e.target.value });
  if ($('#sCopy')) $('#sCopy').onclick = async () => { const i = $('#sLink'); try { await navigator.clipboard.writeText(i.value); note('Link copied.'); } catch (e) { i.select(); note('Press Ctrl+C to copy.'); } };
  if ($('#sOut')) $('#sOut').onclick = async () => { if (!confirm('Stop approving on this device?')) return; try { await fetch('/api/logout', { method: 'POST' }); } catch (e) { } location.href = '/'; };
}
async function renderLogs() {
  const body = $('#setBody');
  body.innerHTML = `<div class="logbar"><label class="search lgsearch"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input id="lq" type="search" placeholder="Search name, email, IP, tool…" value="${esc(lg.q)}" autocomplete="off"></label>
    <select id="la" aria-label="Event type"><option value="">All events</option>${Object.entries(EV).map(([k, v]) => `<option value="${k}"${lg.action === k ? ' selected' : ''}>${esc(v[0])}</option>`).join('')}</select>
    <span class="spacer"></span><a class="sm btnlink" id="lcsv" href="/api/logs.csv">Export CSV</a></div><div id="logList"><div class="empty">Loading…</div></div>`;
  let tm = null;
  $('#lq').oninput = e => { clearTimeout(tm); tm = setTimeout(() => { lg.q = e.target.value; lg.page = 1; loadLogs(); }, 250); };
  $('#la').onchange = e => { lg.action = e.target.value; lg.page = 1; loadLogs(); };
  await loadLogs();
}
async function loadLogs() {
  const el = $('#logList'); if (!el) return;
  const qs = `q=${encodeURIComponent(lg.q)}&action=${encodeURIComponent(lg.action)}`;
  const a = $('#lcsv'); if (a) a.href = '/api/logs.csv?' + qs;
  let d; try { d = await api(`/api/logs?${qs}&page=${lg.page}&size=20`); } catch (e) { el.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  lg.page = d.page;
  const dt = ts => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' });
  el.innerHTML = d.items.length ? `<div class="tbl"><table class="logtbl"><thead><tr><th>Time</th><th>Event</th><th>Who</th><th>Email</th><th>Tool</th><th>IP address</th><th>Details</th></tr></thead><tbody>${d.items.map(r => {
    const e = EV[r.action] || [r.action, '']; return `<tr><td class="nw">${esc(dt(r.ts))}</td><td><span class="pill ${e[1]}">${esc(e[0])}</span></td><td>${esc(r.actor || '—')}</td><td>${esc(r.email || '—')}</td><td>${esc(r.toolName || '—')}</td><td class="mono">${esc(r.ip || '—')}</td><td class="muted">${esc(r.detail || '')}</td></tr>`;
  }).join('')}</tbody></table></div>${pager('log', d)}` : '<div class="empty">No activity matches.</div>';
  el.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => { lg.page = +b.dataset.to; loadLogs(); });
}

/* ---------- shell ---------- */
function paintNav(route) {
  const admin = ME.role === 'admin', appr = admin || ME.role === 'approver';
  const link = (href, id, icon, text, extra, attrs) => `<a href="${href}" class="${route === id ? 'on' : ''}" title="${esc(text)}"${attrs || ''}>${svg(icon)}<span class="lbl">${esc(text)}</span>${extra || ''}</a>`;
  $('#nav').innerHTML = `<div class="navlbl">Workspace</div>
    ${link('/', 'dashboard', 'dash', 'Gateway Dashboard')}
    ${appr ? link('/requests', 'requests', 'bell', 'Access requests', `<em class="nbadge" id="navBadge"${pendingCount ? '' : ' hidden'}>${pendingCount}</em>`) : ''}
    ${admin ? link('/admin', 'admin', 'shield', 'Admin Console') : ''}
    <div class="navlbl">Tools</div>
    ${myTools().map(t => t.url
      ? `<a href="/launch/${esc(t.id)}" target="_blank" rel="noopener" title="${esc(t.name)}">${svg(t.icon)}<span class="lbl">${esc(t.name)}</span></a>`
      : `<a class="off" href="/" title="${esc(t.name)} (coming soon)">${svg(t.icon)}<span class="lbl">${esc(t.name)}</span></a>`).join('') || '<span class="navnone">No tools yet</span>'}
    <div class="navlbl">Personal</div>
    ${link('/mytools', 'mytools', 'star', 'My Tools')}
    ${appr ? `<div class="navlbl">System</div>${link('/settings', 'settings', 'gear', 'Settings')}` : ''}`;
}function render() {
  const route = routeParts()[0] || 'dashboard';
  const isAppr = ME.role === 'admin' || ME.role === 'approver';
  const r = (route === 'admin' && ME.role !== 'admin') || ((route === 'requests' || route === 'settings') && !isAppr) ? 'dashboard' : route;
  paintNav(r);
  $('#crumbSub').textContent = { admin: 'Admin console', requests: 'Access requests', settings: 'Settings', mytools: 'My tools' }[r] || 'Internal portal';
  if (r === 'admin') renderAdmin(); else if (r === 'requests') renderRequests(); else if (r === 'settings') renderSettings(); else if (r === 'mytools') renderTools(true); else renderDashboard();
}
/* clean addresses (no #): in-app links change the path without reloading */
const ROUTE = /^\/(requests|settings(\/activity)?|admin|mytools)?\/?$/;
function go(p) { if (p !== location.pathname) history.pushState(null, '', p); document.documentElement.classList.remove('navopen'); window.scrollTo(0, 0); if (ME) render(); }
addEventListener('popstate', () => { document.documentElement.classList.remove('navopen'); if (ME) render(); });
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a[href]'); if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || a.target) return;
  const h = a.getAttribute('href'); if (h && ROUTE.test(h)) { e.preventDefault(); go(h); }
});
{ const m = /^#\/?(requests|settings(\/activity)?|admin|mytools|dashboard)?$/.exec(location.hash); if (m) history.replaceState(null, '', m[1] && m[1] !== 'dashboard' ? '/' + m[1] : '/'); }
$('#q').oninput = e => { query = e.target.value; if (ME && !/^\/(admin|requests|settings)/.test(location.pathname)) render(); };
const isPhone = () => matchMedia('(max-width:900px)').matches;
function setCollapsed(c) { document.documentElement.classList.toggle('collapsed', c); try { localStorage.setItem(KEY + '-coll', c ? '1' : ''); } catch (e) { } $('#burger').setAttribute('aria-expanded', String(!c)); }
try { setCollapsed(localStorage.getItem(KEY + '-coll') === '1'); } catch (e) { }
$('#burger').onclick = () => isPhone() ? document.documentElement.classList.toggle('navopen') : setCollapsed(!document.documentElement.classList.contains('collapsed'));
addEventListener('keydown', e => { if (e.key === '[' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) $('#burger').click(); });
$('#scrim').onclick = () => document.documentElement.classList.remove('navopen');
function setTheme(t) { document.documentElement.dataset.theme = t; try { localStorage.setItem(KEY + '-theme', t); } catch (e) { } }
(function () { let t = 'light'; try { t = localStorage.getItem(KEY + '-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch (e) { } setTheme(t); })();
$('#themeBtn').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
$('#pwBtn').onclick = passwordDialog;
$('#bellBtn').onclick = () => go('/requests');
$('#outBtn').onclick = async () => { try { await fetch('/api/logout', { method: 'POST' }); } catch (e) { } location.href = '/'; };

(async function boot() {
  try {
    ME = await api('/api/me');
    const guest = !ME.signedIn, admin = ME.role === 'admin', appr = admin || ME.role === 'approver';
    document.querySelector('.user').hidden = guest;
    $('#bellBtn').hidden = !appr;
    $('#pwBtn').hidden = ME.role === 'approver';
    if (!guest) {
      const av = $('#uAvatar'); av.classList.add('logo'); av.innerHTML = '<img src="logo.png" alt="">';
      $('#uName').textContent = ME.name; $('#uRole').textContent = ME.role === 'approver' ? 'ARC+ Gateway' : admin ? 'Super Admin' : 'User';
    }
    if (appr) { setBadge(ME.pending || 0); live(); api('/api/settings').then(s => { DEFAULT_HOURS = s.defaultHours; }).catch(() => { }); }
    render();
  } catch (e) { /* api() redirects to /login when an admin page is opened without a session */ }
})();

(function () {
  /* entrance animation: after signing in or being approved, the app slides and fades in */
  try {
    if (sessionStorage.getItem('arc-just-signed')) {
      sessionStorage.removeItem('arc-just-signed');
      if (!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
        var st = document.createElement('style');
        st.textContent = '@keyframes arcin{from{opacity:0;transform:translateY(16px) scale(.996)}to{opacity:1;transform:none}}@keyframes arcside{from{opacity:0;transform:translateX(-18px)}to{opacity:1;transform:none}}' +
          'html.arc-enter .app{animation:arcin .75s cubic-bezier(.2,.7,.2,1) both}html.arc-enter aside{animation:arcside .7s .05s cubic-bezier(.2,.7,.2,1) both}';
        document.head.appendChild(st); document.documentElement.classList.add('arc-enter');
        setTimeout(function () { document.documentElement.classList.remove('arc-enter'); }, 1300);
      }
    }
  } catch (e) { }
})();
