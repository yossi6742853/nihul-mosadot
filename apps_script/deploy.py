# -*- coding: utf-8 -*-
"""
deploy.py — מעלה Apps Script של "ניהול מוסדות" באמצעות clasprc.json קיים.
NetFree-friendly: כל ה-API calls עוברים דרך curl + gzip.

שימוש:
    python deploy.py            # יוצר/מעדכן ויוצר deployment חדש
    python deploy.py --no-deploy # רק מעדכן את התוכן (בלי deployment חדש)

המעקב אחרי SCRIPT_ID מתבצע ב-_state.json בתיקיה הזו.
"""
import os, sys, json, gzip, subprocess, time

HERE       = os.path.dirname(os.path.abspath(__file__))
STATE_PATH = os.path.join(HERE, '_state.json')
CLASPRC    = os.path.join(os.path.expanduser('~'), '.clasprc.json')
TMP_GZ     = os.path.join(HERE, '_deploy_tmp.gz')

GS_FILES   = ['Code']                  # source files in this folder (without extension)
HTML_FILES = ['index']                 # HTML templates (Apps Script HtmlService)
TITLE      = 'ניהול מוסדות'

# ---------- helpers ----------

def load_state():
    if os.path.exists(STATE_PATH):
        return json.load(open(STATE_PATH, encoding='utf-8'))
    return {}

def save_state(s):
    json.dump(s, open(STATE_PATH, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

def curl(*args, timeout=180):
    r = subprocess.run(['curl', '-s', '-S'] + list(args), capture_output=True, timeout=timeout)
    return r.stdout.decode('utf-8', errors='replace') if r.stdout else r.stderr.decode('utf-8', errors='replace')

def refresh_token():
    rc = json.load(open(CLASPRC, encoding='utf-8'))
    c = rc['tokens']['default']
    body = (f"client_id={c['client_id']}&client_secret={c['client_secret']}"
            f"&refresh_token={c['refresh_token']}&grant_type=refresh_token")
    resp = curl('-X', 'POST', 'https://oauth2.googleapis.com/token',
                '-H', 'Content-Type: application/x-www-form-urlencoded',
                '-d', body)
    data = json.loads(resp)
    if 'access_token' not in data:
        print('ERR refresh:', data); sys.exit(1)
    return data['access_token']

def read_text(path):
    return open(path, 'r', encoding='utf-8').read()

def build_files():
    files = []
    mpath = os.path.join(HERE, 'appsscript.json')
    if os.path.exists(mpath):
        files.append({'name': 'appsscript', 'type': 'JSON', 'source': read_text(mpath)})
    for n in GS_FILES:
        p = os.path.join(HERE, n + '.gs')
        if os.path.exists(p):
            files.append({'name': n, 'type': 'SERVER_JS', 'source': read_text(p)})
    for n in HTML_FILES:
        p = os.path.join(HERE, n + '.html')
        if os.path.exists(p):
            files.append({'name': n, 'type': 'HTML', 'source': read_text(p)})
    return files

# ---------- API calls ----------

def create_project(token):
    body = json.dumps({'title': TITLE}, ensure_ascii=False).encode('utf-8')
    body_path = TMP_GZ + '.create.json'
    open(body_path, 'wb').write(body)
    resp = curl('-X', 'POST', 'https://script.googleapis.com/v1/projects',
                '-H', f'Authorization: Bearer {token}',
                '-H', 'Content-Type: application/json',
                '--data-binary', f'@{body_path}')
    os.remove(body_path)
    data = json.loads(resp)
    if 'scriptId' not in data:
        print('ERR create:', data); sys.exit(1)
    return data['scriptId']

def push_content(token, script_id, files):
    body = json.dumps({'files': files}, ensure_ascii=False)
    with gzip.open(TMP_GZ, 'wb') as gz:
        gz.write(body.encode('utf-8'))
    url = f'https://script.googleapis.com/v1/projects/{script_id}/content'
    resp = curl('-X', 'PUT', url,
                '-H', f'Authorization: Bearer {token}',
                '-H', 'Content-Type: application/json',
                '-H', 'Content-Encoding: gzip',
                '--data-binary', f'@{TMP_GZ}')
    os.remove(TMP_GZ)
    data = json.loads(resp)
    if 'files' not in data:
        print('ERR push:', data); return False
    print(f'  pushed {len(data["files"])} files')
    return True

def create_version(token, script_id, desc):
    body = json.dumps({'description': desc})
    url = f'https://script.googleapis.com/v1/projects/{script_id}/versions'
    resp = curl('-X', 'POST', url,
                '-H', f'Authorization: Bearer {token}',
                '-H', 'Content-Type: application/json',
                '-d', body)
    data = json.loads(resp)
    if 'versionNumber' not in data:
        print('ERR version:', data); return None
    return data['versionNumber']

def list_deployments(token, script_id):
    url = f'https://script.googleapis.com/v1/projects/{script_id}/deployments'
    resp = curl('-X', 'GET', url, '-H', f'Authorization: Bearer {token}')
    return json.loads(resp).get('deployments', [])

def update_deployment(token, script_id, deployment_id, version):
    body = json.dumps({
        'deploymentConfig': {
            'versionNumber': version,
            'manifestFileName': 'appsscript',
            'description': f'auto v{version}'
        }
    })
    url = f'https://script.googleapis.com/v1/projects/{script_id}/deployments/{deployment_id}'
    resp = curl('-X', 'PUT', url,
                '-H', f'Authorization: Bearer {token}',
                '-H', 'Content-Type: application/json',
                '-d', body)
    return json.loads(resp)

def create_deployment(token, script_id, version):
    body = json.dumps({
        'versionNumber': version,
        'manifestFileName': 'appsscript',
        'description': f'auto v{version}'
    })
    url = f'https://script.googleapis.com/v1/projects/{script_id}/deployments'
    resp = curl('-X', 'POST', url,
                '-H', f'Authorization: Bearer {token}',
                '-H', 'Content-Type: application/json',
                '-d', body)
    return json.loads(resp)

# ---------- main ----------

def main():
    print('=== ניהול מוסדות — deploy ===')
    state = load_state()
    print('refresh token...')
    token = refresh_token()
    print('OK')

    script_id = state.get('script_id')
    if not script_id:
        print('creating new Apps Script project...')
        script_id = create_project(token)
        state['script_id'] = script_id
        save_state(state)
        print(f'  scriptId = {script_id}')

    print(f'pushing content -> {script_id}')
    files = build_files()
    if not push_content(token, script_id, files):
        sys.exit(1)

    if '--no-deploy' in sys.argv:
        print('skipping deployment (--no-deploy)')
        return

    print('creating version...')
    v = create_version(token, script_id, 'auto from deploy.py')
    if not v:
        sys.exit(1)
    print(f'  version = {v}')

    deps = list_deployments(token, script_id)
    head_dep = next((d for d in deps if d.get('deploymentConfig', {}).get('versionNumber')), None)

    if state.get('deployment_id'):
        print(f'updating existing deployment {state["deployment_id"]}...')
        result = update_deployment(token, script_id, state['deployment_id'], v)
    elif head_dep and head_dep.get('deploymentId'):
        # If a deployment already exists from manual UI, reuse it
        state['deployment_id'] = head_dep['deploymentId']
        save_state(state)
        result = update_deployment(token, script_id, state['deployment_id'], v)
    else:
        print('creating new deployment...')
        result = create_deployment(token, script_id, v)
        state['deployment_id'] = result.get('deploymentId', '')
        save_state(state)

    url = ''
    for ep in result.get('entryPoints', []):
        if ep.get('entryPointType') == 'WEB_APP':
            url = ep['webApp']['url']
            break
    if url:
        state['web_app_url'] = url
        save_state(state)
        print(f'\n=== DONE ===\nWeb App URL:\n{url}')
    else:
        print('deployment created/updated but no web-app URL found yet.')
        print(json.dumps(result, ensure_ascii=False, indent=2)[:1500])
        print('\nOpen the script editor and Publish > Deploy > Web app to expose URL.')

if __name__ == '__main__':
    main()
