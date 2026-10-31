# ChauatGo Push & Rider Success Dashboard Design

## 1. เป้าหมายของ Dashboard

สร้างหน้าจอสำหรับ Admin เพื่อตอบคำถามสำคัญได้ทันที:

1. ตอนนี้ Push Notification ส่งออกไปสำเร็จหรือไม่
2. มีคิว Push ค้างหรือส่งช้าหรือไม่
3. Token ใดเสียหรือมีอัตราล้มเหลวสูง
4. ไรเดอร์คนใดได้รับงานและตอบรับงานได้ดี
5. งานจำนวนมากทำให้เกิด Notification Storm หรือไม่
6. ปัญหาเกิดจาก FCM, Token, Dispatch, อุปกรณ์ หรือไรเดอร์ไม่กดรับ

Dashboard ต้องแยกคำว่า **Push Delivery Success** ออกจาก **Rider Operational Success** อย่างชัดเจน เพราะ FCM ส่งถึงระบบปลายทางสำเร็จไม่ได้แปลว่าไรเดอร์เปิดอ่านหรือรับงานแล้ว

## 2. โครงสร้างเมนูที่เสนอ

เพิ่มเมนูใน `admin.js` / `admin.html`:

```text
📊 แดชบอร์ด
  └─ ภาพรวมระบบเดิม
📣 Push Monitor        ← เมนูใหม่
  ├─ ภาพรวม Push
  ├─ คิวและ Error
  └─ รายงานไรเดอร์
🎯 จ่ายงาน
🛵 ไรเดอร์
```

บนมือถือใช้หน้าเดียวแบบ Section Stack ส่วน Desktop ใช้ Grid 12 คอลัมน์

## 3. Layout หน้า Push Monitor

### 3.1 Header และ Filter Bar

ด้านบนแสดง:

- ชื่อหน้า: `Push Monitor & Rider Success`
- สถานะ Live: `🟢 อัปเดตล่าสุดเมื่อ 10:55:21`
- ปุ่ม Refresh
- ตัวเลือกช่วงเวลา: `15 นาที`, `1 ชั่วโมง`, `วันนี้`, `7 วัน`, `กำหนดเอง`
- ตัวกรองประเภทงาน: `ทั้งหมด`, `อาหาร`, `ส่งด่วน`, `ฝากซื้อ`
- ตัวกรองสถานะ: `ทั้งหมด`, `ส่งสำเร็จ`, `ล้มเหลว`, `ค้าง`, `ถูก Suppress`
- ค้นหา Rider ID/ชื่อไรเดอร์

การเปลี่ยน Filter ต้องไม่โหลดข้อมูลทั้งหมดใหม่ถ้าใช้ข้อมูล Rollup อยู่แล้ว

### 3.2 KPI Cards

แนะนำให้ใช้ 8 Cards แบ่งเป็น 2 กลุ่ม:

#### กลุ่ม Push Health

| KPI | ความหมาย |
|---|---|
| Push ที่ส่ง | จำนวน Notification ที่ Worker พยายามส่ง |
| FCM Success | จำนวน Token ที่ FCM รับคำขอสำเร็จ |
| FCM Failure | จำนวน Token ที่ FCM ตอบล้มเหลว |
| Delivery Rate | `FCM Success / Attempted × 100` |
| Queue Pending | จำนวน Batch ที่ยังรอส่ง |
| P95 Send Latency | เวลา Queue ถึง FCM ที่เปอร์เซ็นไทล์ 95 |

#### กลุ่ม Rider Outcome

| KPI | ความหมาย |
|---|---|
| งานถูกเสนอ | จำนวน Offers ที่สร้างจริง |
| รับงานสำเร็จ | จำนวน Offers ที่ Rider รับ |
| Offer Acceptance Rate | `Accepted / Offered × 100` |
| งานหมดเวลา | Offers ที่หมดอายุหรือถูกข้าม |
| Median Response Time | เวลา Offer ถึงการกดรับ/ข้าม |
| Riders Online | ไรเดอร์ที่พร้อมรับงานและมีพิกัดสด |

สีที่ใช้:

- เขียว: ผ่านเกณฑ์
- เหลือง: ควรติดตาม
- แดง: ต้องตรวจสอบ
- เทา: ไม่มีข้อมูลเพียงพอ

## 4. Charts และ Panels

### 4.1 Push Timeline

กราฟเส้นหรือ Area Chart แสดงราย 5 นาที:

- Attempted
- FCM Success
- FCM Failure
- Suppressed/Deduplicated
- Queue Pending

เมื่อ Hover แสดงจำนวนจริงและ Delivery Rate ของช่วงนั้น

### 4.2 Dispatch Funnel

แสดง Funnel แยกตามประเภทงาน:

```text
Orders Created
      ↓
Offers Created
      ↓
Push Attempted
      ↓
FCM Accepted
      ↓
Rider Opened App
      ↓
Rider Accepted Offer
      ↓
Order Completed
```

ต้องติดป้ายกำกับว่า `Rider Opened App` เป็นตัวชี้วัดโดยประมาณ หากยังไม่มี Event จากการคลิก Notification โดยตรง

### 4.3 Queue Health Panel

แสดงรายการ Batch ล่าสุด:

| เวลา | Rider | งาน | สถานะ | อายุคิว | Retry |
|---|---|---:|---|---:|---:|
| 10:55:21 | Rider A | 6 | ส่งแล้ว | 1.8s | 0 |
| 10:55:19 | Rider B | 3 | รอส่ง | 4.2s | 0 |
| 10:55:10 | Rider C | 4 | ล้มเหลว | 18s | 2 |

สถานะที่ใช้:

- `queued`
- `processing`
- `sent`
- `partial_failure`
- `retrying`
- `suppressed`
- `dead_letter`

### 4.4 Failure Reasons

กราฟแท่งหรือรายการจัดอันดับ:

- `registration-token-not-registered`
- `invalid-registration-token`
- `messaging/unavailable`
- `messaging/internal-error`
- ไม่มี VAPID Key
- Permission ไม่ได้รับ
- ไม่มี Token
- Queue Timeout
- ถูก Deduplicate/Rate Limit

กดรายการ Error เพื่อเปิดรายละเอียด Token/Rider/Batch โดยต้อง Mask Token ไม่แสดง Token เต็ม

### 4.5 Rider Success Table

ตารางหลักสำหรับดูอัตราความสำเร็จรายไรเดอร์:

| ไรเดอร์ | Online | Push Delivery | งานที่ได้รับ | รับงาน | Acceptance | Median Response | Expired | Token |
|---|---|---:|---:|---:|---:|---:|---:|---|
| สมชาย | 🟢 | 99.2% | 42 | 35 | 83.3% | 8.4s | 3 | ดี |

คอลัมน์ที่ควรมี:

- ชื่อและ ID ไรเดอร์
- Online/Offline
- Last GPS Seen
- จำนวน Token ที่ Active
- Push Attempted
- FCM Success/Failure
- Push Delivery Rate
- Offers Received
- Offers Accepted
- Offer Acceptance Rate
- Offers Skipped/Expired
- Median/P95 Response Time
- จำนวนงานเสร็จ
- Rating เฉลี่ย
- สถานะสุขภาพ Token

กดแถวเพื่อเปิด Drawer รายละเอียดไรเดอร์พร้อม Timeline ของ Push และ Offer

## 5. Rider Detail Drawer

เมื่อ Admin กดชื่อไรเดอร์ ให้แสดง:

### Summary

- สถานะบัญชีและ Verified
- สถานะพร้อมรับงาน
- GPS ล่าสุดและอายุพิกัด
- จำนวนงานค้าง
- จำนวนอุปกรณ์/Token

### Push Health

- Push วันนี้
- Success/Failure
- Delivery Rate
- Token ที่เสียล่าสุด
- Last Push Sent
- Last App Open

### Offer Outcome

- งานที่เสนอ
- รับงาน
- ข้ามงาน
- หมดเวลา
- อัตรารับงาน
- เวลาเฉลี่ยก่อนตอบสนอง

### Recent Events

```text
10:55:21  Push batch ส่งสำเร็จ 6 งาน
10:55:28  เปิดหน้ารับงาน
10:55:32  รับงาน OD-1234
10:56:01  ข้ามงาน OD-1235
```

## 6. Data Model ที่เสนอ

### 6.1 `rider_notification_events/{eventId}`

ใช้เก็บรายละเอียดระดับ Batch:

```js
{
  riderId: "rider-123",
  batchId: "rider-123_20261023_1055_07",
  orderCount: 6,
  validOrderCount: 5,
  attemptedTokenCount: 2,
  successTokenCount: 2,
  failureTokenCount: 0,
  dedupedCount: 0,
  retryCount: 0,
  priority: "normal",
  sendLatencyMs: 1760,
  status: "sent",
  failureReasons: [],
  createdAt: Timestamp,
  queuedAt: Timestamp,
  sentAt: Timestamp,
  openedAt: Timestamp | null
}
```

ไม่เก็บ FCM Token เต็มใน Event Log

### 6.2 `rider_offer_events/{eventId}`

เก็บผลลัพธ์การเสนอ Offer:

```js
{
  riderId: "rider-123",
  orderId: "order-456",
  offerId: "offer-789",
  jobType: "food",
  offeredAt: Timestamp,
  responseAt: Timestamp | null,
  outcome: "accepted" | "skipped" | "expired" | "taken" | "cancelled",
  responseLatencyMs: 8400,
  distanceKm: 1.8
}
```

### 6.3 `push_metrics_daily/{yyyy-mm-dd}`

ใช้ Rollup สำหรับ KPI ไม่ให้ Admin ต้องอ่าน Event หลายพันเอกสารทุกครั้ง:

```js
{
  timezone: "Asia/Bangkok",
  attempted: 1240,
  fcmSuccess: 1198,
  fcmFailure: 42,
  invalidTokens: 31,
  suppressed: 86,
  batches: 312,
  queueTimeouts: 2,
  sendLatency: {
    p50: 820,
    p95: 3240,
    max: 11800
  },
  byJobType: {
    food: { attempted: 700, success: 682 },
    express: { attempted: 420, success: 405 },
    shopping: { attempted: 120, success: 111 }
  },
  updatedAt: Timestamp
}
```

### 6.4 `rider_performance_daily/{date_riderId}`

```js
{
  date: "2026-10-23",
  riderId: "rider-123",
  pushAttempted: 42,
  pushSuccess: 41,
  pushFailure: 1,
  offersReceived: 42,
  offersAccepted: 35,
  offersSkipped: 4,
  offersExpired: 3,
  medianResponseMs: 8400,
  completedJobs: 31,
  updatedAt: Timestamp
}
```

## 7. วิธีคำนวณ Metric

### Push Delivery Rate

```text
FCM Success / (FCM Success + FCM Failure) × 100
```

ไม่รวม Suppressed เพราะไม่ได้พยายามส่ง

### Rider Offer Acceptance Rate

```text
Accepted / (Accepted + Skipped + Expired + Taken) × 100
```

ควรแสดง `N/A` เมื่อจำนวน Offers น้อยกว่า 5 เพื่อไม่ให้ตัวเลขจากข้อมูลน้อยทำให้เข้าใจผิด

### Notification-to-Accept Rate

```text
Offers Accepted / Push Batch ที่มีงานนั้น × 100
```

เป็น Metric ประกอบเท่านั้น เพราะงานอาจรับผ่านหน้าแอปก่อน Push หรือ Push ไปหลายไรเดอร์พร้อมกัน

### Send Latency

```text
sentAt - queuedAt
```

แสดง P50, P95 และ Maximum แยกจากเวลา FCM ตอบกลับ

## 8. Real-time กับ Historical Data

### Real-time (อัปเดตทุก 5–10 วินาที)

- Queue Pending
- Processing/Retry
- Last Push Event
- Online Riders
- Current Failure Spike
- P95 Latency ช่วง 15 นาทีล่าสุด

### Historical (อ่านจาก Rollup)

- วันนี้ / 7 วัน / 30 วัน
- Delivery Rate
- Acceptance Rate
- Token Health
- เปรียบเทียบช่วงเวลา
- แนวโน้มตามประเภทงาน

ห้ามใช้ Listener กับ Event Log ทั้งหมดแบบไม่จำกัด เพราะอาจเพิ่มค่าอ่าน Firestore และทำให้หน้า Admin ช้า

## 9. Alert Rules

ตั้ง Alert ใน Dashboard เมื่อ:

| เงื่อนไข | ระดับ | การแสดงผล |
|---|---|---|
| Delivery Rate < 95% ต่อเนื่อง 5 นาที | Critical | แถบแดง + แจ้ง Admin |
| P95 Send Latency > 5 วินาที | Warning | แถบเหลือง |
| Queue ค้างเกิน 30 วินาที | Critical | แสดงจำนวนคิวและ Batch |
| Invalid Token > 20% ต่อชั่วโมง | Warning | ให้ตรวจ Token/Service Worker |
| ไรเดอร์ Online แต่ไม่มี Token | Warning | แนะนำให้เปิด Push |
| Acceptance Rate ต่ำกว่า 30% และ Offers ≥ 10 | Info | ตรวจการจัดอันดับ/คุณภาพงาน |
| Push Failure ต่อไรเดอร์สูงผิดปกติ | Warning | เปิด Rider Drawer อัตโนมัติ |

ควรมี Cooldown Alert อย่างน้อย 15 นาทีเพื่อไม่แจ้งซ้ำรัว

## 10. การออกแบบ UI/UX

### Desktop

- KPI 4 Cards แถวแรกสำหรับ Push
- KPI 4 Cards แถวสองสำหรับ Rider Outcome
- Timeline เต็มความกว้าง
- ซ้าย: Queue Health / Failure Reasons
- ขวา: Rider Success Ranking

### Mobile/Tablet

- KPI แบบ Horizontal Scroll หรือ 2 คอลัมน์
- Filter เป็น Bottom Sheet
- ตารางเปลี่ยนเป็น Card List
- แสดงเฉพาะคอลัมน์สำคัญ: ไรเดอร์, Delivery, Acceptance, Error
- กด Card เพื่อเปิดรายละเอียดแทนตารางกว้าง
- ไม่ใช้กราฟที่ต้องเลื่อนแนวนอนทั้งหน้า

### สี

- เขียว: Healthy / Success
- ส้ม: Queue / Pending
- แดง: Failure / Critical
- ม่วง: Rider Performance
- น้ำเงิน: Dispatch/Offer
- เทา: Suppressed หรือไม่มีข้อมูล

## 11. สิทธิ์และความปลอดภัย

- เฉพาะ Admin ที่ผ่าน `callerIsAdmin()` อ่าน Dashboard ได้
- Client ห้ามเขียน Metric, Event Log หรือแก้ค่า Success Rate
- ใช้ Callable/Cloud Function สำหรับ Export และ Drill-down ที่ละเอียด
- Mask FCM Token ทั้งใน UI และ Log
- ไม่แสดงชื่อ เบอร์โทร หรือที่อยู่ลูกค้าใน Failure Detail โดยไม่จำเป็น
- จำกัดข้อมูลรายไรเดอร์ตาม Role ของ Admin หากมีหลายระดับ
- เขียน Admin Audit Log เมื่อมีการ Export หรือเปิดข้อมูลเชิงละเอียด

## 12. แผนพัฒนา

### Phase 1 — Data Foundation

- เพิ่ม `rider_notification_events`
- เพิ่ม `rider_offer_events`
- เพิ่ม `push_metrics_daily`
- เพิ่ม `rider_performance_daily`
- เพิ่ม Event สำหรับ `app_opened_from_push`

### Phase 2 — Admin UI

- เพิ่มเมนู `Push Monitor`
- เพิ่ม KPI Cards และ Filter
- เพิ่ม Queue Health และ Failure Reasons
- เพิ่ม Rider Success Table
- เพิ่ม Rider Detail Drawer

### Phase 3 — Alert และ Export

- เพิ่ม Alert Rules
- เพิ่มระบบ Snooze/Resolve
- Export CSV เฉพาะข้อมูล Aggregate
- เพิ่ม Retention และลบ Event รายละเอียดตามนโยบายข้อมูล

## 13. Acceptance Criteria

ระบบ Dashboard รุ่นแรกถือว่าผ่านเมื่อ:

- Admin เห็น Queue Pending และ Batch ที่ค้างได้ภายใน 10 วินาที
- Delivery Rate ใน Dashboard คำนวณตรงกับ Event Log
- แยก FCM Success, FCM Failure และ Suppressed ได้ชัดเจน
- แสดง Acceptance Rate ของไรเดอร์โดยไม่ปนกับ Push Delivery Rate
- กดดูรายละเอียดไรเดอร์แล้วเห็น Timeline Push/Offer ล่าสุด
- Token เสียถูกนับและระบุสาเหตุโดยไม่แสดง Token เต็ม
- ข้อมูลช่วง 7 วันอ่านจาก Rollup ไม่ใช่ Listener Event ทั้งหมด
- Dashboard ไม่เปิดสิทธิ์ให้ Client เขียนหรือปลอม Metric
- UI ใช้งานได้บนมือถือและไม่มีตารางล้นหน้าจอ

## 14. ข้อเสนอแนะ

ควรเริ่มจากการเพิ่ม Data Foundation และ KPI Cards ก่อน ยังไม่ควรเริ่มจากกราฟที่ซับซ้อน เพราะตัวเลข Delivery Rate และ Acceptance Rate ต้องมี Event Schema ที่แยกชัดเจนก่อน เมื่อข้อมูลนิ่งแล้วจึงเพิ่ม Timeline, Funnel, Ranking และ Alert ได้โดยไม่ต้องรื้อ Dashboard อีกครั้ง
