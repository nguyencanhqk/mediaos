# S6-SEC-IDENTITYBOUND-1 — N-1d/N-1e: hai đường chiếu danh tính còn KHÔNG bound `data_scope`

> Zone: **red / crown-jewel** · Gate: **FULL** · Mở 2026-07-30 từ pha ĐO của `S6-SEC-IDENTITY-PROJ-1`
> Cấp số hiệu **KI-051** (`/recycle-bin/employees`) + **KI-052** (`/org/teams` `leaderUserName`).
> Nợ ghi kèm số hiệu, KHÔNG vá đợt này: **KI-053** (role-admin) · **KI-054** (auth-logs-viewer).

## 1. Vì sao WO này tồn tại (và vì sao nó KHÔNG phải `S6-SEC-IDENTITY-PROJ-1`)

`S6-SEC-IDENTITY-PROJ-1` là WO **cơ chế**: buộc tầng chiếu `users.email`/`users.fullName` phải nhận vị
từ scope, thiếu thì vỡ typecheck. Nó `S3`, chạm 52 điểm chiếu ở 12 module, và `done_when` của chính nó
ghi *"nếu đang trong cửa sổ RC thì hoãn, đừng trộn vào đường tới RC"*.

Pha **ĐO** của WO đó (bắt buộc theo `done_when`: *"ĐO PROD trước khi siết từng module"*) đã chạy ngày
2026-07-30 và **tìm ra một lỗ SỐNG** — không phải giả thuyết, không phải nợ kiến trúc. Lỗ sống thì
không đi theo lịch của WO cơ chế. Owner chốt 2026-07-30: **tách** — vá lỗ ngay, hoãn cơ chế.

Đây đúng bài học `§1.1` của `S6-SEC-ORGTEAMSCOPE-1`: một phát hiện chỉ nằm dưới dạng văn xuôi trong
plan của WO khác thì **mất số hiệu** và không bao giờ bị `RELEASE-05 §5.3` scrub. Cấp số ngay.

## 2. ĐO TRƯỚC KHI SIẾT — PROD `mediaos`, tenant `funtime`, 2026-07-30

Đo **từ HOST** qua `DATABASE_DIRECT_URL` (memory `db-password-verify-must-be-from-host`: `docker exec
psql` rơi vào `pg_hba` trust nên mọi mật khẩu đều qua ⇒ số đo vô nghĩa).

### 2.1 Ai đang sống

| Role | user sống | `view:user` (cặp danh bạ) |
| --- | --- | --- |
| `employee` | **45** | **— KHÔNG CÓ** |
| `SA` (custom) | 6 | Company |
| `company-admin` (system) | 1 | Company |
| mọi role khác (`hr`·`hr-manager`·`manager`·`project-manager`·…) | **0** | — |

46 user sống. **45/46 mang role `employee`, và role đó không giữ một grant danh bạ nào.**

### 2.2 KI-051 — `GET /recycle-bin/employees` (S2, lỗ SỐNG)

| | |
| --- | --- |
| Gate | `@RequirePermission('read','employee')` — `is_sensitive = false` |
| Ai giữ cặp | `employee` **@Own — 45 user sống** · `SA` @Company (6) · `company-admin` @Company (1) |
| Service resolve scope | **KHÔNG — một dòng nào cũng không** (`recycle-bin.service.ts:17-21`) |
| Chiếu | `userFullName` + `userEmail` của **MỌI** hồ sơ đã xoá mềm trong tenant |
| Phơi nhiễm hôm nay | **0 hàng** — `employee_profiles where deleted_at is not null` = **0** |

`data_scope` của 45 người này là `Own`. Route **bỏ qua scope hoàn toàn**. Guard trả lời "có cặp
không", KHÔNG trả lời "cặp đó tới đâu" — đúng luận điểm của `S6-SEC-IDENTITY-PROJ-1`, lần này đo được
chứ không suy luận.

⇒ Một nhân viên bất kỳ đọc được **họ tên + email của toàn bộ nhân sự đã nghỉ việc**. Chặn duy nhất
hôm nay là *chưa ai bị xoá mềm*. Off-boarding là thao tác HR thường ngày trên hệ thống sắp go-live với
45 nhân viên ⇒ lỗ thành sống ở lần nghỉ việc đầu tiên, không phải "nếu".

**Cùng lớp lỗi với KI-049, nhưng KI-049 có 0 người giữ cặp còn cái này có 45.** Vì vậy `S2`, cùng mức
KI-049 — nhất quán thang, không phát minh mức mới.

### 2.3 KI-052 — `GET /org/teams` chiếu `leaderUserName` (S3)

`org.repository.ts:170` chiếu `leaderUserName: users.fullName` qua `leftJoin(users)`, gate
`read:team`, **không resolve cặp danh bạ**. Đúng hình dạng N-1c — **trong chính file vừa vá**, ở
phương thức bên cạnh. `S6-SEC-ORGTEAMSCOPE-1` chỉ vá `listTeamMembers`.

`S3` chứ không `S2`: chiếu **một cái tên mỗi team** (không email · không trạng thái), `teams` = **0**,
và role duy nhất giữ `read:team` mà thiếu `view:user` là `hr-manager` — **0 user sống**.

### 2.4 Đã kiểm chứng là KÍN — ghi lại để phiên sau khỏi đo lại

`done_when` của WO cơ chế yêu cầu *"ghi rõ module đó đã kín kèm bằng chứng"*. Số đo §2.1 làm dấy lên
nghi ngờ với ATT/LEAVE (45 user giữ `read:attendance@Company` + `read:leave@Company` mà không có
`view:user`). **Đọc code thì cả hai KÍN** — bằng chứng:

| Route | Vì sao kín |
| --- | --- |
| `GET /attendance` | `attendance.service.ts:463` — `userId: query.userId ?? actor.id`; hỏi người khác thì `assertCanManage` (`:457-459`) |
| `GET /leave/balances` | `leave.service.ts:122-128` — `scope=all` đòi `manage:leave`; `scope=me` bound `actor.id` |
| `GET /auth/users` | `auth-users.repository.ts:111` — nhận sẵn vị từ `scope` |
| `GET /org/units`, `/units/tree` | Phơi `headUserName` **CÓ CHỦ ĐÍCH**, có chữ ký ở `test/foundation/route-verdicts.ts` — miễn trừ đã ký, không phải bỏ quên |

⚠️ Cả hai module kín bằng **assert thứ hai trong service** (`assertCanManage`/`assertCan`), KHÔNG
bằng vị từ scope. Đó là dữ kiện thiết kế cho WO cơ chế: một cơ chế "mọi điểm chiếu phải nhận vị từ
scope" sẽ **bắt sai** các call-site vốn đã an toàn nhờ tự-bound theo `actor.id`. Cơ chế phải nhận
được **nhiều dạng căn cứ**, không chỉ một.

### 2.5 Ai mất quyền xem sau khi siết? — **KHÔNG AI**

Người duy nhất đang đọc được hai route này ở diện rộng là `SA`(6) + `company-admin`(1), cả hai giữ
`view:user@Company` ⇒ vị từ danh bạ trả `tenant` ⇒ **thấy y như hôm nay**. 45 `employee` mất một thứ
họ **chưa từng được phép có**. Không có backfill grant nào trong WO này — **0 migration**.

## 3. Quyết định thiết kế — KHÔNG sáng tạo, dùng lại đúng khuôn N-1c

Cặp gate giữ nguyên việc nó đang làm (`read:employee` quyết định truy cập thùng rác; `read:team`
quyết định truy cập tài nguyên team). Hai/một cột **danh tính người** bị buộc bởi scope của cặp danh
bạ `view:user` — đúng cặp mà `/org/employees`, `/auth/users`, `/org/teams/:id/members` đã dùng.

**Đường (A) — bỏ cột, không 403 cả route** (owner đã chốt cho N-1c 2026-07-29; giữ nhất quán):
`read:employee` vốn cho phép biết *có bao nhiêu hồ sơ trong thùng rác* và phục hồi chúng; cắt cả route
là siết quá tay. Ngoài scope ⇒ **BỎ HẲN KHOÁ**, không trả `null`.

Khử ở **tầng SQL** (`case when`) rồi mới xoá khoá ở service — nếu phiên sau ai đó quên bước xoá khoá
thì hàng ngoài scope ra `null` và contract vỡ Zod **ồn ào** ở FE, thay vì rò email im lặng.

## 4. Cách vá

1. `recycle-bin.service.ts`: `resolveOrNull(view:user)` → `buildUserScopeCondition` → truyền
   `identityCond` xuống repo; `null` ⇒ `logger.warn` (nhánh fail-closed phải để lại dấu vết — F1 của
   gate N-1) + không hàng nào có danh tính.
2. `recycle-bin.repository.ts`: `identityInScope` + `case when` cho `userFullName`/`userEmail`.
3. `org.repository.ts` `listTeams` + `org.service.ts`: cùng khuôn cho `leaderUserName`.
4. Contract: kiểm `userEmail`/`userFullName`/`leaderUserName` phải `.optional()` (KHÔNG `.nullable()`).

**KHÔNG migration. KHÔNG đổi seed. KHÔNG grant mới.**

## 5. Đích hội tụ

- [ ] RED TRƯỚC: actor hình dạng `employee` (`read:employee@Own`, không `view:user`) chứng minh hôm
      nay đọc được danh tính hồ sơ đã xoá của người khác.
- [ ] Ca đối chứng `Company` **vẫn** thấy đủ danh tính — thiếu ca này thì "0 danh tính" không phân
      biệt được với "route hỏng".
- [ ] Ca `read:employee` mà không `view:user` → thấy hàng, **0 danh tính**.
- [ ] Ca 403 giữ nguyên: không có `read:employee` ⇒ route vẫn đóng (vá không được nới route).
- [ ] Cùng bộ 4 ca cho `/org/teams` `leaderUserName`.
- [ ] FULL gate `security-reviewer` PASS.
- [ ] `RELEASE-02`: mở **và đóng** KI-051 · KI-052 kèm số đo; mở KI-053 · KI-054 làm nợ có số hiệu.
- [ ] `S6-SEC-IDENTITY-PROJ-1` cập nhật bằng census + số đo THẬT (79 điểm/31 file/12 module, không
      phải "40+/7 module"), kèm dữ kiện §2.4 về hai dạng căn cứ.

## 6. Kết quả (2026-07-30)

### RED → GREEN, có ca đối chứng cả hai phía

Lane `mediaos_identitybound`. `test/integration/identity-bound-scope.int-spec.ts` — **8 ca**.
Vòng RED chạy TRƯỚC khi sửa một dòng code nào: **4 đỏ / 4 xanh**.

| Ca | Kỳ vọng | Trước vá | Sau vá |
| --- | --- | --- | --- |
| **KI-051** `Company` — *đối chứng* | 2 hàng, 2 danh tính | ✅ | ✅ |
| **KI-051** `view:user@Own` | 2 hàng, **1** danh tính | ❌ **2** | ✅ 1 |
| **KI-051** `read:employee@Own`, KHÔNG `view:user` (**hình dạng 45 user sống**) | 2 hàng, **0** danh tính | ❌ **2** | ✅ 0 |
| **KI-051** không có `read:employee` — *đối chứng* | **403** | ✅ | ✅ |
| **KI-052** `Company` — *đối chứng* | 2 team, 2 tên | ✅ | ✅ |
| **KI-052** `view:user@Own` | 2 team, **1** tên | ❌ **2** | ✅ 1 |
| **KI-052** `read:team@Company`, KHÔNG `view:user` | 2 team, **0** tên | ❌ **2** | ✅ 0 |
| **KI-052** không có `read:team` — *đối chứng* | **403** | ✅ | ✅ |

Hai ca đối chứng mỗi vế là phần không được bỏ: thiếu ca `Company` thì "0 danh tính" không phân biệt
được với "route hỏng"; thiếu ca 403 thì bản vá có thể đã âm thầm nới route mà không ai thấy. Cả bốn
ca đối chứng **xanh ở CẢ HAI phía** ⇒ đỏ ở giữa là lỗ thật, không phải test sai.

Hồi quy: `org` + `recycle-bin` + `permission` + 3 int-spec danh bạ = **468 ca** · `test/foundation`
(gồm cổng census route) = **162 ca** · console `recycle-bin` = **10 ca**. `typecheck` xanh.

### Bốn chi tiết của bản vá, kèm lý do

1. **Typecheck vỡ ở call-site là TÍNH NĂNG, không phải phiền toái.** Đổi chữ ký repo/service làm
   `org.service.spec.ts` + `recycle-bin.service.spec.ts` đỏ ngay — đúng tinh thần `Pick<ScopeContext,…>`
   của N-1 F5 mà WO cơ chế sẽ tổng quát hoá: *loud beats silent*.
2. **Khử ở tầng SQL (`case when`) rồi mới bỏ khoá ở service** — quên bước bỏ khoá thì ra `null`, không
   phải rò email.
3. **`logger.warn` cho nhánh "không grant nào".** `buildUserScopeCondition` tự log cho
   `Team`/`Department`, ca `null` không đi qua đó. Không log thì admin thấy cột trống mà không có
   đường chẩn (F1 của gate N-1).
4. **`ORG_EMPLOYEE_DIRECTORY` dùng CHUNG, không viết literal thứ tư.** Chỉ import hằng số, không phụ
   thuộc DI vào `OrgModule` ⇒ không vòng import. Pin trong int-spec vẫn CỐ Ý là literal độc lập.

### Bẫy quan trọng nhất gặp phải — FE vỡ trắng vì chính bản vá

`apps/console/src/lib/recycle-bin-api.ts` khai `userFullName`/`userEmail` **BẮT BUỘC**. Server bỏ khoá
⇒ `apiFetch` ném `ZodError` **dù HTTP 200** ⇒ **vỡ trắng cả trang thùng rác** — cho đúng những role mà
bản vá bảo vệ. Ở N-1c "hỏng ồn ào" là tính năng (contract chưa `.nullable()`, và ở đó server GIỮ khoá
cho hàng trong scope); ở đây nó sẽ là **hồi quy thật**.

Đã đổi sang `.optional()` + thêm ca console khoá lại, và **đã chứng minh ca đó ĐỎ** khi gỡ
`.optional()` (chỉ 1/10 ca đỏ, đúng ca mới) — không tin suông là pin có tác dụng
(memory `apifetch-drops-pagination-bare-array`, `tests-can-pin-a-hole-open`).

### Nợ đã ghi thành số hiệu, không để thành văn xuôi

`KI-053` (role-admin `listRoleMembersTx`) · `KI-054` (auth-logs-viewer — docstring ghi "Company-scope"
nhưng **không resolve `data_scope`**; 316 `login_logs` + 28 `user_security_events` là dữ liệu THẬT).
Cả hai hôm nay chỉ admin `@Company` chạm tới ⇒ `S3`, giao cho `S6-SEC-IDENTITY-PROJ-1`.

### Dữ kiện chuyển giao cho WO cơ chế

Census THẬT: **79 điểm / 31 file / 12 module** (không phải "40+ / 7 module" — grep thẳng trượt
`alias(users,…)` và `getTableColumns(users)`). Và quan trọng nhất: hai module kín (ATT/LEAVE) kín bằng
**assert thứ hai trong service** hoặc **tự-bound theo `actor.id`**, KHÔNG bằng vị từ scope ⇒ cơ chế
ép-kiểu phải nhận **nhiều dạng căn cứ**, nếu không nó sẽ bắt sai hàng loạt call-site vốn đã an toàn.
