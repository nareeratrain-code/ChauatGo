# คู่มือทีม: Performance Historical Trends และ Slack Alerts

คู่มือนี้ใช้สำหรับตรวจสอบผล Performance Test รายสัปดาห์ของ ChauatGo และรับมือกับการแจ้งเตือนจาก Locust, Quality Gate และ Workflow Orchestrator

> หมายเหตุ: Historical CSV จะสะสมข้อมูลก็ต่อเมื่อรัน Summary Script พร้อม `--history-csv` และต้องมีการเก็บไฟล์ดังกล่าวไว้ใน Local, GitHub Artifact หรือ Storage กลางอย่างใดอย่างหนึ่ง

## 1. แหล่งข้อมูลที่ต้องตรวจ

ทีมจะเห็นผลจาก 3 แหล่งหลัก:

1. **GitHub Actions** — สถานะ Workflow, Log, Run URL และ Artifacts
2. **Historical CSV** — ใช้เปรียบเทียบแนวโน้มรายสัปดาห์
3. **Slack** — แจ้งเตือนแบบ Real-time เมื่อผ่าน, ไม่ผ่าน หรือเกิด Error/Timeout

ไฟล์รายงานที่ควรค้นหา:

```text
locust-results.json
locust-report.html
locust-history.csv
```

## 2. ดู Historical CSV

เมื่อตั้งค่า `--history-csv` แล้ว สามารถเปิดดูรายงานบนเครื่อง Local ได้ด้วย:

```bash
column -s, -t < ./history/locust-history.csv | less -S
```

ดูเฉพาะรายการล่าสุด:

```bash
tail -10 ./history/locust-history.csv
```

ดูรายการที่ไม่ผ่าน:

```bash
awk -F, 'NR == 1 || $NF == "FAIL" || $NF == "ERROR"' \
  ./history/locust-history.csv
```

ตรวจว่าไฟล์มี Header ถูกต้อง:

```bash
head -1 ./history/locust-history.csv
```

คอลัมน์สำคัญ:

| คอลัมน์ | ความหมาย |
| --- | --- |
| `timestamp_utc` | เวลาที่บันทึกผลใน UTC |
| `source` | แหล่งที่มา เช่น `local` หรือ `github-actions` |
| `run_id` | GitHub Actions Run ID |
| `commit_sha` | Commit ที่ใช้ทดสอบ |
| `requests` | จำนวน Request ทั้งหมด |
| `failures` | จำนวน Request ที่ล้มเหลว |
| `failure_rate_pct` | อัตราความล้มเหลวเป็นเปอร์เซ็นต์ |
| `rps` | Requests per second |
| `p95_ms` | 95% ของ Request ตอบกลับไม่เกินค่านี้ |
| `p99_ms` | 99% ของ Request ตอบกลับไม่เกินค่านี้ |
| `max_failure_rate_pct` | Failure Rate budget |
| `max_p95_ms` | P95 budget |
| `result` | `PASS`, `FAIL` หรือ `ERROR` |

## 3. เกณฑ์การอ่าน Trend

ค่าเริ่มต้นของ Quality Gate คือ:

```text
Failure Rate <= 1%
P95 <= 200 ms
```

ให้ดูแนวโน้มอย่างน้อย 4–6 รอบ ไม่ควรตัดสินจาก Run เดียว หากไม่มี Error ร่วมด้วย

### สัญญาณปกติ

- `result = PASS`
- Failure Rate อยู่ต่ำกว่า 1% อย่างสม่ำเสมอ
- P95 ต่ำกว่า 200 ms
- P99 สูงขึ้นเล็กน้อยแต่ไม่เพิ่มต่อเนื่อง
- จำนวน Requests ใกล้เคียงกันในแต่ละรอบ

### สัญญาณต้องเฝ้าระวัง

- P95 เพิ่มขึ้นต่อเนื่องหลายสัปดาห์ แม้ยังไม่เกิน 200 ms
- P99 สูงขึ้นมากกว่าปกติ แต่ P95 ยังผ่าน
- Failure Rate เพิ่มขึ้นจาก 0% เป็นค่าบวกต่อเนื่อง
- RPS ลดลงเมื่อใช้จำนวนผู้ใช้และระยะเวลาทดสอบเท่าเดิม
- จำนวน Requests แตกต่างจากรอบก่อนมากผิดปกติ

### สัญญาณต้องเปิด Incident

- `result = FAIL`
- Failure Rate มากกว่า 1%
- P95 มากกว่า 200 ms
- `result = ERROR`
- Workflow Timeout, ถูกยกเลิก หรือหา Artifact ไม่พบ
- มี Failure/Timeout ซ้ำตั้งแต่ 2 รอบขึ้นไป

## 4. การอ่าน Slack Notification

### PASS

ตัวอย่าง:

```text
Locust Threshold: PASS
Requests: 1000
Failures: 0
Failure rate: 0% (max 1%)
RPS: 33.33
P95 latency: 150 ms (max 200 ms)
P99 latency: 180 ms
```

การดำเนินการ:

1. ตรวจว่า Run URL และ Commit ถูกต้อง
2. ไม่ต้องเปิด Incident
3. บันทึกผลลง Historical CSV หาก Workflow ยังไม่ได้ทำอัตโนมัติ

### FAIL

ตัวอย่าง:

```text
Locust Threshold: FAIL
Failure rate: 2.50% (max 1%)
P95 latency: 250 ms (max 200 ms)
```

การดำเนินการ:

1. เปิด Run URL ในข้อความ Slack
2. ตรวจว่า Fail เกิดจาก Failure Rate, P95 หรือทั้งสองค่า
3. ดาวน์โหลด `locust-results.json` และ `locust-report.html`
4. เปรียบเทียบกับ Commit และ Run ก่อนหน้า
5. แจ้งเจ้าของ PR หรือทีม Backend/Frontend ที่เกี่ยวข้อง
6. หลีกเลี่ยงการ Merge หากไม่มีการยืนยันสาเหตุหรือข้อยกเว้นที่อนุมัติแล้ว

### ERROR / TIMEOUT

ตัวอย่าง:

```text
Locust Performance: ERROR
Error: GitHub Actions run 44680184450 timed out after 30 minutes
```

การดำเนินการ:

1. ตรวจสถานะ Run ใน GitHub Actions
2. แยกว่าเป็น Workflow Error, Timeout, Cancelled หรือ Artifact หาย
3. ตรวจ Log ของ Step ที่ล้มเหลว
4. หากเป็น Timeout ให้ตรวจว่าระบบปลายทางช้า หรือ Runner ติดตั้ง Dependency ไม่เสร็จ
5. หากเป็น Artifact หาย ให้ตรวจ Step Locust และ Upload Artifact
6. รันซ้ำหนึ่งครั้งด้วย Parameters เดิมก่อนสรุปว่าเป็น Regression

## 5. Runbook เมื่อ Performance FAIL

ใช้ขั้นตอนนี้ตามลำดับ:

```text
1. เก็บ Run URL, Run ID และ Commit SHA
2. ดาวน์โหลด Locust JSON/HTML report
3. ตรวจจำนวน Requests และ Failure Rate
4. ตรวจ P95 และ P99 เทียบกับรอบก่อน
5. ดู Log ของ Web Server และ Playwright/Locust
6. ตรวจว่าเกิดเฉพาะ Profile ใดหรือเกิดทุก Profile
7. รันซ้ำด้วย Workload เดิม
8. สร้าง Issue พร้อมหลักฐานและลิงก์ Run
```

คำสั่งดาวน์โหลด Artifact:

```bash
RUN_ID=ใส่_RUN_ID

gh run download "$RUN_ID" \
  --repo nareeratrain-code/ChauatGo \
  --dir ./artifacts/investigation
```

รัน Summary ซ้ำโดยไม่ส่ง Slack:

```bash
python3 scripts/performance/summarize_locust_results.py \
  ./artifacts/investigation/locust-results.json \
  --max-failure-rate 1 \
  --max-p95-ms 200 \
  --notify none
```

## 6. ป้องกัน Slack แจ้งเตือนซ้ำ

ก่อนเปิดใช้ Scheduled Orchestrator ให้ตรวจว่า Workflow เดิมไม่ได้ส่ง Slack/Teams ซ้ำสำหรับ Run เดียวกัน

แนวทางที่แนะนำ:

- ให้ `performance-test.yml` เป็นเจ้าของ Notification สำหรับ Scheduled Run
- ให้ `performance-after-important-merge.yml` แจ้งเตือนเฉพาะ PR หรือ Manual Run โดยตรง
- ใช้ `--notify none` หาก Workflow ที่ถูก Dispatch ส่ง Notification อยู่แล้ว
- ห้ามส่ง Webhook URL ใน Log หรือ Commit

หากพบข้อความซ้ำ ให้ตรวจ:

```text
1. Scheduled Trigger ของ Workflow เดิม
2. Notification steps ใน performance-after-important-merge.yml
3. --notify ของ run-performance-and-notify.sh
4. Slack/Teams Webhook ที่ตั้งค่าใน Repository Secrets
```

## 7. การจัดการ Secret และสิทธิ์

Webhook ต้องเก็บใน GitHub Repository Secrets เท่านั้น:

```text
SLACK_WEBHOOK_URL
TEAMS_WEBHOOK_URL
```

ห้าม:

- เขียน Webhook URL ลง CSV
- ใส่ Webhook URL ใน `workflow.yml`
- ส่งค่า Secret เข้า `echo`
- แนบ Secret ใน Issue หรือ Slack
- Commit ไฟล์ `.env`

หาก Webhook รั่ว ให้ยกเลิกหรือ Rotate URL ทันที แล้วอัปเดต GitHub Secret

## 8. Checklist รายสัปดาห์

- [ ] Scheduled Workflow ทำงานตามเวลา
- [ ] Run จบด้วยสถานะที่คาดหมาย
- [ ] มี `locust-results.json` และ HTML report
- [ ] Historical CSV มีแถวใหม่
- [ ] จำนวน Requests ใกล้เคียงรอบก่อน
- [ ] Failure Rate อยู่ใน Budget
- [ ] P95 และ P99 ไม่เพิ่มขึ้นผิดปกติ
- [ ] Slack แจ้งเตือนเพียงครั้งเดียว
- [ ] หาก FAIL/ERROR มีผู้รับผิดชอบและ Issue ติดตาม

## 9. สรุปการตัดสินใจ

| ผลลัพธ์ | การตัดสินใจ |
| --- | --- |
| `PASS` และ Trend ปกติ | ปิดการตรวจรอบนั้นได้ |
| `PASS` แต่ P95/P99 เพิ่มต่อเนื่อง | เฝ้าระวังและสร้างงานปรับปรุง |
| `FAIL` ครั้งเดียว | ตรวจซ้ำและสร้าง Issue |
| `FAIL` ซ้ำ | เปิด Incident/หยุด Merge ที่เกี่ยวข้อง |
| `ERROR` หรือ `TIMEOUT` ครั้งเดียว | ตรวจ Log และ Retry |
| `ERROR` หรือ `TIMEOUT` ซ้ำ | เปิด Incident ด้าน CI/CD หรือระบบปลายทาง |
