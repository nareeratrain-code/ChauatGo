#!/usr/bin/env node
'use strict';

const RATES = Object.freeze({
  platformFare: 0.20,
  riderFare: 0.80,
  storeGp: 0.03,
  riderFoodShare: 0.02,
  platformFoodShare: 0.01,
  cashTip: 5
});

const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function calculate(order) {
  const fare = round2(order.fare || 0);
  const food = round2(order.foodTotal || order.itemsTotal || 0);
  const tip = order.cashTip != null ? round2(order.cashTip) : (order.paymentMode === 'cash' ? RATES.cashTip : 0);
  const riderFare = round2(fare * RATES.riderFare);
  const platformFare = round2(fare * RATES.platformFare);
  const storeGp = order.type === 'food' ? round2(food * RATES.storeGp) : 0;
  const riderFoodGp = order.type === 'food' ? round2(food * RATES.riderFoodShare) : 0;
  const platformFoodGp = order.type === 'food' ? round2(food * RATES.platformFoodShare) : 0;
  return {
    orderId: order.orderId,
    type: order.type,
    status: order.status,
    paymentMode: order.paymentMode,
    riderId: order.riderId,
    merchantId: order.merchantId || null,
    fare,
    food,
    tip,
    riderIncome: round2(riderFare + tip),
    platformFare,
    storeGp,
    riderFoodGp,
    platformFoodGp,
    totalGp: round2(platformFare + storeGp),
    payoutEligible: ['done', 'delivered'].includes(order.status) && order.riderPayoutPaid !== true && order.riderId,
    alreadyPaid: order.riderPayoutPaid === true
  };
}

function aggregate(orders) {
  const rows = orders.map(calculate);
  const sum = (key, predicate = () => true) => round2(rows.filter(predicate).reduce((t, r) => t + Number(r[key] || 0), 0));
  const payoutRows = rows.filter(r => r.payoutEligible);
  const currentAdminPayoutRows = rows.filter(r => ['done', 'delivered'].includes(r.status) && r.riderId);
  const by = (items, key, amountKey) => items.reduce((out, row) => {
    const id = row[key] || 'unknown';
    out[id] = out[id] || { orders: 0, amount: 0 };
    out[id].orders += 1;
    out[id].amount = round2(out[id].amount + Number(row[amountKey] || 0));
    return out;
  }, {});

  return {
    rows,
    completedCount: rows.filter(r => ['done', 'delivered'].includes(r.status)).length,
    currentAdmin: {
      platformFareGp: sum('platformFare'),
      storeGp: sum('storeGp'),
      riderFoodGpPayout: sum('riderFoodGp', r => ['done', 'delivered'].includes(r.status) && r.riderId),
      riderPayoutByRider: by(currentAdminPayoutRows, 'riderId', 'riderFoodGp')
    },
    safeExpected: {
      platformFareGp: sum('platformFare'),
      storeGp: sum('storeGp'),
      riderFoodGpPayout: sum('riderFoodGp', r => r.payoutEligible),
      riderPayoutByRider: by(payoutRows, 'riderId', 'riderFoodGp')
    },
    byMerchantStoreGp: by(rows.filter(r => ['done', 'delivered'].includes(r.status) && r.merchantId), 'merchantId', 'storeGp')
  };
}

const scenarios = [
  { orderId: 'SIM-RIDE-001', type: 'ride', status: 'done', paymentMode: 'transfer', riderId: 'rider-a', fare: 100 },
  { orderId: 'SIM-EXPRESS-001', type: 'express', status: 'delivered', paymentMode: 'cash', riderId: 'rider-a', fare: 150 },
  { orderId: 'SIM-FOOD-TRANSFER-001', type: 'food', status: 'done', paymentMode: 'transfer', riderId: 'rider-a', merchantId: 'shop-a', fare: 40, foodTotal: 500 },
  { orderId: 'SIM-FOOD-CASH-001', type: 'food', status: 'done', paymentMode: 'cash', riderId: 'rider-b', merchantId: 'shop-a', fare: 60, foodTotal: 850 },
  { orderId: 'SIM-CANCELLED-001', type: 'food', status: 'cancelled', paymentMode: 'transfer', riderId: 'rider-b', merchantId: 'shop-b', fare: 50, foodTotal: 300 },
  { orderId: 'SIM-PAID-001', type: 'food', status: 'done', paymentMode: 'transfer', riderId: 'rider-b', merchantId: 'shop-b', fare: 30, foodTotal: 1000, riderPayoutPaid: true },
  { orderId: 'SIM-ROUNDING-001', type: 'food', status: 'done', paymentMode: 'transfer', riderId: 'rider-b', merchantId: 'shop-b', fare: 33.33, foodTotal: 333.33 }
];

const result = {
  rates: RATES,
  assumptions: [
    'คำนวณจากฟิลด์ fare และ foodTotal/itemsTotal ตามสูตรปัจจุบัน',
    'เงินสดใช้ cashTip 5 บาทเมื่อไม่ได้ระบุ cashTip',
    'งานยกเลิกไม่นับ GP และไม่เข้า payout',
    'safeExpected ตัดออเดอร์ที่ riderPayoutPaid=true ออกจากยอดโอนไรเดอร์',
    'นี่คือ simulation แบบไม่เชื่อมต่อ Firebase Production'
  ],
  simulation: aggregate(scenarios),
  duplicatePayoutRisk: {
    currentAdminIncludesAlreadyPaid: true,
    alreadyPaidIncludedAmount: aggregate(scenarios).currentAdmin.riderPayoutByRider['rider-b']?.amount || 0,
    safeExpectedAmountForRiderB: aggregate(scenarios).safeExpected.riderPayoutByRider['rider-b']?.amount || 0
  }
};

console.log(JSON.stringify(result, null, 2));
