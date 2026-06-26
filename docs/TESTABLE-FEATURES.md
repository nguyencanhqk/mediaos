# Chức năng đã hoàn thành & test thực tế được — MediaOS

> **Ảnh chụp tại:** 2026-06-26 · **Mốc:** kết thúc Sprint 2 (commit `49ef4dc`)
> **Mục đích:** liệt kê đúng những gì **đã build · đã review/gate · đã merge vào `master`** và **bấm thử được ngay** (qua API hoặc UI). Dùng cho QA/UAT, demo, smoke test.
> **Không phải** roadmap. Nguồn việc còn lại: `docs/STATUS.md` + `harness/backlog.mjs`. Nghiệp vụ chi tiết: `docs/spec/`.

---

## 0. Tóm tắt 30 giây

| Module | Trạng thái | Test được? |
| --- | --- | --- |
| **AUTH** — đăng nhập, 2FA, đổi/quên mật khẩu, quản trị user, role/permission | ✅ Hoàn thành (v2) | **Có** — API + UI login |
| **HR** — hồ sơ nhân viên (CRUD), masking lương/PII, đổi trạng thái, link user, phòng ban, master-data, yêu cầu đổi hồ sơ, thùng rác | ✅ Hoàn thành (v2) | **Có** — API + UI (apps/app) |
| **Foundation** — audit log, cấu hình công ty/settings, file, ngày nghỉ lễ, catalog module | ✅ Hoàn thành (v2) | **Có** — API |
| ATT · LEAVE · TASK · DASH · NOTI · workflow · api-keys · webhooks … | ⚠️ **PARK (hướng cũ, out-of-scope)** | **Không** (xem §5) |

> ⚠️ **Đọc kỹ §5 trước khi test.** Cây code vẫn còn nhiều controller/màn hình của hướng cũ (media/operator-plane). Chúng *có thể phản hồi* nhưng **không nằm trong phạm vi v2, chưa verify, chưa seed quyền đầy đủ** → **đừng test, đừng báo lỗi** cho nhóm này.

---

## 1. Cách dựng môi trường & đăng nhập để test

### 1.1 Khởi động (local)

```bash
pnpm install
pnpm db:up                 # Postgres + PgBouncer + Valkey + MinIO (cần Docker)
pnpm db:migrate            # áp toàn bộ migration (head: 0451)
node apps/api/demo-seed-base.mjs   # seed company demo + admin  (hoặc dùng CLI: m seed / m reset)
pnpm dev                   # chạy API + 3 app FE song song
```

> Tiện ích CLI repo: `m seed` / `m reset` (seed lại) — xem `mediaos.ps1`.

### 1.2 URL truy cập (dev)

| Thành phần | URL |
| --- | --- |
| **API** (REST) | `http://api.localhost:3100/api/v1` |
| Health check (public) | `http://localhost:3100/api/v1/health` · `…/health/db` |
| **App đăng nhập** (apps/auth) | `http://auth.localhost:5275` |
| **App nghiệp vụ** (apps/app) — màn HR ở đây | `http://web.localhost:5273` |
| **App quản trị** (apps/console) | `http://console.localhost:5278` |

> Dùng subdomain `*.localhost` (không phải `127.0.0.1`) để cookie SSO `Domain=.localhost` hoạt động giống prod.

### 1.3 Tài khoản test

| Trường | Giá trị |
| --- | --- |
| Công ty (slug) | `demo` |
| Email | `admin@demo.local` |
| Mật khẩu | `Admin@12345` |
| Role | `company-admin` (full quyền quản trị công ty — happy-path đi qua hết các gate) |

> Để test **deny-path / masking**, tạo thêm user role thấp hơn (vd nhân viên thường) qua `POST /auth/users` rồi gán role hạn chế — xem §4.5.

### 1.4 Lưu ý xác thực khi gọi API trực tiếp

- Hầu hết endpoint cần **JWT** (`Authorization: Bearer <accessToken>` lấy từ `POST /auth/login`).
- Endpoint **public** (không cần token): `/health`, `/health/db`, `/auth/login`, `/auth/refresh`, `/auth/me`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/2fa/verify`.
- `TWO_FACTOR_ENFORCEMENT_ENABLED=false` ở dev → không bị chặn 2FA khi test luồng thường.

---

## 2. Backend API — đã hoàn thành & test được (v2)

> Tất cả path đã gồm prefix `/api/v1`. Cột **Quyền** = `action:resource` mà PermissionGuard yêu cầu (admin demo có sẵn).

### 2.1 AUTH — Tài khoản, đăng nhập & phân quyền

| Chức năng | Method · Path | Quyền | Ghi chú |
| --- | --- | --- | --- |
| Đăng nhập | `POST /auth/login` | public | trả access/refresh token + set cookie SSO |
| Làm mới token | `POST /auth/refresh` | public | CSRF cookie |
| Đăng xuất | `POST /auth/logout` | public | |
| Bootstrap context (user + quyền) | `GET /auth/me` | public(*) | nguồn `capabilities` cho FE `useCan` |
| Quên mật khẩu | `POST /auth/forgot-password` | public | có rate-limit riêng |
| Đặt lại mật khẩu | `POST /auth/reset-password` | public | token TTL 1h |
| Đổi mật khẩu | `POST /auth/change-password` | đã đăng nhập | |
| 2FA: enroll/enable/disable/status | `POST/GET /auth/2fa/*` | đã đăng nhập | TOTP issuer = **FUNTIME MEDIA** |
| 2FA: verify (lúc đăng nhập) | `POST /auth/2fa/verify` | public | |
| Quản trị user: list/chi tiết | `GET /auth/users` · `GET /auth/users/:id` | `view:user` | |
| Quản trị user: tạo | `POST /auth/users` | `create:user` | |
| Quản trị user: sửa | `PATCH /auth/users/:id` | `update:user` | |
| Khoá / mở khoá user | `POST /auth/users/:id/lock` · `…/unlock` | `lock:user` · `unlock:user` | |
| Danh mục role / permission | `GET /auth/roles` · `GET /auth/permissions` | `view:role` · `view:permission` | cho dropdown |

(*) `/auth/me` tự verify token trong handler, không qua guard chuẩn.

### 2.2 HR — Quản lý nhân sự (lõi v2)

**Đọc:**

| Chức năng | Method · Path | Quyền | Ghi chú |
| --- | --- | --- | --- |
| Danh sách nhân viên (scoped + filter + paginate) | `GET /hr/employees` | `read:employee` | lọc theo data-scope của người gọi |
| Chi tiết nhân viên (đã masking) | `GET /hr/employees/:id` | `read:employee` | salary/PII bị che nếu thiếu quyền |
| Hồ sơ của tôi | `GET /hr/me/profile` | `read:employee` | scope Own |
| Lookups: phòng ban / vị trí / cấp bậc / loại HĐ | `GET /hr/lookups/*` | tương ứng | cho form |
| Preview mã nhân viên | `GET /hr/lookups/employee-code/preview` | `preview:employee-code` | |

**Ghi:**

| Chức năng | Method · Path | Quyền |
| --- | --- | --- |
| Tạo nhân viên | `POST /hr/employees` | `create:employee` |
| Sửa nhân viên | `PATCH /hr/employees/:id` | `update:employee` |
| Đổi trạng thái (active/probation/…) | `POST /hr/employees/:id/change-status` | `change-status:employee` |
| Link / unlink tài khoản user | `POST` · `DELETE /hr/employees/:id/link-user` | `update:employee` |

**Phòng ban & master-data:**

| Chức năng | Method · Path | Quyền |
| --- | --- | --- |
| Phòng ban CRUD | `GET/POST/PATCH/DELETE /hr/departments[/:id]` | `read/create/update/delete:department` |
| Cấp bậc (job-level) CRUD | `…/hr/master-data/job-levels[/:id]` | `manage:master-data` |
| Loại hợp đồng CRUD | `…/hr/master-data/contract-types[/:id]` | `manage:master-data` |

**Yêu cầu đổi hồ sơ (profile-change-request) — luồng phê duyệt:**

| Chức năng | Method · Path | Quyền |
| --- | --- | --- |
| Tạo yêu cầu | `POST /hr/profile-change-requests` | `create:profile-change-request` |
| Yêu cầu của tôi | `GET /hr/profile-change-requests/me` | own |
| Danh sách (người duyệt) | `GET /hr/profile-change-requests` | `approve:profile-change-request` |
| Duyệt / từ chối | `POST …/:id/approve` · `…/reject` | `approve:profile-change-request` |
| Huỷ (người tạo) | `POST …/:id/cancel` | own |

**Thùng rác (soft-delete recovery):**

| Chức năng | Method · Path | Quyền |
| --- | --- | --- |
| Liệt kê nhân viên đã xoá | `GET /recycle-bin/employees` | `read:employee` |
| Khôi phục | `POST /recycle-bin/employees/:id/restore` | `restore:employee` |

> **Bảo mật đã verify (FULL gate PASS):** `salaryType` + PII chỉ lộ khi có `view-salary` / `view-sensitive`; mọi route ghi đều `assertWriteScope` (chống IDOR); route legacy `GET /employees(/:id)` đã được scope + mask đồng nhất.

### 2.3 Foundation — nền tảng dùng chung

| Chức năng | Method · Path | Quyền |
| --- | --- | --- |
| Audit log công ty (list/chi tiết) | `GET /foundation/audit-logs[/:id]` | `view:audit-log` |
| Settings: public / resolve / cập nhật | `GET /foundation/settings/public` · `POST …/resolve` · `PATCH …/company-settings/:key` | `view/update:foundation-setting` |
| Thông tin công ty (xem/sửa) | `GET` · `PATCH /foundation/company/current` | `view/update:foundation-company` |
| Catalog "ứng dụng của tôi" | `GET /foundation/modules/my-apps` | lọc theo grant |
| File: upload/list/metadata/download-url/download/link/unlink/xoá | `…/foundation/files/*` | `upload/view/download/link/unlink/delete:foundation-file` |
| Ngày nghỉ lễ: list / check working-day / CRUD | `…/foundation/public-holidays/*` | `view/manage:foundation-holiday` |

> `audit_logs` là **append-only** (app role không UPDATE/DELETE) — đúng BẤT BIẾN #2.

---

## 3. Frontend — màn hình test được (v2)

### 3.1 apps/auth — `http://auth.localhost:5275`

| Màn hình | Trạng thái | Mô tả |
| --- | --- | --- |
| Đăng nhập | ✅ **Thật** | form email + mật khẩu → (nếu bật) thử thách 2FA → set cookie SSO → redirect về app đích |

### 3.2 apps/app — `http://web.localhost:5273` (vỏ nghiệp vụ — **trọng tâm test**)

| Route | Màn hình | Trạng thái | Gọi API |
| --- | --- | --- | --- |
| `/hr` · `/hr/employees` | Danh sách nhân viên (search · filter phòng ban/trạng thái · paginate · nút tạo/export theo quyền) | ✅ **Thật** | `GET /hr/employees`, lookups |
| `/hr/employees/new` | Form tạo nhân viên (RHF + Zod) | ✅ **Thật** | `POST /hr/employees` |
| `/hr/employees/:id` | Chi tiết (3 tab; field nhạy cảm hiển thị `***` nếu thiếu quyền) | ✅ **Thật** | `GET /hr/employees/:id` |
| `/hr/employees/:id/edit` | Form sửa (dirty-guard) | ✅ **Thật** | `GET` + `PATCH /hr/employees/:id` |
| `/hr/me` | Hồ sơ của tôi (read-only) | ✅ **Thật** | `GET /hr/me/profile` |
| `/system/users` | Danh sách user (**read-only**, CRUD hoãn S3) | ✅ Thật (đọc) | `GET /auth/users` |
| `/system/roles` | Danh sách role (**read-only**) | ✅ Thật (đọc) | `GET /auth/roles` |
| `/403` | Trang từ chối quyền | ✅ Thật | — |

> Tầng chung (`packages/web-core`) đã sẵn: auth store (Zustand), api-client (refresh-on-401), `useCan` / `<PermissionGate>`, `ProtectedRoute` (403/404/loading theo guard server).

### 3.3 apps/console — `http://console.localhost:5278` ⚠️ **test thận trọng**

App console là một trong 3 app v2 nhưng **phần lớn trang hiện tại là code mang sang từ hướng cũ**, **chưa nằm trong scope QA Sprint 0–2**. Một số trang *có thể* chạy với backend hiện tại (Cấu hình công ty, Phân quyền, Audit log, API keys) nhưng **chưa được verify ở đợt này** → coi là **thử nghiệm**, không tính bàn giao, không gating.

---

## 4. Kịch bản smoke test gợi ý (happy-path)

> Đăng nhập trước bằng tài khoản demo (§1.3).

1. **Đăng nhập & context** — mở `auth.localhost:5275` → đăng nhập → tự chuyển sang `web.localhost:5273`. Kiểm `GET /auth/me` trả `capabilities`.
2. **HR — vòng đời nhân viên:** Danh sách → **Tạo** nhân viên mới → mở **Chi tiết** → **Sửa** → **Đổi trạng thái**. Xác nhận xuất hiện trong list + có **audit log** (`GET /foundation/audit-logs`).
3. **Masking lương/PII:** tạo 1 user role thường (không có `view-salary`), đăng nhập user đó → mở chi tiết nhân viên → các field lương/PII phải hiển thị `***` (cả API lẫn UI).
4. **Luồng phê duyệt đổi hồ sơ:** user thường `POST /hr/profile-change-requests` → admin `GET …` thấy yêu cầu → **approve/reject** → user thấy trạng thái cập nhật.
5. **Quản trị user & quyền:** `POST /auth/users` tạo user → `lock`/`unlock` → kiểm user bị khoá không đăng nhập được (deny-path).
6. **Foundation:** sửa thông tin công ty (`PATCH /foundation/company/current`); thêm 1 ngày nghỉ lễ; upload + download 1 file.
7. **Bảo mật mật khẩu:** đổi mật khẩu (`change-password`); thử `forgot-password` (dev: email không gửi nếu `RESET_PASSWORD_URL` rỗng, token vẫn lưu DB).

---

## 5. NGOÀI phạm vi — KHÔNG test, KHÔNG báo lỗi

Các thành phần sau **tồn tại trong cây code** nhưng thuộc **hướng cũ đã de-media-fy / chưa tới lượt build** (CLAUDE.md §1). Chúng có thể phản hồi HTTP nhưng **không thuộc sản phẩm v2 hiện tại, chưa verify, chưa chắc seed đủ quyền**:

**Backend (controller còn wired nhưng PARK):** Attendance (`/attendance/*`) · Leave (`/leave/*`) · Tasks (`/tasks/*`, labels, states, attachments) · Workflow & Templates & Approval inbox (`/workflow/*`, `/workflow-templates/*`, `/approval/*`) · Dashboard (`/dashboard/*`) · Notifications (`/notifications/*`) · API keys (`/api-keys/*`) · Webhooks · Admin-users (`/users/admin/*`) · User-invites (`/users/*invite*`) · Settings mail/security-policy · Org legacy (`/org/*`).

**Frontend placeholder (render "Màn hình đang xây dựng…"):** Dashboard · Attendance · Leave · Tasks · Notifications · `/system/audit-logs` (apps/app) · home-portal launcher.

> Khi gặp các route này: ghi nhận "out-of-scope / parked", **không** mở bug. Nếu cần đưa vào phạm vi, tạo Work Order trong `harness/backlog.mjs`.

---

## 6. Tham chiếu

- Trạng thái tự sinh: [docs/STATUS.md](STATUS.md) — danh sách WO "Đã xong (v2)".
- Backlog máy-đọc: `harness/backlog.mjs`.
- Nghiệp vụ chi tiết (rule/màn hình/mã lỗi): `docs/spec/` · chỉ mục: [docs/README.md](README.md).
- Ma trận phân quyền: [docs/permission-matrix-spec.md](permission-matrix-spec.md).
- ERD hiện tại: [docs/erd-current.md](erd-current.md).

---
_Tài liệu này là ảnh chụp thủ công tại 2026-06-26. Sau mỗi sprint nên cập nhật lại mục §2–§3 theo các WO mới "Đã xong" trong STATUS._
