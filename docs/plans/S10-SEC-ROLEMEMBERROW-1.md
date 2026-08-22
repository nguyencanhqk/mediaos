# S10-SEC-ROLEMEMBERROW-1 — KI-071: `data_scope` chặn TẬP HÀNG của `GET /auth/roles/:id/members`

> Vùng đỏ (phân quyền). Plan viết TRƯỚC code theo CLAUDE.md §6.
> Bảng chạm: `user_roles` ⋈ `users` — chỉ đường ĐỌC, 0 migration.
> Điểm ĐÚC vị từ hàng thứ **BA** sau `S10-SEC-AUDITLOGROW-1` (KI-070) và `-2` (KI-072).
> Ranh giới CROWN: cặp bound (`view:user`) **TRÙNG** cặp gate ⇒ luật fail-closed, KHÔNG dùng luật
> fail-soft của tầng CỘT.

---

## 0. Số đo — ĐO LẠI 2026-08-22 (không chép số seed 21/08)

Câu đo BAO TRÙM (bài học K4 của KI-072: câu lọc đúng một cặp **theo cấu tạo không nhìn thấy** vai giữ
wildcard).

⚠️ **⟲R2 — bản nháp lọc `IN (('view','user'),('*','*'))` là SAI, thiếu hai hình dạng.**
`resolveStrongestScope.matches()` (`permission.service.ts:584-586`) là
`(action === a || action === '*') && (resourceType === r || resourceType === '*')` — **hai vế độc
lập** ⇒ có **BỐN** hình dạng khớp: `('view','user')` · `('view','*')` · `('*','user')` · `('*','*')`.
Câu cũ mù với hai hình dạng giữa, mà cả hai đều (a) qua được `assertCan` ở nhánh non-sensitive và
(b) **đóng góp `data_scope`** vào resolve ⇒ một vai chỉ giữ `view:*@Own` hôm nay thấy TRỌN danh sách và
sau vá còn 1 hàng — đúng cái hồi quy mà §0 tuyên bố là bất khả. Cùng lý do, **DENY ở BẤT KỲ hình dạng
nào** đẩy resolve về `null` (`permission.service.ts:589`) ⇒ 403 MỚI. Câu đo ĐÚNG:

```sql
SELECT p.action||':'||p.resource_type AS pair, p.is_sensitive, r.name AS role, rp.effect, rp.data_scope,
       (SELECT count(*) FROM user_roles ur JOIN users u ON u.id=ur.user_id
         WHERE ur.role_id=r.id AND ur.deleted_at IS NULL AND u.deleted_at IS NULL) AS holders_alive
FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id JOIN roles r ON r.id=rp.role_id
WHERE p.action IN ('view','*') AND p.resource_type IN ('user','*');
```

**Đã chạy câu ĐÚNG (22/08):** trả về **đúng 6 hàng dưới đây** — `('view','*')` và `('*','user')`
**không tồn tại** như grant nào ⇒ kết luận không đổi, nhưng câu đo thì phải đúng cho lần đo lại.

| cặp | vai | effect | data_scope | người giữ (sống) |
| --- | --- | --- | --- | --- |
| `view:user` | `SA` | ALLOW | **Company** | 2 _(10 hàng `user_roles`, 8 đã soft-delete)_ |
| `view:user` | `QUẢN LÝ CẤP CAO` | ALLOW | **Company** | 4 |
| `view:user` | `company-admin` | ALLOW | **Company** | 2 |
| `view:user` | `hr` | ALLOW | **Company** | **0** |
| `*:*` | `SA` | ALLOW | Company | 2 |
| `*:*` | `QUẢN LÝ CẤP CAO` | ALLOW | Company | 4 |

- Phân bố `data_scope` trên **cả bốn hình dạng**: **`{Company: 6}`**, **0 hàng DENY** (ở mọi hình dạng
  — điều kiện của "0 403 mới"), 0 giá trị ngoài `{Own,Team,Department,Company,System}` ⇒ **không có K3**
  hôm nay.
- Hai vai giữ `*:*` **đều CÓ LUÔN** `view:user` exact @Company ⇒ vai có wildcard mà thiếu cặp exact =
  **0**.
- Bề mặt: `user_roles` sống = **57 hàng** / 5 role / 47 user.

**⟲R1 — cơ chế wildcard, phát biểu ĐÚNG** (bản nháp ghi sai, sửa sau plan-review): `resolveStrongestScope`
tính `effectivelySensitive = (opts?.isSensitive ?? false) || allowMatches.some(g => g.isSensitive)`
(`permission.service.ts:598`) — quyết định bởi `is_sensitive` của **CÁC GRANT KHỚP**, KHÔNG phải của cặp
được hỏi. Đo bổ sung 22/08: **`permissions('*','*').is_sensitive = false`** và
**`permissions('view','user').is_sensitive = false`** ⇒ vai chỉ-giữ-`*:*` **resolve được** cặp này (khác
`view:audit-log`). Vì thế câu đo bao trùm ở đây **bắt buộc**, không phải phòng xa.

⚠️ **Hệ quả cho người CẤP QUYỀN sau này** (ghi vào RELEASE-02): non-sensitive ⇒ `exact` **thắng**
`wildcard` (`permission.service.ts:606-607`). Cấp `view:user@Own` cho một vai đang giữ `*:*@Company` sẽ
**HẠ** vai đó xuống `Own` — và sau bản vá điều đó cắt luôn **TẬP HÀNG**, không chỉ cột. Trước WO này
hành vi đó chỉ mất email/tên.

**Kết luận:** **0 vai** chạm được lỗ hôm nay ⇒ bản vá đóng lỗ **TIỀM TÀNG**, **0 hồi quy dự kiến** trên
PROD. Số này **ĐO LẠI ngay trước khi mở PR**; RELEASE-02 đóng KI-071 bằng số đo LÚC ĐÓ.

**Chỗ dựa "0 hồi quy" ở tầng TEST:** `seedRolePermission` mặc định `dataScope='Company'`
(`apps/api/test/helpers/seed.ts`) và cột `role_permissions.data_scope` `notNull().default("Company")`
⇒ mọi suite đang gọi route này đều @Company ⇒ bản vá không cắt hàng của suite nào **trừ** ca A2/A3 của
`identity-projection-scope.int-spec.ts`, vốn CỐ Ý ghim hành vi cũ (xem §3.1 — đó là ca RED, không phải
hồi quy).

### 0.1 Khẳng định đã XÁC MINH trên cây (không suy đoán)

| khẳng định | xác minh | kết quả |
| --- | --- | --- |
| `listRoleMembersTx` có ĐÚNG 1 call-site | `grep -rn listRoleMembers apps/api/src apps/api/test` | ĐÚNG — `role-admin.service.ts:156`. 0 test gọi thẳng |
| Route KHÔNG có `count`/pagination | `roleMemberListSchema` = `{ members: [] }` | ĐÚNG ⇒ **không có vế V3** (khác KI-070/072) |
| Gate = `view:user`, non-sensitive | `role-admin.controller.ts:52` + `assertCan(...,false)` + `permissions.is_sensitive = f` | ĐÚNG |
| `mapError` KHÔNG nuốt 403 | `role-admin.service.ts:736` `if (err instanceof HttpException) return err` | ĐÚNG |
| `PermissionModule` đã có `DataScopeService` | `role-admin.service.ts` đã inject sẵn cho KI-053 | ĐÚNG — **0 sửa module** |
| `enclosing()` chỉ nhận MethodDeclaration | `identity-projection-census.ts` | ĐÚNG ⇒ mint phải là **method**, không phải arrow property |
| ⟲R1 Kill-switch **KHÔNG** mở được route này | `permission.guard.ts:62-72` fail-open, nhưng `assertCan` gọi thẳng `permissionService.can()` (`role-admin.service.ts:713-731`) — **không đọc cờ** | ĐÚNG — route có **cổng THỨ HAI**; xem D4 (danh sách K sửa lại) |
| ⟲R1 FE **CÓ** phụ thuộc tập hàng đã-scope | `RoleMembersTab.tsx:91` `memberIds` → `:383-384`, `:489-490` | **SAI câu "FE (0)" của bản nháp** — xem D12 |
| ⟲R1 `permissions('*','*').is_sensitive` | đo PROD 22/08 | `false` — xem §0 |

---

## 1. Khuyết tật — phát biểu chính xác

**V1 — tập hàng không có vị từ scope.** `PermissionAdminRepository.listRoleMembersTx`
(`role-admin.repository.ts:142`) nhận `identity: IdentityGrant` BẮT BUỘC (tầng bound-CỘT, KI-053) và
chiếu `userId · identityInScope · email · fullName · status · expiresAt · grantedAt`, nhưng `where` =
`roleId` + `companyId` + `notDeleted` + chưa-hết-hạn — **0 vị từ scope**. Vai giữ `view:user@Own` mất
email/họ tên nhưng **vẫn biết ai thuộc role nào** (`userId` + `status` + `expiresAt` của MỌI thành
viên). `withTenant` + RLS chặn CHÉO TENANT, không chặn TRONG tenant.

**KHÔNG có vế V2** (`filter` từ query param): route không nhận filter nào — chỉ `:id` của role.
**KHÔNG có vế V3** (`count`): contract không có `total`. Nói ra để không ai đi tìm hai vế đó rồi kết
luận nhầm là plan bỏ sót — đây là điểm bản vá này HẸP HƠN KI-070/072, không phải điểm nó cẩu thả.

---

## 2. Quyết định thiết kế

### D1 — Bound HÀNG, KHÔNG "trần scope Company-only"

Cùng lý do D1 của KI-070: trần scope là một luật ở tầng CẤP QUYỀN, nó không tồn tại thành dòng code
trên đường đọc ⇒ đúng lớp lỗi mà KI-054 tố cáo. Vá ở đường đọc.

### D2 — Ngữ nghĩa `Own` — PHÁT BIỂU TRƯỚC KHI DỰNG VỊ TỪ

Hàng ở đây là một **tư cách thành viên** (`user_roles`), và cột NGƯỜI của hàng là **THÀNH VIÊN**
(`users.id` qua inner join). ⇒

> **`Own` = "hàng NÓI VỀ tôi"** — tức tư cách thành viên của CHÍNH TÔI trong role này.

Cùng họ với `login_logs` (KI-070, `Own` = hàng về tôi), **KHÁC** `audit_logs` (KI-072, `Own` = hàng do
tôi GÂY RA). Ở bảng này **không có** cột "người gây ra" trong chiếu hiện tại nên không có chiều thứ hai
để nhầm — nhưng ngữ nghĩa vẫn phải được PHÁT BIỂU, không được suy ra từ việc "chỉ có một cột dùng
được".

Hệ quả CÓ CHỦ Ý:

- `view:user@Own` gọi role mình có chân ⇒ **đúng 1 hàng** (chính mình).
- `view:user@Own` gọi role mình KHÔNG có chân ⇒ **0 hàng, HTTP 200**, KHÔNG 404. Sự tồn tại của role
  do `findRoleByIdTx` quyết (tài nguyên _role_), không do scope thành viên quyết — biến "0 thành viên
  trong scope" thành 404 là đẻ oracle "role này có/không có bạn trong đó".

### D3 — Vị từ dựng bằng `buildUserScopeConditionOn`, trên `users.id`/`users.companyId`

TÁI DÙNG lattice (không viết bản thứ tư). Cột đích =
**`{ idCol: users.id, companyIdCol: users.companyId }`** — ĐÚNG cặp cột mà tầng CỘT đang dùng, và đó là
chủ đích: cột NGƯỜI của hàng là thành viên.

⚠️ `rowScopeSql` chỉ assert TÊN BẢNG. `users.id` và `users.companyId` **cùng thuộc `users`**, nên nhầm
`idCol → users.companyId` đi LỌT cổng đó và biến `Own` thành `company_id = <uuid người dùng>` (0 hàng,
im lặng). Cái bắt được: ca **ALLOW `Own`** (§3.2 R-A2) và **U1** — không phải `rowScopeSql`.

Vì sao KHÔNG dùng `userRoles.userId`/`userRoles.companyId` (tương đương về SQL nhờ inner join +
`eq(userRoles.companyId, companyId)` đã có): grant của tầng CỘT nói về bảng `users`; để hai grant nói
về HAI bảng khác nhau trong cùng một truy vấn là mời gọi đúng lớp nhầm mà
`identityColumns`/`rowScopeSql` tồn tại để bắt, đổi lại 0 lợi ích ngữ nghĩa.

### D4 — Cặp gate = cặp bound ⇒ **fail-closed**, và pair chỉ phân giải MỘT LẦN/request

Docstring của chính `resolveOrNull` viết: _"đừng dùng hàm này cho route mà cặp gate = cặp bound (ở đó
`resolveAndAssert` mới đúng, vì `null` nghĩa là guard đã hỏng)"_. Route này ĐÚNG hình dạng đó.

Thi công (soi gương `AuditQueryService.rowScopeFor`, giữ D11 của KI-070 — **phân giải mỗi cặp ĐÚNG MỘT
LẦN/request**):

```text
scope = resolveOrNull(actor.id, actor.companyId, "view", "user")            // MỘT lần
if (scope === null) { logger.error(K1|K2|K3 …); throw Forbidden(NGUYÊN VĂN) }   // fail-closed
rowScope = rowScopeFor(scope, actor)           // basis "scoped-predicate"  → WHERE
identity = fromScope(…, "identity-gated", …)   // KI-053, giữ nguyên        → CASE WHEN
```

- ⚠️ **KHÔNG truyền `opts`** — `resolveOrNull(actor.id, actor.companyId, "view", "user")` cố ý không
  kèm `{ isSensitive: true }`, soi gương `@RequirePermission("view","user")` (không cờ) + `assertCan(…,
  false)`. Ai copy khuôn `audit.service.ts:104-110` rồi thêm `{isSensitive:true}` sẽ **403 mọi vai
  wildcard trong im lặng** (`effectivelySensitive` ⇒ chỉ grant EXACT hợp lệ). Đây là dòng dễ copy sai
  nhất của cả bản vá.
- Chuỗi 403 giữ **NGUYÊN VĂN** `"AUTH-ERR-FORBIDDEN: out of permission scope"` của `resolveAndAssert`
  ⇒ trùng `status`/`code`/`type` với 403 của guard, **khác `message`**. ⟲R1 — phát biểu đúng mức: route
  này **đã có ba** chuỗi 403 khác nhau (`permission.guard.ts:140` `Permission denied: …`;
  `role-admin.service.ts:730` `Insufficient permission: view:user`; và chuỗi này). Cái bị cấm KHÔNG phải
  "có thêm một chuỗi" mà là **làm message giàu thông tin hơn** ("scope resolution failed", tên cặp, tên
  bảng) — đó mới là oracle.
- `resolveOrNull` + log + throw (thay vì gọi thẳng `resolveAndAssert`) vì `resolveAndAssert` **không
  log** ⇒ mất khả năng phân biệt K2/K3/K4 khi trực ca. Đúng lựa chọn của cả hai WO trước.

**HỆ QUẢ CÓ TÊN — phải đọc, đây là thay đổi hành vi DUY NHẤT ngoài tập hàng:** nhánh fail-soft
`scope === null ⇒ BỎ cột danh tính, vẫn trả hàng` của KI-053 trở nên **KHÔNG THỂ VỚI TỚI** (tầng hàng
đã ném 403 trước) ⇒ **gỡ bỏ** thay vì để lại code chết. Đây là **SIẾT**, không phải hồi quy:

- không phải nới quyền cho ai;
- 0 test nào đang phủ nhánh đó (đã kiểm: `uNoDir` của int-spec không dùng cho route này — thiếu
  `view:user` thì nó dừng ở `assertCan`, không tới được nhánh).

**⟲R1 — danh sách nguyên nhân 403, SỬA LẠI (bản nháp chép nhầm từ KI-070/072):**

| mã | nguyên nhân | có với tới route NÀY không |
| --- | --- | --- |
| ~~K1~~ | kill-switch `PERMISSION_GUARD_ENABLED=false` | **KHÔNG** — guard fail-open (`permission.guard.ts:62-72`) nhưng service còn cổng THỨ HAI `assertCan` gọi thẳng `permissionService.can()` (`:713-731`), **không đọc cờ** ⇒ vai không có grant vẫn dừng ở 403 CŨ, không tới được nhánh scope. Khác KI-070/072 (route chỉ có guard) |
| **K2** | cửa sổ cache guard 300s: grant/role bị **GỠ**, ⟲R2 **hoặc** một hàng **DENY được THÊM**, trong khi `can()` còn phục vụ tập allow cũ (`permission.cache.ts:52-89`) | CÓ — nhưng quyền đã đổi THẬT ⇒ 403 là ĐÚNG. Hai chiều cho ra CÙNG một 403 nhưng KHÁC câu chuyện cho người trực ca ⇒ log phải nêu cả hai |
| **K3** | `data_scope` trong DB không chuẩn hoá được ⇒ fail-closed **VĨNH VIỄN** | CÓ — hôm nay 0 hàng (đã đo §0) |
| **K4** ⟲R1 | lỗi HẠ TẦNG trong `resolveStrongestScope` — `catch` bắt MỌI exception rồi trả `null` (`permission.service.ts:624-633`), trong khi `can()` có thể phục vụ **hoàn toàn từ cache Valkey** (`permission.cache.ts:52-89`; `getCompanyRoleGrantsWithScope` là passthrough **KHÔNG cache**, `:95-100`) | CÓ — **mới**: một timeout riêng ở câu scope biến "200 + che cột" của hôm nay thành **403**. Đây là cái giá thật của D4, phải nói ra chứ không giấu |

Log của bản vá liệt kê **K2·K3·K4** (không K1) và bảo đối chiếu dòng
`resolveStrongestScope() infrastructure error` cùng request — nó CỐ Ý không chẩn đoán hộ một nguyên
nhân. Ghi vào RELEASE-02 như một dòng riêng, không lẫn vào mô tả tập hàng.

### D5 — HAI grant CÙNG KIỂU ⇒ truyền bằng **OBJECT CÓ TÊN**, không phải hai tham số vị trí

`listRoleMembersTx` sẽ nhận cả `rowScope` lẫn `identity`, **cùng kiểu `IdentityGrant`** ⇒ hai tham số
vị trí liền nhau hoán đổi được mà typecheck xanh. Chữ ký mới:

```ts
listRoleMembersTx(tx, companyId, roleId, grants: { rowScope: IdentityGrant; identity: IdentityGrant })
```

Hoán đổi vẫn bị `rowScopeSql` ném (basis `identity-gated` ≠ `scoped-predicate`) — nhưng đó là hàng rào
THỨ HAI; hàng rào thứ nhất là không viết ra được chỗ để nhầm. Đổi chữ ký ⇒ call-site duy nhất ĐỎ
typecheck nếu quên.

### D6 — Điểm đúc THỨ BA là bản sao gần giống, **CỐ Ý KHÔNG** trích helper dùng chung

Docblock `ROW_SCOPE_MINT_PINS` đã ghi trước: _"Khi KI-071 thêm điểm THỨ BA thì đó mới là lúc cân nhắc
lại, ở một WO riêng."_ ⇒ WO này **thêm điểm thứ ba và ghi nợ**, không trích. Trích ở đây là refactor
CROWN chạm hai đường đã nghiệm thu, VÀ nó gộp ba bề mặt vào một điểm đúc ⇒ ratchet (pin theo DANH
SÁCH) mất khả năng nhìn thấy từng bề mặt.

Khai bằng **cú pháp method** `private rowScopeFor(...)` — census `enclosing()` chỉ nhận
`MethodDeclaration`/`FunctionDeclaration`; arrow property trả `"?"` ⇒ pin ĐỎ dù đã ký đúng chuỗi.

### D7 — Tầng CỘT GIỮ NGUYÊN, nhưng khả-quan-sát của nó trên route này bị **BAO TRÙM** — nói thẳng

Vị từ hàng và vị từ cột ở route này là **CÙNG MỘT SQL** trên cùng cặp cột ⇒ sau bản vá, mọi hàng trả về
đều trong scope ⇒ `identityInScope` **luôn true**, nhánh `case when … else null` không bao giờ rẽ.

- **Giữ** tầng cột: (a) gỡ nó là chạm bề mặt KI-053 đã nghiệm thu; (b) nếu nợ **N-1b** (sàn hoá
  Team/Department) sau này nới vị từ HÀNG mà không nới vị từ CỘT, hai tầng lại tách ra; (c) khử ở SQL
  vẫn là chế độ hỏng ỒN ÀO nếu ai đó bỏ bước xoá khoá ở service.
- **KHÔNG** được viết vào docblock/RELEASE rằng route này còn "hai lớp độc lập" — nó là một lớp + một
  lớp dự phòng bị bao trùm. Bằng chứng ĐỘC LẬP của cơ chế CỘT sống ở `login-logs`/`security-events` (ca
  B\*/C\*), nơi hai vai có vị từ THẬT SỰ khác nhau.
- Hệ quả cho test: ca **A2** hiện ghim "3 hàng, 2 hàng bỏ khoá" **phải đổi** — xem §3.1. Và hai dòng
  `IDENTITY_VERDICTS` của chính route này (`identity-projection-verdicts.ts:458,465`) phải được phụ đề
  — để nguyên là sổ phán quyết ĐÃ KÝ tiếp tục mô tả route này là bề mặt bound-CỘT-only, đúng cách đọc
  mà gạch đầu dòng trên vừa cấm (§4 mục 3).

**⟲R1 — hệ quả thi công của việc GIỮ hai tầng: `buildUserScopeConditionOn` được gọi HAI LẦN với tham
số GIỐNG HỆT NHAU.** Đây là chủ ý (giữ hai tầng tách rời cho nợ N-1b), nhưng nó đẻ ra hai thứ phải xử
lý tường minh, nếu không plan tự lừa mình:

1. **Ca unit assert bằng `toHaveBeenCalledWith` là XANH-RỖNG** — nó xanh nếu BẤT KỲ lời gọi nào khớp,
   nên đột biến chỉ sửa cột ở tầng HÀNG vẫn xanh nhờ lời gọi tầng CỘT còn nguyên. Xem §3.3 (U1/U2 đã
   viết lại).
2. `Team`/`Department` ⇒ `logger.warn` của `data-scope.service.ts:270-278` bắn **HAI dòng** cùng payload
   cho MỘT request. Chủ ý, ghi ở docblock để người đọc log không tưởng hai sự kiện.

### D8 — KHÔNG rename `listRoleMembersTx` thành `*Unscoped*`

KI-072 phải rename vì `AuditRepository` có hộ tiêu thụ KHÔNG-bound **hợp lệ** (operator `/all`, hai
module ATT/LEAVE có cặp quyền riêng) ⇒ họ không-bound phải còn public và phải PIN. Ở đây: **1
call-site, 0 đường không-bound hợp lệ** ⇒ không có họ thứ hai để nhầm, và tham số `IdentityGrant` BẮT
BUỘC (brand không dựng được bằng literal) làm việc quên = ĐỎ typecheck. Thêm một `UNSCOPED_*_PINS` cho
một bảng không có hộ tiêu thụ nào là ratchet rỗng.

⚠️ **⟲R1 — đừng đọc câu trên mạnh hơn thực tế.** Brand bắt được "caller **quên TRUYỀN**"; nó **KHÔNG**
bắt được "repo nhận rồi **quên DÙNG**" — một `listRoleMembersTx` nhận `grants.rowScope` mà không AND nó
vào `where` là **hợp kiểu và xanh tuyệt đối**. Lớp bắt chiều đó là **M-A + R-D1/R-T1**, không phải tầng
kiểu. (Cùng lớp cận-dưới mà `rowScopeSql` đã tự khai ở docblock của nó.)

### D12 ⟲R1 — FE **CÓ** phụ thuộc tập hàng này, và nó là phụ thuộc GHI. Bản nháp ghi "FE (0)" là SAI

`RoleMembersTab.tsx:91` dựng `memberIds = new Set(members.map(m => m.userId))` từ **danh sách đã bị
scope**, rồi dùng nó cho: bộ đếm "N thành viên" (`:117`), khoá hàng "đã là thành viên" trong dialog Thêm
người (`:339-345`), và **`toAssign`/`alreadyMembers` của batch Thêm-theo-phòng-ban** (`:383-384`) +
**theo-chức-vụ** (`:489-490`).

⇒ Sau bản vá, một actor giữ `assign-role:user@Company` **cộng** `view:user@Own` (hoặc `@Team` ⇒ 0 hàng)
nhận `memberIds` gần-rỗng ⇒ batch **gán lại vai trò cho người đã là thành viên** (loạt 409) và bộ đếm
nói dối.

**⟲R2 — hệ quả NẶNG HƠN "409 ồn ào": đây là một ORACLE ĐỌC nằm trên đường GHI.** `AddOrgUnitDialog` /
`AddPositionDialog` chạy batch rồi render kết quả **từng người** (`BatchResultList`). Vai giữ
`assign-role:user@Company` + `view:user@Own` chạy batch và đọc item nào xung đột ⇒ **dựng lại đúng tập
thành viên mà bản vá vừa giấu**. Phạm vi đúng của nó:

- **KHÔNG có leo thang quyền.** Cặp GHI là cặp RIÊNG (`assign-role:user`, sensitive), gate BE ở
  `POST /permissions/users/:userId/roles`, gate FE `PermissionGate ASSIGN_ROLE`
  (`RoleMembersTab.tsx:124-127`) ⇒ chỉ vai vốn đã được phép GÁN role mới dựng lại được tập đó.
- **Oracle tồn tại ĐỘC LẬP với FE** — nó nằm ở mã trả về của API ghi, không ở màn hình. Vá FE không
  đóng nó.

**CHỐT (không im lặng nhận):** WO này **KHÔNG** sửa FE — `paths` của WO không có `apps/app/**`, và vá
đúng cách (gate ba dialog bằng `useCanExact` + điều kiện scope) là một WO FE riêng. Nhưng lập luận "màn
hình không đổi" là lập luận theo **DỮ LIỆU**, không theo **CODE**, trong khi mục đích của chính WO này
là làm `view:user@Own` thành cấu hình **cấp được** ⇒ coupling này đi vào §7 **và** RELEASE-02 kèm cả hai
vế trên. ⚠️ Đặc biệt: RELEASE-02 **không được** gạch KI-071 thành *"không còn lộ membership"* — đúng
phát biểu là *"đường ĐỌC đã bound hàng; một oracle TRONG-tenant qua mã lỗi của đường GHI vẫn còn, cho
riêng vai giữ `assign-role:user`"*.

### D9 — `ORDER BY` không đổi một ký tự

Hiện sắp theo `lower(<cột email ĐÃ CHE>)` rồi `users.id` (KI-053 + đính chính citext). Sau bản vá mọi
hàng trả về đều trong scope ⇒ `email` không bao giờ null ⇒ thứ tự không rò gì thêm. Không "dọn dẹp" nó
trong WO này.

### D10 — Lưới scope KHÔNG đơn điệu — KẾ THỪA, không vá lén

`Team`/`Department` ⇒ vị từ `false` ⇒ **0 hàng**, tức HẸP HƠN `Own`; giữ đồng thời `@Own` + `@Team` ⇒
`resolveStrongestScope` lấy max ⇒ ra `Team` ⇒ **MẤT** hàng. Sai về phía HẸP (không bao giờ về phía rò).
Sàn hoá là nợ **N-1b**, phải làm cho CẢ BA đường cùng lúc — cấm vá riêng ở đây. Ghim bằng ca **R-T1**.

### D11 — `withTenant` + RLS giữ nguyên là vành đai NGOÀI

Vị từ scope là vành đai TRONG-tenant. Không được đọc bản vá này thành "nay không cần `withTenant`".

### Đường đã LOẠI (đừng mở lại)

- **Guard tự phơi `data_scope` ra request** — handler vẫn TỰ CHỌN dùng hay không; thêm một thứ TUỲ CHỌN
  không biến bug im lặng thành bug ồn ào (đã loại từ KI-053).
- **403 khi `Own` gọi role mình không có chân** — oracle tồn-tại (D2).
- **Trích `rowScopeFor` dùng chung ba nơi** — D6.
- **Nới `Own` thành "role tôi có chân ⇒ thấy hết thành viên"** — đó là ngữ nghĩa `membership`, không
  phải `data_scope`; nó biến tập hàng thành hàm của việc AI GÁN ROLE cho ai, không luật nào kiểm được.

---

## 3. Vế RED — viết TRƯỚC, phải ĐỎ trên cây hôm nay

### 3.1 Ca CŨ ghim lỗ MỞ — phải sửa, và việc sửa chính là vế RED

`apps/api/test/integration/identity-projection-scope.int-spec.ts`:

- **A2** hôm nay assert `rows.length === 3` kèm comment _"Tập HÀNG không đổi — vá bound CỘT, không bound
  HÀNG"_. Đó là ca **ĐANG GHIM LỖ MỞ** (memory `tests-can-pin-a-hole-open`). Sau bản vá nó phải đọc **1
  hàng**. Đây là bằng chứng RED mạnh nhất của WO: ca cũ ĐỎ là điều kiện đủ để nói vị từ có hiệu lực.

  ⚠️ **⟲R1 — sửa `length` KHÔNG đủ, phải XOÁ khối lặp.** A2 còn
  `for (const r of rows.filter(x => x.userId !== uOwn)) { expect("email" in r).toBe(false); … }`
  (`identity-projection-scope.int-spec.ts:249-252`). Với 1 hàng (chính `uOwn`) filter trả **RỖNG** ⇒ hai
  `expect` **không bao giờ chạy**, ca vẫn XANH và vẫn _đọc như_ đang chứng minh tầng CỘT — một vòng lặp
  0 vòng, đúng khuôn `tests-can-pin-a-hole-open` ở chiều thứ hai. **XOÁ** khối đó, thay bằng
  `expect(rows.map(r => r.userId)).toEqual([uOwn])`, kèm comment trỏ sang B\*/C\* là nơi bằng chứng ĐỘC
  LẬP của cơ chế CỘT còn sống (D7).

- **A3** assert `rows.length === 3` như neo chống-xanh-rỗng ⇒ đổi sang `1`, giữ nguyên vế
  `identityInScope` không rò (vẫn có nghĩa).
- **A1** (`@Company` thấy đủ 3 + đủ 3 email) **giữ nguyên** — nó là ca ALLOW đối chứng, và sau bản vá nó
  là thứ duy nhất phân biệt "vá đúng" với "route hỏng".

### 3.2 Ca MỚI — int-spec (DB thật, `hasDb && LANE_DB`)

Thêm vào chính khối role-members của file trên (fixture 3 thành viên + actor `Own`/`Company` đã có sẵn;
dựng file thứ hai là nhân bản seed):

| ca | nội dung | ĐỎ trước vá? |
| --- | --- | --- |
| **R-D1** | `view:user@Own` (có chân trong `roleUnderTest`) ⇒ **đúng 1 hàng**, `userId` = chính mình | ✅ (nay 3) |
| **R-D2** | `view:user@Own` ⇒ KHÔNG có hàng nào của `uOther`/`uCompany` — assert theo `userId` (`toEqual([uOwn])`), KHÔNG theo số đếm | ✅ |
| **R-D3** | `view:user@Own` gọi **`roleOther`** (role mình KHÔNG có chân) ⇒ **200 + 0 hàng**, KHÔNG 404/403 (D2) | ✅ (nay thấy đủ 2 thành viên) |
| **R-A1** | `view:user@Company` gọi `roleUnderTest` ⇒ đủ **3** hàng + đủ 3 `email` _(= A1 cũ, giữ)_ | ❌ (phải XANH cả trước lẫn sau) |
| **R-A2** | `view:user@Own` ⇒ hàng của CHÍNH MÌNH có mặt VÀ còn khoá `email` — bắt nhầm `idCol → companyId` (D3) và bắt hồi quy "siết quá tay thành 0 hàng" | ❌ |
| **R-A3** ⟲R1 | `view:user@Company` gọi **`roleOther`** ⇒ đúng **4** hàng, đúng 4 `userId` (gồm `uTeam` + `uDept`) — **đối chứng ALLOW của R-D3 VÀ neo chống-rỗng của R-T1/R-T2** | ❌ |
| **R-T1** | `uTeam` giữ `view:user@Team`, **LÀ thành viên** của `roleOther`, gọi `roleOther` ⇒ **0 hàng, HTTP 200** | ✅ (nay 4) |
| **R-T2** ⟲R1 | `uDept` giữ `view:user@Department`, **LÀ thành viên** của `roleOther`, gọi `roleOther` ⇒ **0 hàng, HTTP 200** | ✅ (nay 4) |
| **R-G1** | KHÔNG có `view:user` ⇒ **403** (bản vá không nới route) | ❌ |
| **R-X1** ⟲R2 | actor tenant A gọi `:id` của role thuộc tenant B ⇒ **404** — bất biến #1 ở tầng HTTP cho chính route này (trước nay CHƯA có ca) | ❌ |

⚠️ **R-A1 + R-A2 + R-A3 là điều kiện tồn tại của mọi ca DENY** (memory
`deny-cases-vacuous-without-allow-case`): thiếu chúng thì "0/1 hàng" không phân biệt được với "route
hỏng".

**FIXTURE — ràng buộc BẮT BUỘC** (thiếu bất kỳ cái nào là ca xanh-RỖNG):

1. **`roleOther` có 4 thành viên THẬT**: `uCompany` · `uOther` · **`uTeam`** · **`uDept`** — **KHÔNG**
   `uOwn`. Bản nháp chỉ viết "role thứ hai (không có `uOwn`)" ⇒ "200 + 0 hàng" của R-D3 không phân biệt
   được với "role chưa seed thành viên nào", và cột "ĐỎ trước vá ✅" **sai** vì trước vá nó cũng 0 hàng.
2. **⟲R2 — `uTeam`/`uDept` PHẢI là thành viên của chính role chúng gọi.** Bản R1 để hai actor đó ngoài
   mọi role ⇒ R-T1/R-T2 xanh-RỖNG: người **không có chân** thì `Own` cũng cho 0 hàng, nên "0 hàng" KHÔNG
   phân biệt được nhánh `default: false` (`data-scope.service.ts:258-279`) với nhánh `Own` (`:256-257`)
   ⇒ mệnh đề D10 ("`Team` HẸP HƠN `Own`") và cái pin cho nợ N-1b **không được ca nào chứng minh**. Cho
   chúng LÀ thành viên thì "0 hàng" mới mang tin: hàng của chính họ **tồn tại** (R-A3 nhìn thấy) mà họ
   vẫn không đọc được — đó đúng là nghịch lý D10, đo được.
3. **Helper `grant()` của int-spec phải nới kiểu** `"Own" | "Company"` → thêm `"Team" | "Department"`
   (`identity-projection-scope.int-spec.ts:104-115`); `seedRolePermission` đã hỗ trợ đủ 5 giá trị
   (`test/helpers/seed.ts:301`).
4. **⟲R2 — helper `roleMembers()` hard-code `roleUnderTest`** (`:125-128`) ⇒ phải nhận thêm tham số
   `roleId`. Quên là R-D3/R-A3/R-T1/R-T2 lặng lẽ gọi nhầm role và R-D3 hoá thành bản sao của R-D1 —
   **vẫn xanh**.
5. **TUYỆT ĐỐI KHÔNG thêm actor mới vào `roleUnderTest`** — A1/R-A1 assert `rows.length === 3`; thêm
   người vào role đó làm chúng ĐỎ **vì sai lý do**. `uTeam`/`uDept` chỉ vào `roleOther`.

**⟲R2 — chéo-tenant: ĐÍNH CHÍNH một trích dẫn SAI của bản R1.** Bản R1 viết "chiều chéo-tenant đã có ca
ở `permission-soft-delete.int.spec.ts`" — **SAI**: file đó (`apps/api/src/permission/`, không phải
`test/integration/`) toàn ca tầng repository, **0 lời gọi HTTP** tới route này. Grep toàn repo: route có
ĐÚNG MỘT hộ gọi trong test — `identity-projection-scope.int-spec.ts:126`, **một tenant duy nhất**.
⇒ Không được để một trích dẫn sai đứng trong plan vùng đỏ. **Việc phải làm:** thêm ca rẻ **R-X1** —
actor tenant A gọi `:id` của role thuộc tenant B ⇒ **404** (`findRoleByIdTx` + RLS), ghim bất biến #1 ở
tầng HTTP cho chính route này. (Vị từ mới chỉ **thêm** vành đai `users.company_id = ctx.companyId` chồng
lên `eq(userRoles.companyId, companyId)` sẵn có — siết, không nới; nhưng "đã siết" phải có ca, không
phải có lời.)

### 3.3 Ca MỚI — unit spec (KHÔNG cần DB)

`apps/api/src/permission/role-admin.row-scope.spec.ts` — soi gương `audit.service.spec.ts` của KI-072,
bắt được đột biến **M-B** (nhầm cột) mà **không cần Postgres**. Đây là lớp DUY NHẤT bắt M-B trên máy
không có DB (int-spec `describe.skipIf(!hasLaneDb)`), nên nó phải thật sự bắt được.

⚠️ **⟲R1 — khuôn của KI-072 KHÔNG bê nguyên được sang đây.** `audit.service.ts` gọi
`buildUserScopeConditionOn` **một lần**; ở đây D7 làm nó được gọi **HAI lần với tham số giống hệt**
(tầng hàng + tầng cột). Hệ quả: capture kiểu ghi-đè (`captured.target = target`) giữ lời gọi **THỨ
HAI**, và `toHaveBeenCalledWith` xanh nếu **BẤT KỲ** lời gọi nào khớp ⇒ đột biến chỉ sửa cột ở tầng HÀNG
vẫn **XANH**. Cả U1 lẫn U2 phải viết theo kiểu **thu mọi lời gọi**:

- **U1** — `buildUserScopeConditionOn` được gọi **ĐÚNG 2 lần**, và **MỌI** lời gọi có tham số thứ ba
  thoả `target.idCol === users.id` **và** `target.companyIdCol === users.companyId` — so bằng **`toBe`
  (danh tính object)**, KHÔNG `toEqual`/`toHaveBeenCalledWith`: cột drizzle có tham chiếu vòng
  (`col.table → columns`) nên deep-equal vừa đắt vừa mong manh (memory
  `index-ratchet-must-pin-definition-not-name`). _(`toBe` trên cột drizzle đã có tiền lệ đang xanh:
  `audit.service.spec.ts:133-134`.)_

  ⚠️ **⟲R2 — `toHaveBeenCalledTimes(2)` là nửa CHỊU LỰC, phải nói ra vì sao.** Mệnh đề "mọi lời gọi có
  `idCol === users.id`" được thoả **bởi riêng lời gọi tầng CỘT** nếu tầng HÀNG **không đi qua lattice**
  (tự viết `eq(users.id, actor.id)`, hoặc gọi biến thể không-target `buildUserScopeCondition`
  `data-scope.service.ts:212-225` — một khoá mock KHÁC). Chỉ bộ đếm bắt được chiều đó. Nhưng §7 nêu hai
  refactor tương lai chắc chắn làm đổi bộ đếm ⇒ người sau sẽ bị dụ **nới** nó. **Lớp chịu lực thật (viết
  cả hai, đừng chỉ viết bộ đếm):** cho mock trả **SQL KHÁC NHAU mỗi lời gọi** (sentinel theo `idCol`),
  rồi assert `grants.rowScope.cond` **chính là** giá trị trả về của lời gọi có
  `target.idCol === users.id` — mệnh đề này sống sót refactor, bộ đếm ở lại làm lớp phụ kèm comment nói
  vì sao nó tồn tại.
- **U2** — **MỌI** lời gọi có `ctx.userId === actor.id` và `ctx.companyId === actor.companyId` — bắt đột
  biến **M-Q** của KI-072 (truyền nhầm `companyId` vào `userId`), thứ mà ca chỉ bắt tham số thứ ba
  **không** thấy.
- **U3** — `scope === null` ⇒ **ném `ForbiddenException`** và **KHÔNG** chạm repo (`listRoleMembersTx`
  không được gọi lần nào) + có `logger.error`. ⟲R1 **Đo ở `listMembers()`**, không đo ở helper: theo D4
  cú ném nằm ở `listMembersInner` (nơi resolve), không nằm trong `rowScopeFor` — assert trên helper sẽ
  đo nhầm chỗ. Ca này cũng ghim luôn "403 đi qua `mapError` nguyên vẹn" (không hoá 500).

  ⚠️ **⟲R2 — U3 phải phân biệt HAI nguồn 403, nếu không nó xanh-RỖNG.** `listMembers()` ném Forbidden ở
  `assertCan` (`role-admin.service.ts:714-732`) **hoặc** ở nhánh scope mới; ca "rejects Forbidden + repo
  không được gọi" **xanh cả khi nhánh mới không tồn tại** nếu `permissionService.can()` bị mock
  `{allow:false}` (hoặc quên mock). Bắt buộc: mock `can()` → **`{allow:true}`**, assert `resolveOrNull`
  **đã được gọi** (bằng chứng đã qua cổng thứ nhất), và giữ assert `logger.error` là **BẮT BUỘC** — nó
  là thứ DUY NHẤT phân biệt hai nguồn.

- ⚠️ **⟲R2 — đọc `mock.calls` TRƯỚC mọi `mockRestore()`** (memory `mockrestore-wipes-mock-calls`); spec
  của KI-072 đã ghi bài học này (`audit.service.spec.ts:157`).
- **U4** — grant truyền vào repo: `rowScope.basis === "scoped-predicate"`,
  `identity.basis === "identity-gated"` — bắt ca hoán đổi hai grant (D5).

### 3.4 RED-proof phải ĐO, không phải dự đoán

Trước khi mở PR, chạy **hai đột biến** và ghi số ĐỎ/XANH THẬT vào RELEASE-02:

- **M-A** — THAY `rowScopeSql(...)` bằng vị từ `true` trong `where` (⚠️ **THAY**, không XOÁ khỏi mảng
  điều kiện: xoá làm `and()` hụt phần tử, dễ thành `WHERE false` ⇒ ca DENY xanh-RỖNG).
- **M-B** — `idCol: users.id` → `users.companyId` (thứ `rowScopeSql` **không** bắt được, D3).

---

## 4. Thi công — theo file

1. **`apps/api/src/permission/role-admin.repository.ts`** — `listRoleMembersTx` đổi tham số thứ tư
   thành `grants: { rowScope: IdentityGrant; identity: IdentityGrant }`; `where` thêm
   `rowScopeSql(grants.rowScope, users.id)`; `identityColumns(grants.identity, …)` giữ nguyên. Docblock
   ghi rõ **hai** căn cứ và vì sao chúng không gộp (D7).
2. **`apps/api/src/permission/role-admin.service.ts`** — `listMembersInner`: một lần `resolveOrNull` →
   fail-closed 403 (D4) → `this.rowScopeFor(scope, actor)` (method MỚI, D6) →
   `fromScope(…, "identity-gated", …)` giữ nguyên → truyền object có tên. Gỡ nhánh `scope === null`
   fail-soft (D4, kèm docblock nói vì sao nó biến mất).
3. **`apps/api/test/foundation/identity-projection-verdicts.ts`** — (a) thêm mục thứ BA vào
   `ROW_SCOPE_MINT_PINS`: `"permission/role-admin.service.ts#rowScopeFor"`, kèm docblock trỏ tới
   int-spec làm bằng chứng deny/allow của chính bảng; cập nhật dòng "Đo 2026-08-…" và câu "khi KI-071
   thêm điểm thứ ba…" thành nợ CÓ TÊN (D6). (b) ⟲R1 **phụ đề `reason` của HAI dòng
   `IDENTITY_VERDICTS` `:458` + `:465`** (`listRoleMembersTx:users.email` / `:users.fullName`) — hôm nay
   chúng mô tả route này là bề mặt bound-CỘT-only; để nguyên là sổ đã KÝ tiếp tục nói sai (D7). Tiền lệ:
   KI-070 đã phụ đề `⟲ S10-SEC-AUDITLOGROW-1 …` vào mọi dòng bị ảnh hưởng (`:475`…`:509`).
   ⚠️ **`BASIS_CEILINGS` KHÔNG đổi** — vị từ HÀNG không phải điểm CHIẾU nên `collectIdentityPoints()`
   không đếm nó; nói ra để không ai sửa số oan.
4. **`apps/api/test/integration/identity-projection-scope.int-spec.ts`** — sửa A2 (**xoá khối lặp**,
   §3.1) + A3, thêm R-D1…R-G1 (§3.2), nới kiểu helper `grant()`, và fixture MỚI: `roleOther` với **≥2
   thành viên** (`uCompany` + `uOther`, không `uOwn`) + actor `@Team` + actor `@Department`.
5. **`apps/api/src/permission/role-admin.row-scope.spec.ts`** — mới (§3.3).
6. **`docs/permission-matrix-spec.md`** — **BA** khối, không phải hai (⟲R2): (a) dòng bảng `:153`
   `GET /auth/roles/:id/members` đổi `✘ KHÔNG` → `✔ users.id (qua user_roles)`, trạng thái
   `KI-071 ĐÓNG`; (b) gạch đầu dòng "CÒN MỞ → KI-071" `:182-185`; (c) **`:201-207`** — khối *"Workaround
   đang hiệu lực cho dòng CÒN MỞ (`KI-071`): không cấp `view:user` ở scope hẹp hơn `Company`"*. Sau vá
   khối này không chỉ CŨ mà **mâu thuẫn trực tiếp** với mục đích WO (biến `@Own` thành cấu hình cấp-được)
   và với cảnh báo mới ở §0. Thay bằng luật vận hành SAU vá: `@Own`/`@Team`/`@Department` nay là cấu hình
   **hợp lệ và có hiệu lực ở tầng HÀNG** — kèm cảnh báo `Team`/`Department` = 0 hàng (D10) và "cấp `@Own`
   cho vai đang giữ `*:*` là HẠ scope" (§0).
7. **`docs/RELEASE/RELEASE-02_Known_Issues_MVP.md`** — gạch KI-071 kèm: số đo PROD ĐO LẠI, ngữ nghĩa
   `Own` (D2), hệ quả D4 (fail-soft → fail-closed **+ bảng K2/K3/K4, KHÔNG K1**) như dòng RIÊNG,
   coupling FE của D12, cảnh báo "cấp `@Own` cho vai đang giữ `*:*` là HẠ scope" (§0), nợ N-1b/D6/D7,
   RED-proof §3.4, và **ROLLBACK** (§4.9).
8. **`harness/backlog.mjs`** — `status: "done"`, **và ⟲R2 sửa `done_when` #3**: câu hiện tại đòi *"ca cũ
   về `identityInScope`/`email`/`fullName` phải còn xanh **NGUYÊN**"*, trong khi §3.1 CỐ Ý viết lại A2
   (xoá khối lặp) và đổi A3. Để nguyên là `done_when` tự mâu thuẫn với bản vá đã nghiệm thu. Sửa thành:
   *"cơ chế bound-CỘT của KI-053 KHÔNG bị gỡ; ca A2/A3 viết lại theo ngữ nghĩa HÀNG mới (D7 — khả-quan-sát
   của tầng cột trên route này bị bao trùm), bằng chứng ĐỘC LẬP của tầng cột giữ ở ca B\*/C\*"*.

9. **⟲R1 — ROLLBACK, phát biểu ra chứ không để trống:** code-only, **0 migration** ⇒ sự cố CODE thì
   revert PR là đủ. **Không có feature-flag** cho vị từ này (cố ý — một cờ tắt-bound-hàng là chính lỗ
   hổng có công tắc). Nếu là **403 hàng loạt**: kill-switch `PERMISSION_GUARD_ENABLED` **không liên
   quan** (D4 — route có cổng thứ hai); lối thoát vận hành DUY NHẤT là nâng grant của vai bị kẹt lên
   `view:user@Company` (`UPDATE role_permissions SET data_scope='Company' …`). Nếu là **thiếu hàng** (vai
   `@Own`/`@Team` mất danh sách): đó là hành vi ĐÚNG theo thiết kế, xử lý bằng cấp quyền, không bằng
   revert.

**KHÔNG chạm:** migration (0), `data-scope.service.ts` (0 — tái dùng lattice y nguyên),
`identity-projection.ts` (0 — `rowScopeSql`/`fromScope` đã đủ), contract (0 — response không đổi hình
dạng). **FE: 0 dòng sửa — nhưng KHÔNG phải "0 ảnh hưởng"** (D12): coupling `memberIds` là nợ CÓ TÊN ở
§7, không phải khoảng trống.

---

## 5. Bẫy đã biết phải né

- `enclosing()` chỉ nhận method/function declaration (D6) — arrow property ⇒ pin ĐỎ khó hiểu.
- Xoá `rowScopeSql` khỏi `and(...)` thay vì THAY bằng vị từ `true` khi chạy đột biến ⇒ ca DENY xanh-RỖNG
  (§3.4).
- Ca RED chỉ đếm `rows.length` mà không assert `userId` ⇒ không phân biệt "đúng 1 hàng của tôi" với
  "đúng 1 hàng của người khác" (R-D2 tồn tại vì thế).
- `seedRolePermission` mặc định `Company` — quên truyền `"Team"` cho R-T1 ⇒ ca xanh vì SAI lý do.
- `mapError` bọc `listMembersInner` — 403 đi qua nguyên vẹn (đã xác minh §0.1); nếu ai đó đổi nó thành
  `catch` rộng hơn thì 403 hoá 500 trong im lặng.
- `docs/**` reflow bảng khi chạy prettier (memory `prettier-on-docs-reflows-all-tables`) — không chạy
  prettier lên `docs/`.
- Fixture giả-secret phải GHÉP CHUỖI (gitleaks) — file int-spec đã theo luật đó, giữ nguyên.

---

## 6. Nghiệm thu

- [ ] Ca A2/A3 cũ đã ĐỎ trước vá (chứng minh vị từ có hiệu lực), xanh sau vá với ngữ nghĩa MỚI; khối lặp
      0-vòng của A2 đã bị **xoá**, không chỉ sửa số (§3.1).
- [ ] R-D1·R-D2·R-D3·R-T1·R-T2 ĐỎ trước vá; R-A1·R-A2·R-A3·R-G1·R-X1 XANH cả trước lẫn sau.
- [ ] ⟲R2 `uTeam`/`uDept` **CÓ mặt** trong kết quả R-A3 — nếu không, R-T1/R-T2 là xanh-RỖNG và mọi kết
      luận về D10/N-1b rút ra từ chúng đều vô giá trị.
- [ ] U1…U4 xanh **và** U1/U2 ĐỎ dưới M-B/M-Q khi đột biến đặt ở **tầng HÀNG** (không chỉ tầng cột) —
      §3.3; M-A / M-B tái lập đúng số ca ĐỎ đã ghi.
- [ ] `ROW_SCOPE_MINT_PINS` = **3 mục**, ratchet xanh; hai dòng verdict `:458`/`:465` đã phụ đề;
      `BASIS_CEILINGS` **không đổi**.
- [ ] ⟲R1 **`bash harness/check.sh --all`** (hoặc `REQUIRE_LANE_DB=1`) xanh — CLAUDE.md §9.5: vùng đỏ mở
      PR phải dùng cổng ép ĐỎ khi int-spec bị SKIP. `--lane-db` **một mình không exit 1** khi skip ⇒ hạ
      chuẩn cổng.
- [ ] FULL gate `security-reviewer` **PASS**.
- [ ] RELEASE-02 + permission-matrix cập nhật; số đo PROD ĐO LẠI lúc mở PR (kèm câu đo BAO TRÙM §0).

---

## 7. Ranh giới KHÔNG đóng trong WO này (nợ CÓ TÊN)

- **N-1b (sàn hoá Team/Department)** — sau bản vá `Team`/`Department` = 0 hàng trên route này nữa, và
  lưới vẫn không đơn điệu. Phải sửa cho **cả ba** đường (`users` danh bạ · hai bảng nhật ký ·
  `audit_logs` · route này) cùng lúc.
- **Trích `rowScopeFor` dùng chung** — nay đã có **BA** bản sao gần giống. Đây là lần đầu điều kiện của
  docblock `ROW_SCOPE_MINT_PINS` được thoả ("khi KI-071 thêm điểm thứ ba"). Cần WO riêng, và WO đó phải
  giải bài toán "gộp mà ratchet vẫn thấy từng bề mặt" TRƯỚC khi gộp.
- **K2 · K3 · K4** — cửa sổ cache guard 300s cho 403 chủ ý; `data_scope` không chuẩn hoá được ⇒
  fail-closed vĩnh viễn; **K4** lỗi hạ tầng ở câu scope (không cache) trong khi `can()` phục vụ từ cache
  ⇒ 403 nơi trước đây là 200-đã-che. (**K1 kill-switch KHÔNG áp dụng** cho route này — D4.)
- ⟲R1 **Coupling FE `memberIds` (D12)** — `RoleMembersTab.tsx:91` nuôi `toAssign`/`alreadyMembers` của
  hai dialog batch (`:383-384`, `:489-490`) bằng **tập hàng đã bị scope**. Vai giữ đồng thời
  `assign-role:user@Company` và `view:user@Own` ⇒ batch gán lại người đã là thành viên (loạt 409) kèm bộ
  đếm sai. Vá đúng = gate ba
  dialog bằng `useCanExact` + điều kiện scope, ở **WO FE riêng**. Không thuộc WO này.
- ⟲R1 **`RoleMembersTab.spec.tsx:201`** ghim "hàng ngoài scope (thiếu `email`/`fullName`) vẫn render" —
  sau D7 server **không còn phát ra được** hình dạng đó trên route này. **Giữ ca** (phòng thủ FE vẫn
  đúng, và nó chống bẫy `server-masking-needs-optional-fe-schema`), nhưng nó nay mô tả một trạng thái
  server **bất khả** ⇒ đừng ai "nghiệm thu tầng CỘT" qua nó.
- ⟲R1 **`softDeleteRoleMembersTx`** (`role-admin.repository.ts:251-269`) trả **SỐ** thành viên bị gỡ —
  một bộ đếm trên chính `user_roles`, nhưng gate bằng cặp **`delete:role`** (khác cặp). **Ngoài** ranh
  giới KI-071 (WO này bound cặp `view:user`); nhắc để nó không chìm, cùng khuôn với gạch đầu dòng
  `ChatOversightRepository` dưới đây.
- **PAT/api-key** — vị từ hàng phân giải scope của **USER**, bỏ qua `scopeKeys` thu hẹp của PAT. Không
  phải hồi quy (hôm nay cũng vậy), nhưng là ranh giới có tên.
- **`ChatOversightRepository.listOversightAudit`** — đường đọc `audit_logs` thứ hai mà KI-072 phát hiện,
  **vẫn chưa có số hiệu**. Không thuộc WO này; nhắc để nó không chìm.
- **Đọc danh sách thành viên KHÔNG sinh audit** — cặp non-sensitive, `auditRequired` không bật. Ngoài
  phạm vi; cùng lớp với ghi chú của KI-070.
