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
  bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'
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
const isReqPage = () => (location.hash.slice(1) || '').split('/')[0] === 'requests';

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
function popup(r) {
  const box = $('#toasts'); if (!box || box.querySelector('.rtoast[data-id="' + r.id + '"]')) return;
  const el = document.createElement('div'); el.className = 'rtoast'; el.dataset.id = r.id;
  el.innerHTML = `<div class="rt-top"><b>New access request</b><button class="rt-x" aria-label="Dismiss">&times;</button></div>
    <div class="rt-body"><b>${esc(r.name)}</b> wants to open <b>${esc(r.toolName)}</b><div class="muted">${esc(r.email)}${r.note ? ' &middot; ' + esc(r.note) : ''}</div></div>
    <div class="rt-act"><button class="open sm" data-a="approve">Approve</button><button class="sm" data-a="deny">Deny</button><a class="rt-link" href="#requests">Review all</a></div>`;
  el.querySelector('.rt-x').onclick = () => el.remove();
  el.querySelector('.rt-link').onclick = () => el.remove();
  el.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { await api('/api/access/' + r.id + '/' + b.dataset.a, { method: 'POST', body: {} }); el.remove(); note(b.dataset.a === 'approve' ? r.name + ' approved — they are being let in.' : r.name + ' was declined.'); }
    catch (e) { b.disabled = false; note(e.message, true); }
  });
  while (box.querySelectorAll('.rtoast:not(.small)').length >= 4) box.querySelector('.rtoast:not(.small)').remove();
  box.appendChild(el); beep();
}
async function refreshPending() { try { const m = await api('/api/me'); setBadge(m.pending || 0); } catch (e) { } }
function live() {
  if (es) return;
  es = new EventSource('/api/events');
  es.addEventListener('hello', () => { refreshPending(); if (isReqPage()) loadRequests(); });
  es.addEventListener('request', ev => { const r = JSON.parse(ev.data); setBadge(pendingCount + 1); popup(r); if (isReqPage()) loadRequests(); });
  es.addEventListener('update', ev => {
    const r = JSON.parse(ev.data);
    document.querySelectorAll('.rtoast[data-id="' + r.id + '"]').forEach(e => e.remove());
    refreshPending(); if (isReqPage()) loadRequests();
  });
}

async function renderRequests() {
  $('#view').innerHTML = `<h1>Access requests</h1><p class="sub">People asking to open a tool. You are told here the moment someone asks; approve and they are let in automatically.</p><div id="rList"><div class="empty">Loading…</div></div>`;
  await loadRequests();
}
async function loadRequests() {
  const el = $('#rList'); if (!el) return;
  try { reqs = await api('/api/access'); } catch (e) { el.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const pend = reqs.filter(r => r.status === 'pending'), rest = reqs.filter(r => r.status !== 'pending');
  setBadge(pend.length);
  const pill = s => `<span class="pill ${s === 'approved' ? 'ok' : s === 'pending' ? 'warn' : ''}">${esc(s)}</span>`;
  el.innerHTML = `<h2 class="h2">Waiting for you ${pend.length ? `<span class="pill warn">${pend.length}</span>` : ''}</h2>
    ${pend.length ? `<div class="rgrid">${pend.map(r => `<article class="rcard">
      <div class="rc-top"><span class="avatar sm">${esc(initials(r.name))}</span><div style="min-width:0"><b>${esc(r.name)}</b><div class="muted">${esc(r.email)}</div></div><span class="rc-time">${esc(ago(r.created_at))}</span></div>
      <div class="rc-tool">${svg(toolOf(r.tool).icon)} ${esc(r.toolName)}</div>
      ${r.note ? `<p class="rc-note">&ldquo;${esc(r.note)}&rdquo;</p>` : ''}
      <div class="rc-act"><select data-h="${esc(r.id)}" aria-label="How long"><option value="12" selected>12 hours</option><option value="1">1 hour</option><option value="24">24 hours</option><option value="168">7 days</option></select>
        <button class="open sm" data-approve="${esc(r.id)}">Approve</button><button class="sm" data-deny="${esc(r.id)}">Deny</button></div></article>`).join('')}</div>`
      : '<div class="empty">No one is waiting. New requests appear here instantly.</div>'}
    <h2 class="h2">Recent</h2>
    ${rest.length ? `<div class="tbl"><table><thead><tr><th>Person</th><th>Tool</th><th>Status</th><th>Decided by</th><th>Access until</th><th></th></tr></thead><tbody>${rest.map(r => `<tr>
      <td><b>${esc(r.name)}</b><div class="muted">${esc(r.email)}</div></td><td>${esc(r.toolName)}</td><td>${pill(r.status)}</td>
      <td>${esc(r.decided_by || '—')}</td><td>${r.status === 'approved' ? esc(when(r.expires_at)) : '—'}</td>
      <td class="r">${r.status === 'approved' ? `<button class="sm danger" data-revoke="${esc(r.id)}">Revoke</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Nothing yet.</div>'}`;
  const act = async (id, what, body, msg) => { try { await api('/api/access/' + id + '/' + what, { method: 'POST', body: body || {} }); note(msg); } catch (e) { note(e.message, true); } loadRequests(); };
  el.querySelectorAll('[data-approve]').forEach(b => b.onclick = () => act(b.dataset.approve, 'approve', { hours: +el.querySelector('[data-h="' + b.dataset.approve + '"]').value }, 'Approved — they are being let in.'));
  el.querySelectorAll('[data-deny]').forEach(b => b.onclick = () => act(b.dataset.deny, 'deny', {}, 'Request declined.'));
  el.querySelectorAll('[data-revoke]').forEach(b => b.onclick = () => { if (confirm('Revoke this person\'s access now? They will be signed out within about 30 seconds.')) act(b.dataset.revoke, 'revoke', {}, 'Access revoked.'); });
}

/* ---------- shell ---------- */
function paintNav(route) {
  const admin = ME.role === 'admin', appr = admin || ME.role === 'approver';
  $('#nav').innerHTML = `<div class="navlbl">Workspace</div>
    <a href="#dashboard" class="${route === 'dashboard' ? 'on' : ''}">${svg('dash')}Gateway Dashboard</a>
    ${appr ? `<a href="#requests" class="${route === 'requests' ? 'on' : ''}">${svg('bell')}Access requests<em class="nbadge" id="navBadge"${pendingCount ? '' : ' hidden'}>${pendingCount}</em></a>`  : ''}
    ${admin ? `<a href="#admin" class="${route === 'admin' ? 'on' : ''}">${svg('shield')}Admin Console</a>` : ''}
    <div class="navlbl">Tools</div>
    ${myTools().map(t => t.url
      ? `<a href="/launch/${esc(t.id)}" target="_blank" rel="noopener">${svg(t.icon)}${esc(t.name)}</a>`
      : `<a class="off" href="#dashboard" title="Coming soon">${svg(t.icon)}${esc(t.name)}</a>`).join('') || '<span class="navnone">No tools yet</span>'}
    <div class="navlbl">Personal</div>
    <a href="#mytools" class="${route === 'mytools' ? 'on' : ''}">${svg('star')}My Tools</a>`;
}
function render() {
  const route = (location.hash.slice(1) || 'dashboard').split('/')[0];
  const isAppr = ME.role === 'admin' || ME.role === 'approver';
  const r = (route === 'admin' && ME.role !== 'admin') || (route === 'requests' && !isAppr) ? 'dashboard' : route;
  paintNav(r);
  $('#crumbSub').textContent = { admin: 'Admin console', requests: 'Access requests', mytools: 'My tools' }[r] || 'Internal portal';
  if (r === 'admin') renderAdmin(); else if (r === 'requests') renderRequests(); else renderTools(r === 'mytools');
}
addEventListener('hashchange', () => { document.documentElement.classList.remove('navopen'); if (ME) render(); });
$('#q').oninput = e => { query = e.target.value; if (ME && !/^#(admin|requests)/.test(location.hash)) render(); };
$('#burger').onclick = () => document.documentElement.classList.toggle('navopen');
$('#scrim').onclick = () => document.documentElement.classList.remove('navopen');
function setTheme(t) { document.documentElement.dataset.theme = t; try { localStorage.setItem(KEY + '-theme', t); } catch (e) { } }
(function () { let t = 'light'; try { t = localStorage.getItem(KEY + '-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch (e) { } setTheme(t); })();
$('#themeBtn').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
$('#pwBtn').onclick = passwordDialog;
$('#bellBtn').onclick = () => { location.hash = 'requests'; };
$('#outBtn').onclick = async () => { try { await fetch('/api/logout', { method: 'POST' }); } catch (e) { } location.href = '/'; };

(async function boot() {
  try {
    ME = await api('/api/me');
    const guest = !ME.signedIn, admin = ME.role === 'admin', appr = admin || ME.role === 'approver';
    document.querySelector('.user').hidden = guest;
    $('#bellBtn').hidden = !appr;
    $('#pwBtn').hidden = ME.role === 'approver';
    if (!guest) {
      $('#uAvatar').textContent = initials(ME.name || ME.username);
      $('#uName').textContent = ME.name; $('#uRole').textContent = admin ? 'Super Admin' : ME.role === 'approver' ? 'Approver' : 'User';
    }
    if (appr) { setBadge(ME.pending || 0); live(); }
    render();
  } catch (e) { /* api() redirects to /login when an admin page is opened without a session */ }
})();
