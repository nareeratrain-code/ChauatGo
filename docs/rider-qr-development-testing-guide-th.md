# คู่มือ Development และการทดสอบ Rider QR Payment Flow

เอกสารนี้ใช้ทดสอบฟีเจอร์ QR รับเงินของไรเดอร์โดยไม่แตะข้อมูล Firebase Production โดยใช้ Firebase Emulator Suite และหน้าเว็บจาก Local Development Server

## 1. สิ่งที่ต้องติดตั้ง

- Node.js 20 ขึ้นไป แนะนำ Node.js 22 ให้ตรงกับ Firebase Functions
- Java Runtime สำหรับ Firestore Emulator
- Android Studio/ADB หากต้องการทดสอบบนโทรศัพท์ Android ผ่าน USB
- Git และ Firebase CLI ใช้งานผ่าน `npx firebase-tools` ได้ ไม่จำเป็นต้องติดตั้ง Global

ตรวจเวอร์ชัน:

```bash
node --version
npm --version
java -version
adb version              # เฉพาะ Android
```

## 2. ติดตั้ง Dependencies

รันจากโฟลเดอร์โปรเจกต์:

```bash
npm install
npm install --prefix functions
```

ไม่ต้องใช้ `firebase login` เพื่อรัน Emulator แต่ต้องใช้สิทธิ์ Firebase หากจะ Deploy Production

## 3. รัน Test แบบไม่เปิดเว็บ

ใช้สำหรับตรวจ Logic ของข้อความและ QR Payload อย่างรวดเร็ว:

```bash
npm run test:rider-qr
```

ผลที่ต้องได้:

```text
4 tests
4 pass
0 fail
```

รัน Root Tests ทั้งหมด:

```bash
node --test tests/*.test.js
```

ในชุดปัจจุบันควรผ่านทั้งหมด รวม Test QR ด้วย

## 4. ทดสอบ Storage Rules ด้วย Emulator

คำสั่งนี้จะเปิด Firestore/Storage Emulator ชั่วคราว, รัน Rules Test แล้วปิดเอง:

```bash
npm run test:storage:emu
```

หรือใช้คำสั่งเต็ม:

```bash
npx firebase-tools emulators:exec \
  --only firestore,storage \
  --project chauat-go-b9841 \
  "npm run test:storage --prefix functions"
```

ห้ามใช้ `firebase deploy` ในขั้นตอนนี้ เพราะ Emulator ไม่กระทบ Production

## 5. เปิด Emulator สำหรับทดสอบหน้าเว็บจริง

เปิด Terminal ที่ 1:

```bash
npm run dev:emulators
```

พอร์ตตาม `firebase.json`:

| Service | Port |
|---|---:|
| Auth Emulator | 9099 |
| Firestore Emulator | 8080 |
| Storage Emulator | 9199 |
| Functions Emulator | 5001 |

เปิด Terminal ที่ 2 แล้วรัน Static Server:

```bash
python3 -m http.server 4173 --bind 127.0.0.1
```

เปิดหน้าไรเดอร์ด้วย URL นี้:

```text
http://127.0.0.1:4173/rider.html?emulator=1
```

เมื่อเปิดด้วย `emulator=1` บน Local/Private Network เท่านั้น หน้าไรเดอร์จะเชื่อมต่อไปยัง Auth, Firestore และ Storage Emulator แทน Production และจะไม่เริ่ม App Check Production

ห้ามใช้ `?emulator=1` บน `https://chauatgo.vercel.app` หรือโดเมนสาธารณะ

## 6. สร้างบัญชีไรเดอร์ใน Auth Emulator

เปิด Auth Emulator UI หากต้องการดูข้อมูลแบบภาพรวม หรือใช้ Firebase Emulator REST/CLI ตามที่ทีมกำหนด โดยบัญชีทดสอบควรมี UID เช่น:

```text
rider-dev-001
```

สร้างเอกสาร Firestore Emulator ที่:

```text
riders/rider-dev-001
```

ตัวอย่างข้อมูลขั้นต่ำ:

```json
{
  "name": "ไรเดอร์ทดสอบ",
  "phone": "0800000000",
  "verified": true,
  "status": "active",
  "riderId": "rider-dev-001"
}
```

หากทดสอบการอัปโหลด QR ให้สร้างบัญชี Auth ด้วย UID เดียวกันกับเอกสาร `riders` เพื่อให้ Storage Rule `isRiderAccount()` อนุญาต

## 7. ทดสอบบน Android จริงผ่าน USB

เชื่อมต่อโทรศัพท์ เปิด Developer Options และ USB Debugging จากนั้นตรวจพบอุปกรณ์:

```bash
adb devices
```

เปิด Port Forward เพื่อให้ Chrome บนโทรศัพท์เห็นบริการในเครื่องพัฒนาเป็น `127.0.0.1`:

```bash
adb reverse tcp:4173 tcp:4173
adb reverse tcp:9099 tcp:9099
adb reverse tcp:8080 tcp:8080
adb reverse tcp:9199 tcp:9199
adb reverse tcp:5001 tcp:5001
```

เปิด Chrome บนโทรศัพท์ไปที่:

```text
http://127.0.0.1:4173/rider.html?emulator=1
```

จากนั้นทดสอบตามลำดับ:

1. เข้าสู่ระบบด้วยบัญชีทดสอบ
2. เปิดเมนู **ข้อมูลส่วนตัว & QR รับเงิน**
3. แนบภาพ QR ทดสอบ
4. ตรวจว่าไฟล์ถูกบันทึกไปที่ `rider_qr/{uid}/payment-qr.jpg` ใน Storage Emulator
5. เปิดออเดอร์อาหารแบบ `paymentMode: transfer`
6. กด **ถึงร้าน**
7. ตรวจแชทว่ามีข้อความ `shop_arrived_qr` และรูป QR
8. แนบรูปอาหารจากกล้องหรือคลังภาพ
9. ตรวจแชทว่ามีข้อความ `food_payment_qr` พร้อมยอดรวมถูกต้อง
10. ทดสอบกดซ้ำเพื่อยืนยันว่าไม่สร้างข้อความซ้ำ

## 8. ข้อมูลทดสอบที่ควรใช้

ตัวอย่างออเดอร์:

```json
{
  "id": "OD-DEV-001",
  "type": "food",
  "paymentMode": "transfer",
  "status": "ready",
  "foodTotal": 105,
  "fare": 20,
  "userId": "customer-dev-001",
  "riderId": "rider-dev-001",
  "merchantName": "ร้านทดสอบ"
}
```

ผลที่คาดหวังหลังส่งรูปอาหาร:

```text
ค่าอาหาร ฿105 + ค่าส่ง ฿20 = รวม ฿125
```

พร้อม `imageUrl` ที่ชี้ไปยัง QR ของไรเดอร์

## 9. กรณี Edge Cases ที่ต้องตรวจ

- ไม่มี QR: ระบบแสดงคำเตือน แต่ยังเปิดขั้นตอนถ่ายรูปอาหารได้
- ออเดอร์เงินสด: ต้องไม่ส่งข้อความขอให้ลูกค้าโอนและไม่แนบ QR
- ออเดอร์ส่งด่วนหรือฝากซื้อ: ต้องไม่ใช้ QR Flow ของอาหาร
- ไรเดอร์คนอื่นพยายามอัปโหลดในโฟลเดอร์ของเรา: ต้องถูกปฏิเสธ
- ลูกค้าพยายามอัปโหลดหรืออ่านไฟล์ QR ของไรเดอร์โดยตรง: ต้องถูกปฏิเสธตาม Storage Rules
- กดถึงร้านซ้ำ: ต้องไม่สร้างข้อความซ้ำ
- ส่งรูปอาหารซ้ำ: ต้องไม่สร้างข้อความ `food_payment_qr` ซ้ำ
- รีเฟรชหน้าแล้วเปิดแชทใหม่: ต้องยังเห็น QR URL จากข้อความเดิม

## 10. ตรวจสอบว่าไม่ได้แตะ Production

ก่อนทดสอบต้องเห็นข้อความใน Console คล้าย:

```text
[ChauatGo DEV] Rider connected to Firebase Emulators at 127.0.0.1
```

และตรวจว่า URL เป็น `127.0.0.1` หรือ Private IP พร้อม `emulator=1` เท่านั้น

หาก URL เป็น `chauatgo.vercel.app` หรือ Firebase Production ให้หยุดทดสอบทันที และลบ Query String ออกจาก URL

## 11. คำสั่งสรุปสำหรับ QA

```bash
# Terminal 1
npm run dev:emulators

# Terminal 2
python3 -m http.server 4173 --bind 127.0.0.1

# Terminal 3
npm run test:rider-qr
npm run test:storage:emu
```

หลังทดสอบเสร็จ กด `Ctrl+C` ที่ Terminal Emulator และ Static Server เพื่อหยุดบริการทั้งหมด
