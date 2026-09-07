# S18-AUTH-RESETMETA-1 — `resetPassword` + `changePassword` phải mang `ip`/`userAgent` vào audit

> 🔴 vùng đỏ (auth). Phạm vi **owner CHỐT 07/09/2026**: hai đường `resetPassword` + `changePassword`.
> Vế 2FA (`disableTwoFactor`) **KHÔNG** thuộc WO này — xem §7.
>
> **v2** sau 1 vòng `plan-reviewer` (REVISE, 7 mục chặn — đã xác minh lại từng mục bằng Read/Grep,
> **cả 7 đúng**). Đổi lớn nhất: §1 đếm thiếu 1 hàng audit · `§change-denied` ở v1 **KHÔNG tới được** ·
> §2.5 đo thiếu ~2.8× bề mặt caller · §7 trỏ vào một WO chưa tồn tại trên base này.

---

## §1 — Khiếm khuyết

**NĂM** hàng `audit_logs` trên hai đường đổi mật khẩu ghi `ip = NULL`, `user_agent = NULL`:

| # | Hàng audit | Vị trí (base = master `1f963382`) | Nhánh |
| --- | --- | --- | --- |
| 1 | `auth.password_change_denied` | `auth.service.ts:820` | từ chối 401 (chỉ tới được qua TOCTOU — xem §5) |
| 2 | `auth.password_changed` | `auth.service.ts:838` | thành công 200 |
| 3 | `auth.password_reset_denied` | `auth.service.ts:1691` | từ chối 401 |
| 4 | `auth.password_reset` | `auth.service.ts:1709` | thành công 200 |
| 5 | `user.login_throttle_cleared` | `auth.service.ts:1834` | **nhánh Valkey hỏng** trong chuỗi `resetPassword` |

Hàng #5 là mục `plan-reviewer` bắt được và v1 **đếm thiếu**: `resetPassword:1740` →
`clearLoginLocksAfterReset:1770` → `recordFailedLockClear:1825`. Nó ghi khi việc gỡ khoá đăng nhập sau
reset **thất bại** — tức đúng lúc hệ thống đang bất thường nhất — và `actorUserId` ở đó cũng là nạn nhân
(`:1800` truyền `userId, userId`).

Ba hàng `_denied`/`throttle_cleared` tự nhận trong comment là **vết BỀN duy nhất** của nhánh từ chối
vùng đỏ, nhưng `actorUserId` là **CHỦ TÀI KHOẢN**, không phải người bấm nút. Không có `ip`/`userAgent`
thì vết **không trả lời được câu hỏi "ai"** — nó chỉ nói "chuyện này đã xảy ra với tài khoản X".

Đây **KHÔNG** phải hồi quy của `S18-AUTH-RESETDELETED-1` / `-CHANGEPWTOCTOU-1`: nhánh THÀNH CÔNG đã
thiếu từ trước; hai WO đó chỉ THÊM nhánh `_denied` mang sẵn cùng món nợ.

## §2 — Đã đo (đừng đo lại)

1. **Hạ tầng đã có đủ, chỉ thiếu dây nối.** `AuditEntry` đã khai `ip?` + `userAgent?`
   (`events/audit.service.ts:22-23`) và `record()` ghi thẳng vào cột v1 `audit_logs.ip` /
   `audit_logs.user_agent` (`:133-134`; schema `db/schema/audit.ts:39-40`, kiểu `text`).
   **Không cần migration.**
2. **Có cột `ip_address` thứ hai** (`audit.ts:53`, v2 mig 0432, `varchar(45)`). Mọi caller auth hiện tại
   dùng cột **v1** (`ip`) — `login` `:357/:371/:388/:400/:409/:424/:436`, `refresh` `:1008`,
   `forgotPassword`. WO này **mirror v1**, KHÔNG đụng `ip_address` (đổi cột = đổi thứ dashboard đang đọc).
3. **Controller đã có helper.** `auth.controller.ts:314` — `private meta(req: Request): RequestMeta`.
   `AuthenticatedRequest extends Request` (`:52`) ⇒ gọi được ở cả hai endpoint không cần ép kiểu.
4. **Lệch nằm ngay trong một cặp endpoint công khai.** `forgotPassword(req, meta: RequestMeta)` — meta
   **bắt buộc** (`:1474`); `resetPassword(req)` — không có. Cùng file, cùng cặp mint↔dùng token.
5. **Bề mặt caller — SỐ ĐO THẬT** (v1 khai "≈19", sai ~2.8×):

   | Method | controller | `auth.service.spec.ts` | int-spec | tổng |
   | --- | --- | --- | --- | --- |
   | `resetPassword` | 1 | 13 | **12 điểm / 4 file** | 26 |
   | `changePassword` | 1 | ~10 | **20 điểm / 7 file** | ~31 |

   9 file int-spec liên quan: `account-self-service` · `auth-coverage` · `auth-reset-deny-path` ·
   `auth-s18-changepwtoctou-1` · `auth-s18-resetclears-e2e` · `auth.int-spec` ·
   `foundation-seed3-must-change-password` · `security-event-atomicity` · `security-event-emit-sites`.

   `apps/api/tsconfig.json:23` `include` có `test` ⇒ **`tsc` THẤY int-spec** — cơ chế §4.4 đứng vững.
   ⚠️ `users/auth-users.service.ts` cũng có method tên `resetPassword(actor, id)` — **method KHÁC**
   (admin đặt lại hộ), KHÔNG thuộc phạm vi (xem §7).
6. **Chuỗi hàng #5 hoàn toàn KÍN.** `clearLoginLocksAfterReset` + `recordFailedLockClear` đều `private`,
   và caller **duy nhất** là `resetPassword:1740` → `:1800`/`:1810`. Thêm `meta` vào hai chữ ký đó có
   bán kính nổ **bằng không** ngoài file.

## §3 — Quyết định thiết kế

### D1 — `meta` là tham số **BẮT BUỘC**, không phải `= {}`

`resetPassword(req, meta: RequestMeta)` · `changePassword(user, cur, next, meta: RequestMeta)` ·
hai private `clearLoginLocksAfterReset(..., meta)` / `recordFailedLockClear(..., meta)`.

Mirror `forgotPassword`/`login` (bắt buộc), **không** mirror `refresh(token, meta = {})`.

Lý do: mặc định `= {}` làm caller quên trở nên **im lặng ở compile-time**. WO này tồn tại vì một vết
im lặng; vá nó bằng một cơ chế im lặng khác là tự mâu thuẫn. Bắt buộc ⇒ caller thứ ba trong tương lai
**không biên dịch được** nếu quên.

⚠️ **Cấm `meta?.ip`.** Nếu một điểm gọi lách `tsc` bằng `as unknown as` (`auth.service.spec.ts:1049`)
thì `meta === undefined` ⇒ TypeError ⇒ **500 thay vì 401 trên đường CÔNG KHAI**. Giữ required + neo
`§shape` hai đầu; đừng vá bằng optional-chaining, nó tái tạo đúng sự im lặng WO này đi giết.

### D2 — Chỉ nối dây, KHÔNG đổi luồng

Năm `audit.record(...)` thêm đúng hai trường `ip: meta.ip, userAgent: meta.userAgent`. Không thêm
nhánh, không thêm `throw`, không đổi thứ tự lệnh.

**KHÔNG cắt độ dài.** `audit_logs.ip`/`user_agent` là `text` không giới hạn và `record()` ghi thô
(chỉ jsonb được mask — `events/audit.service.ts:112-123`). Cùng cây CÓ tiền lệ cắt vì "kích thước do
client điều khiển" (`login-rate-limiter.ts:299-301`, `MAX_IP_MEMBER_LEN`), nhưng ở đó là **member của
set Valkey** (bộ nhớ không bị chặn), còn đây là một cột `text` trong hàng INSERT vốn đã chạy, bị chặn
sẵn bởi trần header của Node và bởi trần "tối đa 1 lần/token". `login`/`refresh` đã ghi thô y hệt ⇒
cắt ở đây sẽ làm **lệch** với chúng. Giữ thô, có chủ ý.

### D3 — Hình dạng phản hồi BẤT BIẾN

`resetPassword` là đường **CÔNG KHAI không xác thực**. Mọi nhánh hỏng phải vẫn 401 **byte-giống nhau** —
thêm trường vào *vết* không được đẻ ra *oracle* ở *phản hồi*. `changePassword` giữ nguyên bộ nhánh
(`account_gone` 401 · `bad_credentials` 401 · 429) + `assertNever`, và giữ nguyên **hai câu 401 CỐ Ý
khác nhau**: `"Phiên đăng nhập không còn hợp lệ."` (`:867`) vs `"Mật khẩu hiện tại không đúng."`
(`:872`). Không gộp.

### D4 — Bằng chứng phải đi qua **HTTP**, không gọi thẳng service

⚠️ **Bẫy trung tâm của WO này.** `account-self-service.int-spec.ts:113-206` gọi thẳng
`auth.changePassword(...)`. Một int-spec viết theo khuôn đó sẽ **tự truyền meta** ⇒ xanh kể cả khi
controller quên `this.meta(req)` — đúng hình dạng **xanh-RỖNG**. Khiếm khuyết nằm ở **dây nối
controller→service**, nên phép đo phải bắt đầu từ **request HTTP thật** (supertest + `app.listen(0)`,
khuôn `auth-s18-resetdeleted-1.int-spec.ts`), rồi đọc thẳng `audit_logs` qua `directPool`.

### D4b — `account_gone` chỉ tới được qua cửa sổ `password.hash` ⟵ **sửa lỗi của v1**

v1 viết `§change-denied` = "user xoá mềm + access token còn sống ⇒ `password_change_denied`". **SAI.**
Câu SELECT re-auth `:750-754` **đã có** `isNull(users.deletedAt)` ⇒ user xoá mềm rơi vào `!row` →
`"bad_credentials"` (`:761`) → ném `"Mật khẩu hiện tại không đúng."` và **KHÔNG ghi hàng `audit_logs`
nào**. Truy vấn `action='auth.password_change_denied'` sẽ trả **0 hàng** ⇒ ca xanh-RỖNG.
(Chính docblock `auth-s18-changepwtoctou-1.int-spec.ts:10-13` đã cảnh báo đúng điều này; v1 chép nhầm
tiền đề từ đường `reset` — nơi vế `deleted_at` nằm ở câu **UPDATE**, không phải SELECT. Đúng bẫy memory
`sibling-wo-rationale-may-not-transfer`.)

Cơ chế đúng: `account_gone` = câu UPDATE `:777-789` khớp **0 hàng** ⇒ phải soft-delete **XEN GIỮA**
SELECT `:750` và UPDATE `:777`. Điểm chèn tất định: `this.password.hash(newPassword)` `:766` — argon2id
19 MiB, cửa sổ hàng chục–hàng trăm ms (docblock `:860-866`).

⇒ `vi.spyOn(app.get(PasswordService), "hash")`: bên trong spy chạy
`UPDATE users SET deleted_at = now() WHERE id = $1` qua **`directPool`** (kết nối KHÁC ⇒ commit thấy
được ở statement kế dưới READ COMMITTED), rồi `await` hash THẬT. **Giữ nguyên đường HTTP** ⇒ D4 không bị
phá. Không đụng `withTenant`, không cần `proxyTx`, không cần counter.
Dùng **user dùng-một-lần** cho ca này; `mockRestore()` sau khi đã assert xong (memory
`mockrestore-wipes-mock-calls`).

### D5 — Assert giá trị, không assert "khác null"

- `user_agent`: gửi `User-Agent` **đặc trưng theo ca** ⇒ assert **BẰNG ĐÚNG** chuỗi đó. supertest
  **không** tự gửi `User-Agent` ⇒ trước vá là NULL sạch, sau vá là giá trị của **đúng request đó**.
- `ip`: assert khớp `/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/`.
  ⚠️ Lý do là **`trust proxy` = false trong int-spec**, vì `app.set("trust proxy", …)` chỉ chạy ở
  `main.ts:34` mà int-spec dựng app bằng `Test.createTestingModule().createNestApplication()` ⇒
  **không bao giờ chạy `main.ts`**. (v1 dẫn nhầm sang memory PROD — lý do này bền hơn, không phụ thuộc
  env máy chạy.)
- **Neo chống chép nhầm hàng:** helper mint token gọi `forgotPassword(..., { ip: "198.51.100.201" })`
  và `forgotPasswordImpl` ghi `auth.password_reset_requested` **CÓ ip** cho **cùng `object_id`**
  (`:1537-1543`). ⇒ mọi truy vấn phải lọc theo `action` **VÀ** khoá `rowCount === 1`, **VÀ** assert
  `ip !== "198.51.100.201"` — chứng minh giá trị đến từ request reset, không bị chép từ hàng mint.

### D6 — Mock unit spec: chỉ thêm tham số, KHÔNG chạm field

`auth.service.spec.ts` có **HAI** khuôn dựng service: `Object.create(AuthService.prototype)` + gán một
phần field (`:627/:731/:811/:885/:927`) **và** `new AuthService(13 đối số vị trí)`
(`:126/:260/:399/:565/:1050`). D1 chỉ đổi **chữ ký hàm**, không thêm field/dep constructor ⇒ **cả hai**
khuôn không vỡ; chỉ cần thêm đối số ở điểm gọi.

Đây cũng là lý do **BÁC** phương án "AsyncLocalStorage / provider REQUEST-scoped thay vì truyền meta":
nó thêm dependency vào constructor ⇒ vỡ cả 5 builder vị trí, và làm nguồn của `ip` trở nên ẩn — ngược
đúng mục tiêu WO.

## §4 — Các bước

1. `auth.service.ts` — `changePassword(user, cur, next, meta: RequestMeta)`; hai `audit.record`
   (`:820`, `:838`) thêm `ip`/`userAgent`.
2. `auth.service.ts` — `resetPassword(req, meta: RequestMeta)`; hai `audit.record` (`:1691`, `:1709`)
   thêm `ip`/`userAgent`.
3. `auth.service.ts` — thread `meta` xuống `clearLoginLocksAfterReset:1770` →
   `recordFailedLockClear:1825`; `audit.record` `:1834` thêm `ip`/`userAgent` (hàng #5).
4. `auth.controller.ts` — `:184` thêm `@Req() req: Request` + truyền `this.meta(req)`; `:200` truyền
   `this.meta(req)` (đã có `@Req()`).
5. `pnpm --filter @mediaos/api typecheck` ⇒ `tsc` liệt kê đủ ~55 điểm gọi. Vá cơ học.
   **LUẬT VÁ: chỉ THÊM `{}` (hoặc meta thật ở ca cần). CẤM đổi bất kỳ assert nào đang có** — sửa spec
   bảo mật là đúng chỗ sinh bẫy `tests-can-pin-a-hole-open`.
6. Int-spec mới `auth-s18-resetmeta-1.int-spec.ts` + bổ sung unit (§5).
7. **`harness/backlog.mjs`** — cập nhật WO `S18-AUTH-RESETMETA-1`:
   `done_when` (thêm 2 hàng của `changePassword` + hàng #5) · `paths` (thêm plan + 9 file int-spec) ·
   `plan: "docs/plans/S18-AUTH-RESETMETA-1.md"` · `depends_on` thêm `S18-AUTH-CHANGEPWTOCTOU-1`
   (hàng `auth.password_change_denied` **chỉ tồn tại nhờ WO đó**).
8. **RED trước:** `bash harness/check.sh --all --lane-db=s18resetmeta` — dán **5 màu đỏ thật** vào
   handoff. Không có `LANE_DB` thì int-spec `describe.skipIf(!hasDb)` bị SKIP ⇒ "XANH KHÔNG ĐỦ BẰNG
   CHỨNG", không phải bằng chứng.

## §5 — Ca kiểm (RED trước)

**Int-spec (HTTP thật — bắt buộc, D4):**

| Ca | Nội dung | Trước vá |
| --- | --- | --- |
| `§reset-ok` | POST `/auth/reset-password` token hợp lệ + UA đặc trưng ⇒ 200; `auth.password_reset` (1 hàng) có `ip` loopback ≠ `198.51.100.201` + `user_agent` ĐÚNG | 🔴 NULL/NULL |
| `§reset-denied` | token của user **xoá mềm** ⇒ 401; `auth.password_reset_denied` (1 hàng) có `ip` + `user_agent` | 🔴 NULL/NULL |
| `§change-ok` | POST `/auth/change-password` đúng mật khẩu + UA đặc trưng ⇒ 200; `auth.password_changed` (1 hàng) có `ip` + `user_agent` | 🔴 NULL/NULL |
| `§change-denied` | **D4b**: spy `password.hash` soft-delete xen giữa ⇒ 401 `"Phiên đăng nhập không còn hợp lệ."`; `auth.password_change_denied` (1 hàng) có `ip` + `user_agent` | 🔴 NULL/NULL |
| `§shape` | 401 của `§reset-denied` **byte-giống** 401 token rác; và hai câu 401 của `changePassword` vẫn KHÁC nhau (D3) | 🟢 neo, xanh cả trước lẫn sau |

**Unit (`auth.service.spec.ts`) — hàng #5 và neo hồi quy:**

| Ca | Nội dung |
| --- | --- |
| `§lockfail-meta` | spy `rateLimiter` ném ở bước gỡ khoá ⇒ `user.login_throttle_cleared` mang `ip`/`userAgent` (hàng #5 chỉ tới được khi Valkey hỏng ⇒ đo ở unit rẻ hơn int) |
| neo 4 hàng | ở ≥1 ca sẵn có mỗi nhánh, assert `ip`/`userAgent` **BẰNG HẰNG CỤ THỂ** |

⚠️ **CẤM `expect.objectContaining({ ip: meta.ip })` khi `meta = {}`** — hai vế là `undefined`, assert
xanh dù không nối dây gì. Dùng `meta = { ip: "203.0.113.9", userAgent: "unit-ua-<nhánh>" }` và assert
đúng chuỗi đó.

**Đo đột biến bắt buộc trước khi mở PR:** gỡ `ip:` khỏi **từng** trong 5 `audit.record` ⇒ mỗi lần phải
có **đúng** ca tương ứng đỏ. Cổng chồng nhau ở đây là có thật (5 hàng, cùng một kiểu vá) — không đột
biến từng vế thì không biết ca nào đang thực sự đo cái gì (memory
`overdetermined-gate-makes-deny-spec-vacuous`).

Mỗi ca một **email riêng** (`rl:forgot:*` khoá theo `(slug,email)`), một **UA riêng**, một **user riêng**
cho `§change-denied` ⇒ không ca nào đầu độc ca khác.

## §6 — Rủi ro

| # | Rủi ro | Chặn bằng |
| --- | --- | --- |
| R1 | Int-spec gọi thẳng service ⇒ xanh-RỖNG với dây controller | D4 — bắt buộc supertest HTTP |
| R2 | Đổi chữ ký làm vỡ mock | D6 — hai khuôn mock, cả hai chỉ ăn tham số |
| R3 | Thêm trường vào vết vô tình đổi hình phản hồi ⇒ oracle mới trên đường công khai | D3 + `§shape` |
| R4 | Ghi nhầm `ip_address` (v2) thay vì `ip` (v1) ⇒ dashboard đọc v1 vẫn thấy NULL | §2.2 — mirror `login`/`refresh` |
| R5 | `§change-denied` **không tới được** nếu dựng theo v1 ⇒ 0 hàng ⇒ xanh-RỖNG | **D4b** — cửa sổ `password.hash` |
| R6 | Truy vấn audit ăn nhầm hàng `auth.password_reset_requested` của bước mint | D5 — lọc `action` + `rowCount===1` + `ip ≠ 198.51.100.201` |
| R7 | `meta` undefined lúc CHẠY (điểm gọi lách `tsc` bằng `as unknown as`) ⇒ 500 thay 401 | D1 — cấm `meta?.`; `§shape` neo hai đầu |
| R8 | Vá ~55 điểm gọi làm hỏng assert sẵn có ở spec bảo mật | §4.5 — luật "chỉ thêm `{}`", 9 file vào `paths` để FULL gate NHÌN THẤY |
| R9 | #483 squash-merge trước WO này ⇒ 5 số dòng ở §1 lệch | Rebase rồi **đo lại**, đừng tin số cũ |

## §7 — Nợ để lại (CÓ CHỦ Ý, có chủ)

### N1 — Vế 2FA ⟶ `S18-AUTH-RESTORE2FA-1`

`auth.2fa_disabled` (`two-factor.service.ts:288`, CÓ trên master) và `auth.2fa_disable_denied`
(**chỉ có trên PR #483**) đều thiếu `ip`/`userAgent`; `disableTwoFactor(user, password)` không nhận
`RequestMeta`.

⚠️ **`S18-AUTH-RESTORE2FA-1` CHƯA tồn tại trên base này** — grep `harness/backlog.mjs` trên master trả
**0**; WO đó được seed **trong chính PR #483** (nhánh `fix/s18-auth-2fadeleted-1` có 2 hit). v1 khẳng
định nó "vốn đã sửa `two-factor.service.ts`" là nói về một vật thể chưa có ở đây.

⇒ **KHÔNG seed lại ở nhánh này** (hai nhánh cùng chèn vào `backlog.mjs` = xung đột, memory
`stage-head-blob-races-parallel-session`). Thay vào đó: nợ này **treo vào việc #483 merge**. Nếu #483
bị bác thì N1 mất chủ ⇒ **bước đóng WO này phải kiểm tra lại**: sau khi #483 merge, thêm hai gạch đầu
dòng `ip`/`userAgent` vào `done_when` của `S18-AUTH-RESTORE2FA-1`. Ghi vào `harness/handoff.md`.

### N2 — `user_security_events` vẫn vô danh (nhánh nhiều lượt nhất của `changePassword`)

Nhánh `bad_credentials` (`:869-873`) là nơi **kẻ chiếm phiên dò mật khẩu hiện tại** rơi vào, và vết BỀN
duy nhất của nó là `REAUTH_FAILED` qua `recordReauthFailure` (`:2105-2119`) — **không** ip/UA, dù bảng
CÓ sẵn cột (`db/schema/auth-logs.ts:81-82`) và **cùng file đã có tiền lệ nối dây** (`refresh` truyền
meta vào `securityEvents.record`, `:1008-1009`).

**KHÔNG làm trong WO này**, có lý do: `recordReauthFailure` dùng chung với `disableTwoFactor:722` ⇒ thêm
`meta` bắt buộc ở đó **kéo vế 2FA vào**, đúng thứ owner vừa loại khỏi phạm vi. `done_when` của WO cũng
chỉ nói `audit_logs`.
⇒ **Seed WO riêng** `S18-AUTH-SECEVENTMETA-1` (🔴, `depends_on: [S18-AUTH-RESETMETA-1]`) ở bước §4.7,
phủ cả 4 `securityEvents.record` của hai method + `recordReauthFailure`.

### N3 — Đường admin `users/auth-users.service.ts#resetPassword`

Audit `user.password_reset_by_admin` mang **cùng món nợ**. Ngoài phạm vi (method khác, module khác),
nhưng ghi ra đây để nó **không rơi vào khoảng trống như N1 suýt rơi**. Gộp vào `S18-AUTH-SECEVENTMETA-1`
khi seed.
