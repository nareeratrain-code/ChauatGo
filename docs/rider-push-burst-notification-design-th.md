# ChauatGo Rider Push Burst Notification Design

## 1. เป้าหมาย

ออกแบบระบบแจ้งเตือน Push Notification เมื่อมีงานใหม่เข้ามาหลายรายการในเวลาใกล้กัน โดยต้อง:

- แจ้งไรเดอร์เร็วพอสำหรับงานที่มีเวลารับจำกัด
- ไม่ยิง Notification แยกทุกออเดอร์จนเกิดเสียง/การสั่นรัว
- รวมงานหลายรายการเป็นข้อความเดียวที่อ่านง่าย
- ไม่แย่งหน้าที่ของ Firestore Dispatch Offer ซึ่งยังเป็นแหล่งข้อมูลและสิทธิ์รับงานตัวจริง
- ป้องกัน Notification ซ้ำเมื่อ Cloud Function ทำงานซ้ำหรือ Token หลายอุปกรณ์
- รองรับการเปิดแอปค้างอยู่, ทำงานเบื้องหลัง และ PWA บน iPhone
- มีตัวชี้วัดเพื่อตรวจสอบ Push delivery และปัญหา Token

## 2. สถานะระบบปัจจุบัน

จากโค้ดปัจจุบัน:

1. `functions/dispatch.js` สร้าง `dispatchOffers` ให้ไรเดอร์ที่เข้าเกณฑ์
2. หลังสร้าง Offer ระบบเรียก `notifyRider()` แยกตามไรเดอร์
3. `notifyRider()` ใช้ `sendEachForMulticast()` กับ `fcmTokens` ของไรเดอร์ สูงสุด 20 Token
4. Push ปัจจุบันมีข้อความลักษณะ `มีงานใหม่` ต่อหนึ่งออเดอร์
5. Service Worker `sw.js` ใช้ `offerId` หรือ `orderId` เป็น Notification tag
6. หน้าจอไรเดอร์มี `enableRiderPush()` สำหรับขอสิทธิ์และเก็บ FCM Token
7. การรับงานจริงยังอาศัย Firestore Offer และการกดรับผ่าน Callable ไม่ควรเปลี่ยนให้ Push เป็นแหล่งข้อมูลหลัก

### ปัญหาเมื่อมีงานเข้าพร้อมกัน

หากมีงาน 20 รายการเข้าพร้อมกันและไรเดอร์ 10 คนอยู่ในรัศมี ระบบอาจพยายามส่งประมาณ 200 การแจ้งเตือนแยกกัน ทำให้:

- โทรศัพท์สั่น/ส่งเสียงต่อเนื่อง
- ผู้ใช้เห็นข้อความซ้ำจนแยกความสำคัญไม่ได้
- FCM request และ Cloud Function ทำงานเพิ่มโดยไม่จำเป็น
- Notification บน Service Worker อาจกองเป็นหลายใบ แม้เป็นงานประเภทเดียวกัน
- การ retry หรือ Event ซ้ำอาจทำให้ไรเดอร์ได้รับข้อความซ้ำ

## 3. แนวทางที่แนะนำ

ใช้รูปแบบ **Per-rider Notification Aggregator**:

```text
Order Created/Updated
        ↓
Dispatch creates Firestore Offers
        ↓
Create notification intent for each eligible rider
        ↓
Per-rider debounce queue (2–3 seconds)
        ↓
Read still-valid offers and remove expired/taken jobs
        ↓
Build one summary notification
        ↓
Send FCM to that rider's active tokens
        ↓
Service Worker shows one replaceable notification
```

หลักการสำคัญคือ **Offer เป็น source of truth, Push เป็นเพียงสัญญาณเรียกความสนใจ** หาก Push ล่าช้าหรือส่งไม่สำเร็จ ไรเดอร์ยังเห็นงานจาก Firestore เมื่อเปิดหน้าจอและ Subscribe รายการงาน

## 4. Notification Policy

### 4.1 Debounce

- เมื่อมีงานแรกเข้าคิว ให้ตั้ง `flushAt = now + 2 วินาที`
- งานอื่นของไรเดอร์คนเดิมที่เข้ามาก่อนถึง `flushAt` จะถูกรวมชุดเดียวกัน
- ห้ามเลื่อน `flushAt` ออกไปเรื่อย ๆ เมื่อมีงานใหม่เข้ามา เพื่อป้องกัน starvation
- งานที่ Offer ใกล้หมดอายุไม่ควรรอ batch นานเกินไป; ค่าเริ่มต้นที่แนะนำคือ 2 วินาที

### 4.2 Rate limit ต่อไรเดอร์

ค่าเริ่มต้นที่แนะนำ:

| กฎ | ค่าเริ่มต้น |
|---|---:|
| Notification ปกติ | ไม่เกิน 1 ครั้งต่อ 5 วินาที |
| สูงสุด | ไม่เกิน 12 ครั้งต่อนาทีต่อไรเดอร์ |
| จำนวนงานในข้อความ | แสดงจำนวนรวม + ตัวอย่างสูงสุด 3 งาน |
| อายุข้อมูลใน Queue | 30–60 วินาที แล้วตรวจ Offer ใหม่ก่อนส่ง |

Rate limit มีไว้ลด Noise ไม่ใช่ลดสิทธิ์รับงาน เพราะหน้าแอปยัง Subscribe งานจาก Firestore อยู่

### 4.3 ลำดับความสำคัญ

- `urgent`: Offer ใกล้หมดอายุหรือมีงานที่ถูก Assign โดยตรง — ส่งทันทีหรือใช้ batch window สั้น 0–1 วินาที
- `normal`: งานใหม่ทั่วไป — รวมใน window 2 วินาที
- `info`: ข่าวสารหรือประกาศ — ไม่ควรใช้ช่องเดียวกับงานรับส่ง

ไม่ควรใช้ Push เพื่อบอกว่า “งานนี้ยังว่างแน่นอน” โดยไม่ตรวจสถานะ Offer ล่าสุดก่อนเปิดรายละเอียด

## 5. Firestore Data Model

### 5.1 `rider_notification_batches/{riderId}`

ใช้เอกสารเดียวต่อไรเดอร์เพื่อรวมงาน ลดจำนวน Document:

```js
{
  riderId: "rider-123",
  pendingOrderIds: ["order-a", "order-b"],
  pendingOfferIds: ["offer-a", "offer-b"],
  categoryCounts: {
    food: 3,
    express: 2,
    shopping: 1
  },
  firstQueuedAt: Timestamp,
  latestQueuedAt: Timestamp,
  flushAt: Timestamp,
  lastSentAt: Timestamp | null,
  sendCountThisMinute: 4,
  windowKey: "2026-10-23T10:55",
  version: 7,
  state: "queued" // queued | processing | sent | suppressed
}
```

ข้อเสนอแนะ:

- จำกัด Array ไม่เกิน 50 IDs ต่อ batch เพื่อไม่ให้ Document โตเกินจำเป็น
- ใช้ `arrayUnion` หรือ Transaction เพื่อรวม ID แบบ idempotent
- ถ้างานเกิน 50 รายการ ให้เก็บ `overflowCount` และให้หน้าไรเดอร์อ่านงานจริงจาก Firestore
- ไม่เก็บที่อยู่ลูกค้าหรือข้อมูลส่วนบุคคลไว้ใน Notification Batch โดยไม่จำเป็น

### 5.2 `rider_notification_events/{eventId}` (แนะนำสำหรับ Observability)

```js
{
  riderId: "rider-123",
  batchId: "rider-123_20261023_1055_07",
  orderCount: 6,
  validOrderCount: 5,
  tokenCount: 2,
  successCount: 2,
  failureCount: 0,
  suppressed: false,
  reason: null,
  createdAt: Timestamp,
  sentAt: Timestamp
}
```

เก็บเฉพาะ Metadata ที่จำเป็น ไม่เก็บข้อความส่วนตัวหรือ Token แบบ plaintext ใน Event Log

## 6. Backend Flow

### 6.1 เปลี่ยนจากส่งตรงเป็น Queue Intent

ใน `broadcastOrder()` หลังสร้าง `dispatchOffers` สำเร็จ:

```js
await Promise.all(
  riderIds.map((riderId) => enqueueRiderPush(db, riderId, {
    orderId,
    offerId: riderId,
    type: 'dispatch_offer',
    priority: 'normal'
  }))
);
```

`enqueueRiderPush()` ต้อง:

1. เปิด Transaction ที่ `rider_notification_batches/{riderId}`
2. ตรวจว่า `orderId + offerId` อยู่ใน Queue แล้วหรือยัง
3. ถ้ายังไม่มี ให้เพิ่ม ID และเพิ่ม Category Count
4. ตั้ง `flushAt` เฉพาะตอนที่ไม่มี Queue ที่รออยู่
5. ไม่ส่ง FCM ภายใน Transaction

### 6.2 Worker สำหรับ Flush

เลือกหนึ่งแนวทางตามระดับความพร้อม:

**ระยะเริ่มต้น:** Scheduled Function ทุก 10 วินาที ค้นหา Batch ที่ `state == queued` และ `flushAt <= now`
**ระยะ Production ที่ต้องการความไว:** ใช้ Cloud Tasks ตั้งเวลาทำงานราย Batch ประมาณ 2 วินาทีหลัง Event แรก
**ไม่แนะนำ:** ใช้ `setTimeout()` ใน Firestore Trigger เพื่อรอหลายวินาที เพราะเสี่ยง timeout, retry และงานซ้ำเมื่อ Instance ถูกหยุด

Worker ต้องทำตามลำดับ:

1. Claim Batch ด้วย Transaction เปลี่ยน `queued → processing`
2. อ่าน `dispatchOffers` และ `orders` ของ IDs ใน Batch
3. ตัดรายการที่สถานะไม่ใช่ `pending`, หมดอายุ, ถูกกดรับ หรือถูกยกเลิก
4. อ่าน `riders/{riderId}.fcmTokens`
5. ตรวจ Rate Limit
6. สร้างข้อความสรุป
7. เรียก FCM แบบ Multicast
8. ลบ Invalid Token ด้วย `arrayRemove`
9. เขียน Event Log
10. เปลี่ยน Batch เป็น `sent` หรือสร้าง Queue รอบถัดไปถ้ามีรายการใหม่เข้าระหว่างประมวลผล

## 7. รูปแบบข้อความ Push

### งานชุดเดียว

```text
หัวข้อ: มีงานใหม่
ข้อความ: งานส่งอาหาร 1 งาน • แตะเพื่อดูรายละเอียด
```

### หลายงานประเภทเดียว

```text
หัวข้อ: มีงานใหม่ 5 งาน
ข้อความ: ส่งอาหาร 5 งาน • แตะเพื่อเปิดหน้ารับงาน
```

### หลายประเภท

```text
หัวข้อ: มีงานใหม่ 6 งาน
ข้อความ: อาหาร 3 • ส่งด่วน 2 • ฝากซื้อ 1 • แตะเพื่อดูงาน
```

Payload ตัวอย่าง:

```js
{
  notification: {
    title: 'มีงานใหม่ 6 งาน',
    body: 'อาหาร 3 • ส่งด่วน 2 • ฝากซื้อ 1 • แตะเพื่อดูงาน'
  },
  data: {
    type: 'rider_job_batch',
    batchId: 'rider-123_20261023_1055_07',
    orderCount: '6',
    orderIds: 'order-a,order-b,order-c',
    priority: 'normal',
    link: '/rider.html?push=batch'
  }
}
```

ไม่ควรใส่ชื่อ/เบอร์โทร/ที่อยู่ลูกค้าลงในข้อความ Push เพราะ Notification อาจแสดงบน Lock Screen

## 8. Service Worker และ Foreground Behaviour

### 8.1 Background

ปัจจุบัน `sw.js` ใช้ `offerId` หรือ `orderId` เป็น `tag` ซึ่งทำให้แต่ละออเดอร์มี Notification ของตัวเอง ควรเปลี่ยนเป็น:

```js
const tag = data.type === 'rider_job_batch'
  ? 'rider-job-batch'
  : (data.offerId || data.orderId || 'chauat-push');

self.registration.showNotification(title, {
  body,
  icon: '/icons/icon-512.png',
  tag,
  renotify: true,
  data,
  actions: [{ action: 'open-jobs', title: 'เปิดดูงาน' }]
});
```

`tag: rider-job-batch` ทำให้ Notification ใบเดิมถูกแทนที่ด้วยยอดล่าสุด แทนการกองหลายใบ

### 8.2 Foreground

เพิ่ม `onMessage` ใน `rider.js`:

- เมื่อหน้าไรเดอร์เปิดอยู่ ให้ไม่สร้าง OS Notification ซ้ำ
- เรียก `renderJobs()` หรือแสดง Inline Banner เช่น `มีงานใหม่ 6 งาน`
- เล่นเสียงไม่เกิน 1 ครั้งต่อ Batch Window
- สั่นตามค่าที่ผู้ใช้เปิดไว้ แต่ไม่สั่นซ้ำทุกออเดอร์
- คลิก Banner แล้วเลื่อนไปยังส่วน `งานใหม่`

## 9. การป้องกันซ้ำและความถูกต้อง

ใช้ Idempotency Key:

```text
{riderId}:{orderId}:{offerId}:{offerCreatedAtMillis}
```

แนวทาง:

- Queue ห้ามเพิ่ม Key เดิมซ้ำ
- Worker ต้อง Claim Batch ก่อนส่ง
- เมื่อ Function ถูก retry ต้องตรวจ `lastSentVersion` หรือ `eventId` ก่อนส่งซ้ำ
- หลังส่งแล้วต้องล้างเฉพาะ IDs ที่ส่งสำเร็จหรือไม่ valid แล้ว ไม่ล้างรายการที่เข้ามาใหม่ระหว่าง Worker ทำงาน
- ก่อนสร้างข้อความต้องอ่าน Offer ล่าสุดเพื่อไม่แจ้งงานที่ถูกคนอื่นรับไปแล้ว
- การกดรับงานยังต้องผ่าน Transaction/Callable เดิม เพื่อป้องกันรับงานซ้ำ

## 10. Token และอุปกรณ์หลายเครื่อง

โครงสร้าง `riders/{riderId}.fcmTokens` ที่มีอยู่แล้วสามารถใช้ต่อได้ แต่ควรเพิ่ม Metadata แยกในอนาคต:

```js
riderDevices/{deviceId} {
  riderId,
  token,
  platform: 'ios' | 'android' | 'web',
  appMode: 'pwa' | 'browser',
  lastSeenAt,
  enabled: true
}
```

ประโยชน์:

- ปิด Push เฉพาะอุปกรณ์ได้
- ตรวจ Token ที่ไม่ได้ใช้นาน
- แยกนโยบาย iOS PWA และ Browser
- ไม่ต้องเก็บ Array ขนาดใหญ่ใน Rider Document

ระยะเริ่มต้นยังใช้ `fcmTokens` ได้ โดยต้องลบ Token ที่ได้ Error `registration-token-not-registered` หรือ `invalid-registration-token` เหมือนระบบปัจจุบัน

## 11. Security และ PDPA

- Queue และ Event Log ให้เขียนได้เฉพาะ Admin SDK/Backend
- Client ห้ามเขียนจำนวนงานหรือสร้าง Notification Batch เอง
- ใช้ข้อมูลขั้นต่ำใน Push Payload
- ไม่ส่งชื่อ เบอร์โทร ที่อยู่ หรือยอดเงินบน Lock Screen
- การเก็บ Token ต้องผูกกับ Consent/Permission ที่ผู้ใช้เปิดจริง
- เมื่อไรเดอร์ถอนสิทธิ์ Push ให้ลบ Token ของอุปกรณ์นั้น
- จำกัดการอ่าน Event Log ให้ไรเดอร์เห็นเฉพาะ Event ของตนเอง และ Admin เห็นตามสิทธิ์

## 12. Monitoring และ KPI

ควรบันทึก Metric ต่อ Batch:

| Metric | ความหมาย |
|---|---|
| `queuedCount` | จำนวนงานที่เข้า Queue |
| `validOrderCount` | จำนวนงานที่ยัง valid ตอนส่ง |
| `sendLatencyMs` | เวลา Queue ถึงการเรียก FCM |
| `successTokenCount` | จำนวน Token ที่ส่งสำเร็จ |
| `invalidTokenCount` | จำนวน Token ที่ต้องลบ |
| `suppressedCount` | จำนวน Batch ที่ถูก Rate Limit/รวมกับรอบก่อน |
| `dedupeCount` | จำนวน Event ซ้ำที่ถูกกันไว้ |
| `openRate` | วัดโดยใช้คลิกเปิดหน้า ไม่ใช่ถือว่า FCM ถึงแล้ว |

ค่าเริ่มต้นสำหรับ Alert:

- `sendLatencyMs` P95 มากกว่า 5 วินาที
- Invalid Token มากกว่า 20% ต่อชั่วโมง
- Queue ค้างเกิน 30 วินาที
- Notification ต่อไรเดอร์เกิน 12 ครั้งต่อนาที
- Function Error หรือ FCM failure ต่อเนื่อง 5 นาที

## 13. แผนพัฒนาเป็นระยะ

### Phase 1 — ลด Notification Storm

- เพิ่ม `rider_notification_batches`
- เพิ่ม Debounce 2–3 วินาที
- รวมข้อความตาม Category
- ใช้ Notification tag เดียวสำหรับงานชุด
- เพิ่ม Unit Test สำหรับ dedupe และ category count

### Phase 2 — Worker และ Reliability

- เปลี่ยน Trigger ส่งตรงเป็น Queue + Worker
- เพิ่ม Claim/Retry/Idempotency
- บันทึก Event Log และลบ Token เสีย
- ทดสอบงาน 100, 1,000 และ 5,000 รายการ

### Phase 3 — UX และ Observability

- เพิ่ม Foreground Banner และเสียงแบบ cooldown
- เพิ่มหน้า Setting สำหรับ `รวมการแจ้งเตือนงาน`
- เพิ่ม Dashboard Metric
- ทดสอบ Firestore listener, Cloud Tasks และ FCM จริงบนอุปกรณ์ Android/iOS PWA

## 14. Acceptance Criteria

ระบบถือว่าพร้อมสำหรับ Pilot เมื่อ:

- งาน 100 รายการที่เข้าภายใน 2 วินาทีไม่ทำให้ไรเดอร์ได้รับ Push เกิน 1–2 ใบต่อ Window
- งานที่ยัง valid ถูกสรุปจำนวนถูกต้องไม่น้อยกว่า 99% ของ Batch
- งานที่ถูกคนอื่นรับหรือหมดอายุแล้วไม่ถูกแสดงเป็นงานพร้อมรับ
- การอัปเดตซ้ำของ Function ไม่ทำให้เกิด Notification ซ้ำอย่างมีนัยสำคัญ
- P95 Queue-to-send ต่ำกว่า 5 วินาทีใน Staging
- Invalid Token ถูกลบอัตโนมัติ
- Firestore Rules ไม่เปิดให้ Client เขียน Queue หรือ Event Log
- งานรับจริงยังใช้ Transaction/Callable เดิมและไม่เกิด Double Accept

## 15. ข้อเสนอแนะสุดท้าย

แนะนำให้เริ่มจาก Phase 1 โดยไม่เปลี่ยนกติกาการ Dispatch และไม่เปลี่ยนวิธีรับงานก่อน เพราะช่วยลด Notification Storm ได้เร็วและความเสี่ยงต่ำ จากนั้นจึงย้ายการส่ง Push ไปเป็น Queue/Worker ใน Phase 2 เมื่อมี Metric เพียงพอสำหรับปรับค่า Debounce และ Rate Limit ให้เหมาะกับจำนวนไรเดอร์จริง
