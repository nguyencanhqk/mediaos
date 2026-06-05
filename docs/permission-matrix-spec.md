# Permission Matrix Spec — G0-4

> **Nguồn sự thật** cho phân quyền MediaOS (MVP-0). Thực thi: [ADR-0010](adr/0010-permission-engine-4-tier.md). Phạm vi: chỉ phần [`mvp-0-scope.md`](mvp-0-scope.md). Đây là **đặc tả thiết kế** — không phải code thật. Test deny-path TRƯỚC (RED) theo [`CLAUDE.md` §6](../CLAUDE.md).
>
> **3 bất biến chi phối tài liệu này:** (1) `company_id` ép bằng RLS ở tầng DB, không nằm trong PermissionService; (2) không hard-delete audit; (3) secret/masking là việc của **server**, FE chỉ UX.

---

## 1. Mô hình 4 tầng

PermissionService trả lời đúng 1 câu hỏi: **"Trong cùng 1 tenant, user X có được làm `action` lên `objType/objId` không?"**. Tenant isolation (cross-company) KHÔNG thuộc tầng này — đó là việc của RLS (§6).

| Tầng | Tên | Hỏi gì | Nguồn dữ liệu | Kết quả |
| --- | --- | --- | --- | --- |
| 1 | **RBAC** | User có `permission(action, objType)` qua role nào không? | `roles` → `role_permissions` | allow / deny / none |
| 2 | **Scope** | Quyền đó phủ tới *phạm vi dữ liệu* chứa object này không? | scope của grant: `company \| department \| team \| project \| channel \| self` | object có nằm trong scope không |
| 3 | **Object-level** | Có grant/deny gắn trực tiếp lên *instance* này không? | `object_permissions(object_type, object_id, effect)` | allow / deny / none — **override Tầng 1+2** |
| 4 | **Sensitive** | Action này có nhạy cảm không? Nếu có, đã được cấp **tường minh** chưa? | flag `is_sensitive` của permission + grant riêng | gate cứng — **không kế thừa** |

### 1.1. Định nghĩa từng tầng

- **Tầng 1 — RBAC.** Map `role → permission`. Một user có thể giữ nhiều role; tập quyền = hợp (union) các allow, trừ đi các deny (deny thắng). Permission là cặp `(action, objType)` + cờ `is_sensitive`.
- **Tầng 2 — Scope.** Mỗi grant có một `scope` định nghĩa *phạm vi dữ liệu* user được chạm: `company` (toàn tenant) ⊃ `department` ⊃ `team`; song song có scope theo cấu trúc nội dung `project` / `channel`; và `self` (chỉ bản ghi của chính mình). Object phải *thuộc về* scope đó (vd task thuộc project mà user là member, hoặc thuộc team user phụ trách).
- **Tầng 3 — Object-level.** `object_permissions` cấp/cấm quyền trên **một instance cụ thể** (1 project, 1 platform_account…). Dùng cho: thêm member ad-hoc vào project, hoặc cấm 1 người cụ thể trên 1 object dù role cho phép. Tầng này **override** Tầng 1+2.
- **Tầng 4 — Sensitive.** Quyền nhạy cảm (`view-salary`, `reveal-secret`, `view-finance`…) gắn cờ `is_sensitive=true`. Loại quyền này **không bao giờ tự kế thừa** từ role thường (kể cả Company Admin); phải có một grant ALLOW **tường minh** cho đúng permission đó. Mọi quyết định trên dữ liệu nhạy cảm phải ghi audit (+ re-auth với reveal-secret).

### 1.2. Thuật toán quyết định cuối (deny-by-default)

Thứ tự đánh giá trong `can()` (chuẩn hóa từ [erd-v2 §4.2](erd-v2.md)):

```text
INPUT: user, action, objType, objId, ctx

0. (Ngoài tầng này) RLS đã đảm bảo objId thuộc ctx.companyId.
   Object khác tenant → không tồn tại trong tầm nhìn (0 row / 404). KHÔNG để PermissionService phán.

1. Gom mọi grant áp dụng cho user trên (action, objType):
   - từ role_permissions (Tầng 1) lọc theo scope (Tầng 2)
   - từ object_permissions (Tầng 3) khớp (objType, objId)

2. DENY-WINS: nếu có BẤT KỲ effect='deny' khớp (role hoặc object) → DENY ngay. (Matrix §10 quy tắc #1)

3. SENSITIVE GATE: nếu permission.is_sensitive = true:
     → phải có một ALLOW tường minh CHO ĐÚNG permission đó (không suy ra từ 'manage'/role cha).
     → thiếu ALLOW tường minh → DENY (kể cả Company Admin).
     → reveal-secret: thêm yêu cầu re-auth còn hiệu lực trong ctx.

4. SCOPE CHECK: với mỗi ALLOW còn lại, kiểm tra objId có nằm trong scope của grant không
   (company ⊃ department ⊃ team; project/channel theo membership; self = owner).

5. Nếu tồn tại ALLOW khớp scope (và qua được gate sensitive nếu có) → ALLOW.

6. Mặc định → DENY (deny-by-default).

7. Nếu objType/action thuộc nhóm nhạy cảm hoặc hành động quan trọng → ghi audit_log (cả khi DENY).
```

**Tóm tắt ưu tiên:** `DENY tường minh` > `Sensitive gate` > `Object ALLOW` > `Role ALLOW trong scope` > `DENY mặc định`.

---

## 2. Chữ ký `PermissionService.can()`

```text
can(user, action, objType, objId?, ctx) -> Decision

Decision = {
  allow: boolean,
  reason: 'allow' | 'deny-default' | 'deny-explicit'
        | 'deny-scope' | 'deny-sensitive' | 'deny-reauth-required',
  requiresReauth?: boolean,      // true với reveal-secret chưa re-auth
  auditRequired: boolean         // true nếu chạm nhóm nhạy cảm / hành động quan trọng
}
```

- **`user`**: định danh + tập role + tập object_permissions đã resolve (lấy từ cache, §7). KHÔNG chứa companyId — companyId luôn từ `ctx`.
- **`action`**: enum (§3), vd `approve`, `submit`, `return`.
- **`objType`**: enum ObjectType (§3).
- **`objId`**: id instance. Cho phép `null` khi hỏi *"có quyền action trên loại này về nguyên tắc không"* (vd hiện/ẩn nút "Tạo Project" — Tầng 1+4, bỏ qua Tầng 3 scope-instance). Khi có `objId` → kiểm tra đủ 4 tầng.
- **`ctx`**: `{ companyId, currentScope?, reauthValidUntil?, requestId }`.
  - `companyId` — bắt buộc; dùng để chọn cache key và đối chiếu (RLS mới là cái ép thật ở DB).
  - `currentScope` — gợi ý phạm vi đang thao tác (vd đang ở project nào) để tối ưu Tầng 2.
  - `reauthValidUntil` — phục vụ Tầng 4 reveal-secret.

### 2.1. Tách 3 câu hỏi (đừng trộn)

| Câu hỏi | Tầng | Trả về khi sai |
| --- | --- | --- |
| "Có quyền `action` trên `objType` không?" | 1 + 4 | 403 (thiếu RBAC / thiếu sensitive grant) |
| "Object này có trong scope của tôi không?" | 2 | 403 (sai scope) — *hoặc 404 để không lộ tồn tại* |
| "Tôi có grant trực tiếp trên đúng object này không?" | 3 | 403 (không phải member/được cấp) |

> Quy ước lộ thông tin: với object **không thuộc scope** của user nhưng cùng tenant → ưu tiên trả **404** (giấu sự tồn tại) cho object nhạy cảm; **403** cho object thường. Cross-tenant luôn là **404 / 0 row** do RLS.

---

## 3. Danh mục Action & ObjectType (MVP-0)

### 3.1. Action

| Action | Ý nghĩa | Ghi chú |
| --- | --- | --- |
| `create` | Tạo | |
| `read` | Xem | masking field nhạy cảm ở server |
| `update` | Sửa | |
| `delete` | Xóa (soft) | `delete-project`/`delete-employee` là **sensitive** (§5) |
| `submit` | Nộp work (file/link) | của task assignee |
| `comment` | Bình luận trong task/project | |
| `assign` | Giao task / gán nhân sự | |
| `approve` | Duyệt (1 cấp ở MVP-0) | qua `approval_requests` |
| `return` | Trả sửa / yêu cầu revision | chọn bước lỗi + người chịu TN |
| `manage` | Quản lý đầy đủ trong scope | = union các action thường, **không** gồm sensitive |
| `reveal-secret` | Lộ secret tài khoản kênh | sensitive, **hoãn G5e** |
| `view-finance` | Xem doanh thu/chi phí/lợi nhuận | sensitive, **hoãn G5g** |
| `view-salary` | Xem lương người khác | sensitive, **hoãn G5f** |

### 3.2. Action × ObjectType áp dụng MVP-0

(`C`reate `R`ead `U`pdate `D`elete `As`sign `Su`bmit `Cm`comment `Ap`prove `Re`turn `M`anage; `—` = không áp dụng MVP-0)

| ObjectType | C | R | U | D | As | Su | Cm | Ap | Re | M |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Company | — | ✓ | ✓ | — | — | — | — | — | — | ✓ |
| Department | ✓ | ✓ | ✓ | ✓ | — | — | — | — | — | ✓ |
| Team | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | — | ✓ |
| User (employee) | ✓ | ✓ | ✓ | ✓* | — | — | — | — | — | ✓ |
| Role | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | — | ✓ (sensitive: change-role) |
| Channel | ✓ | ✓ | ✓ | ✓ | — | — | — | — | — | ✓ |
| Project | ✓ | ✓ | ✓ | ✓* | ✓ | — | ✓ | — | — | ✓ |
| Content | ✓ | ✓ | ✓ | ✓ | — | — | ✓ | — | — | ✓ |
| WorkflowInstance | (auto) | ✓ | ✓ | — | — | — | — | — | — | ✓ |
| Step | (auto) | ✓ | ✓ | — | — | — | — | ✓ | ✓ | ✓ |
| Task | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | ✓ |
| ApprovalRequest | (auto) | ✓ | — | — | — | — | — | ✓ | ✓ | — |
| Comment | ✓ | ✓ | ✓ | ✓ | — | — | — | — | — | — |
| Notification | (auto) | ✓ | ✓ | — | — | — | — | — | — | — |
| ChatGroup | ✓ | ✓ | ✓ | — | ✓ | — | — | — | — | ✓ |

`*` = sensitive khi xóa Project/User (§5). `(auto)` = sinh bởi event/workflow, không tạo trực tiếp qua API người dùng.

---

## 4. Ma trận Role × Permission (MVP-0)

Role tối thiểu cho walking skeleton (gộp theo [Matrix §15](../USER%20ROLE%20%26%20PERMISSION%20MATRIX%20—%20MVP%20v1.md), position chuyên môn Editor/Script tách khỏi role phân quyền nhưng vẫn cần để định tuyến task).

Ký hiệu: **C** company · **D** dept · **T** team · **P** project · **Ch** channel · **O** own/self · **✓** allow · **✗** deny/none · **G** chỉ khi được cấp tường minh (object/sensitive).

| Action / Object | CompanyAdmin | ProjectManager | ChannelManager | ScriptWriter | Editor | QAReviewer | Uploader | Employee |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Content.create | C | P | Ch | ✗ | ✗ | ✗ | ✗ | ✗ |
| Content.read | C | P | Ch | P(assigned) | P(assigned) | P(assigned) | P(assigned) | O(assigned) |
| Project.create | C | G | G | ✗ | ✗ | ✗ | ✗ | ✗ |
| Project.read | C | P | Ch | P(assigned) | P(assigned) | P(assigned) | P(assigned) | O(assigned) |
| Project.assign (nhân sự/task) | C | P | G | ✗ | ✗ | ✗ | ✗ | ✗ |
| Task.read | C | P | Ch | O | O | O | O | O |
| Task.submit (nộp work) | ✗ | ✗ | ✗ | O | O | O | O | O |
| Task.comment | C | P | Ch | O(in task) | O(in task) | O(in task) | O(in task) | O(in task) |
| Step.approve (Script) | ✓ | P | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Step.approve (Edit→QA) | ✓ | ✗ | ✗ | ✗ | ✗ | T/P | ✗ | ✗ |
| Step.approve (QA→PM) | ✓ | P | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Step.approve (Upload) | ✓ | ✗ | Ch | ✗ | ✗ | ✗ | ✗ | ✗ |
| Step.return (trả sửa) | ✓ | P | Ch | ✗ | ✗ | T/P | ✗ | ✗ |
| Channel.update | C | G(project-linked) | Ch(phụ trách) | ✗ | ✗ | ✗ | ✗ | ✗ |
| User.read | C | P(members) | Ch | O | O | O | O | O |
| Role.update (change-role) | **G**(sensitive) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Project.delete | **G**(sensitive) | G | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| ChatGroup.create | C | P | Ch | G | G | G | G | G |
| Notification.read | O | O | O | O | O | O | O | O |

> **CompanyAdmin** giữ `manage` toàn tenant nhưng **vẫn không** tự có quyền sensitive (view-salary/reveal-secret/finance) — phải cấp tường minh (§5). Đây là điểm chống leo thang quyền cốt lõi.

---

## 5. Quyền nhạy cảm (Tầng 4)

Nguyên tắc bất biến ([Matrix §10–11](../USER%20ROLE%20%26%20PERMISSION%20MATRIX%20—%20MVP%20v1.md), [ADR-0010](adr/0010-permission-engine-4-tier.md)):

1. **Không kế thừa** — `manage`/role cha KHÔNG suy ra được quyền sensitive.
2. **Cấp tường minh** — phải có ALLOW cho đúng permission `is_sensitive=true`.
3. **Re-auth** với reveal-secret (xác thực lại trong cửa sổ ngắn).
4. **Luôn ghi audit** (cả khi DENY) — ai/khi/object/lý do.

| Permission sensitive | Object | MVP-0 | Re-auth | Ghi chú |
| --- | --- | --- | --- | --- |
| `change-role` / `update-permission` | Role | **Có** | Khuyến nghị | Chỉ CompanyAdmin được cấp; đổi quyền có audit |
| `delete-project` | Project | **Có** | — | Tách khỏi `manage` project |
| `delete-employee` | User | **Có** | — | Soft-delete; audit |
| `access-audit-log` | AuditLog | **Có (chỉ admin được cấp)** | — | Read-only |
| `reveal-secret` | PlatformAccount | **Hoãn G5e** | **Bắt buộc** | Envelope decrypt phía app; mỗi lần xem = 1 audit row |
| `edit-platform-account` | PlatformAccount | Hoãn G5e | Khuyến nghị | |
| `view-salary` (người khác) | Payslip | **Hoãn G5f** | — | "self" xem lương mình KHÔNG sensitive |
| `approve-payroll` | Payslip | Hoãn G5f | Khuyến nghị | |
| `view-finance` (revenue/cost/profit) | Channel/Project | **Hoãn G5g** | — | |
| `export-finance-report` | Finance | Hoãn G5g | — | |
| `override-approval` / `unlock-step` / `close-serious-defect` | Step/Defect | Hoãn G5a/b | Khuyến nghị | |

> MVP-0 **bắt buộc** đã có *gate* sensitive trong engine (4 quyền đầu) dù module finance/payroll/secret hoãn — để khi bật module G5 không phải sửa lõi `can()`.

---

## 6. Tương tác với RLS (phân vai rõ ràng)

| Mối lo | Ai lo | Cơ chế |
| --- | --- | --- |
| **Tenant isolation** (company A ≠ B) | **RLS ở DB** | `FORCE ROW LEVEL SECURITY` + policy `company_id = current_setting('app.current_company_id')`; mọi truy cập qua `withTenant()` ([erd-v2 §6](erd-v2.md)) |
| **Phân quyền trong CÙNG tenant** | **PermissionService** | 4 tầng (§1) |
| **Masking field nhạy cảm** | **Server** | Field bị cấm → không đưa vào DTO/WS payload; FE không nhận → không render (CLAUDE §5) |

Quy tắc không chồng vai:

- PermissionService **giả định** mọi `objId` truyền vào đã cùng `ctx.companyId` — vì RLS đã loại object ngoài tenant ở tầng query (trả 0 row). Engine **không** tự kiểm `company_id` (tránh hai nguồn sự thật).
- Hệ quả test: một cross-tenant probe phải fail ở **RLS** (0 row / 404), không phải ở `can()`. Nếu nó tới được `can()` nghĩa là RLS thủng → lỗi nghiêm trọng hơn phân quyền.
- Masking: ngay cả khi `read` được phép, các field sensitive (secret, lương) chỉ vào DTO khi qua được Tầng 4. WS payload đi qua **cùng** masking layer như REST (CLAUDE §5).

---

## 7. Caching & Invalidation (Valkey)

**Cache cái gì:** "capabilities đã resolve" của user trong 1 tenant — tập `(action, objType, scope, effect)` từ role + object_permissions, kèm cờ sensitive. KHÔNG cache quyết định `can()` theo từng objId (scope/object thay đổi liên tục).

**Cấu trúc key (luôn gắn companyId + userId):**

```text
perm:cap:{companyId}:{userId}          -> hash capabilities (TTL ngắn, vd 300s)
perm:objgrants:{companyId}:{userId}    -> object_permissions của user (TTL ngắn)
perm:ver:{companyId}                   -> version counter của tenant (bump để vô hiệu hàng loạt)
```

Key gắn `companyId` ở đầu để tránh rò chéo tenant trong cache và để xóa theo prefix khi cần.

**Khi nào invalidate:**

| Sự kiện | Hành động |
| --- | --- |
| Đổi role của user / gán-bỏ role | xóa `perm:cap:{co}:{user}` |
| Sửa `role_permissions` của 1 role | bump `perm:ver:{co}` (ảnh hưởng mọi user giữ role đó) hoặc xóa cap của các user liên quan |
| Thêm/sửa/xóa `object_permissions` | xóa `perm:objgrants:{co}:{user}` (+ cap nếu effect đổi) |
| Cấp/thu quyền sensitive | xóa cap của user; **bắt buộc** audit |
| User join/leave project/team | xóa cap + objgrants của user (scope đổi) |

- Mọi thay đổi quyền đi qua event/outbox → consumer invalidate cache (idempotent qua `processed_events`).
- TTL ngắn là lưới an toàn cho trường hợp bỏ sót invalidation; deny-by-default vẫn giữ an toàn khi cache miss (re-resolve từ DB).

---

## 8. Deny-cases phải test TRƯỚC (RED) — ≥12 case

Mỗi case: `actor → action → kỳ vọng`. Đây là test RED trước khi viết engine (CLAUDE §6, [erd-v2 §4.2](erd-v2.md)).

### (a) RBAC thiếu quyền

1. `Employee → Step.approve(QA step)` → **403** (không có permission approve).
2. `ScriptWriter → Content.create` → **403** (chỉ PM/ChannelManager tạo content).
3. `Editor → Project.delete(P1)` → **403** (không có delete).

### (b) Đúng quyền nhưng sai scope

4. `PM của Team A → Step.approve(task thuộc Project của Team B)` cùng công ty → **403 deny-scope** (có quyền approve nhưng object ngoài scope).
5. `ChannelManager kênh X → Channel.update(kênh Y)` → **403 deny-scope**.
6. `QAReviewer Team A → Step.return(step Team B)` → **403 deny-scope**.
7. `Employee → Task.read(task không assign cho mình)` cùng project → **404** (giấu) hoặc **403**.

### (c) Object-level (không phải member)

8. `PM không phải member Project P2 → Task.assign(P2)` → **403** (thiếu object grant / không trong project scope).
9. `Uploader chưa được thêm vào Project → Content.read(content của project đó)` → **404/403**.
10. `User bị object_permissions effect='deny' trên Project P3 → Project.read(P3)` dù role cho phép → **403 deny-explicit** (DENY-WINS).

### (d) Sensitive không kế thừa

11. `CompanyAdmin (không có grant sensitive) → view-salary(payslip người khác)` → **403 deny-sensitive** (manage không suy ra sensitive).
12. `ChannelManager → reveal-secret(platform_account kênh mình phụ trách)` mà chưa cấp `reveal-secret` → **403 deny-sensitive**.
13. `User có reveal-secret nhưng chưa re-auth → reveal-secret(account)` → **deny-reauth-required** (yêu cầu re-auth, chưa lộ secret).
14. `DeptManager → change-role(user khác)` không có `update-permission` → **403 deny-sensitive**.

### (e) Cross-tenant (kết hợp RLS)

15. `CompanyAdmin công ty A → Project.read(P thuộc công ty B)` → **404 / 0 row** (chặn ở RLS, KHÔNG tới `can()`).
16. `User công ty A → Task.submit(task công ty B)` → **0 row affected** (RLS không thấy row để update).
17. `User công ty A → reveal-secret(account công ty B)` → **404 ở RLS trước**, không phải deny-sensitive.

> Yêu cầu: nhóm (e) phải verify **đường chặn là RLS** (qua log/probe), không phải PermissionService — để phát hiện RLS thủng.

---

## 9. Câu hỏi mở / rủi ro cần chốt trước khi code G3

1. **Scope `manage` vs sensitive** — chốt dứt khoát: `manage` có bao gồm `delete-project`/`delete-employee` không? Đề xuất: **KHÔNG** (tách sensitive). Cần xác nhận để seed permission đúng.
2. **404 vs 403** — quy ước lộ thông tin cho object cùng tenant ngoài scope: chọn 404 (giấu) cho nhóm nào, 403 cho nhóm nào? Ảnh hưởng UX và test kỳ vọng (§8).
3. **Định tuyến approve theo bước** — Step.approve phụ thuộc *loại bước* (Script→PM, Edit→QA, QA→PM, Upload→ChannelManager). Quyền này gắn vào permission `approve` + điều kiện bước, hay tách permission theo bước? Đề xuất: 1 permission `approve` + Tầng 2/3 quyết "đúng người duyệt của step này" qua `reviewer_user_id`.
4. **Object scope cho QAReviewer ở bước Edit** — QA vừa là người thực hiện bước QA vừa là người duyệt bước Edit. Cần model rõ "reviewer của step" để không nhầm self-approve.
5. **Cache invalidation khi đổi `role_permissions`** — bump version tenant (đơn giản, vô hiệu rộng) hay xóa cap từng user (chính xác, tốn tính toán)? Chốt theo số user/role.
6. **Re-auth window cho reveal-secret** — thời hạn re-auth bao lâu, lưu ở đâu (session/Valkey)? Cần trước G5e nhưng nên định hình interface `ctx.reauthValidUntil` ngay G3.
7. **`can(objId=null)`** — đồng bộ FE `useCan()`/`<PermissionGate>`: FE chỉ ẩn nút (UX), server vẫn enforce đủ 4 tầng. Xác nhận FE không bao giờ tự suy quyền (CLAUDE §5).
8. **deny ở object_permissions** — có cho phép deny ở mức object để "cấm 1 người trên 1 project" không? Đề xuất: **Có** (đã có cột `effect`), và phải nằm trong nhánh DENY-WINS (§1.2 bước 2).
