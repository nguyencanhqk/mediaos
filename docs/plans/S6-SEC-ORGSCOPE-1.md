# S6-SEC-ORGSCOPE-1 — N-1: ép `data_scope` trong `OrgRepository.listEmployees`

> **Zone:** đỏ (crown — permission/data_scope) · **Module:** FOUNDATION · **Migration:** KHÔNG (việc CODE thuần)
> **Nguồn:** `docs/plans/S6-SEC-ORG-1.md` §7 N-1 — cả 3 reviewer FULL gate độc lập chỉ về cùng chỗ
> **Kế tiếp:** `S6-SEC-PERMVERB-1` (N-2 — đổi động từ gate; WO này dọn đường bằng hằng số cặp-quyền dùng chung)

---

## 1. Lỗ hổng

`S6-SEC-ORG-1` đã gate `GET /org/employees` bằng `read:user`, nhưng **repository không ép
`data_scope`**:

```ts
// apps/api/src/org/org.repository.ts — listEmployees
.from(users)
.where(and(eq(users.companyId, companyId), isNull(users.deletedAt)))   // ← chỉ tenant, KHÔNG scope
```

`PermissionGuard` chỉ hỏi **“có cặp quyền không”**, không hỏi **“scope tới đâu”**. Vì vậy một role
tenant tự đúc qua role-admin với `data_scope = Own/Team/Department` **qua được guard rồi nhận TRỌN
danh bạ tenant kèm email** — UI hứa hẹp, API giao rộng.

Đường mở lỗ là **có thật, không phải giả định**: `apps/api/src/permission/role-admin.service.ts`
cho admin gán scope tuỳ ý, ceiling chỉ chặn `System`.

### 1.1 Vì sao pin hiện có KHÔNG bịt được

`test/integration/org-directory-permission.int-spec.ts` (ca cuối) ghim tiền đề *“không role nào giữ
`read:user` ở scope ≠ Company”*, nhưng truy vấn lọc `r.is_system = true` ⇒ **chỉ phủ role hệ thống
(seed/migration)**. Role tenant đúc lúc chạy — đúng cái role-admin sinh ra — nằm ngoài lưới.

### 1.2 Đo PROD (read-only, 2026-07-28, DB `mediaos`)

| role | user | `read:user` | `view:user` | `read:team` |
| --- | --- | --- | --- | --- |
| `employee` | **45** | — | — | — |
| `SA` (tenant funtime) | **6** | ALLOW/Company | ALLOW/Company | ALLOW/Company |
| `company-admin` (system) | **1** | ALLOW/Company | ALLOW/Company | ALLOW/Company |
| `project-manager` | 0 | ALLOW/Company | — | — |
| `hr` | 0 | — | ALLOW/Company | — |
| `hr-manager` | 0 | — | — | ALLOW/Company |

**Mọi grant đang sống đều `Company`** ⇒ hôm nay chưa rò. Đây là **bẫy ngủ đông**: một lần bấm trong
màn RBAC là mở.

---

## 2. Quyết định thiết kế (done_when #2) — chọn **(b)**, KHÔNG (a), KHÔNG (c)

WO nêu 3 đường: **(a)** join `employee_profiles` rồi lọc · **(b)** dựng vị từ **hình-`users`** ·
**(c)** giữ Company-only + chặn cấp scope hẹp ở role-admin.

### Chọn (b): vị từ hình-`users`, đặt ở `DataScopeService` (tầng chia sẻ đã có sẵn)

| Vì sao | Bằng chứng |
| --- | --- |
| `listEmployees` SELECT từ `users` và trả **dữ liệu account-level** (`id·email·fullName·status`) — **cùng lớp dữ liệu** với `GET /auth/users` | `org.repository.ts` listEmployees vs `auth-users.service.ts` |
| Vị từ hình-`users` **đã tồn tại** ở `AuthUsersService.buildUserScopeCondition` (private): `System/Company → tenant` · `Own → self` · `Team/Department → sql\`false\`` | `auth-users.service.ts:478-488` |
| Sau `S6-SEC-PERMVERB-1` hai route dùng **CÙNG cặp quyền** `view:user`. Hai endpoint cùng cặp mà trả tập hàng khác nhau = **drift mới** — đúng lớp lỗi cả S6 đang đóng | ADR §3 |
| §13 chỉ cấp **Company** cho `view:user`; `Team/Department` trên `user` là **ngữ nghĩa chưa định nghĩa** (không có org-mapping trên `users`) ⇒ fail-closed là cách đọc an toàn duy nhất | `auth-users.service.ts:93-95` |

### Vì sao KHÔNG (a)

`buildEmployeeScopeCondition` dựng vị từ trên `employee_profiles`. Join vào `listEmployees` sẽ làm
**user chưa có hồ sơ nhân sự biến mất khỏi màn RBAC của console** ngay cả ở scope `Company` — hồi
quy trực diện done_when #3. `apps/console/src/lib/rbac-api.ts` dùng chính route này làm **danh sách
subject để gán role**; mất user chưa có hồ sơ = **không gán role được cho người mới tạo**.

### Vì sao KHÔNG (c)

Chặn ở `role-admin` là **hàng rào chính sách, không phải hàng rào dữ liệu**: nó nằm trên đúng một
code path, không bảo vệ được grant đến từ migration (memory `blanket-grant-migration-role-drift` —
role sinh SAU migration `CROSS JOIN` lỡ grant), và để API vẫn “rộng” khi hàng rào bị vòng qua.
Giữ lại như **defense-in-depth về sau**, không phải lời giải chính.

### 2.1 Hệ quả phải nói rõ (không giấu)

Role có scope `Team`/`Department` trên cặp đọc user sẽ nhận **0 hàng** — tức **hẹp hơn cả `Own`**.

**Bổ sung sau FULL gate (security-reviewer):** phi đơn điệu **KHÔNG chỉ ở mức "Team < Own"** như bản
đầu của mục này mô tả — nó lan sang **phép hợp grant**. `resolveStrongestScope` lấy `max(SCOPE_STRENGTH)`,
nên user giữ **đồng thời** `Own` và `Team` resolve ra `Team` ⇒ **0 hàng**. Ca tái lập: user U có role
A(`Own`) → `/org/employees` = `[U]`; **gán THÊM** role B(`Team`) → `/org/employees` = `[]`.
**Thêm quyền làm MẤT quyền.** Fail-closed nên không phải lỗ hổng, nhưng là bẫy vận hành thật (admin
sẽ đọc thành "màn RBAC hỏng").

Đây là **hành vi toàn hệ**, không phải của riêng route này — `/auth/users` cũng vậy, cùng
`resolveStrongestScope`, cùng nhánh `false`. Vì thế **không sửa ở WO này**: lời giải (hạ sàn
`Team`/`Department` xuống chính vị từ `Own` để mạng scope đơn điệu) phải áp cho **CẢ HAI** endpoint
một lượt, nếu không lại đẻ ra đúng thứ drift mà §2 đang tránh. Ghi thành **nợ N-1b** trong `src[]`
của `S6-SEC-PERMVERB-1` — WO đó là lúc hai route về chung một cặp quyền, tức thời điểm đúng để hợp nhất.

Cái WO này **có** làm để bớt đau: nhánh fail-closed nay ghi `logger.warn` (xem §5.2), nên "0 hàng vì
scope" phân biệt được với "0 hàng vì tenant rỗng" trong log.

Vẫn giữ `false` (không hạ sàn về `Own`) vì:

- nó **giống hệt** `GET /auth/users` hôm nay (không đẻ hành vi thứ hai),
- fail-closed sai về phía **hẹp**, không phải phía rò,
- hôm nay **0 role nào** ở scope đó (bảng §1.2) ⇒ ảnh hưởng sống = 0.

Nếu sau này cần `Team` thật cho danh bạ, đó là việc **mở rộng có chủ đích** (thêm org-mapping cho
`users`), làm **một lần cho cả hai route** — không phải vá lẻ ở đây.

---

## 3. Dọn đường cho `S6-SEC-PERMVERB-1` — hằng số cặp-quyền dùng chung

ADR đã chốt: động từ canonical là **`view:user`** (xem `S6-SEC-PERMVERB-1`). WO này **chưa đổi động
từ**, nhưng phải chặn trước bẫy **“gate một cặp, resolve scope một cặp khác”**
(memory `read-path-gate-pair-must-match-download-pair`) — vì `data_scope` là **PER-(permission, role)**,
gate lệch cặp = scope lệch.

Cách chặn: **một hằng số duy nhất**, dùng cho CẢ `@RequirePermission` lẫn `resolveAndAssert`:

```ts
// apps/api/src/org/org.permissions.ts
export const ORG_EMPLOYEE_DIRECTORY = { action: "read", resourceType: "user" } as const;
```

⇒ `S6-SEC-PERMVERB-1` chỉ đổi **một dòng** + migration, không thể để gate và scope trôi lệch nhau.

---

## 4. Các bước

1. **RED trước** — `test/integration/org-directory-scope.int-spec.ts`:
   role tenant `Team`/`Own` CÓ cặp đọc user → `GET /org/employees` phải **không** trả toàn tenant.
2. `DataScopeService`: thêm `buildUserScopeCondition(scope, ctx)` — vị từ hình-`users`, cùng ngữ
   nghĩa `AuthUsersService`. (**Không** thêm `isUserInScope`: đường `/org` chỉ LIST, không get-by-id
   — thêm bề mặt không có caller là code chết.)
3. `org.permissions.ts`: hằng số `ORG_EMPLOYEE_DIRECTORY`; `org.controller.ts` dùng nó cho
   `@RequirePermission`.
4. `OrgService.listEmployees(actor)`: `resolveAndAssert` → `buildUserScopeCondition` → truyền vị từ
   xuống repo. `OrgRepository.listEmployees(companyId, predicate)` AND vị từ vào SELECT, và **bound
   luôn `team_members`** theo tập user đã lọc (không để membership của người ngoài scope lọt ra).
5. **Xử lý pin cũ** ở `org-directory-permission.int-spec.ts` (done_when #4 — *“bỏ `is_system` HOẶC
   nêu rõ vì sao giữ”*): **GIỮ bộ lọc, ĐỔI ý nghĩa**. Xem §5.1.
6. Docs: `S6-SEC-ORG-1.md` §7 N-1 đánh dấu đóng · `permission-matrix-spec.md` CHỐT /org · RELEASE-02.
7. Verify: `lint + typecheck + build` + `check.sh --lane-db` (deny-path chạy THẬT).

---

## 5. Rủi ro & cách chặn

| Rủi ro | Chặn |
| --- | --- |
| Hồi quy màn RBAC console: user chưa có `employee_profile` biến mất | Chọn (b) — Company không join `employee_profiles`. **Test khoá** seed user không hồ sơ + khẳng định company-admin vẫn thấy |
| `Company` vô tình fail-closed ⇒ màn RBAC rỗng cho admin | Ca allow-path khẳng định **email cụ thể** có mặt (không dừng ở `Array.isArray`) |
| Gate và scope resolve **lệch cặp** khi PERMVERB đổi động từ | §3 — một hằng số dùng chung cho cả decorator lẫn service |
| `team_members` vẫn lộ membership của user ngoài scope | Bound `memberRows` theo tập id đã lọc; tập rỗng ⇒ bỏ hẳn truy vấn |
| Nới pin `is_system` bắt nhầm role phù du của spec khác trên cùng lane DB | §5.1 — giữ bộ lọc, đổi ý nghĩa ca |

### 5.1 Vì sao KHÔNG bỏ `is_system = true` khỏi pin cũ

done_when #4 cho hai đường; chọn **giữ**, vì:

1. **Tiền đề mà pin canh đã được thay bằng code.** Ca đó từng nói *“an toàn CHỈ VÌ mọi grant đều
   `Company`”*. Sau WO này repo ép `data_scope`, nên vế đó do
   `org-directory-scope.int-spec.ts` chứng minh trực tiếp — mạnh hơn một pin gián tiếp trên catalog.
2. **Bỏ bộ lọc sẽ làm ca ĐỎ NGẪU NHIÊN.** `org-directory-scope.int-spec.ts` **cố ý** seed role tenant
   `Own`/`Team`/`Department` trên đúng cặp `read:user` để dựng vế deny. Hai spec chạy song song trên
   cùng lane DB ⇒ pin mở rộng sẽ bắt phải chính role phù du của spec anh em.
3. **Ca vẫn còn giá trị, chỉ đổi LOẠI.** Migration cấp scope hẹp cho role hệ thống nay không gây rò
   nữa — nó gây **màn hình rỗng** (fail-closed). Vẫn là hồi quy đáng vỡ to tiếng. Thông điệp
   `expect` đã viết lại theo đúng nghĩa mới, không để ai đọc nhầm là hàng rào an toàn.

### 5.2 Sửa sau FULL gate (3 reviewer, 2026-07-28 — tất cả PASS)

Gate chạy: `security-reviewer` · `rls-tenant-isolation-tester` (**thay** `database-reviewer`, agent
không có trong môi trường) · `general-purpose` mang brief `silent-failure-hunter` (**thay** agent cùng
tên, không có) — theo tiền lệ `S6-SEC-ORG-1` §7c. **0 CRITICAL. 1 HIGH + 6 MEDIUM đã vá NGAY trong WO:**

| # | Phát hiện | Đã làm |
| --- | --- | --- |
| F1 (HIGH) | Nhánh fail-closed **im lặng tuyệt đối**. `getCapabilities` phát `{pair:true}` KHÔNG kèm `data_scope` ⇒ `useCan()` = true ⇒ console render "không có user nào" cho tenant có 45 người, admin không có đường chẩn | `logger.warn` ở nhánh `default` kèm `userId·companyId·scope`. (Mirror sang `auth-users` = nợ N-1b, không làm lẻ ở đây) |
| F2 (MED) | Comment ở repo nói `inArray` **vá một lỗ rò** — SAI: `membersByUser.get(u.id)` đã chặn theo id, bỏ `inArray` cũng không rò. Và test "khoá" nó xanh tầm thường (`uOwn` không thuộc team nào ⇒ xoá `inArray` vẫn xanh) | Comment hạ về đúng "defense-in-depth + chặn phình query"; `uOwn` vào `teamA`; ca đổi thành **khẳng định dương** (`teams == [teamA]`); bỏ `?? []` |
| F3 (MED) | Tôi biến census `org.permissions.spec.ts` từ pin **độc lập** thành **vòng tròn** — cho nó đọc chính hằng số controller đọc ⇒ đổi hằng số thành `read:team` census vẫn PASS | **Hoàn nguyên về literal**, kèm chú thích "đừng DRY, đây là pin độc lập". Comment ở `org.service.spec.ts` viết lại cho đúng thứ nó THẬT SỰ canh |
| F4 (MED) | Ca "không rò email" thiếu `expect(status)` ⇒ route 500/403 vẫn xanh; và xanh cả khi **bỏ hẳn cột `email`** khỏi projection | Thêm assert `200` + khẳng định **dương** đối trọng (`Own` PHẢI thấy email của chính mình) |
| F5 (MED) | Call-site dựng `ScopeContext` **thiếu** (không gọi `resolveContext`). Hôm nay vô hại; ngày ai đó dạy method này về `Team` thì nó lặng lẽ trả 0 hàng | Thu hẹp tham số thành `Pick<ScopeContext,"userId"\|"companyId">` ⇒ ngày đó **vỡ typecheck** ở mọi call-site thay vì rò im lặng |
| F6 (MED) | Docstring nói "mirrors `AuthUsersService` **exactly**" — không đúng (nhánh `Own` bản mới CÓ thêm vế tenant); và nói hai route "share one permission pair" — chưa đúng cho tới khi PERMVERB xong | Docstring sửa cả hai, ghi rõ **hợp nhất phải hợp nhất VỀ PHÍA bản chặt hơn** |
| — (MED) | Nợ N-1b/N-1c chỉ nằm trong **văn xuôi** plan, không có trong `backlog.mjs`/RELEASE-02 ⇒ "nợ không ai đòi" | N-1c seed thành WO `S6-SEC-ORGTEAMSCOPE-1` + mở trong RELEASE-02; N-1b vào `src[]` của `S6-SEC-PERMVERB-1`; back-reference hai chiều thêm vào `auth-users.service.ts` |

**LOW/INFO ghi nhận, KHÔNG sửa ở đây:** toán tử `??` trước vị từ `false` không thể chạm tới (nhưng
cần cho kiểu trả về `SQL`) · `inArray` không có trần bind-param (PROD 45 user/tenant, trần PG 65535) · thiếu composite
FK `team_members(company_id,team_id)` và policy `users_all_tenant_read`/`mediaos_readonly` mong manh
→ **đã chuyển thành ca cụ thể trong `src[]` của `S6-QA-TENANTWRITE-1`** · `resolveStrongestScope` nuốt
lỗi hạ tầng thành 403 "out of permission scope" (nợ N-3 toàn hệ, có sẵn từ trước).

### 5.3 Lỗ MỚI phát hiện, KHÔNG do WO này gây ra → `S6-SEC-ORGTEAMSCOPE-1`

2/3 reviewer chỉ độc lập vào cùng một chỗ: `GET /org/teams/:id/members` trả `userEmail` +
`userFullName`, gate **chỉ** `read:team`, **không** ép `data_scope`. Role `read:user@Own` +
`read:team@Company` ⇒ `/org/employees` trả đúng 1 hàng (N-1 đã khoá) rồi **`/org/teams` →
`/org/teams/:id/members` lấy lại trọn danh bạ email**. Gốc rễ chung: `PermissionGuard` không đọc
`data_scope` một lần nào. Mức: HIGH (rls-tester) / MEDIUM (security-reviewer); không BLOCK PR này vì
nằm ngoài `paths` đã khai và không do nó gây ra — **nhưng nó khiến câu "N-1 đóng" phải kèm điều kiện**,
nên đã ghi vào RELEASE-02 + `permission-matrix-spec.md` + backlog thay vì để trôi.

## 6. Ngoài phạm vi

- Đổi động từ `read:user` → `view:user` — là `S6-SEC-PERMVERB-1` (cần migration).
- Thêm org-mapping `Team/Department` cho `users` (xem §2.1).
- Gộp `/org/employees` vào `/hr/employees` — nợ kiến trúc, WO riêng.
- Refactor `AuthUsersService` để dùng chung vị từ mới: **cố ý không làm** — `UsersModule` chưa inject
  `DataScopeService`, thêm phụ thuộc DI vào đường `/auth/users` (crown) để đổi lấy DRY là **đánh đổi
  sai** ở WO này (memory `systemjobhandler-optional-dbw-di` — sai DI đổ dây chuyền 100+ int-spec).
  ⇒ **nợ N-1b**, nay đã ĐĂNG KÝ THẬT (không chỉ trong văn xuôi): `src[]` của `S6-SEC-PERMVERB-1` +
  chú thích trỏ **hai chiều** ở cả `data-scope.service.ts` lẫn `auth-users.service.ts`.

## 7. Bằng chứng RED → GREEN (lane `mediaos_orgscope`, chain `0000→0532` áp sạch)

**TRƯỚC khi vá** — `vitest run test/integration/org-directory-scope.int-spec.ts`:

```text
Tests  5 failed | 2 passed (7)

FAIL  scope `Own` → CHỈ thấy chính mình (không phải toàn tenant)
FAIL  scope `Team` → 0 hàng (fail-closed: `users` không có org-mapping — plan §2.1)
FAIL  scope `Department` → 0 hàng (fail-closed)
FAIL  scope hẹp KHÔNG rò email của người ngoài scope (khẳng định trên THÂN phản hồi)
FAIL  scope hẹp KHÔNG rò membership team của người ngoài scope
        AssertionError: expected [ { …(3) }, { …(3) } ] to deeply equal []
```

**2 ca PASS ngay từ vòng RED là có chủ đích** — đó là hai chốt *chống siết quá tay* (`Company` thấy
mọi user kể cả người chưa có `employee_profile`, và vẫn trả membership team). Chúng phải xanh ở CẢ
hai vòng; nếu vòng GREEN làm chúng đỏ thì bản vá đã đi quá tay.

**SAU khi vá** — `org-directory-scope` + `org-directory-permission` + `src/org/**` +
`src/permission/data-scope.service.spec.ts`:

```text
Test Files  7 passed (7)      Tests  210 passed (210)     ← int + org unit
Test Files  6 passed (6)      Tests  231 passed (231)     ← + data-scope unit
```

## 8. Mở rộng `paths` (memory `wo-paths-drive-gate-and-scheduler`)

`paths` gốc chỉ khai `apps/api/src/org/**`. Vị từ dùng chung nằm ở `DataScopeService` ⇒ **phải khai
thêm** `apps/api/src/permission/**`, nếu không diff lọt LIGHT gate.
