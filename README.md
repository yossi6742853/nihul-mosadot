# ניהול מוסדות

מערכת ניהול תקציב לעמותות (multi-tenant). אדמינים כלליים רואים את כל המוסדות; כל מנהל מוסד רואה רק את שלו.

* **Frontend** — GitHub Pages (HTML+JS, RTL עברי).
* **גישה לדאטה** — Sheets API ישירות מהדפדפן (OAuth של המשתמש).
* **בידול בין מוסדות** — שיתוף סלקטיבי של ספרדשיט נפרד לכל מוסד.

## הפעלה ראשונה (יוסף בלבד)

1. ב-[Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials):
   * צור **OAuth Client ID** → Web application
   * Authorized JavaScript origins: `https://yossi6742853.github.io`
2. הפעל בפרויקט: [Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com), [Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)
3. העתק את ה-Client ID לתוך `config.js` ושמור (push).
   * (חלופה: תזין דרך אשף ההתקנה באתר → נשמר ב-localStorage שלך).

## שימוש

* **https://yossi6742853.github.io/nihul-mosadot/**
* התחבר עם Google
* אדמין רואה לשונית **ניהול כללי** — שם יוצרים מוסדות חדשים ומשייכים מנהל
* כשמוסיפים מנהל מוסד — הספרדשיט שלו משותף איתו אוטומטית

## תפקידים

| תפקיד | מה רואה |
|---|---|
| `admin` | כל המוסדות, ניהול משתמשים, audit כללי |
| `manager` | רק את המוסדות ששויכו אליו ב-`users` |

## נעילה ו-workflow

לכל שורה: סטטוס (`טיוטה / ממתין לאישור / מאושר / שולם / בוטל`).
* `מאושר` או `שולם` → השורה ננעלת. רק admin יכול לערוך/למחוק/להחליף קובץ.
* admin יכול גם לנעול ידנית דרך כפתור 🔒.
