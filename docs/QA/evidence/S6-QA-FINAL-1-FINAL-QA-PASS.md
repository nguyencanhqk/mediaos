# S6-QA-FINAL-1 — QA FINAL PASS (Sprint 6 · WS3)

> Sinh trong `S6-QA-FINAL-1`. Khung: `IMPLEMENTATION-09` §12 (§12.2 regression P0 · §12.3 theo vai ·
> §12.4 API · §12.5 UAT final · §12.6 điều kiện sign-off). Luật: **`RELEASE-05`** (3 tầng scope §2 ·
> thang `S0…S4` §5 · change-control §4 · 4 chặn RC §8.4).
> Nối tiếp `RELEASE-06` (WS2) · `S5-QA-REG-1-REGRESSION-SIGNOFF` · `S5-SEC-1-PERM-SCOPE-SUITE` ·
> `S5-UAT-1-UAT-KIT`.
> Chấm ngày **2026-07-26** trên `master` `c845a777` · migration head `0529` (197 file) ·
> DB cô lập `LANE_DB=mediaos_s6qafinal1`.

---

## 1. Cách đọc bảng

Giữ nguyên quy ước bằng chứng của `RELEASE-06` §1 để hai tài liệu ghép được:

| Ký hiệu | Nghĩa |
| --- | --- |
| **T** | Test **đã chạy xanh** ở §2 — ghi file spec (+ dòng / tên `it()` khi cần phân biệt) |
| **C** | Ràng buộc tĩnh trong code — ghi `đường/dẫn.ts:dòng` |
| **L** | Chỉ chứng minh được trên môi trường sống (UI/deploy) ⇒ **KHÔNG tick ở đây**, chuyển UAT Cycle 1 |
| **GAP** | Không có bằng chứng ⇒ vào §8 + sổ `RELEASE-02` |

Thêm một ký hiệu riêng của WS3, vì §12.4 hỏi về **API** chứ không hỏi về chức năng:

| Ký hiệu | Nghĩa |
| --- | --- |
| **T-svc** | Chỉ được phủ ở tầng **service/DB**, KHÔNG đi qua HTTP ⇒ guard · DTO · envelope của route đó **chưa từng chạy trong test** |

> Phân biệt này không phải bới lông tìm vết: `PermissionGuard` gắn **trên controller**, nên một luồng
> "xanh ở tầng service" **không** chứng minh route tương ứng có gác quyền.

---

## 2. Bằng chứng chạy

### 2.1 Backend (`@mediaos/api`) — Postgres thật, DB cô lập

`bash scripts/lane-db-setup.sh s6qafinal1` → `LANE_DB=mediaos_s6qafinal1` ⇒ deny-path / IDOR /
cross-tenant **thực thi thật** (không bị `describe.skipIf` bỏ qua).

**Cách chạy — đính chính so với `RELEASE-06` §2.** WS2 ghi "chia 6 chunk là chạy được". Lần này 6-chunk
**vẫn chết**: chunk `src/` (230 file) và cả chunk `test/foundation` (**20 file**) đều
`ERR_IPC_CHANNEL_CLOSED` (KI-014). Tách được **hai điều kiện** mà WS2 gộp làm một:

1. **`--no-file-parallelism` là bắt buộc, không phải tuỳ chọn.** Thiếu nó thì ngay cả 20 file cũng chết.
   Đây mới là vế chính — chia chunk mà vẫn để worker song song thì không cứu được.
2. Có cờ đó rồi, giới hạn còn lại phụ thuộc **độ nặng** của spec chứ không phải số file thuần: `apps/api`
   (mỗi file bootstrap một Nest app + pool Postgres) chết ở 230 file, chạy sạch ở 20; còn `apps/app`
   (jsdom, không DB) chạy **199 file trong MỘT tiến trình** vẫn sạch (§2.2) — **đính chính STAB-F04(a)**,
   vốn kết luận `@mediaos/app` cũng phải chia chunk.

⇒ Quy trình đo cho các WO Sprint 6 còn lại: **`--no-file-parallelism` ở mọi gói**, cộng **chunk 20 file
cho riêng `apps/api`**, tự chia đôi khi vẫn crash (§2.3).

| Gói | Cách chạy | File | Test | Kết quả |
| --- | --- | ---: | ---: | --- |
| `@mediaos/api` | 23 chunk × 20 file, `--no-file-parallelism` | **446** (445 pass · 1 skip) | **7.129** (7.113 pass · 15 skip · 1 todo) | ✅ **0 fail** |

Không chunk nào phải chia đôi ⇒ ngưỡng 20 file là ổn định. `1` file skip + `15` test skip là **có chủ
ý** (`pgbouncer-tenant-isolation` cần PgBouncer; gate `sessions` của `migration-smoke`), không phải
deny-path bị bỏ qua.

### 2.2 Frontend + package dùng chung

Cùng lần chạy, **một tiến trình mỗi gói**, `--no-file-parallelism`:

| Gói | File | Test | Kết quả |
| --- | ---: | ---: | --- |
| `@mediaos/app` | 199 | 1.502 | ✅ |
| `@mediaos/web-core` | 39 | 635 | ✅ |
| `@mediaos/contracts` | 32 | 536 | ✅ |
| `@mediaos/console` | 23 | 179 | ✅ |
| `@mediaos/ui` | 16 | 98 | ✅ |
| `@mediaos/auth` | 4 | 23 | ✅ |

**Tổng toàn workspace: 759 file spec · 10.102 test · 0 fail.**

### 2.2b Lint · typecheck · build

Chạy với **`TURBO_FORCE=1`** để loại khả năng turbo trả log cũ từ cache (xanh-giả):

| Bước | Tasks | Cached | Kết quả |
| --- | --- | --- | --- |
| `pnpm lint` | 7/7 | **0** | ✅ |
| `pnpm typecheck` | 10/10 | **0** | ✅ |
| `pnpm build` | 7/7 | **0** | ✅ |

### 2.3 Tái lập

```bash
bash scripts/lane-db-setup.sh s6qafinal1
export LANE_DB=mediaos_s6qafinal1
cd apps/api
# chunk 20 file, --no-file-parallelism (xem §2.1 vì sao cả hai đều bắt buộc)
npx vitest run <20 đường dẫn spec> --no-file-parallelism --reporter=basic
```

---

## 3. §12.2 — Bộ flow regression P0 (15 flow)

Mỗi ô "Bằng chứng" trỏ tới assertion **đã chạy trong §2**. Cột "Mắt xích yếu" ghi phần nào của chuỗi
**không** được test chạm — để người đọc biết chỗ nào còn phải nhìn bằng mắt ở UAT.

| Mã flow | Kết quả | Bằng chứng (T) | Mắt xích yếu / còn cần UI |
| --- | --- | --- | --- |
| **IMP09-REG-001** Login → Home Portal → mở app | ✅ | `qae2e1-full-journey.int-spec.ts:240` *"(1) đăng nhập → GET /foundation/modules/my-apps thấy đúng module theo quyền (Home Portal + App Switcher) → GET /auth/me xác nhận identity"* · `my-apps-canonical-role.int-spec.ts:124` *"AUTH (system app) ẨN cho employee + manager; HIỆN cho hr + company-admin"* · `:143` shape không lộ secret | Điều hướng thật của App Switcher = **L** (UAT-EMP-03/04) |
| **IMP09-REG-002** Employee check-in/check-out | ✅ | `qae2e1-full-journey.int-spec.ts:257` *"(2) mở workspace Chấm công → GET today → check-in → check-out"* · `attendance-be1.int.spec.ts:154` OFFICE_8H · `:212` check-in lần 2 → Conflict · `:302` đua 2 check-in đồng thời | — |
| **IMP09-REG-003** Employee tạo + gửi đơn nghỉ | ✅ | `leave-qa2-api.int-spec.ts:394` *"submit→approve ledger: RESERVE/RELEASE/USE balance_before/after continuous"* · `leave-noti-e2e.int-spec.ts:355` *"gửi đơn nghỉ → 1 notification cho direct manager"* | — |
| **IMP09-REG-004** Manager/HR duyệt đơn nghỉ | ✅ | `leave-approval.int.spec.ts:383` *"manager approve a direct-report's request (Team scope) → 200 Approved"* · `:465` ledger RELEASE+USE + event + audit · `leave-att-sync-qa2.int-spec.ts` full-day → ATT `Leave`/required=0, day `Synced` · `qae2e1:270` chuỗi đầy đủ tới `attendance_records.status = Leave` | — |
| **IMP09-REG-005** Chặn chấm công khi nghỉ cả ngày | ✅ | `attendance-leave-sync.int.spec.ts:316` *"approve full-day leave → attendance_records Leave/required=0, day Synced, audit written, **check-in blocked**"* | Nút bị disable + message trên UI = **L** (UAT-EMP-07) |
| **IMP09-REG-006** Employee gửi adjustment công | ✅ | `attendance-adjustment.int.spec.ts:269` *"employee creates own adjustment → Pending, employee_id resolved server-side"* · `:279` trùng (employee,date,type) → 409 · `att-noti-e2e.int-spec.ts:355` *"(1) đơn điều chỉnh công submit → 1 notification cho direct manager"* | — |
| **IMP09-REG-007** Manager/HR duyệt adjustment | ✅ | `attendance-adjustment.int.spec.ts:302` *"manager approves report's request → record Adjusted, logs appended (kept), items is_applied=true"* · `:485` cấm tự duyệt · `:521` 2 approve đồng thời → đúng 1×200 + 1×409 · `att-noti-e2e.int-spec.ts:370` chỉ requester nhận | Manager xem **chi tiết** đơn của cấp dưới: `:577` — xanh, nhãn `[BLOCKED]` cũ là chú thích chết (**QA-F02**, §8.2) |
| **IMP09-REG-008** HR tạo employee + link user | ✅ | `s2-int1-employee-user-provision.int-spec.ts:188` *"provision happy: create:employee + create:user → 201, hashed account + linked + BOTH audits"* · `:256` rollback không để user mồ côi · `:272` cross-company → 404 · `auth-hr-noti-e2e.int-spec.ts:254` 1 `AUTH_USER_CREATED` cho user mới | — |
| **IMP09-REG-009** Employee gửi yêu cầu sửa hồ sơ | ✅ | `profile-change-request.int-spec.ts` (RLS + append-only history) · `profile-change-request.controller.spec.ts:63/91` tầng HTTP (approve/reject) | Route `POST /hr/profile-change-requests` (tạo) = **T-svc** — xem §5.2 |
| **IMP09-REG-010** HR duyệt yêu cầu sửa hồ sơ | ✅ | `profile-change-request.int-spec.ts:320` *"approve applies every mapped field to employee_profiles (no silent drop of 10/13)"* · `:387` history + `is_sensitive` · `:639` approver thiếu `view-identity` → 403, **giữ Pending, employee KHÔNG đổi**, deny-audit persist | — |
| **IMP09-REG-011** Manager tạo project/task + giao việc | ✅ | `qae2e1-full-journey.int-spec.ts:302` *"(4) manager tạo task + giao cho employee → employee cập nhật trạng thái (My Tasks)"* · `task-noti-e2e.int-spec.ts:334` *"(1) TASK_ASSIGNED → 1 notification cho assignee mới, delivery_log Sent"* · `task-core.int-spec.ts:408/415` gate `create:task` | — |
| **IMP09-REG-012** Employee cập nhật task/comment/checklist | ✅ | `task-qa1-fsm-collab.int-spec.ts:392` nhảy cấp Todo→Done · `:430` checklist bắt buộc chưa tick → 400 · `task-comments-checklists.int-spec.ts:269` mention → outbox `TASK_MENTIONED` · `qa2-e2e-task-noti-dash.int-spec.ts:305` body điền thật, không còn placeholder | — |
| **IMP09-REG-013** Notification dropdown → deep link | ✅ | `my-notifications.int-spec.ts:302` unread=2/high=1 · `:313` mark-read giảm còn 1 · `:326` idempotent · `noti-deeplink-perm-lost.int-spec.ts:193/219` deep-link tới được khi còn quyền, **403 khi mất quyền** · `s5-noti-fix1-deeplink.int-spec.ts:189` `target_url = /tasks/{taskId}` | Điều hướng thật của dropdown = **L** (UAT-EMP-22) |
| **IMP09-REG-014** Dashboard theo vai trò | ✅ | `dashboard-resolver.int-spec.ts:208` no-role → 403 · `:230` employee đúng 5 widget · `:264` manager KHÔNG có `MY_TASKS` · `:297` HR ≠ Manager · `:333` cross-tenant không rò `HR_OVERVIEW` của B · `dashboard-widget-data.int-spec.ts:427` nguồn hỏng → `Degraded`, KHÔNG 500 | Quick-action điều hướng = **L** (giữ nguyên `RELEASE-06` §3.7 ô 4) |
| **IMP09-REG-015** Admin cấu hình role/permission | ✅ | `permission-admin.int-spec.ts:225` *"assignRole writes user_role + audit (RoleAssigned) + outbox permission.changed"* · `:215` cấm tự gán (SoD) · `:161` `*:*` KHÔNG kế thừa quyền sensitive · `permission-rule-apply.int-spec.ts:157/198/206` áp thật / chặn role hệ thống / cross-tenant → 404 · `rbac-operator-escalation.int-spec.ts:92` tenant admin KHÔNG gán được platform-admin | Quyền đổi **có hiệu lực ngay trên UI đang mở** = **L** |

**Kết quả §12.2: 15/15 flow P0 có bằng chứng backend đã chạy xanh.** 5 flow còn một mắt xích chỉ chứng
minh được trên UI (đánh **L**) — đã ánh xạ sang kịch bản UAT tương ứng, KHÔNG tự tick ở đây.

---

## 4. §12.3 — Regression theo role

| Role | Flow §12.3 | Kết quả | Bằng chứng |
| --- | --- | --- | --- |
| **Employee** | Login · Home Portal · dashboard cá nhân · check-in/out · bảng công cá nhân · tạo nghỉ · task của tôi · notification | ✅ | `qae2e1-full-journey` (7 bước, kể cả `(7)` deny-path 403/401) · `employees-rbac-scope.int-spec.ts:247` Own · `attendance-be2.int.spec.ts:254` my-records only own · `task-qa1-permission-matrix.int-spec.ts:451` ngoài Own → 404 fail-closed · `my-notifications.int-spec.ts:286` chỉ của mình |
| **Manager** | Dashboard quản lý · attendance team · duyệt leave · duyệt adjustment · task team/project · deep-link | ✅ | `dashboard-resolver.int-spec.ts:264` bộ widget Manager · `attendance-permission.int-spec.ts:278` team-records = reports ∪ self · `leave-approval.int.spec.ts:383` duyệt report / `:366` ngoài team → 403 · `attendance-adjustment.int.spec.ts:302` duyệt report / `:389` ngoài team → 403 · `task-qa1-permission-matrix.int-spec.ts:470/490` Team |
| **HR** | Employee list/detail · duyệt sửa hồ sơ · bảng công company/team · leave admin · dashboard HR · hợp đồng | ✅ | `employees-rbac-scope.int-spec.ts:271` Company, loại tenant B · `profile-change-request.int-spec.ts:622` duyệt request chạm `identity_number` · `attendance-permission.int-spec.ts:290` Company cả 2 team · `leave-qa2-api.int-spec.ts:374` company-wide balances · `dashboard-resolver.int-spec.ts:297` HR ≠ Manager · `hr-contract.int-spec.ts:371` |
| **Company Admin** | User/role/permission · company settings · module catalog · dashboard admin · audit log | ✅ | `admin-users-deny.int-spec.ts:249…319` (kể cả `*:*` KHÔNG lách sensitive) · `permission-admin.int-spec.ts` · `system-settings.int-spec.ts:189/272` · `module-toggle-permission-deny.int-spec.ts` · `dashboard-resolver.int-spec.ts:316` · `foundation-audit.e2e-spec.ts:3b` audit 200 + redact |
| **Super Admin** | System scope · tenant/module/system settings | ✅ (bounded N=1) | `employees-rbac-scope.int-spec.ts:287` *"System: super-admin scope thấy toàn bộ tenant (N=1 bounded tới tenant)"* · `foundation-audit.e2e-spec.ts:3d/3e/3f` biên audience operator: tenant token → **401**, thiếu `view:platform-audit` → **403**, có quyền → chéo tenant + `?companyId` khoanh đúng · `super-admin-bootstrap.int-spec.ts` |

> **Giới hạn đã biết (không phải lỗ hổng):** hệ chạy **N=1**, nên `System ≡ Company` tại runtime. Ô
> Super Admin chứng minh **biên phân tách** (audience + quyền `view:platform-audit`), không chứng minh
> được "thấy nhiều công ty" — điều đó chỉ có nghĩa khi bật multi-company (`S5-SEC-1-PERM-SCOPE-SUITE`
> chú giải ⁶).

---

## 5. §12.4 — API regression

### 5.1 Đo độ phủ thay vì tự chấm

`IMPLEMENTATION-09` §12.4 liệt kê 8 **nhóm** API và hỏi "đã kiểm chưa". Trả lời bằng cách tự chấm ✅ cho
8 dòng thì không kiểm chứng được. Thay vào đó **đo**: liệt kê route THẬT từ decorator NestJS trong
`apps/api/src/**/*.controller.ts` (**452 route** / **346 đường dẫn** phân biệt), rồi đối chiếu với mọi
URL literal xuất hiện trong **446 file spec** (`src/**/*.spec.ts` + `test/**/*.int-spec.ts|e2e-spec.ts`).

> **Giới hạn của phép đo, nói trước:** rất nhiều spec gọi qua helper (`authGet(token, url)`) nên **không
> lấy được HTTP method tại chỗ** ⇒ đo theo **đường dẫn**, không theo cặp (method, path). Kết luận rút ra
> là *"đường dẫn này có/không được test chạm tới"* — KHÔNG phải *"mọi method của nó đều được test"*.
> Con số dưới đây vì thế là **cận trên** của độ phủ.

| Nhóm §12.4 | Đường dẫn | Có test chạm | % | Chưa chạm |
| --- | ---: | ---: | ---: | ---: |
| AUTH | 47 | 27 | 57% | 20 |
| HR | 53 | 24 | 45% | 29 |
| ATT | 39 | 34 | 87% | 5 |
| LEAVE | 28 | 25 | 89% | 3 |
| TASK | 49 | 43 | 88% | 6 |
| NOTI | 16 | 14 | 88% | 2 |
| DASH | 16 | 16 | **100%** | 0 |
| FOUNDATION | 47 | 32 | 68% | 15 |
| *(ngoài §12.4 — ME/GOAL/workflow/approval…)* | 51 | 33 | 65% | 18 |
| **TỔNG** | **346** | **248** | **72%** | **98** |

### 5.2 98 đường dẫn chưa có test HTTP nào chạm — nguy hiểm tới đâu?

Hai câu hỏi khác nhau, phải tách:

**(a) Nó có bị bỏ ngỏ quyền không?** Không. Trong **134 route** (cặp method+path) chưa có test chạm,
chỉ **9 route** vừa không `@RequirePermission` vừa không `@Public()`. Toàn hệ có **35 route** như vậy, và
phần lớn là **self-scoped có chủ đích** (`/auth/2fa/*`, `/auth/sessions/*`, `/me/*`,
`/notifications/preferences`) hoặc thuộc `WorkflowController` của module CONTENT **đã park**
(de-media-fy) — đã nằm trong `MUTATION_BASELINE` của
[route-guard-coverage.e2e-spec.ts:57](apps/api/test/foundation/route-guard-coverage.e2e-spec.ts#L57), tức
đang bị một test **chặn hồi quy** chứ không phải không ai biết. Danh sách đầy đủ + phán quyết từng dòng
**thuộc `S6-SEC-1`** (WS4 §13.2 nhóm Authorization/RBAC), không kết luận ở đây.

**(b) Nó có được test không?** Nhiều chỗ **có**, nhưng ở **tầng service** — tức **T-svc**, guard/DTO/
envelope của route chưa từng chạy. Hai ví dụ đã mở file xác minh:

| Bề mặt | Trạng thái thật |
| --- | --- |
| `POST/GET /hr/profile-change-requests` (+ `/me`, `/:id`, `/:id/cancel`) | Luồng nghiệp vụ phủ **rất kỹ** ở tầng DB/service (`profile-change-request.int-spec.ts`), tầng HTTP chỉ có `profile-change-request.controller.spec.ts` cho **approve/reject**. Route **tạo** + **cancel** + **list** = **T-svc** |
| `/users/pending` · `/users/invite` · `/users/:id/approve` · `/reject` · `/suspend` · `/reactivate` · `/users/activation/accept` (`user-invites`) | `user-invites-flow.int-spec.ts` dựng **`UserInvitesService` trực tiếp** (`new UserInvitesService(...)`), KHÔNG qua HTTP ⇒ toàn bộ bề mặt HTTP của user-invites = **T-svc**. Ghi chú: đây là bề mặt user-admin **thứ ba** bên cạnh `/auth/users` và `/users/admin` |

⇒ Phát hiện **QA-F03** (§8.3).

### 5.3 Chấm 8 nhóm §12.4

| Nhóm | Kiểm gì (§12.4) | Kết quả | Ghi chú |
| --- | --- | --- | --- |
| AUTH | login/refresh/logout/me/permissions + admin user/role/permission | ✅ | Lõi phủ đầy (`auth.int-spec` · `auth-session` · `auth-logout` · `two-factor-login` · `permission-admin`). 57% là do **ba** bề mặt user-admin song song, xem §5.2(b) |
| HR | employee CRUD/status · my profile · profile change · department/position/contract | ⚠️ **có T-svc** | Nghiệp vụ ✅; `master-data`/`lookups`/`org/*`/profile-change **create** chưa qua HTTP |
| ATT | today · check-in/out · records · adjustment · manual adjustment · shift/rule · remote | ✅ | 87%; 5 đường dẫn còn lại là report/schedule/period-lock |
| LEAVE | balance · draft/submit/cancel · approve/reject · calendar · admin type/policy/balance | ✅ | 89% |
| TASK | project · member · task · assignee · status · kanban · comment · checklist · file · activity | ✅ | 88% |
| NOTI | dropdown · unread · list · detail · mark-read · template/event admin · internal event | ✅ | 88%; 2 chưa chạm là `/notifications/devices` (push — chưa dùng ở MVP) |
| DASH | me · by-type · widget data · config · cache refresh | ✅ | **100%** |
| FOUNDATION | settings · module catalog · files · audit logs · health | ⚠️ **có T-svc** | 68%; `settings/company`, `settings/mail-config`, `public-holidays`, `recycle-bin` chưa qua HTTP |

---

## 6. §12.5 — UAT final pass

**Trạng thái: CHƯA CHẠY ĐƯỢC — chặn bởi môi trường, không phải chất lượng code.**

| Điều kiện mở UAT final | Trạng thái |
| --- | --- |
| Bộ kịch bản theo vai (84 kịch bản / 4 vai) | ✅ `S5-UAT-1-UAT-KIT` §5 |
| Tài khoản UAT (`uat.employee/manager/hr/admin`, `sa@demo.local`) | ✅ có thật trong `mediaos_dev` |
| Dữ liệu UAT (hồ sơ nhân viên · quan hệ quản lý · số dư phép) | ✅ UAT-BLOCK-001/002 đã đóng 2026-07-26 |
| DB UAT ở đúng head | ✅ `mediaos_dev` 197/197 (UAT-BLOCK-003 đã đóng) |
| **Stack UAT `:3200` chạy** | ❌ **đang tắt** (đã kiểm: `GET localhost:3200/api/v1/health` không phản hồi; `:3100` PROD trả 200) |

Việc duy nhất còn thiếu là **bật stack UAT**, và nó **không phải thao tác vô hại**: `m dev-online` biên
dịch lại `apps/api/dist` mà **service PROD `:3100` đang dùng chung** (KI-016 / `RELEASE-05` §8.4 B4) ⇒
bật sai lệnh là **PROD login 500**. Đây là **quyết định của owner**, không phải việc QA tự làm:

- Đường an toàn hiện có: `m dev-online-fast` (không đụng `dist` PROD).
- Đường dứt điểm: tách `dist` (`S6-OPS-DISTSPLIT-1` — **chưa mở WO**).

**Cái WS3 làm được và đã làm thay cho UAT:** mọi kịch bản UAT có phần lõi kiểm chứng được ở tầng API đều
đã được phủ và ánh xạ ở §3–§4. Cái **không** thay thế được (và không được giả vờ là đã xong): điều hướng
UI, App Switcher, disable nút, quick-action, focus/responsive — **11 mắt xích `L`** trong §3.

---

## 7. §12.6 — Điều kiện UAT sign-off

| # | Điều kiện | Trạng thái | Căn cứ |
| --- | --- | --- | --- |
| 1 | 100% flow P0 pass | ⚠️ **một phần** | 15/15 flow P0 pass ở **tầng API** (§3). Pass ở **tầng nghiệp vụ/UI** chưa đo được — UAT Cycle 1 chưa chạy (§6) |
| 2 | Không còn P0/P1 (`S0`/`S1`) mở | ✅ | `RELEASE-02`: `S0 = 0` · `S1 = 0`. WS3 phát hiện thêm 1 mục `S1` (**QA-F01**) và **đã đóng trong WO** (§8.1) |
| 3 | P2 còn lại có workaround + stakeholder chấp nhận | ⚠️ **vượt ngưỡng** | `RELEASE-05` §5.3 cho **≤3** mục `S2` mở; WS2 để lại **5** (KI-008 · KI-011 · KI-014 · KI-016 · KI-021), WS3 thêm **QA-F03** ⇒ **6**. Mọi mục đều có workaround + chủ; cần owner đóng bớt hoặc **ký waiver tường minh** cho phần vượt |
| 4 | Dữ liệu test đủ đại diện | ✅ | `S5-UAT-1-UAT-KIT` §4 (14 hồ sơ · 7 phòng · 8 dự án · 34 việc · 38 thông báo · số dư phép 2026) |
| 5 | User guide / admin guide bản tối thiểu | ❌ **chưa** | `IMP09-IN-017` — thuộc `S6-GOLIVE-1` (WS10) |
| 6 | Release notes có known issues | ✅ | `RELEASE-03` + `RELEASE-02` (23 mục có mức/loại/workaround/chủ) |
| 7 | Stakeholder ký sign-off | ❌ **chưa** | Không ký được khi #1 chưa đo bằng UAT thật; mẫu ký sẵn ở `RELEASE-04` §5 + `UAT-KIT` §10 |

**Kết luận §12.6: chưa đạt sign-off.** 3 điều kiện chưa đạt (#1 một phần, #5, #7) + 1 vượt ngưỡng (#3).
**Không điều kiện nào chưa-đạt vì lỗi sản phẩm** — chúng chờ (a) bật môi trường UAT, (b) viết guide,
(c) chữ ký, (d) quyết định của owner về ngưỡng `S2`.

---

## 8. Phát hiện & triage WS3

Phân mức theo `RELEASE-05` §5 (`S0…S4`).

### 8.1 QA-F01 — `foundation-audit.e2e-spec` dùng `action` cố định + đếm tuyệt đối ở System scope ⇒ **ĐỎ-GIẢ vĩnh viễn**

| | |
| --- | --- |
| **Mức** | **S1** (High — chặn khả năng verify release) · Priority **P0** |
| **Loại CR** | **Operational fix** (`RELEASE-05` §4.1) — chỉ chạm `apps/api/test/**`, 0 dòng code sản phẩm |
| **Triệu chứng** | Lần chạy đầu (chunk crash giữa chừng) để lại 2 hàng `audit_logs`. Từ đó **mọi** lần chạy sau đều đỏ: `3f — Operator thấy audit CHÉO tenant` nhận `expected 2 to be 1`. Chạy một mình cũng đỏ ⇒ **không tự khỏi** |
| **Root cause** | `ACTION_A`/`ACTION_B` là **hằng cố định** (`BE3SecretLeakA/B`), còn 3f đọc ở **System scope** (chéo tenant, RLS không khoanh) và assert `length === 1`. `audit_logs` là **append-only** ⇒ hàng của lần chạy bị ngắt nằm lại vĩnh viễn trên DB lane |
| **Vì sao đáng sửa ngay** | Cùng lớp lỗi với STAB-F02/F03 (`RELEASE-06` §4.2/§4.3): đỏ **không** phản ánh chất lượng sản phẩm nhưng **chặn** mọi kết luận xanh của `S6-QA-FINAL-1`/`S6-SEC-1`/`S6-PERF-DB-1`. Tệ hơn STAB-F02 ở chỗ nó **không** biến mất khi chạy lại |
| **Fix** | [`apps/api/test/foundation/foundation-audit.e2e-spec.ts`](apps/api/test/foundation/foundation-audit.e2e-spec.ts) — gắn `RUN_TAG = randomUUID().slice(0,8)` vào `action`, **đúng idiom đã có** trong repo (`audit-permission-deny.int-spec.ts:66`), không phát minh cơ chế mới |
| **Verify** | Xoá 2 hàng mồ côi → chạy lại nguyên chunk `test/foundation`: **20/20 file · 157/157 test xanh**. Rồi chạy file đó **2 lần liên tiếp không dọn gì ở giữa**: 8/8 xanh cả hai lần, `SELECT count(*) … LIKE 'BE3SecretLeak%'` = **0** ⇒ chứng minh điều kiện gây lỗi cũ đã hết |
| **Trạng thái** | ✅ **Closed** |

### 8.2 QA-F02 — Nhãn `[BLOCKED — service.ts bug]` trên một test ĐANG XANH (chú thích chết)

| | |
| --- | --- |
| **Mức** | **S3** (Minor) · Priority **P3** · **KHÔNG phải defect sản phẩm** |
| **Loại CR** | **Operational fix** (`RELEASE-05` §4.1) — chỉ chạm `apps/api/src/attendance/*.int.spec.ts`, 0 dòng code sản phẩm |
| **Triệu chứng** | `attendance-adjustment.int.spec.ts` có một test tên *"GET /:id detail in scope: manager on report (Team) → 200 **[BLOCKED — see comment above, service.ts bug]**"*, phía trên là 9 dòng chú thích **KNOWN BROKEN** mô tả `detailInScope()` hard-code `orgUnitId: null, directManagerUserId: null` ⇒ Team scope luôn false ⇒ manager không mở được chi tiết đơn của cấp dưới |
| **Sự thật** | Test **đang XANH** trong suite §2, và bug **đã được sửa** — [attendance-adjustment.service.ts:696-715](apps/api/src/attendance/attendance-adjustment.service.ts#L696) nay nạp employee thật qua `resolveRequestEmployee()` (`findEmployeeScopeByIdTx` / `ByUserIdTx`) rồi mới `inScope()`. `git log -S resolveRequestEmployee` cho thấy fix nằm **trong CHÍNH commit đưa test vào**: `80a1bcd5` (PR #81, 2026-07-02). Chú thích viết lúc đang phát triển, quên gỡ khi fix cùng PR |
| **Vì sao vẫn ghi lại** | Đây đúng thứ mà WS3 tồn tại để chặn: một nhãn "KNOWN BROKEN" trên test XANH khiến người đọc kết luận ATT còn lỗi mở — phiên này suýt ghi nó thành `S2` **defer** trước khi mở file service ra đọc. Cùng bài học `wo-plans-built-on-code-comments`: **chú thích không phải bằng chứng, phải đọc code + git**. `RELEASE-06` §1 đã nói *"code đọc có vẻ đúng không phải bằng chứng"*; chiều ngược lại cũng đúng — *"code đọc có vẻ hỏng"* cũng không phải bằng chứng |
| **Fix** | Thay chú thích chết bằng ghi chú lịch sử (nêu rõ đã sửa ở commit nào) + bỏ nhãn `[BLOCKED]` khỏi tên test |
| **Verify** | Chạy lại `src/attendance/attendance-adjustment.int.spec.ts` — xem §8.4 |
| **Trạng thái** | ✅ **Closed** |

### 8.3 QA-F03 — Bề mặt HTTP chỉ được phủ ở tầng service (`T-svc`)

| | |
| --- | --- |
| **Mức** | **S2** (Major — rủi ro verify, không phải defect đã biểu hiện) · Priority **P2** |
| **Bằng chứng** | §5.1/§5.2 — **98/346 đường dẫn (28%)** không có bất kỳ test HTTP nào chạm. Hai bề mặt nghiệp vụ thật nằm trong đó: **profile-change create/cancel/list** và **toàn bộ user-invites** (`/users/pending`, `/users/invite`, `/users/:id/approve…`) |
| **Tác động** | Guard · `ZodValidationPipe` · response envelope của các route đó **chưa từng chạy trong test**. Một route mất `@RequirePermission` ở đây sẽ **không** làm đỏ suite (bắt được bởi `route-guard-coverage.e2e-spec.ts` **chỉ khi** controller đó đã có ít nhất 1 route gate) |
| **Giảm nhẹ đang có** | (a) sweep tĩnh `route-guard-coverage.e2e-spec.ts`; (b) chỉ **9/134** route chưa-test là không-gate, và đều thuộc nhóm self-scoped hoặc module đã park |
| **Quyết định** | **DEFER** sang sau MVP (thêm test = việc mới, `RELEASE-05` §4.2 chặn sau freeze). **Bàn giao cho `S6-SEC-1`** phần phán quyết 35 route không-`@RequirePermission` (WS4 §13.2). Vào sổ `RELEASE-02` |

### 8.4 Verify hai file test bị WO này sửa

WO chạm đúng **2 file, đều thuộc `apps/api/**/*.spec.ts`, 0 dòng code sản phẩm**:

```text
$ LANE_DB=mediaos_s6qafinal1 npx vitest run \
    src/attendance/attendance-adjustment.int.spec.ts \
    test/foundation/foundation-audit.e2e-spec.ts \
    --no-file-parallelism
  Test Files  2 passed (2)
       Tests  30 passed (30)
```

Điều kiện đóng bug (`IMPLEMENTATION-09` §11.4) cho QA-F01/QA-F02: link commit ✅ · môi trường verify ✅
(`LANE_DB=mediaos_s6qafinal1`, Postgres thật) · kết quả QA ✅ (30/30, và cả suite 7.113 ✅) · ghi chú
regression ✅ (**không** đổi code sản phẩm ⇒ không có regression module khác).

### 8.5 Đính chính KI-014 (không phải phát hiện mới, là đo lại)

`RELEASE-06` §4.4 kết luận "chia 6 chunk thì chạy được" và "`@mediaos/app` cũng phải chia chunk". Đo lại
thì **cả hai đều chưa chính xác**:

| Mô tả cũ (WS2) | Đo lại (WS3) |
| --- | --- |
| Chia chunk là đủ | **Không.** `--no-file-parallelism` mới là vế chính — thiếu nó thì chunk 20 file cũng chết |
| `@mediaos/app` phải chia chunk | **Không.** Có `--no-file-parallelism` thì 199 file chạy sạch trong **một** tiến trình |
| Giới hạn là "kích thước chunk" | Chính xác hơn: giới hạn theo **độ nặng** — spec `apps/api` bootstrap Nest + pool Postgres mỗi file (trần ~20), spec jsdom thì không |

Ghi lại để `S6-PERF-DB-1` / `S6-REL-1` không mất thời gian tái phát hiện, và để `S6-QA-CHUNK-1`
(chưa mở) biết đúng phạm vi phải sửa: **cơ chế worker song song**, không phải "chia nhỏ file".

---

## 9. Phân loại known issue còn lại (fix / defer / waiver)

| ID | Mức | Phân loại WS3 | Lý do |
| --- | --- | --- | --- |
| KI-008 chưa diễn tập restore | S2 | **FIX trước RC** | `RELEASE-05` §8.4 **B2** — chặn RC. Thuộc `S6-PERF-DB-1` (WS6) |
| KI-011 chưa có cảnh báo tự động | S2 | **FIX trước go-live** | Thuộc `S6-REL-1` (WS9 monitoring) |
| KI-014 crash suite 1 tiến trình (local) | S2 | **DEFER** (có workaround đo được — §2.1) | CI ubuntu không dính; chỉ chặn cổng local |
| KI-016 PROD dùng chung `dist` | S2 | **FIX trước RC** | `RELEASE-05` §8.4 **B4**; đang **chặn cả UAT Cycle 1** (§6) |
| KI-021 3 sự kiện NOTI của ATT không có producer | S2 | **DEFER** (đã quyết ở WS2) | Không chạm CF-P0/P1 |
| **QA-F03** bề mặt HTTP chỉ phủ tầng service | S2 | **DEFER** + bàn giao `S6-SEC-1` | Rủi ro verify, chưa biểu hiện thành defect |
| **QA-F02** nhãn `[BLOCKED]` trên test xanh | S3 | ✅ **đã fix trong WO** | Chú thích chết, không phải defect (§8.2) |
| KI-007 `Security / Dependency scan` đỏ | S3 | **FIX trước RC** | `RELEASE-05` §8.4 **B1** |
| KI-003/004/018/019/020 dữ liệu | S3 | **DEFER** (việc của Owner/HR) | Dữ liệu, không phải code |
| KI-005/009/010/013/015/017 | S3 | **DEFER** | Đã có workaround, không chạm P0/P1 |
| KI-006 LMS→NOTI | S3 | **FIX trước go-live** | Còn `LMS_NOTI_TOKEN` + deploy |
| KI-012 accepted-risk **D3** | S3 | **WAIVER — cần chữ ký owner** | Điều kiện `C4` của `RELEASE-01` §10 |

> **Ngưỡng `S2` (`RELEASE-05` §5.3: ≤3 mục mở) đang bị vượt: 6 mục.** WS2 báo 5, WS3 thêm **QA-F03**
> (QA-F01 mức `S1` và QA-F02 mức `S3` đều đã đóng trong WO nên không tính vào ngưỡng). Đây là
> **điều kiện chặn RC** phải xử lý ở `S6-REL-1` — hoặc đóng bớt (KI-008 · KI-016 nằm trong tầm), hoặc
> owner ký waiver cho phần vượt. Ghi thẳng thay vì hạ mức cho vừa ngưỡng.

---

## 10. Kết luận WS3

| Câu hỏi (`done_when` của WO) | Trả lời |
| --- | --- |
| Bộ flow regression P0 §12.2 xanh? | ✅ **15/15** ở tầng API, có cite assertion từng flow (§3). 5 flow còn mắt xích `L` chỉ UI mới chứng minh được — đã ánh xạ UAT, không tự tick |
| Regression theo role §12.3 xanh? | ✅ **5/5 vai** (§4), có giới hạn N=1 ghi rõ cho Super Admin |
| API regression §12.4 xanh? | ⚠️ **6/8 nhóm ✅ · 2 nhóm (HR · FOUNDATION) có `T-svc`**. Độ phủ đo được **72%** đường dẫn (§5) — con số **đo**, không tự chấm |
| E2E P0 full pass? | ✅ `qae2e1-full-journey` (7 bước xuyên AUTH→ATT→LEAVE→TASK→NOTI→DASH→logout→deny) + `qa2-e2e-task-noti-dash` + 4 bộ `*-noti-e2e` |
| UAT final pass §12.5? | ❌ **chưa chạy** — chặn bởi stack UAT `:3200` đang tắt + `dist` dùng chung với PROD (§6). Quyết định của owner |
| Điều kiện sign-off §12.6 đạt? | ❌ **chưa** — 3 chưa đạt + 1 vượt ngưỡng (§7); **không cái nào do lỗi sản phẩm** |
| Known issue phân loại rõ? | ✅ §9 — fix / defer / waiver cho **23 mục**, kèm mục nào chặn RC |
| `check.sh` xanh toàn workspace? | ⚠️ **không đạt theo nghĩa đen** (KI-014 — §2.1/§8.4). Bằng chứng thay thế đầy đủ hơn: **759 file spec · 10.102 test · 0 fail** (§2.1+§2.2) + `lint`/`typecheck`/`build` xanh với `TURBO_FORCE=1` (§2.2b, loại xanh-giả do cache) + CI ubuntu xanh trên PR |

**Còn `S0`/`S1` mở sau WO: 0.** (QA-F01 phát hiện + đóng trong chính WO này.)

> **WS3 xanh KHÔNG mở đường tới RC.** 4 chặn RC ở `RELEASE-05` §8.4 vẫn nguyên, và WS3 vừa siết thêm
> hai điều: **B3 (UAT Cycle 1) và B4 (`dist` dùng chung) là CÙNG một nút thắt** — không tách được
> `dist` thì không bật được UAT, không bật UAT thì không có chữ ký §12.6. Việc đáng làm sớm nhất của
> Sprint 6 vì thế là mở `S6-OPS-DISTSPLIT-1`, không phải viết thêm test.
