'use strict';

const { FieldValue } = require('firebase-admin/firestore');

const FOOD_BASE = 20;
const FOOD_PER_KM = 8;
const FOOD_FREE_KM = 2;
const FOOD_CAP = 150;
const ROAD_FACTOR = 1.3;
const PROMO_DAYS = 60;
const GP_RATE = 0.03;
const GP_RIDER_SHARE = 0.02;
const GP_PLATFORM_SHARE = 0.01;

const RIDE = {
  motorcycle: { base: 30, perKm: 5, name: '🏍️ มอเตอร์ไซค์' },
  car: { base: 60, perKm: 10, name: '🚗 รถเก๋ง' },
  pickup: { base: 90, perKm: 12, name: '🛻 รถกระบะ' },
  van: { base: 120, perKm: 15, name: '🚐 รถตู้' }
};

function round2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

function clip(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function reject(message) {
  const err = new Error(message);
  err.code = 'invalid-argument';
  throw err;
}

function pointOf(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  if (la === 0 && ln === 0) return null;
  return { lat: la, lng: ln };
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function routeKm(from, to) {
  if (!from || !to) return 0;
  return haversineKm(from.lat, from.lng, to.lat, to.lng) * ROAD_FACTOR;
}

/* Same numbers as index.html calculateFoodDeliveryFee. */
function foodDeliveryFee(shop, dest) {
  if (!shop || !dest) return { fee: FOOD_BASE, distanceKm: null };
  const distanceKm = routeKm(shop, dest);
  const extra = Math.ceil(Math.max(0, distanceKm - FOOD_FREE_KM)) * FOOD_PER_KM;
  return { fee: Math.min(FOOD_CAP, FOOD_BASE + extra), distanceKm: distanceKm };
}

function rideFare(vehicle, from, to) {
  const spec = RIDE[vehicle];
  if (!spec) return { fare: 50, distanceKm: 0, vehicleName: '' };
  const distanceKm = routeKm(from, to);
  return {
    fare: Math.round(spec.base + distanceKm * spec.perKm),
    distanceKm: distanceKm,
    vehicleName: spec.name
  };
}

function expressFare(from, to) {
  const distanceKm = routeKm(from, to);
  return { fare: Math.round(30 + distanceKm * 5), distanceKm: distanceKm };
}

function shoppingFare(from, shop) {
  const straight = from && shop ? haversineKm(from.lat, from.lng, shop.lat, shop.lng) : 0;
  const distanceKm = straight * ROAD_FACTOR;
  return { fare: Math.round(30 + straight * ROAD_FACTOR * 5), distanceKm: distanceKm };
}

function millisOf(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  return 0;
}

function promoActive(merchant, nowMs) {
  if (!merchant || !merchant.gpStartDate) return true;
  const start = millisOf(merchant.gpStartDate);
  if (!start) return true;
  const days = Math.floor(((nowMs || Date.now()) - start) / 86400000);
  return days < PROMO_DAYS;
}

function calcGp(foodTotal, merchant, nowMs) {
  const base = round2(foodTotal);
  if (promoActive(merchant, nowMs) || base <= 0) {
    return { total: 0, rider: 0, platform: 0, promo: true };
  }
  return {
    total: round2(base * GP_RATE),
    rider: round2(base * GP_RIDER_SHARE),
    platform: round2(base * GP_PLATFORM_SHARE),
    promo: false
  };
}

function promoLine(price, promo) {
  const original = round2(price);
  if (!promo || promo.active !== true) {
    return { original: original, final: original, discount: 0, label: '' };
  }
  const value = Number(promo.value) || 0;
  if (value <= 0) return { original: original, final: original, discount: 0, label: '' };
  let final = original;
  if (promo.type === 'percent') final = Math.max(0, Math.round(original * (1 - value / 100)));
  else if (promo.type === 'amount') final = Math.max(0, original - value);
  else return { original: original, final: original, discount: 0, label: '' };
  const discount = Math.max(0, round2(original - final));
  const label = promo.type === 'percent' ? ('ลด ' + value + '%') : ('ลด ฿' + value);
  return { original: original, final: round2(final), discount: discount, label: label };
}

function orderCode(raw) {
  const code = clip(raw, 16);
  if (/^OD-\d{4}$/.test(code)) return code;
  return 'OD-' + String(Math.floor(1000 + Math.random() * 9000));
}

function deliveryCode(raw) {
  const code = clip(raw, 8);
  if (/^\d{4}$/.test(code)) return code;
  return String(Math.floor(1000 + Math.random() * 9000));
}

function paymentModeOf(data, type) {
  const raw = clip(data && data.paymentMode, 20);
  if (raw === 'cash' || raw === 'transfer') return raw;
  return type === 'shopping' ? 'cash' : 'transfer';
}

function httpsUrl(value) {
  const url = clip(value, 1000);
  if (!url || url.indexOf('https://') !== 0) return '';
  return url;
}

async function priceFoodItems(db, merchantId, rawItems) {
  if (!Array.isArray(rawItems) || !rawItems.length) reject('ยังไม่มีรายการอาหาร');
  if (rawItems.length > 40) reject('รายการอาหารมากเกินไป');
  const ids = rawItems.map((row) => {
    const id = clip(row && row.menuId, 80);
    if (!id) reject('รายการอาหารไม่ถูกต้อง');
    return id;
  });
  const snaps = await db.getAll.apply(db, ids.map((id) => db.collection('menus').doc(id)));
  let subtotal = 0;
  let discountTotal = 0;
  const items = [];
  snaps.forEach((snap, i) => {
    if (!snap.exists) reject('ไม่พบเมนู');
    const menu = snap.data() || {};
    if (menu.merchantId !== merchantId) reject('เมนูไม่ใช่ของร้านนี้');
    if (menu.status === 'out_of_stock') reject('มีเมนูหมด');
    const qty = Math.round(Number(rawItems[i].qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > 99) reject('จำนวนไม่ถูกต้อง');
    const priced = promoLine(menu.price, menu.promotion);
    subtotal += priced.original * qty;
    discountTotal += priced.discount * qty;
    items.push({
      menuId: snap.id,
      name: clip(menu.name || rawItems[i].name, 120),
      qty: qty,
      price: priced.original,
      originalPrice: priced.original,
      finalPrice: priced.final,
      discount: priced.discount,
      promoLabel: priced.label
    });
  });
  return {
    items: items,
    subtotal: round2(subtotal),
    discountTotal: round2(discountTotal),
    netTotal: round2(subtotal - discountTotal),
    itemsText: items.map((row) => row.name + ' x' + row.qty).join(', ').slice(0, 2000)
  };
}

async function createOrder(db, uid, data) {
  const src = data || {};
  const type = clip(src.type, 20);
  if (['food', 'ride', 'express', 'shopping'].indexOf(type) === -1) reject('ประเภทงานไม่ถูกต้อง');
  const mode = paymentModeOf(src, type);
  const from = pointOf(src.fromLat, src.fromLng);
  const dest = pointOf(src.lat, src.lng);
  let fare = 0;
  let distanceKm = 0;
  let cashTip = 0;
  let food = null;
  let merchantName = clip(src.merchantName, 120);
  let shopPoint = pointOf(src.shopPlaceLat, src.shopPlaceLng);
  const merchantId = clip(src.merchantId, 128);

  if (type === 'food' && Array.isArray(src.items) && src.items.length) {
    if (!merchantId) reject('ไม่พบร้าน');
    const merchantSnap = await db.collection('merchants').doc(merchantId).get();
    if (!merchantSnap.exists) reject('ไม่พบร้าน');
    const merchant = merchantSnap.data() || {};
    merchantName = clip(merchant.name || merchantName, 120);
    shopPoint = pointOf(merchant.lat, merchant.lng) || shopPoint;
    food = await priceFoodItems(db, merchantId, src.items);
    const quoted = foodDeliveryFee(shopPoint, dest);
    fare = quoted.fee;
    distanceKm = quoted.distanceKm || 0;
    cashTip = mode === 'cash' ? 5 : 0;
  } else if (type === 'food') {
    const quoted = foodDeliveryFee(shopPoint, dest);
    fare = quoted.fee;
    distanceKm = quoted.distanceKm || 0;
    cashTip = mode === 'cash' ? 5 : 0;
    food = { items: [], subtotal: 0, discountTotal: 0, netTotal: 0, itemsText: clip(src.itemsText, 2000) };
  } else if (type === 'ride') {
    const quoted = rideFare(clip(src.vehicle, 20), from, dest);
    fare = quoted.fare;
    distanceKm = quoted.distanceKm;
  } else if (type === 'express') {
    const quoted = expressFare(from, dest);
    fare = quoted.fare;
    distanceKm = quoted.distanceKm;
  } else {
    const quoted = shoppingFare(from, shopPoint);
    fare = quoted.fare;
    distanceKm = quoted.distanceKm;
  }

  const net = food ? food.netTotal : 0;
  const total = round2(net + fare + cashTip);
  const code = orderCode(src.code);
  const body = {
    type: type,
    userId: uid,
    userName: clip(src.userName, 80) || 'ลูกค้า',
    userPhone: clip(src.userPhone, 30),
    title: clip(src.title, 160) || 'ออเดอร์',
    status: 'searching',
    riderId: null,
    address: clip(src.address, 300),
    note: clip(src.note, 500),
    from: clip(src.from, 300),
    to: clip(src.to, 300),
    paymentMode: mode,
    fare: fare,
    total: total,
    distanceKm: round2(distanceKm),
    code: code,
    deliveryCode: deliveryCode(src.deliveryCode),
    codeCreatedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp()
  };
  if (from) {
    body.fromLat = from.lat;
    body.fromLng = from.lng;
  }
  if (dest) {
    body.lat = dest.lat;
    body.lng = dest.lng;
  }
  if (type === 'food') {
    body.merchantId = merchantId;
    body.merchantName = merchantName;
    body.shopPlaceName = clip(src.shopPlaceName, 120) || merchantName;
    if (shopPoint) {
      body.shopPlaceLat = shopPoint.lat;
      body.shopPlaceLng = shopPoint.lng;
    }
    body.items = food.items;
    body.itemsText = food.itemsText;
    body.itemsTotal = food.subtotal;
    body.subtotal = food.subtotal;
    body.discountTotal = food.discountTotal;
    body.netTotal = food.netTotal;
    body.foodTotal = food.subtotal;
    body.cashTip = cashTip;
  }
  if (type === 'ride') {
    const vehicle = clip(src.vehicle, 20);
    body.vehicle = vehicle;
    body.vehicleName = (RIDE[vehicle] && RIDE[vehicle].name) || clip(src.vehicleName, 40);
  }
  if (type === 'express') {
    body.parcelType = clip(src.parcelType, 40);
    body.parcelTypeLabel = clip(src.parcelTypeLabel, 80);
    body.requestedArrivalBy = clip(src.requestedArrivalBy, 40);
    const weight = Number(src.weightKg);
    body.weightKg = Number.isFinite(weight) && weight > 0 && weight <= 1000 ? weight : null;
    body.itemDescription = clip(src.itemDescription, 500);
    body.parcelPhotoUrl = httpsUrl(src.parcelPhotoUrl);
    const photoPath = clip(src.parcelPhotoPath, 300);
    body.parcelPhotoPath = photoPath.indexOf('chats/' + uid + '/images/') === 0 ? photoPath : '';
  }
  if (type === 'shopping') {
    body.shopPlaceId = clip(src.shopPlaceId, 80);
    body.shopPlaceName = clip(src.shopPlaceName, 120);
    if (shopPoint) {
      body.shopPlaceLat = shopPoint.lat;
      body.shopPlaceLng = shopPoint.lng;
    }
    const list = typeof src.items === 'string' ? clip(src.items, 2000) : clip(src.itemsText, 2000);
    body.items = list;
    body.itemsText = list;
    body.paymentMode = mode;
  }

  const ref = db.collection('orders').doc();
  await ref.set(body);
  return {
    id: ref.id,
    code: code,
    fare: fare,
    total: total,
    cashTip: cashTip,
    distanceKm: body.distanceKm
  };
}

async function completeOrder(db, uid, orderId) {
  const id = clip(orderId, 128);
  if (!id) reject('ข้อมูลไม่ครบ');
  const orderRef = db.collection('orders').doc(id);
  const riderRef = db.collection('riders').doc(uid);
  let result = null;
  await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    const riderSnap = await tx.get(riderRef);
    if (!orderSnap.exists) {
      const err = new Error('missing-order');
      throw err;
    }
    if (!riderSnap.exists) {
      const err = new Error('missing-rider');
      throw err;
    }
    const order = orderSnap.data() || {};
    if (order.riderId !== uid) {
      const err = new Error('not-yours');
      throw err;
    }
    if (order.status !== 'on_the_way') {
      const err = new Error('สถานะงานยังส่งไม่สำเร็จ');
      err.code = 'failed-precondition';
      throw err;
    }
    let merchant = null;
    if (order.type === 'food' && order.merchantId) {
      const merchantSnap = await tx.get(db.collection('merchants').doc(order.merchantId));
      merchant = merchantSnap.exists ? (merchantSnap.data() || {}) : null;
    }
    const fare = round2(order.fare);
    const isCash = order.paymentMode === 'cash';
    const tip = order.cashTip != null ? round2(order.cashTip) : (isCash ? 5 : 0);
    const riderShare = round2(fare * 0.8);
    const platformShare = round2(fare * 0.2);
    const riderIncome = round2(riderShare + tip);
    const foodTotal = round2(order.foodTotal || order.itemsTotal || 0);
    const gp = order.type === 'food' ? calcGp(foodTotal, merchant) : { total: 0, rider: 0, platform: 0, promo: true };
    tx.update(orderRef, {
      status: 'done',
      doneAt: FieldValue.serverTimestamp(),
      riderIncome: riderIncome,
      riderOwe: platformShare,
      riderPaid: false,
      gpTotal: gp.total,
      gpRider: gp.rider,
      gpPlatform: gp.platform,
      gpPromo: gp.promo === true
    });
    tx.update(riderRef, {
      totalJobs: FieldValue.increment(1),
      totalIncome: FieldValue.increment(riderIncome)
    });
    result = {
      ok: true,
      riderIncome: riderIncome,
      riderOwe: platformShare,
      gpTotal: gp.total,
      gpRider: gp.rider,
      gpPlatform: gp.platform
    };
  });
  return result;
}

module.exports = {
  FOOD_BASE,
  FOOD_CAP,
  foodDeliveryFee,
  rideFare,
  expressFare,
  shoppingFare,
  calcGp,
  promoActive,
  createOrder,
  completeOrder
};
