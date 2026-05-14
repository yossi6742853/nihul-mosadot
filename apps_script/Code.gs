/**
 * ניהול מוסדות — Apps Script Backend
 * Web App multi-tenant לניהול תקציב עמותות.
 *
 * Master Hub: מאחסן רשימת מוסדות, משתמשים, audit כללי.
 * לכל מוסד — ספרדשיט נפרד עם 7 גליונות (פעילות / ספקים / בעלות / חשבוניות / קבלות / config / audit).
 *
 * אימות: Session.getActiveUser().getEmail() (Web App רץ כ-User Accessing).
 * הרשאות: admin רואה הכל; manager רק את ה-orgs שמשויכים לאימייל שלו.
 */

const MASTER_SHEET_ID = '1AhlGUV9qbCMVKP5_LH-fKJj3-ijD8CrefBlh1Fdq9DY';
const APP_VERSION = 'v0.1.0';

// Bootstrap admins — used until users tab is populated, and as a permanent fallback
// so that the master sheet's owner is never locked out.
const FALLBACK_ADMIN_EMAILS = ['6742853@gmail.com'];

// =====================================================================
// HTTP entry points
// =====================================================================

function doGet(e) {
  // API mode: ?api=1 returns JSON (whoami).
  if (e && e.parameter && e.parameter.api) {
    return jsonOut({ok: true, app: 'nihul-mosadot', version: APP_VERSION, user: getUser_()});
  }
  // Otherwise: serve the SPA.
  const tmpl = HtmlService.createTemplateFromFile('index');
  tmpl.app_version = APP_VERSION;
  return tmpl.evaluate()
    .setTitle('ניהול מוסדות')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include_(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

// Server-side endpoints invoked from the SPA via google.script.run.
function api(req) {
  try {
    return dispatch_(req && req.action || '', req || {});
  } catch (err) {
    return {ok: false, error: String(err && err.message || err)};
  }
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch(_) {}
  const action = body.action || '';
  try {
    return jsonOut(dispatch_(action, body));
  } catch (err) {
    return jsonOut({ok: false, error: String(err && err.message || err), action});
  }
}

function dispatch_(action, body) {
  const user = getUser_();
  if (!user.email && action !== 'ping') {
    return {ok: false, error: 'NOT_LOGGED_IN'};
  }
  switch (action) {
    case 'ping':         return {ok: true, version: APP_VERSION};
    case 'whoami':       return whoami_(user);
    case 'list_orgs':    return {ok: true, orgs: visibleOrgs_(user)};
    case 'create_org':   return requireAdmin_(user, () => createOrg_(user, body));
    case 'update_org':   return requireAdmin_(user, () => updateOrg_(body));
    case 'delete_org':   return requireAdmin_(user, () => deleteOrg_(body));
    case 'list_users':   return requireAdmin_(user, () => ({ok: true, users: listUsers_()}));
    case 'add_user':     return requireAdmin_(user, () => addUser_(user, body));
    case 'remove_user':  return requireAdmin_(user, () => removeUser_(user, body));
    case 'get_sheet':    return getSheet_(user, body);
    case 'add_row':      return addRow_(user, body);
    case 'update_row':   return updateRow_(user, body);
    case 'delete_row':   return deleteRow_(user, body);
    case 'summary':      return summary_(user, body);
    case 'global_summary': return requireAdmin_(user, () => globalSummary_());
    case 'audit':        return getAudit_(user, body);
    case 'search':       return searchOrg_(user, body);
    case 'init_master':  return requireAdmin_(user, () => initMaster_());
    case 'bulk_import':  return requireAdmin_(user, () => bulkImport_(body));
    case 'upload_file':  return uploadFile_(user, body);
    case 'replace_file': return uploadFile_(user, body);  // same logic, audited as replace
    case 'lock_row':     return setLock_(user, body, true);
    case 'unlock_row':   return setLock_(user, body, false);
    case 'set_status':   return setStatus_(user, body);
    default:
      return {ok: false, error: 'UNKNOWN_ACTION', action};
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// =====================================================================
// Auth & user resolution
// =====================================================================

function getUser_() {
  const email = (Session.getActiveUser().getEmail() || '').toLowerCase().trim();
  const u = {email: email, role: 'guest', name: ''};
  if (!email) return u;
  // Fallback admin (hardcoded) so that the master-owner is always recognized,
  // even before the users tab exists.
  if (FALLBACK_ADMIN_EMAILS.indexOf(email) >= 0) u.role = 'admin';
  // Lazy bootstrap: when an admin connects, ensure master is initialized.
  if (u.role === 'admin') ensureMasterReady_();
  const row = lookupUser_(email);
  if (row) { u.role = row.role; u.name = row.name || ''; u.org_id = row.org_id || ''; }
  return u;
}

function ensureMasterReady_() {
  try {
    const ss = master_();
    if (!ss.getSheetByName('orgs')) initMaster_();
  } catch (e) {}
}

function whoami_(user) {
  return {ok: true, ...user, orgs: visibleOrgs_(user)};
}

function requireAdmin_(user, fn) {
  if (user.role !== 'admin') return {ok: false, error: 'FORBIDDEN_ADMIN_ONLY'};
  return fn();
}

function lookupUser_(email) {
  const sh = master_().getSheetByName('users');
  if (!sh) return null;
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return null;
  const head = data[0].map(h => String(h).trim());
  const idx = (k) => head.indexOf(k);
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[idx('email')]).toLowerCase().trim() === email) {
      return {
        email: email,
        role: String(row[idx('role')] || 'manager').toLowerCase(),
        name: row[idx('name')] || '',
        org_id: row[idx('org_id')] || '',
      };
    }
  }
  return null;
}

function visibleOrgs_(user) {
  const all = listOrgs_();
  if (user.role === 'admin') return all;
  // For managers: orgs where they appear as manager in users sheet
  const myOrgIds = new Set();
  const sh = master_().getSheetByName('users');
  if (sh) {
    const d = sh.getDataRange().getValues();
    const head = d[0].map(String);
    const eIdx = head.indexOf('email');
    const oIdx = head.indexOf('org_id');
    for (let i = 1; i < d.length; i++) {
      if (String(d[i][eIdx]).toLowerCase().trim() === user.email && d[i][oIdx]) {
        myOrgIds.add(String(d[i][oIdx]));
      }
    }
  }
  return all.filter(o => myOrgIds.has(o.id));
}

function userCanAccessOrg_(user, org_id) {
  if (user.role === 'admin') return true;
  return visibleOrgs_(user).some(o => o.id === String(org_id));
}

// =====================================================================
// Master sheet helpers
// =====================================================================

function master_() { return SpreadsheetApp.openById(MASTER_SHEET_ID); }

function listOrgs_() {
  const sh = master_().getSheetByName('orgs');
  if (!sh) return [];
  const d = sh.getDataRange().getValues();
  if (d.length < 2) return [];
  const head = d[0].map(String);
  const out = [];
  for (let i = 1; i < d.length; i++) {
    const r = d[i];
    if (!r[0]) continue;
    const obj = {};
    head.forEach((k, j) => obj[k] = r[j]);
    if (String(obj.active).toLowerCase() === 'false') continue;
    out.push(obj);
  }
  return out;
}

function getOrgById_(org_id) {
  return listOrgs_().find(o => String(o.id) === String(org_id));
}

function listUsers_() {
  const sh = master_().getSheetByName('users');
  if (!sh) return [];
  const d = sh.getDataRange().getValues();
  if (d.length < 2) return [];
  const head = d[0].map(String);
  return d.slice(1).filter(r => r[0]).map(r => {
    const o = {};
    head.forEach((k, j) => o[k] = r[j]);
    return o;
  });
}

// =====================================================================
// Org CRUD
// =====================================================================

function createOrg_(user, body) {
  const name = (body.name || '').trim();
  const manager_email = (body.manager_email || '').toLowerCase().trim();
  const budget_total = Number(body.budget_total || 0);
  if (!name) return {ok: false, error: 'NAME_REQUIRED'};
  const id = 'org_' + Utilities.formatDate(new Date(), 'GMT', 'yyyyMMddHHmmss');
  const newSs = SpreadsheetApp.create('ניהול מוסדות — ' + name);
  const newId = newSs.getId();
  bootstrapOrgSheet_(newSs, name, budget_total);
  // Share with manager (if provided)
  if (manager_email) {
    try { DriveApp.getFileById(newId).addEditor(manager_email); } catch(e) {}
  }
  // Add row to master.orgs
  const orgsSh = master_().getSheetByName('orgs');
  orgsSh.appendRow([id, name, newId, manager_email, new Date(), 'TRUE', budget_total, '']);
  // Add manager to users
  if (manager_email) addUser_(user, {email: manager_email, role: 'manager', org_id: id, name: ''});
  audit_(user, 'create_org', id, {name, manager_email, sheet_id: newId});
  return {ok: true, org: {id, name, sheet_id: newId, manager_email, budget_total}};
}

function updateOrg_(body) {
  const sh = master_().getSheetByName('orgs');
  const d = sh.getDataRange().getValues();
  const head = d[0].map(String);
  const idIdx = head.indexOf('id');
  for (let i = 1; i < d.length; i++) {
    if (String(d[i][idIdx]) === String(body.org_id)) {
      ['name', 'manager_email', 'budget_total', 'notes', 'active'].forEach(k => {
        if (body[k] !== undefined) {
          const ci = head.indexOf(k);
          if (ci >= 0) sh.getRange(i + 1, ci + 1).setValue(body[k]);
        }
      });
      audit_(getUser_(), 'update_org', body.org_id, body);
      return {ok: true};
    }
  }
  return {ok: false, error: 'ORG_NOT_FOUND'};
}

function deleteOrg_(body) {
  const sh = master_().getSheetByName('orgs');
  const d = sh.getDataRange().getValues();
  const head = d[0].map(String);
  const idIdx = head.indexOf('id');
  const actIdx = head.indexOf('active');
  for (let i = 1; i < d.length; i++) {
    if (String(d[i][idIdx]) === String(body.org_id)) {
      sh.getRange(i + 1, actIdx + 1).setValue('FALSE');
      audit_(getUser_(), 'delete_org', body.org_id, {});
      return {ok: true};
    }
  }
  return {ok: false, error: 'ORG_NOT_FOUND'};
}

// =====================================================================
// Users CRUD
// =====================================================================

function addUser_(actor, body) {
  const sh = master_().getSheetByName('users');
  const email = (body.email || '').toLowerCase().trim();
  if (!email) return {ok: false, error: 'EMAIL_REQUIRED'};
  // If exists for same org_id — update role/name; otherwise append.
  const d = sh.getDataRange().getValues();
  const head = d[0].map(String);
  const eIdx = head.indexOf('email');
  const oIdx = head.indexOf('org_id');
  const rIdx = head.indexOf('role');
  const nIdx = head.indexOf('name');
  for (let i = 1; i < d.length; i++) {
    if (String(d[i][eIdx]).toLowerCase().trim() === email &&
        String(d[i][oIdx]) === String(body.org_id || '')) {
      if (body.role) sh.getRange(i + 1, rIdx + 1).setValue(body.role);
      if (body.name) sh.getRange(i + 1, nIdx + 1).setValue(body.name);
      audit_(actor, 'update_user', body.org_id || '', {email, role: body.role});
      return {ok: true, updated: true};
    }
  }
  sh.appendRow([email, body.role || 'manager', body.org_id || '', body.name || '', new Date()]);
  // If org provided — share its sheet with this user
  if (body.org_id) {
    const org = getOrgById_(body.org_id);
    if (org && org.sheet_id) {
      try { DriveApp.getFileById(org.sheet_id).addEditor(email); } catch(e) {}
    }
  }
  audit_(actor, 'add_user', body.org_id || '', {email, role: body.role});
  return {ok: true};
}

function removeUser_(actor, body) {
  const sh = master_().getSheetByName('users');
  const email = (body.email || '').toLowerCase().trim();
  const d = sh.getDataRange().getValues();
  const head = d[0].map(String);
  const eIdx = head.indexOf('email');
  const oIdx = head.indexOf('org_id');
  for (let i = d.length - 1; i >= 1; i--) {
    if (String(d[i][eIdx]).toLowerCase().trim() === email &&
        (!body.org_id || String(d[i][oIdx]) === String(body.org_id))) {
      sh.deleteRow(i + 1);
    }
  }
  audit_(actor, 'remove_user', body.org_id || '', {email});
  return {ok: true};
}

// =====================================================================
// Sheet operations on org spreadsheets
// =====================================================================

const ORG_TABS = ['פעילות', 'ספקים', 'בעלות'];
const ORG_HEADERS = [
  'מספר סידורי', 'קטגורית מטרה', 'פירוט המטרה',
  'שם הספק', 'טלפון ספק', 'תאריך חשבון',
  'בנק', 'סניף', 'חשבון', 'שם המוטב',
  'סכום',
  'קישור חשבונית', 'קישור קבלה',
  'סטטוס', 'מאשר', 'נעול', 'נוצר ע"י', 'נוצר בתאריך'
];

// Statuses that imply the row is locked (only admin can edit/delete).
const LOCKED_STATUSES = ['מאושר', 'שולם'];

function bootstrapOrgSheet_(ss, orgName, budgetTotal) {
  // Remove the default Sheet1
  const def = ss.getSheets()[0];
  // Build budget tabs
  ORG_TABS.forEach((tab, idx) => {
    const sh = (idx === 0) ? def : ss.insertSheet(tab);
    if (idx === 0) sh.setName(tab);
    sh.appendRow(ORG_HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, ORG_HEADERS.length).setFontWeight('bold').setBackground('#fff2cc');
  });
  // Auxiliary tabs
  const inv = ss.insertSheet('חשבוניות');
  inv.appendRow(['חותמת זמן', 'אימייל', 'מספר סידורי', 'גליון', 'קישור']);
  inv.setFrozenRows(1);
  const rec = ss.insertSheet('קבלות');
  rec.appendRow(['חותמת זמן', 'אימייל', 'מספר סידורי', 'גליון', 'קישור']);
  rec.setFrozenRows(1);
  const cfg = ss.insertSheet('config');
  cfg.appendRow(['key', 'value']);
  cfg.appendRow(['org_name', orgName]);
  cfg.appendRow(['budget_total', budgetTotal]);
  cfg.appendRow(['categories', 'אחר;פעילות חודשית;פעילות פרטנית;אחזקה ותחזוקה;נקיון וציוד נקיון;קייטרינג;שכירות;אישורים;ציוד משרדי']);
  cfg.appendRow(['workflow_statuses', 'טיוטה;ממתין לאישור;מאושר;שולם;בוטל']);
  const aud = ss.insertSheet('audit');
  aud.appendRow(['ts', 'user_email', 'action', 'sheet', 'row_id', 'details']);
  aud.setFrozenRows(1);
}

function orgSpreadsheet_(user, org_id) {
  if (!userCanAccessOrg_(user, org_id)) throw new Error('FORBIDDEN');
  const org = getOrgById_(org_id);
  if (!org) throw new Error('ORG_NOT_FOUND');
  return {org, ss: SpreadsheetApp.openById(org.sheet_id)};
}

function getSheet_(user, body) {
  const {ss, org} = orgSpreadsheet_(user, body.org_id);
  const tab = body.sheet || 'פעילות';
  const sh = ss.getSheetByName(tab);
  if (!sh) return {ok: false, error: 'SHEET_NOT_FOUND', tab};
  const data = sh.getDataRange().getValues();
  if (!data.length) return {ok: true, headers: [], rows: []};
  const headers = data[0].map(String);
  const rows = data.slice(1).map((r, i) => {
    const o = {_row: i + 2};
    headers.forEach((h, j) => o[h] = r[j]);
    return o;
  });
  return {ok: true, headers, rows, org_name: org.name, sheet: tab};
}

function addRow_(user, body) {
  const {ss, org} = orgSpreadsheet_(user, body.org_id);
  const tab = body.sheet || 'פעילות';
  const sh = ss.getSheetByName(tab);
  if (!sh) return {ok: false, error: 'SHEET_NOT_FOUND'};
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const fields = body.fields || {};
  // Auto-fill metadata
  if (headers.indexOf('נוצר ע"י') >= 0 && !fields['נוצר ע"י']) fields['נוצר ע"י'] = user.email;
  if (headers.indexOf('נוצר בתאריך') >= 0 && !fields['נוצר בתאריך']) fields['נוצר בתאריך'] = new Date();
  if (headers.indexOf('סטטוס') >= 0 && !fields['סטטוס']) fields['סטטוס'] = 'טיוטה';
  // Auto-increment serial if missing
  if (headers.indexOf('מספר סידורי') >= 0 && !fields['מספר סידורי']) {
    fields['מספר סידורי'] = nextSerial_(sh);
  }
  const row = headers.map(h => fields[h] !== undefined ? fields[h] : '');
  sh.appendRow(row);
  const newRowIdx = sh.getLastRow();
  audit_(user, 'add_row', body.org_id, {sheet: tab, row: newRowIdx, fields: fields});
  auditOrg_(ss, user, 'add_row', tab, newRowIdx, fields);
  return {ok: true, _row: newRowIdx, serial: fields['מספר סידורי']};
}

function updateRow_(user, body) {
  const {ss} = orgSpreadsheet_(user, body.org_id);
  const tab = body.sheet || 'פעילות';
  const sh = ss.getSheetByName(tab);
  if (!sh) return {ok: false, error: 'SHEET_NOT_FOUND'};
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const rowNum = Number(body._row);
  if (!rowNum || rowNum < 2) return {ok: false, error: 'INVALID_ROW'};
  const fields = body.fields || {};
  const before = {};
  headers.forEach((h, i) => before[h] = sh.getRange(rowNum, i + 1).getValue());
  // Lock guard
  if (rowIsLocked_(headers, before) && user.role !== 'admin' && !body.force_admin) {
    return {ok: false, error: 'ROW_LOCKED', reason: 'נעול / סטטוס סופי — רק מנהל כללי יכול לערוך'};
  }
  Object.keys(fields).forEach(k => {
    const ci = headers.indexOf(k);
    if (ci >= 0) sh.getRange(rowNum, ci + 1).setValue(fields[k]);
  });
  audit_(user, 'update_row', body.org_id, {sheet: tab, row: rowNum, before, after: fields});
  auditOrg_(ss, user, 'update_row', tab, rowNum, {before, after: fields});
  return {ok: true};
}

function deleteRow_(user, body) {
  const {ss} = orgSpreadsheet_(user, body.org_id);
  const tab = body.sheet || 'פעילות';
  const sh = ss.getSheetByName(tab);
  if (!sh) return {ok: false, error: 'SHEET_NOT_FOUND'};
  const rowNum = Number(body._row);
  if (!rowNum || rowNum < 2) return {ok: false, error: 'INVALID_ROW'};
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const snapshot = {};
  headers.forEach((h, i) => snapshot[h] = sh.getRange(rowNum, i + 1).getValue());
  if (rowIsLocked_(headers, snapshot) && user.role !== 'admin') {
    return {ok: false, error: 'ROW_LOCKED', reason: 'נעול — לא ניתן למחוק'};
  }
  sh.deleteRow(rowNum);
  audit_(user, 'delete_row', body.org_id, {sheet: tab, row: rowNum, snapshot});
  auditOrg_(ss, user, 'delete_row', tab, rowNum, snapshot);
  return {ok: true};
}

function rowIsLocked_(headers, rowObj) {
  const lockIdx = headers.indexOf('נעול');
  const stIdx = headers.indexOf('סטטוס');
  if (lockIdx >= 0) {
    const v = rowObj['נעול'] || rowObj[headers[lockIdx]];
    if (String(v).toLowerCase() === 'true' || v === true) return true;
  }
  if (stIdx >= 0) {
    const s = String(rowObj['סטטוס'] || rowObj[headers[stIdx]] || '').trim();
    if (LOCKED_STATUSES.indexOf(s) >= 0) return true;
  }
  return false;
}

function setLock_(user, body, locked) {
  const {ss} = orgSpreadsheet_(user, body.org_id);
  const sh = ss.getSheetByName(body.sheet || 'פעילות');
  if (!sh) return {ok: false, error: 'SHEET_NOT_FOUND'};
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const ci = headers.indexOf('נעול');
  if (ci < 0) return {ok: false, error: 'NO_LOCK_COLUMN'};
  const rowNum = Number(body._row);
  if (!rowNum || rowNum < 2) return {ok: false, error: 'INVALID_ROW'};
  // managers can lock but only admin can unlock
  if (!locked && user.role !== 'admin') return {ok: false, error: 'FORBIDDEN_UNLOCK_ADMIN_ONLY'};
  sh.getRange(rowNum, ci + 1).setValue(locked ? 'TRUE' : 'FALSE');
  audit_(user, locked ? 'lock_row' : 'unlock_row', body.org_id, {sheet: body.sheet, row: rowNum});
  auditOrg_(ss, user, locked ? 'lock_row' : 'unlock_row', body.sheet, rowNum, {});
  return {ok: true};
}

function setStatus_(user, body) {
  const {ss} = orgSpreadsheet_(user, body.org_id);
  const sh = ss.getSheetByName(body.sheet || 'פעילות');
  if (!sh) return {ok: false, error: 'SHEET_NOT_FOUND'};
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const stIdx = headers.indexOf('סטטוס');
  const apIdx = headers.indexOf('מאשר');
  const rowNum = Number(body._row);
  if (stIdx < 0 || !rowNum) return {ok: false, error: 'INVALID'};
  const next = String(body.status || '').trim();
  // Only admin can move into a "locking" status (approve/pay), or out of it
  const willLock = LOCKED_STATUSES.indexOf(next) >= 0;
  const prev = String(sh.getRange(rowNum, stIdx + 1).getValue() || '').trim();
  const wasLocked = LOCKED_STATUSES.indexOf(prev) >= 0;
  if ((willLock || wasLocked) && user.role !== 'admin') {
    return {ok: false, error: 'FORBIDDEN_APPROVAL_ADMIN_ONLY'};
  }
  sh.getRange(rowNum, stIdx + 1).setValue(next);
  if (willLock && apIdx >= 0) sh.getRange(rowNum, apIdx + 1).setValue(user.email);
  audit_(user, 'set_status', body.org_id, {sheet: body.sheet, row: rowNum, prev, next});
  auditOrg_(ss, user, 'set_status', body.sheet, rowNum, {prev, next});
  return {ok: true};
}

// =====================================================================
// File uploads (חשבוניות / קבלות)
// =====================================================================

function uploadFile_(user, body) {
  // body: {org_id, sheet ('פעילות'|'ספקים'|'בעלות'), _row, kind ('invoice'|'receipt'),
  //        filename, mime, dataB64}
  const {ss, org} = orgSpreadsheet_(user, body.org_id);
  const sh = ss.getSheetByName(body.sheet);
  if (!sh) return {ok: false, error: 'SHEET_NOT_FOUND'};
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const rowNum = Number(body._row);
  if (!rowNum) return {ok: false, error: 'INVALID_ROW'};

  // Lock guard for replace
  const rowSnapshot = {};
  headers.forEach((h, i) => rowSnapshot[h] = sh.getRange(rowNum, i + 1).getValue());
  if (rowIsLocked_(headers, rowSnapshot) && user.role !== 'admin') {
    return {ok: false, error: 'ROW_LOCKED', reason: 'נעול — אין החלפת קובץ'};
  }

  // Resolve target column
  const colName = body.kind === 'receipt' ? 'קישור קבלה' : 'קישור חשבונית';
  const colIdx = headers.indexOf(colName);
  if (colIdx < 0) return {ok: false, error: 'NO_COLUMN', col: colName};

  // Prepare folder structure: <org folder>/<kind>/
  const folder = ensureOrgFolder_(org, body.kind === 'receipt' ? 'קבלות' : 'חשבוניות');

  // Decode upload
  const bytes = Utilities.base64Decode(body.dataB64 || '');
  const blob = Utilities.newBlob(bytes, body.mime || 'application/pdf', body.filename || 'file.pdf');
  const file = folder.createFile(blob);
  // Best-effort share with viewers in same domain (link sharing is on for the spreadsheet only)
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}

  const url = file.getUrl();
  const previousUrl = sh.getRange(rowNum, colIdx + 1).getValue();

  // Update sheet cell
  sh.getRange(rowNum, colIdx + 1).setValue(url);

  // Mirror to invoices/receipts log tab
  const logName = body.kind === 'receipt' ? 'קבלות' : 'חשבוניות';
  const logSh = ss.getSheetByName(logName);
  const serial = sh.getRange(rowNum, headers.indexOf('מספר סידורי') + 1).getValue();
  if (logSh) logSh.appendRow([new Date(), user.email, serial, body.sheet, url]);

  audit_(user, previousUrl ? 'replace_file' : 'upload_file', body.org_id,
         {sheet: body.sheet, row: rowNum, kind: body.kind, file: file.getId(), prev: previousUrl, next: url, name: body.filename});
  auditOrg_(ss, user, previousUrl ? 'replace_file' : 'upload_file', body.sheet, rowNum,
            {kind: body.kind, file: file.getId(), prev: previousUrl, next: url, name: body.filename});

  return {ok: true, url, file_id: file.getId(), name: body.filename, replaced: !!previousUrl};
}

function ensureOrgFolder_(org, sub) {
  // Folder lives next to the org spreadsheet, in a subfolder by year + sub
  const file = DriveApp.getFileById(org.sheet_id);
  const parents = file.getParents();
  const parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const orgFolderName = 'ניהול מוסדות — קבצים — ' + org.name;
  let orgFolder;
  const it = parent.getFoldersByName(orgFolderName);
  orgFolder = it.hasNext() ? it.next() : parent.createFolder(orgFolderName);
  if (!sub) return orgFolder;
  const it2 = orgFolder.getFoldersByName(sub);
  return it2.hasNext() ? it2.next() : orgFolder.createFolder(sub);
}

function nextSerial_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return 1;
  const col = sh.getRange(2, 1, last - 1, 1).getValues().map(r => Number(r[0]) || 0);
  return Math.max.apply(null, col.concat([0])) + 1;
}

// =====================================================================
// Summary & search
// =====================================================================

function summary_(user, body) {
  const {ss, org} = orgSpreadsheet_(user, body.org_id);
  const cfg = readConfig_(ss);
  const total = Number(cfg.budget_total || org.budget_total || 0);
  const tabs = ORG_TABS.filter(t => ss.getSheetByName(t));
  const out = {ok: true, org_name: org.name, budget_total: total, tabs: []};
  let usedAll = 0;
  tabs.forEach(t => {
    const sh = ss.getSheetByName(t);
    const data = sh.getDataRange().getValues();
    if (data.length < 2) { out.tabs.push({name: t, count: 0, sum: 0}); return; }
    const headers = data[0].map(String);
    const sumIdx = headers.indexOf('סכום');
    let sum = 0, count = 0;
    for (let i = 1; i < data.length; i++) {
      const v = Number(data[i][sumIdx]) || 0;
      if (data[i][0] !== '' && data[i][0] !== null) { sum += v; count++; }
    }
    out.tabs.push({name: t, count, sum});
    usedAll += sum;
  });
  out.used = usedAll;
  out.remaining = total - usedAll;
  return out;
}

function globalSummary_() {
  const orgs = listOrgs_();
  const out = orgs.map(o => {
    try {
      const ss = SpreadsheetApp.openById(o.sheet_id);
      const cfg = readConfig_(ss);
      const total = Number(cfg.budget_total || o.budget_total || 0);
      let used = 0, count = 0;
      ORG_TABS.forEach(t => {
        const sh = ss.getSheetByName(t);
        if (!sh) return;
        const d = sh.getDataRange().getValues();
        if (d.length < 2) return;
        const headers = d[0].map(String);
        const sumIdx = headers.indexOf('סכום');
        for (let i = 1; i < d.length; i++) {
          if (d[i][0] !== '' && d[i][0] !== null) {
            used += Number(d[i][sumIdx]) || 0;
            count++;
          }
        }
      });
      return {id: o.id, name: o.name, budget_total: total, used, remaining: total - used, count};
    } catch (e) {
      return {id: o.id, name: o.name, error: String(e.message || e)};
    }
  });
  return {ok: true, orgs: out};
}

function readConfig_(ss) {
  const sh = ss.getSheetByName('config');
  const out = {};
  if (!sh) return out;
  const d = sh.getDataRange().getValues();
  for (let i = 1; i < d.length; i++) if (d[i][0]) out[String(d[i][0])] = d[i][1];
  return out;
}

function searchOrg_(user, body) {
  const {ss} = orgSpreadsheet_(user, body.org_id);
  const q = String(body.query || '').trim().toLowerCase();
  if (!q) return {ok: true, results: []};
  const results = [];
  ORG_TABS.forEach(tab => {
    const sh = ss.getSheetByName(tab);
    if (!sh) return;
    const d = sh.getDataRange().getValues();
    if (d.length < 2) return;
    const headers = d[0].map(String);
    for (let i = 1; i < d.length; i++) {
      const row = d[i];
      const joined = row.join(' ').toLowerCase();
      if (joined.indexOf(q) >= 0) {
        const o = {_row: i + 1, _sheet: tab};
        headers.forEach((h, j) => o[h] = row[j]);
        results.push(o);
        if (results.length >= 200) break;
      }
    }
  });
  return {ok: true, results};
}

// =====================================================================
// Audit
// =====================================================================

function audit_(user, action, org_id, details) {
  try {
    const sh = master_().getSheetByName('audit');
    if (!sh) return;
    sh.appendRow([new Date(), user.email || '(anon)', action, org_id || '', JSON.stringify(details || {}).slice(0, 4000)]);
  } catch (e) {}
}

function auditOrg_(ss, user, action, sheet, rowId, details) {
  try {
    const sh = ss.getSheetByName('audit');
    if (!sh) return;
    sh.appendRow([new Date(), user.email || '(anon)', action, sheet, rowId, JSON.stringify(details || {}).slice(0, 4000)]);
  } catch (e) {}
}

function getAudit_(user, body) {
  if (body && body.org_id) {
    const {ss} = orgSpreadsheet_(user, body.org_id);
    const sh = ss.getSheetByName('audit');
    if (!sh) return {ok: true, rows: []};
    const d = sh.getDataRange().getValues();
    return {ok: true, headers: d[0], rows: d.slice(1).reverse().slice(0, body.limit || 200)};
  }
  if (user.role !== 'admin') return {ok: false, error: 'FORBIDDEN_ADMIN_ONLY'};
  const sh = master_().getSheetByName('audit');
  const d = sh.getDataRange().getValues();
  return {ok: true, headers: d[0], rows: d.slice(1).reverse().slice(0, body.limit || 500)};
}

// =====================================================================
// Bootstrap & bulk import
// =====================================================================

function initMaster_() {
  const ss = master_();
  const ensure = (name, headers) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(headers);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#d9ead3');
    }
  };
  ensure('orgs',     ['id', 'name', 'sheet_id', 'manager_email', 'created_at', 'active', 'budget_total', 'notes']);
  ensure('users',    ['email', 'role', 'org_id', 'name', 'added_at']);
  ensure('audit',    ['ts', 'user_email', 'action', 'org_id', 'details']);
  ensure('settings', ['key', 'value']);
  // Remove default Sheet1 if empty
  const def = ss.getSheetByName('Sheet1') || ss.getSheetByName('גיליון1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);
  return {ok: true, master_id: MASTER_SHEET_ID, url: ss.getUrl()};
}

function bulkImport_(body) {
  // body: {org_id, sheet_name, rows: [ {col: val, ...}, ... ]}
  const org = getOrgById_(body.org_id);
  if (!org) return {ok: false, error: 'ORG_NOT_FOUND'};
  const ss = SpreadsheetApp.openById(org.sheet_id);
  const sh = ss.getSheetByName(body.sheet_name);
  if (!sh) return {ok: false, error: 'SHEET_NOT_FOUND', sheet: body.sheet_name};
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const rows = (body.rows || []).map(r => headers.map(h => r[h] !== undefined ? r[h] : ''));
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  return {ok: true, imported: rows.length};
}

// =====================================================================
// Convenience: run from editor to bootstrap master sheet
// =====================================================================

function setup() {
  const r = initMaster_();
  Logger.log(JSON.stringify(r));
  return r;
}
