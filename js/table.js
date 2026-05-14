// ניהול מוסדות — table view (פעילות / ספקים / בעלות / חשבוניות / קבלות)

const HIDDEN_COLS = ['נוצר ע"י','נוצר בתאריך','נעול'];
const EDITABLE_EXCLUDE = ['מספר סידורי','נוצר ע"י','נוצר בתאריך','נעול','מאשר','קישור חשבונית','קישור קבלה'];

const _filterState = {}; // {sheetName: {q, status, category, dateFrom, dateTo, sumMin, sumMax}}

async function renderTable(sheetName) {
  const root = document.getElementById('page-table');
  const org = currentOrg();
  if (!org) {
    root.innerHTML = '<div class="empty-state"><i class="bi bi-folder-x"></i><div>אין מוסד פעיל. פנה למנהל הכללי.</div></div>';
    return;
  }
  _filterState[sheetName] = _filterState[sheetName] || {};

  root.innerHTML = `
    <div class="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
      <div>
        <h3 class="mb-0">${escHtml(sheetName)}</h3>
        <div class="text-muted small">${escHtml(org.name)} <span id="tableCounter" class="ms-2"></span></div>
      </div>
      <div class="d-flex gap-2 align-items-center flex-wrap">
        <div class="search-box"><i class="bi bi-search text-muted"></i><input id="searchInput" placeholder="חיפוש מהיר…"></div>
        <button class="btn btn-sm btn-outline-secondary" id="toggleFilters" title="סינון"><i class="bi bi-funnel"></i></button>
        <button class="btn btn-sm btn-outline-secondary" onclick="exportSheet('${escAttr(sheetName)}')" title="ייצוא לאקסל"><i class="bi bi-file-earmark-excel"></i></button>
        <button class="btn btn-sm btn-outline-primary" onclick="reloadTable('${escAttr(sheetName)}')" title="רענן"><i class="bi bi-arrow-clockwise"></i></button>
        <button class="btn btn-sm btn-outline-secondary" onclick="goto('home')"><i class="bi bi-house"></i></button>
        ${isDataSheet(sheetName) ? `<button class="btn btn-sm btn-primary" onclick="openRowEditor('${escAttr(sheetName)}', null)"><i class="bi bi-plus-lg"></i> שורה חדשה</button>` : ''}
      </div>
    </div>

    <div class="filter-chips" id="filterChips"></div>

    <div id="filtersPanel" class="card p-3 mb-3 d-none">
      <div class="row g-2 align-items-end">
        <div class="col-md-3">
          <label class="form-label small mb-1">סטטוס</label>
          <select class="form-select form-select-sm" id="fltStatus">
            <option value="">הכל</option>
            <option>טיוטה</option><option>ממתין לאישור</option>
            <option>מאושר</option><option>שולם</option><option>בוטל</option>
          </select>
        </div>
        <div class="col-md-3">
          <label class="form-label small mb-1">קטגוריה</label>
          <select class="form-select form-select-sm" id="fltCategory"><option value="">הכל</option></select>
        </div>
        <div class="col-md-2">
          <label class="form-label small mb-1">מתאריך</label>
          <input type="date" class="form-control form-control-sm" id="fltDateFrom">
        </div>
        <div class="col-md-2">
          <label class="form-label small mb-1">עד תאריך</label>
          <input type="date" class="form-control form-control-sm" id="fltDateTo">
        </div>
        <div class="col-md-1">
          <label class="form-label small mb-1">סכום מ-</label>
          <input type="number" class="form-control form-control-sm" id="fltSumMin">
        </div>
        <div class="col-md-1">
          <label class="form-label small mb-1">עד</label>
          <input type="number" class="form-control form-control-sm" id="fltSumMax">
        </div>
        <div class="col-12">
          <button class="btn btn-sm btn-outline-secondary" onclick="clearFilters('${escAttr(sheetName)}')"><i class="bi bi-x-lg"></i> נקה</button>
          <span id="filterSummary" class="text-muted small ms-2"></span>
        </div>
      </div>
    </div>

    <div class="table-wrap shadow-sm"><table class="table table-hover table-sm mb-0" id="dataTable"><thead></thead><tbody><tr><td>טוען…</td></tr></tbody></table></div>
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

  // Populate categories
  const cats = new Set();
  (data.rows||[]).forEach(r => { if (r['קטגורית מטרה']) cats.add(r['קטגורית מטרה']); });
  const catSel = document.getElementById('fltCategory');
  Array.from(cats).sort().forEach(c => {
    const opt = document.createElement('option'); opt.value = c; opt.textContent = c; catSel.appendChild(opt);
  });

  // Restore filter state
  const fs = _filterState[sheetName];
  ['fltStatus','fltCategory','fltDateFrom','fltDateTo','fltSumMin','fltSumMax'].forEach(id => {
    const el = document.getElementById(id);
    const key = id.replace('flt','').toLowerCase();
    const keyMap = {status:'status', category:'category', datefrom:'dateFrom', dateto:'dateTo', summin:'sumMin', summax:'sumMax'};
    if (fs[keyMap[key]] !== undefined && fs[keyMap[key]] !== '') el.value = fs[keyMap[key]];
  });
  document.getElementById('searchInput').value = fs.q || '';

  // Bind filter controls
  document.getElementById('toggleFilters').onclick = () => {
    document.getElementById('filtersPanel').classList.toggle('d-none');
  };
  ['fltStatus','fltCategory','fltDateFrom','fltDateTo','fltSumMin','fltSumMax'].forEach(id => {
    document.getElementById(id).onchange = () => paint();
  });
  let timer;
  document.getElementById('searchInput').oninput = e => {
    clearTimeout(timer); timer = setTimeout(() => paint(), 200);
  };
  // Show filter panel if any filter active
  if (Object.values(fs).some(v => v && v !== '')) {
    document.getElementById('filtersPanel').classList.remove('d-none');
  }

  // Render quick-filter chips
  paintChips();

  function paintChips() {
    const fs = _filterState[sheetName] || {};
    document.getElementById('filterChips').innerHTML = `
      <span class="chip ${!fs.status?'active':''}" onclick="applyChip('${escAttr(sheetName)}','status','')"><i class="bi bi-list"></i> הכל</span>
      <span class="chip ${fs.status==='טיוטה'?'active':''}" onclick="applyChip('${escAttr(sheetName)}','status','טיוטה')">טיוטה</span>
      <span class="chip ${fs.status==='ממתין לאישור'?'active':''}" onclick="applyChip('${escAttr(sheetName)}','status','ממתין לאישור')">ממתין</span>
      <span class="chip ${fs.status==='מאושר'?'active':''}" onclick="applyChip('${escAttr(sheetName)}','status','מאושר')">מאושר</span>
      <span class="chip ${fs.status==='שולם'?'active':''}" onclick="applyChip('${escAttr(sheetName)}','status','שולם')">שולם</span>
      <span class="chip" onclick="applyChip('${escAttr(sheetName)}','noInvoice',1)"><i class="bi bi-receipt"></i> ללא חשבונית</span>
      <span class="chip" onclick="applyChip('${escAttr(sheetName)}','noReceipt',1)"><i class="bi bi-envelope-paper"></i> ללא קבלה</span>
      <span class="chip" onclick="applyChip('${escAttr(sheetName)}','thisMonth',1)"><i class="bi bi-calendar-month"></i> החודש</span>
    `;
  }

  function paint() {
    const fs = _filterState[sheetName] = {
      q: document.getElementById('searchInput').value || '',
      status: document.getElementById('fltStatus').value || '',
      category: document.getElementById('fltCategory').value || '',
      dateFrom: document.getElementById('fltDateFrom').value || '',
      dateTo: document.getElementById('fltDateTo').value || '',
      sumMin: document.getElementById('fltSumMin').value || '',
      sumMax: document.getElementById('fltSumMax').value || '',
      noInvoice: _filterState[sheetName].noInvoice || false,
      noReceipt: _filterState[sheetName].noReceipt || false,
      thisMonth: _filterState[sheetName].thisMonth || false,
      sortBy: _filterState[sheetName].sortBy || '',
      sortDir: _filterState[sheetName].sortDir || 'asc',
    };
    paintChips();
    const headers = data.headers || [];
    const visibleCols = headers.filter(h => h && HIDDEN_COLS.indexOf(h) < 0);
    let rows = applyFilters(data.rows || [], fs);
    // Sort if requested
    if (fs.sortBy) {
      rows = rows.slice().sort((a, b) => {
        const va = a[fs.sortBy], vb = b[fs.sortBy];
        const na = Number(va), nb = Number(vb);
        let cmp;
        if (!isNaN(na) && !isNaN(nb)) cmp = na - nb;
        else cmp = String(va||'').localeCompare(String(vb||''), 'he');
        return fs.sortDir === 'desc' ? -cmp : cmp;
      });
    }
    let sumFiltered = 0;
    rows.forEach(r => { sumFiltered += Number(r['סכום']) || 0; });

    const tbl = document.getElementById('dataTable');
    let thead = '<tr>' + visibleCols.map(h => {
      const sortableCols = ['מספר סידורי','קטגורית מטרה','שם הספק','תאריך חשבון','סכום','סטטוס'];
      if (sortableCols.indexOf(h) < 0) return `<th>${escHtml(h)}</th>`;
      let cls = 'sortable';
      if (fs.sortBy === h) cls += fs.sortDir === 'desc' ? ' sort-desc' : ' sort-asc';
      return `<th class="${cls}" onclick="toggleSort('${escAttr(sheetName)}','${escAttr(h)}')">${escHtml(h)}</th>`;
    }).join('') + '<th class="text-end">פעולות</th></tr>';
    tbl.querySelector('thead').innerHTML = thead;
    if (!rows.length) {
      tbl.querySelector('tbody').innerHTML = `<tr><td colspan="${visibleCols.length+1}" class="text-center text-muted py-4">אין שורות תואמות.</td></tr>`;
    } else {
      tbl.querySelector('tbody').innerHTML = rows.map(r => {
        const locked = isRowLocked(r);
        const cells = visibleCols.map(h => formatCell(h, r[h], r)).join('');
        return `<tr data-row="${r._row}" class="${locked?'locked-row':''}">${cells}<td class="row-actions text-end">${renderActions(sheetName, r, locked)}</td></tr>`;
      }).join('');
      tbl.querySelectorAll('tr[data-row]').forEach(tr => {
        const _row = Number(tr.dataset.row);
        const rowObj = data.rows.find(x => x._row === _row);
        tr.querySelectorAll('[data-act]').forEach(btn => {
          btn.onclick = (e) => {
            e.stopPropagation();
            const act = btn.dataset.act;
            if (act === 'edit')     openRowEditor(sheetName, rowObj);
            if (act === 'invoice')  openUploadDialog(sheetName, rowObj, 'invoice');
            if (act === 'receipt')  openUploadDialog(sheetName, rowObj, 'receipt');
            if (act === 'approve')  quickStatus(sheetName, rowObj, 'מאושר');
            if (act === 'pay')      quickStatus(sheetName, rowObj, 'שולם');
            if (act === 'pending')  quickStatus(sheetName, rowObj, 'ממתין לאישור');
          };
        });
      });
    }
    document.getElementById('tableCounter').innerHTML =
      `<i class="bi bi-rows"></i> ${rows.length} מתוך ${(data.rows||[]).length}` +
      (sumFiltered ? ` · <i class="bi bi-coin"></i> ${fmtMoney(sumFiltered)}` : '');
    // Filter summary
    const active = Object.entries(fs).filter(([k,v]) => v && v !== '' && k !== 'q').length;
    document.getElementById('filterSummary').textContent = active ? `${active} מסננים פעילים` : '';
  }
  paint();
}
window.renderTable = renderTable;

function applyFilters(rows, fs) {
  return rows.filter(r => {
    if (fs.q && !Object.values(r).join(' ').toLowerCase().includes(fs.q.toLowerCase())) return false;
    if (fs.status && String(r['סטטוס']||'').trim() !== fs.status) return false;
    if (fs.category && String(r['קטגורית מטרה']||'').trim() !== fs.category) return false;
    if (fs.dateFrom || fs.dateTo) {
      const d = r['תאריך חשבון'] ? new Date(r['תאריך חשבון']) : null;
      if (!d || isNaN(d.getTime())) return false;
      if (fs.dateFrom && d < new Date(fs.dateFrom)) return false;
      if (fs.dateTo && d > new Date(fs.dateTo)) return false;
    }
    const s = Number(r['סכום']) || 0;
    if (fs.sumMin && s < Number(fs.sumMin)) return false;
    if (fs.sumMax && s > Number(fs.sumMax)) return false;
    if (fs.noInvoice && r['קישור חשבונית']) return false;
    if (fs.noReceipt && r['קישור קבלה']) return false;
    if (fs.thisMonth) {
      const d = r['תאריך חשבון'] ? new Date(r['תאריך חשבון']) : null;
      if (!d || isNaN(d.getTime())) return false;
      const now = new Date();
      if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) return false;
    }
    return true;
  });
}

function applyChip(sheetName, key, value) {
  _filterState[sheetName] = _filterState[sheetName] || {};
  // Toggle for boolean chips
  if (key === 'noInvoice' || key === 'noReceipt' || key === 'thisMonth') {
    _filterState[sheetName][key] = !_filterState[sheetName][key];
  } else {
    _filterState[sheetName][key] = value;
  }
  renderTable(sheetName);
}
window.applyChip = applyChip;

function toggleSort(sheetName, col) {
  const fs = _filterState[sheetName] = _filterState[sheetName] || {};
  if (fs.sortBy === col) {
    fs.sortDir = fs.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    fs.sortBy = col;
    fs.sortDir = 'asc';
  }
  renderTable(sheetName);
}
window.toggleSort = toggleSort;

function clearFilters(sheetName) {
  _filterState[sheetName] = {};
  renderTable(sheetName);
}
window.clearFilters = clearFilters;

function isDataSheet(name) { return ['פעילות','ספקים','בעלות'].indexOf(name) >= 0; }

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
      return `<a class="btn btn-sm btn-outline-primary" target="_blank" href="${escAttr(r['קישור'])}"><i class="bi bi-box-arrow-up-left"></i></a>`;
    }
    return '';
  }
  const isAdmin = State.user.role === 'admin';
  const status = String(r['סטטוס']||'').trim();
  const buttons = [];
  buttons.push(`<button class="btn btn-sm btn-outline-secondary" data-act="edit" title="ערוך"><i class="bi bi-pencil"></i></button>`);
  if (!r['קישור חשבונית']) buttons.push(`<button class="btn btn-sm btn-outline-info" data-act="invoice" title="חשבונית"><i class="bi bi-receipt"></i></button>`);
  else buttons.push(`<button class="btn btn-sm btn-info" data-act="invoice" title="החלף חשבונית"><i class="bi bi-receipt-cutoff"></i></button>`);
  if (!r['קישור קבלה']) buttons.push(`<button class="btn btn-sm btn-outline-success" data-act="receipt" title="קבלה"><i class="bi bi-envelope-paper"></i></button>`);
  else buttons.push(`<button class="btn btn-sm btn-success" data-act="receipt" title="החלף קבלה"><i class="bi bi-envelope-paper-fill"></i></button>`);
  // Quick status (admin only)
  if (isAdmin && !locked) {
    if (status === 'טיוטה' || status === '') {
      buttons.push(`<button class="btn btn-sm btn-outline-warning" data-act="pending" title="העבר לאישור"><i class="bi bi-hourglass-split"></i></button>`);
    }
    if (status === 'ממתין לאישור' || status === 'טיוטה' || status === '') {
      buttons.push(`<button class="btn btn-sm btn-outline-success" data-act="approve" title="אישור"><i class="bi bi-check2-circle"></i></button>`);
    }
    if (status === 'מאושר') {
      buttons.push(`<button class="btn btn-sm btn-outline-primary" data-act="pay" title="סמן כשולם"><i class="bi bi-cash-coin"></i></button>`);
    }
  }
  return buttons.join(' ');
}

async function reloadTable(sheetName) {
  delete State.cache[`${State.currentOrgId}:${sheetName}`];
  await renderTable(sheetName);
}
window.reloadTable = reloadTable;

// ---- export to Excel -------------------------------------------------
function exportSheet(sheetName) {
  const data = State.cache[`${State.currentOrgId}:${sheetName}`];
  if (!data) { notify('אין נתונים לייצא', 'warn'); return; }
  const fs = _filterState[sheetName] || {};
  const rows = applyFilters(data.rows || [], fs);
  const headers = (data.headers || []).filter(h => h);
  const aoa = [headers].concat(rows.map(r => headers.map(h => r[h] !== undefined ? r[h] : '')));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = headers.map(() => ({wch: 16}));
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const org = currentOrg();
  const ts = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
  XLSX.writeFile(wb, `${org.name}_${sheetName}_${ts}.xlsx`);
  notify(`יוצא ${rows.length} שורות`, 'success');
}
window.exportSheet = exportSheet;

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
      <h5 class="modal-title">${isNew ? '➕ שורה חדשה' : '✏️ עריכת שורה'} <span class="text-muted small">${isNew?'':'#'+escHtml(rowObj['מספר סידורי']||rowObj._row)}</span></h5>
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
      <button class="btn btn-primary" id="saveBtn" ${locked && !isAdmin ? 'disabled' : ''}><i class="bi bi-check2"></i> שמור</button>
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
      btn.disabled = false; btn.innerHTML = '<i class="bi bi-check2"></i> שמור';
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
  if (r.ok) { notify('עודכן ל: '+status,'success'); reloadTable(sheetName); renderDashboard(); }
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
