# Incident Post-mortem: Performance Test Failure

> เอกสารนี้ใช้สำหรับสรุปเหตุการณ์ที่ Performance Test ไม่ผ่านและส่งผลกระทบต่อระบบจริง โดยเน้นการเรียนรู้และปรับปรุงระบบ ไม่ใช่การกล่าวโทษบุคคล

## 1. ข้อมูลเหตุการณ์

| รายการ | รายละเอียด |
| --- | --- |
| Incident ID | `INC-YYYYMMDD-XXX` |
| ชื่อเหตุการณ์ | `[สรุปสั้น ๆ เช่น Rider API P95 latency สูงเกิน Budget]` |
| ระดับความรุนแรง | `SEV-1 / SEV-2 / SEV-3 / SEV-4` |
| สถานะ | `Open / Monitoring / Resolved / Closed` |
| วันที่เกิดเหตุ | `YYYY-MM-DD` |
| เวลาเริ่มต้น UTC | `YYYY-MM-DD HH:mm UTC` |
| เวลาเริ่มต้น Bangkok | `YYYY-MM-DD HH:mm น.` |
| เวลาสิ้นสุด UTC | `YYYY-MM-DD HH:mm UTC` |
| ระยะเวลารวม | `[นาที/ชั่วโมง]` |
| ผู้จัดทำ | `ชื่อ / ทีม` |
| Incident Commander | `ชื่อ / ทีม` |
| ผู้อนุมัติปิด Incident | `ชื่อ / ทีม` |

## 2. Executive Summary

สรุปเหตุการณ์ภายใน 3–5 ประโยค:

- เกิดอะไรขึ้น
- เกิดขึ้นเมื่อใด
- ผู้ใช้หรือระบบใดได้รับผลกระทบ
- ทีมตรวจพบและแก้ไขอย่างไร
- สถานะปัจจุบันเป็นอย่างไร

**สรุป:**

> `[เขียนสรุปเหตุการณ์ที่อ่านได้ภายใน 1 นาที]`

## 3. Customer และ System Impact

### 3.1 ผลกระทบต่อผู้ใช้

- ประเภทผู้ใช้ที่ได้รับผลกระทบ: `[Customer / Rider / Partner / Admin]`
- ฟีเจอร์ที่ได้รับผลกระทบ: `[เช่น เรียกรถ / ส่งด่วน / Rider Dashboard]`
- จำนวนผู้ใช้ที่ได้รับผลกระทบ: `[จำนวนหรือประมาณการ]`
- จำนวน Request ที่ได้รับผลกระทบ: `[จำนวน]`
- Error Rate สูงสุด: `[%]`
- ช่วงเวลาที่ผู้ใช้ได้รับผลกระทบ: `[เวลา]`
- อาการที่ผู้ใช้พบ: `[ช้า / Timeout / Error / โหลดหน้าไม่ได้]`

### 3.2 ผลกระทบต่อระบบ

- Service/API ที่ได้รับผลกระทบ: `[ชื่อ Service หรือ Endpoint]`
- Dependency ที่เกี่ยวข้อง: `[Firestore / Functions / Storage / External API]`
- Region/Environment: `[Production / Staging / Region]`
- Availability ที่ลดลง: `[% หรือเวลา Downtime]`
- ข้อมูลสูญหายหรือไม่: `ใช่ / ไม่ใช่ / อยู่ระหว่างตรวจสอบ`
- ธุรกรรมผิดพลาดหรือซ้ำหรือไม่: `ใช่ / ไม่ใช่ / อยู่ระหว่างตรวจสอบ`

## 4. Detection

| รายการ | รายละเอียด |
| --- | --- |
| ช่องทางที่ตรวจพบ | `Performance Test / Monitoring / Alert / Customer Report` |
| Alert หรือ Test ที่ทำให้ตรวจพบ | `[ชื่อ Alert/Workflow/Test]` |
| GitHub Actions Run ID | `[Run ID]` |
| Run URL | `[ลิงก์]` |
| PR/Commit ที่เกี่ยวข้อง | `[PR URL / Commit SHA]` |
| Slack Alert URL/เวลา | `[ลิงก์หรือเวลา]` |
| ตรวจพบโดย | `[ชื่อ/ทีม/ระบบอัตโนมัติ]` |

## 5. Performance Evidence

แนบหลักฐานและผลลัพธ์จาก Performance Test:

| Metric | Actual | Budget | สถานะ |
| --- | ---: | ---: | --- |
| Total requests | `[จำนวน]` | `≥ 1` | `PASS/FAIL` |
| Failed requests | `[จำนวน]` | `≤ [ค่า]` | `PASS/FAIL` |
| Failure Rate | `[%]` | `≤ 1%` | `PASS/FAIL` |
| RPS | `[ค่า]` | `[Baseline/เปรียบเทียบ]` | `PASS/FAIL` |
| Average latency | `[ms]` | `[Baseline]` | `PASS/FAIL` |
| P50 latency | `[ms]` | `[Baseline]` | `PASS/FAIL` |
| P95 latency | `[ms]` | `≤ 200 ms` | `PASS/FAIL` |
| P99 latency | `[ms]` | `[Budget]` | `PASS/FAIL` |
| Maximum latency | `[ms]` | `[Baseline]` | `PASS/FAIL` |

### Historical Comparison

| รอบทดสอบ | Commit/Run | Requests | Failure Rate | P95 | P99 | ผลลัพธ์ |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| ก่อนเกิดเหตุ | `[SHA/Run]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `PASS` |
| รอบที่เกิดเหตุ | `[SHA/Run]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `FAIL` |
| หลังแก้ไข | `[SHA/Run]` | `[ ]` | `[ ]` | `[ ]` | `[ ]` | `PASS/รอตรวจ` |

Artifacts:

- Locust JSON: `[ลิงก์ Artifact]`
- Locust HTML: `[ลิงก์ Artifact]`
- Historical CSV: `[ลิงก์หรือ Path]`
- Application Logs: `[ลิงก์]`
- Monitoring Dashboard: `[ลิงก์]`

## 6. Timeline

> ใช้เวลา UTC หรือ Asia/Bangkok ให้สอดคล้องกันทั้งเอกสาร และระบุ Timezone ในหัวข้อ

| เวลา | เหตุการณ์ | ผู้ดำเนินการ | หลักฐาน/ลิงก์ |
| --- | --- | --- | --- |
| `[HH:mm]` | Deploy/merge commit ที่เกี่ยวข้อง | `[ชื่อ/ระบบ]` | `[ลิงก์]` |
| `[HH:mm]` | Performance Test เริ่มทำงาน | `[ระบบ]` | `[Run URL]` |
| `[HH:mm]` | Quality Gate ไม่ผ่าน | `[ระบบ]` | `[Log/Artifact]` |
| `[HH:mm]` | Production เริ่มมีอาการผิดปกติ | `[ระบบ/ผู้ใช้]` | `[Dashboard]` |
| `[HH:mm]` | เปิด Incident | `[ชื่อ]` | `[ช่องทาง]` |
| `[HH:mm]` | เริ่ม Mitigation | `[ชื่อ/ทีม]` | `[รายละเอียด]` |
| `[HH:mm]` | อาการเริ่มดีขึ้น | `[ระบบ]` | `[Metric]` |
| `[HH:mm]` | Deploy Fix/Rollback สำเร็จ | `[ชื่อ/ระบบ]` | `[ลิงก์]` |
| `[HH:mm]` | ปิด Incident และเริ่ม Monitoring | `[ชื่อ]` | `[Dashboard]` |

## 7. Root Cause Analysis

### 7.1 Technical Root Cause

อธิบายสาเหตุทางเทคนิคที่ทำให้ Performance ลดลง:

> `[เช่น Query ไม่มี Index, N+1 reads, Function timeout, เพิ่ม payload, connection pool ไม่พอ หรือ dependency ตอบสนองช้า]`

### 7.2 Five Whys

1. **ทำไมผู้ใช้พบว่า Request ช้าหรือ Timeout?**  
   `[คำตอบ]`
2. **ทำไม Service จึงตอบสนองช้า?**  
   `[คำตอบ]`
3. **ทำไมปัญหานี้จึงเกิดหลังการเปลี่ยนแปลงล่าสุด?**  
   `[คำตอบ]`
4. **ทำไม Test/Review/Monitoring จึงไม่ป้องกันปัญหานี้ก่อน Production?**  
   `[คำตอบ]`
5. **เราต้องปรับระบบหรือกระบวนการใดเพื่อไม่ให้เกิดซ้ำ?**  
   `[คำตอบ]`

### 7.3 Contributing Factors

เลือกหรือเติมรายการที่เกี่ยวข้อง:

- [ ] ไม่มี Performance Test สำหรับเส้นทางนี้
- [ ] Workload ใน Test ไม่ใกล้เคียง Production
- [ ] Threshold ไม่เหมาะสม
- [ ] Test ไม่ได้รันหรือถูก Skip
- [ ] Alert ช้า/ไม่มี Alert
- [ ] Monitoring ไม่แยก Endpoint/ผู้ใช้/Region
- [ ] Dependency มีปัญหา
- [ ] Capacity หรือ Resource ไม่เพียงพอ
- [ ] Rollback ทำได้ยากหรือไม่มีขั้นตอนชัดเจน
- [ ] เอกสาร/Runbook ไม่ครบ
- [ ] อื่น ๆ: `[รายละเอียด]`

## 8. Response และ Mitigation

### สิ่งที่ทำระหว่าง Incident

1. `[เช่น ปิด Feature Flag หรือหยุด Traffic บางส่วน]`
2. `[เช่น Rollback ไปยัง Commit ก่อนหน้า]`
3. `[เช่น เพิ่ม Capacity/ปรับ Timeout/ลด Query]`
4. `[เช่น ตรวจธุรกรรมและ Retry รายการที่ล้มเหลว]`

### วิธีแก้ชั่วคราว

> `[รายละเอียด Mitigation และข้อจำกัดของวิธีนี้]`

### วิธีแก้ถาวร

> `[รายละเอียด Fix ที่นำไปใช้และเหตุผลที่แก้ Root Cause ได้]`

## 9. Corrective และ Preventive Actions

| ลำดับ | Action | ประเภท | ผู้รับผิดชอบ | Priority | Due date | สถานะ | ลิงก์ |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | `[แก้ Root Cause]` | Corrective | `[ชื่อ/ทีม]` | P0/P1/P2 | `YYYY-MM-DD` | `Open` | `[Issue/PR]` |
| 2 | `[เพิ่ม Regression/Performance Test]` | Preventive | `[ชื่อ/ทีม]` | P0/P1/P2 | `YYYY-MM-DD` | `Open` | `[Issue/PR]` |
| 3 | `[เพิ่ม Alert/Monitoring]` | Preventive | `[ชื่อ/ทีม]` | P0/P1/P2 | `YYYY-MM-DD` | `Open` | `[Issue/PR]` |
| 4 | `[ปรับปรุง Runbook/เอกสาร]` | Process | `[ชื่อ/ทีม]` | P0/P1/P2 | `YYYY-MM-DD` | `Open` | `[Issue/PR]` |

Action ที่สำคัญควรมี Acceptance Criteria ชัดเจน เช่น:

```text
- Performance Test P95 ผ่าน <= 200 ms ติดต่อกัน 3 รอบ
- Failure Rate <= 1% ที่ Workload เทียบเท่า Production
- มี Alert เมื่อ P95 เกิน Budget 2 รอบต่อเนื่อง
- Rollback ขั้นตอนหลักทำเสร็จภายใน 15 นาที
```

## 10. Verification หลังแก้ไข

- [ ] Unit Tests ผ่าน
- [ ] Integration/Emulator Tests ผ่าน
- [ ] Performance Test ผ่านด้วย Workload เดิม
- [ ] Performance Test ผ่านด้วย Workload สูงสุดที่กำหนด
- [ ] P95 กลับเข้า Budget
- [ ] P99 ไม่เพิ่มขึ้นผิดปกติ
- [ ] Failure Rate กลับเข้า Budget
- [ ] Production Metrics กลับสู่ Baseline
- [ ] ไม่มี Error/Timeout ซ้ำในช่วง Monitoring
- [ ] ตรวจธุรกรรม/ข้อมูลที่ได้รับผลกระทบครบแล้ว

### Monitoring Window

- เริ่ม Monitoring: `[YYYY-MM-DD HH:mm TZ]`
- สิ้นสุด Monitoring: `[YYYY-MM-DD HH:mm TZ]`
- ผู้รับผิดชอบเฝ้าระวัง: `[ชื่อ/ทีม]`
- Dashboard: `[ลิงก์]`
- เกณฑ์ปิด Incident: `[เงื่อนไข]`

## 11. Lessons Learned

### สิ่งที่ทำได้ดี

- `[ตัวอย่าง: Alert แจ้งเตือนเร็ว, Rollback สำเร็จ, มี Artifact ครบ]`

### สิ่งที่ควรปรับปรุง

- `[ตัวอย่าง: ไม่มี Historical Trend, Test Workload ต่ำเกินไป, Owner ไม่ชัดเจน]`

### สิ่งที่จะทำแตกต่างในการจำลองครั้งหน้า

- `[รายละเอียด]`

## 12. Communication Log

| เวลา | ช่องทาง | ผู้ส่ง | เนื้อหา/ลิงก์ |
| --- | --- | --- | --- |
| `[HH:mm]` | Slack #channel | `[ชื่อ]` | `[ลิงก์ข้อความ]` |
| `[HH:mm]` | Status Page | `[ชื่อ]` | `[ลิงก์]` |
| `[HH:mm]` | Customer Support | `[ชื่อ]` | `[รายละเอียด]` |

## 13. Privacy และ Security Review

- [ ] ไม่มี Secret/Webhook URL อยู่ในเอกสาร
- [ ] ไม่มีข้อมูลส่วนตัวของลูกค้าโดยไม่จำเป็น
- [ ] Log ที่แนบถูก Redact แล้ว
- [ ] ลิงก์ Artifact จำกัดสิทธิ์ตามความเหมาะสม
- [ ] ตรวจสอบธุรกรรมหรือข้อมูลทางการเงินที่อาจได้รับผลกระทบแล้ว

## 14. Approval และ Closure

### เงื่อนไขก่อนปิด Incident

- [ ] Root Cause ได้รับการยืนยัน
- [ ] Mitigation/ถาวร Deploy แล้ว
- [ ] Performance Test ผ่าน
- [ ] Production Monitoring กลับสู่ Baseline
- [ ] Corrective Actions มี Owner และ Due date
- [ ] ผู้เกี่ยวข้องได้รับการสื่อสาร
- [ ] ไม่มี Open Critical Error ที่เกี่ยวข้อง

| บทบาท | ชื่อ | วันที่ | ลายเซ็น/การยืนยัน |
| --- | --- | --- | --- |
| Incident Commander | `[ชื่อ]` | `YYYY-MM-DD` | `[ยืนยัน]` |
| Engineering Owner | `[ชื่อ]` | `YYYY-MM-DD` | `[ยืนยัน]` |
| Product/Operations Owner | `[ชื่อ]` | `YYYY-MM-DD` | `[ยืนยัน]` |

**สถานะสุดท้าย:** `Resolved / Closed`

**วันที่ปิด:** `YYYY-MM-DD HH:mm TZ`

---

# ตัวอย่างการกรอก: Performance Test Timeout

> ตัวอย่างนี้เป็นข้อมูลสมมติทั้งหมด ใช้เพื่อสาธิตวิธีกรอกเอกสารเท่านั้น ไม่ใช่เหตุการณ์จริง

## 1. ข้อมูลเหตุการณ์

| รายการ | รายละเอียด |
| --- | --- |
| Incident ID | `INC-20261120-001` |
| ชื่อเหตุการณ์ | `Rider Filter Performance Test Timeout หลัง Deploy Query Optimization` |
| ระดับความรุนแรง | `SEV-2` |
| สถานะ | `Closed` |
| วันที่เกิดเหตุ | `2026-11-20` |
| เวลาเริ่มต้น UTC | `2026-11-20 06:00 UTC` |
| เวลาเริ่มต้น Bangkok | `2026-11-20 13:00 น.` |
| เวลาสิ้นสุด UTC | `2026-11-20 07:02 UTC` |
| ระยะเวลารวม | `62 นาที` |
| ผู้จัดทำ | `Performance Engineering Team` |
| Incident Commander | `ทีม Platform On-call` |
| ผู้อนุมัติปิด Incident | `Engineering Manager` |

## 2. Executive Summary

เวลา 13:00 น. ระบบ Scheduled Performance Test เริ่มทดสอบ Rider Filter ด้วย 20 concurrent users แต่ Workflow ไม่สามารถจบภายใน Timeout 30 นาทีได้ ระบบ Production มีค่า P95 ของ Rider Job API สูงขึ้นจนผู้ใช้บางส่วนโหลดรายการงานช้าและพบ Timeout เป็นช่วง ๆ ทีม Rollback Commit ที่เกี่ยวข้องและเพิ่ม Index ให้ Query หลังจากนั้น Metrics กลับสู่ Baseline และ Performance Test รอบยืนยันผ่าน 3 รอบติดต่อกัน

## 3. Customer และ System Impact

### 3.1 ผลกระทบต่อผู้ใช้

- ประเภทผู้ใช้ที่ได้รับผลกระทบ: `Rider`
- ฟีเจอร์ที่ได้รับผลกระทบ: `หน้ารายการงานและตัวกรองงาน`
- จำนวนผู้ใช้ที่ได้รับผลกระทบ: `ประมาณ 18% ของ Rider ที่ใช้งานในช่วงเหตุการณ์`
- จำนวน Request ที่ได้รับผลกระทบ: `ประมาณ 2,400 requests`
- Error Rate สูงสุด: `3.1%`
- ช่วงเวลาที่ผู้ใช้ได้รับผลกระทบ: `13:08–13:42 น. Bangkok`
- อาการที่ผู้ใช้พบ: `รายการงานโหลดช้าและบาง Request Timeout`

### 3.2 ผลกระทบต่อระบบ

- Service/API ที่ได้รับผลกระทบ: `GET /api/rider/jobs?filter=available`
- Dependency ที่เกี่ยวข้อง: `Firestore composite query`
- Region/Environment: `Production / asia-southeast1`
- Availability ที่ลดลง: `ไม่มี Downtime เต็มระบบ แต่มี Partial degradation 34 นาที`
- ข้อมูลสูญหายหรือไม่: `ไม่พบข้อมูลสูญหาย`
- ธุรกรรมผิดพลาดหรือซ้ำหรือไม่: `ไม่พบธุรกรรมซ้ำ`

## 4. Detection

| รายการ | รายละเอียด |
| --- | --- |
| ช่องทางที่ตรวจพบ | `GitHub Actions Timeout และ Cloud Monitoring latency alert` |
| Alert หรือ Test ที่ทำให้ตรวจพบ | `Weekly Performance Test / Rider Filter p95 alert` |
| GitHub Actions Run ID | `44680184450` |
| Run URL | `https://github.com/example/ChauatGo/actions/runs/44680184450` |
| PR/Commit ที่เกี่ยวข้อง | `PR #999 / abc1234` |
| Slack Alert URL/เวลา | `#chauatgo-alerts / 13:31 น.` |
| ตรวจพบโดย | `Performance Workflow และ On-call Engineer` |

## 5. Performance Evidence

| Metric | Actual | Budget | สถานะ |
| --- | ---: | ---: | --- |
| Total requests | `18,420` | `≥ 1` | `PASS` |
| Failed requests | `571` | `≤ 184` | `FAIL` |
| Failure Rate | `3.10%` | `≤ 1%` | `FAIL` |
| RPS | `8.7` | `≥ 12 baseline` | `FAIL` |
| Average latency | `1,180 ms` | `≤ 500 ms baseline` | `FAIL` |
| P50 latency | `740 ms` | `≤ 300 ms baseline` | `FAIL` |
| P95 latency | `4,820 ms` | `≤ 2,000 ms` | `FAIL` |
| P99 latency | `9,840 ms` | `≤ 4,000 ms` | `FAIL` |
| Maximum latency | `30,000 ms` | `≤ 10,000 ms baseline` | `FAIL` |

Historical comparison:

| รอบทดสอบ | Commit/Run | Requests | Failure Rate | P95 | P99 | ผลลัพธ์ |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| ก่อนเกิดเหตุ | `f91a2c1 / 44670001000` | `18,100` | `0.20%` | `410 ms` | `920 ms` | `PASS` |
| รอบที่เกิดเหตุ | `abc1234 / 44680184450` | `18,420` | `3.10%` | `4,820 ms` | `9,840 ms` | `TIMEOUT/FAIL` |
| หลังแก้ไข | `d45ef67 / 44690002000` | `18,300` | `0.10%` | `390 ms` | `880 ms` | `PASS` |

## 6. Timeline

| เวลา | เหตุการณ์ | ผู้ดำเนินการ | หลักฐาน/ลิงก์ |
| --- | --- | --- | --- |
| `12:45` | Deploy Commit `abc1234` ขึ้น Production | `Release Bot` | `[Deploy URL]` |
| `13:00` | Scheduled Performance Test เริ่ม | `GitHub Actions` | `[Run URL]` |
| `13:08` | Rider Job API P95 เริ่มสูงกว่า Baseline | `Monitoring` | `[Dashboard]` |
| `13:31` | Slack แจ้ง Workflow Timeout | `Alert Bot` | `#chauatgo-alerts` |
| `13:34` | เปิด SEV-2 Incident | `On-call Engineer` | `[Incident Channel]` |
| `13:40` | ยืนยันว่า Query ใช้ Full Collection Scan | `Backend Team` | `[Query Log]` |
| `13:45` | Rollback Commit `abc1234` | `Release Engineer` | `[Rollback URL]` |
| `13:52` | Error Rate กลับต่ำกว่า 1% | `On-call Engineer` | `[Dashboard]` |
| `14:10` | Deploy Index และ Query Fix | `Backend Team` | `[PR URL]` |
| `14:30` | Performance Test รอบยืนยันผ่าน | `Performance Workflow` | `[Run URL]` |
| `14:42` | ปิด Incident หลัง Monitoring | `Incident Commander` | `[Post-mortem]` |

## 7. Root Cause Analysis

### Technical Root Cause

การเปลี่ยนแปลง Query ใน Rider Filter เพิ่มเงื่อนไข Sort ตาม `availableAt` แต่ยังไม่มี Composite Index ที่ตรงกับเงื่อนไขใหม่ ทำให้ Firestore ใช้การประมวลผลที่ช้ากว่าปกติ เมื่อมี Concurrent Requests สูงจึงเกิดคิวสะสมและ Request Timeout ที่ 30 วินาที

### Five Whys

1. **ทำไม Rider เห็นรายการงานช้า?**  
   Query ใช้เวลานานและมี Request Timeout บางส่วน
2. **ทำไม Query ใช้เวลานาน?**  
   Query ใหม่มี Filter และ Sort ที่ไม่มี Composite Index รองรับ
3. **ทำไมไม่มี Index ก่อน Deploy?**  
   Code Review ตรวจ Logic แต่ไม่ได้ตรวจ Query Explain และ Index Diff
4. **ทำไม Performance Test ไม่หยุด Deploy ก่อน Production?**  
   Test แบบ PR ใช้ Dataset ขนาดเล็กและไม่จำลอง Load แบบ Scheduled ครบถ้วน
5. **เราจะป้องกันอย่างไร?**  
   เพิ่ม Index validation, Dataset ใกล้เคียง Production และ Performance Gate ก่อน Promote

### Contributing Factors

- [x] Workload ใน PR Test ต่ำกว่าการใช้งานจริง
- [x] ไม่มี Index validation ใน CI
- [x] Alert ตรวจพบหลัง Deploy แล้ว ไม่ได้ Block ก่อน Deploy
- [x] ไม่มี Historical Trend เปรียบเทียบ Query latency ราย Endpoint
- [ ] ข้อมูลสูญหาย

## 8. Response และ Mitigation

### สิ่งที่ทำระหว่าง Incident

1. หยุดการ Promote Release ที่กำลังรออยู่
2. Rollback Commit `abc1234` ไปยัง `f91a2c1`
3. ตรวจสอบ Query Profile และ Firestore Logs
4. เพิ่ม Composite Index และทดสอบกับ Dataset จำลองขนาด Production
5. รัน Performance Test ซ้ำ 3 รอบก่อนปิด Incident

### วิธีแก้ชั่วคราว

Rollback ไปยัง Query implementation เดิม ทำให้ P95 กลับต่ำกว่า 500 ms ภายในประมาณ 8 นาทีหลังเริ่ม Mitigation

### วิธีแก้ถาวร

เพิ่ม Composite Index ที่จำเป็น ปรับ Query ให้ใช้เงื่อนไขที่ Index รองรับ และเพิ่ม CI Check สำหรับ Firestore Index ก่อน Merge

## 9. Corrective และ Preventive Actions

| ลำดับ | Action | ประเภท | ผู้รับผิดชอบ | Priority | Due date | สถานะ |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | เพิ่ม Composite Index และ Query regression test | Corrective | `Backend Team` | P0 | `2026-11-20` | `Done` |
| 2 | เพิ่ม Production-sized dataset ใน Performance Test | Preventive | `Performance Team` | P1 | `2026-11-27` | `In progress` |
| 3 | เพิ่ม Firestore Index validation ใน CI | Preventive | `Platform Team` | P1 | `2026-11-27` | `Open` |
| 4 | เพิ่ม Historical P95/P99 Trend Dashboard | Preventive | `SRE Team` | P2 | `2026-12-04` | `Open` |
| 5 | ปรับ Alert ให้แจ้งเมื่อ P95 เกิน Budget 2 รอบ | Preventive | `SRE Team` | P2 | `2026-12-04` | `Open` |

## 10. Verification หลังแก้ไข

- [x] Unit Tests ผ่าน
- [x] Integration Tests ผ่าน
- [x] Performance Test ผ่านด้วย Workload เดิม
- [x] P95 กลับเข้า Budget: `390 ms เทียบกับ Budget 2,000 ms`
- [x] P99 กลับเข้า Budget: `880 ms เทียบกับ Budget 4,000 ms`
- [x] Failure Rate กลับเข้า Budget: `0.10%`
- [x] Production Metrics กลับสู่ Baseline
- [x] ไม่พบ Error/Timeout ซ้ำใน Monitoring Window 60 นาที
- [x] ตรวจสอบแล้วว่าไม่มีข้อมูลสูญหายหรือธุรกรรมซ้ำ

### Monitoring Window

- เริ่ม Monitoring: `2026-11-20 14:42 น. Bangkok`
- สิ้นสุด Monitoring: `2026-11-20 15:42 น. Bangkok`
- ผู้รับผิดชอบเฝ้าระวัง: `Platform On-call`
- เกณฑ์ปิด Incident: `P95 < 2,000 ms, Failure Rate < 1%, ไม่มี Timeout ต่อเนื่อง 60 นาที`

## 11. Lessons Learned

### สิ่งที่ทำได้ดี

- Slack Alert และ GitHub Actions ระบุ Run ID ทำให้เริ่มตรวจสอบได้เร็ว
- Rollback ทำได้ภายใน 6 นาทีหลังยืนยัน Root Cause
- ไม่มีข้อมูลสูญหายและไม่พบธุรกรรมซ้ำ

### สิ่งที่ควรปรับปรุง

- PR Performance Test ใช้ Dataset เล็กเกินไป
- ยังไม่มี Index validation เป็น Required Check
- Historical Trend ยังไม่แสดงแยกตาม Endpoint

### สิ่งที่จะทำแตกต่างในการจำลองครั้งหน้า

- บังคับให้ทุก Query Change แนบ Index/Explain evidence
- เพิ่ม Load Test ที่ใกล้เคียง Peak Traffic ก่อน Promote
- ให้ Quality Gate ตรวจ P95 และ Failure Rate ของ Endpoint สำคัญแยกกัน

## 12. Approval และ Closure

- [x] Root Cause ได้รับการยืนยัน
- [x] Mitigation และ Fix ถาวร Deploy แล้ว
- [x] Performance Test ผ่าน
- [x] Production Monitoring กลับสู่ Baseline
- [x] Corrective Actions มี Owner และ Due date
- [x] ผู้เกี่ยวข้องได้รับการสื่อสาร
- [x] ไม่มี Open Critical Error ที่เกี่ยวข้อง

**สถานะสุดท้าย:** `Closed`

**วันที่ปิด:** `2026-11-20 15:42 น. Bangkok`
