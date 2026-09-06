# S18-AUTH-CHANGEPWTOCTOU-1 — `changePassword` ghi lên hàng đã xoá mềm (TOCTOU)

> Vùng: 🔴 **đỏ** (AUTH, đường đã xác thực). Gate: **FULL** (`security-reviewer` + `silent-failure-hunter`).
> Kế thừa `S18-AUTH-RESETDELETED-1` §2c — WO đó CHỦ Ý không vá vế này và ghi lý do.
>
> **v3** — v2 vá 4 BLOCKING + 12 cảnh báo của `plan-reviewer`; v3 vá tiếp FULL gate
> (`security-reviewer` + `silent-failure-hunter`, cả hai PASS, 0 CRITICAL/HIGH) — xem §8. Mọi khẳng
> định đã đối chiếu code thật; chỗ nào là **quyết định** thì ghi rõ là quyết định.

---

## 1. Lỗ (đã xác minh trên code)

`apps/api/src/auth/auth.service.ts:749-767` — trong một `withTenant` tx:

```ts
const [row] = await tx
  .select({ passwordHash: users.passwordHash })
  .from(users)
  .where(and(eq(users.id, user.id), isNull(users.deletedAt)))   // ✅ READ có lọc
  .limit(1);
if (!row) return false;
...
await tx
  .update(users)
  .set({ passwordHash: newHash, updatedAt: new Date(), mustChangePassword: false })
  .where(eq(users.id, user.id));                                // ⛔ WRITE KHÔNG lọc, KHÔNG đo kết quả
```

Cùng **hình dạng lỗi** với `resetPassword` đã vá ở #480 (ghi `password_hash` lên hàng đã xoá mềm), khác
ở chỗ được chặn **gián tiếp** bởi câu đọc trong cùng tx. PostgreSQL chạy READ COMMITTED — **mỗi câu
lệnh một ảnh chụp** — nên một `UPDATE users SET deleted_at=…` commit **xen giữa** `:753` và `:766` sẽ
hiện ra với câu UPDATE.

⚠️ **Cửa sổ KHÔNG phải micro-giây** (v1/v2 nói sai, `security-reviewer` bác đúng 06/09): `password.hash`
— argon2id **19 MiB** — nằm CHÍNH GIỮA câu SELECT và câu UPDATE, nên cửa sổ rộng cỡ **hàng chục–hàng
trăm ms**. Và nó **lặp lại được**: một actor thứ hai có quyền `softDeleteUser`/`restoreUser`
(`admin-users.service.ts:141` · `auth-users.service.ts:580`) đảo qua đảo lại quanh một request đang bay
là trúng — `assertNotSelf` chỉ chặn tự-xoá, không chặn hai người phối hợp. Lỗ **dễ trúng hơn** hẳn so
với ước lượng ban đầu.

Và vì sao hậu quả nặng chứ không chỉ là "dữ liệu chết": unique email là **PARTIAL** (`WHERE deleted_at IS NULL`) ⇒ email của
user đã xoá **có thể đã được cấp lại cho người khác**; ghi hash lên hàng đã xoá là ghi lên một danh
tính mà người khác đang sở hữu. Đây là mảnh cuối của lớp lỗi "ghi lên hàng đã xoá mềm" trên `users`.

### 1b. Lựa chọn ĐÓNG BẰNG "chấp nhận TOCTOU" — để owner ký một trong hai

`notes` của WO cho phép owner đóng bằng quyết định chấp nhận. Số liệu để ký:

| | Vá (plan này) | Chấp nhận |
| --- | --- | --- |
| Chi phí | 1 file `src` (~20 dòng) + 2 file test · **0 migration · 0 contract · 0 event_type mới** | 0 |
| Rollback | 1 commit revert, **không có gì không hoàn tác được** (nhánh mới không ghi hàng nghiệp vụ nào) | — |
| Rủi ro còn lại | 0 cho lớp lỗi này | cửa sổ **hàng chục–hàng trăm ms** (argon2 nằm giữa hai câu) và **lặp lại được** bởi actor thứ hai có quyền xoá/khôi phục — không phải "khe micro-giây" như v1 ước lượng |

Plan đi tiếp theo hướng **VÁ**. Nếu owner chọn "chấp nhận", phải ghi vào `notes` của WO — không được
để lại một ô ✅ sai trong bảng đo.

---

## 2. Đo TRƯỚC khi sửa

### 2a. Ai gọi tới được? (đã đo lại — vòng 1 đếm SÓT một client)

| Vế | Kết quả đo |
| --- | --- |
| Caller BE | **DUY NHẤT** `auth.controller.ts:196` (`POST /auth/change-password`, `@HttpCode(200)`) |
| Client FE **(1)** | `apps/app/src/routes/account/ChangePasswordPage.tsx:45` — `:56` map `401\|403` → `errors.invalidCredentials`, **bỏ qua message server** |
| Client FE **(2)** | `apps/console/src/routes/settings/account.tsx:142` — `:146` → `errorText()` `:11` **`return err.message`** ⇒ **in NGUYÊN chuỗi của server** |
| `JwtAuthGuard` | `permission/guards/jwt-auth.guard.ts:37-76` — **stateless**, chỉ verify chữ ký + audience, **KHÔNG đọc `users`** |
| `CompanyGuard` | `permission/guards/company.guard.ts:26` — chỉ đọc claim, **không đọc `users`** |
| `TwoFactorEnforcementGuard` | `:93-105` — đọc policy/role/2FA, **không đọc `users.deleted_at`** |

⇒ **(i)** Cả **ba** APP_GUARD toàn cục (`app.module.ts:138-140`) đều không chặn user đã xoá mềm ⇒ access
token của họ còn sống tới hết TTL. Hôm nay họ bị chặn ở câu SELECT (`!row`), **không** ở câu UPDATE.

⇒ **(ii) QUYẾT ĐỊNH D3b — chấp nhận console hiện chuỗi thô, KHÔNG mở WO FE.** Chuỗi mới
("Phiên đăng nhập không còn hợp lệ.") là tiếng Việt, thân thiện, **không chứa secret, không lộ danh
tính hay sự tồn tại của ai khác** — đúng tiêu chí mà `errorText()` đang dựa vào cho 400/401. Ghi ra để
người sau biết đây là quyết định, không phải chỗ chưa đo.

### 2b. Cổng CHỒNG NHAU — vì sao int-spec "gọi thẳng service với hàng đã xoá" là **xanh RỖNG**

`done_when` #3 đề nghị "mô phỏng bằng cách gọi thẳng service với hàng đã xoá". Đo thật: làm vậy thì câu
SELECT `:753` (đã có `isNull`) bắt trước, trả `!row` ⇒ **câu UPDATE không bao giờ chạy**. Bài test đó
xanh **y hệt nhau** trước và sau bản vá ⇒ nó KHÔNG chứng minh được vế mới
(memory `overdetermined-gate-makes-deny-spec-vacuous` — phải **đột biến TỪNG VẾ**, không đo cả cụm).

Cách đo đúng ở §5.2 §race: **proxy tx** cho câu SELECT thấy một hàng "còn sống" (đúng là thứ READ
COMMITTED cho phép) trong khi câu UPDATE chạy **THẬT** lên hàng **thật sự đã xoá**.

⚠️ **`done_when` #3 phải được sửa lại trong `harness/backlog.mjs` cùng commit này** (file đã trong
`paths`) — nếu không, máy đọc backlog sẽ thấy ✅ trong khi bằng chứng thật nằm ở §race, còn ca thoả
đúng câu chữ cũ (§reachable) thì xanh cả trước lẫn sau vá.

### 2c. Vì sao unit spec một mình là KHÔNG đủ

`auth.service.spec.ts:320-395` mock tx bằng chain stub **mù với `.where()`** — thêm `isNull` vào
predicate không làm nó đổi màu (đúng cảnh báo đã ghi ở đầu `auth-s18-resetdeleted-1.int-spec.ts`).
Unit spec chỉ chứng minh được **cách xử KẾT QUẢ 0 hàng**; sự có mặt của predicate phải do §race chứng
minh. Hai bài, hai nhiệm vụ — không bài nào thay được bài nào.

### 2d. Thứ tự lệnh trong tx (đã tự kiểm — nền của "trả sớm là an toàn")

- `password.hash`/`verify` → `password.service.ts:25-47` `@node-rs/argon2`, **thuần CPU, 0 chạm DB**.
- `withTenant` → `db.service.ts:83-91` chỉ chạy `set_config('app.current_company_id', …)` trước callback — **không phải lệnh ghi**.
- ⇒ Câu `UPDATE users` **là lệnh GHI ĐẦU TIÊN** của tx. Trả sớm ngay sau nó ⇒ `refresh_tokens`,
  `user_sessions`, `user_security_events` **chưa bị đụng**; tx commit đúng **một** hàng `audit_logs`
  (§4.1 D2) — không rollback thủ công, không hàng mồ côi.
- ⚠️ **KHÔNG đảo `password.hash` xuống sau câu UPDATE** (khác #480, nơi câu đòi token được đặt trước
  `hash` để kẻ thua không đốt argon2). Ở đây **phép kiểm `deleted_at` CHÍNH LÀ câu UPDATE**, muốn đảo
  thì phải đẻ thêm một SELECT thừa — không làm.

---

## 3. Cái bẫy trung tâm (chép nguyên từ `done_when`)

Thêm `isNull(users.deletedAt)` vào `:766` mà **không xử kết quả** ⇒ 0 hàng khớp ⇒ hàm vẫn `return true`
⇒ **HTTP 200 mà mật khẩu KHÔNG đổi**. Đó chính là hình dạng **fail-OPEN** nguy hiểm nhất
(memory `empty-success-is-the-fail-open-shape`): nhánh ném thì siết + để vết; nhánh **thành công mà
rỗng** thì nới + im lặng. Bản vá phải xử `.returning()` rỗng **tường minh**.

---

## 4. Thiết kế bản vá

### 4.0 Quyết định

**D1 — GIỮ NGUYÊN nhánh `!row`.** Không gộp `!row` ("tài khoản không còn") vào outcome mới.
- `!row` là đường **chạy được thật** (§2a) và hôm nay để lại **vết BỀN** (`recordReauthFailure` →
  `user_security_events.REAUTH_FAILED`). Gộp = **XOÁ một vết bảo mật đang có**.
- prior-plan §2c đã chốt "plan không tự nới phạm vi vùng đỏ".
- Nợ ghi nhận (§7 #1): nhãn `REAUTH_FAILED` + message "Mật khẩu hiện tại không đúng" cho ca tài khoản
  đã xoá là **nhãn sai** (cùng lớp `rls-makes-cross-tenant-look-nonexistent-in-audit-labels`).

**D2 — Nhánh 0-hàng GHI một hàng audit `auth.password_change_denied`, nhãn `reason` do PROBE ĐO**
*(v1 nói `logger.warn`; v2 đảo theo plan-reviewer; v3 thay hằng `user_gone_between_read_and_write`
bằng probe 1 hàng → `user_not_visible` / `user_deleted` / `state_changed`, mirror
`resetPassword:1643-1655` — hàng append-only KHÔNG được khẳng định nguyên nhân mà `.returning()` rỗng
vừa mất khả năng quan sát)*:
- Lý do v1 ("chưa có `RequestMeta` ⇒ đừng đẻ vết thiếu ip/ua") **không đối xứng**: `auth.password_reset_denied`
  ĐÃ ship ở `:1602-1608` với đúng món nợ đó. Nợ ip/ua là việc của `S18-AUTH-RESETMETA-1`, không phải
  lý do để nhánh từ chối vùng đỏ **không có vết bền nào**.
- Giá schema = **0**: `audit_logs.action` là `text` **không CHECK**; `object_type='auth'` đã trong UNION.
- Không có bề mặt sinh-hàng do kẻ tấn công điều khiển: nhánh chỉ tới được khi **trúng race** (khác
  `resetPassword` — đường công khai, phải cần trần "1 lần/token"). Lý do buộc #480 phải cẩn thận **không
  tồn tại ở đây**.
- FK an toàn: `audit_logs.actor_user_id → users.id`; soft-delete **giữ hàng**, hard-delete bị BẤT BIẾN #2 cấm.
- **`return` chứ KHÔNG `throw` trong tx** — mirror `:1610-1612`: ném trong tx là rollback nuốt luôn vết.

**D3 — Mã lỗi: `401 UnauthorizedException("Phiên đăng nhập không còn hợp lệ.")`.**
- Giữ **nguyên hình dạng HTTP** (401 như nhánh hỏng còn lại) ⇒ không đẻ status mới.
- **KHÔNG** tái dùng "Mật khẩu hiện tại không đúng" — sai sự thật (người dùng nhập ĐÚNG mật khẩu).
- **CỐ Ý không đẻ mã lỗi `AUTH-ERR-XXX` mới** (SPEC-01 §9): nhánh hiện tại ném `UnauthorizedException(string)`
  trần; giữ đúng hình dạng đó. Đã kiểm: không spec nào ghim chuỗi "Mật khẩu hiện tại không đúng." ⇒ 0 hồi quy.
- Không có rủi ro oracle: người gọi đã xác thực **chính họ**.

**D4 — Nhánh 0-hàng KHÔNG phạt** (không `recordFailure`, không `recordReauthFailure`): người dùng đưa
đúng mật khẩu, hỏng là do trạng thái đổi phía server. Phạt = phạt oan + đẻ `REAUTH_FAILED` sai nhãn.
- **Vì sao không mở đường DoS** — ⚠️ **v3 thay tiền đề**: KHÔNG phải "nhánh này không lặp lại được"
  (v2 nói vậy, `security-reviewer` bác đúng — xem §1). Lý do THẬT: đường **thành công** ngay dưới cũng
  chỉ gọi `reset(rlKey)`, nên một người dùng đã xác thực vốn ĐÃ đốt được **2× argon2id 19 MiB**/lượt
  không giới hạn ⇒ nhánh mới **không thêm chút khuếch đại nào**. Hệ quả cho người sau: nếu bịt trần cho
  đường thành công thì phải bịt **CẢ** nhánh này.

### 4.1 Sửa gì

```ts
type ChangePwOutcome = "ok" | "bad_credentials" | "account_gone";
```

| Nhánh | Trước | Sau |
| --- | --- | --- |
| `!row` (SELECT 0 hàng) | `false` | `"bad_credentials"` — **hành vi y hệt** (D1) |
| `!verified` | `false` | `"bad_credentials"` — y hệt |
| UPDATE khớp 0 hàng | *(không tồn tại — ghi mù)* | `"account_gone"` + 1 hàng audit — **MỚI** |
| thành công | `true` | `"ok"` |

```ts
const [updated] = await tx
  .update(users)
  .set({ passwordHash: newHash, updatedAt: new Date(), mustChangePassword: false })
  .where(and(
    eq(users.id, user.id),
    eq(users.companyId, user.companyId),   // BẤT BIẾN #1 tường minh (mirror #480:1571)
    isNull(users.deletedAt),               // ⟵ VẾ CHỐT
  ))
  .returning({ id: users.id });
if (!updated) {
  await this.audit.record(tx, {
    action: "auth.password_change_denied",
    objectType: "auth",
    actorUserId: user.id,
    objectId: user.id,
    after: { reason: "user_gone_between_read_and_write" },
  });
  return "account_gone";                   // return, KHÔNG throw ⇒ tx COMMIT giữ vết
}
```

Xử outcome **sau** `withTenant`: `account_gone` → throw 401 (D3) **không phạt** (D4); `bad_credentials`
→ nguyên xi khối `:788-792`; `ok` → `rateLimiter.reset(rlKey)`.

**KHÔNG đụng:** `auth.controller.ts` · FE · contracts · migration · `resetPassword` · nhánh `!row` ·
`user_security_events.event_type` (union ĐÓNG — cố ý không đẻ giá trị mới).

**§tenant — `eq(users.companyId, …)` là defense-in-depth, CỐ Ý KHÔNG testable.** Dưới N=1 + FORCE RLS
(`withTenant` set GUC = `user.companyId`, `db.service.ts:87-89`; policy `users` là
`company_id = current_setting(...)`) không dựng được ca làm vế này bật. Đã kiểm **không ca hợp lệ nào bị
chặn oan**: `req.user.companyId` = `claims.companyId` (`jwt-auth.guard.ts:76`); token `aud=operator`
không vào được route này (`expectedAudience='tenant'`, :69-73 ⇒ 401 ngay ở guard); PAT lấy companyId từ
key. **Đừng viết test giả để "phủ" vế này.**

---

## 5. Test (RED trước)

### 5.1 Unit — `apps/api/src/auth/auth.service.spec.ts` (xử KẾT QUẢ 0 hàng)

Tái dùng harness `makeChangePwTx()` (`:323-341`), **tham số hoá CẢ `limit` LẪN `returning`** — mỗi ca
một builder riêng, không dùng chung một builder cho hai ý nghĩa
(memory `same-builder-twice-makes-unit-spec-vacuous`).

- 🔴 `returning → []` ⇒ **ném** `UnauthorizedException`, message **≠** "Mật khẩu hiện tại không đúng.",
  **KHÔNG** `audit.record({action:"auth.password_changed"})`, **CÓ** `audit.record({action:"auth.password_change_denied"})`,
  **KHÔNG** `rateLimiter.recordFailure`, **KHÔNG** `rateLimiter.reset`.
  *(Assert `reset` không được gọi là bắt buộc: nếu ai dời `reset(rlKey)` lên trên hai câu throw, khoá
  đang sống bị gỡ trong im lặng và không test nào bắt.)*
  *(Trước vá: `resolves.toBeUndefined()` ⇒ đỏ.)*
- 🟢 đối chứng DƯƠNG: `returning → [{id}]` ⇒ resolves + `auth.password_changed` + `reset` được gọi.
- 🟢 neo D1: `limit → []` (`!row`) ⇒ vẫn 401 **"Mật khẩu hiện tại không đúng."** + `recordFailure` được gọi.

`this.logger` là field khởi tạo inline (`:174`) nên an toàn với `new Ctor(...)`; bản vá **không thêm lời
gọi `this.<dep>` mới nào** trên nhánh mà các spec dựng bằng `Object.create(prototype)` chạm tới
(`forgot-password-rate-limit.spec.ts` — chỉ chạy `forgotPassword`).

### 5.2 Int-spec — `apps/api/test/integration/auth-s18-changepwtoctou-1.int-spec.ts`

`app.listen(0)` bắt buộc (memory `supertest-closes-shared-server-on-first-response`).

- **§allow** (🟢 đối chứng DƯƠNG, HTTP thật): user sống đổi mật khẩu ⇒ 200, hash **đổi**,
  `must_change_password=false`, refresh token cũ bị thu hồi.
- **§race** (🔴 ĐỎ trước vá — **bài load-bearing**):
  1. seed user với `must_change_password=true`; **login THẬT** để có ≥1 `refresh_tokens` + ≥1
     `user_sessions` còn sống *(thiếu bước này thì assert "không bị thu hồi" là **xanh-RỖNG**: 0 hàng
     thì đúng một cách trống rỗng cả trước lẫn sau vá)*;
  2. soft-delete hàng `users`;
  3. `spyOn(dbsvc,'withTenant')` **bọc CALL-THROUGH**: `(cid, fn) => orig(cid, tx => fn(proxy(tx)))` —
     **KHÔNG** tự mở `db.transaction()` (không có GUC ⇒ FORCE RLS trả 0 hàng ⇒ UPDATE khớp 0 hàng vì lý
     do SAI ⇒ bài xanh mà chứng minh sai thứ);
  4. `proxy` chặn **đúng một** câu `select(...).from(users)` đầu tiên, trả `[{passwordHash: <hash thật>}]`;
     **mọi lệnh khác forward sang tx THẬT**; assert `intercepted === 1` *(ai thêm một select sớm hơn sau
     này sẽ khiến proxy chặn NHẦM câu khác trong im lặng)*;
  5. `mockRestore()` trong `finally` — `dbsvc` là singleton dùng chung với §allow/§reachable, và nếu bản
     vá sai rơi vào `bad_credentials` thì `recordReauthFailure` (`:2023`) mở một `withTenant` **thứ hai**.

  Khẳng định: ném **401** message mới · `password_hash` **KHÔNG đổi** · `must_change_password` **vẫn true** ·
  `audit_logs.action='auth.password_changed'` = **0** hàng · `audit_logs.action='auth.password_change_denied'`
  = **đúng 1** hàng · `user_security_events.event_type='PASSWORD_CHANGED'` = **0** *(vế mạnh nhất chứng
  minh `return` đứng TRƯỚC `securityEvents.record` `:780-784`)* · `REAUTH_FAILED` = **0** (D4) ·
  `refresh_tokens.revoked_at IS NULL` · `user_sessions.revoked_at IS NULL`.
  *(Đột biến kiểm chứng khi RED: bỏ `isNull` khỏi câu UPDATE ⇒ §race phải đỏ lại.)*
- **§reachable** (🟢 neo hành vi cũ, KHÔNG proxy): user xoá mềm gọi thẳng service ⇒ 401 "Mật khẩu hiện
  tại không đúng." + hash không đổi. Docblock ghi rõ **`// Ca này XANH cả TRƯỚC lẫn SAU bản vá`** — nó
  được quyết bởi câu SELECT, KHÔNG phải bởi vế mới (§2b), để không ai đọc kết quả xanh thành bằng chứng.

### 5.3 Cổng + bề mặt hồi quy phải chạy lại

- `bash harness/check.sh --all --lane-db=s18chgpw` XANH.
- `pnpm --filter @mediaos/api test:cov:sensitive` dưới `LANE_DB` (`vitest.config.ts:195-200` khoá
  `src/auth/auth.service.ts` ≥80% mọi trục). **KHÔNG** thêm int-spec mới vào script đó — `apps/api/package.json`
  không nằm trong `paths` của WO (`guard-scope` sẽ kêu); hai nhánh mới đã được unit spec phủ.
- Int-spec gọi **thẳng** `changePassword` (bề mặt hồi quy, phải xanh):
  `account-self-service.int-spec.ts:113,127,145,153,175,178,193,206` · `auth-coverage.int-spec.ts:128` ·
  `security-event-emit-sites.int-spec.ts:200` (`expectExactEvents(["PASSWORD_CHANGED"])` — **rất giòn**) ·
  `security-event-writer.int-spec.ts:276` · `foundation-seed3-must-change-password.int-spec.ts`.

---

## 6. File đụng tới · rollback

| File | Việc |
| --- | --- |
| `apps/api/src/auth/auth.service.ts` | tri-state outcome + `WHERE` 3 vế + `.returning()` + nhánh `account_gone` + audit denied |
| `apps/api/src/auth/auth.service.spec.ts` | 3 ca §5.1 (chain stub tham số hoá `limit` + `returning`) |
| `apps/api/test/integration/auth-s18-changepwtoctou-1.int-spec.ts` | MỚI — 3 ca §5.2 |
| `docs/plans/S18-AUTH-CHANGEPWTOCTOU-1.md` | plan này |
| `harness/backlog.mjs` | đóng WO + sửa `done_when` #3 (§2b) + ghi nợ §7 |

**Rollback: SẠCH.** 0 migration · 0 contract · 0 `event_type` mới · 0 đổi hình dạng HTTP. Revert = 1
commit; nhánh mới không ghi hàng nghiệp vụ nào nên **không có gì không hoàn tác được**.

---

## 7. Nợ ghi nhận (KHÔNG vá ở WO này — seed vào `harness/backlog.mjs` cùng commit)

1. **Nhãn sai ở nhánh `!row`** (D1): tài khoản đã xoá mềm → "Mật khẩu hiện tại không đúng" + `REAUTH_FAILED`.
   Sai sự thật, nhưng vá = đổi hành vi + xoá vết đang có ⇒ WO riêng.
2. **`changePassword` không có `RequestMeta`** (D2): mọi vết của endpoint này — `auth.password_changed`
   đang có **và** `auth.password_change_denied` WO này thêm — đều thiếu `ip`/`userAgent`. **Cùng món nợ**
   `S18-AUTH-RESETMETA-1` đang mở cho `resetPassword` ⇒ **mở rộng RESETMETA phủ luôn `changePassword`**,
   không seed WO thứ ba.
3. **Ba APP_GUARD đều stateless với `users.deleted_at`** (§2a): access token của user vừa bị xoá mềm còn
   sống tới hết TTL trên **MỌI** endpoint. Đây là giá của stateless JWT — ghi lại để không ai coi WO này
   đã đóng nó.


---

## 8. FULL gate — kết quả (06/09/2026)

`security-reviewer` **PASS** · `silent-failure-hunter` **PASS** — 0 CRITICAL, 0 HIGH.

| # | Sev | Phát hiện | Xử lý |
| --- | --- | --- | --- |
| 1 | MEDIUM | Tiền đề an toàn của D4 SAI (cửa sổ không micro-giây; lặp được bởi actor thứ hai) | **NHẬN** — thay tiền đề trong code + §1 + D4. Kết luận "không phạt" giữ nguyên, lý do khác. |
| 2 | MEDIUM | `reason` là HẰNG, khẳng định nguyên nhân chưa đo, trên hàng append-only | **NHẬN** — thêm probe 1 hàng, nhãn 3 giá trị (mirror #480). int-spec assert `user_deleted`. |
| 3 | MEDIUM | Comment nói hard-delete chỉ là "chính sách" vì `mediaos_app` còn `DELETE ON users` | **BÁC** — reviewer chỉ đọc `0002:70` và bỏ sót `0467_s2_fnddb1_companies_users_revoke_delete.sql:32`. Đo DB thật: `has_table_privilege('mediaos_app','users','DELETE')` = **false**. Comment được siết lại + trích 0467 để lần sau không ai suy sai từ migration cũ (`grant-in-old-migration-is-not-current-state`). |
| 4 | MEDIUM | Không có test ghim "audit ném ⇒ fail-closed" (lệch với ca đã có của `resetPassword:1161`) | **NHẬN** — thêm ca unit đối xứng. |
| 5 | LOW | Tri-state rơi-xuống-cuối ⇒ outcome thứ tư lặng lẽ = "ok" | **NHẬN** — `assertNever`, sơ suất thành lỗi BIÊN DỊCH. |
| 6 | LOW | `apps/app` map mọi 401 → `invalidCredentials` ⇒ lợi ích D3 chỉ hiện ở console | **GHI NHẬN** — không oracle (đã kiểm: cần token của chính chủ + đúng mật khẩu; 4xx không log server). |
| 7 | LOW | spy `withTenant` là toàn cục trong cửa sổ §race ⇒ cửa flake | **NHẬN** — lọc theo `companyId` của công ty test. |
| 8 | LOW | `disableTwoFactor` KHÔNG lọc `deleted_at` ở CẢ câu SELECT — yếu hơn `changePassword` trước vá, và **đi thẳng chứ không cần race** | **NHẬN, ngoài phạm vi** — seed `S18-AUTH-2FADELETED-1` (đỏ). |

**Bản vá sau gate tự chịu gate** (`fix-commit-for-review-findings-is-itself-ungated`): sau khi sửa 5
mục trên, đột biến bỏ `isNull` khỏi câu UPDATE được chạy LẠI ⇒ vẫn **2 ĐỎ** (unit predicate + int
§race). Cổng không bị bản vá làm cùn.
