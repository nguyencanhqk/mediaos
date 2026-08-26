# S10-ATT-SHIFTASSIGNSCOPE-1 — hợp đồng `scope`↔`target` phải KHỚP CHECK của DB (KI-080)

> 🟡 Vùng vàng · LIGHT gate (`typescript-reviewer` + `quality-gate`). Không chạm permission/RLS/secret/migration.
> Plan viết sau khi ĐO BẰNG HTTP THẬT trên lane DB `mediaos_shiftassignscope` 2026-08-26
> ([[wo-plans-built-on-code-comments]]) — không dựng trên chú thích code.

## §0 — PHÁT BIỂU MỨC ĐỘ TRƯỚC (điều kiện nghiệm thu #1)

**Hỏng ĐÚNG CHIỀU AN TOÀN ⇒ KHÔNG phải lỗ bảo mật.** Đã chứng minh, không suy luận:

| Câu hỏi                             | Đo được (lane DB, 26/08)                                                                                    | Kết luận                         |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Request có ghi được hàng nào không? | `SELECT id FROM shift_assignments WHERE company_id=$1 AND shift_id=$2` ⇒ `rowCount = 0`                     | **KHÔNG** — DB chặn              |
| Ai chặn?                            | CHECK `chk_shift_assignments_target` nổ ở `ExecConstraints` (`execMain.c:2074`)                             | **Tầng DB**, không phải tầng app |
| Client nhận gì?                     | `500` + `error.code = SYSTEM-ERR-001`, `AttendanceShiftService.mapError` gói `InternalServerErrorException` | Sai hợp đồng                     |

⇒ Thiệt hại = **hợp đồng API sai** (đáng lẽ `400` ở biên) + **bơm 500 GIẢ vào giám sát**. Cùng LỚP với
KI-068, khác chỗ: đây không phải chuỗi rác mà là **TỔ HỢP FIELD hợp lệ từng cái nhưng mâu thuẫn nhau**.

## §1 — Nợ thật: refine kiểm MỘT chiều, CHECK kiểm HAI chiều

CHECK thật trên DB (`0452_s3_attdb1_att_core.sql:114`, mirror ở `db/schema/attendance.ts:143`):

```sql
(assignment_scope = 'Company'    AND department_id IS NULL     AND employee_id IS NULL)
OR (assignment_scope = 'Department' AND department_id IS NOT NULL AND employee_id IS NULL)
OR (assignment_scope = 'Employee'   AND employee_id   IS NOT NULL)
```

`createShiftAssignmentSchema` (`packages/contracts/src/attendance.ts:822`) chỉ phủ **một nửa** bảng dưới:

| Tổ hợp                                       | CHECK của DB | `.refine()` HÔM NAY | Kết quả HTTP hôm nay   |
| -------------------------------------------- | ------------ | ------------------- | ---------------------- |
| `Company` + không id                         | ✅ hợp lệ    | cho qua             | `201` ✅               |
| `Company` + `employeeId`                     | ❌ vi phạm   | **cho qua**         | **`500`** 🔴 (KI-080)  |
| `Company` + `departmentId`                   | ❌ vi phạm   | **cho qua**         | **`500`** 🔴 (cùng lỗ) |
| `Department` + không `departmentId`          | ❌ vi phạm   | CHẶN                | `400` ✅               |
| `Department` + `departmentId` + `employeeId` | ❌ vi phạm   | **cho qua**         | **`500`** 🔴 (cùng lỗ) |
| `Employee` + `employeeId`                    | ✅ hợp lệ    | cho qua             | `201` ✅               |
| `Employee` + không `employeeId`              | ❌ vi phạm   | CHẶN                | `400` ✅               |

**Payload gây lỗi là payload TỰ NHIÊN NHẤT** ("gán ca này cho nhân viên này" — quên `assignmentScope`,
mà schema `.default("Company")` điền hộ).

## §2 — Rà CÙNG LỚP (điều kiện nghiệm thu #5): ĐO, không đoán

Câu hỏi: _schema nào khác trong `packages/contracts` cũng chỉ kiểm MỘT chiều trong khi DB có CHECK
HAI chiều, và ĐI ĐƯỢC từ input của client?_ Quét mọi CHECK dạng "scope/level ↔ cột neo" trong
`apps/api/src/db/schema/**` rồi lần ngược về đường ghi:

| CHECK hai chiều của DB                                              | Đường GHI từ client                                                                                                                                                                | Ai kiểm chiều ngược                                                                                                                                     | Kết luận                                                     |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `chk_shift_assignments_target` (`attendance.ts:143`)                | `POST /attendance/shift-assignments` ← `createShiftAssignmentSchema`                                                                                                               | **KHÔNG AI**                                                                                                                                            | 🔴 **LỖ — KI-080, vá ở WO này**                              |
| `chk_attendance_rules_target` (`attendance.ts:217`)                 | `POST /attendance/rules` ← `createRuleSchema` (`attendance.ts:762`)                                                                                                                | **KHÔNG AI**                                                                                                                                            | 🔴 **LỖ Y HỆT — cùng file, cách 60 dòng, vá kèm**            |
| `chk_goals_level_anchor` (`goals.ts:102`, 4 nhánh)                  | `POST /goals` ← `createGoalSchema` (KHÔNG có `.refine()` nào)                                                                                                                      | `GoalsValidationService` (`goals-validation.service.ts:120-142`) kiểm **CẢ HAI** chiều: `need` phải có **VÀ** `extra` phải rỗng ⇒ `422 GOAL-ERR ANCHOR` | ✅ **SẠCH** — kiểm ở service thay vì contract, nhưng CÓ kiểm |
| `chk_dashboard_widget_configs_role_user_scope` (`dashboard.ts:157`) | **KHÔNG CÓ** — chỉ `PATCH /dashboard/configs/:id`, body `.strict()` KHÔNG chứa `config_scope`/`role_id`/`user_id`; hàng do `dashboard-config.seeder.ts` tạo (server-authoritative) | —                                                                                                                                                       | ✅ **KHÔNG VỚI TỚI ĐƯỢC** từ client                          |
| `finance.ts:84/140/232` (entry_kind · target_type)                  | module finance **park (out-of-scope)** — CLAUDE.md §1                                                                                                                              | —                                                                                                                                                       | ⬜ **KHÔNG đụng**                                            |
| `communication.ts:532/536` (call `accepted_at`/`ended_at`)          | FSM server-authoritative, client không gửi cột neo                                                                                                                                 | —                                                                                                                                                       | ✅ ngoài lớp này                                             |

⇒ **Đúng HAI chỗ có lỗ, cả hai nằm trong `paths` của WO này** — không có món nào phải cấp số KI mới.

`createRuleSchema` có **ĐÚNG CÙNG MỘT `.refine()`** (chép nguyên văn, chỉ đổi `assignmentScope`→`ruleScope`).
Vá một cái mà bỏ cái kia chính là cái bẫy "bản sao cách bản vá MỘT DÒNG" đã cho ra `S10-FND-PARAMUUID-1`.

**Bài học rút ra (ghi để lần sau đỡ đào lại):** cái phân biệt GOAL sạch với ATT hỏng KHÔNG phải "kiểm ở
contract hay ở service" mà là **có ai kiểm chiều NGƯỢC hay không**. GOAL kiểm ở service và sạch; ATT
kiểm ở contract nhưng chỉ một chiều nên hỏng.

## §3 — Bản vá: MIRROR CHECK 1:1 ở CONTRACT (không vá ở service)

Vá ở contract vì **FE dùng chung schema** — vá riêng ở service là để FE tiếp tục gửi sai.
Luật: **hợp đồng phải chặt ÍT NHẤT bằng CHECK của DB**, và mirror **đúng bảng chân trị của CHECK**,
không chặt hơn (nhánh `Employee` của CHECK KHÔNG cấm `department_id` ⇒ refine cũng không cấm).

`assignmentScope`/`ruleScope` giữ nguyên `.default(...)` — đổi default là đổi hợp đồng của mọi client
đang gửi đúng; cái sai là refine, không phải default.

## §4 — Kế toán ca test (chống xanh-RỖNG)

| Tầng                      | File                                                                | Ca                                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract (unit, không DB) | `packages/contracts/src/attendance-scope-target.spec.ts` (MỚI)      | phủ **TOÀN BỘ** bảng §1 cho cả hai schema: ALLOW + DENY từng nhánh                                                                                                                    |
| HTTP thật (int)           | `apps/api/test/integration/routehttp3-attendance-leave.int-spec.ts` | **LẬT** ca ghim KI-080 → `400` + `VALIDATION-ERR-001`; **THÊM** `Company`+`employeeId` (id THẬT) → `400`; **THÊM** `POST /attendance/rules` `ruleScope` khuyết + `employeeId` → `400` |

⚠️ **KHÔNG** nới assert thành `>= 400` — ca ghim phải ĐỎ với code cũ và XANH với code mới, không được
xanh với cả hai ([[tests-can-pin-a-hole-open]]).
⚠️ **GIỮ** ca ALLOW hiện có (`assignmentScope:'Employee'` + `employeeId` ⇒ 2xx và đọc lại được qua GET),
không có nó thì ca 400 là xanh-rỗng ([[deny-cases-vacuous-without-allow-case]]).
⚠️ Ca `Company`+`employeeId` dùng `empIdA` **THẬT** (không phải UUID ngẫu nhiên) để 400 không thể bị
nhầm là lỗi FK/không-tồn-tại — nó phải là 400 vì MÂU THUẪN scope↔target.

## §5 — Hộ tiêu thụ (điều kiện nghiệm thu: đổi 500→400 là đổi hành vi quan sát được)

Census `POST /attendance/shift-assignments` + `POST /attendance/rules` trên toàn cây:

| Hộ                                                 | Gửi gì                                                                       | Ảnh hưởng                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------- |
| `apps/app/.../ShiftAssignmentFormDialog.tsx:77-86` | **tự lọc id theo scope** (`scope==='Department' ? departmentId : undefined`) | **KHÔNG** — không bao giờ sinh tổ hợp mâu thuẫn |
| `att-core-tenant-deny.int-spec.ts:548`             | `Company` + không id                                                         | **KHÔNG**                                       |
| `attendance-shift.int.spec.ts:238/248`             | `Company` + không id                                                         | **KHÔNG**                                       |
| `routehttp3-…int-spec.ts:298` (ALLOW)              | `Employee` + `employeeId`                                                    | **KHÔNG**                                       |
| `attendance-shift.service.spec.ts:262/444`         | gọi THẲNG service (bỏ qua Zod)                                               | **KHÔNG**                                       |
| `apps/app/.../RuleFormDialog.tsx:117-118`          | **cũng tự lọc id theo scope** (cùng khuôn với dialog gán ca)                 | **KHÔNG**                                       |
| `routehttp3-…int-spec.ts:361`                      | `ruleScope:'Company'` + không id                                             | **KHÔNG**                                       |

⇒ Không hộ tiêu thụ nào đang dựa vào hành vi 500. Đổi an toàn.

## §6 — Việc phải làm

1. Vá `createShiftAssignmentSchema` + `createRuleSchema` — mirror CHECK 1:1.
2. Spec contract MỚI phủ trọn bảng chân trị.
3. Lật ca ghim + thêm 2 ca HTTP.
4. Rà cùng lớp — đã đo (§2): **không có món nào phải cấp số KI mới**.
5. RELEASE-02 đóng KI-080 kèm số đo trước/sau. `backlog.mjs` → done. `docs/plans/INDEX.md`.
