const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');

function slice(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  assert.notEqual(from, -1, start);
  assert.notEqual(to, -1, end);
  return html.slice(from, to);
}

const context = { Math, Number, isFinite, String, Array };
vm.createContext(context);
vm.runInContext(
  slice('function calcFinalPrice(', 'function isMenuOutOfStock(') +
    'function isMenuOutOfStock(menu) { return menu.status === "out_of_stock"; }\n' +
    slice('/* REORDER_HELPERS_START */', '/* REORDER_HELPERS_END */'),
  context
);

const menu = (extra) => Object.assign({
  id: 'm1', name: 'ข้าวผัด', price: 40, status: 'available'
}, extra);

test('reorder is offered for finished food, shopping, express, and ride', () => {
  assert.equal(context.canReorderCompleted({ status: 'done', type: 'food' }), true);
  assert.equal(context.canReorderCompleted({ status: 'delivered', type: 'express' }), true);
  assert.equal(context.canReorderCompleted({ status: 'done', type: 'shopping' }), true);
  assert.equal(context.canReorderCompleted({ status: 'cancelled', type: 'food' }), true);
  assert.equal(context.canReorderCompleted({ status: 'done', type: 'ride' }), true);
  assert.equal(context.canReorderCompleted({ status: 'cancelled', type: 'ride' }), true);
  assert.equal(context.canReorderCompleted({ status: 'cancelled', type: 'shopping' }), true);
  assert.equal(context.canReorderCompleted({ status: 'cancelled', type: 'express' }), true);
  assert.equal(context.canReorderCompleted({ status: 'searching', type: 'express' }), false);
});

test('food reorder keeps quantities, uses current prices, and skips unavailable items', () => {
  const plan = context.planFoodReorderItems([
    { menuId: 'm1', name: 'ชื่อเก่า', qty: 2, finalPrice: 25 },
    { name: 'ต้มยำ', qty: 1, finalPrice: 50 },
    { menuId: 'gone', name: 'เมนูที่ปิด', qty: 1, finalPrice: 30 },
    { name: 'น้ำเปล่า', qty: 3, finalPrice: 10 },
    { name: 'ไม่มีแล้ว', qty: 1, finalPrice: 20 }
  ], [
    menu({ id: 'm1', name: 'ข้าวผัดใหม่', price: 45 }),
    menu({ id: 'm2', name: 'ต้มยำ', price: 50 }),
    menu({ id: 'gone', name: 'เมนูที่ปิด', status: 'hidden', price: 30 }),
    menu({ id: 'm3', name: 'น้ำเปล่า', status: 'out_of_stock', price: 15 })
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.lines.map((line) => [line.menuId, line.qty, line.finalPrice]))), [
    ['m1', 2, 45],
    ['m2', 1, 50]
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.priceChanges)), [{ name: 'ข้าวผัดใหม่', from: 25, to: 45 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.skipped.map((row) => row.reason))), ['ไม่มีในร้านแล้ว', 'หมดชั่วคราว', 'ไม่มีในร้านแล้ว']);
});

test('food reorder keeps the drop-off pin, address, and note', () => {
  const drop = context.foodReorderDropoff({
    lat: 8.01, lng: 100.02, address: 'บ้านสีฟ้า', note: 'โทรก่อนถึง',
    riderId: 'rider', status: 'done', riderPhone: '0811111111'
  });
  assert.deepEqual(JSON.parse(JSON.stringify(drop)), { lat: 8.01, lng: 100.02, address: 'บ้านสีฟ้า', note: 'โทรก่อนถึง' });
});

test('express reorder keeps pins and parcel details without the old photo or rider', () => {
  const packed = context.expressReorderDraft({
    from: 'ตลาด', fromLat: 7.96, fromLng: 99.99,
    to: 'บ้าน', address: 'บ้าน', lat: 8.02, lng: 100.05,
    parcelType: 'fruit', weightKg: 2.5, itemDescription: 'มะม่วง',
    note: 'ระวังบุบ', userName: 'สมชาย', userPhone: '0890000000',
    requestedArrivalBy: '2020-01-01T10:00',
    parcelPhotoUrl: 'https://example.com/old.jpg', parcelPhotoPath: 'chats/old',
    riderId: 'rider', riderPhone: '0811111111', status: 'done',
    createdAt: { seconds: 1 }, fare: 99
  });
  assert.equal(packed.origin.address, 'ตลาด');
  assert.equal(packed.destination.lat, 8.02);
  assert.equal(packed.draft.parcelType, 'fruit');
  assert.equal(packed.draft.weightKg, '2.5');
  assert.equal(packed.draft.itemDescription, 'มะม่วง');
  assert.equal(packed.draft.note, 'ระวังบุบ');
  assert.equal(packed.draft.contactName, 'สมชาย');
  assert.equal(packed.draft.phone, '0890000000');
  assert.equal(packed.draft.arrivalBy, '');
  const dumped = JSON.stringify(packed);
  ['parcelPhoto', 'riderId', 'riderPhone', 'status', 'createdAt', 'fare'].forEach((key) => {
    assert.equal(dumped.includes('"' + key + '"'), false, key);
  });
});

test('shopping reorder keeps the store, list, and drop-off without another phone', () => {
  const prefill = context.shoppingReorderPrefill({
    shopPlaceId: 'moved',
    shopPlaceName: 'ร้านโชคชัย',
    shopPlaceLat: 7.97,
    shopPlaceLng: 99.98,
    items: '- น้ำแข็ง 1 ถุง',
    note: 'รับทอน',
    address: 'บ้านบุญมี',
    lat: 8.03,
    lng: 100.01,
    userName: 'สมหญิง',
    userPhone: '0860000000',
    riderPhone: '0811111111',
    phone: '0899999999',
    fare: 80,
    status: 'done'
  }, [{ id: 'LOC-010', name: 'ร้านอื่น', lat: 1, lng: 1 }]);
  assert.equal(prefill.place.name, 'ร้านโชคชัย');
  assert.equal(prefill.place.lat, 7.97);
  assert.equal(prefill.items, '- น้ำแข็ง 1 ถุง');
  assert.equal(prefill.note, 'รับทอน');
  assert.equal(prefill.phone, '0860000000');
  assert.equal(prefill.contactName, 'สมหญิง');
  assert.deepEqual(JSON.parse(JSON.stringify(prefill.dropoff)), { lat: 8.03, lng: 100.01, address: 'บ้านบุญมี', note: 'รับทอน' });
  assert.equal(JSON.stringify(prefill).includes('0811111111'), false);
  assert.equal(JSON.stringify(prefill).includes('"fare"'), false);
});

test('ride reorder restores the vehicle, pins, and note, and leaves an unknown vehicle unselected', () => {
  const ready = context.rideReorderState({
    status: 'cancelled',
    type: 'ride',
    vehicle: 'motorcycle',
    from: 'ร้านขายปลา',
    fromLat: 7.96943,
    fromLng: 100.00215,
    to: 'ตลาดสดชะอวด',
    lat: 7.966,
    lng: 99.997,
    note: 'รอหน้าตลาด',
    userPhone: '0812345678',
    fare: 35
  });
  assert.equal(ready.missingVehicle, false);
  assert.equal(ready.vehicle.type, 'motorcycle');
  assert.equal(ready.vehicle.price, 30);
  assert.equal(ready.origin.address, 'ร้านขายปลา');
  assert.equal(ready.origin.lat, 7.96943);
  assert.equal(ready.destination.address, 'ตลาดสดชะอวด');
  assert.equal(ready.destination.lng, 99.997);
  assert.equal(ready.draft.note, 'รอหน้าตลาด');
  assert.equal(ready.draft.phone, '0812345678');
  assert.equal(JSON.stringify(ready).includes('"fare"'), false);
  const missing = context.rideReorderState({ vehicle: 'helicopter', from: 'บ้าน', to: 'ตลาด' });
  assert.equal(missing.vehicle, null);
  assert.equal(missing.missingVehicle, true);
  assert.equal(context.rideVehicleByType('car').price, 60);
});

test('express reorder asks for a new parcel type when the old one is unknown', () => {
  const packed = context.expressReorderDraft({
    parcelType: 'livestock',
    weightKg: 1,
    itemDescription: 'กล่อง',
    from: 'บ้าน',
    to: 'ตลาด'
  });
  assert.equal(packed.draft.parcelType, '');
  assert.equal(packed.draft.parcelNeedsChoice, true);
  assert.equal(packed.draft.weightKg, '1');
  assert.equal(packed.draft.itemDescription, 'กล่อง');
});

test('the ride form keeps the restored vehicle selected so submit can proceed', () => {
  const form = html.slice(html.indexOf('window.openRideOrderForm'), html.indexOf('function calculateFare'));
  const submit = html.slice(html.indexOf('window.submitRideOrder'), html.indexOf('/* ═══ ORDER FORM'));
  assert.match(form, /id="ride-vehicle-picker"/);
  assert.match(form, /ride-vehicle-option' \+ \(on \? ' selected'/);
  assert.match(form, /selectedVehicle = \{ type: chosen\.type, price: chosen\.price \}/);
  assert.match(form, /data-ride-vehicle="/);
  assert.match(html, /function reorderRide[\s\S]*rideReorderState\(order\)/);
  assert.match(html, /selectedVehicle = state\.vehicle \? \{ type: state\.vehicle\.type, price: state\.vehicle\.price \} : null/);
  assert.match(submit, /markRideVehicleMissing\('เลือกประเภทรถก่อนยืนยัน'\)/);
  assert.equal(submit.includes("ไม่ได้เลือกรถ"), false);
  assert.match(submit, /createServerOrder/);
  assert.match(submit, /vehicle:selectedVehicle\.type/);
});
