# DECISIONS-06: CHỐT MỘT ĐỘNG TỪ CHO QUYỀN ĐỌC DANH BẠ TÀI KHOẢN — `view:user`

> **📚 Bộ tài liệu DECISIONS — Hệ thống Quản lý Doanh nghiệp**
> **DECISIONS-06 Động từ quyền canonical** · (tiếp nối DECISIONS-01 Chốt câu hỏi mở · DECISIONS-02 Khoá stack & bất biến · DECISIONS-03 Cột Kanban & FSM · DECISIONS-04 Quyền per-project · DECISIONS-05 Việc con & đếm lá)
>
> **Nguồn & liên quan:** [Chỉ mục: README](<../README.md>) · [Đặc tả: SPEC-02 AUTH](<../SPEC/SPEC-02 AUTH.md>) · [Ma trận quyền](<../permission-matrix-spec.md>) · [DB: DB-02 AUTH RBAC](<../DB/DB-02 AUTH RBAC Database Design.md>) · [Kế hoạch thi công: S6-SEC-PERMVERB-1](<../plans/S6-SEC-PERMVERB-1.md>) · [Tiền đề: S6-SEC-ORG-1 §7 N-2](<../plans/S6-SEC-ORG-1.md>)

---

## 1. Thông tin tài liệu

| Trường        | Nội dung                                                            |
| ------------- | ------------------------------------------------------------------- |
| Mã tài liệu   | DECISIONS-06                                                        |
| Tên tài liệu  | Động từ canonical cho quyền đọc danh bạ tài khoản                   |
| Tên dự án     | Hệ thống quản lý doanh nghiệp nội bộ                                |
| Tên sản phẩm  | Enterprise Management System                                        |
| Phiên bản     | v1.0                                                                |
| Trạng thái    | **D-41 CHỐT** — owner đồng ý 28/07/2026, ký lại khi merge PR (crown) |
| Giai đoạn     | Sprint 6 — hậu FULL gate S6-SEC-ORG-1 (nợ N-2)                      |
| Ngày tạo      | 29/07/2026                                                          |
| Ngày cập nhật | 29/07/2026                                                          |
| Người duyệt   | Cian (Product Owner) — chốt khi merge PR (crown)                    |

---

## 2. Bối cảnh — một tài nguyên, hai động từ

Catalog quyền hiện mang **hai** cặp cho cùng một hành vi "đọc danh sách tài khoản":

| Cặp | Nguồn seed | Vai trò lịch sử |
| --- | --- | --- |
| `read:user` | `0005_permissions.sql:205` | **LEGACY** — thời sơ khai, trước khi có bộ canonical |
| `view:user` | `0444_s2_authseed1_canonical_roles_perms.sql:87-90` | **CANONICAL** — header 0444 ghi rõ *"KHÁC legacy `read:user`"* |

Sự tách từ vựng này là **cố ý** khi seed 0444 ra đời, nhưng việc chuyển đổi **chưa hoàn tất**: `apps/api/src/foundation/module-catalog/module-app-metadata.ts:10` tuyên bố thẳng rằng `read:user` là cặp legacy *"KHÔNG dùng"*, trong khi `GET /org/employees` — đường đọc danh bạ chính của console — **vẫn gate `read:user`**.

### 2.1 Vì sao đây là vấn đề AN NINH, không phải chuyện thẩm mỹ

`data_scope` trong MediaOS là **PER-(permission, role)** (xem [§13 permission matrix](<../permission-matrix-spec.md>)). Hệ quả trực tiếp:

> Hai endpoint trả **cùng một lớp dữ liệu** (`id · email · fullName · status`) nhưng gate **hai cặp khác nhau** ⇒ siết `data_scope` ở cặp này **KHÔNG** siết cặp kia.

Cụ thể trước quyết định này:

- `GET /auth/users` (+ role-admin, + widget dashboard `USER_SUMMARY`) gate `view:user`
- `GET /org/employees` gate `read:user`

`S6-SEC-ORGSCOPE-1` (N-1) vừa ép `data_scope` cho `/org/employees`. Nhưng vì hai đường mang hai cặp, một admin siết scope trên `view:user` sẽ **tưởng** đã khoá cả hai đường đọc tài khoản, trong khi `/org/employees` vẫn mở theo cặp còn lại. Đây đúng lớp lỗi mà memory `read-path-gate-pair-must-match-download-pair` mô tả: **gate lệch cặp = scope lệch**.

---

## 3. Quyết định

### D-41 — Động từ canonical của quyền đọc danh bạ tài khoản là `view:user`

`GET /org/employees` chuyển gate từ `read:user` sang `view:user`. Sau quyết định này **mọi** đường đọc danh sách tài khoản trong hệ thống dùng CHUNG một cặp.

**Lý do chọn `view:user` chứ không phải giữ `read:user`:**

1. **0444 đã tuyên bố nó là canonical** — đảo chiều nghĩa là phủ nhận một quyết định seed đã ghi thành văn bản, và phải sửa ngược cả bộ canonical.
2. **`module-app-metadata.ts:10` đã ghi `read:user` là legacy "KHÔNG dùng"** — code hiện tại đã nói một đằng (`/org` gate legacy) làm một nẻo; chuẩn hoá về `view:user` làm tài liệu và code khớp nhau.
3. **Đa số đường đọc đã ở `view:user`** — `/auth/users`, role-admin (`role-admin.controller.ts:52`), dashboard `USER_SUMMARY`. `/org/employees` là chỗ **DUY NHẤT** còn lệch (đo bằng grep `@RequirePermission` toàn `apps/api/src`, 29/07/2026).
4. **Chi phí đổi = 1 dòng + 3 pin test.** Chiều ngược lại (kéo tất cả về `read:user`) đụng nhiều điểm hơn và đi ngược hướng đã chốt.

### D-42 — KHÔNG cấp grant mới, KHÔNG migration ở release này

Đây là điểm **khác với dự kiến ban đầu** của Work Order (WO seed dự trù "backfill PER-PAIR bằng migration"). Số đo thực tế cho thấy backfill là **thừa và có hại**.

---

## 4. Bằng chứng đo — PROD `mediaos`, 29/07/2026

Truy vấn `role_permissions ⋈ permissions ⋈ roles ⋈ companies` cho `resource_type='user'`, `action ∈ {read, view}`, đếm user **sống** (`deleted_at IS NULL`). Toàn hệ thống có **1 tenant** (`funtime`, 46 user).

| Cặp | Role | Phạm vi role | `data_scope` | User SỐNG |
| --- | --- | --- | --- | --- |
| `read:user` | `SA` | funtime | Company | **6** |
| `read:user` | `company-admin` | global | Company | **1** |
| `read:user` | `project-manager` | global | Company | 0 |
| `view:user` | `SA` | funtime | Company | **6** |
| `view:user` | `company-admin` | global | Company | **1** |
| `view:user` | `hr` | global | Company | 0 |

### 4.1 TRƯỚC / SAU theo từng role

| Role | User sống | Trước (gate `read:user`) | Sau (gate `view:user`) | Thay đổi |
| --- | --- | --- | --- | --- |
| `SA` | 6 | ✅ đọc được | ✅ đọc được | **không đổi** (giữ CẢ HAI động từ) |
| `company-admin` | 1 | ✅ đọc được | ✅ đọc được | **không đổi** (giữ CẢ HAI động từ) |
| `employee` | 45 | ❌ 403 | ❌ 403 | không đổi (không grant nào) |
| `project-manager` | **0** | ✅ đọc được | ❌ 403 | **MẤT quyền** — cố ý, xem §4.2 |
| `hr` | **0** | ❌ 403 | ✅ đọc được | **ĐƯỢC quyền** — đúng §13, xem §4.3 |

> **Kết luận: 0 user sống bị ảnh hưởng.** Cả 7 user đang giữ cặp danh bạ (`SA` 6 + `company-admin` 1) đều giữ **đồng thời** hai động từ ở `data_scope = Company`, nên việc đổi gate là **no-op** với họ. Hai role lệch đều **0 user**.

### 4.2 `project-manager` mất quyền — cố ý, không backfill

`project-manager` (…002) là role **MEDIA-ERA** — header `0444` ghi rõ không gộp nhóm role thời media vào bộ canonical, và reframe *de-media-fy* (CLAUDE.md §1) nói **không phát triển tiếp** hướng đó. Cấp `view:user` cho nó = **mở rộng quyền ngoài §13**, đi ngược chính WO đang đóng lỗ. Với 0 user sống, việc mất quyền không tạo cửa sổ 403 cho ai.

### 4.3 `hr` được quyền — đúng thiết kế, không phải nới tay

§13 (`docs/plans/S2-AUTH-SEED-1.md`) đặc tả `AUTH.USER.VIEW` → `view:user` = Employee `-` · Manager `-` · **HR Company** · Company-Admin Company. `hr` **đã có sẵn** `view:user@Company` từ 0444; nó chỉ chưa dùng được vì `/org/employees` gate động từ khác. Đổi gate làm role `hr` hoạt động **đúng như §13 đã đặc tả** — không cấp thêm grant nào.

> ⚠️ **Đính chính tiền đề của WO seed.** Bản seed WO ghi *"hr/manager/hr-manager đều lệch cặp"* và dự trù backfill cả ba. Số đo bác bỏ: `manager` (…010) **đúng thiết kế** — §13 ghi Manager `-` cho `AUTH.USER.VIEW`, nên backfill nó là mở rộng quyền ngoài đặc tả; `hr-manager` (…009) là media-era, ngoài §13. Chỉ `hr` lệch thật, **và nó đã có sẵn grant cần thiết**.

---

## 5. Expand–contract: vì sao KHÔNG tách 2 release

Luật chung (memory `migration-expand-contract-required`): revoke một grant trong khi code còn enforce nó = **cửa sổ 403** cho user sống ⇒ phải tách hai release.

Luật đó **không kích hoạt ở đây**, vì:

1. **Pha EXPAND đã xảy ra từ 0444** (28/06/2026) — `view:user` đã được cấp cho `SA`, `company-admin`, `hr` từ lâu. Release này chỉ đổi vế *enforce*, và mọi user sống đã có sẵn grant đích.
2. **Release này KHÔNG revoke gì.** Row `read:user` vẫn nằm trong catalog; grant `read:user` của `project-manager` vẫn còn nguyên. Ta chỉ **thôi đọc** động từ cũ.

### 5.1 Pha CONTRACT — hoãn có chủ đích

Sau release này `read:user` trở thành **row catalog không mở được cửa nào**. Việc dọn (revoke grant `project-manager` + cân nhắc gỡ row khỏi catalog) **cố ý để lại** cho một WO sau, vì:

- Gỡ ngay = trộn hai loại rủi ro (đổi enforce + đổi dữ liệu) vào một PR vùng đỏ.
- Giữ row cho phép **rollback rẻ**: nếu phải quay lại, chỉ cần đảo hằng số, không cần migration khôi phục grant.

**Chốt hồi quy thay cho việc dọn:** ca `S6-SEC-PERMVERB-1: read:user (LEGACY) KHÔNG còn mở được danh bạ` trong `test/integration/org-directory-permission.int-spec.ts` seed một user chỉ có `read:user` và khẳng định **403 + không rò một byte email nào**. Nếu hồi quy nào đưa gate về động từ cũ, `project-manager` sẽ lặng lẽ lấy lại trọn danh bạ — ca này làm điều đó **đỏ to tiếng**.

---

## 6. Phạm vi thay đổi

| Loại | Tệp | Nội dung |
| --- | --- | --- |
| **Code** | `apps/api/src/org/org.permissions.ts` | `action: "read"` → `"view"` — **đúng 1 dòng hiệu dụng** |
| Pin 1 | `apps/api/src/org/org.permissions.spec.ts` | census literal `listEmployees` |
| Pin 2 | `apps/api/test/integration/org-directory-scope.int-spec.ts` | `DIRECTORY_PAIR` |
| Pin 3 | `apps/api/test/integration/org-directory-permission.int-spec.ts` | `DIRECTORY_PAIR` + ca deny legacy MỚI |
| Docstring | `org.controller.ts` · `data-scope.service.ts` · `route-verdicts.ts` | khớp lại với code |
| Docs | `permission-matrix-spec.md` · ADR này | đóng bảng "lệch cặp" |
| **Migration** | — | **KHÔNG CÓ** (xem §4, §5) |

> **Ba pin literal là CỐ Ý không import hằng số.** Nếu chúng đọc chính `ORG_EMPLOYEE_DIRECTORY` thì hai vế không bao giờ lệch được và pin thành tautology — đổi hằng số thành `read:team` census vẫn PASS. Việc WO này **buộc phải sửa cả ba** chính là tác dụng của pin. (FULL gate 28/07/2026 đã bắt đúng lỗi "DRY hoá pin" này ở vòng 1 của `S6-SEC-ORGSCOPE-1`.)

---

## 7. Hệ quả & nợ còn lại

### 7.1 Được gì

- **Một knob thay vì hai:** `data_scope` trên `view:user` nay siết **cả hai** đường đọc tài khoản cùng lúc. Trước đây phải nhớ siết hai cặp, và quên một cặp là lỗ im lặng.
- Code khớp tài liệu: `read:user` được tuyên bố legacy **và thực sự không còn dùng**.

### 7.2 Nợ N-1b — CHƯA đóng ở WO này (cố ý)

Vẫn còn **hai bản cài đặt** của cùng luật vị từ scope hình-`users`:

- `DataScopeService.buildUserScopeCondition` — nhánh `Own` **CÓ** vế `company_id`
- `AuthUsersService.buildUserScopeCondition` (private) — nhánh `Own` **KHÔNG** có vế `company_id`

Sau D-41 hai endpoint dùng **cùng một cặp quyền**, nên đây là lúc đúng để hợp nhất — **hợp nhất VỀ PHÍA `DataScopeService`** (bản chặt hơn; copy chiều ngược lại sẽ làm rơi đai tenant).

Kèm theo, cần cân nhắc bỏ tính **phi đơn điệu** của lưới scope: `Team`/`Department` hiện fail-closed 0 hàng, mà `resolveStrongestScope` lấy `max` ⇒ user giữ **đồng thời** `Own`+`Team` resolve ra `Team` và thấy **0 hàng** — *thêm* một role làm *mất* quyền. Cách sửa hệ thống là hạ sàn `Team`/`Department` xuống vị từ `Own`, và **phải áp cho CẢ HAI endpoint cùng lúc**.

> Tách khỏi WO này có chủ đích: đổi động từ là thay đổi **1 dòng có bằng chứng đo đầy đủ**; hợp nhất vị từ là thay đổi **hành vi** của hai đường đọc, cần bộ test riêng. Trộn vào một PR vùng đỏ làm cả hai khó review.

### 7.3 Không đóng lớp lỗ gốc

`PermissionGuard` **vẫn không đọc `data_scope`** (`grep dataScope permission.guard.ts` = 0 hit) ⇒ mọi route chỉ gate bằng guard vẫn thừa hưởng lỗ "gate đúng cặp nhưng không bound hàng". D-41 làm hai đường đọc tài khoản dùng chung cặp — nó **không** sửa gốc đó. Xem `S6-SEC-ORGTEAMSCOPE-1` (N-1c) cho vế `teams`.

---

## 8. Rollback

Đảo `ORG_EMPLOYEE_DIRECTORY.action` về `"read"` + hoàn 3 pin. **Không cần migration khôi phục** vì release này không revoke gì — đó chính là lý do §5.1 giữ lại row legacy.
