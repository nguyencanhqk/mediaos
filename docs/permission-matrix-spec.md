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
> ⚠️ **Gốc rễ chung:** `PermissionGuard` KHÔNG đọc `data_scope` (verify 2026-07-30: 0 hit `dataScope`
> trong `permission.guard.ts`), nên MỌI route chỉ dựa vào guard đều thừa hưởng khoảng hở. N-1 · N-2 ·
> N-1c · N-1d · N-1e là **năm lần vá cùng một lớp lỗi ở năm đường khác nhau**.
>
> ✅ **ĐÃ CÓ CƠ CHẾ 2026-08-19 — `S6-SEC-IDENTITY-PROJ-1`** (đóng KI-053 · KI-054, mở+đóng KI-069):
>
> - **L1 tầng type** — `apps/api/src/permission/identity-projection.ts`: `IdentityGrant` có brand,
>   dựng được bằng ĐÚNG 4 constructor; hàm chiếu `identityColumns()` **bắt buộc** nhận nó. Không có
>   đường "tạm thời chưa bound".
> - **L2 ratchet** — `test/foundation/identity-projection-{census,verdicts,ratchet}`: MỌI điểm chiếu
>   `users.email`/`users.fullName` phải có một dòng phán quyết đã ký, với một trong **8 căn cứ**
>   (`scoped-predicate` · `identity-gated` · `self-bound-row` · `self-bound-route` · `second-assert` ·
>   `membership` · `no-actor` · `waiver`). Điểm mới không có dòng ⇒ **ĐỎ**.
>
> ⚠️ **VÌ SAO 8 căn cứ chứ không phải "mọi điểm PHẢI nhận vị từ scope"** như `done_when` gốc phát biểu:
> đo lại cho thấy hàng loạt call-site đã an toàn nhưng **không phải bằng vị từ scope** — chúng kín bằng
> assert thứ hai trong service (`leave.service` `assertCan('manage','leave')`), bằng tự-bound theo
> `actor.id` (`attendance.listMonthly`), bằng membership (`chat` `assertMember`), hoặc là job máy
> không có actor HTTP. Một cơ chế chỉ nhận một dạng căn cứ sẽ bắt SAI hàng loạt chỗ đúng, và cái giá
> của việc bắt sai là người ta gỡ cơ chế.
>
> **Census đo lại 2026-08-19 (con số 2026-07-29 "40+ điểm / 7 module" ĐÃ BỊ BÁC BỎ):** **92 điểm chạm /
> 37 file / 13 module**, trong đó **71 PROJECTION / 34 file / 12 module** — 13 PREDICATE (lớp *oracle*
> RIÊNG, không cùng lớp lỗ), 6 ORDER BY, 2 GROUP BY. Grep thẳng trượt ba dạng: `alias(users,…)`,
> `getTableColumns(users)`, và bản đồ cột hằng ở cấp module. **71 là CẬN DƯỚI** — nguồn census là parse
> TĨNH, tức lớp bằng chứng yếu hơn `fk-tenant-census`/`route-census` (hai file đó có bất biến "0 regex
> trên mã nguồn"); ba vùng mù còn lại được PIN thành số trong sổ phán quyết.
>
> ⚠️ **RANH GIỚI — BẢN ĐỒ ĐỌC DÙNG CHUNG (đo lại 2026-08-21):** cơ chế `identityColumns` bound **CỘT
> danh tính**, nó KHÔNG bound **TẬP HÀNG**. Đó là hai tầng độc lập, mỗi tầng đi theo **cặp quyền của
> riêng nó**, và một route có thể kín tầng này mà hở tầng kia.
>
> **Vì sao bản đồ này tồn tại ở dạng BẢNG chứ không phải vài câu:** cặp `view:audit-log` gác **4
> route trên 3 bảng**, và `S10-SEC-AUDITLOGROW-1` chỉ bound HÀNG cho **2** trong số đó. Đọc một câu
> "audit-log đã bound hàng" rồi suy ra cả cặp là kín — đó đúng là cách KI-054 sinh ra ("Company-scope"
> viết trong docstring như một sự thật). Ai cấp `view:audit-log` ở scope hẹp phải đọc HÀNG của mình
> trong bảng, không đọc tiêu đề.
>
> | route | cặp GATE | TẬP HÀNG bound? | CỘT danh tính bound? | trạng thái |
> | --- | --- | --- | --- | --- |
> | `GET /auth/login-logs` | `view:audit-log` | ✔ `login_logs.user_id` | ✔ `view:user` | KI-070 **ĐÓNG** |
> | `GET /auth/security-events` | `view:audit-log` | ✔ `user_security_events.user_id` | ✔ `view:user` ×2 grant | KI-070 **ĐÓNG** |
> | `GET /foundation/audit-logs` | `view:audit-log` | ✔ `audit_logs.actor_user_id` | — (không chiếu email/tên) | KI-072 **ĐÓNG** |
> | `GET /foundation/audit-logs/:id` | `view:audit-log` | ✔ `audit_logs.actor_user_id` | — | KI-072 **ĐÓNG** |
> | `GET /auth/roles/:id/members` | `view:user` | ✔ `users.id` (qua `user_roles`) | ✔ `view:user` | KI-071 **ĐÓNG** |
>
> • **Hai bảng nhật ký — ĐÃ ĐÓNG** (`S10-SEC-AUDITLOGROW-1`, KI-070). Chặn TẬP HÀNG theo `data_scope`
>   của **chính cặp gate** `view:audit-log`: `Company`/`System` = cả tenant · `Own` = hàng có
>   `user_id = actor` · `Team`/`Department` = **0 hàng** (lattice chưa định nghĩa membership trên bảng
>   nhật ký). `?user_id=` của caller bị **GIAO** với vị từ scope, không được dùng trần. Cơ chế: brand
>   `IdentityGrant` với `basis:"scoped-predicate"` + hàm cổng `rowScopeSql()` (assert `basis` +
>   assert BẢNG); bề mặt ĐÚC vị từ bị pin thành danh sách (`ROW_SCOPE_MINT_PINS`) ⇒ mở một điểm đúc
>   mới là ĐỎ. Cột danh tính trên hai route đó VẪN đi theo cặp danh bạ `view:user` — không gộp.
>
> • **`/foundation/audit-logs` (+ `/:id`) — ĐÃ ĐÓNG 2026-08-22** (`S10-SEC-AUDITLOGROW-2`, KI-072).
>   Cùng cơ chế: `AuditQueryService.rowScopeFor()` (điểm đúc THỨ HAI trong `ROW_SCOPE_MINT_PINS`) +
>   họ `AuditRepository.*ForActorTx` nhận `rowScope` BẮT BUỘC ở CẢ `data` lẫn `count(*)`.
>   ⚠️ **`Own` ở bảng này = "hàng do TÔI GÂY RA"** (`actor_user_id`) — ngữ nghĩa KHÁC hai bảng nhật ký
>   (`Own` = hàng VỀ tôi). `audit_logs` chỉ có MỘT cột người. Hệ quả có chủ đích: **360 hàng
>   `actor_user_id IS NULL`** (job máy) không thuộc scope `Own` của ai. `/:id` ngoài scope trả **404**
>   `AUDIT_NOT_FOUND` — cùng mã với cross-tenant miss, để mã lỗi không thành oracle tồn-tại.
>   ⚠️ **PHẠM VI ĐÓNG = ĐÚNG HAI route COMPANY này**, KHÔNG phải "bảng `audit_logs` đã bound": đường
>   operator `/all` và `ChatOversightRepository.listOversightAudit` (CHAT-API-019, cặp CHAT) vẫn đọc
>   `audit_logs` không bound hàng. Xem gạch đầu dòng "Cặp KHÁC" bên dưới.
>
> • *(Bản mô tả khuyết tật gốc, giữ để đọc lịch sử)* — CÙNG CẶP `view:audit-log`, KHÔNG bound hàng:
>   `AuditQueryService.listCompany(companyId, query)` **không nhận `userId` của actor** ⇒ nó không
>   resolve `data_scope` được, kể cả nếu muốn. Vai `view:audit-log@Own` đọc trọn **13.146** hàng
>   `audit_logs` của tenant (đo 2026-08-21; so với 366 + 65 của hai bảng vừa đóng — bề mặt CÒN MỞ lớn
>   gấp ~30 lần bề mặt đã đóng), và `?actorUserId=` là đúng hình dạng V2 của KI-070: dò được lịch sử
>   hành động của một UUID bất kỳ trong tenant. Che before/after (`AuditMaskerService`) là lớp KHÁC —
>   nó che GIÁ TRỊ trong hàng, không quyết định hàng nào được trả.
>
> • **`GET /auth/roles/:id/members` — ĐÓNG 2026-08-22 (`S10-SEC-ROLEMEMBERROW-1`, KI-071).** Trước đó
>   vai giữ `view:user@Own` mất email/tên nhưng vẫn nhận trọn `userId` + `status` + `expiresAt` của
>   MỌI thành viên role. Nay tập hàng đi theo `data_scope` của **chính cặp gate** `view:user`, vị từ
>   dựng trên `users.id`/`users.company_id` (điểm đúc thứ BA của cơ chế KI-070).
>   **`Own` ở route này = "hàng NÓI VỀ tôi"** — tư cách thành viên của chính tôi; cùng họ `login_logs`,
>   KHÁC `audit_logs` (`Own` = hàng do tôi GÂY RA). `@Own` gọi role mình không có chân ⇒ **0 hàng +
>   200**, KHÔNG 404 (404 ở đó là oracle tồn-tại).
>   ⚠️ Cặp gate = cặp bound ⇒ **fail-closed**: `data_scope` không phân giải được ⇒ **403**, không còn
>   nhánh fail-soft "bỏ cột danh tính, vẫn trả hàng" của KI-053.
>
> • **Đường GHI cạnh route trên — ĐÓNG 2026-08-24 (`S10-SEC-ROLEMEMBERFE-1`, KI-073).** Thân **201**
>   của `POST /permissions/users/:userId/roles` trước đó trả NGUYÊN HÀNG `user_roles` — nhánh no-op
>   (đã là thành viên, cùng expiry) trả **hàng GỐC** với `id`/`grantedBy`/`createdAt` gốc ⇒ 1 request
>   /người dựng lại được tư cách thành viên mà KI-071 vừa giấu, **im lặng** (no-op không ghi gì).
>   Nay thân đồng nhất đúng **4 khoá** `{userId, roleId, companyId, expiresAt}` echo request cho MỌI
>   actor, CẢ BA nhánh (no-op/fresh/reassign) — audit/`user_security_events` vẫn ghi id hàng THẬT
>   (chỉ đổi hình chiếu HTTP). `GET /auth/roles/:id/members` phát thêm cờ **`complete`**
>   (= scope ∈ {Company, System} của CHÍNH actor) để FE thôi khẳng định điều nó không biết (bộ đếm ·
>   dedup batch · empty-state); contract FE parse `complete` bằng `.catch(false)` — thiếu khoá/sai
>   kiểu rơi về partial-mode CÓ NHÃN, không ZodError.
>
> • **Đường GHI thứ HAI — ĐÓNG 2026-08-25 (`S10-SEC-ROLEMEMBERDEL-1`, KI-074, ADR `DECISIONS-11`).**
>   `DELETE /permissions/users/:userId/roles/:roleId` trước đó phân biệt **404** ("không phải thành
>   viên" — ném TRƯỚC mọi ghi ⇒ **0 hàng forensic, 0 thiệt hại**) với **204** ⇒ câu trả lời ÂM MIỄN
>   PHÍ. Nay theo **hướng (b)**: GIỮ **404** cho actor có `view:user` ở scope `Company`/`System`;
>   **204 + 0 ghi** cho phần còn lại (kể cả scope `null` — "KHÔNG có thẩm quyền" ≠ `Company`). Cùng
>   một cơ chế với cờ `complete` ở trên: **bit CÓ THẨM QUYỀN về scope `view:user` của CHÍNH actor**
>   lái hình dạng câu trả lời. Ba lớp role tách nhau ở nhánh ÂM: company-scoped của tenant KHÁC →
>   **404** (BẤT BIẾN #1, RLS ép) · **system** role (`company_id IS NULL`) → **204** ·
>   operator-audience → **404**. ⚠️ Kênh THỜI GIAN (nhánh ÂM 0 ghi vs nhánh DƯƠNG 4 ghi) **KHÔNG
>   đóng theo** — ghi nhận trong ADR; đóng nó đòi ghi audit giả. ⚠️ Cờ `is_sensitive` của catalog nay
>   là một **CỔNG** của route: lật `('view','user')` sang `true` sẽ ép nhánh exact-only ⇒ mọi actor
>   wildcard-only tụt `null` ⇒ **204-mù trong im lặng** (DECISIONS-11 §6).
>
>   ⇒ Tính chất đạt được sau KI-073 **và** KI-074: *"không enumerate thành viên IM LẶNG theo CẢ HAI
>   chiều"*. Chiều CÓ-DẤU-VẾT vẫn mở **có chủ ý** — mỗi câu hỏi dương trúng đều gỡ vai THẬT và để lại
>   4 vết.
>
> ⚠️ **Cặp KHÁC, đừng đọc lây sang:** `/foundation/audit-logs/all` gate `view:platform-audit`
> (operator-only, chéo tenant) · `/attendance/audit-logs` gate `view:attendance-audit-log` ·
> `/leave/audit-logs` gate `view:leave-audit-log` · audit của TASK gate `view:task-audit-log`. Bốn
> đường này **chưa được đo** ở vế bound-HÀNG — "chưa đo" KHÔNG phải "đã kín", và cũng không phải
> "đang hở"; ai chạm tới chúng thì đo trước.
>
> ⚠️ **ĐƯỜNG ĐỌC `audit_logs` THỨ NĂM, đo 2026-08-22 (census của `S10-SEC-AUDITLOGROW-2`):**
> `ChatOversightRepository.listOversightAudit` (`chat-oversight.repository.ts:335-399`,
> `CHAT-API-019`, gate cặp CHAT + `ChatOversightAuditGuard`) đọc thẳng `audit_logs` với **đúng hình
> dạng V2**: `opts.actorUserId` từ caller đi THẲNG vào `WHERE` (`:352-354`), **0 vị từ row-scope**,
> chiếu `users.fullName` bằng `leftJoin` trần (`:386-389`, không qua `identityColumns`) và trả
> `auditLogs.metadata` **THÔ** (`:381`) trong khi đường foundation coi `metadata` là phải
> `masker.mask()`. **Chưa có WO/KI** — cặp quyền khác, cần số hiệu riêng.
>
> ⚠️ **LUẬT VẬN HÀNH SAU KHI KI-071 ĐÓNG (2026-08-22) — thay cho workaround cũ.** Workaround cũ
> (*"không cấp `view:user` ở scope hẹp hơn `Company` cho vai nào"*) **đã hết hiệu lực và không được
> chép lại**: nó mâu thuẫn trực tiếp với mục đích bản vá, vốn làm `@Own` thành cấu hình **cấp được
> và CÓ HIỆU LỰC ở tầng HÀNG**. Ba điều người cấp quyền phải biết:
> (1) `@Own` nay cắt TẬP HÀNG chứ không chỉ cột — vai đó chỉ còn thấy tư cách thành viên của chính mình;
> (2) `@Team`/`@Department` = **0 hàng** (fail-closed) và lưới **KHÔNG đơn điệu** — giữ đồng thời
> `@Own` + `@Team` resolve ra `Team` ⇒ **MẤT** hàng, tức thêm một role có thể LÀM MẤT quyền xem;
> (3) cặp này `is_sensitive = false` nên `exact` **THẮNG** `wildcard` — cấp `view:user@Own` cho vai
> đang giữ `*:*@Company` là **HẠ** vai đó xuống `Own` trên cả hai tầng. Đo 2026-08-22: `view:audit-log` có **3 vai giữ** (`SA` 2 người sống ·
> `QUẢN LÝ CẤP CAO` 4 hàng `user_roles`/3 active · `company-admin` 2) và `view:user` có **4 vai**
> (ba vai trên + `hr`, 0 người giữ) — **tất cả đều `@Company`**, 0 hàng `DENY` ⇒ hôm nay chưa ai chạm
> được lớp này. Đó là lý do KI-071 là lỗ TIỀM TÀNG, không phải sự cố đang chảy.
> *(Đính chính số 21/08 "SA 10 người": con số đó đếm cả hàng `user_roles` đã soft-delete; đếm sống ra
> 2. Kết luận không đổi — cả ba vẫn `@Company`.)*
>
> ⚠️ Lưới scope KHÔNG đơn điệu ở mọi chỗ dùng lattice này: `Team`/`Department` fail-closed 0 hàng nên
> **hẹp hơn** `Own`, và `resolveStrongestScope` lấy scope MẠNH nhất ⇒ thêm một role có thể LÀM MẤT
> hàng. Sai về phía hẹp (không bao giờ về phía rò); sàn hoá là nợ **N-1b** và phải làm cho cả ba
> đường cùng lúc.
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

## 9d. ASSET — Quản lý tài sản (SPEC-13) · *Phase 3 — wave S11-OFFICE, chưa seed*

ASSET đứng riêng, **11 cặp** quyền per-(action, resource) theo SPEC-13 §11 — owner duyệt gói wave 28/08/2026. Data scope **chốt cùng migration seed** (S11-ASSET-DB-1, KHÔNG để mở sau — flip sau đụng pin canonical-seed). Ngoài 4 role canonical, wave này seed thêm **role hệ thống `asset-manager`** (SPEC-01 §10.8; `roles.company_id IS NULL`, `is_system=true`, tiền lệ `hr-manager` mig `0019`) — **không** phải role canonical, không được thêm vào `DashCanonicalRole`/`NOTI_CANONICAL_ROLES`/pin `auth-seed-canonical-roles`.

| Cặp quyền (SPEC-13 §11) | Ý nghĩa | Nhân viên | Trưởng đơn vị | HR | BOD/Admin · Asset Manager |
| --- | --- | --- | --- | --- | --- |
| `('access','asset')` | Cổng nav menu Tài sản | có | có | có | có |
| `('view','asset')` | Xem loại · tài sản · lịch sử cấp phát/bảo trì · đợt kiểm kê · thống kê · **`/me/assets`** | **own** (tài sản mình đang/đã giữ) | **department** (tài sản nhân viên đơn vị mình đang giữ) | all | all |
| `('create','asset')` | Tạo hồ sơ tài sản | không | không | không | all |
| `('update','asset')` | Sửa thông tin mô tả (không đổi `status`/`asset_code`) | không | không | không | all |
| `('delete','asset')` | Xoá mềm hồ sơ nhập nhầm (chỉ `In Stock`, 0 lịch sử) | không | không | không | all |
| `('assign','asset')` | Cấp phát cho nhân viên | không | không | không | all |
| `('revoke','asset')` | Thu hồi | không | không | không | all |
| `('dispose','asset')` | Thanh lý (`Disposed`) · ghi nhận mất (`Lost`) · tìm thấy lại | không | không | không | all |
| `('manage','asset-category')` | CRUD loại tài sản | không | không | không | all |
| `('manage','asset-maintenance')` | Mở/đóng lượt bảo trì | không | không | không | all |
| `('manage','asset-inventory')` | Mở/đánh dấu/đóng đợt kiểm kê | không | không | không | all |

Ghi chú:

- **`is_sensitive` chốt `false` cho cả 11 cặp.** Dữ liệu tài sản không thuộc danh sách nhạy cảm §10; trường **tài chính** (`purchase_price` · `supplier` · `asset_maintenances.cost`) chỉ trả ở scope **Company** — che ở **server** cho cả Own lẫn Department (SPEC-13 §18), không dựng cặp nhạy cảm riêng. **Danh tính người giữ** cũng lọc theo scope (người giữ cũ ở Own không thấy ai đang giữ; Department chỉ thấy nhân viên trong đơn vị — SPEC-13 §13.6).
- **Cặp gate của `/me/assets` PHẢI là chính cặp đọc `('view','asset')`** (scope Own) — không tách `ASSET.ASSIGNMENT.VIEW` như bản dự kiến của hồ sơ duyệt HTML. Tách cặp đọc thành hai sẽ đẻ ra role "thấy danh sách của mình mà không mở được chi tiết" — bài học `read-path-gate-pair-must-match-download-pair` (S5-TASK-COVER-1).
- Cột **department** là ràng buộc thật: chỉ tài sản có lượt cấp phát `Active` mà người giữ thuộc đơn vị mình (∪ đơn vị mình làm trưởng). Tài sản `In Stock` (không ai giữ) **chỉ** hiện ở scope Company. `access` seed scope Own cho mọi role (mẫu 0506).
- **Ma trận seed = 28 hàng** `role_permissions`: `employee` 2 · `manager` 2 · `hr` 2 · `company-admin` 11 · `asset-manager` 11 (`access`@Own, 10 cặp còn lại @Company). Migration verify fail-loud đúng số; `super-admin` không enumerate (nhận qua `SuperAdminBootstrapService`).
- RLS+FORCE cô lập **tenant** trên 6 bảng `asset_*`; data scope (own/department/all) ép ở **service layer** qua `buildReadScopeExists` pattern (không phải RLS). Ngoài scope → **404** (không 403 — chống dò sự tồn tại).
- FSM 5 trạng thái tài sản (SPEC-01 §17.8) ép ở service; chốt cuối "một lượt đang sống" là partial unique ở DB (DB-15 §6.3–6.5).
- Chi tiết mã lỗi/quy tắc: [SPEC-13 ASSET §11–13](<SPEC/SPEC-13 ASSET.md>); schema: [DB-15](<DB/DB-15 ASSET Database Design.md>); API: [API-14](<API Design/API-14_ASSET_API_Design.md>).

---

## 9e. ROOM — Quản lý phòng họp (SPEC-14) · *Phase 3 — wave S11-OFFICE, chưa seed*

ROOM đứng riêng, **5 cặp** quyền per-(action, resource) theo SPEC-14 §11 — owner duyệt gói wave 28/08/2026. Data scope **chốt cùng migration seed** (S11-ROOM-DB-1, KHÔNG để mở sau). Ngoài 4 role canonical, wave này seed thêm **role hệ thống `office-admin`** (SPEC-01 §10.9; `roles.company_id IS NULL`, `is_system=true`, `requires_two_factor=false` tường minh; tiền lệ `hr-manager` mig `0019`, `asset-manager` §9d) — **không** phải role canonical, không được thêm vào `DashCanonicalRole`/`NOTI_CANONICAL_ROLES`/pin `auth-seed-canonical-roles`.

| Cặp quyền (SPEC-14 §11) | Ý nghĩa | Nhân viên | Trưởng đơn vị | HR | BOD/Admin · Office Admin |
| --- | --- | --- | --- | --- | --- |
| `('access','room')` | Cổng nav menu Phòng họp | có | có | có | có |
| `('view','room')` | Xem phòng · **lịch mọi phòng** (mọi lượt trong company) · phòng trống · chi tiết lượt · thống kê sử dụng · `/me/room-bookings` | **all** | **all** | **all** | all |
| `('book','room')` | Tạo lượt đặt phòng | **own** (organizer = chính mình) | **own** | **own** | **all** (đặt hộ — `organizerUserId`) |
| `('cancel','room-booking')` | Huỷ lượt đặt | **own** (lượt mình tổ chức) | **own** | **own** | **all** (mọi lượt) |
| `('manage','room')` | CRUD phòng · kích hoạt/vô hiệu · xoá mềm | không | không | không | all |

Ghi chú:

- **`is_sensitive` chốt `false` cho cả 5 cặp.** Lịch phòng (tiêu đề · giờ · người tổ chức · người tham dự) là **dữ liệu dùng chung** của công ty, không thuộc danh sách nhạy cảm §10 — ai cũng cần thấy toàn bộ lịch để biết phòng bận. Vì vậy `('view','room')` là **all cho mọi role**; `/me/room-bookings` là **bộ lọc** theo caller trên cùng cặp đọc, không phải scope riêng (tinh chỉnh so với hồ sơ HTML dự kiến tách `ROOM.BOOKING.VIEW` — họ lỗi `read-path-gate-pair-must-match-download-pair`).
- **Scope ở cặp GHI là ràng buộc thật:** `book@own` ⇒ `organizerUserId` (nếu gửi) phải bằng user gọi, khác ⇒ **403 ROOM-ERR-010**; `cancel@own` ⇒ chỉ lượt `organizer_user_id = caller`, lượt của người khác ⇒ **403** `AUTH-ERR-SCOPE-DENIED` (lịch công khai trong company nên không cần 404 che sự tồn tại như ASSET; **cross-tenant** vẫn 404). `ROOM.BOOKING.MANAGE` của hồ sơ HTML = chính `cancel@all`, không cần cặp riêng.
- **Ma trận seed = 22 hàng** `role_permissions`: `employee` 4 · `manager` 4 · `hr` 4 (`access`@Own · `view`@Company · `book`@Own · `cancel`@Own) · `company-admin` 5 · `office-admin` 5 (`access`@Own, 4 cặp còn lại @Company). Migration verify fail-loud đúng số; `super-admin` không enumerate.
- **6 cặp di sản `('view'|'create'|'update'|'cancel','meeting')` · `('view'|'manage','meeting_room')`** (mig `0052`, mỗi cặp 2 grant đo 29/08/2026, **0** guard dùng) bị **xoá grant + xoá cứng** ở `S11-ROOM-DB-1` bước B (mig `0553` — `permissions` không có `deleted_at`; 12 grant đo được đều thuộc 2 role tenant) — không có cửa sổ 403 vì không code nào ép; không tái dụng vì tên resource khác chuẩn `room`/`room-booking`.
- RLS+FORCE cô lập **tenant** trên `meeting_rooms` · `room_bookings` · `room_booking_attendees`; data scope own/all ép ở **service layer**. Chống trùng lịch là ràng buộc **DB** (EXCLUDE gist — DB-16 §6.2), không phải quyền.
- Chi tiết mã lỗi/quy tắc: [SPEC-14 ROOM §11–13](<SPEC/SPEC-14 ROOM.md>); schema: [DB-16](<DB/DB-16 ROOM Database Design.md>); API: [API-15](<API Design/API-15_ROOM_API_Design.md>).

---

## 9f. RECRUIT — Tuyển dụng (SPEC-12) · *ĐÃ SEED 31/08/2026 (S12-RECRUIT-DB-1, mig `0560`)*

RECRUIT đứng riêng, **16 cặp** quyền per-(action, resource) theo SPEC-12 §11 — owner duyệt gói wave 31/08/2026 (REC-DEC-001..008). Data scope **chốt cùng migration seed** (S12-RECRUIT-DB-1, KHÔNG để mở sau). Ngoài 4 role canonical, wave này seed thêm **role hệ thống `recruiter`** (SPEC-01 §10.7; `roles.company_id IS NULL`, `is_system=true`, `requires_two_factor=false` tường minh; tiền lệ `asset-manager` §9d, `office-admin` §9e) — **không** phải role canonical, không được thêm vào `DashCanonicalRole`/`NOTI_CANONICAL_ROLES`/pin `auth-seed-canonical-roles`. Hiring manager = role `manager` hiện có, **không** role mới (REC-DEC-008).

| Cặp quyền (SPEC-12 §11) | `is_sensitive` | Ý nghĩa | Nhân viên | Trưởng đơn vị | HR | BOD/Admin · Recruiter |
| --- | --- | --- | --- | --- | --- | --- |
| `('access','recruit')` | false | Cổng nav menu Tuyển dụng | không | có | có | có |
| `('view','job-opening')` | false | Xem vị trí tuyển + đếm ứng viên | không | không | all | all |
| `('create','job-opening')` | false | Tạo vị trí | không | không | không | all |
| `('update','job-opening')` | false | Sửa · gán recruiter · đổi trạng thái FSM | không | không | không | all |
| `('view','candidate')` | **true** | Xem ứng viên · timeline · ghi chú · tệp CV (email/phone **dạng che**) | không | không | all | all |
| `('create','candidate')` | **true** | Tạo hồ sơ + check-duplicate + upload CV | không | không | không | all |
| `('update','candidate')` | **true** | Sửa hồ sơ — người giữ cặp này thấy email/phone **không che** | không | không | không | all |
| `('move-stage','candidate')` | **true** | Chuyển stage kèm lý do (sổ append-only) | không | không | không | all |
| `('comment','candidate')` | **true** | Ghi chú nội bộ | không | không | không | all |
| `('export','candidate')` | **true** | Export danh sách (audit bắt buộc) | không | không | không | all |
| `('convert','candidate')` | **true** | Chuyển ứng viên trúng tuyển → nhân viên HR | không | không | all | all |
| `('view','interview')` | false | Xem lượt phỏng vấn + feedback | không | **own** (lượt mình được xếp) | all | all |
| `('manage','interview')` | false | Xếp/sửa/kết thúc/huỷ lượt | không | không | không | all |
| `('feedback','interview')` | false | Ghi/sửa feedback **của mình** trên lượt mình tham gia | không | **own** | **own** | **own** |
| `('view','offer')` | false | Xem offer (**không** thấy lương) | không | không | all | all |
| `('manage','offer')` | false | Tạo/sửa/đổi trạng thái offer + **thấy lương** | không | không | không | all |

Ghi chú:

- **7 cặp resource `candidate` mang `is_sensitive = true`** (REC-DEC-003 — PII ứng viên), 9 cặp còn lại `false` — chốt cùng seed, không flip sau (bẫy `canonical-seed-pin-regression`). Cặp sensitive phải khai **allowlist capability ở BACKEND** cùng WO BE (kẻo màn quản trị biến mất với chính role được grant).
- **Masking là tầng thứ hai, tách khỏi cặp quyền:** email/phone che ở server trừ khi caller giữ `('update','candidate')`; `offers.salary` chỉ trả cho `('manage','offer')` — không dựng cặp nhạy cảm riêng cho lương (SPEC-12 §18).
- **`('feedback','interview')` scope Own cho MỌI role** — feedback bản chất là "của tôi trên lượt tôi tham gia"; điều kiện participant kiểm ở service (RECRUIT-ERR-011). Đường đọc tệp CV dùng **chính cặp đọc** `('view','candidate')` qua resolver Foundation Files (họ lỗi `read-path-gate-pair-must-match-download-pair`).
- **Ma trận seed = 42 hàng** `role_permissions`: `employee` 0 · `manager` 3 (`access`@Own · `view:interview`@Own · `feedback:interview`@Own) · `hr` 7 (`access`@Own · `view` job-opening/candidate/interview/offer @Company · `convert:candidate`@Company · `feedback:interview`@Own) · `company-admin` 16 · `recruiter` 16 (`access`@Own · `feedback`@Own · 14 cặp @Company). Migration verify fail-loud đúng số; `super-admin` không enumerate (nhận qua `SuperAdminBootstrapService`).
- RLS+FORCE cô lập **tenant** trên 8 bảng RECRUIT; own-scope interview ép ở **service layer** (`EXISTS interview_participants` theo employee của caller). Ngoài scope → **404** (không 403 — chống dò sự tồn tại); riêng ghi feedback khi thấy lượt ở Company mà không tham gia → **403** (RECRUIT-ERR-011).
- 4 FSM (ứng viên · vị trí · phỏng vấn · offer — SPEC-01 §17.11–17.14) ép ở service; chốt cuối ở DB: UNIQUE `candidates.employee_id` (double-convert) · partial unique 1 offer sống · unique feedback per interviewer (DB-14 §6).
- Chi tiết mã lỗi/quy tắc: [SPEC-12 RECRUIT §11–13](<SPEC/SPEC-12 RECRUIT.md>); schema: [DB-14](<DB/DB-14 RECRUIT Database Design.md>); API: [API-17](<API Design/API-17_RECRUIT_API_Design.md>).

---

## 9g. PAYROLL — Tiền lương (SPEC-11) · *Phase 2 — wave S13-PAYROLL, chưa seed*

PAYROLL đứng riêng, **17 cặp** quyền per-(action, resource) theo SPEC-11 §11.1 — owner duyệt gói wave 31/08/2026 (PAY-DEC-001..010). Data scope **chốt cùng migration seed** (`S13-PAYROLL-DB-1`, KHÔNG để mở sau). Ngoài 4 role canonical, wave này seed thêm **role hệ thống `payroll-officer`** (SPEC-01 §10.6; `roles.company_id IS NULL`, `is_system=true`, **`requires_two_factor=TRUE`** — khác tiền lệ `asset-manager` §9d / `office-admin` §9e / `recruiter` §9f vốn để `false`, vì lương là vùng crown) — **không** phải role canonical, không được thêm vào `DashCanonicalRole`/`NOTI_CANONICAL_ROLES`/pin `auth-seed-canonical-roles`. Id cố định **`…0015`**.

**Nguyên tắc nền — DECISIONS-01 «Phương án B» (Block-code):** quyền lương là nhóm **độc lập**, **KHÔNG mặc định cho HR**. Sau wave này `hr`, `hr-manager` và `manager` giữ **0 cặp PAYROLL**.

| Cặp quyền (SPEC-11 §11.1) | `is_sensitive` | Ý nghĩa | Nhân viên | Trưởng đơn vị · HR · HR Manager | Payroll Officer | BOD/Admin |
| --- | --- | --- | --- | --- | --- | --- |
| `('access','payroll')` | false | Cổng nav menu Tiền lương | **own** | không | own | own |
| `('view','payroll-period')` | false | Xem danh sách/chi tiết kỳ — **không số tiền** | không | không | all | all |
| `('manage','payroll-period')` | false | Tạo kỳ · cấu hình · gắn kỳ công · **khoá kỳ** (cấu hình kỳ — PAY-DEC-006) | không | không | all | all |
| `('view-line','payroll-period')` | **true** | **Đọc dòng bảng lương (CÓ TIỀN)** + tổng chi phí kỳ + vế đọc export — **cặp ĐỌC thuần** | không | không | all | all |
| `('calculate','payroll-period')` | **true** | Gom đầu vào · tính · điều chỉnh dòng · gửi duyệt (**ghi**) | không | không | all | all |
| `('approve','payroll-period')` | **true** | Duyệt / từ chối bảng lương — **KHÔNG gán Payroll Officer** (four-eyes, PAY-DEC-007) | không | không | **không** | all |
| `('publish','payroll-period')` | **true** | Sinh phiếu lương + phát hành cho nhân viên | không | không | all | all |
| `('reopen','payroll-period')` | **true** | Mở lại kỳ (lý do bắt buộc + audit) | không | không | all | all |
| `('view','salary-profile')` | **true** | Xem hồ sơ lương + lịch sử phiên bản (+ danh bạ chọn người) | không | không | all | all |
| `('manage','salary-profile')` | **true** | Tạo phiên bản mới · sửa · xoá mềm | không | không | all | all |
| `('view','bonus-penalty')` | **true** | Xem thưởng/phạt/khấu trừ theo kỳ | không | không | all | all |
| `('manage','bonus-penalty')` | **true** | Tạo · sửa khi `Pending` · xoá mềm | không | không | all | all |
| `('approve','bonus-penalty')` | **true** | Duyệt / từ chối (tự duyệt bị chặn ở service — PAYROLL-ERR-012) | không | không | all | all |
| `('export','payroll')` | **true** | Export XLSX bảng lương (audit bắt buộc) | không | không | all | all |
| `('view-payslip','payslip')` *(di sản `0097` — GIỮ)* | **true** | Xem phiếu lương của **người khác** | không | không | all | all |
| `('view-own-payslip','payslip')` *(di sản `0180` — GIỮ)* | **true** | Xem phiếu lương **của mình** | **own** | không | không | không |
| `('acknowledge-own-payslip','payslip')` *(di sản `0132` — GIỮ)* | false | Xác nhận phiếu lương của mình | **own** | không | không | không |

Ghi chú:

- **13 cặp `is_sensitive = true`**, 4 cặp `false` (`access:payroll` cổng nav · `view:payroll-period` không chở số tiền · `manage:payroll-period` cấu hình kỳ · `acknowledge-own-payslip` không chở số tiền) — đúng PAY-DEC-006 «cặp payroll nhạy cảm **trừ cấu hình kỳ**». Chốt cùng seed, **không flip sau** (bẫy `canonical-seed-pin-regression`). 13 cặp sensitive phải khai **allowlist capability ở BACKEND** cùng WO BE (kẻo màn quản trị biến mất với chính role được grant).
- **Ba cặp họ `payslip` giữ NGUYÊN TÊN di sản** (kiểu action-carries-resource) thay vì đổi sang bộ `(action, resource)` sạch: `view-own-payslip` đang có **grant sống cho `employee` từ `0180`** mà PAY-DEC-006 yêu cầu giữ, và `view-payslip` đang là fixture của `permission-admin.int-spec.ts`. Đổi tên phá cả hai.
- **Four-eyes là ràng buộc QUYỀN, không chỉ kiểm tra runtime:** `('approve','payroll-period')` **không** nằm trong grant của `payroll-officer`. Service kiểm thêm `submitted_by ≠ approved_by` (**PAYROLL-ERR-005**), và DB có CHECK `payroll_periods_four_eyes_check` làm chốt cuối — ba tầng.
- **Cặp ĐỌC tiền tách khỏi cặp GHI** (`view-line` ≠ `calculate`): dòng bảng lương (`GET /payroll-periods/{id}/lines`), tổng chi phí (`/payroll-periods/summary`), vế đọc export và widget DASH `PAYROLL_COST` đều gác bằng **`('view-line','payroll-period')`** (+ **SÀN scope `Company`** cho summary/widget) — KHÔNG bằng `('view','payroll-period')` (cố ý không nhạy cảm) và KHÔNG bằng `calculate` (gộp thì người chỉ có `approve` **duyệt mù**, và ai thấy widget đều ghi được lương). **Mọi role giữ `('approve','payroll-period')` BẮT BUỘC được cấp kèm `('view-line','payroll-period')`** — migration verify fail-loud.
- **Export đòi CẢ HAI cặp** `('export','payroll')` **và** `('view-line','payroll-period')` — cổng export đứng một mình là đường đọc lương rộng hơn đường đọc từng dòng (bài học RECRUIT §9f H5).
- **Masking là tầng thứ hai, tách khỏi cặp quyền:** trường tiền **vắng khoá** (không `null`, không `0`) khi caller không giữ cặp tương ứng; FE schema `.optional()`. **Mọi lượt đọc số lương của người khác ghi `audit_logs` trong cùng transaction** (khuôn reveal+audit atomic của `hr-read.service`); `/me/payslips*` **không** ghi audit.
- **Ma trận seed = 32 hàng** `role_permissions`: `employee` **3** (`access`@Own · `view-own-payslip`@Own · `acknowledge-own-payslip`@Own) · `manager` **0** · `hr` **0** · `hr-manager` **0** · `payroll-officer` **14** (`access`@Own + 13 cặp @Company) · `company-admin` **15** (`access`@Own + 14 cặp @Company). Migration verify fail-loud đúng số; `super-admin` không enumerate (nhận qua `SuperAdminBootstrapService`).
- **Hai điều kiện verify fail-loud trong migration:** (1) mọi role giữ `('manage','bonus-penalty')` **phải** giữ `('view','salary-profile')` — `PAYROLL-API-034` (danh bạ nhân sự) gác bằng cặp sau; (2) mọi role giữ `('approve','payroll-period')` **phải** giữ `('view-line','payroll-period')` — kẻo người duyệt không đọc được bảng lương. `payroll-officer` giữ **0 cặp ngoài PAYROLL** ⇒ danh sách kỳ công phải đi qua `PAYROLL-API-035`, không qua `GET /attendance/periods` (`('read','attendance')`).
- RLS+FORCE cô lập **tenant** trên 7 bảng PAYROLL; own-scope phiếu lương ép ở **service layer** (`payslips.user_id` = user của caller **và** kỳ ∈ `Paid`/`Locked`). Ngoài scope → **404** (không 403 — chống dò sự tồn tại).
- 3 bộ trạng thái (SPEC-01 §17.15–17.17) ép ở service; chốt cuối ở DB: `UNIQUE (company_id, payroll_period_id, user_id)` trên `payslips` · `UNIQUE (company_id, period_month)` trên kỳ · `UNIQUE (company_id, user_id, effective_date)` trên hồ sơ lương · CHECK four-eyes (DB-13 §6).
- Chi tiết mã lỗi/quy tắc: [SPEC-11 PAYROLL §11–13](<SPEC/SPEC-11 PAYROLL.md>); schema + **bản đồ reconcile**: [DB-13 §5](<DB/DB-13 PAYROLL Database Design.md>); API: [API-18](<API Design/API-18_PAYROLL_API_Design.md>).

### 9g.1 THU HỒI quyền lương di sản — 19 cặp / 5 migration (PAY-DEC-006)

> ⚠️ Hồ sơ duyệt ghi tay chỉ nhắc `0092`/`0097`/`0180`. Đo bằng grep toàn bộ `apps/api/migrations/` ngày 31/08/2026 cho thấy họ lương trải **5 migration / 19 cặp**. Hai lỗ thật:
>
> 1. **`('approve-payroll-period','payroll_period')` và `('publish-payroll-period','payroll_period')` (`0132`) để `is_sensitive = false`** ⇒ **duyệt và phát hành lương đang kế thừa được qua wildcard `*:*`**.
> 2. **4 cặp `payslip` của `0005:282-285`** (`create`/`read`/`update`/`delete`, đều `is_sensitive=false`) dính **blanket-grant `WHERE p.is_sensitive = false` KHÔNG điều kiện** ở `0005:310-313` — **chỉ của `company-admin` (`…0001`)**. *(Đính chính phép đo: 7 role hệ thống thời media còn lại (`0005:317-433`) đều có thêm `AND (action, resource_type) IN (…)` liệt kê cụ thể và **không** chứa cặp `payslip` nào.)* Trong bốn cặp đó, `('update','payslip')` mâu thuẫn thẳng bất biến #2 (phiếu lương append-only).
>
> **GRANT trong migration cũ ≠ hiện trạng DB** (`grant-in-old-migration-is-not-current-state`): WO DB **phải ĐO bảng thật** (`permissions ⋈ role_permissions ⋈ roles`) trước khi viết lệnh thu hồi.

| Cặp di sản | sensitive | Nguồn | Xử lý |
| --- | --- | --- | --- |
| `('create','payslip')` · `('read','payslip')` · `('update','payslip')` · `('delete','payslip')` · `('view-salary','payslip')` | 4× false, 1× true | `0005` | **GỠ cả 5** (+ mọi grant) |
| `('view-salary-profile','salary_profile')` · `('manage-salary-profile','salary_profile')` | true | `0092` | **GỠ** → thay bằng `('view'/'manage','salary-profile')` |
| `('manage-payroll-period','payroll_period')` · `('run-payroll','payroll_period')` · `('read-payslip','payslip')` | false/true/true | `0097` | **GỠ** → thay bằng `('manage','payroll-period')` / `('calculate','payroll-period')` / *(trùng `view-payslip`)* |
| `('manage-bonus-penalty',…)` · `('approve-bonus-penalty',…)` · `('view-bonus-penalty','bonus_penalty')` | true | `0099` | **GỠ** → thay bằng `('manage'/'approve'/'view','bonus-penalty')` |
| `('approve-payroll-period','payroll_period')` · `('publish-payroll-period','payroll_period')` | **false ⚠️** | `0132` | **GỠ** → thay bằng `('approve'/'publish','payroll-period')` **`is_sensitive=true`** — vá lỗ wildcard |
| `('resolve-payslip-dispute','payslip')` | true | `0132` | **GỠ** — khiếu nại ngoài v1, mở lại cùng PARK-PAYROLL-001 |
| `('view-payslip','payslip')` | true | `0097` | **GIỮ** — vào bảng §9g; **thu hồi grant `hr-manager`** |
| `('view-own-payslip','payslip')` | true | `0180` | **GIỮ nguyên grant `employee`** |
| `('acknowledge-own-payslip','payslip')` | false | `0132` | **GIỮ grant `employee`**; thu hồi grant `company-admin` + `hr-manager` |

> 📏 **ĐO THẬT khi thi công `S13-PAYROLL-DB-1` (01/09/2026) — bề mặt RỘNG HƠN tài liệu 31/08.**
> Ngoài ba role hệ thống (`company-admin` 13 cặp · `hr-manager` 12 · `employee` 2), **ba role TUỲ BIẾN của
> tenant** cũng đang giữ grant lương di sản: `QUẢN LÝ CẤP CAO` (19 cặp) · `SA` (19) · `SEO` (2). Luật "xoá
> **mọi** hàng `role_permissions` trỏ 16 cặp GỠ" đã phủ chúng, nhưng verify «đúng 32 hàng» chỉ đạt nếu **cũng**
> xoá grant của chúng trên **3 cặp GIỮ** ⇒ mig `0565` bước (3c) xoá SẠCH grant của cả 19 cặp trước khi seed lại.
> **Hệ quả có chủ đích: sau wave này 3 role tuỳ biến giữ 0 cặp PAYROLL.** Chấp nhận được vì PAYROLL có **0 route**
> ở thời điểm chạy (không ai đang dùng) và PAY-DEC-006 định nghĩa quyền lương là khối độc lập; cấp lại được lúc
> chạy qua `permission-admin`. Đo thêm: `object_permissions` = **0 hàng** cho cả 19 cặp (cascade `0005:154` là
> NO-OP thực tế), và `('view-own-payslip','payslip')` của `employee` đang ở scope **@Company** chứ không phải
> **@Own** như bảng §9g ghi — vòng grant `DELETE data_scope <> 'Own'` + INSERT tự sửa.

**Trình tự bắt buộc trong migration seed** (DB-13 §10 bước B): thu hồi **TRƯỚC**, seed cặp mới **SAU** — xoá mọi hàng `role_permissions` **VÀ `object_permissions`** trỏ **16 cặp GỠ** rồi xoá 16 cặp khỏi `permissions`. ⚠️ `object_permissions.permission_id` là **`ON DELETE CASCADE`** (`0005:154`) ⇒ xoá cặp cascade âm thầm: phải ĐO trước rồi xoá tường minh. **Với cặp GIỮ `view-payslip`** (vốn *giữ ngữ nghĩa object-permission override*): thu hồi grant `hr-manager` ở **cả hai** bảng — chỉ xoá `role_permissions` là để lại đường đọc phiếu lương sống trong khi verify vẫn XANH. Verify fail-loud: `hr-manager` = **0 cặp PAYROLL trên CẢ BA bảng**, 16 cặp GỠ = **0 hàng** ở cả ba. Cặp `('view-salary','employee')` (`0019`, domain HR — masking hồ sơ nhân sự của SPEC-03) **KHÔNG đụng tới**. Tiền lệ xoá cặp mồ côi + grant: `0548` (27 cặp / 89 grant của cụm workflow).

---

## 10. Nguyên tắc dữ liệu nhạy cảm (SPEC-01 §11.3)

Dữ liệu nhạy cảm: lương · tài khoản ngân hàng · CCCD/CMND · hợp đồng · hồ sơ nhân sự · dữ liệu kỷ luật/nghỉ việc · chấm công chi tiết · log hệ thống.

1. Không hiển thị nếu không có quyền (mask ở **server**).
2. Không cho export nếu không có quyền export riêng.
3. Mọi thao tác xem/sửa/xuất dữ liệu nhạy cảm **ghi audit**.
4. Dữ liệu lương tách quyền riêng (Phase 2 — không mặc định cho HR nếu công ty yêu cầu kiểm soát chặt).

> Chi tiết từng quyền (điều kiện, mã lỗi deny-path, test case): xem từng SPEC trong [`docs/spec/`](./spec/). Quyền là cặp `(action, resource)` + cờ `is_sensitive`; seed `ON CONFLICT DO NOTHING` (hot-file, append).
