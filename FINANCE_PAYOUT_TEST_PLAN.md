# Test Plan: ตรวจยอดโอนไรเดอร์และร้านค้าก่อน Production

## 1. วัตถุประสงค์

ยืนยันว่าการคำนวณค่าบริการ, GP แพลตฟอร์ม, GP ร้านค้า, ส่วนแบ่งไรเดอร์ และยอดที่ Admin ต้องโอนถูกต้อง ไม่รวมงานยกเลิก ไม่รวมรายการที่จ่ายแล้ว และไม่สร้าง payout ซ้ำเมื่อกดซ้ำหรือเปิดหลายแท็บ

การทดสอบนี้ใช้ข้อมูลจำลองเท่านั้น ไม่อ่านหรือเขียน Firebase Production

## 2. สูตรอ้างอิงจากโค้ดปัจจุบัน

- ไรเดอร์ได้รับจากค่าบริการ: `fare × 80%`
- GP แพลตฟอร์มจากค่าบริการ: `fare × 20%`
- GP ร้านค้า: `foodTotal × 3%`
- ส่วนแบ่ง GP อาหารให้ไรเดอร์: `foodTotal × 2%`
- ส่วนแบ่ง GP อาหารให้แพลตฟอร์ม: `foodTotal × 1%`
- งานเงินสด: ถ้าไม่มี `cashTip` ให้เพิ่มทิปเงินสด 5 บาทในรายได้ไรเดอร์
- เงินโอนไม่เพิ่มทิปอัตโนมัติ
- งานที่สถานะ `done` หรือ `delivered` เท่านั้นจึงนับเป็นงานสำเร็จ
- งานที่ `riderPayoutPaid=true` ต้องไม่เข้า payout รอบใหม่

## 3. ขอบเขต Test Matrix

| ID | กรณี | ต้องตรวจ |
|---|---|---|
| FIN-01 | Ride เงินโอน | 80/20 ของค่าบริการ, ไม่มี GP อาหาร |
| FIN-02 | Express เงินสด | 80/20 ของค่าบริการและทิป 5 บาท, ชำระหลังส่งถึงปลายทาง |
| FIN-03 | Food เงินโอน | GP ร้าน 3%, ไรเดอร์ 2%, แพลตฟอร์ม 1% |
| FIN-04 | Food เงินสด | เพิ่มทิป 5 บาท, GP และ payout แยกจากเงินสด |
| FIN-05 | งานยกเลิก | ไม่เข้า GP และไม่เข้า payout |
| FIN-06 | งานจ่ายไรเดอร์แล้ว | ไม่เข้า payout รอบใหม่ |
| FIN-07 | ปัดเศษ | ตรวจผลรวมต่อออเดอร์และผลรวมหลายออเดอร์ไม่คลาดเคลื่อน |
| FIN-08 | กดโอนซ้ำ | ต้องได้ payout เดิมเพียงรายการเดียว |
| FIN-09 | เปิดสองแท็บ | transaction/idempotency ต้องกันรายการซ้ำ |
| FIN-10 | สลิป GP ร้าน pending | `gpPending` ต้องไม่ถูกล้างก่อน Admin อนุมัติ |
| FIN-11 | อนุมัติสลิปซ้ำ | ยอดร้านลดครั้งเดียว |
| FIN-12 | ปฏิเสธสลิป | ยอดค้างยังอยู่และมีเหตุผลการปฏิเสธ |

## 4. Expected Result จาก Simulation

ชุดข้อมูลประกอบด้วย Ride 1 งาน, Express 1 งาน, Food 4 งาน (โอน/สด/ยกเลิก/จ่ายแล้ว/ปัดเศษ) และใช้ไรเดอร์ 2 คน ร้านค้า 2 ร้าน

ผลที่ต้องยืนยันจากไฟล์ output:

- `SIM-RIDE-001`: ค่าบริการ 100 → ไรเดอร์ 80, GP แพลตฟอร์ม 20
- `SIM-EXPRESS-001`: ค่าบริการ 150 + ทิปเงินสด 5 → ไรเดอร์ 125, GP แพลตฟอร์ม 30
- `SIM-FOOD-TRANSFER-001`: ค่าบริการ 40, อาหาร 500 → ไรเดอร์ 32, GP ร้าน 15, payout GP ไรเดอร์ 10, GP แพลตฟอร์มรวม 8 + 5
- `SIM-FOOD-CASH-001`: ค่าบริการ 60 + ทิป 5, อาหาร 850 → ไรเดอร์ 53, GP ร้าน 25.50, payout GP ไรเดอร์ 17, GP แพลตฟอร์มรวม 12 + 8.50
- `SIM-CANCELLED-001`: ต้องไม่ถูกนับ
- `SIM-PAID-001`: ต้องไม่ถูกนับในยอด payout ที่ปลอดภัย
- `SIM-ROUNDING-001`: ใช้ตรวจการปัดเศษระดับ 2 ตำแหน่ง

## 5. Current-vs-Safe Test

ต้องรันและเปรียบเทียบ 2 แบบ:

1. **Current Admin behavior**: รวมออเดอร์สำเร็จทุกงานที่มี riderId
2. **Safe expected behavior**: รวมเฉพาะออเดอร์สำเร็จที่ `riderPayoutPaid !== true`

หากยอดสองแบบต่างกัน ต้องถือเป็น defect ก่อน Production เพราะ Current Admin อาจรวมยอดที่โอนไปแล้ว

## 6. Integration Test บน Emulator

สร้าง fixture ใน Firestore Emulator เท่านั้น:

1. สร้าง rider, merchant และ order ตาม FIN-01 ถึง FIN-12
2. จำลองสถานะ order จน `done/delivered`
3. ตรวจฟิลด์ `riderIncome`, `riderOwe`, `gpTotal`, `gpRider`, `gpPlatform`
4. สร้าง `gp_transfers` สถานะ `pending` และตรวจว่า `gpPending` ยังไม่หาย
5. อนุมัติสลิปด้วย server transaction แล้วตรวจว่า `gpPending` ลดเพียงครั้งเดียว
6. เรียก payout ซ้ำ 2 ครั้งพร้อมกัน ต้องมีรายการ payout ที่สำเร็จเพียงรายการเดียว
7. ตรวจ notification/audit event ไม่ซ้ำด้วย `eventId`

## 7. Release Acceptance Criteria

- ทุกกรณี FIN-01 ถึง FIN-12 ผ่าน
- จำนวนเงินปัดเศษตรงกันใน Admin, Rider และ Merchant
- งานยกเลิก/คืนเงินไม่เข้า payout
- งานที่จ่ายแล้วไม่ปรากฏเป็นยอดต้องโอน
- การกดซ้ำไม่สร้างรายการโอนซ้ำ
- GP ร้านไม่ถูกล้างก่อนอนุมัติสลิป
- ทุกการเปลี่ยนยอดการเงินมาจาก Cloud Function/transaction ไม่ใช่ client write โดยตรง
- Rules Emulator ผ่านทั้ง allow และ deny cases
- Full Unit, Functions, Rules Emulator และ Mobile Admin Smoke Test ผ่าน
- มี rollback plan และตรวจ Production Logs หลังปล่อย

## 8. สิ่งที่ยังต้องแก้ก่อนรัน Production Gate

จากการตรวจโค้ดปัจจุบัน พบว่า Admin `payouts()` ยังรวมงานสำเร็จทั้งหมดโดยไม่กรอง `riderPayoutPaid`, `pendingPayouts` ยังเป็น TODO และ `onGpTransferCreated` ล้าง `gpPending` ตอนสร้าง transfer ที่ยัง pending ดังนั้น Test Plan นี้ใช้เพื่อยืนยัน defect และเป็นเกณฑ์ก่อนแก้/Deploy ไม่ใช่การยืนยันว่าระบบ Production พร้อมแล้ว
