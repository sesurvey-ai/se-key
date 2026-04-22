# se-key server

Local LAN API server สำหรับ SE Survey Helper — Express.js + SQLite (better-sqlite3) + Admin web UI

## ติดตั้ง

```bash
cd server
npm install          # ดึง better-sqlite3 prebuilt ตาม Node ABI ปัจจุบัน (Node 22 / 24 Windows x64 รองรับ)
```

## รัน Server

```bash
npm start                 # port 3100 (ตาม .env), bind 0.0.0.0 (LAN-accessible)
```

### Production: ติดตั้งเป็น Windows service (แนะนำ)

รัน `npm start` ตรงๆ จาก terminal มีความเสี่ยง **Quick Edit Mode ค้างโปรเซส** — user คลิกเข้า terminal → cmd pause ทั้ง Node process → HTTP ค้างทั้งระบบ ต้อง kill terminal + start ใหม่

ติดตั้งเป็น Windows service ด้วย WinSW แทน (สคริปต์ [`install-winsw.ps1`](../install-winsw.ps1) ที่ root ของ repo):

```powershell
# PowerShell as Administrator
cd C:\se-key
Set-ExecutionPolicy -Scope Process Bypass
.\install-winsw.ps1
```

Script จะ download WinSW v2.12.0 → เขียน XML config → install + start service → health-check ให้ครบ

**จัดการ service หลังติดตั้ง**
```powershell
C:\se-key\service\se-key.exe status      # running?
C:\se-key\service\se-key.exe restart     # หลัง deploy โค้ดใหม่
C:\se-key\service\se-key.exe stop / start / uninstall
```

**Log**
- `logs/se-key.out.log` — stdout
- `logs/se-key.err.log` — stderr/crash
- `logs/se-key.wrapper.log` — WinSW events
- `logs/YYYY-MM-DD.log` — app log (JSON lines)

`.env` (copy จาก `.env.example`):
```
PORT=3100
HOST=0.0.0.0
SE_KEY_DB=                   # empty → ใช้ ./data.db (default)
ISURVEY_URL=https://se.isurvey.mobi/service/srvEMCSrpt.php
ISURVEY_USER_ID=sesurvey
ISURVEY_PASSWORD=xxx
ISURVEY_TIMEOUT_MS=60000     # 60s — upstream อาจช้า
SE_KEY_API_KEY=<64-hex>      # shared secret
RETRY_ENABLED=0              # ปิด default (opt-in)
RETRY_INTERVAL_MS=300000
RETRY_BATCH_SIZE=20
RETRY_MAX_ATTEMPTS=10
```

## Endpoints

### Auth
- ทุก `/api/*` ต้อง header `X-API-Key: <SE_KEY_API_KEY>` (ถ้า env ตั้ง)
- `/admin/*` ไม่ต้อง API key — page prompt user ตอน load เก็บใน `localStorage`

### `GET /api/health`
```json
{ "ok": true, "rows": 320531 }
```

### `GET /api/records?claim_no=X&survey_no=Y&limit=100&since_id=0&q=...&work_type=...&isurvey_sent=0|1&from_date=YYYY-MM-DD&to_date=YYYY-MM-DD`
ดึงรายการ records (newest first) + นับ claim/survey ที่ตรงกัน
```json
{
  "rows": [...],
  "total": 320531,
  "limit": 100, "offset": 0,
  "claim_count":  5, "claim_sent_count":  4,
  "survey_count": 0, "survey_sent_count": 0
}
```

### `GET /api/records/:id`
ดู record เดียว (ใช้โดย admin edit form)
```json
{ "record": {...} }
```

### `GET /api/records/export?<same filters>`
Export เป็น `.xlsx` (streaming writer)

### `POST /api/records`
```json
{
  "claim_no":       "2026013126637",
  "survey_no":      "SEABI-110260400183",
  "keyer":          "นิสากร เปรมปรีดิ์",
  "work_type":      "งานต้น",
  "invoice_mix":    "",
  "upsert_pending": true
}
```
- `upsert_pending: true` — ถ้ามี pending row (isurvey_sent=0) สำหรับ `(claim, survey)` เดิม → UPDATE แทน INSERT (กัน duplicate เวลา user กดแก้ซ้ำ)
- Response `201 Created` → `{ "record": {...}, "upserted": "inserted" }`
- Response `200 OK` (ถ้า upserted) → `{ "record": {...}, "upserted": "updated" }`

### `PATCH /api/records/:id`
แก้ไข — payload ใส่เฉพาะ field ที่จะเปลี่ยน:
```json
{ "isurvey_sent": 1, "keyer": "edited" }
```
Editable fields: `claim_no`, `survey_no`, `keyer`, `work_type`, `invoice_mix`, `isurvey_sent`
(read-only: `id`, `created_at`, `retry_*`)

### `DELETE /api/records/:id`
```json
{ "deleted": 320570 }
```

### `POST /api/send-isurvey`
```json
{ "id": 320570 }
```
- Proxy ส่งข้อมูลต่อไป `https://se.isurvey.mobi/service/srvEMCSrpt.php`
- Routing ตาม `work_type`: **งานต้น / งานตาม / งานรวม / SESV** ส่งทุกตัว โดยใช้ `records.survey_no` เป็น canonical
- `records.survey_no` คือค่าที่ user กรอก (สำหรับ batch mode), `records.invoice_mix` เก็บเลขเซอร์เวย์ DOM เป็น reference
- Unknown work_type → `{ sent: false, skipped: true, reason }` + mark `isurvey_sent = 1` (ถือว่า done)
- ถ้า row `isurvey_sent=1` อยู่แล้ว → `{ sent: true, alreadySent: true }` **ไม่ยิง iSurvey ซ้ำ** (idempotent)
- สำเร็จ → mark `isurvey_sent = 1`
- Config env: `ISURVEY_URL`, `ISURVEY_USER_ID`, `ISURVEY_PASSWORD`, `ISURVEY_TIMEOUT_MS`

### `GET /admin/`
Static admin UI — list + CRUD + ปุ่ม iSurvey ต่อแถว (ดู `public/`)

## Schema

```sql
CREATE TABLE records (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at   TEXT DEFAULT (datetime('now','localtime')),
    claim_no     TEXT NOT NULL,
    survey_no    TEXT NOT NULL DEFAULT '',
    keyer        TEXT NOT NULL DEFAULT '',
    work_type    TEXT NOT NULL DEFAULT '',   -- งานต้น/งานตาม/งานรวม/SESV
    invoice_mix  TEXT NOT NULL DEFAULT '',
    isurvey_sent INTEGER NOT NULL DEFAULT 0, -- 0=รอส่ง, 1=ส่งแล้ว
    retry_count    INTEGER NOT NULL DEFAULT 0,
    last_retry_at  TEXT,
    retry_error    TEXT
);
```
Indexes: `claim_no`, `survey_no`, `created_at`, `(isurvey_sent, work_type)`

## Migration scripts

ใน `src/`:
- `migrate-csv.js` — import จาก Google Sheets CSV export
- `import-xlsx.js` — import จาก .xlsx, ตั้ง `isurvey_sent=1` (สำหรับข้อมูล historical ที่ถือว่าส่งไปแล้ว)
- `revert-sent.js` — flip rows จาก sent → pending (ตามเงื่อนไขในไฟล์ reference)

```bash
node src/migrate-csv.js ./mydata.csv
node src/import-xlsx.js "C:\path\to\คีย์ข้อมูล.xlsx" --dry-run
node src/import-xlsx.js "C:\path\to\คีย์ข้อมูล.xlsx"          # for real
```

## Backup

```bash
# Mac/Linux
cp data.db data.db.$(date +%Y%m%d).bak

# Windows
copy data.db data.db.20260421.bak
```

WAL mode รองรับ hot copy แต่ควร checkpoint ก่อนเพื่อให้ `data.db` มีข้อมูลครบ (ไม่ต้อง copy -shm/-wal ไปด้วย):
```js
// one-liner
node -e "const D=require('better-sqlite3');const d=new D('./data.db');d.pragma('wal_checkpoint(TRUNCATE)');d.close();"
```

หลัง checkpoint → copy `data.db` ได้ทันที (ไม่ต้องเอา `data.db-shm` / `data.db-wal` ไปด้วย)

ถ้าปลายทางเจอ error `database disk image is malformed` หลัง copy → ลบ `data.db-shm` + `data.db-wal` ของปลายทาง (เป็นของ DB เก่า ไม่ตรงกับไฟล์ใหม่)
