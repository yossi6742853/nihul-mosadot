// ניהול מוסדות — global search (Ctrl+K)

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    if (State.user) openGlobalSearch();
  }
  if (e.key === 'Escape') {
    const overlay = document.getElementById('global-search-overlay');
    if (overlay) overlay.remove();
  }
});

function openGlobalSearch() {
  if (document.getElementById('global-search-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'global-search-overlay';
  overlay.innerHTML = `
    <div class="gs-bg"></div>
    <div class="gs-modal">
      <div class="gs-input-wrap">
        <i class="bi bi-search"></i>
        <input id="gsInput" placeholder="חיפוש בכל הגליונות... (Esc ליציאה)" autocomplete="off">
        <kbd class="gs-kbd">Ctrl+K</kbd>
      </div>
      <div id="gsResults" class="gs-results"></div>
      <div class="gs-footer text-muted small">
        <kbd>↑↓</kbd> ניווט · <kbd>Enter</kbd> פתיחה · <kbd>Esc</kbd> סגירה
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.gs-bg').onclick = () => overlay.remove();
  const inp = document.getElementById('gsInput');
  inp.focus();
  let timer;
  inp.oninput = () => { clearTimeout(timer); timer = setTimeout(() => doSearch(inp.value), 300); };
  // Initial: show shortcuts to pages
  document.getElementById('gsResults').innerHTML = `
    <div class="gs-section-title">קיצורי דרך</div>
    <div class="gs-item" onclick="gsGoto('home')"><i class="bi bi-house"></i> דשבורד</div>
    <div class="gs-item" onclick="gsGoto('פעילות')"><i class="bi bi-clipboard-data"></i> פעילות</div>
    <div class="gs-item" onclick="gsGoto('ספקים')"><i class="bi bi-shop"></i> ספקים</div>
    <div class="gs-item" onclick="gsGoto('בעלות')"><i class="bi bi-building"></i> בעלות</div>
    <div class="gs-item" onclick="gsGoto('audit')"><i class="bi bi-clock-history"></i> היסטוריה</div>
    ${State.user.role==='admin'?`
      <div class="gs-item" onclick="gsGoto('orgs')"><i class="bi bi-diagram-3"></i> ניהול מוסדות</div>
      <div class="gs-item" onclick="gsGoto('users')"><i class="bi bi-people-fill"></i> ניהול משתמשים</div>` : ''}
  `;
}
window.openGlobalSearch = openGlobalSearch;

async function doSearch(q) {
  const res = document.getElementById('gsResults');
  if (!q || q.length < 2) { return; }
  res.innerHTML = '<div class="text-muted p-3"><span class="spinner-border spinner-border-sm me-1"></span> מחפש…</div>';
  if (!State.currentOrgId) { res.innerHTML = '<div class="p-3 text-muted">אין מוסד פעיל</div>'; return; }
  const r = await api('search', [State.user.username, State.currentOrgId, q]);
  if (!r.ok) { res.innerHTML = `<div class="p-3 text-danger">${escHtml(r.error)}</div>`; return; }
  const items = r.data || [];
  if (!items.length) { res.innerHTML = `<div class="p-3 text-muted">לא נמצאו תוצאות עבור "${escHtml(q)}"</div>`; return; }
  // Group by sheet
  const grouped = {};
  items.forEach(x => { (grouped[x._sheet] = grouped[x._sheet] || []).push(x); });
  let html = '';
  Object.keys(grouped).forEach(sheet => {
    html += `<div class="gs-section-title">${escHtml(sheet)} (${grouped[sheet].length})</div>`;
    grouped[sheet].slice(0, 10).forEach(item => {
      html += `<div class="gs-item" onclick="gsJump('${escAttr(sheet)}',${item._row})">
        <div>
          <div><b>#${escHtml(item['מספר סידורי']||item._row)}</b> · ${escHtml(item['פירוט המטרה']||'')}</div>
          <div class="text-muted small">${escHtml(item['שם הספק']||'')} · ${fmtMoney(item['סכום'])} · <span class="status-pill ${statusClass(item['סטטוס'])}">${escHtml(item['סטטוס']||'טיוטה')}</span></div>
        </div>
      </div>`;
    });
    if (grouped[sheet].length > 10) html += `<div class="text-muted small p-2">+${grouped[sheet].length-10} נוספות...</div>`;
  });
  res.innerHTML = html;
}

function gsGoto(view) {
  document.getElementById('global-search-overlay').remove();
  goto(view);
}
window.gsGoto = gsGoto;

function gsJump(sheet, row) {
  document.getElementById('global-search-overlay').remove();
  goto(sheet);
  // Highlight the row after render (delay)
  setTimeout(() => {
    const tr = document.querySelector(`tr[data-row="${row}"]`);
    if (tr) {
      tr.scrollIntoView({behavior:'smooth', block:'center'});
      tr.style.background = '#fff3cd';
      setTimeout(() => tr.style.background = '', 2000);
    }
  }, 800);
}
window.gsJump = gsJump;
