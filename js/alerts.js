// ניהול מוסדות — smart alerts on dashboard

async function loadDashboardAlerts() {
  const org = currentOrg();
  if (!org) return;
  const container = document.getElementById('dashboard-alerts');
  if (!container) return;
  container.innerHTML = '';
  // Pull all 3 tabs to analyze
  const alerts = [];
  for (const tab of ['פעילות','ספקים','בעלות']) {
    const cacheKey = `${org.id}:${tab}`;
    if (!State.cache[cacheKey]) {
      const r = await api('getSheet', [State.user.username, org.id, tab]);
      if (r.ok) State.cache[cacheKey] = r.data;
    }
    const data = State.cache[cacheKey];
    if (!data || !data.rows) continue;

    // 1. Missing invoices for high-amount items
    const noInvoiceHigh = data.rows.filter(r => Number(r['סכום']) > 500 && !r['קישור חשבונית']);
    if (noInvoiceHigh.length) {
      alerts.push({
        level: 'warn', tab,
        icon: 'receipt',
        text: `<b>${noInvoiceHigh.length}</b> שורות מעל ₪500 ב<b>${tab}</b> ללא חשבונית`,
        action: () => {
          _filterState[tab] = {sumMin: '500', q: ''};
          goto(tab);
          setTimeout(() => notify('מציג שורות מעל ₪500. בדוק אילו ללא חשבונית.', 'warn'), 600);
        }
      });
    }
    // 2. Old "ממתין לאישור" rows
    const weekAgo = Date.now() - 7*24*3600*1000;
    const oldPending = data.rows.filter(r => {
      if (String(r['סטטוס']||'').trim() !== 'ממתין לאישור') return false;
      const d = r['נוצר בתאריך'] || r['תאריך חשבון'];
      if (!d) return true;
      const t = new Date(d).getTime();
      return !isNaN(t) && t < weekAgo;
    });
    if (oldPending.length) {
      alerts.push({
        level: 'warn', tab,
        icon: 'hourglass-bottom',
        text: `<b>${oldPending.length}</b> שורות ב<b>${tab}</b> ממתינות לאישור יותר משבוע`,
        action: () => { _filterState[tab] = {status: 'ממתין לאישור'}; goto(tab); }
      });
    }
    // 3. Approved but no receipt
    const approvedNoReceipt = data.rows.filter(r => {
      const s = String(r['סטטוס']||'').trim();
      return (s === 'מאושר' || s === 'שולם') && !r['קישור קבלה'];
    });
    if (approvedNoReceipt.length) {
      alerts.push({
        level: 'info', tab,
        icon: 'envelope-exclamation',
        text: `<b>${approvedNoReceipt.length}</b> שורות מאושרות/משולמות ב<b>${tab}</b> ללא קבלה`,
        action: () => { _filterState[tab] = {status: 'מאושר'}; goto(tab); }
      });
    }
  }

  // 4. Budget overflow per tab
  const sumR = await api('summary', [State.user.username, org.id]);
  if (sumR.ok && sumR.data) {
    sumR.data.tabs.forEach(t => {
      if (t.budget > 0 && t.sum > t.budget) {
        alerts.push({
          level: 'danger', tab: t.name,
          icon: 'exclamation-triangle-fill',
          text: `<b>חריגת תקציב ב${t.name}:</b> נוצל ${fmtMoney(t.sum)} מתוך ${fmtMoney(t.budget)} (חריגה ${fmtMoney(t.sum-t.budget)})`,
          action: () => goto(t.name)
        });
      }
    });
    if (sumR.data.budget_total > 0 && sumR.data.used > sumR.data.budget_total) {
      alerts.push({
        level: 'danger',
        icon: 'exclamation-octagon-fill',
        text: `<b>חריגת תקציב כללי!</b> נוצל ${fmtMoney(sumR.data.used)} מתוך ${fmtMoney(sumR.data.budget_total)}`,
      });
    }
  }

  if (!alerts.length) {
    container.innerHTML = '<div class="alert alert-success py-2 mb-0"><i class="bi bi-check2-circle"></i> אין התראות פעילות. הכל מסודר ✓</div>';
    return;
  }
  container.innerHTML = alerts.map((a, i) => `
    <div class="alert alert-${a.level === 'danger' ? 'danger' : a.level === 'warn' ? 'warning' : 'info'} py-2 mb-2 d-flex justify-content-between align-items-center" role="alert">
      <div><i class="bi bi-${a.icon} me-2"></i>${a.text}</div>
      ${a.action ? `<button class="btn btn-sm btn-outline-dark" onclick="window._alertActions[${i}]()"><i class="bi bi-arrow-left"></i> פתח</button>` : ''}
    </div>`).join('');
  window._alertActions = alerts.map(a => a.action || (() => {}));
}
window.loadDashboardAlerts = loadDashboardAlerts;
