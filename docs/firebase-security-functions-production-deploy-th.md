# Production Deploy Runbook: Firestore Rules และ Cloud Functions

โปรเจกต์ Firebase: `chauat-go-b9841`

ขอบเขตของชุดนี้:

- `firestore.rules` — จำกัด Rider Profile, Raw GPS, Order-scoped Tracking และ Rating Ownership
- `functions/index.js` — เพิ่ม `onRatingCreated` และ Fan-out GPS ไปยัง `orders/{orderId}/tracking/current`
- Frontend ที่เกี่ยวข้องต้อง Deploy แยกผ่าน Vercel หลัง Firebase พร้อมใช้งานแล้ว

เอกสารนี้เป็นขั้นตอนเตรียม Deploy ยังไม่ใช่คำสั่งที่ถูกสั่งรันโดยอัตโนมัติ

## 1. เงื่อนไขก่อน Deploy

ต้องมีครบทุกข้อ:

1. โค้ดอยู่บน Commit/Branch ที่ได้รับอนุมัติแล้ว
2. ทำงานจาก Repository `chauatgo` ที่ถูกต้อง
3. Firebase CLI Login ด้วยบัญชีที่มีสิทธิ์ Deploy Functions และ Firestore Rules
4. Firebase Project เป็น `chauat-go-b9841`
5. ใช้ Firebase Plan แบบ Blaze สำหรับ Cloud Functions
6. มี Backup ของ Rules ที่ใช้งานอยู่ใน Production
7. ไม่มีการ Deploy จาก Working Tree ที่มีไฟล์อื่นปะปนโดยไม่ตั้งใจ

ตรวจสอบ:

```bash
cd /home/ubuntu/chauatgo
firebase --version
firebase projects:list
firebase use chauat-go-b9841
firebase use
cat .firebaserc
```

ผลที่ต้องเห็นคือ Project ปัจจุบันเป็น:

```text
chauat-go-b9841
```

## 2. ตรวจ Source ก่อน Deploy

```bash
cd /home/ubuntu/chauatgo

git status --short
git diff --check
git log -1 --oneline --decorate

test -s firebase.json
test -s .firebaserc
test -s functions/package.json
test -s functions/index.js
test -s firestore.rules
```

แนะนำให้ Commit การแก้ไขที่ต้องการ Deploy ก่อน หากมีไฟล์ Untracked หรือการแก้ไขจากงานอื่น ให้แยกออกจาก Working Tree ก่อนดำเนินการจริง

## 3. Backup ก่อน Publish Rules

คำสั่งนี้เก็บสำเนาของไฟล์ใน Repository เพื่อใช้ตรวจสอบ/ย้อนกลับในระดับ Source:

```bash
BACKUP_DIR="/tmp/chauatgo-firebase-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp firestore.rules "$BACKUP_DIR/firestore.rules"
cp firestore.indexes.json "$BACKUP_DIR/firestore.indexes.json"
cp storage.rules "$BACKUP_DIR/storage.rules"
echo "$BACKUP_DIR"
```

สำหรับการ Rollback ที่แม่นยำ ควรคัดลอก Rules เวอร์ชันที่ใช้งานอยู่จาก Firebase Console เก็บไว้ด้วย เพราะไฟล์ใน Repository อาจไม่ตรงกับ Version ที่ Production ใช้อยู่ในปัจจุบัน

## 4. Pre-deploy Tests

รันจาก Root Repository:

```bash
cd /home/ubuntu/chauatgo
npm run build
node --check functions/index.js
node --check rider.js
npm run test:emu --prefix functions
```

ผลที่ต้องผ่าน:

```text
Firestore/Functions Tests: ผ่าน
Storage Rules Tests: ผ่าน
Production Build: สำเร็จ
JavaScript Syntax Check: สำเร็จ
```

ห้าม Deploy หาก Emulator Rules Test ล้มเหลว โดยเฉพาะกรณีต่อไปนี้:

- Customer อ่าน Rider Profile คนอื่นได้
- Customer อ่าน Raw GPS ได้
- Stranger อ่าน Order-scoped Tracking ได้
- Customer ให้คะแนน Order ของผู้อื่นได้
- Rating ของ Order ที่ยังไม่เสร็จถูกสร้างได้

## 5. ตรวจ Functions ที่จะถูก Deploy

```bash
grep -nE '^exports\.' functions/index.js
firebase functions:list --project chauat-go-b9841
```

ชุดนี้ต้องมี Function สำคัญอย่างน้อย:

```text
onGpsOnline
onRatingCreated
onOrderDispatch
onDispatchOfferCreated
sweepDispatchOffers
```

## 6. Recommended Deploy Sequence

แนะนำให้ Deploy แบบแยกขั้น ไม่ใช้คำสั่งรวมทั้งหมด เพื่อให้ตรวจสอบผลแต่ละส่วนได้

### ขั้นที่ 1: Deploy Cloud Functions

```bash
cd /home/ubuntu/chauatgo
firebase deploy \
  --only functions \
  --project chauat-go-b9841
```

เหตุผลที่ Deploy Functions ก่อน Rules:

- สร้าง `onRatingCreated` ให้พร้อมรับ Rating ใหม่
- ให้ `onGpsOnline` พร้อมเขียน Order-scoped Tracking
- ลดช่วงเวลาที่ Frontend เปลี่ยนไปอ่าน Tracking ใหม่ แต่ Backend ยังไม่มี Fan-out

### ขั้นที่ 2: Deploy Firestore Rules

```bash
firebase deploy \
  --only firestore:rules \
  --project chauat-go-b9841
```

คำสั่งนี้จะ Publish เฉพาะ `firestore.rules` ไม่กระทบ Storage Rules

### ขั้นที่ 3: Deploy Indexes เฉพาะเมื่อมีการเปลี่ยนแปลง

การเพิ่ม Query ใน `onGpsOnline` ใช้ Composite Query ของ `riderId` และ `status` หาก Firebase แจ้งให้สร้าง Index ให้ Deploy ด้วยคำสั่งนี้:

```bash
firebase deploy \
  --only firestore:indexes \
  --project chauat-go-b9841
```

หากไม่มีการแก้ `firestore.indexes.json` และ Query ไม่แจ้ง Missing Index สามารถข้ามขั้นนี้ได้

## 7. คำสั่ง Deploy แบบรวมกรณีจำเป็น

ใช้เมื่อผ่านการตรวจสอบแยกขั้นแล้ว หรือใช้ใน CI ที่มี Approval แล้วเท่านั้น:

```bash
cd /home/ubuntu/chauatgo
firebase deploy \
  --only functions,firestore:rules,firestore:indexes \
  --project chauat-go-b9841
```

ไม่ต้องใส่ `hosting` เพราะ `firebase.json` ของโครงการนี้ไม่มี Hosting Target

ไม่ควรใส่ `--force` ในการ Deploy แบบ Manual Production เว้นแต่ทีมอนุมัติแล้ว เพราะอาจข้าม Prompt ที่ช่วยเตือนการเปลี่ยนแปลงที่มีผลกระทบ

## 8. Verification หลัง Deploy

### ตรวจ Functions

```bash
firebase functions:list --project chauat-go-b9841
```

### ตรวจ Logs ล่าสุด

```bash
firebase functions:log \
  --project chauat-go-b9841 \
  --limit 100
```

ค้นหาเฉพาะ Function สำคัญ:

```bash
firebase functions:log \
  --project chauat-go-b9841 \
  --only onRatingCreated,onGpsOnline \
  --limit 100
```

หาก CLI เวอร์ชันที่ติดตั้งไม่รองรับ `--only` ให้ใช้ Firebase Console หรือ Google Cloud Logs Explorer แทน

## 9. Production Smoke Test

ใช้บัญชีทดสอบและ Order ทดสอบที่ได้รับอนุมัติเท่านั้น:

1. Rider ที่ผ่านการยืนยันเปิด Online และส่ง GPS
2. ตรวจว่า `gps_riders/{riderId}` ถูกเขียนได้
3. ตรวจว่า Customer อ่าน Raw GPS โดยตรงไม่ได้
4. ตรวจว่า Order ของ Customer มี `tracking/current` ถูกสร้างหรืออัปเดต
5. ตรวจว่า Customer อ่าน Tracking ของ Order ตัวเองได้
6. ตรวจว่า Customer อื่นอ่าน Tracking ของ Order นี้ไม่ได้
7. สร้าง Order ทดสอบให้เสร็จสิ้น
8. Customer ให้คะแนน Order ของตัวเอง
9. ตรวจว่า `onRatingCreated` ทำงานและอัปเดต `ratingAvg`/`ratingCount`
10. ตรวจว่า Customer ไม่สามารถสร้าง Rating ให้ Order ของผู้อื่นได้

## 10. Rollback

### Rollback Firestore Rules

ให้คืนไฟล์ Rules เวอร์ชันที่ตรวจสอบแล้วก่อน จากนั้นรัน:

```bash
firebase deploy \
  --only firestore:rules \
  --project chauat-go-b9841
```

### Rollback Functions

ให้ Checkout Commit ก่อนหน้าที่ผ่านการทดสอบ แล้ว Deploy Functions ใหม่:

```bash
git switch --detach <KNOWN_GOOD_COMMIT>
npm ci --prefix functions
npm test --prefix functions
firebase deploy \
  --only functions \
  --project chauat-go-b9841
```

หลัง Rollback เสร็จให้กลับไป Branch เดิม:

```bash
git switch <เดิม>
```

ไม่ควรลบ Function ด้วย `firebase functions:delete` เพื่อแก้ปัญหาเฉพาะหน้า เพราะอาจกระทบ Trigger ที่กำลังทำงานอยู่

## 11. สิ่งที่ยังไม่ควรทำในขั้นตอนนี้

- อย่า Deploy จากบัญชี Firebase Project อื่น
- อย่าใช้ `firebase deploy --only hosting` เพราะงานนี้ไม่มี Hosting Target
- อย่า Publish Rules โดยไม่ผ่าน Emulator Test
- อย่าเปิด Read ของ `gps_riders` ให้ผู้ใช้ที่ Login ทุกคน
- อย่าให้ Client กลับมาเขียน `ratingAvg` หรือ `ratingCount`
- อย่าใช้ข้อมูลจริงของลูกค้า/ไรเดอร์ในการ Smoke Test
