// ============================================================
// ניהול מוסדות — config
// ============================================================
// יוסף: לאחר יצירת OAuth Client ID ב-Google Cloud Console,
// הדבק את המזהה כאן (זה מזהה ציבורי, בטוח לחשוף).
// ============================================================

window.CONFIG = {
  // OAuth 2.0 Client ID (Web application) — קח מ-https://console.cloud.google.com/apis/credentials
  // עדיין לא מוגדר → המערכת תציג הוראות התקנה.
  CLIENT_ID: '',

  // Master Hub Spreadsheet ID — נשאר קבוע
  MASTER_ID: '12XSl0Biu96fu4LDN99KdzCOScAe-4hWnAiIX_oaq06I',

  // קישורי quick-launch (זמין במצב פשוט בלי OAuth)
  QUICK_LINKS: [
    {name: 'Master Hub - ניהול מוסדות', id: '12XSl0Biu96fu4LDN99KdzCOScAe-4hWnAiIX_oaq06I'},
    {name: 'בית התלמוד תשפו', id: '1tUs40BAedWRiCGclaoZF_ktZ7NXjEZ6NiYEv3Fm26u8'},
  ],

  // ה-scopes הנדרשים. אל תשנה.
  SCOPES: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/userinfo.email',
    'openid'
  ].join(' '),

  // Discovery doc for Sheets API
  DISCOVERY_DOC: 'https://sheets.googleapis.com/$discovery/rest?version=v4',

  // Bootstrap admins — מי שיכול להיכנס למצב admin אם users sheet ריק או לא נגיש.
  // הכוונה: רק אנשים אלו יראו "ניהול כללי" כל עוד אין שורה אחרת ב-users.
  FALLBACK_ADMINS: ['6742853@gmail.com'],

  APP_VERSION: '0.2.0'
};
