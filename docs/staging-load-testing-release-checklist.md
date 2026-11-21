# Checklist: Load Testing บน Staging ก่อน Deploy Production

เอกสารนี้ใช้ตรวจความพร้อมก่อนทำ Load/Stress Testing บน Staging Environment และใช้เป็นหลักฐานประกอบการตัดสินใจ Deploy ขึ้น Production

> เป้าหมายคือยืนยันว่า Release รองรับ Workload ที่คาดหมายได้ มี Latency และ Error Rate อยู่ใน Budget และมีแผน Rollback/Monitoring ที่พร้อมใช้งาน

## 1. Release และ Scope

- [ ] ระบุ Release/Version/Commit SHA ที่จะทดสอบแล้ว
- [ ] ระบุ PR และ Change Summary ที่เกี่ยวข้องแล้ว
- [ ] ระบุ Feature หรือ Endpoint ที่อยู่ใน Scope แล้ว
- [ ] ระบุ Out-of-scope ที่ไม่ต้องนำมาพิจารณาแล้ว
- [ ] ระบุ Owner ฝั่ง Engineering, QA, SRE และ Product แล้ว
- [ ] มี Incident/Post-mortem ที่ยังเปิดอยู่และเกี่ยวข้องหรือไม่: `[ไม่มี / มี: ลิงก์]`
- [ ] กำหนดวันเวลาเริ่ม–สิ้นสุด Test และผู้ On-call แล้ว

รายละเอียด:

```text
Release/Commit: ______________________________
Test window: __________________________________
Test owner: ___________________________________
Approvers: ____________________________________
Scope/Endpoint: _______________________________
```

## 2. Staging Environment Readiness

- [ ] Staging ใช้ Build/Config เดียวกับที่จะ Deploy Production หรือมีรายการความแตกต่างชัดเจน
- [ ] Runtime, Node/Python version และ Dependency ตรงกับ Production
- [ ] Database/Firestore schema และ Index พร้อมเหมือน Production
- [ ] Cloud Functions/Queue/Worker/Storage config ถูกต้อง
- [ ] Connection Pool, Timeout, Retry และ Rate Limit ตั้งค่าตาม Production หรือมีเหตุผลรองรับ
- [ ] Autoscaling/Min-Max Instances ถูกกำหนดและบันทึกไว้
- [ ] CDN/Cache/WAF/Load Balancer ตั้งค่าใกล้เคียง Production
- [ ] มี Capacity เพียงพอสำหรับ Test และไม่กระทบทีมอื่น
- [ ] Health Check ของทุก Service ผ่านก่อนเริ่ม
- [ ] Clock/Timezone ของระบบสอดคล้องกัน โดยเฉพาะ Asia/Bangkok ที่เกี่ยวข้องกับระบบ ChauatGo

Health Check:

```text
Staging URL: __________________________________
API health: PASS / FAIL
Auth: PASS / FAIL
Firestore/Database: PASS / FAIL
Functions: PASS / FAIL
Storage/Queue: PASS / FAIL
```

## 3. Test Data และความปลอดภัย

- [ ] ใช้ข้อมูลจำลองหรือข้อมูลที่ Anonymize แล้วเท่านั้น
- [ ] ไม่มี PII, Token, Password, Payment Data หรือ Webhook URL จริงในชุดทดสอบ
- [ ] Test Account และ Rider/Partner Account ถูกแยกจาก Production
- [ ] Test Order/Job IDs แยก Namespace จาก Production
- [ ] กำหนดวิธี Cleanup ข้อมูลหลัง Test แล้ว
- [ ] ปิดการส่งเงินจริง, SMS จริง, Email จริง และ Push จริง หรือใช้ Sandbox Provider
- [ ] ปิดหรือ Mock External API ที่มีค่าใช้จ่ายหรือผลกระทบภายนอก
- [ ] กำหนดสิทธิ์ของผู้รัน Test แบบ Least Privilege
- [ ] ตรวจว่า App Check/Auth/Rules ของ Staging ยังทำงานตามที่ต้องการ
- [ ] มีแผนลบ Credential และ Test Data หลังจบงาน

## 4. Load Profile และ Test Scenario

- [ ] ระบุ Baseline จากผลทดสอบก่อนหน้าแล้ว
- [ ] ระบุ Expected Peak Traffic แล้ว
- [ ] กำหนดจำนวน Concurrent Users แล้ว
- [ ] กำหนด Spawn Rate แล้ว
- [ ] กำหนด Ramp-up, Steady State และ Ramp-down แล้ว
- [ ] กำหนด Test Duration แล้ว
- [ ] มี Scenario สำหรับ User Type ที่สำคัญ เช่น Customer, Rider, Partner และ Admin
- [ ] Workload สะท้อนสัดส่วนการใช้งานจริง
- [ ] ทดสอบ Happy Path และ Error/Retry Path ที่สำคัญ
- [ ] ทดสอบ Endpoint ที่เปลี่ยนแปลงโดยตรง
- [ ] ทดสอบ Dependency ที่มีความเสี่ยง เช่น Firestore, Functions และ External API
- [ ] กำหนด Load Test แบบปกติ, Stress และ Spike ตามความจำเป็น

ตัวอย่าง Profile:

| Profile | Users | Spawn Rate | Duration | เป้าหมาย |
| --- | ---: | ---: | ---: | --- |
| Smoke | 2 | 1/s | 2 นาที | ตรวจว่า Script/ระบบพร้อม |
| Expected peak | `[ ]` | `[ ]` | `[ ]` | ยืนยัน Capacity ปกติ |
| Stress | `[ ]` | `[ ]` | `[ ]` | หา Saturation Point |
| Spike | `[ ]` | `[ ]` | `[ ]` | ตรวจการรับ Traffic เพิ่มเร็ว |
| Soak | `[ ]` | `[ ]` | `[ชั่วโมง]` | ตรวจ Memory Leak/Resource Drift |

## 5. Threshold และ Quality Gate

กำหนดตัวเลขก่อนเริ่ม Test ห้ามเปลี่ยน Threshold เพื่อให้ Test ผ่านโดยไม่มีการอนุมัติ

| Metric | Budget | Actual | สถานะ |
| --- | ---: | ---: | --- |
| Failure Rate | `≤ 1%` | `[ ]` | `PASS/FAIL` |
| P50 latency | `[ ] ms` | `[ ]` | `PASS/FAIL` |
| P95 latency | `≤ 200 ms` หรือ Budget ของ Service | `[ ]` | `PASS/FAIL` |
| P99 latency | `[ ] ms` | `[ ]` | `PASS/FAIL` |
| HTTP 5xx | `[ ]%` | `[ ]` | `PASS/FAIL` |
| Timeout rate | `[ ]%` | `[ ]` | `PASS/FAIL` |
| RPS/Throughput | `≥ [ ]` | `[ ]` | `PASS/FAIL` |
| CPU utilization | `< [ ]%` | `[ ]` | `PASS/FAIL` |
| Memory utilization | `< [ ]%` | `[ ]` | `PASS/FAIL` |
| DB read/write latency | `< [ ] ms` | `[ ]` | `PASS/FAIL` |
| Queue backlog | `≤ [ ]` | `[ ]` | `PASS/FAIL` |

เกณฑ์ขั้นต่ำที่แนะนำสำหรับ ChauatGo:

```text
Failure Rate: ไม่เกิน 1%
P95: ต้องอยู่ใน Budget ของ Endpoint
P99: ต้องไม่เพิ่มขึ้นผิดปกติเมื่อเทียบกับ Baseline
ไม่มี Data Loss, Duplicate Transaction หรือ Security Rule Bypass
```

## 6. Observability และ Alerting

- [ ] เปิด Dashboard สำหรับ Application, API, Functions, Database และ Infrastructure แล้ว
- [ ] เปิด Log ที่จำเป็นและตั้ง Retention เหมาะสม
- [ ] มี Correlation ID/Request ID สำหรับตาม Request ข้าม Service
- [ ] Metrics แยกตาม Endpoint, Status Code, User Type และ Region ได้
- [ ] ตรวจ CPU, Memory, Network, Instance Count และ Cold Start
- [ ] ตรวจ Firestore/Database Reads, Writes, Contention และ Index Usage
- [ ] ตรวจ Queue Depth, Retry และ Dead Letter Queue
- [ ] ตรวจ Error Rate, Timeout และ Dependency Failure
- [ ] ตั้ง Alert สำหรับ Error Spike และ Latency สูงผิดปกติ
- [ ] ตั้ง Slack/Teams Alert ไปยังช่อง Staging ไม่ใช่ Production
- [ ] ทดสอบว่า Alert ส่งถึงผู้รับผิดชอบจริง
- [ ] มีผู้เฝ้าดู Dashboard ตลอด Test Window

## 7. Pre-test Smoke Test

- [ ] Login และ Authentication ผ่าน
- [ ] Customer สร้าง Order/Request สำเร็จ
- [ ] Rider เห็นและรับงานทดสอบสำเร็จ
- [ ] Partner/Admin Flow ที่อยู่ใน Scope ทำงานได้
- [ ] Firestore Rules/Storage Rules ไม่เปิดสิทธิ์เกินจำเป็น
- [ ] Callable/HTTP Functions ตอบกลับถูกต้อง
- [ ] Notification ถูกส่งไปยัง Test Account เท่านั้น
- [ ] ข้อมูลทดสอบถูกสร้างและล้างได้
- [ ] Baseline Smoke Test ผ่านก่อนเริ่ม Load จริง

## 8. Execution Checklist

ก่อนกดเริ่ม:

- [ ] แจ้งทีมที่เกี่ยวข้องใน Channel แล้ว
- [ ] Freeze การเปลี่ยนแปลง Staging ระหว่าง Test แล้ว
- [ ] ยืนยันว่าไม่มี Job อื่นใช้ Resource ชุดเดียวกัน
- [ ] บันทึกเวลาเริ่ม Test และ Commit SHA
- [ ] บันทึก Parameters ของ Load Test
- [ ] ตรวจว่า Notification Mode ชี้ไปยัง Staging Channel
- [ ] ตรวจว่า Stop/Abort Command ใช้งานได้

ระหว่างรัน:

- [ ] เริ่มจาก Smoke Profile
- [ ] เพิ่ม Load ตาม Ramp-up ที่กำหนด
- [ ] ตรวจ Metrics ทุกช่วง Ramp
- [ ] ตรวจ Error Log และ Timeout แบบ Real-time
- [ ] ตรวจ Resource ไม่เข้า Saturation ก่อนถึง Target Load
- [ ] หยุด Test หากเข้า Stop Condition
- [ ] บันทึกเหตุการณ์และเวลาใน Timeline

ตัวอย่าง Stop Conditions:

- [ ] Failure Rate เกิน `5%` ต่อเนื่อง 2 นาที
- [ ] P95 สูงกว่า Budget `2 เท่า` ต่อเนื่อง 5 นาที
- [ ] มี Data Corruption, Duplicate Transaction หรือ Security Issue
- [ ] Database/Queue เกิด Saturation หรือ Backlog โตต่อเนื่อง
- [ ] Test กระทบผู้ใช้หรือ Environment อื่น
- [ ] ค่าใช้จ่าย Cloud สูงผิดปกติ

## 9. Post-test Validation

- [ ] Test จบตาม Duration หรือถูกหยุดตาม Stop Condition อย่างชัดเจน
- [ ] เก็บ `locust-results.json` และ HTML Report แล้ว
- [ ] บันทึก GitHub Actions Run URL/ID แล้ว
- [ ] ตรวจ Historical Trend และเปรียบเทียบกับ Baseline แล้ว
- [ ] ตรวจ Error Log, Timeout และ Retry แล้ว
- [ ] ตรวจ Database/Firestore ว่าไม่มีข้อมูลผิดปกติ
- [ ] ตรวจว่าไม่มี Order/Payment/Remittance ซ้ำหรือสูญหาย
- [ ] ตรวจ Queue และ Dead Letter Queue แล้ว
- [ ] Cleanup Test Data สำเร็จ
- [ ] ปิด Test Credential/Token ที่ใช้ชั่วคราวแล้ว
- [ ] ปิดหรือปรับ Alert กลับตามมาตรฐาน Staging แล้ว

## 10. Go / No-Go Decision

### Go เมื่อ

- [ ] ทุก Quality Gate ผ่าน
- [ ] Failure Rate อยู่ใน Budget
- [ ] P95/P99 อยู่ใน Budget และไม่มี Trend แย่ลง
- [ ] ไม่มี Critical Error, Data Loss หรือ Security Finding
- [ ] Resource ยังมี Headroom ตามที่กำหนด
- [ ] ไม่มี Queue/Retry Backlog ค้าง
- [ ] Monitoring และ Alert พร้อมสำหรับ Production
- [ ] Rollback Plan ผ่านการตรวจทาน
- [ ] Product/Engineering/SRE อนุมัติร่วมกัน

### No-Go เมื่อ

- [ ] Performance Test Timeout หรือผลไม่สมบูรณ์โดยยังหาสาเหตุไม่ได้
- [ ] Failure Rate หรือ Latency เกิน Budget
- [ ] พบ Data Corruption, Duplicate Transaction หรือ Security Bypass
- [ ] Resource Saturation หรือ Capacity ไม่พอ
- [ ] Artifact/Metric ไม่ครบจนประเมินผลไม่ได้
- [ ] Rollback/Monitoring ยังไม่พร้อม
- [ ] มี Open SEV-1/SEV-2 ที่เกี่ยวข้อง

ผลการตัดสินใจ:

```text
Decision: GO / NO-GO / CONDITIONAL GO
เหตุผล: ______________________________________
เงื่อนไขเพิ่มเติม: ______________________________
ผู้อนุมัติ: ____________________________________
วันที่/เวลา: ___________________________________
```

## 11. Production Readiness และ Rollback

- [ ] มี Deployment Window และ On-call ครบ
- [ ] กำหนด Canary/Gradual Rollout แล้ว หากเหมาะสม
- [ ] กำหนด Production Success Criteria แล้ว
- [ ] มี Dashboard และ Alert Link พร้อมใน Runbook
- [ ] มี Rollback Commit/Image/Config ที่ระบุชัดเจน
- [ ] ทดสอบคำสั่ง Rollback หรือยืนยันขั้นตอนแล้ว
- [ ] กำหนด Owner ที่มีสิทธิ์ Rollback แล้ว
- [ ] กำหนดเวลาสูงสุดในการตัดสินใจ Rollback แล้ว
- [ ] แจ้ง Customer Support/Operations เรื่องผลกระทบที่อาจเกิดขึ้นแล้ว
- [ ] กำหนด Post-deploy Smoke Test แล้ว

Rollback Information:

```text
Current release: _______________________________
Rollback target: _______________________________
Rollback owner: _______________________________
Maximum decision time: ________________________
Verification after rollback: ____________________
```

## 12. Sign-off

| บทบาท | ชื่อ | ผลการอนุมัติ | วันที่ | หมายเหตุ |
| --- | --- | --- | --- | --- |
| Engineering Owner | `[ ]` | `Approve/Reject` | `[ ]` | `[ ]` |
| QA/Performance Owner | `[ ]` | `Approve/Reject` | `[ ]` | `[ ]` |
| SRE/Platform Owner | `[ ]` | `Approve/Reject` | `[ ]` | `[ ]` |
| Product/Operations Owner | `[ ]` | `Approve/Reject` | `[ ]` | `[ ]` |

## 13. หลักฐานที่ต้องแนบ

- [ ] Load Test configuration/profile
- [ ] Locust JSON report
- [ ] Locust HTML report
- [ ] GitHub Actions Run URL และ Log
- [ ] Historical Trend CSV หรือ Dashboard Snapshot
- [ ] Application/Infrastructure Dashboard Snapshot
- [ ] Error/Timeout Log ที่ Redact แล้ว
- [ ] รายการ Test Data และผล Cleanup
- [ ] Go/No-Go Approval
- [ ] Rollback Plan

## 14. สรุปผลการทดสอบ

```text
Release/Commit: ______________________________
Environment: Staging
Test profile: _________________________________
Actual users: _________________________________
Duration: ____________________________________
Failure Rate: _________________________________
P95: _________________________________________
P99: _________________________________________
Final result: PASS / FAIL / INCONCLUSIVE
Production decision: GO / NO-GO / CONDITIONAL GO
```
