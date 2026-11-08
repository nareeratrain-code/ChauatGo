const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');

const html = fs.readFileSync('index.html', 'utf8');

function sliceBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  assert.notEqual(start, -1, `ไม่พบจุดเริ่มต้น: ${startMarker}`);
  assert.notEqual(end, -1, `ไม่พบจุดสิ้นสุด: ${endMarker}`);
  return html.slice(start, end);
}

test('Hotel UI เป็นปลายทางสำหรับเรียกรถเท่านั้น ไม่แสดงปุ่มจองห้องพักหรือ Agoda', () => {
  const hotelUi = sliceBetween('<div id="hotel-tools"', '<div id="tourist-tools"');
  assert.match(html, /function renderHotelCardHTML\(p\)/);
  assert.doesNotMatch(hotelUi, /openHotelBooking|hotelBookingUrl|ค้นหา Agoda|Agoda|จองห้องพัก|จองที่พัก/i);
});

test('Hotel card มี action ปลายทาง และไม่มี booking action', () => {
  const renderer = sliceBetween('function renderHotelCardHTML(p)', 'function renderTouristDirectory()');
  assert.match(renderer, /class="hotel-action destination"/);
  assert.match(renderer, /setDestFromPlace/);
  assert.doesNotMatch(renderer, /class="hotel-action book"|openHotelBooking|Agoda|booking/i);
});

test('Hotel detail มีเฉพาะโทร ดู Maps และเพิ่มเป็นปลายทาง', () => {
  const detail = sliceBetween('function openHotelDetail(p)', 'window.showPlaceDetail = function(placeId)');
  assert.match(detail, /callHotelById/);
  assert.match(detail, /hotelMapsUrl/);
  assert.match(detail, /setDestFromPlace/);
  assert.doesNotMatch(detail, /openHotelBooking|hotelBookingUrl|Agoda|จองห้องพัก|จองที่พัก/i);
});

test('การเลือกโรงแรมต้องเปิด Ride destination picker และไม่สร้าง booking payload', () => {
  const handler = sliceBetween('window.setDestFromPlace = function(placeId)', '\n};');
  assert.match(handler, /mapPickerMode = 'ride-dest'/);
  assert.match(handler, /openMapPage\(true\)/);
  assert.match(handler, /setDestination\(p\.lat, p\.lng, true, p\.name, p\.id \|\| placeId\)/);
  assert.doesNotMatch(handler, /booking|hotelBooking|room|checkIn|checkOut|Agoda/i);
});

test('Hotel flow ไม่มีฟังก์ชันเปิดลิงก์จองหรือ URL จองภายนอก', () => {
  assert.doesNotMatch(html, /function hotelBookingUrl\s*\(/);
  assert.doesNotMatch(html, /function openHotelBooking\s*\(/);
  assert.doesNotMatch(html, /agoda\.com|ค้นหาที่พักต่อบน Agoda|ค้นหา Agoda/i);
});

test('Hotel destination flow ไม่รับฟิลด์ห้องพักหรือวันที่เข้าพัก', () => {
  const hotelFlow = [
    sliceBetween('function renderHotelCardHTML(p)', 'function renderTouristDirectory()'),
    sliceBetween('function openHotelDetail(p)', 'window.showPlaceDetail = function(placeId)'),
    sliceBetween('window.setDestFromPlace = function(placeId)', '\n};'),
  ].join('\n');
  assert.doesNotMatch(hotelFlow, /roomType|roomCount|checkIn|checkOut|วันเข้าพัก|คืนพัก|จำนวนห้อง/i);
});
