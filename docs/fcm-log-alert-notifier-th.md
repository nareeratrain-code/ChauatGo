# FCM Log Alert → Slack / LINE

สคริปต์ `tools/fcm-log-alert-notifier.js` รับ JSON จาก Google Cloud Monitoring Webhook แล้วกรองเฉพาะ Structured Log Event สองชนิด:

- `send_exception`
- `send_partial_failure`

Log อื่นจะถูกตอบกลับเป็น `ignored` และไม่ส่งข้อความ

## Environment Variables

ตั้งค่าผ่าน Secret Manager, Firebase Functions Environment หรือระบบรันที่ใช้เก็บ Secret โดยห้ามใส่ค่าจริงลง Git:

```bash
# ต้องมีเพื่อป้องกันคนภายนอกยิง Webhook
export ALERT_SHARED_SECRET='เปลี่ยนเป็นค่าที่ยาวและสุ่ม'

# เลือก Slack อย่างใดอย่างหนึ่งหรือใช้ทั้งสองช่องทาง
export SLACK_WEBHOOK_URL='https://hooks.slack.com/services/REDACTED'

# LINE Messaging API
export LINE_CHANNEL_ACCESS_TOKEN='REDACTED'
export LINE_TO='USER_ID_OR_GROUP_ID'

# กันแจ้งซ้ำ Event เดิมภายใน 5 นาที (ค่าเริ่มต้น 300 วินาที)
export ALERT_DEDUPE_SECONDS=300
```

## ทดสอบแบบไม่ส่งจริง

```bash
ALERT_DRY_RUN=1 node tools/fcm-log-alert-notifier.js --sample
```

ผลที่คาดหวังต้องมี `dryRun: true` และต้องไม่ยิง Slack หรือ LINE

## รันเป็น Webhook Receiver

```bash
ALERT_SHARED_SECRET='เปลี่ยนเป็นค่าจริง' \
SLACK_WEBHOOK_URL='https://hooks.slack.com/services/REDACTED' \
PORT=8787 \
node tools/fcm-log-alert-notifier.js --serve
```

Endpoint คือ:

```text
POST /fcm-alert
Header: X-Alert-Secret: <ค่าเดียวกับ ALERT_SHARED_SECRET>
Content-Type: application/json
```

## Payload ที่รองรับ

รองรับทั้ง Structured Log โดยตรง:

```json
{
  "event": "send_partial_failure",
  "riderId": "rider-123",
  "orderId": "order-456",
  "tokenCount": 2,
  "successCount": 1,
  "failureCount": 1,
  "invalidTokenCount": 1,
  "failureCodes": {
    "messaging/registration-token-not-registered": 1
  },
  "timestamp": "2026-10-31T10:00:00.000Z"
}
```

และ Google Cloud Monitoring Webhook ที่วางข้อมูลไว้ใต้ `incident.jsonPayload`, `incident.payload`, `jsonPayload` หรือ `payload`

## ข้อความที่ส่ง

ตัวอย่าง Slack/LINE:

```text
ChauatGo FCM Alert
FCM ส่งแจ้งเตือนล้มเหลวบางส่วน
Rider: rider-123
Order: order-456
Error: messaging/registration-token-not-registered=1
Token: 2 | สำเร็จ: 1 | ล้มเหลว: 1 | Token เสีย: 1
เวลา: 2026-10-31T10:00:00.000Z
```

สคริปต์จะไม่ส่ง FCM Token จริงออกไป และจะไม่บันทึก Secret ลงไฟล์

## การเชื่อมกับ Google Cloud Monitoring

1. สร้าง Log-based Metric หรือ Alert Policy จาก Cloud Logging โดยกรองข้อความ Structured Log ที่มี `event="send_exception"` หรือ `event="send_partial_failure"` และ `component="fcm"`
2. เพิ่ม Webhook Notification Channel ที่ชี้มายัง `POST /fcm-alert`
3. ส่ง Header `X-Alert-Secret` ผ่านกลไก Secret/Authentication ของ Webhook Gateway ที่ใช้หน้า Endpoint
4. ทดสอบด้วย Payload ตัวอย่างก่อนเปิดใช้จริง
5. ตรวจ Slack/LINE และตรวจ Cloud Logs ว่ามี HTTP 2xx จาก Receiver

แนะนำให้รัน Receiver บน Cloud Run หรือ HTTPS Cloud Function ที่มี Secret Manager และ HTTPS Authentication แทนการเปิด Node Process ตรง ๆ บนเครื่องพัฒนา
