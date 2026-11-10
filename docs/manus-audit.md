# Manus direct-to-main audit (31 Oct–5 Nov 2026)

Audit of commits that landed on `main` of `nareeratrain-code/ChauatGo` without a pull request, between 31 Oct 2026 and 5 Nov 2026 (inclusive). Reviewed pull requests #52–#64 and later are out of scope except where they left one of these bugs in place. Findings below are against current `main` (`1da7f0c`), not against a historical snapshot that later commits already repaired.

## How the commits were identified

A commit is treated as a Manus direct push when all of these are true:

- Author and committer are both `nareeratrain-code <3.34194198e+08+nareeratrain-code@users.noreply.github.com>` (not `GitHub <noreply@github.com>`).
- The subject has no `(#NN)` pull-request number.
- The commit date is from 2026-10-31 through 2026-11-05.

Grok Bot pull requests in the same days (#52–#64) are the commits whose committer is `GitHub` and whose subject ends in `(#NN)`. Those were not re-audited as new work.

| Commit | Date (UTC) | Subject |
| --- | --- | --- |
| `adeca1a` | 2026-10-31 | feat: notify riders when customer uploads payment slip |
| `62a17b2` | 2026-10-31 | Merge remote-tracking branch `origin/main` (merge only) |
| `ac16317` | 2026-10-31 | feat: add rider slip rejection and customer re-upload flow |
| `d8aca93` | 2026-10-31 | test: harden production fcm event checks |
| `f32c65c` | 2026-10-31 | feat: add structured fcm delivery logging |
| `60be7a0` | 2026-10-31 | feat: add fcm slack line alert notifier |
| `7b946a9` | 2026-10-31 | feat: browse map places across all districts |
| `9f22d87` | 2026-10-31 | fix: simplify map search to place names |
| `58e1db3` | 2026-11-01 | fix: separate non-food rider delivery flows |
| `22b69c4` | 2026-11-02 | fix: finalize rider payment flows and e2e coverage |
| `84f6d12` | 2026-11-02 | fix: simplify map location confirmation flow |
| `196561f` | 2026-11-03 | fix: prioritize Chauat places across search views |
| `f18a040` | 2026-11-03 | fix: resolve destination names across order flows |
| `9e93212` | 2026-11-04 | fix: complete arrival payment QR flow |
| `34467aa` | 2026-11-04 | fix: clarify ride pickup and destination labels |
| `923efa5` | 2026-11-04 | fix: finalize ride payment and qr flow |
| `03e29dd` | 2026-11-05 | fix: allow express slip payment on the way |
| `356e3fb` | 2026-11-05 | fix: map firebase client errors to thai messages |
| `f9d294d` | 2026-11-05 | fix: consolidate partner food payment chat flow |

The large behavior changes are `ac16317` and `22b69c4` (rules and rider payment), `58e1db3` (non-food flow), and `9e93212` / `923efa5` / `03e29dd` / `f9d294d` (payment chat). Map commits and the FCM notifier did not change order money.

Business rules used as the check:

- Transfer food and buy-for-me: the customer attaches a slip, or the rider manually confirms, before the rider buys.
- Cash food and cash buy-for-me: cash on delivery, no slip first, rider service fee ฿5.
- Express and ride: fee at the end, no slip before that.
- Every order type: the rider can open the exact pickup and destination coordinates and start GPS navigation.

## Confirmed bugs fixed in this change

### 1. High — cash buy-for-me omitted the ฿5 service fee on the order

- File: `functions/orders.js` around lines 257–266 and the shopping `body.cashTip` write.
- What was wrong: food cash set `cashTip = 5` and added it to `total`. Shopping cash left `cashTip` at 0, so `createOrder` returned a total without the fee. `completeOrder` still paid the rider ฿5 when `cashTip` was missing. The customer toast and the stored total did not match the rider settlement.
- Fix: shopping cash now stores `cashTip: 5` and includes it in `total`. Transfer shopping stays ฿0. The shopping payment hint now says the cash service fee is ฿5. That is copy on the existing hint, not a layout change. The delivery-fare button is unchanged; the server total shown after submit includes the ฿5.

### 2. High — a rider could set any goods price

- File: `firestore.rules` `riderGoodsQuoteOk` (food total check near line 810). Client: `rider.js` `submitFoodPhoto`.
- What was wrong: the shopping quote is a client write. Rules required `foodTotal > 0` and did not cap it. A rider could set `foodTotal` / `itemsTotal` to an unbounded number and that became the amount the customer was asked to pay. Fare and the other money fields stayed frozen.
- Fix: both fields must be greater than 0 and at most ฿100,000 (the same ceiling as a menu price and a GP transfer). The rider app rejects a higher number before the write. Emulator test: `functions/test/quote-cap-rules.test.js`.

### 3. High — cash could be marked received before the rider bought, and ride/express could be marked paid before the destination

- File: `functions/orders.js` `confirmPaymentReceived` (gate near line 600). UI: `rider.js` `riderMayConfirmPay` near line 159.
- What was wrong: the callable treated `accepted`, `ready`, and `picked_up` as valid for every type. Cash food and cash shopping could be flagged `customerPaidAt` before the purchase, including from the rider job-detail button. Express and ride could be confirmed at pickup even though the fee is paid at the end. Partner cash food was rejected at pickup and also could not be recorded on delivery. A unit test (`tests/nonfood-payment-ui.test.js`) had locked the early cash confirm in place; that test now matches cash-on-delivery.
- Fix: transfer food and buy-for-me can still be confirmed at `accepted` / `ready` / `picked_up` (slip or rider confirm before buying). Cash food and cash buy-for-me can be confirmed only at `on_the_way`, and the status stays `on_the_way`. Ride and express can be confirmed only at `on_the_way` (a ride still needs the arrival timestamp). The rider button follows the same rule.

### 4. High — rules let a ride take a slip and jump to `customer_paid` at pickup

- File: `firestore.rules` `customerMayAttachSlip` near line 473 and `customerPaidOk`.
- What was wrong: any order at `picked_up` could gain a customer slip, and `customerPaidOk` then allowed `picked_up` → `customer_paid` for a ride. The customer app hides the ride slip button, but the rules did not. That is a prior slip and an early paid flag on a trip that should be paid at the end.
- Fix: a slip at `picked_up` is only for food and shopping. Express stays on the existing `on_the_way` path. `customerPaidOk` requires `buysGoods()`.

### 5. High — GP slip download URLs were copied onto a world-readable shop document

- File: `functions/index.js` `onGpTransferCreated` near line 138 and `reviewGpTransfer` near line 476. Helper: `functions/gp-history.js`.
- What was wrong: `merchants/{id}` is readable by anyone when `verified == true` (`firestore.rules` line 1203). The trigger copied `slipUrl` and `slipPath` into `gpHistory` on that document. A Firebase download URL carries its own token, so the slip image did not need a Storage rule to open.
- Fix: merchant history entries no longer include `slipUrl` or `slipPath`. The slip stays on `gp_transfers/{id}`, which only the shop and an admin can read. Admin slip review already loads `gp_transfers`, not the merchant array. The merchant history list only shows amount and status. A later review rewrites stored history and strips old URLs on that shop. Shops that are never reviewed keep old URLs until a one-time cleanup.

### 6. High — `firebase deploy --only functions` can update some functions and fail the rest

- File: `functions/index.js` `setGlobalOptions` near line 28. Runtime is already `nodejs22` in `firebase.json` and `functions/package.json`.
- What was wrong: there is no function named `expireDispatchOffers`. The callable is `expireDispatchOffer` (`functions/index.js`). `manualAssignRider` and `listMyConsentEvents` are normal `onCall` handlers with auth checks, the same options as the callables that succeed, and no missing import. Gen 2 defaults to 1 vCPU. Firebase CLI releases many Gen 2 updates at once, and each new revision is health-checked at that CPU. On a small Cloud Run CPU quota in `asia-southeast1` the health checks return “Container Healthcheck failed / Quota exceeded for total allowable CPU”, which the CLI prints as “failed to update” for whichever functions lose the race. That matches [firebase-tools#11001](https://github.com/firebase/firebase-tools/issues/11001). A missing index or a bad handler name would fail at run time, not at update time. `consent_events` already has the `subjectRef` + `receivedAt` index in `firestore.indexes.json`.
- Fix in repo: `memory: '256MiB'`, `cpu: 'gcf_gen1'`, `concurrency: 1`. New revisions request the fractional CPU that 256MiB Gen 1 used, so one full rollout fits. This does not deploy anything.

## Follow-up, resolved after PR #98

These three items were still open after the first audit. They are closed in the follow-up branch. The original notes stay below so the first review can still be read.

### 7. High — verified shop documents were publicly readable, including balances — resolved

GP balances, owner email, alert-sound settings, internal notes, and bank fields now live on `merchants/{id}/private/profile`. Only that shop and an admin can read it. The public shop document still has the name, photo, address, hours, partner flag, ratings, menu categories, and the storefront phone the customer “call shop” button dials. A merchant write that still contains a finance field is copied to the private doc and deleted. `sweepMerchantFinance` repeats that move every hour for shops that are not edited. The partner list query `where('verified','==',true)` is unchanged.

### 8. Medium — callable App Check was not enforced — resolved as a flagged rollout

The client already activates reCAPTCHA Enterprise with the public site key for `chauat-go-i5ec.vercel.app`. Localhost now asks Firebase to print a debug token; register that token in the console and do not commit it. Callable rejection stays behind `functions/.env` `APP_CHECK_ENFORCE`, which is still `false`. Turn it on only after App Check metrics show verified traffic for a day or two. Firestore and Storage Enforce are console toggles and are not required for the app to run. Full steps are in the pull request and in `config/env.js`.

### 9. Medium — a cash customer could mark `picked_up` as paid — resolved

`customerPaidOk` now rejects `paymentMode == 'cash'`. A transfer food or buy-for-me order can still move to `customer_paid` after a slip. Cash is recorded by `confirmPaymentReceived` when the rider is `on_the_way`. The customer page tells a cash customer that the rider confirms at delivery and does not write the paid flags.

## Still open

Items 7, 8, and 9 are resolved in the follow-up section above.

### 10. Low — navigation

- File: `rider.js` `riderStop` near line 1567 and `riderNavBlock` near line 1634.
- Food and shopping use `shopPlaceLat`/`shopPlaceLng` for pickup and `lat`/`lng` for drop-off. Ride and express use `fromLat`/`fromLng` and `lat`/`lng`. Both stops render a Google Maps directions link and a `geo:` link when the numbers exist. Lodging is a map category (`โรงแรม ที่พัก`) that becomes a ride destination, not a fifth order type. If a shop has no coordinates, the button falls back to a name search. That is a data gap, not a missing button.

## Suspicions

- The deploy log may also be a Cloud Functions API write-rate limit rather than CPU. The CPU change is the in-repo cause that fits “some functions updated, these three did not”. If the log text is different, deploy the failed names again after this config is live: `expireDispatchOffer`, `manualAssignRider`, `listMyConsentEvents`.
- If `listMyConsentEvents` updates and then fails on the first call, deploy `firestore:indexes` as well. The composite index is already in the repo.
- `firestore.rules` still has a second shop-slip `allow update` near line 1265 that overlaps `riderShopSlipOk`. It does not allow extra fields. It is duplicate, not a wider hole.
- Repo Storage rules allow `slips/customers/{uid}/{orderId}/…`. The customer app writes `orders/{orderId}/riders/{uid}/slip_…` because an older live ruleset denied `slips/customers/`. Both paths are allowed by the rules file now. If production Storage rules are older than this repo, publish `storage.rules` before relying on the customers path. This change does not edit `storage.rules`.
- `tools/fcm-log-alert-notifier.js` reads webhook secrets from the environment. The file itself has no token. `functions/.env` only sets `APP_CHECK_ENFORCE`.

## Checks that held

- Order create is server-only (`allow create: if false`). `createOrder` recomputes fare and total and ignores the client’s numbers.
- Riders cannot write `riderIncome`, `fare`, or `total`.
- A user can create `users/{self}` with `role: admin` only when `isPending == true`, and `isAdmin()` ignores a pending admin. `admins/{self}` can be created only as `role: pending`.
- Every `onCall` handler checks `req.auth`. `manualAssignRider`, `createRiderPayout`, and `reviewGpTransfer` also check the admin role.
- Dispatch offers and `rider_locks` are not client-writable.

## Tests

- `node --test tests/*.test.js` — 211 passed.
- `node --test functions/test/create-order.test.js functions/test/gp-history.test.js functions/test/orders.test.js` — passed.
- Firestore emulator: `functions/test/quote-cap-rules.test.js` (price cap and ride slip denied) and `functions/test/rider-paid.test.js` (payment gates) passed.

## Deploy

Not deployed from this audit. Products that changed are Cloud Functions and Firestore rules.

```bash
firebase deploy --only functions,firestore:rules --project chauat-go-b9841
```

If a function still fails to update, wait for the in-flight revisions to finish and rerun only that name, for example:

```bash
firebase deploy --only functions:expireDispatchOffer,functions:manualAssignRider,functions:listMyConsentEvents --project chauat-go-b9841
```

Do not add `storage` or `hosting` for this change. The customer site on Vercel needs a separate deploy for `rider.js` and `index.html`.

---

# สรุปการตรวจคอมมิตของ Manus ที่พุชเข้า main โดยตรง (31 ต.ค.–5 พ.ย. 2026)

ตรวจคอมมิตบน `main` ของ `nareeratrain-code/ChauatGo` ที่ไม่มี Pull Request ระหว่าง 31 ต.ค. 2026 ถึง 5 พ.ย. 2026 รวมปลายทางทั้งสองวัน งานที่ผ่าน PR #52–#64 และหลังจากนั้นไม่ถูกตรวจเป็นงานใหม่ ผลด้านล่างคือสิ่งที่ยังอยู่บน `main` ปัจจุบัน (`1da7f0c`)

วิธีแยกคอมมิต: ผู้เขียนและผู้ commit คือ `nareeratrain-code` อีเมล noreply คนเดียวกัน ไม่ใช่ `GitHub` และหัวข้อไม่มี `(#เลข PR)` ตารางคอมมิตอยู่ด้านบน รวม 18 งานจริงกับ 1 merge

กฎธุรกิจที่ใช้ตรวจ: อาหารและฝากซื้อแบบโอนต้องมีสลิปหรือให้ไรเดอร์กดยืนยันก่อนซื้อ ของสดจ่ายปลายทางและไม่ต้องมีสลิปก่อน โดยไรเดอร์ได้ค่าบริการ ฿5 ส่งด่วนและเรียกรถจ่ายค่าบริการตอนท้าย ไรเดอร์ต้องเปิดพิกัดรับและพิกัดส่งแล้วเริ่มนำทางได้ทุกประเภทงาน

## ข้อที่ยืนยันและแก้ในชุดนี้

1. **สูง** — ฝากซื้อเงินสดไม่บันทึกค่าบริการ ฿5 ลงออเดอร์ (`functions/orders.js` บรรทัดประมาณ 266) ยอดที่ลูกค้าเห็นไม่ตรงกับส่วนที่ไรเดอร์ได้ตอนจบงาน แก้โดยเก็บ `cashTip: 5` และบวกเข้า `total` เฉพาะเงินสด ข้อความวิธีจ่ายของฝากซื้อระบุ ฿5 เพิ่มจากประโยคเดิม ไม่ได้เปลี่ยนโครงหน้า
2. **สูง** — ไรเดอร์กำหนดราคาสินค้าฝากซื้อได้ไม่จำกัด (`firestore.rules` ฟังก์ชัน `riderGoodsQuoteOk`) แก้ให้ `foodTotal` และ `itemsTotal` มากกว่า 0 และไม่เกิน ฿100,000 มีเทส emulator
3. **สูง** — `confirmPaymentReceived` ให้ไรเดอร์กดว่ารับเงินสดได้ตั้งแต่ยังไม่ซื้อ และให้เรียกรถ/ส่งด่วนถูกยืนยันตั้งแต่จุดรับ (`functions/orders.js` ประมาณบรรทัด 600, `rider.js` `riderMayConfirmPay`) แก้ให้เงินสดอาหารและฝากซื้อยืนยันได้เฉพาะตอน `on_the_way` ส่วนโอนยังยืนยันก่อนซื้อได้ เรียกรถและส่งด่วนยืนยันได้เฉพาะตอนถึงปลายทาง
4. **สูง** — กฎอนุญาตให้เรียกรถแนบสลิปและขยับเป็น `customer_paid` ตั้งแต่ `picked_up` (`firestore.rules` `customerMayAttachSlip`) แอปปิดปุ่มไว้แต่กฎไม่ปิด แก้ให้สลิปตอน `picked_up` ใช้ได้แค่อาหารและฝากซื้อ ส่งด่วนยังแนบได้ตอน `on_the_way`
5. **สูง** — URL สลิป GP ถูกคัดลอกลงเอกสารร้านที่คนทั่วไปอ่านได้เมื่อ `verified == true` (`functions/index.js` `onGpTransferCreated`, `firestore.rules` บรรทัด 1203) แก้โดยไม่คัดลอก `slipUrl`/`slipPath` ไปที่ร้าน สลิปอยู่ที่ `gp_transfers` ซึ่งร้านและแอดมินเท่านั้นที่อ่านได้ ร้านที่เคยถูกคัดลอกไว้จะหลุด URL เดิมจนกว่าจะมีการตรวจสลิปรอบถัดไปหรือล้างข้อมูลครั้งเดียว
6. **สูง (ดีพลอย)** — ไม่มีฟังก์ชันชื่อ `expireDispatchOffers` ชื่อจริงคือ `expireDispatchOffer` ฟังก์ชันที่ผู้ใช้เห็นว่าอัปเดตไม่สำเร็จใช้ตัวเลือกเดียวกับฟังก์ชันที่สำเร็จ สาเหตุที่เข้ากับอาการ “บางตัวสำเร็จ บางตัวล้ม” คือ Gen 2 จอง 1 vCPU ต่อรีวิชัน และ CLI ตรวจสุขภาพพร้อมกันจนโควต้า CPU รายภูมิภาคไม่พอ แก้ในโค้ดด้วย `cpu: 'gcf_gen1'` และ `concurrency: 1` ยังไม่ได้ดีพลอย

## ข้อที่ยืนยัน แต่ยังไม่แก้

7. **สูง — แก้แล้ว** — ยอด GP อีเมลเจ้าของ โน้ต และข้อมูลบัญชี ย้ายไป `merchants/{id}/private/profile` ร้านเจ้าของและแอดมินเท่านั้นที่อ่านได้ รายการร้านร่วมยังอ่านชื่อ รูป ที่อยู่ เวลาเปิด และสถานะพาร์ทเนอร์ได้ เบอร์หน้าร้านยังอยู่บนเอกสารสาธารณะเพราะปุ่มโทรใช้เบอร์นั้น `sweepMerchantFinance` ย้ายของเก่าทุกชั่วโมง
8. **กลาง — พร้อมเปิดใช้** — ไคลเอนต์เปิด reCAPTCHA Enterprise อยู่แล้ว การปฏิเสธ callable ยังปิดอยู่ที่ `APP_CHECK_ENFORCE=false` ให้ดูเมตริกหนึ่งถึงสองวันแล้วค่อยตั้งเป็น `true` แล้วดีพลอย functions การบังคับ Firestore/Storage ทำในคอนโซลทีหลัง แอปไม่รอสวิตช์นั้น localhost พิมพ์ debug token ให้ไปลงทะเบียน ห้ามคอมมิตโทเคน
9. **กลาง — แก้แล้ว** — ลูกค้าเงินสดตั้ง `customer_paid` จาก `picked_up` ไม่ได้อีก งานโอนยังต้องมีสลิป เงินสดให้ไรเดอร์ยืนยันตอน `on_the_way`
10. **ต่ำ** — ปุ่มนำทางมีทั้งจุดรับและจุดส่งเป็นพิกัดจริงของอาหาร ฝากซื้อ เรียกรถ และส่งด่วน (`rider.js` `riderStop`) ที่พักเป็นหมวดแผนที่แล้วกลายเป็นปลายทางของเรียกรถ ไม่ใช่ประเภทออเดอร์ใหม่ ถ้าร้านไม่มีพิกัด ปุ่มจะค้นจากชื่อแทน

## ข้อสงสัย

- ถ้า log ดีพลอยไม่ได้พูดถึงโควต้า CPU อาจเป็นโควต้า write ของ Cloud Functions ให้ดีพลอยชื่อที่ล้มอีกครั้งหลังคอนฟิกนี้ขึ้นแล้ว
- ถ้า `listMyConsentEvents` อัปเดตได้แต่ตอนเรียกใช้แล้วล้ม ให้ดีพลอย `firestore:indexes` ด้วย อินเด็กซ์อยู่ในไฟล์แล้ว
- กฎ Storage ใน repo อนุญาต `slips/customers/…` แต่แอปเขียนที่ `orders/{orderId}/riders/{uid}/slip_…` เพราะกฎที่ขึ้นจริงเคยปฏิเสธเส้น customers ชุดนี้ไม่ได้แก้ `storage.rules` ถ้าของจริงเก่ากว่า repo ให้เผยแพร่ Storage แยก

## คำสั่งดีพลอย

ยังไม่ได้ดีพลอย สิ่งที่เปลี่ยนคือ Cloud Functions กับ Firestore rules

```bash
firebase deploy --only functions,firestore:rules --project chauat-go-b9841
```

เว็บลูกค้าบน Vercel ต้องดีพลอยแยกเพื่อให้ `rider.js` และ `index.html` ตามไปด้วย
