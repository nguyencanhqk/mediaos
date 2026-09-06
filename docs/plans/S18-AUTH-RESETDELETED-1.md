# S18-AUTH-RESETDELETED-1 — `resetPassword` không lọc `deleted_at`

> Vùng: 🔴 **đỏ** (AUTH, đường công khai không xác thực). Gate: **FULL**
> (`security-reviewer` + `silent-failure-hunter`).
>
> **v2** — vá 4 mục BLOCKING + 8 cảnh báo của `plan-reviewer` vòng 1. Mọi khẳng định dưới đây đã đối
> chiếu code thật; chỗ nào là **quyết định** thì ghi rõ là quyết định, không trá hình thành sự thật.

---

## 1. Lỗ (đã xác minh trên code, không phải suy đoán)

`apps/api/src/auth/auth.service.ts:1538-1544` — câu UPDATE trong `resetPassword`:

```ts
const [updated] = await tx
  .update(users)
  .set({ passwordHash: newHash, updatedAt: new Date(), mustChangePassword: false })
  .where(eq(users.id, row.userId))          // ⛔ KHÔNG có isNull(users.deletedAt)
  .returning({ email: users.email, deletedAt: users.deletedAt });
```

Cầm một token reset còn hạn, chưa dùng, của user **đã xoá mềm** ⇒ hash mật khẩu của hàng đó **bị ghi
đè**, token bị `used_at`, API trả **200 `{ok:true}`**.

Nguy hiểm hơn "dữ liệu chết": unique email là **PARTIAL** (`WHERE deleted_at IS NULL`) nên email của
user đã xoá **có thể đã được cấp lại cho người khác**.

**Cửa sổ khai thác** (hẹp nhưng thật): `forgotPassword` không mint token cho hàng đã xoá ⇒ token phải
được mint **TRƯỚC** khi user bị xoá mềm và còn trong TTL. Đúng ca "xoá nhân viên nghỉ việc trong lúc
họ đang giữ mail đặt lại mật khẩu".

---

## 2. Đo trước khi sửa — `done_when` #1 và #4 (KẾT QUẢ)

Duyệt MỌI đường ghi `users.password_hash` / cấp lại quyền truy cập, để trả lời "ĐƠN LẺ hay một lớp lỗi":

| Đường | Vị trí | Lọc `deleted_at`? |
| --- | --- | --- |
| `login` bước 1 | `auth.service.ts:350` → `findActiveUserByEmail:1729` | ✅ `isNull(users.deletedAt)` |
| `login` bước 2 (2FA) | `auth.service.ts:628` | ✅ chặn khi `user.deletedAt` |
| `refresh` | `auth.service.ts:1278` | ✅ `if (!row \|\| row.deletedAt) return null` |
| `forgotPassword` | `auth.service.ts:1423` → `findActiveUserByEmail` | ✅ — **KHÔNG mint** token mới cho hàng đã xoá |
| admin `POST /auth/users/:id/password/reset` | `auth-users.repository.ts` `setPasswordTx:366` | ✅ → `updated` undefined → **404 `USER_NOT_FOUND`** |
| `changePassword` | READ `:753` / **WRITE `:766`** | ⚠️ **✅ ở READ, ❌ ở WRITE** — xem §2c |
| **`resetPassword` (token công khai)** | `auth.service.ts:1542` | ❌ **LỖ CỦA WO NÀY** |

Đã kiểm và **không** còn vế bỏ sót nào khác cho hướng "cấp lại quyền cho hàng đã xoá":
`super-admin-bootstrap.repository.ts:106` có `ON CONFLICT … WHERE deleted_at IS NULL` (không hồi
sinh); `user-invites` / `employees` / `hr-write` chỉ INSERT hàng `users` MỚI; `admin-users.repository.ts`
và `auth-users.repository.ts` lọc `deleted_at` ở mọi UPDATE cấp-quyền (`unlock` / `setPassword` / `update`).

**Kết luận:** lỗ **KHAI THÁC ĐƯỢC** là ĐƠN LẺ ⇒ giữ nguyên phạm vi WO. Vế `changePassword` là TOCTOU
**không khai thác được từ ngoài**, xử lý riêng ở §2c.

### 2b. Đo `done_when` ⚠️ — có client nào dựa vào 200 không?

- Client DUY NHẤT: `packages/web-core/src/lib/auth-api.ts:94` → `apps/auth/src/routes/reset-password.tsx:53`
- FE **đã** bắt `err.status === 400 || err.status === 401` → hiện `resetPassword.invalidToken`.
- ⇒ Đổi 200 → 401 **được client hiện tại hấp thụ trọn**. Không cần WO FE kèm.

### 2c. `changePassword` — PHÁN QUYẾT: KHÔNG vá trong WO này

Sự thật (đã đọc `:749-766`): SELECT `:753` có `isNull(users.deletedAt)`, câu UPDATE `:766` thì
**không** — cùng hình dạng lỗi, nhưng bị chặn upstream bởi câu đọc **trong cùng tx**. Khai thác đòi
soft-delete commit xen vào giữa `:753` và `:766` (cỡ micro-giây) **và** kẻ tấn công đã có access token
hợp lệ **và** biết mật khẩu hiện tại — mà user xoá mềm thì `login`/`refresh` đều đã chặn nên token của
họ chết theo TTL.

**Vì sao không vá kèm:** thêm `isNull` vào `:766` mà không xử kết quả sẽ tạo **ĐƯỜNG THÀNH CÔNG GIẢ**
(0 hàng khớp ⇒ hàm vẫn `return true` ⇒ **200 mà mật khẩu không đổi**) — tệ hơn hẳn TOCTOU đang vá. Xử
cho đúng thì phải chọn mã lỗi mới và quyết định có phạt rate-limit không (`:788-792` hiện phạt
`recordFailure` + `recordReauthFailure` + ném "Mật khẩu hiện tại không đúng") — đó là quyết định của
một WO khác, không phải phần thừa của WO này.

⇒ **Seed WO tiếp theo** `S18-AUTH-CHANGEPWTOCTOU-1` trong `harness/backlog.mjs` (zone đỏ, todo). Owner
có thể lật quyết định này; plan không tự nới phạm vi vùng đỏ.

---

## 3. Thiết kế bản vá

### 3.0 Đòi token theo lối NGUYÊN TỬ — điều kiện tiên quyết của mọi lập luận bên dưới

Hiện trạng: SELECT token (`:1527-1532`) **không** `FOR UPDATE`, và UPDATE `used_at` (`:1543-1546`)
**không** có `AND used_at IS NULL`. Ở READ COMMITTED, N request đồng thời cùng một token đều đọc
`usedAt = null`, đều đi tiếp, đều ghi ⇒ **single-use hôm nay KHÔNG được code ép**, và kẻ cầm token
điều khiển được số hàng sinh ra.

Đây **không phải mở rộng phạm vi**: §3.2 thêm một lệnh ghi trên đường **không xác thực**, và lý do duy
nhất khiến việc đó an toàn là "≤1 lần/token". Không ép được thì lập luận đó sai ⇒ phải ép.

```ts
// ĐÒI token trước khi làm bất cứ việc gì tốn kém. Kẻ thua race khớp 0 hàng ⇒ 401 y hệt.
const [claimed] = await tx
  .update(passwordResetTokens)
  .set({ usedAt: new Date() })
  .where(and(eq(passwordResetTokens.id, row.id), isNull(passwordResetTokens.usedAt)))
  .returning({ id: passwordResetTokens.id });
if (!claimed) return null;
```

`UPDATE … WHERE used_at IS NULL` là nguyên tử dưới READ COMMITTED: kẻ thua chặn ở khoá hàng, đọc lại
bản mới, khớp 0 hàng. **Không cần `FOR UPDATE`.** Đặt TRƯỚC `password.hash` ⇒ kẻ thua không đốt argon2.

### 3.1 Siết `WHERE` của câu UPDATE `users`

```ts
.where(and(
  eq(users.id, row.userId),
  eq(users.companyId, companyId),   // BẤT BIẾN #1 — mirror mọi repo khác, hiện chỉ dựa vào RLS
  isNull(users.deletedAt),          // ⬅ điểm chốt của WO
))
.returning({ email: users.email })  // ⬅ BỎ deletedAt — xem §3.3
```

Hàng xoá mềm ⇒ `updated === undefined` ⇒ **hash KHÔNG bị ghi đè**.

### 3.2 Nhánh từ chối — thứ tự lệnh là hợp đồng

```
1. SELECT token → !row / usedAt / hết hạn ⇒ return null            [không ghi gì]
2. ĐÒI token nguyên tử (§3.0) → thua ⇒ return null
3. newHash = await password.hash(...)
4. UPDATE users …§3.1 → updated
5. if (!updated) { đo lý do; audit 'auth.password_reset_denied'; return null }   ← DỪNG
6. …ca thành công (revoke refresh · revoke sessions · audit · 2 security event · slug)
```

**`used_at` bị đốt CẢ ở ca từ chối** (`done_when` #5): `auth-users.repository.ts:337-349` có
`restoreTx` — khôi phục user là `deleted_at = NULL`. Nếu token vẫn sống thì khôi phục user trong TTL
làm **token cũ sống lại**. Đốt token là cách duy nhất đóng vế đó.

> **Diễn giải `done_when` #5 — để owner ký, không để người sau tự suy ngược.** Chữ WO là "kiểm tra
> hàng token có bị đánh dấu `used_at` **nhầm** không". Đã kiểm: hôm nay `used_at` được set **vô điều
> kiện**, kể cả cho hàng xoá mềm. Plan này đọc vế "token phải bị VÔ HIỆU" là **chuẩn**, và giữ nguyên
> hành vi đốt token — chỉ khác là từ nay nó nguyên tử (§3.0) và **không** kèm việc đổi mật khẩu.

**Audit ca từ chối — ĐO rồi mới ghi, không khẳng định điều chưa quan sát:**

```ts
const [probe] = await tx.select({ deletedAt: users.deletedAt })
  .from(users).where(eq(users.id, row.userId)).limit(1);
const reason = !probe ? "user_not_visible" : probe.deletedAt ? "user_deleted" : "state_changed";
```

Ghi thẳng một `reason` cố định là để audit **khẳng định** thứ code vừa mất khả năng quan sát (vì
`.returning()` không còn trả `deletedAt`). Một SELECT ở nhánh **chạy tối đa 1 lần/token** là rẻ, và
audit là "bằng chứng duy nhất" nên nó không được nói sai.

> **Sửa v3 — `security-reviewer` và `silent-failure-hunter` ĐỘC LẬP cùng bắt đúng chỗ này, và họ
> đúng.** Bộ nhãn v2 (`no_live_user` / `tenant_mismatch`) nói nhiều hơn thứ phép đo thấy được.
> `users` có FORCE RLS `USING company_id = current_setting('app.current_company_id')`
> (`0002_companies_users.sql:65-67`) và `withTenant` set GUC đó `= companyId`
> (`db.service.ts:87-89`) ⇒ **probe bị bó vào đúng tenant của token**. Hai hệ quả:
>
> - `tenant_mismatch` **không đạt tới được**: probe thấy hàng ⇒ hàng cùng tenant; hàng cùng tenant mà
>   còn sống thì predicate của câu UPDATE đã thoả ⇒ mâu thuẫn. Nghĩa THẬT của ca đó là **trạng thái
>   đổi giữa hai câu lệnh** (READ COMMITTED — mỗi statement một ảnh chụp; ví dụ `restoreTx` xen vào)
>   ⇒ đổi tên `state_changed`.
> - `no_live_user` **đảo nghĩa**: 0 hàng KHÔNG phân biệt được "vắng hàng" (bất khả nhờ FK) với "hàng
>   thuộc tenant khác bị RLS ẩn" — từ trong tenant hai thứ đó giống hệt nhau ⇒ nhãn trung thực là
>   `user_not_visible`. Hôm nay N=1 nên vế cross-tenant chưa xảy ra được, nhưng hạ tầng tenant vẫn
>   được giữ để mở rộng ⇒ một nhãn sai cắm thẳng vào bảng append-only là mìn hẹn giờ.
>
> Bài học chung: **đừng dán nhãn nguyên nhân cho một phép đo chạy dưới RLS mà không hỏi RLS đang ẩn
> gì.** Predicate tường minh và predicate ngầm của RLS trông giống nhau trong code, khác nhau ở chỗ
> cái ngầm biến "khác tenant" thành "không tồn tại".

**Ca `audit.record` NÉM ở nhánh này** ⇒ tx rollback ⇒ mất cả `used_at` vừa đốt lẫn vết audit, người
dùng nhận 500. **Chấp nhận** vì fail-CLOSED (không ai đổi được mật khẩu) và cùng hình dạng với nhánh
thành công. Nhưng một quyết định "chấp nhận" mà **0 test pin** thì lần refactor sau (ai đó bọc
`audit.record` trong `try/catch` "cho an toàn") sẽ lặng lẽ đổi nó thành 401-không-vết ⇒ §4(b) có ca
khoá đúng hành vi này.

Trường của hàng audit — **chốt tường minh, không để implementer tự quyết ở vùng đỏ**:
`action: "auth.password_reset_denied"` · `objectType: "auth"` · `objectId: row.userId` ·
`actorUserId: row.userId` · `after: { reason }`.

`actorUserId` **an toàn FK**: `audit_logs.actor_user_id` có `.references(() => users.id)`
(`schema/audit.ts:32`), và `password_reset_tokens.user_id` là **NOT NULL + FK tới `users.id`**
(`schema/auth.ts:64-66`) — hàng token tồn tại ⇒ hàng user tồn tại (soft-delete GIỮ hàng; hard-delete
bị BẤT BIẾN #2 cấm). Nên ca 23503 → rollback → mất `used_at` + 500 **không tới được**.

**Ném ở đâu:** `return null` rơi vào `if (!target) throw new UnauthorizedException(...)` **có sẵn ở
`:1586`** — cùng literal `"Token không hợp lệ hoặc đã hết hạn."` với `:1522` ⇒ **BYTE-GIỐNG NHAU**
(`done_when` #2), và tx **COMMIT** (giữ `used_at` + audit) vì ném NGOÀI `withTenant`.
⚠️ **KHÔNG** ném trong tx — rollback sẽ nuốt cả hai.

**Ca audit INSERT hỏng ở nhánh deny** ⇒ tx rollback ⇒ 500 và token **vẫn sống**. Chấp nhận: cùng hình
dạng với nhánh thành công (ở đó audit hỏng cũng rollback cả reset), và fail-closed.

### 3.3 GỠ `deletedAt` khỏi `target` + gỡ guard trong `clearLoginLocksAfterReset` — QUYẾT ĐỊNH

Sau §3.1, người gọi DUY NHẤT không bao giờ dựng được `target.deletedAt` khác null. Hai lối, plan
**chọn lối (ii)**:

- (i) giữ guard + thêm `logger.error` ⇒ một nhánh **không tới được** + hai unit spec khẳng định một
  trạng thái mà code thật không sinh ra — đúng hình dạng `tests-can-pin-a-hole-open` mà chính plan
  này cảnh báo ở §4.
- (ii) **GỠ**: bỏ `deletedAt` khỏi `.returning()` (`:1541`), khỏi shape `target` (`:1578-1583`), khỏi
  tham số của `clearLoginLocksAfterReset`, và bỏ nhánh `if (deletedAt) return;` (`:1623`).

**Vì sao (ii) không phải "gỡ một hàng rào an ninh":** hàng rào **mạnh lên** — trước đây nó chỉ chặn
bước *gỡ khoá Valkey* SAU KHI mật khẩu đã bị đổi; giờ predicate ở §3.1 chặn **cả việc đổi mật khẩu**,
sớm hơn và ở tầng DB. Hàm là `private`, **một** người gọi.

⚠️ **Kiến thức thì GIỮ:** đoạn docblock `:1618` giải thích hiểm hoạ partial-unique / email cấp lại cho
người khác **không được xoá** — viết lại thành lời giải thích cho `isNull(users.deletedAt)` ở §3.1
(nơi nó thực sự có hiệu lực), kèm con trỏ `S18-AUTH-RESETDELETED-1`.

---

## 4. Test — RED trước

⚠️ **Bẫy đã đo:** `auth.service.spec.ts:862-864` mock `.returning()` trả **cứng**
`[{email, deletedAt}]`, **mù với predicate `.where()`**. Thêm `isNull` vào WHERE **không** làm unit
spec đổi màu ⇒ unit spec **không được** làm bằng chứng chính
(`tests-can-pin-a-hole-open` · `same-builder-twice-makes-unit-spec-vacuous`).

### 4(a) int-spec trên DB thật — bằng chứng chính

`apps/api/test/integration/auth-s18-resetdeleted-1.int-spec.ts` (LANE_DB `s18resetdel`).
**Mỗi ca TỰ CHỨA** (user + token riêng, tự soft-delete/restore) — KHÔNG ăn side-effect của ca trước;
phụ thuộc thứ tự `it()` là nguồn flake kinh điển trong lane chung.

1. 🔴 **DENY** (ĐỎ trước vá): user + token còn hạn → soft-delete → `POST /auth/reset-password` ⇒
   - HTTP **401**; envelope so **cả `message` LẪN `error.code`** với ca token-hết-hạn (so hai phản hồi
     **với nhau**, không hard-code chuỗi — tiền lệ `auth-toprisk-http.int-spec.ts:250-253`);
   - `password_hash` **KHÔNG đổi** (đọc trước/sau);
   - `password_reset_tokens.used_at` **ĐÃ set**;
   - đúng 1 hàng audit `auth.password_reset_denied` với `after.reason = 'user_deleted'`.
2. 🟢 **ĐỐI CHỨNG DƯƠNG** (`done_when` #3 — chống xanh-rỗng): user **BÌNH THƯỜNG** ⇒ **200**,
   `password_hash` **ĐỔI**, `used_at` set, refresh token bị thu hồi.
3. 🟢 **KHÔNG SỐNG LẠI**: soft-delete → reset (401) → **restore** user → dùng LẠI token ⇒ vẫn **401**.
   ⚠️ Ca này **xanh cả trước lẫn sau** bản vá (hôm nay `used_at` đã set vô điều kiện) — nó **không**
   bắt hồi quy, nó ghim **lựa chọn triển khai** ở §3.2 (ai đó bỏ `used_at` khỏi nhánh deny thì ĐỎ).
   Ghi rõ điều đó trong docblock của ca, đừng để người sau tưởng nó chứng minh bản vá.
4. 🟢 **ĐÒI token nguyên tử** (§3.0, ĐỎ trước vá): 5 request **song song** cùng một token của user
   BÌNH THƯỜNG ⇒ đúng **1** × 200 + 4 × 401, và đúng **1** hàng audit `auth.password_reset`.
5. 🟢 **admin path đối chiếu**: admin reset lên user đã xoá ⇒ **404** (neo hành vi đã đúng).

**Trả lời `done_when` #4 (phán quyết, không chỉ báo cáo):** hai hình lỗi **KHÁC nhau** (public 401
`"Token không hợp lệ hoặc đã hết hạn."` · admin 404 `USER_NOT_FOUND`) và **khác là ĐÚNG**: đường admin
đã xác thực + qua `PermissionGuard` với cặp `reset-password:user` nên không phải kênh dò danh tính;
đường public không xác thực nên mọi nhánh hỏng phải hội tụ về MỘT phản hồi.

**Bẫy hạ tầng đã biết, phải né ngay khi viết:**
- mint ≥3 token qua `forgotPassword` từ cùng IP sẽ chạm trần `rl:forgot:*` (`auth.service.ts:1407-1413`)
  — `auth-s18-resetclears-e2e.int-spec.ts:233` đã né bằng IP khác; **dùng lại đúng helper đó**.
- `app.init()` PHẢI kèm `listen(0)` (nợ đang mở `S18-QA-SUPERTESTLISTEN-1`) — ca 4 chạy song song nên
  thiếu `listen(0)` là ECONNRESET chắc chắn.

### 4(b) unit spec `auth.service.spec.ts` — số phận CẢ HAI ca `makeService({deletedAt})`

- `:978` "user đã XOÁ MỀM ⇒ KHÔNG gỡ khoá" và `:998` "…bỏ qua trong IM LẶNG" — sau §3.3 cả hai gieo
  một trạng thái **không tới được** ⇒ **XOÁ cả hai**, không sửa cho xanh.
- Thay bằng: ca soi **predicate** của câu UPDATE `users` (bắt `.where()`, khẳng định SQL chứa
  `deleted_at is null` **và** `company_id`), theo đúng khuôn đã có ở `:284` / `:433`.
- Bằng chứng "deny không bao giờ tới `clearLoginLocksAfterReset`" thuộc về int-spec 4(a).1, không
  thuộc unit spec.
- Ca `:987` (`companyRows: []` ⇒ `warn` được gọi) **giữ nguyên** — không liên quan.

### 4(c) cổng

`bash harness/check.sh --all --lane-db=s18resetdel` XANH (`done_when` #6).

---

## 5. Rủi ro đã cân nhắc

| Rủi ro | Phán quyết |
| --- | --- |
| **Timing oracle** — sau vá, nhánh deny làm argon2 + 2 UPDATE + 1 SELECT + 1 audit, còn nhánh *token hết hạn/không tồn tại* trả về ngay sau SELECT (`:1532`). Chênh lệch cỡ argon2 ⇒ người **cầm token** phân biệt được "tài khoản đã xoá" với "token hết hạn" dù chuỗi lỗi giống hệt. | **CHẤP NHẬN.** ⚠️ Lập luận "kẻ đo đã cầm token ⇒ đã biết câu trả lời" của v1 **SAI** — cầm token không cho biết tài khoản đã bị xoá hay chưa. Lý do chấp nhận thật: (a) thông tin rò là về **chính tài khoản của người kiểm soát hòm thư đó**, không phải tài khoản người khác; (b) `resetPassword` **chưa từng** có `applyUniformResponseFloor` nên không có sàn nào bị phá; (c) hướng vá hiển nhiên — dời `password.hash` lên trước tx — sẽ **san phẳng timing nhưng biến token rác thành đòn bẩy CPU** trên endpoint công khai, đắt hơn cái nó mua. |
| **Đổi 200 → 401 trên API công khai** | Đã đo §2b: client duy nhất đã xử 401. |
| **Ghi `used_at` + audit ở nhánh không xác thực** | An toàn **sau §3.0** và chỉ nhờ §3.0: đòi token nguyên tử ⇒ ≤1 ghi/token. Không có §3.0 thì khẳng định này sai (BLOCKING #2 vòng 1). |
| **Migration / contract** | **KHÔNG có.** `audit_logs.action` là `text` không CHECK (`0003_audit_outbox.sql:12`); `object_type = 'auth'` đã trong UNION (`:21`); `AuditEntry.action` là `string`. Route đã là `PUBLIC` trong `test/foundation/route-verdicts.ts:136-139` ⇒ sổ đóng băng không đụng. |
| **Vì sao KHÔNG ghi `user_security_events`** | `eventType` là union ĐÓNG ở `packages/contracts` + catalog ở SPEC-02/DB-02 ⇒ thêm giá trị kéo theo migration + sửa spec, phá khẳng định "KHÔNG migration". Vết forensics đã có ở `audit_logs`. |
| **Rollback** | Revert = **1 commit, không migration**. ⚠️ Không hoàn tác được: những hàng `used_at` đã bị đốt ở nhánh deny trong lúc bản vá đang chạy. |

---

## 6. Phạm vi file (khớp `paths` của WO — không nới)

| File | Đổi gì |
| --- | --- |
| `apps/api/src/auth/auth.service.ts` | §3.0 + §3.1 + §3.2 + §3.3 |
| `apps/api/src/auth/auth.service.spec.ts` | §4(b) |
| `apps/api/test/integration/auth-s18-resetdeleted-1.int-spec.ts` | MỚI — §4(a) |
| `docs/plans/S18-AUTH-RESETDELETED-1.md` | file này |
| `harness/backlog.mjs` | đóng WO + seed `S18-AUTH-CHANGEPWTOCTOU-1` (§2c) |

**KHÔNG đụng:** `auth.controller.ts` (giữ `@HttpCode(200)`; 401 do exception), FE, contracts, migration,
`changePassword` (§2c).
