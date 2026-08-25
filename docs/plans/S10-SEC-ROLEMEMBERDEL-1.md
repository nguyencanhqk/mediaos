# S10-SEC-ROLEMEMBERDEL-1 — KI-074: oracle thứ HAI của tab Thành viên role, chiều `DELETE`

> Vùng đỏ (phân quyền + kênh phụ). Plan viết TRƯỚC code theo CLAUDE.md §6.
> Bảng chạm: `user_roles` (chỉ ĐỌC thêm `roles`) — **0 migration**.
> Xếp SAU `S10-SEC-ROLEMEMBERFE-1` (KI-073) và `S10-SEC-ROLEMEMBERROW-1` (KI-071): WO này chỉ tồn tại
> vì hai chiều kia đã bị đóng, để lại `DELETE` là kênh im lặng duy nhất còn sống.

---

## 0. Tiền đề — chủ trương ĐÃ KÝ, plan này KHÔNG mở lại lựa chọn

Owner ký 2026-08-24, **hướng (b)**: `DELETE /permissions/users/:userId/roles/:roleId` **GIỮ 404** cho
actor có `view:user` ở scope `Company`/`System`; **204** cho phần còn lại.

Hai hướng bị loại (ghi lại để plan-review không đề xuất lại):

| hướng | nội dung | vì sao loại |
| --- | --- | --- |
| (a) | 204 đồng nhất cho mọi actor | đóng oracle nhưng **lấy mất** tín hiệu 404 mà `packages/web-core/src/lib/auth-users-api.ts:136` cố ý dựa vào ("caller xử lý như lỗi rõ ràng, KHÔNG no-op ngầm") |
| (c) | chấp nhận rủi ro, không sửa | lỗ tiềm tàng còn nguyên; KI-074 sinh ra chính để chống "nợ nằm trong văn xuôi" |

Hướng (b) thắng vì **không mất tín hiệu vận hành** (người trực ca luôn ở `Company`) và **đối xứng với
cờ `complete`** của KI-073 (`role-admin.service.ts:251`): cùng một ý — *bit CÓ THẨM QUYỀN về scope
`view:user` của CHÍNH actor* lái hình dạng câu trả lời.

---

## 1. Bảng nhánh THẬT của `revokeRole` hôm nay (đọc code, không đọc mô tả)

`apps/api/src/permission/permission-admin.service.ts:186-223`:

| # | điều kiện | HTTP | ghi gì |
| --- | --- | --- | --- |
| N | `findUserRole` rỗng (`:191`) | **404** `"User does not have this role"` | **0 hàng** — ném TRƯỚC mọi ghi |
| P | có hàng active | **204** (`@HttpCode(204)`, controller `:56`) | soft-delete `user_roles` + `audit RoleRevoked` + `user_security_events ROLE_REMOVED` + outbox `permission.changed` = **4 vết** |

⇒ Nhánh **N là câu trả lời ÂM MIỄN PHÍ**: "x KHÔNG phải thành viên của role r" với **0 hàng forensic,
0 thiệt hại**. Đây chính xác là gương của V1 mà KI-073 đã đóng ở chiều `POST`.
Nhánh **P đắt và ồn** — nhưng actor giữ `assign-role:user` **vá lại được ngay bằng POST**, nên cặp
`RoleRevoked`+`RoleAssigned` sát nhau lẫn vào nhiễu cấp phát bình thường.

⚠️ **Không có nhánh "role không tồn tại" riêng hôm nay.** Role lạ / đã xoá / operator-audience /
thuộc tenant khác đều rơi vào N và nhận CÙNG câu 404 `"User does not have this role"` — vì
`findUserRole` lọc theo `(company_id, user_id, role_id)` chứ không validate role trước. Sự thật này
quyết định D3 dưới.

---

## 2. Quyết định thi công

### D1 — Điểm quyết định nằm ở nhánh N của `revokeRole`, KHÔNG ở controller, KHÔNG ở guard

Guard chỉ trả lời có/không cặp `assign-role:user`. Bit lái hình dạng câu trả lời là **scope của một
cặp KHÁC** (`view:user`) — cùng khuôn KI-053/KI-071/KI-073, và cùng lý do: cặp gate ≠ cặp bound.

### D2 — Lấy bit qua `PermissionService.resolveStrongestScope` TRỰC TIẾP, KHÔNG thêm `DataScopeService` vào DI

`DataScopeService.resolveOrNull` (`data-scope.service.ts:107-109`) chỉ là passthrough sang
`permission.resolveStrongestScope`. `PermissionService` **đã được inject** vào `PermissionAdminService`.

Vì sao quan trọng: thêm một constructor arg thứ 7 sẽ **phá 3 suite dựng service bằng tay**
(`permission-admin.soft-delete.spec.ts:49-56`, `permission-admin.assign-response.spec.ts`,
`permission-admin.int-spec.ts`) và mời một import-cycle mới vào module đã `forwardRef` Auth↔Permission.
Dùng lại dependency có sẵn ⇒ **0 dependency mới, 0 vòng import mới, chữ ký constructor KHÔNG đổi**.

### D3 — Ranh (2): nhánh "role không assignable trong tenant này" GIỮ 404 cho MỌI actor

Theo §1, hôm nay nhánh này chưa tách. (b) buộc phải tách, nếu không thì role của tenant khác cũng tụt
xuống 204 ⇒ **vi phạm BẤT BIẾN #1** (cô lập tenant phải nhìn thấy được ở tầng HTTP, xem ca R-X1 của
`S10-SEC-ROLEMEMBERROW-1`).

Tách bằng `repo.findAssignableRole(tx, roleId)` — **đúng hàm mà `assignRole:99` đang dùng**:

```
roles WHERE id = :roleId AND deleted_at IS NULL AND id NOT IN (OPERATOR_ROLE_IDS)
```

dưới RLS `roles_tenant_isolation` (mig `0005_permissions.sql:37-44`) — **predicate ĐẦY ĐỦ, cả hai vế**:

```sql
USING ( company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        OR company_id IS NULL )        -- ⚠️ vế thứ hai: SYSTEM role thấy được ở MỌI tenant
```

⇒ **ba lớp role, ba kết cục khác nhau — phải ký cả ba, không được chỉ nói vế đầu:**

| lớp role | thấy dưới tenant actor? | actor `Company`/`System` | actor HẸP |
| --- | --- | --- | --- |
| company-scoped của **tenant KHÁC** | ❌ RLS chặn | 404 | **404** (ranh 2) |
| **system** (`company_id IS NULL`, 4 vai chính tắc mig `0444`) | ✅ (vế `OR`) | 404 | **204** |
| operator-audience (`OPERATOR_ROLE_IDS`) | ✅ nhưng `notOperatorRole()` loại | 404 | **404** |

Hàng giữa là **hành vi mới được ký ở đây**: system role không thuộc tenant nào nên 204 KHÔNG phá
ranh (2) và nhất quán với (b) — nhưng nó phải được nói ra, và ca `D-X1` **phải dùng role
company-scoped của B** (`seedRole(direct, B.companyId, …)`), không được dùng system role, nếu không
nó pin nhầm mệnh đề.

Hàng cuối là **cạnh DUY NHẤT** phân biệt `findAssignableRole` với một `SELECT … WHERE id =` trần ⇒
phải có ca riêng (`D-X3`), nếu không ai đó "đơn giản hoá" hàm này sẽ mở đường gán role operator.

**Thông điệp GIỮ NGUYÊN `"User does not have this role"`** ở cả hai nhánh 404 — KHÔNG thêm
`"Role not found"`. Đổi chuỗi là thêm một bit mới vào response và làm 3 caller FE phải đọc lại.

**Bit "role có assignable không" là bit MỚI với actor hẹp?** KHÔNG — và chứng minh MẠNH hơn "đã lộ
qua POST": `assignRole` cho bit đó **MIỄN PHÍ**. Với `roleId` rác + `targetUserId` rác, POST trả
**hai thông điệp KHÁC NHAU** — `"Role not found"` (`:99-101`) vs `"User not found"` (`:102-104`) —
và **0 ghi ở CẢ HAI nhánh** (ném trước mọi `insertUserRole`/`audit`). Cùng quyền `assign-role:user`,
cùng giá bằng không. ⇒ D3 không thêm bit nào.
⚠️ Chỗ dựa này là **giả định về code KHÁC**: ai vá POST sau này thì D3 mất nền và phải mở lại. Pin
bằng `D-X4`.

### D4 — Ranh (1): `resolveStrongestScope` trả `null` ⇒ **204**, không phải 404

`null` = *"KHÔNG có thẩm quyền"*, KHÔNG phải `Company`. Ba nguồn của `null` (xem `permission.service.ts:572-634`):
0 grant khớp · một grant `DENY` khớp (deny-overrides) · `data_scope` không chuẩn hoá được **hoặc lỗi
hạ tầng** (`catch` → `null`, fail-closed).

⚠️ Ở đây fail-closed **= 204**, ngược chiều với `listMembersInner` (fail-closed = 403). Không mâu
thuẫn: ở đó `null` nghĩa "không được đọc route" nên chặn; ở đây `null` nghĩa "không đủ thẩm quyền để
nhận câu trả lời ÂM" nên **im lặng**. Cả hai đều là "nghi ngờ ⇒ nói ít hơn".

⇒ Hệ quả vận hành phải nói ra: một sự cố hạ tầng ở câu scope biến 404 thành 204 cho actor
`Company`. Đó là **mất tín hiệu tạm thời, không phải mất quyền** — revoke thật vẫn chạy đúng. Log
`resolveStrongestScope() infrastructure error` của chính hàm đó là đường lần.

### D5 — KHÔNG truyền `opts.isSensitive` — dòng dễ copy sai nhất

`view:user` là `is_sensitive = false` (mig `0444:39`). Truyền `{ isSensitive: true }` theo khuôn
`foundation/audit` sẽ ép nhánh `eligible = allowMatches.filter(isExact)` ⇒ **mọi vai chỉ giữ `*:*`
tụt về `null` ⇒ 204** ⇒ super-admin và mọi admin dùng wildcard **mất tín hiệu 404** trong im lặng.
Đúng thứ hồi quy vận hành mà hướng (a) bị loại vì gây ra. Ghim bằng ca unit U5.

⚠️ **"Không truyền `opts`" KHÔNG ĐỦ để chắc chắn ở nhánh non-sensitive.** `permission.service.ts:598-599`:

```ts
const effectivelySensitive =
  (opts?.isSensitive ?? false) || allowMatches.some((grant) => grant.isSensitive);
```

Vế thứ hai đọc cờ **từ CATALOG**. Chỉ cần MỘT grant khớp `('view','user')` — **kể cả hàng catalog
`('*','*')`** — có `is_sensitive = true` là toàn bộ resolution rơi về nhánh exact-only ⇒ mọi actor
wildcard-only tụt `null` ⇒ **204, mất tín hiệu 404 trong im lặng**.

⇒ Hôm nay plan đúng **nhờ DỮ LIỆU**, không nhờ code: `('view','user')` = `false` (`0444:39`).
Lật cờ đó ở một migration sau **biến route này thành 204-mù mà không một test hành vi nào đỏ**.
Ghim bằng ca int `D-S1`: assert thẳng `permissions.is_sensitive = false` cho `('view','user')` (và
cho `('*','*')` nếu lane DB có hàng đó), kèm chú thích nói ra hệ quả — khuôn `audit.service.spec.ts:90-94`.

### D6 — 4 hình dạng wildcard: đã có sẵn trong engine, KHÔNG viết lại

`resolveStrongestScope` `matches()` (`:584-586`) là
`(action === a || action === '*') && (resourceType === r || resourceType === '*')` — **hai vế độc lập**
⇒ phủ đủ `('view','user') · ('view','*') · ('*','user') · ('*','*')`
([[permission-grant-census-must-cover-four-wildcard-shapes]]). Gọi đúng hàm này là đủ; **cấm** tự
viết lại điều kiện ở service.

**Hệ quả CÓ CHỦ Ý của "exact THẮNG wildcard"** (`:606-607`, vì cặp non-sensitive): một vai giữ
`*:*@Company` **được cấp thêm** `view:user@Own` sẽ **TỤT xuống nhánh 204**. Đó là siết, không phải
nới, và là hành vi đã ký. Ghim bằng ca unit U4.

### D7 — Ranh (3): nhánh 204-ÂM là **0 ghi**

Trả về trước mọi `audit.record` / `securityEvents.record` / `emitPermissionChangedForUser` /
`repo.deleteUserRole`. **Cấm** ghi audit/security-event giả "cho giống nhánh dương" — đó là biến
oracle ĐỌC thành GHI giả, đúng luật no-op mà KI-073 ca O4 đã chốt. Ghim bằng U2 + ca int `D-N2`.

### D8 — Kênh THỜI GIAN không đóng theo; và chi phí THẬT của D2

Nhánh ÂM = 0 ghi (+1 `findAssignableRole`), nhánh DƯƠNG = 4 ghi ⇒ phân biệt được bằng độ trễ
([[attribution-patch-creates-timing-oracle]]). **Ghi nhận trong ADR, KHÔNG hứa đóng** — đóng nó đòi
ghi giả, mâu thuẫn D7.

⚠️ Resolve vô điều kiện (D2) **KHÔNG làm phẳng** chênh lệch đó — nó cộng một hằng số vào **cả hai**
nhánh; khoảng cách 4-ghi còn nguyên. Chi phí thật phải ghi đúng: **mỗi `DELETE` nay mở 2 transaction**
(một cho `resolveStrongestScope`, một cho write-tx), kể cả nhánh dương. Chấp nhận được vì revoke là
thao tác quản trị hiếm; nói ra để không ai tưởng đây là tối ưu.

### D9 — Caller của 404: CHỨNG MINH không đổi, không giả định

Ba caller (đã rà hết `packages/web-core` + `apps/app` + `apps/console`):

| caller | đường | xử lý 404 |
| --- | --- | --- |
| `apps/app/src/routes/system/roles/RoleMembersTab.tsx:107` | `authUsersApi.revokeRole` | mutation `onError` → toast |
| `apps/app/src/routes/system/users/UserRolesPage.tsx:98` | `authUsersApi.revokeRole` | mutation `onError` → toast (spec `:149` ghim reject) |
| `apps/console/src/routes/system/permissions/revoke-role-dialog.tsx:40` | `rbacApi.revokeRole` | mutation `onError` → toast |

Dưới (b) người trực ca ở `Company` **VẪN nhận 404** ⇒ **0 dòng FE phải sửa**. Chứng minh, không giả
định: ca int `D-A2` gọi bằng actor `Company` và pin `404`. Chú thích `auth-users-api.ts:136` được
**cập nhật** để nói rõ 404 nay là *có điều kiện* (không đổi hành vi, chỉ hết nói dối).

### D10 — ADR `docs/DECISIONS/DECISIONS-11_Role_Membership_Absence_Signal.md` — **ĐÃ LAND**

Đổi HỢP ĐỒNG API mà chỉ để lại một dòng backlog là tái lập đúng lỗ mà KI-074 sinh ra để chống
(tiền lệ: KI-065 đóng kèm `DECISIONS-09`). ADR ghi: chữ ký (b) · (a)/(c) và vì sao loại · ba ranh
giới · kênh thời gian còn mở · số đo PROD. Còn nợ trên ADR: **§R2 trích đủ predicate RLS** (ba lớp
role của D3) và **§5 cập nhật số đo sau khi đo lại**.

### D11 — Điểm đúc THỨ TƯ của cặp `view:user` — ghi nợ, KHÔNG gộp

`hasCompanyWideDirectory` là nơi thứ **4** đọc scope của cặp `view:user`, sau
`role-admin.service.ts:183` (tập hàng + cột danh tính + cờ `complete`),
`auth-logs-viewer.service.ts` và `foundation/audit/audit.service.ts`. Nợ gộp đã ghi ở
`S10-SEC-ROLEMEMBERROW-1`; WO này **cộng thêm một** và **không gộp** (gộp là refactor CROWN chạm ba
đường đã nghiệm thu). Ghi **số 4** vào nợ để lần cân nhắc sau không đếm thiếu.

---

## 3. Hình dạng code (GREEN)

`permission-admin.service.ts`:

```ts
async revokeRole(actor, targetUserId, roleId) {
  await this.assertCan(actor, "assign-role", "user", targetUserId);
  try {
    // KI-074/D2: bit thẩm quyền lấy NGOÀI write-tx — resolveStrongestScope tự mở withTenant
    // (permission.repository.ts:70) ⇒ gọi trong tx là withTenant LỒNG NHAU: connection thứ hai
    // trong khi đang giữ một connection, + transaction tách rời (không thấy ghi chưa commit).
    // Đúng bẫy assignRole:87 đã ghi. TRONG `try` (⟲plan-review): resolveStrongestScope hôm nay tự
    // nuốt mọi lỗi (:624-633) nhưng đó là hợp đồng KHÔNG được compiler ép — ném ra ngoài `try` sẽ
    // bỏ qua mapError và rò stack ra 500. Đưa vào trong: 0 chi phí.
    const directoryWide = await this.hasCompanyWideDirectory(actor);
    await this.db.withTenant(actor.companyId, async (tx) => {
      const existing = await this.repo.findUserRole(...);
      if (!existing) {
        // D3 — role không assignable trong tenant NÀY: 404 cho MỌI actor.
        if (!(await this.repo.findAssignableRole(tx, roleId))) {
          throw new NotFoundException("User does not have this role");
        }
        // D4/D7 — trong-tenant "user không giữ role này": 404 chỉ cho Company/System, còn lại 204 + 0 ghi.
        if (directoryWide) throw new NotFoundException("User does not have this role");
        return;
      }
      ... nguyên như cũ ...
    });
  } catch (err) { throw this.mapError(err, "Failed to revoke role"); }
}

/** KI-074 — bit CÓ THẨM QUYỀN của CHÍNH actor trên cặp danh bạ `view:user`. D5: KHÔNG opts. */
private async hasCompanyWideDirectory(actor: RequestUser): Promise<boolean> {
  const scope = await this.permissionService.resolveStrongestScope(
    actor.id, actor.companyId, "view", "user",
  );
  return scope === "Company" || scope === "System";
}
```

⚠️ **Hai vị trí là BẮT BUỘC, không phải phong cách:**

1. `findAssignableRole` **TRONG** `if (!existing)`, không phải đầu hàm. Nâng lên đầu cho "gọn" sẽ
   **khoá vĩnh viễn việc gỡ vai của một role vừa bị soft-delete** (`findAssignableRole` lọc
   `deleted_at IS NULL`) — user giữ quyền tồn đọng mà không gỡ được, và **không test nào đỏ** trừ
   `U9`.
2. `findAssignableRole` chạy **TRƯỚC** `directoryWide`. Đảo lại thì actor `Company` vẫn ra 404 (test
   của họ không phát hiện) nhưng actor hẹp nhận **204 cho role của tenant khác** ⇒ mất ranh (2)
   trong im lặng. `D-X1` ghim đúng chỗ này.

---

## 4. Test — RED TRƯỚC

### 4.1 Unit (không cần DB) — `permission-admin.ki074.spec.ts` (mới, colocated `src/permission/`)

Dựng service bằng tay như `permission-admin.soft-delete.spec.ts:28-57`, thêm
`permissionService.resolveStrongestScope` vào mock.

| ca | dựng | chờ |
| --- | --- | --- |
| **U1** | scope `Company`, `findUserRole`→∅, role assignable | 404 + `deleteUserRole` KHÔNG gọi |
| **U2** | scope `Own`, `findUserRole`→∅, role assignable | resolve (204); `deleteUserRole`/`audit.record`/`securityEvents.record`/`outbox.enqueue` **đều 0 lần** (D7) |
| **U3** | scope `null`, `findUserRole`→∅, role assignable | 204 + 0 ghi (D4 — `null` KHÔNG phải `Company`) |
| **U4** | scope `Own` (mô phỏng `*:*@Company` + `view:user@Own`) | 204 — ghim ở tầng SERVICE (tầng ENGINE là `D-W4`) |
| **U5** | scope `Company` | `resolveStrongestScope` gọi **1 lần**, `mock.calls[0]` **độ dài 4**, `toHaveBeenCalledWith(actorId, companyId, "view", "user")` — ghim D5 |
| **U6** | scope `Own`, `findUserRole`→∅, `findAssignableRole`→`undefined` | **404** (D3 — role ngoài tenant KHÔNG tụt 204) |
| **U7** | scope `Own`, `findUserRole`→**có hàng** | gỡ THẬT (`deleteUserRole` + `RoleRevoked` + `ROLE_REMOVED` + emit) — chặn U2/U3 xanh-RỖNG ([[deny-cases-vacuous-without-allow-case]]) |
| **U8** | scope `System` | 404 (nhánh `System` của D4 không bị bỏ quên) |
| **U9** | scope `Own`, `findUserRole`→**có hàng**, `findAssignableRole`→`undefined` | vẫn gỡ THẬT **và** `expect(findAssignableRole).not.toHaveBeenCalled()` — ghim vị trí (1) ở §3: role đã soft-delete/operator vẫn gỡ vai được |

⚠️ **U5 dễ mất răng.** Viết `toHaveBeenCalledWith(..., "user", undefined)` là ca CHẾT (nó pass cả khi
ai đó truyền `opts` rồi lại xoá). Phải cả ba: `toHaveBeenCalledTimes(1)` +
`expect(spy.mock.calls[0]).toHaveLength(4)` + `toHaveBeenCalledWith(id, cid, "view", "user")`.

RED: trước GREEN, U2/U3/U4/U6 **ném 404** thay vì resolve; U5/U9 đỏ vì hàm chưa tồn tại.

### 4.2 Integration (`LANE_DB`) — `apps/api/test/integration/role-member-del-oracle.int-spec.ts` (mới)

Vì sao **file mới**: ca ALLOW ở đây **gỡ vai thật**, làm hỏng fixture thành viên mà
`identity-projection-scope.int-spec.ts` dựa vào. Tự seed, tự dọn.

Seed: tenant `A` + `B`; catalog `assign-role:user (sensitive=true)` + `view:user (sensitive=false)`.

⚠️ `seedPermissionCatalog(direct, "view", "user", **false**)` — truyền `true` sẽ bị hàng rào
`seed.ts:250-288` **NÉM** ("fixture đóng dấu catalog toàn cục").

- `aCompany` — `assign-role:user@Company` + `view:user@Company` (hình dạng PROD của người trực ca)
- `aOwn` — `assign-role:user@Company` + **`view:user@Own`** (hình dạng lỗ — **TỰ GIEO**, PROD 0 vai)
- `aNoDir` — `assign-role:user@Company`, **không** `view:user` (⇒ `null`)
- `roleTarget` — **PHẢI mang một cặp quyền THẬT** (`view:user@Company`) để D-A3 đo được hệ quả
- `victim` giữ `roleTarget` · `keep` cũng giữ `roleTarget` (đối chứng) · `stranger` KHÔNG giữ
- `roleTenantB` — role **company-scoped của B** (`seedRole(direct, B.companyId, …)`) — **KHÔNG** system role

| ca | actor | gọi | chờ |
| --- | --- | --- | --- |
| **D-S1** | — | đọc catalog | `('view','user').is_sensitive = false` (+ `('*','*')` nếu có hàng) — ghim D5 |
| **D-A2** | `aCompany` | DELETE `stranger`/`roleTarget` | **404** — tín hiệu vận hành CÒN (D9) |
| **D-N1** | `aOwn` | DELETE `stranger`/`roleTarget` | **204** |
| **D-N2** | `aOwn` | delta DB quanh D-N1 | `user_roles` không đổi · **Δ0** `audit_logs` (`object_type='user_role' AND actor_user_id=aOwn`) · **Δ0** `user_security_events` (`user_id=stranger`) · **Δ0** outbox (`payload->>'userId'=stranger`) |
| **D-N3** | `aNoDir` | DELETE `stranger`/`roleTarget` | **204** (D4 — `null` ⇒ im lặng) |
| **D-X1** | `aOwn` | DELETE `stranger`/**`roleTenantB`** | **404** (BẤT BIẾN #1 — D3 hàng 1) |
| **D-X2** | `aOwn` | DELETE `stranger`/**role SYSTEM** (`company_id IS NULL`) | **204** — ký hành vi D3 hàng 2 |
| **D-X3** | `aOwn` | DELETE `stranger`/**`OPERATOR_ROLE_IDS[0]`** | **404** — D3 hàng 3, cạnh duy nhất phân biệt `findAssignableRole` |
| **D-X4** | `aOwn` | POST `roles` với `roleId` rác, rồi với `userId` rác | hai thông điệp KHÁC nhau + **0 ghi** cả hai — pin nền của "0 bit mới" (D3) |
| **D-W1** | `assign-role@Company` + `('*','*')@Company` | DELETE `stranger`/`roleTarget` | **404** |
| **D-W2** | + `('view','*')@Company` | ↑ | **404** |
| **D-W3** | + `('*','user')@Company` | ↑ | **404** |
| **D-W4** | `('*','*')@Company` **+** `view:user@Own` | ↑ | **204** — "exact THẮNG wildcard" ở tầng **ENGINE** (D6) |
| **D-A0** | `victim` **trước** D-A1 | route gate bằng quyền của `roleTarget` | **200** — đối chứng ALLOW |
| **D-A1** | `aOwn` | DELETE `victim`/`roleTarget` | **204** + `user_roles` soft-deleted (`deleted_by=aOwn`) + `audit RoleRevoked` trỏ **id hàng thật** + `ROLE_REMOVED` + outbox |
| **D-A3** | `victim` **sau** D-A1 | ↑ cùng route | **403** — mất quyền THẬT; và `keep` vẫn **200** |

⚠️ **D-A1 và D-N1 KHÔNG phân biệt được ở tầng HTTP** — đó chính là mệnh đề WO này chứng minh. Cái
phân biệt chúng chỉ nằm ở DB (D-N2 vs D-A1), tức **ở phía phòng thủ**.

⚠️ **`D-X1` và `D-X3` là RATCHET, KHÔNG phải RED-proof.** Code CŨ trả 404 ở mọi nhánh ÂM nên hai ca
này xanh cả TRƯỚC lẫn SAU bản vá. Chúng vẫn có giá trị (bắt hồi quy nếu ai nới ranh 2 hoặc "đơn giản
hoá" `findAssignableRole`), nhưng đừng đọc "13/13 xanh" thành "13 ca đều đỏ trước". Ca THỰC SỰ đỏ
trên code cũ, đo bằng cách revert service về HEAD: **D-N1 · D-N3 · D-X2 · D-W4** (int) và
**U2 · U3 · U5 · U9** (unit).

⚠️ **Ba người giữ `roleTarget`, không phải hai.** Cache quyền TTL 300s + scheduler tắt trong
`NODE_ENV=test` ⇒ gọi route bị gate bằng chính `victim` TRƯỚC khi gỡ sẽ nạp cache và D-A3 đo trúng
cache cũ (bản đầu đã đỏ đúng như vậy: 200 thay vì 403, **kể cả sau khi đăng nhập lại** — cache khoá
theo user, không theo token). Nên: `prover` gánh ca ALLOW đối chứng, `victim`/`keep` giữ CACHE-LẠNH
tới sau D-A1.

⚠️ D-W1..W4 dùng **4 hình dạng wildcard ĐỘC LẬP HAI VẾ**
([[permission-grant-census-must-cover-four-wildcard-shapes]]). U4 **không thay thế được** chúng: U4
mock resolver nên nó ghim service, không ghim engine.

⚠️ **KHÔNG test bằng super-admin** ([[superadmin-not-a-canonical-role]]) — SA được
`SuperAdminBootstrapRepository.grantPermissionWithScope` cấp toàn catalog ở `data_scope='System'`
⇒ mọi ca DENY thành tautology.

⚠️ Cache quyền TTL 300s + scheduler tắt trong `NODE_ENV=test`: mỗi actor gọi route bị gate **một
lần**, cache-lạnh. `resolveStrongestScope` đọc `getCompanyRoleGrantsWithScope` (KHÔNG cache) nên
không dính bẫy này, nhưng `assertCan` thì có.

### 4.3 Suite CŨ — **5 file** chạm `revokeRole`, không phải 3

| file | ca | ảnh hưởng | sửa |
| --- | --- | --- | --- |
| `src/permission/permission-admin.soft-delete.spec.ts:98` | (2) revoke → 404 | **ĐỎ** — mock `permissionService` chỉ có `can` ⇒ `resolveStrongestScope` undefined ⇒ TypeError ⇒ 500 | thêm mock trả `"Company"` (giữ nguyên mệnh đề 404) |
| `test/integration/permission-admin.int-spec.ts:279` | `unknown role → NotFound` | **ĐỎ** — `adminUser` không có `view:user` ⇒ `null` ⇒ 204 | **seed `view:user@Company`** cho `adminRole` (`isSensitive: false`!) — giữ pin 404 CÓ NGHĨA; thêm ca actor không-danh-bạ → 204 |
| `test/integration/permadmin-roles-http.int-spec.ts:300` | cross-tenant revoke ≥400 | **không đỏ** — `tAdminB` có `view:user@Company`; role của A không thấy dưới tenant B | không đổi; **ghi chú** nó nay đo D3 hàng 1 |
| `test/integration/user-roles-soft-delete.int-spec.ts:318,350,404` | QA-05/06 | **không đỏ** — chỉ đường DƯƠNG | không đổi (thêm 1 transaction/lần gọi) |
| `test/integration/security-event-emit-sites.int-spec.ts:440` | ROLE_REMOVED | **không đỏ** — chỉ đường DƯƠNG | không đổi |

⚠️ Sửa `permission-admin.int-spec.ts` bằng **thêm grant thật**, KHÔNG bằng đổi assert thành `204` —
đổi assert là xoá mất pin của nhánh vận hành ([[tests-can-pin-a-hole-open]]).

---

## 5. Không làm (phạm vi)

- KHÔNG đụng `assignRole` (KI-073 đã đóng; và D3 dựa vào hành vi hiện tại của nó — xem `D-X4`).
- KHÔNG gộp bốn điểm đọc scope `view:user` (D11 — ghi nợ, số 4).
- KHÔNG đóng kênh thời gian (D8).
- KHÔNG migration, KHÔNG đổi catalog quyền (`is_sensitive` giữ nguyên — D-S1 canh).
- KHÔNG sửa hành vi 3 caller FE (D9) — chỉ cập nhật **chú thích** ở `auth-users-api.ts:136`
  (`console/rbac-api.ts:65` không có chú thích 404 ⇒ không phải sửa).

---

## 6. Definition of Done

- [ ] `revokeRole` thi công đúng (b) + ba ranh giới (D3/D4/D7) + hai vị trí bắt buộc của §3
- [ ] Unit U1–U9 xanh; RED chứng kiến trước GREEN
- [ ] Int D-S1 · D-A0/A1/A2/A3 · D-N1/N2/N3 · D-X1/X2/X3/X4 · D-W1..W4 xanh dưới `LANE_DB`
- [ ] 5 suite cũ: 2 sửa bằng grant thật (không nới assert), 3 xác nhận không đỏ
- [ ] `bash harness/check.sh --lane-db` xanh (int-spec THỰC SỰ chạy, không SKIP)
- [ ] ADR `DECISIONS-11`: §R2 trích đủ predicate RLS (3 lớp role) + §5 số đo đo lại
- [ ] Chú thích `auth-users-api.ts:136` cập nhật
- [ ] `docs/permission-matrix-spec.md:201-204` gỡ dòng *"Còn sống: KI-074"*; `docs/plans/INDEX.md`;
      `docs/plans/S10-SEC-ROLEMEMBERFE-1.md:175`; `docs/README.md` thêm hàng `DECISIONS-11`
- [ ] **FULL gate** (CLAUDE.md §6): `security-reviewer` + `database-reviewer` + `silent-failure-hunter`
      (+ `santa-method` nếu chạm logic crown) — PASS
- [ ] RELEASE-02 đóng KI-074 kèm **số đo PROD ĐO LẠI**: lấy tập actor giữ `assign-role:user`
      (4 hình dạng wildcard) rồi đo `resolveStrongestScope(view,user)` **trên tập đó** (4 hình dạng)
      — **hai cặp, không phải một**; ghi cả nguồn `data_scope='System'` của super-admin; và ghi rõ
      kênh THỜI GIAN không đóng theo
- [ ] `harness/backlog.mjs` → `done`
