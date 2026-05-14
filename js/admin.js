// ניהול מוסדות — admin pages: audit, orgs, users

async function renderAudit() {
  const root = document.getElementById('page-audit');
  const org = currentOrg();
  root.innerHTML = `
    <div class="d-flex align-items-center justify-content-between mb-3">
      <h3>היסטוריית שינויים <small class="text-muted">${escHtml((org&&org.name)||'')}</small></h3>
      <button class="btn btn-sm btn-outline-secondary" onclick="goto('home')"><i class="bi bi-arrow-right"></i> חזרה</button>
    </div>
    <div class="table-wrap shadow-sm"><table class="table table-sm table-hover mb-0" id="auditTbl"><tbody><tr><td>טוען…</td></tr></tbody></table></div>`;
  const r = await api('audit', [State.user.username, State.currentOrgId, 300]);
  if (!r.ok) { document.querySelector('#auditTbl tbody').innerHTML = `<tr><td class="text-danger">${escHtml(r.error)}</td></tr>`; return; }
  const headers = r.data.headers || [];
  const rows = r.data.rows || [];
  if (!rows.length) {
    document.querySelector('#auditTbl tbody').innerHTML = `<tr><td class="text-muted text-center py-3">אין רשומות.</td></tr>`;
    return;
  }
  const tbl = document.getElementById('auditTbl');
  tbl.innerHTML = `<thead><tr>${headers.map(h => `<th>${escHtml(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(row => `<tr>${row.map((c,i) => `<td>${i===0 ? fmtDateTime(c) : escHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
}
window.renderAudit = renderAudit;

// ---- orgs ------------------------------------------------------------
async function renderOrgs() {
  if (State.user.role !== 'admin') { notify('רק למנהל כללי','warn'); goto('home'); return; }
  const root = document.getElementById('page-orgs');
  root.innerHTML = `
    <div class="d-flex align-items-center justify-content-between mb-3">
      <h3>ניהול מוסדות</h3>
      <div>
        <button class="btn btn-sm btn-primary" onclick="openCreateOrg()"><i class="bi bi-plus-lg"></i> מוסד חדש</button>
        <button class="btn btn-sm btn-outline-secondary" onclick="goto('home')"><i class="bi bi-arrow-right"></i> חזרה</button>
      </div>
    </div>
    <div id="orgsList" class="row g-3"></div>`;
  const list = document.getElementById('orgsList');
  list.innerHTML = '<div class="col-12 text-muted">טוען…</div>';
  const r = await api('listOrgs', []);
  if (!r.ok) { list.innerHTML = `<div class="col-12 text-danger">${escHtml(r.error)}</div>`; return; }
  if (!r.data.length) { list.innerHTML = '<div class="col-12 text-muted">אין מוסדות. צור חדש בכפתור למעלה.</div>'; return; }
  list.innerHTML = r.data.map(o => `
    <div class="col-md-6 col-lg-4">
      <div class="card p-3 shadow-sm h-100">
        <h5 class="mb-2">${escHtml(o.name)}</h5>
        <div class="text-muted small mb-2"><i class="bi bi-person"></i> ${escHtml(o.manager_email||'—')}</div>
        <div class="text-muted small mb-2"><i class="bi bi-wallet2"></i> תקציב: ${fmtMoney(o.budget_total)}</div>
        <div class="mt-auto pt-2 d-flex gap-2">
          <a class="btn btn-sm btn-outline-primary" target="_blank" href="https://docs.google.com/spreadsheets/d/${escAttr(o.sheet_id)}/edit"><i class="bi bi-table"></i> Sheet</a>
          <button class="btn btn-sm btn-outline-secondary" onclick="openEditOrg('${escAttr(o.id)}')"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-sm btn-outline-danger" onclick="deleteOrg('${escAttr(o.id)}','${escAttr(o.name)}')"><i class="bi bi-trash"></i></button>
        </div>
      </div>
    </div>`).join('');
}
window.renderOrgs = renderOrgs;

function openCreateOrg() {
  openModal(`
    <div class="modal-header"><h5 class="modal-title">מוסד חדש</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
    <div class="modal-body">
      <form id="orgForm">
        <div class="mb-3"><label class="form-label">שם המוסד <span class="text-danger">*</span></label><input class="form-control" name="name" required></div>
        <div class="row g-3">
          <div class="col-md-6"><label class="form-label">שם משתמש למנהל המוסד</label><input class="form-control" name="manager_username" placeholder="לדוגמה: bait-talmud"></div>
          <div class="col-md-6"><label class="form-label">סיסמה ראשונית</label><input class="form-control" name="manager_password" placeholder="ייווצר אוטומטית אם תשאיר ריק"></div>
        </div>
        <div class="mt-3"><label class="form-label">תקציב כולל (₪)</label><input type="number" class="form-control" name="budget_total" value="0"></div>
      </form>
      <div class="alert alert-info small mt-3">לאחר היצירה — פרטי המנהל יוצגו לך. שמור אותם כדי לתת למנהל המוסד.</div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" data-bs-dismiss="modal">ביטול</button>
      <button class="btn btn-primary" id="saveOrg">צור</button>
    </div>`);
  document.getElementById('saveOrg').onclick = async () => {
    const fd = new FormData(document.getElementById('orgForm'));
    const btn = document.getElementById('saveOrg');
    btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> יוצר…';
    const r = await api('createOrg', [
      State.user.username,
      fd.get('name'),
      fd.get('manager_username') || '',
      fd.get('manager_password') || '',
      Number(fd.get('budget_total') || 0)
    ]);
    if (!r.ok) { notify('שגיאה: '+r.error,'error'); btn.disabled = false; btn.innerHTML = 'צור'; return; }
    closeModal();
    const o = r.data;
    notify('המוסד נוצר','success');
    openModal(`
      <div class="modal-header"><h5 class="modal-title">פרטי המוסד החדש</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">
        <p><strong>שם:</strong> ${escHtml(o.name)}</p>
        <p><strong>תקציב:</strong> ${fmtMoney(o.budget_total)}</p>
        ${o.manager_username ? `<div class="alert alert-success">
          <strong>פרטי כניסה למנהל המוסד:</strong><br>
          שם משתמש: <code>${escHtml(o.manager_username)}</code><br>
          סיסמה: <code>${escHtml(fd.get('manager_password') || '(אוטומטי — בקש מהאדמין לאפס)')}</code>
        </div>` : ''}
        <a class="btn btn-outline-primary" target="_blank" href="https://docs.google.com/spreadsheets/d/${escAttr(o.sheet_id)}/edit"><i class="bi bi-table"></i> פתח את הספרדשיט</a>
      </div>
      <div class="modal-footer"><button class="btn btn-primary" data-bs-dismiss="modal" onclick="renderOrgs()">סגור</button></div>`);
  };
}
window.openCreateOrg = openCreateOrg;

async function openEditOrg(id) {
  const o = State.orgs.find(x => x.id === id) || (await api('listOrgs',[])).data.find(x => x.id === id);
  if (!o) return;
  openModal(`
    <div class="modal-header"><h5 class="modal-title">עריכת מוסד</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
    <div class="modal-body">
      <form id="orgForm">
        <div class="mb-3"><label class="form-label">שם המוסד</label><input class="form-control" name="name" value="${escAttr(o.name)}"></div>
        <div class="mb-3"><label class="form-label">תקציב כולל</label><input type="number" class="form-control" name="budget_total" value="${escAttr(o.budget_total||0)}"></div>
        <div class="mb-3"><label class="form-label">הערות</label><textarea class="form-control" name="notes">${escHtml(o.notes||'')}</textarea></div>
      </form>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" data-bs-dismiss="modal">ביטול</button>
      <button class="btn btn-primary" id="saveEdit">שמור</button>
    </div>`);
  document.getElementById('saveEdit').onclick = async () => {
    const fd = new FormData(document.getElementById('orgForm'));
    const fields = {name: fd.get('name'), budget_total: Number(fd.get('budget_total')||0), notes: fd.get('notes')};
    const r = await api('updateOrg', [State.user.username, id, fields]);
    if (r.ok) { notify('נשמר','success'); closeModal(); renderOrgs(); }
    else notify('שגיאה: '+r.error,'error');
  };
}
window.openEditOrg = openEditOrg;

async function deleteOrg(id, name) {
  if (!confirm(`להסתיר את "${name}"? (לא נמחק - רק מוסתר)`)) return;
  const r = await api('deleteOrg', [State.user.username, id]);
  if (r.ok) { notify('הוסר','success'); renderOrgs(); }
  else notify('שגיאה: '+r.error,'error');
}
window.deleteOrg = deleteOrg;

// ---- users -----------------------------------------------------------
async function renderUsers() {
  if (State.user.role !== 'admin') { notify('רק למנהל כללי','warn'); goto('home'); return; }
  const root = document.getElementById('page-users');
  root.innerHTML = `
    <div class="d-flex align-items-center justify-content-between mb-3">
      <h3>ניהול משתמשים</h3>
      <div>
        <button class="btn btn-sm btn-primary" onclick="openAddUser()"><i class="bi bi-plus-lg"></i> משתמש חדש</button>
        <button class="btn btn-sm btn-outline-secondary" onclick="goto('home')"><i class="bi bi-arrow-right"></i> חזרה</button>
      </div>
    </div>
    <div class="table-wrap shadow-sm"><table class="table table-hover mb-0" id="usersTbl"><tbody><tr><td>טוען…</td></tr></tbody></table></div>`;
  const r = await api('listUsers', []);
  if (!r.ok) { document.querySelector('#usersTbl tbody').innerHTML = `<tr><td class="text-danger">${escHtml(r.error)}</td></tr>`; return; }
  const tbl = document.getElementById('usersTbl');
  tbl.innerHTML = `<thead><tr><th>שם משתמש</th><th>שם</th><th>תפקיד</th><th>מוסד</th><th>נוסף בתאריך</th><th></th></tr></thead>
  <tbody>${(r.data||[]).map(u => `
    <tr>
      <td><code>${escHtml(u.username)}</code></td>
      <td>${escHtml(u.name)}</td>
      <td><span class="status-pill ${u.role==='admin'?'approved':'draft'}">${escHtml(u.role)}</span></td>
      <td>${escHtml(u.org_id||'—')}</td>
      <td>${fmtDateTime(u.added_at)}</td>
      <td class="row-actions">
        <button class="btn btn-sm btn-outline-warning" onclick="resetPassword('${escAttr(u.username)}')" title="איפוס סיסמה"><i class="bi bi-key"></i></button>
        ${u.username !== 'admin' ? `<button class="btn btn-sm btn-outline-danger" onclick="removeUser('${escAttr(u.username)}')"><i class="bi bi-trash"></i></button>` : ''}
      </td>
    </tr>`).join('')}</tbody>`;
}
window.renderUsers = renderUsers;

function openAddUser() {
  const orgs = State.orgs.length ? State.orgs : [];
  openModal(`
    <div class="modal-header"><h5 class="modal-title">משתמש חדש</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
    <div class="modal-body">
      <form id="userForm">
        <div class="row g-3">
          <div class="col-md-6"><label class="form-label">שם משתמש <span class="text-danger">*</span></label><input class="form-control" name="username" required></div>
          <div class="col-md-6"><label class="form-label">סיסמה</label><input class="form-control" name="password"></div>
          <div class="col-md-6"><label class="form-label">שם מלא</label><input class="form-control" name="name"></div>
          <div class="col-md-6"><label class="form-label">תפקיד</label>
            <select class="form-select" name="role"><option value="manager">מנהל מוסד</option><option value="admin">מנהל כללי</option></select></div>
          <div class="col-12"><label class="form-label">מוסד (לא חובה לאדמין)</label>
            <select class="form-select" name="org_id"><option value="">— ללא —</option>${orgs.map(o => `<option value="${escAttr(o.id)}">${escHtml(o.name)}</option>`).join('')}</select></div>
        </div>
      </form>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" data-bs-dismiss="modal">ביטול</button>
      <button class="btn btn-primary" id="saveUser">הוסף</button>
    </div>`);
  document.getElementById('saveUser').onclick = async () => {
    const fd = new FormData(document.getElementById('userForm'));
    const r = await api('addUser', [
      State.user.username, fd.get('username'), fd.get('password') || '',
      fd.get('role'), fd.get('org_id') || '', fd.get('name') || ''
    ]);
    if (r.ok) { notify('נוסף','success'); closeModal(); renderUsers(); }
    else notify('שגיאה: '+r.error,'error');
  };
}
window.openAddUser = openAddUser;

async function resetPassword(username) {
  const newP = prompt(`סיסמה חדשה ל-${username}:`, '');
  if (!newP) return;
  const r = await api('changePassword', [State.user.username, username, newP]);
  if (r.ok) notify('הסיסמה אופסה','success');
  else notify('שגיאה: '+r.error,'error');
}
window.resetPassword = resetPassword;

async function removeUser(username) {
  if (!confirm(`להסיר את ${username}?`)) return;
  const r = await api('removeUser', [State.user.username, username]);
  if (r.ok) { notify('הוסר','success'); renderUsers(); }
  else notify('שגיאה: '+r.error,'error');
}
window.removeUser = removeUser;
