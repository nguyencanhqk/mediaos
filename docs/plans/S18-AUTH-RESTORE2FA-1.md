# S18-AUTH-RESTORE2FA-1 — Khôi phục user không soát lại 2FA + `enroll`/`confirmEnable` không lọc `deleted_at`

> WO **đỏ** (AUTH, FULL gate). Nợ defer từ `S18-AUTH-2FADELETED-1` §7.1/§7.2/§7.4 (`#483`, `2ed34586`)
> và `S18-AUTH-SECEVENTMETA-1` (`#486`). **Đọc `docs/plans/S18-AUTH-2FADELETED-1.md` §1b + §7 + §8
> trước** — bản vá dưới đây mirror khuôn của WO đó ở CÙNG file.
>
> **v2 (09/09/2026)** — sau `plan-reviewer` **BLOCK** (8 mục). Đổi thực chất: §4 D3 **bỏ hẳn**
> `TwoFactorService.resetOnRestoreTx` (dùng primitive repo đã có — B1), thứ tự set-cờ/audit viết lại
> (B2), §2 A2 ghi thẳng hệ quả cờ-dính + owner ký lại (B3), §5 dựng lại `§d2-shape`/`§A2-limit`/
> `§restore-flag` vì **không ca nào trong số đó đỏ được** (B4/B5), §4 D4/D5 chốt chữ ký + liệt kê bán
> kính (B6), thêm §6 bề mặt hồi quy/rollback (B8), `paths` mở rộng (B7). Mục v1 sai giữ dưới dạng
> "❌ v1" để không ai khôi phục.
>
> Mọi số dòng đọc trên `138d71de` (master sau khi merge `#489`) — **đã re-anchor ở v2**.

---

## 1. Lỗ — đã xác minh trên code (09/09/2026)

### 1.0 Census: những gì GHI vào `user_totp` / `user_recovery_codes` (số đo, không phải suy đoán)

| Điểm ghi | Vị trí | Lọc `deleted_at`? | Phán quyết |
| --- | --- | --- | --- |
| `TwoFactorService.enroll` | `two-factor.service.ts:142` | ❌ **KHÔNG** | 🔴 **L1** |
| `TwoFactorService.confirmEnable` | `:186` | ❌ **KHÔNG** | 🔴 **L1** |
| `TwoFactorService.disable` | `:268` | ✅ có (`#483`) | vá `company_id` → **L2** |
| `TwoFactorService.verifyChallenge` (update `used_at`) | `:353` | — | **ngoài phạm vi**: chỉ tiêu thụ mã đã có, không tạo/bật yếu tố |
| `AuthUsersRepository.deleteTwoFactorTx` (admin reset, `POST /auth/users/:id/2fa/reset`) | `auth-users.repository.ts:248` ← `auth-users.service.ts:279` | ✅ **có** — `findByIdTx` lọc `isNull(users.deletedAt)` (`repository.ts:145`) ⇒ 404 TRƯỚC mọi mutation | **không phải lỗ** |
| seed · job · migration | — | — | **0 điểm** (đã grep) |

⇒ Bề mặt cần vá đúng bằng `enroll` + `confirmEnable`. Ghi census ở đây để người sau **không phải đo lại**.

### (L1) 🔴 `enroll` + `confirmEnable` không lọc `deleted_at` — CÀI được yếu tố thứ hai

`TwoFactorService.enroll` (`two-factor.service.ts:142-183`), trong `withTenant(companyId)`:

```ts
const [existing] = await tx
  .select({ enabledAt: userTotp.enabledAt })
  .from(userTotp)
  .where(eq(userTotp.userId, userId))     // ⟵ không đụng users, không có deleted_at
  .limit(1);
if (existing?.enabledAt != null) throw new ConflictException(...);
await tx.delete(userTotp).where(eq(userTotp.userId, userId));            // :162 — cũng thiếu company_id
await tx.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));  // :163 — nt
await tx.insert(userTotp).values({ userId, ...this.toColumns(enc) });    // ⟵ GHI
```

`confirmEnable` (`:186-222`) chỉ `loadTotp(tx, userId)` rồi `UPDATE ... SET enabled_at = now()`.

**Đường đi — ĐI THẲNG, không cần trúng race.** Ba `APP_GUARD` đều stateless với `users.deleted_at`
(đo ở `S18-AUTH-CHANGEPWTOCTOU-1` §2a, tái xác nhận `#483` §1a). `deleteUser` thu hồi mọi *refresh*
token nhưng **access token là JWT stateless**, sống tới hết TTL. ⇒ kẻ giữ access token của tài khoản
vừa bị xoá mềm gọi `POST /auth/2fa/enroll` → nhận `otpauthUri` của secret **do chính họ kiểm soát** →
`POST /auth/2fa/enable` → `enabled_at != null`.

**Vì sao là lỗ, không phải rác dữ liệu:** `restoreUser` (L3) không đụng 2FA, và
`TwoFactorEnforcementGuard` chỉ ép enroll khi `!isEnabled` (`two-factor-enforcement.guard.ts:102-106`)
— hàng của kẻ tấn công **đã** enabled ⇒ guard thấy "đủ 2FA" và cho qua. Tài khoản khôi phục về với
yếu tố thứ hai của kẻ tấn công, **im lặng**.

> Plan v1 của `#483` từng viết "bật 2FA cho tài khoản đã xoá không phải là làm yếu đi" — `plan-reviewer`
> bác đúng; §7.2 plan đó đã đánh dấu `❌ v1`. **Không khôi phục lập luận ấy.**

### (L2) Bốn câu DELETE thiếu `company_id` tường minh

`disable()` `:312`, `:315` **và** `enroll()` `:162`, `:163` — cả bốn chỉ `eq(..., userId)`, dựa hoàn
toàn vào RLS. `#483` FULL gate mục #3 ghi nợ về đây (chỉ nêu hai câu của `disable`; hai câu của
`enroll` là **phát hiện thêm ở v2**, cùng file, cùng hình dạng, và `enroll` vốn đã bị sửa bởi D1).

Cả hai bảng **có** `company_id` (`db/schema/two-factor.ts:35`, `:72`) ⇒ siết trực tiếp, không cần join.
Đối chiếu: `AuthUsersRepository.deleteTwoFactorTx` (`:248-255`) — cùng thao tác, cùng repo — **đã có**
`company_id` tường minh từ đầu. Để nguyên là cùng codebase nói hai giọng về BẤT BIẾN #1.

### (L3) `restoreUser` không soát lại 2FA

`AuthUsersService.restoreUser` (`apps/api/src/users/auth-users.service.ts:618-654`) clear
`deleted_at`/`deleted_by`, giữ `status`, audit `user.restored` + `USER_RESTORED` — **không đụng**
`user_totp`/`user_recovery_codes`. Vì `disable()` **hard-delete**, mọi lần 2FA bị tắt trong lúc tài
khoản đã xoá mềm là không phục hồi được ⇒ tài khoản khôi phục về với 2FA **TẮT**.

### (L4/L5) Nợ quan sát — N1 + N2

- **N1** (`#484`): `disableTwoFactor` (`auth.service.ts:717`) **không nhận** `RequestMeta` ⇒
  `auth.2fa_disable_denied` (`auth.service.ts:776`), `auth.2fa_disable_denied`
  (`two-factor.service.ts:303`), `auth.2fa_disabled` (`:318`) đều thiếu `ip`/`userAgent`.
- **N2** (`#486`): `REAUTH_FAILED` vô danh ở **cả hai** ngữ cảnh 2FA — `2fa_disable`
  (`auth.service.ts:799`, `{}` **tường minh**, đã ghi chú "WO kia chỉ cần thay đúng token này") và
  `2fa_enable` (`two-factor.service.ts:238` là writer **RIÊNG**).

---

## 2. Quyết định owner — chốt `done_when[0]`

> **Vòng 1 (09/09):** khôi phục user thì 2FA phải (a) ép bật lại, (b) chờ duyệt, hay (c) giữ nguyên?
> → **(a) xoá sạch 2FA + ép đăng ký lại.**
>
> **Vòng 2 (09/09, sau khi `plan-reviewer` phát hiện B3):** cơ chế "ép" duy nhất không cần migration
> là `users.require_two_factor`, và cờ đó **DÍNH VĨNH VIỄN**. → **owner chốt: set cờ, CHẤP NHẬN dính.**

**A1 — xoá sạch (VÔ ĐIỀU KIỆN).** Sau restore, `user_totp` + `user_recovery_codes` của user đó **0
hàng**. Đây là vế đóng lỗ: mọi yếu tố cài trong cửa sổ đã-xoá biến mất, **kể cả khi L1 hồi quy về sau**.
Defence-in-depth **cố ý**, không phải thừa.

**A2 — set `users.require_two_factor = true` CHỈ KHI** trước lúc xoá sạch user **đang bật** 2FA
(`user_totp.enabled_at IS NOT NULL`). Hàng enroll **pending** (`enabled_at IS NULL`) **không** tính.

*Vì sao có điều kiện:* restore không được siết chính sách của user chưa từng bật 2FA.

**⚠️ HỆ QUẢ ĐÃ ĐƯỢC OWNER KÝ — phải ghi ra, không được để im lặng:**

1. `disable()` fail-closed 409 `TWO_FACTOR_ENFORCED` dựa trên `requiresTwoFactorTx`
   (`two-factor.service.ts:270-275` → `:89-96`), **bất kể** `TWO_FACTOR_ENFORCEMENT_ENABLED`. ⇒ user
   từng **tự nguyện** bật 2FA, bị xoá mềm rồi khôi phục, **vĩnh viễn mất quyền tự tắt 2FA**.
2. **Không có đường tự clear.** `confirmEnable` không clear cờ; đường gỡ **duy nhất** là admin
   `PATCH /auth/users/:id` (`auth-users.service.ts:249-254` → `updateProfileTx`).
3. Lập luận chấp nhận: tài khoản vừa khôi phục là tài khoản **rủi ro cao hơn**; chặn self-disable ở đó
   là hợp lý, và admin gỡ được nên **không phải một chiều**.
4. Ghim bằng ca `§sticky-409` (§5) + ghi vào docblock `restoreUser`. Ca đó **không** phụ thuộc env.

**⚠️ GIỚI HẠN của vế "ép enroll" — chính xác, không thổi phồng:** nhánh `roleRequired` của guard
(`two-factor-enforcement.guard.ts:94-98`) **chỉ chạy khi** `globalEnabled` —
`TWO_FACTOR_ENFORCEMENT_ENABLED === 'true'`, **đọc-và-cache lúc construct** (`:51`). Mặc định
`env.schema.ts:102` + `.env.example:136` là `'true'` ⇒ **ở PROD A2 ép enroll thật**. Nếu operator tắt
cờ global **và** `company_security_policies.two_factor_enforced` cũng tắt thì guard không ép ai — A2
khi đó chỉ còn tác dụng (1) ở trên.

> **`vitest.config.ts:26` ép `TWO_FACTOR_ENFORCEMENT_ENABLED: "false"` cho TOÀN SUITE.** ⇒ vế DƯƠNG
> của A2 **không đo được bằng int-spec**; phải neo bằng unit spec (§5 `§a2-pos-*`). Đây là lý do
> `§A2-limit` của ❌ v1 là **xanh-RỖNG**: nó "set env false" trong khi suite đã false sẵn — nó ghim
> mặc định của suite, không ghim code của WO này.

---

## 3. Phạm vi vá

| # | Vế | File | Loại |
| --- | --- | --- | --- |
| D1 | `enroll` + `confirmEnable` từ chối user đã xoá / vắng mặt | `two-factor.service.ts` | 🔴 đóng lỗ |
| D2 | **BỐN** câu DELETE (`enroll:162,163` · `disable:312,315`) mang `company_id` | `two-factor.service.ts` | defence-in-depth |
| D3 | `restoreUser` xoá sạch 2FA (A1) + set cờ có điều kiện (A2) + audit trung thực | `auth-users.service.ts` | 🔴 quyết định owner |
| D4 | N1 — `disableTwoFactor` nhận `RequestMeta`, 3 hàng audit mang ip/UA | `auth.controller.ts`, `auth.service.ts`, `two-factor.service.ts` | quan sát |
| D5 | N2 — `REAUTH_FAILED` mang ip/UA ở **cả hai** ngữ cảnh 2FA | nt | quan sát |

**KHÔNG cần migration.** `audit_logs.action` là `text NOT NULL` **không CHECK**
(`migrations/0003_audit_outbox.sql:12`) ⇒ action mới không đụng ràng buộc. `objectType` dùng lại
`"auth"`/`"user"` đã có. `users.require_two_factor` đã tồn tại (mig 0466, `db/schema/users.ts:43`).
Migration head giữ nguyên `0569`. ⇒ **`database-reviewer` không cần** ở FULL gate.

**BẤT BIẾN #2 không bị phạm:** `user_totp`/`user_recovery_codes` **không** nằm trong danh sách
append-only của `CLAUDE.md` §2.2; mig 0120 GRANT DELETE cho `mediaos_app` (docblock xác nhận tại
`auth-users.repository.ts:244-246`). D3 hard-delete **cùng lớp** với `disable()` và admin-reset đang chạy.

---

## 4. Thiết kế từng vế

### D1 — `enroll` / `confirmEnable`

Chèn phép kiểm **đầu tiên trong tx**, TRƯỚC mọi lệnh ghi:

```ts
const [alive] = await tx
  .select({ deletedAt: users.deletedAt })
  .from(users)
  .where(and(eq(users.id, userId), eq(users.companyId, companyId)))
  .limit(1);
```

**D1.a — `!alive` cũng bị TỪ CHỐI ở đây (khác `disable()`).** Trong `disable()`, `companyId` là tham
số **rời** do caller truyền ⇒ `!alive` là đường cross-tenant, hợp đồng ghim **no-op im lặng**
(`two-factor.int-spec.ts` ca (f) + chú thích D3 của `#483`). Ở `enroll`/`confirmEnable`, controller
truyền `req.user.id` + `req.user.companyId` (`auth.controller.ts:242`, `:252`) — **luôn** là chính
người gọi ⇒ không có rủi ro gán `actor_user_id` của tenant khác vào hàng audit append-only. `!alive`
ở đây nghĩa là hàng user thật sự vắng ⇒ ghi tiếp vào `user_totp` sẽ nổ FK 500. Từ chối **sạch hơn**.

Nhãn `reason` theo khuôn `disableTwoFactor:776`: `!alive → "user_absent"`, `deletedAt != null →
"user_deleted"` — không khẳng định "đã xoá" khi chỉ đo được "0 hàng"
(`rls-makes-cross-tenant-look-nonexistent-in-audit-labels`).

**D1.b — audit TRONG tx, ném NGOÀI tx.** Mirror `disable()` (`:296-306`, `:333`): ghi
`auth.2fa_enroll_denied` / `auth.2fa_enable_denied` trong tx rồi `return` sentinel;
`UnauthorizedException` ném **sau khi tx COMMIT**. Ném trong tx = rollback nuốt luôn vết.

**D1.c — KHÔNG gom vào helper dùng chung.** Ba điểm kiểm có **ba hợp đồng khác nhau** ở nhánh `!alive`
(no-op / từ chối / từ chối) + ba action audit khác nhau. Gom lại làm mù census cú pháp
`grep "2fa_.*_denied"` (`refactor-to-helper-blinds-syntax-census`) và ép ba hợp đồng vào một tham số
cấu hình (`reused-method-must-be-actor-scoped`). **Viết inline ở cả ba.**

**D1.d — `confirmEnable` trả sentinel 3 trạng thái** `"ok" | "bad_code" | "account_gone"`, không phải
boolean. Nhánh `account_gone` **KHÔNG** `recordFailure`, **KHÔNG** `recordReauthFailure` — phạt
rate-limit + đẻ `REAUTH_FAILED` cho lượt *không phải* "nhập sai mã" là **sai nhãn** (lập luận D4 ở
`auth.service.ts:946-947`). Vết bền của nhánh là `auth.2fa_enable_denied`.

> ⚠️ **Ràng buộc cứng từ ratchet** (§6): `login-log-429-ratchet.unit-spec.ts:152` assert
> `reauthFailedContexts()` **BẰNG CHÍNH XÁC** `["2fa_disable","2fa_enable","change_password"]`, và
> census gom **mọi string-literal là đối số** của `recordReauthFailure(...)`
> (`login-log-429-census.ts:385-389`). ⇒ **CẤM** thêm context mới (vd `"2fa_enroll"`) — sẽ đỏ. Truyền
> `meta` (identifier, không phải literal) thì an toàn. **CẤM** sửa WAIVERS (`:37-45`) để cho qua.

**D1.e — `encryptSecret` chạy TRƯỚC tx** (`enroll:144-149`) ⇒ nhánh từ chối vẫn tốn một lượt KMS, và
`enroll` **không có rate-limit** (khác `confirmEnable` `:187-192`) ⇒ người giữ token lặp được vòng gọi
KMS. **Không phải lỗ ghi** (0 hàng vào DB). Không đảo thứ tự ở WO này: kéo lời gọi mạng vào tx
crown-jewel là giữ connection + khoá lâu hơn. Nợ §7.2 (mô tả đúng mức, không nói nhẹ).

### D2 — bốn câu DELETE

Thêm `and(eq(..., userId), eq(...companyId, companyId))` ở `enroll:162,163` và `disable:312,315`.
Hành vi **không đổi** (RLS đã ép hôm nay); giá trị là defence-in-depth + hết "hai giọng".

> ❌ **v1 sai:** ca int "`disable()` của A không đụng hàng của B khác tenant" **không thể đỏ** —
> `uniqueIndex("user_totp_user_uq").on(t.userId)` (`db/schema/two-factor.ts:56`) là UNIQUE **toàn
> bảng** ⇒ `DELETE WHERE user_id = A` **không bao giờ** chạm hàng của B, có hay không `company_id`.
> Cổng rỗng. Xem §5 `§d2-shape` v2 (assert **cú pháp**).

### D3 — `restoreUser` (viết lại hoàn toàn ở v2)

> ❌ **v1 sai:** đề xuất thêm `TwoFactorService.resetOnRestoreTx` + inject `TwoFactorService` vào
> `AuthUsersService`. Đo lại: **không cần**. Ba primitive đã có trong **chính repo mà service đang
> cầm**, và việc chèn tham số constructor là **bẫy fail-open** — ba tham số cuối của `AuthUsersService`
> là optional (`securityEvents?:121`, `lmsSync?:125`, `rateLimiter?:133`) với cảnh báo tại chỗ
> (`:126-133`): ba spec-builder dựng service **theo VỊ TRÍ** với `as never`, nên chèn vào giữa làm
> lệch mock **đúng một ô** mà TypeScript vẫn biên dịch sạch; còn `twoFactor?` + `?.` thì D3 thành
> **no-op im lặng** trong unit-spec.

Dùng primitive có sẵn — **0 DI mới, 0 đụng constructor, 0 đụng spec-builder**:

| Việc | Primitive | Ghi chú |
| --- | --- | --- |
| `wasEnabled` | `repo.getTwoFactorStateTx(tx, id)` → `{enabled}` | `auth-users.repository.ts:217` |
| A1 xoá sạch | `repo.deleteTwoFactorTx(tx, actor.companyId, id)` | `:248` — **đã có** `company_id` tường minh |
| A2 set cờ | `repo.updateProfileTx(tx, actor.companyId, id, {requireTwoFactor:true}, actor.id)` | `:190` — trả row sau cập nhật |

Lập luận `reused-method-must-be-actor-scoped` **vẫn đúng cho `disable()`** (nó mang chính sách
self-disable: `requiresTwoFactorTx` → 409 sẽ **giết cả lệnh restore** với user bị ép 2FA) — nhưng
**không áp** cho `deleteTwoFactorTx` (data-access thuần, đúng primitive mà admin-reset dùng).

**Thứ tự BẮT BUỘC trong tx của `restoreUser`** (sửa B2 — audit không được nói dối):

```text
1. findDeletedByIdTx → before            (đã có)
2. emailExistsTx → 409                   (đã có)
3. restoreTx → restored                  (đã có, ĐÃ canh `if (!restored) throw NotFound` :635)
4. { enabled: wasEnabled } = getTwoFactorStateTx(tx, id)
5. deleteTwoFactorTx(tx, actor.companyId, id)                       ← A1
6. let finalRow = restored
   if (wasEnabled) {
     const afterRow = await updateProfileTx(..., {requireTwoFactor:true}, actor.id)   ← A2
     if (!afterRow) throw new Error("restoreUser: A2 set require_two_factor khớp 0 hàng")
     finalRow = afterRow
   }
7. audit.record  after: { ...authUserSnapshot(finalRow),
                          twoFactorReset: true, twoFactorWasEnabled: wasEnabled }
8. securityEvents USER_RESTORED          (đã có)
9. return toDto(finalRow)
```

- **Bước 6 phải TRƯỚC bước 7.** `authUserSnapshot` **có** trường `requireTwoFactor`
  (`auth-users.repository.ts:48`) ⇒ snapshot row cũ sẽ ghi `requireTwoFactor:false` trong khi DB là
  `true` — một hàng **append-only nói dối**. Dùng row trả về của `updateProfileTx` làm `after`.
- **🔴 CẤM `afterRow ?? restored`** (plan-review vòng 2, BLOCK-1). `updateProfileTx` trả
  `Promise<User | undefined>` (`auth-users.repository.ts:190-206`). Với `??`, một lượt trả `undefined`
  (0 hàng khớp) bị **nuốt lặng**: audit ghi snapshot cũ, `toDto` trả row cũ, HTTP **200**, và **A2 đã
  không xảy ra** — tài khoản khôi phục xong **không** bị ép 2FA, không tín hiệu nào. Đúng hình
  `empty-success-is-the-fail-open-shape`. Tệ hơn: `authUserSnapshot(undefined)` trả `null`
  (`:38-39`) và `{...null}` = `{}` ⇒ `after` co lại còn hai khoá 2FA, **mất sạch** snapshot user trong
  bảng append-only mà không ai đỏ.
  **Ném** ⇒ rollback cả lệnh restore (nguyên tử, fail-closed) thay vì restore-không-ép. Tiền lệ cùng
  hàm: `if (!restored) throw new NotFoundException(...)` (`auth-users.service.ts:635`).
- **`twoFactorReset: true` là HẰNG SỐ, đọc cho đúng.** `deleteTwoFactorTx` trả `void` (`:248`) ⇒ vết
  audit **không** phân biệt "đã xoá 2 hàng" với "vốn chẳng có gì". Nó nghĩa là **đã chạy bước reset**,
  KHÔNG phải **đã có gì để xoá**. Muốn số hàng thì phải đổi `deleteTwoFactorTx` — dùng chung với
  admin-reset ⇒ nợ §8.7, không làm ở đây.
- `updateProfileTx` lọc `isNull(users.deletedAt)` — chạy được vì `restoreTx` đã clear trong **cùng tx**.
- `toDto` **không** mang `requireTwoFactor` (`auth-users.service.ts:43-55`) ⇒ response admin không đổi hình.
- Không ghi audit/security-event **riêng** cho vế 2FA: `user.restored` đã là hàng của hành động này;
  thêm hàng thứ ba làm loãng vết. Trọn quyết định nằm trong `after`.
- Cùng tx với restore ⇒ **nguyên tử**: không có cửa sổ nào tài khoản sống lại mà 2FA cũ còn.
- **Không deadlock:** sau restore user đăng nhập được (2FA đã tắt) và enroll được vì
  **`AuthController` mang `@AllowWithoutTwoFactor()` cấp class** (`auth.controller.ts:56-59`). Đây là
  **điều kiện sống** của A2 — ghi ra để người sau không gỡ decorator đó.

### D4 — `RequestMeta` cho `disableTwoFactor`

| Chữ ký | Quyết định |
| --- | --- |
| `AuthService.disableTwoFactor(user, password, meta)` | **BẮT BUỘC**, không `= {}` |
| `TwoFactorService.disable(userId, companyId, meta)` | **BẮT BUỘC** |
| `TwoFactorService.confirmEnable(userId, companyId, token, meta)` | **BẮT BUỘC** |

Mirror D1 của `#484` (`auth-users.service.ts:667-672`): giá trị mặc định trong chữ ký là **vô hình**
khi review; tham số bắt buộc biến "quên truyền" thành **lỗi biên dịch**. `auth.controller.ts:252`,
`:263` truyền `this.meta(req)`. 3 hàng audit (`auth.service.ts:776`, `two-factor.service.ts:303`,
`:318`) mang `ip`/`userAgent`.

**Bán kính đã đo** (grep trên cây làm việc): **21** điểm gọi `.disable(` + **16** điểm gọi
`confirmEnable(` — gần như toàn bộ là spec: `two-factor.service.spec.ts` · `two-factor.int-spec.ts` ·
`security-event-emit-sites.int-spec.ts` · `auth-coverage.int-spec.ts` · `two-factor-login.int-spec.ts` ·
`auth-s18-2fadeleted-1.int-spec.ts`. Churn **cơ học** và **type-checker ép đủ**. Xếp D4/D5 **cuối**
(§7 thứ tự) để churn chữ ký không trộn vào commit đóng lỗ.

### D5 — `REAUTH_FAILED` mang ip/UA ở cả hai ngữ cảnh

- `auth.service.ts:799`: thay đúng token `{}` → `meta`.
- `two-factor.service.ts:238` `recordReauthFailure` nhận `meta: RequestMeta` **bắt buộc**.

**KHÔNG gộp hai writer** (WO nói "cân nhắc"). Gộp đòi (i) `TwoFactorService` gọi ngược `AuthService`
→ vòng DI giữa **hai** service crown-jewel, hoặc (ii) service thứ ba — refactor kiến trúc trên đường
đỏ, đổi lấy ~20 dòng trùng có union `context` khác nhau. Ratchet `reauthFailedWriterCount() >= 2`
(`login-log-429-ratchet.unit-spec.ts:157`) **đang ghim rằng có HAI writer** ⇒ gộp sẽ làm ratchet đỏ.
Census `grep -rn "REAUTH_FAILED"` thấy **cả hai** ⇒ trùng lặp này **quan sát được**, không phải nợ ẩn.
Nợ §7.3.

---

## 5. Bộ ca — RED trước, mỗi ca cô lập ĐÚNG một vế, mỗi ca MỘT đột biến

Int-spec: `apps/api/test/integration/auth-s18-restore2fa-1.int-spec.ts`, **đi qua HTTP thật** rồi đọc
thẳng `audit_logs` / `user_security_events` / `user_totp` / `users`. Gọi thẳng service thì spec tự
truyền meta ⇒ **xanh-RỖNG** với dây controller.

**Giàn giáo:** `asAdmin` + `POST /auth/users/:id/restore` lấy từ
`auth-s18-seceventrest-1.int-spec.ts:438`; helper `enable2fa` từ `auth-s18-2fadeleted-1.int-spec.ts:88-92`.
(❌ v1 chỉ dẫn `auth-s18-resetmeta-1` — file đó **thiếu** giàn giáo admin.)

| ID | Ca | Ghim vế | Đột biến làm nó ĐỎ |
| --- | --- | --- | --- |
| §enroll-deny | user xoá mềm + access token còn sống → `POST /2fa/enroll` = 401, `user_totp` **0 hàng**, có `auth.2fa_enroll_denied` reason=`user_deleted` | D1 | gỡ vế `deletedAt` ở `enroll` |
| §enable-deny | enroll hợp lệ **trước**, xoá mềm, rồi `POST /2fa/enable` mã **ĐÚNG** → 401, `enabled_at` vẫn NULL, có `auth.2fa_enable_denied` | D1 | gỡ vế `deletedAt` ở `confirmEnable` |
| §enable-deny-norl | ca trên **không** tăng bộ đếm rate-limit, **không** đẻ `REAUTH_FAILED` | D1.d | trả `"bad_code"` thay `"account_gone"` |
| **§allow-enroll** | **ĐỐI CHỨNG DƯƠNG** — user bình thường enroll + enable **thành công**, `enabled_at != NULL` | chống xanh-RỖNG | siết thành từ chối vô điều kiện |
| §absent-label | user bị **hard**-delete (hoặc id lạ trong tenant) → reason = `user_absent`, KHÔNG phải `user_deleted` | D1.a nhãn | dùng một nhãn cho cả hai nhánh |
| §restore-wipe | user có 2FA **bật** → xoá mềm → restore → `user_totp` + `user_recovery_codes` **0 hàng** | D3/A1 | bỏ `deleteTwoFactorTx` |
| §restore-flag | ca trên: `users.require_two_factor = true` **VÀ** `after.requireTwoFactor === true` **VÀ** `after.twoFactorWasEnabled === true` | D3/A2 + **B2** | set cờ SAU khi snapshot (audit nói dối) |
| §restore-flag-failclosed | `updateProfileTx` trả `undefined` (stub/0 hàng) → restore **rollback**, KHÔNG phải 200 | **BLOCK-1** fail-open | thay `throw` bằng `?? restored` ⇒ ca phải ĐỎ |
| §restore-noflag | user **chưa từng** bật 2FA → restore → `require_two_factor` **vẫn false** | D3/A2 điều kiện | set cờ vô điều kiện |
| §restore-pending | hàng enroll **pending** (`enabled_at IS NULL`) → restore → hàng bị xoá **nhưng** cờ **không** set | D3/A2 ranh giới | dùng "có hàng" thay "đã bật" |
| §restore-enforced | user giữ role `requires_two_factor=true` → restore **không** ném 409, vẫn xoá sạch | D3 (không tái dùng `disable()`) | gọi `disable()` thay primitive repo |
| **§sticky-409** | restore (đã set cờ) → user enroll lại → **assert `enabled_at IS NOT NULL`** → `POST /2fa/disable` = **409** `TWO_FACTOR_ENFORCED` | **§2 hệ quả owner ký** | ai đó "sửa" cho user tự tắt được |
| §meta-disable | `POST /2fa/disable` sai mật khẩu → `auth.2fa_disable_denied` **và** `REAUTH_FAILED` mang ip+UA | D4/D5 | trả `{}` lại |
| §meta-disable-ok | disable thành công → `auth.2fa_disabled` mang ip+UA | D4 | không truyền meta xuống `disable()` |
| §meta-enable | `POST /2fa/enable` mã **SAI** → `REAUTH_FAILED` (context `2fa_enable`) mang ip+UA | D5 | writer thứ hai không nhận meta |

**Unit spec** — vế mà int-spec **không đo được**:

| ID | File | Ca |
| --- | --- | --- |
| §d2-disable-shape | `two-factor.service.spec.ts` | Assert **CÚ PHÁP** hai câu DELETE của `disable()` (`:312`, `:315`), mỗi vế một `expect`, khuôn `whereHasColumn` (`auth.service.spec.ts:24-39`, dùng ở `:298`) — khuôn **đã ship và đã qua gate** cho vế (A) của `#483`. |
| §d2-enroll-shape | `two-factor.service.spec.ts` | Nt cho hai câu DELETE của `enroll()` (`:162`, `:163`) — **harness RIÊNG** (xem dưới). |

> **⚠️ Hai ca TÁCH RIÊNG vì dùng HAI harness khác nhau.** Gộp một ca thì đột biến "gỡ `company_id` ở
> `enroll:162`" không nói được nó đỏ ở đâu. Việc phải làm trước khi hai ca này chạy được:
>
> 1. **`makeTx.delete()` hiện VỨT đối số `where`** — `delete: (table) => ({ where: () => {...} })`,
>    `where` **không nhận tham số** (`two-factor.service.spec.ts:109-125`) ⇒ hôm nay bắt được **0/4**
>    câu. Phải mở rộng để capture **hai hình dạng**: `userTotp` (`.where().returning()`) và
>    `userRecoveryCodes` (`.where()` trả thẳng Promise).
> 2. **`enroll` chưa chạm tới được ở tầng unit**: `makeSvc` truyền `{} as never` cho
>    `secrets`/`totp`/`tokens` (`:153-162`) nên `enroll` nổ ngay ở `this.totp.generateSecret()`, và
>    `makeTx` **không có `insert`**. Harness mới phải mock `totp.generateSecret` · `secrets.encryptSecret`
>    · `tokens.hashToken` · `tx.insert().values()`.
> 3. **Bẫy đã ăn một lần ở `#483` §5.2**: `makeTx` dispatch **chỉ theo bảng** ⇒ khi mở rộng phải chắc
>    câu `select userTotp` (kiểm `existing`) trả đúng `[]` cho ca enroll-mới, kẻo ca xanh vì lý do sai.
| §a2-pos-flag | `two-factor.service.spec.ts:171` (mở rộng) | Cờ per-user `require_two_factor=true` ⇒ `requiresTwoFactorTx` = **true** |
| §a2-pos-guard | `two-factor-enforcement.guard.spec.ts:63` (mở rộng) | `globalEnabled='true'` + cờ bật + chưa enroll ⇒ **403** `TWO_FACTOR_SETUP_REQUIRED` |

> §a2-pos-* là **neo DƯƠNG bắt buộc** của A2: `vitest.config.ts:26` ép env `'false'` toàn suite nên
> nhánh `roleRequired` của guard **không bao giờ chạy trong int-spec** ⇒ nếu chỉ có ca deny thì cả A2
> là xanh-RỖNG (`deny-cases-vacuous-without-allow-case`).

> **Hai điều `§sticky-409` PHẢI ghi trong docblock, kẻo nó kể sai chuyện** (plan-review vòng 2):
> (i) **409 nổ TRƯỚC khi mật khẩu được đọc** — fail-fast ở `auth.service.ts:721-726`, trước cả
> rate-limit lẫn re-auth ⇒ mật khẩu SAI cũng 409. Đừng để người sau tưởng ca này chứng minh gì đó về
> re-auth. (ii) Bước "enroll lại" **phải được assert**; nếu không, enroll hỏng thì ca vẫn 409 và vẫn
> XANH, trong khi mệnh đề cần chứng minh — "user đã trở lại thế đứng bình thường mà **vẫn** không tự
> tắt được" — chưa được chứng minh.
>
> Đường đi đã lần từng chặng và **chạy được thật**: login sau restore rẽ nhánh theo *2FA đã BẬT*, không
> theo `require_two_factor` (cờ per-user chỉ là cờ tư vấn `mustSetupTwoFactor` ở `me()`,
> `auth.service.ts:1478`, `:1526`); `enroll`/`confirmEnable` **không** đọc `requiresTwoFactorTx` ⇒ cờ
> vừa set không cản enroll; `@AllowWithoutTwoFactor()` cấp class + suite ép env `'false'` ⇒ guard không cản.

**Không chép lại `§rls-shape`** — tiền đề đó đã được ghim ở `auth-s18-2fadeleted-1.int-spec.ts:201`.
**Trỏ về**, đừng tạo bản sao thứ hai (hai bản sao của cùng một tiền đề sẽ trôi).

**Cổng chồng nhau — gỡ mù:** sau D1, nhánh `enroll` của user xoá mềm bị chặn; sau D3, hàng 2FA bị xoá
khi restore. `§restore-wipe` vẫn **không** chồng cổng vì nó dựng 2FA **khi user còn sống** rồi mới
xoá mềm ⇒ D1 không can thiệp. Ghi rõ trong docblock để người sau không "tối ưu" bằng cách enroll sau
khi xoá (khi đó ca thành xanh-RỖNG — `overdetermined-gate-makes-deny-spec-vacuous`).

**Đo đột biến bắt buộc** (`fix-commit-for-review-findings-is-itself-ungated`): sau khi sửa mọi phát
hiện của FULL gate, **chạy lại toàn bộ cột "Đột biến"** — cổng không được cùn đi vì bản vá.

---

## 6. File đụng tới · bề mặt hồi quy · rollback

**Sửa:** `apps/api/src/auth/two-factor.service.ts` · `apps/api/src/auth/auth.service.ts` ·
`apps/api/src/auth/auth.controller.ts` · `apps/api/src/users/auth-users.service.ts` ·
`apps/api/src/auth/two-factor.service.spec.ts` · `apps/api/src/auth/two-factor-enforcement.guard.spec.ts` ·
`apps/api/src/users/auth-users.service.spec.ts` · `harness/backlog.mjs` · plan này.
**Thêm:** `apps/api/test/integration/auth-s18-restore2fa-1.int-spec.ts`.
**Rollback:** revert **1 commit** — không migration, không đổi schema, không đổi dữ liệu đã ghi.

**Phải chạy LẠI và còn xanh:**

| Bề mặt | Vì sao |
| --- | --- |
| `test/foundation/login-log-429-ratchet.unit-spec.ts:152,157` | assert **tập context CHÍNH XÁC** + **≥2 writer**. D1.d/D5 đều chạm. **Không được sửa WAIVERS** (`:37-45`). |
| `test/integration/two-factor.int-spec.ts` ca (f) | hợp đồng no-op của nhánh `!alive` trong `disable()` (D1.a **không** đổi nó) |
| `test/integration/auth-s18-2fadeleted-1.int-spec.ts` | `§rls-shape:201` + hai ca đột biến của `#483` |
| `test/integration/security-event-emit-sites.int-spec.ts:350,366` | census điểm phát security-event |
| `test/integration/auth-coverage.int-spec.ts:218` · `two-factor-login.int-spec.ts:112` | chữ ký `disable`/`confirmEnable` |
| `test:cov:sensitive` (`vitest.config.ts:195-200`) | khoá `src/auth/auth.service.ts` ≥80% |

---

## 7. Thứ tự thi công

1. **RED** — `§enroll-deny`, `§enable-deny`, `§restore-wipe`, `§restore-noflag` **trước**, xác nhận
   ĐỎ trên `LANE_DB=mediaos_s18restore2fa`.
2. D1 → D2 (cùng file, cùng khuôn) → GREEN hai ca đầu + `§d2-shape`.
3. D3 (primitive repo, **không** đụng constructor) → GREEN ca restore, kể cả `§restore-flag` (B2).
4. D4 → D5 (dây meta, chạm controller + ~37 điểm gọi spec) → GREEN 3 ca meta.
5. Bổ ca đối chứng dương + biên: `§allow-enroll`, `§absent-label`, `§restore-pending`,
   `§restore-enforced`, `§sticky-409`, `§a2-pos-flag`, `§a2-pos-guard`.
6. Đo đột biến toàn bảng §5.
7. `bash harness/check.sh --all --lane-db=s18restore2fa` ⇒ XANH (có `LANE_DB` ⇒ không phải
   "xanh không đủ bằng chứng").
8. FULL gate: `security-reviewer` + `silent-failure-hunter`. `database-reviewer` **không cần** (§3).

---

## 8. Nợ ghi nhận (KHÔNG vá ở WO này)

1. **Guard chỉ đọc cờ per-user khi `TWO_FACTOR_ENFORCEMENT_ENABLED='true'`** (§2). Muốn ép vô điều
   kiện thì phải đổi `TwoFactorEnforcementGuard` trên **mọi** request ⇒ WO riêng, cổng riêng, đo tải.
2. **`enroll` không rate-limit + gọi `encryptSecret` trước khi biết được phép hay không** (§4 D1.e) ⇒
   vòng lặp gọi KMS miễn phí cho người giữ token. Không phải lỗ ghi (0 hàng). Vá đòi tái cấu trúc tx.
3. **Hai writer `recordReauthFailure`** (§4 D5) — gộp đòi refactor DI giữa hai service crown-jewel, và
   sẽ làm ratchet `reauthFailedWriterCount() >= 2` đỏ.
4. **`getTwoFactorStateTx` đọc `user_totp` không có `company_id` tường minh**
   (`auth-users.repository.ts:224`). ❌ **v2 từng chốt "siết luôn" — RÚT LẠI ở v2.1** (plan-review
   vòng 2, BLOCK-2). Lý do rút: đó **không** phải "một dòng". Chữ ký hiện tại là
   `getTwoFactorStateTx(tx, userId)` — **không có** `companyId` (`:217-219`) ⇒ siết là **đổi chữ ký**,
   kéo theo caller `auth-users.service.ts:199` (`GET /auth/users/:id`) + `auth-users.repository.spec.ts:57`
   (gọi đúng 2 đối số ⇒ **đứt biên dịch**), và **0 ca đo được**: fake tx của repo-spec chỉ capture WHERE
   nhánh `userRoles` (`repository.spec.ts:42`), nhánh `userTotp` không capture ⇒ vế siết sẽ vào master
   **không có cổng nào** — đúng cái bệnh mà nó tự nhận đang đi chữa.
   **Ranh giới đã chọn:** D2 siết đường **GHI** (bốn câu DELETE, có cổng `§d2-*-shape`); đường **ĐỌC**
   giữ nguyên và ghi nợ ở đây. Đường đọc kém nhất quán hơn đường ghi, nhưng RLS vẫn ép và nó **không**
   nằm trong bề mặt lỗ của WO này.
   *Khi làm WO nợ này phải kèm:* 2 file vào danh sách sửa + 1 assert capture `userTotpWhere` +
   `whereHasColumn(..., userTotp, "company_id")` (khuôn có sẵn `repository.spec.ts:13-28`).
   *Rủi ro nếu làm ẩu:* truyền nhầm id vào chỗ companyId ⇒ `enabled:false` **im lặng** trên màn chi
   tiết user ("2FA: tắt" trong khi đang bật).
5. **Nhãn sai ở nhánh `!row` của `disableTwoFactor`** — nói "Mật khẩu không đúng." cho người đưa ĐÚNG
   mật khẩu. Nợ có sẵn từ `#482` §7.1 + `#483` §7.3 ⇒ **WO nhãn chung**, đừng seed WO thứ tư.
6. **Không backfill.** Tài khoản đã bị cài/tắt 2FA trước bản vá không được soát lại — `user_totp` bị
   hard-delete nên không đo được thiệt hại quá khứ. WO này chặn đường, không sửa quá khứ.
