const fs = require('fs');
const path = require('path');
const test = require('node:test');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} = require('@firebase/rules-unit-testing');

const ROOT = path.join(__dirname, '../../..');
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const OVER = new Uint8Array(5 * 1024 * 1024 + 1);

function put(storage, objectPath, meta) {
  return storage.ref(objectPath).put(JPEG, meta || { contentType: 'image/jpeg' });
}

test('storage rules match every client upload path', async () => {
  const env = await initializeTestEnvironment({
    projectId: 'chauat-go-b9841',
    firestore: { rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') },
    storage: { rules: fs.readFileSync(path.join(ROOT, 'storage.rules'), 'utf8') }
  });
  try {
    await env.clearFirestore();
    await env.clearStorage();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await db.doc('users/rider1').set({ role: 'rider' });
      await db.doc('users/rider2').set({ role: 'rider' });
      await db.doc('users/cust1').set({ role: 'user' });
      await db.doc('users/shop1').set({ role: 'merchant' });
      await db.doc('users/admin1').set({ role: 'admin', isPending: false });
      await db.doc('users/stranger').set({ role: 'user' });
      await db.doc('riders/rider1').set({ verified: true, riderId: 'rider1' });
      await db.doc('riders/rider2').set({ verified: true, riderId: 'rider2' });
      await db.doc('merchants/shop1').set({ verified: true, name: 'shop' });
      await db.doc('orders/ord1').set({
        type: 'food',
        status: 'accepted',
        userId: 'cust1',
        merchantId: 'shop1',
        riderId: 'rider1',
        code: 'OD-TEST',
        fare: 20,
        items: [{ name: 'item', qty: 1, price: 70 }]
      });
      await db.doc('chats/ord1').set({
        orderId: 'ord1',
        userId: 'cust1',
        riderId: 'rider1',
        merchantId: 'shop1'
      });
    });

    const rider = env.authenticatedContext('rider1');
    const other = env.authenticatedContext('rider2');
    const cust = env.authenticatedContext('cust1');
    const shop = env.authenticatedContext('shop1');
    const admin = env.authenticatedContext('admin1');
    const stranger = env.authenticatedContext('stranger');
    const anon = env.unauthenticatedContext();
    const rs = rider.storage();
    const os = other.storage();
    const cs = cust.storage();
    const ss = shop.storage();
    const as = admin.storage();
    const ts = stranger.storage();

    const checks = [
      ['rider pickup photo jpeg', () => assertSucceeds(put(rs, 'orders/ord1/food_1.jpg'))],
      ['rider pickup photo without a type', () => assertSucceeds(put(rs, 'orders/ord1/food_2.jpg', { contentType: 'application/octet-stream' }))],
      ['rider pickup photo empty type', () => assertSucceeds(put(rs, 'orders/ord1/food_3.jpg', { contentType: '' }))],
      ['other rider pickup photo', () => assertFails(put(os, 'orders/ord1/food_x.jpg'))],
      ['customer pickup photo', () => assertFails(put(cs, 'orders/ord1/food_c.jpg'))],
      ['shop pickup photo', () => assertFails(put(ss, 'orders/ord1/food_s.jpg'))],
      ['stranger pickup photo', () => assertFails(put(ts, 'orders/ord1/food_t.jpg'))],
      ['pdf named as a pickup photo', () => assertFails(put(rs, 'orders/ord1/food_4.jpg', { contentType: 'application/pdf' }))],
      ['octet-stream without an image name', () => assertFails(put(rs, 'orders/ord1/notes.txt', { contentType: 'application/octet-stream' }))],
      ['pickup photo over 5MB', () => assertFails(rs.ref('orders/ord1/big.jpg').put(OVER, { contentType: 'image/jpeg' }))],
      ['rider payment QR', () => assertSucceeds(put(rs, 'rider_qr/rider1/payment-qr.jpg'))],
      ['other rider payment QR', () => assertFails(put(os, 'rider_qr/rider1/payment-qr-2.jpg'))],
      ['customer cannot upload rider payment QR', () => assertFails(put(cs, 'rider_qr/rider1/payment-qr-3.jpg'))],
      ['rider reads own payment QR', () => assertSucceeds(rs.ref('rider_qr/rider1/payment-qr.jpg').getMetadata())],
      ['customer cannot read rider payment QR metadata', () => assertFails(cs.ref('rider_qr/rider1/payment-qr.jpg').getMetadata())],
      ['customer reads pickup photo', () => assertSucceeds(cs.ref('orders/ord1/food_1.jpg').getMetadata())],
      ['shop reads pickup photo', () => assertSucceeds(ss.ref('orders/ord1/food_1.jpg').getMetadata())],
      ['admin reads pickup photo', () => assertSucceeds(as.ref('orders/ord1/food_1.jpg').getMetadata())],
      ['stranger reads pickup photo', () => assertFails(ts.ref('orders/ord1/food_1.jpg').getMetadata())],
      ['rider deletes own pickup photo', () => assertSucceeds(rs.ref('orders/ord1/food_3.jpg').delete())],
      ['customer cannot delete pickup photo', () => assertFails(cs.ref('orders/ord1/food_2.jpg').delete())],

      ['rider shop-payment slip', () => assertSucceeds(put(rs, 'slips/riders/rider1/ord1_1.jpg'))],
      ['rider shop-payment slip without a type', () => assertSucceeds(put(rs, 'slips/riders/rider1/ord1_2.jpg', { contentType: 'application/octet-stream' }))],
      ['customer shop-payment slip', () => assertFails(put(cs, 'slips/riders/cust1/ord1_1.jpg'))],
      ['rider writes another rider slip folder', () => assertFails(put(rs, 'slips/riders/rider2/ord1_1.jpg'))],
      ['stranger reads rider slip', () => assertFails(ts.ref('slips/riders/rider1/ord1_1.jpg').getMetadata())],
      ['admin reads rider slip', () => assertSucceeds(as.ref('slips/riders/rider1/ord1_1.jpg').getMetadata())],
      ['admin deletes rider slip', () => assertSucceeds(as.ref('slips/riders/rider1/ord1_2.jpg').delete())],

      ['customer chat image', () => assertSucceeds(put(cs, 'chats/ord1/images/1_cust1.jpg'))],
      ['rider chat image', () => assertSucceeds(put(rs, 'chats/ord1/images/1_rider1.jpg'))],
      ['shop chat image', () => assertSucceeds(put(ss, 'chats/ord1/images/1_shop1.jpg'))],
      ['stranger chat image', () => assertFails(put(ts, 'chats/ord1/images/1_stranger.jpg'))],
      ['customer parcel photo in own folder', () => assertSucceeds(put(cs, 'chats/cust1/images/parcel_1.jpg'))],
      ['stranger parcel photo in customer folder', () => assertFails(put(ts, 'chats/cust1/images/parcel_2.jpg'))],
      ['admin chat image outside images/', () => assertSucceeds(put(as, 'chats/ord1/1700000000000.jpg', { contentType: 'application/octet-stream' }))],
      ['rider chat image outside images/', () => assertFails(put(rs, 'chats/ord1/1700000000001.jpg'))],

      ['shop menu photo', () => assertSucceeds(put(ss, 'menus/shop1/1.jpg'))],
      ['rider menu photo', () => assertFails(put(rs, 'menus/shop1/2.jpg'))],
      ['anonymous menu read', () => assertSucceeds(anon.storage().ref('menus/shop1/1.jpg').getMetadata())],
      ['shop avatar', () => assertSucceeds(put(ss, 'shops/shop1/avatar_1.jpg'))],
      ['customer shop avatar', () => assertFails(put(cs, 'shops/shop1/avatar_2.jpg'))],
      ['shop GP slip', () => assertSucceeds(put(ss, 'gp_slips/shop1/1.jpg'))],
      ['shop GP slip without a type', () => assertSucceeds(put(ss, 'gp_slips/shop1/2.jpg', { contentType: 'application/octet-stream' }))],
      ['rider GP slip', () => assertFails(put(rs, 'gp_slips/rider1/1.jpg'))],
      ['stranger reads GP slip', () => assertFails(ts.ref('gp_slips/shop1/1.jpg').getMetadata())],
      ['admin reads GP slip', () => assertSucceeds(as.ref('gp_slips/shop1/1.jpg').getMetadata())],

      ['admin order slip', () => assertSucceeds(put(as, 'slips/orders/ord1/admin-1.jpg'))],
      ['admin order slip without a type', () => assertSucceeds(put(as, 'slips/orders/ord1/admin-2.png', { contentType: 'application/octet-stream' }))],
      ['rider admin slip', () => assertFails(put(rs, 'slips/orders/ord1/admin-3.jpg'))],
      ['customer reads admin slip', () => assertSucceeds(cs.ref('slips/orders/ord1/admin-1.jpg').getMetadata())],
      ['admin deletes admin slip', () => assertSucceeds(as.ref('slips/orders/ord1/admin-2.png').delete())],
      ['rider cannot delete admin slip', () => assertFails(rs.ref('slips/orders/ord1/admin-1.jpg').delete())]
    ];

    for (const [name, run] of checks) {
      try {
        await run();
      } catch (err) {
        const detail = err && (err.message || err.code) || err;
        throw new Error(name + ': ' + detail);
      }
    }
  } finally {
    await env.cleanup();
  }
});
