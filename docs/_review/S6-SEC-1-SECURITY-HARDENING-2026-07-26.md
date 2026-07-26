# S6-SEC-1 — SECURITY / RBAC / DATA-PROTECTION FINAL HARDENING (Sprint 6 · WS4 · 🔴 crown)

> Sinh trong `S6-SEC-1`. Khung: `IMPLEMENTATION-09` §13 (§13.2 checklist · §13.3 ma trận quyền tối
> thiểu · §13.4 security release gate). Luật: `RELEASE-05` (thang `S0…S4` §5 · change-control §4).
> Kế hoạch đã qua `plan-reviewer` (PASS vòng 2): `docs/plans/S6-SEC-1.md`.
> Đo ngày **2026-07-26** · `master` `c845a777` · migration head `0529` (197) · DB cô lập
> `LANE_DB=mediaos_s6sec1` · **cộng truy vấn read-only trên DB PROD `mediaos`**.
>
> Nối tiếp `S5-SEC-1` (`_review/S5-SEC-1-SECURITY-TESTING-2026-07-25` + `QA/evidence/S5-SEC-1-PERM-SCOPE-SUITE`)
> — WS4 **không** viết lại OWASP/ma-trận-scope, chỉ carry-forward (§2.1) và làm phần delta.

---

## 0. Kết luận điều hành

> ## 🔴 BẢN NÀY ĐÃ BỊ FULL GATE CHẶN — ĐỌC §0.1 TRƯỚC
>
> Ba reviewer của FULL gate (`security-reviewer` · `rls-tenant-isolation-tester` · thay thế cho
> `silent-failure-hunter`) đều trả **BLOCK**, và cùng nhau lôi ra **hai lỗ `S0`** mà bản đầu của báo
> cáo này **kết luận sai là "không có"**. WO **DỪNG**, không mở PR, chờ owner (`plan` §6).
>
> Phần §1–§7 bên dưới giữ nguyên như lúc chấm để đối chiếu; **mọi kết luận của chúng phải đọc kèm
> §0.1 và §6.0**.

### 0.1 HAI LỖ `S0` — cần hành động của owner NGAY

| | **SEC-F00-A** — 3 tài khoản `platform-admin` trong PROD dùng mật khẩu nằm trong repo PUBLIC |
| --- | --- |
| **Mức** | **`S0` / CRITICAL** · **đang sống trên production** |
| **Bằng chứng (tự kiểm chứng lại, không chỉ tin reviewer)** | PROD `mediaos`: 3 user `status=active`, `deleted_at IS NULL`, `must_change_password=false`, giữ role `00000000-0000-0000-0000-0000000000f0` (**platform-admin — operator audience**), nằm trong **tenant TEST còn sót**: `op-52e0bf36@a.test` (`fla-0b8fd5e5`) · `op-07803e71@a.test` và `opng-36db5001@a.test` (`be3a-e5d8e266`). Mật khẩu của chúng là chuỗi test **`Passw0rd!test99`** — xuất hiện trong **86 file** của repo, và repo là **PUBLIC** (`gh repo view` → `PUBLIC`). Đã **xác minh trực tiếp**: lấy `password_hash` của `op-52e0bf36@a.test` từ PROD và chạy `argon2.verify(hash, "Passw0rd!test99")` → **`true`** |
| **Vì sao nghiêm trọng** | `platform-admin` là **audience operator**, có đường đọc **CHÉO TENANT theo thiết kế**: `GET /foundation/audit-logs/all` → `withPlatformReadContext` đọc xuyên tenant. PROD `audit_logs` đang giữ **9.124 dòng của `funtime`**. Grant kèm theo gồm `view:platform-audit` · `read:db-all-tenant` · `read:db-browser` · `manage:db-ops` |
| **Bật 2FA (SEC-F01) KHÔNG cứu được** | `@AllowWithoutTwoFactor()` đặt ở **cấp class** trên `AuthController` ⇒ ai có mật khẩu tự enroll TOTP của chính họ |
| **Yếu tố làm chậm kẻ tấn công (KHÔNG phải biện pháp bảo vệ)** | Login cần `companySlug` + email; slug tenant test là chuỗi ngẫu nhiên không nằm trong repo. Nhưng slug **không phải bí mật** — nó lộ qua bất kỳ bản backup, bản sao DB, hay log nào |
| **Hành động** | **XOÁ/thu hồi 3 `user_roles` role `…f0` này trước tiên**, rồi xoá 25 user + 16 tenant test khỏi PROD. Coi `Passw0rd!test99` là **đã cháy** |

| | **SEC-F00-B** — tenant admin xoá được grant của role hệ thống TOÀN CỤC (ghi chéo tenant, không hoàn tác được) |
| --- | --- |
| **Mức** | **`S0` / CRITICAL** |
| **Bằng chứng** | `role_permissions` policy ([0005_permissions.sql:87-109](apps/api/migrations/0005_permissions.sql#L87)): `USING` cho phép `r.company_id IS NULL` (để tenant **đọc** role hệ thống), `WITH CHECK` thì chặt. **Postgres chỉ xét `USING` cho DELETE** ⇒ khe hở dành cho ĐỌC trở thành quyền XOÁ trên hàng toàn cục. Grant `DELETE ON role_permissions TO mediaos_app` có thật (`:109`). Tầng service **không** bù: `assignPermissionToRole` ([role-admin.service.ts:324](apps/api/src/permission/role-admin.service.ts#L324)) và `revokePermissionFromRole` (`:409`) chỉ chặn `role.companyId !== null && !== actor.companyId` ⇒ role toàn cục (`companyId === null`) **lọt qua**; chúng thiếu guard `isSystem` mà `updateRole`/`deleteRole` **có** |
| **Đã chứng minh tới đâu** | `rls-tenant-isolation-tester` chạy trên **lane DB cô lập**: DELETE **đã commit**, tenant B đọc lại thấy hàng biến mất; **INSERT khôi phục bị `WITH CHECK` chặn** ⇒ **không hoàn tác được qua ứng dụng**, phải superuser/migration |
| **Bán kính** | PROD có **785 grant** trên role toàn cục; `funtime` dùng **2** role toàn cục. Ai có `assign:permission` đều với tới — PROD: `funtime` 6 user **và 9 user thuộc 5 tenant test** (mật khẩu đã cháy ở SEC-F00-A) |
| **Vì sao mọi lưới đều trượt** | `role_permissions` **không có cột `company_id`** ⇒ nằm ngoài phép đo 153/153. `tenant-isolation.int-spec` (465 case) **chỉ SELECT** — không có một ca deny ghi chéo tenant nào. `rls-coverage-assert` không mô hình hoá DELETE và không thấy vế `OR company_id IS NULL` |
| **Hành động** | Vá 3 lớp (policy `FOR DELETE` + guard `isSystem` ở 2 hàm + gỡ grant `DELETE ON roles` không ai dùng), **RED test trước**. Là **migration + crown** ⇒ WO riêng, người chốt |

### 0.2 Bảng kết luận (đã sửa sau FULL gate)

| Câu hỏi | Trả lời |
| --- | --- |
| Còn lỗ `S0`/CRITICAL mở? | **CÓ — 2** (§0.1). Bản đầu của báo cáo này ghi "KHÔNG"; **kết luận đó SAI** |
| Còn lỗ `S1`/HIGH mở? | **CÓ 1** — **SEC-F01**: 2FA **không được ép ở PROD** cho tài khoản company-admin duy nhất, dù role khai `requires_two_factor = true`. Là **cấu hình vận hành**, sửa bằng thao tác owner, **không** sửa bằng code |
| Ba bất biến còn nguyên? | **CÓ** — verify **trên chính DB PROD**: 153/153 bảng `company_id` có RLS+FORCE; app/worker role `NOSUPERUSER`+`NOBYPASSRLS`; 13/13 bảng append-only chỉ có `INSERT,SELECT` |
| Có sửa code trong WO này? | **KHÔNG** — mọi finding hoặc là cấu hình PROD, hoặc là thay đổi hành vi sau freeze cần owner duyệt (`RELEASE-05` §4.1). Đúng luật dừng của plan §6 |
| Chặn RC? | **CÓ.** Hai `S0` ở §0.1 chặn cả RC lẫn go-live |
| WO đóng được chưa? | **CHƯA — `needs_human`.** FULL gate BLOCK; không mở PR |

### 0.3 Những gì bản đầu nói SAI (rút lại tường minh)

| Bản đầu nói | Thực tế |
| --- | --- |
| "Còn lỗ `S1`/HIGH mở? **CÓ 1**… 0 CRITICAL" | **2 `S0`** (§0.1) |
| KI-028 `S2`, *"RLS giữ: phiên đó bị khoá trong tenant test của nó"* | **Đúng cho ĐỌC, sai cho GHI và sai cho operator.** 3 trong 25 tài khoản đó là **platform-admin đọc chéo tenant theo thiết kế**; và bất kỳ ai trong 9 tài khoản có `assign:permission` đều ghi được lên role toàn cục. Nâng lên **`S0`** |
| Census "**38** route không gate… 37 hợp lệ, **1** GAP" | Đếm thiếu. Quét runtime của reviewer: **43**. Xem §0.4 |
| §2.3 ô 1 ✅-với-1-GAP · §13.3 "9/10" · §13.4 "4/7 đóng sạch" | **Không đứng vững** khi census sai — phải chấm lại sau khi vá census |
| SEC-F04 "gate `read:user` là xong" | **Chưa đủ**: `GET /org/teams/:id/members` ([org.controller.ts:143](apps/api/src/org/org.controller.ts#L143)) cũng trả `userFullName` + `userEmail` ([org.repository.ts:257](apps/api/src/org/org.repository.ts#L257)) ⇒ đi vòng `GET /org/teams` → team id → members là dựng lại được danh bạ. Nâng **`S1`**, và là **3 route** chứ không phải 1 |
| §2.1 "3 lớp ép 2FA độc lập" | Sai mô hình: `roleRequired` **chỉ** được xét khi `globalEnabled` ([two-factor-enforcement.guard.ts:78-81](apps/api/src/auth/two-factor-enforcement.guard.ts#L78)) ⇒ lớp (3) phụ thuộc lớp (1). Còn **lớp thứ 4** chưa hề nhắc: `SECURITY_POLICY_ENFORCEMENT_ENABLED` ([security-policy.service.ts:144](apps/api/src/security-policy/security-policy.service.ts#L144)) |
| SEC-F01 "thuần vận hành, code default an toàn" | Gốc rễ **nằm trong repo**: `.env.example:91` ship `TWO_FACTOR_ENFORCEMENT_ENABLED=false`, mà `cp .env.example .env` là bước cài đặt chuẩn (CLAUDE §7) ⇒ **tái diễn ở mọi lần deploy mới** nếu không sửa file mẫu |
| §1.1 "446 file… mọi skip đều có chủ ý" | Thiếu công bố: `vitest.config.ts:57-67` **exclude 6 file** (5 là bộ deny-path) TRƯỚC khi đếm ⇒ 452 − 6 = 446. Chúng không xuất hiện ở bất kỳ reporter nào |

### 0.4 Census: 3 bẫy đo lường, ba lần sai khác nhau

Con số route không-gate **thay đổi 4 lần** trong lúc làm — ghi lại vì đây là bài học đắt hơn kết quả:

| Lần | Kết quả | Sai ở đâu |
| --- | ---: | --- |
| 1 | 49 | Bỏ qua `@RequirePermission` **cấp class** (`getAllAndOverride([handler, class])`) ⇒ đếm thừa 11 route `/me/*` |
| 2 | 38 | Cửa sổ decorator cố định `i+8` **nuốt decorator của route KẾ TIẾP** — `@Get('teams/:id/members')` (không gate) cách `@RequirePermission` của route `@Post` đúng 7 dòng ⇒ **đếm thiếu**, và chính đây là chỗ giấu SEC-F04 thứ hai |
| 3 | 114 | Vá cửa sổ nhưng `@RequirePermission(` **trải nhiều dòng** ⇒ regex đòi trọn cặp ngoặc trượt ⇒ đếm thừa ồ ạt |
| 4 | 40 | Docstring **nhắc tên decorator để giải thích vì sao KHÔNG dùng** (`"KHÔNG @UseGuards(...), KHÔNG @RequirePermission"`) bị đọc thành "đã gác" |
| **Chuẩn** | **43** | Quét **runtime** (boot `AppModule`, đọc `PATH_METADATA`/`REQUIRE_PERMISSION`/`IS_PUBLIC` thật) của `security-reviewer` — **đây mới là nguồn đáng tin**; parse tĩnh chỉ là xấp xỉ |

**Kết luận về phương pháp:** Phụ lục A phải được dựng lại bằng **quét runtime**, không phải regex trên
văn bản. Route chưa từng được phán quyết: `GET /org/units/tree` · `GET /org/teams` ·
`GET /org/teams/:id/members` · `GET /workflow-templates/:id` · `GET /foundation/company/branding`
(+ `GET /foundation/settings/public` có trong văn xuôi nhưng thiếu trong bảng 6 ô).

> **Nói thẳng phần khó chịu:** WS4 tự tin kết luận "0 CRITICAL" và **sai**. Cả hai lỗ `S0` đều nằm
> ngoài tầm nhìn của 10.102 test xanh — một cái ở **dữ liệu PROD**, một cái ở **chiều GHI của RLS** mà
> bộ 465 ca cô lập tenant **chưa từng thử** vì chúng chỉ `SELECT`. Bản thân phép đo census của tôi cũng
> sai bốn lần trước khi đúng. Bài học không phải "cần thêm test", mà là: **kết luận bảo mật rút ra từ
> lưới do chính mình dựng thì chỉ chắc bằng lưới đó** — phải có người/agent độc lập đâm thủng.

---

## 1. Cách đọc & bằng chứng chạy

| Ký hiệu | Nghĩa |
| --- | --- |
| **T** | Test **đã chạy xanh trong chính lần chạy này** — ghi file + tên `it()`; file đó phải nằm trong bảng §1.1 |
| **C** | Ràng buộc tĩnh trong code — `đường/dẫn.ts:dòng` |
| **P** | Đo trực tiếp trên **DB PROD** (read-only) — ghi truy vấn |
| **L** | Chỉ chứng minh được trên môi trường sống ⇒ chuyển UAT |
| **N/A** | Không áp dụng, **kèm lý do** |
| **GAP** | Không có bằng chứng ⇒ finding §6 |

### 1.1 Nền bằng chứng

DB cô lập `LANE_DB=mediaos_s6sec1` (Postgres thật) ⇒ deny-path / IDOR / cross-tenant **thực thi thật**,
không bị `describe.skipIf(!(hasDb && LANE_DB))` bỏ qua.

| Bước | Cách chạy | Kết quả |
| --- | --- | --- |
| `@mediaos/api` | 24 lô × 20 file, `--no-file-parallelism` | **446 file** (445 pass · 1 skip) · **7.113 test pass · 15 skip · 1 todo · 0 FAIL** |
| `pnpm lint` | `TURBO_FORCE=1` | ✅ 7/7 task, **0 cached** |
| `pnpm typecheck` | `TURBO_FORCE=1` | ✅ 10/10 task, **0 cached** |
| Truy vấn PROD | `psql -d mediaos`, **chỉ SELECT** | §5 |

**Skip là có chủ ý, không phải deny-path bị bỏ qua:** 1 file (`pgbouncer-tenant-isolation` — cần
PgBouncer) + 15 test (gate `sessions` của `migration-smoke` và tương tự). Không có mục nào skip vì
thiếu `LANE_DB` ⇒ kết luận là "XANH", không phải "XANH KHÔNG ĐỦ BẰNG CHỨNG" (CLAUDE §9.5).

> **Ghi lại một sự cố đo lường:** lô 15 chết `ERR_IPC_CHANNEL_CLOSED` (KI-014) và được script **tự chia
> đôi** thành 15a/15b — cả hai xanh (10+10 file). Tức ngưỡng 20 file/tiến trình **không tuyệt đối**;
> phải có bước tự-chia-đôi, nếu không một lô chết sẽ bị đọc nhầm thành "suite đỏ".

### 1.2 Caveat bắt buộc — suite chạy dưới cấu hình KHÔNG giống production

[vitest.config.ts:30](apps/api/vitest.config.ts#L30) đặt `TWO_FACTOR_ENFORCEMENT_ENABLED: "false"` cho
**toàn suite** (kèm `JWT_SECRET` cố định `:26`, `ALLOW_SUPERUSER_ROTATION: "true"` `:25`). Nghĩa là mọi
ô nhóm Authentication/session dựa vào suite này được chấm **dưới cấu hình đã tắt một lớp gác**. Ô nào
bị ảnh hưởng đều ghi caveat tại chỗ. Nhánh DENY của guard **có** được phủ riêng ở unit-test đặt cờ
tường minh ([two-factor-enforcement.guard.spec.ts](apps/api/src/auth/two-factor-enforcement.guard.spec.ts)).

> Chính caveat này dẫn tới **SEC-F01**: đi kiểm "PROD đang đặt cờ đó là gì" thì phát hiện PROD cũng
> đang tắt.

---

## 2. §13.2 — Security checklist

### 2.1 Carry-forward từ `S5-SEC-1` (không mở lại, không âm thầm đóng)

| Mã | Nội dung | Ánh xạ §13 | Trạng thái hôm nay |
| --- | --- | --- | --- |
| **D3** (KI-012) | Widget `hr-overview` count-only xuyên phòng ban cho HR scope Department | **§13.4 #4** | **VẪN CHƯA CÓ CHỮ KÝ** (điều kiện `C4`, `RELEASE-01` §10). WS4 không tự ký — §13.4 #4 phụ thuộc chữ ký này |
| **D1** (KI-013) | `refresh`/`resetPassword` không throttle | §13.2 API-sec #1 | Accepted theo thiết kế; mitigation còn nguyên (reuse-detection thu hồi cả họ + reset token dạng **envelope mã hoá**, single-use, TTL ngắn) |

### 2.2 Authentication / session (7 mục)

| # | Mục | KQ | Bằng chứng |
| --- | --- | --- | --- |
| 1 | Password hash dùng thuật toán an toàn | ✅ | **C** [password.service.ts:1,19](apps/api/src/auth/password.service.ts#L19) — **argon2id** (`@node-rs/argon2`), tham số cost theo OWASP 2024 |
| 2 | Access/refresh token có TTL | ✅ | **C** [env.schema.ts:45,48,49](apps/api/src/config/env.schema.ts#L45) — access **900s**, operator-access **600s**, refresh **2.592.000s** (30 ngày) |
| 3 | Refresh token / session revoke được | ✅ | **T** `auth-session.int-spec` (reuse-detection thu hồi **cả họ**; refresh thiếu/sai CSRF → 403) · **C** `revokeAllSessionsForUserTx` gọi ở **6** đường: đổi mật khẩu · reuse · suspend · company-inactive · logout · reset ([auth.service.ts:597,679,715,745,841,1301](apps/api/src/auth/auth.service.ts#L597)) |
| 4 | Logout clear session/cache nhạy cảm | ✅ | **T** `auth-logout.int-spec` — logout(refreshToken) → refresh chính token đó sau đó = 401; thu hồi cả family |
| 5 | User locked/inactive không truy cập API | ✅ | **T** `auth-blocked-status.int-spec` — `suspended`/`invited` + mật khẩu ĐÚNG → 401 **đồng nhất** · **C** [auth.service.ts:67-72](apps/api/src/auth/auth.service.ts#L67) dùng **allow-list** (`status === 'active'`), không deny-list ⇒ trạng thái mới mặc định KHÔNG lọt |
| 6 | Reset password token chỉ lưu hash + hết hạn đúng | ✅ | **T** `reset-token-envelope.int-spec` · **C** [auth.service.ts:1199-1210](apps/api/src/auth/auth.service.ts#L1199) — payload **chỉ** mang `resetTokenEnc` (envelope mã hoá), KHÔNG plaintext |
| 7 | Không log password/token/plain secret | ✅ | **T** `audit-write-shape.int-spec` (mask-at-write) · `auth-hr-noti-e2e.int-spec:334` (outbox mang token sentinel → notification KHÔNG chứa) |

> **Caveat §1.2 áp cho ô 3/4/5**: chạy với `TWO_FACTOR_ENFORCEMENT_ENABLED=false`. Không ảnh hưởng kết
> luận của 3 ô này (chúng không đi qua guard 2FA), nhưng **có** ảnh hưởng tới câu hỏi "PROD ép 2FA
> chưa" — trả lời ở **SEC-F01**, không phải ở đây.

### 2.3 Authorization / RBAC (7 mục)

| # | Mục | KQ | Bằng chứng |
| --- | --- | --- | --- |
| 1 | Backend kiểm permission cho **mọi API nghiệp vụ** | ⚠️ **1 GAP** | Đo: **452 route / 80 controller**; **38** route không `@RequirePermission` và không `@Public()`. Phán quyết từng dòng ở **Phụ lục A**: 37 hợp lệ (`SELF`/`PUBLIC`/`OTHER_GUARD`/`TENANT_READ`/`DEAD-410`/`PARKED`), **1 = GAP** (**SEC-F04** `GET /org/employees`) |
| 2 | Data scope đúng Own/Team/Department/Project/Company/System | ✅ | `S5-SEC-1-PERM-SCOPE-SUITE` §2 — ma trận 5 scope × 7 module, mỗi ô cite spec đang chạy; **T** `data-scope-resolver.int-spec` (đủ 5 scope + fail-closed) |
| 3 | API list không trả dữ liệu ngoài scope | ⚠️ **1 GAP** | ✅ cho `/hr/employees` (**T** `employees-rbac-scope.int-spec:247/253/260/271`), ATT/LEAVE/TASK/NOTI. **Trừ** `GET /org/employees` — **SEC-F04** |
| 4 | Direct URL trái quyền bị **cả** FE guard **và** BE guard | ✅ (vế BE) · **C** (vế FE) | Vế BE = ô 1 + Phụ lục A. Vế FE: `ForbiddenPage` + `PermissionGate` — **178 file** dùng `PermissionGate`/`useCan()` |
| 5 | Widget/dashboard không hiển thị số liệu ngoài scope | ⚠️ **accepted-risk** | **T** `dashboard-widget-security.int-spec` (sweep chéo tenant 7 widget) · `dashboard-agg-routes-deny.int-spec` (gate TRƯỚC aggregate). **Ngoại lệ đã biết: D3/KI-012 chưa ký** — xem §2.1 |
| 6 | Notification deep-link kiểm quyền **ở module gốc** | ✅ | **T** `noti-deeplink-perm-lost.int-spec:219` — thu hồi `read:task` → `GET /tasks/:id` **403**, trong khi notification vẫn đọc được (own-scope) |
| 7 | Permission matrix **không hard-code theo role** ở frontend | ✅ | **C** quét `apps/{app,console,auth}/src` + `packages/*/src`: **0** so sánh với tên role hệ thống. 8 hit đều KHÔNG phải role: `goal.level === "employee"` (bậc cây GOAL), `personDialog.kind === "manager"`, và `myProjectRole === "Owner"/"Manager"` ([tasks/constants.ts:60-65](apps/app/src/routes/tasks/constants.ts#L60)) = vai **thành viên dự án do server trả**, chỉ ẩn/hiện affordance — BE `ProjectAccessService` quyết cuối (**T** `task-project-role.int-spec`) |

### 2.4 Sensitive data (5 mục)

| # | Mục | KQ | Bằng chứng |
| --- | --- | --- | --- |
| 1 | Field nhạy cảm HR mask/không trả nếu thiếu quyền | ✅ | **T** `employees-salary-sensitive.int-spec:245` (mask khi thiếu `view-salary`) · `:260` (**wildcard `*:*` KHÔNG kế thừa quyền sensitive**) · `hr-identity-read.int-spec:258/270` (identity mask + 0 audit) |
| 2 | File private không tải/xem được nếu thiếu quyền | ✅ | **T** `file-access-hardening.int.spec:397` (out-of-scope → 403 + deny-log) · `file-security.int-spec` (MIME-spoof · path-traversal · không lộ `storage_path`) · `task-files-access.int-spec` |
| 3 | Notification payload không chứa dữ liệu nhạy cảm | ✅ | **T** `noti-deeplink-perm-lost.int-spec` (`assertNoSecrets`) · `reset-token-envelope.int-spec` · `auth-hr-noti-e2e.int-spec:293` (body KHÔNG chứa giá trị envelope) |
| 4 | Export dữ liệu nhạy cảm cần permission riêng | ✅ | **T** `hr-export.int.spec:181` (`export:employee` **sensitive**; salary + CCCD **FORCED NULL**) · `attendance-export.int.spec:210` (`export:attendance`, 403 fail-closed) · `leave-be6.int.spec:317` |
| 5 | Audit log ghi nhận xem/sửa/xuất dữ liệu nhạy cảm | ✅ | **T** `hr-identity-read.int-spec:285/347` — **ĐÚNG 1 audit `view-identity` mỗi lần xem** (detail và **mỗi hàng** ở list) · `audit-write-shape.int-spec` · audit ghi **trong cùng tx** (`employee-code-config.int-spec`) |

### 2.5 API security (6 mục)

| # | Mục | KQ | Bằng chứng |
| --- | --- | --- | --- |
| 1 | Rate limit / guard tối thiểu cho login + reset password | ⚠️ **một phần (D1)** | ✅ login: **T** `auth.int-spec:182` "brute-force: quá số lần sai → **429**" + khoá theo `accountMaxAttempts` ([auth.service.ts:636,1180](apps/api/src/auth/auth.service.ts#L636)). ❌ `refresh`/`resetPassword` **không** throttle — **D1 accepted theo thiết kế**, mitigation ở §2.1 |
| 2 | Validation 422 đúng cho input không hợp lệ | ✅ | **C** `ZodValidationPipe` (nestjs-zod) gắn cấp controller · **T** `dashboard-resolver.int-spec:367` (`limit=0`/`limit=abc` → **400, KHÔNG 500, KHÔNG trả toàn bộ**) · `me-qa1-idor-sweep` (PATCH strict → 400) |
| 3 | Không expose stack trace ở production | ✅ | **C** [all-exceptions.filter.ts:29,49](apps/api/src/common/filters/all-exceptions.filter.ts#L29) — 5xx **chỉ log server-side**, client nhận envelope không stack |
| 4 | CORS đúng domain | ✅ | **C** [main.ts:42](apps/api/src/main.ts#L42) — `origin` lấy từ `env.CORS_ORIGIN` (allow-list tách `,`), KHÔNG `*` |
| 5 | Security headers bật nếu qua web server/proxy | **L** | Thuộc tầng tunnel/NSSM trước API ⇒ chỉ verify được trên môi trường sống. Chuyển `S6-REL-1` (WS7/8) |
| 6 | Idempotency-Key cho action quan trọng | ✅ | **T** `S5-BE-CONTRACT-1` (PR #287) — khoá suy từ **payload**, không phải khoá ngẫu nhiên trong thân hàm · check-in trùng → 409 (`attendance-be1.int.spec:212`), approve đua → đúng 1×200 + 1×409 (`attendance-adjustment.int.spec:521`) |

### 2.6 Secret / config (5 mục)

| # | Mục | KQ | Bằng chứng |
| --- | --- | --- | --- |
| 1 | Không commit secret trong repo | ✅ | CI `Secret scan (gitleaks)` **pass** trên PR #294 (`.gitleaks.toml`, full-history). *(gitleaks không cài trên máy local ⇒ dựa vào CI, ghi rõ thay vì giả vờ đã chạy tay.)* |
| 2 | Production seed không chứa password mẫu | ⚠️ **GAP** | **P** PROD `mediaos`: **16/17 công ty là tenant TEST còn sót** (`slug ~ '-[0-9a-f]{8}$'`) với **25 user** dùng mật khẩu seed test → **SEC-F02** |
| 3 | Bootstrap admin password lấy từ secret manager/env | ✅ | **T** `foundation-seed3-must-change-password.int-spec` · **P** PROD: **45/46** user `funtime` có `must_change_password = true` (đợt import nhân sự) |
| 4 | ENV production/staging/dev tách rõ | ⚠️ **một phần** | Có `.env` / `.env.prod` / `.env.example` riêng. **Nhưng** `apps/api/dist` dùng chung giữa PROD `:3100` và dev-online `:3200` (KI-016) ⇒ tách env **không** đủ khi tách build chưa xong |
| 5 | Connection string / storage key / email key được bảo vệ | ⚠️ **GAP** | Mail-config lưu **envelope mã hoá** (**T** `mail-config-envelope.int-spec`) ✅. **Nhưng** 2 biến bảo mật đọc **thẳng `process.env`**, KHÔNG qua zod, KHÔNG có trong `.env.example` → **SEC-F03** (`PERMISSION_GUARD_ENABLED` — fail-**open** toàn hệ) và **SEC-F05** (`INTERNAL_API_KEY` — fail-**closed**, nhẹ hơn) |

### 2.7 Tổng kết §13.2

| Nhóm | Số mục | ✅ | ⚠️ một phần / accepted | GAP | L |
| --- | ---: | ---: | ---: | ---: | ---: |
| Authentication/session | 7 | 7 | 0 | 0 | 0 |
| Authorization/RBAC | 7 | 5 | 1 (D3 chờ ký) | 1 (SEC-F04) | 0 |
| Sensitive data | 5 | 5 | 0 | 0 | 0 |
| API security | 6 | 4 | 1 (D1 accepted) | 0 | 1 |
| Secret/config | 5 | 2 | 1 | 2 (SEC-F02·F03/F05) | 0 |
| **Tổng** | **30** | **23** | **3** | **3** | **1** |

> Ghi số thật: **30/30 mục được chấm**, trong đó 2 mục có vế FE (RBAC #4, #7) chấm bằng quét tĩnh vì
> `paths` của WO không mở `apps/app/**` — vế BE của RBAC #4 vẫn thuộc WO này và đã chấm ở Phụ lục A.

---

## 3. §13.3 — Ma trận permission regression tối thiểu

> **Khai luật trước:** hệ chạy **N=1 (một công ty)** ⇒ `System ≡ Company` tại runtime. Cột Super Admin
> vì thế chứng minh **biên phân tách** (audience + quyền `view:platform-audit`), không chứng minh
> "thấy nhiều công ty" — điều đó chỉ có nghĩa khi bật multi-company.

| Case | Employee | Manager | HR | Admin | Super Admin | Bằng chứng |
| --- | --- | --- | --- | --- | --- | --- |
| Xem hồ sơ cá nhân | Own ✅ | Own ✅ | Company ✅ | theo quyền ✅ | System ✅ | `hr-identity-read.int-spec:314/324` (self reveal + 1 audit) · `employees-rbac-scope.int-spec:247` |
| **Xem danh sách nhân viên** | Own ✅ / **directory ⚠️** | Team ✅ | Company ✅ | Company ✅ | System ✅ | `employees-rbac-scope.int-spec:247/253/271/287`. ⚠️ **SEC-F04**: `GET /org/employees` trả **danh bạ toàn tenant** cho mọi user đã đăng nhập — đường đọc thứ hai không theo scope |
| Xem bảng công cá nhân | Own ✅ | Own ✅ | Own ✅ | Own ✅ | System ✅ | `attendance-be2.int.spec:254` |
| Xem bảng công team | Không ✅ | Team ✅ | Company ✅ | Company ✅ | System ✅ | `attendance-permission.int-spec:278/290` |
| Tạo đơn nghỉ | Own ✅ | Own ✅ | Own ✅ | theo quyền ✅ | System ✅ | `leave-qa2-api.int-spec:394` |
| Duyệt đơn nghỉ | Không ✅ | Team ✅ | Company ✅ | theo quyền ✅ | System ✅ | `leave-approval.int.spec:352` (employee → 403) · `:366` (ngoài team → 403) · `:383` (report → 200) |
| Tạo task | theo quyền ✅ | Team/Project ✅ | theo quyền ✅ | Company ✅ | System ✅ | `task-core.int-spec:408/415` · `task-project-role.int-spec` |
| Xem notification | Own ✅ | Own ✅ | Own ✅ | Own ✅ | System ✅ | `my-notifications.int-spec:241/248/286` (cross-user + cross-tenant → 404) |
| Xem dashboard | Employee ✅ | Manager ✅ | HR ✅ | Admin ✅ | System ✅ | `dashboard-resolver.int-spec:230/264/297/316/333` |
| Cấu hình role/permission | Không ✅ | Không ✅ | Không mặc định ✅ | Company ✅ | System ✅ | `permission-admin.int-spec:151/161/215` (thiếu quyền → 403 · `*:*` không kế thừa sensitive · cấm tự gán) · `rbac-operator-escalation.int-spec:92` |

**9/10 case khớp hoàn toàn. 1 case (danh sách nhân viên) lệch ở đường đọc phụ** — SEC-F04.

---

## 4. §13.4 — Security release gate (7 điều kiện chặn go-live)

Mỗi điều kiện = một phép thử, không phải một dấu tick.

| # | "KHÔNG được go-live nếu…" | Phép thử | Kết quả |
| --- | --- | --- | --- |
| 1 | User không có quyền vẫn đọc được dữ liệu nhân sự/chấm công/nghỉ phép **của người khác** | Deny-path + scope suite trên DB thật | ✅ cho **hồ sơ HR · chấm công · nghỉ phép** (`employees-rbac-scope` · `attendance-permission` · `leave-approval`). ⚠️ **SEC-F04** chạm rìa: `/org/employees` lộ **danh bạ tài khoản** (email/tên/trạng thái/team) — KHÔNG phải hồ sơ HR, KHÔNG có lương/CCCD/công/phép. Phân mức `S2`, **không** coi là vi phạm #1; owner quyết |
| 2 | Employee tự cập nhật hồ sơ chính không qua duyệt | `profile-change-request.int-spec` | ✅ Không thể — self-service **chỉ** tạo request; `PATCH /users/me` chỉ đổi `fullName` của **chính mình** ([users.controller.ts:22](apps/api/src/users/users.controller.ts#L22)), không chạm `employee_profiles` |
| 3 | Token/session vẫn dùng được sau logout/revoke | `auth-logout` · `auth-session` | ✅ 6 đường thu hồi (§2.2 ô 3); reuse-detection thu hồi **cả họ** |
| 4 | Notification hoặc dashboard lộ số liệu ngoài scope | `dashboard-widget-security` · `noti-deeplink-perm-lost` | ⚠️ **Phụ thuộc chữ ký D3** (KI-012 — HR scope Department thấy **con số** headcount toàn công ty; count-only, không PII). Kỹ thuật: không lộ PII. Thủ tục: **chưa ai ký** ⇒ điều kiện #4 **chưa đóng được** |
| 5 | File private tải được bằng URL đoán được / thiếu check permission | `file-access-hardening.int.spec:375/397` · `file-security.int-spec` | ✅ presign TTL ngắn + check quyền record gốc + deny-log; không lộ `storage_path` |
| 6 | Production secret nằm trong repo/log/build artifact | gitleaks CI + audit masker | ✅ gitleaks pass; audit payload không PII; mail-config + reset-token dạng envelope |
| 7 | Migration/seed production tạo user admin với **password mặc định bị lộ** | **P** truy vấn PROD | ⚠️ **GAP** — không phải admin mặc định, nhưng **25 user của 16 tenant TEST còn sống trong DB PROD** với mật khẩu seed test → **SEC-F02**. Riêng nhân sự thật: **45/46** `funtime` user `must_change_password = true` ✅ |

**Kết luận §13.4: 4/7 đóng sạch · 2 chờ thủ tục (#4 chữ ký D3, #7 dọn tenant test) · #1 có 1 lệch mức `S2`.**

---

## 5. Ba bất biến — re-verify bằng số đo (kể cả PROD)

### 5.1 BẤT BIẾN #1 — `company_id` + RLS

| Phép đo | Lane DB | **PROD `mediaos`** |
| --- | --- | --- |
| Bảng có cột `company_id` **và** `RLS + FORCE` | ✅ `rls-coverage-assert.int-spec` (a) | **P** `153 / 153` |
| App role không superuser, không bypass RLS | ✅ `rls-guards.int-spec` | **P** `mediaos_app` `rolsuper=f rolbypassrls=f` · `mediaos_worker` `f/f` |
| Policy ép tenant **cả** `USING` (đọc) **lẫn** `WITH CHECK` (ghi) | ✅ `rls-coverage-assert.int-spec` (b) | — (assert chạy trên lane DB cùng chain migration) |

Truy vấn PROD đã dùng (read-only):

```sql
select count(*) filter (where rel.relrowsecurity and rel.relforcerowsecurity) || ' / ' || count(*)
from information_schema.columns c
join pg_class rel on rel.relname = c.table_name
join pg_namespace n on n.oid = rel.relnamespace and n.nspname = 'public'
where c.table_schema = 'public' and c.column_name = 'company_id' and rel.relkind = 'r';
```

### 5.2 BẤT BIẾN #2 — không hard-delete / append-only

Đối chiếu **danh sách bảng thiết kế** (CLAUDE §2.2) với **grant THẬT của `mediaos_app` trên PROD**:

| Bảng | Nguồn | Grant app role trên PROD |
| --- | --- | --- |
| `audit_logs` · `login_logs` · `attendance_logs` · `leave_balance_transactions` · `task_activity_logs` · `notification_delivery_logs` · `employee_status_histories` | CLAUDE §2.2 (thiết kế) | **P** cả 7: `INSERT,SELECT` ✅ |
| `user_security_events` · `file_access_logs` · `api_key_usages` · `security_alerts` | code hiện ép | **P** cả 4: `INSERT,SELECT` ✅ |
| `leave_request_approvals` · `payslips` | phát sinh | **P** cả 2: `INSERT,SELECT` ✅ |

**13/13 bảng append-only đúng — 0 bảng nào cho app role `UPDATE`/`DELETE`.** (`salary_profiles` có
`UPDATE` là **đúng thiết kế**: bản ghi lương có thể sửa, tính append-only nằm ở **audit** của nó —
`salary-profile-appendonly-audit.int-spec`.)

> **Cảnh báo diễn giải:** họ spec append-only gồm **9 file, 3 kiểu tên** (glob `*-appendonly.int-spec`
> chỉ khớp **6**) — `salary-profile-appendonly-audit.int-spec` · `notification-delivery-append-only.int-spec` ·
> `src/foundation/company/company-users-append-only.int.spec.ts` (colocated). Và **9 spec ≠ 9 bảng**:
> độ phủ theo bảng lấy từ bảng grant ở trên, không từ số spec.

### 5.3 BẤT BIẾN #3 — không secret plaintext

| Phép đo | Kết quả |
| --- | --- |
| Mật khẩu user | **C** argon2id (§2.2 ô 1) |
| Reset token | **T** envelope mã hoá, không plaintext |
| Mail-config | **T** `mail-config-envelope.int-spec` |
| Secret trong repo | CI gitleaks pass |
| Secret trong audit payload | **T** `hr-write.service.spec` "audit payload has NO PII key/value" |
| **Biến bảo mật đọc thẳng `process.env`** | ⚠️ **SEC-F03 / SEC-F05** — xem §6 |

---

## 6. Findings & triage

### 6.1 SEC-F01 — 2FA **không được ép** cho company-admin ở PROD (dù role khai bắt buộc) · `S1`

| | |
| --- | --- |
| **Mức** | **S1 (High)** · Priority **P1** · **KHÔNG phải lỗi code** — lỗi cấu hình vận hành |
| **Bằng chứng (P — PROD `mediaos`)** | `select name from roles where requires_two_factor is true` → **`company-admin`, `platform-admin`**. Ba lớp ép đều TẮT: (1) env PROD `.env` **và** `.env.prod` đặt `TWO_FACTOR_ENFORCEMENT_ENABLED=false` (trong khi [env.schema.ts:55](apps/api/src/config/env.schema.ts#L55) default `"true"`); (2) `company_security_policies.two_factor_enforced` = **NULL** cho `funtime`; (3) user `admin@funtimemediacorp.com` có `require_two_factor = false` |
| **Vì sao là ba lớp** | [two-factor-enforcement.guard.ts:35,~75](apps/api/src/auth/two-factor-enforcement.guard.ts#L35) — `effective2FA = globalEnv \|\| policy.two_factor_enforced`. Global OFF ⇒ **chỉ** ép khi công ty tự bật. Công ty không bật ⇒ **không ép ai** |
| **Tác động** | Tài khoản quản trị công ty **duy nhất** của production (quản lý user · role · permission · audit log) truy cập được **chỉ bằng mật khẩu**. Thiết kế hứa 2FA cho role này; production không giao |
| **KHÔNG phải** | Không phải bypass đăng nhập: user **đã enroll** TOTP vẫn bị challenge (challenge bám theo TOTP đã enroll, độc lập cờ env). Vấn đề là **không ai bị bắt buộc enroll** |
| **Cách đóng (thứ tự BẮT BUỘC — đảo là tự khoá mình ra ngoài)** | 1) admin enroll 2FA qua `/me/security` → 2) đặt `TWO_FACTOR_ENFORCEMENT_ENABLED=true` ở **cả** `.env` và `.env.prod` (nhớ `m prod-env` ghi đè `.env.prod`) → 3) restart API → 4) smoke login. **Đặt cờ trước khi enroll ⇒ admin ăn 403 `TWO_FACTOR_SETUP_REQUIRED` trên mọi route** |
| **Vì sao WS4 KHÔNG tự làm** | Chạm cấu hình + restart PROD; và bước 1 cần **người thật** thao tác trên thiết bị của họ. Thuộc quyết định owner (plan §6) |

### 6.2 SEC-F02 — 16 tenant TEST + 25 user còn sống trong DB PROD · `S2`

| | |
| --- | --- |
| **Mức** | **S2 (Medium)** · Priority **P2** · ánh xạ **§13.4 #7** |
| **Bằng chứng (P)** | `select count(*) from companies` → **17**; khớp mẫu tenant test `slug ~ '-[0-9a-f]{8}$'` → **16**; công ty thật duy nhất: **`funtime`**. User thuộc 16 tenant đó: **25** |
| **Tác động** | Tài khoản **đăng nhập được** trong DB production, dùng mật khẩu seed test (mẫu `Passw0rd!test99` trong helper). Ai biết mẫu đó + slug tenant test ⇒ có phiên hợp lệ. **RLS giữ**: phiên đó bị khoá trong tenant test của nó, KHÔNG thấy dữ liệu `funtime` |
| **Vì sao không cao hơn** | Không chạm dữ liệu thật (bất biến #1 chặn); không leo thang chéo tenant (`rbac-operator-escalation.int-spec:92`) |
| **Liên quan** | Tái diễn của lớp sự cố đã biết (dọn 2026-07-22, 122 công ty test lọt PROD). Lần này **16** ⇒ nguồn rò **chưa bịt** |
| **Đề xuất** | Dọn 16 tenant test khỏi PROD + chặn nguồn (test tuyệt đối không trỏ DB `mediaos`). Thuộc `S6-PERF-DB-1` (WS6 — DB readiness) hoặc WO dọn riêng |

### 6.3 SEC-F03 — `PERMISSION_GUARD_ENABLED`: kill-switch **fail-open toàn hệ**, không validate, không tài liệu · `S2`

| | |
| --- | --- |
| **Mức** | **S2 (Medium)** · Priority **P2** · *(tiềm ẩn — hiện KHÔNG đặt ở PROD, đã kiểm)* |
| **Bằng chứng** | [permission.guard.ts:57-68](apps/api/src/permission/guards/permission.guard.ts#L57) đọc **thẳng** `process.env['PERMISSION_GUARD_ENABLED']`; `=== 'false'` ⇒ `return true` cho **mọi** route đã gate, chỉ để lại một dòng `logger.warn`. Biến này **không** có trong [env.schema.ts](apps/api/src/config/env.schema.ts) và **không** có trong `.env.example` ⇒ zod không validate, không ai biết nó tồn tại |
| **Tác động** | Một biến môi trường đặt nhầm (hoặc kế thừa từ shell/CI/`docker run -e`) **tắt toàn bộ phân quyền** mà không có tín hiệu nào ngoài log. Đối chứng: `TWO_FACTOR_ENFORCEMENT_ENABLED` **có** trong schema với default `"true"` — nên đây là ngoại lệ, không phải quy ước |
| **Đã kiểm** | `.env` và `.env.prod` **không** chứa biến này ⇒ hiện tại guard đang BẬT ở PROD ✅ |
| **Đề xuất** | (a) đưa vào `env.schema.ts` với default `"true"` + ghi vào `.env.example` kèm cảnh báo; (b) **fail-loud lúc boot** nếu `NODE_ENV=production` mà cờ = `false`. Là **thay đổi hành vi sau freeze** ⇒ cần owner duyệt (`RELEASE-05` §4.1); WS4 không tự sửa |

### 6.4 SEC-F04 — `GET /org/employees` trả **danh bạ toàn tenant** cho mọi user đã đăng nhập · `S2`

| | |
| --- | --- |
| **Mức** | **S2 (Medium)** · Priority **P2** · ánh xạ §13.2 RBAC #1/#3 + §13.3 dòng 2 |
| **Bằng chứng** | [org.controller.ts:173-176](apps/api/src/org/org.controller.ts#L173) — không `@UseGuards`, không `@RequirePermission`. [org.repository.ts:322-359](apps/api/src/org/org.repository.ts#L322) `listEmployees()` trả `id · email · fullName · status` + team membership của **mọi** user chưa xoá trong tenant |
| **Vì sao lọt mọi lưới** | [route-guard-coverage.e2e-spec.ts:148](apps/api/test/foundation/route-guard-coverage.e2e-spec.ts#L148) lọc `httpMethod !== "GET"` ⇒ sweep tĩnh **chỉ soi mutation**. Đây là **1 trong 11** route GET không gate nằm trong controller *đã* gate (Phụ lục A) |
| **Vì sao là lệch thật** | Đường đọc song song: `GET /hr/employees` ép data_scope (`employees-rbac-scope.int-spec:247`: Employee Own **chỉ** thấy hồ sơ mình), còn `/org/employees` trả tất cả. Hai đường, hai câu trả lời ⇒ ma trận §13.3 dòng 2 mất hiệu lực trên đường thứ hai |
| **Vì sao KHÔNG phải `S1`** | Trả **danh bạ tài khoản** (email công ty · tên · trạng thái · team), **không** phải hồ sơ HR: không lương, không CCCD, không ngày sinh, không công/phép. `withTenant` + RLS giữ ⇒ **không** rò chéo tenant. FE chỉ gọi từ `apps/console` (màn quản trị) |
| **Đường sửa đã khảo sát sẵn** | Gate `read:user`. **P** PROD `role_permissions`: `read:user@Company` đã cấp cho `company-admin`, `SA`, `project-manager`. Caller FE: **chỉ** `apps/console` (`rbac-api.ts:52`, `org-api.ts:62` → 2 màn `system/objects`, `system/org/org-structure`) — đều là màn của company-admin ⇒ siết **không** gãy UI |
| **Vì sao WS4 vẫn KHÔNG sửa** | Luật dừng của plan §6: chỉ fix `CRITICAL`/`HIGH`. Đây là `S2`, và là **thay đổi hành vi sau freeze** ⇒ owner quyết. Bốn điều kiện an toàn đã khảo sát xong nên fix sẽ rẻ khi được duyệt |
| **Kèm theo** | 3 route `/org/units`, `/org/departments`, `/org/roles` cùng nhóm `TENANT_READ` nhưng **giữ nguyên**: chúng trả cơ cấu tổ chức + danh mục vai trò (`listRoles` đã **loại trừ role operator** để chặn leo thang — `rbac-operator-escalation.int-spec:101`), không phải danh bạ người |

### 6.5 SEC-F05 — `INTERNAL_API_KEY` ngoài `env.schema` / `.env.example` · `S3`

| | |
| --- | --- |
| **Mức** | **S3 (Minor)** · Priority **P3** |
| **Bằng chứng** | [internal.guard.ts:23-29](apps/api/src/permission/guards/internal.guard.ts#L23) đọc thẳng `process.env["INTERNAL_API_KEY"]`; không có trong `env.schema.ts` lẫn `.env.example` |
| **Vì sao nhẹ hơn SEC-F03** | Guard **fail-CLOSED**: thiếu biến ⇒ 403 mọi route `/internal/**` + log warn. Hậu quả là **mất tính năng** (recalculate thủ công, invalidate cache), không phải mất kiểm soát |
| **Đề xuất** | Đưa vào `.env.example` + schema (optional) để lỗi cấu hình hiện ra lúc boot thay vì lúc gọi route |

### 6.6 Bảng triage

| Mã | Mức | Chặn RC? | Chặn go-live? | Chủ | Hành động |
| --- | --- | --- | --- | --- | --- |
| **SEC-F01** 2FA không ép ở PROD | `S1` | ❌ | ⚠️ **nên đóng trước go-live** | Owner | 4 bước §6.1, ~10 phút, KHÔNG cần sửa code |
| **SEC-F02** 16 tenant test trong PROD | `S2` | ❌ | ⚠️ | Owner/DevOps | Dọn + bịt nguồn (`S6-PERF-DB-1`) |
| **SEC-F03** kill-switch fail-open | `S2` | ❌ | ❌ | Sau MVP / CR | Vào schema + fail-loud lúc boot |
| **SEC-F04** `/org/employees` danh bạ mở | `S2` | ❌ | ❌ | CR chờ owner | Gate `read:user` (đường sửa đã khảo sát) |
| **SEC-F05** `INTERNAL_API_KEY` ngoài schema | `S3` | ❌ | ❌ | Sau MVP | Tài liệu hoá |
| D3 (KI-012) | `S3` | ❌ | ⚠️ cần chữ ký | Owner | Ký `C4` → đóng §13.4 #4 |

---

## 7. Phụ lục A — Phán quyết 38 route không `@RequirePermission` / `@Public()`

Đo **tự thân** trong WO này (không lấy số từ nhánh chưa merge): **452 route / 80 controller**.
Chia theo 6 ô của plan §4 Bước 2.

> **Bẫy đo lường đã sửa trong lúc làm** (ghi lại để lần sau không lặp): (a) `@RequirePermission` đặt ở
> **cấp class** phủ mọi route qua `reflector.getAllAndOverride([handler, class])` — bỏ vế này đếm thừa
> 11 route `/me/*`; (b) nhiều file khai `export class XxxDto` **trước** controller ⇒ neo "decorator cấp
> class" vào `export class` đầu tiên sẽ cắt mất `@Public()`/`@UseGuards` của controller
> (`lms-notifications.controller.ts`: DTO ở `:20`, `@Public` ở `:60`); (c) decorator có thể nằm **trên**
> `@Controller` (`health.controller.ts`: `@Public()` ở `:5`).

| Ô | Số | Route | Căn cứ |
| --- | ---: | --- | --- |
| **SELF** | 15 | `/auth/2fa/{enroll,enable,disable,status}` · `/auth/change-password` · `/auth/sessions` · `/auth/sessions/:id/revoke` · `/auth/sessions/revoke-others` · `/notifications/devices` (POST) · `/notifications/devices/:token` (DELETE) · `/notifications/preferences` (GET/PUT) · `PATCH /users/me` · `GET /approval/inbox` · `GET /foundation/modules/my-apps` | Service ép chủ thể từ token: `req.user.id`/`req.user.companyId` — [auth.controller.ts:227,237,255,263,273,283](apps/api/src/auth/auth.controller.ts#L227) · [notifications.controller.ts:45,60,71,87](apps/api/src/notifications/notifications.controller.ts#L45) · [users.controller.ts:27](apps/api/src/users/users.controller.ts#L27) (`WHERE id = self`) · [approval-inbox.controller.ts:28](apps/api/src/approval/approval-inbox.controller.ts#L28). `my-apps` lọc theo **quyền của chính user** (**T** `my-apps-canonical-role.int-spec:124`) |
| **PUBLIC** | 2 | `GET /health` · `GET /health/db` | `@Public()` cấp class ([health.controller.ts:5](apps/api/src/health/health.controller.ts#L5)) — probe hạ tầng, không dữ liệu nghiệp vụ |
| **OTHER_GUARD** | 2 | `POST /internal/v1/notifications/events` · `POST /internal/v1/dashboard/cache/invalidate` | `InternalGuard` cấp class — đòi `x-internal-key` khớp `INTERNAL_API_KEY`; **fail-CLOSED** khi biến chưa đặt ([internal.guard.ts:23-29](apps/api/src/permission/guards/internal.guard.ts#L23)). Vẫn nằm sau `JwtAuthGuard`+`CompanyGuard` toàn cục |
| **TENANT_READ** | 4 | `GET /org/units` · `/org/departments` · `/org/roles` · **`/org/employees`** | Quy ước nhà ghi ở [org.controller.ts:37](apps/api/src/org/org.controller.ts#L37) ("READ giữ mở cho mọi user tenant"). 3 route đầu = cơ cấu tổ chức + danh mục vai trò (đã loại role operator) ⇒ **ACCEPTED**. Route thứ 4 = **danh bạ người** ⇒ **GAP → SEC-F04** |
| **DEAD-410** | 4 | `POST/GET /tasks/:taskId/attachments` · `GET …/:attachmentId/download` · `DELETE …/:attachmentId` | Cả 4 handler `return gone()` — **luôn 410**, không đọc/ghi gì ([task-attachments.controller.ts:39-60](apps/api/src/tasks/task-attachments.controller.ts#L39)); khoá bởi **T** `legacy-attachments-lock.int-spec` |
| **PARKED** | 11 | `GET /workflow-templates` · `GET /workflow/:instanceId` · `/workflow/approval-requests` (+approve/request-revision) · `/workflow/by-content/:contentItemId` · `POST /workflow/start` · `/workflow/steps/:stepId/{checklist,checklist-items/:itemId ×2,start,submit}` | Module CONTENT/media **đã park** (CLAUDE §1 de-media-fy · `RELEASE-05` §2.4). ⚠️ **Vẫn mounted ở PROD**: user đã đăng nhập gọi được. Rủi ro thực tế thấp (bảng `content_items` không có dữ liệu nghiệp vụ MVP) nhưng **đây là bề mặt tấn công không cần thiết** — đề xuất owner: **gỡ mount** hoặc gate cấp class trước RC |
| **GAP** | **1** | `GET /org/employees` | → **SEC-F04** (§6.4) |

**11 route GET nằm trong controller ĐÃ có route gate** — tức ngoài lưới `route-guard-coverage`:
`/approval/inbox` · `/foundation/settings/public` · `/org/{units,departments,roles,employees}` ·
`/workflow-templates` · `/workflow/:instanceId` · `/workflow/{approval-requests,by-content/:id,steps/:id/checklist}`.
Trong đó **1 là GAP**, còn lại `SELF`/`TENANT_READ`/`PARKED`.

> **Đề xuất bền (rẻ, không đổi hành vi runtime):** mở rộng `route-guard-coverage.e2e-spec` sang **GET**
> với allow-list có lý do, để route đọc mới **không lẳng lặng** gia nhập tập không-gate. Allow-list chỉ
> được chứa route đã phán quyết `SELF`/`PUBLIC`/`OTHER_GUARD`/`DEAD-410` — **không** được chứa
> `TENANT_READ`/`GAP` (đưa vào = tự ký thay owner). Là **việc mới sau freeze** ⇒ đề xuất, không tự làm.

---

## 7b. Hồ sơ FULL gate (kết quả: **BLOCK × 3**)

| Reviewer | Bắt buộc bởi | Kết quả | Phát hiện nặng nhất |
| --- | --- | --- | --- |
| `security-reviewer` | `done_when` | **BLOCK** | SEC-F00-A (3 tài khoản platform-admin, mật khẩu trong repo public) · census 43 ≠ 38 · KI-030 là 3 route · gốc rễ `.env.example:91` |
| `rls-tenant-isolation-tester` | `done_when` | **BLOCK** | SEC-F00-B (xoá chéo tenant grant role toàn cục, không hoàn tác được) · matview ngoài phép đo 153/153 · grant `DELETE ON roles` thừa |
| ~~`silent-failure-hunter`~~ → **agent thay thế** | `done_when` + CLAUDE §6 | **BLOCK** | `export:leave` **không ghi audit** nào (trái §2.4 ô 4/5) · audit của `notifications.service` **không cùng tx** dù chú thích nói có · `login_logs` bỏ ghi im lặng (`if (!db) return;`) · 6 file bị exclude khỏi bằng chứng · 2FA company-policy fail-open và **cache 30s** |

> **Sai lệch quy trình phải ghi:** agent `silent-failure-hunter` mà CLAUDE §6 yêu cầu **không được cài
> trong môi trường này**. Đã chạy **đúng phạm vi** bằng một agent general-purpose với chỉ dẫn chuyên
> biệt, và ghi lại đây thay vì đánh dấu như thể đã chạy đúng agent. Kết quả của nó vẫn là BLOCK và vẫn
> tìm ra 3 lỗi `S1` — nhưng người đọc cần biết cấu hình gate đã lệch so với luật.

**Chưa chạy** (điều kiện kích hoạt của CLAUDE §6 đã bật nhưng WO dừng trước đó): `database-reviewer`
(SEC-F00-B chạm policy/migration) và `santa-method` (crown). Phải chạy ở WO vá.

## 7c. Việc phải làm để gỡ BLOCK

| # | Việc | Ai | Ghi chú |
| --- | --- | --- | --- |
| 1 | **Thu hồi 3 grant role `…f0`** rồi xoá 25 user + 16 tenant test khỏi PROD | **Owner** | Thao tác **phá huỷ trên PROD** — cần bạn duyệt tường minh. Backup trước |
| 2 | Coi `Passw0rd!test99` là **đã cháy**; đổi mẫu mật khẩu fixture | Owner/dev | Repo PUBLIC, 86 file |
| 3 | Vá SEC-F00-B 3 lớp (policy `FOR DELETE` · guard `isSystem` ×2 · gỡ grant `DELETE ON roles`) + **RED test trước** | WO mới, crown | Có migration ⇒ nối tiếp, không song song `S6-PERF-DB-1` |
| 4 | Sửa `.env.example:91` → `true` | WO mới | Chặn tái diễn SEC-F01 |
| 5 | Dựng lại Phụ lục A bằng **quét runtime**; chấm lại §2.3 · §13.3 · §13.4 | WO này (vòng 2) | §0.4 |
| 6 | Mở rộng SEC-F04 sang `/org/teams/:id/members` + `/org/teams` + `/org/units/tree` | WO mới | Nâng `S1` |
| 7 | Thêm ca **deny GHI chéo tenant** vào `tenant-isolation.int-spec` (hiện 465 ca đều SELECT) | WO mới | Đây là lớp lỗ hổng, không phải một bug |
| 8 | Vá `export:leave` thiếu audit · audit `notifications.service` ra ngoài tx · `login_logs` bỏ ghi im lặng | WO mới | Cả 3 chạm `done_when` #2 |

## 7d. Đợt VÁ (2026-07-27 — owner duyệt "xử lý vá luôn")

### S0-B — ĐÃ VÁ, RED → GREEN

Vá **hai tầng độc lập** (tầng nào tuột thì tầng kia vẫn chặn):

| Tầng | Thay đổi |
| --- | --- |
| DB | [`migrations/0530_s6sec1_system_role_immutable.sql`](apps/api/migrations/0530_s6sec1_system_role_immutable.sql) — (a) policy **RESTRICTIVE `FOR DELETE`** trên `role_permissions` bắt buộc role thuộc tenant hiện tại (RESTRICTIVE **AND** với policy permissive sẵn có ⇒ **giữ nguyên đường ĐỌC** role hệ thống, chỉ siết DELETE); (b) **`REVOKE DELETE ON roles FROM mediaos_app`** — đặc quyền thừa, không code path nào dùng (`deleteRole` xoá **mềm** bằng UPDATE, và UPDATE vốn an toàn vì `WITH CHECK` **có** áp cho UPDATE) |
| App | [`role-admin.service.ts`](apps/api/src/permission/role-admin.service.ts) — thêm guard `role.isSystem` vào **cả** `assignPermissionToRole` **và** `revokePermissionFromRole`, mirror `updateRole`/`deleteRole` vốn đã có |

**Bằng chứng RED → GREEN** ([`role-system-immutable.int-spec.ts`](apps/api/test/integration/role-system-immutable.int-spec.ts), 6 ca, phủ **cả hai tầng**):

| | Trước vá | Sau vá |
| --- | --- | --- |
| Service `revokePermissionFromRole` trên role toàn cục | ❌ **`promise resolved` — xoá THÀNH CÔNG** | ✅ `BadRequestException`, 0 grant đổi |
| Service `assignPermissionToRole` trên role toàn cục | ❌ `InternalServerError` (RLS chặn nhưng 500, không phải 400) | ✅ `BadRequestException`, 0 grant đổi |
| RLS `DELETE role_permissions` role toàn cục | ❌ **xoá 66 hàng** | ✅ **0 hàng** |
| RLS `DELETE roles` toàn cục | ❌ không bị chặn | ✅ bị chặn (đã thu hồi GRANT) |
| *Không siết quá tay:* đọc role hệ thống | ✅ vẫn đọc được | ✅ vẫn đọc được |
| *Không siết quá tay:* xoá grant role **của chính tenant** | ✅ chạy | ✅ vẫn chạy |

Regression bộ quyền/role: **8 file · 152 test xanh** (`permission-admin` · `role-permission-grants` ·
`role-permission-data-scope` · `role-members` · `rbac-operator-escalation` · `auth-seed-canonical-roles` ·
`permission-rule-apply` · `role-admin.service.spec`).

> **Hai bẫy gặp khi viết RED test, ghi lại vì đều tạo "xanh-giả ngược"** (tưởng đã chặn, thật ra chưa
> chạm tới chỗ cần kiểm): (1) `new PermissionRepository()` **không truyền `DatabaseService`** trả về 0
> grant ⇒ `can()` ra `deny-default` ⇒ test đỏ ở cổng `assertCan` chứ không phải ở guard system-role;
> (2) `ROLLBACK` đặt trong `try` — assertion ném thì rollback **không chạy** và connection **đang dở
> transaction** bị trả về pool, làm test kế tiếp đọc trạng thái bẩn. Cả hai đã sửa; `ROLLBACK` nay nằm
> trong `finally`.

### KI-036 — ĐÃ VÁ

`.env.example:91` `TWO_FACTOR_ENFORCEMENT_ENABLED` đổi **`false` → `true`** kèm cảnh báo thứ tự thao
tác. Đây là **gốc rễ** của KI-027: `cp .env.example .env` là bước cài chuẩn (CLAUDE §7) nên giá trị
`false` đã theo vào PROD.

### S0-A — script sẵn sàng, CẦN OWNER CHẠY

[`scripts/s6sec1-contain-test-tenants.sql`](scripts/s6sec1-contain-test-tenants.sql). Phiên này **bị
lớp phân quyền của công cụ chặn ghi vào DB PROD** — đã dừng đúng chỗ thay vì tìm đường lách. Script:
thu hồi 3 grant operator → suspend + soft-delete + băm mật khẩu 25 user tenant test → xoá refresh
token. Một transaction, có chốt an toàn tự `RAISE EXCEPTION` nếu `funtime` lọt vào tập, in số đo
trước/sau.

**Cố ý KHÔNG hard-delete company/user:** 11 FK tới `companies` là `NO ACTION` (gồm `audit_logs`
append-only) ⇒ purge là thao tác riêng, rủi ro cascade cao hơn hẳn — tách sang `S6-PERF-DB-1`. **Chặn
đường vào đã đóng hết bề mặt bảo mật**; purge chỉ còn là vệ sinh dữ liệu.

Backup PROD trước khi vá đã tạo: `c:\tmp\mediaos-prod-pre-s6sec1fix-20260727-004838.dump`.

### Còn LẠI — chưa vá trong đợt này (có chủ ý)

| Mục | Vì sao hoãn |
| --- | --- |
| KI-030 `/org/employees` + `/org/teams/:id/members` | Siết quyền là **thay đổi hành vi** có rủi ro 403-storm. `/org/units/tree` và `/org/teams` **đang được `apps/app` dùng** (OrgChartPage, TaskSidebarTree) nên **không** được siết cùng một nhát. Cần tách: gate 2 route console-only, giữ 2 route app-wide làm `TENANT_READ` có chữ ký. Việc của WO riêng, không nhét vào cuối một phiên dài |
| KI-033/034/035 (audit `export:leave` · audit `notifications` ngoài tx · `login_logs` bỏ ghi im lặng) | Ba lỗi `S1` chạm `done_when` #2, nhưng nằm ở 3 module khác nhau và cần RED test riêng từng cái |
| Dựng lại Phụ lục A bằng quét runtime | §0.4 — parse tĩnh đã sai 4 lần; phải làm bằng công cụ khác, không phải regex |

## 8. Kết luận WS4

| `done_when` | Trả lời |
| --- | --- |
| Checklist §13.2 đủ 5 nhóm — không lỗi CRITICAL/HIGH mở | ⚠️ **30/30 mục chấm** (§2.7): 23 ✅ · 3 một-phần/accepted · 3 GAP · 1 L. **0 CRITICAL.** **1 HIGH (`S1`)** = **SEC-F01**, là **cấu hình PROD**, đóng bằng thao tác owner |
| Audit log đầy đủ hành động quan trọng; append-only không phá | ✅ §2.4 ô 5 (1 audit/lần xem identity, kể cả **mỗi hàng** ở list) + §5.2 (**13/13** bảng append-only đúng **trên PROD**) |
| 3 bất biến verify lại toàn hệ | ✅ §5 — đo trên **cả** lane DB **và** PROD: 153/153 RLS+FORCE · app/worker không bypass · 13/13 append-only · secret dạng envelope |
| §13.3 ma trận | ✅ §3 — **9/10 case khớp**, 1 lệch ở đường đọc phụ (SEC-F04) |
| §13.4 gate | ⚠️ §4 — **4/7 đóng sạch**, 2 chờ thủ tục (chữ ký D3 · dọn tenant test), 1 lệch `S2` |
| FULL gate 3 reviewer PASS | *(§9 — chạy sau khi báo cáo này chốt)* |
| plan-reviewer PASS trước sửa | ✅ vòng 2 PASS; **và WS4 kết thúc mà KHÔNG sửa dòng code sản phẩm nào** |

**Điều đáng nói nhất của WS4:** ba phát hiện nặng nhất (**SEC-F01** 2FA, **SEC-F02** tenant test,
**SEC-F04** danh bạ mở) đều **không** bị bắt bởi 10.102 test xanh — hai cái đầu vì chúng sống ở **cấu
hình và dữ liệu PROD**, cái thứ ba vì lưới kiểm tra tĩnh **cố ý bỏ qua route GET**. Cả ba chỉ hiện ra
khi đi hỏi production trực tiếp và khi tự đo lại thay vì tin lưới sẵn có.
