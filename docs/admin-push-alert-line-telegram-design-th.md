# ChauatGo Admin Push Alert ผ่าน LINE OA และ Telegram

## 1. เป้าหมาย

ออกแบบระบบแจ้งเตือน Admin เมื่อระบบ Push/Dispatch มีปัญหาที่ต้องแก้ไข เช่น:

- Queue Push ค้างนานเกินเกณฑ์
- Delivery Rate ต่ำกว่าค่าที่ยอมรับได้
- FCM Failure หรือ Invalid Token เพิ่มสูงผิดปกติ
- Worker Retry หรือ Dead Letter เพิ่มขึ้น
- ระบบกลับมาเป็นปกติแล้วและควรแจ้ง Recovery

ระบบต้องลด Alert Noise, ไม่ส่งข้อความซ้ำ, ไม่เปิดเผยข้อมูลลูกค้า และเชื่อมโยงกลับไปยัง Push Monitor Dashboard ได้

## 2. ข้อเสนอแนะช่องทาง

### ทางเลือก A: Telegram เป็นช่องทางหลัก

เหมาะสำหรับ Alert ภายในทีมเทคนิคและผู้ดูแลระบบ เพราะ:

- ตั้ง Bot และกลุ่ม Admin ได้ง่าย
- ส่งข้อความ Server-to-Server ได้ตรงไปตรงมา
- รองรับ Markdown, Thread และปุ่ม Inline Button
- เหมาะกับข้อความ Incident ที่ต้องการความเร็ว
- ไม่จำเป็นต้องออกแบบ Rich Message ซับซ้อนในระยะแรก

ข้อจำกัด:

- Admin ต้องกด Start Bot หรืออยู่ในกลุ่มที่ Bot เป็นสมาชิก
- ต้องเก็บ `chat_id` ของกลุ่ม/ผู้รับให้ถูกต้อง
- ต้องป้องกัน Bot Token รั่ว

### ทางเลือก B: LINE Official Account เป็นช่องทางหลักหรือสำรอง

เหมาะเมื่อทีมปฏิบัติการใช้ LINE เป็นหลักและต้องการให้แจ้งเตือนเข้าบัญชี LINE โดยตรง

ข้อจำกัดสำคัญ:

- ต้องมี LINE OA และเปิด Messaging API
- ต้องรู้ `userId` ของผู้รับ หรือ `groupId` ของกลุ่มที่ Bot อยู่
- การส่ง Push ไม่ได้ส่งถึงหมายเลขโทรศัพท์โดยตรง
- ผู้ใช้ต้อง Add Friend หรือ Bot ต้องอยู่ในกลุ่มก่อน
- ต้องดูแล Channel Access Token และ Webhook/การเชื่อมบัญชี

### คำแนะนำสำหรับ ChauatGo

เริ่มต้นด้วย:

```text
Primary: Telegram Admin Group
Secondary: LINE OA Admin Group หรือผู้รับสำคัญ
Dashboard: ใช้ดูรายละเอียดและกด Acknowledge/Snooze
```

ไม่ควรส่งข้อมูลส่วนตัวของลูกค้าผ่านทั้งสองช่องทาง

## 3. สถาปัตยกรรมที่แนะนำ

```text
Firestore Queue / Push Metrics
          ↓
Firebase Functions Alert Evaluator
          ↓
Condition + Threshold + Minimum Sample Check
          ↓
Incident State / Deduplication / Cooldown
          ↓
Alert Dispatcher
      ↙             ↘
Telegram Bot       LINE OA Messaging API
          ↓
Admin Chat + Dashboard Link
```

ใช้ **Application-native Firebase Functions** เป็นตัวประเมิน Alert เพราะข้อมูลต้นทางอยู่ใน Firestore และต้องตรวจสอบแบบใกล้ Real-time

ไม่ควรให้ Client Browser ส่ง Alert เอง และไม่ควรใช้ข้อมูลที่ Admin เห็นในหน้าเว็บเป็นแหล่งคำนวณเพียงแหล่งเดียว

## 4. Alert Rules

### 4.1 Queue ค้าง

| Rule ID | เงื่อนไข | ระดับ | การแจ้ง |
|---|---|---|---|
| `QUEUE_OLDEST_30S` | Batch ที่เก่าสุดรอเกิน 30 วินาที | Warning | แจ้งครั้งแรก |
| `QUEUE_OLDEST_60S` | Batch ที่เก่าสุดรอเกิน 60 วินาที | Critical | แจ้งเร่งด่วน |
| `QUEUE_COUNT_HIGH` | Queue ค้างตั้งแต่ 20 Batch ต่อเนื่อง 2 รอบ | Warning | แจ้งเมื่อผ่านเกณฑ์ |
| `QUEUE_PROCESSING_STUCK` | Batch อยู่ `processing` เกิน 15 วินาที | Critical | แจ้งแยก Worker |
| `QUEUE_DEAD_LETTER` | มี Batch เข้า Dead Letter | Critical | แจ้งทันที |

### 4.2 Delivery Rate

คำนวณจากช่วง Rolling Window และต้องมีจำนวนตัวอย่างขั้นต่ำเพื่อป้องกัน False Alarm:

```text
Delivery Rate = FCM Success / (FCM Success + FCM Failure) × 100
```

| Rule ID | เงื่อนไข | ระดับ | การแจ้ง |
|---|---|---|---|
| `DELIVERY_LT_95` | ต่ำกว่า 95% และมี Attempted ≥ 20 ใน 5 นาที | Warning | แจ้งครั้งแรก |
| `DELIVERY_LT_90` | ต่ำกว่า 90% และมี Attempted ≥ 20 ใน 5 นาที | Critical | แจ้งเร่งด่วน |
| `FAILURE_SPIKE` | Failure เพิ่มขึ้นมากกว่า 3 เท่าจาก Baseline 1 ชั่วโมง | Warning | แจ้งเมื่อผิดปกติ |
| `INVALID_TOKEN_SPIKE` | Invalid Token มากกว่า 20% ใน 1 ชั่วโมง | Warning | ตรวจ Token/Service Worker |
| `NO_TOKEN_ONLINE` | มีไรเดอร์ Online แต่ไม่มี Active Token | Info/Warning | รวมแจ้งเป็นรายงาน |

### 4.3 Recovery

แจ้งเมื่อระบบกลับมาปกติ เพื่อให้ Admin ปิด Incident ได้อย่างมั่นใจ:

- Delivery Rate มากกว่าหรือเท่ากับ 98% ต่อเนื่อง 10 นาที
- Queue เก่าสุดต่ำกว่า 10 วินาทีต่อเนื่อง 3 รอบ
- ไม่มี Dead Letter ใหม่อย่างน้อย 15 นาที

ตัวอย่าง:

```text
✅ RECOVERED — Push Delivery กลับมาปกติ
Delivery Rate: 99.1% ในช่วง 10 นาทีล่าสุด
Queue เก่าสุด: 2 วินาที
Incident: PUSH-20261023-1055
```

## 5. Incident State และการกันแจ้งเตือนซ้ำ

### 5.1 Collection `admin_alert_incidents/{fingerprint}`

```js
{
  fingerprint: "delivery_rate:production:asia-southeast1",
  ruleId: "DELIVERY_LT_95",
  environment: "production",
  status: "open", // open | acknowledged | resolved | snoozed
  severity: "warning",
  firstSeenAt: Timestamp,
  lastSeenAt: Timestamp,
  lastNotifiedAt: Timestamp,
  occurrenceCount: 4,
  currentValue: 93.4,
  threshold: 95,
  sampleCount: 86,
  notifiedChannels: ["telegram", "line"],
  acknowledgedBy: null,
  acknowledgedAt: null,
  resolvedAt: null,
  snoozeUntil: null,
  dashboardPath: "/admin.html?section=pushMonitor&incident=..."
}
```

### 5.2 Dedupe และ Cooldown

ค่าเริ่มต้น:

- Alert เดิมไม่ส่งซ้ำภายใน 15 นาที
- ถ้าค่ายังแย่ลงมาก เช่น Delivery Rate ลดจาก 95% เหลือ 90% ให้ Escalate ได้ทันที
- Queue Alert รวมจำนวน Batch เป็นข้อความเดียวทุก 5 นาที
- Alert แต่ละ `ruleId + environment + region` มี Fingerprint แยกกัน
- Recovery ส่งได้ 1 ครั้งต่อ Incident
- Snooze 30 นาที ต้องไม่ลบ Incident State

## 6. รูปแบบข้อความ Telegram

### 6.1 Queue Warning

```text
⚠️ [WARNING] ChauatGo Push Queue ค้าง

Queue เก่าสุด: 37 วินาที
Batch รอส่ง: 14
เกณฑ์: เกิน 30 วินาที
Region: asia-southeast1
Incident: PUSH-20261023-1055

[เปิด Dashboard] [รับทราบ]
```

### 6.2 Delivery Critical

```text
🚨 [CRITICAL] Push Delivery Rate ต่ำ

Delivery Rate: 88.6%
FCM Success: 109
FCM Failure: 14
ตัวอย่างใน 5 นาที: 123
เกณฑ์ Critical: ต่ำกว่า 90%
สาเหตุเด่น: invalid-registration-token

Incident: PUSH-20261023-1055
[เปิด Dashboard] [รับทราบ] [Snooze 30 นาที]
```

### 6.3 Recovery

```text
✅ [RECOVERED] Push System กลับมาปกติ

Delivery Rate: 99.2%
Queue เก่าสุด: 3 วินาที
ไม่มี Dead Letter ใหม่ใน 15 นาที
Incident: PUSH-20261023-1055
```

## 7. รูปแบบข้อความ LINE OA

แนะนำใช้ Flex Message สำหรับเหตุการณ์สำคัญ และ Text Message สำหรับ Warning ที่เกิดบ่อย

### Flex Message ควรมี

- Header สีตามระดับ: เขียว/เหลือง/แดง
- ชื่อระบบและประเภท Alert
- Metric ปัจจุบัน
- Threshold
- เวลา Asia/Bangkok
- Incident ID
- ปุ่ม `เปิด Dashboard`
- ปุ่ม `รับทราบ` หรือ `Snooze`

ไม่ควรใส่:

- ชื่อลูกค้า
- เบอร์โทร
- ที่อยู่
- รายละเอียดอาหาร/สินค้า
- FCM Token เต็ม

## 8. การเชื่อม Action กลับ Dashboard

ปุ่มใน Telegram/LINE ควรเปิด URL ที่มี Incident ID แบบปลอดภัย:

```text
https://chauatgo.vercel.app/admin.html?section=pushMonitor&incident=PUSH-20261023-1055
```

การกด `รับทราบ` หรือ `Snooze` ควรเรียก HTTPS Callable Function ที่ตรวจ:

1. ผู้ใช้ Login แล้ว
2. ผู้ใช้มี Role Admin
3. Incident ยังไม่ถูกปิด
4. Action ไม่หมดอายุ
5. เขียน Audit Log

ห้ามใช้ URL ที่มีสิทธิ์ Admin ฝังอยู่ใน Query String

## 9. Credentials และ Secrets

### Telegram

ต้องมี:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ADMIN_CHAT_IDS`
- Optional: `TELEGRAM_THREAD_ID`

### LINE OA

ต้องมี:

- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_ADMIN_USER_IDS` หรือ `LINE_ADMIN_GROUP_ID`
- Optional: `LINE_CHANNEL_SECRET` สำหรับตรวจ Webhook Signature

เก็บใน Firebase/Google Secret Manager หรือ Environment ของ Functions เท่านั้น ห้ามใส่ใน:

- `admin.js`
- `index.html`
- GitHub
- Firestore Document ที่ Client อ่านได้
- URL ของ Dashboard

## 10. Retry และ Fallback

ลำดับการส่งที่แนะนำ:

```text
สร้าง Incident
   ↓
ส่ง Telegram
   ↓ ถ้าล้มเหลว
Retry Exponential Backoff 1s, 5s, 30s
   ↓ ยังล้มเหลว
ส่ง LINE OA เป็นช่องทางสำรอง
   ↓ ยังล้มเหลว
บันทึก delivery_failure + แสดงใน Dashboard
```

ข้อควรระวัง:

- ไม่ Retry แบบไม่จำกัด
- ไม่ส่งซ้ำข้ามช่องทางจนกลายเป็น Spam
- บันทึกสถานะราย Channel ว่าสำเร็จ/ล้มเหลว
- แยก `alert_evaluation` ออกจาก `channel_delivery`

## 11. Data Model การส่ง Alert

### `admin_alert_deliveries/{deliveryId}`

```js
{
  incidentId: "PUSH-20261023-1055",
  channel: "telegram", // telegram | line
  destinationRef: "ops-group",
  status: "sent", // queued | sent | failed | skipped
  attempt: 1,
  providerMessageId: "masked-or-provider-id",
  errorCode: null,
  sentAt: Timestamp,
  createdAt: Timestamp
}
```

ข้อมูลนี้ช่วยตอบได้ว่า Alert ไม่ถึง Admin เพราะ:

- ไม่เข้าเงื่อนไข
- ถูก Cooldown
- Queue Worker ไม่ทำงาน
- Telegram/LINE Provider ล้มเหลว
- Destination ไม่ถูกต้อง

## 12. การทำงานของ Alert Evaluator

```text
ทุก 10 วินาที หรือเมื่อ Push Metric เปลี่ยน
          ↓
อ่าน Queue Summary + Push Rollup ล่าสุด
          ↓
ประเมินทุก Rule
          ↓
ถ้าไม่ผ่าน: ไม่สร้าง Incident
ถ้าผ่านและยังไม่มี Incident: เปิด Incident + ส่ง Alert
ถ้าผ่านและอยู่ใน Cooldown: อัปเดตค่า ไม่ส่งซ้ำ
ถ้าผ่านและ Severity สูงขึ้น: Escalate ทันที
ถ้ากลับมาปกติ: ปิด Incident + ส่ง Recovery
```

ควรใช้ Scheduled Function ทุก 10–15 วินาที หรือ Event-driven จากการเขียน Metric แล้วมี Debounce ในระบบ สำหรับระยะแรกแนะนำ Scheduled Function ที่ 1 นาทีหากต้องการลดความซับซ้อนและต้นทุน โดยต้องระบุว่าไม่ใช่ Real-time ระดับวินาที

## 13. Dashboard Integration

เพิ่ม Section ใน Push Monitor:

- Alert Status: `Open`, `Acknowledged`, `Snoozed`, `Resolved`
- Channel Delivery: Telegram/LINE สำเร็จหรือไม่
- Last Alert Sent
- Next Retry
- Acknowledged By
- Incident Timeline
- ปุ่มทดสอบส่งข้อความแบบไม่ใช้ข้อมูลจริง

บน Dashboard ต้องมีข้อความชัดเจน:

```text
FCM Success = FCM รับคำขอส่งสำเร็จ
ไม่ใช่หลักฐานว่าไรเดอร์เปิดอ่านหรือเห็น Notification แล้ว
```

## 14. Security และ PDPA

- จำกัดผู้รับเฉพาะ Admin Group หรือ Admin User ที่ยืนยันแล้ว
- ไม่ส่งข้อมูลลูกค้าและข้อมูลสถานที่ส่วนตัว
- Mask Token และ Internal IDs ที่ไม่จำเป็น
- ตรวจ Role ทุกครั้งเมื่อกด Acknowledge/Snooze
- บันทึก Audit Log ทุกการรับทราบ/ปิด Incident
- จำกัดอายุ Incident Detail และกำหนด Retention ตามนโยบายข้อมูล
- หากใช้ LINE Group ต้องตรวจว่า Bot อยู่ในกลุ่มที่ถูกต้องและไม่ส่งไปกลุ่มสาธารณะ
- หากใช้ Telegram ต้องตรวจ Chat ID ปลายทางก่อน Production

## 15. แผนพัฒนา

### Phase 1 — Telegram MVP

- สร้าง Alert Evaluator ใน Firebase Functions
- เพิ่ม Incident State และ Dedupe
- เชื่อม Telegram Bot ไปยัง Admin Group
- รองรับ Queue Stuck, Delivery Rate ต่ำ และ Recovery
- เพิ่มปุ่มเปิด Dashboard

### Phase 2 — Dashboard Actions

- Acknowledge
- Snooze 30 นาที
- Resolve
- Audit Log
- Channel Delivery Status

### Phase 3 — LINE OA และ Fallback

- เพิ่ม LINE OA Messaging API
- เพิ่ม Flex Message
- ตั้ง Telegram เป็น Primary และ LINE เป็น Fallback
- เพิ่มทดสอบ Provider Failure

## 16. Acceptance Criteria

ระบบพร้อมสำหรับ Pilot เมื่อ:

- Queue เกิน 30 วินาทีแล้ว Admin ได้รับ Alert ภายในรอบประเมินถัดไป
- Delivery Rate ต่ำกว่า 95% และมีข้อมูลอย่างน้อย 20 Attempt จึงแจ้งเตือน
- Alert เดิมไม่ซ้ำภายใน 15 นาที
- Delivery Rate ต่ำกว่า 90% สามารถ Escalate ได้ทันที
- เมื่อระบบกลับมาปกติมี Recovery Message เพียง 1 ครั้ง
- Telegram/LINE ล้มเหลวมี Retry และแสดงสถานะใน Dashboard
- Admin กดเปิด Dashboard จากข้อความได้
- ไม่มีข้อมูลส่วนตัวลูกค้าอยู่ในข้อความ
- Client ไม่สามารถสร้างหรือปิด Incident เองได้
- การทดสอบ Queue Spike, Delivery Failure, Provider Failure และ Recovery ผ่านครบ

## 17. ข้อเสนอแนะสุดท้าย

แนะนำให้เริ่มด้วย Telegram Admin Group เป็นช่องทางหลัก เพราะตั้งค่าและทดสอบได้เร็ว เหมาะกับ Alert ภายในทีม และให้ทำ LINE OA เป็น Phase 3 หรือช่องทางสำรองเมื่อทีมต้องการรับ Alert ใน LINE อย่างเป็นทางการ การแยก Incident State, Dedupe และ Channel Delivery ตั้งแต่แรกจะทำให้เพิ่ม LINE ภายหลังได้โดยไม่ต้องแก้กฎ Alert ใหม่
