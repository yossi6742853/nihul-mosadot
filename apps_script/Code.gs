/**
 * ניהול מוסדות — Backend (Apps Script Web App)
 * Architecture: Token-based auth (no Google sign-in needed in browser).
 * Frontend (GitHub Pages) calls this Web App via fetch() with AGENT_TOKEN.
 *
 * Master Sheet stores: orgs, users, audit, settings.
 * Each org spreadsheet: פעילות, ספקים, בעלות, חשבוניות, קבלות, config, audit.
 */

const MASTER_SHEET_ID = '12XSl0Biu96fu4LDN99KdzCOScAe-4hWnAiIX_oaq06I';
const AGENT_TOKEN     = 'NIHUL_2026_xK7tQp9eMz';   // shared secret with frontend
const APP_VERSION     = 'v1.0.0';

// Locked statuses — only admin can edit / delete / replace files
const LOCKED_STATUSES = ['מאושר', 'שולם'];
const ORG_TABS = ['פעילות', 'ספקים', 'בעלות'];
const ORG_HEADERS = [
  'מספר סידורי','קטגורית מטרה','פירוט המטרה',
  'שם הספק','טלפון ספק','תאריך חשבון',
  'בנק','סניף','חשבון','שם המוטב','סכום',
  'קישור חשבונית','קישור קבלה','כן (גפן)','לא (גפן)',
  'סטטוס','מאשר','נעול','נוצר ע"י','נוצר בתאריך'
];

// =====================================================================
// HTTP entry points
// =====================================================================

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'ping';
  return jsonOut(runAction({action, token: e.parameter.token, params: e.parameter.params ? JSON.parse(e.parameter.params) : []}));
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (_) {}
  return jsonOut(runAction(body));
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function runAction(body) {
  const token = body.token || '';
  const action = body.action || 'ping';
  const params = body.params || [];
  if (action === 'ping') return {ok: true, version: APP_VERSION};
  if (token !== AGENT_TOKEN) return {ok: false, error: 'INVALID_TOKEN'};
  try {
    const fn = HANDLERS[action];
    if (!fn) return {ok: false, error: 'UNKNOWN_ACTION', action};
    const data = fn.apply(null, params);
    return {ok: true, data};
  } catch (err) {
    return {ok: false, error: String(err && err.message || err), stack: err && err.stack};
  }
}

// =====================================================================
// Action handlers
// =====================================================================

const HANDLERS = {
  // -- auth & meta --
  authenticate: authenticate,
  whoami: function(username) { return getUser_(username); },

  // -- orgs --
  listOrgs:    listOrgs_,
  createOrg:   createOrg_,
  updateOrg:   updateOrg_,
  deleteOrg:   deleteOrg_,

  // -- users --
  listUsers:   listUsers_,
  addUser:     addUser_,
  removeUser:  removeUser_,
  changePassword: changePassword_,

  // -- sheet rows --
  getSheet:    getSheet_,
  addRow:      addRow_,
  updateRow:   updateRow_,
  deleteRow:   deleteRow_,
  setStatus:   setStatus_,
  setLock:     setLock_,

  // -- summaries --
  summary:        summary_,
  globalSummary:  globalSummary_,

  // -- audit --
  audit:       audit_get_,

  // -- file uploads --
  uploadFile:  uploadFile_,

  // -- search --
  search:      search_,

  // -- self heal --
  initMaster:  initMaster_,
};

// =====================================================================
// Auth (simple username/password from Master.users)
// =====================================================================

function authenticate(username, password) {
  ensureMasterReady_();
  const users = listUsers_();
  const u = users.find(x => String(x['username']||'').toLowerCase() === String(username||'').toLowerCase());
  if (!u) return {ok: false, error: 'משתמש לא נמצא'};
  const stored = String(u['password'] || '');
  if (stored !== String(password)) return {ok: false, error: 'סיסמה שגויה'};
  return {ok: true, user: {
    username: u['username'],
    role: u['role'] || 'manager',
    name: u['name'] || '',
    org_id: u['org_id'] || '',
    permissions: u['permissions'] || ''
  }};
}

function getUser_(username) {
  const users = listUsers_();
  return users.find(x => String(x['username']||'').toLowerCase() === String(username||'').toLowerCase()) || null;
}

function userIsAdmin_(username) {
  const u = getUser_(username);
  return u && String(u.role).toLowerCase() === 'admin';
}

// =====================================================================
// Master sheet helpers
// =====================================================================

function master_() { return SpreadsheetApp.openById(MASTER_SHEET_ID); }

function tableRead_(ss, tabName) {
  const sh = ss.getSheetByName(tabName);
  if (!sh) return [];
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(String);
  return data.slice(1).filter(r => r[0] !== '' && r[0] !== null).map(r => {
    const o = {};
    headers.forEach((h, i) => o[h] = r[i]);
    return o;
  });
}

function tableHeaders_(ss, tabName) {
  const sh = ss.getSheetByName(tabName);
  if (!sh) return [];
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
}

function listOrgs_() {
  const rows = tableRead_(master_(), 'orgs');
  return rows.filter(o => String(o.active).toUpperCase() !== 'FALSE');
}

function getOrgById_(org_id) {
  return listOrgs_().find(o => String(o.id) === String(org_id));
}

function listUsers_() { return tableRead_(master_(), 'users'); }

// =====================================================================
// Org CRUD
// =====================================================================

function createOrg_(actorUsername, name, manager_username, manager_password, budget_total) {
  if (!userIsAdmin_(actorUsername)) throw new Error('FORBIDDEN_ADMIN_ONLY');
  if (!name) throw new Error('NAME_REQUIRED');
  const id = 'org_' + Utilities.formatDate(new Date(), 'GMT', 'yyyyMMddHHmmss');
  const ss = SpreadsheetApp.create('ניהול מוסדות — ' + name);
  bootstrapOrgSpreadsheet_(ss, name, Number(budget_total||0));
  const sheetId = ss.getId();
  // Append to master.orgs
  const orgsSh = master_().getSheetByName('orgs');
  orgsSh.appendRow([id, name, sheetId, '', manager_username||'', new Date(), 'TRUE', Number(budget_total||0), '']);
  // Add user row
  if (manager_username) {
    addUser_(actorUsername, manager_username, manager_password || generatePassword_(),
             'manager', id, name + ' מנהל');
  }
  audit_(actorUsername, 'create_org', id, {name, sheet_id: sheetId});
  return {id, name, sheet_id: sheetId, manager_username, budget_total};
}

function updateOrg_(actorUsername, org_id, fields) {
  if (!userIsAdmin_(actorUsername)) throw new Error('FORBIDDEN_ADMIN_ONLY');
  const sh = master_().getSheetByName('orgs');
  const data = sh.getDataRange().getValues();
  const head = data[0].map(String);
  const idIdx = head.indexOf('id');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]) === String(org_id)) {
      Object.keys(fields||{}).forEach(k => {
        const ci = head.indexOf(k);
        if (ci >= 0) sh.getRange(i+1, ci+1).setValue(fields[k]);
      });
      audit_(actorUsername, 'update_org', org_id, fields);
      return {ok: true};
    }
  }
  throw new Error('ORG_NOT_FOUND');
}

function deleteOrg_(actorUsername, org_id) {
  if (!userIsAdmin_(actorUsername)) throw new Error('FORBIDDEN_ADMIN_ONLY');
  const sh = master_().getSheetByName('orgs');
  const data = sh.getDataRange().getValues();
  const head = data[0].map(String);
  const idIdx = head.indexOf('id');
  const actIdx = head.indexOf('active');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]) === String(org_id)) {
      sh.getRange(i+1, actIdx+1).setValue('FALSE');
      audit_(actorUsername, 'delete_org', org_id, {});
      return {ok: true};
    }
  }
  throw new Error('ORG_NOT_FOUND');
}

function bootstrapOrgSpreadsheet_(ss, orgName, budget) {
  const def = ss.getSheets()[0];
  ORG_TABS.forEach((tab, idx) => {
    const sh = (idx === 0) ? def : ss.insertSheet(tab);
    if (idx === 0) sh.setName(tab);
    sh.appendRow(ORG_HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, ORG_HEADERS.length).setFontWeight('bold').setBackground('#fff2cc');
  });
  const inv = ss.insertSheet('חשבוניות');
  inv.appendRow(['חותמת זמן','אימייל','מספר סידורי','גליון','קישור']);
  inv.setFrozenRows(1);
  const rec = ss.insertSheet('קבלות');
  rec.appendRow(['חותמת זמן','אימייל','מספר סידורי','גליון','קישור']);
  rec.setFrozenRows(1);
  const cfg = ss.insertSheet('config');
  cfg.appendRow(['key','value']);
  cfg.appendRow(['org_name', orgName]);
  cfg.appendRow(['budget_total', budget]);
  cfg.appendRow(['categories','אחר;פעילות חודשית;פעילות פרטנית;אחזקה ותחזוקה;נקיון וציוד נקיון;קייטרינג;שכירות;אישורים;ציוד משרדי']);
  cfg.appendRow(['workflow_statuses','טיוטה;ממתין לאישור;מאושר;שולם;בוטל']);
  const aud = ss.insertSheet('audit');
  aud.appendRow(['ts','user','action','sheet','row_id','details']);
  aud.setFrozenRows(1);
}

// =====================================================================
// Users CRUD
// =====================================================================

function addUser_(actorUsername, username, password, role, org_id, name) {
  if (!userIsAdmin_(actorUsername)) throw new Error('FORBIDDEN_ADMIN_ONLY');
  if (!username) throw new Error('USERNAME_REQUIRED');
  const sh = master_().getSheetByName('users');
  const data = sh.getDataRange().getValues();
  const head = data[0].map(String);
  // Update if exists
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][head.indexOf('username')]).toLowerCase() === String(username).toLowerCase()) {
      if (password) sh.getRange(i+1, head.indexOf('password')+1).setValue(password);
      if (role)     sh.getRange(i+1, head.indexOf('role')+1).setValue(role);
      if (org_id)   sh.getRange(i+1, head.indexOf('org_id')+1).setValue(org_id);
      if (name)     sh.getRange(i+1, head.indexOf('name')+1).setValue(name);
      audit_(actorUsername, 'update_user', org_id||'', {username, role});
      return {ok: true, updated: true};
    }
  }
  sh.appendRow([username, password || generatePassword_(), role||'manager', org_id||'', name||'', new Date(), '']);
  audit_(actorUsername, 'add_user', org_id||'', {username, role});
  return {ok: true};
}

function removeUser_(actorUsername, username) {
  if (!userIsAdmin_(actorUsername)) throw new Error('FORBIDDEN_ADMIN_ONLY');
  const sh = master_().getSheetByName('users');
  const data = sh.getDataRange().getValues();
  const head = data[0].map(String);
  const uIdx = head.indexOf('username');
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][uIdx]).toLowerCase() === String(username).toLowerCase()) {
      sh.deleteRow(i+1);
    }
  }
  audit_(actorUsername, 'remove_user', '', {username});
  return {ok: true};
}

function changePassword_(actorUsername, username, newPassword) {
  // user can change own password; admin can change any
  if (actorUsername !== username && !userIsAdmin_(actorUsername)) throw new Error('FORBIDDEN');
  const sh = master_().getSheetByName('users');
  const data = sh.getDataRange().getValues();
  const head = data[0].map(String);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][head.indexOf('username')]).toLowerCase() === String(username).toLowerCase()) {
      sh.getRange(i+1, head.indexOf('password')+1).setValue(newPassword);
      audit_(actorUsername, 'change_password', '', {username});
      return {ok: true};
    }
  }
  throw new Error('USER_NOT_FOUND');
}

function generatePassword_() {
  const chars = 'abcdefghkmnpqrstuvwxyz23456789';
  let p = '';
  for (let i = 0; i < 8; i++) p += chars.charAt(Math.floor(Math.random()*chars.length));
  return p;
}

// =====================================================================
// Sheet operations
// =====================================================================

function userCanAccessOrg_(username, org_id) {
  const u = getUser_(username);
  if (!u) return false;
  if (String(u.role).toLowerCase() === 'admin') return true;
  return String(u.org_id) === String(org_id);
}

function orgSpreadsheet_(username, org_id) {
  if (!userCanAccessOrg_(username, org_id)) throw new Error('FORBIDDEN_ORG');
  const org = getOrgById_(org_id);
  if (!org) throw new Error('ORG_NOT_FOUND');
  return {org, ss: SpreadsheetApp.openById(org.sheet_id)};
}

function getSheet_(username, org_id, sheetName) {
  const {ss, org} = orgSpreadsheet_(username, org_id);
  const sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error('SHEET_NOT_FOUND: ' + sheetName);
  const data = sh.getDataRange().getValues();
  const headers = (data[0]||[]).map(String);
  const rows = data.slice(1).map((r, i) => {
    const o = {_row: i + 2};
    headers.forEach((h, j) => o[h] = r[j]);
    return o;
  });
  return {headers, rows, org_name: org.name, sheet: sheetName};
}

function addRow_(username, org_id, sheetName, fields) {
  const {ss} = orgSpreadsheet_(username, org_id);
  const sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error('SHEET_NOT_FOUND');
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const f = fields || {};
  if (headers.indexOf('נוצר ע"י') >= 0 && !f['נוצר ע"י']) f['נוצר ע"י'] = username;
  if (headers.indexOf('נוצר בתאריך') >= 0 && !f['נוצר בתאריך']) f['נוצר בתאריך'] = new Date();
  if (headers.indexOf('סטטוס') >= 0 && !f['סטטוס']) f['סטטוס'] = 'טיוטה';
  if (headers.indexOf('מספר סידורי') >= 0 && !f['מספר סידורי']) f['מספר סידורי'] = nextSerial_(sh);
  const row = headers.map(h => f[h] !== undefined ? f[h] : '');
  sh.appendRow(row);
  const newRow = sh.getLastRow();
  audit_(username, 'add_row', org_id, {sheet: sheetName, row: newRow, fields: f});
  auditOrg_(ss, username, 'add_row', sheetName, newRow, f);
  return {_row: newRow, serial: f['מספר סידורי']};
}

function updateRow_(username, org_id, sheetName, _row, fields) {
  const {ss} = orgSpreadsheet_(username, org_id);
  const sh = ss.getSheetByName(sheetName);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const before = {};
  headers.forEach((h, i) => before[h] = sh.getRange(_row, i+1).getValue());
  if (rowIsLocked_(headers, before) && !userIsAdmin_(username)) {
    throw new Error('שורה נעולה — רק מנהל כללי יכול לערוך');
  }
  Object.keys(fields||{}).forEach(k => {
    const ci = headers.indexOf(k);
    if (ci >= 0) sh.getRange(_row, ci+1).setValue(fields[k]);
  });
  audit_(username, 'update_row', org_id, {sheet: sheetName, row: _row, fields, before});
  auditOrg_(ss, username, 'update_row', sheetName, _row, {fields, before});
  return {ok: true};
}

function deleteRow_(username, org_id, sheetName, _row) {
  const {ss} = orgSpreadsheet_(username, org_id);
  const sh = ss.getSheetByName(sheetName);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const snapshot = {};
  headers.forEach((h, i) => snapshot[h] = sh.getRange(_row, i+1).getValue());
  if (rowIsLocked_(headers, snapshot) && !userIsAdmin_(username)) {
    throw new Error('שורה נעולה — אין למחוק');
  }
  sh.deleteRow(_row);
  audit_(username, 'delete_row', org_id, {sheet: sheetName, row: _row, snapshot});
  auditOrg_(ss, username, 'delete_row', sheetName, _row, snapshot);
  return {ok: true};
}

function setStatus_(username, org_id, sheetName, _row, newStatus) {
  const {ss} = orgSpreadsheet_(username, org_id);
  const sh = ss.getSheetByName(sheetName);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const stIdx = headers.indexOf('סטטוס');
  const apIdx = headers.indexOf('מאשר');
  const prev = String(sh.getRange(_row, stIdx+1).getValue() || '').trim();
  const willLock = LOCKED_STATUSES.indexOf(newStatus) >= 0;
  const wasLocked = LOCKED_STATUSES.indexOf(prev) >= 0;
  if ((willLock || wasLocked) && !userIsAdmin_(username)) {
    throw new Error('שינוי סטטוס מאושר/שולם — רק למנהל כללי');
  }
  sh.getRange(_row, stIdx+1).setValue(newStatus);
  if (willLock && apIdx >= 0) sh.getRange(_row, apIdx+1).setValue(username);
  audit_(username, 'set_status', org_id, {sheet: sheetName, row: _row, prev, next: newStatus});
  auditOrg_(ss, username, 'set_status', sheetName, _row, {prev, next: newStatus});
  return {ok: true};
}

function setLock_(username, org_id, sheetName, _row, locked) {
  if (!locked && !userIsAdmin_(username)) throw new Error('פתיחת נעילה — רק מנהל כללי');
  const {ss} = orgSpreadsheet_(username, org_id);
  const sh = ss.getSheetByName(sheetName);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const ci = headers.indexOf('נעול');
  if (ci < 0) throw new Error('NO_LOCK_COLUMN');
  sh.getRange(_row, ci+1).setValue(locked ? 'TRUE' : 'FALSE');
  audit_(username, locked?'lock_row':'unlock_row', org_id, {sheet: sheetName, row: _row});
  auditOrg_(ss, username, locked?'lock_row':'unlock_row', sheetName, _row, {});
  return {ok: true};
}

function rowIsLocked_(headers, rowObj) {
  const v = rowObj['נעול'];
  if (v === true || String(v).toLowerCase() === 'true') return true;
  const s = String(rowObj['סטטוס']||'').trim();
  return LOCKED_STATUSES.indexOf(s) >= 0;
}

function nextSerial_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return 1;
  const col = sh.getRange(2, 1, last - 1, 1).getValues().map(r => Number(r[0]) || 0);
  return Math.max.apply(null, col.concat([0])) + 1;
}

// =====================================================================
// Summaries
// =====================================================================

function summary_(username, org_id) {
  const {ss, org} = orgSpreadsheet_(username, org_id);
  const cfg = readConfig_(ss);
  const total = Number(cfg.budget_total || org.budget_total || 0);
  const tabs = ORG_TABS.filter(t => ss.getSheetByName(t));
  let used = 0;
  const tabStats = tabs.map(t => {
    const sh = ss.getSheetByName(t);
    const data = sh.getDataRange().getValues();
    if (data.length < 2) return {name: t, count: 0, sum: 0};
    const headers = data[0].map(String);
    const sumIdx = headers.indexOf('סכום');
    let sum = 0, count = 0;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] !== '' && data[i][0] != null) {
        sum += Number(data[i][sumIdx]) || 0;
        count++;
      }
    }
    used += sum;
    return {name: t, count, sum, budget: Number(cfg['budget_'+t]||0)};
  });
  return {org_name: org.name, org_id, budget_total: total, used, remaining: total - used, tabs: tabStats};
}

function globalSummary_(username) {
  if (!userIsAdmin_(username)) throw new Error('FORBIDDEN_ADMIN_ONLY');
  const orgs = listOrgs_();
  return orgs.map(o => {
    try { return summary_(username, o.id); }
    catch (e) { return {org_id: o.id, org_name: o.name, error: String(e.message||e)}; }
  });
}

function readConfig_(ss) {
  const sh = ss.getSheetByName('config');
  const out = {};
  if (!sh) return out;
  const d = sh.getDataRange().getValues();
  for (let i = 1; i < d.length; i++) if (d[i][0]) out[String(d[i][0])] = d[i][1];
  return out;
}

// =====================================================================
// Audit
// =====================================================================

function audit_(username, action, org_id, details) {
  try {
    const sh = master_().getSheetByName('audit');
    if (!sh) return;
    sh.appendRow([new Date(), username||'(anon)', action, org_id||'',
                  JSON.stringify(details||{}).slice(0, 4000)]);
  } catch (e) {}
}

function auditOrg_(ss, username, action, sheet, rowId, details) {
  try {
    const sh = ss.getSheetByName('audit');
    if (!sh) return;
    sh.appendRow([new Date(), username||'(anon)', action, sheet, rowId,
                  JSON.stringify(details||{}).slice(0, 4000)]);
  } catch (e) {}
}

function audit_get_(username, org_id, limit) {
  limit = limit || 200;
  if (org_id) {
    const {ss} = orgSpreadsheet_(username, org_id);
    const sh = ss.getSheetByName('audit');
    if (!sh) return {headers: [], rows: []};
    const d = sh.getDataRange().getValues();
    return {headers: d[0]||[], rows: d.slice(1).reverse().slice(0, limit)};
  }
  if (!userIsAdmin_(username)) throw new Error('FORBIDDEN_ADMIN_ONLY');
  const sh = master_().getSheetByName('audit');
  const d = sh.getDataRange().getValues();
  return {headers: d[0]||[], rows: d.slice(1).reverse().slice(0, limit)};
}

// =====================================================================
// File upload
// =====================================================================

function uploadFile_(username, org_id, sheetName, _row, kind, filename, mime, dataB64) {
  const {ss, org} = orgSpreadsheet_(username, org_id);
  const sh = ss.getSheetByName(sheetName);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const snap = {};
  headers.forEach((h, i) => snap[h] = sh.getRange(_row, i+1).getValue());
  if (rowIsLocked_(headers, snap) && !userIsAdmin_(username)) {
    throw new Error('שורה נעולה — אי אפשר להחליף קובץ');
  }
  const colName = kind === 'receipt' ? 'קישור קבלה' : 'קישור חשבונית';
  const colIdx = headers.indexOf(colName);
  if (colIdx < 0) throw new Error('NO_COLUMN: ' + colName);
  const folder = ensureOrgFolder_(org, kind === 'receipt' ? 'קבלות' : 'חשבוניות');
  const bytes = Utilities.base64Decode(dataB64 || '');
  const blob = Utilities.newBlob(bytes, mime || 'application/pdf', filename || 'file.pdf');
  const file = folder.createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(e) {}
  const url = file.getUrl();
  const previousUrl = sh.getRange(_row, colIdx+1).getValue();
  sh.getRange(_row, colIdx+1).setValue(url);
  const logName = kind === 'receipt' ? 'קבלות' : 'חשבוניות';
  const logSh = ss.getSheetByName(logName);
  const serial = sh.getRange(_row, headers.indexOf('מספר סידורי')+1).getValue();
  if (logSh) logSh.appendRow([new Date(), username, serial, sheetName, url]);
  audit_(username, previousUrl?'replace_file':'upload_file', org_id,
         {sheet: sheetName, row: _row, kind, file_id: file.getId(), prev: previousUrl, next: url, name: filename});
  auditOrg_(ss, username, previousUrl?'replace_file':'upload_file', sheetName, _row,
            {kind, file_id: file.getId(), prev: previousUrl, next: url, name: filename});
  return {url, file_id: file.getId(), name: filename, replaced: !!previousUrl};
}

function ensureOrgFolder_(org, sub) {
  const file = DriveApp.getFileById(org.sheet_id);
  const parents = file.getParents();
  const parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const orgFolderName = 'ניהול מוסדות — קבצים — ' + org.name;
  const it = parent.getFoldersByName(orgFolderName);
  const orgFolder = it.hasNext() ? it.next() : parent.createFolder(orgFolderName);
  if (!sub) return orgFolder;
  const it2 = orgFolder.getFoldersByName(sub);
  return it2.hasNext() ? it2.next() : orgFolder.createFolder(sub);
}

// =====================================================================
// Search
// =====================================================================

function search_(username, org_id, query) {
  const {ss} = orgSpreadsheet_(username, org_id);
  const q = String(query||'').toLowerCase().trim();
  if (!q) return [];
  const out = [];
  ORG_TABS.forEach(tab => {
    const sh = ss.getSheetByName(tab);
    if (!sh) return;
    const d = sh.getDataRange().getValues();
    if (d.length < 2) return;
    const headers = d[0].map(String);
    for (let i = 1; i < d.length; i++) {
      if (d[i].join(' ').toLowerCase().indexOf(q) >= 0) {
        const o = {_row: i+1, _sheet: tab};
        headers.forEach((h, j) => o[h] = d[i][j]);
        out.push(o);
        if (out.length >= 200) break;
      }
    }
  });
  return out;
}

// =====================================================================
// Init / self-heal
// =====================================================================

function ensureMasterReady_() {
  const ss = master_();
  ['orgs','users','audit','settings'].forEach(n => {
    if (!ss.getSheetByName(n)) initMaster_();
  });
  // Ensure users tab has expected headers
  const sh = ss.getSheetByName('users');
  if (sh) {
    const head = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
    if (head.indexOf('username') < 0) {
      // Migrate old schema (email/role/org_id/name/added_at) → new (username/password/role/org_id/name/added_at/permissions)
      sh.clearContents();
      sh.appendRow(['username','password','role','org_id','name','added_at','permissions']);
      sh.appendRow(['admin','6742','admin','','יוסף שניידר',new Date(),'all']);
    } else {
      // Make sure default admin exists
      const data = sh.getDataRange().getValues();
      const uIdx = head.indexOf('username');
      const has = data.slice(1).some(r => String(r[uIdx]).toLowerCase() === 'admin');
      if (!has) sh.appendRow(['admin','6742','admin','','יוסף שניידר',new Date(),'all']);
    }
  }
}

function initMaster_() {
  const ss = master_();
  const ensure = (name, headers) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(headers);
      sh.setFrozenRows(1);
      sh.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#d9ead3');
    }
  };
  ensure('orgs',     ['id','name','sheet_id','folder_id','manager_email','created_at','active','budget_total','notes']);
  ensure('users',    ['username','password','role','org_id','name','added_at','permissions']);
  ensure('audit',    ['ts','user','action','org_id','details']);
  ensure('settings', ['key','value']);
  return {ok: true};
}
