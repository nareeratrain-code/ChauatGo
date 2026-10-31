# รายงานตรวจระบบก่อนเปิดใช้งานจริง: PR #42

วันที่ตรวจ: 25 ตุลาคม 2026

## ผลสรุป

**สถานะ: NO-GO ชั่วคราว**

ระบบยังไม่ควร Merge/Deploy Firebase เพื่อเปิดใช้งานจริง จนกว่าจะเคลียร์ Root Test Failure 1 รายการใน PR #42

ปัญหาที่พบเป็น Test Assertion ค้าง ไม่ใช่ Failure ของ Flow ออเดอร์โดยตรง แต่ควรแก้ให้ชุดทดสอบเป็นสีเขียวก่อนเปิด Production

## PR ที่ตรวจ

- PR: `#42`
- PR Head: `609001a` — `fix: offer food orders only after the shop accepts`
- ขอบเขต: 10 Commits จาก `main`
- ไฟล์ที่เปลี่ยน: 33 ไฟล์
- การตรวจทั้งหมดทำบน Branch/Worktree ของ PR แยกจาก `main`
- ไม่มีการเขียนหรือแก้ไขออเดอร์ Production ระหว่างการตรวจ

## Blocker ที่พบ

### Root Test: FCM Service Worker Version Mismatch

ไฟล์ `sw.js` ใน PR ใช้:

```text
chauat-app-v3.9.38
```

แต่ `tests/fcm-safe.test.js` ยังคาดหวัง:

```text
chauat-app-v3.9.37
```

ผลคือ Root Test ล้มเหลวที่กรณี:

```text
default FCM worker is real JavaScript and does not take over the page
```

แนวทางแก้ที่ตรงจุดคือปรับ Test Assertion ให้ตรงกับ Cache Version ปัจจุบัน หรือเปลี่ยนเป็นตรวจรูปแบบ Version โดยไม่ผูกกับเลขเวอร์ชันเก่าตายตัว แล้วรัน Root Test ใหม่ให้ผ่านทั้งหมด

> ไม่ควรแก้โดยลดหรือปิด Test เพราะ Cache Version มีผลต่อการบังคับอัปเดต Service Worker ของผู้ใช้เดิม

## ผลการตรวจที่ผ่าน

### Build และ Static Checks

- `npm run build`: ผ่าน
- สร้าง `dist/` สำเร็จและลดขนาด JavaScript ได้ประมาณ 26%
- Syntax Check ของ JavaScript หลักและ Functions: ผ่าน
- HTML Parse Check: ผ่าน
- `git diff --check`: ผ่าน

### Firebase Functions และ Dispatch Emulator

- Functions Unit/Emulator Test: **17 ผ่าน, 0 ล้มเหลว**
- Dispatch Emulator Scenario ผ่าน
- ทดสอบการกันงานอาหารก่อนร้านรับออเดอร์
- ทดสอบการเลือกไรเดอร์และ One-job Lock
- ทดสอบค่าบริการ Food/Ride/Express/Shopping
- ทดสอบ GP หลังหมดช่วง Promotion

### Storage Rules Emulator

- Storage Rules Test: **1 ผ่าน, 0 ล้มเหลว**
- ทดสอบ Upload รูปที่มี MIME type เป็นรูปภาพ
- ทดสอบ Upload รูปที่เป็น `application/octet-stream` แต่ชื่อไฟล์เป็นนามสกุลรูป
- ทดสอบไฟล์ไม่ใช่รูปและไฟล์เกิน 5 MB
- ทดสอบสิทธิ์ Rider/Customer/Merchant/Admin แยกตาม Path
- ทดสอบรูปอาหาร, สลิปไรเดอร์, สลิป Admin, Chat, เมนู และรูปโปรไฟล์ร้าน

### Rider E2E

หลังบังคับให้ Playwright ใช้ WebServer จาก PR โดยตรง:

- Job Filter: **4/4 ผ่าน**
- Negative Job Filter: **4/4 ผ่าน**
- ตรวจ Filter 5 ประเภท: ทั้งหมด, ส่งอาหาร, ส่งด่วน, เรียกรถ, ฝากซื้อ
- ตรวจว่า Active Jobs ไม่ถูก Filter ซ่อน
- ตรวจข้อมูล `null`, Object, String และข้อมูลไม่ครบ
- ตรวจการกด Filter ซ้ำระหว่างโหลดข้อมูลผิดพลาด

หมายเหตุ: การรันรอบแรกให้ผลลวง เพราะมี WebServer จาก `main` ค้างอยู่ที่ Port 4173 ต่อมาหยุด Server เดิมและรันซ้ำจาก PR โดยตรงแล้วผ่าน

## สิ่งที่ตรวจพบว่ามีใน PR

### Partner และร้านทั่วไป

- งานอาหารที่มี `merchantId` ต้องรอร้าน Partner รับก่อนจึงส่งต่อให้ไรเดอร์
- งานที่ไม่ใช่ Kitchen/ร้านทั่วไปยังสามารถเข้าสู่ Flow ส่งงานได้
- ระบบมีสถานะรอร้านและเหตุผลยกเลิกกรณีร้านไม่รับภายใน 1 ชั่วโมง
- มีข้อความเตือนลูกค้าเรื่องร้านนอก Partner และความรับผิดชอบค่าบริการหากร้านปิด

### Food Payment และ Slip

- ไรเดอร์ส่งรูปอาหารแล้วจึงแจ้งยอดอาหารและค่าส่งให้ลูกค้า
- ออเดอร์โอนเงินต้องรอลูกค้าชำระเงิน
- ไรเดอร์ต้องแนบสลิปที่จ่ายร้านก่อนออกจากร้าน
- ระบบไม่ให้เริ่มเดินทางต่อ หากเงื่อนไขสลิป/การชำระเงินยังไม่ครบ
- ออเดอร์เงินสดใช้ Flow ชำระกับไรเดอร์ตามที่กำหนด

### Auto-chat

มี Template แยกตามประเภทบริการ:

- อาหาร
- ส่งด่วน
- ฝากซื้อ
- เรียกรถ

มี Test ตรวจว่าแต่ละประเภทไม่ใช้ข้อความผิดบริการ เช่น งานส่งด่วนไม่ขอเงินค่าอาหาร

### Rider Capacity

- Dashboard แสดงจำนวนงานที่กำลังทำเทียบกับจำนวนที่รับได้จริง เช่น `1/1`
- ไม่ใช้จำนวนข้อเสนอทั้งหมดมาแสดงแทนจำนวนงาน Active
- Server มีการป้องกันรับงานซ้อนด้วย Transaction/Lock

## ข้อสังเกตจาก Emulator Log

ระหว่างทดสอบ Firestore Rules มี Log `PERMISSION_DENIED` บางรายการจากเคสที่ตั้งใจทดสอบการปฏิเสธสิทธิ์ และมีข้อความเกี่ยวกับ expression limit ใน Rules Emulator แต่ชุด Test ผ่านครบ 17/17 จึงยังไม่ถือเป็น Test Failure

ควรเฝ้าดู Rules Evaluation Cost ใน Production หลัง Deploy โดยเฉพาะ Query/Update ที่มีเงื่อนไขหลายชั้น

## สิ่งที่ยังไม่ได้ทำ

- ยังไม่ได้ Merge PR #42
- ยังไม่ได้ Deploy Firebase Production รอบใหม่
- ยังไม่ได้ทดสอบกับข้อมูลออเดอร์จริง Production
- ยังไม่ได้พิสูจน์จากฐานข้อมูลจริงว่าไม่มีออเดอร์เดิมถูกแก้ไข เพราะการตรวจรอบนี้ใช้ Emulator และ Static Review เท่านั้น

## Checklist ก่อน Go

1. แก้ `tests/fcm-safe.test.js` ให้ตรงกับ `sw.js` เวอร์ชัน `v3.9.38`
2. รัน Root Test ทั้งหมดให้ผ่าน 100%
3. รัน Functions/Storage Emulator Test ซ้ำ
4. ตรวจ GitHub PR Checks ให้เป็นสีเขียว
5. Merge PR #42
6. Deploy Firebase Functions, Firestore Rules และ Storage Rules ด้วยคำสั่งเดิม
7. ตรวจ Deployment Result และ Function Logs
8. ทำ Smoke Test จริงแบบไม่สร้างออเดอร์ หรือสร้างออเดอร์ทดสอบแล้วล้างตามขั้นตอนที่อนุมัติ
9. ทดสอบ Upload รูปจากมือถือจริงอย่างน้อย JPEG/PNG และรูปจาก Camera Blob
10. ตรวจ Partner Order, Non-partner Order, Food Payment, Rider Slip และร้านปิด

## คำตัดสินสำหรับทีม

> PR #42 ผ่านการตรวจ Flow หลัก, Functions Emulator, Storage Rules Emulator, Build และ Rider E2E แล้ว แต่ยังไม่ผ่าน Quality Gate เพราะ Root Test มี Assertion ที่ค้างจาก Cache Version เดิม จึงให้สถานะ **NO-GO ชั่วคราว** แก้ Test Version Mismatch และรันชุดทดสอบให้เขียวก่อน Merge/Deploy Firebase
