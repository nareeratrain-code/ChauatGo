'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Orders = require('../orders');

function memoryDb(docs) {
  const written = [];
  let seq = 0;
  function refFor(name, id) {
    const path = name + '/' + id;
    return {
      id: id,
      path: path,
      async get() {
        const data = docs[path];
        return { exists: data != null, id: id, data: () => data };
      },
      async set(body) {
        docs[path] = body;
        written.push(body);
      }
    };
  }
  return {
    written: written,
    collection(name) {
      return {
        doc(id) {
          return refFor(name, id || ('id-' + (++seq)));
        }
      };
    },
    getAll() {
      const refs = Array.prototype.slice.call(arguments);
      return Promise.all(refs.map((ref) => ref.get()));
    }
  };
}

test('a shop without coordinates still uses the ฿20 base fee', async () => {
  const db = memoryDb({
    'merchants/shop-nocoord': { name: 'ร้านทดสอบไม่มีพิกัด', verified: true },
    'menus/menu-somtum': { merchantId: 'shop-nocoord', name: 'ส้มตำทดสอบ', price: 70, status: 'available' },
    'menus/menu-tea': { merchantId: 'shop-nocoord', name: 'ชาทดสอบ', price: 35, status: 'available' }
  });
  const created = await Orders.createOrder(db, 'customer-fee', {
    type: 'food',
    merchantId: 'shop-nocoord',
    shopPlaceLat: null,
    shopPlaceLng: null,
    lat: null,
    lng: null,
    paymentMode: 'transfer',
    items: [
      { menuId: 'menu-somtum', qty: 3, price: 1 },
      { menuId: 'menu-tea', qty: 3, price: 1 }
    ],
    fare: 999,
    total: 1
  });
  assert.equal(created.fare, 20);
  assert.equal(created.cashTip, 0);
  assert.equal(created.total, 335);
  assert.equal(created.distanceKm, 0);
  const saved = db.written[0];
  assert.equal(Object.prototype.hasOwnProperty.call(saved, 'shopPlaceLat'), false);
  assert.equal(saved.netTotal, 315);
  assert.equal(saved.status, 'searching');
  assert.equal(JSON.stringify(saved).includes('เหล่าเต๊ง'), false);

  const cashDb = memoryDb({
    'merchants/shop-nocoord': { name: 'ร้านทดสอบไม่มีพิกัด' },
    'menus/menu-somtum': { merchantId: 'shop-nocoord', name: 'ส้มตำทดสอบ', price: 70 },
    'menus/menu-tea': { merchantId: 'shop-nocoord', name: 'ชาทดสอบ', price: 35 }
  });
  const cash = await Orders.createOrder(cashDb, 'customer-fee', {
    type: 'food',
    merchantId: 'shop-nocoord',
    paymentMode: 'cash',
    items: [
      { menuId: 'menu-somtum', qty: 3 },
      { menuId: 'menu-tea', qty: 3 }
    ]
  });
  assert.equal(cash.fare, 20);
  assert.equal(cash.cashTip, 5);
  assert.equal(cash.total, 340);
});
