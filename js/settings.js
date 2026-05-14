// ניהול מוסדות — settings page (org config: budgets, categories, contact info)

async function renderSettings() {
  if (State.user.role !== 'admin') { notify('רק למנהל כללי','warn'); goto('home'); return; }
  const org = currentOrg();
  if (!org) { notify('אין מוסד פעיל','warn'); goto('home'); return; }
  const root = document.getElementById('page-settings');
  root.innerHTML = `
    <div class="d-flex align-items-center justify-content-between mb-3">
      <div>
        <h3 class="mb-0"><i class="bi bi-gear"></i> הגדרות</h3>
        <div class="text-muted small">${escHtml(org.name)}</div>
      </div>
      <button class="btn btn-sm btn-outline-secondary" onclick="goto('home')"><i class="bi bi-house"></i></button>
    </div>
    <div id="settingsContent" class="loader">טוען…</div>
  `;
  const r = await api('getConfig', [State.user.username, org.id]);
  if (!r.ok) { document.getElementById('settingsContent').innerHTML = `<div class="alert alert-danger">${escHtml(r.error)}</div>`; return; }
  const cfg = r.data || {};
  document.getElementById('settingsContent').innerHTML = `
    <div class="row g-3">
      <div class="col-lg-6">
        <div class="card p-3 shadow-sm">
          <h6 class="mb-3"><i class="bi bi-wallet2"></i> תקציב</h6>
          <div class="mb-2">
            <label class="form-label small mb-1">סך תקציב</label>
            <input type="number" class="form-control" id="cfg-budget_total" value="${Number(cfg.budget_total)||0}">
          </div>
          <div class="row g-2">
            <div class="col-4">
              <label class="form-label small mb-1">תקציב פעילות</label>
              <input type="number" class="form-control" id="cfg-budget_פעילות" value="${Number(cfg['budget_פעילות'])||0}">
            </div>
            <div class="col-4">
              <label class="form-label small mb-1">תקציב ספקים</label>
              <input type="number" class="form-control" id="cfg-budget_ספקים" value="${Number(cfg['budget_ספקים'])||0}">
            </div>
            <div class="col-4">
              <label class="form-label small mb-1">תקציב בעלות</label>
              <input type="number" class="form-control" id="cfg-budget_בעלות" value="${Number(cfg['budget_בעלות'])||0}">
            </div>
          </div>
        </div>
      </div>
      <div class="col-lg-6">
        <div class="card p-3 shadow-sm">
          <h6 class="mb-3"><i class="bi bi-building"></i> פרטי עמותה</h6>
          <div class="mb-2"><label class="form-label small mb-1">שם עמותה</label>
            <input class="form-control" id="cfg-amuta_name" value="${escAttr(cfg.amuta_name||'')}"></div>
          <div class="row g-2">
            <div class="col-6"><label class="form-label small mb-1">מספר ע"ר</label>
              <input class="form-control" id="cfg-amuta_id" value="${escAttr(cfg.amuta_id||'')}"></div>
            <div class="col-6"><label class="form-label small mb-1">סמל מוסד</label>
              <input class="form-control" id="cfg-amuta_symbol" value="${escAttr(cfg.amuta_symbol||'')}"></div>
          </div>
          <div class="mb-2"><label class="form-label small mb-1">כתובת</label>
            <input class="form-control" id="cfg-amuta_address" value="${escAttr(cfg.amuta_address||'')}"></div>
          <div class="mb-2"><label class="form-label small mb-1">אימייל</label>
            <input class="form-control" id="cfg-amuta_email" value="${escAttr(cfg.amuta_email||'')}"></div>
        </div>
      </div>
    </div>

    <div class="card p-3 mt-3 shadow-sm">
      <h6 class="mb-3"><i class="bi bi-tags"></i> קטגוריות</h6>
      <div class="text-muted small mb-2">קטגוריות מופרדות בנקודה-פסיק (;). יהיו זמינות בdropdown של עריכת שורה.</div>
      <textarea class="form-control" id="cfg-categories" rows="3">${escHtml(cfg.categories||'')}</textarea>
    </div>

    <div class="card p-3 mt-3 shadow-sm">
      <h6 class="mb-3"><i class="bi bi-list-check"></i> סטטוסי workflow</h6>
      <div class="text-muted small mb-2">סטטוסי השורות. ברירת מחדל: טיוטה;ממתין לאישור;מאושר;שולם;בוטל</div>
      <textarea class="form-control" id="cfg-workflow_statuses" rows="2">${escHtml(cfg.workflow_statuses||'טיוטה;ממתין לאישור;מאושר;שולם;בוטל')}</textarea>
    </div>

    <div class="mt-3 d-flex gap-2">
      <button class="btn btn-primary" onclick="saveSettings()"><i class="bi bi-check2"></i> שמור הגדרות</button>
      <button class="btn btn-outline-secondary" onclick="goto('home')"><i class="bi bi-x"></i> ביטול</button>
    </div>
  `;
}
window.renderSettings = renderSettings;

async function saveSettings() {
  const kv = {};
  document.querySelectorAll('[id^="cfg-"]').forEach(el => {
    const key = el.id.slice(4);
    kv[key] = el.value;
  });
  showLoading('שומר...');
  const r = await api('setConfig', [State.user.username, State.currentOrgId, kv]);
  hideLoading();
  if (r.ok) { notify('נשמר','success'); renderDashboard(); }
  else notify('שגיאה: '+r.error,'error');
}
window.saveSettings = saveSettings;
