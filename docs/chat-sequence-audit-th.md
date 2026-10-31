# รายงานตรวจสอบ Chat Flow เทียบกับ Sequence Diagram

วันที่ตรวจ: 30 ตุลาคม 2026
Repository: `chauatgo`

## สรุปสถานะ

ระบบแชทปัจจุบันรองรับข้อความ รูปอาหาร รูปสลิป และ QR Code ในระดับพื้นฐานแล้ว แต่ยัง **ไม่ตรงกับ Sequence Diagram ใหม่** และยังไม่ควรถือว่า Flow ใหม่เสร็จสมบูรณ์ก่อนแก้รายการระดับสูงด้านล่าง

## ตารางเทียบตามลำดับ Sequence Diagram

| ขั้นตอน | สถานะปัจจุบัน | ไฟล์/จุดอ้างอิง | ระดับ |
|---|---|---|---|
| ไรเดอร์รับงาน | มีข้อความ `accepted` | `rider.js:1646` | ผ่านบางส่วน |
| ส่งสรุปรายการและยอดหลังรับงาน | ยังไม่มีในแชท ข้อความมีเพียงรับงานแล้ว | `AUTO_CHAT_BY_TYPE.food.accepted` | สูง |
| ลูกค้ายืนยันรายการและยอดหลังไรเดอร์รับงาน | ยังไม่มี State/ปุ่ม/ฟิลด์แยก | `index.html:3675` เป็นยืนยันว่าโอนแล้ว | สูง |
| ส่ง QR หลังลูกค้ายืนยัน | ยังไม่มีกลไกยืนยันก่อนส่ง QR | `rider.js:1699-1700` | สูง |
| ส่งข้อความ “โอนหลังเห็นรูปเท่านั้น” | มีข้อความลักษณะเตรียมโอน แต่ส่ง QR ก่อนรูป | `rider.js:1578-1581` | สูง |
| ไรเดอร์ถ่ายรูปอาหาร/สินค้า | Food มี; Shopping/Express ใช้ Combined Flow | `submitFoodPhoto`, `confirmCombinedPickup` | สูง |
| ส่งรูปเข้าแชท | Food ใช้ URL จาก `orders`; Combined ไม่ส่งรูปเข้าแชท | `rider.js:2015-2017`, `2093-2133` | สูง |
| ส่งยอดจริงหลังเห็นรูป | Food มี | `rider.js:2034` | ผ่านบางส่วน |
| ส่ง QR พร้อมยอดจริง | Food มี แต่เป็นคนละข้อความกับรูป/ยอด และอาจเกิด Race | `rider.js:2035` | กลาง/สูง |
| ลูกค้าแนบสลิป | ยังไม่มีฟังก์ชัน Customer Slip Upload | `index.html:4358` เป็นรูปแชททั่วไป | สูง |
| ไรเดอร์เห็นว่าลูกค้าชำระแล้ว | ใช้ `customerPaidAt` จากปุ่มยืนยัน | `rider.js:2237-2258` | ผ่านบางส่วน |
| เปิดเมนูแนบสลิปร้าน | Food มีตามเงื่อนไข | `rider.js:1455-1460` | ผ่าน Food |
| ส่งสลิปร้านเข้าแชท | Food มี แต่ Upload ซ้ำไป `chats/.../images` | `rider.js:2068` | กลาง |
| เปลี่ยนเป็น `on_the_way` หลังแนบสลิป | ยังไม่เปลี่ยน ต้องกด “เริ่มส่ง” แยก | `rider.js:2069-2084` | สูง |
| Shopping/Express มีข้อความสลิปร้าน/รูปครบ | ยังไม่ครบ; Combined ไม่เรียกส่ง Media เข้าแชท | `rider.js:2092-2133` | สูง |
| Customer เห็นรูป/QR ในแชท | Renderer รองรับ `imageUrl` | `index.html:4215-4246` | ผ่านพื้นฐาน |
| กำกับสถานะ/CTA ในแชท | ยังไม่มี; ปุ่มอยู่ Order Card แยกจากแชท | `index.html:4230-4235`, `3675-3688` | กลาง |

## จุดที่ต้องแก้ระดับสูง

### 1. ยังไม่มีข้อความสรุปยอดหลังไรเดอร์รับงาน

`sendAutomatedChat(jobId, 'accepted')` ส่งข้อความทั่วไป เช่น “ไรเดอร์รับงานแล้ว” แต่ไม่ได้ส่ง:

- รายการอาหาร/สินค้า
- ค่าอาหารหรือค่าสินค้า
- ค่าส่ง/ค่าบริการ
- ยอดที่ต้องชำระหรือยอดประมาณการ
- ปุ่มยืนยันรายการและยอด

ข้อความยืนยันออเดอร์ที่มีใน `index.html` เป็นขั้นตอน Checkout ก่อนสร้างออเดอร์ ไม่ใช่ Customer Confirmation หลังไรเดอร์รับงานตาม Diagram

**ข้อเสนอ:** เพิ่ม `order_summary` message และเพิ่มฟิลด์ `customerOrderConfirmedAt`/`customerOrderConfirmed` แยกจาก `customerPaidAt`

### 2. QR ถูกส่งก่อนถึงเงื่อนไขตาม Diagram

ใน `arrivedAtShop()` มีการเรียก:

```js
sendRiderQrPaymentChat(jobId, 'shop_arrived')
```

ทันทีเมื่อไรเดอร์กดถึงร้าน ทำให้ QR ไปถึงลูกค้าก่อนรูปอาหาร/สินค้า และก่อนมี Customer Confirmation หลังไรเดอร์รับงาน

**ข้อเสนอ:**

- ไม่ส่ง `shop_arrived_qr` ในขั้นตอนถึงร้าน
- ส่งข้อความถึงร้านเพียง “กำลังถ่ายรูป”
- ส่ง QR หลัง `customerOrderConfirmed == true`
- คงข้อความ “โอนหลังเห็นรูปเท่านั้น” โดยไม่ใช้เป็นคำขอชำระเงินจริง

### 3. Food Photo, Payment Text และ QR เป็นคนละข้อความ และอาจเรียงผิด

ใน `submitFoodPhoto()` มีลำดับแบบ fire-and-forget:

```js
sendAutomatedChatLater(jobId, 'food_photo');
const qrSent = await sendRiderQrPaymentChat(jobId, 'food_payment');
```

เนื่องจาก `sendAutomatedChatLater()` ไม่ได้ `await` จึงมีโอกาสที่ QR จะถูกเขียนก่อนข้อความ `food_photo` หรือข้อความรูปอาหารจะมาช้ากว่า QR ทำให้ลำดับในแชทไม่แน่นอน

นอกจากนี้ลูกค้าจะได้รับโดยทั่วไป 3 รายการแยกกัน:

1. รูปอาหาร
2. ข้อความแจ้งยอด
3. QR พร้อมข้อความแจ้งโอน

**ข้อเสนอ:** ใช้ฟังก์ชัน Transaction/Sequence เดียว เช่น `sendFoodPaymentBundle()` ที่เขียนข้อความและ Media ตามลำดับเดียวกัน หรือสร้างข้อความ Payment Bundle เดียวที่มี `text + imageUrl + qrImageUrl` หาก Schema รองรับ

### 4. Shopping/Express Combined Flow ไม่ส่งรูปและสลิปเข้าแชทครบ

`confirmCombinedPickup()` อัปโหลดรูปและสลิป แล้วเขียน URL ลง Order แต่ไม่ได้เรียก:

- `postRiderOrderImageUrl()` สำหรับรูปสินค้า/พัสดุ
- `postRiderOrderImage()` สำหรับสลิปร้าน
- `sendAutomatedChatLater(..., 'shop_slip')` สำหรับ Shopping

จึงเกิดกรณี Order มี URL แต่ลูกค้าเปิดแชทแล้วไม่เห็นรูป/สลิปตาม Diagram

**ข้อเสนอ:** แยก Flow อย่างน้อยเป็น:

- Shopping: รูปสินค้า → ลูกค้ายืนยัน/ชำระ → สลิปร้าน → ออกเดินทาง
- Express ที่ไม่มีการซื้อสินค้า: รูปพัสดุถ้าจำเป็น → ออกเดินทาง ไม่ต้องบังคับสลิปร้าน
- Ride: ไม่ควรใช้ Flow รูปสินค้า/สลิปร้าน

### 5. ยังไม่มี Customer Slip Upload แบบ Proof จริง

`index.html:4358` เป็นการส่งรูปแชททั่วไป โดยบันทึกเพียง `imageUrl`/`imagePath` ใน `messages` ไม่มีการบันทึกลง Order เช่น:

- `customerSlipUrl`
- `customerSlipPath`
- `customerSlipUploadedAt`
- `customerPaymentProofStatus`

ดังนั้นปุ่ม `confirmCustomerPaid()` ที่ `index.html:3675` ยังเป็นการแจ้งว่าโอนแล้วด้วยตนเอง ไม่ใช่ “ได้รับสลิปจากลูกค้า”

**ข้อเสนอ:** ถ้าต้องการ Proof จริง ให้แยกปุ่ม “แนบสลิปการโอน” จากแชททั่วไป และให้ Backend/Rules เปลี่ยน `customerPaid` หลังมีไฟล์และข้อมูล Order ครบ

### 6. แนบสลิปร้านแล้วข้อความบอกว่าเริ่มส่งได้ แต่สถานะยังไม่เปลี่ยน

`submitShopSlip()` บันทึก `riderSlipToShop` และส่งข้อความ `shop_slip` แต่ไม่ได้เขียน:

- `status: 'on_the_way'`
- `onTheWayAt`

ผู้ใช้ยังต้องกดปุ่ม `startDelivery()` แยกอีกครั้ง หาก Diagram ต้องการให้แนบสลิปแล้วเปลี่ยนสถานะทันที ควรใช้ Server Callable/Backend Transition แบบ Atomic

### 7. ระบบอัปโหลดสลิปซ้ำสองตำแหน่ง

สลิปถูกอัปโหลดครั้งแรกที่:

```text
slips/riders/{riderUid}/{orderId}_*.jpg
```

จากนั้น `postRiderOrderImage()` อัปโหลด Blob ซ้ำที่:

```text
chats/{orderId}/images/{timestamp}_{uid}.jpg
```

แม้ลูกค้าจะเห็นรูปได้ แต่เพิ่มค่า Storage และทำให้มี Source of Truth สองจุด

**ข้อเสนอ:** ใช้ URL จาก `slips/riders/...` สร้างข้อความในแชทเหมือนที่ Food Photo ใช้ URL จาก `orders/...` หรือให้ Backend สร้างข้อความอ้างอิง URL เดียว

## จุดที่ทำงานได้ดี

- `subscribeChatMessages()` แสดง `imageUrl` และข้อความใน Bubble เดียวกันได้
- Firestore Rules จำกัด Message Keys และตรวจ `senderId`, `senderRole`, `createdAt`
- ผู้ที่อ่านแชทได้ต้องเป็น Order Party หรือสมาชิกของ Chat
- Storage Rules จำกัดการอ่าน/เขียนรูปแชทตาม Order Party
- QR Message มี `automationKey` และมีการป้องกันการส่งซ้ำในระดับ Client
- Food Photo ใช้ URL เดิมจาก `orders/{orderId}` ไปแสดงในแชท ลดการอัปโหลดซ้ำ

## ข้อสังเกตด้านความทนทานของระบบ

### Auto Chat Retry ไม่สมบูรณ์

`sendAutomatedChat()` เพิ่ม Token ใน `autoChatSent` ก่อนเขียน Firestore แต่ใน `catch` ไม่ได้ลบ Token ออก ต่างจาก QR Function ที่ลบ Token เมื่อส่งล้มเหลว หากเกิด Network/Permission Error ครั้งเดียว การ Retry ใน Session เดิมอาจไม่ส่งซ้ำ

ควรทำ:

```js
catch (err) {
  autoChatSent.delete(token);
  ...
}
```

### Client ยังเป็นผู้สร้างข้อความ System/Automated

Rules อนุญาตให้ Rider สร้างข้อความที่มี `systemMessage: true`, `automated: true` และ `automationKey` ได้ แต่ไม่ได้จำกัดค่า `automationKey` ให้เป็นรายการที่ระบบกำหนด หากต้องการความน่าเชื่อถือของ Audit Trail ควรย้ายข้อความสำคัญ เช่น Payment Confirmation, Customer Paid และ On The Way ไปสร้างจาก Cloud Functions/Callable

### Message Idempotency ยังไม่ครบทุกประเภท

Auto Messages ใช้ Document ID เช่น `auto_food_payment_qr` จึงกันซ้ำได้ แต่รูป Food/Shop Slip ใช้ `.add()` ทำให้ Retry อาจสร้างรูปหรือข้อความซ้ำได้ ควรใช้ deterministic ID เช่น:

- `auto_{orderId}_food_photo`
- `auto_{orderId}_shop_slip`
- หรือใช้ `clientEventId` ที่ Rules ตรวจซ้ำ

## ลำดับแก้ไขที่แนะนำ

1. เพิ่ม Order Summary + Customer Confirmation หลังไรเดอร์รับงาน
2. หยุด `shop_arrived_qr` ไม่ให้ QR ถูกส่งก่อนรูป
3. ทำ Payment Bundle ให้ลำดับข้อความ/รูป/QR deterministic
4. เพิ่ม Customer Slip Upload หรือเปลี่ยนข้อความให้ชัดว่าเป็น self-declaration
5. แยก Shopping/Express/Ride ออกจาก Combined Pickup
6. แก้การแนบสลิปร้านให้เปลี่ยน `on_the_way` ตาม Product Decision
7. ลดการอัปโหลดสลิปซ้ำและแก้ Auto Chat Retry
8. เพิ่ม Firestore Rules และ E2E Tests ตรวจลำดับข้อความจริง

## สรุปการอนุมัติ

**สถานะ: ยังไม่ผ่าน Sequence Diagram ใหม่**

Chat Renderer และ Security Rules พื้นฐานผ่าน แต่ Business Sequence ยังขาดขั้นตอนสำคัญ และมีความเสี่ยงด้านลำดับข้อความ/การแสดงหลักฐานการชำระเงิน จึงควรแก้รายการระดับสูงก่อน Merge หรือ Deploy Production
