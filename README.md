# SE Survey Helper — Chrome Extension Project

โปรเจกต์ย้ายเครื่องมือคีย์ข้อมูลงานสำรวจจาก Python Tkinter + Selenium (`tk.py` เดิม) มาเป็น Chrome Extension ที่ฝังเข้ากับหน้า eClaim3 โดยตรง พร้อม local LAN API server + Admin web UI

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

### ระบบใหม่

Chrome Extension ฝังเข้าหน้า eClaim3 + Local LAN API (Express.js + SQLite) + Admin web UI — ทำงานบน LAN เดียวกัน

---

## สถาปัตยกรรม (Architecture)

```
┌─────────────────────────────────────┐
│   เครื่องผู้ใช้ (2-5 คน)             │
│  ┌──────────┐   ┌──────────────┐    │
│  │ eClaim3  │──►│ Chrome Ext   │    │
│  │ website  │   │ (content.js) │    │
│  └──────────┘   └──────┬───────┘    │
│                        │            │
│  Browser อื่นๆ:        │            │
│  http://.../admin/  ─┐ │            │
└──────────────────────┼─┼────────────┘
                       │ │ HTTP LAN
                       ▼ ▼
┌─────────────────────────────────────┐
│    Windows Server ใน LAN (.122)      │
│  ┌────────────────────────────┐      │
│  │   Express.js API           │      │
│  │   GET  /api/records        │      │
│  │   GET  /api/records/:id    │      │
│  │   POST /api/records        │      │
│  │   PATCH/DELETE /api/records/:id │  │
│  │   POST /api/send-isurvey   │      │
│  │   GET  /admin (static UI)  │      │
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
- แจกจ่ายง่าย (load unpacked)

**Local LAN API แทน Google Sheets**
- Latency < 1ms (เทียบกับ Google Sheets 200-500ms)
- ไม่ต้องพึ่ง internet ตอนบันทึก
- ข้อมูลอยู่ในมือ (ไม่พึ่ง Google)
- backup ง่าย (copy ไฟล์ `data.db`)
- iSurvey API ย้ายมาเรียกจากฝั่ง server → ไม่ต้อง CORS, credentials ปลอดภัย

**SQLite แทน PostgreSQL/JSON**
- ไม่ต้อง setup database server แยก
- ไฟล์เดียวจบ (`data.db`)
- รองรับ 2-5 คน concurrent ได้สบาย (WAL mode)
- เปิดดูผ่าน DB Browser for SQLite
- ย้ายไป PostgreSQL/Supabase ทีหลังได้ง่าย

**Admin Web UI (`/admin`)**
- เข้าจากเบราเซอร์ปกติ — ไม่ต้องมี extension
- CRUD: ค้นหา / เพิ่ม / แก้ไข / ลบ / ปุ่มส่ง iSurvey ต่อแถว
- ใช้ได้กับหลายเครื่องใน LAN พร้อมกัน

---

## Component Details

### 1. Chrome Extension (Manifest V3)

**หน้าที่**
- Inject content script เข้าหน้า eClaim3
- แสดง floating panel UI (ลากได้, ย่อ/ขยายได้)
- อ่านเลขเคลม (`#lblRef_Claim_No`) + เลขเซอร์เวย์ (`#txtBill_No`) + ผู้คีย์ (`#wuHeadUser1_lblUser_Name`) ผ่าน `MutationObserver`
- **Click-only signal**: ยิง save/flush ทันทีที่คลิกปุ่ม eClaim3 (capture phase) — ไม่รอ native alert / SweetAlert ใด ๆ

**Save flow**
- กด **"บันทึกราคา"** (`#btnSurvey_Update`):
  - Save row(s) ลง DB เป็น `isurvey_sent=0` (รอส่ง) — ไม่ส่ง iSurvey
  - รองรับกด **ซ้ำ** สำหรับ edit ข้อมูล — upsert UPDATE row pending เดิม, keyer เป็นคนล่าสุดเสมอ (last-write-wins)
  - รองรับ 2 คน 2 เครื่อง แก้งานเคลมเดียวกัน (ทั้งคู่กดได้ตราบใดที่ยังไม่มี "ส่งงานใหม่")
- กด **"ส่งงานใหม่"** (`#wuFlow1_cmdSendNew`):
  - Save row(s) ของหน้าปัจจุบัน
  - ยิง iSurvey **ทุก row ของเคลมนี้ที่ยัง `sent=0`** (flush-all-for-claim) → flip เป็น `isurvey_sent=1`
  - ไม่จำเป็นต้องเคยกด "บันทึกราคา" มาก่อน — flow นี้ครบในคลิกเดียว
  - Idempotent: กดซ้ำบน row ที่ `sent=1` → server short-circuit `skipped_already_sent`, ไม่สร้าง row + ไม่ยิง iSurvey ซ้ำ
  - Background ทำงานทั้งหมด → reliable แม้ ASP.NET postback ทำให้หน้าเว็บ reload 10+ ครั้ง

**Batch flow (งานรวม / SESV)**
- เปิด checkbox → ช่อง input invoice/sesv list (เพิ่มกี่เลขก็ได้ด้วยปุ่ม +)
- กดบันทึกครั้งเดียวได้ N+1 row:
  - 1 primary: claim + page's survey, work_type = baseType (งานต้น/งานตาม)
  - N follow-up: claim + invoice_value, work_type = "งานตาม", invoice_mix = page's survey

**โครงสร้างไฟล์**
```
eclaim3-extension/
├── manifest.json         ← Manifest V3 config
├── content.js            ← อ่าน DOM + floating panel + click handler
├── content.css           ← สไตล์ panel
├── background.js         ← Service worker (fetch proxy + save-many-and-flush)
├── popup.html / popup.js ← หน้าตั้งค่า (LAN URL + API key + ปุ่ม ดูรายงาน)
├── records.html + .js + .css ← หน้ารายงานในตัว extension
├── icons/
└── README.md
```

### 2. Express.js API (Windows Server ใน LAN)

**Endpoints**

| Method | Path | หมายเหตุ |
|---|---|---|
| `GET` | `/api/health` | row count ปัจจุบัน |
| `GET` | `/api/records` | list + filters (q, work_type, status, date range, pagination) |
| `GET` | `/api/records/export` | Export เป็น .xlsx |
| `GET` | `/api/records/:id` | ดู record เดียว |
| `POST` | `/api/records` | insert/upsert (รองรับ `upsert_pending`) |
| `PATCH` | `/api/records/:id` | แก้ไข (claim_no, survey_no, keyer, work_type, invoice_mix, isurvey_sent) |
| `DELETE` | `/api/records/:id` | ลบ |
| `POST` | `/api/send-isurvey` | proxy ส่งไป iSurvey upstream |
| `GET` | `/admin/*` | static admin UI (served โดยไม่ต้อง API key) |

**Auth**
- API-key header `X-API-Key` ตรงกับ `SE_KEY_API_KEY` ใน `.env`
- `/admin/*` static file ไม่ต้อง key — page prompt user ตอน load ครั้งแรก เก็บไว้ใน `localStorage`

**Database schema (SQLite WAL mode)**
```sql
CREATE TABLE records (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at   TEXT DEFAULT (datetime('now','localtime')),
    claim_no     TEXT NOT NULL,
    survey_no    TEXT NOT NULL DEFAULT '',
    keyer        TEXT NOT NULL DEFAULT '',
    work_type    TEXT NOT NULL DEFAULT '',  -- งานต้น/งานตาม/งานรวม/SESV
    invoice_mix  TEXT NOT NULL DEFAULT '',
    isurvey_sent INTEGER NOT NULL DEFAULT 0,  -- 0=รอส่ง, 1=ส่งแล้ว
    retry_count    INTEGER NOT NULL DEFAULT 0,
    last_retry_at  TEXT,
    retry_error    TEXT
);
```
Indexes: `claim_no`, `survey_no`, `created_at`, `(isurvey_sent, work_type)`

### 3. Admin Web UI (`/admin`)

**หน้าตาราง** — ค้นหา + filter ประเภทงาน/สถานะ/วันที่ + pagination
**ปุ่มต่อแถว**: `แก้ไข` (modal form) / `ลบ` (confirm) / `iSurvey` (ยิง send-isurvey) หรือ `ส่งซ้ำ` (ถ้า sent แล้ว)
**ปุ่ม + เพิ่ม**: modal form กรอกได้ทุก field

⚠️ ปุ่ม "ส่งซ้ำ" บน row `isurvey_sent=1` จะ**ไม่ยิง iSurvey จริง** (server short-circuit `alreadySent`) — ถ้าต้องการส่งซ้ำจริง: แก้สถานะเป็น "รอส่ง" ก่อน

---

## เปรียบเทียบกับระบบเดิม

| หัวข้อ | tk.py (เดิม) | ระบบใหม่ |
|---|---|---|
| ติดตั้งที่เครื่องผู้ใช้ | Python + Selenium + ChromeDriver + gspread | Chrome Extension อย่างเดียว |
| ขึ้นกับ ChromeDriver version | ใช่ | ไม่ |
| อ่านค่าจาก eClaim3 | Selenium polling 100ms | MutationObserver (event-driven) |
| UI | Tkinter หน้าต่างแยก | Panel ฝังในหน้า + Admin web |
| เก็บข้อมูล | Google Sheets (cloud) | SQLite (local LAN, WAL mode) |
| ตอนบันทึก ต้องมี internet | ต้อง | ไม่ต้อง (ลง SQLite ก่อน ส่ง iSurvey ทีหลัง) |
| CPU usage | สูง | ต่ำ |
| Credentials | hardcode ในโค้ด | เก็บฝั่ง server `.env` |
| Backup ข้อมูล | Google export | copy ไฟล์ `data.db` |
| CRUD ข้อมูลย้อนหลัง | ต้อง Google Sheets | หน้า Admin `/admin` |

---

## Progress / Status

### เสร็จแล้ว

- [x] วิเคราะห์ระบบเดิม `tk.py`
- [x] ออกแบบสถาปัตยกรรมใหม่ (Extension + LAN API + SQLite + Admin UI)
- [x] **Express.js API + SQLite** ([`server/`](server/))
  - [x] setup Node.js + `express` + `better-sqlite3` (v12.9.0 — prebuilt สำหรับ Node 22/24 Windows)
  - [x] Schema + indexes + migration (`retry_count`, `last_retry_at`, `retry_error`)
  - [x] Endpoints: GET list/single/export, POST records/send-isurvey, PATCH/DELETE records, /api/health
  - [x] iSurvey proxy port จาก `tk.py` (routing รองรับ SESV/งานรวม — canonical `survey_no`)
  - [x] Idempotent `/api/send-isurvey` (`alreadySent` short-circuit)
  - [x] Idempotent `/api/records` upsert — short-circuit `skipped_already_sent` เมื่อ `(claim, survey)` มี `isurvey_sent=1` แล้ว → กัน duplicate row + กันยิง iSurvey ซ้ำจากเครื่องที่ 2
  - [x] **API key auth** (`X-API-Key`; ปิดได้ถ้าไม่ตั้ง env)
  - [x] **File logging** (rolling daily JSON lines `logs/YYYY-MM-DD.log`)
  - [x] **Retry queue** (exp backoff, ปิด default — opt-in ด้วย `RETRY_ENABLED=1`)
  - [x] `/admin/*` static serving (bypass API key gate)
- [x] **Migration ข้อมูลเก่า**
  - [x] Import CSV จาก Google Sheets: 319,302 แถว → 1.7 วินาที
  - [x] Import xlsx `คีย์ข้อมูล.xlsx` เพิ่มเติม (+89 rows, `isurvey_sent=1`)
  - [x] Import xlsx `งานสร้างใหม่.xlsx` (+83 rows `isurvey_sent=0` + flip 1 row)
- [x] **Chrome Extension v0.3.30** ([`eclaim3-extension/`](eclaim3-extension/))
  - [x] Manifest V3 + host permissions + storage
  - [x] Floating panel — **แคบ 170px, ย่อเป็น default** (คลิก header ขยาย) ลากย้ายตำแหน่งได้
  - [x] Radio buttons: งานต้น / งานตาม / งานรวม / SESV + batch list
  - [x] Keyer detection จาก `#wuHeadUser1_lblUser_Name`
  - [x] Popup settings (LAN URL + API key + test + ปุ่ม "ดูรายงาน") + **วงสถานะ server** มุมขวาบน
  - [x] Background service worker (fetch proxy bypass mixed-content; `save-many-and-flush` op)
  - [x] Panel ซ่อนอัตโนมัติบนหน้าที่ไม่ใช่หน้าคีย์งาน
  - [x] **Click-only detection**: save ยิงทันทีที่คลิกปุ่ม eClaim3 (capture phase) — ไม่พึ่ง native alert / SweetAlert observer อีกต่อไป (ลดขนาด content.js -293 บรรทัดใน v0.3.30)
  - [x] **"ส่งงานใหม่" flush-all-for-claim**: ยิง iSurvey ทุก row ของเคลมที่ยัง `sent=0` ไม่ว่าจะสร้างจาก session ไหน เครื่องไหน (v0.3.29)
  - [x] Batch flow งานรวม/SESV: 1 primary + N follow-up ในคลิกเดียว
  - [x] Submit status: 🔴 "ยังไม่ได้ส่ง" / 🟠 "รอส่งงาน" / 🟢 "ส่งงานแล้ว"
  - [x] **Submit status dot** บน header panel — เห็นสีสถานะได้แม้ panel ย่อ
  - [x] **🧹 Clear form** — ปุ่ม broom บน header ล้าง 29 ช่องฟอร์ม eClaim3 (ราคา/ประกัน/จำนวน/รายละเอียด) ในคลิกเดียว
  - [x] Dup labels กระชับ: "เลขเคลม (ส่งแล้ว)" / "เลขเคลม (รอส่ง)" / "เลขเซอร์เวย์ (ส่งแล้ว)" / "เลขเซอร์เวย์ (รอส่ง)"
  - [x] **หน้า records** (ใน extension): ค้นหา, filter, pagination, Export xlsx
- [x] **Admin Web UI** ([`server/public/`](server/public/))
  - [x] List + filter + pagination (เหมือน records.html)
  - [x] **Add/Edit/Delete** modal forms
  - [x] ปุ่ม iSurvey / ส่งซ้ำ ต่อแถว
  - [x] API key เก็บใน `localStorage` — ตั้งครั้งเดียวจำตลอด

### ยังเหลือ / optional

- [x] **Windows service (WinSW)** บน .122 — auto-start on boot, ไม่มี terminal ให้ค้าง (สคริปต์ [`install-winsw.ps1`](install-winsw.ps1))
- [ ] Firewall rule inbound port 3100 บน .122 (`netsh advfirewall`)
- [ ] Dashboard ดูสถิติย้อนหลัง (optional)

---

## เทคโนโลยีที่ใช้

**Frontend (Extension + Admin)**
- Chrome Extension Manifest V3
- Vanilla JavaScript (ไม่ใช้ framework)
- MutationObserver API + page-world script injection
- sessionStorage สำหรับ claim session tracking

**Backend (LAN Server)**
- Node.js ≥ 22 (ใช้ `--env-file`)
- Express.js
- better-sqlite3 v12.9.0 (prebuilt ABI 127 สำหรับ Node 22 / ABI 137 สำหรับ Node 24 Windows x64)
- SQLite (WAL mode)
- ExcelJS (streaming xlsx export + import)

**External**
- iSurvey API (`se.isurvey.mobi/service/srvEMCSrpt.php`)

---

## Deployment

**เป้าหมาย**: Windows server `192.168.4.122:3100`

### 1. Deploy server

```powershell
# 1. คัดลอก server/ ไปที่ C:\se-key\server\ (ข้าม data.db, logs, node_modules ถ้ามีอยู่แล้ว)
cd C:\se-key\server
npm install                  # ดาวน์โหลด prebuilt better-sqlite3 ให้ Node เวอร์ชันที่ใช้

# 2. ตั้งค่า .env (copy จาก .env.example)
#   PORT=3100
#   SE_KEY_DB=C:\se-key\server\data.db
#   ISURVEY_USER_ID=sesurvey
#   ISURVEY_PASSWORD=<รหัสจริง>
#   ISURVEY_TIMEOUT_MS=60000   ← 60s (upstream อาจช้า; 15s น้อยไป)
#   SE_KEY_API_KEY=<random 64-hex>
#   RETRY_ENABLED=0

# 3. ทดสอบรัน
npm start
#   เห็น: auth.enabled / server.start port=3100 / retry.disabled

# 4. ติดตั้งเป็น Windows service ด้วย WinSW (แนะนำ — หลุดปัญหา terminal ค้าง/Quick Edit)
#    เปิด PowerShell as Administrator
cd C:\se-key
Set-ExecutionPolicy -Scope Process Bypass
.\install-winsw.ps1
#   script จะ download WinSW v2.12.0, เขียน config XML, install + start service,
#   health-check http://localhost:3100/api/health ให้อัตโนมัติ

# 5. (optional) เปิด firewall port 3100 (PowerShell admin)
New-NetFirewallRule -DisplayName "SE-Key API" -Direction Inbound -LocalPort 3100 -Protocol TCP -Action Allow
```

**คำสั่งจัดการ service หลังติดตั้ง**
```powershell
C:\se-key\service\se-key.exe status      # ดูว่า running ไหม
C:\se-key\service\se-key.exe restart     # หลัง deploy โค้ดใหม่
C:\se-key\service\se-key.exe stop
C:\se-key\service\se-key.exe start
C:\se-key\service\se-key.exe uninstall   # ถอนทิ้ง
```

**Log files** — `C:\se-key\server\logs\`
- `se-key.out.log` — stdout จาก server (console.log)
- `se-key.err.log` — stderr / crash
- `se-key.wrapper.log` — WinSW events (install/start/stop)
- `YYYY-MM-DD.log` — app log ของ server เอง ([`logger.js`](server/src/logger.js), JSON lines)

### 2. Deploy extension (ทุกเครื่อง user)

1. `chrome://extensions/` → Developer mode → **Load unpacked** → เลือก `eclaim3-extension/`
2. คลิก icon → ตั้งค่า:
   - **LAN server URL**: `http://192.168.4.122:3100`
   - **API key**: ค่าเดียวกับ `SE_KEY_API_KEY` ใน `.env`
3. กด "ทดสอบ" → เห็น `เชื่อมได้ ✓ (rows = ...)` → กด "บันทึก"
4. ทดสอบบนหน้า eClaim3 — floating panel ควรโผล่มุมขวาบน จุดสถานะเขียว

### 3. เข้า Admin UI

- เบราเซอร์เครื่องไหนใน LAN ก็ได้: `http://192.168.4.122:3100/admin/`
- popup ⚙ ถามครั้งแรก → ใส่ API key → บันทึก → ใช้ได้เลย

### Upgrade ครั้งต่อไป

Server-only changes: copy `server/src/*.js` + `server/public/*` ทับบน .122 → `C:\se-key\service\se-key.exe restart`
Extension-only changes: copy `eclaim3-extension/*` แล้วทุกเครื่อง user กด Reload ที่ `chrome://extensions/`

---

## Troubleshooting

### `database disk image is malformed` หลัง copy data.db
- ลบ `data.db-shm` + `data.db-wal` ของเครื่องปลายทาง — เป็นของ DB เก่า ไม่ตรงกับ `data.db` ที่ copy มาใหม่
- ก่อน copy ที่เครื่องต้นทาง: checkpoint ก่อน (`PRAGMA wal_checkpoint(TRUNCATE)`) เพื่อให้ข้อมูลทั้งหมดอยู่ใน `data.db` ไฟล์เดียว

### `better_sqlite3.node ... NODE_MODULE_VERSION`
- native binding ไม่ตรง Node runtime — รัน `npm install better-sqlite3@latest` ใหม่ที่เครื่องปลายทาง (ดึง prebuilt ตาม ABI)

### `iSurvey request timed out`
- Upstream ช้าเกิน → เพิ่ม `ISURVEY_TIMEOUT_MS` ใน `.env` เป็น 60000+ แล้ว restart server

### Extension ไม่ยิง POST เลย (แค่ GET /api/health)
- Open browser DevTools → ดู console ว่า extension โหลดเวอร์ชันที่ถูกต้องไหม (`[SE Survey Helper] v0.3.xx loaded`)
- User click ปุ่มถูกไหม (`#btnSurvey_Update` หรือ `#wuFlow1_cmdSendNew`) — ถ้า eClaim3 เปลี่ยน id ต้องอัพเดต content.js

### Server ค้าง (ไม่ error แต่เปิด admin ไม่ได้ ต้อง restart)
- **สาเหตุหลัก**: Windows "Quick Edit Mode" — user คลิกใน terminal `npm start` → cmd pause process รอ Enter
- **ทุก HTTP request ค้าง** เพราะ [`logger.js`](server/src/logger.js) เรียก `console.log` ทุก request → block event loop
- **วิธีแก้ถาวร**: ติดตั้งเป็น Windows service ด้วย [`install-winsw.ps1`](install-winsw.ps1) — ไม่มี interactive terminal = ไม่มี Quick Edit ค้าง
- **วิธีแก้ชั่วคราว**: right-click title bar ของ terminal → Properties → ปิด "QuickEdit Mode"

---

## หมายเหตุ

- Windows server ใน LAN ต้องมี Node.js ≥ 22
- มีผู้ใช้ 2-5 คน ใน LAN เดียวกัน
- Port 3000 ถูกโปรเจกต์อื่นใช้ → เราใช้ 3100
- Backup `data.db` — copy ไฟล์ได้ทันที (WAL mode รองรับ hot copy แต่ควร checkpoint ก่อน)
