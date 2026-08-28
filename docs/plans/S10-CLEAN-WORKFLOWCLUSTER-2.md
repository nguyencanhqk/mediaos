# S10-CLEAN-WORKFLOWCLUSTER-2 — DỌN NỐT cụm `workflow/` + `approval/` (KI-082)

> Zone 🔴 red · gate **FULL** (`security-reviewer` + `database-reviewer` + `silent-failure-hunter`) · người chốt.
> Đo ngày **2026-08-28**. Nhánh xếp chồng trên `fix/s10-clean-workflowpark-1` (PR #429, xanh hết check, chờ review).

---

## 1. Đo TRƯỚC khi xoá (`done_when` #1 — census của WO trước chỉ đo `/workflow`, KHÔNG đo `/approval`)

### 1.1 Hộ tiêu thụ — RỖNG trên đủ tám chỗ

| Nơi đo | Cái đo | Kết quả |
| --- | --- | --- |
| `apps/api/src/**` | gọi `createInstance` · `createInstanceForTemplate` · `createApprovalRequest` | **0** (3 hit còn lại = ĐỊNH NGHĨA trong `workflow.repository.ts`) |
| `apps/app` · `apps/console` · `apps/auth` · `apps/fbpost` | đường dẫn `/approval` · `approval-request` · `approvalRequest` | **0 chỗ gọi API** |
| `apps/lms` (repo git RIÊNG) | `approval` · `workflow` trong `src/` | **0** |
| `scripts/` | `approval` · `workflow` | **0 chỗ chạy**; 1 file di sản `scripts/seed-workflow-definition.sql` (seed tay, không ai gọi) |
| `packages/*/src` | `ApprovalRequestDto` · `WorkflowInstanceDto` · `DefectDto` … | **0** (hit còn lại nằm ở `packages/contracts/dist/**` = artifact build) |
| `apps/api/src/**` ngoài `approval/` | `ApprovalMultilevelService` · `ApprovalRulesRepository` | **0** (`exports:` của module không ai import) |

⇒ Bằng chứng KI-082 giữ nguyên sau khi đo lại: `approval/` là bề mặt **CHẾT-THEO-DỮ-LIỆU**.

### 1.2 Số đo bề mặt HTTP (runtime, `collectRoutes()` trên `AppModule` ĐÃ BOOT)

| Chỉ số | Trước |
| --- | --- |
| Route `/approval/*` | **3** — `GET /approval/inbox` · `POST /approval/requests/:id/approve` · `POST /approval/requests/:id/reject` |
| `route-http-coverage` `MIN_COVERED_COUNT` | **471** |

> ⚠️ **ĐÍNH CHÍNH `src` của WO:** WO ghi *"`ApprovalInboxController` (5 route)"*. Đo runtime lúc RED
> ra **3**. Con số 5 không tái hiện được — dùng 3.

### 1.3 Số hàng trên DB `mediaos` (PROD + dev-online DÙNG CHUNG database này)

| Bảng | Hàng |
| --- | --- |
| `workflow_definitions` · `workflow_definition_steps` · `workflow_instances` · `workflow_steps` · `workflow_step_dependencies` · `workflow_step_checklist_states` · `workflow_step_instance_locks` · `step_transitions` · `checklists` · `checklist_items` · `approval_requests` · `approval_steps` · `approval_rules` · `defects` | **0 — tất cả 14 bảng** |
| `tasks` (bảng SỐNG) | 12 |
| `tasks` có `workflow_step_id` NOT NULL | **0** |
| `tasks` có `workflow_instance_id` NOT NULL | **0** |
| `tasks` có `task_type = 'workflow_step'` | **0** |

⇒ DROP là thao tác **KHÔNG chạm dữ liệu thật**. Đây là số đo quyết định cho phép gộp nửa migration
vào cùng PR thay vì hoãn sang WO khác.

### 1.4 Catalog quyền mồ côi sau khi gỡ

| `resource_type` | số cặp | tổng `role_permissions` |
| --- | --- | --- |
| `approval-request` | 8 | 26 |
| `workflow-instance` | 6 | 18 |
| `workflow-template` | 4 | 12 |
| `defect` | 2 | 6 |
| **Tổng** | **20 cặp** | **62 grant** |

---

## 2. PHÁT HIỆN của phiên — LỆCH với `src` của WO (đọc trước khi sửa)

1. **`apps/api/src/db/schema/workflow.ts` chứa LẪN bảng SỐNG của module TASK**: `tasks` ·
   `project_states` · `labels` · `task_labels` · `task_comments` · `task_attachments`.
   ⛔ KHÔNG được xoá cả file — chỉ gỡ đúng các khối bảng chết.
2. **DROP `workflow_steps`/`workflow_instances` bắt buộc chạm bảng SỐNG `tasks`**: phải gỡ FK + 2 cột
   `workflow_step_id` · `workflow_instance_id`, 2 index, và unique `tasks_dedup_key_uq`
   (neo trên `workflow_step_id`). An toàn vì 0 hàng, nhưng đây là **contract-phase trên bảng đang sống**
   ⇒ đúng lý do WO bắt FULL gate.
3. **`apps/api/test/workflow-lifecycle.e2e-spec.ts` (407 dòng) là di sản đợt 1 chưa dọn** — nó gọi
   `/workflow/*` (đã bị gỡ ở PARK-1) nên là test CHẾT, phải xoá ở đợt này.
4. `scripts/seed-workflow-definition.sql` — di sản seed tay, chết theo bảng.

---

## 3. PHẠM VI ĐÃ CHỌN (`done_when` #2 — TÁCH ĐÔI thành commit riêng, KHÔNG tách PR)

| Commit | Nội dung | Gate |
| --- | --- | --- |
| **(1) RED** | mở rộng `workflow-surface-removed.unit-spec.ts` — `approval` vào `REMOVED_CONTROLLER_PATHS`; **ĐỔI ca đối chứng (3) sang `leave/`** | — |
| **(2) CODE** | gỡ `approval/**` + phần còn lại `workflow/**` + contracts chết + i18n chết + test chết + census/ratchet/verdicts | LIGHT |
| **(3) MIGRATION** | DROP 14 bảng + gỡ 2 cột FK trên `tasks` + gỡ 20 cặp quyền; gỡ khối schema drizzle tương ứng | **FULL** |

### 3.1 Vì sao ca đối chứng (3) PHẢI đổi neo

Đợt 1 dùng `approval/` làm đối chứng ("module đang sống vẫn còn bề mặt") vì đường ranh bản vá đi
giữa nó và `workflow/`. Đợt 2 gỡ chính `approval/` ⇒ **giữ nguyên ca cũ thì spec tự mâu thuẫn**
(cùng một base path vừa phải còn vừa phải mất). Neo mới: `leave/` (SPEC-05, MVP lõi, không dính cụm).

### 3.2 Ratchet/census phải hạ theo — kèm LÝ DO bằng văn bản

- `route-http-coverage` `MIN_COVERED_COUNT` **471 → 468**: tử số và mẫu số tụt CÙNG 3.
  ⛔ `MAX_UNCOVERED_TOTAL = 0` **KHÔNG được nới** — tụt tổng mà uncovered > 0 là MẤT TEST.
- `param-uuid`: bỏ `"approval/"` khỏi `CLEAN_PREFIXES` (prefix trỏ code không còn file ⇒ ca lọc ra
  tập rỗng và xanh vĩnh viễn = ghim một lời hứa không ai đo — đúng luật đã ghi trong docblock cho
  `workflow/` ở đợt 1). Gỡ 2 dòng verdict `approval/approval-inbox.controller.ts#{approve,reject}:id`
  và mục file trong `PARAM_UUID_MEASURED_FILES`. `UNPIPED_CEILING` = 1 **KHÔNG đổi** (2 site bị gỡ
  vốn đã PIPED, không nằm trong trần).

---

## 4. Chống `review-gate-blind-to-deletions`

`ĐỎ đo được lúc RED` (2026-08-28): 3 route `/approval/*` sống, ca (2) bắt được
`ApprovalInboxController` còn đăng ký, ca (3) `leave/` XANH. Sau bản vá cả ba phải xanh vì lý do
NGƯỢC LẠI — không phải vì spec bị nới.

---

## 5. Đích hội tụ

| Chỉ số | Trước | Sau |
| --- | --- | --- |
| Route `/approval/*` | 3 | **0** |
| `MIN_COVERED_COUNT` | 471 | **468** (uncovered vẫn = 0) |
| Bảng cụm workflow/approval trên DB | 14 | **0** |
| Cột FK chết trên `tasks` | 2 | **0** |
| Cặp quyền mồ côi | 20 | **0** |
| Dòng code `apps/api/src/{workflow,approval}/` | ~2 600 + ~530 | **0** |

---

## 6. NGHIỆM THU nửa MIGRATION — số đo thật (2026-08-28)

Migration `0548_s10cleanworkflowcluster2_drop_workflow_approval_cluster.sql`, áp trên lane cô lập
`mediaos_wfcluster2` (chain-migrate 0000→latest).

| Kiểm | Kết quả |
| --- | --- |
| 14 bảng cụm còn lại | **0** |
| Cột chết trên `tasks` (`workflow_step_id`·`workflow_instance_id`) | **0** |
| `evaluation_results.workflow_step_id` · `bonus_penalties.defect_id` | **0** |
| Cặp quyền mồ côi · grant mồ côi | **0** · **0** (xoá 27 cặp + 89 grant) |
| `bonus_penalties_reference_check` sau DROP COLUMN | **CÒN** (dựng lại tường minh) |
| `bash harness/check.sh --lane-db=wfcluster2` | **XANH toàn phần** — 572/572 file API chạy, 0 đỏ |

### 6.1 BẪY — `DROP COLUMN` giết CHECK trong im lặng

Postgres gỡ luôn mọi `CHECK` tham chiếu cột bị xoá, không cảnh báo. Quét `pg_constraint` trên 3 bảng
bị chạm trước khi viết migration chỉ ra **đúng một nạn nhân**: `bonus_penalties_reference_check`
(bất biến "reference đúng-một-hoặc-không"). Migration nay DROP constraint → DROP cột → **DỰNG LẠI**
constraint không còn vế `defect`, và `packages/contracts/src/payroll.ts` mirror ĐÚNG BẰNG hai chiều
(hai enum `bonusSourceEnum`/`bonusReferenceTypeEnum` bỏ `"defect"`).

### 6.2 BA lỗi lộ ra khi chạy trên lane DB — phân loại bằng ĐO A/B, không bằng suy luận

| # | Triệu chứng | Do đâu | Xử lý |
| --- | --- | --- | --- |
| 1 | **364 test ĐỎ** | `cleanupTenants()` còn 10 lệnh `DELETE FROM <bảng đã DROP>`. Nó chạy trong `afterAll` của gần như MỌI int-spec ⇒ một dòng sót làm đỏ TOÀN BỘ suite tích hợp | Gỡ 10 lệnh. **Bài học: dọn bảng thì phải dọn cả đường DỌN DẸP của test** |
| 2 | `employee_contracts_employee_id_fkey` vỡ ở `DELETE users` — "Failed Suite" trong khi 24/24 test XANH | **LỖI CÓ SẴN, KHÔNG do WO này.** Chứng minh bằng đối chứng: lane **mới tinh head 0547** (không có `0548`) ĐỎ y hệt; lane cũ `mediaos_workflowpark` (cùng head 0547, đã dùng lâu) XANH ⇒ biến quyết định là **lane vừa chain-migrate**, không phải migration. Gốc: `DELETE users` phát ra ĐỒNG THỜI cascade (users→employee_profiles→employee_contracts) và SET NULL (`created_by`/`updated_by`/`deleted_by`); vế UPDATE chạy sau khi hàng cha đã mất ⇒ composite FK kiểm lại và ném 23503. Thứ tự hai luồng phụ thuộc thứ tự trigger RI | Xoá `employee_contracts` tường minh TRƯỚC `DELETE users`. Xanh trên **cả hai** lane |
| 3 | `evaluation_results_evaluator_user_id_fkey` vỡ ở `DELETE users` | **DO WO này.** Trước `0548`, hàng `evaluation_results` được dọn GIÁN TIẾP qua `workflow_step_id … ON DELETE CASCADE`. Gỡ cột ⇒ hàng ở lại chặn `DELETE users` | Dọn `evaluation_scores` + `evaluation_results` tường minh |

### 6.3 Ba ratchet hạ theo — mỗi lần hạ đều đo A/B hai lane

| Hằng số | Trước → Sau | Độ lệch giải thích được |
| --- | --- | --- |
| `FK_SINGLE_COL_PAIRS_FLOOR` | 440 → **423** | Đo `mediaos_wfcluster2` (0548) = 423 · đối chứng `mediaos_wfbase547` (0547, cũng mới tinh) = **459**. 459 − 423 = **36** = đúng phần DROP (14 bảng + 4 cột FK) |
| `PROVEN_WITH_CHECK_FLOOR` | 147 → **133** | 147 − 133 = **14** = ĐÚNG số bảng bị DROP, mỗi bảng là một mục registry tự chứng minh WITH CHECK. Khớp 1–1 |
| `W4_FK_BLOCKED_FLOOR` | 260 → **241** | Cặp thử 448 → 412 (**−36**, cùng con số trên); chứng minh bằng 23503 263 → 241 (**−22**) — 22 cặp trong 36 vốn thuộc nhóm "chứng minh bằng composite FK", 14 cặp còn lại vốn ở nhóm "chặn bằng cơ chế khác" |

⛔ Cả ba là **MẤT ĐỐI TƯỢNG ĐO**, không phải mất hàng rào. Đệm của `W4_FK_BLOCKED_FLOOR` nay = 0 theo
đúng luật đã ghi cho `PROVEN_WITH_CHECK_FLOOR`: hạ ĐÚNG số đo, không cộng biên.
