# Firebase Production Deploy Runbook หลัง Merge PR #42

โปรเจกต์: `chauat-go-b9841`

PR: [#42](https://github.com/nareeratrain-code/ChauatGo/pull/42)

สถานะตอนจัดทำเอกสาร: PR ยังเป็น `OPEN` และยังไม่ได้ Merge จึงยังไม่ควรรันคำสั่ง Production Deploy

## ขอบเขตที่ PR #42 ต้อง Deploy

หลัง Merge แล้ว PR นี้มีการเปลี่ยนแปลงที่เกี่ยวข้องกับ Firebase ดังนี้:

- Cloud Functions ใน `functions/`
- Firestore Rules ใน `firestore.rules`
- Firestore Indexes ใน `firestore.indexes.json`
- Cloud Storage Rules ใน `storage.rules`
- `firebase.json` เพิ่มการผูก Storage Rules และ Storage Emulator

โปรเจกต์ไม่มี Hosting Target ใน `firebase.json` ดังนั้นคำสั่งนี้ไม่ควร Deploy Hosting โดยไม่จำเป็น

## 0. เงื่อนไขก่อนเริ่ม

ให้ดำเนินการตามลำดับนี้ก่อน:

1. Merge PR #42 เข้า `main`
2. รอ GitHub Checks หลัง Merge ผ่านทั้งหมด
3. ตรวจว่า `main` มี Commit ของ PR #42 แล้ว
4. ตรวจว่า Firebase CLI Login อยู่ในบัญชี/โปรเจกต์ที่ถูกต้อง
5. สำรองไฟล์ Rules ปัจจุบันก่อน Publish Rules ใหม่
6. ตรวจว่าโปรเจกต์ใช้แผน Blaze และมีสิทธิ์ Deploy Functions/Rules/Storage

ตรวจ PR และ Merge Status:

```bash
gh pr view 42 --json state,mergedAt,mergeCommit,baseRefName,headRefOid,url
```

ผลที่ต้องเห็นก่อน Deploy:

```text
state: MERGED
mergedAt: ไม่เป็น null
baseRefName: main
```

## 1. เตรียม Source หลัง Merge

```bash
cd /path/to/ChauatGo

git fetch origin main
git switch main
git pull --ff-only origin main

git status --short
git log -1 --oneline --decorate
```

`git status --short` ควรว่าง หรือไม่มีไฟล์ที่อาจทำให้การตรวจสอบสับสน

ตรวจว่ามีไฟล์สำคัญครบ:

```bash
test -s firebase.json
test -s .firebaserc
test -s functions/package.json
test -s firestore.rules
test -s firestore.indexes.json
test -s storage.rules
```

ตรวจ Project Alias:

```bash
cat .firebaserc
firebase use chauat-go-b9841
```

ตรวจให้แน่ใจว่า CLI ชี้ไปที่:

```text
chauat-go-b9841
```

## 2. รัน Pre-deploy Tests

```bash
npm ci
npm run build
node --test tests/*.test.js
npm ci --prefix functions
npm test --prefix functions
```

รัน Emulator Test สำหรับ Functions และ Storage Rules:

```bash
npm run test:emu --prefix functions
```

ผลขั้นต่ำที่คาดหวังจาก PR #42 ที่ตรวจไว้แล้ว:

- Root Tests: 54/54 ผ่าน
- Functions/Dispatch Emulator: 17/17 ผ่าน
- Storage Rules Emulator: 1/1 ผ่าน
- Rider Job Filter E2E: 4/4 ผ่าน
- Negative E2E: 4/4 ผ่าน

## 3. สำรอง Rules ปัจจุบัน

ก่อน Publish Rules ใหม่ ให้สำรอง Rules ที่ใช้งานอยู่จาก Firebase Console หรือใช้คำสั่ง CLI ที่รองรับในเวอร์ชันที่ติดตั้งอยู่ จากนั้นเก็บสำเนาไว้นอก Working Tree เช่น:

```bash
mkdir -p /tmp/chauatgo-firebase-rules-backup-$(date +%Y%m%d-%H%M%S)
cp firestore.rules /tmp/chauatgo-firebase-rules-backup-$(date +%Y%m%d-%H%M%S)/firestore.rules.repo
cp storage.rules /tmp/chauatgo-firebase-rules-backup-$(date +%Y%m%d-%H%M%S)/storage.rules.repo
cp firestore.indexes.json /tmp/chauatgo-firebase-rules-backup-$(date +%Y%m%d-%H%M%S)/firestore.indexes.json.repo
```

หมายเหตุ: สำเนาในคำสั่งด้านบนคือไฟล์จาก Commit ที่กำลังจะ Deploy ไม่ใช่ Snapshot จาก Server หากต้องการ Rollback อย่างแม่นยำ ให้ Export/คัดลอก Rules ปัจจุบันจาก Firebase Console เก็บไว้อีกชุดก่อนกด Publish

## 4. ตรวจสอบสิทธิ์และบัญชี Firebase

สำหรับการรันจากเครื่องที่ Login อยู่แล้ว:

```bash
firebase login
firebase projects:list
firebase use chauat-go-b9841
```

ไม่ควรใช้บัญชีส่วนตัวที่ไม่มีสิทธิ์ Admin/Editor ของโปรเจกต์ เพราะ Deploy Functions และ Rules อาจสำเร็จบางส่วนแล้วล้มเหลวในขั้นถัดไป

สำหรับ GitHub Actions ต้องตั้ง Secret ชื่อ:

```text
FIREBASE_SERVICE_ACCOUNT
```

เป็น JSON ของ Service Account ที่มีสิทธิ์ Deploy Functions, Firestore Rules/Indexes และ Storage Rules ตามขอบเขตที่ต้องการ

## 5. คำสั่ง Deploy Production แบบครบชุด

เมื่อ Merge แล้วและ Pre-deploy Tests ผ่าน ให้รันจาก Root Repository:

```bash
firebase deploy \
  --only functions,firestore:rules,firestore:indexes,storage \
  --project chauat-go-b9841 \
  --non-interactive \
  --force
```

คำสั่งนี้ Deploy:

- Functions ทั้งหมดที่ Export ใน `functions/index.js`
- Firestore Rules
- Firestore Indexes
- Storage Rules

คำสั่งนี้ไม่ Deploy Vercel และไม่ Deploy Hosting เพราะ `firebase.json` ไม่มี Hosting Configuration

## 6. หากต้องการ Deploy แบบแยกขั้นเพื่อควบคุมความเสี่ยง

แนะนำให้ Deploy แยกเป็น 3 กลุ่มและตรวจผลทุกขั้น:

### 6.1 Deploy Functions และ Indexes

```bash
firebase deploy \
  --only functions,firestore:indexes \
  --project chauat-go-b9841 \
  --non-interactive \
  --force
```

### 6.2 Deploy Firestore Rules

```bash
firebase deploy \
  --only firestore:rules \
  --project chauat-go-b9841 \
  --non-interactive
```

### 6.3 Deploy Storage Rules

```bash
firebase deploy \
  --only storage \
  --project chauat-go-b9841 \
  --non-interactive
```

การแยกขั้นช่วยให้ระบุได้ว่าปัญหาเกิดจาก Functions, Firestore หรือ Storage แต่ละขั้นอาจใช้เวลาหลายนาที และไม่ควรสั่งซ้ำทันทีหาก CLI แสดง Timeout โดยยังไม่ทราบว่า Server ประมวลผลเสร็จหรือไม่

## 7. GitHub Actions ที่มีอยู่ใน Repository

ไฟล์ `.github/workflows/deploy-functions.yml` ใน PR ปัจจุบันใช้คำสั่ง:

```bash
firebase deploy --only functions,firestore:indexes --project chauat-go-b9841 --non-interactive --force
```

ดังนั้น Workflow นี้ Deploy เฉพาะ:

- Functions
- Firestore Indexes

และ **ยังไม่ Deploy**:

- Firestore Rules
- Storage Rules

หากทีมต้องการให้ Workflow เป็นช่องทาง Deploy ครบชุด ควรแก้คำสั่งใน Workflow หลัง Merge เป็น:

```yaml
- name: Deploy functions, rules, indexes, and storage
  run: firebase deploy --only functions,firestore:rules,firestore:indexes,storage --project chauat-go-b9841 --non-interactive --force
```

ก่อนแก้ Workflow ควรกำหนดผู้รับผิดชอบและ Approval สำหรับการ Publish Rules เพราะ Rules มีผลต่อสิทธิ์อ่าน/เขียนข้อมูล Production โดยตรง

## 8. Post-deploy Verification

ตรวจสถานะ Functions:

```bash
firebase functions:list --project chauat-go-b9841
```

ตรวจว่า Functions สำคัญมีอยู่ เช่น:

```text
createOrder
onOrderDispatch
onDispatchOfferCreated
sweepDispatchOffers
acceptDispatchOffer
claimOpenJob
recordConsentEvent
listMyConsentEvents
```

ตรวจ Logs:

```bash
firebase functions:log --project chauat-go-b9841 --limit 100
```

ตรวจ Deployment ล่าสุดของ Functions จาก Google Cloud/Firebase Console และเฝ้าดู Error Logs ใน 10–15 นาทีแรก

## 9. Smoke Test หลัง Deploy

ควรทดสอบใน Production ด้วยบัญชีทดสอบและข้อมูลที่ได้รับอนุมัติเท่านั้น:

1. ลูกค้าสร้างออเดอร์อาหารจากร้าน Partner
2. ร้าน Partner กดรับออเดอร์
3. ตรวจว่าออเดอร์ถูกส่งเข้า Queue ไรเดอร์หลังร้านรับแล้ว
4. ทดสอบร้าน Non-partner ว่าส่งงานตาม Flow ที่กำหนด
5. ไรเดอร์แนบรูปอาหารจากมือถือ
6. ไรเดอร์แนบสลิปที่จ่ายร้าน
7. ตรวจว่าออเดอร์ไม่ให้เริ่มส่งก่อนเงื่อนไขการชำระเงิน/สลิปครบ
8. ทดสอบอัปโหลด JPEG/PNG และ Camera Blob ที่ `application/octet-stream`
9. ทดสอบอ่าน/เขียนรูปโดยบัญชีที่ไม่เกี่ยวข้อง ต้องถูกปฏิเสธ
10. ตรวจ Auto-chat แยกตามประเภทบริการ

## 10. เงื่อนไข Rollback

หากพบปัญหาร้ายแรงหลัง Deploy:

1. หยุดการเปิดรับออเดอร์ใหม่ชั่วคราวหรือสลับ Dispatch เป็น Manual ตาม Runbook ปฏิบัติการ
2. เก็บ Function Logs และ Error Details ก่อนแก้ไข
3. Checkout Commit ก่อนหน้าใน Working Tree แยก
4. รัน Test ของ Commit ก่อนหน้า
5. Deploy Functions/Rules/Storage เฉพาะส่วนที่จำเป็นกลับไปยังเวอร์ชันก่อนหน้า
6. ตรวจ Smoke Test อีกครั้ง
7. บันทึก Incident และ Commit ที่ใช้ Rollback

ห้าม Rollback ด้วยการแก้ไฟล์ Production โดยตรงโดยไม่มี Commit ที่ระบุชัดเจน

## สรุปคำสั่งหลักแบบย่อ

หลัง PR #42 Merge แล้ว:

```bash
cd /path/to/ChauatGo
git fetch origin main
git switch main
git pull --ff-only origin main
npm ci
npm run build
node --test tests/*.test.js
npm ci --prefix functions
npm test --prefix functions
npm run test:emu --prefix functions
firebase use chauat-go-b9841
firebase deploy --only functions,firestore:rules,firestore:indexes,storage --project chauat-go-b9841 --non-interactive --force
firebase functions:list --project chauat-go-b9841
firebase functions:log --project chauat-go-b9841 --limit 100
```

อย่ารันชุดคำสั่ง Deploy นี้จนกว่า PR #42 จะมีสถานะ `MERGED` และ GitHub Checks หลัง Merge ผ่านครบถ้วน
