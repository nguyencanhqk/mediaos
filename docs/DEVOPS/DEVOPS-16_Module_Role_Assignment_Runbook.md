# DEVOPS-16: RUNBOOK GÁN ROLE MODULE TRÊN PROD

# HỆ THỐNG QUẢN LÝ DOANH NGHIỆP NỘI BỘ

> **Work Order:** S14-OPS-MODULEROLE-1 · wave S14-CONSOLIDATE
> **Nguồn:** `harness/handoff.md` 30/08/2026 (nợ ASSET) · migration `0550`/`0554`/`0560`/`0565`
> **Chuẩn thiết kế đối chiếu:** [DEVOPS-08 Staging/UAT/Production](DEVOPS-08_Staging_UAT_Production_Environment.md) · [RELEASE-11 Admin Guide](../RELEASE/RELEASE-11_Admin_Guide.md)
> **Loại:** runbook vận hành — **KHÔNG sinh code**. Owner quyết ai được gán role nào; tài liệu này dựng
> danh sách, thủ tục và cách nghiệm thu.

---

## 1. Thông tin tài liệu

| Trường          | Giá trị                                                                       |
| --------------- | ----------------------------------------------------------------------------- |
| Ngày lập         | 2026-09-03                                                                    |
| Môi trường đích  | PROD — API `:3100` (NSSM `MediaOS-API`), DB `mediaos`, company `funtime`       |
| Công cụ đo       | `scripts/s14-audit-module-roles.mjs` (**chỉ SELECT**, không ghi một hàng nào)  |
| Đường gán        | Console `/system/permissions` (CS-2 "Phân quyền") — đường sản phẩm, có audit   |
| Gate             | LIGHT (yellow zone)                                                           |

---

## 2. Vì sao tài liệu này tồn tại

Migration seed role của mỗi wave (`0550` ASSET · `0554` ROOM · `0560` RECRUIT · `0565` PAYROLL) chỉ làm
**hai** việc: TẠO role và cấp `role_permissions` cho role đó. Không migration nào **gán role cho người** —
`user_roles` không được đụng tới. Việc gán là dữ liệu riêng của tenant, không thuộc migration.

Đường bù còn lại trên lý thuyết là `SuperAdminBootstrapService` (grant toàn bộ catalog mỗi lần boot,
`super-admin-bootstrap.service.ts:31-45` — "tự phủ permission module mới mỗi boot"). **Đường này CHẾT trên
PROD**: nó chỉ chạy khi `PLATFORM_SUPERADMIN_EMAIL` được set, và biến đó **không có trong `<repo>/.env`**
(đo 03/09/2026 — `grep -c` trả `0`). Vắng email → no-op.

⇒ **Không có đường tự động nào gán role module cho người thật trên PROD.** Hệ quả đo được:

| Hệ quả                | Cơ chế                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Module **vô hình**     | App-shell lọc theo `MODULE_APP_METADATA.requiredAny`; không ai có cặp ⇒ module không hiện trong vỏ nghiệp vụ                                             |
| NOTI **phát 0**        | `ASSET_MAINTENANCE_DUE` resolve người nhận **theo TÊN ROLE**, không theo cặp quyền                                                                       |

Không cổng tự động nào bắt được việc này: typecheck, CI, int-spec đều xanh vì đây là **trạng thái dữ liệu
của một DB cụ thể**, không phải mã nguồn. Vì vậy bước 1 bắt buộc là **ĐO**, không đoán.

---

## 3. Bốn role sinh bởi wave S11/S12/S13

Đo từ migration (`INSERT INTO roles`) 03/09/2026 — tất cả đều `company_id IS NULL`, `is_system = true`:

| Wave | Module      | Role              | Migration | `requires_two_factor` | Cặp mở khoá module (`requiredAny`) |
| ---- | ----------- | ----------------- | --------- | --------------------- | ----------------------------------- |
| S11  | **ASSET**   | `asset-manager`   | `0550`    | `false`               | `view:asset`                        |
| S11  | **ROOM**    | `office-admin`    | `0554`    | `false`               | `view:room`                         |
| S12  | **RECRUIT** | `recruiter`       | `0560`    | `false`               | `view:job-opening`                  |
| S13  | **PAYROLL** | `payroll-officer` | `0565`    | **`true`** ⚠️          | `view:payroll-period`               |

Cặp ở cột cuối lấy từ `module-app-metadata.ts` (ASSET:150 · ROOM:159 · RECRUIT:169 · PAYROLL:182) — đây
chính là cặp mà `hasAnyCapability()` kiểm để quyết định module có **hiện** trong app-shell hay không.

### 3.1 Role mở khoá cái gì — hai cơ chế KHÁC NHAU

Đo bằng census toàn bộ `src/` (03/09/2026): **`asset-manager` là tên role DUY NHẤT được mã nguồn runtime
tham chiếu** (`asset-audience.reader.ts:45`). Ba role còn lại không xuất hiện ở bất kỳ đâu trong `src/`.

| Role              | Mở khoá **hiển thị** (qua cặp quyền) | Mở khoá **NOTI** (qua tên role) |
| ----------------- | ------------------------------------ | -------------------------------- |
| `asset-manager`   | ✅ `view:asset`                       | ✅ `ASSET_MAINTENANCE_DUE`        |
| `office-admin`    | ✅ `view:room`                        | ❌ không job nào đọc tên role      |
| `recruiter`       | ✅ `view:job-opening`                 | ❌                                |
| `payroll-officer` | ✅ `view:payroll-period`              | ❌                                |

**Ý nghĩa vận hành:** với ROOM/RECRUIT/PAYROLL, *bất kỳ* role nào mang đủ cặp quyền đều làm module hiện —
không nhất thiết phải là role hệ thống. Với **ASSET thì khác**: người nhận `ASSET_MAINTENANCE_DUE` được
resolve bằng câu SQL ghim cứng tên role:

```sql
-- asset-audience.reader.ts:41-48
join roles r on r.id = ur.role_id
 and r.company_id is null          -- ⚠️ CHỈ role hệ thống
 and r.deleted_at is null
 and r.name in ('asset-manager', 'company-admin')
```

Vị từ `r.company_id is null` nghĩa là **role tuỳ biến của tenant KHÔNG BAO GIỜ khớp**, dù role đó có đủ
mọi quyền ASSET. Trên PROD, hai role tuỳ biến `SA` và `QUẢN LÝ CẤP CAO` là role tenant (`company_id` NOT
NULL) ⇒ người giữ chúng **thấy được** module ASSET nhưng **không nhận** được thông báo bảo trì. Đây là
giả thuyết chính cần census xác nhận ở bước 1.

---

## 4. Bước 1 — CENSUS (đo trước, không đoán)

Chạy từ gốc repo. Script **chỉ SELECT**, an toàn chạy trên PROD bất kỳ lúc nào:

```bash
node scripts/s14-audit-module-roles.mjs           # bảng người đọc
node scripts/s14-audit-module-roles.mjs --json    # JSON cho pipeline
```

Script đọc `DATABASE_DIRECT_URL` từ **`<repo>/.env`** — file env RUNTIME thật của PROD. `.env.prod`
**không** phải file runtime (xem §7). Muốn đo DB khác thì set sẵn `DATABASE_DIRECT_URL` trong môi trường.

Script trả 6 khối:

| # | Khối                    | Dùng để trả lời                                                              |
| - | ----------------------- | ----------------------------------------------------------------------------- |
| 1 | Migration head + số đã áp | Lô `0564–0568` đã áp chưa? Chưa áp ⇒ `payroll-officer` **chưa tồn tại**      |
| 2 | Toàn bộ role + `members`/`perms` | Bức tranh đầy đủ: role nào có người, role nào rỗng                    |
| 3 | 4 role wave + danh sách người giữ | `exists` · `has_probe_pair` · `members` · email/2FA của từng người |
| 4 | `modules.is_active`      | Đối chiếu app-shell (**lưu ý: `is_active` KHÔNG phải cổng quyền** — §7)      |
| 5 | Grant wildcard còn sót    | Đường ngầm quanh mọi cổng — phải rỗng sau khi `s13-revoke-wildcard-grants.mjs` chạy |

### 4.1 Bảng census — điền từ output

**Đã biết trước (đo PROD 02/09/2026, ghi trong commit `f0892425` của PR #467 — chỉ SELECT):**

- **236/236 migration đã áp, head `0568`** ⇒ lô `0564–0568` XONG, `payroll-officer` **tồn tại thật** trên
  PROD. Điều kiện tiên quyết của WO này **đã thoả**.
- **0 hàng wildcard** còn lại ở mọi role ngoài `super-admin` ⇒ kết luận "module vô hình" ở §4.2 là đọc
  được, không bị wildcard làm nhiễu.
- **Quyền lương = 32 hàng** đúng ma trận §9g: `company-admin` 15 · `payroll-officer` 14 · `employee` 3.
  ⚠️ Nghĩa là **`company-admin` cũng mở khoá PAYROLL** — không nhất thiết phải gán `payroll-officer` để
  ai đó *thấy* module lương.

**Còn THIẾU (chính là thứ WO này phải đo): số người giữ mỗi role.** Ba dòng trên nói role và quyền đã
đúng; không dòng nào nói **có ai đang giữ role hay không**. Điền bảng dưới bằng khối 3 của script:

| Module  | Role              | Tồn tại      | Có cặp mở khoá | Số người giữ | Ai giữ |
| ------- | ----------------- | ------------ | --------------- | ------------ | ------ |
| ASSET   | `asset-manager`   | ?            | ?               | **?**        |        |
| ROOM    | `office-admin`    | ?            | ?               | **?**        |        |
| RECRUIT | `recruiter`       | ?            | ?               | **?**        |        |
| PAYROLL | `payroll-officer` | ✅ (0565 áp) | ✅ 14 hàng      | **?**        |        |

Ghi thêm hai dòng nữa từ khối 2 — đây là hai role **hệ thống** quyết định NOTI của ASSET (§3.1) và
là đường thấy PAYROLL thứ hai:

| Role            | Số người giữ | Vì sao quan trọng                                                      |
| --------------- | ------------ | ----------------------------------------------------------------------- |
| `company-admin` | **?**        | Khớp reader NOTI ASSET **và** có 15 cặp lương ⇒ nếu > 0 thì cả hai vấn đề của WO đã tự khỏi một phần |
| `SA` (tenant)   | ~10          | Role tuỳ biến ⇒ thấy module nhưng **không** nhận NOTI ASSET (§3.1)      |

### 4.2 Đọc kết quả

- **`exists = false` cho `payroll-officer`** ⇒ lô `0564–0568` chưa áp. DỪNG: chạy `pnpm db:migrate`
  trước, rồi census lại. *Đo 02/09 cho thấy đã áp đủ (head `0568`) — nếu nhánh này xảy ra thì DB đã bị
  rollback về trước `0564`, đó là sự cố riêng, KHÔNG vá bằng cách gán role.*
- **`exists = true` nhưng `has_probe_pair = false`** ⇒ role tồn tại mà thiếu quyền: migration seed áp
  nửa vời. Đây là lỗi DB, KHÔNG vá bằng cách gán thêm role — điều tra migration trước.
- **`members = 0`** ⇒ đúng triệu chứng WO mô tả: module ship rồi mà không ai dùng được.
- **Khối 5 không rỗng** ⇒ còn role giữ wildcard. Wildcard làm `hasAnyCapability()` trả `true` cho MỌI
  cặp ⇒ mọi kết luận "module vô hình" ở trên **sai** với người giữ nó. Xử wildcard trước khi kết luận.

---

## 5. Bước 2 — GÁN (đường sản phẩm, có audit)

**Đường duy nhất được phép:** app **console** → `/system/permissions` (CS-2 "Phân quyền") → chọn user →
nút gán role → chọn role trong danh sách → (tuỳ chọn) đặt `expiresAt` → xác nhận.

- BE: `POST /permissions/users/:userId/roles` — `permission-admin.controller.ts:45`
- Quyền cần: **`assign-role:user`** (`isSensitive: true`, đã nằm trong allowlist sensitive BE tại
  `permission.service.ts:66` ⇒ nút không bị allowlist giấu mất)
- Vết để lại **trong cùng một transaction**: `audit_logs` (`RoleAssigned` / `RoleReassigned`, `object_type`
  = `user_role`) + `user_security_events` (`ROLE_ASSIGNED`, severity `medium`) + outbox `permission.changed`
  (đập cache capability ⇒ hiệu lực ngay, không cần restart API)

**KHÔNG** blanket grant. **KHÔNG** SQL tay — SQL tay bỏ qua cả ba vết trên và không đảo ngược được bằng UI.

### 5.1 Bốn ràng buộc của `assignRole` (đo từ `permission-admin.service.ts:83-160`)

| # | Ràng buộc                                | Hệ quả vận hành                                                                                                        |
| - | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1 | Cần `assign-role:user`                    | Người thao tác phải có cặp này                                                                                          |
| 2 | **SoD: KHÔNG tự gán cho chính mình**      | `actor.id === targetUserId` → 403. **Cần HAI người**: A gán cho B, B gán cho A. Công ty chỉ có 1 admin ⇒ kẹt.            |
| 3 | Role phải "assignable"                    | Chỉ `platform-admin` (`…f0`) bị loại. Cả 4 role wave đều hiện trong danh sách chọn.                                     |
| 4 | Target phải thuộc tenant                  | Không gán chéo công ty                                                                                                  |

**KHÔNG có** ràng buộc "chỉ cấp được quyền mình đang có". Người có `assign-role:user` gán được
`payroll-officer` cho người khác **kể cả khi bản thân không còn quyền lương nào** — đúng tình huống sau khi
`s13-revoke-wildcard-grants.mjs` thu hồi nhóm lương khỏi `SA` / `QUẢN LÝ CẤP CAO`.

### 5.2 ⚠️ `payroll-officer` — THỨ TỰ THAO TÁC QUYẾT ĐỊNH THÀNH BẠI

`payroll-officer` là role duy nhất có `requires_two_factor = TRUE`. Trên PROD
`TWO_FACTOR_ENFORCEMENT_ENABLED=true` (đo `.env` 03/09/2026) ⇒ `TwoFactorEnforcementGuard` đang **bật**.

`requiresTwoFactorTx` kiểm `users.require_two_factor` **HOẶC bất kỳ role nào đang giữ** có
`requires_two_factor = true`. Nên gán role này cho người **chưa enroll TOTP** sẽ khiến họ nhận
**403 `TWO_FACTOR_SETUP_REQUIRED` ở MỌI route** — không riêng gì PAYROLL. Triệu chứng nhìn y hệt "hệ thống
hỏng toàn diện", và người đó mất luôn quyền vào các module họ vẫn đang dùng.

**Thứ tự bắt buộc:**

1. Người nhận tự bật 2FA trước: `apps/app` → avatar → "Tài khoản của tôi" → `/account/profile` → thẻ
   **"Bảo mật"** → bật 2FA, quét QR, xác nhận mã, **lưu recovery codes**.
2. Xác nhận `two_factor_enabled = true` cho người đó (khối 3 của script census có sẵn cột này).
3. **Rồi mới** gán `payroll-officer` qua console.
4. Người nhận đăng xuất, đăng nhập lại → phải qua bước-2 TOTP thành công.

**Không đảo ngược dễ:** sau khi giữ role này, người đó **không tự tắt được 2FA** (409
`TWO_FACTOR_ENFORCED`) và nút "Tắt 2FA" bị ẩn. Muốn tắt phải thu hồi role trước.

---

## 6. Bước 3 — NGHIỆM THU (bằng hành vi, không bằng "đã bấm xong")

| # | Kiểm                     | Cách làm                                                                                                     | Đạt khi                                                              |
| - | ------------------------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| 1 | Census lại               | `node scripts/s14-audit-module-roles.mjs`                                                                     | `members` của role vừa gán tăng đúng số người dự kiến                 |
| 2 | Module hiện               | Người được gán đăng nhập `apps/app`, xem vỏ nghiệp vụ                                                        | Module xuất hiện, mở đúng route (`/assets` · `/rooms` · `/recruit/job-openings` · `/payroll/periods`) |
| 3 | Vết audit                 | Console → nhật ký audit, lọc `RoleAssigned`                                                                  | Có đúng 1 hàng/lượt gán, đúng actor + target                          |
| 4 | NOTI ASSET                | Chờ nhịp scheduler kế (60s) sau khi có người giữ `asset-manager`                                             | `ASSET_MAINTENANCE_DUE` phát **> 0** — hoặc giải thích được vì sao 0   |
| 5 | 2FA payroll               | Người giữ `payroll-officer` đăng xuất/đăng nhập lại                                                          | Qua bước-2 TOTP, vào được `/payroll/periods`                          |

### 6.1 Khi nào "0 thông báo" là ĐÚNG

`ASSET_MAINTENANCE_DUE` phát 0 mà **không** phải lỗi, nếu bất kỳ điều nào sau đây đúng — kiểm theo thứ tự:

1. **Không có tài sản nào đến hạn.** Job chỉ lấy tài sản có `next_maintenance_due <= current_date + 7`,
   chưa Disposed/Lost, chưa xoá (`asset-maintenance-due.job-handler.ts:100`). Cửa sổ 7 ngày; kho tài sản
   trống hoặc chưa ai đặt `next_maintenance_due` ⇒ 0 là đúng.
2. **Đã nhắc rồi.** Dedupe key `ASSET_MAINTENANCE_DUE:<assetId>:<dueDate>` — cùng hạn KHÔNG nhắc lại dù job
   chạy mỗi 60s. Lần chạy thứ hai trở đi phát 0 là **đúng thiết kế**.
3. **Có tài sản đến hạn nhưng 0 người nhận** ⇒ đây là **LỖI đang tìm**. Job ghi log cảnh báo tường minh:
   `ASSET_MAINTENANCE_DUE tenant=…: N tài sản đến hạn nhưng KHÔNG có user nào giữ role
   asset-manager/company-admin còn hiệu lực.` (`job-handler.ts:69`). Thấy dòng này ⇒ chưa gán xong.

Dòng log ở mục 3 là **cách phân biệt duy nhất** giữa "0 vì không có việc" và "0 vì không có người".

---

## 7. Bẫy đã biết

| Bẫy                                                                | Vì sao cắn                                                                                                                        |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Sửa `.env.prod` rồi restart                                         | `.env.prod` **không** phải env runtime. API nạp `<repo>/.env`. Đổi ở file kia cho mọi dấu hiệu thành công mà cấu hình không đổi gì. |
| Kết luận "module vô hình" khi còn wildcard                          | `hasAnyCapability()` coi `*:*` là TRUE ⇒ người giữ wildcard thấy hết. Xử khối 5 của census trước.                                   |
| Bật `modules.is_active` để "cho module hiện"                        | `is_active` **KHÔNG phải cổng quyền**. Bật nó không thay việc gán role, và có thể chặn WO khác.                                     |
| Gán `payroll-officer` trước khi người đó bật 2FA                     | 403 `TWO_FACTOR_SETUP_REQUIRED` ở **mọi** route — §5.2.                                                                             |
| Trông chờ role tenant (`SA`) nhận NOTI ASSET                        | Reader ghim `r.company_id is null` ⇒ chỉ role hệ thống khớp — §3.1.                                                                 |
| Công ty 1 admin, muốn admin tự cầm role                             | SoD chặn tự gán (§5.1 #2). Cần người thứ hai có `assign-role:user`.                                                                 |
| Chạy script census lặp nhanh để "xem đã ăn chưa"                    | Census chỉ đọc DB nên an toàn; nhưng **đăng nhập** lặp nhanh thì dính `LOGIN_MAX_ATTEMPTS` → `LOGIN_LOCKOUT_SEC`. PROD không override trong `.env` ⇒ mặc định **5 lần → khoá 900s (15 phút)** theo bucket `(slug, email, ip)`. |

---

## 8. Việc thuộc quyền quyết định của owner

Tài liệu này **không** chốt ai được gán role nào. Sau khi có census (§4.1), owner cần quyết:

1. Ai giữ `asset-manager` — lưu ý đây là role **duy nhất** ảnh hưởng người nhận NOTI, nên tối thiểu 1 người.
2. Ai giữ `office-admin` / `recruiter`.
3. Ai giữ `payroll-officer` — người này phải bật 2FA trước và chấp nhận không tự tắt được sau đó.
4. Có thu hồi 6 cặp nâng-quyền khỏi `SA` (10 người) hay không — nằm ngoài phạm vi WO này, cần quyết định
   riêng (xem đầu file `scripts/s13-revoke-wildcard-grants.mjs`).
