# PLAN — CS Console "Hệ thống" Upgrade (bám MISA AMIS)

> Master plan đa-lane cho việc nâng cấp **apps/console** (app "Hệ thống", aud=user, tenant-plane) thành
> bộ quản trị đầy đủ theo mô hình module **"Hệ thống" của MISA AMIS**.
> Bắt buộc rà soát bằng agent `plan-reviewer` tới PASS trước khi code lane 🔴.
> Tham chiếu chuẩn vận hành: `CLAUDE.md` §2/§3/§6/§9 · `docs/AUTOMATION-PLAYBOOK.md`.

## Meta

- **Mã:** CS (Console-System) · **Lane:** CS-1 … CS-10
- **Vùng rủi ro chủ đạo:** 🟡 vàng (đa số CRUD/UI) — riêng CS-8 (mail secret) + CS-9 (security policy) = 🔴 crown-jewel
- **Model chính:** Sonnet (mặc định) · Opus cho CS-2/CS-8/CS-9 (permission/secret/auth)
- **Ước lượng tổng:** XL (chia 10 lane S–M, 3 đợt)
- **Ngày lập:** 2026-06-18

---

## 1. Mục tiêu

Sau khi xong, **apps/console** trở thành trung tâm quản trị nội bộ của một công ty (tenant) ngang tầm
module "Hệ thống" MISA AMIS: quản lý hồ sơ công ty, cơ cấu tổ chức, người dùng/nhân viên, phân quyền,
theo dõi tình hình sử dụng, cấu hình mail, chính sách bảo mật nâng cao, nhật ký hoạt động và thùng rác —
tất cả **tenant-scoped** (RLS), không lẫn với operator plane (apps/admin).

## 2. Bối cảnh

**Hiện trạng console** (4 mục, [nav.ts](../../apps/console/src/lib/nav.ts)): Tài khoản nền tảng (secret kênh),
Break-glass, Bảo mật tài khoản (2FA self-service), Cài đặt công ty (tối giản).

**Đích (ảnh tham chiếu MISA AMIS "Hệ thống"):** Thông tin công ty · Quản lý danh mục (Cơ cấu tổ chức ·
Vị trí công việc · Đối tượng: Người dùng/Nhân viên/Chờ duyệt/Kích hoạt) · Phân quyền · Tình hình sử dụng ·
Cấu hình mail server · Bảo mật nâng cao · Thiết lập chung · Nhật ký hoạt động · Thùng rác.

**Nguyên tắc:** tái dùng tối đa backend đã có; mirror UI pattern từ apps/admin (RBAC, audit) + apps/people
(employees, departments) + apps/studio (dashboard); chỉ xây mới phần thật sự thiếu.

## 3. Scope

**Trong scope:**

- Tái cấu trúc IA sidebar console thành nhóm có category/subcategory (hiện đang phẳng, chung `system`).
- 10 lane CS-1…CS-10 (mục §6) phủ toàn bộ menu MISA "Hệ thống".
- Backend mới ở những lane thiếu: hồ sơ công ty mở rộng, thùng rác/restore, tình hình sử dụng (last-login),
  cấu hình mail server, chính sách bảo mật per-company, luồng mời/duyệt user.

**Ngoài scope (KHÔNG làm lần này):**

- **Bật/tắt module theo gói** → giữ ở **operator plane (apps/admin)** đúng mô hình SaaS billing
  (entitlement do operator quản). MISA "Hệ thống" cũng không có mục này. Console chỉ *xem* qua "Tình hình sử dụng".
- Mô hình "Tập đoàn" (multi-company group) của MISA — DEFER (MediaOS hiện 1 company = 1 tenant).
- Khách hàng / Nhóm khách hàng (CRM của MISA) — không thuộc phạm vi console MediaOS.
- Thay đổi permission engine 4-tier (ADR-0010) — chỉ *dùng*, không sửa.

**Acceptance tổng:** mỗi lane có DoD riêng (§6). Toàn cục: 3 bất biến CLAUDE §2 không vi phạm · mọi mutation
có audit log · mọi màn FE xử lý loading/error/empty · test ≥80% (lane 🔴 cao hơn) · không phá luồng SSO/RLS.

## 4. Kiến trúc IA mới (sidebar console)

```
🏠 Thông tin công ty            CS-5
📁 Quản lý danh mục
   ├─ Cơ cấu tổ chức            CS-3
   ├─ Vị trí công việc          CS-3
   └─ Đối tượng                 CS-4  (Người dùng · Nhân viên · Chờ duyệt · Kích hoạt)
🔑 Phân quyền                   CS-2
📊 Tình hình sử dụng            CS-7
✉️  Cấu hình mail server         CS-8
🛡️  Bảo mật nâng cao             CS-9
🕘 Nhật ký hoạt động            CS-1
🗑️  Thùng rác                    CS-6
─────────────────────────────────
(giữ nguyên) Tài khoản nền tảng · Break-glass · Bảo mật tài khoản (2FA)  → gom vào nhóm "Bảo mật" / self-service
```

**Việc khung (CS-1 kèm) — ĐÍNH CHÍNH sau plan-review:** console **ĐÃ CÓ** shell sidebar — `root-layout.tsx`
bọc `<AppShell navItems={NAV_ITEMS}>`, `@mediaos/ui` `AppSidebar` đã render `<aside>` nhóm **1 cấp** theo
`category` qua `navItemsByCategory`. Việc thật của CS-1 = **nâng 1 cấp → 2 cấp**: thêm field `subcategory?`
(OPTIONAL — `web-core/src/lib/nav.ts` `NavItem` dùng chung **5 app** people/studio/console/admin/web → bắt buộc
optional để không phá app khác) + cập nhật `navItemsByCategory` gom 2 cấp + `AppSidebar` render group lồng.
KHÔNG dựng shell mới (home.tsx là route launcher grid, giữ nguyên).

## 5. Phụ thuộc & thứ tự (3 đợt)

| Đợt | Lane | Lý do thứ tự |
| --- | --- | --- |
| **1 — Mirror (BE đủ)** | CS-1 (khung + audit) → CS-2 (RBAC) → CS-3 (cơ cấu+vị trí) → CS-4 (đối tượng) | CS-1 dựng IA shell trước (mọi lane cắm route vào). Còn lại độc lập, mirror được song song sau CS-1. |
| **2 — Thêm ít BE** | CS-5 (hồ sơ công ty) · CS-6 (thùng rác) · CS-7 (tình hình sử dụng) | Mỗi lane 1 band migration riêng, độc lập domain → song song được. |
| **3 — Xây mới (plan riêng)** | CS-8 (mail secret) → CS-9 (security policy) → CS-10 (mời/duyệt) | 🔴 crown-jewel/đụng auth → planner + FULL gate + santa. **TUẦN TỰ, KHÔNG song song** (≤2 crown — tránh 2 lane đụng auth/secret reconcile đồng thời, memory rate-limit). CS-10 sau CS-8 (cần mail). |

- **Cần có TRƯỚC tất cả:** PermissionService (G3 ✅), withTenant/RLS (G2 ✅), audit+outbox (G2-4 ✅), web-core SSO (FS-1 ✅).
- **Đụng schema chung:** CS-5/6/7/8/9/10 mỗi lane band migration riêng (§9) → **không** đụng chéo; chạy song song an toàn trong đợt.
- **Hot-file** (append, không rewrite): `nav.ts`, `router.tsx`, permission seed (`ON CONFLICT DO NOTHING`), audit `object_types` CHECK (UNION).

## 6. Phân rã lane (CS-1 … CS-10)

### CS-1 — Khung IA + Nhật ký hoạt động (audit) 🟢 Sonnet · S–M

- **Mục tiêu:** dựng sidebar nhóm 2 cấp + màn "Nhật ký hoạt động".
- **Backend:** ✅ `GET /tenant/audit` (guard `view:audit-log` sensitive; filter action/objectType/objectId/actorUserId/dateFrom/dateTo; limit 1–100 + offset; redaction server-side). Contract `observability.ts` (AuditLogQuery, AuditLogDto). **Không cần BE mới.**
- **FE:** mirror `AuditTable` từ [apps/admin tenant/audit](../../apps/admin/src/routes/tenant/audit); bỏ cột companyId; bộ lọc Hành động/Đối tượng/khoảng ngày + ô tìm; cột Người dùng/Ngày giờ/Hành động/Đối tượng/Tham chiếu/Mô tả(before→after)/IP. Phân trang. `<PermissionGate action="view" resourceType="audit-log">`.
- **Khung:** thêm `subcategory` vào `NavItem` (web-core); SidebarLayout nhóm; reconcile `nav.ts` + `router.tsx`.
- **Test:** render audit table; filter đổi query key; empty/loading/error; deny khi thiếu `view:audit-log`.
- **DoD:** sidebar nhóm hiển thị đúng; audit list/filter/paginate chạy với `/tenant/audit`; mask hiển thị `{redacted}`.

### CS-2 — Phân quyền (RBAC) 🟡 Opus · M · **FULL gate**

- **Mục tiêu:** gán/thu vai trò cho user theo từng app + grant/deny quyền chi tiết (object-level).
- **Backend:** ✅ `POST /permissions/users/:userId/roles` + `DELETE …/:roleId` (guard `assign-role:user` sensitive); `PUT /permissions/object` + `DELETE` (guard `grant-object-permission:permission` sensitive); `GET /org/roles` (`org.controller.ts @Get('roles')`).
- **🔴 CHẶN LEO THANG ĐẶC QUYỀN (plan-review HIGH):** `findAssignableRole` (`permission-admin.repository.ts`) + `GET /org/roles` hiện trả CẢ system role `company_id IS NULL` (gồm `platform-admin`/operator). Tenant admin gán role operator → user nhận `aud=operator` ⇒ leo thang ra ngoài tenant. **Bắt buộc:** lọc loại trừ role `audience='operator'`/system-only ở cả endpoint list VÀ `findAssignableRole` TRƯỚC khi CS-2 land. Test bắt buộc: "tenant admin KHÔNG gán được platform-admin role".
- **Catalog (QUYẾT ĐỊNH, không để lửng):** UI ma trận quyền → thêm `GET /permissions/catalog` (read-only từ bảng `permissions` seeded, KHÔNG migration). Nếu chỉ cần list role+grant đơn giản → render contract tĩnh, KHÔNG thêm endpoint. Chốt ở micro-plan CS-2, ghi vào DoD.
- **FE:** mirror [apps/admin tenant/rbac/rbac-page](../../apps/admin/src/routes/tenant/rbac): bảng user (tên/email/đơn vị/vị trí/vai trò/trạng thái) + dialog gán-vai-trò, thu-vai-trò, object-permission. Lọc theo vai trò. Step-up reauth cho thao tác sensitive.
- **Test (deny-path RED trước):** assign/revoke role bị chặn khi thiếu `assign-role:user`; object grant chặn khi thiếu `grant-object-permission`; **tenant admin gán platform-admin role → DENY**; idempotent no-op; audit ghi đúng.
- **DoD:** gán/thu vai trò + grant/deny chạy thật; role operator KHÔNG xuất hiện trong list gán được; audit `permission.changed` phát; cache invalidation <100ms (đã có ở engine).

### CS-3 — Quản lý danh mục: Cơ cấu tổ chức + Vị trí công việc 🟢 Sonnet · M

- **Mục tiêu:** cây phòng ban/đơn vị (CRUD) + team + vị trí công việc (CRUD).
- **Backend (xác minh plan-review):** ✅ `/org/units` (+ `/tree`); `/org/teams` (+ `/:id/members`, `/:id/leader`); **vị trí công việc CÓ controller** `GET/POST/PATCH/DELETE /org/positions` (`positions/positions.controller.ts @Controller('org/positions')` — grep trước miss vì prefix `org/positions` chứ không phải `/positions`). Guard `create/update/delete:org_unit`, `:team`, `:position`. Contract [positions.ts](../../packages/contracts/src/positions.ts).
- **FE:** mirror [apps/people org/departments](../../apps/people/src/routes/org) (OrgChart + dialog CRUD + parent picker) + bảng vị trí công việc (name/code/đơn vị/cấp/vai trò mặc định/trạng thái). Cột giống MISA "Cơ cấu tổ chức".
- **Test:** CRUD org unit/team/position; cây cha-con; deny theo permission.
- **DoD:** xem cây + thêm/sửa/xoá đơn vị, team, vị trí; khớp dữ liệu seed thật.

### CS-4 — Quản lý danh mục: Đối tượng (Người dùng / Nhân viên) 🟡 Sonnet · M

- **Mục tiêu:** danh bạ 2 tab Người dùng / Nhân viên: xem/tìm/lọc trạng thái/chi tiết/thêm/sửa/vô hiệu hoá/import CSV.
- **Backend:** ✅ `/employees` GET/POST/PATCH/DELETE (soft-delete) + `/employees/import` (preview) + `/import/confirm`. Guard `read/create/update/delete/import:employee`. Status `active|inactive|resigned|terminated`.
- **FE:** mirror [apps/people org/employees](../../apps/people/src/routes/org): DataTable (avatar+tên, email cá nhân, email tài khoản, SĐT, trạng thái badge, đơn vị). Tab "Người dùng" (tài khoản) vs "Nhân viên" (hồ sơ); dialog import + preview + kết quả. (Tab "Chờ duyệt"/"Yêu cầu kích hoạt" → CS-10.)
- **Test:** list/search/filter; create/update/soft-delete; import preview→confirm; deny theo permission.
- **DoD:** danh bạ chạy với `/employees`; đổi trạng thái + soft-delete + import hoạt động.

### CS-5 — Thông tin công ty (hồ sơ đầy đủ) 🟡 Sonnet · M · migration band **0360s**

- **Mục tiêu:** mở rộng "Thông tin công ty" giống MISA: Thông tin chi tiết · Đăng ký kinh doanh · Liên hệ · Mô hình.
- **Backend (MỚI):** thêm cột vào `companies` (hoặc cột `profile_json` jsonb) — `shortName`, `taxCode`, `businessType`, `companyCode`(read-only sinh sẵn), `regNumber`, `regDate`, `regPlace`, `legalRepName`, `legalRepTitle`, `establishedDate`, `address`, `phone`, `fax`, `email`, `website`. Migration 0360s (additive, nullable, KHÔNG đụng RLS sẵn có). Mở rộng `updateCompanySettingsSchema` + service + `GET/PATCH /settings/company` (guard `configure-company:company` đã có).
- **FE:** trang view dạng card (mirror layout MISA) + nút "Chỉnh sửa" → form. Mở rộng [company.tsx](../../apps/console/src/routes/settings/company.tsx) hiện có.
- **Test:** GET trả field mới; PATCH validate Zod (MST, ngày, URL); audit ghi before/after.
- **DoD:** xem + sửa hồ sơ công ty đầy đủ; field cũ (timezone/currency/…) giữ nguyên.
- **"Thiết lập chung" (MISA) → GỘP vào CS-5:** timezone/currency/language/ngày công/kỳ lương đã nằm ở `company.tsx`/`settings-api.ts` hiện tại → đưa thành tab "Thiết lập chung" cùng trang Thông tin công ty. KHÔNG tách lane riêng.

### CS-6 — Thùng rác (recycle bin + restore) 🟡 Sonnet · S–M · migration: **0** (chỉ endpoint)

- **Mục tiêu:** liệt kê bản ghi đã soft-delete (user/nhân viên + mở rộng) + khôi phục.
- **Backend (MỚI):** `GET /recycle-bin/employees` (where `deleted_at IS NOT NULL`) + `POST /recycle-bin/employees/:id/restore` (set `deleted_at = NULL`, audit action **`employee.restored`** — phân biệt với `employee.updated`). Chạy trong `withTenant` (RLS tự lọc chéo tenant). Guard `restore:employee` (permission key mới, sensitive). KHÔNG hard-delete (giữ bất biến CLAUDE §2). Không cần migration (cột `deleted_at` đã có) — chỉ seed permission key.
- **FE:** trang Thùng rác, tab Người dùng/Nhân viên, nút Khôi phục (mirror MISA).
- **Test:** list-deleted chỉ thấy đã xoá; restore khôi phục + audit; deny khi thiếu quyền; RLS không lộ chéo tenant.
- **DoD:** xem + khôi phục bản ghi đã xoá.

### CS-7 — Tình hình sử dụng 🟡 Sonnet · M · migration band **0370s**

- **Mục tiêu:** số người đăng nhập, lần cuối dùng theo module, item tạo/hoàn thành (mirror MISA "Tình hình sử dụng").
- **Backend (MỚI một phần):** thêm `users.last_login_at` (update ở auth login) — migration 0370s additive; endpoint `GET /tenant/usage` tổng hợp (login count, per-user last-login, đếm task/việc tạo+hoàn thành từ bảng sẵn có). Tận dụng `company_usage_counters` (đã có cho limit). Guard `view-usage:company` (key mới).
- **FE:** StatCard (mirror [apps/studio dashboard](../../apps/studio/src/routes/dashboard)) + bảng người dùng (tên/email/đơn vị/lần cuối dùng) + cây module + lọc thời gian + Xuất khẩu CSV.
- **Test:** last_login_at cập nhật khi login; aggregation đúng theo tenant; export.
- **DoD:** xem số liệu sử dụng + bảng last-login + export.

### CS-8 — Cấu hình mail server (SMTP) 🔴 Opus · M · **FULL gate** · migration band **0380s**

- **Mục tiêu:** cấu hình SMTP riêng công ty (mặc định + theo app), nút kiểm tra kết nối.
- **Backend (MỚI, SECRET) — bước theo thứ tự:**
  1. **(plan-review HIGH) Thêm `'smtp_password'` vào `KeyPurpose` union** (`crypto/secret-encryption.types.ts`) TRƯỚC — nếu tái dùng `'platform_account'` thì SMTP password lẫn KEK bucket + rotation với secret kênh. Type union tĩnh sẽ chặn compile nếu thiếu → phải thêm purpose mới.
  2. Bảng `company_mail_configs` (host, port, username, **passwordEncrypted**, fromName, fromEmail, secure(TLS), scope `default | app:KEY`). Migration 0380s + RLS + FORCE.
  3. Reuse `secretEncryption.encrypt/decrypt(purpose='smtp_password', aad=companyId+recordId)` — **KHÔNG tự gọi KEK**. Password KHÔNG plaintext, KHÔNG vào DTO, KHÔNG log.
  4. Endpoints `GET/PUT /settings/mail-config` + `POST /settings/mail-config/test`. Guard `configure-mail:company` (key mới, sensitive + reauth). `test` trả `{ok, errorMessage?}` đã **sanitize** (không echo credential; lọc password khỏi SMTP error trước khi trả).
- **FE:** empty-state "Chưa thiết lập" + nút Thiết lập (mirror MISA); form host/port/user/pass(masked)/from/TLS + nút Kiểm tra. Tab "Mặc định" / "Theo ứng dụng".
- **Test (deny-path RED):** password không bao giờ trả plaintext; deny khi thiếu quyền; test-connection không lộ secret vào log; audit ghi (không log secret).
- **DoD:** lưu + kiểm tra SMTP; secret mã hoá phía app; santa-method PASS.

### CS-9 — Bảo mật nâng cao (per-company security policy) 🔴 Opus · L · **FULL gate + planner + santa** · migration band **0390s**

- **Mục tiêu:** chính sách bảo mật theo công ty (mirror MISA): Tự động đăng xuất · Giới hạn IP · Giới hạn giờ · Giới hạn tên miền email tài khoản · whitelist user miễn giới hạn · (mở rộng) 2FA enforcement per-company.
- **Backend (MỚI, đụng AUTH = crown-jewel):** bảng `company_security_policies` (autoLogoutMinutes nullable, ipRestrictionEnabled + allowlistCidrs[], timeRestrictionEnabled + windows[], applyScope (all|selected apps), exemptUserIds[], emailDomainRestrictionEnabled + allowedDomains[], twoFactorEnforced nullable). Endpoint `GET/PATCH /settings/security-policy` (guard `configure-security-policy:company`, sensitive + reauth). Migration 0390s + RLS.
- **Quy tắc enforcement (plan-review HIGH — bắt buộc tường minh):**
  - **2FA KHÔNG được hạ chuẩn:** `effective2FA = globalEnv(TWO_FACTOR_ENFORCEMENT_ENABLED) || (perCompany.twoFactorEnforced ?? false)`. Tenant chỉ **tăng** chuẩn (bật khi global tắt), KHÔNG tắt được khi global bật. Sửa `TwoFactorEnforcementGuard` đọc thêm policy DB theo công thức này.
  - **Phạm vi check IP/giờ:** chốt **"check tại lúc CẤP token"** (login + refresh) — WS handshake (`getType()!=='http'` hiện bỏ qua) KHÔNG re-check mỗi message; bù lại đặt access-token TTL ngắn cho tenant. Ghi rõ rủi ro cửa sổ TTL.
  - **fail-OPEN vs fail-CLOSED khi rỗng:** `ipRestrictionEnabled=true` + `allowlistCidrs[]` rỗng ⇒ coi như **TẮT** (không giới hạn, fail-OPEN — chưa cấu hình). `timeRestrictionEnabled=true` + `windows[]` rỗng ⇒ **fail-CLOSED** (không cửa sổ hợp lệ = chặn). Phân biệt rõ ở schema/service.
  - **email-domain** check khi tạo tài khoản VÀ khi accept invite (CS-10).
  - **Cơ chế thoát cứng:** env-flag `SECURITY_POLICY_ENFORCEMENT_ENABLED=false` ⇒ guard BỎ QUA toàn bộ (KHÔNG đọc DB) — chống tự-khoá khi policy lỗi/parse sai. "Người đang sửa policy + exempt list + admin" KHÔNG bao giờ bị policy của chính mình khoá (test RED-first bắt buộc).
- **FE:** toggles + danh sách (mirror MISA "Bảo mật nâng cao" 1-1): Tự động đăng xuất, Giới hạn IP/giờ, Áp dụng cho tất cả/chọn app, danh sách user miễn giới hạn, Giới hạn tên miền email.
- **Test (deny-path RED, độ phủ cao):** policy chặn login sai IP/ngoài giờ; whitelist bỏ qua; email-domain chặn tạo tài khoản sai miền; fail-closed khi thiếu config; deny sửa policy khi thiếu quyền; KHÔNG tự khoá chính admin ra ngoài (guard an toàn).
- **DoD:** policy lưu + **enforce thật** ở login/refresh (đo được: login sai IP/ngoài giờ bị chặn, đúng thì qua); 2FA không hạ dưới sàn global; env-flag thoát cứng hoạt động; test "admin không tự khoá" PASS; planner micro-plan PASS; santa-method CONVERGED.

### CS-10 — Đối tượng: Mời / Duyệt / Kích hoạt user 🔴 Sonnet→Opus · M · migration band **0410s**

- **Mục tiêu:** luồng mời user qua email + hàng đợi Chờ duyệt + Yêu cầu kích hoạt (mirror tab MISA).
- **Backend (MỚI):** `POST /users/invite` (tạo lời mời + token + gửi email qua CS-8 mail config), `GET /users/pending`, `POST /users/:id/approve` / `reject`, `POST /users/activation/accept`. Guard `invite:user`, `approve:user` (keys mới, sensitive). Migration **0410s** (bảng `user_invites` có `token` hashed, **`expires_at`** đề xuất 72h, **`accepted_at`** = single-use, + RLS). Email-domain restriction (CS-9) check tại **thời điểm accept** (không chỉ lúc invite). Phụ thuộc **CS-8** (gửi mail).
- **FE:** tab "Chờ duyệt" + "Yêu cầu kích hoạt" trong Đối tượng (CS-4) với nút Duyệt/Từ chối.
- **Test:** invite→accept tạo tài khoản; approve/reject; token hết hạn; deny theo quyền; audit.
- **DoD:** mời + duyệt + kích hoạt chạy end-to-end.

## 7. Permission keys MỚI cần seed (ON CONFLICT DO NOTHING)

| Key | Lane | Sensitive | Ghi chú |
| --- | --- | --- | --- |
| `restore:employee` | CS-6 | ✅ | thùng rác khôi phục |
| `view-usage:company` | CS-7 | — | tình hình sử dụng |
| `configure-mail:company` | CS-8 | ✅ (reauth) | cấu hình SMTP (secret) |
| `configure-security-policy:company` | CS-9 | ✅ (reauth) | chính sách bảo mật |
| `invite:user`, `approve:user` | CS-10 | ✅ | mời/duyệt user |

> `view:audit-log`, `configure-company:company`, `assign-role:user`, `grant-object-permission:permission`,
> `read/create/update/delete:employee`, `:org_unit`, `:team`, `:position` — **đã có**, không seed lại.
> Gán các key mới cho vai trò `quản trị hệ thống` (system-admin) trong seed (không tự gán wildcard).

## 8. Migration bands đặt trước (hook `guard-migration-band`)

> **ĐÍNH CHÍNH plan-review:** band cao nhất KHÔNG phải 0347 — `0400_fs1_refresh_token_family.sql` đã chiếm **0400**.
> Dải console **0360–0419** (né 0400). Mỗi lane 1 band:

| Lane | Band | Bảng/đổi |
| --- | --- | --- |
| CS-5 | `0360s` | `companies` thêm cột hồ sơ (additive nullable) |
| CS-7 | `0370s` | `users.last_login_at` (additive) |
| CS-8 | `0380s` | `company_mail_configs` (+RLS+FORCE) |
| CS-9 | `0390s` | `company_security_policies` (+RLS) |
| CS-10 | `0410s` | `user_invites` (+RLS) — né 0400 (đã chiếm bởi fs1) |
| CS-6 | — | không migration (chỉ endpoint + seed permission) |

- DB cô lập mỗi lane khi verify (`scripts/lane-db-setup.sh <lane>` → `LANE_DB=mediaos_cs<n>`) — CLAUDE §9.6.
- Audit `object_types` CHECK = **UNION** thêm `mail_config`, `security_policy`, `user_invite`, `recycle_restore`.

## 9. Rủi ro & giảm thiểu (phần quan trọng nhất)

| Rủi ro | Khả năng | Tác động | Giảm thiểu |
| --- | --- | --- | --- |
| **CS-8 secret SMTP rò** (plaintext/log/DTO) | TB | 🔴 cao | Envelope encryption phía app (reuse `SecretEncryptionService`); không vào DTO; không log; test deny-path; FULL gate + santa |
| **CS-9 tự khoá admin ra ngoài** (IP/giờ sai) | TB | 🔴 cao | Guard "không áp policy cho người đang sửa"; whitelist mặc định có admin; xác nhận 2 bước; fail-safe break-glass |
| **CS-9 enforcement bỏ sót đường** (refresh/api-key) | TB | 🔴 cao | Áp ở cùng guard với 2FA enforcement; test mọi entrypoint (login/refresh/api-key); fail-closed |
| Rò chéo tenant (thiếu RLS bảng mới) | TB | 🔴 cao | policy + FORCE RLS **trước** backfill (CLAUDE §3); test 2-tenant |
| Hot-file rewrite (`nav.ts`/`router.tsx`/audit CHECK) phá lane khác | cao (song song) | 🟡 | append-only, UNION CHECK, reconcile khi merge (CLAUDE §9.3) |
| **`NavItem.subcategory` ở web-core phá 4 app kia** (people/studio/admin/web) | TB | 🟡 | field PHẢI optional; `navItemsByCategory` mặc định gom 1 cấp khi vắng subcategory → app khác không đổi |
| Worktree CS-8/CS-9 thiếu `.secrets/local-kek.bin` → verify false-RED | cao | 🟡 | `cp .secrets/local-kek.bin` vào worktree trước verify (gotcha đã biết) |
| CS-5 prettier reflow cả file env/schema | TB | 🟡 | sửa tay, không prettier-write toàn file (gotcha đã biết) |
| Mirror UI lệch DTO khi contract đổi | TB | 🟡 | build `@mediaos/contracts` trước typecheck; dùng type từ contract |
| Phình permission (gán wildcard cho system-admin) | TB | 🟡 | seed key tường minh, không `*:*`; test deny mặc định |

## 10. Test plan

- **Deny-path RED trước** cho mọi lane chạm permission/secret/auth: CS-2, CS-6, CS-8, CS-9, CS-10.
- Coverage ≥80% toàn bộ; **≥90%** cho CS-8/CS-9 (secret/auth).
- Regression bắt buộc chạy lại: test isolation 2-tenant; suite auth/SSO (CS-9 đụng login/refresh); audit append-only.
- E2E (tuỳ chọn, Playwright): luồng phân quyền (CS-2) + bảo mật nâng cao (CS-9) end-to-end.

## 11. Gate & model (CLAUDE §6)

| Lane | Gate | Model | Plan-step | Reviewers |
| --- | --- | --- | --- | --- |
| CS-1, CS-3, CS-4, CS-5, CS-6, CS-7 | LIGHT | Sonnet | ❌ | typescript + react + quality-gate |
| CS-2 | FULL | Opus | ✅ planner | security + silent-failure + react + quality |
| CS-8 | FULL | Opus | ✅ planner | security + database + silent-failure + **santa** |
| CS-9 | FULL | Opus | ✅ planner | security + database + silent-failure + **santa** |
| CS-10 | FULL | Sonnet→Opus | ✅ (phần auth) | security + silent-failure |

## 12. Commit & merge

- Nhánh mỗi lane: `feat/cs<n>-<tên>` (worktree `mediaos-cs<n>` cho lane song song — CLAUDE §9.1).
- Conventional commit: `feat(cs<n>): …`. Micro-commit mỗi step.
- Điều kiện merge: cụm xanh + gate đạt + (lane 🔴) santa CONVERGED + chain migration `0000→latest` sạch trên DB cô lập.
- Thứ tự land: Đợt 1 (CS-1 trước, rồi CS-2/3/4) → Đợt 2 (CS-5/6/7) → Đợt 3 **TUẦN TỰ CS-8 → CS-9 → CS-10** (≤2 crown, không song song; CS-10 cần mail CS-8).
- **Gotcha worktree (memory):** `cp .secrets/local-kek.bin` vào worktree CS-8/CS-9 TRƯỚC verify (gitignore không theo `worktree add` → false-RED). Audit `object_types` CHECK UNION phải parse cả 2 form (IN-list & ANY-array).

## 13. Rollback

- Mỗi lane 1 nhánh/commit độc lập → revert commit lane đó.
- Migration additive nullable (CS-5/7) → reversible bằng drop column; bảng mới (CS-8/9/10) → drop table.
- FE nav: `subcategory` + route mới tháo được (ẩn nav item) không ảnh hưởng lane khác.
- CS-9 enforcement có cờ tắt nhanh (policy `enabled=false` toàn bộ) nếu khoá nhầm.

---

## ✅ Kết quả rà soát plan (`plan-reviewer`)

**Vòng 1 (2026-06-18):** architect + security-reviewer → **REVISE** (cả hai), đối chiếu code thật.
**Đã vá vào plan (vòng này):**

1. Band `0400` đã chiếm (fs1) → CS-10 dời **0410**; dải console 0360–0419 (§8).
2. Console đã có `AppShell`+`AppSidebar` nhóm category → CS-1 nâng **1→2 cấp** (`subcategory?` optional, web-core 5 app), không dựng shell mới (§4/§6 CS-1, +risk §9).
3. CS-8: thêm `'smtp_password'` vào `KeyPurpose` (bước 1); reuse `encrypt/decrypt` không tự gọi KEK; sanitize test-connection (§6 CS-8).
4. CS-9: 2FA fail-STRICTER (global là sàn, tenant chỉ tăng); IP/giờ check tại cấp-token (WS bỏ qua + TTL ngắn); fail-OPEN(IP rỗng)/fail-CLOSED(giờ rỗng); env-flag `SECURITY_POLICY_ENFORCEMENT_ENABLED` thoát cứng; test admin-không-tự-khoá RED-first (§6 CS-9, DoD).
5. CS-2: lọc role `audience='operator'` khỏi list gán + `findAssignableRole` (chống leo thang platform-admin) + test (§6 CS-2).
6. CS-3: xác nhận controller `/org/positions` TỒN TẠI (grep trước miss prefix).
7. CS-6: audit action `employee.restored`. CS-10: invite `expires_at` 72h + `accepted_at` single-use + email-domain check tại accept.
8. Đợt 3 land **tuần tự CS-8→CS-9→CS-10** (≤2 crown). "Thiết lập chung" gộp CS-5. KEK cp + audit UNION 2-form (§9/§12).

> **Trạng thái: PASS-sau-sửa cho Đợt 1 & 2** (CS-1/2/3/4/5/6/7 đủ rõ để code). Lane 🔴 **CS-8/CS-9/CS-10** nên chạy
> `planner` (Opus) micro-plan + 1 vòng `plan-reviewer` nữa NGAY TRƯỚC khi code (xác nhận sửa #3/#4/#5 phản ánh đúng guard auth thật).

## 🏁 Kết quả đánh giá hoàn thành (`completion-evaluator`)

_(điền khi đóng từng đợt: rubric + PASS/BLOCK + nợ.)_
