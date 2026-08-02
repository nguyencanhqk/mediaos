# Permission Matrix — Hệ thống Quản lý Doanh nghiệp

> **Nguồn sự thật phân quyền tầng-trên**, hợp nhất từ bộ SPEC-02…08 (mỗi SPEC §"Quyền trong module" + "Ma trận phân quyền MVP"). Engine thực thi: permission engine 4 tầng (quyền nhạy cảm KHÔNG kế thừa). Test deny-path TRƯỚC (RED) cho mọi quyền nhạy cảm/phê duyệt ([`CLAUDE.md` §6](../CLAUDE.md)).
>
> **3 bất biến chi phối:** (1) `company_id` ép bằng RLS ở tầng DB, KHÔNG nằm trong PermissionService; (2) không hard-delete audit; (3) masking dữ liệu nhạy cảm là việc của **server**, FE chỉ UX.
>
> ⚠️ De-media-fy 2026-06-20: bỏ quyền media/finance/payroll/SaaS cũ. Mã quyền theo quy ước `MODULE.RESOURCE.ACTION` (SPEC-01 §9.5).

---

## 1. Mô hình 4 tầng (engine)

PermissionService trả lời: **"Trong cùng 1 tenant, user X có được làm `action` lên `resource/objId` không?"**. Cross-company KHÔNG thuộc tầng này — đó là RLS.

| Tầng | Tên | Hỏi gì | Nguồn | Kết quả |
| --- | --- | --- | --- | --- |
| 1 | **RBAC** | User có `permission(action, resource)` qua role nào? | `roles` → `role_permissions` | allow / deny / none |
| 2 | **Scope** | Quyền phủ tới *phạm vi dữ liệu* chứa object này? | `data_scope` của grant | object có trong scope? |
| 3 | **Object-level** | Có grant/deny gắn trực tiếp lên *instance* này? | object grant | allow/deny — **override Tầng 1+2** |
| 4 | **Sensitive** | Action nhạy cảm? Đã cấp **tường minh** chưa? | `is_sensitive` + grant riêng | gate cứng — **không kế thừa** |

- **Deny thắng** (deny-overrides) · **deny-by-default** (thiếu grant → từ chối) · **fail-closed** (route không khai quyền → 403).
- **Sensitive không kế thừa qua wildcard** — `view dữ liệu nhạy cảm` (CCCD/lương) phải có ALLOW tường minh, kể cả Company Admin.

### 1.1 Phạm vi dữ liệu (data scope — SPEC-01 §11.2)

| Scope | Ý nghĩa |
| --- | --- |
| **Own** | Chỉ dữ liệu của chính mình |
| **Team** | Dữ liệu team/nhân viên mình quản lý (`direct_manager_id = me`) |
| **Department** | Dữ liệu trong phòng ban |
| **Company** | Toàn công ty |
| **System** | Toàn hệ thống |
| **Project** | _(chỉ TASK)_ dữ liệu trong dự án user là thành viên |

**Role hệ thống mặc định + scope:** `SUPER_ADMIN` (System) · `COMPANY_ADMIN` (Company) · `HR` (Company) · `MANAGER` (Team) · `EMPLOYEE` (Own). User có thể giữ **nhiều role**.

> Ký hiệu ma trận: **Có** = mặc định có · **Cấp** = có nếu được cấp quyền riêng · **—** = không · **Own/Team/…** = giới hạn theo scope. SA=Super Admin · ADM=Company Admin · HR · MGR=Manager · EMP=Employee (TASK thêm PM=Project Manager).

---

## 2. AUTH — Tài khoản & phân quyền (SPEC-02)

**Mã quyền:** `AUTH.LOGIN.ACCESS · AUTH.PROFILE.VIEW · AUTH.PROFILE.UPDATE · AUTH.PASSWORD.CHANGE · AUTH.USER.{VIEW,CREATE,UPDATE,LOCK,UNLOCK,ASSIGN_ROLE} · AUTH.ROLE.{VIEW,CREATE,UPDATE,DELETE} · AUTH.PERMISSION.{VIEW,ASSIGN} · AUTH.AUDIT_LOG.VIEW`

| Chức năng | SA | ADM | HR | MGR | EMP |
|---|---|---|---|---|---|
| Đăng nhập/xuất · Đổi mật khẩu · Xem hồ sơ cá nhân | Có | Có | Có | Có | Có |
| Xem danh sách user | Có | Có | — | — | — |
| Tạo / Cập nhật user | Có | Có | Cấp | — | — |
| Khóa / Mở khóa user | Có | Có | — | — | — |
| Xem / Tạo / Cập nhật role | Có | Có (giới hạn) | — | — | — |
| Gán role cho user | Có | Có | — | — | — |
| Xem / Gán permission | Có | Có (giới hạn) | — | — | — |
| Xem audit log AUTH | Có | Cấp | — | — | — |

> **CHỐT canonical (S2-FND-BE-5):** *audit-log viewer* = cặp engine **`view:audit-log`** (mig 0340, `is_sensitive=true`, grant `company-admin`) — đây là cổng DUY NHẤT của `GET /foundation/audit-logs`. Cặp `view:foundation-audit-log`/`export:foundation-audit-log` (mig 0435, non-sensitive) **DEPRECATE cho app-surface**: KHÔNG route nào enforce, seed row GIỮ (append-only). `MODULE_APP_METADATA.AUTH` dùng `view:audit-log` (không `view:foundation-audit-log`).
>
> **CHỐT `GET /foundation/company/branding` = Authenticated (S5-BRAND-FE-2):** đường ĐỌC thương hiệu công ty (logo + favicon) chỉ cần JWT hợp lệ, **KHÔNG** cặp quyền. Lý do: `view:foundation-company` DB thật chỉ cấp `company-admin`, gate bằng nó ⇒ logo trên vỏ app + favicon động chết với mọi nhân viên còn lại. Logo/favicon là tài sản thương hiệu công khai trong tenant. Cô lập tenant do `CompanyGuard` + `withTenant` ép; `CompanyBrandingFileResolver.canRead` kiểm `entityId === companyId`; `resolveAsset` chỉ ký file CÓ link branding sống (chống đầu độc con trỏ `companies.logo_url`).
>
> **Mọi đường GHI branding VẪN gate `update:foundation-company`** (`upload-url` · `confirm` · `PUT :kind` · `DELETE :kind`), thêm owner-check file ở `canLinkFile`/`canDeleteFile`. ⚠️ Hệ quả đã ghi nhận: role nào được cấp `download:foundation-file` sẽ **kéo theo** quyền đọc file branding (hôm nay chỉ SA + company-admin giữ cặp đó) — pin bằng int-spec `company-branding-deny.int-spec.ts`.

> **CHỐT `GET /foundation/settings/public` = Authenticated** (chỉ cần JWT hợp lệ, KHÔNG cần `view:foundation-setting`); server vẫn lọc `is_public && !is_sensitive` + mask secret. `resolve`/`PATCH company-settings` VẪN gate `view`/`update:foundation-setting`. *(Pin API-09 chuẩn hoá surface → S2-FND-DOC-1.)*

> **CHỐT đường ĐỌC `/org` — ranh giới "CƠ CẤU ≠ NGƯỜI" (S6-SEC-ORG-1, đóng KI-030):**
>
> | Route | Cổng | Vì sao |
> |---|---|---|
> | `GET /org/units` · `/org/units/tree` · `/org/departments` | **Authenticated** | Danh mục cơ cấu: tên phòng ban + hình dạng cây. `apps/app` dùng trực tiếp ở `OrgChartPage` + `TaskSidebarTree` ⇒ gate = gãy UI mọi nhân viên |
> | `GET /org/roles` | **Authenticated** | Danh mục vai trò, trả đúng `{ id, name }`; **không** nêu ai giữ vai trò nào. Repo đã loại role operator-plane khỏi đường đọc |
> | `GET /org/employees` | **`view:user`** + **`data_scope`** | Trả `id · email · fullName · status` + team membership. Từ `S6-SEC-ORGSCOPE-1`: hàng được BOUND theo scope, không còn "toàn tenant". Động từ = `view:user` từ `S6-SEC-PERMVERB-1` (DECISIONS-06 D-41) — **cùng cặp** với `GET /auth/users` |
> | `GET /org/teams` | **`read:team`** (vế cơ cấu) + **`view:user` + `data_scope`** (`leaderUserName`) | Cơ cấu team = ai thuộc nhóm nào. Từ `S6-SEC-IDENTITYBOUND-1` (N-1e, KI-052): **tên trưởng nhóm** là danh tính NGƯỜI nên bound theo cặp danh bạ. ⚠️ Khác `members`: `leaderUserName` là `.nullable()` HỢP LỆ (team chưa có trưởng nhóm) ⇒ `null` không mang được thông tin "ngoài scope" ⇒ **bắt buộc bỏ khoá** |
> | `GET /recycle-bin/employees` | **`read:employee`** (vế nghiệp vụ) + **`view:user` + `data_scope`** (hai cột danh tính) | `S6-SEC-IDENTITYBOUND-1` (N-1d, **KI-051**). Trước đó gate `read:employee` rồi trả `userFullName`+`userEmail` của MỌI hồ sơ xoá mềm, **không resolve scope nào** — mà role seeded `employee` giữ `read:employee@Own` với **45/46 user sống** và không có `view:user` nào |
> | `GET /org/teams/:id/members` | **`read:team`** (vế quan hệ) + **`view:user` + `data_scope`** (hai cột danh tính) | **HAI lớp dữ liệu, HAI chủ quyền** — `S6-SEC-ORGTEAMSCOPE-1` (N-1c, KI-049). `read:team` quyết định truy cập *tài nguyên team*; `userFullName`/`userEmail` bị buộc bởi **đúng cặp danh bạ** của `/org/employees`. Ngoài scope ⇒ **BỎ HẲN KHOÁ** (không trả `null`: contract `userEmail` chưa `.nullable()`) |
>
> **`data_scope` của `GET /org/employees` (S6-SEC-ORGSCOPE-1 — đóng nợ N-1):** guard chỉ trả lời "có
> cặp quyền không"; số hàng do `DataScopeService.buildUserScopeCondition` quyết, dựng trên bảng
> `users`:
>
> | scope | Thấy gì |
> |---|---|
> | `Company` · `System` | Mọi tài khoản trong tenant — **kể cả tài khoản chưa có `employee_profile`** (màn RBAC console dùng route này làm danh sách subject gán role) |
> | `Own` | Chỉ chính mình |
> | `Team` · `Department` | **0 hàng (fail-closed)** — `users` không mang org-mapping, và §13 chỉ cấp `Company` cho cặp đọc tài khoản ⇒ scope hẹp ở đây là ngữ nghĩa chưa định nghĩa. Giống hệt `GET /auth/users` |
>
> Cố ý **phi đơn điệu** (`Team` hẹp hơn `Own`): sai về phía 0 hàng, không sai về phía rò. Muốn `Team`
> có nghĩa thật thì phải thêm org-mapping cho `users` — làm MỘT LẦN cho cả hai route, không vá lẻ.
> Phi đơn điệu còn có vế thứ hai: `resolveStrongestScope` lấy **max**, nên user giữ ĐỒNG THỜI `Own` và
> `Team` resolve ra `Team` ⇒ **0 hàng** — thêm role có thể LÀM MẤT quyền xem. Fail-closed, không rò,
> nhưng là bẫy vận hành thật; nhánh này nay có `logger.warn` để chẩn được.
>
> ✅ **N-1c ĐÃ ĐÓNG 2026-07-30** — `S6-SEC-ORGTEAMSCOPE-1` (KI-049). Trước đó
> `GET /org/teams/:id/members` trả `userEmail` + `userFullName` mà **chưa** ép `data_scope` (chỉ có cặp
> `read:team`) ⇒ role `read:team@Own` — và cả role **không có `view:user` nào**, đúng hình dạng
> `hr-manager` trong seed — lấy được trọn danh bạ email qua đường teams, **vòng qua** vế
> `/org/employees` vừa siết ở trên.
>
> Cách đóng: hai cột danh tính bound theo cặp danh bạ, **không** phát minh ngữ nghĩa
> `Own`/`Team`/`Department` thứ hai cho `teams` — làm vậy là đẻ hành vi thứ hai cho cùng lớp dữ liệu.
>
> ✅ **N-1d + N-1e ĐÃ ĐÓNG 2026-07-30** — `S6-SEC-IDENTITYBOUND-1` (KI-051 · KI-052).
> **KI-051 `GET /recycle-bin/employees`** là lỗ NẶNG NHẤT của cả loạt N-1: cùng lớp lỗi KI-049 nhưng
> **45/46 user sống** giữ cặp gate (`employee` → `read:employee@Own`) và **không ai trong số đó có
> `view:user`**, trong khi KI-049 có 0 người. Phơi nhiễm lúc phát hiện = 0 hàng chỉ vì chưa có hồ sơ
> nào bị xoá mềm — chặn bởi *thiếu dữ liệu*, không phải bởi một lớp kiểm soát nào.
> **KI-052 `GET /org/teams`** nằm ở **phương thức bên cạnh trong chính file mà N-1c vừa vá** ⇒ bằng
> chứng cụ thể rằng vá-theo-route không quét hết file; lần sau vá lớp lỗi này thì quét CẢ FILE.
>
> ⚠️ **Gốc rễ chung VẪN CÒN, đừng đọc khối này là "/org đã chốt toàn bộ":** `PermissionGuard` không đọc
> `data_scope`, nên MỌI route chỉ dựa vào guard đều thừa hưởng khoảng hở này. N-1 · N-2 · N-1c là **ba
> lần vá cùng một lớp lỗi ở ba route khác nhau**. Hướng gốc đề xuất (`S6-SEC-IDENTITY-PROJ-1`, `S3`,
> không chặn RC): buộc **tầng chiếu** — mọi truy vấn chiếu `users.email`/`users.fullName` phải nhận
> một vị từ scope, thiếu thì **vỡ typecheck** thay vì trả 0 hàng im lặng. Census 2026-07-29: 40+ điểm
> chiếu ở 7 module.
>
> Trước 2026-07-27 cả bảy route đều Authenticated theo quy ước cũ "READ mở trong tenant" — đó chính là
> KI-030: mọi user đã đăng nhập đọc được trọn danh bạ kèm email, trong khi `/hr/employees` cùng lớp dữ
> liệu thì ép `read:employee` + data_scope. Quy ước "đọc thì mở" **chỉ áp cho DANH MỤC**, không áp cho
> dữ liệu về NGƯỜI.
>
> ⚠️ **Hệ quả đã ghi nhận (KHÔNG backfill):** ở PROD chỉ `company-admin`/`SA` giữ cặp danh bạ, và
> `company-admin`/`SA`/`hr-manager` giữ `read:team` — nên role `employee` **mất** quyền đọc 3 route
> trên (40/46 user tenant `funtime`). Cả 3 chỉ có caller ở `apps/console`. Cấp thêm cặp danh bạ cho
> `employee` = mở lại chính lỗ vừa vá. Pin bằng `org-directory-permission.int-spec.ts`.
>
> ✅ **Lệch động từ `read:user` vs `view:user` — ĐÃ ĐÓNG (`S6-SEC-PERMVERB-1`, 2026-07-29).**
> ADR: [DECISIONS-06 D-41](<DECISIONS/DECISIONS-06_Permission_Verb_Canonical.md>). `/org/employees`
> nay gate **`view:user`** — cùng cặp với `/auth/users`, role-admin và widget dashboard
> `USER_SUMMARY`. Vì `data_scope` là PER-(permission, role), trước đây siết scope trên `view:user`
> **không** siết `/org/employees`; sau khi thống nhất, một knob siết cả hai đường đọc tài khoản.
>
> **KHÔNG migration, KHÔNG grant mới** — số đo PROD 2026-07-29 (1 tenant, 46 user):
>
> | Role | User sống | Trước | Sau | Ghi chú |
> |---|---|---|---|---|
> | `SA` · `company-admin` | 6 + 1 | ✅ | ✅ | Giữ **CẢ HAI** động từ @Company ⇒ đổi gate là no-op |
> | `employee` | 45 | ❌ | ❌ | Không grant nào — không đổi |
> | `project-manager` (…002) | **0** | ✅ | ❌ | **Mất** — media-era, ngoài §13, de-media-fy ⇒ cố ý không backfill |
> | `hr` (…011) | **0** | ❌ | ✅ | **Được** — §13 đặc tả HR = Company; đã có sẵn `view:user` từ `0444`, chỉ chưa dùng được |
>
> ⓘ **Đính chính tiền đề cũ của khối này:** bản trước ghi "BA role lệch" và dự trù backfill cả ba.
> Số đo bác bỏ — `manager` (…010) **đúng thiết kế** (§13 ghi Manager `-` cho `AUTH.USER.VIEW`, backfill
> = mở rộng quyền ngoài đặc tả) và `hr-manager` (…009) là media-era ngoài §13. Chỉ `hr` lệch thật, và
> nó **đã có** grant cần thiết ⇒ đổi gate là đủ.
>
> **Pha CONTRACT hoãn có chủ đích:** row `read:user` + grant của `project-manager` **vẫn còn** trong
> catalog (không revoke cùng release đổi enforce — memory `migration-expand-contract-required`), nhưng
> không route nào đọc tới. Khoá bằng ca chạy-thật *"`read:user` (LEGACY) KHÔNG còn mở được danh bạ"*.

---

## 3. HR — Nhân sự (SPEC-03)

**Mã quyền (nhóm):** `HR.EMPLOYEE.{VIEW,VIEW_SENSITIVE,CREATE,UPDATE,CHANGE_STATUS,DELETE,EXPORT,IMPORT,FILE_VIEW,FILE_UPLOAD,FILE_DELETE} · HR.DEPARTMENT.{VIEW,CREATE,UPDATE,DELETE} · HR.POSITION.{…} · HR.CONTRACT.{…} · HR.ORG_CHART.VIEW · HR.MASTER_DATA.MANAGE · HR.PROFILE_CHANGE_REQUEST.{CREATE,VIEW_OWN,VIEW,APPROVE,REJECT,CANCEL_OWN} · HR.EMPLOYEE_CODE_CONFIG.{VIEW,UPDATE} · HR.EMPLOYEE_CODE.{PREVIEW,MANUAL_OVERRIDE} · HR.AUDIT_LOG.VIEW`

| Chức năng | SA | ADM | HR | MGR | EMP |
|---|---|---|---|---|---|
| Xem danh sách nhân viên | Có | Cấp | Có | Team/Dept | — |
| Xem hồ sơ cá nhân | Có | Có | Có | Giới hạn | Own |
| **Xem dữ liệu nhạy cảm** 🔒 (CCCD/lương) | Có | Cấp | Cấp | — | — |
| Thêm / Cập nhật nhân viên | Có | Cấp | Có | Cấp (giới hạn) | Một số trường cá nhân (nếu cho phép) |
| Đổi trạng thái · Xóa mềm nhân viên | Có | Cấp | Có | — | — |
| Quản lý phòng ban / chức vụ / hợp đồng | Có | Có | Cấp | — | — |
| Upload/Xem file hồ sơ | Có | Cấp | Có | — | — |
| Xuất danh sách · Xem lịch sử thay đổi | Có | Cấp | Cấp | — | — |
| **Nhập nhân viên hàng loạt (Excel/CSV)** 🔒 (`import:employee` scope Company) | Có | Cấp | Cấp | — | — |
| Gửi/Xem/Hủy yêu cầu sửa hồ sơ của mình | Có | Có | Có | Có | Có |
| Duyệt/Từ chối yêu cầu sửa hồ sơ | Có | Cấp | Có | — | — |
| Cấu hình mã NV / Sửa mã thủ công | Có | Cấp | Cấp | — | — |

---

## 4. ATT — Chấm công (SPEC-04)

**Mã quyền (nhóm):** `ATT.ATTENDANCE.{CHECK_IN,CHECK_OUT,VIEW_OWN,VIEW_TEAM,VIEW_COMPANY,VIEW_DETAIL,EXPORT,ADJUST_DIRECT} · ATT.ADJUSTMENT.{CREATE_OWN,VIEW_OWN,VIEW_TEAM,VIEW_COMPANY,APPROVE,REJECT,CANCEL_OWN} · ATT.SHIFT.{VIEW,CREATE,UPDATE,DELETE} · ATT.SHIFT_ASSIGNMENT.{VIEW,UPDATE} · ATT.RULE.{VIEW,CONFIG} · ATT.REMOTE_REQUEST.{CREATE_OWN,VIEW_OWN,VIEW_TEAM,VIEW_COMPANY,APPROVE,REJECT} · ATT.AUDIT_LOG.VIEW`

| Chức năng | SA | ADM | HR | MGR | EMP |
|---|---|---|---|---|---|
| Check-in/out · Xem bảng công cá nhân | Có | Có | Có | Có | Có |
| Xem bảng công team | Có | Cấp | Cấp | Có | — |
| Xem bảng công toàn công ty | Có | Cấp | Có | — | — |
| Cấu hình ca làm / gán ca / rule | Có | Cấp | Cấp | — | — |
| Gửi yêu cầu điều chỉnh công | Có | Có | Có | Có | Có |
| Duyệt/Từ chối điều chỉnh công | Có | Cấp | Có | Team | — |
| Điều chỉnh công trực tiếp | Có | Cấp | Có | — | — |
| Gửi remote/công tác | Có | Có | Có | Có | Có |
| Duyệt remote/công tác | Có | Cấp | Cấp | Team | — |
| Xuất bảng công · Xem audit log ATT | Có | Cấp | Cấp | — | — |

---

## 5. LEAVE — Nghỉ phép (SPEC-05)

**Mã quyền (nhóm):** `LEAVE.REQUEST.{CREATE,VIEW_OWN,VIEW_TEAM,VIEW_DEPARTMENT,VIEW_COMPANY,UPDATE_OWN,CANCEL_OWN,APPROVE,REJECT,CANCEL_ANY,EXPORT} · LEAVE.TYPE.{VIEW,CREATE,UPDATE,DELETE} · LEAVE.POLICY.{VIEW,UPDATE} · LEAVE.BALANCE.{VIEW_OWN,VIEW,ADJUST} · LEAVE.CALENDAR.{VIEW_OWN,VIEW_TEAM,VIEW_COMPANY} · LEAVE.AUDIT_LOG.VIEW`

| Chức năng | SA | ADM | HR | MGR | EMP |
|---|---|---|---|---|---|
| Tạo / Xem / Hủy đơn nghỉ của mình | Có | Có | Có | Có | Có |
| Xem đơn nghỉ team | Có | Cấp | Cấp | Có | — |
| Xem đơn nghỉ toàn công ty | Có | Cấp | Có | — | — |
| Duyệt / Từ chối đơn nghỉ | Có | Cấp | Cấp | Team | — |
| Hủy đơn người khác | Có | Cấp | Cấp | — | — |
| Quản lý loại nghỉ / chính sách phép | Có | Cấp | Cấp | — | — |
| Xem số dư phép cá nhân | Có | Có | Có | Có | Có |
| Xem số dư phép nhân viên | Có | Cấp | Có | Team (cấp) | — |
| Điều chỉnh số dư phép | Có | Cấp | Cấp | — | — |
| Xem lịch nghỉ team / công ty | Có | Cấp | Cấp/Có | Team | — |

---

## 6. TASK — Công việc & dự án (SPEC-06)

Thêm cột **PM** (Project Manager — vai trò cấp-dự-án) và scope **Project**.

**Mã quyền (nhóm):** `TASK.PROJECT.{VIEW,CREATE,UPDATE,DELETE,CLOSE,ARCHIVE,MANAGE_MEMBER,VIEW_REPORT} · TASK.TASK.{VIEW,CREATE,UPDATE,DELETE,ASSIGN,UPDATE_STATUS,UPDATE_STATE,UPDATE_PRIORITY,UPDATE_DEADLINE,COMMENT,FILE_UPLOAD,FILE_DELETE,WATCH,VIEW_KANBAN,EXPORT} · `TASK.PROJECT_STATE.{VIEW,CREATE,UPDATE,DELETE}` · `TASK.AUDIT_LOG.VIEW`

| Chức năng | SA | ADM | HR | MGR | PM | EMP |
|---|---|---|---|---|---|---|
| Xem danh sách dự án | Có | Cấp | Cấp | Scope | Dự án phụ trách | Nếu là member |
| Tạo dự án | Có | Cấp | Cấp | Cấp | Cấp | — |
| Cập nhật dự án | Có | Cấp | Cấp | Dự án QL | Dự án phụ trách | — |
| Đóng/hủy dự án · Quản lý thành viên | Có | Cấp | — | Nếu owner | Nếu owner | — |
| Xem / Tạo task | Có | Cấp | Cấp | Team/Project | Project | Task liên quan / Cấp |
| Giao task | Có | Cấp | Cấp | Team/Project | Project | — |
| Cập nhật trạng thái task | Có | Cấp | Cấp | Scope | Project | Nếu là assignee |
| Đổi cột pipeline task (kéo thả Kanban) | Có | Cấp | Cấp | Scope | Project | Own (task của mình) |
| Xem cột pipeline của dự án | Có | Có | — | — | Có | Có |
| Quản lý cột pipeline (thêm/sửa/xoá) | Có | Có | — | **—** | Có | — |
| Bình luận / Upload file task | Có | Nếu xem được task | Nếu xem được task | Nếu xem được task | Nếu xem được task | Nếu xem được task |
| Xóa task | Có | Cấp | — | Creator/owner | Owner | — |
| Xem báo cáo dự án · Xuất task | Có | Cấp | Cấp | Scope | Dự án phụ trách | — |

> **`TASK.TASK.UPDATE_STATE`** (bổ sung 18/07/2026 — [DECISIONS-03](<DECISIONS/DECISIONS-03_Task_Pipeline_Column_And_FSM.md>) D-16/D-17): quyền đổi **cột pipeline** (`tasks.state_id` → `project_states`), TÁCH khỏi `TASK.TASK.UPDATE_STATUS` (đổi `task_status`). Ma trận scope theo 4 role chuẩn **mirror đúng `UPDATE_STATUS`**: `employee = Own` · `manager = Team` · `hr = Company` · `company-admin = Company`.
>
> Kéo thẻ sang cột **khác `state_group`** kéo theo đổi trạng thái ⇒ đòi **cả hai** quyền, và phần đổi trạng thái chạy ở **phạm vi của chính `UPDATE_STATUS`**, không mượn phạm vi của `UPDATE_STATE`. Kéo sang cột **cùng nhóm** chỉ đòi `UPDATE_STATE`.

---

## 7. DASH — Dashboard (SPEC-07)

DASH chỉ hiển thị/deep-link; **module nguồn ép data scope thật**. Quyền widget gate hiển thị.

**Mã quyền (nhóm):** `DASH.DASHBOARD.{VIEW,VIEW_EMPLOYEE,VIEW_MANAGER,VIEW_HR,VIEW_ADMIN} · DASH.WIDGET.VIEW_* (theo widget) · DASH.CONFIG.{VIEW,UPDATE} · DASH.AUDIT_LOG.VIEW`

| Dashboard / widget | SA | ADM | HR | MGR | EMP |
|---|---|---|---|---|---|
| Xem Dashboard · Dashboard Employee | Có | Có | Có | Có | Có |
| Dashboard Manager | Có | Cấp | Cấp | Có | — |
| Dashboard HR | Có | Cấp | Có | — | — |
| Dashboard Admin | Có | Có | — | — | — |
| Widget chấm công hôm nay · task của tôi · số ngày phép · thông báo mới | Có | Có | Có | Có | Có |
| Widget đơn nghỉ chờ duyệt · task team quá hạn · lịch nghỉ team | Có | Cấp | Cấp | Có | — |
| Widget tổng quan nhân sự · nhân sự mới · hợp đồng sắp hết hạn · sắp hết thử việc | Có | Cấp | Có | — | — |
| Widget tổng user/nhân viên · module · log hệ thống · tài khoản mới | Có | Có | — | — | — |
| Widget tiến độ dự án | Có | Cấp | Liên quan | Scope | Nếu là member |
| Cấu hình widget theo role | Có | Cấp | — | — | — |

> **Hai hàng cột pipeline ghi theo seed THẬT (mig 0420), không theo suy đoán.** Quản trị cột chỉ cấp cho SA · ADM · PM; quyền xem cấp thêm cho EMP. **MGR và HR hiện không có quyền nào trên cột, kể cả xem.** Không tồn tại kiểm tra "owner dự án" ở các route quản trị cột. Đổi bất kỳ ô nào ở hai hàng này = quyết định mới, phải qua sổ quyết định + migration riêng.

---

## 8. NOTI — Thông báo (SPEC-08)

**Mã quyền (nhóm):** `NOTI.NOTIFICATION.{VIEW_OWN,VIEW_DETAIL_OWN,COUNT_UNREAD_OWN,MARK_READ_OWN,MARK_ALL_READ_OWN,HIDE_OWN,DELETE_OWN,VIEW_COMPANY,CREATE_SYSTEM,SEND_SYSTEM} · NOTI.EVENT.{VIEW,CONFIG} · NOTI.TEMPLATE.{VIEW,UPDATE} · NOTI.CHANNEL.{VIEW,UPDATE} · NOTI.LOG.VIEW · NOTI.AUDIT_LOG.VIEW`

| Chức năng | SA | ADM | HR | MGR | EMP |
|---|---|---|---|---|---|
| Xem/đếm/đánh dấu đã đọc · ẩn/xóa mềm thông báo của mình | Có | Có | Có | Có | Có |
| Xem log thông báo toàn công ty | Có | Cấp | — | — | — |
| Tạo thông báo hệ thống thủ công | Có | Cấp | — | — | — |
| Cấu hình loại / template thông báo | Có | Cấp | Cấp | — | — |
| Cấu hình kênh gửi · Xem audit log NOTI | Có | Cấp | — | — | — |

---

## 9. ME — Trung tâm cá nhân (SPEC-09)

ME chỉ **đọc-lại** dữ liệu Own của chính user (ATT/LEAVE/TASK/NOTI/profile) qua **permission NGUỒN** (ME-DEC-002 / SPEC-09 §11.2) — KHÔNG wrap quyền riêng cho nghiệp vụ nguồn. Chỉ `user_preferences` (tùy chọn cá nhân, DB-08 §8.16) là dữ liệu MỚI của ME. RLS+FORCE cô lập **tenant**; chống IDOR cross-user (đọc/ghi pref của user khác) ép ở **ME-BE** (`WHERE user_id = token-resolved`, SPEC-09 §14.4/§17.1) — KHÔNG do RLS.

**Ánh xạ mã quyền ME → cặp (action, resource_type) engine** (mig 0495, is_sensitive=false — cổng nav; web-core `PERMISSION_CODE_TO_PAIR` hạ nguồn PHẢI khớp, chống pair-drift):

| Mã quyền (SPEC-09) | Cặp engine `action:resource_type` | Scope | Ghi chú |
|---|---|---|---|
| `ME.ACCESS` | `access:me` | Own | Cổng vào /me — mọi role canonical |
| `ME.PREFERENCE.VIEW_OWN` | `view:user-preference` | Own | Đọc tùy chọn cá nhân của mình |
| `ME.PREFERENCE.UPDATE_OWN` | `update:user-preference` | Own | Ghi tùy chọn cá nhân của mình (upsert) |
| `ME.AVATAR.UPDATE_OWN` | `update:avatar` | Own | Cập nhật avatar của mình |
| `ME.NOTIFICATION_PREFERENCE.UPDATE_OWN` | `update:notification-preference` | Own | Cập nhật tùy chọn nhận thông báo của mình |

Grant scope `Own` cho **cả 4 role canonical** (employee/manager/hr/company-admin) = 20 hàng `role_permissions` (per-role §13). KHÔNG seed `ME.OVERVIEW/PROFILE/ACCOUNT/SESSION/SECURITY_ACTIVITY/DATA_EXPORT` (out-of-scope MVP DB WO).

---

## 9b. GOAL — Mục tiêu (SPEC-10)

GOAL đứng riêng (GOAL-DEC-002), 8 cặp quyền per-(action, resource) theo SPEC-10 §11. Data scope đề xuất theo 4 role canonical — **chốt cùng migration seed** (S5-GOAL-DB-1, KHÔNG để mở sau — flip sau đụng pin canonical-seed):

| Cặp quyền (SPEC-10 §11) | Ý nghĩa | Nhân viên | Trưởng đơn vị | BOD/Admin |
| --- | --- | --- | --- | --- |
| `('access','goal')` | Cổng nav menu Mục tiêu | có | có | có |
| `('view','goal')` | Xem mục tiêu | **department** (goal phòng + goal cá nhân mình + goal dự án mình là member) | department | all |
| `('create','goal')` | Tạo mục tiêu | **own** (chỉ cấp employee của chính mình) | department (cả 3 cấp trong phòng) | all |
| `('update','goal')` | Sửa mục tiêu | own | department | all |
| `('delete','goal')` | Xóa mềm | own | department | all |
| `('checkin','goal')` | Check-in tiến độ | own | department | all |
| `('finalize','goal')` | Chốt kỳ + mở lại | không | department | all |
| `('manage','task-template')` | Danh mục template phân rã | không | department | all |

Ghi chú:

- Goal **cấp dự án**: quyền ghi ngoài data_scope trên còn đi qua **vai trò dự án** (ProjectAccessService — DECISIONS-04): Owner/Manager của project được tạo/sửa goal dự án đó kể cả khác phòng ban.
- `is_sensitive` đề xuất `false` cho cả 8 cặp; `('finalize','goal')` là quyết định phải chốt tường minh trong plan WO backend đầu tiên của GOAL — nếu đổi thành `true` sau seed, phải cập nhật đồng thời allowlist sensitive FE + pin `auth-seed-canonical-roles` trong CÙNG WO (bẫy `canonical-seed-pin-regression`).
- RLS+FORCE cô lập **tenant** trên `goals`/`goal_updates`/`task_templates`/`task_template_items`; data scope (own/department/all) ép ở **service layer** GOAL-BE qua `buildReadScopeExists` pattern (không phải RLS).
- Chi tiết mã lỗi/quy tắc: [SPEC-10 GOAL §11–12](<spec/SPEC-10 GOAL.md>); schema: [DB-11](<DB/DB-11 GOAL Database Design.md>).

---

## 9c. CHAT — Chat nội bộ (SPEC-15) · *Phase 4 — chưa seed*

⚠️ **CHAT không dùng thang `own / department / all` như các module khác.** Ranh giới dữ liệu của chat là **thành viên phòng**, không phải phạm vi tổ chức: một nhân viên có thể nhắn riêng với giám đốc (ngoài phòng ban của mình), và trưởng phòng **không** được đọc tin nhắn riêng của nhân viên trong phòng mình dù `data_scope` là `department`.

```text
Quyền CHAT.* (per-pair)  =  CỔNG MODULE     — "được dùng chat không, làm được hành động gì"
Thành viên phòng          =  RANH GIỚI DỮ LIỆU — "được đọc/ghi ở phòng nào"
```

Cả hai phải cùng đúng. Membership ép ở **service layer** qua đúng một hàm `ChatAccessService.assertMember` (SPEC-15 §3.2) — không phải ở RLS, không phải ở `data_scope`.

Ngoại lệ **duy nhất** với ranh giới membership là cặp `('view','chat-oversight')` (CHAT-DEC-004): nó **không** nới scope của cặp nào, mà mở một đường đọc **riêng** (`/chat/oversight/*`, chỉ đọc, có audit) — xem ghi chú bên dưới bảng.

| Cặp quyền (SPEC-15 §11) | Ý nghĩa | Nhân viên | Trưởng đơn vị | BOD/Admin |
| --- | --- | --- | --- | --- |
| `('access','chat')` | Cổng nav + panel nổi | có | có | có |
| `('view','chat-room')` | Xem phòng · đọc tin · **tìm kiếm** · tải tệp đính kèm | all | all | all |
| `('create','chat-room')` | Tạo phòng nhóm + mở DM | có | có | có |
| `('update','chat-room')` | Sửa tên/mô tả phòng nhóm | có (admin phòng) | có | có |
| `('archive','chat-room')` | Lưu trữ phòng nhóm | có (admin phòng) | có | có |
| `('manage','chat-member')` | Thêm/bớt/phong admin trong phòng nhóm | có (admin phòng) | có | có |
| `('send','chat-message')` | Gửi tin + đính kèm | có | có | có |
| `('recall','chat-message')` | Thu hồi tin | có (tin của mình) | có | có |
| `('pin','chat-message')` | Ghim/bỏ ghim | có (admin phòng) | có | có |
| `('view','chat-oversight')` 🔒 | **Đọc-vượt membership**: mở đích danh một phòng với tư cách quản trị, chỉ đọc, có audit | — | — | **chỉ Super Admin** |

Ghi chú:

- Cột "có (admin phòng)" = **quyền là điều kiện cần, `chat_room_members.role='admin'` là điều kiện đủ** — kiểm ở service, không phải ở seed.
- **Đúng MỘT cặp cho phép đọc phòng mình không thuộc: `('view','chat-oversight')`** (CHAT-DEC-004, owner chốt 02/08/2026 — **ngược** đề xuất Draft ban đầu). Ràng buộc bắt buộc: migration chỉ INSERT catalog `permissions`, **0** hàng `role_permissions` cho mọi role canonical (⚠️ `super-admin` **không** phải role canonical — SA nhận cặp qua `SuperAdminBootstrapService` lúc boot; grant trong migration sẽ khớp 0 hàng và đẩy người thi công sang grant lạc `company-admin`) · `is_sensitive=true` · path riêng `/chat/oversight/*` (**không** dùng chung path với đường đọc thường) · audit ghi trong **cùng transaction trước khi trả dữ liệu** · **KHÔNG** áp cho tìm kiếm. Chi tiết: [SPEC-15 §3.3](<SPEC/SPEC-15 CHAT.md>).
- **Ngoài** `('view','chat-oversight')`, mọi cặp CHAT còn lại — kể cả `('view','chat-room')` — vẫn bị membership chặn **tuyệt đối**, không có ngoại lệ nào cho role nào.
- Nếu về sau owner duyệt kiểm duyệt nội dung, cặp mới phải là `('manage','chat-report')` gắn với **tin bị báo cáo**, không phải mở rộng scope của `('view','chat-room')` hay `('view','chat-oversight')`.
- Cặp gate của **tìm kiếm** và **tải tệp** PHẢI trùng cặp của đường đọc (`view:chat-room`). Tách cặp riêng sẽ đẻ ra role "tìm được mà đọc không được" — đúng lỗ đã gặp ở `S5-TASK-COVER-1`.
- `is_sensitive` **đã chốt**: `false` cho 9 cặp thường, **`true`** cho riêng `('view','chat-oversight')`. Cặp nhạy cảm phải vào `SENSITIVE_CAPABILITY_ALLOWLIST` — **backend** `apps/api/src/permission/permission.service.ts`, pin bởi `apps/api/src/auth/auth-me-capabilities.int.spec.ts` — **cùng commit với seed**. Thiếu là màn quản trị ẩn dù DB có quyền, và test bằng chính tài khoản SA **không tái hiện được** (KI-058 đã mất một phán quyết vì đúng bẫy này ở LEAVE). FE gate bằng **`useCanExact`**, không phải `useCan` (wildcard `*:*` sẽ lọt).
- RLS+FORCE trên `chat_rooms`/`chat_room_members`/`chat_messages` đã có từ migration `0010` — đó là cô lập **tenant**, khác tầng với ranh giới **phòng**.
- Chi tiết mã lỗi/quy tắc: [SPEC-15 CHAT §11–12](<SPEC/SPEC-15 CHAT.md>); schema: [DB-12](<DB/DB-12 CHAT Database Design.md>).

---

## 10. Nguyên tắc dữ liệu nhạy cảm (SPEC-01 §11.3)

Dữ liệu nhạy cảm: lương · tài khoản ngân hàng · CCCD/CMND · hợp đồng · hồ sơ nhân sự · dữ liệu kỷ luật/nghỉ việc · chấm công chi tiết · log hệ thống.

1. Không hiển thị nếu không có quyền (mask ở **server**).
2. Không cho export nếu không có quyền export riêng.
3. Mọi thao tác xem/sửa/xuất dữ liệu nhạy cảm **ghi audit**.
4. Dữ liệu lương tách quyền riêng (Phase 2 — không mặc định cho HR nếu công ty yêu cầu kiểm soát chặt).

> Chi tiết từng quyền (điều kiện, mã lỗi deny-path, test case): xem từng SPEC trong [`docs/spec/`](./spec/). Quyền là cặp `(action, resource)` + cờ `is_sensitive`; seed `ON CONFLICT DO NOTHING` (hot-file, append).
