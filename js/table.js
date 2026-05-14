// ניהול מוסדות — table view (פעילות / ספקים / בעלות / חשבוניות / קבלות)

const HIDDEN_COLS = ['נוצר ע"י','נוצר בתאריך','נעול'];
const EDITABLE_EXCLUDE = ['מספר סידורי','נוצר ע"י','נוצר בתאריך','נעול','מאשר','קישור חשבונית','קישור קבלה'];

async function renderTable(sheetName) {
  const root = document.getElementById('page-table');
  const org = currentOrg();
  if (!org) {
    root.innerHTML = '<div class="empty-state"><i class="bi bi-folder-x"></i><div>אין מוסד פעיל. פנה למנהל הכללי.</div></div>';
    return;
  }
  root.innerHTML = `
    <div class="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
      <div>
        <h3 class="mb-0">${escHtml(sheetName)}</h3>
        <div class="text-muted small">${escHtml(org.name)}</div>
      </div>
      <div class="d-flex gap-2 align-items-center flex-wrap">
        <div class="search-box"><i class="bi bi-search text-muted"></i><input id="searchInput" placeholder="חיפוש מהיר…"></div>
        <button class="btn btn-sm btn-outline-secondary" onclick="goto('home')"><i class="bi bi-arrow-right"></i> חזרה</button>
        <button class="btn btn-sm btn-outline-primary" onclick="reloadTable('${escAttr(sheetName)}')"><i class="bi bi-arrow-clockwise"></i> רענן</button>
        ${isDataSheet(sheetName) ? `<button class="btn btn-sm btn-primary" onclick="openRowEditor('${escAttr(sheetName)}', null)"><i class="bi bi-plus-lg"></i> שורה חדשה</button>` : ''}
      </div>
    </div>
    <div class="table-wrap shadow-sm"><table class="table table-hover table-sm mb-0" id="dataTable"><thead></thead><tbody><tr><td>טוען…</td></tr></tbody></table></div>
    <div class="text-muted small mt-2" id="tableInfo"></div>
  `;
  const cacheKey = `${org.id}:${sheetName}`;
  if (!State.cache[cacheKey]) {
    const r = await api('getSheet', [State.user.username, org.id, sheetName]);
    if (!r.ok) {
      document.getElementById('dataTable').innerHTML = `<tbody><tr><td class="text-danger">שגיאה: ${escHtml(r.error)}</td></tr></tbody>`;
      return;
    }
    State.cache[cacheKey] = r.data;
  }
  const data = State.cache[cacheKey];
  function paint(filter) {
    const headers = data.headers || [];
    const visibleCols = headers.filter(h => h && HIDDEN_COLS.indexOf(h) < 0);
    const rows = (data.rows || []).filter(r => {
      if (!filter) return true;
      return Object.values(r).join(' ').toLowerCase().indexOf(filter.toLowerCase()) >= 0;
    });
    const tbl = document.getElementById('dataTable');
    let thead = '<tr>' + visibleCols.map(h => `<th>${escHtml(h)}</th>`).join('') + '<th></th></tr>';
    tbl.querySelector('thead').innerHTML = thead;
    if (!rows.length) {
      tbl.querySelector('tbody').innerHTML = `<tr><td colspan="${visibleCols.length+1}" class="text-center text-muted py-4">אין שורות${filter?' תואמות חיפוש':''}.</td></tr>`;
      document.getElementById('tableInfo').textContent = `${rows.length} מתוך ${(data.rows||[]).length} שורות`;
      return;
    }
    const html = rows.map(r => {
      const locked = isRowLocked(r);
      const cells = visibleCols.map(h => formatCell(h, r[h], r)).join('');
      return `<tr data-row="${r._row}" class="${locked?'locked-row':''}">${cells}<td class="row-actions">${renderActions(sheetName, r, locked)}</td></tr>`;
    }).join('');
    tbl.querySelector('tbody').innerHTML = html;
    tbl.querySelectorAll('tr[data-row]').forEach(tr => {
      const _row = Number(tr.dataset.row);
      const rowObj = data.rows.find(x => x._row === _row);
      tr.querySelectorAll('[data-act]').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const act = btn.dataset.act;
          if (act === 'edit') openRowEditor(sheetName, rowObj);
          if (act === 'invoice') openUploadDialog(sheetName, rowObj, 'invoice');
          if (act === 'receipt') openUploadDialog(sheetName, rowObj, 'receipt');
          if (act === 'approve') quickStatus(sheetName, rowObj, 'מאושר');
          if (act === 'pay')     quickStatus(sheetName, rowObj, 'שולם');
        };
      });
    });
    document.getElementById('tableInfo').textContent = `${rows.length} מתוך ${(data.rows||[]).length} שורות`;
  }
  paint('');
  let timer;
  document.getElementById('searchInput').oninput = e => { clearTimeout(timer); timer = setTimeout(() => paint(e.target.value), 200); };
}
window.renderTable = renderTable;

function isDataSheet(name) {
  return ['פעילות','ספקים','בעלות'].indexOf(name) >= 0;
}

function isRowLocked(r) {
  const v = r['נעול'];
  if (v === true || String(v).toLowerCase() === 'true') return true;
  const s = String(r['סטטוס']||'').trim();
  return s === 'מאושר' || s === 'שולם';
}
window.isRowLocked = isRowLocked;

function formatCell(h, v, row) {
  if (h === 'סכום') return `<td class="num">${fmtMoney(v)}</td>`;
  if (h === 'תאריך חשבון' || h === 'נוצר בתאריך') return `<td>${fmtDate(v)}</td>`;
  if (h === 'סטטוס') return `<td><span class="status-pill ${statusClass(v)}">${escHtml(v||'טיוטה')}</span></td>`;
  if (h === 'קישור חשבונית' || h === 'קישור קבלה') {
    return v ? `<td><a class="file-link" target="_blank" href="${escAttr(v)}">פתח</a></td>` : '<td><span class="no-file">—</span></td>';
  }
  return `<td>${escHtml(v)}</td>`;
}

function renderActions(sheetName, r, locked) {
  if (!isDataSheet(sheetName)) {
    if ((sheetName === 'חשבוניות' || sheetName === 'קבלות') && r['קישור']) {
      return `<a class="btn btn-sm btn-outline-primary" target="_blank" href="${escAttr(r['קישור'])}">פתח</a>`;
    }
    return '';
  }
  const isAdmin = State.user.role === 'admin';
  const editBtn  = `<button class="btn btn-sm btn-outline-secondary" data-act="edit" title="ערוך"><i class="bi bi-pencil"></i></button>`;
  const invBtn   = `<button class="btn btn-sm btn-outline-info" data-act="invoice" title="חשבונית"><i class="bi bi-receipt"></i></button>`;
  const recBtn   = `<button class="btn btn-sm btn-outline-success" data-act="receipt" title="קבלה"><i class="bi bi-envelope-paper"></i></button>`;
  const approveBtn = isAdmin && !locked ? `<button class="btn btn-sm btn-outline-success" data-act="approve" title="אישור"><i class="bi bi-check2"></i></button>` : '';
  return [editBtn, invBtn, recBtn, approveBtn].filter(Boolean).join(' ');
}

async function reloadTable(sheetName) {
  delete State.cache[`${State.currentOrgId}:${sheetName}`];
  await renderTable(sheetName);
}
window.reloadTable = reloadTable;

// ---- row editor -------------------------------------------------------
function openRowEditor(sheetName, rowObj) {
  const isNew = !rowObj;
  const cacheKey = `${State.currentOrgId}:${sheetName}`;
  const headers = (State.cache[cacheKey] || {}).headers || [];
  const editable = headers.filter(h => h && EDITABLE_EXCLUDE.indexOf(h) < 0);
  const isAdmin = State.user.role === 'admin';
  const locked = !isNew && isRowLocked(rowObj);

  const formHtml = `
    <div class="modal-header">
      <h5 class="modal-title">${isNew ? 'שורה חדשה' : 'עריכת שורה'} <span class="text-muted small">${isNew?'':'#'+escHtml(rowObj['מספר סידורי']||rowObj._row)}</span></h5>
      <button class="btn-close" data-bs-dismiss="modal"></button>
    </div>
    <div class="modal-body">
      ${locked && !isAdmin ? `<div class="alert alert-warning">🔒 שורה נעולה (סטטוס: ${escHtml(rowObj['סטטוס']||'')}). רק מנהל כללי יכול לערוך.</div>` : ''}
      <form id="rowForm">
        <div class="row g-3">
          ${editable.map(h => fieldHtml(h, isNew ? null : rowObj[h])).join('')}
        </div>
      </form>
    </div>
    <div class="modal-footer">
      ${!isNew && (isAdmin || !locked) ? `<button class="btn btn-outline-danger me-auto" id="delBtn"><i class="bi bi-trash"></i> מחק</button>` : ''}
      ${!isNew && isAdmin ? `<button class="btn btn-outline-warning" id="lockBtn">${locked?'<i class="bi bi-unlock"></i> בטל נעילה':'<i class="bi bi-lock"></i> נעל'}</button>` : ''}
      <button class="btn btn-secondary" data-bs-dismiss="modal">ביטול</button>
      <button class="btn btn-primary" id="saveBtn" ${locked && !isAdmin ? 'disabled' : ''}>שמור</button>
    </div>`;
  openModal(formHtml);
  document.getElementById('saveBtn').onclick = async () => {
    const fields = collectFields();
    const btn = document.getElementById('saveBtn');
    btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> שומר…';
    try {
      let r;
      if (isNew) r = await api('addRow', [State.user.username, State.currentOrgId, sheetName, fields]);
      else r = await api('updateRow', [State.user.username, State.currentOrgId, sheetName, rowObj._row, fields]);
      if (!r.ok) throw new Error(r.error || 'שגיאה');
      notify(isNew?'נוסף':'נשמר','success'); closeModal(); reloadTable(sheetName); renderDashboard();
    } catch (e) {
      notify('שגיאה: ' + e.message, 'error');
      btn.disabled = false; btn.innerHTML = 'שמור';
    }
  };
  if (!isNew && (isAdmin || !locked)) document.getElementById('delBtn').onclick = async () => {
    if (!confirm('למחוק את השורה?')) return;
    const r = await api('deleteRow', [State.user.username, State.currentOrgId, sheetName, rowObj._row]);
    if (r.ok) { notify('נמחק','success'); closeModal(); reloadTable(sheetName); renderDashboard(); }
    else notify('שגיאה: '+r.error,'error');
  };
  if (!isNew && isAdmin) document.getElementById('lockBtn').onclick = async () => {
    const r = await api('setLock', [State.user.username, State.currentOrgId, sheetName, rowObj._row, !locked]);
    if (r.ok) { notify(locked?'נפתחה נעילה':'ננעלה','success'); closeModal(); reloadTable(sheetName); }
    else notify('שגיאה: '+r.error,'error');
  };
}
window.openRowEditor = openRowEditor;

function fieldHtml(h, v) {
  const safe = escAttr(v == null ? '' : v);
  if (h === 'סטטוס') {
    const opts = ['טיוטה','ממתין לאישור','מאושר','שולם','בוטל'];
    return `<div class="col-md-6"><label class="form-label">${escHtml(h)}</label>
      <select class="form-select" name="${escAttr(h)}">${opts.map(o => `<option ${o===String(v)?'selected':''}>${o}</option>`).join('')}</select></div>`;
  }
  if (h === 'תאריך חשבון') {
    let d = '';
    if (v) { const dt = new Date(v); if (!isNaN(dt.getTime())) d = dt.toISOString().slice(0,10); }
    return `<div class="col-md-6"><label class="form-label">${escHtml(h)}</label>
      <input type="date" class="form-control" name="${escAttr(h)}" value="${d}"></div>`;
  }
  if (h === 'סכום') {
    return `<div class="col-md-6"><label class="form-label">${escHtml(h)} <span class="text-danger">*</span></label>
      <input type="number" step="0.01" class="form-control" name="${escAttr(h)}" value="${safe}"></div>`;
  }
  if (h === 'קטגורית מטרה') {
    const cats = ['אחר','פעילות חודשית','פעילות פרטנית','אחזקה ותחזוקה','נקיון וציוד נקיון','קייטרינג','שכירות','אישורים','ציוד משרדי','הסעות','חשבונות שוטפים','קופה קטנה','מחנה חורף','פעילות אלול'];
    return `<div class="col-md-6"><label class="form-label">${escHtml(h)}</label>
      <input class="form-control" list="cat-list" name="${escAttr(h)}" value="${safe}">
      <datalist id="cat-list">${cats.map(c => `<option value="${c}">`).join('')}</datalist></div>`;
  }
  if (h === 'פירוט המטרה') {
    return `<div class="col-12"><label class="form-label">${escHtml(h)}</label>
      <input class="form-control" name="${escAttr(h)}" value="${safe}"></div>`;
  }
  return `<div class="col-md-6"><label class="form-label">${escHtml(h)}</label>
    <input class="form-control" name="${escAttr(h)}" value="${safe}"></div>`;
}

function collectFields() {
  const f = {};
  document.querySelectorAll('#rowForm [name]').forEach(el => f[el.name] = el.value);
  return f;
}

async function quickStatus(sheetName, rowObj, status) {
  const r = await api('setStatus', [State.user.username, State.currentOrgId, sheetName, rowObj._row, status]);
  if (r.ok) { notify('סטטוס עודכן: '+status,'success'); reloadTable(sheetName); renderDashboard(); }
  else notify('שגיאה: '+r.error,'error');
}
window.quickStatus = quickStatus;

// ---- modal helpers ----------------------------------------------------
let _modal = null;
function openModal(html) {
  const el = document.getElementById('genericModal');
  el.querySelector('.modal-content').innerHTML = html;
  _modal = new bootstrap.Modal(el);
  _modal.show();
}
function closeModal() { if (_modal) _modal.hide(); }
window.openModal = openModal; window.closeModal = closeModal;
