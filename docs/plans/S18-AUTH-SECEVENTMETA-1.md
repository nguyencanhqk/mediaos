# S18-AUTH-SECEVENTMETA-1 — `user_security_events` của đường mật khẩu phải mang `ip`/`userAgent`

- **WO**: `S18-AUTH-SECEVENTMETA-1` · zone 🔴 red · FULL gate (auth)
- **Phụ thuộc**: `S18-AUTH-RESETMETA-1` (#484 `118a6ec4`, ĐÃ merge)
- **Nguồn**: `docs/plans/S18-AUTH-RESETMETA-1.md` §7 N2 + N3 (nợ CÓ CHỦ Ý, có chủ)
- **Lane DB**: `s18seceventmeta`
- **v2 (07/09)** — sau vòng `plan-reviewer` thứ nhất: BLOCK với 5 mục. v1 (a) bỏ sót writer
  `REAUTH_FAILED` **thứ ba** ở `two-factor.service.ts:238`, (b) để hai điểm ghi admin không có ca đo,
  (c) `paths` mù với controller + 13 điểm gọi trong spec, (d) đề một ca unit xanh-RỖNG, (e) xếp code
  trước test trên vùng đỏ. Tất cả đã xác minh lại trên master và vá ở v2.
- **v3 (07/09)** — vòng hai xác nhận 5 mục của v1 ĐÃ đóng, nhưng v2 **tự đẻ một lỗ mới** (đúng cảnh
  báo memory `plan-review-rounds-inject-new-holes`): "LUẬT VÁ" §2i nói *13 điểm đều nhận `{}`* trong
  khi §5 cần **2** trong số đó nhận meta THẬT ⇒ đọc theo nghĩa đen sẽ ghi đè chính chỗ đo, biến hai
  assert mới thành `undefined === undefined`. v3 tách danh sách 11/2, thêm ngoại lệ cùng hình dạng ở
  `auth.service.spec.ts:1574`, sửa 5 nhãn `event_type` sai ở §2e, bổ sung writer `USER_UNLOCKED` thứ
  ba (`:375`), bỏ câu biện hộ SAI của D6 (`import type` cho một **hàm**), và neo lại 4 ca kiểm.

---

## §1 — Khiếm khuyết

`S18-AUTH-RESETMETA-1` đã nối `RequestMeta` xuyên `resetPassword` / `changePassword` / hai private
`clearLoginLocksAfterReset` · `recordFailedLockClear`, và điền `ip`/`userAgent` cho **5 hàng
`audit_logs`**. Nhưng cùng những tx đó còn ghi **dual-write** sang bảng thứ hai —
`user_security_events` — và **không hàng nào** trong số đó được điền, dù:

- bảng **CÓ SẴN** cột `ip_address` / `user_agent` (`db/schema/auth-logs.ts:81-82`), và
- **cùng file đã có tiền lệ nối dây**: `refresh` (`auth.service.ts:1063-1067`),
  `forgotPasswordImpl` (`:1605-1611`), `emitAccountLocked` (`:2396-2400`) đều truyền `ip`/`userAgent`.

**Điểm ghi trong phạm vi — 9 chỗ, 2 file** (số dòng đo lại trên master hôm nay):

`apps/api/src/auth/auth.service.ts`

| # | dòng | `event_type` | method | `meta` đã trong scope? |
| --- | --- | --- | --- | --- |
| 1 | `:904` | `PASSWORD_CHANGED` | `changePassword` | ✅ (tham số, từ #484) |
| 2 | `:1784` | `PASSWORD_RESET_COMPLETED` | `resetPassword` | ✅ (tham số, từ #484) |
| 3 | `:1789` | `ALL_SESSIONS_REVOKED` | `resetPassword` | ✅ (cùng scope) |
| 4 | `:1918` | `USER_UNLOCKED` | `recordFailedLockClear` (private) | ✅ (tham số, từ #484) |
| 5 | `:2190` | `REAUTH_FAILED` | `recordReauthFailure` (private) | ❌ **KHÔNG** |

`apps/api/src/users/auth-users.service.ts` (nợ N3 của #484)

| # | dòng | hàng | method | `meta`? |
| --- | --- | --- | --- | --- |
| 6 | `:651` | audit `user.password_reset_by_admin` | `resetPassword` | ❌ |
| 7 | `:658` | `PASSWORD_RESET_BY_ADMIN` | `resetPassword` | ❌ |
| 8 | `:725` | audit `user.login_throttle_cleared` | `recordFailedLockClear` (private) | ❌ |
| 9 | `:732` | `USER_UNLOCKED` | `recordFailedLockClear` (private) | ❌ |

Hàng #5 nặng nhất: `recordReauthFailure` là **vết BỀN duy nhất** của nhánh `bad_credentials` — nơi
**kẻ chiếm phiên đang dò mật khẩu hiện tại** rơi vào, nhánh nhiều lượt nhất của `changePassword`.
Docblock của chính nó (`:2171-2182`) tự nhận nhiệm vụ đó. `actor_user_id` ở đó = **chủ tài khoản**,
không phải người bấm nút ⇒ vết **không trả lời được câu "AI"** — đúng thứ #484 sinh ra để giết, chỉ ở
bảng thứ hai.

---

## §2 — Đã đo (đừng đo lại)

**2a. Writer đã sẵn sàng — đây là việc NỐI DÂY, không đổi lược đồ.**
`SecurityEventWriter.record` đã nhận `ip?`/`userAgent?` trong `SecurityEventEntry`
(`security-event-writer.service.ts:18-19`) và map vào `ipAddress`/`userAgent` (`:76-77`).
**0 migration · 0 contracts.** DDL `migrations/0443_…:146-147` — `ip_address text`, `user_agent text`,
**không** trần độ dài, **không** CHECK ⇒ không có rủi ro 22001 (xem D2).

**2b. Bốn hàng #1–#4 KHÔNG cần đổi chữ ký.** `meta` đã trong scope nhờ #484 (`auth.service.ts:795`,
`:1670`, `:1843`, `:1901`) ⇒ mỗi chỗ đúng hai dòng.

**2c. ⚠️ `REAUTH_FAILED` có BA writer, không phải một** (v1 nói sai — plan-reviewer B3):

| writer | call-site | `context` | trong phạm vi? |
| --- | --- | --- | --- |
| `auth.service.ts:2182` | `:930` `changePassword` | `change_password` | ✅ **có** `meta` |
| ” | `:773` `disableTwoFactor` | `2fa_disable` | ❌ hàm chưa nhận `meta` — **§2d** |
| **`two-factor.service.ts:238`** (private của class KHÁC) | `:218` `confirmEnable` | `2fa_enable` | ❌ file **ngoài** `paths` — **§2d** |

Hệ quả phải nói thẳng: sau WO này `event_type='REAUTH_FAILED'` mang ip/UA khi
`context='change_password'` và NULL ở hai context kia. Chấp nhận được vì `payload.context` **phân biệt
được ba họ** ⇒ truy vấn forensics đọc được "hàng này thuộc họ chưa nối dây", không phải "không có ip".
Nợ ghi ở §7 N2 + gạch `done_when` cho WO chủ (§4.10).

Và phải sửa lời hứa của D1 cho đúng: tham số bắt buộc chỉ ép được **caller trong `AuthService`**; nó
**không** bảo vệ writer thứ ba ở class khác.

**2d. Vế 2FA ĐÃ CÓ CHỦ — không được lấy ở đây.** `S18-AUTH-RESTORE2FA-1` (`backlog.mjs:17517`) mang
`done_when` gạch 6: «`disableTwoFactor` nhận `RequestMeta` … ⇒ `auth.2fa_disabled` VÀ
`auth.2fa_disable_denied` mang `ip`+`userAgent`», và `paths` của nó **có**
`apps/api/src/auth/two-factor.service.ts` — thứ **không** nằm trong `paths` của WO này. Nối dây
`disableTwoFactor`/`confirmEnable` ở đây = **cướp phạm vi** + rủi ro xung đột nếu WO kia chạy song song
(memory `stage-head-blob-races-parallel-session`).

**2e. Census ĐẦY ĐỦ hai file** (v1 chỉ census một file và đếm sai chữ số — plan-reviewer W1):

`auth.service.ts` — **11** `securityEvents.record`: 5 trong phạm vi (§1) + 6 ngoài:
- `:1063` `REFRESH_TOKEN_REUSE_DETECTED` · `:1605` `PASSWORD_RESET_REQUESTED` · `:2396` `USER_LOCKED` —
  **đã có** ip/UA.
- `:1224` / `:1329` / `:1384` `SESSION_REVOKED` (`logout` · `revokeSession` · `revokeOtherSessions`) —
  **KHÔNG** có ip/UA, **KHÔNG** có `meta` trong scope, họ *quản lý phiên* ⇒ **nợ N1** (§7).

`auth-users.service.ts` — **8** `securityEvents?.record`: 2 trong phạm vi (`:658`, `:732`) + 6 ngoài
(nhãn ĐỌC TỪ CODE — v2 ghi nhãn theo trí nhớ và sai cả 5, plan-reviewer N-3):
- `:298` `TOTP_RESET` · `:339` `USER_LOCKED` · `:375` `USER_UNLOCKED` · `:563` `USER_DELETED` ·
  `:606` `USER_RESTORED`. Cùng lớp thiếu, nhưng mỗi cái là một endpoint riêng ⇒ **nợ N1**.
- `:466` `USER_UNLOCKED` từ `clearLoginThrottle` — **nút "Gỡ khoá đăng nhập" của admin**, chạy mỗi lần
  dùng bình thường (khác #8/#9 chỉ chạy khi Valkey `degraded`). Xử ở **§3 D7**.

⚠️ Suy ra từ census trên: `USER_UNLOCKED` có **BA** writer (`:375` `unlockUser` · `:466`
`clearLoginThrottle` · `:732` đường mật khẩu), không phải hai. Quan trọng cho D7.

**2f. `revokeAllSessionsForUserTx` KHÔNG tự ghi security-event** (`:2083-2094` — chỉ UPDATE
`user_sessions` + `realtime.severUserSessions`) ⇒ `ALL_SESSIONS_REVOKED` `:1789` là **điểm ghi duy
nhất** loại đó trong repo; `PASSWORD_CHANGED` một (`:904`); `PASSWORD_RESET_BY_ADMIN` một
(`auth-users.service.ts:658`) ⇒ khoá `rowCount === 1` hợp lệ cho cả ba.

**2g. NEO CHỐNG CHÉP NHẦM HÀNG cũng áp cho bảng này.** `forgotPasswordImpl` ghi
`PASSWORD_RESET_REQUESTED` **CÓ `ip = MINT_IP`** cho **CÙNG `user_id`** (`:1605-1611`), và bước mint
token của int-spec chạy đúng đường đó ⇒ mọi truy vấn phải lọc `event_type` **VÀ** khoá
`rowCount === 1` **VÀ** assert `ip_address !== MINT_IP` (mirror D5 của #484).

**2h. `AuthUserActor` có 15 method dùng chung** (`auth-users.service.ts:37-40`) ⇒ nhét `meta` vào
**type** đó = ripple 15 chữ ký + mọi builder trong spec cho **một** method trong phạm vi ⇒ **BÁC**.
Thêm tham số thứ ba cho riêng `resetPassword`.

**2i. Bề mặt caller của `AuthUsersService.resetPassword` — số ĐO, không ước lượng:**
- 1 controller: `auth-users.controller.ts:201-206`.
- **13** điểm trong `auth-users.service.spec.ts`: `:499, :537, :538, :543, :553, :561, :570, :578,
  :595, :608, :632, :645, :660`.
- **0** int-spec gọi thẳng — cả ba int-spec chạm route admin đều đi HTTP
  (`authusers-admin-http.int-spec.ts:256/290` · `auth-s18-resetclears-e2e.int-spec.ts:265` ·
  `auth-s18-resetdeleted-1.int-spec.ts:237`) ⇒ **không** phải sửa int-spec nào đang có.

⚠️ **LUẬT VÁ (kế thừa #484 §4.5)** — và nó **có NGOẠI LỆ, phải đọc kèm §5**:

- **11 điểm nhận `{}`**: `:499, :537, :538, :543, :553, :561, :570, :578, :595, :632, :660`.
  **CHỈ THÊM** đối số — **CẤM đổi bất kỳ assert nào đang có**. Một assert bị nới trong lượt "vá cho
  biên dịch được" là cách kinh điển để một ca đang canh gác biến thành ca xanh-rỗng.
- **2 điểm nhận meta THẬT**: `:608` (trong ca `:601` degraded) và `:645` (trong ca `:641` NÉM) —
  chúng là **chỗ đo** của #8/#9 theo §5, không phải chỗ vá.
- Ngoại lệ **cùng hình dạng ở file kia**: `auth.service.spec.ts:1574` (ca `:1565` degraded — chỗ đo
  của **#4**) nhận meta THẬT; `:1594` trong **cùng ca** là **đối chứng DƯƠNG** (`good`, không degraded,
  assert `not.toContain("USER_UNLOCKED")`) ⇒ **giữ `{}`**.

⚠️ Đây chính là chỗ v2 tự mâu thuẫn và bị BLOCK vòng 2: §4 đặt bước "vá điểm gọi" **sau** bước viết
spec, nên một câu "13 điểm đều nhận `{}`" đọc theo nghĩa đen sẽ **ghi đè meta thật** của bước trước ⇒
hai assert mới thành `undefined === undefined`. Danh sách trên là hợp đồng; **đếm lại trước khi vá**.

**2j. Hàng #4 · #8 · #9 KHÔNG tới được qua HTTP.** Chúng chỉ ghi khi `clearLoginLocks` trả `degraded`
hoặc ném (`auth.service.ts:1863`/`:1873` · `auth-users.service.ts:690`/`:699`). #484 cũng không đo
được hàng audit anh em qua HTTP. ⇒ phủ bằng **unit spec** (§5), không giả vờ phủ bằng int-spec. Ca
unit đã có sẵn để mở rộng: `auth.service.spec.ts` (đường self-service) và
`auth-users.service.spec.ts:601` («gỡ khoá degraded…») · `:641` («clearLoginLocks NÉM…»).

**2k. Ratchet tĩnh KHÔNG vỡ khi đổi chữ ký `recordReauthFailure`** (plan-reviewer đo hộ, đã xác minh):
`test/foundation/login-log-429-census.ts:385-389` chỉ gom **string literal** trong đối số, `:407-415`
chỉ khớp prop `eventType: "REAUTH_FAILED"` ⇒ thêm đối số thứ 4 và hai trường không đổi
`reauthFailedContexts()` / `reauthFailedWriterCount()` ⇒ `login-log-429-ratchet.unit-spec.ts:149-160`
giữ nguyên.

**2l. Cổng quyền của `§admin-reset`.** Cặp `reset-password:user` khai `isSensitive: true`
(`auth-users.controller.ts:198-200`) ⇒ grant wildcard **KHÔNG** thoả cổng (memory
`sensitive-pair-widget-needs-usecanexact`). Công thức đã chứng minh chạy:
`seedUserRole(direct, adminId, "00000000-0000-0000-0000-000000000001", companyId)` + login HTTP thật —
`auth-s18-resetclears-e2e.int-spec.ts:114-121` và `:264-267` (kỳ vọng 200). Dùng đúng công thức đó;
**cấm** "sửa" 403 bằng cách nới cổng.

---

## §3 — Quyết định thiết kế

### D1 — `recordReauthFailure(companyId, userId, context, meta: RequestMeta)` — **BẮT BUỘC**, call-site 2FA truyền `{}` TƯỜNG MINH

Mirror D1 của #484: **không** `meta = {}` mặc định. Mặc định làm caller-quên trở nên im lặng ở
compile-time; WO này tồn tại vì một vết im lặng.

Call-site `:773` (`disableTwoFactor`) truyền **`{}` tường minh** + comment trỏ đích danh
`S18-AUTH-RESTORE2FA-1`. Một `{}` viết ra ở call-site là thứ **grep được** và **đọc thấy khi review**;
giá trị mặc định trong chữ ký thì vô hình tại điểm gọi.

⚠️ **Phạm vi lời hứa (sửa v1 — §2c):** tham số bắt buộc chỉ ép caller **trong `AuthService`**. Writer
thứ ba (`two-factor.service.ts:238`) là private của class khác ⇒ **không** được bảo vệ. Đó là lý do
N2 phải là nợ **có chủ**, không phải một câu an ủi.

**BÁC ba phương án khác:**
- *Nối dây `disableTwoFactor`/`confirmEnable` luôn cho gọn* — §2d: cướp phạm vi WO đã seed.
- *Gộp hai writer làm một* — đúng về nguyên tắc, nhưng chạm `two-factor.service.ts` (ngoài `paths`) và
  hợp nhất hai `try/catch` best-effort có docblock riêng ⇒ việc của WO chủ, không phải của WO này.
- *`meta?: RequestMeta` optional* — hồi quy đúng cái D1 cấm.

⚠️ **Cấm `meta?.ip` ở thân hàm.** Nếu một điểm gọi lách `tsc` bằng `as unknown as` thì
`meta === undefined` ⇒ TypeError **bên trong `try`** ⇒ bị `catch` **nuốt** ⇒ vết biến mất **im lặng** —
đúng hình dạng WO này đi giết.

### D2 — Chỉ nối dây, KHÔNG đổi luồng, KHÔNG đổi hình dạng phản hồi

Chín điểm ghi thêm **đúng hai trường**. Không thêm nhánh, không `throw`, không đổi thứ tự lệnh, không
đổi `severity`, không chạm `payload`. `changePassword` giữ nguyên bộ ba nhánh và **hai câu 401 CỐ Ý
khác nhau** (`"Phiên đăng nhập không còn hợp lệ."` vs `"Mật khẩu hiện tại không đúng."`) — không gộp.
`resetPassword` là đường **CÔNG KHAI**: thêm trường vào *vết* không được đẻ oracle ở *phản hồi*.

**KHÔNG cắt độ dài** — nhưng phải nói lý do **theo từng họ**, không "mirror D2" suông (v1 chép nguyên
lập luận của #484 vốn dựa vào trần "tối đa 1 lần/token", trần đó **không** phủ hai họ mới):

| họ hàng | trần khuếch đại |
| --- | --- |
| `PASSWORD_RESET_COMPLETED` · `ALL_SESSIONS_REVOKED` | "tối đa 1 lần/token" (`auth.service.ts:1697-1702`) |
| `PASSWORD_CHANGED` · `REAUTH_FAILED` | `LOGIN_MAX_ATTEMPTS`/cửa sổ rate-limit (`:2172-2175`) |
| `PASSWORD_RESET_BY_ADMIN` · `USER_UNLOCKED` (admin) | cặp **sensitive** đã xác thực + audit |

Cộng trần header của Node, và DDL không đặt trần độ dài (§2a) ⇒ ghi thô, **thống nhất** với
`refresh`/`forgotPassword`/`emitAccountLocked` ngay cạnh. Cắt ở đây sẽ làm **lệch** với chúng.

### D3 — `payload` KHÔNG được đụng tới

Writer mask `payload` (BẤT BIẾN #3) nhưng **không** mask `ip`/`userAgent` — hai cột này ghi thô, đúng
như `audit_logs`. Nhét `ip` vào `payload` để "được mask" sẽ (a) đặt cùng một dữ kiện ở hai chỗ khác
nhau giữa các hàng, (b) làm đường đọc AUTH-API-402 không tìm thấy nó ở cột chuẩn. Dùng **cột**.

### D4 — Bằng chứng phải đi qua **HTTP THẬT**, đọc thẳng bảng bằng `directPool`

⚠️ Bẫy trung tâm, y hệt #484: khiếm khuyết nằm ở **dây nối controller→service**.
`account-self-service.int-spec.ts:113-206` gọi thẳng `auth.changePassword(...)`; một spec theo khuôn
đó **tự truyền meta** ⇒ xanh kể cả khi controller quên ⇒ **xanh-RỖNG**. Mọi ca int-spec bắt đầu từ
`supertest` + `app.listen(0)` (memory `supertest-closes-shared-server-on-first-response`), rồi
`SELECT … FROM user_security_events` qua `directPool`.

### D5 — Assert **GIÁ TRỊ**, không assert "khác null"

- `user_agent`: gửi `User-Agent` **đặc trưng theo ca** ⇒ assert **BẰNG ĐÚNG** chuỗi đó. supertest
  **không** tự gửi `User-Agent` ⇒ trước vá là NULL sạch, sau vá là giá trị của **đúng request đó**.
- `ip_address`: khớp `/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/` — `trust proxy` chỉ bật ở
  `main.ts:34`, mà int-spec dựng app bằng `Test.createTestingModule()` ⇒ **không bao giờ chạy
  `main.ts`**.
- Neo chống chép nhầm hàng (§2g): `event_type` + `rowCount === 1` + `ip_address !== MINT_IP`.

### D6 — Đường admin: tham số thứ ba, `ip` là của **ADMIN**, và helper `meta` DÙNG CHUNG

`resetPassword(actor, id, meta: RequestMeta)` (§2h — **không** nhét vào `AuthUserActor`).

⚠️ **Không nhân bản sợi dây.** `auth.controller.ts:320` đã có `private meta(req): RequestMeta`; viết
lại nguyên biểu thức đó ở controller thứ hai là tạo **hai bản sao của đúng thứ cả họ WO này bảo vệ**.
⇒ **export một helper dùng chung** cạnh `RequestMeta` trong `auth.service.ts`
(`export function requestMeta(req: { ip?: string; headers: IncomingHttpHeaders }): RequestMeta`),
`auth-users.controller.ts` import nó, và `auth.controller.ts#meta` **delegate** về nó (thân một dòng).

**Bốn phép đo trước khi chấp nhận D6** (v2 biện hộ bằng một câu SAI — "import type-only để không đẻ
phụ thuộc runtime users→auth": `requestMeta` là **hàm**, import nó **buộc** là value-import và
`import type` sẽ không biên dịch; hơn nữa cạnh runtime users→auth **đã tồn tại**
`auth-users.service.ts:28`. Câu đó đã bỏ):

1. **Không có chu trình**: `rg '\.\./users' apps/api/src/auth` → **0** kết quả; `auth.controller.ts:32`
   vốn đã value-import `AuthService` ⇒ delegate thêm **0** cạnh.
2. **Không đổi DI/module**: hàm thuần, không provider, không `UsersModule`.
3. **Không lỗi kiểu**: `tsconfig.json:16` bật `strict` nhưng **không** `exactOptionalPropertyTypes` ⇒
   `{ ip?: string; headers: IncomingHttpHeaders }` nhận express `Request` (cũng là lý do thân `meta()`
   hôm nay biên dịch được với `req.headers["user-agent"]: string | undefined`).
4. **Không vỡ test**: **không có** `auth.controller.spec.ts`; 7 điểm gọi `this.meta(req)`
   (`auth.controller.ts:80, 110, 122, 176, 188, 209, 228`) không đổi một ký tự.

⚠️ **Trong int-spec cả admin lẫn nạn nhân đều 127.0.0.1** ⇒ `ip` **không** phân biệt được ai. Thứ
chứng minh "của ADMIN" là **`user_agent` đặc trưng** của request admin, cộng `actor_user_id = admin.id`
/ `user_id = victim.id`. Ca test phải assert **cả ba**, nếu không nó chỉ chứng minh "có ghi gì đó".

`recordFailedLockClear(actor, id, meta)` của **cùng file** (private, **một** caller) nhận thêm `meta`:
để một hàng cùng chuỗi câm trong khi hàng chính có vết là để lại đúng khoảng trống WO này đi lấp.
Ripple = **0** ngoài file.

### D7 — `clearLoginThrottle` (`:449`/`:466`) **KHÔNG** kéo vào — nợ có chủ, không phải khoảng trống

Cám dỗ thật (plan-reviewer W2): sau WO, `USER_UNLOCKED` sẽ có ip/UA ở nhánh **degraded hiếm khi chạy**
(`:732`) mà vẫn NULL ở **nút admin chạy mỗi ngày** (`:466`) — nghe như incoherent.

**Vẫn BÁC, có số:** các họ **phân biệt được bằng dữ liệu**, không phải bằng phỏng đoán. Sau WO, bảng
có **BA** họ `USER_UNLOCKED` (§2e), đọc được bằng `payload.reason`:

| writer | `payload.reason` | ip/UA sau WO |
| --- | --- | --- |
| `:736` đường mật khẩu (#9) | `"password_reset"` | ✅ **có** |
| `:473` `clearLoginThrottle` | `"login_throttle"` | ❌ (N1) |
| `:379` `unlockUser` | **vắng** (payload rỗng — chính code nói vậy ở `:470`) | ❌ (N1) |

⇒ truy vấn forensics luôn đọc được "hàng này thuộc họ chưa nối dây", không bao giờ phải đoán giữa
"không ghi ip" và "không có ip".

Chi phí thật, nói cho sòng phẳng: phần controller **rẻ** (~2 dòng — route
`POST /auth/users/:id/login-throttle/clear` nằm **cùng file** WO này đã mở và đã có `@Req()`
`auth-users.controller.ts:135-142`). Giá thật là **10** điểm gọi trong `auth-users.service.spec.ts`
(`:805, :816, :825, :859, :871, :885, :895, :903, :932, :940`) + một cặp quyền khác (`unlock:user`,
không phải đường mật khẩu). Mở rộng phạm vi một WO 🔴 vì lý do thẩm mỹ là đúng cách để nó trượt khỏi
tầm kiểm soát.
⇒ **nợ N1** (§7) với dòng chỉ đích danh; owner quyết, không im lặng.

---

## §4 — Các bước (TEST TRƯỚC — cổng RED tường minh)

⚠️ Thứ tự này là bắt buộc, không phải gợi ý: CLAUDE.md §6 («Test deny-path TRƯỚC (RED)») + §9.4
(RED → GREEN → gate). v1 xếp code trước test và bị BLOCK vì đúng điều đó. Đột biến hậu-kiểm **không**
thay thế được một lượt RED có ghi chép trên code gốc.

1. **`backlog.mjs` TRƯỚC MỌI THỨ** — mở rộng `paths` để `guard-scope` + FULL gate không mù (§2i):
   thêm `apps/api/src/users/**` (phủ **cả** `auth-users.controller.ts` lẫn `auth-users.service.spec.ts`),
   `apps/api/src/auth/auth.controller.ts`, `docs/plans/S18-AUTH-SECEVENTMETA-1.md`; thêm khoá `plan:` (WO
   này thiếu; 215 WO khác trong `backlog.mjs` đã có).
   _(Ghi chú: entry `.md` là **no-op với hook** — `.claude/hooks/guard-scope.mjs:31` bỏ qua mọi
   `.md`/`.txt`. Nó ở đó cho khoá `plan:` và cho hồ sơ, không phải cho hook. `harness/handoff.md` ở
   bước 4 vì thế cũng không cần entry.)_
2. **Viết int-spec** `auth-s18-seceventmeta-1.int-spec.ts` (§5) — khuôn
   `auth-s18-resetmeta-1.int-spec.ts`.
3. **Viết/mở rộng unit spec** (§5): `auth.service.spec.ts` (#4, #5) + `auth-users.service.spec.ts:601`
   / `:641` (#8, #9).
4. **CỔNG RED** — `bash harness/check.sh --all --lane-db=s18seceventmeta`; dán **số ca đỏ THẬT** vào
   `harness/handoff.md`. Thiếu `LANE_DB` ⇒ int-spec `describe.skipIf(!hasDb)` bị SKIP im lặng ⇒
   "XANH KHÔNG ĐỦ BẰNG CHỨNG" (CLAUDE.md §9.5) — **không** được nhận là RED hợp lệ.
   ⚠️ **`typecheck` ĐỎ ở bước này là DỰ KIẾN**, không phải sự cố: spec mới gọi `resetPassword` 3 tham
   số và đọc `mock.calls[0][3]` trước khi chữ ký đổi. Bằng chứng vẫn sinh ra được — `harness/check.sh`
   không bật `set -e` (`:99-109` ghi nhận `step()` hỏng rồi ĐI TIẾP) và vitest transpile **không**
   typecheck. **Bằng chứng RED = danh sách ca vitest đỏ**, KHÔNG phải mã thoát của `check.sh`. Đừng
   "sửa" màu đỏ đó bằng cách nhảy sang bước 5 sớm — làm thế là giết chính cổng RED.
5. `auth.service.ts` — `requestMeta()` helper export (D6); `recordReauthFailure(…, meta)`; call-site
   `:930` truyền `meta`, `:773` truyền `{}` + comment; điền ip/UA cho #1–#5.
6. `auth.controller.ts` — `private meta()` delegate về `requestMeta()`.
7. `users/auth-users.service.ts` — `resetPassword(actor, id, meta)`;
   `recordFailedLockClear(actor, id, meta)`; điền ip/UA cho #6–#9.
8. `users/auth-users.controller.ts` — route `:id/password/reset` truyền `requestMeta(req)`.
9. Vá **11** điểm gọi trong `auth-users.service.spec.ts` theo **LUẬT VÁ** §2i (chỉ thêm `{}`, cấm
   đổi assert). ⚠️ `:608` và `:645` **KHÔNG** thuộc nhóm này — chúng đã nhận meta THẬT ở bước 3 và là
   chỗ đo của #8/#9; ghi đè chúng bằng `{}` là tái tạo đúng lỗ đã bị BLOCK ở vòng 2.
10. **Đột biến** (§5) → `bash harness/check.sh --all --lane-db=s18seceventmeta` XANH.
11. Đóng sổ `backlog.mjs`:
    - WO này → `done`.
    - `S18-AUTH-RESTORE2FA-1` — **ba** sửa, không phải một:
      (a) thêm gạch `done_when` phủ `REAUTH_FAILED` ở **cả hai** context 2FA (`2fa_disable`
      `auth.service.ts:773` **và** `2fa_enable` `two-factor.service.ts:246`) — gạch 6 hiện tại
      (`backlog.mjs:17546`) chỉ nói `audit_logs`;
      (b) thêm `apps/api/src/auth/auth.service.ts` vào `paths` của nó — `paths` hiện tại
      (`:17524-17531`) **thiếu** file này dù chính gạch 6 đòi `auth.2fa_disable_denied`
      (`auth.service.ts:755-763`) mang ip/UA, tức nó **phải** nối `meta` vào `disableTwoFactor` nằm ở
      đúng file đó;
      (c) thêm `"S18-AUTH-SECEVENTMETA-1"` vào `depends_on` của nó — hôm nay chỉ có
      `S18-AUTH-2FADELETED-1`, trong khi WO này đổi chữ ký `recordReauthFailure` mà nó sẽ phải dùng.
    - Seed WO cho nợ N1.

---

## §5 — Ca kiểm (RED trước)

**Int-spec `auth-s18-seceventmeta-1.int-spec.ts`** — khuôn `auth-s18-resetmeta-1.int-spec.ts`:

| ca | đường đi | hàng đo | RED trước vá vì |
| --- | --- | --- | --- |
| `§reset-ok` | POST `/auth/reset-password` (UA đặc trưng) | `PASSWORD_RESET_COMPLETED` **và** `ALL_SESSIONS_REVOKED` | cả hai `user_agent` NULL |
| `§change-ok` | POST `/auth/change-password` (UA đặc trưng) | `PASSWORD_CHANGED` | `user_agent` NULL |
| `§reauth-failed` | POST `/auth/change-password` **mật khẩu sai** ⇒ 401 | `REAUTH_FAILED` (`context='change_password'`) | `user_agent` NULL |
| `§admin-reset` | POST `/auth/users/:id/password/reset` bằng token **ADMIN** (§2l), UA đặc trưng của admin | `PASSWORD_RESET_BY_ADMIN` + audit `user.password_reset_by_admin` | `user_agent` NULL ở cả hai |

Mỗi ca: lọc `event_type` **VÀ `user_id`** (R8), khoá `rowCount === 1`, assert `user_agent` **BẰNG
ĐÚNG** chuỗi của ca, `ip_address` khớp regex loopback **VÀ** `!== MINT_IP`.

**Hai neo bắt buộc thêm:**

- **`§admin-reset` phải chứng minh "của ADMIN" bằng ĐỐI CHỨNG, không bằng sự vắng mặt.** Assert
  `actor_user_id = admin.id` + `user_id = victim.id` (D6) là chưa đủ: UA của admin chỉ "đúng" vì trong
  spec nạn nhân không hề gửi request nào — tức đang assert "vũ trụ này chỉ có một UA". ⇒ cho **nạn nhân
  đăng nhập trước bằng một `VICTIM_UA` KHÁC**, rồi assert hàng `PASSWORD_RESET_BY_ADMIN` có
  `user_agent !== VICTIM_UA`. Cùng kỷ luật với neo `MINT_IP` ở §2g.
- **`§reauth-failed` và `§change-ok` phải dùng USER KHÁC NHAU.** Hai ca chia chung bucket rate-limit
  per-user `change-pw:{companyId}|{userId}` (`auth.service.ts:795-800`) ⇒ chạy chung một user thì ca
  sau có thể ăn 429 thay vì đường đang đo (memory `per-user-rate-limit-throttles-own-int-spec`). R8
  chỉ phủ nhiễu **giữa các spec**; đây là nhiễu **trong cùng spec**.

**KHÔNG viết ca `§shape`** (v1 có): vế `bad_credentials` đã được
`auth-s18-resetmeta-1.int-spec.ts:257-279` phủ, và vế `account_gone` cần **toàn bộ** máy móc D4b của
#484 (`vi.spyOn(PasswordService,"hash")` + soft-delete qua `directPool` xen giữa) cho một bất biến
WO này **không** chạm. Một bản sao của ca đang có không phải bằng chứng mới.

**Unit spec** — cho các hàng KHÔNG tới được qua HTTP (§2j):

| ca | file | đo |
| --- | --- | --- |
| #4 `USER_UNLOCKED` self-service | `auth.service.spec.ts:1565` (ca degraded ĐÃ CÓ — mở rộng, đừng viết mới) | đổi `{}` ở `:1574` thành meta THẬT ⇒ `securityEvents.record` nhận **BẰNG ĐÚNG** `ip`/`userAgent` đó. `:1594` (nhánh `good`, đối chứng dương) **GIỮ `{}`** |
| #8 + #9 admin, degraded | `auth-users.service.spec.ts:601` (mở rộng) | `resetPassword(ACTOR, TARGET_ID, { ip: "203.0.113.11", userAgent: "unit-ua-admin-lockfail" })` ⇒ **cả** `audit.record` **và** `securityEvents.record` mang **BẰNG ĐÚNG** hai chuỗi đó |
| #8 + #9 admin, throw | `auth-users.service.spec.ts:641` (mở rộng) | như trên, nhánh `clearLoginLocks` NÉM |

⚠️ **Cấm** `expect.objectContaining({ ip: meta.ip })` với `meta = {}` — đó là assert `undefined ===
undefined`, xanh cả trước lẫn sau vá (luật #484 §5).

**Ca neo cho call-site 2FA (D1) — hình dạng LỜI GỌI, không phải giá trị.** Nhà: **`auth.service.ts`
`apps/api/src/auth/auth.service.spec.ts`** (đã nằm trong glob `apps/api/src/auth/**/*.spec.ts`), mở
rộng bộ ca `disableTwoFactor` đang có ở `:205-390` — nhánh `!ok` đã được lái sẵn ở `:312, :326, :348,
:357, :369`. Spy `recordReauthFailure`, assert đối số thứ 4 **là object**:
`typeof arg === "object" && arg !== null` (⚠️ `typeof null === "object"` — thiếu vế `!== null` thì ca
này xanh cả khi ai đó truyền `null`).
Nó **không** rỗng: hôm nay `:773` gọi 3 đối số ⇒ đối số 4 là `undefined` ⇒ **ĐỎ**; sau vá `{}` ⇒ xanh;
ngày `S18-AUTH-RESTORE2FA-1` truyền meta thật ⇒ **vẫn** là object ⇒ vẫn xanh.
⚠️ **KHÔNG** assert `ip === undefined`: ngày `S18-AUTH-RESTORE2FA-1` nối dây `disableTwoFactor`, ca đó
sẽ ĐỎ và agent kế tiếp sẽ "sửa" bằng cách revert (memory `tests-can-pin-a-hole-open` +
`noti-check-baseline-guard-must-be-forward-compatible`).
_(v1 đề ca "assert nó vẫn chạy và không ném với `{}`" — xanh cả trước lẫn sau vá, đúng hình dạng
xanh-RỖNG mà WO này tồn tại để giết. Đã bỏ.)_

**Đột biến bắt buộc trước khi gọi là xong:** gỡ `ip`/`userAgent` khỏi **từng** điểm trong 9 điểm ⇒
**phải** có ≥1 ca đỏ cho mỗi điểm. Điểm nào gỡ mà không ca nào đỏ = ca đó chưa load-bearing.

---

## §6 — Rủi ro

| # | rủi ro | xử |
| --- | --- | --- |
| R1 | Đổi chữ ký `recordReauthFailure` vỡ builder unit spec | D6 của #484 đã đo: 2 khuôn dựng (`Object.create(prototype)` + `new AuthService(13 đối số)`); đây là **private method**, không đổi constructor ⇒ cả hai nguyên vẹn |
| R2 | Ratchet tĩnh `login-log-429` vỡ | §2k — đã đo, không vỡ |
| R3 | Ca int-spec bắt nhầm hàng của bước mint | D5 — neo `MINT_IP` + `rowCount === 1` |
| R4 | Ghi thêm trường vỡ CHECK / append-only | Không: `text` nullable, không CHECK; chỉ INSERT ⇒ BẤT BIẾN #2 nguyên vẹn |
| R5 | `{}` ở call-site 2FA bị hiểu nhầm là quên | Comment trỏ đích danh WO chủ + §7 N2 + gạch `done_when` (§4.11) |
| R6 | Đường admin lấy nhầm ip của nạn nhân | D6 — meta dựng từ request admin; ca test assert `actor_user_id` + UA đặc trưng |
| R7 | Vá 13 điểm gọi spec làm nới một assert đang canh gác | **LUẬT VÁ** §2i — chỉ thêm `{}` |
| R8 | `§reauth-failed` nhiễu bởi `account-self-service.int-spec.ts:104` (cũng đếm `REAUTH_FAILED`) khi chạy chung lane | Khác company ⇒ RLS cô lập; thêm khoá `user_id` vào truy vấn để không phụ thuộc điều đó (memory `parallel-int-specs-share-one-outbox`, `flake-rate-tracks-lane-db-dirtiness`) |
| R9 | Số dòng cũ sau rebase | Mọi số ở §1/§2 đo lại trên master **hôm nay**; rebase ⇒ **đo lại**, đừng tin số cũ |

**Rollback**: revert commit. **0 migration · 0 contracts · 0 state** ⇒ không có bước hoàn tác nào khác.

---

## §7 — Nợ để lại (CÓ CHỦ Ý)

**N1 — chín điểm ghi cùng bảng vẫn câm, ngoài đường mật khẩu.** `auth.service.ts:1224` · `:1329` ·
`:1384` (`SESSION_REVOKED`) và `auth-users.service.ts:298` `TOTP_RESET` · `:339` `USER_LOCKED` ·
`:375` `USER_UNLOCKED` · `:466` `USER_UNLOCKED` · `:563` `USER_DELETED` · `:606` `USER_RESTORED`.

Nặng nhất là **hai nút admin chạy mỗi ngày**: `:466` ("Gỡ khoá đăng nhập") và `:375` (`unlockUser` —
"Mở khoá tài khoản"). D7 giải thích vì sao không kéo vào: ba họ `USER_UNLOCKED` phân biệt được bằng
`payload.reason` (`"password_reset"` / `"login_throttle"` / **vắng**), và chúng là endpoint khác + 10
điểm gọi spec.

⚠️ **Ghi cho người đọc AUTH-API-402**: sau WO này bảng có ba họ `USER_UNLOCKED`, chỉ **một** họ
(`reason='password_reset'`) mang ip/UA. Đừng đọc `ip_address IS NULL` là "không thu được ip".
⇒ **seed WO riêng** ở §4.11 (🟡, `depends_on` WO này). Kiểm `git status` sạch + không có WO
`in_progress` nào khác trước khi chèn `backlog.mjs` (memory `stage-head-blob-races-parallel-session`);
nếu không sạch thì ghi vào `harness/handoff.md` cho owner seed sau.

**N2 — `REAUTH_FAILED` của HAI context 2FA vẫn câm** — `context='2fa_disable'`
(`auth.service.ts:773`, truyền `{}`) và `context='2fa_enable'` (`two-factor.service.ts:246`, writer
thứ ba). **Có chủ**: `S18-AUTH-RESTORE2FA-1` (§2d). `done_when` của WO đó hôm nay chỉ nhắc hai hàng
`audit_logs` ⇒ §4.11 **phải thêm** gạch cho `REAUTH_FAILED` ở **cả hai** context, nếu không nó rơi
đúng khoảng trống mà N1 của #484 suýt rơi. Nêu luôn cơ hội gộp hai writer khi WO đó chạm cả hai file.

**N6 — LUỒNG THÔNG TIN MỚI: chủ thể nhìn thấy ip/UA của ACTOR** (security-reviewer, FULL gate 07/09,
MEDIUM — đã tự xác minh lại).

`GET /auth/security-events` gán phạm vi hàng theo **CHỦ THỂ**, không theo actor:
`buildWhere` dùng `rowScopeSql(rowScope, userSecurityEvents.userId)`
(`security-event.repository.ts:109-110`), và docblock ngay trên (`:103-107`) nói rõ chiều
"chủ thể = tôi, actor = người khác" VẪN hiện, với lời hứa «danh tính của actor ở hàng đó vẫn bị che
riêng bởi `identityActor`».

⚠️ Lời hứa đó **chỉ phủ email/họ tên**: `auth-logs-viewer.service.ts:382-389` cho `actor` đi qua
`this.userRef(..., row.actorIdentityInScope)` nhưng phát `ip_address` / `user_agent` **THÔ**. Trước WO
này hai cột đó NULL trên hàng admin→nạn nhân nên lời hứa còn đúng trên thực tế; **sau WO này chúng có
giá trị**, nên một người giữ `view:audit-log` ở phạm vi `Own` đọc được **IP + UA của admin đã thao tác
trên mình**.

**KHÔNG chặn hôm nay, và KHÔNG vá ở đây:** cặp là `isSensitive: true`
(`auth-logs-viewer.controller.ts:33`) và chỉ `company-admin` giữ
(`docs/permission-matrix-spec.md:57`, đo "3 vai giữ" ở `:242`) ⇒ hôm nay là admin→admin.

**Điều kiện kích hoạt** (ghi ra để không ai cấp nhầm mà không biết): cấp `view:audit-log` ở phạm vi
`Own` hoặc `Department` cho một vai KHÔNG phải admin. **Điểm trung hoà là DTO của viewer, KHÔNG phải
điểm ghi** — che ở điểm ghi sẽ làm hai cột này mang nghĩa khác nhau tuỳ hàng và giết luôn giá trị
forensics mà WO này vừa tạo ra. Cùng hình dạng với N3: sửa ở nơi ĐỌC.

**N5 — giá trị của 9 cột này PHỤ THUỘC `TRUST_PROXY`** (silent-failure-hunter, FULL gate 07/09).
`req.ip` chỉ có nghĩa nếu Express `trust proxy` được đặt đúng; PROD chạy sau `cloudflared` cùng máy,
và khi `TRUST_PROXY` không đặt thì MỌI request = `::1` ⇒ WO này sẽ thread rất cẩn thận một giá trị
vô nghĩa. **ĐÃ ĐO: không phải lỗ hở đang mở** — `S10-AUTH-IPTRUST-1` đóng đúng việc đó và ở trạng
thái `done`; `main.ts:34` gọi `parseTrustProxy(env.TRUST_PROXY)`, và `config/trust-proxy.spec.ts`
đóng đinh cả ca `loopback` (đúng số đo cloudflared) lẫn ca vì sao CẤM `true`. Ghi ra đây vì phụ thuộc
này KHÔNG hiển hiện ở diff: ai đó hạ `TRUST_PROXY` về mặc định sẽ làm mù 9 cột này mà không ca test
nào của WO này đỏ (int-spec khẳng định loopback là ĐÚNG trong môi trường test — xem D5).

**N3 — `ip_address`/`user_agent` lưu THÔ** (D3) ⇒ formula injection ở **ĐIỂM EXPORT** tương lai —
cùng món nợ N5 của #484, nay lan sang bảng thứ hai. Hôm nay an toàn (đường đọc sau cặp sensitive, FE
React escape, chưa có export). Khi thêm export CSV/XLSX cho viewer AUTH-API-402 thì phải neutralize
`= + - @` **tại điểm export**, không phải điểm ghi.

**N4 — `done_when` gạch 1 của WO đếm theo file cũ** («4 `securityEvents.record`…»). Số ĐO thật là
**9 điểm ghi / 2 file** (§1). Đề xuất owner sửa câu đó khi đóng sổ để lần sau không phải diễn giải.
