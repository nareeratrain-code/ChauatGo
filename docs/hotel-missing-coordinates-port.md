# แผนพอร์ต UI โรงแรมไม่มีพิกัดจาก PR #82

เอกสารนี้ใช้สำหรับ port เฉพาะความสามารถ “โรงแรมไม่มีพิกัดต้องเลือกเป็นปลายทางไม่ได้” จาก PR #82 เข้ากับ `main` ปัจจุบัน โดยไม่ดึงโค้ด Agoda/booking รุ่นเก่าหรือโครงสร้าง hotel flow เดิมกลับเข้ามา

## เป้าหมาย

เมื่อข้อมูลโรงแรมไม่มี `lat` หรือ `lng` ที่เป็นตัวเลขและอยู่ในช่วงที่ถูกต้อง ระบบต้อง:

- ไม่คำนวณระยะทางเป็น `NaN`
- ไม่สร้างปลายทางด้วยพิกัด fallback เช่น `0,0`
- ปิดปุ่มตั้งเป็นปลายทางบน hotel card
- แสดงคำเตือนภาษาไทยที่อ่านได้และเข้าถึงได้
- ป้องกันซ้ำที่ `setDestFromPlace()` แม้มีการเรียก handler โดยตรง
- ทำงานเหมือนเดิมสำหรับโรงแรมที่มีพิกัดถูกต้อง

## ขั้นตอนที่แนะนำ

### 1. สร้าง branch ใหม่จาก main ล่าสุด

```bash
git switch main
git pull --ff-only origin main
git switch -c fix/hotel-missing-coordinates-main-flow
```

ห้าม merge PR #82 ทั้งชุด เพราะ branch เดิมตามหลัง `main` และมีปุ่ม/ฟังก์ชัน Agoda รุ่นเก่าปะปนอยู่

### 2. เพิ่ม helper ตรวจพิกัด

วางถัดจาก `hotelPhone()` ใน `index.html`:

```js
function hotelCoordinateIsValid(value, min, max) {
  if (value === null || value === undefined ||
      (typeof value === 'string' && value.trim() === '')) return false;
  var number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max;
}
function hotelHasCoordinates(place) {
  return !!place &&
    hotelCoordinateIsValid(place.lat, -90, 90) &&
    hotelCoordinateIsValid(place.lng, -180, 180);
}
```

### 3. ปรับ `renderHotelCardHTML(p)`

เพิ่ม:

```js
var canSetDestination = hotelHasCoordinates(p);
var distance = userLocation && canSetDestination
  ? ' • 📍 ' + fmtDistance(haversine(userLocation.lat, userLocation.lng, p.lat, p.lng))
  : '';
```

ปุ่มปลายทางให้ใช้ conditional rendering:

```js
canSetDestination
  ? '<button type="button" class="hotel-action destination" onclick="event.stopPropagation();setDestFromPlace(\'' + esc(p.id) + '\')">🎯 ปลายทาง</button>'
  : '<button type="button" class="hotel-action destination disabled" disabled aria-disabled="true" aria-describedby="hotel-missing-coordinate-' + esc(p.id) + '" title="ที่พักนี้ยังไม่มีพิกัด">⚠️ ไม่มีพิกัด</button>'
```

และเพิ่มข้อความใต้ action เมื่อไม่มีพิกัด:

```html
<div id="hotel-missing-coordinate-ID"
     class="hotel-destination-missing"
     role="status"
     aria-live="polite">
  ⚠️ ที่พักนี้ยังไม่มีพิกัด จึงยังตั้งเป็นปลายทางไม่ได้
</div>
```

ให้คงปุ่มหรือ flow อื่นของ `main` ไว้ตามเดิม อย่านำโครงสร้าง Agoda จาก PR #82 กลับมา

### 4. ปรับ `openHotelDetail(p)`

ใช้ `hotelHasCoordinates(p)` เช่นเดียวกัน:

- ถ้ามีพิกัด: แสดง CTA เดิมสำหรับเพิ่มเป็นปลายทาง
- ถ้าไม่มีพิกัด: แสดงปุ่ม disabled พร้อม `aria-describedby="hotel-detail-missing-coordinate"`
- แสดงคำเตือน `role="alert" aria-live="assertive"`
- คำนวณ distance เฉพาะเมื่อ `userLocation && hotelHasCoordinates(p)`

### 5. ป้องกันที่ handler หลัก

ต้น `window.setDestFromPlace = function(placeId)` หลัง `if (!p) return;` ให้เพิ่ม:

```js
if (!hotelHasCoordinates(p)) {
  showToast('ที่พักนี้ยังไม่มีพิกัดสำหรับตั้งเป็นปลายทาง', 'warning');
  return;
}
```

ห้ามใช้ `p.lat || 0`, `p.lng || 0` หรือ fallback coordinate ใด ๆ

### 6. เพิ่ม CSS

เพิ่มใน CSS หลัก:

```css
.hotel-action.destination:disabled,
.hotel-action.destination.disabled {
  background: var(--surface-2);
  color: var(--text-muted);
  border-color: var(--border);
  cursor: not-allowed;
  opacity: .72;
  box-shadow: none;
}
.hotel-destination-missing {
  margin: 8px 0 0;
  padding: 10px 12px;
  border-radius: 12px;
  background: #FFF4E5;
  color: #9A5A00;
  border: 1px solid #F4C27A;
  font-size: 12px;
  line-height: 1.45;
  font-weight: 800;
}
[data-theme="dark"] .hotel-destination-missing {
  background: #3A2915;
  color: #FFD58A;
  border-color: #8A6228;
}
```

### 7. Port test โดยตัด test ที่ไม่เกี่ยวข้อง

นำเฉพาะ test เหล่านี้จาก PR #82 มาใช้หรือเขียนใหม่ให้เข้ากับ renderer ปัจจุบัน:

- helper ตรวจพิกัดอยู่จริงและไม่รับค่าว่าง
- card ปิดปุ่มเมื่อไม่มีพิกัด
- detail ปิด CTA เมื่อไม่มีพิกัด
- `setDestFromPlace()` ไม่สร้าง destination เมื่อไม่มีพิกัด
- ไม่เกิด `NaN` ในระยะทาง
- มี accessible name/description สำหรับปุ่ม disabled

ไม่ควรคัดลอก assertion ที่คาดหวังปุ่ม Agoda หรือโครงสร้างเก่าจาก PR #82

### 8. ตรวจสอบก่อนเปิด PR

```bash
node --test tests/hotel-global-search.test.js tests/hotel-missing-coordinates-ui.test.js
git diff --check
node --check /tmp/chauatgo-inline-*.js
npm test --if-present
```

ตรวจด้วย grep ว่าไม่มีการนำ booking flow เก่ากลับมา:

```bash
grep -n "hotelBookingUrl\|openHotelBooking\|ค้นหา Agoda" index.html
```

คำสั่งนี้อาจพบโค้ดเดิมที่ยังมีอยู่ใน `main`; ให้ตรวจว่า patch ใหม่ไม่ได้เพิ่มหรือคืนโค้ดเหล่านี้กลับมา

### 9. เปิด PR ใหม่

```bash
git add index.html tests/hotel-missing-coordinates-ui.test.js
git commit -m "Disable hotel destination without coordinates"
git push -u origin fix/hotel-missing-coordinates-main-flow
gh pr create --base main --head fix/hotel-missing-coordinates-main-flow \
  --title "Disable hotel destinations without coordinates" \
  --body "Port missing-coordinate protection from PR #82 into the current hotel destination flow without restoring legacy booking UI."
```

## เกณฑ์รับงาน

- โรงแรมมีพิกัด: กด “ปลายทาง” แล้วเข้า ride destination flow ได้เหมือนเดิม
- โรงแรมไม่มีพิกัด: ปุ่ม disabled และมีคำเตือนภาษาไทย
- เรียก `setDestFromPlace()` โดยตรงกับโรงแรมไม่มีพิกัดแล้วไม่เปลี่ยน `selectedDestination`
- ไม่เกิด `NaN` หรือ `0,0` จากข้อมูลพิกัดว่าง
- ไม่มี room booking form หรือโค้ดใหม่ที่นำ Agoda flow กลับมา
- test เฉพาะส่วนผ่าน และ full suite ไม่ลดลงจาก baseline
