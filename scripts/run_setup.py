# -*- coding: utf-8 -*-
"""
run_setup.py — מפעיל את setup() של Apps Script דרך scripts.run API,
משתמש ב-clasprc.json. אם נכשל (כי הdeployment לא API Executable) — מפעיל
את ה-Web App URL בעקיפין דרך GET /exec?api=1&action=ping.
"""
import os, sys, json, subprocess

CLASPRC = os.path.join(os.path.expanduser('~'), '.clasprc.json')
HERE    = os.path.dirname(os.path.abspath(__file__))
STATE   = os.path.join(HERE, '..', 'apps_script', '_state.json')

def refresh_token():
    rc = json.load(open(CLASPRC, encoding='utf-8'))
    c = rc['tokens']['default']
    body = (f"client_id={c['client_id']}&client_secret={c['client_secret']}"
            f"&refresh_token={c['refresh_token']}&grant_type=refresh_token")
    r = subprocess.run(['curl','-s','-X','POST','https://oauth2.googleapis.com/token',
                        '-H','Content-Type: application/x-www-form-urlencoded',
                        '-d', body], capture_output=True, timeout=60)
    return json.loads(r.stdout.decode())['access_token']

def call(method, url, token, body=None, extra_headers=None):
    args = ['curl','-s','-S','-X',method,url,'-H',f'Authorization: Bearer {token}']
    if body is not None:
        args += ['-H','Content-Type: application/json','-d',json.dumps(body, ensure_ascii=False)]
    for k, v in (extra_headers or {}).items():
        args += ['-H', f'{k}: {v}']
    r = subprocess.run(args, capture_output=True, timeout=180)
    out = (r.stdout or r.stderr).decode('utf-8', errors='replace')
    try: return json.loads(out)
    except: return {'_raw': out}

def main():
    state = json.load(open(STATE, encoding='utf-8'))
    script_id = state['script_id']
    web_url   = state.get('web_app_url')
    token = refresh_token()
    fn = sys.argv[1] if len(sys.argv) > 1 else 'setup'
    params = json.loads(sys.argv[2]) if len(sys.argv) > 2 else []
    body = {'function': fn, 'parameters': params, 'devMode': True}
    print(f'calling scripts.run -> {fn}({params!r})')
    r = call('POST', f'https://script.googleapis.com/v1/scripts/{script_id}:run', token, body)
    print(json.dumps(r, ensure_ascii=False, indent=2)[:2500])

if __name__ == '__main__':
    main()
