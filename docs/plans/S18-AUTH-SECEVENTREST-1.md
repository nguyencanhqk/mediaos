# S18-AUTH-SECEVENTREST-1 — 9 điểm ghi `user_security_events` NGOÀI đường mật khẩu phải mang `ip`/`userAgent`

> **WO**: `S18-AUTH-SECEVENTREST-1` · layer BE · depends_on `S18-AUTH-SECEVENTMETA-1` (#486, `d3c66029`)
> **zone**: 🔴 **red** (nâng từ `yellow` ở bước 0 — xem D0) · **gate FULL**
> **Đọc kèm**: `docs/plans/S18-AUTH-SECEVENTMETA-1.md` §2e (census gốc) · §3 D1/D4/D5/D6 · §3 D7 (vì sao `clearLoginThrottle` bị hoãn sang đây) · §7 N1 (nợ mà WO này đi trả).
>
> **v2 sau plan-review vòng 1 (BLOCK, 7 blocker).** Đã vá: B1 gate/zone · B2 `paths` · B3 lệnh lane-db · B4 hợp đồng WHERE hai bảng · B5 census ngoài hai file · B6 dựng trạng thái · B7 logout có **4** điểm gọi / 3 handler. Cộng W1–W8.

---

## §1 — Khiếm khuyết

`S18-AUTH-RESETMETA-1` (#484) nối `RequestMeta` cho `audit_logs` của đường mật khẩu;
`S18-AUTH-SECEVENTMETA-1` (#486) nối tiếp cho `user_security_events` của **cùng đường đó**.

WO này đóng **9 điểm ghi còn lại trong HAI FILE `auth.service.ts` + `auth-users.service.ts`** — thuộc
*quản lý phiên* và *thao tác admin trên tài khoản*. ⚠️ **KHÔNG** phải "phần còn lại của bảng": bảng
còn 6 điểm ghi vô danh ở **ba file khác** ngoài `paths` — xem §2c + §7 N4.

Bảng có sẵn cột `ip_address`/`user_agent` (`migrations/0443_…:146-147`), writer đã nhận `ip?`/`userAgent?`
(`security-event-writer.service.ts:18-19`), nhưng **không method nào trong 9 method này nhận `RequestMeta`**
⇒ hàng ghi ra NULL.

Hai điểm **đáng giá nhất** là **hai nút admin chạy mỗi ngày**:

| # | điểm ghi | method | endpoint | vì sao đáng |
| --- | --- | --- | --- | --- |
| 6 | `auth-users.service.ts:375` `USER_UNLOCKED` | `unlockUser` | `POST /auth/users/:id/unlock` | nút «Mở khoá tài khoản» |
| 7 | `auth-users.service.ts:466` `USER_UNLOCKED` | `clearLoginThrottle` | `POST /auth/users/:id/login-throttle/clear` | nút «Gỡ khoá đăng nhập» |

Sau #486 bảng có **BA** họ `USER_UNLOCKED` mà **chỉ** họ `payload.reason='password_reset'` (nhánh
degraded, hiếm khi chạy) mang ip/UA.

🟡 **Không phải lỗ khai thác** — không có đường nào để kẻ tấn công lợi dụng sự vắng mặt này. Là **mù
forensics**: khi phải trả lời "ai đã mở khoá / xoá tài khoản đó, từ máy nào", bảng im lặng.
(Zone 🔴 ở đây là vì **diff** chạm `auth` + `audit`, không phải vì mức độ lỗ — xem D0.)

---

## §2 — Đã đo (đừng đo lại)

### 2a. Writer đã sẵn sàng — NỐI DÂY, không đổi lược đồ

`SecurityEventEntry` có `ip?`/`userAgent?` và map vào `ipAddress`/`userAgent`
(`security-event-writer.service.ts:18-19`, `:76-77`). Cột `text`, **không** trần độ dài, **không**
CHECK ⇒ **0 migration · 0 contracts · 0 rủi ro 22001**. Y hệt #486.

### 2b. Census 9 điểm — đọc từ code `master` @ `9d284de3`

`auth.service.ts` — 11 `securityEvents.record`, **3 trong phạm vi**:

| # | dòng ghi | `event_type` | method (dòng decl) | `payload` | audit anh em (dòng `action:`) | `objectId` của audit |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `:1254` | `SESSION_REVOKED` | `logout` (`:1216`) | `{scope:"family"}` | `auth.logout` (`:1247`) | `row.userId` |
| 2 | `:1359` | `SESSION_REVOKED` | `revokeSession` (`:1318`) | `{scope:"single",sessionId}` | `auth.session_revoked` (`:1352`) | ⚠️ **`sessionId`** |
| 3 | `:1414` | `SESSION_REVOKED` | `revokeOtherSessions` (`:1373`) | `{scope:"others",count,hadCurrentSession}` | `auth.session_revoked` (`:1403`) | `userId` |

8 điểm còn lại của file **ngoài** phạm vi vì **đã có** ip/UA: `:929` `PASSWORD_CHANGED` · `:1635`
`PASSWORD_RESET_COMPLETED` · `:1813` `ALL_SESSIONS_REVOKED` · `:1822` `USER_UNLOCKED` · `:2242`
`REAUTH_FAILED` (từ #486); `:1093` `REFRESH_TOKEN_REUSE_DETECTED` · `:1953` `PASSWORD_RESET_REQUESTED`
· `:2451` `USER_LOCKED` (từ trước).

`auth-users.service.ts` — 8 `securityEvents?.record`, **6 trong phạm vi**:

| # | dòng ghi | `event_type` | method (dòng decl) | `payload` | audit anh em (dòng `action:`) | endpoint |
| --- | --- | --- | --- | --- | --- | --- |
| 4 | `:298` | `TOTP_RESET` | `resetTwoFactor` (`:279`) | `{revokedSessionCount}` | `user.2fa_reset` (`:292`) | `POST /auth/users/:id/2fa/reset` |
| 5 | `:339` | `USER_LOCKED` | `lockUser` (`:312`) | `{reason}` | `user.locked` (`:329`) | `POST /auth/users/:id/lock` |
| 6 | `:375` | `USER_UNLOCKED` | `unlockUser` (`:357`) | *(vắng — writer default `{}`)* | `user.unlocked` (`:366`) | `POST /auth/users/:id/unlock` |
| 7 | `:466` | `USER_UNLOCKED` | `clearLoginThrottle` (`:431`) | `{reason:"login_throttle",hadLock,ok}` | `user.login_throttle_cleared` (`:449`) | `POST /auth/users/:id/login-throttle/clear` |
| 8 | `:563` | `USER_DELETED` | `deleteUser` (`:542`) | `{revokedSessionCount}` | `user.deleted` (`:556`) | `DELETE /auth/users/:id` |
| 9 | `:606` | `USER_RESTORED` | `restoreUser` (`:580`) | *(vắng)* | `user.restored` (`:599`) | `POST /auth/users/:id/restore` |

2 điểm còn lại (`:671` `PASSWORD_RESET_BY_ADMIN` · `:755` `USER_UNLOCKED` trong
`recordFailedLockClear`) — **đã có** ip/UA từ #486.

⇒ **9 = 3 + 6.** Khớp `src` của WO; số dòng đã trôi so với `src` (viết trước #486), method thì khớp một-một.

### 2c. Ngoài HAI file: 6 điểm ghi nữa vẫn vô danh — **KHÔNG kéo vào**, nhưng phải nói ra

`rg 'securityEvents\??\.record'` toàn `apps/api/src`, trừ hai file trên (đối chiếu bản kiểm kê có sẵn
`test/integration/security-event-emit-sites.int-spec.ts`, 13 emit-site):

| file:dòng | `event_type` | chủ |
| --- | --- | --- |
| `auth/two-factor.service.ts:209` | `TOTP_ENABLED` | **KHÔNG có** |
| `auth/two-factor.service.ts:245` | `REAUTH_FAILED` (`context='2fa_enable'`) | `S18-AUTH-RESTORE2FA-1` |
| `auth/two-factor.service.ts:324` | `TOTP_DISABLED` | **KHÔNG có** |
| `auth/step-up/step-up.service.ts:214` | `STEP_UP_GRANTED` / `STEP_UP_FAILED` | **KHÔNG có** |
| `permission/permission-admin.service.ts:151` | `ROLE_ASSIGNED` | **KHÔNG có** |
| `permission/permission-admin.service.ts:288` | `ROLE_REMOVED` | **KHÔNG có** |

Cả 6 đều **không** truyền `ip`/`userAgent` (đã đọc từng block). Cả 3 file **ngoài `paths`** của WO này
⇒ kéo vào là cướp phạm vi + mở diff sang `permission` (vùng đỏ khác). ⇒ **N4** (§7) + seed WO gom.

> Lý do phải ghi thẳng: nếu §1 nói "phần còn lại của bảng", người đọc kế tiếp sẽ tin bảng đã sạch và
> không bao giờ đi tìm 5 điểm không chủ kia (họ lỗi `db-design-doc-can-understate-legacy-surface`).

### 2d. Hàng `audit_logs` ANH EM trong CÙNG tx cũng vô danh — và KHÔNG có chủ khác

9 hàng ở cột "audit anh em" của §2b: **0 hàng nào** có `ip`/`userAgent` (đo bằng `awk` trên block
`audit.record(tx, {…}` + `grep 'action:|ip:|userAgent:'`). `grep` 8 chuỗi action đó trên
`harness/backlog.mjs` → **0** WO nhận. ⇒ **không có scope theft**. Xử ở **D3**.

### 2e. Vế 2FA VẪN có chủ — KHÔNG lấy

`disableTwoFactor` / `confirmEnable` (`REAUTH_FAILED` context `2fa_disable`/`2fa_enable`, audit
`auth.2fa_disable_denied`) → **`S18-AUTH-RESTORE2FA-1`**, `paths` của nó có
`apps/api/src/auth/two-factor.service.ts`, `paths` của WO này **không**. Y nguyên §2d của #486.

⚠️ **W2 — va chạm rộng hơn R8 của v1 tưởng.** `S18-AUTH-RESTORE2FA-1` (`harness/backlog.mjs`) có
`paths` gồm **cả** `apps/api/src/users/auth-users.service.ts` **và** `apps/api/src/auth/auth.service.ts`,
và mục `src` đầu của nó là **`restoreUser`** — đúng method D1 đổi chữ ký. Cả hai WO đang `ready`,
0 in_progress. ⇒ **CẤM chạy song song** (memory `stage-head-blob-races-parallel-session`). Bước 0 ghi
`notes` chặn; ai làm RESTORE2FA-1 sau phải rebase trên commit của WO này.

### 2f. Bề mặt caller — số ĐO

`rg` toàn `apps/api/src` + `apps/api/test`, trừ 2 controller:

| method | src ngoài controller | unit spec (`auth-users.service.spec.ts`) | int-spec |
| --- | --- | --- | --- |
| `logout` | **0** | 0 | `auth-logout.int-spec.ts:118,139,154,162,163` (5) · `security-event-emit-sites.int-spec.ts:284` (1) |
| `revokeSession` | **0** | 0 | `security-event-emit-sites.int-spec.ts:304` (1) |
| `revokeOtherSessions` | **0** | 0 | `security-event-emit-sites.int-spec.ts:326` (1) |
| `resetTwoFactor` | **0** | `:360,384,391` (3) | 0 |
| `lockUser` | **0** | `:200,226,234,242,250` (5) | `security-event-emit-sites.int-spec.ts:379` (1) |
| `unlockUser` | **0** | `:259,274,280` (3) | `security-event-emit-sites.int-spec.ts:399` (1) |
| `clearLoginThrottle` | **0** | `:842,853,862,896,908,922,932,940,969,977` (**10**) | 0 |
| `deleteUser` | **0** | `:414,434,439,447` (4) | 0 |
| `restoreUser` | **0** | `:454,468,475,487` (4) | 0 |

**Tổng: 0 caller src ngoài controller · 29 unit spec · 10 int-spec = 39 điểm phải vá** (v1 cộng nhầm
thành 38 — W1). 10 điểm `clearLoginThrottle` khớp ĐÚNG `done_when` gạch 3 (số dòng trôi sau #486:
`805→842 · 816→853 · 825→862 · 859→896 · 871→908 · 885→922 · 895→932 · 903→940 · 932→969 · 940→977`).

### 2g. ⚠️ `logout` có **4** điểm gọi ở controller, không phải 3 — và điểm production là điểm CÒN LẠI

`auth.controller.ts:139-144`:

```ts
if (cookieToken) { this.assertCsrf(req, cookies); await this.auth.logout(cookieToken); }   // :141 — ĐƯỜNG COOKIE
else if (dto?.refreshToken) { await this.auth.logout(dto.refreshToken); }                  // :143 — đường body
```

Web dùng **cookie** (`auth.controller.ts:81-85` login `setSessionCookies`, comment "web-core dùng cookie");
supertest **không** tự mang cookie ⇒ một ca `§logout` chỉ gửi body sẽ **chỉ chạm `:143`**. Nối dây `:143`
mà quên `:141` ⇒ **ca xanh, đường thật vẫn NULL** — đúng hình dạng xanh-RỖNG WO này sinh ra để giết.
⇒ **2 ca cho điểm #1** (§5) + §4 bước 4 ghi "4 điểm gọi / 3 handler".
Khuôn cookie đã chạy: `auth-session.int-spec.ts:41-51` (`cookieValue`/`cookieLine`) + `:154`
(`.set("Cookie", …)` + `.set(CSRF_HEADER_NAME, csrf)`).

### 2h. Cả 9 handler controller ĐÃ có `@Req()` — phần dây là RẺ

`auth.controller.ts`: `logout` `:132-135` (`@Req() req: Request`) · `revokeSession` `:281-284` ·
`revokeOtherSessions` `:292`. Helper `private meta(req)` `:325-327` đã delegate về `requestMeta`.
`auth-users.controller.ts`: `:101` `lockUser` · `:112` `unlockUser` · `:140` `clearLoginThrottle` ·
`:157` `resetTwoFactor` · `:172` `deleteUser` · `:186` `restoreUser` — **tất cả** đã có
`@Req() req: AuthenticatedRequest`, và file **đã import** `requestMeta` (`:18`, dùng ở `:208`).
⇒ **0 decorator mới · 0 import mới · 0 thay đổi DI/module.**

### 2i. `lockUser` là method DUY NHẤT có tham số optional — TS cấm required sau optional

`lockUser(actor, id, reason?: string)` (`:312`). Thêm `meta: RequestMeta` sau `reason?` = TS1016. Xử ở **D2**.
`lockAuthUserRequestSchema.reason` = `z.string().trim().min(1).max(500).optional()`
(`packages/contracts/src/auth/user-admin.ts:203`) ⇒ `dto.reason` vốn là `string | undefined` ⇒ D2 hợp lệ
độc lập với `exactOptionalPropertyTypes`.

### 2j. Ratchet / census tĩnh KHÔNG dính

- `login-log-429-census.ts` + `login-log-429-ratchet.unit-spec.ts`: `rg 'clearLoginThrottle|unlockUser|USER_UNLOCKED|auth-users'` → **0**.
- `route-verdicts.ts:85,90,116` (`AuthController#revokeSession/revokeOtherSessions/logout`) và
  `param-uuid-verdicts.ts:316` khoá theo **controller#method**, không theo chữ ký service ⇒ đổi chữ ký
  *service* vô hại. (W5 — v1 kết luận đúng nhưng chưa có bằng chứng này.)
- `supertest-listen-census.ts:268-272` + `supertest-listen-ratchet.unit-spec.ts`: spec MỚI **phải**
  `app.listen(0)` **và** `app.close()` (memory `supertest-closes-shared-server-on-first-response`).

### 2k. Cổng quyền 6 route admin — công thức ĐÃ chứng minh chạy

| route | cặp | `isSensitive` |
| --- | --- | --- |
| `POST …/lock` | `lock:user` (`auth-users.controller.ts:99`) | false |
| `POST …/unlock` | `unlock:user` (`:110`) | false |
| `POST …/login-throttle/clear` | `unlock:user` (`:137`) | false |
| `POST …/2fa/reset` | `reset-2fa:user` (`:153-155`) | **true** |
| `DELETE …/:id` | `delete:user` (`:170`) | **true** |
| `POST …/restore` | `restore:user` (`:184`) | **true** |

`seedUserRole(direct, adminId, "00000000-0000-0000-0000-000000000001", companyId)` + login HTTP thật đã
cho **204** ở `unlock:user` (`auth-s18-unlock429-e2e.int-spec.ts:218,256,278`), **200** ở cặp *sensitive*
`reset-password:user` (`auth-s18-seceventmeta-1.int-spec.ts:91,263`) và **200** ở `delete:user`/`restore:user`
(`authusers-admin-http.int-spec.ts:125,214-220,257`). ⇒ dùng ĐÚNG công thức đó.
⚠️ **CẤM "sửa" 403 bằng cách nới cổng** (điều cấm kế thừa §2l của #486).

### 2l. `clearLoginThrottle` đi qua HTTP được — và ghi vết TRƯỚC khi có thể ném 503

`auth-s18-unlock429-e2e.int-spec.ts:218,256,278` gọi `POST …/login-throttle/clear` và nhận **204**
⇒ Valkey có mặt trong môi trường int-spec. Thêm nữa, `auth-users.service.ts:447-483` ghi audit +
security-event **trước** câu `throw ServiceUnavailable` khi `!ok` ⇒ kể cả nhánh 503 vẫn **có hàng để đo**.

### 2m. `revokeAllForUserTx` KHÔNG ghi security-event

Chỉ UPDATE `user_sessions`/`refreshTokens` + `severUserSessions` (kế thừa §2f của #486, đã xác minh lại)
⇒ `lockUser`/`deleteUser`/`resetTwoFactor` **không** đẻ thêm hàng `SESSION_REVOKED` làm nhiễu phép đo.

### 2n. ⚠️ `revokeOtherSessions` THOÁT SỚM khi không có phiên nào khác

`auth.service.ts:1386` — `if (targets.length === 0) return 0;` **trước** mọi lệnh ghi ⇒ user chỉ có 1 phiên
thì **0 hàng** `SESSION_REVOKED`, ca không bao giờ xanh. Tiền lệ dựng đúng: `auth-session-selfservice.int-spec.ts:201-203`
(login 3 lần) · `security-event-emit-sites.int-spec.ts:320-323` (login 2 lần). Xử ở §5 cột «dựng trạng thái».

---

## §3 — Quyết định thiết kế

### D0 — Nâng zone `yellow` → `red` + **gate FULL**, ở BƯỚC 0

`harness/policy.md` xếp 🔴 cho diff chạm "audit · auth (login/token)"; CLAUDE.md §6 đòi FULL gate khi
diff chạm `audit`/`auth`. Diff này sửa `auth.service.ts` (logout / thu hồi phiên) **và** — do D3 — thêm
`ip`/`userAgent` vào 9 hàng `audit_logs`. WO anh em cùng hình dạng (`S18-AUTH-SECEVENTMETA-1`) là
`zone:'red'`. Seed để `yellow` là **đo thiếu**, không phải quyết định.

⇒ **Gate FULL**: `security-reviewer` + `database-reviewer` + `silent-failure-hunter`.
⇒ Không auto-commit; **người chốt** trước merge.

### D1 — `meta: RequestMeta` **BẮT BUỘC**, đặt **CUỐI** danh sách tham số

Không `= {}`: mặc định biến "caller quên" thành lỗi im lặng lúc chạy thay vì lỗi lúc biên dịch — chính
lớp lỗi cả họ WO `S18-AUTH-*META` đang đóng. Kế thừa D1 của #486.

| method | chữ ký MỚI |
| --- | --- |
| `AuthService.logout` | `(refreshToken: string, meta: RequestMeta)` |
| `AuthService.revokeSession` | `(companyId, userId, sessionId, meta: RequestMeta)` |
| `AuthService.revokeOtherSessions` | `(companyId, userId, currentSessionId: string \| undefined, meta: RequestMeta)` |
| `AuthUsersService.resetTwoFactor` | `(actor, id, meta: RequestMeta)` |
| `AuthUsersService.lockUser` | `(actor, id, reason: string \| undefined, meta: RequestMeta)` ← **D2** |
| `AuthUsersService.unlockUser` | `(actor, id, meta: RequestMeta)` |
| `AuthUsersService.clearLoginThrottle` | `(actor, id, meta: RequestMeta)` |
| `AuthUsersService.deleteUser` | `(actor, id, meta: RequestMeta)` |
| `AuthUsersService.restoreUser` | `(actor, id, meta: RequestMeta)` |

«CUỐI» là quy ước duy nhất cho cả 9 ⇒ không method nào bắt người đọc nhớ ngoại lệ.
`revokeOtherSessions` đã khai `currentSessionId: string | undefined` (**không** `?`) nên nối tham số bắt
buộc là hợp lệ ngay.

### D2 — `lockUser`: `reason?: string` → `reason: string | undefined`, **KHÔNG đảo thứ tự**

| lối | diff | rủi ro |
| --- | --- | --- |
| **CHỌN** — `reason: string \| undefined` giữ vị trí 3, `meta` vị trí 4 | 5 điểm spec + 1 int-spec thêm `undefined`/`meta` | 0 — vẫn "chỉ THÊM đối số" ở mọi call-site đã truyền `reason` |
| BÁC — `(actor, id, meta, reason?)` | ít ký tự hơn | đảo thứ tự đối số ở một method vùng auth; `meta` hết «CUỐI» ⇒ vỡ quy ước D1 |

`auth-users.controller.ts:105` truyền `dto.reason` (`string | undefined`) ⇒ **0 thay đổi kiểu**, chỉ thêm
đối số thứ 4.

### D3 — Nối luôn 9 hàng `audit_logs` ANH EM cùng tx — **mở rộng CÓ CHỦ Ý, nói thẳng trong PR**

`done_when` gạch 1 chỉ nói 9 hàng `user_security_events`. Vẫn làm cả 9 hàng `audit_logs` §2d, vì:

1. **`meta` đã trong scope** sau D1 ⇒ mỗi hàng đúng **2 dòng**; 0 sợi dây mới, 0 tham số mới.
2. **Tiền lệ của chính họ WO này**: #486 nối `PASSWORD_RESET_BY_ADMIN` thì nối luôn audit
   `user.password_reset_by_admin` cùng tx; `recordFailedLockClear` ghi CẢ HAI hàng có ip/UA
   (`auth-users.service.ts:749-750` ↔ `:758-759`).
3. **Không bỏ nửa chừng hot-file vùng auth**: để hàng audit câm cạnh hàng security-event có vết nghĩa là
   một WO thứ hai phải mở lại **đúng 9 method này** — CLAUDE.md §9.3 nói hot-file là chỗ gom lượt chạm.
4. **0 chủ khác** (§2d).

Đã xác minh **0 assert vỡ**: mọi assert hiện có trên hai hàm ghi dùng `objectContaining`/đọc thuộc tính,
không `toEqual` nguyên vật (`auth-users.service.spec.ts:149-156, 184-187, 203-206, 262, 370-375, 864-877`).
`audit.record` **đã** nhận `ip?`/`userAgent?` (dùng ở 20+ điểm trong chính hai file này) ⇒ additive.

⚠️ Chính D3 là thứ kéo `audit` vào diff ⇒ củng cố **D0** (gate FULL). Mở rộng này **phải vào PR body**.

### D4 — `payload` KHÔNG được đụng tới

Không thêm/bớt/đổi một khoá nào của `payload` ở cả 9 điểm. Lý do sống còn: **`payload.reason` /
`payload.scope` chính là thứ D5 dùng để phân biệt họ** (§2b) — sửa nó là vừa đổi dữ liệu forensics đang có
vừa tự làm hỏng phép đo của mình. Kế thừa D3 của #486.

### D5 — Hợp đồng phép đo: **4 vế**, không phải 3

1. **HTTP THẬT.** Khiếm khuyết ở dây controller→service. `security-event-emit-sites.int-spec.ts` gọi
   **thẳng service** cho 5/9 method (`:284, :304, :326, :379, :399`); sau D1 nó **tự truyền `meta`** ⇒ spec
   viết theo khuôn đó xanh kể cả khi controller quên. **Đây là bẫy xanh-RỖNG trung tâm.** Mọi ca mới bắt
   đầu bằng `supertest` và đọc bảng qua `directPool`.
2. **WHERE phải mang KHOÁ CHỦ THỂ + lọc họ + `rowCount === 1`.** (v1 thiếu vế khoá chủ thể — B4.)
   - `user_security_events`: `WHERE user_id = $subject AND event_type = $type` **+** lọc họ khi cần
     (`payload->>'scope'` cho `SESSION_REVOKED`; `payload->>'reason' IS NULL` / `= 'login_throttle'` cho
     `USER_UNLOCKED`).
   - `audit_logs`: `WHERE object_id = $obj AND action = $action` — ⚠️ `$obj` là **`sessionId`** cho
     `§revoke-one` (`auth.service.ts:1355`), là `userId` cho 9 ca còn lại. Một bản sao helper
     `auditRow(userId, action)` của #486 sẽ trả **0 hàng** cho ca đó.
3. **Assert GIÁ TRỊ**, không `not.toBeNull()`: `userAgent === UA` của **đúng request đang đo** + `ip` khớp
   `LOOPBACK`.
4. **Neo chống-nhiễu `PREP_UA` / `VICTIM_UA`.**
   - 6 ca đường admin (#4–#9): nạn nhân **phải** login trước bằng `VICTIM_UA` rồi assert
     `userAgent !== VICTIM_UA` **và** `actorUserId === admin.id` — nếu không, ca chỉ chứng minh "vũ trụ
     này có đúng một UA" (D6 của #486).
   - 2 ca có bước **dựng trạng thái bằng chính API admin** (`§unlock` phải lock trước, `§restore` phải
     delete trước): bước dựng chạy với **`PREP_UA`**, ca đo assert `userAgent !== PREP_UA`. Đây là vai trò
     tương đương `MINT_IP` của #486 — chứng minh giá trị đến từ **request đang đo**, không phải chép từ
     request trước.

### D6 — Tái dùng `requestMeta`, KHÔNG viết biểu thức thứ ba

`auth.controller.ts` dùng `this.meta(req)`; `auth-users.controller.ts` dùng `requestMeta(req)` (đã import
`:18`). **Cấm** dựng lại `{ ip: req.ip, userAgent: req.headers['user-agent'] }` ở bất kỳ đâu.

### D7 — LUẬT VÁ 39 call-site: **CHỈ THÊM đối số, CẤM đổi assert đang có**

29 unit + 10 int-spec (§2f). Thêm `{}` (hoặc `undefined, {}` cho `lockUser`) và **không chạm** một ký tự
`expect(...)`. Một assert bị nới trong lượt "vá cho biên dịch được" là cách kinh điển biến ca đang canh gác
thành ca xanh-rỗng (memory `tests-can-pin-a-hole-open`).

⚠️ **Khác #486, ở đây KHÔNG có điểm nào «nhận meta THẬT»** — không ca cũ nào đang đo ip/UA của 9 điểm này
(chúng vốn NULL) ⇒ luật vá áp **đồng nhất** cho cả 39, không ngoại lệ phải đếm lại.

### D8 — 9 điểm ghi PHẢI có ≥1 ca đột biến RIÊNG (⇒ **10 ca**, vì #1 có 2 đường)

`done_when` gạch 5. Một ca phủ hai điểm cùng lúc là chỗ để một điểm bị bỏ quên đi qua cổng. Bảng
điểm↔ca ở §5.

---

## §4 — Các bước (TEST TRƯỚC — cổng RED tường minh)

Thứ tự bắt buộc (CLAUDE.md §6 + §9.4).

0. **`harness/backlog.mjs`** — `zone: 'red'` (D0) · thêm `plan: 'docs/plans/S18-AUTH-SECEVENTREST-1.md'` ·
   mở rộng `paths` thêm `apps/api/test/integration/auth-logout.int-spec.ts`,
   `apps/api/test/integration/security-event-emit-sites.int-spec.ts`, `docs/plans/S18-AUTH-SECEVENTREST-1.md`
   (D7 bắt sửa hai file đó; `paths` lái cả `guard-scope` lẫn gate — memory `wo-paths-drive-gate-and-scheduler`)
   · `notes` ghi «KHÔNG chạy song song với `S18-AUTH-RESTORE2FA-1`» (§2e W2).
1. **Viết int-spec mới** `apps/api/test/integration/auth-s18-seceventrest-1.int-spec.ts` — 10 ca §5, khuôn
   `auth-s18-seceventmeta-1.int-spec.ts` (+ helper cookie của `auth-session.int-spec.ts:41-51`).
   `app.listen(0)` + `app.close()` (§2j).
2. **Chạy RED**:

   ```bash
   bash scripts/lane-db-setup.sh s18seceventrest       # tạo DB `mediaos_s18seceventrest` + migrate
   bash harness/check.sh --lane-db=s18seceventrest     # tự nạp .env + export 3 mật khẩu DB
   ```

   ⚠️ **KHÔNG** dùng `LANE_DB=s18seceventrest pnpm …`: `LANE_DB` là **TÊN DB nguyên văn**
   (`apps/api/test/db-target.ts:138-139` dựng `postgres://…@host/${lane}`; tiền tố `mediaos_` do
   `scripts/lane-db-setup.sh:21` sinh), và `requirePassword` (`db-target.ts:83-101`) **THROW** khi thiếu
   `APP_DB_PASSWORD`/`SUPERUSER_DB_PASSWORD`/`WORKER_DB_PASSWORD`. Lệnh trần cho ra lỗi **cấu hình**, và
   §8 sẽ được tick bằng một màu đỏ **sai nguyên nhân**. (Muốn chạy tay: `export LANE_DB=mediaos_s18seceventrest`
   kèm 3 biến mật khẩu.)
   ⇒ kỳ vọng **10/10 ĐỎ** vì `ip_address`/`user_agent` NULL. Dán output vào §8.
3. **`auth.service.ts`**: 3 chữ ký (D1) + 3 điểm `securityEvents.record` + 3 hàng `audit.record` (D3).
4. **`auth.controller.ts`**: 3 handler → **4 điểm gọi** truyền `this.meta(req)` (`:141` cookie **và** `:143` body — §2g).
5. **`auth-users.service.ts`**: 6 chữ ký (D1 + D2) + 6 điểm `securityEvents?.record` + 6 hàng `audit.record` (D3).
6. **`auth-users.controller.ts`**: 6 handler truyền `requestMeta(req)`.
7. **Vá 39 call-site** (D7) — **đếm lại trước khi vá**, chỉ thêm đối số.
8. **Chạy GREEN**: lệnh bước 2 ⇒ 10/10 xanh.
9. **9 lượt đột biến** (D8): gỡ `ip`/`userAgent` khỏi từng điểm một, xác nhận ca tương ứng ĐỎ, khôi phục.
10. `bash harness/check.sh --all --lane-db=s18seceventrest` XANH.
11. **Gate FULL** (D0) trên diff → PR → người chốt. Sau merge: `backlog.mjs` `status:'done'` + `pr` + regen STATUS.

---

## §5 — Ca kiểm (RED trước) — 10 ca / 9 điểm

Tất cả trong `auth-s18-seceventrest-1.int-spec.ts`. **Mỗi ca một user riêng.**
`UA` = UA của request ĐANG ĐO · `PREP_UA` = UA của bước dựng trạng thái · `VICTIM_UA` = UA của nạn nhân.

| ca | điểm | dựng trạng thái (thứ tự bắt buộc) | HTTP đo | `user_security_events` WHERE | `audit_logs` WHERE |
| --- | --- | --- | --- | --- | --- |
| `§logout-cookie` | #1 | login(UA) → giữ `Set-Cookie` (refresh + csrf) | `POST /auth/logout` + `Cookie` + `x-csrf-token` | `user_id=u ∧ SESSION_REVOKED ∧ scope='family'` | `object_id=u ∧ auth.logout` |
| `§logout-body` | #1 | login(UA) → lấy `refreshToken` từ body | `POST /auth/logout` body | như trên (**user khác**) | như trên |
| `§revoke-one` | #2 | login(UA) → `GET /auth/sessions` lấy `sessionId` | `POST /auth/sessions/:sid/revoke` | `user_id=u ∧ SESSION_REVOKED ∧ scope='single'` | ⚠️ `object_id=`**`sid`** `∧ auth.session_revoked` |
| `§revoke-others` | #3 | login(UA) **2 LẦN** (§2n — 1 phiên ⇒ thoát sớm, 0 hàng) | `POST /auth/sessions/revoke-others` | `user_id=u ∧ SESSION_REVOKED ∧ scope='others'` | `object_id=u ∧ auth.session_revoked` |
| `§2fa-reset` | #4 | victim login(VICTIM_UA); admin login(ADMIN_UA) | `POST /auth/users/:v/2fa/reset` | `user_id=v ∧ TOTP_RESET` | `object_id=v ∧ user.2fa_reset` |
| `§lock` | #5 | như trên | `POST /auth/users/:v/lock` | `user_id=v ∧ USER_LOCKED` **+ neo `actor=admin`** | `object_id=v ∧ user.locked` |
| `§unlock` | #6 | victim login(VICTIM_UA) → admin **lock** bằng `PREP_UA` | `POST /auth/users/:v/unlock` (ADMIN_UA) | `user_id=v ∧ USER_UNLOCKED ∧ payload->>'reason' IS NULL` | `object_id=v ∧ user.unlocked` |
| `§throttle-clear` | #7 | victim login(VICTIM_UA); admin login(ADMIN_UA) | `POST /auth/users/:v/login-throttle/clear` | `user_id=v ∧ USER_UNLOCKED ∧ reason='login_throttle'` | `object_id=v ∧ user.login_throttle_cleared` |
| `§delete` | #8 | victim login(VICTIM_UA); admin login(ADMIN_UA) | `DELETE /auth/users/:v` | `user_id=v ∧ USER_DELETED` | `object_id=v ∧ user.deleted` |
| `§restore` | #9 | victim login(VICTIM_UA) → admin **delete** bằng `PREP_UA` | `POST /auth/users/:v/restore` (ADMIN_UA) | `user_id=v ∧ USER_RESTORED` | `object_id=v ∧ user.restored` |

**Neo bắt buộc:**

- **`§lock`**: `actorUserId === admin.id`. `USER_LOCKED` có writer thứ hai (`auth.service.ts:2451`
  `emitAccountLocked`, `actor_user_id` = chính user) ⇒ thiếu neo thì một hàng auto-lock lọt vào là ca xanh
  nhầm hàng.
- **`§unlock` ≠ `§throttle-clear`**: hai user KHÁC NHAU, và lọc `payload->>'reason'` là thứ chứng minh đúng
  họ (3 họ `USER_UNLOCKED` — §1).
- **`§revoke-one` ≠ `§revoke-others`**: hai user KHÁC NHAU (cùng user ⇒ 2 hàng `SESSION_REVOKED`).
- **`§logout-cookie` ≠ `§logout-body`**: hai user KHÁC NHAU.
- **`§delete` ≠ `§restore`**: hai user KHÁC NHAU; `§restore` **tự dựng** trạng thái deleted ⇒ không phụ thuộc
  thứ tự `it()`.
- **6 ca admin** (#4–#9): `userAgent !== VICTIM_UA` + `actorUserId === admin.id`.
- **`§unlock` · `§restore`**: thêm `userAgent !== PREP_UA` (D5.4).
- **`audit_logs` cũng có họ trùng** (W6): `user.login_throttle_cleared` có **3** writer
  (`auth-users.service.ts:449` admin · `:747` `recordFailedLockClear` · `auth.service.ts:1942` đường reset)
  và `auth.session_revoked` có 2 với `object_id` khác ngữ nghĩa ⇒ WHERE của D5.2 là bắt buộc cho **cả hai bảng**.

---

## §6 — Rủi ro

| # | rủi ro | vì sao thật | chặn bằng |
| --- | --- | --- | --- |
| R1 | **Ca xanh-RỖNG vì gọi thẳng service** | `security-event-emit-sites.int-spec.ts` làm đúng vậy cho 5/9 method; sau D1 nó tự truyền meta | D5.1 — mọi ca qua `supertest`; checklist review: 0 lời gọi thẳng service trong spec mới |
| R2 | **Xanh-RỖNG vì chỉ đo đường body của `logout`** | web dùng cookie; supertest không tự mang cookie | §2g + 2 ca `§logout-*` |
| R3 | **Nhầm hàng giữa các họ trùng, ở CẢ HAI bảng** | 3 họ `USER_UNLOCKED` · 3 writer `SESSION_REVOKED` · 2 writer `USER_LOCKED` · 3 writer `user.login_throttle_cleared` | D5.2 — WHERE khoá chủ thể + lọc họ + `rowCount===1` + user riêng + neo `actorUserId` |
| R4 | **`§revoke-others` đỏ vĩnh viễn** | `auth.service.ts:1386` thoát sớm khi 0 phiên khác | §5 — login 2 lần |
| R5 | **`auditRow(userId, …)` trả 0 hàng ở `§revoke-one`** | audit ghi `objectId: sessionId` (`:1355`) | D5.2 — helper nhận `objectId`, không nhận `userId` |
| R6 | **Vá 39 call-site làm nới assert** | lượt "vá cho biên dịch được" | D7 — `git diff` phải cho thấy **0** dòng `expect(` bị đổi ở 3 file spec |
| R7 | **`lockUser` TS1016** | §2i | D2 |
| R8 | **`§throttle-clear` giòn theo Valkey** | ném 503 khi `!ok` | §2l — có tiền lệ 204; và hàng vết ghi TRƯỚC câu ném ⇒ vẫn đo được |
| R9 | **Bằng chứng RED sai nguyên nhân** | `LANE_DB` là tên DB, `requirePassword` throw | §4 bước 2 — dùng `lane-db-setup.sh` + `check.sh --lane-db=` |
| R10 | **Mở rộng D3 vượt `done_when`** | 9 hàng audit không trong gạch 1 | D3 — có số đo, 0 chủ khác, 0 assert vỡ, ghi vào PR body |
| R11 | **Xung đột với `S18-AUTH-RESTORE2FA-1`** | WO đó có `paths` gồm CẢ HAI file và sở hữu `restoreUser` | §2e — bước 0 ghi `notes` cấm chạy song song |
| R12 | **Ratchet `supertest-listen`** | spec mới phải `listen(0)` + `close()` | §2j |

---

## §7 — Nợ để lại (CÓ CHỦ Ý)

- **N1** — 4 hàng `audit_logs` **không** kèm một trong 9 điểm security-event vẫn vô danh:
  `auth.token_refreshed` · `auth.token_reuse_detected` (`auth.service.ts`) · `user.created` · `user.updated`
  (`auth-users.service.ts`). Ở method **ngoài** 9 method của WO ⇒ mở rộng tới đó là kéo thêm 4 chữ ký +
  call-site mà `done_when` không đo.
- **N2** — Vế 2FA (`REAUTH_FAILED` context `2fa_disable`/`2fa_enable` · audit `auth.2fa_disable_denied`)
  thuộc **`S18-AUTH-RESTORE2FA-1`** (§2e). Sau WO này `REAUTH_FAILED` vẫn NULL ở hai context đó — phân biệt
  được bằng `payload.context`, y như N2 của #486.
- **N3** — Không có ca đo cho nhánh **lỗi** (403/404/400) của 9 method: chúng ném **trước** mọi mutation ⇒
  0 hàng ghi ⇒ không có gì để đo. Không phải khoảng trống, là bản chất.
- **N4** *(mới — B5)* — **5 điểm ghi `user_security_events` KHÔNG có chủ**, ngoài `paths`:
  `two-factor.service.ts:209` `TOTP_ENABLED` · `:324` `TOTP_DISABLED` · `step-up/step-up.service.ts:214`
  `STEP_UP_GRANTED`/`STEP_UP_FAILED` · `permission/permission-admin.service.ts:151` `ROLE_ASSIGNED` ·
  `:288` `ROLE_REMOVED`. ⇒ đề xuất seed **`S18-AUTH-SECEVENT-XREST-1`** (chạm `permission/` ⇒ vùng đỏ riêng).
- **N5** *(mới — W3)* — **Luồng thông tin MỚI, quyết định có ý thức.**
  `me-security-activity.repository.ts:107-108` select `ip_address`/`user_agent` của `user_security_events`
  theo `user_id = <người gọi>`, phục vụ `GET /me/security/activity` sau cặp **non-sensitive Own-scope**
  `('access','me')`. ⇒ sau WO này, **6 hàng admin→nạn nhân** (#4–#9) mang ip/UA **của admin**, và nhân viên
  thường đọc được.
  ⚠️ **Bổ sung sau gate (security-reviewer, MEDIUM)** — census luồng đọc ở trên **THIẾU đường thứ hai**:
  `GET /auth/security-events` (`auth-logs-viewer.service.ts:367-368, 388-389`) trả `ip_address`/`user_agent`
  **THÔ, không mask**. Đã đo cổng: `@RequirePermission("view","audit-log",{isSensitive:true})`
  (`auth-logs-viewer.controller.ts:40`) + migration `0340_ac8_observability.sql:31,36-40` seed cặp
  `is_sensitive=true` **chỉ grant `company-admin`** ⇒ wildcard `*:*` KHÔNG kế thừa ⇒ phơi bày là
  **admin→admin**, KHÔNG phải lỗ. Ghi ra đây để người đọc sau không tin nhầm «chỉ có đường `/me` và nó đã mask».

  **Giảm nhẹ đã có sẵn ở server**: `maskIp` trả `a.b.*.*` (IPv4 /16 — `me-security-activity.util.ts:16-22`)
  kèm `summarizeUserAgent` (nhãn thiết bị, không phải UA thô) — raw **không bao giờ rời service**.
  **Tiền lệ đã ship**: #486 tạo đúng hình dạng này cho `PASSWORD_RESET_BY_ADMIN`.
  ⇒ **Giữ** (transparency của timeline bảo mật CỦA CHÍNH người dùng), ghi vào PR body.
  ❓ **Câu hỏi cho owner**: có muốn che ip/UA ở DTO `/me/security/activity` khi `actor_user_id ≠ user_id`
  (hàng admin thao tác lên mình) không? Nếu có → WO riêng, KHÔNG nhét vào đây.
- **N6** *(mới — security-reviewer MEDIUM, 2026-09-08)* — **hai cột không nhãn giờ mang HAI nghĩa.**
  `user_security_events.ip_address`/`user_agent` (`auth-logs.ts:81-82`): với 3 điểm self-service (#1–#3) là
  thiết bị của **chủ thể**; với 6 điểm admin (#4–#9) là thiết bị của **actor**, trong khi `user_id` vẫn là nạn
  nhân và **không cột/cờ nào phân biệt**. FE `MeSecurityActivityPage.tsx` render nhãn CHUNG ⇒ chủ tài khoản đọc
  «Tài khoản bị khoá — Chrome trên Windows, 203.0.\*.\*» dễ hiểu thành máy của CHÍNH MÌNH. Nhất quán với tiền
  lệ #486 nên KHÔNG chặn WO này; sửa ở WO riêng: gắn nhãn «thao tác bởi quản trị viên», hoặc ẩn ip/device khi
  `actor_user_id ≠ user_id`. Gộp cùng câu hỏi owner ở N5.
- **N7** *(mới — LOW)* — `user_agent` là `text` **không trần** và repo có **0 điểm cắt độ dài UA**
  (khác `login-rate-limiter.ts:299` có cắt `ip`). WO thêm 18 hàng vào bề mặt đã có 30+ điểm ghi cùng hình dạng
  ⇒ nhất quán, không do WO này đẻ ra. WO sau: cắt UA ở writer.

---

## §8 — Bằng chứng (ĐÃ CHẠY 2026-09-07, lane `mediaos_s18seceventrest`)

- [x] **RED**: `10/10 failed` TRƯỚC khi sửa src, và **mọi** lỗi là `AssertionError: <what>: expected null to be '<UA>'` — đúng khiếm khuyết, không phải lỗi dựng. Quan trọng không kém: mọi ca đã **qua được** assert `rowCount === 1` ⇒ hợp đồng WHERE của D5.2 (lọc họ `scope`/`reason`, `object_id = sessionId` cho `§revoke-one`) đo **đúng một hàng** ngay từ lượt đỏ.
- [x] **GREEN**: `10/10 passed` sau khi nối dây. `tsc --noEmit` exit 0.
- [x] **Bề mặt caller đo bằng trình biên dịch, không bằng grep**: sau khi đổi 9 chữ ký, `tsc` liệt kê **đúng 39** lỗi TS2554 — 29 ở `auth-users.service.spec.ts` + 10 ở hai int-spec, khớp từng dòng với §2f (kể cả 10 điểm `clearLoginThrottle`). Đây là phép đối chiếu độc lập cho con số 39 (v1 cộng nhầm 38).
- [x] **Cổng đột biến: 20/20** — mỗi lượt gỡ ip/userAgent ở ĐÚNG MỘT điểm ghi, chạy lại cả file:

  | mutation | ca ĐỎ | | mutation | ca ĐỎ |
  | --- | --- | --- | --- | --- |
  | `SE1` / `AU1` (logout) | `§logout-cookie` + `§logout-body` | | `SE5` / `AU5` | `§lock` |
  | **`CTL-COOKIE`** (bỏ `meta` ở `auth.controller.ts:141`) | **chỉ** `§logout-cookie` | | `SE6` / `AU6` | `§unlock` |
  | **`CTL-BODY`** (bỏ `meta` ở `:143`) | **chỉ** `§logout-body` | | `SE7` / `AU7` | `§throttle-clear` |
  | `SE2` / `AU2` | `§revoke-one` | | `SE8` / `AU8` | `§delete` |
  | `SE3` / `AU3` | `§revoke-others` | | `SE9` / `AU9` | `§restore` |
  | `SE4` / `AU4` | `§2fa-reset` | | | |

  ⇒ cả **18** hàng (9 security-event + 9 audit của D3) có ca canh gác RIÊNG, và **hai đường gọi `logout`
  tách bạch được** — đóng đúng lỗ B7 của plan-reviewer (nối dây đường body mà quên đường cookie thì
  `§logout-cookie` đỏ một mình).
- [x] **LUẬT VÁ D7 đo được**: `git diff -U0` trên 3 file spec → 38 dòng `-`/`+`, **38/38 chỉ khác đúng
  đối số vừa thêm** (chuẩn hoá bằng cách bỏ `, {})` / `, undefined, {})` rồi so bằng); dòng `+` thứ 39
  là `{},` chèn thuần cho lời gọi nhiều dòng. **0 assert bị nới.**
- [x] `bash harness/check.sh --all --lane-db=s18seceventrest` → **XANH** (9/9): secret-literals · lint ·
  typecheck · migration-no-drop · tooling-tests · test `[chunked]` với `LANE_DB=mediaos_s18seceventrest`
  (KHÔNG phải trạng-thái-thứ-ba «XANH KHÔNG ĐỦ BẰNG CHỨNG») · build · prod-tenant-check ·
  db-readiness (FORCE RLS 0 bảng thiếu · append-only 0 grant UPDATE/DELETE trên 9 bảng ledger).
- [x] **Gate FULL (2026-09-08) — cả 3 PASS**, 0 CRITICAL / 0 HIGH:
  - `security-reviewer` **PASS** — đo LẠI độc lập (không tin lời khai §8): luật vá D7 (38 `-`/39 `+`, dòng `+`
    dư là `{},` thuần) · census 39 call-site trên `apps/**`+`packages/**`+`harness/**` → 0 sót · D4 (`payload`
    nguyên) · D6 (cả 10 điểm đi qua `requestMeta()`, 0 biểu thức thứ ba) · 4 điểm gọi `logout`. Nguồn `ip` =
    `req.ip` dưới `trust proxy` mặc định `false` (PROD `loopback`) ⇒ KHÔNG tin XFF vô điều kiện. 5 bất biến ✓
    (tenant · audit append-only · secret · authz · authn).
  - `database-reviewer` **PASS** — 18 điểm ghi nằm trong `withTenant` sẵn có · 0 `UPDATE`/`DELETE` mới lên bảng
    append-only · WHERE 10 ca khoá đúng 1 hàng (`§revoke-one` vs `§revoke-others` khác KHÔNG GIAN `object_id`)
    · `cleanupTenants` dọn cả `audit_logs` + `user_security_events` ⇒ lane DB không tích rác.
  - `silent-failure-hunter` **PASS** — `securityEvents?.record` có lưới fail-fast lúc boot
    (`users.module.ts:52-65`) · `§revoke-others` login 2 lần nên đường ghi chạy thật · 18 điểm `ip: meta.ip`
    đếm bằng máy · 0 `try`/`catch`/`.catch()` mới · 0 dòng `expect(` bị đụng ở 3 file spec.
  - **Đã vá sau gate**: neo `expect(current).toBeTruthy()` trước `.find(...).id` (LOW — ném `TypeError` thay
    vì `AssertionError`). Chạy lại spec sau khi vá: xem ô GREEN-2 dưới.
  - **KHÔNG vá (có số đo)**: `npx prettier --check` đỏ trên `auth-users.service.spec.ts` — **bản HEAD đỏ y
    hệt** (prettier muốn đổi **405 dòng ở CẢ HAI bản**, file 980 dòng chưa từng được format) ⇒ 5 dòng dài của
    WO không đẻ nợ mới, và chạy `prettier --write` ở đây là churn 405 dòng ngoài phạm vi. CI (`ci.yml:88`) +
    `check.sh` chỉ chạy `lint`, không có cổng prettier.
  - **Chuyển thành nợ/WO sau** (2 MEDIUM — không chặn diff): xem N5 (đường đọc thứ hai) và N6 (hai nghĩa).
- [ ] Người chốt trước merge (zone 🔴 — D0)

## §9 — Rollback

Revert commit là đủ: **0 migration · 0 contracts · 0 seed · 0 trạng thái ngoài DB**. Hàng đã ghi với ip/UA
không cần dọn (append-only, giá trị đúng). Không có cờ/env nào phải hoàn tác.
