// ניהול מוסדות — file upload dialog (drag & drop)

function openUploadDialog(sheetName, rowObj, kind) {
  const isAdmin = State.user.role === 'admin';
  const locked = isRowLocked(rowObj);
  const colName = kind === 'receipt' ? 'קישור קבלה' : 'קישור חשבונית';
  const existing = rowObj[colName];
  const title = kind === 'receipt' ? 'העלאת קבלה' : 'העלאת חשבונית';

  const html = `
    <div class="modal-header">
      <h5 class="modal-title">${title}</h5>
      <button class="btn-close" data-bs-dismiss="modal"></button>
    </div>
    <div class="modal-body">
      <p class="text-muted small mb-3">
        שורה #${escHtml(rowObj['מספר סידורי']||rowObj._row)} ·
        ${escHtml(rowObj['פירוט המטרה']||'')}<br>
        סכום: ${fmtMoney(rowObj['סכום'])} · ספק: ${escHtml(rowObj['שם הספק']||'—')}
      </p>
      ${existing ? `<div class="alert alert-info"><strong>קיים קובץ:</strong> <a class="file-link" target="_blank" href="${escAttr(existing)}">פתח קיים</a> · העלאה תחליף אותו.</div>` : ''}
      ${locked && !isAdmin ? `<div class="alert alert-warning">🔒 השורה נעולה — לא ניתן להעלות קובץ.</div>` : `
        <div class="dropzone" id="dropzone">
          <i class="bi bi-cloud-upload icon"></i>
          <div>גרור קובץ לכאן או <b>לחץ לבחירה</b></div>
          <div class="small text-muted mt-1">PDF, JPG, PNG · עד 10MB</div>
          <input type="file" accept=".pdf,image/*">
        </div>
        <div id="filePreview" class="mt-3"></div>
      `}
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" data-bs-dismiss="modal">ביטול</button>
      ${locked && !isAdmin ? '' : '<button class="btn btn-primary" id="uploadBtn" disabled>העלה</button>'}
    </div>`;
  openModal(html);

  if (locked && !isAdmin) return;
  const dz = document.getElementById('dropzone');
  const inp = dz.querySelector('input[type=file]');
  const prev = document.getElementById('filePreview');
  const btn = document.getElementById('uploadBtn');
  let chosen = null;

  function pickFile(f) {
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { notify('הקובץ גדול מ-10MB', 'error'); return; }
    chosen = f;
    prev.innerHTML = `<div class="card p-3 d-flex flex-row justify-content-between align-items-center">
      <div><i class="bi bi-file-earmark-pdf text-danger"></i> <strong>${escHtml(f.name)}</strong>
      <div class="text-muted small">${(f.size/1024).toFixed(0)} KB · ${escHtml(f.type||'unknown')}</div></div>
      <button class="btn btn-sm btn-outline-danger" id="clearFile"><i class="bi bi-x"></i></button>
    </div>`;
    document.getElementById('clearFile').onclick = () => { chosen = null; prev.innerHTML = ''; btn.disabled = true; };
    btn.disabled = false;
  }

  dz.onclick = () => inp.click();
  inp.onchange = () => pickFile(inp.files[0]);
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); pickFile(e.dataTransfer.files[0]); };

  btn.onclick = async () => {
    if (!chosen) return;
    btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> מעלה…';
    try {
      const b64 = await fileToBase64(chosen);
      const r = await api('uploadFile', [
        State.user.username, State.currentOrgId, sheetName, rowObj._row, kind,
        chosen.name, chosen.type || 'application/pdf', b64
      ]);
      if (!r.ok) throw new Error(r.error || 'upload failed');
      notify(r.data.replaced ? 'הוחלף' : 'הועלה', 'success');
      closeModal();
      reloadTable(sheetName);
    } catch (e) {
      notify('שגיאה: ' + e.message, 'error');
      btn.disabled = false; btn.innerHTML = 'העלה';
    }
  };
}
window.openUploadDialog = openUploadDialog;

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
