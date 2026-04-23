# eClaim3 Survey Helper — Chrome Extension

Chrome Extension (Manifest V3) ฝังเข้าหน้า eClaim3 — อ่านเลขเคลม/เลขเซอร์เวย์/ผู้คีย์ ตรวจซ้ำ บันทึกเข้า LAN API server และส่งต่อไป iSurvey

## ติดตั้ง (unpacked)

1. เปิด Chrome → `chrome://extensions` → เปิด **Developer mode**
2. กด **Load unpacked** → เลือกโฟลเดอร์ `eclaim3-extension/` นี้
3. กดไอคอน extension → ตั้งค่า:
   - **LAN server URL** (เช่น `http://192.168.4.122:3100`)
   - **API key** ตรงกับ `SE_KEY_API_KEY` ของ server
   - มุมขวาบนของ popup มีวงกลมบอกสถานะ server (เขียว=OK / แดง=ล่ม / เทา=ยังไม่ ping)
4. กด "ทดสอบ" เพื่อเช็คการเชื่อมต่อ → กด "บันทึก"
5. เปิดหน้า eClaim3 → floating panel แบบ**ย่อ**จะโผล่มุมขวาบน (คลิก header เพื่อขยาย)

## ไฟล์

```
eclaim3-extension/
├── manifest.json      ← Manifest V3 config
├── background.js      ← Service worker: fetch proxy + save-many-and-flush
├── content.js         ← อ่าน DOM + floating panel + click handler + validation
├── content.css        ← สไตล์ panel (แคบ 170px, ย่อ default, submit-status dot)
├── popup.html / popup.js  ← หน้าตั้งค่า (LAN URL + API key + วงสถานะ server + ปุ่ม 📋 ดูรายงาน)
├── records.html + .js + .css ← หน้ารายงานในตัว extension
├── icons/
└── README.md
```

## ทำไมต้องมี background.js

eClaim3 เป็น HTTPS แต่ LAN server เป็น HTTP → Chrome block mixed content. Content script ส่ง `chrome.runtime.sendMessage` ไป background worker ซึ่งยิง fetch เอง (ไม่โดน mixed-content) + ประกัน reliability: การ save + send-isurvey ทำครบใน background แม้ content script ถูกทำลายจาก ASP.NET postback navigation

## Save flow

### กด "บันทึกราคา" (`#btnSurvey_Update`)
- Save row(s) ลง DB เป็น `isurvey_sent=0` (รอส่ง) — ไม่ส่ง iSurvey
- รองรับกดซ้ำเพื่อแก้ไขข้อมูล (upsert: UPDATE pending row เดิม ไม่สร้างซ้ำ)
- Panel แสดงสถานะ 🟠 "บันทึกแล้ว รอส่งงาน" (พื้นส้ม)

### กด "ส่งงานใหม่" (`#wuFlow1_cmdSendNew`) หรือ "ส่งผลงานต่อเนื่อง" (`#wuFlow1_cmdSendFollow`)
- Save row(s) ของหน้าปัจจุบัน
- Background ยิง iSurvey สำหรับ **ทุก row ของเคลมนี้ที่ยัง `sent=0`** → flip เป็น `isurvey_sent=1`
- ไม่ต้องกด "บันทึกราคา" มาก่อนก็ได้ — flow ครบในคลิกเดียว
- Idempotent: server short-circuit `skipped_already_sent` ถ้า `(claim, survey)` ตรงกับ row ที่ `sent=1` แล้ว — กัน duplicate + กันยิงซ้ำจากเครื่องที่ 2
- Panel แสดงสถานะ 🟢 "ส่งงานแล้ว" (พื้นเขียว)

### Batch (งานรวม / SESV)
- เปิด checkbox → panel auto-expand + ช่อง input list (เพิ่มได้หลาย invoice ด้วยปุ่ม +)
- `#txtBill_No` ขึ้นต้น "SESV" → auto-tick SESV ให้อัตโนมัติ
- **ทุกช่อง input ที่เห็นต้องมีค่า** ก่อนกดบันทึก/ส่ง — ถ้ามีช่องว่าง click จะถูก block (`preventDefault` + `stopImmediatePropagation`) + focus ช่องว่าง + แจ้งใน panel. ถ้าไม่ต้องการใช้ช่องไหน → กดปุ่ม × ลบ row นั้น
- กดบันทึกครั้งเดียวได้ N+1 row:
  - 1 primary: claim + page's survey, work_type = baseType (งานต้น/งานตาม)
  - N follow-up: claim + invoice_value, work_type = "งานตาม", invoice_mix = page's survey

## พฤติกรรม

### Label เหนือช่องเลขเคลม / เลขเซอร์เวย์

| สถานการณ์ | label + สี |
|---|---|
| ยังโหลดหน้าไม่เสร็จ | "เลขเคลม" / "เลขเซอร์เวย์" — เทา "รอข้อมูล..." |
| ไม่ซ้ำ | "เลขเคลม" / "เลขเซอร์เวย์" — เขียว |
| ซ้ำ (มีแต่ "รอส่ง") | **"เลขเคลม (รอส่ง)"** / **"เลขเซอร์เวย์ (รอส่ง)"** — ส้ม (ยังบันทึกต่อได้) |
| ซ้ำ (มี "ส่งแล้ว") | **"เลขเคลม (ส่งแล้ว)"** / **"เลขเซอร์เวย์ (ส่งแล้ว)"** — แดง (ต้องใช้ SESV/งานรวม หรือแก้ที่ admin) |

### Submit status — แสดงพร้อมกัน 2 จุด
- **แถบสีล่าง panel** (ข้อความ + icon)
- **วงสถานะบน header** (ข้างปุ่ม `—`) — mirror สีเดียวกัน เห็นได้แม้ panel ย่อ

| วง / แถบ | ความหมาย |
|---|---|
| 🔴 "ยังไม่ได้ส่ง" | idle — รอบนี้ยังไม่กดอะไร |
| 🟠 "รอส่งงาน" | หลังกด "บันทึกราคา" (optimistic ทันที; row อยู่ใน DB แบบ `isurvey_sent=0`) |
| 🟢 "ส่งงานแล้ว" | หลังกด "ส่งงานใหม่" (optimistic ทันที; background flip เป็น `isurvey_sent=1`) |

### Panel UI
- **แคบ 170px, ย่อเป็น default** — คลิก header เพื่อขยาย ลากย้ายได้
- **ปุ่ม 🧹 (broom)** บน header — ล้างค่า 29 ช่องฟอร์ม eClaim3 (จำนวน/ราคา/ประกัน/รายละเอียด) ในคลิกเดียว
- **ปุ่ม 📋** ใต้แถบสถานะ — เปิดหน้ารายงาน records.html

## DOM selectors ที่ extension อ่าน

| ข้อมูล | selector |
|---|---|
| เลขเคลม       | `#lblRef_Claim_No` |
| เลขเซอร์เวย์   | `#txtBill_No` |
| ผู้คีย์         | `#wuHeadUser1_lblUser_Name` |
| ประเภทงาน (auto) | `#ddlAdd_No` (=`1` → งานต้น; อื่น → งานตาม) |
| ปุ่ม "บันทึกราคา"  | `#btnSurvey_Update` |
| ปุ่ม "ส่งงานใหม่"  | `#wuFlow1_cmdSendNew` |
| ปุ่ม "ส่งผลงานต่อเนื่อง" | `#wuFlow1_cmdSendFollow` (behavior = "ส่งงานใหม่") |

## Versions

- **0.3.33** — ตรวจจับปุ่ม `#wuFlow1_cmdSendFollow` ("ส่งผลงานต่อเนื่อง") ด้วย พฤติกรรมเหมือน "ส่งงานใหม่" (save + flush iSurvey)
- **0.3.32** — Batch mode UX: ติ๊ก งานรวม/SESV → auto-expand panel + บังคับกรอก invoice ทุกช่อง (block บันทึก/ส่ง ถ้ามีช่องว่าง, กด × ลบช่องที่ไม่ใช้)
- **0.3.31** — Auto-tick SESV เมื่อ `#txtBill_No` ขึ้นต้น "SESV" (เปลี่ยนเคลม / เปลี่ยน sub-form)
- **0.3.30** — Click-only detection: ลบ page-inject.js + SweetAlert observer + `se-page-alert` + `onSuccessDismissed` (−293 บรรทัดใน content.js); submit status เหลือ 🔴/🟠/🟢
- **0.3.29** — `save-many-and-flush` flush **ทุก row ของเคลม** ที่ยัง `sent=0` (แทน session-scoped) + ลบ claim-session sessionStorage; กัน duplicate เมื่อเปิดหลายเครื่องบนเคลมเดียวกัน (server-side short-circuit `skipped_already_sent` บน `sent=1`)
- **0.3.28** — Dup label กระชับ: "เลขเคลม (ส่งแล้ว)" / "เลขเคลม (รอส่ง)" / "เลขเซอร์เวย์ (ส่งแล้ว)" / "เลขเซอร์เวย์ (รอส่ง)"
- **0.3.27** — ปุ่ม 🧹 Clear form บน header — ล้าง 29 ช่อง (จำนวน/ราคา/ประกัน/รายละเอียด) + dispatch input+change
- **0.3.26** — เอาวงสถานะ server ออกจาก panel header (server status เหลือเฉพาะใน popup)
- **0.3.25** — เพิ่ม Submit-status dot บน panel header — mirror สีเดียวกับแถบล่าง เห็นได้แม้ panel ย่อ
- **0.3.24** — Popup เพิ่มวงสถานะ server มุมขวาบน (auto ping `/api/health` ตอนเปิด); panel **ย่อเป็น default**; ตัด opacity ออก
- **0.3.23** — Submit status text กระชับ: "ยังไม่ได้ส่ง", "รอ popup", "รอส่งงาน"; opacity 35%
- **0.3.22** — Width 200→170px; opacity 50% + hover → opacity 1.0
- **0.3.21** — Compact panel: 300→200px + ลด padding/font ทุกจุด
- **0.3.20** — Claim session tracking: "ส่งงานใหม่" ส่ง iSurvey เฉพาะ `(claim, survey)` ที่ user save ในรอบนี้ ไม่เกี่ยวกับ row ค้างเก่า
- **0.3.19** — `save-many-and-flush`: flush pending iSurvey ทั้ง claim (ถูกแทนที่ใน 0.3.20 ด้วย session-scoped)
- **0.3.18** — `save-and-send` op ใน background: save + send-isurvey คู่กันใน background → reliable ข้าม content-script teardown
- **0.3.17** — popup เพิ่มปุ่ม "📋 ดูรายงาน" เปิด records.html
- **0.3.16** — Batch flow ฟิกซ์: งานรวม/SESV สร้าง N+1 row ในคลิกเดียว (primary + N follow-up)
- **0.3.15** — Fire-on-click: save ยิงทันทีที่คลิกปุ่ม eClaim3 ผ่าน background — ไม่รอ alert/swal confirmation (reliable ข้าม ASP.NET postback)
- **0.3.14** — sessionStorage tracking: persist click + alert/swal events ข้าม page reload
- **0.3.13** — dup logic ผ่อน: allow บันทึก/ส่ง เมื่อมีแค่ dup "รอส่ง" (block เฉพาะมี "ส่งแล้ว")
- **0.3.12** — Submit status 🟠 "บันทึกแล้ว รอส่งงาน" / 🟢 "ส่งงานแล้ว"
- **0.3.x earlier** — sessionStorage persist ข้าม ASP.NET postback reloads
- **0.2.8** — Web-submit gate: panel auto-save หลัง user คลิก submit ของ eClaim3 + popup success
- **0.2.x** — UI เต็ม, batch งานรวม/SESV, popup settings, background proxy, ปรับ column mapping
- **0.1.0** — prototype อ่าน DOM + floating panel
