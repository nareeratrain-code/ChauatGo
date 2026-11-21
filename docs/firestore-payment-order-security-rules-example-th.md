# ตัวอย่าง Firestore Security Rules สำหรับป้องกันการทุจริตของ Payment และ Order

เอกสารนี้เป็นตัวอย่างสำหรับนำไปผสานกับ `firestore.rules` ของ ChauatGo ไม่ควรนำไปแทนที่ไฟล์ Production ทั้งหมดโดยตรง เพราะไฟล์ปัจจุบันมี State Machine ของ Order, Merchant, Rider, Dispatch และ Remittance อยู่แล้ว

หลักการสำคัญคือ **Client อ่านข้อมูลที่จำเป็นได้ แต่การเปลี่ยนแปลงทางการเงินและการเปลี่ยนสถานะสำคัญต้องผ่าน Cloud Functions**

---

## 1. หลักการที่ Rules ต้องบังคับ

1. Client ห้ามสร้าง Order โดยกำหนด `fare`, `total` หรือ `riderIncome` เอง
2. Client ห้ามเปลี่ยน `paymentStatus` เป็น `verified`
3. Client ห้ามเปลี่ยน `riderPaid`, `riderOwe`, `completedAt` หรือ `riderIncome`
4. Client ห้ามแก้ `onlineLockedUntil`, `riskScore` หรือ `lockReason`
5. การตรวจสลิปต้องผ่าน `submitPaymentProof` หรือ `submitRiderRemittance` Callable
6. Admin อ่านข้อมูลได้ตาม Role แต่ไม่ควรเขียน Ledger โดยตรงจาก Browser
7. Audit Log, Risk Event และ Payment Ledger เป็น append-only หรือเขียนได้เฉพาะ Cloud Functions
8. ใช้ `request.resource.data.diff(resource.data).affectedKeys()` เพื่อจำกัด Field ที่ Client แก้ได้

---

## 2. Helper Functions

ส่วนนี้ให้วางไว้ภายใน `match /databases/{database}/documents` และใช้ร่วมกับฟังก์ชันเดิม เช่น `isAuth()`, `myUid()` และ `isAdmin()` ที่มีอยู่แล้วใน ChauatGo

```firestore
function orderPath(orderId) {
  return /databases/$(database)/documents/orders/$(orderId);
}

function paymentPath(paymentId) {
  return /databases/$(database)/documents/payments/$(paymentId);
}

function isOrderCustomer(orderId) {
  return isAuth()
    && exists(orderPath(orderId))
    && get(orderPath(orderId)).data.get('userId', '') == myUid();
}

function isOrderRider(orderId) {
  return isAuth()
    && exists(orderPath(orderId))
    && get(orderPath(orderId)).data.get('riderId', '') == myUid();
}

function isOrderParty(orderId) {
  return isAdmin()
    || isOrderCustomer(orderId)
    || isOrderRider(orderId);
}

function onlyChanged(fields) {
  return request.resource.data.diff(resource.data).affectedKeys().hasOnly(fields);
}

function unchanged(field) {
  return request.resource.data.get(field, null)
    == resource.data.get(field, null);
}

function isValidMoney(value) {
  return value is number && value >= 0 && value <= 1000000;
}

function serverOwnedOrderFieldsFrozen() {
  return !request.resource.data.diff(resource.data).affectedKeys().hasAny([
    'fare',
    'total',
    'subtotal',
    'discountTotal',
    'platformFee',
    'riderIncome',
    'riderOwe',
    'riderPaid',
    'riderPaidAt',
    'riderPayoutId',
    'paymentStatus',
    'paymentVerifiedAt',
    'paymentId',
    'completedAt',
    'cancelledAt',
    'cancelledBy',
    'riderId',
    'userId',
    'merchantId',
    'riskScore',
    'riskLevel',
    'onlineLockedUntil',
    'onlineLockReason',
    'remittanceVerificationUntil'
  ]);
}
```

> ในไฟล์จริงของ ChauatGo มี Helper และ Order State Machine อยู่แล้ว ควรใช้ Helper เดิมให้มากที่สุด เพื่อหลีกเลี่ยงชื่อซ้ำและลดจำนวน Expressions ของ Rules

---

## 3. ป้องกันการสร้าง Order ปลอม

แนวทางที่ปลอดภัยที่สุดคือปิดการสร้าง Order จาก Browser แล้วให้ `createOrder` Callable เป็นผู้คำนวณและเขียนข้อมูล

```firestore
match /orders/{orderId} {
  // อ่านต้องใช้เงื่อนไขของระบบจริง เช่น Customer, Rider ที่ได้รับงาน,
  // Merchant หรือ Admin
  allow read: if isOrderParty(orderId);

  // ห้าม Client สร้าง Order โดยตรง เพราะ Client อาจปลอมราคา,
  // merchantId, riderId หรือ paymentStatus
  allow create: if false;

  // ให้ Cloud Functions เป็นผู้สร้าง Order หลังจากคำนวณราคาแล้ว
  // Admin SDK จะ bypass Firestore Rules

  allow update: if isOrderParty(orderId)
    && serverOwnedOrderFieldsFrozen()
    && (
      // Customer ยกเลิกเฉพาะช่วงที่ยังไม่เริ่มงาน
      (
        isOrderCustomer(orderId)
        && resource.data.status in ['searching', 'pending']
        && request.resource.data.status == 'cancelled'
        && request.resource.data.cancelledBy == 'customer'
        && request.resource.data.cancelledAt is timestamp
        && request.resource.data.get('cancelReason', '') is string
        && request.resource.data.get('cancelReason', '').size() >= 1
        && request.resource.data.get('cancelReason', '').size() <= 300
        && onlyChanged(['status', 'cancelledBy', 'cancelledAt', 'cancelReason'])
      )

      // Rider เปลี่ยนได้เฉพาะ Field ที่เกี่ยวกับการเดินทาง
      || (
        isOrderRider(orderId)
        && resource.data.status in ['accepted', 'picked_up', 'on_the_way']
        && request.resource.data.status in ['picked_up', 'on_the_way', 'cancelled']
        && onlyChanged([
          'status',
          'pickedUpAt',
          'onTheWayAt',
          'cancelledBy',
          'cancelledAt',
          'cancelReason'
        ])
      )
    );

  // การจบงานต้องผ่าน completeOrder Callable เท่านั้น
  // เพราะต้องตรวจ Payment, Token, Rider assignment และ State Machine
  allow delete: if isAdmin();
}
```

ใน ChauatGo ปัจจุบันมี `allow create: if false` และมี `orderUpdateAllowed(orderId)` อยู่แล้ว ควรรักษาแนวทางนั้นไว้ และเพิ่ม Field สำคัญที่ต้อง Freeze ให้ครบถ้วนตาม Schema จริง

---

## 4. ป้องกันการปลอม Payment

### 4.1 Payment Ledger แบบ Server-owned

หาก Payment ถูกสร้างโดย Cloud Functions หรือ Payment Provider Webhook ให้ปิดการเขียนจาก Client ทั้งหมด

```firestore
match /payments/{paymentId} {
  allow read: if isAdmin()
    || (
      isAuth()
      && (
        resource.data.payerId == myUid()
        || resource.data.riderId == myUid()
      )
    );

  // ห้าม Client สร้าง Payment Ledger เอง
  allow create, update, delete: if false;
}
```

Client ต้องเรียก:

```text
createPaymentIntent
submitPaymentProof
confirmCashReceived
```

จากนั้น Cloud Function จึงสร้างหรือแก้ `payments/{paymentId}` ด้วย Admin SDK ภายใน Transaction

### 4.2 Payment Intent

ป้องกันการสร้าง QR หรือรายการจ่ายซ้ำจาก Client:

```firestore
match /payment_intents/{intentId} {
  allow read: if isAuth()
    && resource.data.payerId == myUid();

  // ปิดการเขียนโดยตรง เพื่อให้ Function คำนวณ amount จาก Order
  allow create, update, delete: if false;
}
```

### 4.3 หากจำเป็นต้องให้ Client อัปโหลดหลักฐานเอง

แนะนำให้ Client อัปโหลดไฟล์เข้า Storage แล้วเรียก Callable เพื่อสร้าง Payment Proof แทนการสร้าง Payment Document โดยตรง

ถ้าจำเป็นต้องเปิด `create` บน `payment_proofs` ให้จำกัดเฉพาะข้อมูลที่ไม่ใช่ผลการตรวจสอบ:

```firestore
match /payment_proofs/{proofId} {
  allow read: if isAdmin()
    || (isAuth() && resource.data.payerId == myUid());

  allow create: if isAuth()
    && request.resource.data.payerId == myUid()
    && request.resource.data.status == 'submitted'
    && request.resource.data.keys().hasOnly([
      'orderId',
      'payerId',
      'amountClaimed',
      'proofPath',
      'submittedAt',
      'status'
    ])
    && request.resource.data.orderId is string
    && request.resource.data.amountClaimed is number
    && request.resource.data.amountClaimed >= 0
    && request.resource.data.amountClaimed <= 1000000
    && request.resource.data.proofPath is string
    && request.resource.data.proofPath.matches(
      '^payment_proofs/' + myUid() + '/[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+$'
    )
    && request.resource.data.submittedAt is timestamp;

  // ห้าม Client เปลี่ยน submitted เป็น verified/rejected
  allow update, delete: if false;
}
```

`amountClaimed` เป็นเพียงยอดที่ผู้ใช้แจ้ง ไม่ใช่ยอดที่ระบบยืนยัน ห้ามนำไปตั้ง `paymentStatus=verified` โดยตรง

---

## 5. ป้องกัน Order จบโดยไม่ชำระเงิน

ไม่ควรให้ Rider หรือ Customer เปลี่ยน Order เป็น `completed` หรือ `done` ด้วยการเขียนตรง

```firestore
match /orders/{orderId} {
  allow update: if isOrderRider(orderId)
    && serverOwnedOrderFieldsFrozen()
    && request.resource.data.status == resource.data.status;

  // ไม่เปิด transition เป็น completed/done ใน Client Rules
  // ให้ completeOrder Callable ตรวจสอบแทน
}
```

Cloud Function `completeOrder` ควรตรวจสอบอย่างน้อย:

```javascript
if (order.riderId !== context.auth.uid) {
  throw new HttpsError('permission-denied', 'Not assigned rider');
}

if (!['payment_verified', 'cash_confirmed'].includes(payment.status)) {
  throw new HttpsError('failed-precondition', 'Payment is not confirmed');
}

if (order.status !== 'arrived_customer') {
  throw new HttpsError('failed-precondition', 'Invalid order state');
}
```

จากนั้นให้เขียน `payment`, `order`, `orders/{orderId}/events/{eventId}` และ `audit_logs/{eventId}` ใน Transaction เดียวกัน

---

## 6. ป้องกัน Rider ปลอมยอดจ่ายและยอดค้าง

สำหรับ `rider_remittances` ไม่ควรให้ Rider สร้างหรือแก้เอกสารโดยตรง เพราะสามารถแก้ `amountExpected`, `status` หรือ `verifiedAt` ได้

```firestore
match /rider_remittances/{remittanceId} {
  allow read: if isAdmin()
    || (isAuth() && resource.data.riderId == myUid());

  // ใช้ submitRiderRemittance Callable เท่านั้น
  allow create, update, delete: if false;
}
```

สำหรับ Order ที่ใช้คำนวณ Remittance ต้อง Freeze ฟิลด์เหล่านี้:

```firestore
function remittanceSourceFieldsFrozen() {
  return !request.resource.data.diff(resource.data).affectedKeys().hasAny([
    'riderIncome',
    'riderOwe',
    'riderPaid',
    'riderPaidAt',
    'fare',
    'total',
    'platformFee',
    'completedAt'
  ]);
}
```

เมื่อ Admin ตรวจสลิป ให้ `reviewRiderRemittance` เป็นผู้คำนวณยอดค้างจริงจาก Orders ใน Transaction และไม่ใช้ยอดสลิปเป็นยอดค้างโดยตรง

---

## 7. ป้องกันการปลอม Lock และ Risk Score

```firestore
match /riders/{riderId} {
  allow read: if isAdmin()
    || (isAuth() && myUid() == riderId);

  allow update: if isAdmin()
    || (
      isAuth()
      && myUid() == riderId
      && request.resource.data.diff(resource.data).affectedKeys().hasOnly([
        'status',
        'lastToggle',
        'fcmTokens'
      ])
      && request.resource.data.get('onlineLockedUntil', null)
        == resource.data.get('onlineLockedUntil', null)
      && request.resource.data.get('onlineLockReason', '')
        == resource.data.get('onlineLockReason', '')
      && request.resource.data.get('riskScore', 0)
        == resource.data.get('riskScore', 0)
      && request.resource.data.get('riskLevel', '')
        == resource.data.get('riskLevel', '')
      && request.resource.data.get('remittanceVerificationUntil', null)
        == resource.data.get('remittanceVerificationUntil', null)
    );
}
```

ข้อควรระวัง: ในระบบจริง `riderProfileWriteOk()` ของ ChauatGo มี Allowlist และ Freeze Lock Fields อยู่แล้ว ควรแก้ฟังก์ชันเดิม ไม่ควรสร้าง `match /riders/{riderId}` ซ้ำอีกชุดหนึ่ง

---

## 8. Audit Log และ Risk Events

ข้อมูลเหล่านี้ควรเขียนโดย Cloud Functions เท่านั้น

```firestore
match /audit_logs/{auditId} {
  allow read: if isAdmin();
  allow create, update, delete: if false;
}

match /risk_events/{eventId} {
  allow read: if isAdmin();
  allow create, update, delete: if false;
}

match /orders/{orderId}/events/{eventId} {
  allow read: if isOrderParty(orderId);
  allow create, update, delete: if false;
}
```

เหตุผลคือหาก Client สร้าง Audit เอง จะสามารถปลอมหลักฐานว่า Payment ผ่านหรืออ้างว่า Admin ปลดล็อกแล้วได้

---

## 9. ป้องกันการใช้ข้อมูลเก่าจาก Client

Rules ตรวจได้เฉพาะข้อมูลก่อนและหลังการเขียน แต่ไม่สามารถทำ Accounting หรือโหลด Order หลายรายการเพื่อคำนวณยอดใหม่ได้อย่างปลอดภัย

ดังนั้น Cloud Function ควรใช้ Transaction และตรวจ Version:

```javascript
await db.runTransaction(async (tx) => {
  const orderRef = db.doc(`orders/${orderId}`);
  const paymentRef = db.doc(`payments/${paymentId}`);

  const [orderSnap, paymentSnap] = await Promise.all([
    tx.get(orderRef),
    tx.get(paymentRef)
  ]);

  const order = orderSnap.data();
  const payment = paymentSnap.data();

  if (order.currentEventVersion !== expectedVersion) {
    throw new HttpsError('aborted', 'Order changed; retry with fresh data');
  }

  if (payment.status !== 'verified') {
    throw new HttpsError('failed-precondition', 'Payment is not verified');
  }

  tx.update(orderRef, {
    status: 'completed',
    completedAt: FieldValue.serverTimestamp(),
    currentEventVersion: order.currentEventVersion + 1
  });
});
```

Rules เป็นด่านความปลอดภัยชั้นแรก ส่วน Transaction/Idempotency/State Machine ใน Cloud Functions เป็นด่านหลักสำหรับป้องกัน Race Condition และข้อมูลเก่า

---

## 10. ตัวอย่างโครงสร้าง Rules ที่ควรมีใน ChauatGo

```firestore
service cloud.firestore {
  match /databases/{database}/documents {
    // Existing shared helpers:
    // isAuth(), myUid(), isAdmin(), isVerifiedRider(),
    // orderPath(), orderUpdateAllowed(), etc.

    match /orders/{orderId} {
      allow read: if canReadOrder();
      allow create: if false;
      allow update: if orderUpdateAllowed(orderId);
      allow delete: if isAdmin();
    }

    match /payments/{paymentId} {
      allow read: if isAdmin()
        || (isAuth() && (
          resource.data.payerId == myUid()
          || resource.data.riderId == myUid()
        ));
      allow create, update, delete: if false;
    }

    match /payment_intents/{intentId} {
      allow read: if isAuth()
        && resource.data.payerId == myUid();
      allow create, update, delete: if false;
    }

    match /rider_remittances/{remittanceId} {
      allow read: if isAdmin()
        || (isAuth() && resource.data.riderId == myUid());
      allow create, update, delete: if false;
    }

    match /rider_payouts/{payoutId} {
      allow read: if isAdmin();
      allow create, update, delete: if false;
    }

    match /risk_events/{eventId} {
      allow read: if isAdmin();
      allow create, update, delete: if false;
    }

    match /audit_logs/{auditId} {
      allow read: if isAdmin();
      allow create, update, delete: if false;
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

---

## 11. Rules ที่ไม่ควรเขียน

ไม่ควรใช้รูปแบบต่อไปนี้:

```firestore
// อันตราย: ให้ Rider เปลี่ยนยอดเอง
allow update: if isAuth()
  && request.resource.data.riderOwe == 0;
```

```firestore
// อันตราย: ให้ Customer ตั้ง Payment เป็น verified
allow update: if isOrderCustomer(orderId)
  && request.resource.data.paymentStatus == 'verified';
```

```firestore
// อันตราย: ใช้ยอดที่ Client ส่งมาแทนยอดที่ Server คำนวณ
allow create: if request.resource.data.amount == request.resource.data.total;
```

```firestore
// อันตราย: ให้ Rider แก้ Lock เอง
allow update: if isAuth()
  && myUid() == riderId
  && request.resource.data.onlineLockedUntil == null;
```

---

## 12. Test Cases ที่ควรเพิ่มใน Emulator

ควรมีอย่างน้อย:

```text
1. unauthenticated cannot create order
2. customer cannot set fare or total
3. rider cannot change riderIncome
4. rider cannot change riderOwe/riderPaid
5. customer cannot set paymentStatus=verified
6. customer cannot write payments ledger
7. rider cannot write rider_remittances directly
8. admin browser cannot write payment ledger directly
9. only callable/Admin SDK can write audit_logs
10. only assigned rider can perform permitted order transition
11. completed order cannot be changed back to on_the_way
12. stale client cannot overwrite current Order state
13. duplicate payment proof does not change verified payment
14. rider cannot clear onlineLockedUntil
15. customer cannot read another customer's payment
16. rider cannot read risk evidence of another rider
```

ตัวอย่างแนวคิดการทดสอบ:

```javascript
await assertFails(
  db.collection('orders').doc('order-1').set({
    userId: 'customer-1',
    fare: 1,
    total: 1,
    status: 'searching'
  })
);

await assertFails(
  db.collection('payments').doc('payment-1').set({
    orderId: 'order-1',
    status: 'verified',
    amountReceived: 1
  })
);

await assertFails(
  db.collection('rider_remittances').doc('rider-1_2026-11-20').set({
    riderId: 'rider-1',
    amountExpected: 0,
    status: 'verified'
  })
);
```

---

## 13. คำแนะนำสำหรับไฟล์ปัจจุบัน

จาก `firestore.rules` ของ ChauatGo ที่ตรวจสอบ:

- `orders` ปิด `create` จาก Client แล้ว
- มี `moneyFrozen()` ป้องกันการแก้ `fare`, `total`, `riderIncome`, `riderOwe` และ `riderPaid`
- `rider_remittances` ปิด `create/update/delete` จาก Client แล้ว
- `rider_payouts`, `rider_locks`, `settlement_queue` และ Audit-like collections ถูกปิดการเขียนจาก Client
- `riders` Freeze `onlineLockedUntil`, `onlineLockReason` และ `remittanceVerificationUntil` ใน `riderProfileWriteOk()`

ดังนั้นแนวทางที่ควรทำต่อคือเพิ่มหรือทบทวน:

1. Collection `payments` และ `payment_intents` ให้เป็น Server-owned อย่างชัดเจน
2. Collection `payment_proofs` ถ้าจะรองรับการแนบหลักฐานโดยตรง
3. `orders/{orderId}/events` แบบ append-only
4. `risk_events` และ `audit_logs`
5. Emulator Tests สำหรับ Payment Ledger และ stale/race writes
6. ตรวจ Storage Rules ให้ `proofPath` ผูกกับ User และ Order เดียวกัน

## สรุป

Firestore Rules ควรทำหน้าที่เป็น **ด่านปิดการเขียนข้อมูลสำคัญจาก Client** ไม่ใช่เป็นระบบคำนวณเงินหลัก โดยให้ Cloud Functions รับผิดชอบการคำนวณ, Transaction, Idempotency, Payment Verification, Complete Order และ Auto-lock ส่วน Rules จะบังคับว่า Client ไม่สามารถปลอมผลลัพธ์เหล่านั้นได้
