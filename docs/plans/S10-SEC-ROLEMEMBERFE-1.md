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
| **no-op** | `existing && sameExpiry` (`:105`) | **200** | **hàng GỐC** (`existing`) |
| reassign | `existing && !sameExpiry` (`:110`) | 200 | hàng MỚI (`inserted`) |
| fresh | `!existing` | 200 | hàng MỚI (`inserted`) |
| conflict | `insertUserRole` trả `undefined` — **thua race** (`:120-123`) | 409 | — |

Hai dialog batch (`AddOrgUnitDialog:383-384` · `AddPositionDialog:489-490`) gọi
`authUsersApi.assignRole(userId, { roleId })` — **không có `expiresAt`** ⇒ `expiresAt = null` ⇒ với một
người ĐÃ là thành viên vĩnh viễn thì `sameExpiry(null, null) === true` (`:37-41`, so sánh **bằng tuyệt
đối**) ⇒ luôn rơi vào nhánh **no-op**. `useAssignBatch` (`RoleMembersTab.tsx:~275`) chỉ ghi
`kind:"error"` khi promise **throw**; 200 ⇒ `kind:"ok"`. ⇒ **`BatchResultList` hiện TOÀN "ok"** — ở tầng
danh sách kết quả **không có oracle nào cả**.

**Xác minh phủ định:** `grep -rn "409\|Conflict" apps/api/src/permission/*.spec.ts` ⇒ **0 kết quả**.
Không một ca test nào trong cả module chạm nhánh 409 — đúng như dự đoán từ bảng nhánh.

### 0.1 Kênh THẬT — thân trả về 200 phân biệt được "đã là thành viên"

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
- **Một request / một người**, HTTP 200, không cần chạy batch, không cần FE — `curl` là đủ.
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
| no-op trả 200 + hàng gốc | `permission-admin.service.ts:105-107` | ĐÚNG |
| `sameExpiry` là bằng-tuyệt-đối (không dung sai) | `:37-41` | ĐÚNG ⇒ `expiresAt` trả về **luôn** = giá trị request ở CẢ BA nhánh ⇒ 0 bit thông tin |
| 409 chỉ ở nhánh thua-race | `:120-123` | ĐÚNG; 0 test nào phủ |
| `id`/`grantedBy`/`createdAt` không có consumer | `grep -rn "userRoleSchema\|UserRoleDto" apps packages` | ĐÚNG — 2 client (`web-core/auth-users-api.ts:128`, `console/rbac-api.ts:56`), **0 chỗ đọc field**; `RoleMembersTab` (`useAssignBatch`, `AddPersonDialog.onAddOne`) và `console/assign-role-dialog.tsx:48` đều **bỏ** giá trị trả về |
| DELETE trả 404 khi không phải thành viên | `:161-163` | ĐÚNG ⇒ oracle THỨ HAI, xem N-1 |
| FE **CÓ** nhận `data_scope` từng cặp | `packages/contracts/src/auth.ts:154` `scopes: z.record(z.array(z.enum(DATA_SCOPES))).optional()` | ĐÚNG — nhưng **KHÔNG dùng được**, xem D4 |
| `listMembersInner` ĐÃ phân giải `scope` | `role-admin.service.ts:183` (sau #404) | ĐÚNG ⇒ cờ `complete` lấy được **không tốn lần resolve thứ hai** |
| int-spec HTTP của route này có sẵn | `apps/api/test/integration/identity-projection-scope.int-spec.ts` (A1·A2·A3·R-D2·R-D3·R-A3·R-T1·R-T2·R-G1·R-X1) | ĐÚNG — ca mới đặt cùng file, tái dùng fixture tenant A/B |

### 0.4 Số đo PROD — ⛔ CHƯA ĐO, CHẶN PR

`done_when` đòi số đo PROD ĐO LẠI. Script chỉ-SELECT đã soạn
(`scratchpad/measure.mjs` — `role_permissions ⋈ permissions ⋈ roles` + `count(user_roles)`), **bị
classifier của auto-mode chặn 2 lần**. Cần owner cấp quyền chạy.

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

---

## 1. Khuyết tật — phát biểu chính xác

**V1 (BE — oracle THẬT, phải đóng).** `POST /permissions/users/:userId/roles` trả **thân 200 phân biệt
được** "đã là thành viên" với "vừa gán" qua `id`/`grantedBy`/`createdAt` (§0.1). Vai giữ
`assign-role:user` **cộng** `view:user@Own` dựng lại được TRỌN tập thành viên mà KI-071 vừa giấu, bằng
1 request/người, và **im lặng ở mọi câu trả lời dương**.

**V2 (BE — oracle THỨ HAI, KHÔNG đóng ở WO này).** `DELETE /permissions/users/:userId/roles/:roleId`
trả **404 "User does not have this role"** vs **204**. Xem N-1.

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
{ userId: targetUserId, roleId: dto.roleId, companyId: actor.companyId, expiresAt }
```

Cả bốn đều do **caller cung cấp hoặc suy ra được** ⇒ **0 bit thông tin**. `expiresAt` an toàn ở CẢ BA
nhánh vì `sameExpiry` là bằng-tuyệt-đối (§0.3): no-op ⇒ bằng request theo định nghĩa; reassign/fresh ⇒
chính giá trị request.

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
4. Chi phí = 0: **0 consumer** đọc ba cột đó (§0.3).

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
{ members: [...], complete: boolean }   // complete = scope ∈ {Company, System}
```

**0 lần resolve thêm** (dùng lại chính biến `scope` — giữ luật KI-070 D11 "mỗi cặp resolve ĐÚNG MỘT
LẦN/request"). `complete` chỉ nói về **scope của CHÍNH actor** ⇒ không rò gì.

⚠️ `complete` khai **bắt buộc** (không `.optional()`): nếu optional thì `undefined` sẽ được FE đọc
thành falsy = "không đủ", nghĩa là một server CŨ (rollback từng phần) làm FE **im lặng tắt dedup** cho
mọi người — hỏng theo kiểu khó thấy. Bắt buộc ⇒ lệch phiên bản nổ ngay bằng ZodError, không nằm im.
_(Ngược chiều với `email` của KI-053: ở đó vắng-khoá LÀ tín hiệu; ở đây vắng-khoá là LỖI.)_

### D5 — FE: bỏ lời khẳng định sai, **GIỮ** chức năng

| chỗ | `complete === true` | `complete === false` |
| --- | --- | --- |
| bộ đếm `:117` | `roleMembers.count` (như cũ) | nhãn RIÊNG "N thành viên **bạn xem được**" |
| `AddPersonDialog` khoá hàng `:339-345` | như cũ | **không** khoá, **không** badge "đã là thành viên" |
| `toAssign` `:383-384` / `:489-490` | `linked.filter(!memberIds.has)` (như cũ) | **`linked`** (toàn bộ) |
| dòng preview `alreadyMembers` | như cũ | **ẩn**, thay bằng một dòng nói rõ "không xác định được ai đã là thành viên (phạm vi xem hạn chế)" |

**KHÔNG chọn "tắt hai dialog batch"**: `assign-role:user@Company` + `view:user@Own` là một hình dạng
cấp quyền **hợp lệ** (người vận hành cấp phát, §1), tắt đi là lấy mất một năng lực đúng vì một khiếm
khuyết ở tầng khác. Server no-op vẫn xử lý đúng người đã là thành viên.

⚠️ **Ghép cặp bắt buộc — không tách PR:** ở nhánh `complete === false`, FE **cố ý** POST cả người đã là
thành viên. Điều đó chỉ chấp nhận được **SAU** D2. Ship FE trước BE = biến một lỗi ngẫu nhiên thành
một luồng probe có chủ đích. _(Hôm nay FE **đã** làm đúng việc đó một cách vô tình vì `memberIds`
gần-rỗng — D5 chỉ khiến nó TRUNG THỰC, không khiến nó mới.)_

### D6 — `paths` của WO phải MỞ RỘNG (và nói ra lý do)

`paths` seed không có `packages/**` vì bản seed tưởng vế BE nằm gọn trong `apps/api/src/permission/**`.
Thu hẹp thân trả về (D2) và thêm `complete` (D4) **bắt buộc** đụng contract, nếu không client
`apiFetch` sẽ ZodError khi server bỏ khoá — đúng bẫy [[server-masking-needs-optional-fe-schema]].

Thêm: `packages/contracts/**` · `packages/web-core/**` · `apps/app/src/i18n/**`
(`locales/vi/system.ts` giữ chuỗi `roleMembers.*`, nằm NGOÀI `routes/system/roles/**`).
`apps/console/**` **không** cần: `rbac-api.ts` chỉ `apiFetch(..., userRoleSchema, ...)` và
`assign-role-dialog.tsx:48` bỏ giá trị trả về ⇒ thu hẹp schema không phá typecheck. _Xác minh lại bằng
`pnpm typecheck` chứ không bằng lập luận này._

### D7 — Bảng nhánh giữ nguyên; chỉ đổi **hình chiếu**

Không đụng `findUserRole`/`insertUserRole`/`deleteUserRole`/audit/outbox. Chỉ thay `return existing` /
`return inserted` bằng một **bộ chiếu DUY NHẤT** dùng chung cho cả ba nhánh — một hàm, một chỗ:

```ts
private projectAssignResult(companyId, targetUserId, roleId, expiresAt): UserRoleDto
```

Một điểm chiếu ⇒ đột biến "quên chiếu ở một nhánh" là **không viết ra được** bằng cách sửa một dòng;
phải xoá cả lời gọi (M-B bắt).

### D8 — KHÔNG gộp ba bản sao `rowScopeFor`

Nợ N-4 của KI-071 giữ nguyên. WO này không thêm điểm đúc thứ tư (không bound hàng mới) ⇒ không chạm
`ROW_SCOPE_MINT_PINS`.

---

## 3. Test — RED TRƯỚC, và chống ca XANH-RỖNG

### 3.1 Int-spec HTTP (`apps/api/test/integration/identity-projection-scope.int-spec.ts`)

Tái dùng fixture tenant A/B sẵn có. Thêm một vai `provisioner` = `assign-role:user@Company` +
`view:user@Own`.

| ca | loại | phát biểu |
| --- | --- | --- |
| **O1** | DENY (RED) | `provisioner` POST cho `M` (ĐÃ là thành viên, `grantedBy` ≠ actor, `createdAt` quá khứ) ⇒ 200 và thân **KHÔNG có** `id`/`grantedBy`/`createdAt` |
| **O2** | DENY (RED) — **ca cốt lõi** | Cùng actor POST cho `M` (đã là thành viên) và `N` (chưa) ⇒ hai thân **BẰNG NHAU sau khi bỏ `userId`**, VÀ tập khoá **đúng bằng** `{userId,roleId,companyId,expiresAt}` |
| **O3** | ALLOW (đối chứng) | Actor `@Company` POST cho `N` ⇒ 200, **và hàng `user_roles` THẬT SỰ được tạo** + audit `RoleAssigned` ghi ⇒ thu hẹp KHÔNG làm hỏng mutation |
| **O4** | trạng thái (ghim D3) | Sau O1, `user_roles` và `audit_logs` **không có hàng mới** ⇒ nhánh no-op còn nguyên |
| **S1** | cờ `complete` | scope `Own` ⇒ `complete === false`; scope `Company` ⇒ `complete === true` (hai `it()` riêng, hai giá trị) |

⚠️ **Chống xanh-RỖNG cho O2** — bài học `deny-cases-vacuous-without-allow-case` +
`same-builder-twice-makes-unit-spec-vacuous`: "hai thân bằng nhau" **cũng đúng khi cả hai là `{}`** hay
khi route hỏng trả 500 → không tới `expect`. Nên O2 assert **BA** thứ, không một: (a) cả hai status =
200; (b) `Object.keys(body).sort()` **đúng bằng** bốn khoá; (c) hai thân bằng nhau modulo `userId`.
Và **O3 là neo**: thiếu O3, toàn bộ khối O có thể xanh trong khi route đã ngừng gán được ai.

⚠️ `M` phải được gieo với `grantedBy` là **người KHÁC** actor và `createdAt` **lùi về quá khứ**. Gieo
`grantedBy = actor` sẽ làm O1/O2 xanh-RỖNG với một bản vá chỉ che `createdAt`.

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
| **F1** | `complete: false` ⇒ nhãn đếm partial; dòng `alreadyMembers` **vắng**; `toAssign` = TOÀN BỘ nhân viên đã link (kể cả người có trong `members`) |
| **F2** | `complete: true` ⇒ hành vi cũ NGUYÊN VẸN: dedup đúng, `alreadyMembers` hiện, hàng đã-là-thành-viên bị khoá |
| — | **GIỮ** ca `:201` (hàng thiếu `email`/`fullName` vẫn render) theo ghi chú WO — phòng thủ FE vẫn đúng dù server nay không phát ra hình dạng đó |

### 3.4 API-client — `packages/web-core/src/lib/auth-users-api.spec.ts`

Sửa fixture `USER_ROLE` theo hình dạng mới + assert `parse` **loại** `id`/`grantedBy`/`createdAt` nếu
server (cũ) còn gửi.

### 3.5 Đột biến — RED-proof phải ĐO, không dự đoán

Chạy trên lane DB riêng (`bash scripts/lane-db-setup.sh rolememberfe` → `export LANE_DB=mediaos_rolememberfe`).

| mã | đột biến | kỳ vọng |
| --- | --- | --- |
| **M-A** | `projectAssignResult` trả thẳng hàng gốc (revert D2) | O1·O2·U1·U2·U3 ĐỎ |
| **M-B** | chỉ chiếu ở nhánh no-op, hai nhánh kia trả `inserted` | **O2 ĐỎ, O1 XANH** ⇒ chứng minh O2 tự mang sức nặng |
| **M-C** | FE bỏ qua `complete` (luôn dedup) | F1 ĐỎ |
| **M-D** | server hard-code `complete: true` | S1 ĐỎ (không phải chỉ F1 — F1 nhận cờ từ fixture) |
| **M-E** | bỏ nhánh no-op, luôn delete+insert | O4 ĐỎ |

Con số ĐỎ/XANH thật **điền vào bảng này sau khi chạy**; plan không được ship với ô "kỳ vọng" chưa đối chiếu.

---

## 4. Ranh giới & nợ — đọc trước khi tin dấu gạch ngang trên KI-073

- **N-1 — V2 (`DELETE` 404 vs 204) KHÔNG đóng ở WO này.** `auth-users-api.ts:136` ghi rõ 404 là quyết
  định CÓ CHỦ Ý ("caller xử lý như lỗi rõ ràng, KHÔNG no-op ngầm"); đảo nó là lấy mất một tín hiệu vận
  hành đúng. **Ranh phân biệt có nguyên tắc:** V1 im lặng ở **mọi câu trả lời dương** (0 hàng forensic
  khi phát hiện một thành viên); V2 **ồn**: mỗi lần trúng đều ghi `RoleRevoked` + `user_security_events`
  **và thực sự gỡ vai của nạn nhân** (thiệt hại thật, phát hiện được). ⇒ đóng kênh im lặng, chấp nhận
  kênh có-dấu-vết. **Phải vào RELEASE-02 dưới một số hiệu RIÊNG** — đúng bài học KI-049/KI-071/KI-073:
  phần còn sống mà chỉ nằm dưới dạng văn xuôi trong một hàng đã gạch thì **vô hình với bug scrub**.
- **N-2 — kênh THỜI GIAN.** No-op = 0 ghi; fresh = insert + audit + security-event + outbox. Chênh lệch
  đo được. Không đóng (đóng = ghi giả). Cùng lớp `attribution-patch-creates-timing-oracle`.
- **N-3 — `Team`/`Department` ⇒ 0 hàng, lưới scope KHÔNG đơn điệu** (kế thừa N-1b của KI-071). `complete`
  cũng `false` ở đó ⇒ nhất quán, nhưng **không sàn hoá** — phải làm cho CẢ BA đường cùng lúc.
- **N-4 — ba bản sao `rowScopeFor`** (kế thừa KI-071). Không đụng.
- ⚠️ **Đừng đọc thành "tab Thành viên role đã kín".** WO này đóng V1 + V3. V2 còn sống dưới N-1.

---

## 5. Rollback

Code-only, **0 migration** ⇒ `git revert` PR là đủ. **Không có feature-flag** (một cờ tắt-thu-hẹp-thân
chính là lỗ hổng có công tắc). Lệch phiên bản BE/FE: BE mới + FE cũ ⇒ FE cũ parse thừa khoá → zod
**strip**, không vỡ; FE mới + BE cũ ⇒ **ZodError** vì thiếu `complete` (D4, CỐ Ý — nổ to hơn im lặng).
⇒ **thứ tự deploy: BE trước, FE sau.**

---

## 6. Thứ tự thi công

1. `harness/backlog.mjs` — mở rộng `paths` (D6) + ghi lý do.
2. **RED**: viết O1·O2·O3·O4·S1·U1–U3·F1·F2 trên cây CHƯA vá → chạy → **ghi lại ca nào đỏ**.
3. Contract: thu hẹp `userRoleSchema` (D2) + thêm `complete` vào `roleMemberListSchema` (D4).
4. BE: `projectAssignResult` (D7) + `complete` ở `listMembersInner`.
5. FE: `RoleMembersTab` theo D5 + i18n.
6. Chạy M-A…M-E, điền bảng §3.5.
7. `pnpm typecheck` + `pnpm lint` + `bash harness/check.sh --lane-db=rolememberfe`.
8. FULL gate `security-reviewer`; đo lại PROD (§0.4); RELEASE-02 đóng KI-073 + **cấp số mới cho N-1**.
