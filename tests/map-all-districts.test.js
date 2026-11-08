'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('map menu loads all province files when no district is selected', () => {
  assert.match(source, /function provinceFilesFor\(districtName\)[\s\S]*?if \(!districtName\) return rows;/);
  assert.match(source, /ensurePlaceData\(function\(\) \{[\s\S]*?onDestSearchInput\(\);[\s\S]*?\}, ''\);/);
});

test('map search browses all districts when query and filters are empty', () => {
  assert.match(source, /var browseAll = !q && !destCatFilter && !destDistrictFilter && !destTambonFilter;/);
  assert.match(source, /searchLocalPlaces\(q, browseAll\)/);
  assert.match(source, /searchPlaceCatalog\(q, destCatFilter, origin, limit, destDistrictFilter, destTambonFilter, browseAll\)/);
});

test('map menu has only a name search, without district or tambon selectors', () => {
  assert.match(source, /id="dest-search-input" type="search" placeholder="พิมพ์ชื่อสถานที่เพื่อค้นหา\.\.\."/);
  assert.doesNotMatch(source, /id="dest-district" class="place-district-select"/);
  assert.doesNotMatch(source, /id="dest-tambon" class="place-district-select"/);
  assert.doesNotMatch(source, /if \(!q && !destCatFilter && !destDistrictFilter && !destTambonFilter\) \{ hideDestSearchResults\(\); return; \}/);
});

test('all empty and typed place searches prioritize randomized Chauat places', () => {
  assert.match(source, /var chauat = rows\.filter\(function\(row\) \{ return \(row\.district \|\| 'ชะอวด'\) === 'ชะอวด'; \}\);/);
  assert.match(source, /rows: shufflePlaces\(chauat\)\.concat\(shufflePlaces\(other\)\)/);
  assert.match(source, /if \(!q\) \{[\s\S]*?chauat = shufflePlaces\(chauat\);[\s\S]*?rows = chauatKept\.concat\(other\);/);
  assert.match(source, /var districtRankA = \(a\.district \|\| 'ชะอวด'\) === 'ชะอวด' \? 0 : 1;/);
  assert.match(source, /var districtRankB = \(b\.district \|\| 'ชะอวด'\) === 'ชะอวด' \? 0 : 1;/);
  assert.match(source, /closeModal\(\); openMapPage\(true\); setDestSearchMode\(false\);/);
});

test('restaurant, local food, shopping, partner, and express suggestions use Chauat-first ordering', () => {
  assert.match(source, /function isChauatArea\(item\)/);
  assert.match(source, /function compareChauatFirst\(a, b, tieBreaker\)/);
  assert.ok((source.match(/compareChauatFirst\(/g) || []).length >= 7);
  assert.match(source, /var localPool = shufflePlaces\(PLACES\.filter\(function\(p\) \{ return isChauatArea\(p\); \}\)\);/);
  assert.match(source, /suggestions = localPool\.slice\(0, 4\);/);
  assert.match(source, /renderRestaurantDirectory/);
  assert.match(source, /renderLocalRestaurantList/);
  assert.match(source, /renderShoppingPlaces/);
  assert.match(source, /renderMerchantList/);
});
