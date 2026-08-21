# S10-SEC-AUDITLOGROW-1 — KI-070: `data_scope` chặn TẬP HÀNG của hai bảng nhật ký

> Vùng đỏ (phân quyền + đường đọc dữ liệu audit). Plan viết TRƯỚC code theo CLAUDE.md §6.
> Bảng chạm: `login_logs` · `user_security_events` — **append-only**, chỉ đổi đường ĐỌC.
>
> **Vòng plan-review 1 (2026-08-21): REVISE** — 5 chặn + 9 cảnh báo + 6 nhỏ. Bản này đã hấp thụ toàn
> bộ; các mục mang dấu `⟲R1` là thứ ĐỔI so với bản đầu, giữ lại lý do để phiên sau không "sửa ngược".

---

## 0. Số đo — ĐO LẠI 2026-08-21 (không dùng lại số 30/07 hay 19/08)

### 0.1 Ai giữ cặp nào, ở scope nào (PROD, DB `mediaos`)

```sql
SELECT r.name, coalesce(c.slug,'(system)'), rp.effect, p.action, p.resource_type, rp.data_scope,
       p.is_sensitive, (SELECT count(*) FROM user_roles ur
                        WHERE ur.role_id=r.id AND (ur.expires_at IS NULL OR ur.expires_at>now()))
FROM role_permissions rp JOIN roles r ON r.id=rp.role_id
LEFT JOIN companies c ON c.id=r.company_id JOIN permissions p ON p.id=rp.permission_id
WHERE (p.action,p.resource_type) IN (('view','audit-log'),('view','user'));
```

| vai | công ty | cặp | effect | data_scope | is_sensitive | người giữ |
| --- | --- | --- | --- | --- | --- | --- |
| `QUẢN LÝ CẤP CAO` | funtime | `view:audit-log` | ALLOW | **Company** | ✔ | 4 |
| `SA` | funtime | `view:audit-log` | ALLOW | **Company** | ✔ | 10 |
| `company-admin` | (system) | `view:audit-log` | ALLOW | **Company** | ✔ | 2 |
| `QUẢN LÝ CẤP CAO` | funtime | `view:user` | ALLOW | Company | ✘ | 4 |
| `SA` | funtime | `view:user` | ALLOW | Company | ✘ | 10 |
| `company-admin` | (system) | `view:user` | ALLOW | Company | ✘ | 2 |
| `hr` | (system) | `view:user` | ALLOW | Company | ✘ | 0 |

Wildcard: `SA` và `QUẢN LÝ CẤP CAO` có `*:*@Company`, nhưng `view:audit-log` là `is_sensitive=true`
⇒ wildcard **KHÔNG** thoả (guard + `resolveStrongestScope` cùng luật). Không có hàng `DENY` nào.

Khối lượng: `login_logs` **366** hàng · `user_security_events` **65** · `users` **48**.

**Kết luận:** **0 vai** giữ `view:audit-log` ở scope hẹp hơn Company ⇒ lỗ KI-070 hôm nay **chưa ai với
tới được**; nó là lỗ **tiềm tàng** — vai đúc sau này ở scope hẹp sẽ đọc trọn hai bảng. Căn cứ để WO
này KHÔNG phải hotfix, và cũng là căn cứ để nó phải đóng trước khi có vai thứ tư.

### 0.2 ⟲R1 Census ĐƯỜNG ĐỌC hai bảng (bằng chứng cho "bản vá không phải vá nửa")

Grep `apps/api/src` cho `loginLogs` / `userSecurityEvents` — chỉ **hai** đường đọc:

| đường | căn cứ bound | WO này chạm? |
| --- | --- | --- |
| `login-log.repository.ts` + `security-event.repository.ts` (route `/auth/login-logs`, `/auth/security-events`) | **không có** ← khuyết tật | ✔ |
| `me-security-activity.repository.ts:62-76` (`GET /me/security/activity`) | **actor-locked cứng trong SQL** (`user_id = :actor`) | ✘ đã kín |

`retention.service.ts:45-51` chỉ liệt kê hai bảng trong `PROTECTED_TABLES` (chặn XOÁ), không đọc.
`auth-users.service.ts:109` là comment về đường GHI. ⇒ vá hai repository là **đủ**, không sót đường.

---

## 1. Khuyết tật — ba vế, phát biểu chính xác

`S6-SEC-IDENTITY-PROJ-1` bound **CỘT** danh tính (email/họ tên đi theo `data_scope` của cặp danh bạ
`view:user`). Nó **KHÔNG** bound **HÀNG**.

**V1 — tập hàng không có vị từ scope.** `AuthLogsViewerService.listLoginLogs` / `listSecurityEvents`
gọi `withTenant(companyId)` rồi `findManyTx(tx, filter, …)`. `LoginLogRepository.buildWhere` dựng
`WHERE` **chỉ từ `filter`**, mà `filter` **chỉ từ query param của caller**. Không gì resolve
`data_scope` của cặp GATE `view:audit-log`. ⇒ vai `view:audit-log@Own` đọc trọn 366 hàng login
(`user_id`, IP, UA, mốc thời gian, `failure_reason`) + 65 hàng security-event (`user_id`,
`actor_user_id`, `event_type`, `severity`, IP, UA).

**V2 — `filter.userId` đi thẳng từ query param.** `query.user_id` → `LoginLogFilter.userId` →
`eq(loginLogs.userId, filter.userId)`. Không đối chiếu vị từ scope nào ⇒ dò được lịch sử đăng nhập
của **một UUID bất kỳ trong tenant**. Nặng hơn V1: nó biến bảng nhật ký thành oracle **có điều
khiển** thay vì một đống hàng phải lọc bằng mắt.

**V3 — `countTx` cũng không có vị từ.** Cùng `buildWhere`. Ai chỉ vá `findManyTx` thì
`pagination.total` vẫn phát ra **số hàng ngoài scope** — oracle đếm được, im lặng, không lộ ở `data`.
Vế này KHÔNG có trong KI-070; ghi ra để nó không thành khoảng trống lần thứ hai.

Cùng lớp lỗi KI-053 (gate đúng / `data_scope` không được đọc lần nào).

---

## 2. Quyết định thiết kế

### D1 — Chọn đường "bound HÀNG", KHÔNG chọn "Company-only + trần scope"

KI-070 cho hai đường: (a) `data_scope` chặn tập hàng; (b) tuyên bố nhật ký là Company-only rồi ép
bằng `resolveAndAssert` + trần scope (403 khi scope < Company).

**Chọn (a).** Căn cứ **duy nhất và đủ**: `done_when` #3 đòi *"`userId` từ caller phải được ĐỐI CHIẾU
với vị từ scope đã resolve"* — câu đó chỉ có nghĩa khi tồn tại một vị từ scope, tức đường (a).

⟲R1 **Đính chính lý lẽ bản đầu:** bản đầu viện dẫn "cho nhân viên xem lịch sử đăng nhập của CHÍNH
MÌNH". Lý lẽ đó **SAI THỰC TẾ** — ngữ nghĩa ấy đã có route riêng `GET /me/security/activity`, khoá
cứng vào actor trong SQL (`me-security-activity.repository.ts:62-76`). Giữ nguyên kết luận, sửa lý do:
đường (b) sẽ thêm một **trần scope** (403 khi < Company) mà `done_when` #3 không đòi và không ai đo
được là đúng; đường (a) giữ `data_scope` làm knob DUY NHẤT, đúng khuôn §13.

### D2 — ⟲R1 Cặp bound = cặp GATE = `view:audit-log`; fail-closed **có để lại vết**

Khác vế bound-CỘT: ở đó cặp GATE (`view:audit-log`) ≠ cặp BOUND (`view:user`) ⇒ `resolveOrNull`
(khuôn N-1c). Ở vế bound-HÀNG thì **cặp gate chính là cặp bound** ⇒ `null` khi guard đã cho qua nghĩa
là **guard và trình phân giải scope BẤT ĐỒNG** — trạng thái không được im lặng.

**Bản đầu đề xuất `resolveAndAssert`. ĐỔI.** Đo được: `data-scope.service.ts:80-83` chỉ
`throw new ForbiddenException("AUTH-ERR-FORBIDDEN: out of permission scope")` — **không một dòng log
nào**. 403 đó không phân biệt được với 403 của guard ở mọi tầng vận hành, tức plan bản đầu hứa
"ồn ào" mà code không ồn ào. Thay bằng, trong `AuthLogsViewerService`:

```text
scope = dataScope.resolveOrNull(actor.id, actor.companyId, "view", "audit-log", { isSensitive: true })
if (scope === null) {
  logger.error("auth-logs: guard cho qua nhưng resolveStrongestScope trả null — guard và trình phân
                giải scope BẤT ĐỒNG", { userId, companyId, where })
  throw new ForbiddenException("AUTH-ERR-FORBIDDEN: out of permission scope")   // GIỮ NGUYÊN chuỗi
}
```

- Giữ **nguyên văn** message của `resolveAndAssert` ⇒ response không đổi ⇒ không đẻ oracle mới phân
  biệt "403 guard" với "403 scope".
- **KHÔNG** nhét log vào trong `resolveAndAssert`: đo được **101 lượt gọi / 42 file**, phần lớn dùng
  nó làm cổng DUY NHẤT, ở đó `null` là deny BÌNH THƯỜNG ⇒ log `error` thành báo động giả hàng loạt.

`{ isSensitive: true }` **bắt buộc** — soi gương `@RequirePermission("view","audit-log",{isSensitive:true})`.
Không truyền vẫn đúng hôm nay (catalog `is_sensitive=true` nên `effectivelySensitive` tự bật), nhưng
đúng **nhờ dữ liệu**, không nhờ code: lật cờ catalog là route mở cho wildcard mà không ai thấy.

**Đã đo, KHÔNG có 403 hồi quy** (câu hỏi rủi ro số 1 của vòng review):

- **Object-grant bất khả thi trên hai route này.** Guard chỉ truyền `resourceId` khi
  `isSensitive && requiresReauth` (`permission.guard.ts:121-122`); controller **không** khai
  `requiresReauth` ⇒ `needsObjectGrant = false` (`permission.decide.ts:93`).
- **Không có bypass super-admin/platform:** `APP_GUARD` toàn cục chỉ `JwtAuthGuard` + `CompanyGuard` +
  `TwoFactorEnforcementGuard`; `PermissionGuard` opt-in per-controller.
- **PAT/api-key cùng tập grant:** guard chỉ *thu hẹp* bằng `scopeKeys` rồi vẫn gọi `can()` trên grant
  THẬT của user — cùng nguồn `resolveStrongestScope`.
- **Cổng sensitive khớp bit-by-bit:** `decideCan` lọc `action!=="*" && resourceType!=="*"`
  (`permission.decide.ts:105`) ≡ `isExact` (`permission.service.ts:594-595`).

⟲R1 **Hai khe hở CÒN LẠI, cả hai fail-closed, phải GHI chứ không vá:**

- **K1 — kill-switch.** `PERMISSION_GUARD_ENABLED=false` làm guard fail-open
  (`permission.guard.ts:62-72`) nhưng vị từ hàng vẫn 403 cho người KHÔNG có grant. Tức kill-switch
  **không mở được** hai route này cho người ngoài. Đúng chiều an toàn, **CHỦ Ý**, ghi vào RELEASE-02.
  Tuyệt đối không "sửa" bằng cách cho vị từ đọc cờ kill-switch — đó là cửa sau.
- **K2 — bất đối xứng cache.** `getCompanyRoleGrants` (guard) **có** cache 300s
  (`permission.cache.ts:52-89`); `getCompanyRoleGrantsWithScope` (scope) **không**
  (`permission.cache.ts:95-100`, passthrough cố ý). Cửa sổ ≤300s sau khi gỡ role: guard cho qua ↔
  scope `null` ⇒ 403 + log `error` của D2. **403 là hành vi CHỦ Ý** (quyền đã bị gỡ thật). Ghi rõ để
  phiên sau KHÔNG "hoà giải" bằng cách cache luôn `WithScope` — đó mới là nới.

### D3 — Vị từ dựng bằng `buildUserScopeConditionOn` (TÁI DÙNG lattice, KHÔNG viết bản thứ ba)

| scope | `login_logs` | `user_security_events` |
| --- | --- | --- |
| `System` / `Company` | `company_id = :tenant` | `company_id = :tenant` |
| `Own` | `company_id = :tenant AND user_id = :actor` | `company_id = :tenant AND user_id = :actor` |
| `Team` / `Department` / không rõ | `false` (0 hàng) + `logger.warn` | như trên |

Gọi `buildUserScopeConditionOn(scope, {userId, companyId}, { idCol: <bảng>.userId, companyIdCol:
<bảng>.companyId })` — hình dạng khớp chính xác ("idCol mang `users.id` của CHỦ THỂ hàng").

**Vì sao tái dùng:** lattice đã có **hai** bản (`buildEmployeeScopeCondition` shape
`employee_profiles`, `buildUserScopeConditionOn` shape `users`) và nợ N-1b ghi việc nhân bản đó là nợ.
Bản thứ ba sẽ trôi ngay lần đầu ai sửa một trong ba.

**Cái giá — nói thẳng:** nợ N-1b dự tính "sàn hoá Team/Department xuống vị từ Own". Ngày trả nợ đó,
tập hàng hai route nhật ký **cũng đổi theo** (0 hàng → hàng của chính mình). Chiều NỚI ⇒ không được
âm thầm. Chống bằng int-spec ghim tập hàng **từng scope** trên chính hai route này (ca T1) ⇒ sửa
lattice mà không đọc WO này sẽ ĐỎ. Không dựa vào docblock.

⟲R1 **`login_logs.company_id` NULLABLE — đã kiểm, KHÔNG mất hàng oan.** `migrations/0532_*.sql:61-66`
đặt `USING (company_id = NULLIF(current_setting(...),'')::uuid)` — RLS **đã** loại hàng `NULL` khỏi
đường ứng dụng từ KI-042. `eq(companyId, tenant)` chỉ lặp lại điều RLS đã ép ⇒ 0 hàng hợp lệ bị mất.

⟲R1 **Sửa thông điệp log nhánh `default:`** (`data-scope.service.ts:263-266`): hôm nay ghi
*"account-directory read resolved to a scope with no defined membership on `users`"*. Sau bản vá nó
bắn cho `/auth/login-logs@Team` và chỉ người trực ca vào **nhầm route + nhầm bảng**. Thêm
`table: getTableName(target.idCol.table)` vào payload log. **Chỉ payload — KHÔNG đụng vị từ.**

### D4 — `identityGrantFor` (cột) và vị từ hàng là HAI thứ độc lập, KHÔNG gộp

Cột danh tính vẫn theo `view:user` (`resolveOrNull`, `identity-gated`). Hàng theo `view:audit-log`
(`scoped-predicate`). Gộp một là hồi quy đúng lỗ mà `S6-SEC-IDENTITY-PROJ-1` vừa đóng. Ma trận sau
bản vá — đây là thứ int-spec PHẢI phủ, không phải một câu hứa:

| `view:audit-log` | `view:user` | hàng thấy | khoá `email` |
| --- | --- | --- | --- |
| Company | Company | tất cả trong tenant | có |
| Company | (không có) | tất cả trong tenant | **vắng khoá** |
| Own | Company | chỉ hàng của chính mình | có (trên tập hẹp đó) |
| **Own** | **Own** | chỉ hàng của chính mình | chủ thể (=tôi) CÓ · actor người khác **vắng** |
| Team/Department | bất kỳ | **0 hàng** | — |
| (không có) | bất kỳ | 403 ở guard | — |

⟲R1 Dòng `Own × Own` là bổ sung của vòng review: đó là ô mà **ba** vị từ trông giống hệt nhau
(`user_id = actor` trên `login_logs`, trên `users`, trên `sec_event_actor`) — đúng chỗ một bản vá
"gộp cho gọn" sẽ trông xanh mà sai.

### D5 — ⟲R1 Vị từ đi qua kiểu ÉP ĐƯỢC + truyền bằng OBJECT CÓ TÊN

Tái dùng brand `IdentityGrant` với `basis: "scoped-predicate"` — nhánh basis này đã có sẵn, docblock
ghi nguyên văn *"Vị từ `data_scope` chặn TẬP HÀNG"*, và chưa điểm nào dùng. Đúc bằng
`fromScope(cond, "scoped-predicate", why, targetIdCol)`.

Được ba thứ mà `SQL` trần không có: **brand** (chỉ đúc qua 4 constructor) · **`table`** (grant nhớ nó
nói về bảng nào) · **`why`** (câu cho người trực ca).

Thêm `rowScopeSql(grant, target)`: assert **`grant.basis === "scoped-predicate"`** *và*
`grant.table === tableOf(target)` rồi mới trả `grant.cond`.

- Assert `basis` là **siết một chiều**, không mở gì. ⚠️ **KHÔNG** thêm assert đối xứng vào
  `identityColumns` — 21 dòng sổ phán quyết mang basis `scoped-predicate` là điểm chiếu CỘT hợp lệ
  (`identity-projection-verdicts.ts:534-546`); siết ở đó sẽ ĐỎ hàng loạt call-site vốn đúng.
- ⟲R1 **Ranh giới thật của assert `table`, ghi thẳng vào docblock, đừng để đọc mạnh hơn thực tế:**
  cả nơi ĐÚC (service) lẫn nơi TIÊU THỤ (repo) đều hard-code cùng một hằng cột ⇒ nó **chỉ** bắt được
  ca "đem grant của bảng KIA sang", không bắt được ca "cả hai cùng sai".

**Truyền bằng object có tên, KHÔNG bằng vị trí.** Sau bản vá,
`securityEvents.findManyTx` có **ba** giá trị cùng kiểu `IdentityGrant` (`rowScope`,
`identitySubject`, `identityActor`) — phân biệt nhau **chỉ bằng vị trí** thì hoán vị là **hợp kiểu**,
và assert bảng chỉ bắt được nhờ *tai nạn may mắn* là ba bảng khác nhau, lại chỉ nổ ở **lần chạy truy
vấn đầu tiên** chứ không ở typecheck. Đó đúng hình dạng lỗ B1 mà KI-054 đã trả giá. ⇒ chữ ký:

```ts
findManyTx(tx, filter, page: { sort, order, limit, offset },
           grants: { rowScope: IdentityGrant; identitySubject: IdentityGrant; identityActor: IdentityGrant })
countTx(tx, filter, grants: { rowScope: IdentityGrant })
```

`rowScope` **BẮT BUỘC** trên cả hai hàm — quên = ĐỎ typecheck, không phải rò im lặng (V3).

### D6 — `filter.userId` đối chiếu bằng GIAO, không bằng 403

`buildWhere` ⇒ `and(rowScopeSql(rowScope, <bảng>.userId), ...conds)` — vị từ scope là thành phần
**đầu tiên, không bỏ được**. `Own` + `?user_id=<người khác>` ⇒ `user_id = other AND user_id = me` ⇒
**0 hàng, HTTP 200**.

**Vì sao GIAO chứ không 403:** 403 phân biệt "UUID ngoài scope của bạn" với "UUID không có hàng" ⇒
trả lời được *"UUID này có tồn tại/hoạt động không"* = oracle mềm. 200-rỗng không phân biệt được.
Khớp hành vi cross-tenant đã ghim từ S2 (ca X4, `auth-logs-viewer.int.spec.ts:299-314`).

### D7 — `Own` trên security-event bám CHỦ THỂ, KHÔNG bám người-gây-ra

Vị từ `user_id = actor`, **không** `OR actor_user_id = actor`. `Own` = "sự kiện VỀ tôi". Nới vế actor
cho một vai `Own` liệt kê mọi người mình từng tác động ⇒ tập hàng thành hàm của **lịch sử hành vi**,
không kiểm được bằng luật nào. Hôm nay 0 vai giữ `Own` ⇒ 0 hồi quy. Ghi vào docblock + RELEASE-02.

Chiều ngược lại (chủ thể = tôi, actor = người khác) **vẫn hiện** ở scope Own — đúng: đó là sự kiện về
tôi. Nó phơi `actor_user_id` (UUID) + IP/UA của hàng; **cột danh tính của actor vẫn bị bound riêng
bởi `view:user`** qua `identityActor` (không đổi). Ca `Own × Own` ở D4 ghim đúng chiều này.

### D8 — ⟲R1 ORDER BY: tie-break + ratchet neo vào CỘT THẬT (`done_when` #4)

**(a) Đo:** allowlist sort `login_logs` = `{created_at, status}`; `user_security_events` =
`{created_at, severity, event_type}`. Cả 5 là cột của chính bảng nhật ký, **không cột nào bị che** ⇒
hôm nay không có oracle thứ tự (khác `role-admin` `ORDER BY users.email` / `leave-admin`
`orderBy(asc(users.fullName))` — hai chỗ đã mắc bẫy KI-069).

**(b) Tie-break — bản đầu BỎ SÓT.** Cả hai `orderBy()` sắp theo **đúng một cột**, không khoá phụ.
`sort=status` trên 366 hàng chỉ có 3 giá trị ⇒ ranh giới trang **không xác định** với `OFFSET` ⇒
mất/lặp hàng giữa các trang, và chính int-spec mới có thể flake. Thêm `desc(id)` làm khoá phụ — đúng
khuôn `me-security-activity.repository.ts:116`. *(Không phải oracle chéo-scope — vị từ lọc TRƯỚC
ORDER BY — nhưng là bug đúng chỗ WO này đang mở nắp.)*

**(c) Ratchet — bản đầu là xanh-RỖNG.** "Giao allowlist sort với `{email, fullName}` phải RỖNG" luôn
đúng **theo cấu tạo**: allowlist là chuỗi API snake_case (`created_at`/`status`/…), không bao giờ
trùng chuỗi `email`; ai thêm `sort=user_email` vẫn XANH. Ratchet PHẢI: ánh xạ **mỗi khoá sort sang
cột drizzle THẬT** mà `orderBy()` chọn, rồi assert `getTableName(col.table) ∈ {login_logs,
user_security_events}`. Neo ĐỊNH NGHĨA, không neo tên (`index-ratchet-must-pin-definition-not-name`).

**(d) ⟲R1 Pin vùng mù `login_logs.email` / `normalized_email`.** Census chỉ bind cột danh tính tới
bảng `users` (`identity-projection-census.ts:32,110-113`) ⇒ hai cột này **vô hình** với ratchet. Hôm
nay không được select nên an toàn; người sau thêm `email: loginLogs.email` sẽ được ratchet cấp giấy
thông hành. Thêm một assert tĩnh trong cùng spec: nguồn hai repository **không** chiếu
`loginLogs.email` / `loginLogs.normalizedEmail`. *(Bằng chứng yếu — parse tĩnh — nhưng nó là PIN,
không phải census; ghi rõ ranh giới đó trong docblock spec.)*

### D9 — `withTenant` + RLS giữ nguyên là vành đai NGOÀI

Vị từ scope là vành đai TRONG. Không tháo cái nào. Vị từ **luôn** mang `company_id` kể cả khi RLS đã
ép — không bao giờ để một vị từ trần có thể match-all nếu RLS bị bypass.

Phân giải scope gọi **TRƯỚC** `withTenant` (nó tự mở `withTenant` riêng trong
`getCompanyRoleGrantsWithScope`) — giữ khuôn `identityGrantFor` hôm nay, không lồng transaction.

### D10 — Lưới scope KHÔNG đơn điệu, và điều đó phải được PHÁT BIỂU

Vai giữ ĐỒNG THỜI `view:audit-log@Own` và `@Team` ⇒ `resolveStrongestScope` lấy scope MẠNH hơn =
`Team` ⇒ 0 hàng ⇒ **thêm một role làm MẤT hàng**. Đúng nợ N-1b, nay lây sang đường nhật ký vì D3 tái
dùng chính lattice đó. Sai **về phía hẹp** (không bao giờ về phía rò), hôm nay 0 vai ở
Team/Department ⇒ chấp nhận, KHÔNG vá kèm (sàn hoá phải làm cho CẢ ba đường cùng lúc). Ghi RELEASE-02
như ranh giới có tên.

### D11 — ⟲R1 Phân giải mỗi cặp ĐÚNG MỘT LẦN / request

Hôm nay `listSecurityEvents` gọi `resolveOrNull("view","user")` **hai lần với tham số y hệt**
(`auth-logs-viewer.service.ts:137-148`), mỗi lần một truy vấn DB **không cache**
(`permission.cache.ts:95-100`). Thêm cặp `view:audit-log` nữa là **ba** lượt.

Tách làm hai bước: `resolveDirectoryScope(actor)` → `DataScope | null` (log `warn` **một lần** nếu
`null`), rồi dựng **hai** grant từ cùng giá trị đó bằng `buildUserScopeConditionOn` với cột của từng
vai. Kết quả: 2 lượt/request (audit-log + user) thay vì 3, và **hành vi không đổi** — hai grant vẫn
độc lập, vẫn dựng trên cột của vai mình (lỗ B1 vẫn đóng).

### Đường đã LOẠI (đừng mở lại)

- **Guard tự phơi `data_scope` ra request rồi handler tự dùng** — handler VẪN tự chọn dùng hay không
  ⇒ thêm một thứ TUỲ CHỌN không biến bug im lặng thành bug ồn ào.
- **Nhét vị từ scope vào `LoginLogFilter` như field optional** — optional = quên được = đúng V3.
- **Chỉ vá `findManyTx`, để `countTx` nguyên** — là V3.
- **403 khi `user_id` ngoài scope** — D6, đẻ oracle tồn-tại.
- **Cho vị từ hàng đọc cờ `PERMISSION_GUARD_ENABLED`** — K1, đó là cửa sau.
- **Cache `getCompanyRoleGrantsWithScope` để "hoà giải" K2** — đó là nới.
- **Thêm assert `basis` vào `identityColumns`** — D5, ĐỎ oan 21 điểm chiếu hợp lệ.

---

## 3. Vế RED — viết TRƯỚC, phải ĐỎ trên cây hôm nay

File mới: `apps/api/test/integration/audit-log-row-scope.int-spec.ts`
(gate `hasDb && LANE_DB` — `integration-test-lane-db-gate`).

⟲R1 Mọi lượt gọi dùng **`?per_page=100`**: mặc định `per_page=20` và **mỗi lượt `login()` của fixture
tự sinh thêm một hàng `login_logs`** ⇒ assert trên trang mặc định là xanh-rỗng hoặc flake.
⟲R1 Fixture khai đúng cờ catalog: `seedPermissionCatalog(…, "view","audit-log", true)` và
`(…, "view","user", false)` — sai cờ thì helper NÉM (`test/helpers/seed.ts:263+`).

Fixture (1 tenant, 6 người):

| người | `view:audit-log` | `view:user` | vai trò trong ca |
| --- | --- | --- | --- |
| `uCompany` | Company | Company | **đối chứng ALLOW** |
| `uOwn` | **Own** | Company | hình dạng lỗ (cột KHÔNG phải biến nhiễu) |
| `uOwnOwn` | **Own** | **Own** | ⟲R1 ô nguy hiểm nhất của ma trận D4 |
| `uTeam` | **Team** | Company | fail-closed |
| `uCoNoDir` | Company | (không có) | ma trận D4 chiều còn lại |
| `uOther` | — | — | chủ thể/tác nhân hàng của người khác |

Seed: login_logs cho cả 6 (đăng nhập thật + hàng chèn tay `created_at` tường minh) + **một hàng
`user_id IS NULL`** (fail pre-auth đã resolve company); `user_security_events` hai chiều (chủ thể
`uOwn`/tác nhân `uOther` và ngược lại) + một cặp tương tự cho `uOwnOwn`.

| ca | khẳng định | ĐỎ hôm nay vì |
| --- | --- | --- |
| **R1** 🔴 | `uOwn` GET `/auth/login-logs?per_page=100` ⇒ **mọi** hàng `user.id === uOwn` | hôm nay thấy hàng của 5 người kia |
| **R2** 🔴 | `uOwn` GET `…?user_id=<uOther>&per_page=100` ⇒ `data` rỗng **VÀ** `pagination.total === 0` | hôm nay trả đúng hàng của uOther (V2) + total > 0 (V3) |
| **R3** 🔴 | `uOwn` GET `/auth/security-events?per_page=100` ⇒ mọi hàng `user.id === uOwn`; hàng "chủ thể=uOther, tác nhân=uOwn" **KHÔNG** có mặt (D7) | hôm nay thấy cả hai hàng |
| **R4** 🔴 | `uOwn`: `pagination.total === data.length` **VÀ** `=== <số hàng seed của uOwn>` (hằng tính từ fixture, không phải "số hàng trả về") | hôm nay total = tổng toàn tenant |
| **A1** ✅ | `uCompany` thấy **đủ** hàng của cả 6 người, cả 2 route | chống ca DENY xanh-RỖNG |
| **A2** ✅ | `uOwn` vẫn thấy **≥1 hàng** của chính mình, cả 2 route | chống "0 hàng vì route hỏng" |
| **A3** ✅ | `uOwn` + `?user_id=<uOwn>` ⇒ ra đúng hàng của mình (giao KHÔNG chặn oan) | |
| **T1** | `uTeam` ⇒ 200 + **0 hàng** + `total === 0`, cả 2 route (D3 fail-closed) | |
| **N1** | ⟲R1 `uCompany` thấy hàng `user_id IS NULL`; `uOwn` **KHÔNG** thấy | ghim chiều pre-auth |
| **X1** | `uOwn` (có `view:user@Company`) ⇒ hàng của mình VẪN có khoá `email` (D4 — bound hàng KHÔNG kéo theo mất cột) | |
| **X2** | `uCoNoDir` ⇒ đủ hàng nhưng **vắng khoá** `email` | ma trận D4 |
| **X3** | ⟲R1 `uOwnOwn` trên `/auth/security-events`: hàng chủ thể=mình/tác nhân=`uOther` ⇒ `user.email` **CÓ**, `actor.email` **VẮNG KHOÁ** | soi gương C2 dưới vị từ hàng mới |
| **G1** | vai KHÔNG có `view:audit-log` ⇒ 403 ở guard (bản vá KHÔNG nới route) | hồi quy D1/D2 |

**Chứng minh RED không rỗng:** sau khi GREEN, tạm vô hiệu `rowScopeSql` (trả `sql\`true\``) và ghi
lại ca nào ĐỎ. ⟲R2 **ĐO THẬT 2026-08-21 = 7 ca: R1·R2·R3·R4·T1·N1·X3** (dự đoán của bản plan là 6 —
thiếu **X3**, vì vế HÀNG của nó `rows.every(user.id === uOwnOwn)` cũng gãy khi bỏ vị từ). ⚠️ **X1
KHÔNG đỏ và KHÔNG được tính** — nó hỏi *"hàng của CHÍNH MÌNH có còn khoá `email`"*, tức tầng CỘT;
đưa nó vào danh sách RED là tự cấp bằng chứng chưa đo. 7 ca còn lại GIỮ XANH (A1·A1b·A2·A3·X1·X2·G1). Ghi vào RELEASE-02 (khuôn A2/C2/C3 của
`S6-SEC-IDENTITY-PROJ-1`).

**Unit (không cần DB):**

- `apps/api/src/auth/auth-log-sort-allowlist.spec.ts` — ratchet D8(c) + pin D8(d).
- `apps/api/src/permission/identity-projection.spec.ts` *(append)* — `rowScopeSql` ném khi lệch bảng
  **và** khi lệch `basis`.
- ⟲R1 `apps/api/src/auth/auth-logs-viewer.service.spec.ts` — ca `resolveOrNull("view","audit-log")`
  trả `null` ⇒ cả hai list method **ném `ForbiddenException`** (phủ nhánh D2, thứ mà không có ca nào
  chạm nếu chỉ có int-spec).

---

## 4. Thi công — theo file

1. **`harness/backlog.mjs`** *(⟲R1 làm TRƯỚC khi code)* — `paths` hiện thiếu
   `security-event.repository.ts` và spec mới; đổi sang `apps/api/src/auth/**` (memory
   `wo-paths-drive-gate-and-scheduler`: `paths` lái cả `guard-scope` lẫn routing gate).

2. **`apps/api/src/permission/identity-projection.ts`** *(append)* —
   `export function rowScopeSql(grant: IdentityGrant, target: PgColumn): SQL`: assert `basis` +
   assert `table`, trả `cond`. Không đổi hàm nào đang có.

3. **`apps/api/src/permission/data-scope.service.ts`** — chỉ thêm `table` vào payload `logger.warn`
   nhánh `default:` (D3). **Không đụng vị từ.**

4. **`apps/api/src/auth/login-log.repository.ts`** — chữ ký object-có-tên (D5); `buildWhere(rowScope,
   filter)` ⇒ `and(rowScopeSql(rowScope, loginLogs.userId), …conds)` (luôn ≥1 điều kiện ⇒ bỏ nhánh
   `undefined`); `orderBy` thêm `desc(id)` (D8b).

5. **`apps/api/src/auth/security-event.repository.ts`** — đối xứng, target
   `userSecurityEvents.userId`.

6. **`apps/api/src/auth/auth-logs-viewer.service.ts`** — `rowScopeFor()` theo D2 (resolveOrNull +
   `logger.error` + `ForbiddenException` giữ nguyên chuỗi); `resolveDirectoryScope()` một lần (D11);
   truyền `rowScope` vào **cả** `findManyTx` lẫn `countTx`. Docblock lớp: bỏ "Company-scope" như một
   sự thật, thay bằng phát biểu hai tầng (hàng ← `view:audit-log`, cột ← `view:user`) + ranh giới D7.

7. **`apps/api/src/auth/auth-logs-viewer.service.spec.ts`** — ⟲R1 bổ sung `resolveOrNull` cho cặp
   audit-log vào stub (hôm nay stub chỉ có `resolveOrNull` trả một giá trị cho MỌI cặp — phải cho nó
   phân biệt cặp) + ca 403 của D2.

8. **`apps/api/src/auth/auth-logs-viewer.int.spec.ts`** — ⟲R1 sửa **comment** ở `:496` và `:568`
   ("buildWhere trả `undefined` — phủ nhánh no-conds") vì §4.4 bỏ nhánh đó. Assert không đổi.

9. **`apps/api/test/foundation/identity-projection-verdicts.ts`** — cập nhật `reason` của 6 điểm
   `login-log.repository`/`security-event.repository`: thêm vế bound-HÀNG + số hiệu WO này. Không đổi
   `basis` (cột vẫn `identity-gated`).

10. **Docs:** `docs/RELEASE/RELEASE-02_Known_Issues_MVP.md` (đóng KI-070 **phạm vi hai bảng nhật ký**
    · **mở KI-071** — xem §7 · số đo 21/08 · ranh giới D7/D10/K1/K2) ·
    `docs/permission-matrix-spec.md` · `harness/backlog.mjs` (`done`).

**Không chạm:** migration (0 thay đổi schema) · FE (0 vai ở scope hẹp ⇒ 0 đổi hành vi) ·
`packages/contracts`.

---

## 5. Bẫy đã biết phải né

| bẫy | né thế nào |
| --- | --- |
| `deny-cases-vacuous-without-allow-case` | mỗi ca DENY có ca ALLOW đối chứng (A1/A2/A3) |
| `tests-can-pin-a-hole-open` | ca RED viết trước, phải ĐỎ; cấm nới assert cho khớp |
| `integration-test-lane-db-gate` | `skipIf(!hasDb \|\| !LANE_DB)`; `check.sh --lane-db` trước PR |
| `reused-method-must-be-actor-scoped` | `buildUserScopeConditionOn` nhận `ctx.userId` = actor, không phải target |
| `index-ratchet-must-pin-definition-not-name` | ratchet D8(c) neo vào CỘT drizzle, không neo chuỗi tên |
| `gitleaks-join-not-enough-amend-required` | fixture password ghép chuỗi / `.padEnd()` |
| `wo-paths-drive-gate-and-scheduler` | §4.1 sửa `paths` TRƯỚC khi code |
| `server-masking-needs-optional-fe-schema` | KHÔNG đổi hình dạng DTO ⇒ FE không đổi |
| `module-closed-by-second-assert-not-scope` | cặp gate = cặp bound ⇒ đây KHÔNG phải ca second-assert |
| ⚠️ ⟲R1 hồi quy `identity-projection-scope.int-spec.ts` | Ba token ở đó đều giữ `view:audit-log@**Company**` (`:174-176`) ⇒ B1/B2/C1/C2/C3 **không đổi**. **Ai "làm cho thực tế hơn" bằng cách đổi `:175` sang `Own` sẽ làm ca C3 (chủ thể = uOther) mất hàng và ĐỎ.** Đừng đổi. |

---

## 6. Nghiệm thu

Ánh xạ `done_when`:

1. RED trước — R1 (hàng ngoài scope) + R2 (dò UUID qua query param) ✔ §3
2. Ca đối chứng ALLOW — A1/A2/A3 ✔ §3
3. `userId` đối chiếu vị từ scope — D6 (giao; vị từ là tham số BẮT BUỘC, không bỏ được) ✔
4. ORDER BY — D8 (a) đo sạch + (b) tie-break `id` + (c) ratchet neo cột thật + (d) pin vùng mù ✔
5. FULL gate PASS + RELEASE-02 đóng KI-070 kèm số đo PROD ✔ §0

⟲R1 **FULL gate đủ bộ** theo `harness/policy.md:12` cho zone 🔴: `security-reviewer` +
`database-reviewer` + `silent-failure-hunter`. Merge **người chốt tay** — `policy.md:107` cấm
auto-merge vùng đỏ.

Chạy: `bash harness/check.sh --lane-db=auditlogrow` (int-spec phải THỰC SỰ chạy, không skip).

⟲R1 **Rollback:** code-only, **0 migration** ⇒ revert PR là đủ, không có bước dữ liệu. Ghi ra vì K1
làm kill-switch `PERMISSION_GUARD_ENABLED` **không** dùng được để mở hai route này trong sự cố.

---

## 7. Ranh giới KHÔNG đóng trong WO này (nợ CÓ TÊN, không phải khoảng trống)

- ⟲R2 **KI-072 (MỞ trong PR này) — vế NGUY HIỂM NHẤT của việc gạch KI-070.** `GET
  /foundation/audit-logs` (+ `/:id`) gate **ĐÚNG cặp `view:audit-log`** mà WO này vừa bound HÀNG,
  nhưng trên bảng thứ BA — `audit_logs` — và **không** được bound.
  `AuditQueryService.listCompany(companyId, query)` **không nhận `userId` của actor** ⇒ nó không
  resolve `data_scope` được kể cả nếu muốn; `withTenant` chặn chéo-tenant, không chặn trong-tenant.
  `?actorUserId=` đi thẳng vào `eq(auditLogs.actorUserId, …)` = **đúng hình dạng V2**.
  **Số đo 2026-08-21:** `audit_logs` **13.146** hàng (12.786 có `actor_user_id`, 13 actor phân biệt)
  — bề mặt CÒN MỞ lớn gấp **~30 lần** 366+65 mà WO này vừa đóng.
  **Vì sao phải cấp số TRƯỚC khi gạch KI-070, không phải sau:** §0.2 census "đường đọc HAI BẢNG" và
  kết luận "vá hai repository là ĐỦ" — câu đó đúng **trong phạm vi hai bảng nhật ký** và SAI nếu đọc
  ở phạm vi *cặp quyền*. Người đọc dấu gạch trên KI-070 sẽ hiểu "cặp `view:audit-log` đã chặn tập
  hàng" rồi cấp cặp đó ở scope hẹp — tức bản vá này tự đẻ ra đúng lớp lỗi mà KI-054 tố cáo
  ("Company-scope" là mô tả, không có dòng code ép). Bản đồ 4-route/3-bảng của cặp nay nằm ở
  `docs/permission-matrix-spec.md`, và workaround `view:audit-log@Company` chuyển nguyên văn sang
  KI-072 TRƯỚC khi KI-070 bị gạch.
  ⚠️ Ai vá KI-072 phải **phát biểu ngữ nghĩa trước**: `audit_logs` chỉ có MỘT cột người
  (`actor_user_id`) ⇒ `Own` = "hàng do tôi GÂY RA", khác `login_logs` (`Own` = hàng VỀ tôi). Đó là
  quyết định kiểu D7, không phải chi tiết thi công. Thêm điểm đúc thứ hai ⇒ `ROW_SCOPE_MINT_PINS` ĐỎ
  (thiết kế, không phải phiền toái).
- ⟲R1 **KI-071 (MỞ trong PR này)** — vế bound-HÀNG của `GET /auth/roles/:id/members`:
  `role-admin.repository.ts` `listRoleMembersTx` vẫn trả trọn `userId` + `status` + `expiresAt` của
  MỌI thành viên role cho vai `view:user@Own`. **Vì sao phải cấp số:** KI-070 bao **hai** bề mặt và
  workaround của nó gồm cả *"không cấp `view:role` ở scope hẹp hơn Company"*. Gạch `~~KI-070~~` mà
  không tách số sẽ **xoá mất dòng workaround duy nhất** đang bảo vệ route đó. Chuyển nguyên văn
  workaround `view:role`/`view:user@Own` sang KI-071 rồi mới đóng KI-070 với phạm vi ghi rõ
  **"chỉ hai bảng nhật ký"**.
- **N-1b (sàn hoá Team/Department)** — sau bản vá, `Team`/`Department` trên `view:audit-log` = 0 hàng
  và lưới không đơn điệu (D10). Phải sửa cho cả ba đường cùng lúc.
- **K1 · K2** (D2) — kill-switch không mở được hai route này; cửa sổ cache 300s cho 403 chủ ý.
- ⟲R1 **PAT/api-key** — vị từ hàng phân giải scope của **USER**, bỏ qua `scopeKeys` thu hẹp của PAT
  (`permission.guard.ts:100-115`). Không phải hồi quy (hôm nay cũng vậy), nhưng là ranh giới có tên.
- ⟲R1 **Đọc nhật ký audit KHÔNG sinh audit** — `decideCan` trả `auditRequired: true` cho cặp nhạy cảm
  (`permission.decide.ts:117`) nhưng `permission.guard.ts:139-143` **vứt** giá trị đó. Ngoài
  `done_when`, đúng lớp `ui-promises-backend-never-reads`. Xác minh lại khi thi công; nếu đúng thì
  nêu tên trong RELEASE-02 (không tự ý vá — nó chạm MỌI cặp nhạy cảm, không riêng WO này).
- **`login_logs` hàng `company_id IS NULL`** (telemetry pre-auth) — RLS đã che từ mig 0532; vị từ
  scope mang `company_id = :tenant` nên vẫn che. Ca N1 ghim chiều `user_id IS NULL` (khác vế).
