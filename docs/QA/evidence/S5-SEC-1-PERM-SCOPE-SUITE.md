# QA-PERM-001 — Suite phân quyền & data-scope tái dùng (S5-SEC-1)

> **Deliverable chính** của S5-SEC-1 (WS-E · crown) cho done_when #1 + #3. Ma trận §14.2 **5-scope ×
> 7-module** + checklist §14.3 + negative §14.4, **mỗi ô cite 1 assertion int-spec ĐANG CHẠY** (file +
> tên `it()` nguyên văn) hoặc N/A có lý do. Nguồn yêu cầu: IMPLEMENTATION-08 §14 · QA-05 ·
> `docs/permission-matrix-spec.md`.
>
> **Phạm vi corpus:** cả HAI glob spec mà `apps/api/vitest.config.ts:47` include —
> `test/**/*.int-spec.ts` (~210) **và** colocated `src/**/*.int.spec.ts` (41). Tất cả chạy trên Postgres
> THẬT, DB cô lập theo lane (`hasDb && LANE_DB`), qua chuỗi guard đầy đủ
> `JwtAuthGuard → CompanyGuard → PermissionGuard`.
>
> **Cách re-run suite này** (DB cô lập, KHÔNG chạm PROD `mediaos`):
> ```bash
> bash scripts/lane-db-setup.sh sec1
> DATABASE_URL=postgres://mediaos_app:changeme_app_only@localhost:5432/mediaos_sec1 \
> DATABASE_DIRECT_URL=postgres://mediaos:changeme_dev_only@localhost:5432/mediaos_sec1 \
> DATABASE_WORKER_URL=postgres://mediaos_worker:changeme_worker_only@localhost:5432/mediaos_sec1 \
> LANE_DB=mediaos_sec1 pnpm --filter @mediaos/api exec vitest run \
>   test/integration/me-qa1-idor-sweep.int-spec.ts \
>   test/integration/employees-rbac-scope.int-spec.ts \
>   test/integration/attendance-permission.int-spec.ts \
>   src/attendance/attendance-be2.int.spec.ts \
>   src/leave/leave-approval.int.spec.ts \
>   test/integration/task-qa1-permission-matrix.int-spec.ts \
>   test/integration/dashboard-widget-security.int-spec.ts \
>   test/integration/my-notifications.int-spec.ts \
>   test/integration/noti-deeplink-perm-lost.int-spec.ts \
>   src/employees/hr-export.int.spec.ts src/attendance/attendance-export.int.spec.ts
> ```

---

## 1. Kết luận

Bề mặt §14 (permission · data-scope · IDOR · file · **export** · masking · 3 bất biến) **đã được phủ**
bởi corpus 251 spec. Đợt S5-SEC-1 **thêm 1 test bịt lỗ duy nhất còn thật** (G1 · NEG-PERM-004 · deep-link
mất-quyền) và **không sửa `src` sản phẩm** (không migration/grant). Không ô nào trong ma trận lộ **thiếu
enforcement** — các ô trống đều là **N/A theo thiết kế** (giải thích §2), không cần WO mới.

---

## 2. Bảng A — Ma trận data-scope × module (§14.2)

Ký hiệu: **STRONG** = có assertion module-specific chứng minh cô lập actor theo scope · **N/A-DESIGN** =
scope không hợp lệ cho module theo thiết kế (giải thích tại chỗ) · **N=1** = single-company nên System≡Company
tại runtime.

| Scope \ Module | AUTH | HR | ATT | LEAVE | TASK | DASH | NOTI |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Own** | `me-qa1-idor-sweep.int-spec.ts:369` (IDOR sweep, owner từ token) | `employees-rbac-scope.int-spec.ts:247` (Own chỉ hồ sơ mình) | `attendance-be2.int.spec.ts:254` (my-records only own) | `leave-request.int.spec.ts:543` (me/requests/:id người khác→404) | `task-qa1-permission-matrix.int-spec.ts:569` (Own chỉ task mình) | `dashboard-widget-security.int-spec.ts:355` (S1 my-tasks Own) | `my-notifications.int-spec.ts:286` (list own; loại của A2/B) |
| **Team** | N/A-DESIGN¹ | `employees-rbac-scope.int-spec.ts:253` (Team=reports∪self) | `attendance-permission.int-spec.ts:278` + `attendance-be2.int.spec.ts:280` (team-records reports∪self) | `leave-approval.int.spec.ts:383` (approve report Team) + `:537` | `task-qa1-permission-matrix.int-spec.ts:582` (Team chỉ task trong team) | N/A-DESIGN² | N/A-DESIGN³ |
| **Department** | N/A-DESIGN¹ | `employees-rbac-scope.int-spec.ts:260` (Dept khác phòng→ẩn) + `employees-scope-int2.int-spec.ts:266` | N/A-DESIGN⁴ | N/A-DESIGN⁴ (+ HR-Company dept-filter `leave-approval.int.spec.ts:562`) | N/A-DESIGN⁵ | N/A-DESIGN² | N/A-DESIGN³ |
| **Company** | `admin-users-deny.int-spec.ts:385` (admin list) + `:332` (cross-tenant→404) | `employees-rbac-scope.int-spec.ts:271` (Company toàn tenant, loại tenant B) | `attendance-permission.int-spec.ts:290` (Company cả 2 team) + `:312` | `leave-qa2-api.int-spec.ts:374` (HR company-wide; loại tenant B) | `task-qa1-permission-matrix.int-spec.ts:592` (Company cả ngoài team) | `dashboard-widget-security.int-spec.ts:454` (cache company-wide + no PII) | RLS-tenant `notifications-noti-core-tenant-isolation.int-spec.ts:231` |
| **System** | N/A (N=1)⁶ | `employees-rbac-scope.int-spec.ts:287` (super-admin System, N=1) | N/A (N=1)⁶ | N/A (N=1)⁶ | N/A (N=1)⁶ | N/A (N=1)⁶ | N/A (N=1)⁶ |

**Chú giải N/A (theo thiết kế — KHÔNG phải thiếu test):**
1. **AUTH Team/Department** — quản trị user/role là **Company-only** (không có danh sách user cấp Team/Phòng). SPEC-02.
2. **DASH Team/Department** — DASH **gate hiển thị theo quyền widget; module NGUỒN ép data-scope**
   (`permission-matrix-spec.md §7`). Widget không tự data-scope theo Team/Dept; khác biệt chỉ ở **loại
   dashboard** (`dashboard-resolver.int-spec.ts:264`). Cô lập dữ liệu nguồn của widget đã chứng minh ở
   Own (`:355`) + Company (`:454`) + gate-trước-aggregate (`:530`).
3. **NOTI Team/Department** — notification là **recipient-Own tuyệt đối** (`my-notifications.repository.ts`
   filter cứng `recipient_user_id`); không có khái niệm Team/Dept scope. Cô lập Company = RLS tenant.
4. **ATT/LEAVE Department** — role đọc/duyệt của ATT/LEAVE **chỉ cấp Own/Team/Company**, KHÔNG có actor
   scope Department (ATT report-gate loại Own/Department/System —
   `apps/api/src/attendance/attendance-report.repository.ts:57`). `departmentId` chỉ là **bộ lọc cho
   viewer Company-scope** (`attendance-qa1-records-filters.int.spec.ts:327`; leave HR dept-filter
   `leave-approval.int.spec.ts:562`). Predicate Department generic vẫn được phủ ở tầng resolver
   (`data-scope-resolver.int-spec.ts:129`, fail-closed `:152`) — nhưng chỉ trên `employee_profiles`, nên
   KHÔNG dùng làm bằng chứng route ATT/LEAVE.
5. **TASK Department** — TASK dùng scope **Project** (không Department). Dept chỉ là bộ lọc danh sách dự án
   (`apps/api/src/tasks/projects-department-filter.int.spec.ts:140`). Project-scope: `task-project-role`.
6. **System scope** — hệ chạy **N=1 (single-company)** ⇒ System ≡ Company tại runtime; §14.2 ghi System
   "chỉ nếu MVP bật multi-company". Chỉ HR có assertion System tường minh (bounded về 1 tenant). Nếu bật
   multi-company về sau → mở lại các ô này (không phải nợ MVP).

> **Không ô nào lộ thiếu ENFORCEMENT.** Mọi N/A là lựa chọn thiết kế có neo spec/tài liệu, không phải lỗ hổng.

---

## 3. Bảng B — Checklist §14.3 (13 mục deny)

| # | Mục | Trạng thái | Spec (file : `it()`) |
| --- | --- | --- | --- |
| 1 | Employee không gọi API danh sách toàn công ty | COVERED | `employees-rbac-scope.int-spec.ts:247/355` · `dashboard-agg-routes-deny.int-spec.ts` (no-role→403) |
| 2 | Employee không duyệt đơn nghỉ | COVERED | `leave-approval.int.spec.ts:352` |
| 3 | Manager không duyệt đơn ngoài team | COVERED | `leave-approval.int.spec.ts:366` · `leave-qa2-api.int-spec.ts:341` (0 side-effect) |
| 4 | Manager không xem bảng công phòng khác nếu thiếu scope | COVERED | `attendance-be2.int.spec.ts:280/292` · `attendance-be6.int.spec.ts:267` · `attendance-permission.int-spec.ts:278` |
| 5 | HR Department không xem Company nếu không được cấp | COVERED | `employees-rbac-scope.int-spec.ts:260` · `employees-scope-int2.int-spec.ts:266` |
| 6 | Admin không xem field nhạy cảm HR nếu thiếu field-level perm | COVERED | `employees-salary-sensitive.int-spec.ts:245` (mask thiếu view-salary) · `:260` (wildcard `*:*` KHÔNG thoả sensitive) |
| 7 | Widget không trả dữ liệu nguồn nếu thiếu quyền module nguồn | COVERED | `dashboard-widget-security.int-spec.ts:530` (thiếu `read:project`⇒403, `listByProject` KHÔNG gọi — gate TRƯỚC aggregate) · `dashboard-widget-catalog2-security.int-spec.ts` (403/slug) |
| 8 | Notification chỉ trả của recipient hiện tại | COVERED | `my-notifications.int-spec.ts:286/241` · `noti-qa-permission.int-spec.ts` |
| 9 | Deep-link notification vẫn bị guard nếu mất quyền | **COVERED (MỚI)** | `noti-deeplink-perm-lost.int-spec.ts` (G1 — §4) |
| 10 | File private không tải được nếu thiếu quyền record gốc | COVERED | `foundation/files/file-access-hardening.int.spec.ts:397` · `employee-file.int-spec.ts:250` · `task-files-access.int-spec.ts:481` |
| 11 | Audit log chỉ xem được bởi user có quyền | COVERED | `foundation/audit-permission-deny.int-spec.ts:162/181/202/213/223` |
| 12 | Frontend không hard-code theo role name | N/A (FE) | Ngoài phạm vi API. Analog API: `audit-permission-deny.int-spec.ts` (my-apps lọc theo quyền, không role-name) |
| 13 | Backend không tin `company_id`/`employee_id`/`user_id` từ FE | COVERED | `me-qa1-idor-sweep.int-spec.ts:369-405` (tamper param bị bỏ qua; PATCH strict 400; owner từ token) |

---

## 4. Bảng C — Negative test §14.4 (NEG-PERM-001..006)

| Mã | Kịch bản | Kỳ vọng | Trạng thái | Spec |
| --- | --- | --- | --- | --- |
| NEG-PERM-001 | Employee gọi approve leave | 403 | COVERED | `leave-approval.int.spec.ts:352` |
| NEG-PERM-002 | Manager đổi request ngoài team | 403/404 | COVERED | `leave-approval.int.spec.ts:366` (403) · `task-qa1-permission-matrix.int-spec.ts:490` (404) · `employees-scope-int2.int-spec.ts:241` (404) |
| NEG-PERM-003 | Employee mở admin users trực tiếp | API 403 | COVERED | `admin-users-deny.int-spec.ts:249` (+ `:256/264/275/295`) |
| NEG-PERM-004 | Click notification target đã mất quyền | Module forbidden | **COVERED (MỚI — G1)** | `noti-deeplink-perm-lost.int-spec.ts` |
| NEG-PERM-005 | HR Department gọi dashboard Company overview | 403 hoặc scoped đúng | **DOCUMENTED (accepted-risk)** | Masking/tier: `dashboard-agg-routes-deny.int-spec.ts:293` · `dashboard-widget-security.int-spec.ts:416`. Xem QA-SEC-001 §accepted-risk (D3). |
| NEG-PERM-006 | Tải file hồ sơ ngoài scope | 403 | COVERED | `foundation/files/file-access-hardening.int.spec.ts:397` · `task-files-access.int-spec.ts:481` |

---

## 5. Field-level & Export permission (done_when #2)

Export **CÓ tồn tại + đã test** (đính chính khảo sát vòng-1 nói "N/A"): dữ liệu nhạy cảm KHÔNG lộ qua export.

| Endpoint | Gate | Bảo vệ | Spec |
| --- | --- | --- | --- |
| `GET /attendance/records/export` (CSV) | `export:attendance` (sensitive) | data-scope Own/Team/Company + row-cap 422 + CSV-injection neutralize + append-only audit | `attendance-export.int.spec.ts:210` (403 fail-closed) |
| `GET /hr/employees/export` (CSV) | `export:employee` (**sensitive**) | per-row PII mask + **salary & CCCD/identity FORCED NULL** (`hr-export.service.ts:168/170`) + scope + row-cap 422 + audit | `hr-export.int.spec.ts:181` (403 fail-closed; view-sensitive present→PII/absent→blank; injection) |
| `GET /leave/reports` (JSON) | `export:leave` (Company-only) | scope Company + tier mask | `leave-be6.int.spec.ts:317` (403 deny) |

Field-level (list/detail): `employees-salary-sensitive.int-spec.ts:245/260` (mask + wildcard-no-inherit).
Dashboard cache no-PII: `dashboard-widget-security.int-spec.ts:454`. Notification payload no-secret:
`me-qa1-idor-sweep.int-spec.ts:211-214,580-604` + G1 `assertNoSecrets`.

---

## 6. G1 — bằng chứng RED → GREEN (NEG-PERM-004, deep-link mất-quyền)

File: [`apps/api/test/integration/noti-deeplink-perm-lost.int-spec.ts`](../../../apps/api/test/integration/noti-deeplink-perm-lost.int-spec.ts).
Chạy trên DB cô lập `mediaos_sec1`.

- **GREEN (thật):** 6/6 pass. BASELINE (còn `read:task`): `GET /tasks/:id` → **200** (deep-link tới được);
  notification list/detail thấy `target_url`. REVOKE `read:task` (xoá user_role): `GET /tasks/:id` → **403**
  (module guard chặn dù deep-link hợp lệ); notification **VẪN** list/đọc được (own-scope `read:notification`
  còn) + `assertNoSecrets`.
- **RED-demo (chứng minh có ý nghĩa, KHÔNG commit):** tạm bỏ bước revoke trong arrange-block → assertion
  "`GET /tasks/:id` → 403" **ĐỎ** (nhận **200** vì `read:task` còn) ⇒ chứng minh 403 đến TỪ việc mất quyền,
  không phải luôn-403. Đã hoàn nguyên revoke; KHÔNG sửa `src`/guard/seed/helper chung.

---

## 7. Bất biến

Đợt này **không** migration/grant/đụng `src` sản phẩm ⇒ #1 RLS · #2 append-only · #3 no-secret **không suy
yếu**; G1 chỉ **củng cố** bằng chứng (assert notification không mất + không rò secret khi mất quyền nguồn).
Fixture không dùng literal high-entropy (né gitleaks `generic-api-key`).
