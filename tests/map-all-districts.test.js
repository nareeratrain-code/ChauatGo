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

test('district selection remains optional and tambon does not block the map', () => {
  assert.match(source, /<option value="">ทุกอำเภอ<\/option>/);
  assert.match(source, /if \(!district\) return '<option value="">ทุกตำบล \(ตัวกรองเสริม\)<\/option>';/);
  assert.doesNotMatch(source, /if \(!q && !destCatFilter && !destDistrictFilter && !destTambonFilter\) \{ hideDestSearchResults\(\); return; \}/);
});
