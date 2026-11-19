/* ============================================================
   ARC+ Gateway VERSION  +  "What's new" modal (same as Payroll, Inventory and Procurement)
   EVERY TIME YOU PUSH AN UPDATE:
     1. add a new entry at the TOP of APP_CHANGELOG
     2. set APP_VERSION to the same version (and package.json "version")
   Entry shape:  { v, date, title, new:[...], improved:[...], fixed:[...] }
   ============================================================ */
const APP_VERSION = '1.7.0';
const APP_CHANGELOG = [
  { v: '1.7.0', date: '2026-11-19', title: 'Notifications in the bell',
    new: ['The bell now lists what happened: password changes and resets, sign-ins and failed sign-ins, approvals, declines and revocations, user and settings changes.', 'New events appear live with a short message and a number on the bell; opening the bell marks them as read.'],
    improved: ['Changing your password shows a message in the corner instead of a browser pop-up.', 'Refresh button in the header: a hard refresh that fetches everything fresh.'] },
  { v: '1.6.1', date: '2026-11-19', title: 'Sign-in is required',
    improved: ['The Gateway now shows nothing until you sign in: visitors and signed-out people go straight to the sign-in page.', 'Sign out moved to the bottom of the sidebar, like the other ARC+ apps.'] },
  { v: '1.6.0', date: '2026-11-19', title: 'Change password and Forgot password',
    new: ['Change password in Settings.', 'Forgot password? on the sign-in page: one click emails a link to the ARC email to choose a new password. The link works once and expires in 30 minutes.'],
    improved: ['Password changes and resets are recorded in the activity log.'] },
  { v: '1.5.0', date: '2026-11-19', title: 'Sign in and sign out are back',
    new: ['Sign in button in the header for admins and approvers, and Sign out once you are in.', 'A fourth card on the dashboard: always at least four, with a \u201CMore tools coming\u201D tile when there are fewer tools.'],
    improved: ['Visitors see the tools and open them as before; Settings, Access requests and the activity log need an approver or admin.'] },
  { v: '1.4.0', date: '2026-11-19', title: 'Procurement, wider dashboard and ARC+ wording',
    new: ['ARC+ Procurement is on the dashboard, with its own Online / Offline status.', 'What\u2019s new button in the sidebar, like the other ARC+ apps.'],
    improved: ['The dashboard now uses the full width of the screen and the tool cards share the row evenly.', 'Brand text says ARC+ everywhere, including the sign-in captions.', 'The profile circle shows the ARC+ logo.'] },
  { v: '1.3.0', date: '2026-11-17', title: 'Open Gateway and clean addresses',
    new: ['The Gateway opens straight to the dashboard: no sign-in, no password.', 'Clean page addresses such as /requests and /settings instead of #requests.'],
    improved: ['Payroll and Inventory now have their own arcdesignconstructions.com addresses.', 'The sign-out button is gone, since nobody signs in.'] },
  { v: '1.2.0', date: '2026-11-16', title: 'New dashboard',
    new: ['Hero banner with a greeting, live clock and a slideshow of ARC project photos.', 'Number cards that count up: tools online, requests waiting, approvals, entries and failed sign-ins in the last 24 hours.', 'Live Online / Offline dots on every tool card.'],
    improved: ['Cards rise in, lift and glow on hover; the Open App buttons shine.', 'Animations are switched off for people who prefer reduced motion.'] },
  { v: '1.1.0', date: '2026-11-16', title: 'Settings, activity log and a collapsible sidebar',
    new: ['Settings page with sound and pop-up options, the default access length and a switch to pause requests.', 'Activity log of every request, approval and sign-in with the time, name, email and IP address, searchable and exportable to CSV.', 'Burger button in the header to collapse the sidebar (press "[" too).'],
    improved: ['Lists show 10 rows per page.', 'Welcome animation when someone gets in.'] },
  { v: '1.0.0', date: '2026-11-16', title: 'ARC+ Gateway',
    new: ['One place to open every ARC+ tool.', 'Access requests: people ask on a tool\u2019s sign-in page, approvers are told instantly in the bell and in a pop-up, and an approved person enters automatically.', 'Light and dark theme, searchable tool cards and favourites in My Tools.'] }
];

const verEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const verSeenKey = () => 'arc-gateway-v1-ver-seen';
function verGetSeen() { try { return localStorage.getItem(verSeenKey()) || ''; } catch (e) { return ''; } }
function verSetSeen() { try { localStorage.setItem(verSeenKey(), APP_VERSION); } catch (e) { } verPaintBadge(); }
function verPaintBadge() {
  const b = document.getElementById('verBtn'); if (!b) return;
  const unseen = verGetSeen() !== APP_VERSION;
  b.innerHTML = `<span class="vtag">v${APP_VERSION}</span><span class="vtxt">What&rsquo;s new</span>${unseen ? '<i class="vdot" title="New update"></i>' : ''}`;
  b.title = 'ARC+ Gateway v' + APP_VERSION + ' - see what\u2019s new';
}
const verFmt = d => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
function verCmp(a, b) {                                   // 1 if a > b
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1; }
  return 0;
}
function verOpen() {
  let d = document.getElementById('verDlg');
  if (!d) {
    d = document.createElement('dialog'); d.id = 'verDlg'; d.className = 'ver';
    document.body.appendChild(d);
    d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-ver-close]')) d.close(); });
  }
  const seen = verGetSeen();
  const sec = (label, cls, list) => list && list.length ? `<div class="vsec ${cls}"><span class="vlab">${label}</span><ul>${list.map(t => `<li>${verEsc(t)}</li>`).join('')}</ul></div>` : '';
  d.innerHTML = `<div class="v-head"><div><b>What&rsquo;s new in ARC+ Gateway</b><small>You&rsquo;re on <strong>v${APP_VERSION}</strong> &middot; ${APP_CHANGELOG.length} releases</small></div><button type="button" class="v-x" data-ver-close aria-label="Close">&times;</button></div>
    <div class="v-body">${APP_CHANGELOG.map((r, i) => {
      const isNew = seen !== APP_VERSION && (!seen || verCmp(r.v, seen) > 0);
      return `<article class="vrel${i === 0 ? ' latest' : ''}">
        <div class="vmeta"><span class="vnum">v${verEsc(r.v)}</span>${i === 0 ? '<span class="vbadge cur">Current</span>' : ''}${isNew ? '<span class="vbadge nw">New</span>' : ''}<span class="vdate">${verFmt(r.date)}</span></div>
        <h4>${verEsc(r.title)}</h4>${sec('New', 'n', r.new)}${sec('Improved', 'i', r.improved)}${sec('Fixed', 'f', r.fixed)}</article>`;
    }).join('')}</div>
    <div class="v-foot"><span class="muted">Version numbers go up with every update we push.</span><span class="spacer"></span><button type="button" class="open sm" data-ver-close>Got it</button></div>`;
  d.onclose = verSetSeen;
  d.showModal();
  d.querySelector('.v-body').scrollTop = 0;
}
function verInit() {
  const b = document.getElementById('verBtn'); if (!b) return;
  b.onclick = verOpen; verPaintBadge();
  if (verGetSeen() !== APP_VERSION) setTimeout(() => { if (!document.querySelector('dialog[open]')) verOpen(); }, 1400);   // show once per update
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', verInit); else verInit();