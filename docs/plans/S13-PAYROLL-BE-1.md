# S13-PAYROLL-BE-1 — Kế hoạch thi công (micro-plan, **v2 sau plan-review vòng 1**)

> **WO:** `S13-PAYROLL-BE-1` · zone **red** · gate **FULL** · model **Opus**
> **Depends on:** `S13-PAYROLL-DB-1` (mig `0564`–`0566`, PR #455 — **đã merge** `63883624`)
> **Nguồn sự thật:** SPEC-11 §11/§12/§13/§15/§18 · API-18 §5/§6 · DB-13 · permission-matrix §9g
> **Ngày:** 2026-09-01 · **v2** = vá 8 blocker của `plan-reviewer` + 3 cổng tự đo + 2 quyết định owner

---

## 0. Đo hiện trạng (đo TRƯỚC khi viết, không suy từ tài liệu)

| # | Phép đo | Kết quả |
| --- | --- | --- |
| 0.1 | `apps/api/src/payroll/` | **KHÔNG tồn tại** — 0 route, 0 dòng `app.module.ts` |
| 0.2 | `apps/api/src/db/schema/payroll.ts` | **506 dòng, 7 bảng đủ** (DB-1 viết parity tay) — BE **không** sửa file này |
| 0.3 | `packages/contracts/src/payroll.ts` | **441 dòng** — enum + DTO đã có; **thiếu** nhiều hơn dự tính, xem §9 |
| 0.4 | Allowlist capability | `permission/permission.service.ts` — `SENSITIVE_CAPABILITY_ALLOWLIST` + `SENSITIVE_SCREEN_GATE_PAIRS`; test khoá `sensitive-screen-gate-allowlist.spec.ts` (regex `^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$` — **không** đòi cặp phải có route ⇒ khai sớm hợp lệ) |
| 0.5 | Ratchet route HTTP | `route-http-coverage.e2e-spec.ts:324-325` — `MAX_UNCOVERED_TOTAL = 0`, `MIN_COVERED_COUNT = 468` |
| 0.6 | `openapi-modules.ts` | chưa có PAYROLL ⇒ route lên mà thiếu mục = `UNCLASSIFIED_PREFIX` ⇒ `openapi-contract.e2e-spec` ĐỎ. Bất biến duy nhất: mỗi segment thuộc **đúng 1** module (`me` đã thuộc ME) |
| 0.7 | `leave_requests.status` CHECK (`0453`) | **UNION hoa/thường** ⇒ mọi vị từ đơn nghỉ PHẢI `IN ('approved','Approved')` |
| 0.8 | `attendance_records.status` CHECK | `'present','late','early_leave','absent','missing_checkin','pending_adjustment','approved_adjustment'` |
| 0.9 | `attendance_periods.status` CHECK | `'open','locked'` (chữ **thường**) |
| 0.10 | `companies.working_days_json` | `{"days":[1..7]}` (mig `0015`) — **khác** `work_schedules.working_days_json` là mảng trần (mig `0061`) |
| 0.11 | `public_holidays.company_id` | **NULLABLE** — lễ quốc gia `company_id IS NULL` (mig `0434`) |
| 0.12 | `param-uuid-ratchet.unit-spec.ts:67` | `UNPIPED_CEILING = 1`, và có ca **ĐẲNG THỨC** `=== 1` ⇒ **không còn chỗ**: mọi `:id` phải `ParseUUIDPipe` |
| 0.13 | `body-validation-ratchet.unit-spec.ts` | **0 offender** — `@UsePipes(ZodValidationPipe)` phải ở **cấp method** (`nestjs-zod-class-level-pipe-does-nothing`) |
| 0.14 | `identity-projection-verdicts.ts:650` | `BASIS_CEILINGS["identity-gated"] = 16`; ratchet đòi **mọi điểm chiếu có ĐÚNG một dòng phán quyết** |
| 0.15 | `route-guard-coverage.e2e-spec.ts:226-229` | `PermissionGuard` **KHÔNG** là APP_GUARD ⇒ `@RequirePermission` thiếu `@UseGuards` là **trang trí** |
| 0.16 | Trigger `enforce_bonus_penalty_freeze` (`0564`) | 5 nhánh dùng `RAISE EXCEPTION … USING ERRCODE='check_violation'` — **KHÔNG có `USING CONSTRAINT`** ⇒ `err.constraint` RỖNG |
| 0.17 | `vitest.config.ts:26` | `TWO_FACTOR_ENFORCEMENT_ENABLED: "false"` ⇒ 2FA của `payroll-officer` **vô hình trong int-spec** (PROD bật `true`) |
| 0.18 | Lane DB `mediaos_payrollbe1` (chain 0000→0566) | **17 cặp / 13 sensitive**; grant `employee 3 · payroll-officer 14 · company-admin 15 = 32`; `hr-manager` **0**; role `payroll-officer` `requires_two_factor=t, is_system=t, company_id NULL` ✓ |
| 0.19 | Khuôn gần nhất | `apps/api/src/recruit/**` (4201 dòng, 32 route, guard 2 tầng + census) |

---

## 0b. Quyết định OWNER (hỏi–đáp 2026-09-01, KHÔNG phải WO tự chế)

| # | Câu hỏi | Trả lời của owner |
| --- | --- | --- |
| **O1** | SPEC-11 §13.4 chốt 5 đại lượng nhưng để ngỏ **"bản ghi công HỢP LỆ"** — tử số pro-rate, quyết thẳng vào tiền | **`status IN ('present','late','early_leave','approved_adjustment')`** (loại `absent`, `missing_checkin`, `pending_adjustment`). Đi trễ/về sớm **vẫn tính đủ ngày công** vì đã bị trừ riêng qua `late_minutes` — trừ hai lần là sai |
| **O2** | Khẩu độ WO (18 route trong một WO) | **Giữ nguyên, không cắt BE-1b** |

> §13.4 SPEC cấm "WO BE tự phát minh" định nghĩa đầu vào — nên O1 **phải** là quyết định owner, không phải mục "nêu trong PR để owner thấy sau". Ghi lại nguyên văn ở đây; đổi định nghĩa sau = đổi số lương ⇒ lại là quyết định owner.

---

## 1. Quyết định thi công (chốt ở đây — WO sau KHÔNG tự phát minh)

| # | Quyết định | Lý do |
| --- | --- | --- |
| **B1** | **Ranh giới BE-1/BE-2 = 18/17 route.** BE-1: `001`–`006` · `019`–`028` · `034`–`035` | 18+17 = 35 ✓. Mọi route chở tiền của kỳ (`lines`/`summary`/`export`) và mọi route phiếu lương thuộc BE-2 ⇒ BE-1 **không chạm cặp `view-line`** |
| **B2** | **FSM viết ĐỦ ở BE-1** (cả 9 action, kể cả của BE-2), wire **chỉ `collect`** | BE-2 chỉ **gọi**, không mở lại file đã qua FULL gate |
| **B3** | **Đầu vào công/phép là REPOSITORY ĐỌC THUẦN dùng chung** `payroll-inputs.repository.ts`; BE-2 dùng LẠI y nguyên | Hai bản aggregation = hai định nghĩa tiền |
| **B4** | **Route GHI không chở tiền.** `collect` trả `{ id, status, affectedLines, warnings[] }`; `affectedLines` = **số NV đủ điều kiện** | SPEC-11 §11.1 — route ghi trả tiền = cửa sau cho role có `calculate` mà không `view-line` |
| **B5** | **`present_days` theo O1** — và tính bằng **MỘT `COUNT(DISTINCT date)` trên UNION** hai tập, KHÔNG cộng hai `COUNT` rời | *(vá blocker #7)* ngày vừa có công vừa có phép **nửa buổi có lương** nằm trong CẢ HAI tập ⇒ cộng rời là **+2 cho một ngày**, phồng tử số pro-rate. Clamp `LEAST(…,1)` của BE-2 chỉ che phần vượt trần, không che sai số của người vào/nghỉ giữa kỳ |
| **B6** | **Mọi vị từ đơn nghỉ dùng `status IN ('approved','Approved')`** | §0.7 — lọc một dạng là **mất trắng** một nửa dữ liệu, âm thầm |
| **B7** | **`PAYROLL_ROUTE_PAIRS` là bảng hằng NGUỒN SỰ THẬT DUY NHẤT** cho decorator · assert tầng 2 · sàn scope | Census so **cả hai tầng với bảng hằng**, không so tầng-với-tầng |
| **B8** | **Khai ĐỦ BA cờ cuối cùng cho CẢ 35 key ngay ở BE-1**: `isSensitive` · `companyFloor` · `objectGrantRequired` | *(vá blocker #4)* mặc định `companyFloor=true` sẽ **sai** cho 3 route `/me/payslips*` (scope **Own**, SPEC-11 §13.5) và `objectGrantRequired=false` là bắt buộc cho 2 cặp own-payslip (bẫy `0180`). Const viết **bây giờ** ⇒ phải đúng **bây giờ** |
| **B9** | **`isSensitive` truyền TƯỜNG MINH** — 13 cặp `true`, 4 cặp `false` | Thiếu cờ ⇒ wildcard `*:*` kế thừa cặp lương; thừa cờ ⇒ chặn oan |
| **B10** | **`PayrollPeopleRepository` là điểm chiếu danh tính DUY NHẤT** của `payroll/**`; `PAYROLL_PICKER_SCAN_CAP = 1000` | `identity-projection` ratchet; khuôn `RecruitPeopleRepository` |
| **B11** | **13 cặp sensitive vào CẢ HAI danh sách** allowlist ngay ở BE-1 | `capability-allowlist-hides-admin-screens` — lần lặp 11+. Chỉ là cờ HIỂN THỊ |
| **B12** | **Ratchet siết CÙNG COMMIT** — xem §11 (5 cổng, **không phải 3**) | `MAX_UNCOVERED_TOTAL = 0` là cổng chính |
| **B13** | **Không đụng `db/schema/payroll.ts`, không thêm migration** | DB-1 đã khoá schema |
| **B14** | `bonus_penalties`: **quyết định 011/013 ở SERVICE** sau `SELECT … FOR UPDATE` trên chính hàng đó, **TRƯỚC** câu UPDATE; DB chỉ là chốt cuối. Câu duyệt **không kèm sửa tiền** | *(vá blocker #6)* §0.16 — trigger `RAISE` không mang tên constraint ⇒ **không thể** map `23514` theo tên như SPEC-11 §12 làm với `four_eyes_check`. Không tiền-kiểm ở service = map mù = 500 vùng đỏ |
| **B15** | **Xoá mềm kỳ lương: KHÔNG có đường nào ở v1** — đo được: trong 35 route API-18 **không có route DELETE kỳ** nào | *(vá "thiếu sót" của review)* DB-1 bàn giao "cấm xoá mềm kỳ non-Draft chuyển lên service" (nhánh mất theo trigger `payroll_period_status_guard`). Đây là **no-op có chủ đích**, nhưng phải GHI phép đo — im lặng thì BE-2/FE tưởng đã có ai ép |
| **B16** | **`PATCH /payroll-periods/:id` (004) KHÔNG cho gỡ `attendancePeriodId` về NULL** — chỉ gắn/đổi sang UUID khác | `payroll_periods_calculated_needs_attendance_check` cho NULL ở `Draft`/`CollectingData`, nhưng cho gỡ thì `002` của BE-2 (kỳ công `locked`) mất nguồn kiểm ngay trước khi tính. Zod: `attendancePeriodId: z.string().uuid().optional()` — **không** `.nullable()` |
| **B17** | **Route PAYROLL sống kể cả khi `modules.is_active = false`** (module bật ở FE-1) | `module-is-active-is-not-a-gate` — cờ đó là hiển thị, không phải cổng. Ghi tường minh để không ai "sửa cho nhất quán" |

---

## 2. Phạm vi — 18 route

| Mã | Method + path | Cặp quyền | sensitive |
| --- | --- | --- | --- |
| 001 | `GET /payroll-periods` | `view:payroll-period` | false |
| 002 | `POST /payroll-periods` | `manage:payroll-period` | false |
| 003 | `GET /payroll-periods/:id` | `view:payroll-period` | false |
| 004 | `PATCH /payroll-periods/:id` | `manage:payroll-period` | false |
| 005 | `POST /payroll-periods/:id/collect` | `calculate:payroll-period` | **true** |
| 006 | `GET /payroll-periods/:id/readiness` | `calculate:payroll-period` | **true** |
| 019 | `GET /salary-profiles` | `view:salary-profile` | **true** |
| 020 | `POST /salary-profiles` | `manage:salary-profile` | **true** |
| 021 | `GET /salary-profiles/:id` | `view:salary-profile` | **true** |
| 022 | `PATCH /salary-profiles/:id` | `manage:salary-profile` | **true** |
| 023 | `GET /bonus-penalties` | `view:bonus-penalty` | **true** |
| 024 | `POST /bonus-penalties` | `manage:bonus-penalty` | **true** |
| 025 | `GET /bonus-penalties/:id` | `view:bonus-penalty` | **true** |
| 026 | `PATCH /bonus-penalties/:id` | `manage:bonus-penalty` | **true** |
| 027 | `POST /bonus-penalties/:id/approve` | `approve:bonus-penalty` | **true** |
| 028 | `POST /bonus-penalties/:id/reject` | `approve:bonus-penalty` | **true** |
| 034 | `GET /payroll/pickers/people` | `view:salary-profile` | **true** |
| 035 | `GET /payroll/pickers/attendance-periods` | `manage:payroll-period` | false |

> `@Idempotent()` trên `002` · `020` · `024`. `005` là POST **không tạo** (collect lại tại chỗ hợp lệ) ⇒ **không** gắn.
> `:id` khai **sau cùng** trong `PayrollPeriodsController` để BE-2 chèn `summary` lên trước mà không phải sửa thứ tự.

---

## 3. Cây file

```text
apps/api/src/payroll/
  payroll-route-pairs.const.ts   payroll.types.ts       payroll.errors.ts
  payroll-fsm.ts  payroll-fsm.spec.ts
  payroll-access.service.ts      payroll-people.repository.ts
  payroll-inputs.repository.ts   payroll-periods.repository.ts   payroll-periods.service.ts
  salary-profiles.repository.ts  salary-profiles.service.ts
  bonus-penalties.repository.ts  bonus-penalties.service.ts
  payroll.mapper.ts  payroll.mapper.spec.ts  payroll.dto.ts
  payroll.controllers.ts         payroll.module.ts
```

Sửa file có sẵn (append-only): `app.module.ts` · `config/openapi-modules.ts` · `permission/permission.service.ts` ·
`test/foundation/route-http-coverage.e2e-spec.ts` · **`test/foundation/identity-projection-verdicts.ts`** *(vá blocker #5)* ·
`packages/contracts/src/payroll.ts` · **`harness/backlog.mjs`** (chuyển 3 mục `done_when` sang BE-2 — §13).

---

## 4. Bảng hằng cặp quyền

```ts
const pair = (action, resourceType, isSensitive = false,
              companyFloor = true, objectGrantRequired = true) => ({…});
```

**Khai đủ 35 key với BA cờ cuối cùng** (B8). Ngoại lệ **duy nhất**, liệt kê đóng:

| key | companyFloor | objectGrantRequired | căn cứ |
| --- | --- | --- | --- |
| `mePayslipList` (031) | **false** | **false** | SPEC-11 §13.5 scope **Own**; §11.1 bẫy `0180` |
| `mePayslipDetail` (032) | **false** | **false** | idem |
| `mePayslipAck` (033) | **false** | **false** *(cặp `acknowledge-own-payslip`)* | idem |

*(3 route / 2 cặp — câu "3 cặp Own" ở v1 sai, đã sửa.)*

**Census 2 tầng** `payroll-two-layer-guard-census.unit-spec.ts` (khuôn recruit) — 5 ca:

1. tầng 1: metadata `@RequirePermission` từ app **đã boot** khớp bảng hằng;
2. tầng 2: AST `resolveActor(<expr>, "<key>")` map **`Class#method ↔ key`** (không chỉ "key xuất hiện ≥1 lần");
3. `PENDING_BE2 ∪ usedKeys === allKeys` **VÀ** `PENDING_BE2 ∩ usedKeys === ∅` *(vá cảnh báo)* — BE-2 nối dây một key mà quên gỡ khỏi danh sách là **ĐỎ**;
4. `{k | companyFloor === false}` **bằng đúng** `["mePayslipList","mePayslipDetail","mePayslipAck"]`;
5. `{k | objectGrantRequired === false}` **bằng đúng** 3 key trên (2 cặp).

---

## 5. FSM (`payroll-fsm.ts`) — **vá blocker #1 + #2**

```ts
export type PeriodStatus = "Draft"|"CollectingData"|"Calculated"|"Reviewing"|"Approved"|"Paid"|"Locked";
export type PeriodAction = "collect"|"calculate"|"submit"|"approve"|"reject"
                         | "generate-payslips"|"publish"|"lock"|"reopen";   // 9 — có generate-payslips
```

### 5.1 Bảng chuyển tiếp — LIỆT KÊ TƯỜNG MINH, không đếm tay

**10 chuyển tiếp đổi trạng thái** (`PERIOD_TRANSITIONS`):

| action | from | to |
| --- | --- | --- |
| `collect` | `Draft` | `CollectingData` |
| `calculate` | `CollectingData` | `Calculated` |
| `submit` | `Calculated` | `Reviewing` |
| `reject` | `Reviewing` | `Calculated` |
| `approve` | `Reviewing` | `Approved` |
| `publish` | `Approved` | `Paid` |
| `lock` | `Paid` | `Locked` |
| `reopen` | `Calculated` | `CollectingData` |
| `reopen` | `Reviewing` | `CollectingData` |
| `reopen` | `Approved` | `CollectingData` *(chỉ khi CHƯA sinh phiếu — §5.3)* |

**3 hành động TẠI CHỖ** (`IN_PLACE_ACTIONS`, đường chéo hợp lệ):
`collect` @ `CollectingData` · `calculate` @ `Calculated` · `generate-payslips` @ `Approved`.

> ⚠️ **SPEC tự mâu thuẫn:** văn xuôi §13.1 viết "**Hai** hành động chạy TẠI CHỖ" nhưng **bảng** §13.1 hàng `CollectingData` ghi "*(collect lại tại chỗ ✓)*". **BẢNG THẮNG** — vì `collect` lại là đường duy nhất làm mới cảnh báo `readiness` sau khi dữ liệu công/phép đổi, và cấm nó thì `Draft→CollectingData` chỉ đi được một lần. Ghi rõ ở đây để BE-2 không "sửa cho khớp văn xuôi".

⇒ **49 ô = 10 chuyển tiếp + 3 tại chỗ + 36 ô CẤM.** *(v1 viết "11 ✓ + 38 ✗" — sai cả hai số.)*

### 5.2 Bảng RESET vết duyệt — **9 hàng** (SPEC-11 §13.1)

| action | clear | set |
| --- | --- | --- |
| `collect` | `calculated_by/at` | — |
| `calculate` | `submitted_by/at` | `calculated_by/at` |
| `submit` | — | `submitted_by/at` |
| `reject` | `submitted_by/at` | — |
| `approve` | — | `approved_by/at` |
| **`generate-payslips`** | — | **`payslips_generated_by/at`** |
| `publish` | — | `published_by/at` |
| `lock` | — | `locked_by/at` |
| `reopen` | `calculated_by/at` · `submitted_by/at` · `approved_by/at` | `reopen_reason`, `updated_by/at` |

> Thiếu hàng `generate-payslips` (lỗi của v1) ⇒ BE-2 tự chế cặp ghi và ăn `23514` từ
> `payroll_periods_generated_pair_check` (`db/schema/payroll.ts:180-183`).
> `reopen` **không** clear `published_*`/`locked_*` — reopen bị chặn từ `Paid`/`Locked`; clear nhầm nổ
> `payroll_periods_published_pair_check`.

### 5.3 Cổng của `reopen` (dữ liệu ≠ điều kiện)

`TRAIL_RESET` chỉ nói **xoá gì**. Điều kiện **chặn** là việc riêng, BE-2 wire:
`payslips_generated_at IS NOT NULL` ⇒ **409 PAYROLL-ERR-004** `payslip-already-generated`, đọc **dưới row-lock
trên chính hàng kỳ** (KHÔNG đếm bảng `payslips`). BE-1 xuất hàm `assertReopenAllowed(period)` để BE-2 gọi.

### 5.4 `payroll-fsm.spec.ts` — 6 ca

(a) **10 ô chuyển tiếp** gọi đúng action **không ném** (ca ALLOW đối chứng — thiếu thì 36 ca DENY là **xanh rỗng**);
(b) **3 ô tại chỗ** không ném; (c) **36 ô cấm** ném `PAYROLL-ERR-001` kèm from/to;
(d) **suy ngược**: tập ô hợp lệ **tính từ** `PERIOD_TRANSITIONS ∪ IN_PLACE_ACTIONS` phải **bằng đúng** danh sách
liệt kê tay ở §5.1 — assert **hai chiều**, không so với một con số viết tay;
(e) `Object.keys(TRAIL_RESET)` **bằng đúng** `9 action` (thiếu/thừa đều đỏ), và mỗi hàng `clear ∩ set = ∅`;
(f) `reopen.clear` **đúng bằng** 3 cặp; `published_*`/`locked_*` **không** nằm trong.

---

## 6. Đầu vào công/phép (`payroll-inputs.repository.ts`)

`computeInputsTx(tx, companyId, periodMonth)` → một hàng/NV, **tất cả tính ở SQL**:

```text
work_days     = COUNT(ngày trong tháng có ISO-dow ∈ companies.working_days_json->'days')
                − COUNT(public_holidays thoả ĐỦ 4 vị từ)                  -- hằng CHUNG cả kỳ
present_days  = COUNT(DISTINCT d) trên UNION:                             -- B5, MỘT count
                  (ngày có bản ghi công hợp lệ theo O1)
                ∪ (ngày nghỉ CÓ LƯƠNG đã duyệt rơi trong kỳ)
paid/unpaid_leave_days = tách theo leave_types.paid                       -- B6
late_minutes  = SUM(late_minutes + early_leave_minutes)
```

Vị từ **chép nguyên văn** SPEC-11 §13.4:

```sql
jsonb_array_elements_text(c.working_days_json -> 'days')     -- KHÔNG phải work_schedules (§0.10)

WHERE (h.company_id = $companyId OR h.company_id IS NULL)    -- §0.11: lễ quốc gia company_id NULL
  AND h.status = 'Active' AND h.deleted_at IS NULL
  AND h.holiday_type <> 'WorkingDayOverride'                 -- ngày LÀM BÙ, trừ nó là trừ ngược
  AND h.is_paid_holiday = true
```

- **Biên kỳ cắt Ở BE theo tháng công ty** (UTC-at-rest; FE không có `companies.timezone`): `[月-01, 月-01 + 1 month)`.
- `work_days = 0` ⇒ repository trả `0`, **không** chia; service quyết (BE-2: 422 `009`).
- `snapshotMeta = { workingDaysJson, holidaysExcluded[], presentDaysRule }` — `presentDaysRule` ghi **nguyên văn O1**.
- **Chỉ ĐỌC**, 0 câu ghi; mọi câu bind `company_id` tường minh dù RLS đã đỡ.
- **Không phân trang, không trần** — khác picker (`SCAN_CAP = 1000`). Chấp nhận ở N=1, nêu tường minh; đo `EXPLAIN` trước khi mở PR (cùng lượt đo đường `023` lọc `bonus_penalties` theo `period_month`).

`readiness` (006) = `computeInputsTx` ⋈ hồ sơ lương hiệu lực tại **ngày cuối kỳ**:

| kind | điều kiện |
| --- | --- |
| `missing-salary-profile` | NV sống trong company, **không** có `salary_profiles` hiệu lực (`effective_date ≤ ngày cuối kỳ`, `deleted_at IS NULL`) |
| `missing-attendance` | có hồ sơ lương hiệu lực nhưng **0** ngày công hợp lệ [O1] trong kỳ |

`eligibleCount` = số NV có hồ sơ lương hiệu lực. Cảnh báo **mềm**, không chặn.
Tên người lấy qua `PayrollPeopleRepository.namesByUserIdsTx` (B10).

---

## 7. Masking + audit lượt đọc

- **Vắng khoá, không `null`/`0`** — spec mapper assert `"baseSalary" in dto === false` (khác `=== undefined`).
- **7 đường ĐỌC ghi audit atomic** (SPEC-11 §18): BE-1 giữ **2** (`019` · `021`); BE-2 giữ **5** (`lines` · `summary` · `payslips` · `payslips/:id` · `export`). *(v1 viết 3 + 4 — sai cả hai.)* `GET /me/payslips*` **KHÔNG** ghi audit đọc.
- Audit trong **cùng transaction** với lượt đọc (khuôn `hr-read.service`): rollback ⇒ 0 audit.
- `object_type` BE-1 chỉ dùng 3 giá trị: `payroll_period` · `salary_profile` · `bonus_penalty`.
- **Payload audit tuyệt đối không có số tiền**: `PATCH /salary-profiles/:id` ghi `{ effectiveDate, userId, changedFields:["baseSalary"] }` — **không** giá trị; `bonus_penalties` ghi `{ kind, periodMonth, userId, status }` — **không** `amount`.

---

## 8. Mã lỗi (`payroll.errors.ts`) — **vá blocker #6**

Khai đủ `001..017`; 9 mã của BE-2 nằm trong `PENDING_BE2` tường minh của `payroll-error-code-census.unit-spec.ts`.
Mã BE-1 ném thật: **001** · **008** · **010** · **011** · **012** · **013** · **014**.

**Luật bóc lỗi DB (ba điều, không hai):**

1. **`23505`** (unique) → `008` (kỳ trùng tháng) · `014` (hồ sơ lương trùng ngày) — phân biệt bằng tên constraint.
2. **`23514` CÓ tên constraint** → theo bản đồ SPEC-11 §12 (`four_eyes_check` → 005 · `lines_adjustment_check` → 400).
3. **`23514` KHÔNG tên constraint trên `bonus_penalties`** *(§0.16 — trigger `RAISE` không `USING CONSTRAINT`)* → **409 với mã CỐ ĐỊNH khai tường minh**, **tuyệt đối không 500**. Vì không phân biệt được nhánh (A)–(E) từ mã lỗi, **011/013 phải quyết ở SERVICE** dưới `SELECT … FOR UPDATE` trên chính hàng `bonus_penalties`, **TRƯỚC** câu UPDATE (B14) — trigger chỉ là chốt cuối cho race.

- `010` là **một thông điệp duy nhất** cho not-found / khác tenant / xoá mềm / ngoài scope.
- Vế hình thức chặn ở **Zod ⇒ 400**, không chiếm mã PAYROLL.
- **Trần Zod = trần service** cho `amount > 0` ⇒ **KHÔNG** cấp mã PAYROLL riêng cho `amount ≤ 0` (sẽ là mã chết).

---

## 9. Contracts bổ sung — **đo lại, thiếu nhiều hơn v1 ghi**

| Cần | Hiện trạng đo được |
| --- | --- |
| `payrollReadinessSchema` + `payrollReadinessWarningKindEnum` | **chưa có** |
| `payrollPeoplePickerQuerySchema` · `payrollPersonRefSchema` | **chưa có** |
| `payrollAttendancePeriodPickerQuerySchema` · `payrollAttendancePeriodRefSchema` | **chưa có** |
| `updateSalaryProfileSchema.delete` (xoá mềm, API-022) | **KHÔNG có** *(v1 viết "kiểm lại có" — nó không có)* |
| `payrollPeriodListQuerySchema`: `status[]` + `from,to` | chỉ có `status` **đơn** + `periodMonth` (SPEC-11 API-001 đòi cả ba) |
| `updateBonusPenaltySchema` đường xoá mềm (API-026) | **KHÔNG có** |
| `createPayrollPeriodSchema.attendancePeriodId` | kiểm **không** `.nullable()` (B16) |

`payrollWriteResultSchema.warnings` là **`string[]`** ⇒ `collect` trả **chuỗi tóm tắt** (`"missing-salary-profile: 3"`),
còn `readiness` trả **object có cấu trúc**. Hai hình dạng khác nhau là **cố ý**, ghi vào JSDoc.
Barrel `index.ts` **không đụng**.

---

## 10. Test — ĐÃ THI CÔNG (đo 2026-09-01, chạy trên lane `mediaos_payrollbe1`)

Unit **colocated** trong `src/payroll/`; int-spec ở `apps/api/test/integration/payroll-be1-*.int-spec.ts`
(census mã lỗi quét theo mẫu tên này). **Gộp còn 3 int-spec** thay vì 7 như bản v1 — cùng độ phủ, ít
boilerplate dựng tenant hơn (mỗi file dựng lại company + role + login là phần đắt nhất).

| Tệp | Ca | Nội dung |
| --- | --- | --- |
| `src/payroll/payroll-fsm.spec.ts` | 7 | ma trận **49 ô = 10 chuyển tiếp + 3 tại chỗ + 36 cấm**; suy ngược từ hằng (hai chiều); `TRAIL_RESET` đủ 9 action; `reopen` xoá đúng 3 cặp; cổng `assertReopenAllowed` cả hai `kind` |
| `src/payroll/payroll.mapper.spec.ts` | 5 | mask = **vắng khoá** (`"k" in dto === false` + JSON không chứa tên trường) kèm ca ALLOW đối chứng; DTO kỳ lương 0 khoá tiền |
| `src/payroll/payroll.errors.spec.ts` | 5 | **`23514` không tên constraint ⇒ 409** (ba hình dạng, kể cả bọc `.cause` của drizzle); `23505` theo tên; `lines_adjustment_check` ⇒ `null`; lỗi ngoài phổ ⇒ `null` (không nuốt) |
| `test/foundation/payroll-two-layer-guard-census.unit-spec.ts` | 8 | 18 route boot đúng · decorator ↔ bảng hằng · AST `Class#method ↔ key` · `PENDING_BE2` hai chiều · sàn scope · `objectGrantRequired` chỉ được `false` · 13 cặp sensitive |
| `test/foundation/payroll-error-code-census.unit-spec.ts` | 19 | mỗi mã: ném ⇒ có ca test, hoãn ⇒ trong `PENDING_BE2` (9 mã); mọi `kind` có ca |
| `test/integration/payroll-be1-scope.int-spec.ts` | 11 | ma trận A/B trên **18 route** (đủ quyền ⇒ 2xx · thiếu đúng một cặp ⇒ 403) · wildcard `*:*` ⇒ 403 trên cặp sensitive (+ ca đối chứng cặp không sensitive vẫn qua) · `hr-manager` 403 cả 18 route · cross-tenant/không tồn tại ⇒ **cùng một** 404 `010` · `:id` rác ⇒ 400 · masking |
| `test/integration/payroll-be1-errors.int-spec.ts` | 12 | `001` (PATCH + `collect`, có ALLOW đối chứng) · `008` · `010` · `011` · `012` · `013` (013 THẮNG 011 trên hàng đã consume) · `014` (+ tạo lại sau xoá mềm nhờ unique **partial**) · reject thiếu note ⇒ 400 · **đo trực tiếp**: trigger nổ `23514` với `constraint` RỖNG |
| `test/integration/payroll-be1-inputs-audit.int-spec.ts` | 16 | `work_days` 22 ngày · lễ **quốc gia** (`company_id IS NULL`) BỊ trừ · `WorkingDayOverride` KHÔNG bị trừ · lễ `Inactive`/`unpaid` không trừ · đơn nghỉ `'approved'` **và** `'Approved'` · `pending` không tính · phép không lương tách riêng · **ngày vừa có công vừa có phép có lương đếm 1** · 4 status công hợp lệ vs 3 status không · `late_minutes` · `work_days=0` không chia · readiness · **audit đọc atomic** (404 ⇒ 0 hàng) · audit 0 số tiền · `object_type` không có `payslip` |

**Tổng: 83 ca, xanh hết.** Chạy: `export LANE_DB=mediaos_payrollbe1` (+ `APP_DB_PASSWORD`/`WORKER_DB_PASSWORD`/`SUPERUSER_DB_PASSWORD`).

> ⚠️ **2FA của `payroll-officer` KHÔNG được int-spec chứng minh** (§0.17: `vitest.config.ts` ép
> `TWO_FACTOR_ENFORCEMENT_ENABLED="false"`). Đừng đọc bộ test này là bằng chứng đường 2FA chạy đúng.
>
> ⚠️ **Hàng lễ GLOBAL (`company_id IS NULL`) sống sót qua `cleanupTenants`** — helper đó dọn theo
> company. Spec `inputs-audit` tự dọn hai đầu theo tiền tố mã lễ riêng; đã chạy hai lần liên tiếp để
> chứng minh isolation (lần đầu viết thiếu thì ca `work_days` đỏ ở **lần chạy thứ hai**, không phải
> lần đầu — dạng đỏ khó truy nhất).

## 11. Cổng phải siết CÙNG COMMIT — **5 cổng**

1. `MIN_COVERED_COUNT` **468 → 486**. Khớp verb×path ở **cấp file** ⇒ hai path picker phải xuất hiện **nguyên văn** trong một file có `.get(`.
2. `ROUTE_CENSUS_WRITE=1 … route-guard-coverage.e2e-spec.ts` — regen **có chủ đích**, đọc diff từng dòng.
3. `openapi-modules.ts`: mục `PAYROLL`, `segments: ["payroll-periods","salary-profiles","bonus-penalties","payslips","payroll"]` (khai **cả** `payslips` cho BE-2).
4. `permission.service.ts`: 13 cặp vào **cả hai** danh sách (B11).
5. **`identity-projection-verdicts.ts`** *(vá blocker #5)*: 1 dòng verdict `payroll/payroll-people.repository.ts#namesByUserIdsTx:users.fullName`, basis `identity-gated`, lý do = cond thật từ cặp CỦA ROUTE theo `PAYROLL_ROUTE_PAIRS`, fail-closed `users.id = actor`; **`BASIS_CEILINGS["identity-gated"] 16 → 17`** kèm ghi chú như hai lần ROOM/RECRUIT.

Cộng thêm hai luật **cấp file** (không phải cổng riêng nhưng đỏ CI nếu quên):
`@Param("id", ParseUUIDPipe)` theo **method** (§0.12 — ceiling là ĐẲNG THỨC) · `@UseGuards(PermissionGuard)` khai
trên **mỗi route** (§0.15 — `@RequirePermission` một mình là trang trí) · `@UsePipes(ZodValidationPipe)` cấp
**method** (§0.13).

---

## 12. Rủi ro

| # | Rủi ro | Xử lý |
| --- | --- | --- |
| R1 | **Hai lịch làm việc** lệch nhau ⇒ tử số/mẫu số lệch có hệ thống | SPEC-11 §13.4 chốt lịch **cấp công ty**; QA có ca đối chứng. Công ty có **≥2** `work_schedules` khác nhau ⇒ **hỏi owner** |
| R2 | `leave_requests.status` UNION hoa/thường | B6 + ca test hai dạng |
| R3 | Định nghĩa `present_days` ảnh hưởng TIỀN | **Đã là quyết định owner O1**, ghi vào `input_snapshot_json.presentDaysRule`. Đổi sau = quyết định owner |
| R4 | 17 key + 9 mã khai sẵn cho BE-2 ⇒ census "xanh rỗng" | `PENDING_BE2` với assert **hai chiều** (§4 ca 3) |
| R5 | `readiness` quét toàn company mỗi lần gọi, không trần | Một câu set-based; đo `EXPLAIN` trước PR; chấp nhận ở N=1 |
| R6 | `bonus_penalties(payroll_period_id)` thiếu index dẫn đầu | Đường nhả consume là BE-2 — giữ bàn giao DB-1 §9.5; nhưng **đo `EXPLAIN` đường `023`** ở BE-1 (rẻ) |
| R7 | 2FA `payroll-officer` vô hình trong test (§0.17) | Ghi tường minh ở §10 — không đọc nhầm là đã phủ |

---

## 13. Bàn giao BE-2 — **và 3 mục phải chuyển vào `done_when` của BE-2 cùng commit**

*(vá blocker #3 — ba mục dưới nằm trong `done_when` của **BE-1** nhưng thuộc route của **BE-2**; `blocked`/`done_when` là cái chặn duy nhất máy đọc được, để rơi ra là không cổng nào bắt lại)*

| Mục (nguyên văn `done_when` BE-1) | Đích |
| --- | --- |
| "Calculated đòi `attendance_periods` locked (**409 PAYROLL-ERR-002**)" | `S13-PAYROLL-BE-2.done_when` — route `007` |
| "**recalc đầu vào khi nguồn đổi TRƯỚC duyệt**" | `S13-PAYROLL-BE-2.done_when` — `collect`/`calculate` lại tại chỗ |
| "reopen … **CHẶN khi `payslips_generated_at` đã set**" (đường vào trạng-thái-không-thoát, SPEC-11 §13.1) | `S13-PAYROLL-BE-2.done_when` — route `016`; BE-1 xuất `assertReopenAllowed()` (§5.3) |

Bàn giao khác:

- `objectGrantRequired = false` cho 2 cặp own-payslip **đã khai sẵn ở bảng hằng** (B8) — BE-2 chỉ việc đọc.
- `PayrollApproverReader` (bộ giải người-duyệt-hợp-lệ) — **một** bộ giải dùng chung cho `submit` (017) và NOTI-020.
- `payrollSummarySchema.totalGross/totalNet` khai `z.number()` nhưng **API-18 §6.3 vẽ CHUỖI** (`"512400000.00"`, để không mất chính xác qua JSON number) — **lệch hợp đồng chưa giải quyết**, BE-2 chốt cùng route `018`.
- Segment `me` cho `/me/payslips` thuộc module ME trong `openapi-modules.ts` — không xung đột, BE-2 kiểm lại.
- Index `bonus_penalties(payroll_period_id)`: đo `EXPLAIN` trên dữ liệu thật rồi quyết (DB-1 §9.5).
