# คู่มือ QA: การทดสอบ GPS และ Notification Permission
## สำหรับทีมทดสอบ ChauatGo

> **สถานะ:** Test Guide สำหรับ QA และ UAT  
> **เวอร์ชัน:** 1.0  
> **วันที่:** 22 ตุลาคม 2569  
> **เอกสารที่เกี่ยวข้อง:** `examples/permission-state-manager.js`

คู่มือนี้ใช้ตรวจสอบการขอสิทธิ์ GPS และ Notification ของ ChauatGo ตั้งแต่ First Launch จนถึงการถอนสิทธิ์ การปฏิเสธซ้ำ อุปกรณ์ไม่รองรับ การสลับบัญชี และกรณีผิดปกติที่อาจทำให้ผู้ใช้เข้าถึงบริการไม่ได้หรือทำให้ระบบเก็บ Consent ไม่ถูกต้อง

---

## 1. เป้าหมายการทดสอบ

QA ต้องยืนยันว่า:

- ระบบไม่ขอ GPS หรือ Notification ตั้งแต่ First Launch โดยไม่มีการใช้ฟีเจอร์ที่เกี่ยวข้อง
- ระบบแสดงข้อความอธิบายก่อนเปิด Native Permission Dialog
- GPS ลูกค้า GPS ไรเดอร์ และ Notification แต่ละประเภทมี `purposeCode` แยกกัน
- ผู้ใช้ที่กดปฏิเสธยังมีทางเลือกใช้งานที่เหมาะสม เช่น กรอกที่อยู่หรือเลือกแผนที่
- ระบบไม่เรียก Native Dialog ซ้ำอย่างน่ารำคาญเมื่อผู้ใช้ปฏิเสธแล้ว
- เมื่อผู้ใช้เปิดสิทธิ์ภายหลัง ระบบตรวจพบสถานะใหม่และทำงานต่อได้
- การปิดสิทธิ์จาก Browser/Device Settings ไม่ทำให้แอปค้างหรือเข้า Flow ไม่ได้
- ระบบแยก Service Notification ออกจาก Marketing Notification
- มีการบันทึก Permission/Consent Event ถูกต้อง โดยไม่บันทึกว่าอนุญาตเมื่อ Native Permission ถูกปฏิเสธ
- ทีมบริการลูกค้าสามารถอธิบายวิธีแก้ปัญหาให้ผู้ใช้ได้
- UI ใช้งานได้บนมือถือจอแคบ รองรับ Keyboard, Screen Reader และ Reduced Motion

---

## 2. ขอบเขตและบทบาทที่ต้องทดสอบ

### ลูกค้า

- ค้นหาร้านใกล้ฉัน
- คำนวณค่าส่ง
- เลือกตำแหน่งปัจจุบันเป็นจุดรับ/ส่ง
- ติดตามออเดอร์
- เปิด Notification สถานะงาน
- รับข่าวสารและโปรโมชั่นแบบแยกต่างหาก

### ไรเดอร์

- เปิดรับงาน
- รับงานและเริ่ม GPS ระหว่างปฏิบัติงาน
- ทดสอบกรณี Background Location หากมีการใช้งานจริง
- Notification งานใหม่และเหตุการณ์สำคัญ

### ร้านค้า

- แจ้งเตือนออเดอร์ใหม่
- แจ้งเตือนไรเดอร์มารับสินค้า
- การตั้งค่า Notification ของร้าน

---

## 3. สภาพแวดล้อมที่ต้องเตรียม

ทดสอบอย่างน้อย:

- Android Chrome รุ่นที่รองรับ
- iOS Safari
- Desktop Chrome
- Desktop Safari หรือ Firefox ตามกลุ่มผู้ใช้จริง
- หน้าจอมือถือกว้างประมาณ 360px และ 390–414px
- Private/Incognito Mode
- อุปกรณ์ที่ไม่มี GPS หรือปิด Location Service ระดับระบบ
- เครือข่ายปกติ ช้า ออฟไลน์ และกลับมาออนไลน์
- HTTPS Production/Preview เพราะ Permission บางประเภทไม่ทำงานบน HTTP หรือ `file://`

บัญชีและข้อมูลทดสอบ:

- ลูกค้าใหม่ที่ไม่เคยมี Permission State
- ลูกค้าที่อนุญาต GPS แล้ว
- ลูกค้าที่ปฏิเสธ GPS แล้ว
- ลูกค้าที่ปิด Notification แล้ว
- ไรเดอร์ที่ผ่านการยืนยันตัวตน
- ไรเดอร์ที่ยังไม่ได้รับอนุญาต GPS
- ร้านค้าทดสอบที่มีออเดอร์จำลอง
- บัญชีเดียวที่มีหลายบทบาท หากระบบรองรับ

ห้ามใช้ข้อมูลลูกค้าจริง พิกัดบ้านจริง เอกสารไรเดอร์จริง หรือ Token Production ในการทดสอบ QA

---

## 4. วิธี Reset สถานะก่อนเริ่มรอบทดสอบ

### Browser Permission

1. เปิด Site Settings ของโดเมน ChauatGo
2. Reset Location เป็น `Ask` หรือ `Allow/Block` ตาม Test Case
3. Reset Notifications เป็น `Ask` หรือ `Allow/Block`
4. ล้าง Site Data/LocalStorage เมื่อ Test Case ระบุ
5. ปิดแท็บเดิมและเปิดใหม่เพื่อไม่ให้ Permission State จากหน้าเดิมค้าง

### LocalStorage ตัวอย่าง

ใช้ DevTools เฉพาะใน QA Environment:

```javascript
localStorage.removeItem('chauat_permission_location_asked');
localStorage.removeItem('chauat_permission_location_denied_at_v1');
localStorage.removeItem('chauat_permission_notification_asked');
localStorage.removeItem('chauat_permission_notification_denied_at_v1');
localStorage.removeItem('chauat_privacy_notice_ack_v1');
```

หากใช้ระบบ Consent Backend ต้องล้างหรือสร้าง Subject Test ใหม่ ห้ามแก้ Event Log เดิมใน Production เพียงเพื่อให้ Test ผ่าน

### Device Settings

บนมือถือให้ปิด/เปิด Location Service และ Notification Permission จากระดับระบบ แล้ว Force Close และเปิดแอปใหม่

---

## 5. รูปแบบการบันทึกผล Test Case

ทุก Test Case ต้องบันทึก:

- Test Case ID
- วันที่ เวลา Timezone และ Tester
- Browser/OS/Device/Viewport
- บัญชีและบทบาททดสอบ
- สถานะ Permission ก่อนทดสอบ
- ขั้นตอนที่ทำ
- ผลที่คาดหวัง
- ผลที่เกิดขึ้นจริง
- Screenshot/Video/Console Log เมื่อจำเป็น
- Permission Event/Consent Event ID
- Severity หากไม่ผ่าน
- Build/Commit/Environment ที่ทดสอบ

ห้ามบันทึก Access Token, เบอร์โทรจริง, ที่อยู่จริง, GPS ละเอียดจริง หรือเอกสารยืนยันตัวตนใน Ticket

---

# 6. Test Matrix: First Launch และ Privacy Flow

## TC-FL-001: First Launch ไม่ขอ Native Permission

**เงื่อนไข:** ผู้ใช้ใหม่ ล้าง Site Data แล้ว  
**ขั้นตอน:** เปิดแอปและรอให้หน้าแรกโหลด  
**คาดหวัง:**

- แสดง Privacy Notice First Launch
- ไม่แสดง Native GPS Prompt
- ไม่แสดง Native Notification Prompt
- ไม่เรียก `getCurrentPosition()` หรือ `Notification.requestPermission()` เอง
- ปุ่ม `รับทราบและเข้าสู่แอป` ทำงานได้โดยไม่ต้องเปิด GPS/Notification

## TC-FL-002: รับทราบ Notice โดยไม่ให้ Consent เพิ่มเติม

**ขั้นตอน:** กดรับทราบและเข้าสู่แอปโดยไม่เปิดตัวเลือกเพิ่มเติม  
**คาดหวัง:**

- เข้าแอปได้
- บันทึก `notice_acknowledged`
- ไม่สร้าง `consent_granted` สำหรับ GPS หรือ Marketing
- ระบบไม่ขอ Native Permission อัตโนมัติ

## TC-FL-003: เปิดแผง Privacy Choices แล้วไม่เลือกอะไร

**คาดหวัง:**

- แผงเปิดภายใน Modal และเลื่อนได้บนจอแคบ
- Checkbox ทุกตัวเริ่มไม่เลือก
- ปุ่มบันทึกทำงานได้
- ระบบเก็บสถานะ `rejected` หรือ `not_selected` ตาม Data Model ที่กำหนด
- ไม่เรียก Native Notification Permission

## TC-FL-004: เลือก Marketing แต่ไม่เลือก Service Permission

**คาดหวัง:**

- Marketing Consent ถูกบันทึกเฉพาะ Purpose ของ Marketing
- ไม่ถือว่าได้รับอนุญาต GPS หรือ Service Notification
- ห้ามเปิด Native Notification เพียงเพราะเลือก Marketing

## TC-FL-005: ปิด/เปิดหน้า First Launch ซ้ำ

**คาดหวัง:**

- หลังรับทราบแล้วไม่แสดง Notice ซ้ำใน Session ถัดไป เว้นแต่ Policy Version ใหม่กำหนดให้รับทราบใหม่
- หาก Policy Version ใหม่ ต้องแสดงเฉพาะ Notice/Consent ที่เปลี่ยน
- Event เก่าต้องไม่ถูกแก้ไข

---

# 7. Test Matrix: GPS ลูกค้า

## TC-GPS-C-001: สถานะ Prompt และกด Allow

**ขั้นตอน:**

1. Reset Location เป็น `Ask`
2. เปิดฟีเจอร์ `ร้านใกล้ฉัน`
3. ตรวจ Custom Dialog
4. กด `อนุญาตให้ใช้ตำแหน่ง`
5. กด Allow ใน Native Prompt

**คาดหวัง:**

- Custom Dialog แสดงก่อน Native Prompt
- ข้อความระบุว่าจะใช้ตำแหน่งเพื่อค้นหาใกล้ฉัน
- แสดงผลลัพธ์ร้านตามระยะทาง
- สร้าง Event `permission_granted`
- `purposeCode` เป็น `customer.location.nearby_search`
- ไม่สร้าง Event ของ Marketing หรือไรเดอร์

## TC-GPS-C-002: สถานะ Prompt และกด Deny

**ขั้นตอน:** เหมือน TC-GPS-C-001 แต่กด Deny ใน Native Prompt  
**คาดหวัง:**

- ไม่แสดงพิกัดหรือระยะทางที่อาศัย GPS
- แสดงข้อความว่าเลือกจุดบนแผนที่หรือกรอกที่อยู่เองได้
- แอปไม่ค้างและผู้ใช้กลับไปทำงานต่อได้
- สร้าง `permission_denied` ไม่ใช่ `permission_granted`
- ไม่เรียก Native Prompt ซ้ำทันทีเมื่อกดฟีเจอร์เดิมอีกครั้ง

## TC-GPS-C-003: ปฏิเสธแล้วเลือกวิธีสำรอง

**คาดหวัง:**

- เปิด Map Picker หรือ Address Input ได้
- ยืนยันคำสั่งซื้อได้เมื่อมีข้อมูลที่อยู่เพียงพอ
- คำนวณค่าบริการจากจุดที่ผู้ใช้เลือกได้
- UI ไม่ใช้ข้อความตำหนิหรือบังคับให้เปิด GPS

## TC-GPS-C-004: Browser Block หลังเคย Deny

**ขั้นตอน:** Deny หนึ่งครั้ง แล้วเปิด Site Settings ตั้ง Location เป็น Block จากนั้นกดใช้ GPS อีกครั้ง  
**คาดหวัง:**

- ไม่แสดง Native Prompt ที่ไม่มีทางทำงาน
- แสดงคำแนะนำให้เปิดสิทธิ์ใน Browser Settings
- มีปุ่มใช้วิธีสำรอง
- บันทึก `permission_blocked` พร้อมเหตุผล `browser`

## TC-GPS-C-005: เปิดสิทธิ์จาก Settings แล้วกลับมา

**ขั้นตอน:** ตั้งเป็น Block → เปิดเป็น Allow → กลับแอป → เรียกฟีเจอร์ GPS  
**คาดหวัง:**

- ระบบตรวจสถานะใหม่ได้
- ไม่ใช้สถานะ Denied จาก Cache เดิมค้างอยู่
- เรียก GPS สำเร็จและแสดงข้อมูลถูกต้อง
- สร้าง Event ใหม่ตามผลจริง

## TC-GPS-C-006: Location Service ระดับเครื่องปิด

**คาดหวัง:**

- แอปแสดง Error ที่เข้าใจได้
- ไม่วนขอ Permission ซ้ำ
- แนะนำให้เปิด Location Service หรือใช้แผนที่/กรอกที่อยู่แทน
- บันทึก `permission_error` หรือ Error Code ที่เหมาะสม

## TC-GPS-C-007: Timeout/Position Unavailable

**ขั้นตอน:** ใช้อุปกรณ์หรือ Simulator ที่ไม่คืนพิกัดภายใน Timeout  
**คาดหวัง:**

- แสดงข้อความลองใหม่หรือเลือกจุดเอง
- ไม่ถือเป็น Consent Denied หากผู้ใช้ไม่ได้ปฏิเสธ
- บันทึก Error แยกจาก `permission_denied`

## TC-GPS-C-008: ปิดหน้า/เปลี่ยนหน้า ระหว่าง Native Prompt

**คาดหวัง:**

- แอปไม่ค้างในสถานะ Loading
- กลับมาแล้วมีปุ่ม Retry
- ไม่สร้าง `granted` หาก Callback ไม่ได้ยืนยันว่าได้พิกัด

## TC-GPS-C-009: กดปุ่ม GPS ซ้ำเร็ว ๆ

**คาดหวัง:**

- ไม่เปิด Native Prompt หลายชั้น
- ปุ่มถูก Disable หรือมี Request Lock ชั่วคราว
- สร้าง Event เดียวต่อการตัดสินใจหนึ่งครั้ง

## TC-GPS-C-010: ตรวจสอบการเก็บข้อมูลหลังได้พิกัด

**คาดหวัง:**

- ใช้พิกัดตาม Purpose ที่แจ้งเท่านั้น
- ไม่ส่งพิกัดไปยัง Analytics/Marketing โดยไม่จำเป็น
- มีการหยุดใช้หรือหมดอายุตาม Retention Policy
- หากแสดงให้ไรเดอร์/ร้านค้าเห็น ต้องเป็นข้อมูลที่จำเป็นต่อคำสั่งนั้น

---

# 8. Test Matrix: GPS ไรเดอร์

## TC-GPS-R-001: เปิดรับงานโดยยังไม่เคยขอ GPS

**คาดหวัง:**

- แสดง Rider Runtime Dialog ก่อน Native Prompt
- อธิบายว่าเริ่มใช้เมื่อรับงานและหยุดเมื่อจบ/ยกเลิก
- ระบุผลกระทบหากไม่อนุญาต
- Purpose เป็น `rider.location.during_active_job`

## TC-GPS-R-002: ไรเดอร์ Deny แล้วพยายามรับงาน

**คาดหวัง:**

- งานที่ต้องใช้ GPS ไม่เริ่ม Tracking
- แสดงเหตุผลและทางเลือกติดต่อฝ่ายบริการ/เปิด Settings
- ไม่วน Prompt ซ้ำ
- สถานะงานไม่เปลี่ยนเป็นกำลังเดินทางโดยไม่มีพิกัดตามข้อกำหนด

## TC-GPS-R-003: ไรเดอร์อนุญาตแล้วจบงาน

**คาดหวัง:**

- เริ่มเก็บพิกัดเมื่อรับงานเท่านั้น
- เมื่อส่งสำเร็จ/ยกเลิก ให้หยุด Tracking
- ไม่เก็บ GPS ต่อในหน้า Home หรือขณะไม่มีงาน
- ตรวจว่า Event/Log ระบุ Start และ Stop ได้

## TC-GPS-R-004: Background Location แยกจาก Foreground

**คาดหวัง:**

- มีข้อความอธิบายแยก ไม่ซ่อนในคำขอทั่วไป
- หากไม่รองรับ Background ให้ใช้ Foreground หรือแจ้งข้อจำกัด
- เมื่อจบงานต้องหยุด Background Watch/Timer
- ทดสอบการปิดแอป Force Close และการกลับมาเปิดใหม่

## TC-GPS-R-005: เปลี่ยนบทบาทจากลูกค้าเป็นไรเดอร์

**คาดหวัง:**

- Consent ลูกค้าไม่ถูกนำมาใช้แทน Consent ไรเดอร์
- Purpose Code และ Role Instance ถูกต้อง
- สถานะ GPS ของแต่ละบทบาทไม่ปะปนกัน

---

# 9. Test Matrix: Notification

## TC-NOTI-001: Notification Prompt เมื่อเปิดใช้สถานะงาน

**ขั้นตอน:** กด `เปิดการแจ้งเตือนสถานะงาน` เมื่อ Browser Permission เป็น `default`  
**คาดหวัง:**

- Custom Dialog แสดงก่อน Native Prompt
- ระบุว่าเป็น Service Notification ไม่ใช่ Marketing
- กด Allow แล้วมีสถานะ `granted`
- ระบบสมัคร Push Token เฉพาะหลังได้รับผล `granted`
- Purpose เป็น `customer.service_notifications`

## TC-NOTI-002: Notification Deny

**คาดหวัง:**

- แสดงข้อความว่ายังดูสถานะงานจากหน้า Orders ได้
- ไม่สมัคร Push Token
- สร้าง `permission_denied`
- ไม่บันทึก Marketing Consent
- ไม่เรียก Prompt ซ้ำทันที

## TC-NOTI-003: Notification Dismissed/ปิด Prompt

**คาดหวัง:**

- ถือเป็น `dismissed` หรือ `prompt` ตาม Browser API ไม่ใช่ `granted`
- ไม่ส่ง Notification จริง
- ผู้ใช้กลับมาเปิดจากเมนูได้ภายหลัง

## TC-NOTI-004: Browser Notification Blocked

**คาดหวัง:**

- ไม่เรียก Native Prompt ซ้ำ
- แสดงคำแนะนำ Browser Settings
- มีวิธีดูสถานะงานโดยไม่พึ่ง Notification
- Event ระบุ `permission_blocked`

## TC-NOTI-005: เปิดสิทธิ์หลังเคย Deny

**ขั้นตอน:** เปิด Notification จาก Site Settings แล้วกลับมาที่แอป  
**คาดหวัง:**

- ระบบอ่านสถานะใหม่
- กดเปิดแล้วสมัคร Token ได้
- ไม่ใช้สถานะ Denied จาก LocalStorage ค้างอยู่

## TC-NOTI-006: Service Notification ไม่ปน Marketing

**คาดหวัง:**

- เปิด Service Notification แล้วไม่สร้าง `marketing` Consent
- ข้อความโปรโมชั่นไม่ถูกส่งด้วย Purpose ของ Service Notification
- ปิด Marketing แล้วยังรับสถานะคำสั่งซื้อได้ หากผู้ใช้เปิด Service Notification

## TC-NOTI-007: Notification ของไรเดอร์และร้านค้า

**คาดหวัง:**

- ไรเดอร์ใช้ Purpose เช่น `rider.service_notifications`
- ร้านค้าใช้ Purpose เช่น `merchant.order_notifications`
- ผู้รับ Notification ถูกต้อง ไม่ส่งข้ามบัญชี/ร้านค้า
- เปลี่ยน Role แล้ว Token/Subscription ถูกจำกัดตามผู้ใช้และ Role

## TC-NOTI-008: ปิดสิทธิ์ระหว่างมีออเดอร์

**คาดหวัง:**

- คำสั่งซื้อยังดำเนินต่อได้ตามระบบ
- หน้า Orders แสดงสถานะล่าสุดเมื่อผู้ใช้เปิดเข้ามา
- ไม่แสดงข้อความว่าออเดอร์ล้มเหลวเพียงเพราะ Notification ถูกปิด
- มีข้อความแนะนำเปิดสิทธิ์หากต้องการรับ Alert

---

# 10. Edge Cases ข้ามระบบ

## TC-EDGE-001: Offline ขณะขอ Permission

- Custom Dialog ต้องเปิดได้หากข้อความอยู่ใน Bundle
- ไม่สร้าง Consent ว่า Granted หาก Backend บันทึกไม่ได้และระบบไม่มี Offline Queue ที่ปลอดภัย
- หลังกลับมาออนไลน์ต้อง Sync Event ครั้งเดียว ไม่ซ้ำ
- หากทำงาน Offline ไม่ได้ ต้องแสดงข้อความชัดเจนและไม่ทำให้ผู้ใช้เข้าใจว่าอนุญาตสำเร็จ

## TC-EDGE-002: Backend ล่มหลัง Native Allow

- ฟีเจอร์แสดงสถานะชั่วคราวได้ตามความเหมาะสม
- Retry บันทึก Event แบบ Idempotent
- ห้ามสร้าง Event ซ้ำหลายรายการจากการกด Retry
- แสดงสถานะว่าการบันทึกกำลังรอ Sync หากจำเป็น

## TC-EDGE-003: เปิดหลายแท็บ

- การอนุญาตในแท็บหนึ่งสะท้อนในแท็บอื่นเมื่อเรียกใช้งานครั้งถัดไป
- ไม่เกิด Native Prompt ซ้อนกัน
- Consent Event ไม่ถูกสร้างซ้ำโดยไม่มีเหตุผล
- เมื่อถอนสิทธิ์จากแท็บหนึ่ง แท็บอื่นต้องตรวจสถานะใหม่ก่อนใช้งาน

## TC-EDGE-004: เปลี่ยนบัญชีผู้ใช้ในอุปกรณ์เดียวกัน

- Permission ของ Browser อาจเป็นระดับ Origin แต่ Consent Event ต้องผูกกับ Subject ที่ถูกต้อง
- ห้ามนำ Consent ของผู้ใช้ A ไปใช้เป็นหลักฐานของผู้ใช้ B
- ต้องตรวจสถานะ Role และ Purpose ใหม่หลัง Logout/Login

## TC-EDGE-005: System Clock ผิด

- ใช้ Server Timestamp เป็นเวลาหลักของ Consent Event
- ไม่ใช้เวลาจากเครื่องในการตัดสินอายุ Consent โดยไม่มีการตรวจสอบ
- Cooldown ฝั่ง Client ไม่ควรทำให้ Consent Backend ผิดพลาด

## TC-EDGE-006: Private/Incognito Mode

- Permission ทำงานตามข้อจำกัดของ Browser
- หาก LocalStorage ไม่คงอยู่ ต้องไม่แสดงสถานะ Granted ผิดหลังเปิดหน้าต่างใหม่
- ไม่มีข้อมูล Consent/Token หลุดไปยัง Session อื่น

## TC-EDGE-007: ผู้ใช้กด Back/ESC/แตะนอก Dialog

- ถือเป็น `dismissed` หรือไม่ดำเนินการ ไม่ใช่ `granted`
- Modal ปิดแล้วไม่ทำให้คำสั่งซื้อเสียหาย
- ผู้ใช้เปิด Dialog ใหม่จากปุ่มเดิมได้เมื่อเหมาะสม

## TC-EDGE-008: Accessibility

- Focus อยู่ใน Dialog และไม่เลื่อนไปยังเนื้อหาด้านหลัง
- ปุ่มมีชื่อที่ Screen Reader อ่านได้
- Checkbox ใช้งานด้วย Keyboard ได้
- สีไม่ใช่ตัวบอกสถานะเพียงอย่างเดียว
- Text ยังอ่านได้ใน High Contrast และ Dark Mode
- `prefers-reduced-motion` ไม่ทำให้ฟังก์ชันเสีย

## TC-EDGE-009: Mobile Rotation และจอแคบ

- Dialog ไม่ล้นแนวนอนที่ 320–360px
- ปุ่มปฏิเสธและปุ่มหลักกดได้โดยไม่ชนกัน
- เนื้อหายาวเลื่อนได้ภายใน Modal
- Safe Area ด้านล่างไม่บังปุ่ม

## TC-EDGE-010: Browser ไม่รองรับ API

- `navigator.geolocation` ไม่มี → แสดง `unavailable`
- `Notification` ไม่มี → แสดง `unavailable`
- `navigator.permissions.query` ไม่มี → ใช้ Fallback โดยไม่ทำให้แอปล่ม
- ไม่เกิด JavaScript Error ที่หยุดหน้าอื่น

---

# 11. การตรวจ Consent Log และ Audit

หลัง Test Case ที่มีการตัดสินใจ ให้ตรวจ Backend หรือ Test Admin Console:

| รายการตรวจ | สิ่งที่ต้องยืนยัน |
|---|---|
| `subjectRef` | ตรงกับบัญชีทดสอบ ไม่ใช่บัญชีอื่น |
| `subjectType` | customer/rider/merchant ถูกต้อง |
| `purposeCode` | ตรงกับฟีเจอร์ที่เรียก |
| `eventType` | granted/denied/dismissed/blocked ถูกต้อง |
| `policyVersion` | เป็น Version ที่แสดงจริง |
| `noticeVersion` | เชื่อม Notice ที่แสดงจริง |
| `source/channel` | runtime dialog และช่องทางถูกต้อง |
| `eventAt` | ใช้ Server Timestamp |
| `idempotencyKey` | Retry ไม่สร้างรายการซ้ำ |
| ข้อมูลส่วนเกิน | ไม่มี OTP, Password, GPS ละเอียดเกินจำเป็นใน Log |
| Append-only | Event เดิมไม่ถูกแก้ไขหรือลบจาก Client |

กรณีสำคัญที่ต้องตรวจเป็นพิเศษ:

- Native Permission Denied ต้องไม่มี `consent_granted`
- ผู้ใช้ถอนสิทธิ์ต้องมี Event ใหม่ ไม่แก้ Event เดิม
- ลูกค้าและไรเดอร์ที่ใช้ UID เดียวกันต้องมี Role/Purpose แยก
- การรับทราบ Notice ต้องไม่ถูกบันทึกเป็น Consent ของ GPS หรือ Marketing

---

# 12. Expected State Transition

## GPS

```text
not_recorded / prompt
        |
        | ผู้ใช้เริ่มฟีเจอร์
        v
custom_dialog_shown
   |             |
 Allow         Deny
   |             |
   v             v
native_prompt  denied + fallback
   |
   +--> granted + feature starts
   +--> denied + fallback
   +--> error + retry/fallback
```

## Notification

```text
default / prompt
        |
        | ผู้ใช้กดเปิดการแจ้งเตือน
        v
custom_dialog_shown
   |             |
 Allow         Deny/Dismiss
   |             |
   v             v
granted       denied/dismissed + Orders fallback
```

สถานะ `denied` จาก Browser/Device Settings ต้องนำไปสู่ `permission_blocked` และแสดงคำแนะนำ Settings ไม่ควรเรียก Prompt ซ้ำแบบไม่มีทางสำเร็จ

---

# 13. Severity และเกณฑ์ไม่ผ่าน

### Blocker

- แอปขอ GPS หรือ Notification ตั้งแต่ First Launch โดยไม่มีการกดใช้ฟีเจอร์
- Native Permission Granted แต่ระบบใช้ข้อมูลผิด Purpose หรือส่งให้ผู้รับผิด
- ผู้ใช้ปฏิเสธแล้วไม่สามารถใช้ทางเลือกสำรองและถูกล็อกออกจากบริการหลัก
- Consent Log ของผู้ใช้หนึ่งไปผูกกับอีกบัญชี
- Event ระบุ Granted ทั้งที่ Native Permission ถูก Denied
- GPS ของไรเดอร์ยังทำงานหลังงานจบหรือไม่มีงาน
- มีการส่งข้อมูลจริงใน QA หรือ Log มี Secret/ข้อมูลอ่อนไหว

### Critical

- เกิดการส่ง Notification ข้ามบัญชีหรือข้ามร้านค้า
- ระบบเก็บหรือเปิดเผย GPS ละเอียดเกินวัตถุประสงค์
- ผู้ใช้ไม่สามารถถอนหรือเปลี่ยนสิทธิ์ได้
- Firestore Rules เปิดให้ Client แก้ไข Consent Event เดิม

### Major

- ปฏิเสธแล้ว Prompt เด้งซ้ำทุกครั้งโดยไม่มี Cooldown
- เปิดสิทธิ์จาก Settings แล้วแอปไม่ตรวจสถานะใหม่
- UI ล้นจอหรือปุ่มปฏิเสธกดยาก
- ข้อความแจ้งไม่บอกผลกระทบหรือทางเลือกสำรอง

### Minor

- ข้อความหรือการแปลไม่ตรงกับ Purpose แต่ไม่กระทบการตัดสินใจ
- Analytics Event ขาดข้อมูลที่ไม่สำคัญต่อการพิสูจน์ Consent

---

# 14. Regression Checklist ก่อน Release

- [ ] First Launch ไม่ขอ GPS/Notification เอง
- [ ] Privacy Notice และ Consent ทางเลือกแยกกัน
- [ ] GPS ลูกค้า Allow/Deny/Block/Unavailable ครบ
- [ ] GPS ไรเดอร์เริ่มและหยุดตรงช่วงรับงาน
- [ ] Background Location มี Dialog แยก หากเปิดใช้
- [ ] Notification ลูกค้า/ไรเดอร์/ร้านค้าไม่ปนกัน
- [ ] Marketing แยกจาก Service Notification
- [ ] มี Fallback เมื่อไม่อนุญาต
- [ ] เปิดสิทธิ์จาก Settings แล้วกลับมาทำงานได้
- [ ] Offline/Retry ไม่สร้าง Event ซ้ำ
- [ ] Multi-tab และเปลี่ยนบัญชีไม่ทำให้ Consent ปะปน
- [ ] Consent Log ตรวจสอบย้อนกลับได้
- [ ] Firebase Rules ป้องกัน Client แก้ Event
- [ ] Accessibility และจอแคบผ่าน
- [ ] ไม่มีข้อมูลจริงใน Screenshot, Console หรือ Test Report

---

# 15. Template รายงาน Defect

**Defect ID:** [ ]  
**Test Case:** [ ]  
**Environment:** [Production Preview/Staging]  
**Device/OS/Browser:** [ ]  
**Build/Commit:** [ ]  
**Role:** [Customer/Rider/Merchant]  
**Initial Permission State:** [ ]  
**Steps to Reproduce:**

1. [ ]
2. [ ]
3. [ ]

**Expected Result:** [ ]  
**Actual Result:** [ ]  
**Permission/Consent Event ID:** [ ]  
**Severity:** [Blocker/Critical/Major/Minor]  
**Evidence Link:** [ลิงก์ที่ไม่มีข้อมูลส่วนบุคคลเกินจำเป็น]  
**Privacy/Security Impact:** [ ]  
**Workaround:** [ ]
