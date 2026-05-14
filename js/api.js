// ניהול מוסדות — API client
// Talks to Apps Script Web App via fetch with shared AGENT_TOKEN.

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyqbZ2_l6CHujD2dupMieqSNDoOXhhAznFqNMGezmEjotQQeRwBk5sPWf_lWyyRL2SN/exec';
const AGENT_TOKEN     = 'NIHUL_2026_xK7tQp9eMz';
const STORAGE_KEY     = 'nihul_mosadot_data';

let _online = false;

// --- request -----------------------------------------------------------
async function api(action, params) {
  params = params || [];
  try {
    // Use POST with text/plain to avoid CORS preflight
    const resp = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {'Content-Type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({token: AGENT_TOKEN, action, params}),
      redirect: 'follow'
    });
    const text = await resp.text();
    let json;
    try { json = JSON.parse(text); }
    catch (e) { return {ok: false, error: 'invalid_response', raw: text.slice(0, 300)}; }
    _online = true;
    return json;
  } catch (e) {
    _online = false;
    return {ok: false, error: 'network: ' + (e.message || e)};
  }
}

// --- local cache -------------------------------------------------------
function cacheGet(key) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return all[key];
  } catch { return null; }
}

function cacheSet(key, val) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    all[key] = val;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {}
}

function cacheClear() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

// --- session -----------------------------------------------------------
function getSession() {
  try { return JSON.parse(sessionStorage.getItem('user') || 'null'); }
  catch { return null; }
}

function setSession(user) {
  try { sessionStorage.setItem('user', JSON.stringify(user)); }
  catch {}
}

function clearSession() {
  try { sessionStorage.removeItem('user'); } catch {}
}

window.api = api;
window.cacheGet = cacheGet;
window.cacheSet = cacheSet;
window.cacheClear = cacheClear;
window.getSession = getSession;
window.setSession = setSession;
window.clearSession = clearSession;
