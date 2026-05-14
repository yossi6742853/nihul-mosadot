# -*- coding: utf-8 -*-
"""
bootstrap_master.py — מאתחל את ה-Master Hub (יוצר גליונות orgs/users/audit/settings).
משתמש ב-clasprc.json של יוסף לקבלת access token.
"""
import os, json, subprocess, sys, time

CLASPRC = os.path.join(os.path.expanduser('~'), '.clasprc.json')
MASTER_ID = '1AhlGUV9qbCMVKP5_LH-fKJj3-ijD8CrefBlh1Fdq9DY'
ADMIN_EMAILS = [
    ('6742853@gmail.com', 'יוסף שניידר'),
]

def curl_json(method, url, token, body=None):
    args = ['curl', '-s', '-S', '-X', method, url,
            '-H', f'Authorization: Bearer {token}',
            '-H', 'Content-Type: application/json']
    if body is not None:
        args += ['-d', json.dumps(body, ensure_ascii=False)]
    r = subprocess.run(args, capture_output=True, timeout=120)
    out = (r.stdout or r.stderr).decode('utf-8', errors='replace')
    try:
        return json.loads(out)
    except Exception:
        return {'_raw': out}

def refresh_token():
    rc = json.load(open(CLASPRC, encoding='utf-8'))
    c = rc['tokens']['default']
    body = (f"client_id={c['client_id']}&client_secret={c['client_secret']}"
            f"&refresh_token={c['refresh_token']}&grant_type=refresh_token")
    r = subprocess.run(['curl', '-s', '-X', 'POST', 'https://oauth2.googleapis.com/token',
                        '-H', 'Content-Type: application/x-www-form-urlencoded',
                        '-d', body], capture_output=True, timeout=60)
    data = json.loads(r.stdout.decode('utf-8'))
    if 'access_token' not in data:
        print('refresh failed:', data); sys.exit(1)
    return data['access_token']

def get_meta(token, sheet_id):
    return curl_json('GET',
        f'https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}?fields=sheets(properties(sheetId,title))',
        token)

def batch_update(token, sheet_id, requests):
    return curl_json('POST',
        f'https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}:batchUpdate',
        token, {'requests': requests})

def values_update(token, sheet_id, a1_range, values):
    url = f'https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/{a1_range}?valueInputOption=USER_ENTERED'
    return curl_json('PUT', url, token, {'values': values})

def main():
    token = refresh_token()
    print('  token OK')

    meta = get_meta(token, MASTER_ID)
    existing_titles = {s['properties']['title']: s['properties']['sheetId']
                       for s in meta.get('sheets', [])}
    print('  existing tabs:', list(existing_titles.keys()))

    needed = [
        ('orgs',     ['id', 'name', 'sheet_id', 'manager_email', 'created_at', 'active', 'budget_total', 'notes']),
        ('users',    ['email', 'role', 'org_id', 'name', 'added_at']),
        ('audit',    ['ts', 'user_email', 'action', 'org_id', 'details']),
        ('settings', ['key', 'value']),
    ]

    add_requests = []
    for title, _ in needed:
        if title not in existing_titles:
            add_requests.append({'addSheet': {'properties': {'title': title}}})
    if add_requests:
        r = batch_update(token, MASTER_ID, add_requests)
        print('  added tabs:', [s['title'] for s in [rep.get('addSheet', {}).get('properties', {}) for rep in r.get('replies', [])]])

    # Refresh meta
    meta = get_meta(token, MASTER_ID)
    titles = {s['properties']['title']: s['properties']['sheetId']
              for s in meta.get('sheets', [])}

    # Write headers + format
    fmt_requests = []
    for title, headers in needed:
        values_update(token, MASTER_ID, f"'{title}'!A1", [headers])
        sid = titles[title]
        fmt_requests += [
            {'updateSheetProperties': {'properties': {'sheetId': sid, 'gridProperties': {'frozenRowCount': 1}, 'rightToLeft': True}, 'fields': 'gridProperties.frozenRowCount,rightToLeft'}},
            {'repeatCell': {
                'range': {'sheetId': sid, 'startRowIndex': 0, 'endRowIndex': 1},
                'cell': {'userEnteredFormat': {'backgroundColor': {'red': 0.85, 'green': 0.93, 'blue': 0.83}, 'textFormat': {'bold': True}}},
                'fields': 'userEnteredFormat(backgroundColor,textFormat)'
            }},
        ]

    # Seed admin users (if not already there)
    sid_users = titles['users']
    for email, name in ADMIN_EMAILS:
        # Append directly (idempotency check is too noisy here; duplicates are harmless)
        values_update(token, MASTER_ID, f"'users'!A2",
                      [[email, 'admin', '', name, time.strftime('%Y-%m-%d %H:%M:%S')]])

    # Seed settings
    values_update(token, MASTER_ID, f"'settings'!A2",
                  [['app_name', 'ניהול מוסדות'],
                   ['version', '0.1.0'],
                   ['admin_emails_hint', 'נהל מ-tab users (role=admin). מנדי וחיים יתווספו בידיים.']])

    # Delete default Sheet1 if empty and other sheets exist
    drop = None
    for t in ('Sheet1', 'גיליון1'):
        if t in titles:
            drop = titles[t]; break
    if drop is not None and len(titles) > len(needed):
        fmt_requests.append({'deleteSheet': {'sheetId': drop}})

    if fmt_requests:
        batch_update(token, MASTER_ID, fmt_requests)

    print('=== DONE ===')
    print('Master Hub:', f'https://docs.google.com/spreadsheets/d/{MASTER_ID}/edit')

if __name__ == '__main__':
    main()
