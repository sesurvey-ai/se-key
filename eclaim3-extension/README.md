# eClaim3 Survey Helper — Chrome Extension

Chrome Extension (Manifest V3) ฝังเข้าหน้า eClaim3 — อ่านเลขเคลม/เลขเซอร์เวย์/ผู้คีย์ ตรวจซ้ำ และส่งข้อมูลเข้า LAN API server

## ติดตั้ง (unpacked)

1. เปิด Chrome → `chrome://extensions` → เปิด **Developer mode**
2. กด **Load unpacked** → เลือกโฟลเดอร์ `eclaim3-extension/` นี้
3. กดไอคอน extension ที่ toolbar → ตั้งค่า **LAN server URL** (เช่น `http://192.168.1.10:3000`)
4. กด "ทดสอบ" เพื่อเช็คการเชื่อมต่อ → กด "บันทึก"
5. เปิดหน้า eClaim3 → floating panel จะโผล่ขึ้นมามุมขวาบน

## ไฟล์

```
eclaim3-extension/
├── manifest.json    ← Manifest V3 config
├── background.js    ← Service worker (proxy API calls — bypass mixed-content block)
├── content.js       ← อ่าน DOM + floating panel + save flow
├── content.css      ← สไตล์ panel
├── popup.html       ← หน้าตั้งค่า (LAN server URL)
├── popup.js
└── icons/
```

## ทำไมต้องมี background.js

eClaim3 เป็น HTTPS แต่ LAN server เป็น HTTP → Chrome block mixed content fetch จากเนื้อหน้า
แก้โดยให้ content script ส่งข้อความผ่าน `chrome.runtime.sendMessage` ไปให้ background service worker
ซึ่งยิง `fetch` เอง (ไม่โดน mixed-content rule)

## พฤติกรรม

| สถานการณ์ | สีป้าย |
|---|---|
| ยังโหลดหน้าไม่เสร็จ | เทา "รอข้อมูล..." |
| เลขเคลมใหม่ | เขียว |
| เลขเคลมซ้ำ | แดง "มีเลขเคลมนี้แล้ว" |
| เลขเซอร์เวย์ใหม่ | เขียว |
| เลขเซอร์เวย์ซ้ำ | แดง → ต้องเลือก **งานรวม** หรือ **SESV** ถึงจะบันทึกได้ |
| server เชื่อมไม่ได้ | status bar ส้ม/แดง |

## Flow ตอนกด "บันทึกข้อมูล"

1. `POST /api/records` → ได้ record id
2. `POST /api/send-isurvey {id}` → server ตัดสินใจว่าส่ง iSurvey หรือไม่ (SESV = ไม่ส่ง)
3. เคลียร์ช่อง mix/sesv และ re-check dup

## DOM selectors ที่ extension อ่าน

| ข้อมูล | selector |
|---|---|
| เลขเคลม     | `#lblRef_Claim_No` |
| เลขเซอร์เวย์ | `#txtBill_No` |
| ผู้คีย์      | `#wuHeadUser1_lblUser_Name` |

## Versions

- **0.2.8** — Web-submit gate: ปุ่ม "บันทึกข้อมูล" manual ถูกลบ, panel auto-save **หลัง** user คลิก `#wuFlow1_cmdSendNew` บนเว็บ + SweetAlert success popup โผล่ + user กด OK — กันการโกง "บันทึก panel ก่อนส่งเว็บ"
- **0.2.7** — auto-select งานต้น/งานตาม จาก `#ddlAdd_No`; เปลี่ยน งานรวม/SESV เป็น checkbox (uncheck → enable radio กลับ); เมื่อ checkbox เลือกอยู่ radio จะถูก disable
- **0.2.6** — สลับคอลัมน์ DB สำหรับงานรวม/SESV: `survey_no` = ค่าที่ user กรอก (ส่ง iSurvey), `invoice_mix` = เลขเซอร์เวย์จาก DOM; migrate ข้อมูลเก่า 3,410 แถวแล้ว
- **0.2.5** — SESV เปลี่ยนเป็นรูปแบบเดียวกับงานรวม (list + ➕ + batch) และตอนนี้ส่ง iSurvey ด้วย (survey_no = invoice_mix); radio label "SESV IV" → "SESV"
- **0.2.4** — งานรวม: ปุ่ม ➕ เพิ่มช่องได้หลายเลข กดบันทึกครั้งเดียวส่งรวดเดียว
- **0.2.3** — เปลี่ยน "เชื่อมต่อ server แล้ว" เป็นวงกลมสีที่ header; status bar ซ่อนเมื่อไม่มีข้อความ
- **0.2.2** — popup มี build tag + status always-visible + route test ผ่าน background worker
- **0.2.1** — จำกัด matches เป็น `/esurvey/*` เท่านั้น (ไม่โผล่ใน popup `/EMCSReport/*`)
- **0.2.0** — UI เต็ม (radio/inputs/save), popup settings, background service worker, API integration
- **0.1.0** — prototype อ่าน DOM + floating panel เฉยๆ
