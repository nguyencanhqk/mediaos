# S6-LEAVE-ACCRUAL-1 — Engine cộng dồn phép theo chính sách (`accrual_method`)

> Work Order: `harness/backlog.mjs` → `S6-LEAVE-ACCRUAL-1` · zone **ĐỎ** (crown-jewel) · gate **FULL**
> Nguồn: RELEASE-05 §4.1 (UX blocker + Data integrity) · SPEC-05 (LEAVE) · DB-05 §7.2/§7.3/§7.4
> Quyết định nghiệp vụ owner 2026-08-01: D-A1 · D-A2 · D-A3 · D-A4 (xem khối CR trong `harness/backlog.mjs`)

---

## 1. Vấn đề (đo lại trên PROD 2026-08-01, KHÔNG chép lại số của WO)

| Đo                                       | Kết quả                                                                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `leave_balances`                         | **0 dòng** / 45 hồ sơ nhân sự                                                                                                                                            |
| `leave_balance_transactions`             | **0 dòng**                                                                                                                                                               |
| `leave_policies` (deleted_at IS NULL)    | **ĐÚNG 1 dòng**: `DEFAULT_ANNUAL` · scope `Company` · `accrual_method='None'` · `yearly_quota_days=12.00` · `allow_negative_balance=false` · `effective_from=2020-01-01` |
| `leave_types.deduct_balance=true`        | `ANNUAL` · `COMPENSATORY` · `SICK` (cả 3 `allow_negative_balance` = NULL)                                                                                                |
| `employee_profiles` (deleted_at IS NULL) | 45 — 34 `active` · 11 `resigned`; 44 có `start_date`, **thiếu 1** (`employee_code=1136`, đang `active`)                                                                  |
| Ngày vào làm                             | 2017-03-02 → 2026-06-22, không có ngày tương lai                                                                                                                         |

Hệ quả: `reserveIfNeeded` ([leave-request.service.ts:545](../../apps/api/src/leave/leave-request.service.ts#L545)) đọc
`remaining_days − pending_days`; không có dòng balance ⇒ `available = 0` ⇒ **mọi đơn nghỉ của 3 loại
`deduct_balance=true` trả 422 `BALANCE_NOT_ENOUGH`**.

Bẫy gốc đã xác minh: [leave-policy-form.ts:49](../../apps/app/src/routes/leave/leave-policy-form.ts#L49) cho HR
chọn `accrualMethod ∈ None|Monthly|Yearly|Manual|Prorated`, `leave-admin.service.ts:254` ghi xuống DB —
nhưng **KHÔNG một dòng code nào ĐỌC `accrual_method` để cấp phép**. HR cấu hình xong tưởng đã chạy;
thực tế 0 ngày được cấp và **không có lỗi nào báo**. Đây là lỗi _im lặng_, không phải lỗi _sai số_.

### 1.1 Ba phát hiện MỚI trong lúc khảo sát (đổi phạm vi so với WO)

**F1 — Preview 295 ngày của WO là số NGÂY THƠ; số ĐÚNG là 245.**
WO tính tháng đủ điều kiện chỉ theo `start_date`. Nếu chặn thêm bằng `end_date` (nhân viên đã nghỉ việc
không tiếp tục tích luỹ phép sau ngày nghỉ), số ngày cấp cho năm 2026 (7 tháng đã kết thúc, quota 12 ⇒
1 ngày/tháng):

|                                                   | Số tháng-cấp | Số NV |
| ------------------------------------------------- | ------------ | ----- |
| Ngây thơ (chỉ `start_date`)                       | **295**      | 44    |
| Đúng (chặn thêm `end_date`)                       | **245**      | 41    |
| ↳ đang làm (`active`)                             | 220          | 33    |
| ↳ đã nghỉ (`resigned`, phần tháng THẬT SỰ đã làm) | 25           | 8     |

50 ngày chênh lệch = quyền lợi cấp cho người **đã rời công ty**, gồm 2 hồ sơ nghỉ việc từ **2025**
(`1119` nghỉ 05/03/2025, `1129` nghỉ 24/05/2025) vẫn được cấp 7 ngày phép 2026. Đây đúng là loại lỗi
"Data integrity" mà WO đi vá ⇒ **plan chọn số 245**, và ghi rõ chênh lệch để owner đối chiếu.
Vẫn cấp cho `resigned` phần tháng họ ĐÃ làm trọn (cần cho quyết toán phép khi thôi việc) — chỉ chặn
phần SAU `end_date`.

**F2 — `SICK` và `COMPENSATORY` KHÔNG có chính sách nào.** Chỉ `ANNUAL` có `DEFAULT_ANNUAL`. Engine chạy
theo chính sách (D-A4) ⇒ sau WO này, 2 loại đó **vẫn 422**. Đây là quyết định **cấu hình dữ liệu**, không
phải code — xem §7 (việc còn lại cho owner). Engine KHÔNG tự bịa chính sách.

**F3 — Cấp phép hằng tháng có thể lệch số lẻ.** `leave_balances.total_days` là `numeric(5,1)` (1 chữ số
thập phân) còn `leave_balance_transactions.amount_days` là `numeric(8,2)`. Quota 15 ngày ⇒ 15/12 = 1.25
⇒ Postgres LÀM TRÒN xuống cột balance thành 1.3 trong khi sổ cái ghi 1.25 ⇒ **sổ cái và số dư lệch dần**,
và 12 × 1.3 = 15.6 > quota. Xử lý ở §3.3 (cấp theo _mốc cộng dồn_, không cấp theo _số hạng cố định_).

---

## 2. Phạm vi

**LÀM:** engine cấp phép định kỳ + bù kỳ đã qua, ghi sổ cái append-only, chạy nền qua `@SystemJobHandler`,
màn/route xem trước (dry-run), chặn cấu hình câm ở DTO + form.

**KHÔNG LÀM (ranh giới rõ):**

- Chuyển tiếp/hết hạn phép cuối năm → `S6-LEAVE-CARRYOVER-1` (WO nối tiếp, `depends_on` WO này).
- Sửa dữ liệu master PROD (`deduct_balance` của SICK/COMPENSATORY, bật `accrual_method='Monthly'` cho
  `DEFAULT_ANNUAL`) → thao tác của owner sau khi merge, §7.
- Bù phép các năm TRƯỚC năm hiện tại (2017–2025) — xem §3.5.

---

## 3. Thiết kế

### 3.1 Ai được cấp (điều kiện vào)

Một `(nhân viên, loại nghỉ, kỳ)` đủ điều kiện khi TẤT CẢ đúng:

1. `employee_profiles.deleted_at IS NULL` **và** `user_id IS NOT NULL`
   (`leave_balances.user_id` NOT NULL — không có user thì không thể tạo dòng số dư).
2. `start_date IS NOT NULL` — **thiếu ⇒ BỎ QUA + báo cáo tường minh**, KHÔNG suy đoán, KHÔNG mặc định
   01/01 (done_when #4). HR điền xong, nhịp sau tự bù (idempotent).
3. Chính sách áp dụng cho loại nghỉ đó có `status='Active'`, `deleted_at IS NULL`, kỳ nằm trong
   `[effective_from, effective_to]`, và `accrual_method ∈ {Monthly, Yearly, Prorated}` (D-A4).
4. `yearly_quota_days` NOT NULL và > 0 — **NULL ⇒ BỎ QUA + báo cáo** (đây chính là dạng "cấu hình câm"
   thứ hai; §5 chặn nó ngay từ lúc nhập).
5. Nhân viên làm **TRỌN** kỳ đó: `start_date ≤ ngày đầu kỳ` **và** (`end_date IS NULL` hoặc
   `end_date ≥ ngày cuối kỳ`) — F1.
6. Kỳ đã **KẾT THÚC**: `ngày cuối kỳ < hôm nay` (D-A1 — tháng đang chạy KHÔNG được cấp trước).

Chọn chính sách: **1 chính sách/loại nghỉ/nhân viên** — `priority` cao nhất, hôm nay chỉ có scope
`Company` được resolve (giữ nguyên hành vi `findActivePolicyForTypeTx`; scope hẹp hơn vẫn DEFERRED,
KHÔNG mở rộng trong WO này để không đổi cả đường tính đơn nghỉ).

### 3.2 Ngữ nghĩa từng `accrual_method`

| `accrual_method` | Engine làm gì                                                                    | Nguồn                        |
| ---------------- | -------------------------------------------------------------------------------- | ---------------------------- |
| `None`           | **không đụng** vào loại nghỉ đó                                                  | D-A4 (mặc định PROD hôm nay) |
| `Manual`         | **không đụng** — HR tự cấp qua `adjust:leave-balance` (đường đã có)              | D-A4                         |
| `Monthly`        | cấp cho từng THÁNG đã kết thúc mà NV làm trọn; ngày ghi sổ = **ngày cuối tháng** | D-A1 + D-A2                  |
| `Yearly`         | cấp TOÀN BỘ quota **một lần/năm**, ngày ghi sổ = **01/01** của năm               | ⚠️ giả định — §3.6           |
| `Prorated`       | như `Yearly` nhưng năm NV vào làm thì cấp theo tỉ lệ `số tháng làm trọn / 12`    | ⚠️ giả định — §3.6           |

### 3.3 Số ngày cấp — cấp theo MỐC CỘNG DỒN (xử lý F3)

KHÔNG cấp `quota/12` mỗi tháng. Thay vào đó, với `m` = số thứ tự tháng trong năm (1..12):

```text
mốc(m)   = làm_tròn_1_chữ_số(quota × m / 12)
số_cấp(m) = mốc(m) − mốc(m−1)          // mốc(0) = 0
```

Tính chất (được ép bằng unit test):

- Mỗi số hạng biểu diễn ĐÚNG trong `numeric(5,1)` ⇒ **sổ cái và `total_days` luôn khớp**, không trôi.
- `Σ số_cấp(1..12) = làm_tròn_1_chữ_số(quota)` ⇒ **không vượt quota** dù quota lẻ.
- quota 12 ⇒ đúng 1.0/tháng (ca PROD hôm nay).
- quota 15 ⇒ 1.3 · 1.2 · 1.3 · 1.2 … Σ = 15.0 (thay vì 15.6 của cách chia đều).

### 3.4 Idempotency — khoá ở TẦNG DB, không chỉ ở tầng app

Hợp đồng `JobHandler` (`scheduler/job-handler.ts:43`): handler chạy **mỗi nhịp scheduler (60s)** và PHẢI
idempotent ⇒ cộng dồn định kỳ và bù kỳ bỏ lỡ là **CÙNG một đường code**.

Ba lớp, từ ngoài vào:

1. `JobRunner` chiếm `system_job_locks(jobCode)` — 1 instance chạy tại 1 thời điểm.
2. Engine đọc trước danh sách ACCRUAL đã ghi rồi chỉ tính phần THIẾU.
3. **Migration 0536** — chốt cuối, chống mọi đường ghi (kể cả script tay/instance lạ):

```sql
CREATE UNIQUE INDEX uq_leave_balance_tx_accrual_period
  ON leave_balance_transactions (company_id, employee_id, leave_type_id, transaction_date)
  WHERE transaction_type = 'ACCRUAL';
```

Ánh xạ kỳ → `transaction_date` phải **đơn ánh** để index trên là đúng khoá (nhân viên, loại, năm, tháng)
mà done_when yêu cầu:

- `Monthly` kỳ (Y, m) → **ngày cuối tháng** (`Y-m-31`, `Y-02-28/29`, …)
- `Yearly`/`Prorated` kỳ Y → **`Y-01-01`**

01/01 không bao giờ là ngày-cuối-tháng ⇒ hai họ kỳ không đụng nhau kể cả khi HR đổi
`Monthly → Yearly` giữa năm. Index là **partial** (`transaction_type='ACCRUAL'`) nên KHÔNG đụng
`RESERVE/USE/ADJUSTMENT/CARRY_OVER/EXPIRE` — S6-LEAVE-CARRYOVER-1 không bị chặn.

> Migration này **không đổi dữ liệu, không hạ ràng buộc, không đụng RLS/FORCE/grant**. `leave_balance_transactions`
> hiện: RLS + FORCE bật, `mediaos_app` = SELECT+INSERT, `mediaos_worker` = SELECT (append-only, BẤT BIẾN #2) — GIỮ NGUYÊN.
> PROD có 0 dòng ⇒ tạo index không thể vỡ vì trùng dữ liệu cũ.

### 3.5 Cửa sổ bù kỳ đã qua (chống hai lỗi ngược nhau)

- Bù **quá ít**: chạy job lúc 00:00:01 ngày 01/01/2027 mà chỉ xét "năm hiện tại" ⇒ **mất tháng 12/2026 vĩnh viễn**.
- Bù **quá nhiều**: lấy `effective_from` (= 2020-01-01 của `DEFAULT_ANNUAL`) làm mốc ⇒ bù 2020→2026 =
  ~7 × 12 ngày/người — một khoản nợ phép khổng lồ **không ai yêu cầu** (owner chốt preview chỉ cho 2026).

Chốt: **sàn = 01/01 của năm chứa `(hôm nay − 45 ngày)`**, rồi cắt thêm bằng `policy.effective_from`.

| Ngày chạy            | `hôm nay − 45` | Sàn        | Kết quả                                            |
| -------------------- | -------------- | ---------- | -------------------------------------------------- |
| 01/08/2026 (lần đầu) | 17/06/2026     | 01/01/2026 | bù T1..T7/2026 = **245 ngày** ✓ đúng preview §1.1  |
| 01/01/2027 00:00     | 17/11/2026     | 01/01/2026 | quét lại 2026 (đã có ⇒ no-op) + **cấp T12/2026** ✓ |
| 20/02/2027           | 06/01/2027     | 01/01/2027 | 2026 rơi ra khỏi cửa sổ (đã cấp xong) ✓            |

**Giới hạn đã biết (ghi rõ, không giấu):** API chết liên tục > ~45 ngày vắt qua giao thừa ⇒ các tháng cuối
năm cũ rơi khỏi cửa sổ. Đường vá: HR cấp tay qua `POST /leave/admin/balances/:id/adjust` (đã có, ghi sổ
`ADJUSTMENT`). Sự cố ngừng-dịch-vụ 45 ngày là sự cố vận hành có giám sát riêng (RELEASE-09), không phải
ca thường.

### 3.6 ⚠️ Giả định cần owner xác nhận (KHÔNG chặn merge)

Owner mới chốt ngữ nghĩa cho `Monthly` (D-A1/D-A2). `Yearly` và `Prorated` là **giả định của plan này**
(§3.2). Cân nhắc: nếu bỏ trống 2 giá trị đó thì HR chọn chúng lại rơi đúng vào cái bẫy im lặng WO đang
vá. Rủi ro thực tế **bằng 0 ở PROD hôm nay** (chính sách duy nhất sẽ được bật là `Monthly`); owner sửa
được trước khi bật `Yearly/Prorated` cho bất kỳ chính sách nào.

**Hệ quả cần biết trước khi bật `Yearly`:** cấp-trước-cả-năm nghĩa là người đang làm ngày 01/01 rồi nghỉ
việc tháng 3 **vẫn nhận trọn quota năm** — khác hẳn `Monthly` (chặn theo `end_date` từng tháng, §1.1 F1).
Đây là bản chất của cấp-trước chứ không phải sót điều kiện: phần thừa thuộc về **quyết toán khi thôi
việc**, không phải việc của engine cộng dồn. Muốn quyền lợi bám sát thời gian làm việc thực tế thì dùng
`Monthly` — và đó đúng là phương án PROD sẽ bật.

### 3.7 Ghi gì, ở đâu (một transaction / một nhân viên-loại nghỉ)

Trong **một** `withTenant(companyId, …)` (BẤT BIẾN #1), cho mỗi kỳ thiếu:

1. `leave_balances` — upsert theo khoá có sẵn `(company_id, user_id, leave_type_id, year)`:
   `total_days += số_cấp` · `granted_days = COALESCE(granted_days,0) + số_cấp` ·
   `employee_id` · `balance_year` · `period_start/period_end` = biên năm · `status='Active'` ·
   `last_accrual_at = now()`. **KHÔNG đụng** `used_days` và `remaining_days` (cột GENERATED).
2. `leave_balance_transactions` — INSERT 1 dòng `transaction_type='ACCRUAL'`, `transaction_date` theo
   §3.4, `amount_days`, `balance_before_days`/`balance_after_days`, `created_by_type='Job'`,
   `reason` = mã kỳ (vd `ACCRUAL 2026-07`), `metadata = {policyId, policyCode, method, quota, periodKey}`.
   **INSERT ONLY** — không UPDATE/DELETE dòng cũ (BẤT BIẾN #2).
3. `audit_logs` — **CHỈ khi thực sự có cấp** (`granted > 0`), 1 dòng/tenant/lần chạy:
   `action='leave_accrual_run'` · `objectType='leave_balance'` (đã nằm trong CHECK union — **không cần
   migration audit**) · `actorType='Job'` · `metadata` = **chỉ số đếm** (không PII).
   > Bài học đã ghi: `lms-user-sync` từng ghi 1 dòng audit MỖI nhịp 60s ⇒ ~526k dòng/năm rác trong bảng
   > append-only. Ở đây `granted=0` là trạng thái BÌNH THƯỜNG 99.99% thời gian ⇒ tuyệt đối không audit.

Thứ tự khoá chống race: `SELECT … FOR UPDATE` dòng balance trước khi cộng (giống `applyAdjustmentTx`).

---

## 4. File đụng tới

| File                                                             | Loại | Ghi chú                                                    |
| ---------------------------------------------------------------- | ---- | ---------------------------------------------------------- |
| `apps/api/migrations/0536_s6leaveaccrual1_accrual_period_uq.sql` | MỚI  | §3.4 — nối tiếp head 0535                                  |
| `apps/api/src/db/schema/leave.ts`                                | SỬA  | khai index mới cho khớp DB (additive)                      |
| `apps/api/src/leave/leave-accrual.logic.ts`                      | MỚI  | **THUẦN**, không DB — kỳ · điều kiện · làm tròn            |
| `apps/api/src/leave/leave-accrual.logic.spec.ts`                 | MỚI  | unit, **RED trước**                                        |
| `apps/api/src/leave/leave-accrual.repository.ts`                 | MỚI  | truy vấn + upsert + ghi sổ                                 |
| `apps/api/src/leave/leave-accrual.service.ts`                    | MỚI  | `previewCompany()` (dry-run) + `runCompany()`              |
| `apps/api/src/leave/leave-accrual.job-handler.ts`                | MỚI  | `jobCode = 'LEAVE_ACCRUAL'`                                |
| `apps/api/src/leave/leave-accrual.int.spec.ts`                   | MỚI  | integration (LANE_DB)                                      |
| `apps/api/src/leave/leave.module.ts`                             | SỬA  | + 4 provider (khối additive)                               |
| `apps/api/src/leave/leave.controller.ts`                         | SỬA  | + `GET admin/accrual/preview` (`view:leave-balance`)       |
| `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json`               | SINH | artifact route-census regen (452→453 route, 401 gated)     |
| `packages/contracts/src/leave.ts`                                | SỬA  | schema preview + **ràng buộc quota ⇔ accrual_method** (§5) |
| `apps/app/src/routes/leave/leave-policy-form.ts`                 | SỬA  | mirror ràng buộc §5                                        |
| `apps/app/src/i18n/locales/vi/*`                                 | SỬA  | thông báo lỗi mới                                          |
| `harness/backlog.mjs`                                            | SỬA  | đóng WO (DoD §8)                                           |

**KHÔNG đụng:** `leave-request.service.ts` · `leave-approval.service.ts` · `leave-revoke.service.ts` ·
`scheduler/**` (handler tự đăng ký qua metadata — chiều phụ thuộc MỘT HƯỚNG, không sửa SchedulerModule).

> `paths` của WO khai `apps/api/src/scheduler/**` nhưng thi công KHÔNG cần sửa file nào ở đó —
> `DiscoveryService` tự gom handler. Khai dư an toàn hơn khai thiếu (bài học `wo-paths-drive-gate-and-scheduler`).

---

## 5. Đóng lỗ "cấu hình câm" ở đầu vào (không chỉ vá ở engine)

Nguyên nhân gốc của WO là **im lặng**, nên vá ở engine thôi là chưa đủ: HR vẫn có thể đặt
`accrual_method='Monthly'` mà để trống `yearly_quota_days` ⇒ lại 0 ngày, lại không lỗi.

- `packages/contracts/src/leave.ts` — `create`/`update` policy: nếu `accrualMethod ∈ {Monthly, Yearly,
Prorated}` thì `yearlyQuotaDays` BẮT BUỘC và > 0 (`superRefine`, path `yearlyQuotaDays`).
- `apps/app/src/routes/leave/leave-policy-form.ts` — cùng luật, cùng path, i18n vi.
- Engine vẫn giữ nhánh phòng thủ (§3.1 điều kiện 4) cho dữ liệu cũ đã nằm sẵn trong DB.

---

## 6. Kế hoạch test (RED trước — done_when #1)

**Unit (`leave-accrual.logic.spec.ts`, không DB) — viết & chạy ĐỎ trước khi có engine:**

1. Tháng đang chạy KHÔNG được cấp (D-A1); tháng vừa kết thúc ĐƯỢC cấp.
2. `start_date` giữa tháng ⇒ tháng đó KHÔNG tính; tháng kế tính (D-A2).
3. `start_date` đúng ngày 1 ⇒ tháng đó TÍNH.
4. `end_date` giữa tháng ⇒ tháng đó KHÔNG tính (F1); `end_date` đúng ngày cuối tháng ⇒ TÍNH.
5. Không `start_date` ⇒ 0 kỳ + **có lý do trong báo cáo** (không im lặng).
6. `accrual_method='None'|'Manual'` ⇒ 0 kỳ.
7. Làm tròn: quota 12 ⇒ mỗi tháng 1.0, Σ=12.0; quota 15 ⇒ Σ 12 tháng = 15.0 và **mọi số hạng có ≤1 chữ số
   thập phân** (F3).
8. `quota = null / 0 / âm` ⇒ 0 kỳ + lý do.
9. Sàn cửa sổ (§3.5): mô phỏng chạy 01/01/2027 ⇒ có kỳ 12/2026; chạy 20/02/2027 ⇒ không còn kỳ 2026.
10. Năm nhuận: kỳ 02/2028 ⇒ `transaction_date = 2028-02-29`.
11. `Yearly`/`Prorated` theo §3.2.

**Integration (`leave-accrual.int.spec.ts`, LANE_DB — `hasDb && LANE_DB`):**

1. **Idempotent**: chạy job 1 → N lần trên cùng kỳ ⇒ số dòng sổ cái và `total_days` **không đổi** sau
   lần 1 (done_when #1). Kể cả khi ép chạy song song.
2. **Chốt DB**: INSERT tay dòng ACCRUAL trùng `(company, employee, type, date)` ⇒ **unique violation**
   (chứng minh lớp 3 §3.4 thật sự sống, không chỉ nhờ logic app).
3. **Append-only**: role app UPDATE/DELETE dòng ACCRUAL ⇒ lỗi quyền (BẤT BIẾN #2).
4. **Số khớp**: seed dữ liệu hình PROD (quota 12, 7 tháng đã kết thúc, có NV nghỉ việc giữa năm, có NV
   thiếu `start_date`) ⇒ tổng cấp = số của `previewCompany()`, và NV nghỉ việc chỉ nhận phần đã làm.
5. **Cô lập tenant**: tenant B có chính sách `Monthly` ⇒ chạy cho tenant A **không** đẻ dòng nào của B.
6. **Thiếu `start_date`**: bị bỏ qua, có trong `skipped[]` với lý do; điền `start_date` rồi chạy lại ⇒
   được bù đủ (idempotent, không cấp đôi cho người khác).
7. **Balance dùng dở**: đã có `used_days` > 0 ⇒ accrual cộng vào `total_days`, `remaining_days`
   (GENERATED) tự đúng, KHÔNG vỡ CHECK `used_days <= total_days`.
8. **Deny-path**: `GET /leave/admin/accrual/preview` không có `view:leave-balance` ⇒ **403**;
   khác tenant ⇒ không lộ dữ liệu.
9. **Audit**: `granted=0` ⇒ **0 dòng audit**; `granted>0` ⇒ đúng 1 dòng, `metadata` chỉ có số đếm.

Coverage ≥ 80% cho `leave-accrual.logic.ts` + `leave-accrual.service.ts` (per-file threshold).

---

## 7. Ra PROD — thứ tự bắt buộc

1. Merge PR (FULL gate PASS: `security-reviewer` + `database-reviewer` + `silent-failure-hunter`).
2. Áp migration 0536 (dev-online → PROD). Không đổi dữ liệu.
3. **Dry-run** `GET /leave/admin/accrual/preview` trên dev-online → đối chiếu **245**.
4. Owner quyết 3 việc **cấu hình dữ liệu** (KHÔNG phải code, không nằm trong PR này):
   - **(a)** Bật `DEFAULT_ANNUAL.accrual_method = 'Monthly'` — đến đây engine mới cấp gì đó. Đây là công
     tắc: chưa bật thì merge PR = 0 thay đổi dữ liệu.
   - **(b)** `SICK` + `COMPENSATORY` đang `deduct_balance=true` mà **không có chính sách** (F2) ⇒ vẫn 422.
     Chọn một: đặt `deduct_balance=false` (khuyến nghị — nghỉ ốm ở VN theo BHXH, nghỉ bù phát sinh theo
     OT nên cấp tay), **hoặc** tạo chính sách `Manual` + `allow_negative_balance=true`.
   - **(c)** Hồ sơ `1136` thiếu `start_date` ⇒ HR điền; engine tự bù ở nhịp sau.
5. Dry-run trên PROD → cấp thật → đối chiếu lại `leave_balances`/sổ cái với preview.

---

## 8. Rủi ro & cách chặn

| Rủi ro                              | Mức        | Chặn                                                                                                |
| ----------------------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| Cấp đôi (cấp trùng = mất tiền thật) | **CAO**    | 3 lớp §3.4, lớp 3 ở DB; int-spec #1 + #2                                                            |
| Cấp cho người đã nghỉ việc          | CAO        | §3.1 điều kiện 5 (F1); unit #4 + int #4                                                             |
| Sổ cái lệch số dư do làm tròn       | TRUNG BÌNH | mốc cộng dồn §3.3; unit #7                                                                          |
| Bù nhầm nhiều năm (nợ phép ảo)      | CAO        | sàn cửa sổ §3.5; unit #9                                                                            |
| Rác `audit_logs` mỗi 60s            | TRUNG BÌNH | chỉ audit khi `granted>0`; int #9                                                                   |
| Rò tenant                           | **CAO**    | `withTenant` + `company_id` tường minh mọi truy vấn; int #5                                         |
| Job nuốt lỗi ⇒ "Success" vĩnh viễn  | TRUNG BÌNH | KHÔNG catch trong `run()` (JobRunner finalize `Failed`); lỗi 1 NV ⇒ đếm `failed`, không giả vờ xanh |
| Vỡ CHECK `used_days <= total_days`  | THẤP       | chỉ CỘNG `total_days`; int #7                                                                       |

---

## 9. Đối chiếu `done_when`

| #   | done_when                                                                  | Đáp ứng ở                                                   |
| --- | -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | RED trước + idempotent chứng minh bằng test, khoá (user, type, năm, tháng) | §6 unit + int #1/#2 · §3.4                                  |
| 2   | Cấp NGÀY CUỐI THÁNG, chỉ tháng đã kết thúc                                 | §3.1 đk 6 · §3.4 · unit #1                                  |
| 3   | Bù kỳ đã qua theo ngày vào làm; khớp preview                               | §3.1 đk 5 · §3.5 · **245** (§1.1 F1 — giải trình chênh 295) |
| 4   | Thiếu `start_date` ⇒ bỏ qua + báo cáo tường minh, bù được sau              | §3.1 đk 2 · unit #5 · int #6 · route preview                |
| 5   | Bật/tắt theo từng chính sách qua `accrual_method`                          | §3.2 · unit #6                                              |
| 6   | Sổ cái append-only + audit + `withTenant`                                  | §3.7 · int #3/#5/#9                                         |
| 7   | Dry-run lane DB → staging → PROD                                           | §6 int #4 · §7                                              |
| 8   | FULL gate PASS + coverage ≥80% engine                                      | §6                                                          |

---

## 10. Kết quả thi công (đo 2026-08-01, KHÔNG phải dự đoán)

### 10.1 Test

| Bộ                                                      | Kết quả                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| `leave-accrual.logic.spec.ts` (unit, không DB)          | **39/39 xanh**                                                     |
| `leave-accrual.int.spec.ts` (LANE_DB `mediaos_accrual`) | **22/22 xanh**                                                     |
| Toàn module `src/leave` trên lane DB                    | **320/320 xanh** (14 file)                                         |
| `@mediaos/contracts`                                    | 536/536 xanh                                                       |
| `@mediaos/app` (FE)                                     | 1504/1504 xanh (199 file)                                          |
| Coverage engine (4 file)                                | **100% stmts · 100% funcs · 91.42% branch** — mọi file ≥88% branch |

Route census: `ROUTE_CENSUS_WRITE=1` regen — 452→**453** route, 400→**401** gated, `ungated` GIỮ NGUYÊN 40
(route mới có gate, không mở lỗ mới).

### 10.2 Test có THẬT SỰ bắt lỗi không — 3 phép thử đột biến

Xanh không chứng minh gì nếu test không bắt được lỗi. Đã cố tình phá 3 chỗ rồi chạy lại:

| Đột biến                                                      | Kết quả                              |
| ------------------------------------------------------------- | ------------------------------------ |
| Nới điều kiện "kỳ đã kết thúc" (`to >= today` → `to > today`) | **1 test ĐỎ** (ca đứng đúng 31/07)   |
| Bỏ chặn `end_date` (`employedThroughPeriod` luôn true)        | **3 test ĐỎ** (cả 3 ca nghỉ việc)    |
| `DROP INDEX uq_leave_balance_tx_accrual_period` trên lane DB  | **1 test ĐỎ** (ca chèn tay trùng kỳ) |

Khôi phục cả 3 → xanh lại. Đặc biệt phép thử thứ ba chứng minh chốt idempotency đang được ép **ở tầng DB**,
không phải chỉ nhờ logic app cẩn thận.

### 10.3 Dry-run trên dữ liệu PROD (CHỈ ĐỌC, chạy chính `buildAccrualPlan` sắp ship)

Giả lập `DEFAULT_ANNUAL.accrual_method='Monthly'` (PROD thật vẫn `None` — chưa có gì đổi):

```text
hôm nay=2026-08-01 · quota=12.00 · hiệu lực từ 2020-01-01
NV quét     : 45
NV được cấp : 41
TỔNG NGÀY   : 245
phân bố     : {"7":30, "4":3, "3":3, "1":2, "5":2, "2":1}
bỏ qua      : {"MISSING_START_DATE": 1}   ← employee_code 1136
```

**245**, khớp chính xác con số §1.1 tính độc lập bằng SQL. Chênh 50 ngày so với preview 295 của WO đúng
bằng phần cấp cho người đã rời công ty. 3 hồ sơ còn lại (45 − 41 − 1) là người nghỉ việc trước 2026 ⇒ 0 kỳ
đủ điều kiện, **không** phải "bỏ qua vì dữ liệu hỏng" nên không nằm trong `skipped[]`.

### 10.4 Trạng thái PROD sau khi merge

Merge PR này **KHÔNG đổi một dòng dữ liệu nào**: `DEFAULT_ANNUAL.accrual_method` vẫn là `None`, engine
chạy mỗi 60 giây và trả `granted=0`. Công tắc nằm ở tay owner — §7 bước 4(a).
