// ניהול מוסדות — reports page (monthly / category / supplier)

async function renderReports() {
  const root = document.getElementById('page-reports');
  const org = currentOrg();
  if (!org) { root.innerHTML = '<div class="empty-state">אין מוסד</div>'; return; }

  root.innerHTML = `
    <div class="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
      <div>
        <h3 class="mb-0">📊 דוחות</h3>
        <div class="text-muted small">${escHtml(org.name)}</div>
      </div>
      <div class="d-flex gap-2 flex-wrap">
        <select class="form-select form-select-sm" id="reportTab" style="width:160px">
          <option value="all">כל הגליונות</option>
          <option value="פעילות">פעילות בלבד</option>
          <option value="ספקים">ספקים בלבד</option>
          <option value="בעלות">בעלות בלבד</option>
        </select>
        <button class="btn btn-sm btn-outline-danger" onclick="printReport()"><i class="bi bi-printer"></i> הדפס</button>
        <button class="btn btn-sm btn-outline-secondary" onclick="goto('home')"><i class="bi bi-house"></i></button>
      </div>
    </div>
    <div id="reportContent">טוען…</div>
  `;
  document.getElementById('reportTab').onchange = () => paintReports();
  await paintReports();
}
window.renderReports = renderReports;

async function paintReports() {
  const org = currentOrg();
  const sel = document.getElementById('reportTab').value;
  const tabs = sel === 'all' ? ['פעילות','ספקים','בעלות'] : [sel];
  // Ensure all data cached
  for (const tab of tabs) {
    const k = `${org.id}:${tab}`;
    if (!State.cache[k]) {
      const r = await api('getSheet', [State.user.username, org.id, tab]);
      if (r.ok) State.cache[k] = r.data;
    }
  }
  const allRows = [];
  tabs.forEach(tab => {
    const data = State.cache[`${org.id}:${tab}`];
    if (data && data.rows) data.rows.forEach(r => allRows.push({...r, _tab: tab}));
  });
  // Aggregations
  const byMonth = {};
  const byCategory = {};
  const bySupplier = {};
  const byStatus = {};
  let totalSum = 0;
  allRows.forEach(r => {
    const s = Number(r['סכום']) || 0;
    totalSum += s;
    // Month
    const d = r['תאריך חשבון'] ? new Date(r['תאריך חשבון']) : null;
    if (d && !isNaN(d.getTime())) {
      const m = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
      byMonth[m] = (byMonth[m] || 0) + s;
    }
    const cat = (r['קטגורית מטרה']||'').trim() || '(לא מוגדר)';
    byCategory[cat] = (byCategory[cat] || 0) + s;
    const sup = (r['שם הספק']||'').trim() || '(לא ידוע)';
    bySupplier[sup] = (bySupplier[sup] || 0) + s;
    const st = (r['סטטוס']||'').trim() || 'טיוטה';
    byStatus[st] = (byStatus[st] || 0) + s;
  });
  const months = Object.keys(byMonth).sort();
  const topCats = Object.entries(byCategory).sort((a,b) => b[1]-a[1]);
  const topSups = Object.entries(bySupplier).sort((a,b) => b[1]-a[1]).slice(0, 20);

  document.getElementById('reportContent').innerHTML = `
    <div class="row g-3 mb-3">
      <div class="col-md-3"><div class="card p-3 text-center"><div class="display-6 text-primary">${fmtMoney(totalSum)}</div><div class="text-muted small">סה"כ בדוח</div></div></div>
      <div class="col-md-3"><div class="card p-3 text-center"><div class="display-6 text-info">${allRows.length}</div><div class="text-muted small">שורות</div></div></div>
      <div class="col-md-3"><div class="card p-3 text-center"><div class="display-6 text-success">${months.length}</div><div class="text-muted small">חודשים</div></div></div>
      <div class="col-md-3"><div class="card p-3 text-center"><div class="display-6 text-warning">${topCats.length}</div><div class="text-muted small">קטגוריות</div></div></div>
    </div>

    <div class="row g-3">
      <div class="col-lg-7">
        <div class="card p-3 shadow-sm">
          <h6 class="mb-3"><i class="bi bi-bar-chart"></i> הוצאות לפי חודש</h6>
          <canvas id="monthlyChart" style="max-height:260px"></canvas>
        </div>
      </div>
      <div class="col-lg-5">
        <div class="card p-3 shadow-sm">
          <h6 class="mb-3"><i class="bi bi-pie-chart"></i> פילוח קטגוריות</h6>
          <canvas id="categoryChart" style="max-height:260px"></canvas>
        </div>
      </div>
    </div>

    <div class="row g-3 mt-1">
      <div class="col-lg-6">
        <div class="card p-3 shadow-sm">
          <h6><i class="bi bi-trophy"></i> Top 10 קטגוריות</h6>
          <table class="table table-sm mb-0">
            <thead><tr><th>#</th><th>קטגוריה</th><th class="text-end">סכום</th><th class="text-end">%</th></tr></thead>
            <tbody>${topCats.slice(0,10).map((row,i) => `
              <tr>
                <td>${i+1}</td>
                <td>${escHtml(row[0])}</td>
                <td class="num">${fmtMoney(row[1])}</td>
                <td class="num">${totalSum?((row[1]/totalSum)*100).toFixed(1):0}%</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
      <div class="col-lg-6">
        <div class="card p-3 shadow-sm">
          <h6><i class="bi bi-shop"></i> Top ספקים</h6>
          <table class="table table-sm mb-0">
            <thead><tr><th>#</th><th>ספק</th><th class="text-end">סכום</th></tr></thead>
            <tbody>${topSups.map((row,i) => `
              <tr>
                <td>${i+1}</td>
                <td>${escHtml(row[0])}</td>
                <td class="num">${fmtMoney(row[1])}</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card p-3 mt-3 shadow-sm">
      <h6><i class="bi bi-list-check"></i> פילוח לפי סטטוס</h6>
      <div class="row g-2">
        ${Object.entries(byStatus).map(([s,v]) => `
          <div class="col-md-2"><div class="card p-2 text-center">
            <span class="status-pill ${statusClass(s)} mb-1">${escHtml(s)}</span>
            <div class="fw-bold">${fmtMoney(v)}</div>
          </div></div>`).join('')}
      </div>
    </div>
  `;

  drawMonthlyChart(months, byMonth);
  drawCategoryChart(topCats.slice(0, 8));
}

let _monthlyChart = null;
let _categoryChart = null;

function drawMonthlyChart(months, byMonth) {
  if (_monthlyChart) _monthlyChart.destroy();
  _monthlyChart = new Chart(document.getElementById('monthlyChart'), {
    type: 'bar',
    data: {
      labels: months,
      datasets: [{label: 'הוצאות', data: months.map(m => byMonth[m]), backgroundColor: '#0969da'}]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: {display:false}, tooltip:{callbacks:{label: c => fmtMoney(c.raw)}} },
      scales: { y: { ticks: { callback: v => fmtMoney(v) } } }
    }
  });
}

function drawCategoryChart(topCats) {
  if (_categoryChart) _categoryChart.destroy();
  _categoryChart = new Chart(document.getElementById('categoryChart'), {
    type: 'doughnut',
    data: {
      labels: topCats.map(c => c[0]),
      datasets: [{data: topCats.map(c => c[1]), backgroundColor: ['#0969da','#1a7f37','#bf8700','#cf222e','#8250df','#6e7681','#1f6feb','#3fb950'], borderColor:'transparent'}]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend:{position:'bottom'}, tooltip:{callbacks:{label: c => `${c.label}: ${fmtMoney(c.raw)}`}} }
    }
  });
}

function printReport() {
  window.print();
}
window.printReport = printReport;
