# รายงานตรวจความพร้อม ChauatGo Admin ก่อน Production

วันที่ตรวจ: 10 พฤศจิกายน 2026

## สรุปผล

สถานะปัจจุบัน: **ยังไม่ควร Deploy ชุดปรับปรุง Admin ขึ้น Production** จนกว่าจะปิดประเด็นการเงินและการแจ้งเตือนระดับ Critical/High ด้านล่าง โดยเฉพาะการป้องกันการโอนเงินซ้ำและการคำนวณยอด GP ที่ต้องจ่ายจริง

## ประเด็น Critical

### 1. การโอน GP ให้ไรเดอร์มีความเสี่ยงโอนซ้ำ

หน้า `admin.js` คำนวณยอดจากออเดอร์ `done/delivered` ทั้งหมด แต่ไม่ได้กรอง `riderPayoutPaid !== true` ก่อนคำนวณยอดรอบใหม่ หลังบันทึก `rider_payouts` แล้วจึงค่อย mark ออเดอร์ทั้งหมดเป็น `riderPayoutPaid: true` หากกดซ้ำหรือเกิดการทำงานซ้ำก่อน listener อัปเดต อาจสร้าง payout ซ้ำได้

แนวทางแก้: ย้ายการคำนวณและการบันทึก payout ไป Cloud Function/transaction, ใช้ payout รอบที่มี idempotency key, กรองเฉพาะรายการที่ยังไม่จ่าย และล็อกออเดอร์ด้วย transaction ก่อนสร้างรายการโอน

### 2. Badge ยอดโอนยังเป็นค่าเท็จ

ฟังก์ชัน `getBadgeCounts()` กำหนด `pendingPayouts = 0` พร้อม TODO และ Admin ไม่ได้ subscribe `rider_payouts` ทำให้ผู้ดูแลอาจไม่เห็นรายการที่ต้องดำเนินการจริง

แนวทางแก้: เพิ่ม query/listener ของ payout ที่มีสถานะ `pending/processing/paid/failed`, แสดง badge จริง และมี filter ตามรอบ/สถานะ

### 3. GP ร้านค้าถูก reset เร็วเกินไป

Cloud Function `onGpTransferCreated` ตั้ง `merchants/{merchantId}.gpPending = 0` ทันทีที่ร้านสร้างเอกสาร `gp_transfers` ซึ่งเอกสารยังมีสถานะ `pending` และยังไม่ได้ตรวจสลิปโดย Admin หากสลิปผิดหรือถูกปฏิเสธ ยอดค้างของร้านอาจหายจากหน้าสรุป

แนวทางแก้: ห้ามลด/เคลียร์ `gpPending` ตอนสร้างคำขอ ให้เคลียร์เฉพาะ transition `pending -> verified` ใน server-side transaction และคืนยอด/บันทึกเหตุผลเมื่อ `pending -> rejected`

## ประเด็น High

### 4. การแจ้งเตือนยังไม่ครอบคลุมร้านค้าและการเงิน

Cloud Functions ปัจจุบันมีการแจ้งเตือนลูกค้าและไรเดอร์ในบาง transition แต่ยังไม่พบ flow กลางสำหรับแจ้งร้านค้าเมื่อมีออเดอร์, ร้านรับออเดอร์, ยอดอาหารสรุป, สลิปจากไรเดอร์, GP ถึงกำหนด, หรือ payout ให้ไรเดอร์สำเร็จ/ล้มเหลว

ควรเพิ่ม event กลางที่มี `eventId`, `orderId`, `recipientId`, `recipientRole`, `amount`, `status`, `createdAt` และ deduplication เพื่อให้แจ้งเตือนซ้ำไม่ได้

### 5. การอนุมัติสลิป GP และการลด `gpPending` ไม่เป็น atomic operation

Admin update `gp_transfers` แล้วจึง update merchant แยกอีกครั้ง หากเขียนครั้งที่สองล้มเหลว จะเกิดสถานะสลิปยืนยันแล้วแต่ยอดร้านยังค้าง หรือกลับกัน ควรให้ server transaction เป็นผู้เปลี่ยนสองเอกสารพร้อมกัน และบันทึก audit log

### 6. Admin โหลดข้อมูลแบบจำกัดจำนวนและไม่มี pagination

`admin.js` โหลด merchants/riders/users/chats/gp_transfers อย่างละ 100 รายการ, orders 200 รายการ และ gps riders 200 รายการ โดยไม่มี `orderBy`/pagination ที่ชัดเจน อาจทำให้ Dashboard ไม่เห็นออเดอร์หรือยอดจริงเมื่อข้อมูลเกิน limit

ควรแยก Dashboard เป็น aggregate/query server-side และเพิ่ม pagination สำหรับรายการ พร้อมระบุเวลาที่ข้อมูลอัปเดตล่าสุด

### 7. สิทธิ์ Admin กว้างเกินไปสำหรับงานการเงิน

Rules อนุญาต `isAdmin()` อ่าน/เขียน `rider_payouts` ได้ทั้งหมด และ Admin client ยังเขียน order status, merchant, rider, role และ GP transfer โดยตรง ควรแยกสิทธิ์เป็น `support`, `operations`, `finance`, `super_admin` และให้การเงินทำผ่าน callable Cloud Functions พร้อม audit log และเหตุผลบังคับ

## ประเด็น Medium

### 8. มี Admin UI ซ้ำและเวอร์ชันไม่ตรงกัน

พบชุด `admin.html/admin.js/admin.css` รุ่นใหม่ และ `boss.html` รุ่นเก่า รวมถึงเอกสาร/สคริปต์ Service Worker แยกกัน โดย version ในหน้า, JS และ CSS ไม่สอดคล้องกันทั้งหมด เสี่ยงให้ทีมเปิด URL ผิดหรือแก้ไฟล์หนึ่งแต่ Production ใช้อีกไฟล์

ควรกำหนด canonical entry เป็น `/admin.html`, ลบหรือ redirect `boss.html`, รวม version จาก `version.json` หรือ build metadata เดียว และเพิ่ม smoke test ตรวจ asset/version ให้ตรงกัน

### 9. UI Mobile ยังต้องปรับสำหรับงานเร่งด่วน

หน้าหลักมีการ์ดและเมนูจำนวนมาก แต่ยังขาดแถบ “ต้องทำตอนนี้” ที่รวมออเดอร์ใหม่, สลิปรอตรวจ, GP ร้านค้าง, payout รอจ่าย และ error แจ้งเตือนในจุดเดียว ควรทำ action queue ด้านบน พร้อมสี/สถานะที่ไม่พึ่ง emoji อย่างเดียว, sticky filter และปุ่มสำคัญที่แตะง่าย

### 10. ยังไม่มี Finance Reconciliation

ควรมีรายงานเทียบยอด 4 ฝั่ง: ยอดลูกค้าจ่าย, ยอดร้านค้า, ยอดไรเดอร์, GP แพลตฟอร์ม รวมถึงรายการ mismatch, refund/cancel, cash/transfer และ export CSV พร้อมรอบบัญชี

### 11. Audit Log ยังไม่ครบ

การอนุมัติ/ปฏิเสธสลิป, ยกเลิกงาน, เปลี่ยน role, แก้ร้าน, แก้สถานะ และยืนยัน payout ควรบันทึก actor, action, before, after, reason, orderId/merchantId/riderId, timestamp และ request/event id โดย server-side

## สิ่งที่มีอยู่และควรรักษาไว้

- Firestore Rules แยก `isAdmin`, `isMerchant`, `isVerifiedRider`
- มีการป้องกัน merchant แก้ `gpPending` โดยตรง
- มีการแจ้งเตือน Express ถึงปลายทางและจบงานฝั่งลูกค้า
- มีการตรวจ token FCM ที่เสียและลบ token ที่ใช้ไม่ได้
- มี Dispatch Cloud Functions และ Emulator/Unit Tests ของ flow หลายส่วน

## แผนงานก่อน Production

1. แก้ GP pending transition และ payout idempotency ด้วย Cloud Functions/transactions
2. เพิ่ม pending payout listener และตัดยอดที่จ่ายแล้วออกจากการคำนวณ
3. เพิ่ม merchant/rider financial notifications พร้อม deduplication
4. เพิ่ม finance reconciliation และ audit log
5. รวม Admin ให้เหลือ entry เดียวและอัปเดต responsive UI
6. เพิ่ม Unit, Rules, Emulator และ cross-role tests สำหรับ payment/GP/payout/notification
7. ทดสอบ staging/preview ด้วยข้อมูลจำลองที่ไม่มีเงินจริง
8. Deploy Functions/Rules ก่อน Deploy UI ตามลำดับ dependency
9. ตรวจ Production logs, alerting และ rollback plan หลัง Deploy

## Release Gate

ยังไม่ผ่าน Production Gate จนกว่าจะมีผลทดสอบต่อไปนี้ครบ:

- สร้างคำขอ GP แล้ว `gpPending` ยังไม่หายก่อน Admin อนุมัติ
- อนุมัติสลิปซ้ำ 2 ครั้งไม่ทำให้ยอดลดซ้ำ
- ปฏิเสธสลิปแล้วมียอดค้างและแจ้งร้านถูกต้อง
- กด payout ซ้ำ/เปิดสองแท็บไม่สร้าง payout ซ้ำ
- ร้านค้าและไรเดอร์ได้รับยอดสรุปที่ตรงกับ order ledger
- Push/ข้อความแจ้งเตือนแต่ละ event ส่งเพียงครั้งเดียว
- Rules Emulator ปฏิเสธการแก้ยอดการเงินจาก client ที่ไม่ได้รับอนุญาต
- Full Unit + Functions + Rules Emulator + Mobile Admin Smoke Test ผ่าน

## ข้อสรุป

หน้า Admin ควรได้รับการปรับปรุงทั้ง UX และระบบหลังบ้าน แต่ประเด็นที่ต้องทำก่อนคือ **ความถูกต้องของยอดเงิน, การป้องกันโอนซ้ำ, server-side financial transitions, การแจ้งเตือนร้าน/ไรเดอร์ และ audit/reconciliation** จึงจะพร้อม Production อย่างปลอดภัย รายงานนี้ยังไม่มีการแก้ข้อมูล Production หรือ Deploy ระบบ Admin ใด ๆ
