import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './LocationPicker.css';

const EMPTY_POINT = { address: '', lat: null, lng: null, accuracy: null, placeId: '' };

function normalizePoint(point) {
  const source = point || EMPTY_POINT;
  const lat = Number(source.lat);
  const lng = Number(source.lng);

  return {
    address: String(source.address || source.name || ''),
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    accuracy: Number.isFinite(Number(source.accuracy)) ? Number(source.accuracy) : null,
    placeId: source.placeId ? String(source.placeId) : '',
  };
}

function hasCoordinates(point) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lng);
}

function formatAccuracy(accuracy) {
  if (!Number.isFinite(accuracy)) return '';
  if (accuracy < 1000) return `±${Math.round(accuracy)} ม.`;
  return `±${(accuracy / 1000).toFixed(1)} กม.`;
}

function Icon({ name, size = 20 }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };

  if (name === 'crosshair') {
    return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="8" opacity=".35" /></svg>;
  }

  if (name === 'map') {
    return <svg {...common}><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" /><path d="M9 3v15M15 6v15" /><path d="M12 8.5a2.5 2.5 0 1 0 0 5c1.2-1.2 2-2.1 2-3.1a2 2 0 0 0-2-1.9Z" /></svg>;
  }

  if (name === 'swap') {
    return <svg {...common}><path d="m7 7 3-3 3 3M10 4v10" /><path d="m17 17-3 3-3-3M14 20V10" /></svg>;
  }

  return null;
}

/**
 * Two-row origin/destination picker.
 *
 * Coordinate callbacks:
 * - onChange({ type: 'origin'|'destination', point }) when text or coordinates change
 * - onUseCurrentLocation(type) when a row requests browser/device GPS
 * - onOpenMap({ type, point }) when a row requests the external Leaflet/map picker
 * - onSwap({ origin, destination }) after swapping both rows
 */
export default function LocationPicker({
  origin = EMPTY_POINT,
  destination = EMPTY_POINT,
  fareLabel = '฿30 เริ่มต้น',
  originPlaceholder = 'พิมพ์ที่อยู่ต้นทาง...',
  destinationPlaceholder = 'พิมพ์ที่อยู่ปลายทาง เช่น บ้าน',
  getCurrentPosition,
  onChange,
  onOpenMap,
  onSwap,
  onSubmit,
  disabled = false,
  className = '',
}) {
  const [points, setPoints] = useState({
    origin: normalizePoint(origin),
    destination: normalizePoint(destination),
  });
  const [activeGps, setActiveGps] = useState(null);
  const [status, setStatus] = useState({ type: null, message: '' });

  useEffect(() => {
    setPoints({ origin: normalizePoint(origin), destination: normalizePoint(destination) });
  }, [origin, destination]);

  const updatePoint = useCallback((type, patch) => {
    setPoints((current) => {
      const point = normalizePoint({ ...current[type], ...patch });
      const next = { ...current, [type]: point };
      onChange?.({ type, point, origin: next.origin, destination: next.destination });
      return next;
    });
  }, [onChange]);

  const requestCurrentLocation = useCallback(async (type) => {
    if (disabled || activeGps) return;
    setActiveGps(type);
    setStatus({ type: 'info', message: 'กำลังค้นหาตำแหน่งปัจจุบัน...' });

    try {
      const position = getCurrentPosition
        ? await getCurrentPosition(type)
        : await new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
              reject(new Error('อุปกรณ์นี้ไม่รองรับ GPS'));
              return;
            }
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 12000,
              maximumAge: 30000,
            });
          });

      const coords = position.coords || position;
      if (!Number.isFinite(Number(coords.latitude ?? coords.lat)) || !Number.isFinite(Number(coords.longitude ?? coords.lng))) {
        throw new Error('ไม่พบพิกัดที่ถูกต้อง');
      }

      const point = normalizePoint({
        ...points[type],
        lat: Number(coords.latitude ?? coords.lat),
        lng: Number(coords.longitude ?? coords.lng),
        accuracy: Number(coords.accuracy),
        address: points[type].address || 'ตำแหน่งปัจจุบัน',
      });
      updatePoint(type, point);
      setStatus({ type: 'success', message: type === 'origin' ? 'บันทึกจุดรับของแล้ว' : 'บันทึกจุดส่งของแล้ว' });
    } catch (error) {
      setStatus({ type: 'error', message: error?.message || 'ไม่สามารถค้นหาตำแหน่งได้' });
    } finally {
      setActiveGps(null);
    }
  }, [activeGps, disabled, getCurrentPosition, points, updatePoint]);

  const openMap = useCallback((type) => {
    if (disabled) return;
    onOpenMap?.({ type, point: points[type], origin: points.origin, destination: points.destination });
  }, [disabled, onOpenMap, points]);

  const swapPoints = useCallback(() => {
    if (disabled) return;
    setPoints((current) => {
      const next = { origin: current.destination, destination: current.origin };
      onSwap?.(next);
      onChange?.({ type: 'swap', ...next });
      return next;
    });
  }, [disabled, onChange, onSwap]);

  const formState = useMemo(() => ({
    originReady: hasCoordinates(points.origin),
    destinationReady: hasCoordinates(points.destination),
    ready: hasCoordinates(points.origin) && hasCoordinates(points.destination),
  }), [points]);

  const submit = (event) => {
    event.preventDefault();
    if (!formState.ready) {
      setStatus({ type: 'error', message: 'กรุณาระบุต้นทางและปลายทางให้ครบก่อนดูราคา' });
      return;
    }
    onSubmit?.({ origin: points.origin, destination: points.destination });
  };

  const renderRow = (type, label, placeholder, point, dotClass) => {
    const isOrigin = type === 'origin';
    const gpsBusy = activeGps === type;
    const rowLabel = isOrigin ? 'ต้นทาง' : 'ปลายทาง';

    return (
      <div className={`location-picker__row location-picker__row--${type}`}>
        <span className={`location-picker__dot ${dotClass}`} aria-hidden="true" />
        <label className="sr-only" htmlFor={`location-picker-${type}`}>{label}</label>
        <input
          id={`location-picker-${type}`}
          className="location-picker__input"
          value={point.address}
          placeholder={placeholder}
          autoComplete="street-address"
          disabled={disabled}
          onChange={(event) => updatePoint(type, { address: event.target.value, lat: null, lng: null })}
        />
        <button
          type="button"
          className={`location-picker__icon-button location-picker__gps ${!hasCoordinates(point) ? 'is-unset' : ''}`}
          aria-label={`ใช้ตำแหน่งปัจจุบันเป็น${rowLabel}`}
          title={`ใช้ตำแหน่งปัจจุบันเป็น${rowLabel}`}
          disabled={disabled || Boolean(activeGps)}
          onClick={() => requestCurrentLocation(type)}
        >
          <Icon name="crosshair" />
          {gpsBusy && <span className="location-picker__spinner" aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="location-picker__icon-button location-picker__map"
          aria-label={`เลือก${rowLabel}จากแผนที่`}
          title={`เลือก${rowLabel}จากแผนที่`}
          disabled={disabled}
          onClick={() => openMap(type)}
        >
          <Icon name="map" />
        </button>
        {hasCoordinates(point) && (
          <span className="location-picker__coordinates" aria-label={`พิกัด${rowLabel}`}>
            ✓ {formatAccuracy(point.accuracy) || 'มีพิกัดแล้ว'}
          </span>
        )}
      </div>
    );
  };

  return (
    <form className={`location-picker ${className}`} onSubmit={submit} noValidate>
      <div className="location-picker__header">
        <div className="location-picker__title"><span aria-hidden="true">📦</span><strong>ส่งด่วน</strong></div>
        <div className="location-picker__fare" aria-label={`ค่าเริ่มต้น ${fareLabel}`}>{fareLabel}</div>
      </div>

      <div className="location-picker__route" aria-label="เส้นทางต้นทางและปลายทาง">
        {renderRow('origin', 'ที่อยู่ต้นทาง', originPlaceholder, points.origin, 'location-picker__dot--origin')}
        <div className="location-picker__connector" aria-hidden="true" />
        <button
          type="button"
          className="location-picker__swap"
          aria-label="สลับต้นทางและปลายทาง"
          title="สลับต้นทางและปลายทาง"
          disabled={disabled}
          onClick={swapPoints}
        >
          <Icon name="swap" />
        </button>
        {renderRow('destination', 'ที่อยู่ปลายทาง', destinationPlaceholder, points.destination, 'location-picker__dot--destination')}
      </div>

      {!formState.originReady && (
        <div className="location-picker__hint" role="status">ยังไม่ทราบตำแหน่งต้นทาง • แตะ ◎ เพื่อใช้ตำแหน่งปัจจุบัน</div>
      )}
      {status.message && <div className={`location-picker__status location-picker__status--${status.type}`} role={status.type === 'error' ? 'alert' : 'status'}>{status.message}</div>}

      <button className="location-picker__submit" type="submit" disabled={disabled || !formState.ready}>
        {formState.ready ? 'ดูราคา' : 'ระบุต้นทางและปลายทาง'}
      </button>
    </form>
  );
}

export { EMPTY_POINT, hasCoordinates, normalizePoint };
