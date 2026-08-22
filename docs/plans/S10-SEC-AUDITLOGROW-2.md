# S10-SEC-AUDITLOGROW-2 — KI-072: `data_scope` chặn TẬP HÀNG của `audit_logs`

> Vùng đỏ (phân quyền + đường đọc dữ liệu audit). Plan viết TRƯỚC code theo CLAUDE.md §6.
> Bảng chạm: `audit_logs` — **append-only** (bất biến #2), WO này chỉ đổi đường ĐỌC.
> Ranh giới CROWN: cùng cặp gate `view:audit-log` mà `S10-SEC-AUDITLOGROW-1` (KI-070) vừa bound HÀNG
> trên `login_logs`/`user_security_events` — WO này KHÔNG được đọc là "cặp đã kín", nó đóng bảng thứ BA.

---

## 0. Số đo — ĐÃ ĐO (2026-08-22), dùng thẳng, không đo lại

`audit_logs`: **13.201** hàng · **12.841** có `actor_user_id` · **360** hàng `actor_user_id IS NULL`
(job máy/hệ thống) · **13** actor phân biệt.

Ai giữ `view:audit-log` (is_sensitive=true, effect ALLOW) — **cả ba `@Company`**, **0 hàng DENY**:

| vai | data_scope | người giữ |
| --- | --- | --- |
| `SA` | Company | 2 (sống) |
| `QUẢN LÝ CẤP CAO` | Company | 4 hàng `user_roles` / 3 active |
| `company-admin` | Company | 2 |

**Kết luận:** hôm nay **0 vai** chạm được lỗ này (không ai giữ scope hẹp hơn Company trên cặp
`view:audit-log`) ⇒ bản vá đóng lỗ **TIỀM TÀNG**, không phải hotfix, **0 hồi quy dự kiến** trên PROD.

⚠️ **ĐÍNH CHÍNH số đo của seed WO (21/08).** Seed ghi "SA (10 người) · QUẢN LÝ CẤP CAO (4) ·
company-admin (2)". Số 10 của SA đếm **cả hàng `user_roles` đã soft-delete**; đếm sống
(`ur.deleted_at IS NULL AND u.deleted_at IS NULL`) ra **2**. Kết luận không đổi (cả ba vẫn @Company),
nhưng con số phải đúng ở RELEASE-02 — memory `wo-seed-hand-measurements-can-be-incomplete`.

⚠️ Số này phải **ĐO LẠI** ngay trước khi mở PR — seed/role có thể đổi giữa lúc viết plan và lúc merge.
RELEASE-02 đóng KI-072 bằng số đo LÚC ĐÓ, không phải số 22/08 chép lại. **Câu đo bắt buộc** (⟲R1-C6):
`SELECT rp.data_scope, count(*) FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id
WHERE (p.action,p.resource_type)=('view','audit-log') GROUP BY 1` — nếu xuất hiện giá trị NGOÀI
`{Own,Team,Department,Company,System}` thì đó là **K3** (xem D2), 403 TỨC THÌ cho vai đó, khác hẳn K1/K2.

**Chỗ dựa của câu "0 hồi quy" ở tầng TEST (⟲R1) — nằm ở LANE DB, không phải PROD:** `seedRolePermission`
mặc định `dataScope='Company'` (`apps/api/test/helpers/seed.ts:296-309`) và grant mig `0340` cho
company-admin **không truyền `data_scope`** ⇒ nhận default cột `'Company'` (`db/schema/permissions.ts:72`
— `notNull().default("Company")`). Bốn suite đang chạm `/foundation/audit-logs` vì thế đều @Company ⇒
bản vá không cắt hàng của suite nào.

### 0.1 — Khẳng định của plan đã XÁC MINH trên cây (không phải suy đoán)

| khẳng định | lệnh xác minh | kết quả |
| --- | --- | --- |
| 4 call-site của `listCompany`/`getCompanyDetail` | `grep -rn` toàn `apps/api/src` + `apps/api/test` | ĐÚNG — controller ×2, `dashboard-widget-handlers.service.ts:555,560`. 0 test gọi thẳng |
| `AttendanceAuditService`/`LeaveAuditService` dùng chung `AuditRepository` | `grep -rn findManyTx\|countTx` | ĐÚNG — `attendance-audit.service.ts:80-81`, `leave-audit.service.ts:74-75`; mỗi module tự `provide` `AuditRepository` cục bộ |
| `PermissionModule` export `DataScopeService` | `permission.module.ts:161` | ĐÚNG — `AuditModule` đã `imports: [DatabaseModule, PermissionModule]`, **không cần sửa `audit.module.ts`** |
| `ctx.user` của widget có `.id` | `dashboard-widget-data.types.ts:7-10` | ĐÚNG — `WidgetRequestUser = { id, companyId }` |
| `audit-log-row-scope.int-spec.ts` đã bị WO-1 chiếm | `ls apps/api/test/integration/` | ĐÚNG — file tồn tại, thuộc `login_logs`/`user_security_events` |

---

## 1. Khuyết tật — phát biểu chính xác, ba vế

**V1 — tập hàng không có vị từ scope.** `AuditQueryService.listCompany(companyId: string, query)`
(`audit.service.ts:35`) **không nhận `userId` của actor** ⇒ không thể resolve `data_scope` được **kể cả
nếu muốn** (khác V1 của KI-070, ở đó chữ ký CÓ actor nhưng vị từ không được dựng — ở đây chữ ký còn
thiếu nguyên liệu). `withTenant(companyId)` + RLS chặn CHÉO TENANT, không chặn TRONG tenant. Vai giữ
`view:audit-log@Own` sẽ đọc trọn `audit_logs` của tenant: `actor_user_id`, `action`, `object_type`/
`object_id`, `permission_code`, `data_scope` (cột), `ip`, `user_agent`, `request_id`, …

**V2 — `query.actorUserId` đi thẳng vào `WHERE`.** `audit.service.ts:94` map `query.actorUserId` vào
`AuditFilter.actorUserId` → `audit.repository.ts:52` `eq(auditLogs.actorUserId, filter.actorUserId)`.
Không đối chiếu vị từ scope nào ⇒ oracle **CÓ ĐIỀU KHIỂN**: dò lịch sử hành động của một UUID bất kỳ
trong tenant. Đúng hình dạng V2 của KI-070.

**V3 — `countTx` dùng chung `buildWhere`.** Ai chỉ vá đường list mà để `countTx` nguyên thì
`pagination.total` vẫn phát ra số hàng ngoài scope — oracle ĐẾM ĐƯỢC, im lặng. KI-070 tự tìm ra vế này
khi vá (không có trong sổ KI gốc); ở đây ghi ngay từ đầu, **không được tự tìm ra lần hai**.

**Chiều thứ hai, không phải hệ quả của list:** `getCompanyDetail(companyId, id)` (`audit.service.ts:50`)
trả trọn 1 hàng theo `id`, 0 vị từ scope. Route `/:id` cần ca RIÊNG.

**KHÔNG có lớp giảm nhẹ nào ngoài workaround.** `AuditMaskerService` chỉ redact GIÁ TRỊ `before`/`after`
— không quyết định HÀNG nào được trả. Route này không chiếu `email`/`fullName` nên tầng bound-CỘT của
KI-053/054 **không áp dụng** ở đây — không có "còn một nửa lá chắn" như ở KI-054.

Cùng lớp lỗi KI-053/KI-070 (gate đúng / `data_scope` không được đọc lần nào).

---

## 2. Ranh giới CÓ TÊN — chốt TRƯỚC khi thiết kế vị từ

Cặp `view:audit-log` gác nhiều route trên cùng bảng `audit_logs`. WO này CHỈ đóng đường COMPANY:

| route | gate | trong phạm vi WO này? |
| --- | --- | --- |
| `GET /foundation/audit-logs` (+ `/:id`) | `view:audit-log` | ✔ ĐÂY |
| `GET /foundation/audit-logs/all` (+ `/all/:id`) | `@OperatorOnly` + `view:platform-audit` | ✘ — xem dưới |
| `GET /attendance/audit-logs` | `view:attendance-audit-log` | ✘ — xem dưới |
| `GET /leave/audit-logs` | `view:leave-audit-log` | ✘ — xem dưới |

**Đường SYSTEM (`/all`, `/all/:id`) NGOÀI PHẠM VI.** `@OperatorOnly()` + `@RequirePermission('view',
'platform-audit', {isSensitive:true})` + `withPlatformReadContext()` (`audit.controller.ts:51-65`) —
biên audience KHÁC (operator, chéo tenant CÓ CHỦ Ý, mig 0340) và **cặp quyền KHÁC**. Vá lan sang đó là
đổi biên audience operator, không phải đóng KI-072.

**Attendance/Leave audit viewer NGOÀI PHẠM VI, dù dùng CHUNG `AuditRepository`.**
`AttendanceAuditService` (`attendance-audit.service.ts:80-81`) và `LeaveAuditService`
(`leave-audit.service.ts:74-75`) tái dùng `findManyTx`/`countTx` SELECT-only, nhưng gate bằng **cặp
quyền RIÊNG của từng module** và tự AND thêm `objectTypes` allowlist theo module. **CÙNG HÌNH DẠNG lỗ**
(row-scope chưa bound) nhưng dưới cặp quyền khác. `paths` của WO này **không bao gồm**
`apps/api/src/attendance/**`/`apps/api/src/leave/**` — chạm hai file đó là vá lây ngoài `done_when`,
ngoài gate đã seed, và cần WO/KI riêng do chủ dự án cấp số (không tự đánh số ở plan này). Xem §8.

### 2.1 — CENSUS đường ĐỌC `audit_logs` (⟲R1-B2 — bước WO-1 có mà bản đầu của plan này BỎ)

`grep -rln "auditLogs" apps/api/src --include=*.ts` (loại `*.spec.ts`), đo 2026-08-22 — **5 file, chỉ
HAI là đường ĐỌC**:

| file | ĐỌC / GHI | trong phạm vi? |
| --- | --- | --- |
| `foundation/audit/audit.repository.ts` | ĐỌC | ✔ (đường Company) / ✘ (System · ATT · LEAVE — §2) |
| **`chat/chat-oversight.repository.ts:335-399`** | **ĐỌC** | ✘ — **NỢ CÓ TÊN, §8** |
| `employees/hr-import.repository.ts:145` | GHI (`insert`) | — |
| `events/audit.service.ts:125` | GHI (`insert`) | — |
| `db/schema/audit.ts` | định nghĩa | — |

**Đường thứ NĂM vừa lộ ra — `ChatOversightRepository.listOversightAudit`** (`CHAT-API-019`, gate cặp
chat + `ChatOversightAuditGuard`): `opts.actorUserId` đi **THẲNG** vào `WHERE`
(`chat-oversight.repository.ts:352-354` — **hình dạng V2 y hệt**), **0 vị từ row-scope**, chiếu
`users.fullName` bằng `leftJoin` trần (`:386-389`, KHÔNG qua `identityColumns`) và trả
`auditLogs.metadata` **THÔ** (`:381`) trong khi `AuditQueryService.toDto` coi `metadata` là phải
`masker.mask()` (`audit.service.ts:145`). Cặp quyền KHÁC ⇒ ngoài phạm vi WO này, nhưng phải vào §8.

⚠️ **Hệ quả cho câu chữ RELEASE-02:** viết **"KI-072 đóng — phạm vi HAI route `/foundation/audit-logs`
(+ `/:id`)"**, TUYỆT ĐỐI KHÔNG viết "`audit_logs` đã bound HÀNG". Câu sau sẽ khiến người đọc cấp
`view:audit-log` (hoặc cặp chat) ở scope hẹp rồi tin là đã an toàn — đúng lớp lỗi §7 của WO-1 tồn tại
để chống.

---

## 3. Quyết định thiết kế

### D1 — Bound HÀNG bằng `buildUserScopeConditionOn`, TÁI DÙNG lattice (không viết bản thứ ba)

Target: `{ idCol: auditLogs.actorUserId, companyIdCol: auditLogs.companyId }`. Soi gương D3 của
`S10-SEC-AUDITLOGROW-1`: `Company`/`System` = cả tenant · `Own` = `company_id=:tenant AND
actor_user_id=:actor` · `Team`/`Department`/không rõ = `false` (fail-closed). `logger.warn` ở nhánh
`default:` đã có sẵn `table` trong payload từ WO-1 ⇒ **0 thay đổi cần ở `data-scope.service.ts`**, nó
tự báo đúng `audit_logs`.

**Hỏng nếu chọn ngược:** viết một hàm dựng vị từ riêng cho `audit_logs` là nợ N-1b thêm một bản sao thứ
ba (đã có 2: `buildEmployeeScopeCondition` shape `employee_profiles`, `buildUserScopeConditionOn` shape
`users`/tham số hoá). Bản thứ ba trôi ngay lần đầu ai sửa một trong ba.

### D2 — Cặp bound = cặp gate ⇒ luật fail-closed của `rowScopeFor` (không phải `resolveOrNull` của tầng cột)

Ở đây cặp GATE (`view:audit-log`) **chính là** cặp cần bound, nên `resolveOrNull(...) === null` sau khi
guard đã cho qua nghĩa là **guard và trình phân giải scope BẤT ĐỒNG** — không được im lặng:

```text
scope = dataScope.resolveOrNull(actor.id, actor.companyId, "view", "audit-log", { isSensitive: true })
if (scope === null) {
  logger.error("audit-logs: guard cho qua nhưng resolveStrongestScope trả null — ...", {...})
  throw new ForbiddenException("AUTH-ERR-FORBIDDEN: out of permission scope")   // NGUYÊN VĂN
}
```

**KHÔNG** dùng `resolveAndAssert` (không log — 403 không phân biệt được với 403 guard ở vận hành, lý do
đã chốt ở KI-070 D2). **KHÔNG** thêm log vào `resolveAndAssert` (~101 call-site, `null` ở đó là deny
bình thường ⇒ báo động giả hàng loạt). `{isSensitive:true}` bắt buộc, soi gương gate của controller —
bỏ nó thì đúng nhờ DỮ LIỆU (catalog `is_sensitive=true`) chứ không nhờ code.

Chuỗi message giữ **NGUYÊN VĂN** của `resolveAndAssert`: `AllExceptionsFilter` không phân biệt exception
ném từ guard với ném từ service, nên `status`/`code`/`type`/`details` giống hệt 403 của guard. Cái KHÔNG
được phép là làm message giàu thông tin hơn (tên cặp quyền, tên bảng) — đó mới là oracle.

**403 hồi quy — đã kiểm:** `AuditController` không khai `requiresReauth` trên hai route Company;
`PermissionGuard` là opt-in per-controller (không APP_GUARD); cổng sensitive khớp bit-by-bit. K1
(kill-switch không mở được route) / K2 (cửa sổ cache 300s ⇒ 403 chủ ý) là rủi ro **KẾ THỪA** từ cùng cơ
chế `DataScopeService`, không phải mới — ghi nhận nó nay CŨNG che `audit_logs` (§8).

⚠️ **K3 — lớp bất đồng THỨ BA, KHÁC K1/K2, bản đầu không kể (⟲R1-C6).** `decideCan` **không đọc
`data_scope` lần nào**, còn `resolveStrongestScope` trả `null` nếu MỌI grant đủ điều kiện mang
`data_scope` không chuẩn hoá được (`permission.service.ts:614-623`, pin ở
`data-scope.service.coverage.spec.ts:148-154`). Đây KHÔNG phải cửa sổ như K2 — nó là bất đồng **VĨNH
VIỄN**: guard cho qua, `rowScopeFor` ném 403, mọi lần gọi. Hôm nay an toàn (cột
`notNull().default("Company")`, mig 0340 không truyền giá trị), nhưng đó là lý do câu đo ở §0 phải
`GROUP BY data_scope` chứ không chỉ đếm người.

### D3 — Ngữ nghĩa `Own` = "hàng do TÔI GÂY RA" (`actor_user_id`), KHÁC `login_logs`

`audit_logs` chỉ có **MỘT** cột người: `actor_user_id`. Không có cột "chủ thể" nào khác để `Own` bám
theo nghĩa "hàng VỀ tôi" (khác `login_logs`, nơi `Own` = `user_id` = người mà hàng nói về — ranh giới
D7 của `S10-SEC-AUDITLOGROW-1`). Ở đây **chỉ có một lựa chọn hợp lý**: `Own` = "hành động do chính tôi
thực hiện" = `actor_user_id = actor.id`.

**Hệ quả PHẢI ghi ra, không phải chi tiết thi công:** `eq(actorUserId, actor.id)` trên cột NULL cho
NULL (không TRUE) ⇒ **360 hàng `actor_user_id IS NULL`** (job máy/hệ thống) **biến mất khỏi mọi vai giữ
`Own`**. Đây là fail-closed ĐÚNG chiều (một vai `Own` không có căn cứ nào để xem hành động không ai gây
ra), nhưng là thứ người sau dễ "sửa" thành `OR actor_user_id IS NULL` để "cho đủ" — làm vậy là **mở
toang**: MỌI vai `Own` sẽ thấy toàn bộ 360 hàng hệ thống của cả tenant. Ca `N1` (§4) ghim chiều này —
KHÔNG được xoá ca đó để "làm UX đẹp hơn".

### D4 — `?actorUserId=` đối chiếu bằng GIAO, không bằng 403

`buildWhereForActor` = `and(rowScopeSql(rowScope, auditLogs.actorUserId), ...conds-từ-filter)`. Vị từ
scope là thành phần ĐẦU, không bỏ được. `Own` + `?actorUserId=<người khác>` ⇒ `actor_user_id=other AND
actor_user_id=me` ⇒ **0 hàng, HTTP 200**. Lý do (đã chốt ở D6 của KI-070): 403 phân biệt được "ngoài
scope" với "không có hàng" ⇒ trả lời hộ câu "UUID này có tồn tại/hoạt động trong tenant không" = oracle.

### D5 — `/:id` ngoài scope trả **404 `AUDIT_NOT_FOUND`**, KHÔNG 403 — cùng mã với cross-tenant miss

`getCompanyDetail` gọi `findByIdForActorTx(tx, rowScope, id)` = `WHERE id=:id AND rowScopeSql(...)`.
Ba lý do một hàng "biến mất" — (a) không tồn tại, (b) thuộc tenant khác (RLS che ở `withTenant`), (c)
cùng tenant nhưng `actor_user_id` ngoài scope — đều đi tới **CÙNG MỘT NHÁNH**
`if (!row) throw NotFoundException({ code: AUDIT_NOT_FOUND, ... })`.

**Vì sao KHÔNG phân biệt (c) bằng 403:** phân biệt được sẽ tạo oracle "id này tồn tại trong tenant của
bạn nhưng do người khác gây ra" — đúng lớp lỗi D4 vừa đóng ở vế list, chỉ đổi hình dạng sang single-row.
Khớp tiền lệ ĐÃ CÓ trong `audit-permission-deny.int-spec.ts` (cross-tenant detail → 404).

### D6 — Company/System tách bằng **PHƯƠNG THỨC MỚI** trên `AuditRepository`, không phải optional param

Họ cũ `findManyTx`/`countTx`/`findByIdTx` giữ nguyên NGỮ NGHĨA (vẫn phục vụ `listSystem`/
`getSystemDetail` operator VÀ `AttendanceAuditService`/`LeaveAuditService` — §2), nhưng **ĐỔI TÊN** —
xem ⟲R1-B3 ngay dưới. Thêm BA phương thức mới, chỉ hai call-site Company gọi:

```ts
findManyForActorTx(tx: TenantTx, rowScope: IdentityGrant, filter: AuditFilter, limit: number, offset: number)
countForActorTx(tx: TenantTx, rowScope: IdentityGrant, filter: AuditFilter): Promise<number>
findByIdForActorTx(tx: TenantTx, rowScope: IdentityGrant, id: string)
```

`rowScope: IdentityGrant` là tham số THỨ HAI, **BẮT BUỘC**, đứng TRƯỚC `filter`/`id` — quên truyền là
sai chữ ký, ĐỎ typecheck ngay tại lời gọi (khuôn `login-log.repository.buildWhere`).

**Vì sao KHÔNG một tham số optional trên hàm đã có:** `rowScope?: IdentityGrant` là field QUÊN ĐƯỢC —
đúng hình dạng V1/V3 mà WO này tồn tại để đóng, chỉ dịch từ `AuditFilter` (đường đã LOẠI ở KI-070) sang
tham số hàm. Một PHƯƠNG THỨC MỚI buộc caller phải CHỌN, và **không thể "quên" tham số của cái ĐANG
dùng** vì nó không tồn tại dưới dạng optional.

⚠️ **⟲R1-B3 — bản đầu của D6/D10 HỨA một bảo đảm kiểu KHÔNG TỒN TẠI; đây là chỗ sửa đắt nhất của vòng
review.** Sau bản vá, họ cũ vẫn **public, chữ ký không đổi, không vị từ scope**: một đường đọc Company
MỚI viết `this.repo.findManyTx(tx, filter, limit, offset)` là **hợp kiểu và XANH tuyệt đối**. Ratchet
cũng mù — `rowScopePredicateMints()` chỉ đếm điểm **ĐÚC** (`fromScope`), không thấy điểm **TIÊU THỤ**
(`identity-projection-census.ts:307-329`). Khác hẳn `login_logs`, nơi KHÔNG tồn tại biến thể
không-bound nào để mà gọi nhầm. ⇒ lỗ KI-072 tái sinh im lặng ở đường đọc thứ hai, và cả hai lớp kiểm
soát của WO này đều không thấy. **BA việc bắt buộc:**

- **(a) ĐỔI TÊN họ cũ** → `findManyUnscopedTx` / `countUnscopedTx` / `findByIdUnscopedTx`. Rename thuần,
  4 call-site (`audit.service.listSystem`/`getSystemDetail`, `attendance-audit.service.ts:80-81`,
  `leave-audit.service.ts:74-75`) — sót là ĐỎ typecheck. Chữ `Unscoped` trong tên buộc người viết mới
  phải TỰ ĐỌC ra rằng mình đang chọn đường không bound.
- **(b) Docblock lớp** ghi: *"họ `*UnscopedTx` CHỈ dành cho đường operator (`withPlatformReadContext`)
  và hai module viewer tự bound bằng allowlist `objectTypes` + cặp quyền riêng — MỌI đường Company mới
  PHẢI dùng họ `*ForActorTx`."*
- **(c) ASSERT TĨNH** trong `identity-projection-ratchet.unit-spec.ts`: tập file gọi
  `findManyUnscopedTx|countUnscopedTx|findByIdUnscopedTx` phải ĐÚNG BẰNG `{foundation/audit/audit.service.ts,
  attendance/attendance-audit.service.ts, leave/leave-audit.service.ts}` — thêm một hộ tiêu thụ là ĐỎ.
  Đây là thứ DUY NHẤT bịt được chiều "đúc đúng, tiêu thụ sai đường".

⚠️ **`AuditRepository` PHẢI giữ ZERO dependency DI (⟲R1-C10).** `attendance.module.ts:154` và
`leave.module.ts:95` **tự `provide` `AuditRepository` cục bộ**, lý do ghi thẳng trong comment ("no DI
deps of its own"). Ai tiêm `DataScopeService` vào **repository** thay vì service sẽ làm
`AttendanceModule`/`LeaveModule` sập ở boot ⇒ khuôn `systemjobhandler-optional-dbw-di` (sập AppModule ⇒
100+ spec đỏ dây chuyền). Plan đặt `DataScopeService` ở **service** — giữ nguyên, đừng "gọn hơn".

### D7 — KHÔNG trích `rowScopeFor` thành helper dùng chung với `auth-logs-viewer.service.ts`

Trùng lặp ~15 dòng logic + docblock giữa `AuditQueryService.rowScopeFor` (mới) và
`AuthLogsViewerService.rowScopeFor` (đã có, WO-1). **Chọn KHÔNG trích, chấp nhận trùng lặp.**

1. Trích là refactor CROWN chạm đường **ĐÃ NGHIỆM THU** (2 route đang chạy, đã qua FULL gate của WO-1)
   để phục vụ một khuyết tật KHÔNG nằm trên đường đó — rủi ro hồi quy trên bề mặt đã đóng, đổi lấy lợi
   ích DRY nhỏ.
2. `ROW_SCOPE_MINT_PINS` là **danh sách**, không phải trần đếm, đúng vì "mỗi điểm = một bề mặt bound-HÀNG
   được reasoned độc lập, kèm int-spec deny/allow CỦA CHÍNH bảng đó"
   (`identity-projection-verdicts.ts:568-583`). Trích chung ⇒ cả hai bề mặt đi qua CÙNG một lời gọi
   `fromScope(..., "scoped-predicate", ...)` ⇒ census chỉ thấy **MỘT** điểm ⇒ việc `audit_logs` được
   bound trở nên **VÔ HÌNH** với chính cái ratchet dựng ra để bắt "mở rộng bề mặt mà không ký".
3. Trích ⇒ khoá pin cũ biến mất + khoá mới xuất hiện ⇒ ratchet ĐỎ **hai chiều cùng lúc** trong MỘT diff
   (trông như "đổi chỗ" thay vì "thêm sạch một điểm") — khó review hơn, không rõ ràng hơn.

**Cái giá của KHÔNG trích, nói thẳng:** khi `S10-SEC-ROLEMEMBERROW-1` (KI-071, `depends_on` WO này)
đóng, sẽ có **BA** bản sao gần giống hệt của mẫu `rowScopeFor`. Đó là điểm nên revisit một refactor DRY
thật sự (WO riêng, đi qua FULL gate) — **không phải bây giờ**, và không lén kèm trong PR này.

### D8 — Đổi chữ ký `listCompany`/`getCompanyDetail`: `(companyId, …)` → `(actor: {id, companyId}, …)`

Bắt buộc vì resolve `data_scope` đòi `actor.id`. Soi gương `AuthLogsViewerService.listLoginLogs(actor,
query)`.

**Call-site ĐỦ (grep xác nhận, §0.1 — đây là TOÀN BỘ):**

| call-site | sau bản vá |
| --- | --- |
| `audit.controller.ts:46` | `listCompany(req.user, query)` — `req.user` đã là `{id, companyId}` |
| `audit.controller.ts:71` | `getCompanyDetail(req.user, id)` |
| `dashboard-widget-handlers.service.ts:555` | `listCompany(ctx.user, {...})` — `WidgetRequestUser` đã là `{id, companyId}` |
| `dashboard-widget-handlers.service.ts:560` | như trên |

0 test gọi thẳng `AuditQueryService.listCompany`/`getCompanyDetail` (chỉ qua HTTP) ⇒ không test nào vỡ
vì đổi chữ ký ngoài chỗ đã liệt kê.

⚠️ **`apps/api/src/dashboard/**` KHÔNG nằm trong `paths` hiện tại của backlog entry** — phải THÊM nó vào
`paths` **TRƯỚC khi code** (memory `wo-paths-drive-gate-and-scheduler`).

### D9 — Không chạm `AttendanceAuditService`/`LeaveAuditService`

Hệ quả trực tiếp của D6: `findManyTx`/`countTx` không đổi ⇒ hai service này tiếp tục hoạt động y hệt
hôm nay, **KHÔNG được bound thêm gì**. Nợ CÓ TÊN (§8), không phải bỏ sót.

### D10 — Không chạm đường SYSTEM (operator)

`listSystem`/`getSystemDetail` giữ nguyên NGỮ NGHĨA; chỉ đổi TÊN phương thức được gọi theo D6(a)
(`findManyUnscopedTx`/`countUnscopedTx`/`findByIdUnscopedTx`).

⚠️ **ĐÍNH CHÍNH bản đầu (⟲R1-B3):** câu "không có cách nào 'vô tình' gọi nhầm phương thức cũ mà biên
dịch qua" là **SAI** — họ cũ vẫn public và vẫn hợp kiểu cho mọi caller. Bảo đảm THẬT chỉ đến từ ba việc
D6(a)(b)(c) cộng lại: tên tự tố cáo + docblock + assert tĩnh danh sách hộ tiêu thụ. Typecheck một mình
KHÔNG đủ, và đừng viết vào docblock rằng nó đủ.

### D11 — Hệ quả kèm theo ở widget `SYSTEM_LOGS` — SỬA ĐÚNG, không phải hồi quy

`fetchSystemLogs` (`dashboard-widget-handlers.service.ts:548-573`) gọi `listCompany` COUNT-ONLY (chỉ đọc
`meta.total`, bỏ toàn bộ `data`). Sau bản vá, `meta.total` của widget SẼ đi theo `data_scope` của actor
đang xem dashboard thay vì luôn đếm cả tenant — **sửa đúng cùng lớp lỗi** (hôm nay widget cũng là nạn
nhân của KI-072, chỉ là COUNT-ONLY nên không lộ HÀNG, vẫn lộ **con số**). Hôm nay 0 hồi quy vì cả ba vai
đều @Company.

**HAI chế độ hỏng, không phải một (⟲R1-C5 — bản đầu chỉ kể chế độ thứ nhất):**

- `GET /dashboard/widgets/system-logs/data` → **403**: `getWidget` re-throw `HttpException`
  (`dashboard-widget-data.service.ts:127-129`).
- `GET /dashboard/widgets?include_data=true` → **widget BIẾN MẤT khỏi danh sách, im lặng**: `attachData`
  bắt `ForbiddenException` rồi `continue` (`dashboard-widget-data.service.ts:206-217`) — không lỗi,
  không "Degraded", không dấu vết cho người dùng. Đây mới là chế độ khó chẩn hơn.

Cả hai là hành vi ĐÃ CÓ SẴN cho mọi widget từng ném lỗi quyền, không phải pattern mới do WO này tạo ra
— chấp nhận, cùng lớp K2/K3, nay thêm MỘT consumer đi qua nó.

**ĐÃ ĐO — điều kiện SỐNG CÒN của D11, không để reviewer sau tự tìm lại:** widget khai
`add("system-logs", …, gateAndResolve: gateSelf)` (`dashboard-widget-handlers.service.ts:203-206`) →
`gateSelf` (`:239-245`) → `ownIdentity` (`:137-145`) ⇒ `shareScope: "user"`, `cacheKey` mang `user.id`
⇒ **KHÔNG có rò con-số chéo người xem**. Nếu cache là company-shared thì `meta.total` tính theo scope
của người xem đầu tiên sẽ được phục vụ cho mọi người xem sau — bản vá tự biến mình thành đường rò.

### Đường đã LOẠI (đừng mở lại)

- **Nới `Own` bằng `OR actor_user_id IS NULL`** — D3, mở toang 360 hàng hệ thống cho mọi vai `Own`.
- **403 khi `actorUserId` ngoài scope, hoặc khi hàng detail ngoài scope** — D4/D5, đẻ oracle tồn-tại.
- **Optional `rowScope` trên `findManyTx`/`countTx`/`findByIdTx` đã có** — D6, quên được = V1/V3 tái phát.
- **Trích `rowScopeFor` thành helper dùng chung ngay trong PR này** — D7.
- **Vá kèm `AttendanceAuditService`/`LeaveAuditService`** — D9, ngoài `paths`, cặp quyền khác.
- **Vá lan sang `/all`, `/all/:id`** — D10/§2, đổi biên audience operator.

---

## 4. Vế RED — viết TRƯỚC, phải ĐỎ trên cây hôm nay

⚠️ **Tên file KHÔNG được trùng** `apps/api/test/integration/audit-log-row-scope.int-spec.ts` — file đó
**ĐÃ TỒN TẠI**, thuộc `S10-SEC-AUDITLOGROW-1` (bảng KHÁC). File mới của WO này:

**`apps/api/test/foundation/foundation-audit-row-scope.int-spec.ts`** (đặt cạnh
`audit-list-filter.int-spec.ts`/`audit-permission-deny.int-spec.ts` — cùng route, cùng thư mục quy ước).

⚠️ **Bẫy tên trùng THỨ HAI, khác nghĩa:** `query.dataScope` (bộ lọc Zod) lọc theo **CỘT**
`audit_logs.data_scope` — giá trị ghi LẠI tại thời điểm hành động xảy ra (lịch sử), đã có ca ở
`audit-list-filter.int-spec.ts`. Đừng nhầm với **`scope`** = kết quả `resolveOrNull("view","audit-log")`
của ACTOR đang gọi API (khái niệm của WO này). Cùng tên, khác tầng, khác đời sống.

Mọi lượt gọi dùng `?limit=100&offset=0` tường minh (mặc định `limit=50`).

⚠️ **CHỐNG NHIỄU FIXTURE — bắt buộc (⟲R1-C7).** `audit_logs` là bảng **ứng dụng tự ghi**, và lane DB
dùng chung với suite khác; chính `/auth/login` của fixture cũng có thể sinh hàng. `?limit=100` trên
`ORDER BY created_at DESC` **KHÔNG** bảo đảm ba hàng seed nằm trong trang. Theo khuôn hai suite anh em
(`audit-permission-deny.int-spec.ts:66` `const TAG = \`PDENY-${randomUUID().slice(0,8)}\``;
`audit-list-filter.int-spec.ts:206` gọi `?action=${TAG}-hr-view`): **mọi hàng seed mang
`action = \`${TAG}-…\`` và MỌI lượt gọi kèm `&action=<TAG cụ thể>`** (hoặc `&objectId=<uuid fixture>`).
Mọi hằng đếm suy từ FIXTURE, không từ response.

⚠️ **Khuôn `insertAudit` phải lấy đúng file (⟲R1-C8).** Bản của `audit-permission-deny.int-spec.ts:81-87`
hard-code `object_type='user'` và **KHÔNG có tham số `actor_user_id`** ⇒ không dựng được fixture của WO
này. Khuôn dùng được là `audit-list-filter.int-spec.ts:73-86`:
`insertAudit(direct, companyId, { actorUserId, objectType, objectId, dataScope, createdAt, … })`.

**Fixture** (1 tenant; seed hàng audit bằng INSERT trực tiếp qua `direct.query`; `audit_logs` không có
đường tạo hàng qua HTTP cho actor tuỳ ý):

| người | `view:audit-log` | vai trò trong ca |
| --- | --- | --- |
| `uCompany` | Company | đối chứng ALLOW |
| `uOwn` | **Own** | hình dạng lỗ |
| `uTeam` | **Team** | fail-closed (củng cố D1) |
| `uOther` | — | actor của hàng NGOÀI scope của `uOwn` |
| `uNoGrant` | — | no-regression G1 |

Seed 3 hàng: actor=`uOwn` · actor=`uOther` · `actor_user_id IS NULL`.

| ca | khẳng định | ĐỎ hôm nay vì |
| --- | --- | --- |
| **R1** 🔴 | `uOwn` GET `/foundation/audit-logs?limit=100` ⇒ **mọi** hàng `actorUserId === uOwn.id` | hôm nay thấy cả hàng `uOther` + hàng NULL |
| **R2** 🔴 | `uOwn` GET `…?actorUserId=<uOther.id>&limit=100` ⇒ `data` rỗng **VÀ** `meta.total === 0` | hôm nay trả đúng hàng `uOther` (V2) + `total>0` (V3) |
| **R3** 🔴 | `uOwn` GET `/foundation/audit-logs/<id hàng uOther>` ⇒ **404** `AUDIT_NOT_FOUND` | hôm nay 200, trả trọn hàng |
| **N1** 🔴 | `uOwn` **KHÔNG** thấy hàng `actor_user_id IS NULL` | hôm nay thấy — pin ngữ nghĩa D3 |
| **T1** 🔴 | `uTeam` GET ⇒ 200, `data=[]`, `meta.total===0` | hôm nay thấy mọi hàng tenant |
| **A1** ✅ | `uCompany` GET list ⇒ thấy đủ hàng `uOwn` + `uOther` + hàng NULL | chống ca DENY xanh-RỖNG |
| **A2** ✅ | `uOwn` vẫn thấy **≥1 hàng** của chính mình | chống "0 hàng vì route hỏng" |
| **A3** ✅ | `uOwn` + `?actorUserId=<uOwn.id>` ⇒ ra đúng hàng của mình | giao KHÔNG chặn oan |
| **A4** ✅ | `uCompany` GET `/foundation/audit-logs/<id hàng uOther>` ⇒ 200 | đối chứng cho R3 — phân biệt "chặn đúng" với "detail hỏng" |
| **C1** ✅ | `uOwn` GET không filter ⇒ `meta.total === data.length` VÀ `=== <số hàng TAG của uOwn>` (hằng từ fixture) | ⟲R1-B4 |
| **C2** ✅ | `uCompany` GET ⇒ `meta.total === 3` (hằng từ fixture) | ⟲R1-B4 |
| **G1** | `uNoGrant` ⇒ vẫn 403 | xác nhận không hồi quy tầng guard |

⚠️ **VÌ SAO C1/C2 tồn tại (⟲R1-B4 — bản đầu BỎ SÓT, WO-1 có ca R4 tương ứng):** `meta.total` trong bản
đầu chỉ xuất hiện ở R2 và T1, **cả hai đều assert `=== 0`**. Một `countForActorTx` hỏng theo hướng
LUÔN-TRẢ-0 (ví dụ rơi vào nhánh `?? sql\`false\``) làm R1·R2·T1·N1 XANH và A1-A4 cũng XANH (chúng assert
`data`, không assert `total`) ⇒ **10/10 XANH với `pagination.total` chết**, `done_when` #4 xanh giả.
C1/C2 là ca ALLOW, XANH dưới đột biến bên dưới — chúng chống hỏng-về-phía-HẸP, không chống rò.

**RED-proof (không phải "nhìn xanh") — ⟲R1-B1, bản đầu mô tả SAI đột biến:**

Đột biến = **THAY** `rowScopeSql(rowScope, auditLogs.actorUserId)` bằng `` sql`true` ``, và phải thay ở
**CẢ HAI** điểm: `buildWhereForActor` **VÀ** `findByIdForActorTx` (D5 dựng vị từ riêng, KHÔNG đi qua
`buildWhereForActor` ⇒ đột biến một chỗ không chạm R3).

⚠️ **TUYỆT ĐỐI KHÔNG "xoá phần tử khỏi `conds`"** như bản đầu viết. Khuôn `login-log.repository.ts:106-115`
kết bằng `and(...conds) ?? sql\`false\``; bỏ hẳn `rowScopeSql` khỏi một lượt gọi KHÔNG filter làm
`conds = []` ⇒ `and()` = `undefined` ⇒ `` sql`false` `` ⇒ **0 hàng**. Khi đó R1 XANH (`every` trên mảng
rỗng = true), N1 XANH, T1 XANH, R3 XANH ⇒ đo ra **1 ĐỎ / 9 XANH** và người thi công đứng trước lựa chọn
"đính chính bảng" hay "nới assert" — đúng bẫy `tests-can-pin-a-hole-open`.

**KHÔNG** mutate `rowScopeSql` dùng chung (nó còn phục vụ WO-1; mutate ở đó làm cả hai suite ĐỎ ⇒ tín
hiệu sai).

Dự đoán với đột biến ĐÚNG: **R1·R2·R3·N1·T1 ĐỎ** (5); **A1·A2·A3·A4·C1·C2·G1 XANH** (7).

⚠️ **"XANH" không đối xứng với "ĐỎ" (⟲R1-C14):** A2·A3·G1 XANH dưới **cả** đột biến lẫn bản vá — chúng
không nói gì về vị từ. Chỉ A1·A4·C1·C2 mang thông tin (chống hỏng-về-phía-hẹp). RELEASE-02 KHÔNG được
trình bày các con số này như một cân bằng đối xứng.

Ghi số **ĐO ĐƯỢC** (không phải số dự đoán) vào RELEASE-02 — nếu lệch, đính chính như WO-1 đã làm, đừng
lặng lẽ sửa bảng cho khớp.

**Unit (không cần DB):** `apps/api/src/foundation/audit/audit.service.spec.ts` *(mới)*.

- **Nhánh DENY:** stub `DataScopeService.resolveOrNull` trả `null` cho cặp `("view","audit-log")` ⇒
  `listCompany` **và** `getCompanyDetail` đều ném `ForbiddenException` (D2).
- **Nhánh ALLOW — BẮT BUỘC (⟲R1-C9), không phải "cho đủ":** `rowScopeSql` chỉ assert **TÊN BẢNG**
  (`identity-projection.ts:201-207`), mà `auditLogs.actorUserId` và `auditLogs.companyId` **CÙNG một
  bảng** ⇒ truyền nhầm `companyIdCol` làm `idCol` sẽ **đi lọt** cổng đó và vị từ `Own` biến thành
  `company_id = <uuid người dùng>` (0 hàng, im lặng). Ca: stub `resolveOrNull → "Own"`, assert
  `findManyForActorTx` và `countForActorTx` cùng nhận MỘT grant có `basisOf(g)==='scoped-predicate'` và
  `g.table==='audit_logs'`, VÀ assert `buildUserScopeConditionOn` được gọi với
  `target.idCol === auditLogs.actorUserId` (không phải `companyId`). Int-spec A2/A3 cũng bắt được, nhưng
  chỉ khi có DB — nhánh ALLOW ở unit là lớp bắt duy nhất trên máy dev không Postgres
  (`deny-cases-vacuous-without-allow-case`, `% Funcs`).

`identity-projection-ratchet.unit-spec.ts` **không sửa**, nhưng sẽ tự ĐỎ cho tới khi
`ROW_SCOPE_MINT_PINS` được ký (§5 bước 8) — bằng chứng deny/allow mà pin đòi hỏi chính là bảng ca trên.

---

## 5. Thi công — theo file

1. **`harness/backlog.mjs`** — thêm `apps/api/src/dashboard/**` vào `paths` (D8).
   ⚠️ **ĐÍNH CHÍNH (FULL gate):** bản R1 của bước này viết "`paths` ĐÃ có … ⇒ chỉ cần XÁC MINH". SAI —
   dòng đó được **THÊM MỚI trong chính PR này** (thêm ngay sau khi plan R0 chỉ ra thiếu, trước khi
   viết R1), nên câu "đã xác minh trên cây" ở §0.1 không đúng cho dòng đó. Đúng khuôn
   `wo-plans-built-on-code-comments`: plan mô tả trạng thái mình vừa tạo ra như trạng thái sẵn có.
2. **`audit.repository.ts`** — import `rowScopeSql`, `type IdentityGrant`; **ĐỔI TÊN** họ cũ
   `findManyTx`/`countTx`/`findByIdTx` → `findManyUnscopedTx`/`countUnscopedTx`/`findByIdUnscopedTx`
   (D6a, rename thuần — `buildWhere` giữ nguyên tên vì là private); thêm
   `private buildWhereForActor(rowScope, filter): SQL`; thêm `findManyForActorTx`/`countForActorTx`/
   `findByIdForActorTx`. Docblock lớp nói rõ HAI họ + VÌ SAO tách bằng tên thay vì optional + câu D6(b).
   **`AuditRepository` giữ ZERO dep DI** (C10) — `DataScopeService` KHÔNG được tiêm vào đây.
2b. **`attendance-audit.service.ts:80-81` + `leave-audit.service.ts:74-75`** — đổi tên lời gọi theo D6(a).
   Đây là rename thuần, KHÔNG phải vá lây (D9 vẫn giữ: hai service không được bound thêm gì). Hai file
   này nằm ngoài `paths` ⇒ **phải thêm `apps/api/src/attendance/attendance-audit.service.ts` và
   `apps/api/src/leave/leave-audit.service.ts` vào `paths`** trước khi chạm, và nói rõ trong PR rằng
   diff ở đó là rename.
3. **`audit.service.ts`** — thêm `ForbiddenException`/`Logger`; import `DataScopeService`, `fromScope`,
   `auditLogs`; constructor nhận `dataScope: DataScopeService` (**không cần sửa `audit.module.ts`** —
   §0.1); thêm private `rowScopeFor(actor, why)` (D2/D3, không trích chung — D7); đổi chữ ký
   `listCompany`/`getCompanyDetail` (D8); gọi `rowScopeFor` **TRƯỚC** `withTenant` (`resolveOrNull` tự
   mở transaction riêng — không lồng); truyền `rowScope` vào **cả** `findManyForActorTx` VÀ
   `countForActorTx` (V3); `getCompanyDetail` → `findByIdForActorTx`, rỗng ⇒ `NotFoundException` cùng
   `code: AUDIT_NOT_FOUND` (D5). `listSystem`/`getSystemDetail` — chỉ đổi TÊN lời gọi theo D6(a).
   ⚠️ `rowScopeFor` PHẢI khai bằng **cú pháp method** (`private async rowScopeFor(...)`), KHÔNG phải
   property arrow (⟲R1-C13): census `enclosing()` chỉ nhận `MethodDeclaration`/`FunctionDeclaration`
   (`identity-projection-census.ts:220-232`); arrow property rơi xuống `nearestVar` và trả `"?"` ⇒
   ratchet ĐỎ khó hiểu dù đã ký đúng chuỗi.
4. **`audit.controller.ts`** — `listCompany(req.user, query)`, `getCompanyDetail(req.user, id)`.
5. **`dashboard-widget-handlers.service.ts`** — hai lệnh gọi trong `fetchSystemLogs`: `ctx.user.companyId`
   → `ctx.user`. ⚠️ **⟲R1-C11:** sau bản vá đó là **2 lượt `getCompanyRoleGrantsWithScope`** mỗi lần
   render dashboard, mà hàm đó **cố ý KHÔNG cache** (`permission.cache.ts:91-100`) — WO-1 D11 đã tốn
   công giảm 3→2 lượt/request đúng vì lý do này. Chọn MỘT: (a) gộp hai cửa sổ vào MỘT lượt `listCompany`
   rồi tự tách 24h/7d; hoặc (b) giữ hai lượt và ghi chi phí có tên vào §8. Không được im lặng nhận (b).
6. **`audit.service.spec.ts`** *(mới)* — ca 403 của D2.
7. **`foundation-audit-row-scope.int-spec.ts`** *(mới)* — bảng ca §4. Gate `hasDb && LANE_DB`.
8. **`identity-projection-verdicts.ts`** — thêm `"foundation/audit/audit.service.ts#rowScopeFor"` vào
   `ROW_SCOPE_MINT_PINS` + câu docblock: điểm đúc THỨ HAI (bảng `audit_logs`, cặp `view:audit-log`,
   KI-072), trỏ tới `foundation-audit-row-scope.int-spec.ts` làm bằng chứng deny/allow.
   *(Khoá đã kiểm khớp định dạng: `rel()` neo từ `apps/api/src`, forward-slash —
   `identity-projection-census.ts:105-107`.)*
8b. **`identity-projection-ratchet.unit-spec.ts`** — thêm ASSERT TĨNH của D6(c): tập file tiêu thụ họ
   `*UnscopedTx` phải ĐÚNG BẰNG ba file đã liệt kê. Đây là lớp DUY NHẤT bịt chiều "đúc đúng, tiêu thụ
   sai đường" (⟲R1-B3).
9. **Docs:** `RELEASE-02` (đóng KI-072 — **câu chữ theo §2.1**: "phạm vi HAI route", không phải
   "`audit_logs` đã bound"; kèm số đo PROD ĐO LẠI lúc merge) · `docs/permission-matrix-spec.md`
   (dòng `/foundation/audit-logs` + `/:id`: KI-072 MỞ → ĐÓNG) · `harness/backlog.mjs` (`status: done`).

**Không chạm:** migration (0 thay đổi schema) · `permission/identity-projection.ts` ·
`permission/data-scope.service.ts` · route `/all`,`/all/:id` (D10) · `packages/contracts` (0 đổi
DTO/query shape) · `chat/chat-oversight.repository.ts` (§2.1 — nợ có tên, cặp quyền khác).

⚠️ **`paths` của WO có `apps/api/src/permission/**` và `apps/api/src/auth/**` nhưng plan này KHÔNG đổi
một dòng nào ở hai cây đó** (⟲R1 câu hỏi mở #3). Ghi ra để `guard-scope` không bị đọc là "được phép
sửa": hai đường đó nằm trong `paths` vì WO seed dự phòng cho phương án trích helper chung — phương án
đã bị D7 loại.

---

## 6. Bẫy đã biết phải né

| bẫy | né thế nào |
| --- | --- |
| `deny-cases-vacuous-without-allow-case` | mỗi ca RED có ca ALLOW đối chứng (A1-A4) |
| `tests-can-pin-a-hole-open` | ca RED viết trước, phải ĐỎ trên cây hôm nay; cấm nới assert cho khớp |
| `integration-test-lane-db-gate` | `describe.skipIf(!hasDb)` + chạy với `LANE_DB` |
| `wo-paths-drive-gate-and-scheduler` | bước 1 §5 sửa `paths` (thêm `dashboard/**`) TRƯỚC khi code |
| `wo-seed-hand-measurements-can-be-incomplete` | §0 đã đính chính số SA 10→2; ĐO LẠI trước merge |
| tên file trùng WO-1 | `audit-log-row-scope.int-spec.ts` đã bị chiếm ⇒ `foundation-audit-row-scope.int-spec.ts` |
| nhầm `dataScope` (bộ lọc cột) với `scope` (resolve của actor) | §4 đầu mục |
| "sửa" `Own` bằng `OR actor_user_id IS NULL` | D3 — ca `N1` ghim |
| optional `rowScope` thay vì method mới | D6 |
| mutate `rowScopeSql` dùng chung cho RED-proof | §4 — làm suite WO-1 ĐỎ oan |
| **XOÁ `rowScopeSql` khỏi `conds` khi RED-proof** | ⟲R1-B1 — `and()` rỗng ⇒ `WHERE false` ⇒ ca DENY xanh-RỖNG. Phải **THAY** bằng `` sql`true` `` ở CẢ `buildWhereForActor` VÀ `findByIdForActorTx` |
| **tin họ phương thức mới là bảo đảm kiểu** | ⟲R1-B3 — họ cũ vẫn public; phải rename + docblock + assert tĩnh D6(a)(b)(c) |
| **quên đường đọc thứ NĂM (`chat-oversight`)** | §2.1 — RELEASE-02 viết "phạm vi 2 route", không viết "`audit_logs` đã bound" |
| **`meta.total` chỉ có ca `=== 0`** | ⟲R1-B4 — thêm C1/C2 (`total` khác 0, hằng từ fixture) |
| **fixture không TAG** ⇒ nhiễu từ suite khác + audit của `/auth/login` | ⟲R1-C7 — mọi hàng seed mang `action=${TAG}-…`, mọi lượt gọi kèm `&action=` |
| **`insertAudit` lấy nhầm file** | ⟲R1-C8 — khuôn của `audit-permission-deny` KHÔNG có `actor_user_id`; dùng `audit-list-filter.int-spec.ts:73-86` |
| **`rowScopeFor` viết dạng arrow property** | ⟲R1-C13 — census `enclosing()` trả `"?"` ⇒ ratchet ĐỎ khó hiểu |
| **tiêm `DataScopeService` vào `AuditRepository`** | ⟲R1-C10 — ATT/LEAVE tự provide repo, sập AppModule ở boot |
| trích `rowScopeFor` chung "tiện tay" | D7 |
| quên `dashboard-widget-handlers.service.ts` | D8 — compile đỏ nếu quên, nhưng biết trước |
| vá kèm Attendance/Leave "cho triệt để" | D9 |

---

## 7. Nghiệm thu

| `done_when` | thoả ở |
| --- | --- |
| RED trước: hàng ngoài scope + dò `?actorUserId=` | R1 · R2 (§4) |
| Ca đối chứng ALLOW | A1-A4 (§4) |
| `/:id` có ca RIÊNG | R3 (RED) + A4 (đối chứng) — D5, §4 |
| `pagination.total` cùng vị từ | `countForActorTx` bắt buộc `rowScope`; R2 assert cả `data` lẫn `meta.total` |
| PHÁT BIỂU ngữ nghĩa `Own` trước khi dựng vị từ | D3, ghim bằng N1 |
| `ROW_SCOPE_MINT_PINS` ký lại + int-spec của CHÍNH `audit_logs` | §5 bước 8, bằng chứng = §4 |
| FULL gate security-reviewer PASS + RELEASE-02 kèm số đo | §5 bước 9 |

**FULL gate** (zone 🔴): `security-reviewer` (bắt buộc) + `database-reviewer` (chạm repository dù 0
migration) + `silent-failure-hunter` (V1/V3 là silent-failure kinh điển). **Merge người chốt tay — cấm
auto-merge vùng đỏ.**

Chạy như CI: `bash harness/check.sh --lane-db=auditlogrow2` — int-spec phải THỰC SỰ chạy, không skip.

**Rollback:** code-only, 0 migration ⇒ revert PR là đủ cho sự cố CODE. Nhưng nếu sự cố là **403 hàng
loạt do K2/K3** (⟲R1 câu hỏi mở #4) thì revert không phải đường nhanh nhất, và kill-switch
`PERMISSION_GUARD_ENABLED` **không** mở được route này (K1): đường thoát vận hành DUY NHẤT là
`UPDATE role_permissions SET data_scope='Company'` cho cặp `view:audit-log` của vai bị kẹt. Ghi cả hai
đường vào RELEASE-02 — người trực ca cần biết trước, không phải suy ra lúc 2 giờ sáng.

---

## 8. Ranh giới KHÔNG đóng trong WO này (nợ CÓ TÊN)

- **Attendance/Leave audit viewer** — CÙNG HÌNH DẠNG lỗ (row-scope chưa bound trên `AuditRepository`)
  nhưng dưới cặp quyền RIÊNG (`view:attendance-audit-log`/`view:leave-audit-log`). Cần WO/KI riêng, số
  hiệu do chủ dự án cấp khi seed backlog — không tự đánh số ở plan này (§2, D9).
- **Đường SYSTEM operator** (`/all`, `/all/:id`) — biên audience + cặp quyền khác, CHỦ Ý chéo tenant.
  Không phải nợ, là ranh giới thiết kế (§2, D10).
- **K1/K2 kế thừa** — kill-switch không mở được route; cửa sổ cache 300s ⇒ 403 chủ ý khi role vừa bị gỡ.
  Cùng cơ chế `DataScopeService` của KI-070, nay CŨNG che `audit_logs`. Thêm một consumer, không phải
  vấn đề mới.
- **N-1b (sàn hoá Team/Department)** — `Team`/`Department` = 0 hàng, kế thừa nghịch lý không-đơn-điệu đã
  ghi ở KI-070 (giữ đồng thời `@Own`+`@Team` ⇒ resolve `Team` ⇒ MẤT hàng). Sàn hoá phải làm cho CẢ BỐN
  đường cùng lúc (`login_logs`, `user_security_events`, `audit_logs`, và KI-071 sau này).
- **`ROW_SCOPE_MINT_PINS` sẽ có ĐIỂM THỨ BA** khi `S10-SEC-ROLEMEMBERROW-1` (KI-071) đóng — lúc đó là
  điểm tự nhiên để cân nhắc lại D7, KHÔNG phải bây giờ.
- **PAT/api-key** — vị từ hàng resolve scope của USER, bỏ qua `scopeKeys` thu hẹp của PAT. Không phải
  hồi quy (hôm nay cũng vậy trên mọi route dùng `DataScopeService`), ranh giới kế thừa từ KI-070.
- **⟲R1-B2 — `ChatOversightRepository.listOversightAudit` (`chat-oversight.repository.ts:335-399`),
  đường ĐỌC `audit_logs` thứ NĂM.** Ba vế, đo 22/08: (1) `opts.actorUserId` từ caller đi THẲNG vào
  `WHERE` (`:352-354`) = hình dạng V2; (2) **0 vị từ row-scope**; (3) chiếu `users.fullName` bằng
  `leftJoin` trần (`:386-389`, không qua `identityColumns`) và trả `auditLogs.metadata` **THÔ** (`:381`)
  trong khi đường foundation coi `metadata` là phải `masker.mask()`. Gate là cặp CHAT riêng +
  `ChatOversightAuditGuard` ⇒ ngoài phạm vi WO này. **Cần WO/KI riêng, số hiệu do chủ dự án cấp.**
- **⟲R1-B3 — `AuditRepository` sau WO này phục vụ HAI họ ngữ nghĩa trong cùng một lớp**
  (`*ForActorTx` bound / `*UnscopedTx` không bound). Đó là nợ THIẾT KẾ, giữ đúng bằng assert tĩnh D6(c)
  chứ không bằng kiểu. Điểm revisit tự nhiên: cùng lúc với D7 khi KI-071 đóng.
- **⟲R1-C11 — ĐÃ CHỌN phương án (b)**: giữ 2 lượt `listCompany` trong `fetchSystemLogs` ⇒ 2 truy vấn
  `getCompanyRoleGrantsWithScope` KHÔNG cache mỗi lần render dashboard. Chi phí đã ghi TÊN ở RELEASE-02
  (plan cấm im lặng nhận (b)). Gốc sâu hơn: hàm đó passthrough-không-cache dựa trên giả định "chỉ dùng
  ở `/auth/me` bootstrap" — giả định mà chính KI-072 vừa làm sai; gỡ nợ đó là WO riêng.
- **⟲FULL gate — widget `SYSTEM_LOGS` biến mất IM LẶNG** khỏi `GET /dashboard/widgets?include_data=true`
  khi `rowScopeFor` ném 403 (`attachData` bắt `ForbiddenException` rồi `continue`). D11 đã ghi nhận hai
  chế độ hỏng nhưng đóng khung là "không có gì mới"; đánh giá đó THẤP hơn thực tế: trước bản vá nhánh
  câm chỉ trúng khi race TOCTOU, nay K1/K3 là điều kiện ĐỨNG YÊN. Fast-follow, chưa cấp số.
- **⟲FULL gate — K4**: `gateOrThrow` của widget gọi `permission.can()` **không truyền `isSensitive`**
  ⇒ vai chỉ giữ `*:*` qua cổng widget rồi bị `rowScopeFor` chặn. Hôm nay 0 vai như vậy (đã đo bằng câu
  bao trùm wildcard), nhưng cổng widget và cổng service đang bất đồng về cờ sensitive — nợ có tên.
