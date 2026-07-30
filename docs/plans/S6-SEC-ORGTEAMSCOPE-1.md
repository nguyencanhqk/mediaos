# S6-SEC-ORGTEAMSCOPE-1 — N-1c: `/org/teams/:id/members` chiếu email/họ tên mà không ép `data_scope` (KI-049)

> Zone: **red / crown-jewel** · Gate: **FULL** · Mở 2026-07-28 từ FULL gate của `S6-SEC-ORGSCOPE-1`
> (2/3 reviewer phát hiện độc lập). Cấp số hiệu **KI-049** ngày 2026-07-29 — xem §1.1.

## 1. Sự việc

`GET /org/teams/:id/members` gate `@RequirePermission("read", "team")`, còn
`OrgRepository.listTeamMembers` chiếu `userFullName` + `userEmail` và chỉ bọc `withTenant` — **không
resolve `data_scope` nào**. Tức **cặp quyền gate (`team`) LỆCH với lớp dữ liệu trả về (`user`)**.

Đây là lần thứ ba của **cùng một lớp lỗi** trong ba tuần:

| | Route | Cặp gate | Đã vá bởi |
| --- | --- | --- | --- |
| N-1 | `/org/employees` | `view:user` | `S6-SEC-ORGSCOPE-1` (#302) |
| N-2 | (chốt động từ danh bạ về `view:user`, bỏ legacy `read:user`) | — | `S6-SEC-PERMVERB-1` (#305) |
| **N-1c** | **`/org/teams/:id/members`** | **`read:team`** | **WO này** |

`S6-SEC-PERMVERB-1` **không** chạm route này: nó chốt động từ của danh bạ (`view:user`), còn route này
gate động từ `team`. Đã verify trên master sau #305 — `org.controller.ts:179-181` vẫn
`@RequirePermission("read","team")`, service vẫn không resolve scope.

### 1.1 Vì sao phải cấp số hiệu trước khi vá

Trước 2026-07-29, N-1c chỉ tồn tại dưới dạng **ghi chú văn xuôi** bên trong khối của `KI-030`
(`grep` bảng KI ⇒ **0 dòng**). Một lỗ hở dữ liệu không có số hiệu thì **vô hình với mọi con số
severity** và với bước *"bug scrub toàn bộ S0/S1/S2"* trước RC (`RELEASE-05` §5.3) — nghĩa là không
thể bị scrub, và có thể lên RC mà không ai thấy. Đã cấp `KI-049` (`S2`) trong cùng nhánh này.

## 2. ĐO TRƯỚC KHI SIẾT (bắt buộc theo `done_when`)

Đo trên PROD `mediaos` 2026-07-29, **trước** khi sửa một dòng code nào.

### 2.1 Ai mất quyền nếu siết? — **KHÔNG AI**

| Role | `view:user` | `read:team` | user active |
| --- | --- | --- | --- |
| `SA` (custom) | Company | Company | **6** |
| `company-admin` (system) | Company | Company | **1** |
| `hr` (system) | Company | — không có | 0 |
| `hr-manager` (system) | **— không có** | Company | 0 |

Cả ba role giữ `read:team` đều ở `data_scope = Company` ⇒ siết theo scope **không đổi gì** với mọi
người đang dùng hệ thống hôm nay.

### 2.2 Phơi nhiễm HÔM NAY = 0, nhưng cấu hình sai đã có trong SEED

`teams` = **0** · `team_members` = **0** ⇒ route hiện trả rỗng, **chưa có dữ liệu để rò**. Nói thẳng
điều này thay vì mô tả như một vụ rò đang diễn ra.

Nhưng lỗ **là thật trong cấu hình, không phải giả thuyết**: `hr-manager` giữ `read:team@Company` mà
**không có `view:user` nào**. Một user mang role đó bị **403 ở `/org/employees`** lại **đọc được
`userEmail` của toàn bộ thành viên mọi team** qua cửa bên cạnh. Role này do **seed** sinh ra, không
phải do ai đúc sai qua role-admin. Nó thành phơi nhiễm sống ngay khi (a) có team đầu tiên, hoặc
(b) ai đó gán `hr-manager` cho một người.

⇒ Mức `S2` là đúng: **cấu hình sai + đường dẫn không gate**, chặn bởi *thiếu dữ liệu*, không phải bởi
một lớp kiểm soát nào.

### 2.3 Lớp lỗ rộng đến đâu (census)

Census cấp module (`@RequirePermission` có, `data_scope` trong service) **không dùng được để kết
luận**: module `org` hiện ra "CÓ" chỉ vì N-1 thêm cho `employees`, trong khi `teams/members` vẫn
trống. Ghi lại để phiên sau không tin con số đó.

Census đúng lớp lỗ = **nơi nào chiếu `users.email` / `users.fullName` của NGƯỜI KHÁC**: 40+ điểm trải
`attendance` · `leave` · `dashboard` · `employees` · `permission/role-admin` · `auth` · `org`. Phần
lớn gate bằng resource của chính module mình **và** có ép scope (ATT/LEAVE/HR). Chỗ đáng soi tiếp,
KHÔNG thuộc WO này: `permission/role-admin.repository.ts:158-159` (chiếu email theo role) và
`org.repository.ts:332-333`.

## 3. Quyết định thiết kế

### 3.1 `Own` / `Team` / `Department` nghĩa là gì trên `teams`?

`done_when` yêu cầu trả lời **tường minh, không mượn ngữ nghĩa của `users`**. Câu trả lời là: với
route NÀY, **câu hỏi đó sai trọng tâm** — và đó chính là gốc của lỗ.

Route trả **hai lớp dữ liệu** trong một payload:

| Lớp | Cột | Câu hỏi phân quyền đúng |
| --- | --- | --- |
| Quan hệ thành viên | `id` · `teamId` · `userId` · `roleName` · `joinedAt` | "tôi được xem team này không?" → **`read:team`** |
| **Danh tính người** | **`userFullName` · `userEmail`** | "tôi được xem danh bạ tới đâu?" → **`view:user`** |

Vì vậy **không phát minh ngữ nghĩa scope mới cho `teams`**. `read:team` giữ đúng việc nó đang làm —
quyết định truy cập *tài nguyên team*. Hai cột danh tính người phải bị buộc bởi **scope của cặp danh
bạ `view:user`**, đúng cặp mà `/org/employees` và `/auth/users` đã dùng sau N-1 + N-2.

Đây là áp dụng trực tiếp bài học đã ghi: **cặp quyền gate phải khớp cặp của đường tải dữ liệu**
(memory `read-path-gate-pair-must-match-download-pair`). Định nghĩa `Own`/`Team`/`Department` cho
`teams` sẽ là phát minh một ngữ nghĩa thứ hai cho cùng lớp dữ liệu — tức đẻ ra hành vi thứ hai,
đúng điều N-1 đã cố tránh.

### 3.2 Hệ quả hành vi — chỗ CẦN CHỦ DỰ ÁN CHỐT

Với thiết kế trên, role giữ `read:team` mà `view:user` hẹp/không có sẽ **vẫn xem được danh sách
thành viên** nhưng **không nhận hai cột danh tính**. Hai đường xử lý:

| | Cách | Hệ quả |
| --- | --- | --- |
| **(A) — đề xuất** | Trả hàng, **bỏ** `userEmail`/`userFullName` khi ngoài scope | Giữ được tính năng "ai thuộc team nào"; masking do SERVER, đúng CLAUDE.md §5. `hr-manager` xem được cơ cấu team, không lấy được danh bạ |
| (B) | **403** cả route khi thiếu `view:user` | Đơn giản hơn, nhưng cắt cả phần dữ liệu KHÔNG nhạy cảm mà `read:team` vốn cho phép ⇒ siết quá tay, và `hr-manager` mất luôn màn team |

Đề xuất **(A)**. Nó đổi **hình dạng response** theo quyền — nên cần chốt trước khi code, vì FE đọc hai
cột đó.

### 3.3 Vá lẻ hay sửa gốc?

`done_when` hỏi: có nên để `PermissionGuard` tự resolve + phơi `data_scope` cho handler.

**Trả lời: không phải ở WO này, và một mình nó không đóng được lớp lỗ.** Guard phơi `data_scope` ra
`request` vẫn để handler **tự chọn có dùng hay không** — N-1c chính là ca "guard đã gate đúng, handler
không bound hàng". Thêm một thứ tuỳ chọn nữa không biến bug im lặng thành bug ồn ào.

Hướng gốc **đúng** cho lớp lỗ này (đề xuất mở WO riêng, KHÔNG làm ở đây): buộc **tầng chiếu** —
mọi truy vấn chiếu `users.email`/`users.fullName` phải nhận một vị từ scope, thiếu thì **vỡ
typecheck**, không phải trả 0 hàng im lặng. Đó là cùng tinh thần `Pick<ScopeContext,…>` mà FULL gate
vòng 1 của N-1 đã chọn (F5): *loud beats silent*. Ghi thành đề xuất `S6-SEC-IDENTITY-PROJ-1`.

Lý do KHÔNG làm ngay: nó chạm 40+ điểm chiếu ở 7 module, mức `S3`, **không chặn RC** — trong khi
KI-049 là `S2` và đường tới RC đang mở. Trộn hai việc là cách chắc chắn nhất để không xong việc nào.

## 4. Cách vá (theo đúng khuôn N-1, không sáng tạo thêm)

1. `org.permissions.ts`: thêm hằng số cặp danh bạ dùng chung — **một** literal cho cả
   `@RequirePermission` lẫn `resolveAndAssert`, để không thể gate một cặp mà bound hàng theo cặp khác.
2. `OrgService.listTeamMembers`: resolve scope của `view:user` (`resolveAndAssert`), rồi
   `buildUserScopeCondition` cho hai cột danh tính. `Company`/`System` → nguyên vẹn ·
   `Own` → chỉ chính mình có danh tính · `Team`/`Department`/không-grant → fail-closed **kèm
   `logger.warn`** (đúng F1 của gate N-1: nhánh fail-closed im lặng tuyệt đối là không chẩn được).
3. Bound theo **tập user đã lọc**, không chỉ lọc cột — lọc cột mà quên vế quan hệ vẫn rò "ai thuộc
   nhóm nào" (bài học F2/N-1).

## 5. Đích hội tụ

- [ ] RED TRƯỚC: role `view:user@Own` + `read:team@Company` → chứng minh bằng log rằng route hiện trả
      email người ngoài scope, trong khi `/org/employees` đã chặn.
- [ ] Ca đối chứng: `Company` **vẫn** thấy đủ email (chống siết quá tay) — không có ca này thì
      "0 email" không phân biệt được với "route hỏng".
- [ ] Ca `hr-manager`: có `read:team`, không có `view:user` → xem được thành viên, **không** có email.
- [ ] `permission-matrix-spec.md`: khối CHỐT `/org` đang đọc như "/org đã chốt" — sửa cho khớp, vì
      vế `teams` hôm nay CHƯA có scope.
- [ ] FULL gate `security-reviewer` + `rls-tenant-isolation-tester` PASS.
- [ ] `RELEASE-02`: đóng `KI-049` kèm số đo (§2 đã có vế "trước").
- [ ] Mở đề xuất `S6-SEC-IDENTITY-PROJ-1` vào `harness/backlog.mjs` (hướng gốc §3.3) — để nó không
      biến thành ghi chú văn xuôi rồi mất số hiệu, đúng lỗi đã mắc với chính N-1c.
