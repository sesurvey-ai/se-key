# SE Survey Helper — Chrome Extension Project

โปรเจกต์ย้ายเครื่องมือคีย์ข้อมูลงานสำรวจจาก Python Tkinter + Selenium (`tk.py` เดิม) มาเป็น Chrome Extension ที่ฝังเข้ากับหน้า eClaim3 โดยตรง พร้อม local LAN API server

---

## ภาพรวม (Overview)

### ระบบเดิม (`tk.py`)

เครื่องมือช่วยคีย์ข้อมูลงานสำรวจที่ใช้ Python Tkinter + Selenium อัตโนมัติ โดย:

1. Selenium เปิด Chrome → login eClaim3 อัตโนมัติ
2. Tkinter window ลอยหน้าจอ (always-on-top) polling ค่าจากหน้าเว็บทุก 100ms
3. โหลดข้อมูลเก่าจาก Google Sheets เพื่อตรวจเลขซ้ำ
4. เมื่อกดบันทึก → เขียนแถวใหม่ลง Google Sheets + POST ไป iSurvey API

### ปัญหาของระบบเดิม

- ต้องติดตั้ง Python + Selenium + ChromeDriver ทุกเครื่อง
- ChromeDriver version ต้องตรงกับ Chrome
- Polling 100ms กิน CPU มาก
- Credentials hardcode ในโค้ด
- Tkinter UI จำกัดเรื่องการปรับแต่ง
- Import หลายตัวไม่ได้ใช้ (PyPDF2, pyhtml2pdf ฯลฯ)

### ระบบใหม่

Chrome Extension ฝังเข้าหน้า eClaim3 + Local LAN API (Express.js + SQLite) บน Windows ใน LAN เดียวกัน

---

## สถาปัตยกรรม (Architecture)

```
┌─────────────────────────────────────┐
│     เครื่องผู้ใช้ (2-5 คน)           │
│  ┌──────────┐   ┌──────────────┐    │
│  │ eClaim3  │──►│ Chrome Ext   │    │
│  │ website  │   │ (content.js) │    │
│  └──────────┘   └──────┬───────┘    │
└──────────────────────── │ ──────────┘
                          │ fetch http://192.168.x.x:3000
                          ▼
┌─────────────────────────────────────┐
│    Windows Server ใน LAN             │
│  ┌────────────────────────────┐      │
│  │   Express.js API           │      │
│  │   GET  /api/records        │      │
│  │   POST /api/records        │      │
│  │   POST /api/send-isurvey   │      │
│  └───────┬──────────────┬─────┘      │
│          ▼              ▼            │
│  ┌────────────┐   ┌──────────┐       │
│  │  SQLite    │   │ iSurvey  │──►   internet → se.isurvey.mobi
│  │  data.db   │   │  proxy   │       │
│  └────────────┘   └──────────┘       │
└──────────────────────────────────────┘
```

### เหตุผลที่เลือกแบบนี้

**Chrome Extension แทน Selenium/Tkinter**
- ไม่ต้องติดตั้ง Python/ChromeDriver ที่เครื่องผู้ใช้
- อ่านค่าจาก DOM ตรงๆ ผ่าน `MutationObserver` (event-driven)
- UI ฝังเข้าหน้างาน ไม่ต้องเปิดหน้าต่างแยก
- แจกจ่ายง่าย (.crx หรือ load unpacked)

**Local LAN API แทน Google Sheets**
- Latency < 1ms (เทียบกับ Google Sheets 200-500ms)
- ไม่ต้องพึ่ง internet ตอนบันทึก
- ข้อมูลอยู่ในมือ (ไม่พึ่ง Google)
- backup ง่าย (copy ไฟล์ `data.db`)
- iSurvey API ย้ายมาเรียกจากฝั่ง server → ไม่ต้อง CORS, credentials ปลอดภัย

**SQLite แทน PostgreSQL/JSON**
- ไม่ต้อง setup database server แยก
- ไฟล์เดียวจบ (`data.db`)
- รองรับ 2-5 คน concurrent ได้สบาย
- เปิดดูผ่าน DB Browser for SQLite (ฟรี, GUI)
- ย้ายไป PostgreSQL/Supabase ทีหลังได้ง่าย

---

## Component Details

### 1. Chrome Extension (Manifest V3)

**หน้าที่**
- Inject content script เข้าหน้า eClaim3
- แสดง floating panel UI (ลากได้, ย่อ/ขยายได้)
- อ่านเลขเคลม (`#lblRef_Claim_No`) และเลขเซอร์เวย์ (`#txtBill_No`) ผ่าน `MutationObserver`
- ส่งข้อมูลไป API ผ่าน LAN
- ตรวจสอบเลขซ้ำ + แสดงสถานะสี (เขียว/แดง/ส้ม)

**โครงสร้างไฟล์**
```
eclaim3-extension/
├── manifest.json    ← Manifest V3 config
├── content.js       ← อ่าน DOM + แสดง floating panel
├── content.css      ← สไตล์ของ panel
├── icons/
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

### 2. Express.js API (Windows Server ใน LAN)

**Endpoints**
- `GET /api/records` — ดึงรายการเลขเคลม + เลขเซอร์เวย์ทั้งหมด (ใช้ตรวจซ้ำ)
- `POST /api/records` — บันทึกข้อมูลใหม่ลง SQLite
- `POST /api/send-isurvey` — proxy ส่งข้อมูลต่อไป iSurvey API

**Database schema (SQLite)**
```sql
CREATE TABLE records (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at   TEXT DEFAULT (datetime('now','localtime')),
    claim_no     TEXT NOT NULL,
    survey_no    TEXT NOT NULL,
    keyer        TEXT NOT NULL,
    work_type    TEXT NOT NULL,  -- งานต้น/งานตาม/งานรวม/SESV
    invoice_mix  TEXT DEFAULT '',
    isurvey_sent INTEGER DEFAULT 0  -- 0=ยังไม่ส่ง, 1=ส่งแล้ว
);
```

คอลัมน์ `isurvey_sent` ไว้ track retry — ถ้า internet หลุดตอนส่ง iSurvey ระบบจะ retry ให้ทีหลัง

---

## เปรียบเทียบกับระบบเดิม

| หัวข้อ | tk.py (เดิม) | ระบบใหม่ |
|---|---|---|
| ติดตั้งที่เครื่องผู้ใช้ | Python + Selenium + ChromeDriver + gspread | Chrome Extension อย่างเดียว |
| ขึ้นกับ ChromeDriver version | ใช่ | ไม่ |
| อ่านค่าจาก eClaim3 | Selenium polling 100ms | MutationObserver (event-driven) |
| UI | Tkinter หน้าต่างแยก | Panel ฝังในหน้า eClaim3 |
| เก็บข้อมูล | Google Sheets (cloud) | SQLite (local LAN) |
| ตอนบันทึก ต้องมี internet | ต้อง | ไม่ต้อง (ลง SQLite ก่อน) |
| CPU usage | สูง | ต่ำ |
| Credentials | hardcode ในโค้ด | เก็บฝั่ง server |
| Backup ข้อมูล | Google export | copy ไฟล์ `data.db` |

---

## Progress / Status

### เสร็จแล้ว

- [x] วิเคราะห์ระบบเดิม `tk.py`
- [x] ออกแบบสถาปัตยกรรมใหม่ (Extension + LAN API + SQLite)
- [x] **Express.js API + SQLite** ([`server/`](server/))
  - [x] setup Node.js project + dependencies (`express`, `better-sqlite3`, `cors`, `exceljs`)
  - [x] สร้าง schema + indexes + migration (`retry_count`, `last_retry_at`, `retry_error`)
  - [x] Endpoints: `GET /api/records` (+ q, filters, date range, pagination), `POST /api/records` (รองรับ `upsert_pending`), `POST /api/send-isurvey`, `GET /api/records/export` (xlsx), `/api/health`
  - [x] iSurvey proxy port จาก `tk.py` (routing รองรับ SESV = ไม่ส่ง)
  - [x] Unit tests สำหรับ payload builder (5/5 ผ่าน)
  - [x] Idempotent `/api/send-isurvey` (`alreadySent` short-circuit)
  - [x] **API key auth** (`X-API-Key` header; ปิดได้ถ้าไม่ตั้ง env)
  - [x] **File logging** (rolling daily JSON lines ที่ `logs/YYYY-MM-DD.log`) + HTTP access log
  - [x] **Retry queue** (exp backoff, ปิด default — opt-in ด้วย `RETRY_ENABLED=1`)
- [x] **Migrate ข้อมูลเก่าจาก Google Sheets** — 319,302 แถว เข้า `data.db` ใน 1.7 วินาที
- [x] **Mark-pending-from-excel** one-off: flip 36 แถวเก่าใน DB จาก `ส่งแล้ว→รอส่ง` ตามไฟล์ `งานสร้างใหม่.xlsx`
- [x] **Chrome Extension v0.3.x** ([`eclaim3-extension/`](eclaim3-extension/))
  - [x] Manifest V3 + host permissions + storage
  - [x] Floating panel (ลาก/ย่อ-ขยาย, MutationObserver + fallback poll)
  - [x] Radio buttons: งานต้น / งานตาม / งานรวม / SESV
  - [x] Entry fields `mix`/`sesv` + สถานะสี 3 ระดับ (เขียว / ส้ม "รอส่ง" / แดง "ส่งแล้ว")
  - [x] Keyer detection จาก `#wuHeadUser1_lblUser_Name`
  - [x] Popup settings page (LAN server URL + API key + test connection)
  - [x] Background service worker เป็น fetch proxy (bypass mixed-content HTTPS→HTTP) + แนบ `X-API-Key` อัตโนมัติ
  - [x] Panel ซ่อนอัตโนมัติบนหน้าที่ไม่ใช่หน้าคีย์งาน (เช่น `frmToday_Cancel.aspx`)
  - [x] Health-ping background (10s) — ไฟสถานะ server ติดตลอด
  - [x] **จับ 2 trigger การบันทึก**:
    - `#wuFlow1_cmdSendNew` → SweetAlert success → INSERT + ส่ง iSurvey
    - `#btnSurvey_Update` → native `window.alert` → **upsert pending** (UPDATE ถ้ามี pending เดิม; INSERT ถ้าไม่มี) — ไม่ยิง iSurvey
  - [x] **หน้า records** (`records.html`): ค้นหา, กรอง work_type/สถานะ/ช่วงวันที่, pagination, **Export Excel (.xlsx)** พร้อม cell types (datetime, text), ปุ่ม manual retry (ปิด default ผ่าน flag)

### กติกายิง iSurvey (ปัจจุบัน)

iSurvey ถูกเรียกเฉพาะเมื่อผู้ใช้กดปุ่ม **"ส่งงานใหม่"** บน eClaim3 และ SweetAlert success ขึ้นมาเท่านั้น

- `#btnSurvey_Update` → **ไม่ยิง** iSurvey (เก็บเป็น pending)
- Retry loop → **ปิด default** (`RETRY_ENABLED=0`)
- ปุ่ม manual send ในหน้า records → **ปิดชั่วคราวผ่าน flag** `MANUAL_SEND_ENABLED`

### ยังเหลือ

- [ ] ทดสอบ end-to-end บน eClaim3 จริง + LAN server Windows จริง
- [ ] Deploy บน Windows 192.168.4.122:3100 (ดู [Deployment](#deployment) ด้านล่าง)
- [ ] **เพิ่มเติมภายหลัง (optional)**
  - [ ] Dashboard (Next.js) ดูข้อมูลย้อนหลัง
  - [ ] Sync → Google Sheets (ถ้ายังต้องการ)

---

## เทคโนโลยีที่ใช้

**Frontend (Extension)**
- Chrome Extension Manifest V3
- Vanilla JavaScript (ไม่ใช้ framework)
- MutationObserver API + page-world script injection

**Backend (LAN Server)**
- Node.js (≥ 20, ใช้ `--env-file`)
- Express.js
- better-sqlite3
- SQLite (WAL mode)
- ExcelJS (streaming xlsx export)

**External**
- iSurvey API (`se.isurvey.mobi`)

---

## Deployment

**เป้าหมาย**: Windows server `192.168.4.122:3100` (port 3000 ถูกโปรเจกต์อื่นใช้อยู่)

**ขั้นตอน**

```powershell
# 1. คัดลอก server/ ไปที่ C:\se-key\server\ (ข้าม node_modules)
cd C:\se-key\server
npm install                 # rebuild better-sqlite3 native binding ให้ Windows/Node

# 2. ตั้งค่า .env
copy .env.example .env
# แก้:
#   PORT=3100
#   SE_KEY_DB=C:\se-key\server\data.db
#   ISURVEY_PASSWORD=<รหัสจริง>
#   SE_KEY_API_KEY=<ได้จาก: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
#   RETRY_ENABLED=0         ← ปิดไว้ตามกติกาปัจจุบัน

# 3. ทดสอบรันก่อน
npm start                   # เห็น: auth.enabled / server.start port=3100 / retry.disabled

# 4. ติดตั้งเป็น Windows service (nssm)
nssm install  se-key "C:\Program Files\nodejs\node.exe" "--env-file=C:\se-key\server\.env" "C:\se-key\server\src\server.js"
nssm set      se-key AppDirectory "C:\se-key\server"
nssm set      se-key AppStdout    "C:\se-key\server\logs\stdout.log"
nssm set      se-key AppStderr    "C:\se-key\server\logs\stderr.log"
nssm start    se-key

# 5. เปิด firewall port 3100
New-NetFirewallRule -DisplayName "SE-Key API" -Direction Inbound -LocalPort 3100 -Protocol TCP -Action Allow
```

**ฝั่ง Extension ทุกเครื่อง (2-5 คน)**
1. `chrome://extensions` → Developer mode → Load unpacked → เลือกโฟลเดอร์ `eclaim3-extension/`
2. คลิก icon extension:
   - **URL**: `http://192.168.4.122:3100`
   - **API key**: ค่าเดียวกับ `SE_KEY_API_KEY` ใน `.env`
3. กด "ทดสอบ" → ต้องเห็น `เชื่อมได้ ✓ (rows = …)` → กด "บันทึก"

---

## หมายเหตุ

- Windows server ใน LAN มี Node.js (≥20) + Python ติดตั้งอยู่แล้ว
- มีผู้ใช้ 2-5 คน ใน LAN เดียวกัน
- Port 3000 ถูกโปรเจกต์อื่นใช้ → เราใช้ 3100
- Backup `data.db` — copy ไฟล์ได้ทันที (WAL mode รองรับ hot copy แต่ควร checkpoint ก่อน: `sqlite3 data.db "PRAGMA wal_checkpoint(TRUNCATE);"`)
