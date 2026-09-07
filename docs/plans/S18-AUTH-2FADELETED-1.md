# S18-AUTH-2FADELETED-1 — `disableTwoFactor` tắt được 2FA của tài khoản đã XOÁ MỀM

> WO đỏ (AUTH). Seed bởi `silent-failure-hunter` ở FULL gate của `S18-AUTH-CHANGEPWTOCTOU-1` (mục #8).
> Cùng lớp lỗi "ghi lên hàng đã xoá mềm" mà `#480` (reset) và `#482` (change) đã đóng ở hai đường kia.
> **Đọc `docs/plans/S18-AUTH-CHANGEPWTOCTOU-1.md` trước** — nhưng xem §3.0 D1: WO này **KHÔNG** mirror
> được D1 của `#482`, vì tiền đề của nó không đúng ở đây.
>
> **v2 (07/09/2026)** — sau `plan-reviewer` **BLOCK** (9 mục). Đổi thực chất: D1 viết lại hoàn toàn
> (§3.0), nhánh `!alive` của (B) giữ hợp đồng no-op thay vì ném (§3.0 D3), toàn bộ §5 dựng lại vì bộ ca
> v1 **không cô lập được vế nào**. Mục v1 sai đã giữ lại dưới dạng ghi chú "❌ v1" để không ai khôi phục.

---

## 1. Lỗ (đã xác minh trên code, 07/09/2026)

`AuthService.disableTwoFactor` (`apps/api/src/auth/auth.service.ts:697-727`) có **HAI** khiếm khuyết
độc lập; bản vá phải đóng **cả hai**.

**(L1) Câu SELECT re-auth không lọc `deleted_at`** — `:712-716` (`withTenant` mở ở `:711`):

```ts
const [row] = await tx
  .select({ passwordHash: users.passwordHash })
  .from(users)
  .where(eq(users.id, user.id))   // ⟵ KHÔNG có isNull(users.deletedAt), KHÔNG có company_id tường minh
  .limit(1);
```

Yếu hơn hiện trạng **trước** vá của `changePassword`: ở đó vế `deleted_at IS NULL` ít nhất còn ở câu
SELECT (đường đi-thẳng đã bị chặn, chỉ còn khe race). Ở đây **không có vế đó ở đâu cả** ⇒ hôm nay
tài khoản đã xoá mềm đưa **đúng** mật khẩu thì **TẮT ĐƯỢC 2FA và trả 200**.

**(L2) Lệnh GHI nằm NGOÀI phép kiểm** — `:726`:

```ts
await this.twoFactor.disable(user.id, user.companyId);   // withTenant/tx RIÊNG, sau khi tx re-auth đã COMMIT
```

`TwoFactorService.disable` (`two-factor.service.ts:273-301`) mở **tx của chính nó** và **hard-delete**
`user_totp` + `user_recovery_codes`, không lọc `deleted_at`. ⇒ kể cả khi L1 được vá, một `soft-delete`
commit **xen giữa** hai tx vẫn xoá được 2FA của hàng đã xoá.

### 1a. Đường tới được — ĐI THẲNG, không cần trúng race

Ba `APP_GUARD` đều **stateless với `users.deleted_at`** (đo ở `S18-AUTH-CHANGEPWTOCTOU-1` §2a). ⇒ user
vừa bị xoá mềm mà access token còn trong TTL gọi thẳng `POST /auth/2fa/disable` được.

### 1b. Vì sao KHÔNG phải "dữ liệu chết" — owner đã chốt 07/09

`AuthUsersService.restoreUser` (`apps/api/src/users/auth-users.service.ts:580-613`) khôi phục hàng và
**KHÔNG đụng trạng thái 2FA**; `disable()` thì **hard-delete** (không phục hồi được). ⇒ tài khoản khôi
phục **quay lại với 2FA đã TẮT**, không ai duyệt.

**Owner chốt phạm vi (07/09): chỉ đường GHI.** Siết L1 + L2. `restoreUser` ⇒ WO riêng (§7.1).

> **Không có backfill.** Tài khoản đã bị tắt 2FA **trước** bản vá không được khôi phục, và vì
> `user_totp` bị hard-delete nên **không đo được** đã mất bao nhiêu bản ghi. WO này chặn đường, không
> sửa quá khứ.

---

## 2. Đo TRƯỚC khi sửa

### 2a. Ai gọi `twoFactor.disable()`?

`apps/api/src/auth/auth.service.ts:726` là caller **sản phẩm** duy nhất. Nhưng **có caller TEST**:
`apps/api/test/integration/two-factor.int-spec.ts:309` — và nó ghim một **hợp đồng**, không phải chi
tiết (§2e). ⚠️ v1 viết "DUY NHẤT (ngoài spec)" rồi gạt spec đi — đó là cách bỏ sót hợp đồng.

### 2b. ⚠️ Rủi ro TRUNG TÂM: vá xong thì cổng CHỒNG NHAU ⇒ deny-spec xanh RỖNG

Sau vá, "user xoá mềm gọi `/auth/2fa/disable`" bị chặn bởi **CẢ HAI** L1 và L2 ⇒ một ca HTTP đơn lẻ
xanh y hệt nhau dù chỉ một vế được vá (`overdetermined-gate-makes-deny-spec-vacuous`). Cổng phải đột
biến **TỪNG VẾ** — và điều đó đòi mỗi vế có **chữ ký quan sát được RIÊNG** (§3.0 D1 là thứ tạo ra chữ
ký cho L1; không có nó thì L1 **không đo được** — xem ❌ v1 dưới §5.4).

### 2c. Thứ tự lệnh — "trả sớm" có an toàn không?

Trước câu SELECT re-auth chỉ có `requiresTwoFactor` (đọc) và `isLocked` (đọc). `recordFailure`/`reset`
ghi **Valkey**, không phải DB ⇒ trong tx re-auth, **không có lệnh ghi DB nào** trước điểm chèn của (A).

Trong `disable()`, `requiresTwoFactorTx` (fail-closed 409) đứng **đầu tx trước mọi delete/audit**; vế
mới phải nằm **ngay sau nó**, trước `tx.delete` đầu tiên — để 409 `TWO_FACTOR_ENFORCED` vẫn thắng.

### 2d. `requiresTwoFactorTx` có cần siết không? — KHÔNG

Với hàng đã xoá mềm, cờ vẫn đọc được ⇒ cổng fail-closed vẫn chặn đúng. Siết `deleted_at` ở đây sẽ
**nới** (user xoá mềm hoá ra "không bị ép" ⇒ đi tiếp) — sai hướng. Giữ nguyên.

### 2e. Hợp đồng cross-tenant của `disable()` — ĐANG được ghim, không được phá

`two-factor.int-spec.ts:302-313` ca **(f)**:

```ts
await svc.disable(uPerUser, D.companyId);                    // no-op, KHÔNG ném
expect(await svc.isEnabled(uPerUser, C.companyId)).toBe(true);
expect(await countSecEvent(uPerUser, "TOTP_DISABLED")).toBe(0);
```

Gọi `disable()` với `companyId` **khác** tenant của user: RLS ẩn hàng ⇒ `requiresTwoFactorTx` = false
(không 409), `delete` khớp 0 hàng ⇒ **no-op im lặng**. Đó là hợp đồng hiện hành. ⇒ (B) **không được**
biến `!alive` thành 401 (v1 định làm — sẽ làm ĐỎ ca (f)).

### 2f. Audit không được gán danh tính XUYÊN tenant

`apps/api/migrations/0003_audit_outbox.sql:9-11`: `audit_logs.company_id` lấy từ
`app.current_company_id`, còn `actor_user_id` FK về `users(id)` **không composite tenant**. ⇒ ghi audit
ở nhánh "hàng không nhìn thấy được" sẽ commit một hàng **append-only** (BẤT BIẾN #2, không sửa/xoá
được) gán `company_id = D` cho `actor_user_id = user của C`. Đây là `rls-makes-cross-tenant-look-
nonexistent-in-audit-labels` ở mức **quy gán**, không chỉ **nhãn**. ⇒ §3.0 D3.

### 2g. Không cần migration — đã xác minh

`'auth'` có trong CHECK `object_types` (`apps/api/migrations/0011_audit_object_types.sql:12`) và
`audit_logs.action` là `text` trần (`0003_audit_outbox.sql:12`) ⇒ action mới **không** cần migration.

---

## 3. Thiết kế bản vá

### 3.0 Quyết định

**D1 — `!row` giữ 401 + phạt rate-limit, NHƯNG phải THÊM vết bền `auth.2fa_disable_denied`.**

❌ **v1 sai**: chép nguyên lý do của `#482` D1 ("đổi nhánh này = XOÁ vết `REAUTH_FAILED` đang có").
Ở `#482` đúng, vì câu SELECT `:753` **đã có** `isNull(users.deletedAt)` từ trước ⇒ user xoá mềm **thật
sự** rơi vào `!row` và **thật sự** để lại vết. Ở đây câu SELECT `:715` là `eq(users.id, …)` **trần** ⇒
hôm nay user xoá mềm **KHÔNG hề đi vào `!row`**: SELECT trả hàng, verify đúng, 2FA bị tắt, và vết duy
nhất là `auth.2fa_disabled` — vết của một **thành công**.

⇒ WO này **không bảo tồn** vết nào; nó **TẠO MỚI** một phân loại. Nếu chỉ đổi predicate rồi để
`return false`, đường tấn công **CHÍNH** (đi thẳng, §1a) kết thúc **không có tín hiệu bền nào** nói
rằng token của một tài khoản đã xoá vừa được dùng — trong khi đường **phụ** (chỉ trúng race, L2) lại
được audit. Quan sát bị **đảo ngược**.

Chốt:
- **Giữ** hình 401 `"Mật khẩu không đúng."` + `recordFailure` + `recordReauthFailure('2fa_disable')`.
  Không đẻ status/mã lỗi mới, và giữ waiver của ratchet
  `apps/api/test/foundation/login-log-429-ratchet.unit-spec.ts:42,150` (waiver chỉ đứng được khi nhánh
  sai còn ghi vết).
- **Thêm** `auth.2fa_disable_denied` ghi **trong cùng tx** ngay trước `return false`. An toàn quy gán:
  `user` ở đây là `req.user` (`auth.controller.ts:250-256`) ⇒ `id`/`companyId` **luôn của chính người
  gọi**, không bao giờ cross-tenant (khác (B) — xem D3).
- Nợ "nhãn sai" (nói "mật khẩu không đúng" cho người đưa **đúng** mật khẩu) vẫn là nợ, ghi ở §7.3.

**D2 — L2 đóng bằng cách siết BÊN TRONG `disable()`, không kéo re-auth vào tx của nó.**
`disable()` có 1 caller sản phẩm (§2a) ⇒ siết tại chỗ là nhỏ nhất. Kéo re-auth (có `password.verify` =
argon2id 19 MiB) vào trong tx sẽ giữ tx mở hàng chục–hàng trăm ms — xấu cho PgBouncer transaction-mode.
_(`done_when` #3 của WO cho hai lựa chọn; đây là nhánh đã chọn — ghi lại vào WO cùng commit.)_

**D3 — (B) phân biệt HAI sub-case; chỉ ném khi hàng NHÌN THẤY ĐƯỢC và ĐÃ XOÁ.**

| Sub-case | Nghĩa | Xử lý |
| --- | --- | --- |
| hàng **thấy** + `deleted_at != null` | đúng tenant, đã xoá mềm ⇒ **race** L2 | audit `auth.2fa_disable_denied` (`reason: "user_deleted"`) → `return "account_gone"` → ném 401 **NGOÀI** tx |
| hàng **không thấy** (`!alive`) | RLS ẩn ⇒ cross-tenant/hàng biến mất | **no-op im lặng, KHÔNG audit, KHÔNG ném** — giữ nguyên hợp đồng §2e |

❌ **v1 sai**: gộp `!alive` vào nhánh ném + audit `reason: "user_not_visible"`. Hai hậu quả: làm **ĐỎ**
ca (f) đang xanh (§2e), và ghi hàng audit gán chéo tenant vào bảng append-only (§2f). Nhánh `!alive`
giữ im lặng **không** phải fail-open: hôm nay nó đã là no-op (delete khớp 0 hàng do RLS), nên bản vá
**không đổi gì** ở đó. Nhãn `user_not_visible` bị **bỏ hẳn** khỏi WO này.

> Vì `users` không bao giờ bị hard-delete (`REVOKE DELETE`, `0467:32` — đo lại ở `#482`), `!alive` với
> **đúng** tenant là bất khả thi trên thực tế. Đường thật của `!alive` = gọi chéo tenant.

**D4 — audit ghi trong tx rồi ném NGOÀI `withTenant`.** Ném *trong* tx = rollback nuốt luôn vết. Mirror
mẫu đã ship và đã qua gate ở `auth.service.ts:826-829`.

**D5 — tri-state tường minh.** Callback `withTenant` của `disable()` hiện **không return gì**. Phải khai
báo union `"ok" | "account_gone"`, có `return "ok" as const` ở cuối, và `assertNever` ở nhánh rơi-xuống
(mirror #5 của gate `#482`) — nếu không, union thật là `… | undefined` và `assertNever` **không biên
dịch được**.

**D6 — chuỗi 401 của D3 phải KHÁC chuỗi của D1.** Ghim: `"Phiên đăng nhập không còn hợp lệ."` (đúng
chuỗi `#482` dùng cho `account_gone`). **Không** tái dùng `"Mật khẩu không đúng."` — vừa sai sự thật,
vừa làm §direct hết phân biệt được L1 với L2 (§5.4).

### 3.1 Sửa gì — chính xác

**(A) `apps/api/src/auth/auth.service.ts:712-717`**

```ts
const [row] = await tx.select({ passwordHash: users.passwordHash }).from(users)
  .where(and(
    eq(users.id, user.id),
    eq(users.companyId, user.companyId),   // BẤT BIẾN #1 tường minh (mirror #480/#482)
    isNull(users.deletedAt),               // VẾ CHỐT — đóng đường ĐI THẲNG §1a
  )).limit(1);
if (!row) {
  // D1: probe ĐO nguyên nhân (không khẳng định thứ chưa đo — mirror gate #482 #2)
  const [probe] = await tx.select({ deletedAt: users.deletedAt }).from(users)
    .where(eq(users.id, user.id)).limit(1);
  await this.audit.record(tx, {
    action: "auth.2fa_disable_denied", objectType: "auth",
    actorUserId: user.id, objectId: user.id,
    after: { reason: !probe ? "user_absent" : probe.deletedAt ? "user_deleted" : "state_changed" },
  });
  return false;   // → nhánh !ok: 401 "Mật khẩu không đúng." + phạt (D1)
}
return this.password.verify(row.passwordHash, password);
```

**(B) `apps/api/src/auth/two-factor.service.ts:273-301`** — sau `requiresTwoFactorTx`, trước `tx.delete`:

```ts
const [alive] = await tx.select({ deletedAt: users.deletedAt }).from(users)
  .where(eq(users.id, userId)).limit(1);
if (alive && alive.deletedAt != null) {          // D3: CHỈ khi thấy được VÀ đã xoá
  await this.audit.record(tx, {
    action: "auth.2fa_disable_denied", objectType: "auth",
    actorUserId: userId, objectId: userId, after: { reason: "user_deleted" },
  });
  return "account_gone" as const;
}
// `!alive` rơi xuống đây: no-op im lặng như cũ (§2e) — delete khớp 0 hàng do RLS.
```

Chữ ký public `disable(userId, companyId): Promise<void>` **giữ nguyên**; ném `UnauthorizedException`
(D6) ngoài `withTenant` khi `account_gone`. ⇒ controller/caller không đổi.

---

## 4. Cái bẫy trung tâm

Thêm predicate mà **không xử kết quả** ⇒ 0 hàng khớp ⇒ hàm vẫn "thành công" ⇒ 200 mà 2FA không đổi.
Nhánh ném thì siết + để vết; nhánh "thành công mà rỗng" thì nới + im lặng
(`empty-success-is-the-fail-open-shape`). (A) xử qua nhánh `!row` + audit; (B) qua D3/D5.

---

## 5. Test (RED trước)

### 5.1 Unit — `apps/api/src/auth/auth.service.spec.ts`

Harness `:89-187` dùng chain stub **mù với `.where()`** (`:93-101`) — đã ghi ở docblock `:329`. ⇒
không thể "trả rỗng khi predicate đủ 3 vế".

1. **§predicate** (cổng đơn vị **load-bearing** của L1) — bắt đối số `.where()` của câu SELECT re-auth,
   assert **ba vế RIÊNG BIỆT**, mỗi vế một `expect` (không gộp): `users.id` · `users.company_id` ·
   `users.deleted_at`. Dùng `whereHasColumn`/`whereFiltersSoftDelete` đã có sẵn **trong chính file này**
   (`:41`) — không cần trích helper dùng chung.
   ⚠️ Cả ba phải trên **CÙNG MỘT** `where` (`same-builder-twice-makes-unit-spec-vacuous`).
2. **§denied-audit** — `!row` ⇒ `audit.record` được gọi với `action: "auth.2fa_disable_denied"`, và
   401 + `recordFailure` + `recordReauthFailure` **vẫn** xảy ra (D1 giữ hình cũ).
3. **§reason** — hai ca probe: `[{deletedAt: <Date>}]` ⇒ `"user_deleted"`; `[]` ⇒ `"user_absent"`.
   (Phủ mọi nhãn WO này ghi vào bảng append-only.)
4. **§neo-hành-vi** (❌ v1 gọi nhầm là "§outer-unit" và tính vào cổng) — user xoá mềm ⇒ 401 và
   `twoFactor.disable` **không** được gọi. **Ca này XANH cả TRƯỚC lẫn SAU vá** (stub mù `.where()` ⇒
   `limit → []` cho `!row` ở cả hai phía) ⇒ **KHÔNG** phải cổng; docblock phải nói thẳng thế, đúng mẫu
   §reachable của `#482`.
5. **§allow-unit** — **ĐÃ TỒN TẠI** ở `:175-186`; chỉ xác nhận còn xanh, **không** thêm ca trùng.

### 5.2 Unit — `apps/api/src/auth/two-factor.service.spec.ts`

⚠️ `makeTx` (`:56-105`) dispatch **chỉ theo bảng** ⇒ sau vá, `disable()` đọc `users` **hai lần**
(`requiresTwoFactorTx:96-100` rồi `alive`) và nhận **cùng** một hàng; `deletedAt === undefined` ⇒ cổng
mới **luôn cho qua** ⇒ ca mới xanh vì lý do sai. **Bắt buộc** mở rộng `makeTx`: một hàng mang **cả**
`requireTwoFactor` **và** `deletedAt` (thêm opt `userDeletedAt`, `userMissing`).

6. **§inner-unit** (cổng của L2) — `userDeletedAt: <Date>` ⇒ ném 401 D6, `calls.totpDeletes === 0`,
   `calls.recoveryDeletes === 0`, audit `auth.2fa_disable_denied` reason `user_deleted`.
7. **§inner-notvisible** (D3) — `userMissing: true` ⇒ **KHÔNG** ném, **KHÔNG** audit; giữ no-op (ghim
   hợp đồng §2e ở tầng unit, rẻ hơn int).
8. **§inner-allow** — hàng sống ⇒ xoá `user_totp` + `user_recovery_codes`, audit `auth.2fa_disabled` +
   `TOTP_DISABLED` giữ nguyên (hồi quy S2-AUTH-BE-8).
9. **§enforced-trước** — `requiresTwoFactorTx` **vẫn** chặn TRƯỚC vế mới (409, không phải 401) ⇒ thứ tự
   cổng không bị đảo (hồi quy S2-AUTH-BE-11, ca `:182-205`).
10. **§audit-fail-closed** — `audit.record` ném ⇒ trồi lên, không nuốt thành "ok" lặng lẽ (đối xứng ca
    `resetPassword:1161`, mirror #4 của gate `#482`).

### 5.3 Int-spec — `apps/api/test/integration/auth-s18-2fadeleted-1.int-spec.ts` (mới)

Khuôn từ `auth-s18-changepwtoctou-1.int-spec.ts` — nhưng file đó seed **MỘT** tenant (`:64-65`); WO này
cần **HAI** (C + D) cho §crosstenant. `app.listen(0)` bắt buộc
(`supertest-closes-shared-server-on-first-response`).

⚠️ **Thứ tự dựng bắt buộc**: user đã bật 2FA thì `POST /auth/login` trả `{twoFactorRequired,
challengeToken}` **chứ không phải access token** (`auth.service.ts:418-421`, `:479-481`). ⇒
login **khi 2FA còn TẮT** → lấy access token → `enroll` + `confirmEnable` → **rồi mới** soft-delete.
(❌ v1 viết "login → soft-delete → disable" — bất khả thi.)

- **§allow** 🟢 đối chứng DƯƠNG qua HTTP: user sống ⇒ 200, `user_totp` + `user_recovery_codes` hết hàng.
- **§direct** 🔴 **ĐỎ trước vá** — đường ĐI THẲNG §1a: soft-delete rồi gọi `/auth/2fa/disable` với
  **đúng** mật khẩu ⇒ **401**, `user_totp` **CÒN NGUYÊN**.
  ⚠️ Assert **chữ ký riêng của L1** bằng **số đếm**, nếu không ca này không cô lập được vế nào (§5.4):
  `user_security_events` `REAUTH_FAILED` = **1** · `audit_logs` `auth.2fa_disable_denied` = **1** ·
  `auth.2fa_disabled` = **0**.
- **§crosstenant** — từ tenant D gọi `disable(userOfC, D.companyId)` ⇒ **không ném**, 2FA của C còn
  nguyên, `auth.2fa_disable_denied` = **0** (ghim D3/§2e ở tầng int, chống hồi quy ca (f)).

### 5.4 Cổng nghiệm thu — đột biến TỪNG VẾ

**ĐÃ CHẠY THẬT 07/09** (không phải dự đoán) — mỗi đột biến áp riêng lên bản vá cuối rồi revert:

| Đột biến | ĐỎ ở (đo được) | XANH (đúng như mong đợi) |
| --- | --- | --- |
| xoá dòng `isNull(users.deletedAt)` khỏi (A) | **§predicate/deleted_at** (1 ca) | §predicate/company_id · §predicate/id · §denied-audit ×2 · §reason ×2 · §neo-hành-vi |
| vô hiệu hoá khối `alive` ở (B) (`if (false)`) | **§inner-unit** · **§audit-fail-closed** (2 ca) | §inner-notvisible · §enforced-trước · §inner-allow |

⚠️ **Sửa một khẳng định của chính plan này**: v2 xếp **§denied-audit** vào cổng của đột biến (A). **Đo
ra là SAI** — nó vẫn XANH. Lý do: stub đơn vị MÙ với `.where()`, nên ca đó ép `selectRows: []` để vào
nhánh `!row` **bất kể** predicate có vế `deleted_at` hay không. §denied-audit ghim *nội dung* của nhánh
`!row` (có audit, giữ 401+phạt), **không** ghim *việc user xoá mềm rơi vào nhánh đó*. Cổng thật của (A)
ở tầng đơn vị là **§predicate** — và ở tầng HTTP là **§direct** (đếm `auth.2fa_disable_denied` = 1).

Bản vá **sau** review cũng phải chạy lại hai đột biến trên
(`fix-commit-for-review-findings-is-itself-ungated`).

❌ **Bảng v1 SAI hai chỗ** — giữ lại để không ai chép lại:
- v1 xếp **§outer-unit** vào cổng: stub mù `.where()` ⇒ xanh cả trước lẫn sau vá (nay là §neo-hành-vi).
- v1 xếp **§direct** vào cổng **mà không có assert đếm**: gỡ `isNull` khỏi (A) nhưng giữ (B) ⇒ (B) ném
  401 và `user_totp` vẫn còn ⇒ §direct **vẫn xanh**. Chỉ chữ ký đếm của D1 mới tách được L1 khỏi L2.

Nếu một đột biến không làm ca nào đỏ ⇒ cổng vô dụng, quay lại §2b. Bản vá **sau** review cũng phải chạy
lại đột biến (`fix-commit-for-review-findings-is-itself-ungated`).

### 5.5 Bề mặt hồi quy phải chạy lại

`two-factor.int-spec.ts` (:126, :135, :173, :265, :279, :290, :309) · `security-event-emit-sites.int-spec.ts:364`
(`expectExactEvents` — `#482` gọi là "rất giòn") · `auth-coverage.int-spec.ts` (:219, :233, :242, :246) ·
`auth-toprisk-http.int-spec.ts` · `account-self-service.int-spec.ts:64` · `prepipe-500-surface.int-spec.ts:352` ·
`security-policy-2fa.int-spec.ts` · `two-factor-login.int-spec.ts` · `login-log-429-ratchet.unit-spec.ts` (:42, :150).

`test:cov:sensitive` (`apps/api/vitest.config.ts:192`) khoá `src/auth/auth.service.ts` ⇒ phải xanh.
**Đo xem `two-factor.service.ts` có trong danh sách không**; nếu chưa, ghi nhận chứ **không** tự thêm
ngưỡng ở WO này.

Cổng cuối: `bash harness/check.sh --all --lane-db=s18twofadel` XANH.

---

## 6. File đụng tới · rollback

| File | Đổi |
| --- | --- |
| `apps/api/src/auth/auth.service.ts` | (A) 3 vế `WHERE` + probe + audit `!row` |
| `apps/api/src/auth/two-factor.service.ts` | (B) khối `alive` + tri-state + ném ngoài tx |
| `apps/api/src/auth/auth.service.spec.ts` | ca 1–4 |
| `apps/api/src/auth/two-factor.service.spec.ts` | `makeTx` mở rộng + ca 6–10 |
| `apps/api/test/integration/two-factor.int-spec.ts` | ca (f): giữ xanh; thêm chú thích trỏ D3 |
| `apps/api/test/integration/auth-s18-2fadeleted-1.int-spec.ts` | MỚI |
| `docs/plans/…` · `harness/backlog.mjs` | plan + trạng thái + seed nợ + `paths` |

**Không migration** (§2g). **Không đổi contract/DTO/route.** Rollback = revert 1 commit.

---

## 7. Nợ ghi nhận (KHÔNG vá ở WO này — seed cùng commit)

1. **`restoreUser` không phục hồi/soát lại 2FA** (§1b) — owner chốt 07/09 là WO riêng.
   → seed `S18-AUTH-RESTORE2FA-1`.
2. **🔴 `enroll`/`confirmEnable` không lọc `deleted_at` — LỖ BẢO MẬT, không phải rác dữ liệu.**
   ❌ v1 viết "bật 2FA cho tài khoản đã xoá không phải là làm yếu đi" — **SAI** trong đúng kịch bản
   §1b: với tài khoản đã xoá mềm mà 2FA đang TẮT, người giữ access token còn hạn có thể `enroll` một
   secret **do chính họ kiểm soát** (`two-factor.service.ts:147-188`) rồi `confirmEnable` (`:191-227`);
   `restoreUser` không đụng 2FA ⇒ tài khoản khôi phục về với **yếu tố thứ hai của kẻ tấn công**.
   → gộp vào WO (1), **`zone: "red"`**.
3. **Nhãn sai ở nhánh `!row`** (D1) — nói "Mật khẩu không đúng." cho người đưa **đúng** mật khẩu. Cùng
   họ nợ đã ghi ở `S18-AUTH-CHANGEPWTOCTOU-1` §7.1; WO này thêm một đường nữa. **Mở rộng WO nhãn đang
   có, đừng seed WO thứ ba.**
4. **`disableTwoFactor` không có `RequestMeta`** ⇒ `auth.2fa_disabled` **và** `auth.2fa_disable_denied`
   đều thiếu `ip`/`userAgent` — cùng món nợ `S18-AUTH-RESETMETA-1` đang mở ⇒ **mở rộng RESETMETA phủ
   luôn đường 2FA**, không seed WO thứ tư.

---

## 8. FULL gate — kết quả (07/09/2026)

`security-reviewer` **PASS** · `silent-failure-hunter` **PASS** — **0 CRITICAL, 0 HIGH**.
`security-reviewer` chạy LẠI cả hai đột biến §5.4 trên DB thật và ra **kết quả trùng khớp** bảng đã đo
ở trên (kể cả việc §denied-audit KHÔNG đỏ) — cổng được xác nhận độc lập, không phải tự chấm.

| # | Sev | Phát hiện | Xử lý |
| --- | --- | --- | --- |
| 1 | MEDIUM | Câu SELECT `alive` ở (B) thiếu `company_id` tường minh, trong khi (A) — CÙNG commit — có. Cùng một commit nói hai giọng về BẤT BIẾN #1. | **NHẬN** — thêm `eq(users.companyId, companyId)`. Hành vi không đổi (RLS đã ép), là defence-in-depth. |
| 2 | MEDIUM | **Vế L2 ngồi lên HÌNH DẠNG của policy `users_tenant_isolation`.** Nếu migration sau siết policy đó thêm `deleted_at IS NULL`, hàng xoá mềm CÙNG tenant hoá vô hình ⇒ rơi vào `!alive` ⇒ no-op ⇒ hai câu DELETE vẫn KHỚP (policy `user_totp`/`user_recovery_codes` là company-only) ⇒ **lỗ mở lại, KHÔNG ca nào đỏ**. | **NHẬN** — thêm ca int **§rls-shape** chốt tiền đề (hàng xoá mềm cùng tenant PHẢI còn SELECT được trong `withTenant`). Biến hồi quy-âm-thầm thành test ĐỎ. |
| 3 | MEDIUM | Hai câu DELETE trong `disable()` vẫn không có `company_id` (CÓ SẴN, không do WO này đẻ). | **GHI NỢ** — gộp vào `S18-AUTH-RESTORE2FA-1` src(3). Không siết ở đây: ngoài phạm vi owner đã chốt, và đổi vế ghi của crown-jewel cần cổng riêng. |
| 4 | LOW | `state_changed` tới được (READ COMMITTED, restore chen giữa hai câu) nhưng **0 ca**; §5.1 khẳng định "phủ mọi nhãn" ⇒ **sai như đã viết**. | **NHẬN** — thêm ca thứ ba (`probeRow: [{deletedAt: null}]`). |
| 5 | LOW | Nhánh `!row` bỏ qua argon2id ⇒ nhanh hơn 401 sai-mật-khẩu thật ⇒ timing oracle. | **GHI NHẬN, không vá** — chỉ lộ cho chính chủ token về CHÍNH HỌ (`user.id`/`companyId` suy từ token), không cross-user/cross-tenant. Hình dạng này đã có sẵn ở `changePassword`. |
| 6 | LOW | `rateLimiter.reset()` chạy TRƯỚC `twoFactor.disable()` ⇒ nhánh race `account_gone` reset bộ đếm rồi mới 401. | **GHI NHẬN, không vá** — không khai thác được (đòi ĐÚNG mật khẩu + trúng race). Đổi thứ tự = đổi ngữ nghĩa rate-limit trên đường crown-jewel, cần cổng riêng. |
| 7 | LOW | `paths` liệt kê `two-factor.int-spec.ts` mà file không đổi; §6 đòi chú thích D3 ở ca (f). | **NHẬN** — thêm chú thích D3 vào ca (f) (chặn người sau "sửa" nhánh no-op). |

**Bản vá sau gate tự chịu gate** (`fix-commit-for-review-findings-is-itself-ungated`): sau khi sửa
4 mục NHẬN, **chạy LẠI cả hai đột biến** §5.4 ⇒ vẫn ĐỎ đúng chỗ (mutant A: §predicate + §direct;
mutant B: §inner-unit + §audit-fail-closed). Cổng KHÔNG bị bản vá làm cùn.

**Cổng cuối:** `bash harness/check.sh --all --lane-db=s18twofadel` ⇒ **XANH ✅** (9/9 step; `LANE_DB`
có mặt nên int-spec chạy thật, không phải "xanh không đủ bằng chứng").
