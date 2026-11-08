# LocationPicker integration

`LocationPicker.jsx` เป็น React component แบบ controlled สำหรับฟอร์มส่งด่วน 2 แถว โดยรับพิกัดเป็น `{ address, lat, lng, accuracy, placeId }` และเปิดแผนที่ผ่าน callback `onOpenMap` เพื่อให้ host ที่ใช้ Leaflet หรือ Map Picker เดิมเป็นผู้ควบคุมแผนที่

> Repository ปัจจุบันเป็น Vanilla JS จึงยังไม่ได้ mount component นี้เข้า `index.html` โดยตรง การนำไปใช้ต้องมี React runtime/bundler เช่น Vite, Next.js หรือ React host แยกต่างหาก

## ตัวอย่างใช้งานกับ Leaflet

```jsx
import { useCallback, useState } from 'react';
import LocationPicker from './LocationPicker';

const blankPoint = { address: '', lat: null, lng: null, accuracy: null, placeId: '' };

export default function ExpressLocationForm({ mapPicker }) {
  const [origin, setOrigin] = useState(blankPoint);
  const [destination, setDestination] = useState(blankPoint);

  const handleChange = useCallback(({ type, point }) => {
    if (type === 'origin') setOrigin(point);
    if (type === 'destination') setDestination(point);
  }, []);

  const handleOpenMap = useCallback(({ type, point }) => {
    // mapPicker.open รับ mode และจุดเริ่มต้น แล้วเรียก onPick เมื่อผู้ใช้ยืนยันหมุด
    mapPicker.open({
      mode: type === 'origin' ? 'exp-origin' : 'exp-destination',
      point,
      onPick: (picked) => {
        const next = {
          address: picked.address || picked.name || '',
          lat: Number(picked.lat),
          lng: Number(picked.lng),
          accuracy: Number.isFinite(Number(picked.accuracy)) ? Number(picked.accuracy) : null,
          placeId: picked.placeId || picked.id || '',
        };
        if (type === 'origin') setOrigin(next);
        else setDestination(next);
      },
    });
  }, [mapPicker]);

  const getCurrentPosition = useCallback(() => new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 30000,
    });
  }), []);

  return (
    <LocationPicker
      origin={origin}
      destination={destination}
      getCurrentPosition={getCurrentPosition}
      onChange={handleChange}
      onOpenMap={handleOpenMap}
      onSwap={({ origin: nextOrigin, destination: nextDestination }) => {
        setOrigin(nextOrigin);
        setDestination(nextDestination);
      }}
      onSubmit={({ origin: finalOrigin, destination: finalDestination }) => {
        // ส่งไปคำนวณค่าโดยสารหรือสร้าง draft/order ของ Express
        console.log('quote', { finalOrigin, finalDestination });
      }}
    />
  );
}
```

## Adapter สำหรับฟังก์ชันเดิมใน `index.html`

ฟังก์ชันเดิมใช้ `openMapPicker('exp-origin')` และ `openMapPicker('exp-destination')` ซึ่งเป็น imperative API และจะอัปเดต `expOrigin`/`expDestination` ภายในหน้าเดิม เมื่อ React component ถูกใช้เป็น shell แยก ให้ส่ง callback แบบนี้:

```jsx
const handleOpenMap = ({ type }) => {
  const mode = type === 'origin' ? 'exp-origin' : 'exp-destination';
  window.openMapPicker?.(mode);
};
```

หลัง `confirmMapLocation()` ของหน้าเดิมทำงาน ให้ bridge ส่งค่ากลับเข้า React ด้วย custom event หรือ callback ที่ host สร้างขึ้น เช่น:

```js
window.dispatchEvent(new CustomEvent('chauatgo:location-picked', {
  detail: { mode: 'exp-origin', lat, lng, address, placeId }
}));
```

แล้วใน React:

```jsx
useEffect(() => {
  const onPicked = (event) => {
    const { mode, ...picked } = event.detail || {};
    const type = mode === 'exp-origin' ? 'origin' : 'destination';
    const point = {
      address: picked.address || '',
      lat: Number(picked.lat),
      lng: Number(picked.lng),
      accuracy: picked.accuracy ?? null,
      placeId: picked.placeId || '',
    };
    if (type === 'origin') setOrigin(point);
    else setDestination(point);
  };
  window.addEventListener('chauatgo:location-picked', onPicked);
  return () => window.removeEventListener('chauatgo:location-picked', onPicked);
}, []);
```

## Contract ของ `onOpenMap`

```ts
type LocationPoint = {
  address: string;
  lat: number | null;
  lng: number | null;
  accuracy?: number | null;
  placeId?: string;
};

type MapRequest = {
  type: 'origin' | 'destination';
  point: LocationPoint;
  origin: LocationPoint;
  destination: LocationPoint;
};
```

แนะนำให้ Map Picker แสดงหัวข้อแตกต่างกันตาม `type`:

- `origin` → `เลือกจุดรับของ`
- `destination` → `เลือกจุดส่งของ`

และเมื่อยืนยันแล้วคืน `{ lat, lng, address, placeId }` กลับมาที่ callback เพื่อไม่ให้ GPS, จุดสีบนฟอร์ม และข้อความสถานที่แยกกัน
