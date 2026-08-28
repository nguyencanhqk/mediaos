# S10-CLEAN-WORKFLOWPARK-1 — DỌN bề mặt API của module `workflow/` (code PARK)

> Zone 🟡 yellow · gate **LIGHT** · KHÔNG chạm migration/schema/seed.
> Đo ngày **2026-08-27** trên `master` `08c8f7de`.

---

## 1. Đo TRƯỚC khi xoá (bắt buộc theo `done_when` #1)

### 1.1 Hộ tiêu thụ FE — RỖNG (đo lại, không tin grep cũ)

| Nơi đo | Lệnh | Kết quả |
| --- | --- | --- |
| `apps/app/src` · `apps/console/src` · `apps/auth/src` | grep đường dẫn `'/workflow'` | **0** |
| `apps/lms` (repo git riêng) | grep đường dẫn `'/workflow'` | **0** |
| `packages/**` (src) | grep đường dẫn `'/workflow'` | **0** (chỉ `packages/contracts/dist/**` = artifact build) |
| `scripts/` | grep đường dẫn `'/workflow'` | **0** (1 hit là `.github/workflows` — CHỮ KHÁC NGHĨA) |
| FE — grep **định danh** `workflow` (bẫy alias) | grep -i toàn FE | **0 chỗ gọi API.** Hit còn lại: 5 comment văn xuôi nói về `profile-change-request`, 1 hằng lỗi `TASK-ERR-WORKFLOW-INVALID` (module TASK), 2 nhãn i18n chết `nav.workflows` / `nav.workflowInstances` |

### 1.2 Hộ tiêu thụ BE — **KHÔNG rỗng** (lệch với mô tả WO, đây là phát hiện của phiên)

`apps/api/src/approval/` (ĐANG MOUNT) phụ thuộc module này:

- `approval.module.ts:5` `import { WorkflowModule }`
- `approval-multilevel.service.ts:11` `import { ApprovalService } from "../workflow/approval.service"`
- gọi đúng **2 method**: `finalApproval.approve()` (dòng 67) · `finalApproval.requestRevision()` (dòng 149)

⇒ **Xoá cả thư mục `workflow/` sẽ làm vỡ `approval/`.** Bản vá phải cắt theo đường ranh
"bề mặt API" chứ không theo đường ranh thư mục.

### 1.3 Số đo bề mặt

| Chỉ số | Trước |
| --- | --- |
| Route `/workflow/*` (`workflow.controller.ts`) | **13** |
| Route `/workflow-templates/*` (`workflow-templates.controller.ts`) | **17** |
| Census `param-uuid` TOÀN API | **37** = 24 (`workflow-templates.controller.ts`) + 12 (`workflow.controller.ts`) + 1 (`auth.controller.ts`, `skipped` có ý thức) |
| `UNPIPED_CEILING` | **37** |

---

## 2. PHẠM VI ĐÃ CHỌN (khai theo `done_when` #2)

**CHỌN: gỡ CODE + BỀ MẶT API. KHÔNG chạm schema · migration · seed permission.**

Lý do: bảng `workflow_*` có RLS + FORCE + GRANT; DROP bảng là việc của lane `db-migration`
(expand-contract, FULL gate) — WO này giữ LIGHT gate như `notes` đã định.

### 2.1 GỠ

| File | Vì sao gỡ được |
| --- | --- |
| `workflow.controller.ts` · `workflow.dto.ts` | 13 route, 0 hộ tiêu thụ |
| `workflow-templates.controller.ts` · `.dto.ts` · `.service.ts` · `.repository.ts` · `.types.ts` | 17 route; cả stack CHỈ được controller đó gọi |
| `workflow.service.ts` (876 dòng) | chỉ 2 controller trên gọi |
| `dag-validator.service.ts` · `dag-result.adapter.ts` (+ spec) | chỉ `workflow-templates.service.ts` gọi |
| spec đi kèm các file trên (`workflow-assign` · `workflow-dag` phần template · `dag-*`) | mất đối tượng test |
| `WorkflowModule` khỏi `app.module.ts` | không còn ai import trực tiếp ngoài `ApprovalModule` |

### 2.2 GIỮ (vì `approval/` đang sống)

`approval.service.ts` · `workflow-fsm.service.ts` · `workflow.repository.ts` ·
`lock-propagation.service.ts` · `workflow-dag.ts` · `workflow.types.ts`

`WorkflowModule` **vẫn tồn tại** nhưng thành **provider-only** (`controllers: []`), chỉ còn
`ApprovalModule` import. Bề mặt HTTP của nó = **0**.

### 2.3 ĐỂ LẠI cho WO sau — khai rõ để không ai tưởng đã dọn xong

1. **DROP bảng** `workflow_definitions` · `workflow_instances` · `workflow_steps` ·
   `workflow_templates*` · `defects` + gỡ seed permission `workflow.*` ⇒ lane `db-migration`, FULL gate.
2. `packages/contracts/src/workflow.ts` (DTO chết, còn export ở `index.ts:87`) — **NGOÀI `paths` của WO này**, không đụng.
3. Hai nhãn i18n chết `nav.workflows` · `nav.workflowInstances` (`packages/web-core`) — ngoài paths.
4. `workflow.repository.ts` còn method join bảng media (`content_items` · `projects`) mà chỉ
   `workflow.service.ts` gọi ⇒ sau khi gỡ service, các method đó thành code chết. Gỡ chúng ở WO dọn schema
   (cùng lượt với bảng) để bản vá này không phình.

---

## 3. Chống `review-gate-blind-to-deletions`

Build xanh KHÔNG chứng minh gì cho phần bị xoá. Ca test khẳng định:

- Spec mới `test/foundation/workflow-surface-removed.unit-spec.ts`: boot `AppModule` thật, dùng
  `collectRoutes()` (runtime, 0 regex, không cần Postgres) khẳng định **0 route** có path bắt đầu
  bằng `workflow` hoặc `workflow-templates`.
- Ca đối chứng trong cùng spec: route `/approval/*` **VẪN CÒN** — chứng minh bản vá cắt đúng đường
  ranh, không cắt nhầm module đang sống.

---

## 4. Kết quả đo được (đích hội tụ)

| Chỉ số | Trước | Sau |
| --- | --- | --- |
| Route toàn API | N | **N − 30** |
| Census `param-uuid` | 37 | **1** (chỉ còn `auth.controller.ts`, `skipped` có ý thức) |
| `UNPIPED_CEILING` | 37 | **1** |
| Dòng code `apps/api/src/workflow/` | 7250 | ~2600 |

⚠️ Trần tụt vì **DỌN**, KHÔNG phải vì vá — RELEASE-02 phải ghi rõ để người đọc sau không tưởng
36 route đó đã được đo bằng HTTP.
