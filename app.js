// ============================================================
// ניהול מוסדות — SPA (vanilla JS, Sheets API ישירות מהדפדפן)
// ============================================================

const State = {
  user: null,           // {email, role: 'admin'|'manager'}
  orgs: [],             // [{id, name, sheet_id, manager_email, budget_total, ...}]
  users: [],            // [{email, role, org_id, name}]
  currentOrgId: null,
  currentView: 'dashboard',
  cache: {},            // {`${orgId}:${sheet}`: {headers, rows}}
  tokenClient: null,
  accessToken: null,
};

// ============================================================
// 0. Setup wizard (when CLIENT_ID is missing)
// ============================================================

function showSetupWizard() {
  const m = document.getElementById('main');
  const origin = location.origin;
  const links = (CONFIG.QUICK_LINKS || []).map(l =>
    `<a class="link-card" target="_blank" href="https://docs.google.com/spreadsheets/d/${l.id}/edit">
      <span class="logo-mini">📊</span>
      <div><b>${l.name}</b><div class="muted small">לחץ לפתיחה ב-Google Sheets</div></div>
    </a>`).join('');
  m.innerHTML = `
  <div class="card setup-panel">
    <h2>👋 ברוך הבא ל"ניהול מוסדות"</h2>
    <p>הספרדשיטים שלך מוכנים. עד שנשלים את הגדרת ה-Dashboard המלא (פעם אחת — ראה למטה), תוכל לעבוד ישירות מתוך Google Sheets:</p>
    <div class="links-grid">${links}</div>

    <details style="margin-top:24px;">
      <summary class="muted" style="cursor:pointer">🔧 הפעלת מצב Dashboard מלא (אופציונלי)</summary>
      <div style="padding:14px 0;">
        <p>ל-Dashboard מלא (טבלאות מסוננות, העלאת קבצים בהדרגה, audit ויזואלי) דרוש OAuth Client ID:</p>
        <ol>
          <li>היכנס ל-<a href="https://console.cloud.google.com/apis/credentials" target="_blank">Google Cloud Console → Credentials</a></li>
          <li>צור Project חדש (או בחר קיים)</li>
          <li>הפעל ב-API Library: <a target="_blank" href="https://console.cloud.google.com/apis/library/sheets.googleapis.com">Sheets API</a> + <a target="_blank" href="https://console.cloud.google.com/apis/library/drive.googleapis.com">Drive API</a></li>
          <li>Create Credentials → OAuth client ID → Application type: <b>Web application</b></li>
          <li>תחת <b>Authorized JavaScript origins</b> הוסף:<br>
            <input class="code-input" readonly value="${origin}" onclick="this.select()"></li>
          <li>העתק את ה-Client ID לכאן:<br>
            <input class="code-input" id="cid" placeholder="123456789-xxxxx.apps.googleusercontent.com">
            <button class="btn btn-primary" style="margin-top:8px" onclick="saveClientId()">שמור והפעל</button></li>
        </ol>
      </div>
    </details>

    <p class="muted small" style="margin-top:24px;text-align:center;">© ניהול מוסדות · אב בחכמה</p>
  </div>`;
}

window.saveClientId = function() {
  const cid = document.getElementById('cid').value.trim();
  if (!cid) return;
  localStorage.setItem('CLIENT_ID', cid);
  location.reload();
};

// ============================================================
// 1. Google API loading
// ============================================================

let gapiInited = false, gisInited = false;

function gapiLoaded() {
  gapi.load('client', async () => {
    await gapi.client.init({ discoveryDocs: [CONFIG.DISCOVERY_DOC] });
    gapiInited = true;
    maybeInitAuth();
  });
}

function gisLoaded() {
  if (!CONFIG.CLIENT_ID) return;
  State.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: CONFIG.SCOPES,
    callback: (resp) => {
      if (resp.error) { toast('שגיאת התחברות: ' + resp.error, 'error'); return; }
      State.accessToken = resp.access_token;
      bootstrap();
    },
  });
  gisInited = true;
  maybeInitAuth();
}

function maybeInitAuth() {
  if (!gapiInited || !gisInited) return;
  showLoginScreen();
}

function showLoginScreen() {
  const t = document.getElementById('tpl-login').content.cloneNode(true);
  setMain(t.firstElementChild);
  // Render Google Sign-In button
  google.accounts.id.initialize({
    client_id: CONFIG.CLIENT_ID,
    callback: (cred) => {
      // We use OAuth Token flow (not just identity) — call requestAccessToken
      State.tokenClient.requestAccessToken({ prompt: '' });
    },
  });
  google.accounts.id.renderButton(document.getElementById('gis-btn'),
    { theme: 'filled_blue', size: 'large', text: 'signin_with', locale: 'he' });
  google.accounts.id.prompt();
}

function logout() {
  if (State.accessToken) google.accounts.oauth2.revoke(State.accessToken, () => {});
  google.accounts.id.disableAutoSelect();
  State.accessToken = null; State.user = null; State.orgs = []; State.cache = {};
  location.reload();
}

window.addEventListener('load', () => {
  // GIS / GAPI scripts may load asynchronously — poll until ready, then init
  const w = setInterval(() => {
    if (window.gapi && !gapiInited) gapiLoaded();
    if (window.google && window.google.accounts && !gisInited) gisLoaded();
    if (gapiInited && gisInited) clearInterval(w);
  }, 100);

  // If no client id yet → setup wizard
  CONFIG.CLIENT_ID = CONFIG.CLIENT_ID || localStorage.getItem('CLIENT_ID') || '';
  if (!CONFIG.CLIENT_ID) showSetupWizard();
});

// ============================================================
// 2. Sheets API helpers
// ============================================================

function setApiToken() {
  gapi.client.setToken({ access_token: State.accessToken });
}

async function sheetsGet(spreadsheetId, range) {
  setApiToken();
  const resp = await gapi.client.sheets.spreadsheets.values.get({ spreadsheetId, range });
  return resp.result.values || [];
}

async function sheetsBatchGet(spreadsheetId, ranges) {
  setApiToken();
  const resp = await gapi.client.sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges });
  return resp.result.valueRanges || [];
}

async function sheetsAppend(spreadsheetId, range, values) {
  setApiToken();
  const resp = await gapi.client.sheets.spreadsheets.values.append({
    spreadsheetId, range,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    resource: { values }
  });
  return resp.result;
}

async function sheetsUpdate(spreadsheetId, range, values) {
  setApiToken();
  const resp = await gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId, range, valueInputOption: 'USER_ENTERED', resource: { values }
  });
  return resp.result;
}

async function sheetsDeleteRow(spreadsheetId, sheetId, rowIndex /* 0-based */) {
  setApiToken();
  const resp = await gapi.client.sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    resource: { requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 } } }] }
  });
  return resp.result;
}

async function spreadsheetMeta(spreadsheetId) {
  setApiToken();
  const resp = await gapi.client.sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(sheetId,title))' });
  return resp.result.sheets || [];
}

async function createSpreadsheet(title, sheetsToAdd) {
  setApiToken();
  const resp = await gapi.client.sheets.spreadsheets.create({
    resource: {
      properties: { title, locale: 'he_IL', timeZone: 'Asia/Jerusalem' },
      sheets: sheetsToAdd.map(name => ({ properties: { title: name, rightToLeft: true, gridProperties: { frozenRowCount: 1 } } }))
    }
  });
  return resp.result;
}

async function ensureMasterSchema() {
  // Make sure orgs/users/audit/settings exist with proper headers
  const meta = await spreadsheetMeta(CONFIG.MASTER_ID);
  const existing = new Set(meta.map(s => s.properties.title));
  const needed = [
    ['orgs',     ['id','name','sheet_id','folder_id','manager_email','created_at','active','budget_total','notes']],
    ['users',    ['email','role','org_id','name','added_at']],
    ['audit',    ['ts','user_email','action','org_id','details']],
    ['settings', ['key','value']],
  ];
  const requests = [];
  needed.forEach(([t]) => { if (!existing.has(t)) requests.push({ addSheet: { properties: { title: t, rightToLeft: true, gridProperties: { frozenRowCount: 1 } } } }); });
  if (requests.length) {
    setApiToken();
    await gapi.client.sheets.spreadsheets.batchUpdate({ spreadsheetId: CONFIG.MASTER_ID, resource: { requests } });
  }
  // Write headers if first row empty
  for (const [tab, headers] of needed) {
    try {
      const rows = await sheetsGet(CONFIG.MASTER_ID, `'${tab}'!A1:1`);
      if (!rows.length || !rows[0].length || !rows[0][0]) {
        await sheetsUpdate(CONFIG.MASTER_ID, `'${tab}'!A1`, [headers]);
      }
    } catch (e) { /* not yet readable */ }
  }
}

// ============================================================
// 3. Bootstrap (after auth)
// ============================================================

async function bootstrap() {
  try {
    // Resolve identity from access token
    const userInfo = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + State.accessToken }
    }).then(r => r.json());
    const email = (userInfo.email || '').toLowerCase();
    State.user = { email, name: userInfo.name || '', role: 'manager' };
    document.getElementById('userBadge').textContent = '👤 ' + email;
    document.getElementById('logoutBtn').classList.remove('hidden');
    document.getElementById('logoutBtn').onclick = logout;

    // Try to read Master users tab — if forbidden, we're a manager.
    let isAdminFromMaster = false;
    try {
      await ensureMasterSchema();   // only succeeds for admin
      const usersRows = await sheetsGet(CONFIG.MASTER_ID, "'users'!A2:E");
      State.users = usersRows.map(r => ({ email:(r[0]||'').toLowerCase(), role:r[1]||'manager', org_id:r[2]||'', name:r[3]||'' }));
      const orgsRows = await sheetsGet(CONFIG.MASTER_ID, "'orgs'!A2:I");
      State.orgs = orgsRows
        .filter(r => r[0] && String(r[6]||'').toUpperCase() !== 'FALSE')
        .map(r => ({ id:r[0], name:r[1], sheet_id:r[2], folder_id:r[3]||'', manager_email:r[4]||'', created_at:r[5]||'', active:r[6]||'TRUE', budget_total:Number(r[7]||0), notes:r[8]||'' }));
      isAdminFromMaster = true;
    } catch (e) {
      // fallback admin
      if (CONFIG.FALLBACK_ADMINS.indexOf(email) >= 0) {
        // Try once more to bootstrap (admin privileges might be later granted)
        State.users = [];
        State.orgs = [];
      } else {
        // Manager: discover orgs by listing spreadsheets shared with the user
        await discoverManagerOrgs();
      }
    }

    // Decide role
    const userRow = State.users.find(u => u.email === email);
    if (userRow) State.user.role = userRow.role;
    else if (isAdminFromMaster || CONFIG.FALLBACK_ADMINS.indexOf(email) >= 0) State.user.role = 'admin';
    document.getElementById('userBadge').textContent = (State.user.role === 'admin' ? '👑 ' : '👤 ') + email;

    // Visible orgs
    let visible = State.orgs;
    if (State.user.role !== 'admin') {
      const myOrgIds = new Set(State.users.filter(u => u.email === email).map(u => u.org_id));
      visible = State.orgs.filter(o => myOrgIds.has(o.id));
    }
    if (visible.length === 0 && State.user.role !== 'admin') {
      const t = document.getElementById('tpl-no-access').content.cloneNode(true);
      t.querySelector('#myEmail').textContent = email;
      setMain(t.firstElementChild);
      return;
    }

    State.currentOrgId = visible[0] ? visible[0].id : null;
    populateOrgPicker(visible);
    document.getElementById('nav').classList.remove('hidden');
    if (State.user.role === 'admin') document.querySelectorAll('.admin-only').forEach(b => b.classList.remove('hidden'));
    bindNav();
    showView('dashboard');
  } catch (e) {
    setMain(el(`<div class="card"><h3>שגיאת טעינה</h3><pre>${escapeHtml(String(e.message || JSON.stringify(e)))}</pre></div>`));
  }
}

async function discoverManagerOrgs() {
  // Manager flow: search Drive for spreadsheets named "ניהול מוסדות —..." that are shared with us
  setApiToken();
  const resp = await gapi.client.request({
    path: '/drive/v3/files',
    params: {
      q: "mimeType='application/vnd.google-apps.spreadsheet' and name contains 'ניהול מוסדות' and trashed=false",
      fields: 'files(id,name)',
      pageSize: 50
    }
  });
  const files = (resp.result.files || []);
  State.orgs = files.map(f => ({
    id: f.id,                       // for managers: org_id == sheet_id (since they don't see master)
    name: f.name.replace(/^ניהול מוסדות\s*[—-]\s*/, ''),
    sheet_id: f.id,
    manager_email: State.user.email,
    budget_total: 0
  }));
  State.users = [{ email: State.user.email, role: 'manager', org_id: State.orgs[0]?.id || '' }];
}

// ============================================================
// 4. Layout helpers
// ============================================================

function populateOrgPicker(orgs) {
  const sel = document.getElementById('orgSelect');
  sel.innerHTML = orgs.map(o => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('');
  if (orgs.length > 1 || State.user.role === 'admin') document.getElementById('org-picker').classList.remove('hidden');
  sel.onchange = () => { State.currentOrgId = sel.value; State.cache = {}; showView(State.currentView); };
}

function bindNav() {
  document.querySelectorAll('#nav button').forEach(b => b.onclick = () => showView(b.dataset.view));
}

function showView(view) {
  State.currentView = view;
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'dashboard') return renderDashboard();
  if (view === 'audit')     return renderAudit();
  if (view === 'admin')     return renderAdmin();
  return renderTable(view);
}

// ============================================================
// 5. Dashboard
// ============================================================

async function renderDashboard() {
  const t = document.getElementById('tpl-dashboard').content.cloneNode(true);
  setMain(t.firstElementChild);
  const grid = document.querySelector('.summary-grid');
  if (!State.currentOrgId) {
    if (State.user.role === 'admin') {
      grid.innerHTML = '<div class="loader">טוען סיכום כללי…</div>';
      const cards = [];
      for (const o of State.orgs) {
        try {
          const sum = await orgSummary(o);
          cards.push(sum);
        } catch (e) { cards.push({ org: o, error: String(e.message || e) }); }
      }
      grid.innerHTML = '';
      cards.forEach(c => {
        if (c.error) {
          grid.appendChild(el(`<div class="stat-card"><div class="label">${escapeHtml(c.org.name)}</div><div class="muted">שגיאה: ${escapeHtml(c.error)}</div></div>`));
        } else {
          const overP = c.budget_total ? Math.round((c.used / c.budget_total) * 100) : 0;
          grid.appendChild(el(`
            <div class="stat-card ${c.remaining < 0 ? 'neg' : 'pos'}">
              <div class="label">${escapeHtml(c.org.name)}</div>
              <div class="value">${fmtMoney(c.remaining)}</div>
              <div class="sub">תקציב ${fmtMoney(c.budget_total)} · נוצל ${fmtMoney(c.used)} (${overP}%)</div>
              <div class="progress ${c.remaining < 0 ? 'over' : ''}"><span style="width:${Math.min(100,overP)}%"></span></div>
            </div>`));
        }
      });
    } else {
      grid.innerHTML = '<div class="muted">אין מוסד פעיל.</div>';
    }
    return;
  }
  const org = State.orgs.find(o => o.id === State.currentOrgId);
  grid.innerHTML = '<div class="loader">טוען…</div>';
  const sum = await orgSummary(org);
  grid.innerHTML = '';
  grid.appendChild(el(`<div class="stat-card"><div class="label">סך תקציב</div><div class="value">${fmtMoney(sum.budget_total)}</div><div class="sub">${escapeHtml(org.name)}</div></div>`));
  grid.appendChild(el(`<div class="stat-card"><div class="label">נוצל</div><div class="value">${fmtMoney(sum.used)}</div><div class="sub">${sum.budget_total ? Math.round(sum.used/sum.budget_total*100) : 0}% מהתקציב</div></div>`));
  grid.appendChild(el(`<div class="stat-card ${sum.remaining<0?'neg':'pos'}"><div class="label">יתרה</div><div class="value">${fmtMoney(sum.remaining)}</div><div class="sub">${sum.remaining<0?'חריגה!':'נותר לשימוש'}</div></div>`));
  sum.tabs.forEach(t => grid.appendChild(el(`<div class="stat-card"><div class="label">${escapeHtml(t.name)}</div><div class="value">${fmtMoney(t.sum)}</div><div class="sub">${t.count} שורות</div></div>`)));

  // Recent
  const ra = document.querySelector('.recent-actions');
  ra.innerHTML = '<div class="loader">טוען…</div>';
  try {
    const rows = await sheetsGet(org.sheet_id, "'audit'!A2:F");
    const recent = (rows || []).slice(-12).reverse();
    if (recent.length) {
      ra.innerHTML = '';
      recent.forEach(r => ra.appendChild(el(`<div class="row"><span class="ts">${fmtDateTime(r[0])}</span><span class="who">${escapeHtml(String(r[1]||''))}</span><span>${escapeHtml(String(r[2]||''))} · ${escapeHtml(String(r[3]||''))} #${escapeHtml(String(r[4]||''))}</span></div>`)));
    } else ra.innerHTML = '<div class="muted">אין פעולות אחרונות.</div>';
  } catch { ra.innerHTML = '<div class="muted">audit לא זמין.</div>'; }
}

const ORG_TABS = ['פעילות','ספקים','בעלות'];

async function orgSummary(org) {
  const ranges = ORG_TABS.map(t => `'${t}'!A:Z`);
  ranges.push("'config'!A:B");
  let valueRanges;
  try { valueRanges = await sheetsBatchGet(org.sheet_id, ranges); }
  catch (e) { return { org, budget_total: org.budget_total||0, used: 0, remaining: org.budget_total||0, tabs: [] }; }
  let budget_total = org.budget_total || 0;
  const cfg = valueRanges[ranges.length - 1].values || [];
  cfg.forEach(r => { if (r[0] === 'budget_total') budget_total = Number(r[1])||budget_total; });
  let used = 0;
  const tabs = [];
  ORG_TABS.forEach((tab, i) => {
    const data = valueRanges[i].values;
    if (!data || data.length < 2) { tabs.push({name: tab, count: 0, sum: 0}); return; }
    const headers = data[0].map(String);
    const sumIdx = headers.indexOf('סכום');
    let sum = 0, count = 0;
    for (let r = 1; r < data.length; r++) {
      if (data[r][0] !== '' && data[r][0] !== undefined) {
        sum += Number(data[r][sumIdx]) || 0;
        count++;
      }
    }
    tabs.push({name: tab, count, sum});
    used += sum;
  });
  return { org, budget_total, used, remaining: budget_total - used, tabs };
}

// ============================================================
// 6. Table view
// ============================================================

async function renderTable(sheetName) {
  const t = document.getElementById('tpl-table').content.cloneNode(true);
  const root = t.firstElementChild;
  setMain(root);
  root.querySelector('.page-title').textContent = sheetName;
  const search = root.querySelector('.search-box');
  const tbl = root.querySelector('.data-table');
  root.querySelector('.add-row').onclick = () => openRowEditor(sheetName, null);

  tbl.innerHTML = '<tbody><tr><td>טוען…</td></tr></tbody>';
  const org = State.orgs.find(o => o.id === State.currentOrgId);
  if (!org) { tbl.innerHTML = '<tbody><tr><td>לא נבחר מוסד.</td></tr></tbody>'; return; }
  const cacheKey = `${org.id}:${sheetName}`;
  if (!State.cache[cacheKey]) {
    try {
      const data = await sheetsGet(org.sheet_id, `'${sheetName}'!A:Z`);
      const headers = (data[0] || []).map(String);
      const rows = (data.slice(1)).map((r, i) => {
        const o = { _row: i + 2 };
        headers.forEach((h, j) => o[h] = r[j] !== undefined ? r[j] : '');
        return o;
      });
      State.cache[cacheKey] = { headers, rows };
    } catch (e) {
      tbl.innerHTML = `<tbody><tr><td>שגיאה: ${escapeHtml(String(e.message || JSON.stringify(e)))}</td></tr></tbody>`;
      return;
    }
  }
  const data = State.cache[cacheKey];
  function renderRows(filterStr) {
    const headers = data.headers;
    const rows = data.rows.filter(r => !filterStr || Object.values(r).join(' ').toLowerCase().indexOf(filterStr.toLowerCase()) >= 0);
    const visibleCols = headers.filter(h => h && h !== 'נוצר ע"י' && h !== 'נוצר בתאריך');
    let html = '<thead><tr>';
    visibleCols.forEach(h => html += `<th>${escapeHtml(h)}</th>`);
    html += '<th></th></tr></thead><tbody>';
    rows.forEach(r => {
      const locked = isRowLocked(r);
      html += `<tr data-row="${r._row}" class="${locked?'locked':''}">`;
      visibleCols.forEach(h => {
        let v = r[h];
        if (h === 'סכום') v = `<span class="num">${fmtMoney(v)}</span>`;
        else if (h === 'תאריך חשבון' || h === 'נוצר בתאריך') v = fmtDate(v);
        else if (h === 'סטטוס') v = `<span class="status ${statusClass(v)}">${escapeHtml(v||'טיוטה')}</span>`;
        else if (h === 'קישור חשבונית' || h === 'קישור קבלה') v = v ? `<a class="file-link" target="_blank" href="${escapeAttr(v)}">פתח</a>` : '<span class="no-file">—</span>';
        else v = escapeHtml(String(v||''));
        html += `<td>${v}</td>`;
      });
      html += `<td class="row-actions"><button class="btn-link" data-act="edit">ערוך</button><button class="btn-link" data-act="upload-inv">חשבונית</button><button class="btn-link" data-act="upload-rec">קבלה</button></td></tr>`;
    });
    html += '</tbody>';
    tbl.innerHTML = html;
    tbl.querySelectorAll('tr[data-row]').forEach(tr => {
      tr.querySelectorAll('button[data-act]').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const rowNum = Number(tr.dataset.row);
          const rowObj = data.rows.find(x => x._row === rowNum);
          if (btn.dataset.act === 'edit') openRowEditor(sheetName, rowObj);
          if (btn.dataset.act === 'upload-inv') openUploadDialog(sheetName, rowObj, 'invoice');
          if (btn.dataset.act === 'upload-rec') openUploadDialog(sheetName, rowObj, 'receipt');
        };
      });
    });
  }
  renderRows('');
  let timer;
  search.oninput = () => { clearTimeout(timer); timer = setTimeout(() => renderRows(search.value), 200); };
}

function isRowLocked(r) {
  const v = r['נעול'];
  if (v === true || String(v).toLowerCase() === 'true') return true;
  const s = String(r['סטטוס']||'').trim();
  return s === 'מאושר' || s === 'שולם';
}

// ============================================================
// 7. Row editor (add / edit / lock / delete)
// ============================================================

function openRowEditor(sheetName, rowObj) {
  const isNew = !rowObj;
  const cacheKey = `${State.currentOrgId}:${sheetName}`;
  const headers = (State.cache[cacheKey] || {}).headers || [];
  const editable = headers.filter(h => !['מספר סידורי','נוצר ע"י','נוצר בתאריך','נעול','מאשר','קישור חשבונית','קישור קבלה'].includes(h));
  const isAdmin = State.user.role === 'admin';
  const locked = !isNew && isRowLocked(rowObj);

  const form = document.createElement('form');
  form.innerHTML = `<h3>${isNew ? 'שורה חדשה' : 'עריכת שורה #' + escapeHtml(String(rowObj['מספר סידורי']||rowObj._row))}</h3>`;

  if (locked && !isAdmin) {
    form.innerHTML += `<div class="card" style="background:var(--warn-bg);border-color:var(--orange);">🔒 שורה נעולה (סטטוס: ${escapeHtml(rowObj['סטטוס']||'')}). רק מנהל כללי יכול לערוך.</div>`;
  }

  const grid = document.createElement('div');
  editable.forEach(h => {
    const v = rowObj ? (rowObj[h] || '') : '';
    let input = '';
    if (h === 'סטטוס') {
      input = `<select name="${h}">${['טיוטה','ממתין לאישור','מאושר','שולם','בוטל'].map(s => `<option ${s===String(v)?'selected':''} value="${s}">${s}</option>`).join('')}</select>`;
    } else if (h === 'תאריך חשבון') {
      const d = v ? new Date(v) : null;
      const dStr = d && !isNaN(d.getTime()) ? d.toISOString().slice(0,10) : '';
      input = `<input type="date" name="${h}" value="${dStr}">`;
    } else if (h === 'סכום') {
      input = `<input type="number" step="0.01" name="${h}" value="${escapeAttr(v)}">`;
    } else {
      input = `<input type="text" name="${h}" value="${escapeAttr(v)}">`;
    }
    grid.appendChild(el(`<div class="form-row"><label>${escapeHtml(h)}</label>${input}</div>`));
  });
  form.appendChild(grid);

  if (!isNew && isAdmin) {
    const lockBtn = el(`<button type="button" class="btn ${locked?'btn-warn':''}">${locked?'🔓 בטל נעילה':'🔒 נעל שורה'}</button>`);
    lockBtn.onclick = async () => {
      try {
        const headers = State.cache[`${State.currentOrgId}:${sheetName}`].headers;
        const lockIdx = headers.indexOf('נעול');
        if (lockIdx < 0) return toast('אין עמודת נעילה','error');
        const colLetter = colToLetter(lockIdx + 1);
        await sheetsUpdate((State.orgs.find(o=>o.id===State.currentOrgId)).sheet_id, `'${sheetName}'!${colLetter}${rowObj._row}`, [[locked?'FALSE':'TRUE']]);
        await writeAudit(State.currentOrgId, locked?'unlock_row':'lock_row', sheetName, rowObj._row, {});
        toast(locked?'בוטלה נעילה':'ננעלה','ok'); closeModal(); await reloadSheet(sheetName);
      } catch (e) { toast('שגיאה: '+e.message,'error'); }
    };
    const lockRow = el('<div class="form-row" style="text-align:left"></div>');
    lockRow.appendChild(lockBtn);
    form.appendChild(lockRow);
  }

  const actions = el('<div class="modal-actions"></div>');
  const saveBtn = el('<button type="submit" class="btn btn-primary">שמור</button>');
  if (locked && !isAdmin) saveBtn.disabled = true;
  actions.appendChild(saveBtn);
  if (!isNew && (!locked || isAdmin)) {
    const delBtn = el('<button type="button" class="btn btn-danger">מחק</button>');
    delBtn.onclick = async () => {
      if (!confirm('למחוק את השורה?')) return;
      try {
        const org = State.orgs.find(o=>o.id===State.currentOrgId);
        const meta = await spreadsheetMeta(org.sheet_id);
        const sheetMeta = meta.find(s => s.properties.title === sheetName);
        await sheetsDeleteRow(org.sheet_id, sheetMeta.properties.sheetId, rowObj._row - 1);
        await writeAudit(State.currentOrgId, 'delete_row', sheetName, rowObj._row, rowObj);
        toast('נמחק','ok'); closeModal(); await reloadSheet(sheetName);
      } catch (e) { toast('שגיאה: '+e.message,'error'); }
    };
    actions.appendChild(delBtn);
  }
  const cancelBtn = el('<button type="button" class="btn">ביטול</button>');
  cancelBtn.onclick = closeModal;
  actions.appendChild(cancelBtn);
  form.appendChild(actions);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const fields = {};
    fd.forEach((v,k) => fields[k] = v);
    saveBtn.disabled = true; saveBtn.textContent = 'שומר…';
    try {
      const org = State.orgs.find(o=>o.id===State.currentOrgId);
      if (isNew) {
        // Add row: prepare row in headers order
        const fullHeaders = State.cache[`${State.currentOrgId}:${sheetName}`].headers;
        const serial = nextSerial(State.cache[`${State.currentOrgId}:${sheetName}`].rows);
        const rowVals = fullHeaders.map(h => {
          if (h === 'מספר סידורי') return serial;
          if (h === 'נוצר ע"י')   return State.user.email;
          if (h === 'נוצר בתאריך') return new Date().toISOString();
          if (h === 'סטטוס' && !fields['סטטוס']) return 'טיוטה';
          return fields[h] !== undefined ? fields[h] : '';
        });
        await sheetsAppend(org.sheet_id, `'${sheetName}'!A1`, [rowVals]);
        await writeAudit(State.currentOrgId, 'add_row', sheetName, serial, fields);
      } else {
        // Update row cell by cell
        const fullHeaders = State.cache[`${State.currentOrgId}:${sheetName}`].headers;
        const rowVals = fullHeaders.map((h, i) => {
          if (fields[h] !== undefined) return fields[h];
          // keep existing
          return rowObj[h] !== undefined ? rowObj[h] : '';
        });
        await sheetsUpdate(org.sheet_id, `'${sheetName}'!A${rowObj._row}`, [rowVals]);
        await writeAudit(State.currentOrgId, 'update_row', sheetName, rowObj._row, fields);
      }
      toast(isNew?'נוסף':'נשמר','ok'); closeModal(); await reloadSheet(sheetName);
    } catch (err) {
      toast('שגיאה: ' + (err.result?.error?.message || err.message || JSON.stringify(err)), 'error');
      saveBtn.disabled = false; saveBtn.textContent = 'שמור';
    }
  };

  openModal(form);
}

function nextSerial(rows) {
  let m = 0;
  rows.forEach(r => { const v = Number(r['מספר סידורי']) || 0; if (v > m) m = v; });
  return m + 1;
}

async function reloadSheet(sheetName) {
  delete State.cache[`${State.currentOrgId}:${sheetName}`];
  if (State.currentView === sheetName) await renderTable(sheetName);
}

// ============================================================
// 8. Upload dialog (drive.file scope)
// ============================================================

function openUploadDialog(sheetName, rowObj, kind) {
  const isAdmin = State.user.role === 'admin';
  const locked = isRowLocked(rowObj);
  const colName = kind === 'receipt' ? 'קישור קבלה' : 'קישור חשבונית';
  const existing = rowObj[colName];

  const wrap = el(`
    <div>
      <h3>העלאת ${kind === 'receipt' ? 'קבלה' : 'חשבונית'}</h3>
      <p class="muted">שורה #${escapeHtml(String(rowObj['מספר סידורי']||rowObj._row))} · ${escapeHtml(String(rowObj['פירוט המטרה']||''))}</p>
      ${existing ? `<p>קיים: <a class="file-link" target="_blank" href="${escapeAttr(existing)}">פתח</a> · העלאה תחליף.</p>` : ''}
      ${locked && !isAdmin ? `<div class="card" style="background:var(--warn-bg);border-color:var(--orange);">🔒 השורה נעולה — לא ניתן להעלות קובץ.</div>` : `
      <div class="dropzone" id="dz">
        <div class="icon">📤</div>
        <div>גרור קובץ לכאן, או <b>לחץ לבחירה</b></div>
        <div class="muted small" style="margin-top:6px;">PDF, JPG, PNG · עד 10MB</div>
        <input type="file" accept=".pdf,image/*">
      </div>
      <div id="preview"></div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="upBtn" disabled>העלה</button>
        <button class="btn" id="cancel">ביטול</button>
      </div>`}
    </div>`);
  openModal(wrap);
  const dz = wrap.querySelector('#dz');
  if (!dz) return;
  const inp = dz.querySelector('input[type=file]');
  const prev = wrap.querySelector('#preview');
  const upBtn = wrap.querySelector('#upBtn');
  let chosen = null;
  function pickFile(f) {
    if (!f) return;
    if (f.size > 10*1024*1024) { toast('הקובץ גדול מ-10MB','error'); return; }
    chosen = f;
    prev.innerHTML = `<div class="file-preview"><span class="name">${escapeHtml(f.name)}</span><span class="size">${(f.size/1024).toFixed(0)} KB</span></div>`;
    upBtn.disabled = false;
  }
  dz.onclick = () => inp.click();
  inp.onchange = () => pickFile(inp.files[0]);
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); pickFile(e.dataTransfer.files[0]); };
  wrap.querySelector('#cancel').onclick = closeModal;
  upBtn.onclick = async () => {
    if (!chosen) return;
    upBtn.disabled = true; upBtn.textContent = 'מעלה…';
    try {
      const url = await uploadFileToDrive(chosen, kind);
      // Update sheet cell with the link
      const cacheKey = `${State.currentOrgId}:${sheetName}`;
      const headers = State.cache[cacheKey].headers;
      const colIdx = headers.indexOf(colName);
      const colLetter = colToLetter(colIdx + 1);
      const org = State.orgs.find(o => o.id === State.currentOrgId);
      await sheetsUpdate(org.sheet_id, `'${sheetName}'!${colLetter}${rowObj._row}`, [[url]]);
      // Mirror to log tab
      const logName = kind === 'receipt' ? 'קבלות' : 'חשבוניות';
      try { await sheetsAppend(org.sheet_id, `'${logName}'!A1`, [[new Date().toISOString(), State.user.email, rowObj['מספר סידורי']||rowObj._row, sheetName, url]]); } catch {}
      await writeAudit(State.currentOrgId, existing ? 'replace_file' : 'upload_file', sheetName, rowObj._row, {kind, name: chosen.name, prev: existing, next: url});
      toast(existing ? 'הוחלף' : 'הועלה','ok'); closeModal(); await reloadSheet(sheetName);
    } catch (err) {
      toast('שגיאה: ' + (err.message || JSON.stringify(err)),'error');
      upBtn.disabled = false; upBtn.textContent = 'העלה';
    }
  };
}

async function uploadFileToDrive(file, kind) {
  // Create file in Drive (drive.file scope) using multipart upload
  const metadata = {
    name: file.name,
    mimeType: file.type || 'application/pdf',
    description: `${kind === 'receipt' ? 'קבלה' : 'חשבונית'} – ${State.user.email} – ${new Date().toISOString()}`
  };
  const boundary = '-------ng' + Math.random().toString(36).slice(2);
  const delim = '\r\n--' + boundary + '\r\n';
  const closeDelim = '\r\n--' + boundary + '--';
  const reader = new FileReader();
  const dataUrl = await new Promise((res, rej) => { reader.onload = () => res(reader.result); reader.onerror = rej; reader.readAsDataURL(file); });
  const b64 = String(dataUrl).split(',')[1];
  const body = delim
    + 'Content-Type: application/json; charset=UTF-8\r\n\r\n'
    + JSON.stringify(metadata)
    + delim
    + 'Content-Type: ' + metadata.mimeType + '\r\n'
    + 'Content-Transfer-Encoding: base64\r\n\r\n'
    + b64
    + closeDelim;
  const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + State.accessToken, 'Content-Type': 'multipart/related; boundary=' + boundary },
    body: body
  }).then(r => r.json());
  if (!resp.id) throw new Error('upload failed: ' + JSON.stringify(resp));
  // Make link viewable to anyone with link (admin/manager pattern)
  await fetch(`https://www.googleapis.com/drive/v3/files/${resp.id}/permissions`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + State.accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' })
  });
  return resp.webViewLink || ('https://drive.google.com/file/d/' + resp.id + '/view');
}

// ============================================================
// 9. Audit
// ============================================================

async function renderAudit() {
  const t = document.getElementById('tpl-audit').content.cloneNode(true);
  setMain(t.firstElementChild);
  const tbl = document.querySelector('.audit-table');
  tbl.innerHTML = '<tbody><tr><td>טוען…</td></tr></tbody>';
  const org = State.orgs.find(o => o.id === State.currentOrgId);
  if (!org) { tbl.innerHTML = '<tbody><tr><td>אין מוסד.</td></tr></tbody>'; return; }
  try {
    const data = await sheetsGet(org.sheet_id, "'audit'!A:F");
    const headers = data[0] || ['ts','user','action','sheet','row_id','details'];
    const rows = (data.slice(1)).reverse();
    let html = '<thead><tr>';
    headers.forEach(h => html += `<th>${escapeHtml(String(h))}</th>`);
    html += '</tr></thead><tbody>';
    rows.forEach(r => {
      html += '<tr>';
      r.forEach((c,i) => { let v = (i===0) ? fmtDateTime(c) : escapeHtml(String(c||'')); html += `<td>${v}</td>`; });
      html += '</tr>';
    });
    html += '</tbody>';
    tbl.innerHTML = html;
  } catch (e) {
    tbl.innerHTML = `<tbody><tr><td>${escapeHtml(e.message||'')}</td></tr></tbody>`;
  }
}

async function writeAudit(orgId, action, sheet, rowId, details) {
  const org = State.orgs.find(o => o.id === orgId);
  if (!org) return;
  const tsRow = [new Date().toISOString(), State.user.email, action, sheet, String(rowId||''), JSON.stringify(details||{}).slice(0,4000)];
  try { await sheetsAppend(org.sheet_id, "'audit'!A1", [tsRow]); } catch {}
  // Mirror to master audit (admin only)
  if (State.user.role === 'admin') {
    try { await sheetsAppend(CONFIG.MASTER_ID, "'audit'!A1", [[new Date().toISOString(), State.user.email, action, orgId, JSON.stringify({sheet, rowId, ...details}).slice(0,4000)]]); } catch {}
  }
}

// ============================================================
// 10. Admin
// ============================================================

async function renderAdmin() {
  const t = document.getElementById('tpl-admin').content.cloneNode(true);
  setMain(t.firstElementChild);
  document.querySelector('.new-org').onclick = openCreateOrg;
  document.querySelector('.new-user').onclick = openAddUser;

  const ol = document.querySelector('.orgs-list');
  ol.innerHTML = '';
  State.orgs.forEach(o => {
    const d = el(`<div class="card" style="margin-top:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <div><b>${escapeHtml(o.name)}</b> <span class="muted">· ${escapeHtml(o.id)}</span><br>
          <small class="muted">${escapeHtml(o.manager_email||'')} · תקציב ${fmtMoney(o.budget_total||0)}</small></div>
        <div>
          <a class="btn-link" target="_blank" href="https://docs.google.com/spreadsheets/d/${escapeAttr(o.sheet_id)}/edit">📊 גליון</a>
          <button class="btn-link" data-act="del">מחק</button>
        </div></div></div>`);
    d.querySelector('[data-act=del]').onclick = async () => {
      if (!confirm(`להסתיר את "${o.name}"?`)) return;
      const idx = State.orgs.findIndex(x => x.id === o.id);
      // Find row in master
      const all = await sheetsGet(CONFIG.MASTER_ID, "'orgs'!A:I");
      const rowIdx = all.findIndex(r => r[0] === o.id);
      if (rowIdx > 0) {
        await sheetsUpdate(CONFIG.MASTER_ID, `'orgs'!G${rowIdx+1}`, [['FALSE']]);
        toast('הוסר','ok'); bootstrap();
      }
    };
    ol.appendChild(d);
  });

  const ul = document.querySelector('.users-list');
  ul.innerHTML = '';
  State.users.forEach((u, i) => {
    const d = el(`<div class="card" style="margin-top:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <div><b>${escapeHtml(u.email)}</b> <span class="muted">${escapeHtml(u.role||'')}</span><br>
          <small class="muted">${escapeHtml(u.name||'')} · org: ${escapeHtml(u.org_id||'(כולם)')}</small></div>
        <button class="btn-link" data-act="del">הסר</button></div></div>`);
    d.querySelector('[data-act=del]').onclick = async () => {
      if (!confirm(`להסיר את ${u.email}?`)) return;
      const all = await sheetsGet(CONFIG.MASTER_ID, "'users'!A:E");
      const rowIdx = all.findIndex((r, j) => j > 0 && (r[0]||'').toLowerCase() === u.email && (r[2]||'') === (u.org_id||''));
      if (rowIdx > 0) {
        const meta = await spreadsheetMeta(CONFIG.MASTER_ID);
        const usersMeta = meta.find(s => s.properties.title === 'users');
        await sheetsDeleteRow(CONFIG.MASTER_ID, usersMeta.properties.sheetId, rowIdx);
        toast('הוסר','ok'); bootstrap();
      }
    };
    ul.appendChild(d);
  });

  const gs = document.querySelector('.global-summary');
  gs.innerHTML = '<div class="loader">טוען…</div>';
  let html = '<table class="data-table"><thead><tr><th>מוסד</th><th>תקציב</th><th>נוצל</th><th>יתרה</th><th>שורות</th></tr></thead><tbody>';
  for (const o of State.orgs) {
    try {
      const s = await orgSummary(o);
      const c = s.tabs.reduce((a,t) => a + t.count, 0);
      html += `<tr><td>${escapeHtml(o.name)}</td><td class="num">${fmtMoney(s.budget_total)}</td><td class="num">${fmtMoney(s.used)}</td><td class="num" style="color:${s.remaining<0?'var(--red)':'#3fb950'}">${fmtMoney(s.remaining)}</td><td class="num">${c}</td></tr>`;
    } catch {}
  }
  html += '</tbody></table>';
  gs.innerHTML = html;
}

function openCreateOrg() {
  const f = el(`<form>
    <h3>מוסד חדש</h3>
    <div class="form-row"><label>שם המוסד</label><input name="name" required></div>
    <div class="form-row"><label>אימייל מנהל המוסד</label><input name="manager_email" type="email" placeholder="manager@example.com"></div>
    <div class="form-row"><label>תקציב כולל (₪)</label><input name="budget_total" type="number" step="1" value="0"></div>
    <div class="modal-actions">
      <button class="btn btn-primary" type="submit">צור</button>
      <button class="btn" type="button" id="cancel">ביטול</button>
    </div>
  </form>`);
  f.querySelector('#cancel').onclick = closeModal;
  f.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    try {
      const name = fd.get('name');
      const mgr = (fd.get('manager_email')||'').toLowerCase().trim();
      const budget = Number(fd.get('budget_total')||0);
      // Create org spreadsheet with all tabs
      const tabs = ['פעילות','ספקים','בעלות','חשבוניות','קבלות','config','audit'];
      const ss = await createSpreadsheet('ניהול מוסדות — ' + name, tabs);
      const sid = ss.spreadsheetId;
      // Write headers
      const ORG_HEADERS = ['מספר סידורי','קטגורית מטרה','פירוט המטרה','שם הספק','טלפון ספק','תאריך חשבון','בנק','סניף','חשבון','שם המוטב','סכום','קישור חשבונית','קישור קבלה','סטטוס','מאשר','נעול','נוצר ע"י','נוצר בתאריך'];
      for (const tab of ['פעילות','ספקים','בעלות']) await sheetsUpdate(sid, `'${tab}'!A1`, [ORG_HEADERS]);
      await sheetsUpdate(sid, "'חשבוניות'!A1", [['חותמת זמן','אימייל','מספר סידורי','גליון','קישור']]);
      await sheetsUpdate(sid, "'קבלות'!A1", [['חותמת זמן','אימייל','מספר סידורי','גליון','קישור']]);
      await sheetsUpdate(sid, "'config'!A1", [['key','value'],['org_name', name],['budget_total', String(budget)],['categories','אחר;פעילות חודשית;פעילות פרטנית;אחזקה ותחזוקה;נקיון וציוד נקיון;קייטרינג;שכירות;אישורים;ציוד משרדי']]);
      await sheetsUpdate(sid, "'audit'!A1", [['ts','user_email','action','sheet','row_id','details']]);
      // Share with manager
      if (mgr) {
        await fetch(`https://www.googleapis.com/drive/v3/files/${sid}/permissions?sendNotificationEmail=true`, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + State.accessToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: mgr })
        });
      }
      // Append to master.orgs
      const id = 'org_' + Date.now();
      await sheetsAppend(CONFIG.MASTER_ID, "'orgs'!A1", [[id, name, sid, '', mgr, new Date().toISOString(), 'TRUE', String(budget), '']]);
      // Add user record
      if (mgr) await sheetsAppend(CONFIG.MASTER_ID, "'users'!A1", [[mgr, 'manager', id, '', new Date().toISOString()]]);
      toast('המוסד נוצר','ok'); closeModal(); bootstrap();
    } catch (err) { toast('שגיאה: ' + (err.result?.error?.message||err.message), 'error'); }
  };
  openModal(f);
}

function openAddUser() {
  const opts = State.orgs.map(o => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('');
  const f = el(`<form>
    <h3>משתמש חדש</h3>
    <div class="form-row"><label>אימייל</label><input name="email" type="email" required></div>
    <div class="form-row"><label>שם</label><input name="name"></div>
    <div class="form-row row2">
      <div><label>תפקיד</label><select name="role"><option value="manager">מנהל מוסד</option><option value="admin">מנהל כללי</option></select></div>
      <div><label>מוסד</label><select name="org_id"><option value="">— (אדמין כולל)</option>${opts}</select></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" type="submit">הוסף</button>
      <button class="btn" type="button" id="cancel">ביטול</button>
    </div>
  </form>`);
  f.querySelector('#cancel').onclick = closeModal;
  f.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const email = (fd.get('email')||'').toLowerCase().trim();
    const role = fd.get('role'); const org_id = fd.get('org_id'); const name = fd.get('name');
    try {
      await sheetsAppend(CONFIG.MASTER_ID, "'users'!A1", [[email, role, org_id, name, new Date().toISOString()]]);
      // Share org sheet with the user
      if (org_id) {
        const org = State.orgs.find(o => o.id === org_id);
        if (org) {
          await fetch(`https://www.googleapis.com/drive/v3/files/${org.sheet_id}/permissions?sendNotificationEmail=true`, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + State.accessToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: email })
          });
        }
      }
      // Admin → also share master
      if (role === 'admin') {
        await fetch(`https://www.googleapis.com/drive/v3/files/${CONFIG.MASTER_ID}/permissions?sendNotificationEmail=true`, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + State.accessToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: email })
        });
      }
      toast('נוסף','ok'); closeModal(); bootstrap();
    } catch (err) { toast('שגיאה: ' + (err.result?.error?.message||err.message), 'error'); }
  };
  openModal(f);
}

// ============================================================
// Helpers
// ============================================================

function colToLetter(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function el(html) { const d = document.createElement('div'); d.innerHTML = String(html).trim(); return d.firstChild; }
function setMain(node) { const m = document.getElementById('main'); m.innerHTML = ''; m.appendChild(node); }

function openModal(content) {
  const root = document.getElementById('modal-root');
  const c = root.querySelector('.modal-content');
  c.innerHTML = '';
  if (typeof content === 'string') c.innerHTML = content;
  else c.appendChild(content);
  root.classList.add('show');
  root.querySelector('.modal-bg').onclick = closeModal;
}
function closeModal() { document.getElementById('modal-root').classList.remove('show'); }

function toast(msg, kind) {
  const t = document.createElement('div');
  t.className = 'toast ' + (kind || '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('he-IL', {style:'currency', currency:'ILS', maximumFractionDigits:0});
}
function fmtDate(d) {
  if (!d) return '';
  const dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('he-IL');
}
function fmtDateTime(d) {
  if (!d) return '';
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

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(s) { return escapeHtml(s); }
