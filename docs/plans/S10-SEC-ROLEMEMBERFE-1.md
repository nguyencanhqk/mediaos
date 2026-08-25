# S10-SEC-ROLEMEMBERFE-1 — KI-073: oracle TRONG-tenant trên đường GHI của tab Thành viên role

> Vùng đỏ (phân quyền + kênh phụ). Plan viết TRƯỚC code theo CLAUDE.md §6.
> Bảng chạm: `user_roles` — chỉ đường GHI + một cờ đọc, **0 migration**.
> Xếp SAU `S10-SEC-ROLEMEMBERROW-1` (KI-071, PR #404 merge `81c8ddd4` 23/08): WO này chỉ tồn tại vì
> tập hàng đường ĐỌC đã bị bound.

---

## ⚠️ 0. ĐÍNH CHÍNH TIỀN ĐỀ — cơ chế mà KI-073 mô tả (`loạt 409`) KHÔNG TỒN TẠI

**Đây là thay đổi lớn nhất so với bản seed. Đọc mục này trước mọi mục khác.**

KI-073 (RELEASE-02) và D12/⟲R2 của `docs/plans/S10-SEC-ROLEMEMBERROW-1.md` đều phát biểu oracle là
_"chạy batch rồi **đọc item nào trả 409** để dựng lại tập thành viên"_. Đọc bảng nhánh THẬT của
`PermissionAdminService.assignRole` (`permission-admin.service.ts:79-149`) thì **409 gần như không bao
giờ nổ**, và kênh thật **mạnh hơn** cái được mô tả:

| nhánh | điều kiện | HTTP | thân trả về |
| --- | --- | --- | --- |
| **no-op** | `existing && sameExpiry` (`:105`) | **201** | **hàng GỐC** (`existing`) |
| reassign | `existing && !sameExpiry` (`:110`) | 201 | hàng MỚI (`inserted`) |
| fresh | `!existing` | 201 | hàng MỚI (`inserted`) |

_(⟲R2: 201, không phải 200 — `@Post` không có `@HttpCode` ⇒ Nest mặc định 201; đã đo sẵn tại
`permadmin-roles-http.int-spec.ts:218`. CẢ BA nhánh cùng 201 — status không mang bit nào.)_
| conflict | `insertUserRole` trả `undefined` — **thua race** (`:120-123`) | 409 | — |

Hai dialog batch (`AddOrgUnitDialog:383-384` · `AddPositionDialog:489-490`) gọi
`authUsersApi.assignRole(userId, { roleId })` — **không có `expiresAt`** ⇒ `expiresAt = null` ⇒ với một
người ĐÃ là thành viên vĩnh viễn thì `sameExpiry(null, null) === true` (`:37-41`, so sánh **bằng tuyệt
đối**) ⇒ luôn rơi vào nhánh **no-op**. `useAssignBatch` (`RoleMembersTab.tsx:~275`) chỉ ghi
`kind:"error"` khi promise **throw**; 2xx ⇒ `kind:"ok"`. ⇒ **`BatchResultList` hiện TOÀN "ok"** — ở tầng
danh sách kết quả **không có oracle nào cả**.

**Xác minh phủ định:** `grep -rn "409\|Conflict" apps/api/src/permission/*.spec.ts` ⇒ **0 kết quả**.
Không một ca test nào trong cả module chạm nhánh 409 — đúng như dự đoán từ bảng nhánh.

### 0.1 Kênh THẬT — thân trả về 201 phân biệt được "đã là thành viên"

`userRoleSchema` (`packages/contracts/src/permission.ts:28-36`) chiếu **cả hàng** `user_roles`, gồm ba
cột **phân biệt được hai nhánh**:

| cột | đã là thành viên (no-op) | vừa được gán |
| --- | --- | --- |
| `createdAt` | **ngày gán GỐC** (quá khứ) | ≈ thời điểm request |
| `grantedBy` | **người cấp GỐC** | `actor.id` |
| `id` | id hàng GỐC | uuid mới |

⇒ Một request `POST /permissions/users/<u>/roles {roleId}` trả `createdAt` sớm hơn thời điểm gọi
**chứng minh `u` đã ở trong role**. Đặc tính khiến nó NẶNG hơn vế 409 được mô tả:

- **Xác định 100%**, không phải suy đoán thống kê.
- **Một request / một người**, HTTP 201, không cần chạy batch, không cần FE — `curl` là đủ.
- **Câu trả lời DƯƠNG không để lại dấu vết:** nhánh no-op **không ghi gì** — không `user_roles`, không
  `audit_logs`, không `user_security_events`, không outbox (`:104-107` return sớm). Kiểm tra "X có
  trong role R không?" khi X **có** ⇒ 0 hàng forensic.
  _(Chỉ câu trả lời ÂM mới ồn: người chưa là thành viên sẽ **bị gán thật** + `RoleAssigned`.)_

**Ba cột trên KHÔNG được caller dùng ở bất kỳ đâu** — xác minh ở §0.3.

### 0.2 Vế FE — là bug TRUNG THỰC, KHÔNG phải rò rỉ

`memberIds` dựng từ danh sách đã-scope (`RoleMembersTab.tsx:91`) làm FE **thiếu hụt**, không phải thừa:
với `view:user@Own`, `memberIds ⊆ {chính mình}` ⇒ ít badge "đã là thành viên" hơn sự thật, bộ đếm
`:117` nhỏ hơn sự thật, `toAssign` **rộng hơn** sự thật. Không có bit nào chảy từ server ra người dùng
qua đường này. ⇒ **Vá FE một mình đóng được 0% oracle** (đúng như KI-073 nói, nhưng vì lý do khác với
lý do KI-073 đưa ra).

### 0.3 Khẳng định đã XÁC MINH trên cây (không suy đoán)

| khẳng định | xác minh | kết quả |
| --- | --- | --- |
| no-op trả 201 + hàng gốc | `permission-admin.service.ts:105-107` (status: `permadmin-roles-http.int-spec.ts:218`) | ĐÚNG |
| `sameExpiry` là bằng-tuyệt-đối (không dung sai) | `:37-41` | ĐÚNG ⇒ `expiresAt` trả về **luôn** = giá trị request ở CẢ BA nhánh ⇒ 0 bit thông tin |
| 409 chỉ ở nhánh thua-race | `:120-123` | ĐÚNG; 0 test nào phủ |
| `id`/`grantedBy`/`createdAt` không có consumer **RUNTIME** | `grep -rn "userRoleSchema\|UserRoleDto" apps packages` | ĐÚNG cho RUNTIME — 2 client (`web-core/auth-users-api.ts:128`, `console/rbac-api.ts:56`), **0 chỗ đọc field**; `RoleMembersTab` và `console/assign-role-dialog.tsx:48` đều **bỏ** giá trị trả về. ⟲R1: câu grep này **MÙ với hộ tiêu thụ giá trị TRẢ VỀ của service ở tầng TEST** ([[identity-projection-census-misses-alias]]) — xem §0.3b |
| DELETE trả 404 khi không phải thành viên | `:161-163` | ĐÚNG ⇒ oracle THỨ HAI, xem N-1 |
| FE **CÓ** nhận `data_scope` từng cặp | `packages/contracts/src/auth.ts:154` `scopes: z.record(z.array(z.enum(DATA_SCOPES))).optional()` | ĐÚNG — nhưng **KHÔNG dùng được**, xem D4 |
| `listMembersInner` ĐÃ phân giải `scope` | `role-admin.service.ts:183` (sau #404) | ĐÚNG ⇒ cờ `complete` lấy được **không tốn lần resolve thứ hai** |
| int-spec HTTP của route này có sẵn | `apps/api/test/integration/identity-projection-scope.int-spec.ts` (A1·A2·A3·R-D2·R-D3·R-A3·R-T1·R-T2·R-G1·R-X1) | ĐÚNG — ca mới đặt cùng file, tái dùng fixture tenant A/B |

### 0.3b ⟲R1/R2 — NĂM hộ tiêu thụ Ở TẦNG TEST (plan-reviewer CRITICAL #1) — kê đơn thay thế, KHÔNG tự ứng biến

Grep §0.3 chỉ quét ký hiệu contract nên mù với chỗ đọc **giá trị trả về của `svc.assignRole(...)`**.
Năm file dưới đây VỠ khi D2 land (typecheck hoặc assert đỏ) và PHẢI sửa **trong cùng PR**, theo đúng
đơn — vì ba int-spec đầu là bằng chứng forensic/bất biến #2, sửa sai là **xoá mất cái ghim**:

| file | chỗ vỡ | bản thay thế (giữ NGUYÊN ngữ nghĩa assert) |
| --- | --- | --- |
| `apps/api/test/integration/permission-admin.int-spec.ts` | `:230-232` `row?.id` + `countAudit(A.companyId,"user_role",row!.id)`; `:244` | Lấy id THẬT bằng `SELECT id FROM user_roles WHERE company_id=$1 AND user_id=$2 AND role_id=$3 AND deleted_at IS NULL` rồi `countAudit` trên id đó — liên kết audit↔hàng thật GIỮ NGUYÊN |
| `apps/api/test/integration/user-roles-soft-delete.int-spec.ts` | `:290`,`:341`,`:386`,`:393-401` — đặc biệt `second!.id !== first!.id` (:395, bằng chứng DUY NHẤT "re-grant sau soft-delete KHÔNG no-op-giả") + `countAuditForObject(second!.id)` (:398) | Đọc id qua SQL: `firstId` = id hàng active TRƯỚC revoke; `secondId` = id hàng active SAU re-grant. ⟲R2 (BLOCKING #2): assert đủ BA — `expect(firstId).toBeDefined()` ∧ `expect(secondId).toBeDefined()` ∧ `expect(secondId).not.toBe(firstId)` — vì dưới đúng đột biến QA-02 sinh ra để bắt (`findUserRole` không lọc tombstone ⇒ no-op-giả ⇒ 0 hàng active mới) `secondId === undefined` làm riêng bất-đẳng-thức **xanh RỖNG**. Rồi `countAuditForObject(secondId)`. `:290`/`:341` thay bằng `expect(await countActiveUserRoles(targetA, capRole)).toBe(1)` — ghi rõ, không để implementer chọn |
| `apps/api/test/integration/rbac-operator-escalation.int-spec.ts` | `:111-114` `row?.id` | Bỏ assert `.id`, thay bằng assert 4 khoá của thân mới (`userId`/`roleId` echo) — `countUserRoles(...)===1` ở `:115` đã là bằng chứng hàng thật |
| `apps/app/src/routes/system/users/UserRolesPage.spec.tsx` | `:115-123` — object literal gán `mockResolvedValue` kiểu `Promise<UserRoleDto>` ⇒ excess-property error khi thu hẹp | Đổi fixture về đúng 4 khoá `{userId, roleId, companyId, expiresAt}` (page KHÔNG đọc `.id` của kết quả assign — thay fixture thuần, 0 rủi ro ngữ nghĩa) |
| ⟲R2 — hộ thứ 5: `packages/web-core/src/lib/auth-users-api.spec.ts` | `:66-73` — `const USER_ROLE: UserRoleDto = {…7 khoá}` vỡ typecheck | Sửa theo §3.4 (fixture 4 khoá + đẳng thức tập khoá) |

Kéo theo: `paths` phải thêm `apps/app/src/routes/system/users/**` (và cho phép trước `apps/console/**`
để `rbac-api.ts:56` không phải quyết dưới `guard-scope` giữa chừng). Đột biến **M-F** (bảng §3.5) ghim
chiều nguy hiểm nhất của D7: `audit.record` phải dùng `inserted.id`, KHÔNG dùng bộ chiếu.

### 0.4 Số đo PROD — ✅ ĐÃ ĐO 2026-08-24, CỔNG MỞ (mục 2b = 0)

`done_when` đòi số đo PROD ĐO LẠI. Script chỉ-SELECT đã chạy 2026-08-24 — kết quả ở cuối mục này.

Câu đo phải **BAO TRÙM BỐN hình dạng wildcard** cho **CẢ HAI** cặp (bài học ⟲R2 của KI-071 —
`matches()` có hai vế độc lập):

```sql
-- (1) từng cặp, bốn hình dạng
WHERE p.action IN ('assign-role','*') AND p.resource_type IN ('user','*')   -- cặp GHI
WHERE p.action IN ('view','*')        AND p.resource_type IN ('user','*')   -- cặp ĐỌC
-- (2) GIAO: vai giữ CẢ HAI = tập vai chạm được KI-073
-- (3) DENY ở BẤT KỲ hình dạng nào của hai cặp  (điều kiện của "0 403 mới")
-- (4) is_sensitive của ('assign-role','user') và ('*','*')
```

**Kết luận cần chứng minh trước khi mở PR:** số vai giữ ĐỒNG THỜI `assign-role:user` **và** `view:user`
ở scope **hẹp hơn Company** = **0** (đo 22/08 khi đóng KI-071: 0 vai giữ `view:user` hẹp hơn Company;
cần đo lại + đo thêm vế `assign-role`). Nếu = 0 ⇒ bản vá đóng lỗ **TIỀM TÀNG**, 0 hồi quy.

⚠️ `assign-role:user` là **`is_sensitive = true`** (`permission-admin.controller.ts:45`) ⇒ khác cặp
`view:user`: wildcard `*:*` **KHÔNG** thoả được nó (`permission.service.ts:604-606` — nhánh
`effectivelySensitive` lọc EXACT). Số đo vì thế phải tách hai cặp, không gộp một câu.

⚠️ **Diễn giải kết quả (⟲R1):** `effectivelySensitive` bật khi **BẤT KỲ** grant ALLOW khớp nào có
`is_sensitive` trong catalog (`permission.service.ts:598-599`) ⇒ tập grant "thoả `view:user` lúc
runtime" không thuần tuý là các hàng khớp 4 hình dạng — một catalog-pair wildcard bị đánh sensitive
sẽ đổi luật khớp của CẢ request. Mục (4) của script (is_sensitive của `('assign-role','user')` và
`('*','*')`) tồn tại để loại trừ đúng nhiễu này; đọc (1)/(2) SAU khi nhìn (4).

#### KẾT QUẢ ĐO — 2026-08-24, `measure-ki073.mjs` (chỉ-SELECT, ép `default_transaction_read_only = on`)

Đích đo: `DATABASE_DIRECT_URL` của `.env.prod` = `localhost:5432/mediaos`, vai `mediaos`.
Script gốc: `c:\tmp\ki073\measure-ki073.mjs`. _Ma sát ghi lại: classifier auto-mode chặn **5 lần** khi
chuỗi kết nối đi qua dòng lệnh (`PROD_DATABASE_URL="$(node -e …)" node …`); chạy được khi bọc bằng
wrapper tự đọc `.env.prod` **trong tiến trình** rồi `await import()` bộ đo._

**(1) Từng cặp, bốn hình dạng wildcard** — 4 hàng cặp GHI, 6 hàng cặp ĐỌC:

| cặp | vai | hình dạng khớp | effect@scope | is_sensitive | holders |
| --- | --- | --- | --- | --- | --- |
| `assign-role:user` | QUẢN LÝ CẤP CAO | `*:*` | ALLOW@Company | false | 4 |
| `assign-role:user` | SA | `*:*` | ALLOW@Company | false | 2 |
| `assign-role:user` | SA | `assign-role:user` | ALLOW@Company | **true** | 2 |
| `assign-role:user` | company-admin | `assign-role:user` | ALLOW@Company | **true** | 2 |
| `view:user` | QUẢN LÝ CẤP CAO | `*:*` · `view:user` | ALLOW@Company | false | 4 |
| `view:user` | SA | `*:*` · `view:user` | ALLOW@Company | false | 2 |
| `view:user` | company-admin | `view:user` | ALLOW@Company | false | 2 |
| `view:user` | hr | `view:user` | ALLOW@Company | false | **0** |

**(4) — đọc TRƯỚC (1)/(2) đúng theo cảnh báo ⟲R1:** `assign-role:user → is_sensitive = true`;
`*:* → is_sensitive = false`. ⇒ **Không** catalog-pair wildcard nào bị đánh sensitive ⇒ **không có
nhiễu `effectivelySensitive`** đổi luật khớp của cả request; đọc (1)/(2) theo nghĩa đen được.
Hệ quả phụ đáng ghi: **`QUẢN LÝ CẤP CAO` chỉ có `*:*`, KHÔNG có exact `assign-role:user`** ⇒ nhánh lọc
EXACT (`permission.service.ts:604-606`) khiến vai này **không gọi nổi**
`POST /permissions/users/:userId/roles` — đúng dự đoán của mục này khi viết plan. Tập vai thật sự
chạm được đường GHI = **{`SA`, `company-admin`}**, cả hai `@Company`.

**(2) GIAO** — vai giữ CẢ `assign-role:user` (EXACT ALLOW) LẪN `view:user` (mọi hình dạng ALLOW):
**2 vai** — `SA` (view qua `*:*` và `view:user`) và `company-admin` (view qua `view:user`), **cả hai
`@Company`**.

**(2b) KẾT LUẬN CẦN CHỨNG MINH — vai giữ đồng thời hai cặp với `view:user` HẸP HƠN Company: `0` vai
✅** (điều kiện: = 0).

**(3) DENY ở bất kỳ hình dạng nào của hai cặp: `0` hàng ✅** (điều kiện: = 0) ⇒ điều kiện "**0 lượt
403 mới**" thoả — bản vá không lấy mất quyền của ai.

**(5) Đo LẠI vế 22/08** — vai giữ `view:user` ALLOW hẹp hơn Company: **`0` vai ✅**, khớp số đo 22/08
lúc đóng KI-071 (đo lại 24/08, không tái dùng số cũ).

⇒ **Kết luận cổng:** bản vá đóng lỗ **TIỀM TÀNG** — **0 vai** thực thi được oracle hôm nay, **0 hồi
quy**. Cổng số-đo của `done_when` **MỞ**. Workaround cũ ("không cấp `view:user` hẹp hơn Company cho
vai đồng thời giữ `assign-role:user`") hết cần cho V1 nhưng **GIỮ như khuyến nghị vận hành** vì
KI-074 (DELETE 404-oracle) còn sống.

---

## 1. Khuyết tật — phát biểu chính xác

**V1 (BE — oracle THẬT, phải đóng).** `POST /permissions/users/:userId/roles` trả **thân 201 phân biệt
được** "đã là thành viên" với "vừa gán" qua `id`/`grantedBy`/`createdAt` (§0.1). Vai giữ
`assign-role:user` **cộng** `view:user@Own` dựng lại được TRỌN tập thành viên mà KI-071 vừa giấu, bằng
1 request/người, và **im lặng ở mọi câu trả lời dương**.

**V2 (BE — oracle THỨ HAI, KHÔNG đóng ở WO này).** `DELETE /permissions/users/:userId/roles/:roleId`
trả **404 "User does not have this role"** vs **204**. Xem N-1.

> ⟲ **ĐÃ ĐÓNG 2026-08-25** bởi `S10-SEC-ROLEMEMBERDEL-1` (KI-074), ADR
> `docs/DECISIONS/DECISIONS-10_Role_Membership_Absence_Signal.md` — hướng (b): GIỮ 404 cho actor có
> `view:user@Company`/`@System`, **204 + 0 ghi** cho phần còn lại. Kênh THỜI GIAN **không** đóng theo.

**V3 (FE — không phải rò rỉ, là bug trung thực).** Bộ đếm `:117`, khoá hàng `:339-345`,
`toAssign`/`alreadyMembers` `:383-384`/`:489-490` đều dựng trên `memberIds` đã-scope ⇒ **nói dối theo
chiều thiếu** (§0.2).

**Mức độ — đọc đúng, đừng thổi lên.** **KHÔNG có leo thang quyền.** Cặp GHI là cặp RIÊNG
(`assign-role:user`, sensitive), gate BE `@RequirePermission("assign-role","user",{isSensitive:true})`
+ gate FE `PermissionGate ASSIGN_ROLE` (`RoleMembersTab.tsx:124-127`), độc lập với `view:user`.

⚠️ **Phản biện phải trả lời (security-reviewer sẽ nêu):** _"actor giữ `assign-role:user@Company` đã có
quyền GHI toàn công ty — ĐỌC là quyền YẾU HƠN GHI, sao lại coi là ranh giới?"_ Trả lời: hình dạng cấp
quyền được bảo vệ ở đây là **"người vận hành cấp phát"** — được đặt người vào vai theo một danh sách
HR đưa (`GET /hr/employees?orgUnitId`, cặp quyền KHÁC), **không** được duyệt danh bạ. Oracle phá đúng
vế "không được duyệt". Ranh giới này là ranh giới mà chính KI-053 + KI-071 đã bỏ hai WO ra để dựng;
để hở V1 thì cả hai WO đó **không đóng được gì trên route này**. Đó là lý do WO này tồn tại, và cũng
là lý do nó **KHÔNG** được quảng cáo là chặn leo thang quyền.

---

## 2. Quyết định thiết kế

### D1 — PHÁT BIỂU TRƯỚC: vế nào đóng ở đâu (`done_when` #1)

| vế | tầng đóng | vì sao KHÔNG đóng được ở tầng kia |
| --- | --- | --- |
| **V1 oracle** | **BE** (D2) | Kênh nằm trong **thân HTTP**. `curl` bỏ qua toàn bộ FE. Vá FE = 0% |
| **V3 trung thực** (bộ đếm · badge · preview batch) | **FE** (D5), ăn cờ từ **BE** (D4) | FE không tự biết mình có thấy đủ tập hàng hay không (D4) |
| **V2 oracle DELETE** | **KHÔNG đóng** | Xem N-1 — có lý do, không phải bỏ sót |

### D2 — Thu hẹp thân trả về của `assignRole`, **ĐỒNG NHẤT cho mọi actor**

Trả về đúng bốn khoá, **giống hệt nhau ở cả ba nhánh**:

```ts
{ userId: targetUserId, roleId: dto.roleId, companyId: actor.companyId,
  expiresAt: expiresAt?.toISOString() ?? null }
```

Cả bốn đều do **caller cung cấp hoặc suy ra được** ⇒ **0 bit thông tin**. `expiresAt` an toàn ở CẢ BA
nhánh vì `sameExpiry` là bằng-tuyệt-đối (§0.3): no-op ⇒ bằng request theo định nghĩa; reassign/fresh ⇒
chính giá trị request.

⟲R1 (LOW): serialization GHIM là `expiresAt?.toISOString() ?? null` — echo **instant của request**
(khớp `userRoleSchema.expiresAt = z.string().datetime().nullable()`); KHÔNG echo `dto.expiresAt` thô
(rủi ro offset khác chuẩn hoá) và KHÔNG lấy `existing.expiresAt` (phụ thuộc độ chính xác lưu trữ —
lại thành 1 bit).

**Vì sao ĐỒNG NHẤT chứ không "thu hẹp cho actor ngoài scope đọc"** (câu chữ của `done_when` gợi ý vế
sau):

1. Nhánh theo scope đòi **phân giải `view:user` NGAY TRONG đường GHI** — thêm một lần
   `resolveStrongestScope` vào một mutation crown, kéo theo đúng bộ hỏng K3 (scope không chuẩn hoá) và
   K4 (`getCompanyRoleGrantsWithScope` **không cache** ⇒ một timeout riêng biến 200 thành 403) mà
   RELEASE-02 vừa phải viết ba đoạn để giải thích cho KI-071. Đưa chúng vào đường GHI là **nới bề mặt
   hỏng**, không phải siết.
2. Thân trả về **đổi hình dạng theo scope** tự nó là một bề mặt phải chứng minh không-rò lần nữa.
3. Đồng nhất là **SIÊU TẬP** của yêu cầu: "không phân biệt cho actor ngoài scope đọc" ⊂ "không phân
   biệt cho bất kỳ ai".
4. ⟲R2: chi phí = **0 consumer RUNTIME** đọc ba cột đó (§0.3), cộng **NĂM hộ tiêu thụ ở tầng TEST**
   phải sửa theo đơn §0.3b + §3.4 — trong đó `user-roles-soft-delete` là bằng chứng forensic (bất
   biến #2), không phải fixture thường.

⇒ Đây là **SIẾT, không nới**. Ba khoá bị **GỠ HẲN** khỏi `userRoleSchema` (không `.optional()`): khoá
không tồn tại thì không rò được, và ratchet mạnh hơn.

### D3 — GIỮ nhánh no-op, KHÔNG "vá" bằng cách luôn ghi lại

Cách vá rẻ tiền — bỏ nhánh no-op để mọi lời gọi đều sinh hàng mới ⇒ thân đồng nhất **mà không đổi
contract** — bị **BÁC**: nó biến một oracle ĐỌC thành **khuếch đại GHI** (tombstone rác mỗi lần gọi,
`RoleReassigned` giả trong audit, `permission.changed` bắn thừa ⇒ đập cache toàn hệ). Ca **O4** ghim
điều này: sau POST no-op, `user_roles` và `audit_logs` **không được có hàng mới**.

### D4 — Cờ `complete` do **SERVER** phát, FE **KHÔNG** tự suy từ `scopes`

FE **có** `me.scopes` (`contracts/src/auth.ts:154`) nên về lý có thể tự tính "tôi có Company không".
**BÁC**, vì đó là **bộ phân giải THỨ HAI** và nó **bất đồng được** với server:

- `scopes` là **hợp các data_scope** theo từng cặp ALLOW non-sensitive; `resolveStrongestScope`
  (`permission.service.ts:575-625`) thì có DENY-overrides · **exact thắng wildcard** · cổng sensitive ·
  mạnh-nhất-trong-số-đủ-điều-kiện.
- Ví dụ bất đồng THẬT: vai chỉ giữ `*:*@Company`, **không** có cặp exact ⇒ server resolve ra
  `Company`, nhưng `scopes["view:user"]` **không tồn tại** ⇒ FE kết luận "không đủ" (sai, may là sai về
  phía hẹp).
- `auth.service.ts:1183` nói thẳng `scopes` là **fail-safe `{}` khi lỗi — chỉ GỢI Ý FE**.

⇒ Server đã resolve `scope` ở `role-admin.service.ts:183`; nó **nói ra**:

```ts
// roleMemberListSchema
{ members: [...], complete: z.boolean().catch(false) }   // server: complete = scope ∈ {Company, System}
```

**0 lần resolve thêm** (dùng lại chính biến `scope` — giữ luật KI-070 D11 "mỗi cặp resolve ĐÚNG MỘT
LẦN/request"). Công thức `scope ∈ {Company, System}` KHÔNG nói dối ở nhánh `System`:
`data-scope.service.ts:153-155` map `System` và `Company` về cùng vị từ tenant (plan-reviewer đã
verify hộ — chép vào đây làm bằng chứng).

⚠️ **`complete` KHÔNG phải 0 bit — nó là bit CÓ THẨM QUYỀN về scope `view:user` của CHÍNH actor**
(gồm cả hệ quả của DENY nhắm vào actor), thứ mà `me.scopes` chỉ gợi ý được. `complete=false` **cố ý**
nói với actor "danh sách bạn thấy là thiếu" — đánh đổi trung thực > mù mờ, và không nói gì về NGƯỜI
KHÁC. Phát biểu chính xác là vậy, không phải "không rò gì".

⚠️ **⟲R1 (BLOCKING #2) — server khai BẮT BUỘC, FE parse bằng `.catch(false)`, KHÔNG `.optional()`:**
bản R0 chọn "bắt buộc ⇒ FE mới + BE cũ nổ ZodError CỐ Ý, deploy BE trước FE". PROD **không có cơ chế
ép thứ tự đó**: push master ⇒ Pages tự deploy FE ngay, còn `m migrate`/`m deploy-api` là THỦ CÔNG
([[prod-3-way-drift-fe-auto-be-manual]]) — tức trạng thái MẶC ĐỊNH sau merge chính là ca "FE mới +
BE cũ", và ZodError = **vỡ TRẮNG tab cho MỌI actor** kể cả company-admin. Đổi một side-channel S4
tiềm tàng lấy một sự cố khả dụng trên route crown là không cân. `.catch(false)`:

- BE mới LUÔN phát `complete` ⇒ vận hành bình thường không đổi; server hard-code bị S1 + M-D bắt.
- FE mới + BE cũ (cửa sổ mặc định của PROD, hoặc rollback BE một mình) ⇒ parse KHÔNG nổ, `complete`
  rơi về `false` ⇒ UI partial-mode + banner (D5) — **fail-safe VÀ nhìn thấy được**, không phải "im
  lặng tắt dedup" như lo ngại của R0: partial-mode có NHÃN riêng, company-admin thấy nhãn lạ là báo.
  Chiều hỏng này không bao giờ KHẲNG ĐỊNH SAI ai là thành viên — giá phải trả chỉ là một nhãn bi quan.
- BE mới + FE cũ ⇒ zod strip khoá thừa, không vỡ (như R0).
- Ca **F4** ghim đường degrade này: fixture VẮNG `complete` ⇒ partial-mode, không throw.

Hệ quả: "thứ tự deploy BE trước FE" từ ràng buộc cứng hạ xuống KHUYẾN NGHỊ (§5) — cả hai chiều lệch
phiên bản đều tự lành.

⟲R2 — ba sự thật chốt thêm cho `.catch(false)` (mạnh hơn lo ngại của R0):

- BE **không** serialize qua schema (`role-admin.controller.ts` trả thẳng, không `ZodSerializer`) ⇒
  `.catch` ở phía FE **không thể** che bug của server.
- `RoleMemberListDto = z.infer` là kiểu **output** ⇒ `complete: boolean` vẫn **BẮT BUỘC** với
  `listMembersInner(): Promise<RoleMemberListDto>` ⇒ "server quên phát" là **lỗi typecheck**, không
  cần test gánh.
- `.catch` nuốt cả giá trị KHÔNG-boolean (`"true"`/`null`/`1` → `false`) — chấp nhận được vì chỉ trượt
  về phía bi quan; hệ quả phải ghi: **cấm** ai sau này coi `complete === true` phía FE là tín hiệu
  "có thẩm quyền tuyệt đối" — server lỗi kiểu dữ liệu thì FE chỉ thấy `false`.

### D5 — FE: bỏ lời khẳng định sai, **GIỮ** chức năng

| chỗ | `complete === true` | `complete === false` |
| --- | --- | --- |
| bộ đếm `:117` | `roleMembers.count` (như cũ) | nhãn RIÊNG "N thành viên **bạn xem được**" |
| `AddPersonDialog` khoá hàng `:339-345` | như cũ | **không** khoá theo `memberIds`, **không** badge "đã là thành viên" — ⚠️ CHỈ bỏ vế `memberIds.has(...)`, **GIỮ** vế `userId === null` + badge `noAccount` `:340-344` + `disabledRowChecked` `:345`; gỡ cả cụm thì `onAddOne` reject `employee-not-linked` `:348` từng dòng, lỗi không giải thích được (⟲R1 MEDIUM) |
| `toAssign` `:383-384` / `:489-490` | `linked.filter(!memberIds.has)` (như cũ) | **`linked` TRỪ chính actor** (`e.userId !== me.userId`) — ⟲R2: hôm nay chính actor bị `memberIds` lọc (`@Own` luôn chứa mình); bỏ lọc TOÀN BỘ là mỗi batch chứa self-assign nổ SoD 403 "Cannot assign a role to yourself" thành dòng đỏ khó hiểu. `me.userId` là bit FE LUÔN biết hợp pháp — dedup mình không cần scope |
| dòng preview `alreadyMembers` | như cũ | **ẩn**, thay bằng một dòng nói rõ "không xác định được ai đã là thành viên (phạm vi xem hạn chế — người đã giữ vai trò sẽ được server tự bỏ qua)" |
| **EmptyState `:157-161`** (⟲R1 BLOCKING #5 — câu nói dối TO NHẤT của V3) | như cũ ("Chưa có thành viên") | 0 hàng là **trạng thái MẶC ĐỊNH** của `@Own` không có chân trong role (ngữ nghĩa KI-071) ⇒ empty-state RIÊNG: "không có thành viên nào **trong phạm vi bạn xem được**" — ca **F3** ghim |

⚠️ i18n: `AddPositionDialog` TÁI DÙNG khoá `roleMembers.addOrgUnit.preview.*` (`:552-560`) ⇒ dòng
"phạm vi xem hạn chế" đặt trong cùng nhóm khoá đó để áp cho CẢ HAI dialog — đặt khoá riêng cho
org-unit là dialog chức vụ giữ câu cũ trong im lặng (⟲R1 LOW).

**KHÔNG chọn "tắt hai dialog batch"**: `assign-role:user@Company` + `view:user@Own` là một hình dạng
cấp quyền **hợp lệ** (người vận hành cấp phát, §1), tắt đi là lấy mất một năng lực đúng vì một khiếm
khuyết ở tầng khác. Server no-op vẫn xử lý đúng người đã là thành viên.

⚠️ **Ghép cặp bắt buộc — không tách PR:** ở nhánh `complete === false`, FE **cố ý** POST cả người đã là
thành viên. Điều đó chỉ chấp nhận được **SAU** D2. Ship FE trước BE = biến một lỗi ngẫu nhiên thành
một luồng probe có chủ đích. _(Hôm nay FE **đã** làm đúng việc đó một cách vô tình vì `memberIds`
gần-rỗng — D5 chỉ khiến nó TRUNG THỰC, không khiến nó mới.)_ ⟲R1: cửa sổ deploy "FE mới + BE cũ"
trên PROD (D4/§5) KHÔNG mở thêm gì so với hôm nay vì đúng lý do trong ngoặc — kênh nằm ở THÂN response
của BE cũ và attacker chỉ cần `curl`, không cần FE; cùng-PR vẫn bắt buộc để không tồn tại BẢN PHÁT
HÀNH nào có D5 mà thiếu D2.

### D6 — `paths` của WO phải MỞ RỘNG (và nói ra lý do)

`paths` seed không có `packages/**` vì bản seed tưởng vế BE nằm gọn trong `apps/api/src/permission/**`.
Thu hẹp thân trả về (D2) và thêm `complete` (D4) **bắt buộc** đụng contract, nếu không client
`apiFetch` sẽ ZodError khi server bỏ khoá — đúng bẫy [[server-masking-needs-optional-fe-schema]].

Thêm: `packages/contracts/**` · `packages/web-core/**` · `apps/app/src/i18n/**`
(`locales/vi/system.ts` giữ chuỗi `roleMembers.*`, nằm NGOÀI `routes/system/roles/**`).

⟲R1: thêm cả **`apps/app/src/routes/system/users/**`** (fixture `UserRolesPage.spec.tsx:115-123` vỡ
typecheck — §0.3b) và **`apps/console/**`** (`rbac-api.ts:56` trả `Promise<UserRoleDto>`; lập luận
"chỉ parse, không đọc field ⇒ không phá typecheck" NHIỀU KHẢ NĂNG đúng nhưng cho phép TRƯỚC để không
phải quyết giữa chừng dưới `guard-scope`). _Xác minh cuối bằng `pnpm typecheck` chứ không bằng lập
luận._

### D7 — Bảng nhánh giữ nguyên; chỉ đổi **hình chiếu**

Không đụng `findUserRole`/`insertUserRole`/`deleteUserRole`/audit/outbox. Chỉ thay `return existing` /
`return inserted` bằng một **bộ chiếu DUY NHẤT** dùng chung cho cả ba nhánh — một hàm, một chỗ:

```ts
private projectAssignResult(companyId, targetUserId, roleId, expiresAt): UserRoleDto
```

Một điểm chiếu ⇒ đột biến "quên chiếu ở một nhánh" là **không viết ra được** bằng cách sửa một dòng;
phải xoá cả lời gọi (M-B bắt).

⟲R2 — **ratchet rẻ nhất, thêm cùng lúc:** annotate chính
`async assignRole(...): Promise<UserRoleDto>` (hiện KHÔNG có annotation). Khi đó `return inserted`
(hàng drizzle, `expiresAt: Date`) là **lỗi typecheck** với `expiresAt: z.string().datetime()` của
contract ⇒ M-B từ "test bắt" thành "compiler bắt". Một dòng.

### D8 — KHÔNG gộp ba bản sao `rowScopeFor`

Nợ N-4 của KI-071 giữ nguyên. WO này không thêm điểm đúc thứ tư (không bound hàng mới) ⇒ không chạm
`ROW_SCOPE_MINT_PINS`.

---

## 3. Test — RED TRƯỚC, và chống ca XANH-RỖNG

### 3.1 Int-spec HTTP (`apps/api/test/integration/identity-projection-scope.int-spec.ts`)

Tái dùng **tenant A + app + helper** sẵn có (nested `describe` "KI-073" với `beforeAll` riêng), nhưng
**⟲R1 (BLOCKING #3): TUYỆT ĐỐI KHÔNG chạm `roleUnderTest`/`roleOther`** — cả hai bị A1/R-A1/R-A3/
R-T1/R-T2 ghim theo TẬP THÀNH VIÊN (`:208-222` cảnh báo nguyên văn); O1 cần thành viên sẵn, O3 TẠO
thành viên mới ⇒ mọi ca O sống trên **role THỨ BA** `roleKN` + user riêng:

- `roleKN` — role đích của mọi POST trong khối O (seedRole, tên `idproj-ki073-target`).
- `uMemberM` — ĐÃ là thành viên `roleKN`: seed bằng SQL trực tiếp với `granted_by = uGrantor`
  (**người KHÁC actor**) và `created_at` **lùi về quá khứ** — gieo `granted_by = actor` là O1/O2
  xanh-RỖNG với bản vá chỉ che `createdAt`.
- `uFreshN` (O2) · `uFreshN2` (O3) — chưa là thành viên. Hai người RIÊNG: O2 đã gán `uFreshN` thật.
- actor `uProv` = `assign-role:user@Company` + `view:user@Own` (login) — hình dạng "người vận hành
  cấp phát"; actor `uProvCo` = `assign-role:user@Company` + `view:user@Company` (O3).
- ⟲R2: seed catalog cặp `('assign-role','user')` với **`isSensitive: true`** cho khớp PROD
  (`seedPermissionCatalog` là INSERT-only `ON CONFLICT DO NOTHING` — cờ bị bỏ qua im lặng nếu cặp đã
  có, nhưng đừng KHAI sai trong fixture).
- ⟲R2 (vị trí): nested `describe` KI-073 đặt **CUỐI file, sau khối D3** — khối này đăng nhập
  `uProv`/`uProvCo` (⇒ `login_logs`) và O2/O3 ghi `user_security_events ROLE_ASSIGNED` trong tenant A,
  đúng hai bảng mà B1/B2/C1/C2/C3 đọc với `per_page=100`; đặt cuối để không xê dịch dữ liệu các ca đó
  đang nhìn.

⚠️ **⟲R1 (BLOCKING #4): MỌI ca O đọc `res.body.data`** — app cài `ResponseEnvelopeInterceptor`
(`:180`), assert trên `res.body` thì `Object.keys` = `['data']` và ca DENY **luôn xanh kể cả khi
revert sạch bản vá**. Phát biểu O1 theo **đẳng thức tập khoá** (không phải phủ định "không chứa").

| ca | loại | phát biểu |
| --- | --- | --- |
| **O1** | DENY (RED) | `uProv` POST cho `uMemberM` ⇒ status **201** (⟲R2: đã đo sẵn — `permadmin-roles-http.int-spec.ts:218`; không để mở) và `Object.keys(res.body.data).sort()` **đúng bằng** `["companyId","expiresAt","roleId","userId"]`, kèm neo giá trị `userId === uMemberM` ∧ `roleId === roleKN` (chống thân rỗng) |
| **O2** | DENY (RED) — **ca cốt lõi** | Cùng actor POST cho `uMemberM` (đã là thành viên) và `uFreshN` (chưa) ⇒ (a) hai status BẰNG NHAU; (b) mỗi thân đúng 4 khoá như O1; (c) hai thân **BẰNG NHAU sau khi bỏ `userId`** |
| **O3** | ALLOW (đối chứng) | `uProvCo` POST cho `uFreshN2` ⇒ 2xx, **hàng `user_roles` active THẬT được tạo** (SQL đếm theo `(company_id,user_id,role_id)`) + audit `RoleAssigned` với `object_type='user_role'` AND `object_id` = **id THẬT đọc từ DB** ⇒ thu hẹp KHÔNG làm hỏng mutation, và audit vẫn trỏ hàng thật (bất biến #2) |
| **O4** | trạng thái (ghim D3) | TỰ CHỨA: đếm TRƯỚC → POST no-op (`uProv` → `uMemberM`) → đếm LẠI, **BỐN bộ đếm không đổi**, cùng khoá `(company_id, uMemberM, roleKN)`: (1) `user_roles` cả active lẫn tombstone; (2) `audit_logs` `object_type='user_role'` giao tập id các hàng đó; (3) ⟲R2: `outbox` sự kiện `permission.changed` của `uMemberM`; (4) ⟲R2: `user_security_events` `ROLE_ASSIGNED` của `uMemberM` — D3 kể BA tác hại (tombstone rác · audit giả · `permission.changed` bắn thừa), O4 chỉ đếm 2 bảng là đột biến "no-op vẫn emit" LỌT. ⟲R1: KHÔNG đếm toàn cục — O2/O3 chạy cùng file làm bẩn số đếm |
| **S1** | cờ `complete` | GET members `roleUnderTest`: `tokOwn` ⇒ `res.body.data.complete === false`; `tokCompany` ⇒ `=== true` (hai `it()` riêng, hai giá trị — đọc route sẵn có, KHÔNG đụng tập thành viên). ⟲R2: **KHÔNG dùng helper `roleMembers()`** — nó chỉ trả `{status, rows}`, VỨT `complete` (`:148-151`); gọi `api(app).get(...)` trực tiếp, nếu không ca xanh-rỗng kiểu "`undefined === false`" |

⚠️ **Chống xanh-RỖNG cho O2** — bài học `deny-cases-vacuous-without-allow-case` +
`same-builder-twice-makes-unit-spec-vacuous`: "hai thân bằng nhau" **cũng đúng khi cả hai là `{}`**
hay khi route hỏng 500 → assert (b) tập-khoá + neo giá trị của O1 chặn chiều đó. Và **O3 là neo**:
thiếu O3, toàn bộ khối O có thể xanh trong khi route đã ngừng gán được ai.

### 3.2 Unit (KHÔNG cần DB) — `permission-admin.assign-response.spec.ts`

| ca | phát biểu |
| --- | --- |
| **U1** | nhánh no-op: repo mock trả `existing` mang **sentinel riêng** (`id`/`grantedBy`/`createdAt` khác hẳn request) ⇒ giá trị trả về đúng bốn khoá, giá trị echo request |
| **U2** | nhánh fresh: repo mock trả `inserted` mang **sentinel KHÁC U1** ⇒ **cùng** tập khoá, cùng giá trị |
| **U3** | nhánh reassign (đổi expiry) ⇒ cùng tập khoá, `expiresAt` = giá trị REQUEST |

⚠️ Ba ca dùng **ba bộ sentinel khác nhau** — nếu dùng chung một builder/giá trị thì đột biến "trả
nguyên hàng" vẫn xanh ở ít nhất một ca (bẫy `same-builder-twice-makes-unit-spec-vacuous`).

### 3.3 FE — `RoleMembersTab.spec.tsx`

| ca | phát biểu |
| --- | --- |
| **F1** | `complete: false` ⇒ nhãn đếm partial; dòng `alreadyMembers` **vắng**, dòng "phạm vi xem hạn chế" **hiện**; `toAssign` = TOÀN BỘ nhân viên đã link **trừ chính actor** (⟲R2 — kể cả người có trong `members`, nhưng KHÔNG gồm `me.userId`) |
| **F2** | `complete: true` ⇒ hành vi cũ NGUYÊN VẸN: dedup đúng, `alreadyMembers` hiện, hàng đã-là-thành-viên bị khoá (neo ALLOW — kỳ vọng XANH ngay trên cây chưa vá) |
| **F3** (⟲R1 BLOCKING #5) | `complete: false` + `members: []` ⇒ empty-state RIÊNG "trong phạm vi bạn xem được", KHÔNG phải "Chưa có thành viên" |
| **F4** (⟲R1 BLOCKING #2) | fixture **VẮNG khoá `complete`** (BE cũ) ⇒ KHÔNG throw, hành xử như `complete: false` (partial-mode) — ghim đường degrade `.catch(false)`. ⚠️ Ca này phải đi qua **parse schema thật** (gọi `roleMemberListSchema.parse` trên fixture trong spec của contract/web-core, hoặc mock ở tầng `apiFetch`) — mock thẳng `roleAdminApi.getMembers` thì `.catch` không được thực thi và ca xanh-RỖNG |
| — | **GIỮ** ca `:201` (hàng thiếu `email`/`fullName` vẫn render) theo ghi chú WO — phòng thủ FE vẫn đúng dù server nay không phát ra hình dạng đó |

⚠️ Fixture sẵn có phải theo contract mới: `MEMBERS` `:52-63` và ca empty `:99` thêm
`complete: true` (giữ NGUYÊN ý nghĩa cũ của chúng); ca `:201` thêm `complete: true`.

### 3.4 API-client — `packages/web-core/src/lib/auth-users-api.spec.ts`

Sửa fixture `USER_ROLE` theo hình dạng mới + assert theo **đẳng thức tập khoá** (⟲R1 BLOCKING #4,
không phủ định "không chứa"): `Object.keys(userRoleSchema.parse(fixtureCũ)).sort()` **đúng bằng** 4
khoá — chứng minh zod **strip** khi server (cũ/rollback) còn gửi 3 khoá thừa. Ca **F4** tầng schema
cũng sống ở đây: `roleMemberListSchema.parse({members:[…]})` (VẮNG `complete`) ⇒ `complete === false`,
không throw.

### 3.5 Đột biến — RED-proof phải ĐO, không dự đoán

Chạy trên lane DB riêng (`bash scripts/lane-db-setup.sh rolememberfe` → `export LANE_DB=mediaos_rolememberfe`).

| mã | đột biến | kỳ vọng | **ĐO 24/08 (lane `mediaos_rolememberfe`)** |
| --- | --- | --- | --- |
| **M-A** | trả thẳng hàng gốc/`inserted` ở CẢ BA nhánh (revert D2, ép `as unknown as` để qua ratchet kiểu) | O1·O2·U1·U2·U3 ĐỎ | ✅ **O1·O2 ĐỎ (int 2/24 fail) + U1·U2·U3 ĐỎ (unit 3/3 fail)** |
| **M-B** | chỉ chiếu ở nhánh no-op, hai nhánh kia trả `inserted` | **O2 ĐỎ, O1 XANH** ⇒ chứng minh O2 tự mang sức nặng | ✅ **O1 XANH · O2 ĐỎ (1/24 fail)** |
| **M-C** | FE bỏ qua `complete` (luôn dedup) | F1 ĐỎ | ✅ **F1 ĐỎ + F3 ĐỎ (2/11 fail), F2 XANH** |
| **M-D** | server hard-code `complete: true` | S1 ĐỎ (không phải chỉ F1 — F1 nhận cờ từ fixture) | ✅ **S1a ĐỎ · S1b XANH (1/24 fail)** |
| **M-E** | bỏ nhánh no-op, luôn delete+insert | O4 ĐỎ | ✅ **O4 ĐỎ (1/24 fail)** — bốn bộ đếm cùng lệch |
| **M-F** (⟲R1 #1c) | `audit.record` nhận giá trị KHÔNG phải `inserted.id` (vd `targetUserId`) | O3 ĐỎ (audit `object_id` không còn = id hàng thật) | ✅ **O3 ĐỎ (1/24 fail)** |

Ghi chú đo: ratchet kiểu của D7 (annotation `assignRole(): Promise<UserRoleDto>`) hoạt động đúng như
thiết kế — M-A/M-B KHÔNG viết ra được bằng `return existing`/`return inserted` trần (lỗi typecheck,
`expiresAt: Date` vs `string|null`), phải ép `as unknown as` mới đo được ở tầng test.

Con số ĐỎ/XANH thật **điền vào bảng này sau khi chạy**; plan không được ship với ô "kỳ vọng" chưa đối chiếu.

### 3.6 Kết quả chạy RED — 24/08, cây CHƯA vá (`master` sau #404), lane `mediaos_rolememberfe`

| suite | kết quả | khớp kỳ vọng §6.2? |
| --- | --- | --- |
| int-spec `identity-projection-scope` | **O1 ĐỎ · O2 ĐỎ · S1a ĐỎ · S1b ĐỎ** (tập khoá = 9 khoá hàng gốc; `complete` = `undefined`) · **O3 XANH · O4 XANH** (neo) · 18 ca cũ XANH nguyên | ✅ |
| unit `permission-admin.assign-response` | **U1 ĐỎ · U2 ĐỎ · U3 ĐỎ** (thân = nguyên hàng repo, 9 khoá — U3 in đúng `createdAt/deletedAt/deletedBy/grantedBy/id` thừa) | ✅ |
| FE `RoleMembersTab` | **F1 ĐỎ** (nhãn partial chưa có) · **F3 ĐỎ** (empty-state vẫn "Chưa có thành viên") · **F2 XANH** (neo hành-vi-cũ) · 8 ca cũ XANH nguyên | ✅ |
| web-core §3.4 | **strip-4-khoá ĐỎ** (parse trả 7 khoá) · **F4-schema ×2 ĐỎ** (`complete` = `undefined`) | ✅ |

Tổng: **10 ca ĐỎ đúng chỗ, 3 ca neo XANH đúng chỗ, 0 ca cũ bị lay** — RED-proof hợp lệ để sang bước
contract (§6.3). Bảng đột biến §3.5 điền SAU khi vá (bước §6.6).

---

## 4. Ranh giới & nợ — đọc trước khi tin dấu gạch ngang trên KI-073

- **N-1 — V2 (`DELETE` 404 vs 204) KHÔNG đóng ở WO này.** `auth-users-api.ts:136` ghi rõ 404 là quyết
  định CÓ CHỦ Ý ("caller xử lý như lỗi rõ ràng, KHÔNG no-op ngầm"); đảo nó là lấy mất một tín hiệu vận
  hành đúng. **Ranh phân biệt có nguyên tắc:** V1 im lặng ở **mọi câu trả lời dương** (0 hàng forensic
  khi phát hiện một thành viên); V2 **ồn**: mỗi lần trúng đều ghi `RoleRevoked` + `user_security_events`
  **và thực sự gỡ vai của nạn nhân** (thiệt hại thật, phát hiện được). ⟲R1 (MEDIUM) — lập luận đó
  **chỉ đúng ở chiều DƯƠNG**: chiều ÂM ("x KHÔNG phải thành viên") ném NotFound **trước mọi ghi**
  (`permission-admin.service.ts:160-163`) ⇒ 0 hàng forensic, 0 thiệt hại — gương của V1; và actor giữ
  `assign-role:user` vá lại được ngay bằng POST, khiến cặp `RoleRevoked`+`RoleAssigned` lẫn vào nhiễu
  cấp phát bình thường. ⇒ Tính chất WO này đạt được là **"không enumerate im lặng theo chiều DƯƠNG"**,
  KHÔNG phải "không enumerate im lặng" — câu này phải chép NGUYÊN VĂN vào KI mới, nếu không dấu gạch
  trên KI-073 lại đọc thành "route đã kín". **Phải vào RELEASE-02 dưới một số hiệu RIÊNG, cấp số
  TRƯỚC khi dấu gạch ngang land** (tiền lệ KI-071/072) — phần còn sống chỉ nằm dưới dạng văn xuôi
  trong một hàng đã gạch thì **vô hình với bug scrub**.
- **N-2 — kênh THỜI GIAN.** No-op = 0 ghi; fresh = insert + audit + security-event + outbox. Chênh lệch
  đo được. Không đóng (đóng = ghi giả). Cùng lớp `attribution-patch-creates-timing-oracle`.
- **N-3 — `Team`/`Department` ⇒ 0 hàng, lưới scope KHÔNG đơn điệu** (kế thừa N-1b của KI-071). `complete`
  cũng `false` ở đó ⇒ nhất quán, nhưng **không sàn hoá** — phải làm cho CẢ BA đường cùng lúc.
- **N-4 — ba bản sao `rowScopeFor`** (kế thừa KI-071). Không đụng.
- **N-5 — quan-sát-được của đường degrade `.catch(false)`** (FULL gate silent-failure-hunter 24/08,
  MEDIUM duy nhất): khi `.catch` nổ THẬT (BE thiếu khoá/sai kiểu), FE chỉ hiện partial-mode có nhãn —
  không có breadcrumb telemetry phân biệt "cửa sổ deploy dự kiến" với "BE regression nằm lì". Follow-up:
  một sự kiện log/telemetry một-lần khi `complete` bị catch về `false` (không dùng `console.log` trần —
  quy ước codebase). Không chặn merge.
- **N-6 — batch dưới `complete=false` SAN HẠN của thành viên có thời hạn** (FULL gate security-reviewer
  24/08, MEDIUM duy nhất). Khi `complete === false`, `toAssign` = toàn bộ nhân viên đã link; `useAssignBatch`
  POST `{ roleId }` **không kèm `expiresAt`** ⇒ với người đang giữ vai trò ĐẾN một mốc,
  `sameExpiry(Date, null) === false` (`permission-admin.service.ts:38-42`) ⇒ rơi nhánh **reassign**
  (`:121-131`): soft-delete hàng cũ + INSERT `expiresAt: null` ⇒ **grant có hạn thành vĩnh viễn**.
  Cửa MỚI do WO mở là **`company-admin` trong cửa sổ FE-mới/BE-cũ** (trạng thái MẶC ĐỊNH sau merge theo
  D4): họ vốn luôn dedup, nay `complete` rơi `false`.
  **Vế i18n đã VÁ TRONG PR NÀY** (dòng `dedupUnavailable` do chính WO này viết ra mà hứa sai "hệ thống
  tự bỏ qua" ⇒ nợ tự tạo, không để lại): câu mới nói thẳng "sẽ được gán lại; ai đang giữ CÓ THỜI HẠN sẽ
  bị ghi đè thành vĩnh viễn".
  **Vế service = NỢ, cố ý không vá ở đây:** "bỏ qua reassign khi request không khai `expiresAt` mà hàng
  active có" là **đổi ngữ nghĩa API GHI** — thuộc WO riêng, qua plan-review, không nhét vào PR đóng oracle.
  **Không phải leo thang quyền:** actor buộc giữ `assign-role:user` (sensitive, company-wide); mọi lần đều
  để lại `RoleReassigned` + `before.expiresAt` cũ trong `audit_logs`, `ROLE_ASSIGNED` trong
  `user_security_events`, và một tombstone ⇒ dựng lại 100%.
- **N-7 — `AddPersonDialog` không khoá hàng của CHÍNH MÌNH khi `complete=false`** (security-reviewer LOW).
  `myUserId` có trong `AddDialogProps` nhưng dialog đơn **không destructure**; trước đây `memberIds` dưới
  `@Own` luôn chứa self nên hàng self bị khoá sẵn. ⇒ chọn phải mình → 403 SoD từng dòng — đúng lớp lỗi D5
  ⟲R2 đã né cho hai dialog batch. **Là lỗ của PLAN, không phải sai lệch của implementer**: bảng D5 chỉ kê
  self-exclusion cho `toAssign`. Vá = mở rộng D5 ⇒ cần vòng plan-review, để nợ.
- **N-8 — `as unknown as z.ZodType<RoleMemberListDto>`** (`role-admin-api.ts:60`, security-reviewer LOW).
  Cast là **cần thật** (`.catch()` làm Input≠Output; `apiFetch` khai `z.ZodType<T>` = Input≡Output) và
  runtime không ảnh hưởng (2 ca F4-schema chạy `.parse` THẬT). Nhưng `as unknown as` xoá luôn quan hệ
  Input/Output ⇒ sau này truyền **nhầm schema** vào đúng call-site này cũng compile. Sửa đúng chỗ là nới
  **một lần** chữ ký `apiFetch<T>(path, schema: z.ZodType<T, z.ZodTypeDef, unknown>, …)` — đụng MỌI
  consumer ⇒ WO riêng. (Handoff 24/08 đã chốt "đừng đổi apiFetch trong PR này".)
- **N-9 — thẻ đếm render vô điều kiện khi query LỖI** (`RoleMembersTab.tsx:99` + `:126-132`,
  security-reviewer LOW/NOTE). `membersQuery.data ? data.complete : true` ⇒ lúc lỗi `complete` rơi về
  `true` còn `members = []` ⇒ hiện "0 thành viên đang giữ vai trò này" — **đúng câu khẳng định mà D5 sinh
  ra để xoá**. Là hình dạng CÓ SẴN trước diff (bộ đếm vốn = 0 khi lỗi), không phải hồi quy. Sửa sạch =
  cho header ăn `membersQuery.data` giống thân.
- ⚠️ **Đừng đọc thành "tab Thành viên role đã kín".** WO này đóng V1 + V3. V2 còn sống dưới N-1.

---

## 5. Rollback

Code-only, **0 migration** ⇒ `git revert` PR là đủ. **Không có feature-flag** (một cờ tắt-thu-hẹp-thân
chính là lỗ hổng có công tắc).

⟲R1 (BLOCKING #2) — lệch phiên bản BE/FE **tự lành CẢ HAI CHIỀU** nhờ D4 `.catch(false)`:

- BE mới + FE cũ ⇒ FE parse thừa khoá → zod **strip**, không vỡ.
- FE mới + BE cũ (trạng thái MẶC ĐỊNH sau merge trên PROD — Pages tự deploy FE, API deploy tay,
  [[prod-3-way-drift-fe-auto-be-manual]]) ⇒ `complete` rơi về `false` → partial-mode + nhãn, KHÔNG
  ZodError, KHÔNG khẳng định sai. Hết cửa "vỡ TRẮNG tab cho mọi actor".
- ⇒ "BE trước, FE sau" chỉ còn là **khuyến nghị** (rút ngắn cửa sổ nhãn partial cho company-admin),
  không phải biện pháp kiểm soát.

**Lối thoát vận hành** (⟲R1 câu hỏi mở): sự cố sau deploy chỉ có hai hình dạng — (i) FE hiện partial
nhãn kéo dài = BE chưa deploy → `m deploy-api`; (ii) hành vi route ghi sai → `git revert` PR + deploy
lại API (không có state phải dọn: 0 migration, không đổi bảng nhánh ghi). KHÔNG có ca "403 hàng loạt"
mới: WO này không đổi gate/scope nào của đường ghi lẫn đường đọc (KI-071 đã đóng đường đọc).

---

## 6. Thứ tự thi công

1. `harness/backlog.mjs` — ⟲R1: 3 glob đầu ĐÃ thêm 24/08; còn thêm `apps/app/src/routes/system/users/**`
   và `apps/console/**` (§0.3b), **viết lại `done_when` #1–#3 VÀ `title` theo kênh THẬT** (thân 201,
   không còn "409"/"mã trả về của batch" — `title` là thứ gen-status/RELEASE-02 render; gạch KI-073
   với title cũ = đóng dấu vĩnh viễn một cơ chế §0 đã bác), sửa comment `apps/console/** KHÔNG cần`
   cho khớp data (⟲R2 #4).
2. **RED**: viết O1·O2·O3·O4·S1·U1–U3·F1–F4 **+ hai ca §3.4** (strip-4-khoá · F4-schema) trên cây
   CHƯA vá → chạy → **ghi lại ca nào đỏ** (kỳ vọng: O1·O2·S1·U1–U3·F1·F3·F4·§3.4 đỏ; O3·O4·F2
   xanh-neo).
3. Contract: thu hẹp `userRoleSchema` (D2) + `complete: z.boolean().catch(false)` vào
   `roleMemberListSchema` (D4) + §3.4.
4. BE: `projectAssignResult` (D7) + `complete` ở `listMembersInner`; sửa 3 int-spec theo đơn §0.3b.
5. FE: `RoleMembersTab` theo D5 (5 hàng, gồm empty-state) + i18n (khoá dùng chung 2 dialog) + fixture
   `UserRolesPage.spec.tsx`/`RoleMembersTab.spec.tsx` theo §0.3b + §3.3.
6. Chạy M-A…M-F, điền bảng §3.5.
7. `pnpm typecheck` + `pnpm lint` + `bash harness/check.sh --lane-db=rolememberfe`.
8. RELEASE-02: **cấp số KI mới cho N-1 TRƯỚC**, rồi mới gạch KI-073 (sửa cả câu mô tả cơ chế của hàng
   KI-073 theo §0 — không gạch một mô tả sai); FULL gate `security-reviewer`; số đo PROD (§0.4, owner
   chạy) đính vào PR trước khi merge.
