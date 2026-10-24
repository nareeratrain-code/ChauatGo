const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');

const rider = fs.readFileSync('rider.js', 'utf8');
const heroStart = rider.indexOf('function updateHeroStats');
const heroEnd = rider.indexOf('const JOB_FILTERS');
const hero = rider.slice(heroStart, heroEnd);

test('rider dashboard job count uses the one-job cap, not the offer rate', () => {
  assert.match(rider, /function riderJobLimit/);
  assert.match(rider, /if \(!Number\.isFinite\(raw\) \|\| raw <= 0\) return 1;/);
  assert.match(hero, /รับงาน \$\{activeCount\}\/\$\{riderJobLimit\(\)\}/);
  assert.equal(hero.includes('offersAccepted'), false);
  assert.equal(hero.includes('offersTotal'), false);
  assert.match(rider, /อัตรารับงาน:/);
  assert.match(rider, /ข้อเสนอ/);
});
