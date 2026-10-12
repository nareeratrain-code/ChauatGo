rules_version = '2';

/* ═══════════════════════════════════════════════════════════════════════════
   CHAUAT GO — FIRESTORE SECURITY RULES
   Version: v3.8.0 PRODUCTION
   Project: chauat-go-b9841
   Updated: 2025-10-13
   
   ─────────────────────────────────────────────────────────────────────────
   🔒 SECURITY MODEL
   ─────────────────────────────────────────────────────────────────────────
   • Default deny
   • Owner-based access + role override
   • Field-level validation
   • Immutable fields (role/createdAt/verified)
   • Status transition validation for orders
   • Chat member verification
   ═══════════════════════════════════════════════════════════════════════════ */

service cloud.firestore {
  match /databases/{database}/documents {

    /* ═════════════════════════════════════════════════════════════════════
       SECTION 1: HELPERS
       ═════════════════════════════════════════════════════════════════════ */

    function isAuth() {
      return request.auth != null;
    }

    function myUid() {
      return request.auth.uid;
    }

    function isAdmin() {
      return isAuth()
        && exists(/databases/$(database)/documents/admins/$(myUid()));
    }

    function isMerchant() {
      return isAuth()
        && exists(/databases/$(database)/documents/merchants/$(myUid()));
    }

    function isRider() {
      return isAuth()
        && exists(/databases/$(database)/documents/riders/$(myUid()));
    }

    function onlyChanged(allowedFields) {
      return request.resource.data.diff(resource.data).affectedKeys()
             .hasOnly(allowedFields);
    }

    function unchanged(forbiddenFields) {
      return !request.resource.data.diff(resource.data).affectedKeys()
              .hasAny(forbiddenFields);
    }

    function isValidString(value, minLen, maxLen) {
      return value is string
        && value.size() >= minLen
        && value.size() <= maxLen;
    }

    function isValidNumber(value, min, max) {
      return value is number
        && value >= min
        && value <= max;
    }

    function hasField(fieldName) {
      return fieldName in request.resource.data;
    }

    function isChatMember(chatId) {
      return isAuth()
        && exists(/databases/$(database)/documents/chats/$(chatId))
        && (
          get(/databases/$(database)/documents/chats/$(chatId)).data.userId == myUid()
          || get(/databases/$(database)/documents/chats/$(chatId)).data.riderId == myUid()
          || get(/databases/$(database)/documents/chats/$(chatId)).data.merchantId == myUid()
        );
    }

    function isOrderParticipant() {
      return isAuth()
        && (
          resource.data.userId == myUid()
          || resource.data.riderId == myUid()
          || resource.data.merchantId == myUid()
        );
    }

    /* ═════════════════════════════════════════════════════════════════════
       SECTION 2: ADMINS
       ═════════════════════════════════════════════════════════════════════ */
    match /admins/{adminId} {
      allow read: if isAuth() && (adminId == myUid() || isAdmin());
      allow create: if isAdmin()
        && isValidString(request.resource.data.email, 5, 100);
      allow update: if isAdmin()
        && unchanged(['email', 'createdAt']);
      allow delete: if isAdmin();
    }

    /* ═════════════════════════════════════════════════════════════════════
       SECTION 3: USERS
       ═════════════════════════════════════════════════════════════════════ */
    match /users/{userId} {
      allow read: if isAuth() && (userId == myUid() || isAdmin());

      /* CREATE — สร้าง doc ตัวเอง + role ต้องอยู่ใน list */
      allow create: if isAuth()
        && userId == myUid()
        && hasField('role')
        && request.resource.data.role in ['user', 'merchant', 'rider'];

      /* UPDATE — เจ้าของ + ห้ามแก้ role/createdAt */
      allow update: if isAuth()
        && userId == myUid()
        && unchanged(['role', 'createdAt'])
        && (!hasField('name') || isValidString(request.resource.data.name, 1, 100))
        && (!hasField('phone') || isValidString(request.resource.data.phone, 0, 20))
        && (!hasField('lineId') || isValidString(request.resource.data.lineId, 0, 50))
        && (!hasField('address') || isValidString(request.resource.data.address, 0, 300));

      /* set(merge) — รองรับทั้ง create + update */
      allow write: if isAuth()
        && userId == myUid()
        && (
          !exists(/databases/$(database)/documents/users/$(userId))
          || unchanged(['role', 'createdAt'])
        );

      allow delete: if isAdmin();
    }

    /* ═════════════════════════════════════════════════════════════════════
       SECTION 4: MERCHANTS
       ═════════════════════════════════════════════════════════════════════ */
    match /merchants/{merchantId} {
      allow read: if isAuth();

      /* CREATE — สมัครร้าน */
      allow create: if isAuth()
        && merchantId == myUid()
        && request.resource.data.verified == false
        && (
          !hasField('gpStartDate')
          || request.resource.data.gpStartDate == null
        )
        && isValidString(request.resource.data.name, 2, 100);

      /* UPDATE — เจ้าของ (ห้าม verified/gp) หรือ admin */
      allow update: if isAdmin()
        || (
          isAuth()
          && merchantId == myUid()
          && unchanged([
            'verified',
            'gpStartDate',
            'gpPending',
            'gpPaid',
            'createdAt'
          ])
        );

      allow delete: if isAdmin();
    }

    /* ═════════════════════════════════════════════════════════════════════
       SECTION 5: RIDERS
       ═════════════════════════════════════════════════════════════════════ */
    match /riders/{riderId} {
      allow read: if isAuth();

      /* CREATE — สมัครไรเดอร์ */
      allow create: if isAuth()
        && riderId == myUid()
        && request.resource.data.verified == false
        && isValidString(request.resource.data.name, 2, 100);

      /* UPDATE — เจ้าของ (ห้าม verified/createdAt) หรือ admin */
      allow update: if isAdmin()
        || (
          isAuth()
          && riderId == myUid()
          && unchanged(['verified', 'createdAt'])
          && (!hasField('status') || request.resource.data.status in ['active', 'inactive'])
        );

      allow delete: if isAdmin();
    }

    /* ═════════════════════════════════════════════════════════════════════
       SECTION 6: MENUS
       ═════════════════════════════════════════════════════════════════════ */
    match /menus/{menuId} {
      allow read: if isAuth();

      allow create: if isAuth()
        && isMerchant()
        && request.resource.data.merchantId == myUid()
        && isValidString(request.resource.data.name, 1, 200)
        && isValidNumber(request.resource.data.price, 0, 100000);

      allow update: if isAuth()
        && isMerchant()
        && resource.data.merchantId == myUid()
        && request.resource.data.merchantId == resource.data.merchantId
        && isValidString(request.resource.data.name, 1, 200)
        && isValidNumber(request.resource.data.price, 0, 100000);

      allow delete: if isAuth()
        && isMerchant()
        && resource.data.merchantId == myUid();
    }

    /* ═════════════════════════════════════════════════════════════════════
       SECTION 7: ORDERS — Flow A + Status Transition Validation
       ═════════════════════════════════════════════════════════════════════
       
       FLOW A:
       pending → cooking → ready → accepted → picked_up
              → on_the_way → delivered → done
       
       ═════════════════════════════════════════════════════════════════════ */
    match /orders/{orderId} {

      /* READ — participants + rider looking + admin */
      allow read: if isAuth() && (
        resource.data.userId == myUid()
        || resource.data.riderId == myUid()
        || resource.data.merchantId == myUid()
        || (
          isRider()
          && resource.data.status == 'ready'                // ⭐ rider เห็นเฉพาะ ready
          && (!('riderId' in resource.data) || resource.data.riderId == null)
        )
        || isAdmin()
      );

      /* CREATE — ลูกค้าสร้าง order ของตัวเอง */
      allow create: if isAuth()
        && request.resource.data.userId == myUid()
        && request.resource.data.status in ['pending', 'searching']
        && request.resource.data.type in ['food', 'ride', 'express', 'shopping']
        && isValidNumber(request.resource.data.total, 0, 100000);

      /* UPDATE — Validate status transition */
      allow update: if isAuth() && (

        /* [A] ลูกค้ายกเลิก — pending/searching → cancelled */
        (
          resource.data.userId == myUid()
          && resource.data.status in ['pending', 'searching']
          && request.resource.data.status == 'cancelled'
          && onlyChanged(['status', 'cancelledAt', 'cancelReason', 'updatedAt'])
        )

        /* [B] Rider รับงาน — ready → accepted */
        || (
          isRider()
          && resource.data.status == 'ready'                // ⭐ เฉพาะ ready
          && (!('riderId' in resource.data) || resource.data.riderId == null)
          && request.resource.data.riderId == myUid()
          && request.resource.data.status == 'accepted'
          && request.resource.data.total == resource.data.total
        )

        /* [C] Rider เปลี่ยนสถานะ — accepted → picked_up → on_the_way → done */
        || (
          resource.data.riderId == myUid()
          && (
            (resource.data.status == 'accepted' && request.resource.data.status == 'picked_up')
            || (resource.data.status == 'picked_up' && request.resource.data.status == 'on_the_way')
            || (resource.data.status == 'on_the_way' && request.resource.data.status in ['delivered', 'done'])
          )
        )

        /* [D] Rider ยกเลิก — accepted/picked_up → cancelled */
        || (
          resource.data.riderId == myUid()
          && resource.data.status in ['accepted', 'picked_up']
          && request.resource.data.status == 'cancelled'
          && onlyChanged(['status', 'cancelledAt', 'cancelReason', 'riderId', 'updatedAt'])
        )

        /* [E] Merchant เปลี่ยนสถานะ — pending → cooking → ready */
        || (
          resource.data.merchantId == myUid()
          && (
            (resource.data.status == 'pending' && request.resource.data.status in ['cooking', 'cancelled'])
            || (resource.data.status == 'cooking' && request.resource.data.status in ['ready', 'cancelled'])
          )
        )

        /* [F] ลูกค้ารีวิว */
        || (
          resource.data.userId == myUid()
          && resource.data.status in ['delivered', 'done']
          && request.resource.data.rated == true
          && onlyChanged(['rated', 'ratedAt'])
        )

        /* [G] Admin */
        || isAdmin()
      );

      allow delete: if isAdmin();
    }

    /* ═════════════════════════════════════════════════════════════════════
       SECTION 8: RATINGS
       ═════════════════════════════════════════════════════════════════════ */
    match /ratings/{ratingId} {
      allow read: if isAuth();
      allow create: if isAuth()
        && request.resource.data.userId == myUid()
        && ratingId == request.resource.data.orderId
        && isValidNumber(request.resource.data.riderRating, 0, 5)
        && isValidNumber(request.resource.data.merchantRating, 0, 5)
        && isValidString(request.resource.data.comment, 0, 500);
      allow update: if false;
      allow delete: if isAdmin();
    }

    /* ═════════════════════════════════════════════════════════════════════
       SECTION 9: GPS RIDERS
       ═════════════════════════════════════════════════════════════════════ */
    match /gps_riders/{riderId} {
      allow read: if isAuth();
      allow create, update: if isAuth()
        && riderId == myUid()
        && isValidNumber(request.resource.data.lat, -90, 90)
        && isValidNumber(request.resource.data.lng, -180, 180);
      allow delete: if isAuth() && riderId == myUid();
    }

    /* ═════════════════════════════════════════════════════════════════════
       SECTION 10: CHATS + MESSAGES — Production Grade
       ═════════════════════════════════════════════════════════════════════ */
    match /chats/{chatId} {

      /* READ — เฉพาะสมาชิกแชท */
      allow read: if isAuth() && (
        isChatMember(chatId)
        || !exists(/databases/$(database)/documents/chats/$(chatId))
      );

      /* CREATE — orderId == chatId + เป็น 1 ใน 3 roles */
      allow create: if isAuth()
        && request.resource.data.orderId == chatId
        && (
          request.resource.data.userId == myUid()
          || request.resource.data.riderId == myUid()
          || request.resource.data.merchantId == myUid()
        );

      /* UPDATE — เฉพาะสมาชิก */
      allow update: if isChatMember(chatId) || isAdmin();

      allow delete: if isAdmin();

      /* ═══ MESSAGES ═══ */
      match /messages/{messageId} {
        allow read: if isChatMember(chatId) || isAdmin();

        allow create: if isChatMember(chatId)
          && request.resource.data.senderId == myUid()
          && isValidString(request.resource.data.senderName, 1, 200)
          && (
            (request.resource.data.text is string
              && request.resource.data.text.size() > 0
              && request.resource.data.text.size() <= 1000)
            || (request.resource.data.imageUrl is string
              && request.resource.data.imageUrl.size() > 0
              && request.resource.data.imageUrl.size() <= 500)
          );

        allow update: if false;
        allow delete: if isAdmin();
      }
    }

    /* ═════════════════════════════════════════════════════════════════════
       SECTION 11: GP TRANSFERS
       ═════════════════════════════════════════════════════════════════════ */
    match /gp_transfers/{transferId} {
      allow read: if isAuth() && (
        resource.data.merchantId == myUid()
        || isAdmin()
      );
      allow create: if isAuth()
        && request.resource.data.merchantId == myUid()
        && isValidNumber(request.resource.data.amount, 0, 999999999)
        && request.resource.data.status == 'pending';
      allow update: if isAdmin();
      allow delete: if isAdmin();
    }

    /* ═════════════════════════════════════════════════════════════════════
       SECTION 12: PLACES + RIDER LOCATIONS (legacy)
       ═════════════════════════════════════════════════════════════════════ */
    match /places/{placeId} {
      allow read: if true;
      allow write: if isAdmin();
    }

    match /rider_locations/{docId} {
      allow read: if isAuth();
      allow write: if isAuth() && docId == myUid();
    }

    /* ═════════════════════════════════════════════════════════════════════
       SECTION 13: DEFAULT DENY
       ═════════════════════════════════════════════════════════════════════ */
    match /{document=**} {
      allow read, write: if false;
    }
  }
}