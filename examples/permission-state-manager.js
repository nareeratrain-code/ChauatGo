/*
 * ChauatGo — Runtime Permission State Manager
 *
 * ตัวอย่างสำหรับ Vanilla JS / Web App
 * - ไม่ขอสิทธิ์ตั้งแต่ First Launch
 * - ขอเมื่อผู้ใช้เริ่มใช้ฟีเจอร์จริง
 * - แยกสถานะ GPS และ Notification
 * - มี fallback เมื่อผู้ใช้ปฏิเสธ
 * - ไม่เรียก Native Permission ซ้ำ ๆ หลัง denied
 *
 * หมายเหตุ: การเปิดหน้า Settings ของเบราว์เซอร์ทำได้จำกัดบนเว็บ
 * ฟังก์ชัน openPermissionHelp() จึงควรเปิดคำแนะนำของแอปหรือหน้า Help แทน
 */

(function (global) {
  'use strict';

  var STORAGE = {
    locationAsked: 'chauat_permission_location_asked_v1',
    locationDeniedAt: 'chauat_permission_location_denied_at_v1',
    notificationAsked: 'chauat_permission_notification_asked_v1',
    notificationDeniedAt: 'chauat_permission_notification_denied_at_v1'
  };

  var COOLDOWN_MS = 24 * 60 * 60 * 1000;

  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function write(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function elapsedSince(iso) {
    var time = Date.parse(iso || '');
    return Number.isFinite(time) ? Date.now() - time : Infinity;
  }

  function isInCooldown(deniedAt) {
    return elapsedSince(deniedAt) < COOLDOWN_MS;
  }

  function emit(type, detail) {
    // เชื่อมกับ Consent/Permission Event ของระบบจริงได้ที่จุดนี้
    global.dispatchEvent(new CustomEvent('chauat:permission-event', {
      detail: Object.assign({
        type: type,
        occurredAt: nowIso(),
        source: 'runtime_permission_dialog'
      }, detail || {})
    }));
  }

  function showToast(message, kind) {
    if (typeof global.showToast === 'function') {
      global.showToast(message, kind || 'info');
      return;
    }
    console.log('[permission]', kind || 'info', message);
  }

  function openPermissionHelp(permissionType) {
    // เว็บไม่สามารถบังคับเปิด Browser Settings ได้ทุกแพลตฟอร์ม
    // ให้เปิดหน้า Help/Modal ของ ChauatGo แทน
    if (typeof global.openPermissionHelpModal === 'function') {
      global.openPermissionHelpModal(permissionType);
      return;
    }

    var message = permissionType === 'location'
      ? 'เปิดสิทธิ์ตำแหน่งของ ChauatGo ในการตั้งค่าเบราว์เซอร์ แล้วกลับมาอีกครั้ง'
      : 'เปิดสิทธิ์การแจ้งเตือนของ ChauatGo ในการตั้งค่าเบราว์เซอร์ แล้วกลับมาอีกครั้ง';
    showToast(message, 'info');
  }

  function queryBrowserPermission(name) {
    if (!navigator.permissions || !navigator.permissions.query) {
      return Promise.resolve('unknown');
    }
    return navigator.permissions.query({ name: name }).then(function (result) {
      return result.state; // granted | denied | prompt
    }).catch(function () {
      return 'unknown';
    });
  }

  function getLocationState() {
    if (!navigator.geolocation) return Promise.resolve({ state: 'unavailable' });

    return queryBrowserPermission('geolocation').then(function (browserState) {
      var deniedAt = read(STORAGE.locationDeniedAt);
      if (browserState === 'denied') return { state: 'denied', reason: 'browser', deniedAt: deniedAt };
      if (browserState === 'granted') return { state: 'granted' };
      if (browserState === 'prompt' && isInCooldown(deniedAt)) {
        return { state: 'denied', reason: 'app_cooldown', deniedAt: deniedAt };
      }
      return { state: browserState === 'unknown' ? 'prompt' : browserState };
    });
  }

  function requestLocation(options) {
    options = options || {};
    var purposeCode = options.purposeCode || 'customer.location.delivery_calculation';
    var onSuccess = options.onSuccess || function () {};
    var onFallback = options.onFallback || function () {};

    return getLocationState().then(function (status) {
      if (status.state === 'unavailable') {
        emit('permission_unavailable', { permission: 'location', purposeCode: purposeCode });
        showToast('อุปกรณ์นี้ไม่รองรับการใช้ตำแหน่ง', 'error');
        onFallback('unavailable');
        return false;
      }

      if (status.state === 'denied') {
        emit('permission_blocked', {
          permission: 'location',
          purposeCode: purposeCode,
          reason: status.reason || 'browser'
        });
        openPermissionHelp('location');
        onFallback('denied');
        return false;
      }

      return new Promise(function (resolve) {
        write(STORAGE.locationAsked, '1');
        navigator.geolocation.getCurrentPosition(function (position) {
          write(STORAGE.locationDeniedAt, '');
          emit('permission_granted', {
            permission: 'location',
            purposeCode: purposeCode,
            accuracyMeters: Math.round(position.coords.accuracy || 0)
          });
          onSuccess({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            capturedAt: nowIso()
          });
          resolve(true);
        }, function (error) {
          var denied = error && error.code === 1;
          if (denied) {
            write(STORAGE.locationDeniedAt, nowIso());
            emit('permission_denied', { permission: 'location', purposeCode: purposeCode });
            showToast('ยังไม่ได้อนุญาตใช้ตำแหน่ง คุณสามารถเลือกจุดบนแผนที่หรือกรอกที่อยู่เองได้', 'info');
            onFallback('denied');
          } else {
            emit('permission_error', {
              permission: 'location',
              purposeCode: purposeCode,
              errorCode: error && error.code
            });
            showToast('ค้นหาตำแหน่งไม่สำเร็จ ลองใหม่หรือเลือกจุดบนแผนที่', 'error');
            onFallback('error');
          }
          resolve(false);
        }, {
          enableHighAccuracy: !!options.highAccuracy,
          timeout: options.timeout || 10000,
          maximumAge: options.maximumAge || 30000
        });
      });
    });
  }

  function getNotificationState() {
    if (!('Notification' in global)) return Promise.resolve({ state: 'unavailable' });
    var deniedAt = read(STORAGE.notificationDeniedAt);
    var state = Notification.permission; // default | granted | denied
    if (state === 'default' && isInCooldown(deniedAt)) {
      return Promise.resolve({ state: 'denied', reason: 'app_cooldown', deniedAt: deniedAt });
    }
    return Promise.resolve({ state: state === 'default' ? 'prompt' : state, deniedAt: deniedAt });
  }

  function requestNotifications(options) {
    options = options || {};
    var purposeCode = options.purposeCode || 'customer.service_notifications';
    var onGranted = options.onGranted || function () {};
    var onFallback = options.onFallback || function () {};

    return getNotificationState().then(function (status) {
      if (status.state === 'unavailable') {
        emit('permission_unavailable', { permission: 'notifications', purposeCode: purposeCode });
        showToast('เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน', 'info');
        onFallback('unavailable');
        return false;
      }

      if (status.state === 'denied') {
        emit('permission_blocked', {
          permission: 'notifications',
          purposeCode: purposeCode,
          reason: status.reason || 'browser'
        });
        openPermissionHelp('notifications');
        onFallback('denied');
        return false;
      }

      write(STORAGE.notificationAsked, '1');
      return Notification.requestPermission().then(function (result) {
        if (result === 'granted') {
          write(STORAGE.notificationDeniedAt, '');
          emit('permission_granted', { permission: 'notifications', purposeCode: purposeCode });
          onGranted();
          return true;
        }

        if (result === 'denied') {
          write(STORAGE.notificationDeniedAt, nowIso());
          emit('permission_denied', { permission: 'notifications', purposeCode: purposeCode });
          showToast('ยังไม่ได้เปิดการแจ้งเตือน คุณยังดูสถานะงานได้ในหน้าออเดอร์', 'info');
          onFallback('denied');
          return false;
        }

        emit('permission_dismissed', { permission: 'notifications', purposeCode: purposeCode });
        onFallback('dismissed');
        return false;
      }).catch(function (error) {
        emit('permission_error', {
          permission: 'notifications',
          purposeCode: purposeCode,
          errorName: error && error.name
        });
        showToast('ขอสิทธิ์การแจ้งเตือนไม่สำเร็จ', 'error');
        onFallback('error');
        return false;
      });
    });
  }

  function resetPermissionCooldownForTesting(permission) {
    if (permission === 'location') write(STORAGE.locationDeniedAt, '');
    if (permission === 'notifications') write(STORAGE.notificationDeniedAt, '');
  }

  global.ChauatPermission = {
    getLocationState: getLocationState,
    requestLocation: requestLocation,
    getNotificationState: getNotificationState,
    requestNotifications: requestNotifications,
    openPermissionHelp: openPermissionHelp,
    resetPermissionCooldownForTesting: resetPermissionCooldownForTesting
  };
})(window);

/* ตัวอย่างการเรียกใช้

// ลูกค้ากด “ใช้ตำแหน่งของฉัน”
ChauatPermission.requestLocation({
  purposeCode: 'customer.location.nearby_search',
  onSuccess: function (coords) {
    // userLocation = coords;
    // renderNearbyShops();
  },
  onFallback: function (reason) {
    // เปิด flow เลือกจุดบนแผนที่หรือกรอกที่อยู่เอง
  }
});

// ไรเดอร์กด “รับงาน”
ChauatPermission.requestLocation({
  purposeCode: 'rider.location.during_active_job',
  highAccuracy: true,
  onSuccess: function (coords) {
    // startRiderTracking(coords);
  },
  onFallback: function (reason) {
    // ไม่เริ่ม tracking และแจ้งข้อจำกัดการรับงาน
  }
});

// ลูกค้ากด “เปิดการแจ้งเตือนสถานะงาน”
ChauatPermission.requestNotifications({
  purposeCode: 'customer.service_notifications',
  onGranted: function () {
    // subscribePushToken();
  },
  onFallback: function (reason) {
    // ยังคงให้ดูสถานะจากหน้า Orders ได้
  }
});
*/
