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
