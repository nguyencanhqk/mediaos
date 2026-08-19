# S6-SEC-IDENTITY-PROJ-1 — cơ chế: tầng chiếu `users.email`/`users.fullName` phải mang CĂN CỨ, thiếu thì ĐỎ

> Zone: **red / crown-jewel** · Gate: **FULL** (`security-reviewer` + `silent-failure-hunter`)
> Mở 2026-07-29 · **HOÃN 2026-07-31** (ngoài cửa sổ RC) · **GỠ HOÃN 2026-08-19** (owner chốt lại)
> Đóng nợ có số hiệu: **KI-053** (role-admin) · **KI-054** (auth-logs-viewer) · mở **KI-069** (leave-admin) + **KI-070** (nợ bound-HÀNG)
> Tiền lệ: `S6-SEC-ORGSCOPE-1` (N-1) · `S6-SEC-ORGTEAMSCOPE-1` (N-1c) · `S6-SEC-IDENTITYBOUND-1` (N-1d/e) · `S6-SEC-XTENANTFK-1` (khuôn sổ phán quyết)
>
> **Vòng plan-review:** vòng 1 = **BLOCK**, 10 lỗ chặn (B1…B10) + 8 cảnh báo. Bản này vá cả 18.
> **KHÔNG mở vòng review thứ hai** — memory `plan-review-rounds-inject-new-holes`; các lỗ còn lại
> (nếu có) đo bằng RED test ở P1/P3a, rẻ hơn và có bằng chứng hơn một vòng đọc nữa.

---

## 0. Căn cứ gỡ hoãn (2026-08-19)

`RELEASE-02` ghi điều kiện: *"đã cắt tag `v1.0.0-rc.1` và qua `S6-GOLIVE-1`, **hoặc owner chốt lại**"*.

| Điều kiện | Đo 2026-08-19 |
| --- | --- |
| Tag RC | ✅ `v1.0.0-rc.1` · `rc.2` · `rc.3` đã cắt |
| `S6-GOLIVE-1` | G1 ✅ (2/2 `SA` có TOTP) · G7 ✅ (2/2 scheduled task chạy thật 04/08) · G8/G10 = chữ ký owner, **không đo được từ máy** |
| Owner chốt lại | ✅ phiên 2026-08-19 |

Bằng chứng đóng dấu: `harness/activity.jsonl` sự kiện `unblocked` (by `owner`, ts `2026-08-19T09:59:59Z`)
— đây là thứ §7 #6 trỏ tới, thay cho một nghiệm thu bằng lập luận.

Cửa sổ RC đã đóng trên thực tế: từ 03/08 tới nay đã land `S7-CHAT` · `S7-CALL` · `S8-CHAT-UX` ·
`S9-SOCIAL` · `S10-*`.

---

## 1. ĐO LẠI TRƯỚC KHI THIẾT KẾ (`done_when` #4: *"đừng tin lại số cũ"*)

### 1.1 Census điểm chiếu — script AST, không grep

| | 2026-07-30 (số `src[]`) | **2026-08-19** | Δ |
| --- | --- | --- | --- |
| Tổng | 79 | **92** | +13 |
| File / module | 31 / 12 | **37 / 13** | +6 / +1 (`chat`) |
| **PROJECTION** | 52 | **71** (34 file / 12 module) | **+19** |
| PREDICATE (lớp *oracle* RIÊNG) | 11 | 13 | +2 |
| ORDER BY / GROUP BY | 6 / — | 6 / 2 | |
| "hỗn hợp" | 8 | 0 | phân loại lại hết |

Chênh có HAI nguồn, không gộp: (1) **tăng thật** — `chat` (10 điểm/5 file) land sau census cũ;
(2) **phân loại lại** — bucket "hỗn hợp" là bản đồ cột hằng (`const LIST_COLUMNS = {…}` rồi
`.select(LIST_COLUMNS)`) = PROJECTION, không phải loại thứ ba.

PROJECTION theo module: `employees` 13 · `auth` 10 · `chat` 10 · `attendance` 8 · `org` 7 · `leave` 6 ·
`tasks` 5 · `integrations/lms` 4 · `me` 3 · `permission` 2 · `recycle-bin` 2 · `users` 1.

**Chiều sai số — ĐO, không phải phát biểu suông** (vá W4). Scanner bắt theo *identifier đã bind tới
`users`*; ba đường nó KHÔNG thấy được PIN thành số trong sổ verdicts, khuôn
`PARTIAL_ENFORCEMENT_PAIRS` của `fk-tenant-verdicts.ts`:

| Bộ đếm mù | Ý nghĩa | Ratchet |
| --- | --- | --- |
| `BLIND_BARE_SELECT` | số `.select()` KHÔNG tham số trong `apps/api/src` (chiếu TOÀN BỘ cột) | pin số; tăng ⇒ ĐỎ |
| `BLIND_RAW_SQL_IDENTITY` | số template `` sql`…` `` chứa `email`/`full_name` dạng chuỗi thô | pin số; tăng ⇒ ĐỎ |
| `BLIND_OUT_OF_TREE` | census chỉ quét `apps/api/src` — `packages/**` + FE ngoài tầm | ghi, không pin |

Sai số dồn về phía "đã phủ" ⇒ **GIẤU khoảng trống** (bài học `S10-QA-ROUTEHTTP-1`). 71 là **cận dưới**.

### 1.2 ĐO PROD — `mediaos` / tenant `funtime`, **từ HOST** qua `DATABASE_DIRECT_URL`

(`docker exec psql` rơi vào `pg_hba` trust ⇒ số đo vô nghĩa — memory `db-password-verify-must-be-from-host`)

**Dân số:** 35 user sống / 48 hàng `users`. *(30/07 ghi 46 sống.)*

| Role | user sống | `read/view:user` | `read/view:role` | `view:audit-log` | `view:leave-balance` |
| --- | --- | --- | --- | --- | --- |
| **`employee`** | **34** | **—** | **—** | **—** | **—** *(chỉ `view-own:leave-balance@Own`)* |
| `QUẢN LÝ CẤP CAO` | 3 | Company | Company | Company | Company |
| `SEO` | 3 | — | — | — | — |
| `SA` | 2 | Company | Company | Company | Company |
| `company-admin` | 2 | Company | Company | Company | Company |
| 15 role khác | 0 | | | | |

`employee` giữ `@Company`: `read:attendance` · `read:leave` · `view:chat-room` · `manage:chat-member` ·
`adjust:attendance` · `send/pin/recall:chat*`. **Không** giữ cặp danh bạ nào.

**Dữ liệu sau đường chiếu của hai KI:** `login_logs` **364** (316 → 325 → 364) ·
`user_security_events` **65** (28 → 42 → 65) · hồ sơ nhân sự xoá mềm **0**.

### 1.3 ⚠️ PHÁT HIỆN: ràng buộc của quyết định hoãn đã bị phá

`RELEASE-02` (dòng ~107-108) viết ràng buộc thời-gian-hoãn: *"không cấp `read:role` / `view:audit-log`
cho bất kỳ role nào ngoài admin. Cấp là lỗ thành sống."*

Đo 2026-08-19: role **`QUẢN LÝ CẤP CAO`** (3 user sống) giữ **cả hai**. Role này ra đời 04/08 khi owner
gỡ vai `SA` khỏi 4 tài khoản để đóng cổng G1 (`RELEASE-10` §6b).

Mức thật: **KHÔNG thành lỗ sống** — cả ba role đều `@Company`, mà KI-053/054 là lớp "chiếu vượt scope";
ở Company không có gì để vượt. Nhưng:

> **Workaround dạng "đừng cấp quyền X" không phải lớp kiểm soát — nó là một lời hứa.** Không có gì
> trong hệ thống ép nó. Nó bị phá bởi một thao tác hoàn toàn hợp lệ ở nơi khác, im lặng, và chỉ lộ
> ra khi có người đo lại 19 ngày sau. Đây là lý do WO này phải kết thúc bằng **cơ chế**.

⇒ P7 phải **gỡ hẳn** ràng buộc đó khỏi `RELEASE-02` sau khi đóng KI (vá W8): để nguyên = tài liệu tiếp
tục hứa một lớp kiểm soát không còn cần và chưa bao giờ được ép.

---

## 2. Trả lời câu hỏi thiết kế

### 2.1 Đã LOẠI, không mở lại

**Guard tự phơi `data_scope` ra request** — loại ở `S6-SEC-ORGTEAMSCOPE-1` §3.3: guard phơi ra thì
handler VẪN tự chọn dùng hay không. N-1c chính là ca guard gate đúng / handler không bound.

### 2.2 Vì sao KHÔNG áp nguyên văn `done_when` #1

`done_when` #1: *"hàm chiếu danh tính nhận tham số vị từ BẮT BUỘC ⇒ call-site thiếu scope vỡ typecheck"*.
Áp nguyên văn lên 71 điểm là SAI — chính `src[]` cảnh báo: *"hai module kín ở trên kín bằng assert thứ
hai trong service hoặc bằng tự-bound theo actor.id, KHÔNG bằng vị từ scope"*. Đo 2026-08-19 xác nhận và
còn rộng hơn: **8 dạng căn cứ**.

| Căn cứ | Nghĩa | Ví dụ đã verify (file:dòng) |
| --- | --- | --- |
| `scoped-predicate` | Vị từ `data_scope` chặn TẬP HÀNG | `employees.service.ts:95-108` · `hr-read.service.ts:93-104` · `attendance-report.service.ts:40-62` |
| `identity-gated` | Riêng CỘT danh tính bound bởi cặp danh bạ | `org.repository.ts:183,285` · `recycle-bin.repository.ts:22` |
| `self-bound-row` | TẬP HÀNG ghim vào `actor.id` bằng vị từ | `attendance.service.ts:457-463` · `chat-messages.repository.ts#findSenderDisplayName` |
| `self-bound-route` | Route theo định nghĩa chỉ phục vụ chính chủ (`/me/*`, `/auth/me`) | `me.repository.ts:51,78` · `auth.service.ts:503,1104` · `two-factor.service.ts:166` |
| `second-assert` | Nới rộng đòi assert quyền THỨ HAI trong service | `leave.service.ts:122-128` (`manage:leave`) · `leave.service.ts:163-182` (`approve:leave`) |
| `membership` | TẬP HÀNG bound bởi tư cách thành viên tài nguyên | `chat-access.service.ts:122 assertMember` · `projects.service.ts:127,148 scopeExists` |
| `no-actor` | Job máy / producer outbox, không có actor HTTP | `attendance-alert-noti.repository.ts` ×3 · `integrations/lms/*` ×4 |
| `waiver` | Phơi có chủ đích, ĐÃ KÝ | `org` units `headUserName` (chữ ký ở `test/foundation/route-verdicts.ts`) · `chat-oversight` (`view:chat-oversight` `isSensitive`, chỉ `SA`) |

> `self-bound` **tách đôi** (vá câu hỏi mở của review): `self-bound-row` là vị từ SQL đo được;
> `self-bound-route` là tính chất của ĐỊNH NGHĨA route, không đo được bằng SQL — hai thứ khác nhau về
> chất, gộp là giấu mất chỗ yếu hơn.

### 2.3 Và vì sao chỉ có type là KHÔNG ĐỦ — nói thẳng ranh giới

Kiểu có brand chỉ cắn ở nơi người ta *gọi hàm chiếu chung*. Một repository mới hoàn toàn có thể viết
`.select({ email: users.email })` thẳng — đúng lớp lỗ N-1c. Thêm nữa, brand `unique symbol`
**KHÔNG chặn `as`**: `{ cond, why } as IdentityGrant` là hợp lệ với TypeScript, và
`.claude/hooks/anti-bandaid-guard.mjs` chỉ chặn `@ts-ignore`/`@ts-nocheck`/`eslint-disable`,
không đụng `as` (vá B4). Cho nên:

**Cơ chế = HAI lớp; thiếu một lớp là quay lại quy ước.**

- **L1 · type** — đường *vá* không thể viết sai: đã đi qua hàm chiếu thì bắt buộc có căn cứ.
- **L2 · ratchet** — đường *né* không thể im lặng: mọi điểm chiếu phải khớp một dòng phán quyết;
  điểm MỚI ⇒ **ĐỎ**. Ratchet cũng đếm `as IdentityGrant` = 0 để bịt đường ép kiểu.

**Ranh giới độ tin cậy — phát biểu đúng (vá B7).** Đây **KHÔNG** phải "khuôn đã chứng minh" của
`S6-SEC-XTENANTFK-1` / `S10-QA-ROUTEHTTP-*`. Bất biến của hai khuôn đó là **"0 regex trên mã nguồn"**
(`fk-tenant-census.ts:14-17`, `route-census.ts:14-19` — file đó liệt kê 4 lần con số sai 49→38→114→40
*chính vì* parse tĩnh). L2 ở đây là **parse tĩnh trên mã nguồn = lớp bằng chứng YẾU HƠN cả hai**.
Tái dùng của WO này là **sổ phán quyết + ratchet**, không phải nguồn census.

Bù bằng một chiều **runtime**: ca ALLOW của mỗi module PIN **số cột danh tính thật sự có mặt trong
response** (đếm khoá, không đọc giá trị). Census tĩnh nói "có điểm chiếu"; ca runtime nói "cột thật ra
tới FE". Hai nguồn lệch nhau ⇒ census sai ⇒ ĐỎ.

---

## 3. Thiết kế

### 3.1 L1 — `apps/api/src/permission/identity-projection.ts` (MỚI)

```ts
declare const IDENTITY_BASIS: unique symbol;

export type IdentityBasis =
  | "scoped-predicate" | "identity-gated" | "self-bound-row" | "self-bound-route"
  | "second-assert"    | "membership"     | "no-actor"       | "waiver";

export interface IdentityGrant {
  readonly [IDENTITY_BASIS]: IdentityBasis;
  readonly cond: SQL;   // vị từ quyết định CỘT danh tính có hiện không
  readonly why: string; // câu cho người đọc; đi vào log ở nhánh fail-closed
}
```

**Constructor — 4, không phải 7** (vá câu hỏi mở "trùng nghĩa" + vá B3):

| Hàm | `cond` | Dùng cho basis |
| --- | --- | --- |
| `fromScope(cond: SQL \| null, basis, why)` | `cond ?? sql\`false\`` — **`null` ⇒ `false`, KHÔNG `true`** | `scoped-predicate` · `identity-gated` |
| `selfBound(actorUserId, idCol, why)` | `eq(idCol, actorUserId)` | `self-bound-row` |
| `byMembership(cond: SQL, why)` | `cond` | `membership` |
| `unconditional(basis, key, why)` | `sql\`true\`` | `no-actor` · `waiver` · `self-bound-route` |

`fromScope` và `identityGated` là **cùng một hàm** với `basis` khác nhau — hai đường dựng cùng một thứ
là hai chỗ để sai. `basis` là tham số, không phải tên hàm.

**`afterAssert` BỊ BỎ khỏi L1 (vá B3).** Lý do đo được: không tồn tại `assertCan*` dùng chung —
`role-admin.service.ts:669`, `leave.service.ts:193`, `attendance.service.ts:523` đều là **private helper
riêng từng service** trả `Promise<void>`. Một `AssertToken` sẽ (a) đòi đổi chữ ký ≥3 helper crown-jewel
nằm ngoài `paths`, và (b) **rỗng nghĩa** — token không mang cặp quyền nào, `cond = sql\`true\``, nên nó
chỉ chứng minh "có một assert nào đó", không phải "assert ĐÚNG cặp". Một call-site assert một cặp
ai-cũng-có rồi lấy token là mở toang cột danh tính mà typecheck vẫn xanh.
⇒ `second-assert` **chỉ sống ở sổ verdict L2**, nơi nó là một câu người đọc và ký, không phải một brand
giả vờ đo được.

**Hàm chiếu — nhận CỘT KHOÁ, không giả định `users` (vá B1):**

```ts
export function identityColumns(grant: IdentityGrant, spec: IdentityColumnSpec)
```
trả `{ identityInScope, …các cột đã bọc }` dạng `case when (grant.cond) then … else null end` — y khuôn
đã chạy ở `org.repository.ts` / `recycle-bin.repository.ts`, không phát minh hình dạng mới.
**Mỗi NHÓM danh tính trong một truy vấn cần MỘT `IdentityGrant` riêng** — xem §3.3 KI-054.

Kèm `DataScopeService.buildUserScopeConditionOn(scope, ctx, { idCol, companyIdCol })` (MỚI, additive):
`buildUserScopeCondition` hiện tại hard-code `eq(users.companyId, …)` / `eq(users.id, ctx.userId)`
(`data-scope.service.ts:211-241`) nên vị từ nó sinh ra **chỉ nói về subject**. Bản mới nhận cột đích;
bản cũ **giữ nguyên chữ ký** và gọi bản mới với `users` (expand, không sửa call-site đang chạy).

**Ba điều bắt buộc ghi vào docblock module này:**
1. Khử ở **SQL** (`case when`), không chỉ xoá khoá ở service — quên bước xoá khoá thì hàng ngoài scope ra
   `null` chứ không rò email im lặng.
2. Service phải **bỏ hẳn khoá** khi contract khai `.optional()`. Giữ `null` CHỈ khi contract khai
   `.nullable()` **và** `null` không lẫn nghĩa với "chưa có" (bẫy KI-052). Object LỒNG (`AuthLogUserRef`)
   không có khoá để bỏ ⇒ phải chốt hình dạng riêng — §3.3.
3. FE phải `.optional()` tương ứng; thiếu ⇒ **ZodError runtime dù HTTP 200** = vỡ TRẮNG trang cho đúng
   role mà bản vá bảo vệ (memory `server-masking-needs-optional-fe-schema`).

> **Ranh giới, ghi trong docblock (vá B4):** brand chặn object literal, **KHÔNG** chặn `as IdentityGrant`.
> Đường đó bị bịt ở L2 (ratchet đếm = 0), không ở L1. Đừng viết "không thể dựng" — sai.

### 3.2 L2 — census + verdicts + ratchet

| File | Vai |
| --- | --- |
| `apps/api/test/foundation/identity-projection-census.ts` | scanner AST (port script §1.1) + 2 bộ đếm mù §1.1 |
| `apps/api/test/foundation/identity-projection-verdicts.ts` | **SỔ PHÁN QUYẾT**: 1 dòng/điểm — `basis` + `reason` + `signedBy` |
| `apps/api/test/foundation/identity-projection-ratchet.unit-spec.ts` | ratchet, KHÔNG cần DB (glob `test/**/*.unit-spec.ts` đã có) |

`signedBy` = **mã Work Order**, khuôn `fk-tenant-verdicts.ts:40` (vá câu hỏi mở). 71 dòng đầu ký
`S6-SEC-IDENTITY-PROJ-1`; dòng nào có WO gốc rõ hơn thì ký WO đó (vd `S6-SEC-IDENTITYBOUND-1`).

**Ratchet assert SÁU chiều:**

1. **Không điểm mồ côi — KHÔNG có ngoại lệ "đã gọi `identityColumns`"** (vá B6a). Nhánh đó bị **BỎ**: nó
   chỉ chứng minh *hàm có gọi*, không chứng minh *cột của ĐIỂM ĐÓ* đi qua nó — một hàm bọc 1 cột và để
   cột bên cạnh trần vẫn qua, tức ratchet **cấp giấy thông hành** cho đúng lớp lỗ KI-052. ⇒ **mọi**
   PROJECTION phải có dòng verdict, kể cả điểm đã vá (basis `identity-gated`).
2. **Không verdict mồ côi** — verdict không khớp điểm nào ⇒ ĐỎ (xoá code quên xoá sổ; memory
   `review-gate-blind-to-deletions`).
3. **Khoá theo ĐỊNH NGHĨA, không theo TÊN** — khoá = `file#fn:expr`, mang cả cách chiếu
   (`users.email` / `alias(x).email` / `getTableColumns`) ⇒ đổi cách chiếu ⇒ khoá đổi ⇒ ĐỎ (memory
   `index-ratchet-must-pin-definition-not-name`).
   **Chính sách rename (vá B6b):** `fn` NẰM TRONG khoá — đổi tên hàm ⇒ verdict của file đó mồ côi ⇒ ĐỎ.
   Đây là **có chủ đích**: rename một hàm chiếu danh tính là thao tác phải cập nhật sổ. Để ĐỎ không thành
   sự cố ở WO sau, thông điệp lỗi in **cặp diff** (`- khoá mất` / `+ khoá mới`) trong cùng file + câu
   "nếu đây là rename thuần, sửa `fn` trong verdict; nếu đổi cách chiếu, phải ký lại".
4. **Trần đếm cho BỐN basis không đo được** (vá B5): `waiver` · `no-actor` · `second-assert` ·
   `self-bound-route`. Trần = số dòng hiện có; tăng ⇒ ĐỎ trừ khi sửa trần **có chủ đích** ⇒ buộc qua FULL
   gate. (`membership` có `cond` thật nên đo được; `scoped-predicate`/`identity-gated`/`self-bound-row`
   cũng vậy ⇒ không trần.)
5. **Basis ⟺ hình dạng `cond`** (vá B5): assert cứng
   `basis ∈ {no-actor, waiver, self-bound-route} ⟺ cond là sql\`true\`` — chặn cả hai chiều dán nhãn sai
   (dán nhãn kỹ thuật lên căn cứ chính trị và ngược lại).
6. **`as IdentityGrant` = 0** trong `apps/api/src/**` (vá B4) + hai bộ đếm mù §1.1 khớp số đã pin.

### 3.3 L3 — bốn bản vá

| # | Điểm | Đo 2026-08-19 | Vá |
| --- | --- | --- | --- |
| **KI-053** | `role-admin.repository.ts:158-159` `listRoleMembersTx` (2 điểm) | ❗CÒN THẬT — `where` (166-174) = `roleId`+`companyId`+`notDeleted`+chưa-hết-hạn, **0 vị từ scope** | 1 `IdentityGrant` (`fromScope`, cặp danh bạ `view:user` qua `resolveOrNull`) |
| **KI-054a** | `login-log.repository.ts:72-73` `findManyTx` (2 điểm) | ❗CÒN THẬT — `buildWhere` (39-46) chỉ nhận query param của caller | 1 `IdentityGrant` trên `users` |
| **KI-054b** | `security-event.repository.ts:84-88` `findManyTx` (4 điểm, 2 NHÓM) | ❗CÒN THẬT + **hai nhóm khác nhau** | **HAI** `IdentityGrant` — §dưới |
| **KI-069** | `leave-admin.repository.ts:219` `listBalancesTx` (1 điểm) | ❗Gate `view:leave-balance` qua `resolveAndAssert` — scope **resolve rồi VỨT**, truy vấn không nhận `scopeCond` | 1 `IdentityGrant` + sửa `ORDER BY` (W1) |

**KI-054b — vì sao HAI grant, không phải một (vá B1).**
`security-event.repository.ts:74` dựng `const actor = alias(users, "sec_event_actor")`; truy vấn
`leftJoin(users, eq(users.id, userSecurityEvents.userId))` **và** `leftJoin(actor, eq(actor.id,
userSecurityEvents.actorUserId))`. `buildUserScopeCondition` hard-code `users` ⇒ vị từ nó sinh ra chỉ nói
về **subject**. Dùng chung MỘT `identityCond` cho cả 4 cột thì:

- hàng có subject = tôi (scope `Own`) ⇒ `identityInScope=true` ⇒ **lộ `actorEmail` của người khác** — leak MỚI;
- hàng có actor = tôi, subject là người khác ⇒ giấu email của chính tôi — **hồi quy allow-path**.

⇒ `identityCondSubject = buildUserScopeConditionOn(scope, ctx, {idCol: users.id, companyIdCol: users.companyId})`
và `identityCondActor = buildUserScopeConditionOn(scope, ctx, {idCol: actor.id, companyIdCol: actor.companyId})`,
hai `IdentityGrant`, hai cụm `case when`. P3a có ca RED riêng cho từng chiều lệch.

**KI-054 — hình dạng DTO sau vá, chốt tường minh (vá B2).**
`auth-logs-viewer.service.ts:86-94` `userRef()` trả `null` khi `!id || !email`. `AuthLogUserRef` là
**object lồng**, không có khoá phẳng để bỏ ⇒ che `email` = sập cả object; mà `null` **hôm nay đã mang
nghĩa** "user xoá mềm / UserNotFound". Sau vá `null` mang hai nghĩa = đúng bẫy KI-052 mà §3.1 điều 2 cấm.

Chốt: `userRef(id, email, fullName, identityInScope)` với **ba nhánh phân biệt được**:

| Điều kiện | Trả | Nghĩa |
| --- | --- | --- |
| `!id` | `null` | log không gắn user (login fail trước khi resolve) — nghĩa CŨ, giữ nguyên |
| `id && !identityInScope` | `{ id, display_name: null }` — **không có khoá `email`** | ngoài scope danh bạ |
| `id && identityInScope && !email` | `null` | join trượt (user đã xoá) — nghĩa CŨ, giữ nguyên |
| còn lại | `{ id, email, display_name }` | đủ quyền |

Contract: `AuthLogUserRef.email` → `.optional()` (`packages/contracts`). P3a có ca ALLOW đối chứng
**phân biệt "user đã xoá" với "ngoài scope"** — thiếu ca đó thì hai nhánh `null` không đo được.

**Ba đường đọc thứ hai đã loại trừ (đo 2026-08-19):** `me-security-activity.repository.ts` docblock ghi
*"KHÔNG SELECT email/normalized_email"* và grep xác nhận 0 điểm chiếu; `permission-admin.repository.ts:45`
chỉ `select({id: users.id})`; `permission.repository.ts` 0 hit `users.`. ⇒ vá 4 điểm trên là **đóng hết**
đường chiếu danh tính của ba bảng đó.

### 3.4 ⚠️ RANH GIỚI CỦA BẢN VÁ — bound CỘT, KHÔNG bound HÀNG (vá B9)

Sau vá, role giữ `view:audit-log@Own` **vẫn đọc toàn bộ** 364 `login_logs` + 65 `user_security_events`
của tenant: `userId`/`actorUserId` (UUID), IP, user-agent, mốc thời gian, `failure_reason` — chỉ mất
email/tên. `LoginLogFilter.userId` vẫn lấy thẳng từ query param của caller
(`auth-logs-viewer.service.ts:50` → `login-log.repository.ts:41`) ⇒ vẫn dò được lịch sử đăng nhập của
một UUID bất kỳ. KI-053 tương tự: vẫn nhận trọn `userId` + `status` + `expiresAt` của mọi thành viên role.

**Quyết định:** chấp nhận trong WO này (phạm vi WO là *tầng chiếu danh tính*), và **mở KI-070** cho vế
bound-HÀNG. Đóng KI mà không ghi ranh giới là lặp đúng lỗi "docstring ghi Company-scope" mà KI-054 tố
cáo. Câu ranh giới này phải được **chép nguyên văn** vào `RELEASE-02` khi đóng KI-053/054, không tóm tắt.

### 3.5 Điểm mới — KI-069, quyết định phạm vi

`leave-admin.service.listBalances` (`:511-527`) cùng lớp lỗ KI-053: gate đúng, scope resolve xong rồi
**không dùng**. Rủi ro sống hôm nay = **0** (`employee` chỉ có `view-own:leave-balance@Own`).
Cấp **KI-069** và vá trong WO này — vá kèm không số hiệu thì vô hình với bug-scrub (đúng lỗi đã mắc với
KI-049); tách WO riêng cho một điểm cùng lớp, cùng cơ chế, đang mở đúng đường vá thì là chia nhỏ vô ích.

**Kèm theo — sửa `ORDER BY` (vá W1).** `leave-admin.repository.ts:235` là
`orderBy(desc(leaveBalances.year), asc(users.fullName))`. Che `userFullName` bằng `case when` mà giữ
`ORDER BY` trên chính cột đó ⇒ **thứ tự hàng tiết lộ thứ tự alphabet của tên bị che** — bản vá thành
oracle. Sửa: `ORDER BY` đi theo cột đã bọc (`case when` cùng vị từ) hoặc đổi sang khoá không danh tính
(`leaveBalances.userId`). ⇒ §6 bỏ câu khẳng định tuyệt đối "ORDER BY không phơi giá trị": **sai** ở đúng
điểm WO này tự vá.

---

## 4. Thứ tự thi công

| Pha | Việc | Ra |
| --- | --- | --- |
| **P0** | ✅ Plan qua `plan-reviewer` vòng 1 → BLOCK 10 lỗ → bản này vá cả 18 (không mở vòng 2) | — |
| **P0b** | **Cập nhật `harness/backlog.mjs` `paths`** — vá B8, TRƯỚC khi code | `paths` phủ đủ 5 nhóm |
| **P1** | Census scanner + 2 bộ đếm mù + verdicts RỖNG + ratchet ⇒ ĐỎ 71 điểm mồ côi | RED có bằng chứng |
| **P2** | ✅ ĐÃ XONG — phân loại 71 điểm (§Phụ lục A) | 62 có căn cứ + **9 UNBOUND** |
| **P2b** | ✅ Cổng dừng KHÔNG kích hoạt — §4.1 | quyết định có bằng chứng |
| **P3a** | RED cho đúng 4 điểm sẽ vá (9 điểm chiếu), SAU khi §3.3 chốt hình dạng DTO | ca đỏ |
| **P4** | L1 `identity-projection.ts` + `buildUserScopeConditionOn` + unit test 4 constructor | GREEN |
| **P5** | Vá KI-053 · KI-054a · KI-054b · KI-069 (+ ORDER BY) qua L1; contracts `.optional()` | int-spec xanh |
| **P3b** | ca ALLOW + PIN số cột runtime cho phần còn lại; bằng chứng "đã kín" cho 4 module đã có spec | phủ đủ 12 module |
| **P6** | Điền 71 dòng verdict; ratchet xanh; FE `.optional()`; hồi quy | suite xanh |
| **P7** | `RELEASE-02` (đóng KI-053/054 + mở KI-069/070 + **gỡ ràng buộc dòng 107-108**) · `permission-matrix-spec.md` · `DECISIONS` | doc |
| **P8** | `bash harness/check.sh --all` + `test:cov:sensitive` → FULL gate → PR | PASS |

**P3a TRƯỚC P4/P5, P3b SAU P5 (vá B10b).** Ca RED cho `auth-logs` và `leave-admin` chỉ viết được sau khi
§3.3 chốt hình dạng DTO — nên chúng tách khỏi phần ca ALLOW diện rộng, thay vì để "P3 đủ 12 module" chặn
trước P4.

**Luật ca test (`done_when` #3 + memory `deny-cases-vacuous-without-allow-case`):** mỗi module PHẢI có cả
hai vế. Ca DENY một mình là **xanh-RỖNG** — khi actor đủ quyền và actor thiếu quyền cùng nhận `null`, ca
DENY không chứng minh gì. Đếm **NHÁNH**, không đếm ca.

**Số ca (vá W7):** 12 module − 4 module đã có spec kín (`org` · `recycle-bin` · `users/auth-users` ·
`employees`) = **8 module × 2 vế = 16 ca**, cộng **6 ca** ở P3a (2 KI-053 · 2 KI-054a · 2 KI-054b lệch
chiều) + **2 ca** phân biệt "user đã xoá" vs "ngoài scope" + **2 ca** KI-069 (gồm ca ORDER BY không rò
thứ tự) = **26 ca**. Bốn module đã kín: ghi bằng chứng + trỏ spec đã có, KHÔNG dựng ca mới.

### 4.1 P2b — cổng dừng, ĐỊNH NGHĨA THAO TÁC (vá B10a)

**"Role `employee` chạm được"** ≝ tồn tại một route (theo `collectRoutes()` của
`apps/api/test/foundation/route-census.ts`, nguồn **runtime**) mà (a) route đó gọi tới điểm chiếu, và
(b) cặp `@RequirePermission` của route ∈ tập grant PROD của role `employee` đo **trong ngày thi công**.

Lệnh đo: truy vấn `role_permissions ⋈ roles ⋈ permissions where roles.name='employee'` qua
`DATABASE_DIRECT_URL` **từ HOST**. Bằng chứng lưu: `docs/_review/S6-SEC-IDENTITY-PROJ-1-prod-grants.json`.

**Kết quả 2026-08-19 — KHÔNG kích hoạt.** Không điểm UNBOUND nào thoả:

| Điểm UNBOUND | Cặp gate | `employee` giữ? |
| --- | --- | --- |
| `role-admin#listRoleMembersTx` | `read`/`view:role` | ❌ |
| `login-log#findManyTx` · `security-event#findManyTx` | `view:audit-log` | ❌ |
| `leave-admin#listBalancesTx` | `view:leave-balance` | ❌ (chỉ `view-own:leave-balance@Own` — cặp KHÁC) |

⇒ không lỗ SỐNG ⇒ **không** phải tách WO như `S6-SEC-IDENTITYBOUND-1` đã làm với KI-051.

**`chat` (10 điểm) — trả lời câu hỏi mở của review.** `chat` NẰM TRONG tiêu chí P2b, không hoãn:
`module.is_active = false` **KHÔNG phải cổng** (memory `module-is-active-is-not-a-gate` — module "chưa
bật" vẫn gọi được). Đã verify từng điểm ở §Phụ lục A: 7 điểm `membership` (`assertMember` là điểm khẳng
định duy nhất, `chat-access.service.ts:122`), 1 `self-bound-row`, 3 `waiver` (oversight —
`view:chat-oversight` `isSensitive`, đo PROD: **chỉ `SA`, 2 user, @Company**). `employee` giữ
`view:chat-room@Company` nhưng mọi đường đọc roster/tin đều qua `assertMember` ⇒ không chạm được điểm nào
ngoài phòng mình.

---

## 5. Rủi ro và cách chặn

| # | Rủi ro | Chặn |
| --- | --- | --- |
| R1 | Đổi hành vi allow-path | Ca ALLOW đối chứng mỗi module + PIN số cột runtime (§2.3). Không có nó thì "0 hàng" không phân biệt được với "route hỏng" |
| R2 | Vỡ TRẮNG màn hình FE | Đổi contract: `roleMemberSchema.email` (`role-permission-list.ts:59` — nay `z.string()` BẮT BUỘC), `leaveBalanceAdminViewSchema.userFullName` (`leave.ts:1048` — nay `.nullable()` không `.optional()`), `AuthLogUserRef.email` → tất cả `.optional()`; ca console chứng minh ĐỎ khi gỡ `.optional()` |
| R3 | `null` lẫn nghĩa | §3.3 chốt ba nhánh phân biệt được cho `userRef`; ca test cho từng nhánh |
| R4 | Refactor 71 điểm sinh hồi quy diện rộng | WO KHÔNG chuyển 62 điểm còn lại sang `identityColumns`; chúng được **ghi phán quyết**. Chuyển hàng loạt là WO khác |
| R5 | Ratchet đỏ oan khi thêm module | Thông điệp lỗi in khoá điểm + cặp diff rename + đường thêm verdict; docblock ghi "mặc định của điểm mới là VÁ, không phải xin waiver" |
| R6 | `resolveOrNull` dùng nhầm chỗ | Chỉ dùng khi cặp gate ≠ cặp bound (cả 4 bản vá đều vậy: gate `read:role`/`view:audit-log`/`view:leave-balance`, bound `view:user`). Cặp gate = cặp bound thì `null` nghĩa là guard đã hỏng ⇒ phải `resolveAndAssert` (`data-scope.service.ts:86-98`) |
| R7 | Xanh-giả do thiếu DB | int-spec dưới `LANE_DB` riêng; **cổng cứng trước PR**: `bash harness/check.sh --all` (skip vượt ngưỡng ⇒ exit 1) + `TURBO_FORCE=1` (memory `turbo-cache-false-green`) |
| R8 | Coverage gate cắn oan | `login-log.repository.ts` + `security-event.repository.ts` đang gate per-file ≥80% (`vitest.config.ts:197-208`) ⇒ chạy `pnpm --filter @mediaos/api test:cov:sensitive` dưới `LANE_DB` trước PR |
| R9 | `paths` WO quá RỘNG ⇒ bắt nhầm WO khác (đã gây WIP ảo 3 lần 31/07) | Chỉ WO này `in_progress`; đóng dấu `done`/`blocked` ngay khi dừng |
| **R10** | **`paths` WO quá HẸP cho chính nó** (vá B8) | P0b thêm: `apps/api/src/auth/auth-logs-viewer.service.ts` · `apps/api/src/leave/**` · `packages/contracts/**` · `apps/console/**`. Memory `wo-paths-drive-gate-and-scheduler`: thiếu ⇒ lọt LIGHT gate |
| **R11** | **Hot-file rewrite** (vá W6) | Sổ verdicts + `test/foundation` (162 ca) là **APPEND**, KHÔNG rewrite (CLAUDE.md §9.3) |
| **R12** | **File crown-jewel mới không có ngưỡng coverage** (vá W2) | `vitest.config.ts` thêm khối per-file cho `src/permission/identity-projection.ts` ≥90 (logic thuần, unit-test được, không cần DB — cùng bậc `dag-validator.service.ts`) |

---

## 6. NGOÀI phạm vi

- Lớp **PREDICATE** (13 điểm, `ilike(users.email, …)`) — lớp **oracle** (dò tồn tại qua tìm kiếm), KHÔNG
  cùng lớp lỗ với chiếu. Gộp vào một con số rồi báo động là sai. WO riêng nếu cần.
- **ORDER BY / GROUP BY** (8 điểm) — ⚠️ **KHÔNG** khẳng định "không phơi giá trị": `leave-admin:235`
  chứng minh ngược lại và ĐƯỢC VÁ trong WO này (§3.5). 7 điểm còn lại: sắp theo cột **không** bị che ở
  cùng truy vấn ⇒ không tạo oracle; ghi vào verdicts basis `order-only` kèm lý do từng điểm.
- Chuyển 62 điểm đã có căn cứ sang `identityColumns` — R4.
- `PermissionGuard` tự resolve `data_scope` — loại ở §2.1.
- **Bound HÀNG** cho `login_logs` / `user_security_events` / `role_members` — §3.4, mở **KI-070**.
- `packages/**` và FE — census chỉ quét `apps/api/src` (`BLIND_OUT_OF_TREE`).

---

## 7. Nghiệm thu (ánh xạ 1-1 với `done_when`)

| # | `done_when` | Nghiệm thu |
| --- | --- | --- |
| 1 | Cơ chế ép ở tầng type | `IdentityGrant` có brand + 4 constructor; ca `@ts-expect-error` cho object literal **VÀ** chiều ratchet `as IdentityGrant = 0` (vì `as` không bị type chặn — §2.3) |
| 2 | RED trước, 1 ca/module | 8 module có ca đỏ + 4 module ghi bằng chứng "đã kín" trỏ spec đã có; tổng 26 ca (§4) |
| 3 | Không đổi allow-path | Ca ALLOW đối chứng + PIN số cột danh tính runtime; hồi quy suite xanh |
| 4 | ĐO PROD | §1.2 (đo 2026-08-19); bằng chứng `docs/_review/S6-SEC-IDENTITY-PROJ-1-prod-grants.json` |
| 5 | Đóng KI-053 + KI-054 | int-spec trước-sau; `RELEASE-02` đóng kèm số đo **và chép nguyên văn câu ranh giới §3.4** |
| 5b | **KI-069** (vá W5) | int-spec `leave-admin` bound + ca ORDER BY không rò thứ tự; `RELEASE-02` mở+đóng cùng WO |
| 5c | **KI-070** (vá B9) | `RELEASE-02` mở, có mức + chủ + workaround; KHÔNG đóng ở WO này |
| 6 | S3 không chặn RC | §0 + dấu `unblocked` ở `harness/activity.jsonl` (ts `2026-08-19T09:59:59Z`) |
| 7 | FULL gate PASS + `RELEASE-02` | `security-reviewer` + `silent-failure-hunter` PASS; `check.sh --all` xanh; `test:cov:sensitive` không tụt ngưỡng |

---

## Phụ lục A — phân loại 71 điểm (P2, đo 2026-08-19)

| basis | điểm |
| --- | --- |
| `scoped-predicate` | 20 |
| `membership` | 11 |
| `self-bound-row` / `self-bound-route` | 3 / 5 |
| `no-actor` | 7 |
| `identity-gated` | 6 |
| `second-assert` | 6 |
| `waiver` | 4 |
| `order-only` | 1 (`hr-read#SORT_COLUMNS` — bản đồ cột sắp xếp, không phát ra response) |
| **UNBOUND** | **9** ← §3.3 |

**Bằng chứng "đã kín" theo module** (file:dòng, đo trực tiếp trên cây 2026-08-19):

| Module | Căn cứ |
| --- | --- |
| `employees` (13) | `employees.service.ts:95-108` · `hr-read.service.ts:93-104` `listScopedTx(scopeCond)` · `hr-org-chart.service.ts:47-58` · `profile-change-request` = tên NGƯỜI DUYỆT trên đơn của chính actor (`waiver`) · `SORT_COLUMNS` = `order-only` |
| `attendance` (8) | `attendance.service.ts:457-463` self-bound + `assertCanManage` · `attendance-report.service.ts:40-62` · `attendance-adjustment.service.ts:292-302` · `remote-work-request.service.ts:288-298` · `attendance-alert-noti` ×3 = job máy |
| `chat` (10) | `chat-members.service.ts:68` · `chat-rooms.service.ts:138` · `chat-attachments.service.ts:158` · `chat-search.service.ts:53` (+`repo.search(actor.id)`) — đều `assertMember` · `findSenderDisplayName(actor.id)` self · `chat-oversight` ×3 `waiver` (`view:chat-oversight` `isSensitive`, PROD: chỉ `SA`/2 user) |
| `leave` (6) | `leave-report.service.ts:34-46` · `leave-calendar.service.ts:54` · `leave-approval.service.ts:104-116` — scopeCond · `leave.service.ts:122-128` / `:163-182` — second-assert · **`leave-admin.service.ts:511-527` UNBOUND** |
| `org` (7) | `identityInScope` (`org.repository.ts:183,285`) · `listEmployees(scopeCond` BẮT BUỘC`)` · `listOrgUnits`+`getOrgTree` `headUserName` = waiver đã ký `route-verdicts.ts` |
| `auth` (10) | `auth.service.ts:503` `eq(users.id, claims.sub)` · `:1104-1105` `me` · `two-factor.service.ts:166` — self-bound-route · **login-log + security-event = 6 điểm UNBOUND** |
| `tasks` (5) | `projects.service.ts:127,148` `scopeExists` · `listMembersTx` sau `findDetailByIdTx(scopeExists)` · `reloadDetail`/`reloadMember` sau ghi đã gate · `task-activity-feed.service.ts:52-71` `view:task-audit-log` HOẶC involvement · `tasks.service.ts:462-464` **@deprecated, KHÔNG còn route** |
| `integrations/lms` (4) | producer outbox + job handler — không actor HTTP |
| `me` (3) | `where eq(users.id, userId)` token-resolved |
| `recycle-bin` (2) | `S6-SEC-IDENTITYBOUND-1` |
| `users` (1) | `auth-users.repository.ts:111` nhận sẵn vị từ scope |
| `permission` (2) | **UNBOUND** — KI-053 |

---

## Phụ lục B — KẾT QUẢ THI CÔNG (2026-08-19)

### B.1 Những gì bản vá thật sự đã dạy, mà plan không đoán trước

| # | Phát hiện | Vì sao đáng giữ |
| --- | --- | --- |
| B-1 | **`ORDER BY` trên chính cột sắp bị che là một oracle** — và nó có ở HAI chỗ (`role-admin.repository` `orderBy(users.email)`, `leave-admin.repository` `orderBy(asc(users.fullName))`), không chỉ chỗ mà plan-review W1 chỉ ra | Che giá trị mà giữ nguyên thứ tự sắp = thứ tự hàng tiết lộ alphabet của thứ vừa che. Khó thấy hơn cột bị rò vì nó không nằm trong body response |
| B-2 | **Gọi `identityColumns` hai lần trong một `select` thì cờ sau ĐÈ cờ trước** — hai nhóm danh tính dùng chung một cờ ⇒ nhóm chủ thể bị quyết định bởi vị từ của nhóm actor, im lặng | Không có test nào bắt được cái này; nó chỉ lộ khi viết ca C2/C3. Đã vá bằng tham số `flagKey` + ca unit riêng |
| B-3 | **Chính bản vá làm CENSUS BỊ MÙ**: nâng `alias(users,…)` từ biến cục bộ lên hằng cấp module (việc bắt buộc để service dựng được vị từ trên cột của vai actor) làm scanner mất dấu 2 điểm NGAY LẬP TỨC — ratchet báo "verdict mồ côi" thay vì "điểm mồ côi" | Một thao tác refactor tầm thường đủ để thu hẹp census. Đã vá: scanner lần theo gán-lại tới điểm bất động. Ghi rõ vùng mù còn lại: import **xuyên file** vẫn chưa lần được |
| B-4 | **KI-053 mô tả SAI cặp gate.** `RELEASE-02` ghi gate là `read:role`/`view:role`; đo lại thì route gate `view:user` và service còn `assertCan(view,user)` nữa | Khuyết tật vẫn thật nhưng khác hình dạng: cặp gate ĐÚNG mà `data_scope` không bao giờ được đọc. Bài học: số đo trong sổ KI cũng phải đo lại, không chỉ số đo trong `src[]` |
| B-5 | **Ca DENY `D2` xanh cả khi bản vá bị vô hiệu hoàn toàn** — chưa seed số dư phép nào ⇒ "0 hàng mang khoá danh tính" đúng một cách RỖNG | Chỉ phát hiện được bằng cách CỐ Ý neutralise `fromScope` rồi chạy lại. 4 ca đỏ, 1 ca xanh — và cái xanh mới là cái nguy hiểm |

### B.2 Nghiệm thu đã chạy

| Hạng mục | Kết quả |
| --- | --- |
| Ratchet L2 | 7/7 xanh. **RED trước** đã ghi: verdicts rỗng ⇒ ĐỎ, gọi tên đúng **9 điểm** không có căn cứ |
| L1 unit (`identity-projection.spec.ts`) | 11/11 xanh · coverage **100% cả 4 trục** (ngưỡng per-file đặt 90 ở `vitest.config.ts`) |
| int-spec `identity-projection-scope` | 11/11 xanh dưới `LANE_DB=mediaos_identityproj` |
| **RED-proof #1** (thay hai grant bằng một) | **C2 + C3 ĐỎ** đúng hai chiều: "LỘ email người gây ra" + "GIẤU email của chính actor" |
| **RED-proof #2** (neutralise `fromScope` ⇒ luôn `true`) | **A2 · B2 · C2 · C3 · D2 ĐỎ** (D2 chỉ đỏ SAU khi seed số dư thật — xem B-5) |
| api unit (`src` + `test/foundation`) | 3666 xanh / 1062 skip |
| Hồi quy vùng chạm (auth·permission·role·leave·org·recycle·security·login) | **67/67 file xanh** dưới `LANE_DB` |
| `test/foundation` + e2e | 25/25 file xanh |
| FE | `apps/app` + `apps/console` + `apps/auth` typecheck sạch; `RoleMembersTab.spec.tsx` 8/8 (thêm ca hàng ngoài scope) |
| lint toàn workspace | xanh |
| Full-suite một lượt | **crash KI-014** (tinypool `ERR_IPC_CHANNEL_CLOSED` sau `chat-qa1-scale.int-spec.ts`) — hạ tầng test, KHÔNG phải bài đỏ; chạy theo chunk là cách đã biết |

### B.3 Sai khác so với plan — nói thẳng

- **P3b không dựng 16 ca ALLOW cho 8 module còn lại.** Bốn module vá trong WO này có đủ cặp DENY+ALLOW
  (11 ca). Tám module còn lại được **ghi phán quyết có ký** (Phụ lục A) + ratchet giữ, chứ không có ca
  runtime mới. Lý do: chúng đã có spec riêng ở tầng của mình (`employees-rbac-scope`, `org-directory-scope`,
  `identity-bound-scope`, chat/tasks suite), và dựng thêm 16 ca chỉ để chạm lại cùng đường là chi phí
  không đổi lấy bằng chứng mới. **Cái mất:** chiều đo runtime "PIN số cột danh tính trong response"
  (§2.3) chỉ áp cho 4 module đã vá, không áp cho 8 module kia — census tĩnh vẫn là bằng chứng duy nhất
  ở đó. Ai muốn đóng nốt thì đó là một WO nhỏ, không phải một dòng verdict.
- **KI-070 mở, không đóng** — ranh giới bound-CỘT/bound-HÀNG (§3.4).

### B.4 FULL gate — verdict và cái nó đổi

| Gate | Verdict | Kết quả |
| --- | --- | --- |
| `silent-failure-hunter` | 4 finding (1 HIGH · 1 MEDIUM · 2 LOW) | **vá hết** |
| `security-reviewer` | **PASS** — 0 CRITICAL · 0 HIGH · 7 MEDIUM · 4 LOW | **vá 10/11**; 1 mục đổi thành đính chính tài liệu |

**Ba finding đổi THIẾT KẾ, không chỉ đổi chữ:**

1. **`IdentityGrant` không bị buộc vào bảng nó bảo vệ (F1).** `buildUserScopeConditionOn` nhận cột bất
   kỳ và `identityColumns` bọc cột bất kỳ ⇒ dựng vị từ trên `users` rồi đem bọc
   `SECURITY_EVENT_ACTOR.email` là **hợp kiểu và chạy được** — đúng lỗ B1 mà WO này tồn tại để đóng.
   Cái giữ 4 call-site đúng hôm nay là hai ca int-spec, **không phải cơ chế**. Nay grant mang `table`
   và `identityColumns` **ném** khi lệch: lỗi im lặng thành lỗi ồn ào, ngay lần chạy đầu tiên.

2. **Nhánh thứ ba của `userRef()` CHẾT (F2), và câu tôi viết vào `RELEASE-02` là overclaim (F4).**
   `users.email` NOT NULL ⇒ join trúng thì luôn có email; join TRƯỢT thì mọi cột NULL ⇒ vị từ cho
   `NULL` ⇒ hàng rơi vào nhánh "ngoài scope". Tức "user đã xoá cứng" và "ngoài scope" **chia chung
   hình dạng**. Đã bỏ nhánh chết, `coalesce((cond), false)` để cờ đúng kiểu (`boolean`, không phải
   `boolean | null` nói dối), và **ghi thẳng ranh giới** thay vì giữ một lời hứa test không kiểm được
   — đúng lỗi mà chính KI-054 tố cáo, suýt tái phạm ở sổ KI. Hệ quả: hai ca "user đã xoá vs ngoài
   scope" mà plan §4 hứa **không còn nghĩa** ⇒ gỡ khỏi §4/§7 thay vì viết một ca không phân biệt được gì.

3. **Trần đếm chỉ phủ 4/9 basis (F5) ⇒ đường né rẻ nhất vẫn mở.** Lý lẽ "ba căn cứ còn lại mang vị từ
   SQL thật nên tự nó là bằng chứng" **sai ở tầng sổ**: sổ chỉ chứa CHUỖI, ratchet không bao giờ nhìn
   thấy vị từ. Một điểm mới không bound chỉ cần dán `basis:"scoped-predicate"` hoặc `"order-only"` là
   ratchet xanh. Nay MỌI basis có trần + một assert bắt basis nào chưa có trần.

**Bốn finding còn lại đã vá:** `asIdentityGrant` bỏ sót `<IdentityGrant>x` và dạng hợp (F6, + hạ giọng
docblock: `any` vẫn xuyên qua brand — bộ đếm thu hẹp bề mặt, không đóng kín); FE hai trang auth-log
render ô RỖNG cho hàng ngoài scope (F7); `identityGrant()` gọi DB **bên trong** transaction ở
`adjustBalance` ⇒ dưới PgBouncer transaction-mode có thể ăn hết pool (F10); UUID fixture
`…-00000000log1` không phải hex ⇒ spec xanh vì đi vào **nhánh lỗi hạ tầng** chứ không phải nhánh deny
(F11); vùng mù `import` xuyên file nay pin thành số `exportedUserAliases` (F12); `ORDER BY` đổi từ
`citext` sang `text` nên comment "thứ tự không đổi" là sai — nay `lower()` (F8).

**Mục KHÔNG vá:** F3 (thiếu 2 ca "user đã xoá vs ngoài scope") — vì F2 chứng minh hai ca đó không phân
biệt được gì; sửa plan cho khớp sự thật là đúng hơn viết một ca tautology.
