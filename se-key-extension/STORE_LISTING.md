# Chrome Web Store Listing — eClaim3 Survey Helper

ไฟล์นี้รวม copy + การตั้งค่าทุกฟิลด์ที่ต้อง paste เข้า Chrome Web Store Developer Dashboard ตอน submit

Dashboard: https://chrome.google.com/webstore/devconsole

---

## Distribution

- **Visibility:** Unlisted
- **Distribution countries:** Thailand
- **Pricing:** Free

## Store listing — ภาพรวม

- **Name:** eClaim3 Survey Helper
- **Category:** Productivity
- **Language:** ไทย (Thai — primary)

### Single purpose (ฟิลด์ Single Purpose)

> ช่วยพนักงานคีย์ข้อมูลงานสำรวจจากหน้า eClaim3 ส่งเข้า LAN API server ของบริษัท เพื่อบันทึก/ตรวจซ้ำ/ส่งต่อระบบ iSurvey

### Short description (สูงสุด 132 ตัวอักษร)

> Floating panel บนหน้า eClaim3 — บันทึกเลขเคลม/เซอร์เวย์ ตรวจซ้ำ และส่งต่อ iSurvey ผ่าน LAN server ของบริษัท

### Detailed description

```
ส่วนขยายสำหรับใช้ภายในองค์กร — ช่วยพนักงานคีย์ข้อมูลงานสำรวจจากระบบ eClaim3
ให้เร็วและแม่นยำขึ้น โดยส่งข้อมูลเข้าเซิร์ฟเวอร์ LAN ของบริษัทเพื่อตรวจซ้ำ
เก็บประวัติ และส่งต่อระบบ iSurvey อัตโนมัติ

ฟีเจอร์หลัก
• Floating panel บนหน้า eClaim3 — แสดงเลขเคลม/เลขเซอร์เวย์/ผู้คีย์ พร้อม label
  เตือนเมื่อพบเลขซ้ำ (สีเขียว = ไม่ซ้ำ, สีส้ม = ซ้ำแบบรอส่ง, สีแดง = ซ้ำแบบ
  ส่งแล้ว)
• ปุ่ม "บันทึกราคา" — บันทึกข้อมูลเข้า LAN server (รอส่ง iSurvey)
• ปุ่ม "ส่งงานใหม่" / "ส่งผลงานต่อเนื่อง" — บันทึก + ส่งต่อ iSurvey ในคลิกเดียว
• โหมดงานรวม / SESV — บันทึกหลายเลขเซอร์เวย์ในรอบเดียว (auto-tick SESV เมื่อ
  เลขเซอร์เวย์ขึ้นต้นด้วย "SESV")
• ปุ่ม 🧹 ล้างฟอร์ม — เคลียร์ค่า 29 ช่องในคลิกเดียว
• หน้ารายงานในตัว — ดูรายการที่บันทึก/ส่งแล้วทั้งหมด
• ตัวบ่งชี้สถานะเซิร์ฟเวอร์บน popup — เขียว/แดง/เทา ping อัตโนมัติ

ความเป็นส่วนตัว
ข้อมูลทุกอย่างถูกส่งไปยังเซิร์ฟเวอร์ภายในเครือข่ายของบริษัทเท่านั้น (URL ที่
ผู้ใช้กำหนดเอง) ไม่มีการส่งไปยัง Google, third-party, หรือ cloud ใดๆ
ไม่มี telemetry / analytics / tracking ใดๆ ทั้งสิ้น

การติดตั้ง
หลังติดตั้ง กดไอคอนส่วนขยาย → กรอก LAN server URL + API key ที่แอดมินของบริษัท
แจ้ง → กด "ทดสอบ" → กด "บันทึก" → เปิดหน้า eClaim3 ได้เลย
```

### URLs

- **Homepage URL:** _(ใส่ทีหลัง — อาจเป็น GitHub repo หรือหน้า intranet)_
- **Support URL:** mailto:sesurvey.ai@gmail.com
- **Privacy policy URL:** _(host PRIVACY.md ที่ public URL แล้วใส่ตรงนี้)_

---

## Privacy practices

### Data usage disclosure (ติ๊กตามที่เก็บจริง)

| Type of data | Collected? | หมายเหตุ |
|---|---|---|
| Personally identifiable info (ชื่อ/email) | **Yes** | ชื่อผู้คีย์จากหน้า eClaim3 |
| Health info | No | |
| Financial / payment info | **Yes** | ข้อมูลค่างานสำรวจ (จำนวน/ราคา/ประกัน) |
| Authentication info | **Yes** | API key ของ LAN server |
| Personal communications | No | |
| Location | No | |
| Web history | No | |
| User activity (clicks/scrolls) | No | |
| Website content (DOM ที่อ่าน) | **Yes** | DOM ของหน้า eClaim3 |

### ยืนยัน 3 ข้อต่อไปนี้ (บังคับติ๊กทั้งหมด)

- [x] ไม่ขาย/โอนข้อมูลให้ third party (ยกเว้นเพื่อการใช้งานจริงของส่วนขยาย คือส่งเข้า LAN server ของบริษัทผู้ใช้เอง)
- [x] ไม่ใช้/โอนข้อมูลเพื่อวัตถุประสงค์ที่ไม่เกี่ยวกับ single purpose
- [x] ไม่ใช้/โอนข้อมูลเพื่อกำหนด creditworthiness หรือเพื่อ lending purpose

### Permission justifications

ต้องกรอกแยกแต่ละ permission:

**`storage`**
> เก็บ LAN server URL และ API key ที่ผู้ใช้ตั้งค่าเอง เพื่อให้ background service worker ใช้ส่ง request ไปยังเซิร์ฟเวอร์ภายในของบริษัท ไม่มีการ sync ข้าม device

**Host permission `https://eclaim3.blueventuregroup.co.th/*`**
> Content script ต้องอ่าน DOM ของหน้า eClaim3 เพื่อดึงเลขเคลม เลขเซอร์เวย์ และค่าฟอร์มสำรวจ เมื่อผู้ใช้กดปุ่มบันทึก/ส่งงาน นี่คือเว็บไซต์เดียวที่ส่วนขยายแทรก content script

**Optional host permissions `http://*/*`, `https://*/*`**
> ขอเพิ่มเฉพาะตอน runtime หลังผู้ใช้กรอก LAN server URL ใน popup และกด allow เพื่อให้ background service worker ยิง fetch ไปยังเซิร์ฟเวอร์ภายในของบริษัทที่ผู้ใช้กำหนด ขอแบบกว้างเพราะผู้ใช้แต่ละบริษัท/แต่ละสภาพแวดล้อมตั้งค่า IP ภายในต่างกัน (เช่น 192.168.x.x หรือ 10.x.x.x)

**Remote code:** ส่วนขยายไม่โหลด/run remote code ใดๆ — ทุก JS/CSS bundle อยู่ใน package

---

## Graphics ที่ต้องแนบ

| ประเภท | ขนาด | สถานะ |
|---|---|---|
| Store icon | 128×128 PNG | มีแล้ว: `icons/icon128.png` |
| Screenshots | 1280×800 หรือ 640×400 PNG, ≥1 รูป | **ยังต้องถ่าย** |
| Small promo tile (optional) | 440×280 PNG | optional |
| Marquee promo (optional) | 1400×560 PNG | optional |

### Screenshots ที่แนะนำให้ถ่าย (3 รูป)

1. **Floating panel ขยาย** — เปิดหน้า eClaim3 จริง, expand panel, ให้เห็น label สี + ปุ่ม 🧹 / 📋 / submit-status dot
2. **Popup settings** — เห็น LAN URL + API key + วงสถานะ server สีเขียว + ปุ่มทดสอบ/บันทึก/ดูรายงาน
3. **หน้ารายงาน (records.html)** — เห็นรายการที่ส่งไปแล้ว + filter + status

---

## Submission checklist

- [ ] manifest.json bump เป็น `0.4.0` แล้ว
- [ ] ทดสอบ unpacked load → permission request flow ทำงาน → fetch LAN ปกติ
- [ ] Privacy policy host ที่ public URL แล้ว
- [ ] Screenshots ถ่ายครบ (≥1 รูป)
- [ ] Build ZIP — Windows: `powershell -ExecutionPolicy Bypass -File build-extension-zip.ps1` / Mac: `bash build-extension-zip.sh`
- [ ] Upload ZIP, paste copy จากไฟล์นี้, set Visibility = Unlisted, Submit for review
