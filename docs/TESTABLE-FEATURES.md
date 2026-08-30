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
| `/hr` · `/hr/employees` | Danh sách nhân viên (search · filter phòng ban/trạng thái · paginate · sort-server theo cột · gom nhóm 1–2 cấp đơn vị/trạng thái · nút tạo/xuất CSV theo quyền, `export:employee` sensitive gate + PII mask per-row) | ✅ **Thật** | `GET /hr/employees`, `GET /hr/employees/export` (CSV), lookups |
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

## 5b. App vệ tinh SOCIAL — `apps/fbpost` (thêm 06/08/2026, wave S9)

Ứng dụng **Đăng bài Facebook Page** nhập vào hệ theo mô hình vệ tinh (như `apps/lms`) — [DECISIONS-08](DECISIONS/DECISIONS-08_Social_Satellite_App.md). Chạy riêng, cổng 3500, nối bằng cầu SSO.

**Test được ngay (đã có bằng chứng chạy thật):**

| Việc | Cách kiểm | Kỳ vọng |
| --- | --- | --- |
| Cổng phiên | `curl http://localhost:3500/api/pages` | **401** — 20/21 route API đòi phiên |
| Trang không phiên | mở `/compose` | điều hướng `/login` |
| Cầu SSO | ô "Đăng bài" trong App Switcher (cần cặp `view:social-post`) | vào thẳng fbpost đã có phiên |
| Chống phát lại | dùng lại cùng link SSO lần hai | bị từ chối, về `/login?error=invalid-token` |
| Token Facebook mã hoá | `sqlite3 data/fbpost.db "SELECT user_token FROM accounts"` | chuỗi `v1.…`, KHÔNG đọc được |
| Ô app ẩn đúng | user KHÔNG có `view:social-post` | không thấy ô "Đăng bài" |

Bộ test tự động: 50 test trong `apps/fbpost` (`npm test`) + 10 test `apps/api/src/integrations/social`.

**CHƯA test được (chờ triển khai):** đăng bài thật lên Facebook Page từ môi trường công ty — cần dịch vụ NSSM + domain public + 2 secret, xem [DEVOPS-14 §7](DEVOPS/DEVOPS-14_Social_Satellite_App_Deployment.md).

**Nợ PROD — ĐÃ TRẢ, đo lại 2026-08-07 (`S8-CHAT-UX-QA-1`):** `mediaos` (DB PROD) có **213/213** migration
của repo, gồm `0542` · `0543` · `0544` · `0545`; kiểm bằng schema chứ không chỉ bằng sổ migration
(`chat_message_reactions` tồn tại · `chat_room_members.pinned_at` + `marked_unread_at` · `chat_rooms.avatar_file_id`
· `chat_messages.file_url`/`file_name` đã DROP) vì migration thiếu entry trong `_journal.json` vẫn in
"applied" rồi bị bỏ qua trong im lặng. **Không còn nợ migration nào cho PROD.**

---

## 5c. CHAT — nâng cấp giao diện (wave S8-CHAT-UX, nghiệm thu 07/08/2026)

⚠️ Module `CHAT` vẫn `is_active = false` trong `modules`. Đó **không** phải cổng chặn (route vẫn gọi
được — xem `docs/DECISIONS`), nhưng nghĩa là wave này chưa được tuyên bố phát hành cho người dùng cuối.

| Việc | Cách kiểm | Kỳ vọng |
| --- | --- | --- |
| Chia mục hội thoại | mở `/chat` | Ghim · Riêng · Nhóm · Phòng ban · Dự án; mục rỗng ẩn hẳn; thu/mở nhớ theo người dùng |
| Ghim hội thoại | menu ngữ cảnh mỗi dòng → Ghim | lên mục Ghim; ghim quá 10 ⇒ báo `CHAT-ERR-021` |
| Tắt thông báo / đánh dấu chưa đọc | menu ngữ cảnh | tắt rồi vẫn tăng số chưa đọc, chỉ không đẩy thông báo |
| Avatar phòng | phòng **nhóm**: admin phòng đổi được · phòng **phòng ban**: người sửa được đơn vị đó · phòng **dự án**: Owner/Manager · phòng **riêng**: không có | sai tư cách ⇒ `CHAT-ERR-023`; phòng riêng ⇒ `CHAT-ERR-022` |
| Avatar người gửi + gộp tin | mở một phòng có nhiều tin liên tiếp | chỉ tin đầu của cụm có avatar + tên; tin hệ thống không gộp |
| Thả cảm xúc | rê chuột lên bong bóng → chọn 1 trong 6 emoji | bấm lại để bỏ; emoji ngoài bộ ⇒ `CHAT-ERR-025` |
| Đang gõ / đang online | hai tài khoản, hai trình duyệt | "đang gõ" tự tắt sau 5s; chấm online chỉ ở phòng riêng + danh sách thành viên |

Bộ test tự động: **82 ca** int-spec (`chat-s8-*.int-spec.ts`, cần `LANE_DB`) + **515 ca** unit
`src/chat`+`src/realtime` + **374 ca** FE `apps/app`. Bằng chứng nghiệm thu (ma trận deny-path ·
RED-trước-GREEN · cross-tenant · coverage):
[`QA/evidence/S8-CHAT-UX-QA-1-ACCEPTANCE.md`](QA/evidence/S8-CHAT-UX-QA-1-ACCEPTANCE.md).

---

## 5d. ASSET — Quản lý tài sản (wave S11-OFFICE, nghiệm thu QA 30/08/2026)

Module Phase 3 đầu tiên vào được tay người dùng: `modules.ASSET.is_active = true` từ migration `0556`
(bật cùng `S11-ASSET-FE-1`). Nghiệp vụ: [SPEC-13](spec/SPEC-13%20ASSET.md) · schema
[DB-15](DB/DB-15%20ASSET%20Database%20Design.md).

**Quyền cần có để thấy gì:** 11 cặp `(action, resource)` — `access:asset` là cổng **nav**, `view:asset`
là cổng **API đọc** (Own = tài sản mình đang/đã giữ · Department = nhân viên đơn vị mình · Company =
toàn bộ). 9 cặp ghi chỉ cấp `@Company`. Role hệ thống `asset-manager` giữ đủ 11 cặp.

> ⚠️ **Vận hành trước khi test trên môi trường thật:** phải gán role `asset-manager` cho tài khoản quản
> trị qua màn quản trị role — migration seed **không** tự gán. Chưa gán thì ASSET vô hình với admin và
> job `ASSET_MAINTENANCE_DUE` phát 0 thông báo.

| Việc | Cách kiểm | Kỳ vọng |
| --- | --- | --- |
| Tạo loại + sinh mã | tạo loại «Laptop» prefix `LT` → tạo 2 tài sản | mã `TS-LT-0001`, `TS-LT-0002`; đổi prefix sau khi đã sinh mã ⇒ `ASSET-ERR-010` `prefix-locked` |
| Cấp phát / thu hồi | cấp `TS-LT-0001` cho nhân viên A → thu hồi `Good` | A nhận thông báo `ASSET_ASSIGNED`; `/me/assets` của A thấy tài sản và **không** thấy giá mua; cấp lần 2 khi đang `Assigned` ⇒ `ASSET-ERR-001` |
| Bảo trì | mở lượt khi A đang giữ → đóng lượt | trạng thái `Under Maintenance` (lượt của A **vẫn** Active) → đóng ⇒ về `Assigned`, không phải `In Stock`; mở lượt thứ 2 ⇒ `ASSET-ERR-004` |
| Thanh lý / mất / tìm lại | thanh lý khi còn lượt Active | `ASSET-ERR-008` (phải thu hồi trước); ghi nhận mất thì được (tự đóng lượt `Lost`); tìm thấy lại ⇒ `In Stock`, bắt buộc lý do ≥ 3 ký tự |
| Kiểm kê | mở đợt toàn bộ → đánh dấu 1 dòng `Missing` → đóng đợt | số dòng = số tài sản không `Disposed`/`Lost`; tài sản tạo SAU không vào đợt; đóng rồi đánh dấu tiếp ⇒ `ASSET-ERR-007` |
| Phạm vi nhìn thấy | nhân viên thường mở `/assets/:id` của tài sản mình **không** giữ | **404** (không phải 403 — 403 sẽ xác nhận tài sản tồn tại); tài sản `In Stock` chỉ hiện với scope Company |
| Che tài chính | mở chi tiết bằng 3 tư cách | `purchasePrice`/`supplier`/`maintenances[].cost` **chỉ** có ở scope Company; Own **và** Department đều vắng khoá |
| Bấm-đúp nút cấp phát | bấm nhanh 2 lần | 1 lượt duy nhất (FE gửi `Idempotency-Key`); lần 2 nhận lại đúng phản hồi cũ |

Widget «Thống kê tài sản» trên Dashboard (SPEC-13 §20 mục 11) đã có từ `S11-OFFICE-DASH-1` — xem §5f.

Bộ test tự động: **157 ca** cụm ASSET (unit + int-spec, cần `LANE_DB`) — trong đó **81 ca mới** của
`S11-ASSET-QA-1` — + **91 ca** FE `apps/app/src/routes/assets`. Coverage `src/assets/**`: **97.6 %**
statements / **88.7 %** branches (lệnh tái lập: `pnpm --filter @mediaos/api test:cov:asset`). Bằng chứng
nghiệm thu (ma trận quyền per-pair · đột biến RED-trước-GREEN · biên idempotency · census mã lỗi):
[`QA/evidence/S11-ASSET-QA-1-ACCEPTANCE.md`](QA/evidence/S11-ASSET-QA-1-ACCEPTANCE.md).

---

## 5f. DASH — 2 widget wave OFFICE (S11-OFFICE-DASH-1, 30/08/2026)

Dashboard nay có thêm «Lịch họp hôm nay» (`ROOM_TODAY`) và «Thống kê tài sản» (`ASSET_SUMMARY`). Cả hai
**đọc lại đúng endpoint của module gốc** (`GET /me/room-bookings?date=…` · `GET /assets/summary`) — số trên
widget và số trong màn module luôn là MỘT.

**Ai thấy widget nào** — điểm dễ tưởng là bug nhất:

| Widget | Điều kiện thấy | Ghi chú |
| --- | --- | --- |
| Lịch họp hôm nay | có `view:room` (mọi role canonical đều có @Company) | Nội dung **chỉ** là lịch của CHÍNH người xem (mình tổ chức hoặc được mời) — không phải lịch toàn công ty |
| Thống kê tài sản | có `view:asset` **ở phạm vi ≥ Department** | Nhân viên thường (`view:asset@Own`) **không** thấy widget và **không** gọi API — đúng SPEC-13 §482. Trưởng đơn vị, HR, Admin và role `asset-manager` thì thấy |

| Việc | Cách kiểm | Kỳ vọng |
| --- | --- | --- |
| Lịch hôm nay | đặt 1 lượt trong ngày → mở Dashboard | lượt hiện với giờ bắt đầu–kết thúc, huy hiệu «Bạn tổ chức» nếu mình là người đặt; bấm vào → sang lưới lịch `/rooms` |
| Ngày theo múi giờ CÔNG TY | đặt lượt lúc 07:00 giờ Việt Nam rồi mở Dashboard từ máy đặt múi giờ khác | vẫn nằm trong «hôm nay» — server chốt ngày theo `companies.timezone`, **không** theo đồng hồ trình duyệt (SPEC-14 §83) |
| Chỉ lịch của mình | người khác đặt lượt không mời mình | lượt đó **không** xuất hiện; widget cũng không hiện TÊN người tham dự (chỉ số lượng) |
| Không có lịch | ngày trống | trạng thái rỗng «Hôm nay bạn không có lịch họp», không phải lỗi |
| Thống kê tài sản theo phạm vi | mở Dashboard bằng tài khoản Admin rồi bằng trưởng đơn vị | Admin thấy số toàn công ty; trưởng đơn vị thấy số **hẹp hơn** (chỉ đơn vị mình) — đây là data scope, không phải sai số |
| Nhân viên thường | mở Dashboard bằng tài khoản chỉ có `view:asset@Own` | **không có** ô «Thống kê tài sản»; tab Network cũng **không** có lời gọi `/dashboard/widgets/asset-summary` |
| Bảo trì sắp đến hạn | có tài sản `next_maintenance_due` trong 7 ngày | dòng cảnh báo màu vàng dưới tổng số; không có thì dòng đó ẩn hẳn |
| Không lộ tiền | mở widget bằng tài khoản scope Company | payload **không** chứa `purchasePrice`/`supplier` — widget chỉ đếm |

Bộ test tự động: **18 ca** int-spec `dashboard-office-widgets.int-spec.ts` (cần `LANE_DB` — phủ sàn scope ở
CẢ hai tầng, đối chiếu widget vs endpoint gốc, self-lock, cross-tenant) + **20 ca** FE.

---

## 6. Tham chiếu

- Trạng thái tự sinh: [docs/STATUS.md](STATUS.md) — danh sách WO "Đã xong (v2)".
- Backlog máy-đọc: `harness/backlog.mjs`.
- Nghiệp vụ chi tiết (rule/màn hình/mã lỗi): `docs/spec/` · chỉ mục: [docs/README.md](README.md).
- Ma trận phân quyền: [docs/permission-matrix-spec.md](permission-matrix-spec.md).
- ERD hiện tại: [docs/erd-current.md](erd-current.md).

---
_Tài liệu này là ảnh chụp thủ công tại 2026-06-26. Sau mỗi sprint nên cập nhật lại mục §2–§3 theo các WO mới "Đã xong" trong STATUS._
