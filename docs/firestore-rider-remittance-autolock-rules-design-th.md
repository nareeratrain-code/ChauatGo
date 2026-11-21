# Firestore Security Rules สำหรับ Rider Remittance และ Auto-lock

เอกสารนี้ออกแบบเพื่อผสานกับ `firestore.rules` ปัจจุบันของ ChauatGo โดยเน้น 2 เรื่อง:

1. ป้องกัน Rider หรือ Client ปลอมยอดโอน, สถานะตรวจสลิป และสถานะชำระเงิน
2. ป้องกันการล้างหรือแก้ไข Rider Lock, Verification Cooldown และ Risk Restriction จาก Client

ตัวอย่างนี้เป็น Design/Reference สำหรับนำไปผสานกับ Rules เดิม ไม่ควรนำไปแทนที่ `firestore.rules` ทั้งไฟล์โดยตรง เพราะไฟล์ปัจจุบันมี Order State Machine, Dispatch, Merchant และ Chat Rules อยู่แล้ว

---

## 1. หลักการออกแบบ

### 1.1 Remittance เป็น Server-owned Ledger

Client ไม่ควรสร้างหรือแก้เอกสาร `rider_remittances` โดยตรง แม้จะเป็น Rider เจ้าของรายการก็ตาม เพราะ Rider อาจแก้:

- `amountExpected`
- `dueAmount`
- `status`
- `verifiedAt`
- `verifiedBy`
- `riderPaid`
- `lockReason`

ให้ Client เรียก Callable Functions:

```text
submitRiderRemittance
reviewRiderRemittance
syncMySettlement
```

แล้วให้ Cloud Functions คำนวณและเขียนด้วย Transaction

### 1.2 Lock เป็น Server-owned Policy

Client ห้ามแก้:

```text
onlineLockedUntil
onlineLockReason
remittanceVerificationUntil
riskRestrictionUntil
riskScore
riskLevel
restriction
```

การปลด Lock ต้องเกิดจาก:

- Function ที่ตรวจเงื่อนไขแล้ว
- Scheduler ที่พบว่าหมดอายุแล้ว
- Admin Callable ที่มี Role ถูกต้อง

ไม่ควรให้ Admin Browser เขียน Lock Document โดยตรง เพราะควรมี Validation และ Audit Log ทุกครั้ง

### 1.3 Rules ไม่ใช่ Accounting Engine

Firestore Rules ควรทำหน้าที่:

- จำกัดผู้ที่อ่านข้อมูลได้
- ปิด Direct Client Write
- Freeze ฟิลด์ที่เป็น Server-owned
- จำกัด Field ที่ Rider แก้ได้

การคำนวณยอดค้าง, รอบเวลา 21:00/22:00, 20% และ Effective Lock ต้องทำใน Cloud Functions

---

## 2. Helper Functions

ChauatGo มี Helper บางส่วนอยู่แล้ว เช่น `isAuth()`, `myUid()`, `isAdmin()`, `isVerifiedRider()` และ `unchanged()` ควรใช้ของเดิมเพื่อไม่ให้เกิดชื่อซ้ำ

ตัวอย่าง Helper ที่เกี่ยวข้อง:

```firestore
function riderPath(riderId) {
  return /databases/$(database)/documents/riders/$(riderId);
}

function remittancePath(remittanceId) {
  return /databases/$(database)/documents/rider_remittances/$(remittanceId);
}

function isOwnRider(riderId) {
  return isAuth() && myUid() == riderId;
}

function isRemittanceOwner() {
  return isAuth()
    && request.resource.data.get('riderId', '') == myUid();
}

function hasOnlyFields(fields) {
  return request.resource.data.keys().hasOnly(fields);
}

function changedOnly(fields) {
  return request.resource.data.diff(resource.data)
    .affectedKeys().hasOnly(fields);
}

function unchangedField(field) {
  return request.resource.data.get(field, null)
    == resource.data.get(field, null);
}
```

> ในไฟล์ปัจจุบันมีชื่อ `riderProfileWriteOk`, `moneyFrozen` และ `rider_remittances` อยู่แล้ว ควรปรับฟังก์ชันเดิมแทนการเพิ่ม Helper ที่ซ้ำกัน

---

## 3. Rules สำหรับ `rider_remittances`

### แบบที่แนะนำ: ปิด Direct Write ทั้งหมด

```firestore
match /rider_remittances/{remittanceId} {
  // Rider อ่านได้เฉพาะเอกสารของตัวเอง
  // Admin อ่านได้ทั้งหมด
  allow read: if isAdmin()
    || (
      isAuth()
      && resource.data.get('riderId', '') == myUid()
    );

  // ห้าม Rider สร้าง/แก้/ลบโดยตรง
  // submitRiderRemittance และ reviewRiderRemittance
  // ใช้ Firebase Admin SDK เขียนผ่าน Cloud Functions
  allow create, update, delete: if false;
}
```

นี่เป็นรูปแบบที่เหมาะกับ ChauatGo มากที่สุด และตรงกับ Rules ปัจจุบันที่ปิดการเขียน `rider_remittances` จาก Client แล้ว

### เหตุผลที่ไม่ควรเปิดให้ Rider สร้างเอง

แม้จะตรวจว่า `riderId == request.auth.uid` ก็ยังไม่เพียงพอ เพราะ Rider อาจส่งข้อมูลปลอม เช่น:

```javascript
{
  riderId: "ตัวเอง",
  amountExpected: 0,
  status: "verified",
  verifiedAt: Timestamp.now()
}
```

Rules ไม่ควรเป็นผู้คำนวณยอดจาก Order หลายรายการ ให้ Function อ่าน Orders ล่าสุดแล้วสร้าง deterministic document ID แทน:

```text
rider_{riderId}_{dateKey}
```

---

## 4. Rules สำหรับ `settlement_queue`

Settlement Queue เป็นผลจาก Server Calculation ไม่ควรเปิดให้ Rider หรือ Admin Browser เขียนโดยตรง

```firestore
match /settlement_queue/{entryId} {
  allow read: if isAdmin()
    || (
      isAuth()
      && resource.data.get('partyId', '') == myUid()
    );

  allow create, update, delete: if false;
}
```

ถ้า Rider ต้องส่งข้อมูลเพิ่มเติม เช่น Slip ให้ใช้ `submitRiderRemittance` Callable ไม่ควรแก้ Queue โดยตรง

ควรแยกข้อมูลดังนี้:

```text
settlement_queue = Server-calculated due/remaining state
rider_remittances = Submitted slip and review state
```

ไม่ควรใช้ยอดในสลิปมาเขียนทับ `displayAmount` หรือ `dueAmount`

---

## 5. Rules สำหรับ `rider_payouts`

Payout Ledger ต้องเป็น Append-only จาก Server:

```firestore
match /rider_payouts/{payoutId} {
  allow read: if isAdmin();

  // Transaction ใน Cloud Functions เขียน Order payout flags
  // และ Rider payout record ให้สอดคล้องกัน
  allow create, update, delete: if false;
}
```

ถ้าต้องให้ Rider ดูประวัติ Payout ควรสร้าง Projection ที่ตัดข้อมูลลับแล้ว เช่น:

```text
riders/{riderId}/payoutHistory/{payoutId}
```

แต่ Projection นี้ก็ต้องเป็น Server-owned และควรให้ Rider อ่านได้อย่างเดียว:

```firestore
match /riders/{riderId}/payoutHistory/{payoutId} {
  allow read: if isAdmin()
    || (isAuth() && myUid() == riderId);
  allow write: if false;
}
```

---

## 6. Rules สำหรับ `rider_locks`

ไม่ควรให้ Client อ่านหรือเขียน Lock Internals โดยตรง:

```firestore
match /rider_locks/{riderId} {
  // Lock plan ภายใน ใช้โดย Cloud Functions/Scheduler เท่านั้น
  allow read, create, update, delete: if false;
}
```

เหตุผล:

- ไม่เปิดเผยรายละเอียด Policy ภายในให้ Client แก้ตามได้
- ไม่ให้ Rider ปลอม Lock State
- ไม่ให้ Admin Browser ข้าม Callable และทำให้ไม่มี Audit

ถ้า Admin ต้องดูข้อมูล ให้สร้าง Admin-safe projection เช่น:

```text
admin_rider_lock_status/{riderId}
```

```firestore
match /admin_rider_lock_status/{riderId} {
  allow read: if isAdmin();
  allow write: if false;
}
```

การเปลี่ยน Lock ต้องผ่าน:

```text
reviewRiderRemittance
reviewRiskCase
unlockRider
sweepRiderRemit
```

---

## 7. ป้องกันการล้าง Lock บน `riders/{riderId}`

เอกสาร Rider ปัจจุบันมีฟิลด์ที่ UI ต้องอ่าน เช่น:

```text
onlineLockedUntil
onlineLockReason
remittanceVerificationUntil
```

Rider ควรแก้ได้เฉพาะ Profile Fields ที่อนุญาตเท่านั้น:

```firestore
match /riders/{riderId} {
  allow read: if isAdmin()
    || (isAuth() && myUid() == riderId);

  allow update: if isAdmin()
    || (
      isAuth()
      && myUid() == riderId
      && request.resource.data.diff(resource.data)
        .affectedKeys().hasOnly([
          'status',
          'lastToggle',
          'fcmTokens',
          'qrCodeUrl',
          'qrCodePath'
        ])
      && unchangedField('onlineLockedUntil')
      && unchangedField('onlineLockReason')
      && unchangedField('remittanceVerificationUntil')
      && unchangedField('riskRestrictionUntil')
      && unchangedField('riskScore')
      && unchangedField('riskLevel')
      && unchangedField('restriction')
      && unchangedField('verified')
      && unchangedField('totalIncome')
      && unchangedField('totalJobs')
    );

  allow delete: if isAdmin();
}
```

ในไฟล์จริงควรรวมเงื่อนไขนี้เข้ากับ `riderProfileWriteOk(riderId)` ที่มีอยู่แล้ว ไม่ควรสร้าง `match /riders/{riderId}` ซ้ำ

### ระวังช่องโหว่จาก `merge: true`

Rules ต้องตรวจ `affectedKeys()` ทุกครั้ง เพราะ Client อาจส่งเพียง Field เดียวเพื่อแก้ Lock:

```javascript
updateDoc(riderRef, {
  onlineLockedUntil: null
});
```

ถ้า Rules ตรวจเฉพาะค่าครบทั้ง Document หรือเช็กเพียง `status` อาจเปิดช่องให้คำสั่งนี้ผ่านได้

---

## 8. ป้องกัน `jobHistory` ถูกแก้ทับ

Job History เป็นข้อมูลที่ใช้คำนวณ Remittance และแสดงยอดค้าง จึงควรเขียนโดย Function เท่านั้น:

```firestore
match /riders/{riderId}/jobHistory/{orderId} {
  allow read: if isAdmin()
    || (isAuth() && myUid() == riderId);

  allow create, update, delete: if false;
}
```

โดยเฉพาะ Field เหล่านี้ต้องมาจาก Server:

```text
riderPaid
riderPaidAt
riderIncome
riderOwe
remittanceDateKey
orderCompletedAt
```

เมื่อ Admin ตรวจสลิป ต้องเขียน `riderPaid=true` ผ่าน Function และไม่ให้ Rider แก้เองเพื่อทำให้ยอดค้างเป็นศูนย์

---

## 9. ป้องกัน Admin Browser แก้ยอดโดยตรง

แม้จะเป็น Admin ก็ไม่ควรเปิด Rule แบบนี้สำหรับ Ledger:

```firestore
// ไม่แนะนำ
allow update: if isAdmin();
```

เพราะ Admin UI อาจส่ง Field ผิดหรือถูกแก้จาก Browser ที่ถูกยึด Session ได้

ควรใช้:

```firestore
allow read: if isAdmin();
allow create, update, delete: if false;
```

แล้วให้ Admin เรียก Callable:

```text
reviewRiderRemittance
reviewRiskCase
unlockRider
rejectRiderRemittance
```

Cloud Function ต้องตรวจ:

```javascript
if (!isAdminContext(request)) {
  throw new HttpsError(
    'permission-denied',
    'Admin role required'
  );
}
```

และต้องบันทึก:

```javascript
{
  action: 'rider_remittance_reviewed',
  actorId: adminUid,
  riderIdHash: shortHash(riderId),
  remittanceId,
  decision: 'verified',
  remainingDue,
  lockReason,
  unlockAt,
  requestId,
  createdAt: FieldValue.serverTimestamp()
}
```

---

## 10. Auto-lock ต้องใช้หลาย Policy Components

ไม่ควรมีเพียง `onlineLockedUntil` ฟิลด์เดียว เพราะจะทำให้เหตุผลหลายประเภททับกันและปลดผิดเหตุผล

แนะนำแยกเป็น:

```text
remitLockUntil
verificationCooldownUntil
riskRestrictionUntil
safetySuspensionUntil
```

Rules ต้อง Freeze ทุกฟิลด์:

```firestore
function lockFieldsFrozen() {
  return !request.resource.data.diff(resource.data)
    .affectedKeys().hasAny([
      'onlineLockedUntil',
      'onlineLockReason',
      'remitLockUntil',
      'verificationCooldownUntil',
      'remittanceVerificationUntil',
      'riskRestrictionUntil',
      'safetySuspensionUntil',
      'riskScore',
      'riskLevel',
      'restriction'
    ]);
}
```

Cloud Function จึงคำนวณ:

```javascript
const lockUntil = Math.max(
  toMillis(remitLockUntil),
  toMillis(verificationCooldownUntil),
  toMillis(riskRestrictionUntil),
  toMillis(safetySuspensionUntil)
);
```

และกำหนดเหตุผลที่มี Priority สูงสุด เช่น:

```text
safety_suspension
risk_restriction
remit_verified_cooldown
remit_overdue
```

### สำคัญสำหรับเคสยอดค้าง 0 บาท

หาก Admin ตรวจสลิปแล้วและ Policy กำหนดให้ล็อกต่อ 24 ชั่วโมง:

```javascript
remainingDue = 0;
verificationCooldownUntil = reviewedAt + 24h;
onlineLockReason = 'remit_verified_cooldown';
```

Rules ไม่ควรมี Logic ที่บังคับว่า `remainingDue == 0` แล้วต้องล้าง Lock เพราะเป็น Business Policy ของ Function ไม่ใช่หน้าที่ของ Rules

---

## 11. Cloud Function ที่ต้องทำงานคู่กับ Rules

### `submitRiderRemittance`

ต้องตรวจ:

```text
1. Auth และ App Check
2. Rider เป็นเจ้าของ Remittance
3. dateKey คำนวณจาก Server Timezone
4. อ่าน Orders ล่าสุดใน Transaction
5. คำนวณ dueAmount จาก 20%
6. ใช้ Deterministic ID
7. ป้องกันการ Submit ซ้ำ
8. ยอดสลิปไม่ถูกใช้แทน dueAmount
```

### `reviewRiderRemittance`

ต้องตรวจ:

```text
1. Admin Role จาก Server
2. Remittance ยังไม่ได้ Review ซ้ำ
3. อ่าน Orders และ Job History ใหม่
4. คำนวณ remainingDue ใหม่
5. ตั้ง riderPaid เฉพาะ Job ที่เกี่ยวข้อง
6. ตั้ง verificationCooldown ตาม Policy
7. สร้าง Audit Log และ Outbox
8. Commit ทั้งหมดใน Transaction
```

### `sweepRiderRemit`

ต้องตรวจ:

```text
1. คำนวณวัน/เวลา Bangkok ถูกต้อง
2. ไม่ล้าง Risk/Safety Restriction ด้วย Remittance Sweep
3. ล้างเฉพาะ Component ที่หมดอายุ
4. คำนวณ Effective Lock ใหม่
5. เขียนผลแบบ Idempotent
```

### `unlockRider`

ควรจำกัดให้ใช้เฉพาะกรณีที่ Policy อนุญาต:

```text
- Admin ตรวจสอบแล้ว
- มีเหตุผลการปลดล็อก
- ไม่ขัดกับ Safety Suspension
- ไม่ปลด Lock ของ Policy อื่นโดยไม่ตั้งใจ
- เขียน Audit ทุกครั้ง
```

---

## 12. Rules ฉบับรวมสำหรับส่วนที่เกี่ยวข้อง

ตัวอย่างโครงสร้างย่อที่ควรมี:

```firestore
service cloud.firestore {
  match /databases/{database}/documents {

    match /rider_remittances/{remittanceId} {
      allow read: if isAdmin()
        || (isAuth() && resource.data.riderId == myUid());
      allow create, update, delete: if false;
    }

    match /settlement_queue/{entryId} {
      allow read: if isAdmin()
        || (isAuth() && resource.data.partyId == myUid());
      allow create, update, delete: if false;
    }

    match /rider_payouts/{payoutId} {
      allow read: if isAdmin();
      allow create, update, delete: if false;
    }

    match /rider_locks/{riderId} {
      allow read, write: if false;
    }

    match /riders/{riderId} {
      allow read: if isAdmin()
        || (isAuth() && myUid() == riderId);

      allow update: if isAdmin()
        || riderProfileWriteOk(riderId);

      match /jobHistory/{orderId} {
        allow read: if isAdmin()
          || (isAuth() && myUid() == riderId);
        allow create, update, delete: if false;
      }
    }

    match /audit_logs/{auditId} {
      allow read: if isAdmin();
      allow create, update, delete: if false;
    }

    match /risk_events/{eventId} {
      allow read: if isAdmin();
      allow create, update, delete: if false;
    }
  }
}
```

---

## 13. Security Rules ไม่สามารถป้องกันอะไรได้เอง

Rules ไม่สามารถ:

- คำนวณยอด 20% จาก Orders หลายรายการได้อย่างเหมาะสม
- ตรวจความถูกต้องของสลิปจากธนาคาร
- ยืนยันว่าเงินเข้า Bank จริง
- ส่ง FCM/Slack อย่างปลอดภัยใน Transaction
- ตรวจพฤติกรรมข้ามหลาย Collection ได้อย่างสมบูรณ์
- ป้องกัน Function ที่มี Bug และใช้ Admin SDK ผิด

ดังนั้นต้องตรวจใน Cloud Functions ด้วย เพราะ Admin SDK ข้าม Rules:

```text
Rules = ป้องกัน Direct Client Access
Cloud Functions = ตรวจสิทธิ์และ Business Invariants
Transaction = ป้องกัน Race Condition
Audit = ตรวจย้อนหลัง
```

---

## 14. Emulator Test Matrix

### Rider Remittance

```text
1. Rider อ่าน Remittance ของตัวเองได้
2. Rider อ่าน Remittance ของ Rider คนอื่นไม่ได้
3. Rider สร้าง rider_remittances ตรงไม่ได้
4. Rider แก้ amountExpected ตรงไม่ได้
5. Rider แก้ status เป็น verified ตรงไม่ได้
6. Rider ลบ Remittance ตรงไม่ได้
7. Admin Browser แก้ Ledger ตรงไม่ได้
8. submitRiderRemittance Retry ไม่สร้างเอกสารซ้ำ
9. Review ซ้ำไม่ตั้ง riderPaid ซ้ำ
10. ยอดสลิปมากกว่ายอดค้างไม่ทำให้ due กลายเป็นยอดสลิป
```

### Auto-lock

```text
11. Rider ล้าง onlineLockedUntil ไม่ได้
12. Rider เปลี่ยน onlineLockReason ไม่ได้
13. Rider แก้ verification cooldown ไม่ได้
14. Rider แก้ riskScore/riskLevel ไม่ได้
15. Rider แก้ restriction เป็น none ไม่ได้
16. Admin ต้องใช้ Callable ในการปลด Lock
17. Remittance Sweep ไม่ล้าง Risk Restriction
18. หมดเฉพาะ Remit Lock แต่ยังมี Cooldown ต้องไม่ปลดทั้งหมด
19. ยอดค้างเป็น 0 แต่ยังมี verification cooldown ต้องยังแสดง Lock ถูกเหตุผล
20. Audit Log ถูกสร้างเมื่อ Lock ถูกสร้าง/เปลี่ยน/ปลด
```

---

## 15. สรุป Design ที่แนะนำ

```text
rider_remittances  = อ่านได้ตามสิทธิ์, เขียนโดย Functions เท่านั้น
settlement_queue   = อ่านได้ตามสิทธิ์, เขียนโดย Functions เท่านั้น
rider_payouts      = Admin อ่านได้, เขียนโดย Functions เท่านั้น
rider_locks        = Internal only, Client อ่าน/เขียนไม่ได้
jobHistory         = Rider อ่านของตัวเอง, เขียนโดย Functions เท่านั้น
riders lock fields = Freeze จาก Rider Client
risk_events        = Admin อ่าน, Functions เขียน
 audit_logs        = Admin อ่าน, Functions เขียนแบบ append-only
```

หัวใจของระบบคือ:

> Rider ต้องไม่สามารถทำให้ยอดค้างเป็นศูนย์, ทำให้สลิปเป็น Verified, หรือล้าง Lock ด้วยการเขียน Firestore โดยตรงได้

และ:

> Admin ต้องไม่แก้ Ledger ด้วย Browser โดยตรง แต่ต้องผ่าน Callable ที่ตรวจ Role, ใช้ Transaction และสร้าง Audit Trail ทุกครั้ง
