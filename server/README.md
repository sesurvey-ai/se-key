# se-key server

Local LAN API server สำหรับ SE Survey Helper — Express.js + SQLite (better-sqlite3)

## ติดตั้ง

```bash
cd server
npm install
```

## Migrate ข้อมูลเก่าจาก Google Sheets

1. Export Google Sheet เป็น CSV แล้ววางไว้ที่ `/tmp/sheet.csv` (หรือส่ง path เอง)
2. รัน:
   ```bash
   npm run migrate                 # อ่านจาก /tmp/sheet.csv
   npm run migrate -- ./mydata.csv # อ่านจาก path อื่น
   ```
3. Migration จะ **refuse** ถ้าตารางมีข้อมูลอยู่แล้ว (ลบ `data.db` ก่อนถ้าอยากรันใหม่)

## รัน Server

```bash
npm start                 # port 3000, bind 0.0.0.0 (LAN-accessible)
PORT=4000 npm start       # port อื่น
HOST=127.0.0.1 npm start  # bind เฉพาะ localhost
```

## Endpoints

### `GET /api/health`
```json
{ "ok": true, "rows": 319302 }
```

### `GET /api/records?claim_no=X&survey_no=Y&limit=100&since_id=0`
ดึงรายการ records (newest first) + นับจำนวน claim/survey ที่ตรงกัน — ใช้ตรวจซ้ำ
```json
{
  "rows": [...],
  "claim_count":  5,     // จำนวนแถวที่ claim_no ตรง (null ถ้าไม่ได้ส่ง)
  "survey_count": 0      // จำนวนแถวที่ survey_no ตรง (null ถ้าไม่ได้ส่ง)
}
```

### `POST /api/records`
```json
{
  "claim_no":    "2026013126637",   // required
  "survey_no":   "SEABI-110260400183",
  "keyer":       "นิสากร เปรมปรีดิ์",
  "work_type":   "งานรวม",
  "invoice_mix": "SEABI-310260400503"
}
```
Response `201`:
```json
{ "record": { "id": 319303, "created_at": "...", ... } }
```

### `POST /api/send-isurvey`
```json
{ "id": 319303 }
```
- Proxy ส่งข้อมูลต่อไป `https://se.isurvey.mobi/service/srvEMCSrpt.php`
- Routing ตาม `work_type`:
  | work_type | ส่ง iSurvey? | `survey_no` ที่ส่ง |
  |---|---|---|
  | งานต้น   | ✓ | `records.survey_no` |
  | งานตาม  | ✓ | `records.survey_no` |
  | งานรวม  | ✓ | `records.survey_no` (extension เขียนค่าที่ user กรอกลงคอลัมน์นี้) |
  | SESV     | ✓ | `records.survey_no` (เหมือน งานรวม) |
  | อื่นๆ/ว่าง | ✗ (เก็บ local อย่างเดียว) | — |
- **Schema** — หลัง 2026-04-17: สำหรับ งานรวม/SESV, `records.survey_no` เก็บค่าที่ user กรอก (ส่ง iSurvey), `records.invoice_mix` เก็บเลขเซอร์เวย์จาก DOM `#txtBill_No` เป็น reference
- unknown work_type → คืน `{ sent: false, skipped: true, reason }` และ mark `isurvey_sent = 1` (ถือว่า done)
- สำเร็จ → mark `isurvey_sent = 1`
- ถ้าเคยส่งแล้ว → คืน `{ sent: true, alreadySent: true }` (idempotent)
- Config ผ่าน env: `ISURVEY_URL`, `ISURVEY_USER_ID`, `ISURVEY_PASSWORD`, `ISURVEY_TIMEOUT_MS` (ดู `.env.example`)

## Schema

```sql
CREATE TABLE records (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at   TEXT DEFAULT (datetime('now','localtime')),
    claim_no     TEXT NOT NULL,
    survey_no    TEXT DEFAULT '',
    keyer        TEXT DEFAULT '',
    work_type    TEXT DEFAULT '',  -- งานต้น/งานตาม/งานรวม/SESV
    invoice_mix  TEXT DEFAULT '',
    isurvey_sent INTEGER DEFAULT 0 -- 0=pending, 1=sent
);
```

Indexes: `claim_no`, `survey_no`, `created_at`

## Backup

```bash
cp data.db data.db.$(date +%Y%m%d).bak
```
(ปลอดภัยแม้ตอน server รันอยู่เพราะ WAL mode เปิดไว้)
