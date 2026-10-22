# โครงสร้างฐานข้อมูล Consent Log และ Privacy Notice
## สำหรับ ChauatGo บน Firebase Firestore

> **สถานะ:** แบบออกแบบสำหรับนำไปตรวจสอบและพัฒนา  
> **เวอร์ชัน Schema:** 1.0  
> **วันที่:** 22 ตุลาคม 2569

เอกสารนี้ออกแบบสำหรับเก็บหลักฐานว่าใครได้รับแจ้ง Privacy Notice ฉบับใด เมื่อใด และให้/ถอนความยินยอมเรื่องใด ผ่านช่องทางใด โดยแยกข้อมูลของลูกค้า ไรเดอร์ และร้านค้าออกจากกันในระดับบทบาท แต่ยังรองรับกรณีบุคคลเดียวกันมีหลายบทบาท

## 1. หลักการออกแบบ

### 1.1 แยก “รับทราบ” กับ “ยินยอม”

การรับทราบ Privacy Notice เป็นหลักฐานว่าได้แสดงหรือแจ้งรายละเอียดให้ผู้ใช้ทราบ ส่วน Consent เป็นการแสดงเจตนาอนุญาตให้ประมวลผลในวัตถุประสงค์ที่ต้องอาศัยความยินยอม ทั้งสองอย่างไม่ควรบันทึกด้วย Boolean เดียวกัน

- `notice_acknowledgement`: ผู้ใช้ได้รับและรับทราบประกาศฉบับใด
- `consent_granted`: ผู้ใช้ยินยอมกิจกรรมใด
- `consent_withdrawn`: ผู้ใช้ถอนความยินยอมกิจกรรมใด
- `consent_rejected`: ผู้ใช้ปฏิเสธกิจกรรมใด หากระบบมีปุ่มปฏิเสธ
- `consent_expired`: ความยินยอมหมดอายุตามเงื่อนไขที่กำหนด

### 1.2 เก็บเป็น Event Log แบบเพิ่มอย่างเดียว

ไม่ควรแก้ไขเอกสาร Consent เดิมเพื่อเปลี่ยน `granted` เป็น `false` เพราะจะทำลายหลักฐานประวัติ ให้สร้าง Event ใหม่เมื่อถอนหรือเปลี่ยนความยินยอม แล้วคำนวณสถานะปัจจุบันจาก Event ล่าสุด

### 1.3 ใช้ Version และ Snapshot

ทุก Event ต้องอ้างอิง `policyVersion` หรือ `noticeVersion` และเก็บ Snapshot ของข้อความ/Hash ที่ผู้ใช้เห็นในเวลานั้น เพื่อพิสูจน์ว่าได้แสดงข้อความฉบับใด แม้เอกสารต้นฉบับจะถูกปรับปรุงภายหลัง

### 1.4 เก็บข้อมูลเท่าที่จำเป็น

เก็บ `subjectRef` แบบสุ่มหรือ Firebase Auth UID ที่เข้ารหัสตามนโยบาย หลีกเลี่ยงการเก็บเลขบัตรประชาชน เบอร์โทรศัพท์ หรือข้อมูลส่วนบุคคลเต็มชุดใน Consent Log หากไม่จำเป็นต่อการพิสูจน์หลักฐาน

---

## 2. โครงสร้าง Collections

แนะนำให้ใช้โครงสร้างดังนี้

```text
consent_policies/{policyId}
privacy_notices/{noticeId}
consent_events/{eventId}
consent_current/{subjectKey}/items/{purposeCode}
consent_requests/{requestId}
consent_audit_exports/{exportId}
```

### 2.1 `consent_policies/{policyId}`

เก็บ Metadata ของวัตถุประสงค์และข้อความ Consent ที่อนุมัติแล้ว ไม่ควรให้ Client แก้ไข

```json
{
  "policyId": "location_during_delivery",
  "policyType": "consent",
  "purposeCode": "rider.location.during_active_job",
  "titleTh": "การใช้ตำแหน่งของไรเดอร์ระหว่างรับงาน",
  "descriptionTh": "ใช้ตำแหน่งเพื่อคำนวณเส้นทาง แสดงสถานะงาน และจัดการความปลอดภัย",
  "dataCategories": ["precise_location", "route", "device_identifier"],
  "subjectTypes": ["rider"],
  "legalBasis": "consent",
  "isRequiredForService": true,
  "requiresExplicitConsent": false,
  "requiresGuardianConsent": false,
  "version": "1.0",
  "textHash": "sha256:...",
  "effectiveFrom": "2026-10-22T00:00:00+07:00",
  "effectiveUntil": null,
  "status": "published",
  "createdBy": "adminUid",
  "approvedBy": "privacyOwnerUid",
  "createdAt": "server_timestamp",
  "updatedAt": "server_timestamp"
}
```

ค่าที่ควรกำหนด:

- `legalBasis`: `consent`, `contract`, `legal_obligation`, `legitimate_interest`, `vital_interest`, `public_task`
- `subjectTypes`: `customer`, `rider`, `merchant`, `staff`, `representative`
- `isRequiredForService`: ใช้บอกผลกระทบหากปฏิเสธ ไม่ใช่เหตุให้บังคับ Consent ที่กฎหมายไม่ต้องการ
- `requiresExplicitConsent`: ใช้กับกรณีที่ต้องแสดงความยินยอมโดยชัดแจ้ง เช่น ข้อมูลอ่อนไหวตามกฎหมาย
- `status`: `draft`, `published`, `retired`

### 2.2 `privacy_notices/{noticeId}`

เก็บประกาศความเป็นส่วนตัวที่นำไปแสดง เช่น General Privacy Notice, Rider Privacy Notice และ Merchant Privacy Notice

```json
{
  "noticeId": "rider_privacy_notice",
  "noticeType": "privacy_notice",
  "audience": "rider",
  "titleTh": "ประกาศความเป็นส่วนตัวสำหรับไรเดอร์",
  "version": "1.0",
  "contentUrl": "/privacy/rider",
  "contentHash": "sha256:...",
  "summaryTh": "แจ้งการเก็บ ใช้ และเปิดเผยข้อมูลของไรเดอร์",
  "effectiveFrom": "2026-10-22T00:00:00+07:00",
  "effectiveUntil": null,
  "requiresReacknowledgement": true,
  "status": "published",
  "approvedBy": "privacyOwnerUid",
  "createdAt": "server_timestamp",
  "updatedAt": "server_timestamp"
}
```

### 2.3 `consent_events/{eventId}`

เป็น Collection หลักสำหรับหลักฐานแบบ Append-only ทุก Event ต้องมี `eventId` ใหม่ ไม่แก้ไข Event เก่าใน Client

```json
{
  "eventId": "evt_01J...",
  "subjectRef": "authUidOrPseudonymousId",
  "subjectType": "rider",
  "roleInstanceId": "riderProfileId",
  "eventType": "consent_granted",
  "purposeCode": "rider.location.during_active_job",
  "policyId": "location_during_delivery",
  "policyVersion": "1.0",
  "policyTextHash": "sha256:...",
  "noticeId": "rider_privacy_notice",
  "noticeVersion": "1.0",
  "noticeAcknowledged": true,
  "consentValue": true,
  "explicitConsent": false,
  "collectionContext": "rider_onboarding",
  "source": "web_app",
  "channel": "in_app_modal",
  "locale": "th-TH",
  "deviceClass": "mobile",
  "userAgentHash": "sha256:...",
  "ipHash": "sha256:...",
  "actorType": "data_subject",
  "actorRef": "authUidOrPseudonymousId",
  "representativeRef": null,
  "guardianVerified": false,
  "eventAt": "server_timestamp",
  "receivedAt": "server_timestamp",
  "withdrawalEffectiveAt": null,
  "supersedesEventId": null,
  "correlationId": "onboarding_...",
  "idempotencyKey": "uid|purpose|version|action|nonce",
  "createdBy": "cloud_function",
  "integrityHash": "sha256:..."
}
```

### 2.4 `consent_current/{subjectKey}/items/{purposeCode}`

เป็น Read Model สำหรับตรวจสถานะปัจจุบันอย่างรวดเร็ว ไม่ใช่หลักฐานต้นฉบับ โดยสร้าง/อัปเดตจาก Trusted Backend หรือ Cloud Function ที่อ่าน `consent_events`

`subjectKey` ควรเป็นค่าที่ไม่เปิดเผยบทบาทโดยตรง เช่น Hash ของ `subjectRef + roleInstanceId` หรือใช้ UID ที่ Firestore Rules ป้องกันอย่างเข้มงวด

```json
{
  "subjectRef": "authUidOrPseudonymousId",
  "subjectType": "rider",
  "roleInstanceId": "riderProfileId",
  "purposeCode": "rider.location.during_active_job",
  "status": "granted",
  "currentEventId": "evt_01J...",
  "currentPolicyVersion": "1.0",
  "currentNoticeVersion": "1.0",
  "grantedAt": "server_timestamp",
  "withdrawnAt": null,
  "expiresAt": null,
  "lastEvaluatedAt": "server_timestamp",
  "source": "derived_from_consent_events"
}
```

ค่าของ `status`:

- `granted`
- `withdrawn`
- `rejected`
- `expired`
- `not_recorded`
- `superseded`
- `blocked_pending_verification`

### 2.5 `consent_requests/{requestId}`

ใช้สำหรับคำขอที่ต้องทำงานหลายขั้นตอน เช่น การส่ง Consent ใหม่เมื่อ Policy เปลี่ยน การยืนยันผู้แทน หรือการขอ Consent โดยชัดแจ้ง

```json
{
  "requestId": "req_01J...",
  "subjectRef": "authUidOrPseudonymousId",
  "subjectType": "merchant",
  "purposeCodes": ["merchant.order.processing", "merchant.payout"],
  "noticeId": "merchant_privacy_notice",
  "noticeVersion": "1.0",
  "requestedAt": "server_timestamp",
  "status": "pending",
  "expiresAt": "server_timestamp",
  "completedEventIds": [],
  "requestedBy": "system",
  "createdAt": "server_timestamp"
}
```

### 2.6 `consent_audit_exports/{exportId}`

ใช้บันทึกการส่งออกหลักฐานให้ Privacy Lead, DSAR หรือหน่วยงานที่มีอำนาจ ไม่ควรเก็บไฟล์ข้อมูลดิบไว้ใน Collection นี้

```json
{
  "exportId": "exp_01J...",
  "reason": "dsar_request",
  "dsarId": "CG-DSAR-20261022-001",
  "requestedBy": "privacyOwnerUid",
  "approvedBy": "approverUid",
  "subjectRef": "authUidOrPseudonymousId",
  "eventCount": 8,
  "exportFormat": "encrypted_json",
  "storagePath": "restricted/consent-exports/exp_01J...",
  "fileHash": "sha256:...",
  "expiresAt": "server_timestamp",
  "deletedAt": null,
  "createdAt": "server_timestamp"
}
```

---

## 3. ค่า `eventType` ที่ควรรองรับ

```text
notice_presented
notice_acknowledged
consent_granted
consent_rejected
consent_withdrawn
consent_expired
consent_superseded
consent_reconfirmed
explicit_consent_granted
guardian_consent_granted
consent_verification_failed
```

`notice_presented` ใช้เมื่อระบบแสดงประกาศ แต่ผู้ใช้ยังไม่ได้กดรับทราบ ส่วน `notice_acknowledged` ใช้เมื่อผู้ใช้กดยืนยันว่าได้รับทราบแล้ว หากระบบพิสูจน์ได้เพียงว่าประกาศถูกแสดง แต่ไม่มีการกดรับทราบ ต้องไม่บันทึกเป็น Consent

---

## 4. Purpose Code ที่แนะนำสำหรับ ChauatGo

### ลูกค้า

```text
customer.account.service
customer.order.processing
customer.delivery.contact
customer.location.selected_for_delivery
customer.photo.upload_for_order
customer.service_notifications
customer.marketing
customer.analytics_optional
```

### ไรเดอร์

```text
rider.onboarding
rider.identity_verification
rider.vehicle_verification
rider.location.during_active_job
rider.payout.accounting
rider.performance_and_safety
rider.service_notifications
rider.marketing
rider.background_check
rider.biometric_verification
```

`rider.background_check` และ `rider.biometric_verification` ต้องเปิดใช้เฉพาะเมื่อมีฐานกฎหมายและการตรวจสอบที่เหมาะสม ไม่ควรสร้างช่อง Consent ไว้แล้วเก็บข้อมูลโดยอัตโนมัติ

### ร้านค้า

```text
merchant.onboarding
merchant.order_processing
merchant.payout.accounting
merchant.store_profile_public_listing
merchant.contact_for_operations
merchant.photo_upload
merchant.service_notifications
merchant.marketing
```

---

## 5. การรองรับผู้ใช้หลายบทบาท

บุคคลหนึ่งอาจเป็นทั้งลูกค้า ไรเดอร์ และผู้ดูแลร้าน จึงไม่ควรใช้เพียง `subjectType` เป็นตัวระบุสถานะทั้งหมด แนะนำให้ใช้:

- `subjectRef`: บุคคล/บัญชีหลัก
- `subjectType`: บทบาทขณะเกิด Event
- `roleInstanceId`: รหัสโปรไฟล์บทบาท เช่น `riderProfileId` หรือ `merchantId`
- `purposeCode`: วัตถุประสงค์เฉพาะบทบาท

ตัวอย่างเดียวกัน:

```text
UID เดียวกัน + customer + customer.location.selected_for_delivery
UID เดียวกัน + rider + rider.location.during_active_job
UID เดียวกัน + merchant + merchant.order_processing
```

การถอน Consent ในบทบาทไรเดอร์ต้องไม่ถอน Consent ในบทบาทลูกค้าโดยอัตโนมัติ เว้นแต่ Policy ระบุความเชื่อมโยงไว้อย่างชัดเจน

---

## 6. การรับทราบ Privacy Notice ใหม่

เมื่อมี Notice เวอร์ชันใหม่ ให้สร้าง `notice_presented` และ `notice_acknowledged` ใหม่โดยไม่แก้ Event เดิม

```json
{
  "eventType": "notice_acknowledged",
  "noticeId": "general_privacy_notice",
  "noticeVersion": "2.0",
  "policyTextHash": "sha256:new...",
  "subjectType": "customer",
  "collectionContext": "policy_reconfirmation",
  "previousNoticeVersion": "1.0",
  "eventAt": "server_timestamp"
}
```

ระบบควรกำหนดว่า Notice ใหม่ต้องทำอะไร:

- `inform_only`: แจ้งให้ทราบ ไม่ต้องกดยินยอมใหม่
- `acknowledgement_required`: ต้องกดรับทราบก่อนใช้ฟังก์ชันต่อ
- `consent_reconfirmation_required`: ต้องขอ Consent ใหม่เฉพาะวัตถุประสงค์ที่เปลี่ยน
- `service_blocked_until_action`: ระงับเฉพาะฟังก์ชันที่จำเป็น ไม่ควรปิดทั้งบัญชีโดยไม่จำเป็น

---

## 7. กรณีผู้แทน ผู้ปกครอง หรือผู้มีอำนาจ

หากยินยอมผ่านผู้แทน ต้องเก็บหลักฐานความสัมพันธ์และการตรวจสอบแยกจาก Event ของเจ้าของข้อมูล

```json
{
  "eventType": "guardian_consent_granted",
  "subjectRef": "dataSubjectUid",
  "subjectType": "customer",
  "actorType": "guardian",
  "actorRef": "verifiedGuardianRef",
  "representativeRef": "rep_01J...",
  "guardianVerified": true,
  "verificationMethod": "manual_review",
  "verificationEvidenceRef": "restricted/representative/rep_01J...",
  "purposeCode": "customer.photo.upload_for_order",
  "eventAt": "server_timestamp"
}
```

เก็บ `verificationEvidenceRef` เป็นเส้นทางจำกัดสิทธิ์ ไม่ฝังสำเนาบัตรหรือเอกสารลงใน Event Log โดยตรง

---

## 8. Firestore Security Rules แนวทางขั้นต่ำ

หลักการสำคัญคือ Client ไม่ควรเขียน `consent_events` โดยตรง เพราะอาจแก้ `eventAt`, `subjectRef`, `policyVersion` หรือ `consentValue` ได้ ให้ Client เรียก Cloud Function/Backend ที่ตรวจสอบข้อมูลแล้วเขียนด้วย Service Account

ตัวอย่างแนวทางเชิงโครงสร้าง ไม่ใช่ Rules ที่นำไปใช้ได้ทันที:

```text
consent_policies:
  read: published policy ตาม audience
  write: privacy_admin เท่านั้น

privacy_notices:
  read: published notice ตาม audience
  write: privacy_admin เท่านั้น

consent_events:
  read: เจ้าของข้อมูลเห็นเฉพาะ Event ของตน หรือ privacy_admin ตามเหตุผล
  create: trusted_backend เท่านั้น
  update: ปฏิเสธทุกกรณี
  delete: ปฏิเสธจาก Client ทุกกรณี

consent_current:
  read: เจ้าของข้อมูลอ่านได้เฉพาะของตน; ระบบภายในตาม Role
  write: trusted_backend เท่านั้น

consent_audit_exports:
  read/write: privacy_admin หรือ service account ที่กำหนด
  public access: ปฏิเสธทุกกรณี
```

หากต้องอนุญาตให้ Client สร้าง Event โดยตรง ต้องตรวจใน Rules อย่างน้อยว่า UID ตรงกับ `subjectRef`, ค่า Event อยู่ในรายการที่อนุญาต, Policy เป็น `published`, Timestamp เป็น Server Timestamp, ห้าม Update/Delete และป้องกัน Replay ด้วย `idempotencyKey` อย่างไรก็ตาม Trusted Backend ยังปลอดภัยกว่า

---

## 9. Indexes ที่ควรเตรียม

- `consent_events`: `subjectRef + subjectType + purposeCode + eventAt desc`
- `consent_events`: `subjectRef + eventType + eventAt desc`
- `consent_events`: `policyId + policyVersion + eventAt desc`
- `consent_events`: `noticeId + noticeVersion + eventAt desc`
- `consent_events`: `correlationId + eventAt desc`
- `consent_current`: `subjectRef + subjectType + status`
- `consent_requests`: `status + expiresAt`

หลีกเลี่ยงการทำ Index กับข้อมูลที่เป็นข้อความยาว เช่น `policyTextSnapshot` หรือข้อมูลที่ไม่ใช้ค้นหา

---

## 10. ความถูกต้องและการป้องกันการแก้ไขย้อนหลัง

- ใช้ `serverTimestamp()` แทนเวลาจากเครื่องผู้ใช้เป็นเวลาหลัก
- เก็บ `policyTextHash` และ `noticeTextHash` เพื่อพิสูจน์ข้อความที่แสดง
- ใช้ `integrityHash` ของ Event ตามรูปแบบที่ทีม Security อนุมัติ
- ใช้ `idempotencyKey` ป้องกัน Event ซ้ำเมื่อผู้ใช้กดปุ่มซ้ำหรือเครือข่ายส่งซ้ำ
- ไม่เก็บ IP หรือ User-Agent แบบเต็มโดยอัตโนมัติ หากไม่จำเป็น ให้ Hash หรือเก็บเฉพาะข้อมูลความปลอดภัยที่จำเป็น
- บันทึก `source`, `channel`, `locale`, และ `collectionContext` เพื่ออธิบายบริบท
- ห้ามให้ Admin แก้ Event เดิม ถ้าพบข้อผิดพลาดให้สร้าง `consent_correction` หรือ Event ใหม่พร้อมเหตุผล
- บันทึกการเข้าถึงและการส่งออก Consent Log แยกต่างหาก

---

## 11. Retention ของ Consent Log

Consent Log อาจต้องเก็บนานกว่าข้อมูลที่ใช้ในบริการ เพื่อพิสูจน์ว่าการเก็บ ใช้ หรือเปิดเผยข้อมูลมีฐานและมีการแจ้งที่เหมาะสม แต่ไม่ควรเก็บโดยไม่มีกำหนด

ให้กำหนด Retention Register แยกสำหรับ:

- Event การให้และถอน Consent
- Event การรับทราบ Privacy Notice
- ข้อความ/Hash ของ Policy Version
- หลักฐานผู้แทนหรือการตรวจสอบเพิ่มเติม
- Export ที่ใช้ตอบ DSAR หรือการตรวจสอบ

เมื่อหมดอายุ:

1. ตรวจ Legal Hold, DSAR, ข้อพิพาท และหน้าที่ตามกฎหมาย
2. ลบข้อมูลที่ระบุตัวบุคคลจาก Event หากยังสามารถเก็บหลักฐานแบบนิรนามได้
3. ลบไฟล์หลักฐานและ Export ที่หมดความจำเป็น
4. อัปเดต `consent_current` ให้เป็น `not_recorded` หรือ `expired` ตามเหตุผล
5. เก็บ Delete Audit Record โดยไม่เก็บข้อมูลดิบเกินจำเป็น

---

## 12. ตัวอย่าง Flow การบันทึก

### 12.1 ลูกค้ารับทราบ Notice ครั้งแรก

1. Backend เลือก `general_privacy_notice` เวอร์ชันที่ Published
2. แสดง Summary และ Link ให้ลูกค้าอ่าน
3. ลูกค้ากด `รับทราบและเข้าสู่แอป`
4. Backend สร้าง `notice_presented` และ `notice_acknowledged`
5. ไม่สร้าง `consent_granted` สำหรับ GPS หรือการตลาดโดยอัตโนมัติ
6. เมื่อใช้ GPS หรือการตลาดจริง ให้แสดง Consent แยกและสร้าง Event เฉพาะ Purpose

### 12.2 ไรเดอร์ถอน GPS

1. ไรเดอร์กดถอนหรือปิดสิทธิ์ GPS
2. Backend ตรวจสอบตัวตนและสร้าง `consent_withdrawn`
3. อัปเดต `consent_current` เป็น `withdrawn`
4. หยุดการสร้าง Location Event ใหม่
5. แจ้งผลกระทบ เช่น ไม่สามารถรับงานที่ต้องใช้ GPS อัตโนมัติ
6. ให้ยังเก็บ Event หลักฐานการถอนตาม Retention Policy

### 12.3 ร้านค้ารับ Notice เวอร์ชันใหม่

1. ระบบพบว่า `merchant_privacy_notice` เวอร์ชันปัจจุบันของร้านต่ำกว่าเวอร์ชัน Published
2. สร้าง `consent_request`
3. แสดงเฉพาะ Notice/Consent ที่เปลี่ยน ไม่บังคับให้ยอมรับวัตถุประสงค์เดิมทั้งหมดใหม่โดยไม่จำเป็น
4. หลังร้านกดยืนยัน สร้าง `notice_acknowledged` และ Consent ใหม่เฉพาะ Purpose ที่เปลี่ยน

---

## 13. Access Control สำหรับ Consent Log

- [ ] ลูกค้า/ไรเดอร์/ร้านค้าอ่านได้เฉพาะสถานะของตน ไม่เห็น Event ของบุคคลอื่น
- [ ] ทีมบริการลูกค้าเห็นเฉพาะสถานะและ Event ที่จำเป็นต่อ Ticket
- [ ] Privacy Lead เห็น Event เต็มตามเหตุผลและมี Audit Log
- [ ] Developer ใช้ข้อมูลจำลองใน Development และห้ามเปิดข้อมูลจริงผ่าน Console
- [ ] Admin สร้างหรือ Export ได้เฉพาะเมื่อมีเหตุผลและผู้อนุมัติ
- [ ] ห้ามแก้ไขหรือลบ Event เดิมจาก Client
- [ ] Export ต้องเข้ารหัส มีวันหมดอายุ และลบเมื่อเสร็จงาน
- [ ] ตรวจสิทธิ์อย่างน้อยทุกไตรมาส
- [ ] ถอนสิทธิ์ทันทีเมื่อผู้ปฏิบัติงานย้ายหน้าที่หรือพ้นสภาพ

---

## 14. เช็กลิสต์ก่อนใช้งานจริง

- [ ] อนุมัติรายการ Purpose Code และฐานการประมวลผลกับ Privacy Lead
- [ ] สร้าง Policy/Notice Version จาก Backend ไม่ให้ Client กำหนดเอง
- [ ] ตั้ง Cloud Function สำหรับสร้าง Event แบบ Append-only
- [ ] ตั้ง `consent_current` เป็น Read Model จาก Event
- [ ] ทดสอบการให้ Consent ถอน Consent และเปลี่ยน Version
- [ ] ทดสอบการกดซ้ำ เครือข่ายขาด และ Replay Request
- [ ] ทดสอบกรณีผู้ใช้คนเดียวมีหลายบทบาท
- [ ] ทดสอบการยื่น DSAR และการ Export หลักฐาน
- [ ] ตรวจ Firestore Rules, Storage Rules และ Service Account
- [ ] กำหนด Retention และ Delete Job ของ Consent Log
- [ ] บันทึก Audit Log การอ่านและ Export
- [ ] ทดสอบกรณี Policy ถูกถอนหรือ Retired
- [ ] จัดทำเอกสาร Data Dictionary และ Runbook สำหรับทีม

---

## 15. Data Dictionary ขั้นต่ำ

| Field | ประเภท | จำเป็น | คำอธิบาย |
|---|---|---:|---|
| `eventId` | string | ใช่ | รหัส Event แบบไม่ซ้ำ |
| `subjectRef` | string | ใช่ | UID/ตัวอ้างอิงแบบจำกัดการเปิดเผย |
| `subjectType` | enum | ใช่ | customer/rider/merchant |
| `eventType` | enum | ใช่ | ประเภท Event |
| `purposeCode` | string | ใช่ | วัตถุประสงค์เฉพาะ |
| `policyVersion` | string | ใช่ | Version ของ Consent Text |
| `noticeVersion` | string | อาจมี | Version ของ Privacy Notice |
| `legalBasis` | enum | ใช่ | ฐานการประมวลผล |
| `consentValue` | boolean/null | อาจมี | ค่า Consent เมื่อ Event เกี่ยวกับ Consent |
| `source` | enum | ใช่ | web_app/mobile/backend/admin |
| `channel` | enum | ใช่ | modal/settings/onboarding/etc. |
| `eventAt` | timestamp | ใช่ | Server Timestamp |
| `correlationId` | string | แนะนำ | เชื่อม Onboarding/Job/DSAR |
| `idempotencyKey` | string | แนะนำ | ป้องกัน Event ซ้ำ |
| `policyTextHash` | string | แนะนำ | Hash ของข้อความที่แสดง |
| `integrityHash` | string | แนะนำ | Hash ป้องกันการแก้ไขย้อนหลัง |

---

## หมายเหตุด้านการปฏิบัติตาม PDPA

Schema นี้เป็นกลไกเก็บหลักฐาน ไม่ได้ทำให้การเก็บ ใช้ หรือเปิดเผยข้อมูลถูกต้องโดยอัตโนมัติ ทีม ChauatGo ยังต้องตรวจว่าได้แจ้งวัตถุประสงค์ ฐานการประมวลผล ผู้รับข้อมูล ระยะเวลาเก็บรักษา และสิทธิของเจ้าของข้อมูลครบถ้วนหรือไม่ รวมถึงต้องจัดทำ Access Control, Retention Policy, DSAR Procedure และ Incident Response ให้ทำงานร่วมกัน
