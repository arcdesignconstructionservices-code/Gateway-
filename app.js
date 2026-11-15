/* ARC+ Gateway — launcher. Tools come from tools.js. */
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
  open: '<path d="M7 17 17 7M8 7h9v9"/>'
};
const svg = n => `<svg viewBox="0 0 24 24">${ICONS[n] || ICONS.doc}</svg>`;

/* ---------- favourites (kept in this browser) ---------- */
let favs = [];
try { favs = JSON.parse(localStorage.getItem(KEY + '-favs')) || []; } catch (e) { favs = []; }
const saveFavs = () => { try { localStorage.setItem(KEY + '-favs', JSON.stringify(favs)); } catch (e) { } };
const isFav = id => favs.includes(id);

/* ---------- views ---------- */
let query = '';
function match(t) {
  const q = query.trim().toLowerCase();
  return !q || (t.name + ' ' + t.desc + ' ' + t.group).toLowerCase().includes(q);
}
function card(t) {
  const live = !!t.url;
  return `<article class="card">
    <div class="card-top"><div class="tico">${svg(t.icon)}</div><span class="status${live ? '' : ' soon'}"><i></i>${live ? 'Active' : 'Coming soon'}</span></div>
    <h3>${esc(t.name)}</h3>
    <p>${esc(t.desc)}</p>
    <div class="chips"><span class="chip">${esc(t.group)}</span>${live ? '<span class="chip ok">Access granted</span>' : ''}</div>
    <div class="card-act">
      <a class="open${live ? '' : ' disabled'}" ${live ? `href="${esc(t.url)}" target="_blank" rel="noopener"` : 'aria-disabled="true"'}>Open App ${svg('open')}</a>
      <button class="star${isFav(t.id) ? ' on' : ''}" data-fav="${esc(t.id)}" title="${isFav(t.id) ? 'Remove from My Tools' : 'Add to My Tools'}" aria-label="Toggle favourite">${svg('star')}</button>
    </div>
  </article>`;
}
function render() {
  const route = (location.hash.slice(1) || 'dashboard').split('/')[0];
  const mine = route === 'mytools';
  const list = GATEWAY_TOOLS.filter(t => (!mine || isFav(t.id)) && match(t));
  $('#view').innerHTML = `<h1>${mine ? 'My Tools' : 'Your Tools'}</h1>
    <p class="sub">${mine ? 'Tools you starred. Click the star on any card to add or remove it.' : 'Tools you can open right now. Each one launches in a new tab.'}</p>
    ${list.length ? `<div class="grid">${list.map(card).join('')}</div>`
      : `<div class="empty">${mine && !query ? 'No favourites yet — star a tool on the dashboard.' : 'No tools match your search.'}</div>`}`;
  $('#crumbSub').textContent = mine ? 'My tools' : 'Internal portal';
  paintNav(route);
  $('#view').querySelectorAll('[data-fav]').forEach(b => b.onclick = () => {
    const id = b.dataset.fav;
    favs = isFav(id) ? favs.filter(x => x !== id) : [...favs, id]; saveFavs(); render();
  });
}
function paintNav(route) {
  $('#nav').innerHTML = `<div class="navlbl">Workspace</div>
    <a href="#dashboard" class="${route !== 'mytools' ? 'on' : ''}">${svg('dash')}Gateway Dashboard</a>
    <div class="navlbl">Tools</div>
    ${GATEWAY_TOOLS.map(t => t.url
      ? `<a href="${esc(t.url)}" target="_blank" rel="noopener">${svg(t.icon)}${esc(t.name)}</a>`
      : `<a class="off" href="#dashboard" title="Coming soon">${svg(t.icon)}${esc(t.name)}</a>`).join('')}
    <div class="navlbl">Personal</div>
    <a href="#mytools" class="${route === 'mytools' ? 'on' : ''}">${svg('star')}My Tools</a>`;
}
addEventListener('hashchange', () => { document.documentElement.classList.remove('navopen'); render(); });
$('#q').oninput = e => { query = e.target.value; render(); };

/* ---------- chrome ---------- */
$('#burger').onclick = () => document.documentElement.classList.toggle('navopen');
$('#scrim').onclick = () => document.documentElement.classList.remove('navopen');
function setTheme(t) { document.documentElement.dataset.theme = t; try { localStorage.setItem(KEY + '-theme', t); } catch (e) { } }
(function () { let t = 'light'; try { t = localStorage.getItem(KEY + '-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch (e) { } setTheme(t); })();
$('#themeBtn').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

render();
