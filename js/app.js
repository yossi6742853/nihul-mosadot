// ניהול מוסדות — main app router + login + dashboard

// ---- Theme -----------------------------------------------------------
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('nihul_theme', t); } catch {}
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.innerHTML = t === 'dark' ? '<i class="bi bi-sun"></i>' : '<i class="bi bi-moon-stars"></i>';
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}
window.toggleTheme = toggleTheme;
try { if (localStorage.getItem('nihul_theme') === 'dark') applyTheme('dark'); } catch {}

// ---- toast / loading -------------------------------------------------
function notify(msg, type) {
  const c = document.querySelector('.toast-container');
  if (!c) return alert(msg);
  const icons = {success:'bi-check-circle-fill', error:'bi-exclamation-triangle-fill', warn:'bi-exclamation-circle-fill'};
  const colors = {success:'#1a7f37', error:'#cf222e', warn:'#bf8700'};
  const icon = icons[type] || 'bi-info-circle-fill';
  const div = document.createElement('div');
  div.className = `toast-msg ${type||''}`;
  div.innerHTML = `<i class="bi ${icon}" style="color:${colors[type]||'#0969da'};font-size:1.3rem"></i><span>${msg}</span>`;
  c.appendChild(div);
  setTimeout(() => { div.classList.add('fadeOut'); setTimeout(() => div.remove(), 300); }, 3500);
}
window.notify = notify;

function showLoading(text) {
  const o = document.getElementById('loading-overlay');
  o.classList.remove('d-none');
  document.getElementById('loading-text').textContent = text || 'טוען…';
}
function hideLoading() { document.getElementById('loading-overlay').classList.add('d-none'); }
window.showLoading = showLoading; window.hideLoading = hideLoading;

// ---- helpers ---------------------------------------------------------
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escAttr(s) { return escHtml(s); }
window.escHtml = escHtml; window.escAttr = escAttr;

function fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('he-IL', {style:'currency', currency:'ILS', maximumFractionDigits:0});
}
function fmtDate(d) {
  if (!d && d !== 0) return '';
  const dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('he-IL');
}
function fmtDateTime(d) {
  if (!d && d !== 0) return '';
  const dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleString('he-IL');
}
function statusClass(s) {
  s = String(s||'').trim();
  if (s === 'מאושר') return 'approved';
  if (s === 'שולם') return 'paid';
  if (s === 'ממתין לאישור') return 'pending';
  if (s === 'בוטל') return 'cancelled';
  return 'draft';
}
window.fmtMoney = fmtMoney; window.fmtDate = fmtDate; window.fmtDateTime = fmtDateTime; window.statusClass = statusClass;

// ---- state -----------------------------------------------------------
const State = {
  user: null,
  orgs: [],
  currentOrgId: null,
  currentView: 'home',
  cache: {},
};
window.State = State;

// ---- routing ---------------------------------------------------------
const PAGES = ['login','home','table','audit','orgs','users','reports'];
function showPage(name) {
  PAGES.forEach(p => document.getElementById('page-' + p).classList.toggle('d-none', p !== name));
}

function goto(view) {
  State.currentView = view;
  if (view === 'home')         { showPage('home'); renderDashboard(); }
  else if (view === 'audit')   { showPage('audit'); renderAudit(); }
  else if (view === 'orgs')    { showPage('orgs'); renderOrgs(); }
  else if (view === 'users')   { showPage('users'); renderUsers(); }
  else if (view === 'reports') { showPage('reports'); renderReports(); }
  else                         { showPage('table'); renderTable(view); }
  history.pushState({view}, '', '#' + encodeURIComponent(view));
}
window.goto = goto;

window.addEventListener('popstate', e => {
  const v = (e.state && e.state.view) || 'home';
  if (State.user) goto(v); else showPage('login');
});

// ---- login -----------------------------------------------------------
async function doLogin() {
  const u = document.getElementById('username').value.trim();
  const p = document.getElementById('password').value;
  if (!u || !p) { notify('הזן שם משתמש וסיסמה', 'warn'); return; }
  const errEl = document.getElementById('login-error');
  errEl.classList.add('d-none');
  const btn = document.getElementById('login-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> מתחבר…';
  try {
    const r = await api('authenticate', [u, p]);
    const auth = r.data || r;
    if (!r.ok) { errEl.textContent = r.error || 'שגיאת חיבור'; errEl.classList.remove('d-none'); return; }
    if (auth.ok === false) { errEl.textContent = auth.error || 'שם משתמש או סיסמה שגויים'; errEl.classList.remove('d-none'); return; }
    State.user = auth.user;
    setSession(State.user);
    await afterLogin();
  } catch (e) {
    errEl.textContent = 'שגיאה: ' + (e.message||e);
    errEl.classList.remove('d-none');
  } finally {
    btn.disabled = false; btn.innerHTML = 'כניסה';
  }
}

async function afterLogin() {
  document.getElementById('user-info').innerHTML =
    `<i class="bi ${State.user.role==='admin'?'bi-shield-fill-check':'bi-person-circle'}"></i> ` +
    `${escHtml(State.user.name || State.user.username)} ` +
    `<button class="btn btn-sm btn-outline-light ms-2" onclick="logout()">יציאה</button>`;
  const r = await api('listOrgs', []);
  if (r.ok) State.orgs = r.data || [];
  if (State.user.role !== 'admin' && State.user.org_id) {
    State.orgs = State.orgs.filter(o => o.id === State.user.org_id);
  }
  if (State.user.role === 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('d-none'));
  }
  if (State.orgs.length) {
    State.currentOrgId = State.orgs[0].id;
    populateOrgPicker();
  }
  goto('home');
}

function populateOrgPicker() {
  const sel = document.getElementById('orgSelect');
  sel.innerHTML = State.orgs.map(o => `<option value="${escAttr(o.id)}">${escHtml(o.name)}</option>`).join('');
  if (State.orgs.length > 1) document.getElementById('org-picker').classList.remove('d-none');
  sel.onchange = () => { State.currentOrgId = sel.value; State.cache = {}; goto(State.currentView); };
}

function logout() {
  clearSession();
  cacheClear();
  location.reload();
}
window.logout = logout;

// ---- dashboard -------------------------------------------------------
let _chart = null;

async function renderDashboard() {
  const org = currentOrg();
  if (!org) {
    if (State.user.role === 'admin') return renderAdminDashboard();
    document.getElementById('home-org-name').textContent = '— אין מוסד פעיל —';
    return;
  }
  document.getElementById('home-org-name').textContent = '— ' + org.name;
  ['stat-total','stat-used','stat-remaining','stat-rows','stat-pct'].forEach(id => document.getElementById(id).textContent = '…');
  try {
    const r = await api('summary', [State.user.username, org.id]);
    if (!r.ok) { notify(r.error||'שגיאה','error'); return; }
    const s = r.data;
    document.getElementById('stat-total').textContent     = fmtMoney(s.budget_total);
    document.getElementById('stat-used').textContent      = fmtMoney(s.used);
    const remEl = document.getElementById('stat-remaining');
    remEl.textContent = fmtMoney(s.remaining);
    remEl.className = 'display-6 ' + (s.remaining < 0 ? 'text-danger' : 'text-success');
    const totalRows = s.tabs.reduce((a, t) => a + t.count, 0);
    document.getElementById('stat-rows').textContent = totalRows;
    const pct = s.budget_total > 0 ? Math.round(s.used / s.budget_total * 100) : 0;
    document.getElementById('stat-pct').textContent = pct + '%';
    const bar = document.getElementById('stat-bar');
    bar.style.width = Math.min(100, pct) + '%';
    bar.className = 'progress-bar ' + (pct > 100 ? 'bg-danger' : pct > 85 ? 'bg-warning' : 'bg-primary');
    drawTabsChart(s.tabs);
    loadRecentActivity();
    if (typeof loadDashboardAlerts === 'function') loadDashboardAlerts();
  } catch (e) { notify('שגיאה: ' + e.message, 'error'); }
}

function drawTabsChart(tabs) {
  const ctx = document.getElementById('tabs-chart');
  if (!ctx) return;
  if (_chart) _chart.destroy();
  _chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: tabs.map(t => t.name),
      datasets: [{
        data: tabs.map(t => t.sum),
        backgroundColor: ['#0969da','#1a7f37','#bf8700','#cf222e'],
        borderColor: 'transparent'
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: c => `${c.label}: ${fmtMoney(c.raw)}` } }
      }
    }
  });
}

async function loadRecentActivity() {
  const el = document.getElementById('recent-activity');
  el.innerHTML = '<div class="text-muted">טוען…</div>';
  const r = await api('audit', [State.user.username, State.currentOrgId, 12]);
  if (!r.ok || !r.data || !r.data.rows || !r.data.rows.length) {
    el.innerHTML = '<div class="text-muted small">אין פעולות אחרונות.</div>';
    return;
  }
  el.innerHTML = r.data.rows.map(row => `
    <div class="item">
      <div><span class="who">${escHtml(row[1])}</span> · ${escHtml(row[2])}</div>
      <div class="meta">${fmtDateTime(row[0])} · ${escHtml(row[3]||'')} ${row[4]?'#'+escHtml(row[4]):''}</div>
    </div>`).join('');
}

async function renderAdminDashboard() {
  document.getElementById('home-org-name').textContent = '— תצוגת אדמין';
  showLoading('טוען סיכום כללי…');
  const r = await api('globalSummary', [State.user.username]);
  hideLoading();
  if (!r.ok) { notify(r.error,'error'); return; }
  const orgs = r.data || [];
  let totalBudget = 0, totalUsed = 0, totalRows = 0;
  orgs.forEach(o => {
    if (!o.error) {
      totalBudget += o.budget_total||0;
      totalUsed += o.used||0;
      totalRows += (o.tabs||[]).reduce((a,t)=>a+t.count,0);
    }
  });
  document.getElementById('stat-total').textContent = fmtMoney(totalBudget);
  document.getElementById('stat-used').textContent  = fmtMoney(totalUsed);
  const remEl = document.getElementById('stat-remaining');
  remEl.textContent = fmtMoney(totalBudget - totalUsed);
  remEl.className = 'display-6 ' + ((totalBudget-totalUsed)<0?'text-danger':'text-success');
  document.getElementById('stat-rows').textContent = totalRows;
  const pct = totalBudget>0 ? Math.round(totalUsed/totalBudget*100) : 0;
  document.getElementById('stat-pct').textContent = pct + '%';
  const bar = document.getElementById('stat-bar');
  bar.style.width = Math.min(100, pct) + '%';
  bar.className = 'progress-bar ' + (pct > 100 ? 'bg-danger' : pct > 85 ? 'bg-warning' : 'bg-primary');

  if (_chart) _chart.destroy();
  const ctx = document.getElementById('tabs-chart');
  _chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: orgs.map(o => o.org_name),
      datasets: [
        {label: 'תקציב', data: orgs.map(o => o.budget_total||0), backgroundColor: '#0969da'},
        {label: 'נוצל',  data: orgs.map(o => o.used||0),         backgroundColor: '#cf222e'}
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmtMoney(c.raw)}` } }
      },
      scales: { y: { ticks: { callback: v => fmtMoney(v) } } }
    }
  });
  loadRecentActivity();
}

function currentOrg() {
  return State.orgs.find(o => o.id === State.currentOrgId);
}
window.currentOrg = currentOrg;

// ---- bootstrap on load -----------------------------------------------
document.getElementById('login-btn').onclick = doLogin;
document.getElementById('password').addEventListener('keypress', e => { if (e.key === 'Enter') doLogin(); });

(async function startup() {
  const params = new URLSearchParams(location.search);
  const u = params.get('u'); const p = params.get('p');
  const stored = getSession();
  if (stored) {
    State.user = stored;
    await afterLogin();
    return;
  }
  if (u && p) {
    document.getElementById('username').value = u;
    document.getElementById('password').value = p;
    setTimeout(doLogin, 300);
  }
})();
