const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');
const vm = require('vm');

const rider = fs.readFileSync('rider.js', 'utf8');

test('express arrival button is handled once', () => {
  assert.equal(rider.includes('onclick="arrivedAtShop('), false);
  assert.match(rider, /data-arrived="\$\{esc\(j\.id\)\}"/);
  assert.match(rider, /if \(arrivalInFlight\.has\(jobId\)\) return/);
  assert.match(rider, /else if \(t\.dataset\.arrived\) await arrivedAtShop\(t\.dataset\.arrived\)/);
});

function loadArrival() {
  const start = rider.indexOf('const arrivalInFlight');
  const end = rider.indexOf('function paySummaryText');
  const toasts = [];
  let updates = 0;
  let status = 'accepted';
  let updateGate = null;
  const context = {
    pickupOrderId: null,
    allJobs: [{ id: 'express-1', type: 'express', status: 'accepted' }],
    arrivalAlreadyRecorded: null,
    showToast: (msg) => { toasts.push(msg); },
    renderJobs: () => {},
    sendAutomatedChatLater: () => {},
    orderBuysGoods: () => false,
    orderNeedsKitchen: () => false,
    orderFoodReady: () => false,
    $: () => ({ classList: { contains: () => false } }),
    db: {
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: true, data: () => ({ status, type: 'express' }) }),
          update: async () => {
            updates += 1;
            status = 'picked_up';
            if (updateGate) await updateGate;
          }
        })
      })
    },
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'ts' } } }
  };
  vm.createContext(context);
  vm.runInContext(rider.slice(start, end), context);
  return {
    toasts,
    context,
    updates: () => updates,
    setStatus: (next) => { status = next; context.allJobs[0].status = next; },
    holdUpdate: () => { let release; updateGate = new Promise((resolve) => { release = resolve; }); return release; }
  };
}

test('express arrival writes picked_up once from accepted', async () => {
  const harness = loadArrival();
  await harness.context.arrivedAtShop('express-1');
  assert.equal(harness.updates(), 1);
  assert.equal(harness.context.allJobs[0].status, 'picked_up');
  assert.match(harness.toasts.join('\n'), /ถึงจุดนัดหมายแล้ว/);
  assert.equal(harness.toasts.some((msg) => String(msg).includes('permission-denied')), false);
});

test('express arrival does not write again while waiting for transfer', async () => {
  const harness = loadArrival();
  harness.setStatus('picked_up');
  await harness.context.arrivedAtShop('express-1');
  assert.equal(harness.updates(), 0);
  assert.match(harness.toasts.join('\n'), /ถึงจุดนัดหมายแล้ว/);
  assert.equal(harness.toasts.some((msg) => String(msg).includes('ไม่สำเร็จ')), false);
});

test('a second express arrival click does not write while the first is in flight', async () => {
  const harness = loadArrival();
  const release = harness.holdUpdate();
  const first = harness.context.arrivedAtShop('express-1');
  const second = harness.context.arrivedAtShop('express-1');
  release();
  await Promise.all([first, second]);
  assert.equal(harness.updates(), 1);
  assert.equal(harness.toasts.filter((msg) => String(msg).includes('ไม่สำเร็จ')).length, 0);
});
