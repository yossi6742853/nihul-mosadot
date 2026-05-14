// ניהול מוסדות — API client
// Talks to Apps Script Web App via fetch with shared AGENT_TOKEN.

// Apps Script Web App URL — piggybacked on ai-email-agent's deployment
// (already approved in NetFree). Module: NihulMosadot.gs, dispatched via
// Webhook.gs case 'nihul'.
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzhRqTLE4fjjDqrH1we-JlGZ15R-ws8b_gfWF1xF1ewailaiyiS_YXqUhRtb3cQghVt/exec';
const AGENT_TOKEN     = 'BHT_AGENT_2026';
const STORAGE_KEY     = 'nihul_mosadot_data';

let _online = false;

// --- request -----------------------------------------------------------
async function api(action, params) {
  params = params || [];
  const body = JSON.stringify({action, params});
  try {
    // Send via POST: action+token as URL params (read by Webhook.gs's e.parameter),
    // and JSON body for the nihul action+params (read by handleNihulMosadot's e.postData).
    const url = `${APPS_SCRIPT_URL}?action=nihul&token=${encodeURIComponent(AGENT_TOKEN)}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'text/plain;charset=utf-8'},  // text/plain avoids CORS preflight
      body: body,
      redirect: 'follow'
    });
    const text = await resp.text();
    let json;
    try { json = JSON.parse(text); }
    catch (e) { return {ok:false, error:'invalid_response', raw: text.slice(0,300)}; }
    _online = true;
    // Server returns {ok:true, data:<handler-result>} or {ok:false, error:...}.
    // Pass through as-is — callers read r.ok, r.data, r.error.
    return json;
  } catch (e) {
    _online = false;
    return {ok:false, error:'network: ' + (e.message||e)};
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
