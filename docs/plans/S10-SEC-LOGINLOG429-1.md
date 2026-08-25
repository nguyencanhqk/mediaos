# S10-SEC-LOGINLOG429-1 — KI-047 + KI-048

> Vùng **ĐỎ** · FULL gate · NGƯỜI CHỐT merge (không gắn nhãn auto-merge).
> Nguồn việc: `harness/backlog.mjs` → `S10-SEC-LOGINLOG429-1`. Sổ nợ: RELEASE-02 → KI-047, KI-048.
>
> **v2 (25/08)** — sau vòng `plan-reviewer` BLOCK 9 blocker. Mọi đoạn v1 bị bác đã VIẾT LẠI, không
> vá đè. Ô "đã sửa gì" ở §9.

---

## §0.0 — MỨC ĐỘ, VÀ VÌ SAO KHÔNG GỘP HAI KI (done_when #1)

Cả hai là **mất tầm nhìn của bên phòng thủ**, KHÔNG phải rò rỉ dữ liệu: không hàng nào bị lộ sai
tenant, không quyền nào bị vượt. Nhưng hai cái **khác nguồn gốc và phải đóng riêng**:

- **KI-047 = lỗ CÓ SẴN.** Năm đường 429 chưa bao giờ ghi một dòng nào, từ ngày viết.
- **KI-048 = hệ quả DO chính bản vá `S6-SEC-LOGINLOG-2` sinh ra.** Trước bản vá đó hàng `blocked`
  ghi `company_id NULL` nên admin không thấy; sau bản vá nó gắn đúng chủ ⇒ **hiện lên** màn admin
  với tốc độ sinh do kẻ tấn công điều khiển.

⇒ Gộp chúng thành "một việc ghi log" là mất đúng bài học: **mỗi lần thêm một đường ghi nhật ký, phải
hỏi ngay ai điều khiển tốc độ sinh hàng.** Bản vá này thêm 4 đường ghi mới ⇒ câu hỏi đó áp cho cả 4,
không riêng cho hàng cũ của KI-048.

---

## §0.1 — SỐ ĐO: điểm ném `TOO_MANY_REQUESTS` (đo lại 24-25/08, không chép sổ)

| # | Vị trí | Hàm | Bucket |
| --- | --- | --- | --- |
| 1 | `auth.service.ts:271` | `login` | `ip` + `acct` |
| 2 | `auth.service.ts:474` | `completeTwoFactorLogin` | `2fa` (companyId\|sub) |
| 3 | `auth.service.ts:595` | `disableTwoFactor` | `2fa-disable` |
| 4 | `auth.service.ts:630` | `changePassword` | `change-pw` |
| 5 | `two-factor.service.ts:194` | `confirmEnable` | `2fa-enable` |
| 6 | `step-up/step-up.service.ts:122` | `stepUp` | `stepup` |

**= 6 điểm ném, KHỚP sổ đã đính chính 24/08** (plan-reviewer đối chiếu độc lập từng dòng, cũng ra 6).
⇒ **KHÔNG phải sửa sổ lần nữa** (done_when #2 đã thoả).
4 hit còn lại của grep = assert trong `step-up.service.spec.ts:224,237,292,307`.
Chỉ #1 ghi `login_logs` ⇒ **5 đường 429 không ghi**.

## §0.2 — KHUNG KI-047 HẸP HƠN SỰ THẬT (đo thêm)

`completeTwoFactorLogin` (`auth.service.ts:452-577`):

| Nhánh | Dòng | `claims` đã có? | `login_logs` |
| --- | --- | --- | --- |
| challengeToken hỏng/hết hạn → 401 | :461 | **CHƯA** (verify vừa ném) | 0 dòng |
| challengeToken **replay** (jti đã claim) → 401 | :467 | **RỒI** (verify xong ở :459) | 0 dòng |
| bucket `2fa` đang khoá → **429** | :474 | RỒI | 0 dòng ← KI-047 chỉ thấy dòng này |
| **mã TOTP/recovery SAI → 401** | :490 | RỒI | 0 dòng |
| công ty ngừng hoạt động → 401 | :558 | RỒI | 0 dòng (chỉ `audit_logs`) |
| thành công → 200 | :570 | RỒI | 1 dòng `success` |

Bước-1, nhánh `result.kind === "2fa"` (`auth.service.ts:424-427`) trả `challengeToken` rồi `return`
— **0 dòng**.

⇒ **Với tài khoản BẬT 2FA, `login_logs` (AUTH-API-401) chỉ chứa THÀNH CÔNG.** Vá riêng nhánh 429 để
lại lỗ lớn hơn cái vừa vá: 429 chỉ xuất hiện SAU `LOGIN_MAX_ATTEMPTS` lần sai mà không lần nào có vết.
⇒ **Phạm vi mở rộng có chủ ý**: vá cả nhánh **mã sai** và nhánh **replay** (§1 bảng, §2.1).

## §0.3 — Hợp đồng `recordLoginAttempt` phải giữ

`auth.service.ts:1639-1694`. **BEST-EFFORT-NHƯNG-QUAN-SÁT**: `catch` nuốt lỗi + `logger.error`,
KHÔNG đổi outcome. Hai nhánh: `companyId` thật → `withTenant`; `null` → `db` trần.
⛔ Nhánh NULL **cấm `.returning()`** (mig 0532 — RLS SELECT áp lên RETURNING).

## §0.4 — KI-048 đo lại

- `loginLogListQuerySchema` (`packages/contracts/src/auth.ts:338-357`) **không có `failure_reason`** ✅.
- `login_logs` ∈ `PROTECTED_TABLES` (`retention.service.ts:49`) ⇒ **không bao giờ thu hồi**.
- Mã đang ghi thật: `TooManyAttempts` · `CompanyInactive` · `UserNotFound` · `WrongPassword` · `Inactive`.
- **Không CHECK nào trên `failure_reason`** (mig `0443:100-108` chỉ CHECK `login_status`) và
  **không CHECK trên `user_security_events.event_type`** (`0443:143-150` chỉ CHECK `severity`)
  ⇒ **KHÔNG cần migration**.
- `failure_reason` **không có index** (`auth-logs.ts:49-55`) ⇒ filter §3.1 quét tuần tự. Chấp nhận ở
  quy mô hiện tại; **nói ra** để reviewer không tưởng có index.
- `retention` nằm trong `paths` của WO nhưng **KHÔNG đụng**: `login_logs` GIỮ trong `PROTECTED_TABLES`.

---

## §1 — PHÂN LOẠI TỪNG ĐƯỜNG: bảng nào, hay WAIVER

**Luật chung** (rút từ bản vá A09 của step-up, `step-up.service.ts:52-63`):

> **Đường DỰNG NÊN cái khoá phải để lại vết; đường ĐANG BỊ KHOÁ, theo mặc định, ghi 0 hàng.**
> `N` lần sai dựng nên khoá đều có hàng ⇒ khoá suy ra được, trần lưu trữ = `N` hàng/cửa sổ.
> Ghi ở nhánh đã-khoá là mời kẻ tấn công bồi hàng vào bảng **không xoá được** — chính là KI-048.

**Ngoại lệ của luật phải TRẢ GIÁ BẰNG MÔ HÌNH CHI PHÍ, không bằng ý kiến** (§1.3).

| # | Đường | Bảng | Quyết định |
| --- | --- | --- | --- |
| 1 | `login` 429 | `login_logs` | ĐÃ ghi. **Giữ**, + GỘP (§3.2) vì đây là nguồn KI-048. |
| 2a | `completeTwoFactorLogin` **mã sai** :490 | `login_logs` | 🔴 **VÁ** — đường dựng nên khoá. |
| 2b | `completeTwoFactorLogin` **replay jti** :467 | `login_logs` | 🔴 **VÁ** + gộp theo `jti` (§1.3b). |
| 2c | `completeTwoFactorLogin` **429** :474 | `login_logs` | 🔴 **VÁ — NGOẠI LỆ có mô hình chi phí** (§1.3a) + gộp. |
| 3 | `disableTwoFactor` | `user_security_events` | 🔴 VÁ nhánh **sai mật khẩu** (:608). 429 → luật chung, 0 hàng. |
| 4 | `changePassword` | `user_security_events` | 🔴 VÁ nhánh **sai mật khẩu** (:677). 429 → 0 hàng. |
| 5 | `confirmEnable` | `user_security_events` | 🔴 VÁ nhánh **mã sai**. 429 → 0 hàng. |
| 6 | `stepUp` 429 | — | ✅ **KHÔNG ĐỤNG** — waiver đã ký sẵn (§1.2). |

### §1.1 Vì sao 429 của #3/#4/#5 ghi 0 hàng — và đó KHÔNG phải waiver

Sau bản vá, `N` lần sai của ba đường này đều ghi 1 hàng `user_security_events` ⇒ khoá quan sát được
đầy đủ. Ba đường **post-auth**, bucket theo `(companyId|userId)` từ JWT ⇒ kẻ bồi tự khoá chính mình.
Ghi thêm ở nhánh đã-khoá = 0 bit thông tin mới, + hàng append-only.
⇒ Đây là **luật chung áp đúng**, nên **KHÔNG vào bảng waiver của ratchet** (§5 B6): chúng qua ratchet
bằng điều kiện dương "nhánh từ chối có ghi", không bằng miễn trừ.

### §1.2 `stepUp` — waiver đã ký từ trước, WO này KHÔNG mở lại

`step-up.service.ts:52-63` ghi rõ: nhánh khoá ghi 0 hàng là **nửa (a)** của `FIX-1-BE-STEPUP-FLOOD`;
nửa (b) là mọi nhánh từ chối CÓ vết đều `recordFailure` ⇒ trần `STEP_UP_MAX_ATTEMPTS` hàng/cửa sổ.
Ghi ở nhánh khoá = **hoàn tác** A09. → waiver §5, **có neo DƯƠNG** (xoá nửa (b) phải làm ratchet ĐỎ).

### §1.3 Ngoại lệ #2 — mô hình chi phí (thay cho "vì nó quan trọng")

**§1.3a — nhánh 429 (2c).** Thứ tự thật ở `auth.service.ts:457-476`:

```text
verifyTwoFactorChallenge → claims        (:459)
replayGuard.claim("2fa-jti", claims.jti) (:466)   ← TIÊU jti Ở ĐÂY
if (!firstUse) throw 401                 (:467)
if (isLocked(rl 2fa)) throw 429          (:472-476)
```

`claim` đứng **TRƯỚC** `isLocked`. ⇒ mỗi lần chạm nhánh 429, kẻ tấn công **tiêu một challengeToken
mới**, mà challengeToken chỉ cấp sau một lượt step-1 **đúng mật khẩu** (`auth.service.ts:424`) —
tức **một lượt argon2 verify** đầy đủ. Hệ số khuếch đại ≈ **1 hàng : 1 argon2**, khác hẳn `stepUp`
/`change-pw` (lặp free bằng access token).
⇒ Ngoại lệ ký được. **Điều kiện cứng kèm theo, không thương lượng:**

1. **Kiểm khoá gộp TRƯỚC mọi lời gọi DB** ở nhánh 429 — gộp trúng ⇒ 0 round-trip, y như hiện trạng.
2. Khoá gộp bucket `2fa` ⇒ trần **1 hàng / `LOGIN_LOCKOUT_SEC`** bất kể bao nhiêu argon2.

**§1.3b — nhánh replay (2b).** Replay **KHÔNG tốn argon2**: cùng một token cũ gửi lại N lần là free.
⇒ ghi trần sẽ là bồi hàng vô hạn. **Gộp theo `jti`**, TTL = TTL của challenge (600s, cùng
`DEFAULT_TTL_SEC` của `ReplayGuard`) ⇒ trần **1 hàng / token bị đánh cắp**. Đó chính là hạt thông
tin muốn có ("token này đã bị dùng lại"), lặp thêm không thêm bit nào.

**Tổn thất phải NÊU TÊN** (như §3.2 đã làm với `suppressed_count`): gộp theo `jti` che mất tín hiệu
"**cùng một token bị replay từ NHIỀU IP**" — dấu hiệu token bị chia sẻ/bán. Vẫn chọn `jti`: khoá theo
`jti|ip` cho kẻ tấn công quyền bơm hàng vô hạn bằng cách đổi IP (replay là free). Viết ra để người
sau không tưởng tín hiệu đó quan sát được.

---

## §2 — KI-047: THIẾT KẾ VÁ

### §2.1 `completeTwoFactorLogin` → `login_logs`

Ba nhánh, ba mã `failure_reason` (cột `text`, **không CHECK** ⇒ không migration):

| Nhánh | `status` | `failure_reason` | gộp theo |
| --- | --- | --- | --- |
| replay jti (:467) | `failed` | **`TwoFactorChallengeReplay`** | `jti`, TTL 600s |
| bucket khoá → 429 (:474) | `blocked` | `TooManyAttempts` (mã CŨ) | bucket `2fa`, TTL `LOGIN_LOCKOUT_SEC` |
| mã sai (:490) | `failed` | **`TwoFactorInvalid`** | **KHÔNG gộp** — đây là đường dựng khoá, trần đã là `LOGIN_MAX_ATTEMPTS` |

**Vấn đề `email` — 1 TX CHO 1 HÀNG (vá B1) + TRẠNG THÁI SAI PHẢI BẤT KHẢ BIỂU DIỄN (vá B4-r2).**
`recordLoginAttempt` cần `email` (cột `normalized_email` NOT NULL). Ở cả ba nhánh ta **chỉ có
`claims.sub`**. ⛔ v1 viết "đọc trong `withTenant` đã có ở nhánh mã-sai" — **SAI**: `withTenant` duy
nhất của hàm ở `:499` và chỉ chạy khi `ok === true`; `verifyChallenge` mở-đóng tx riêng
(`two-factor.service.ts:271`). Làm theo v1 tốn **2 tx/hàng**.

⛔ Và **KHÔNG** nới `args.email` thành union `string | {fromUserId}` trên chữ ký phẳng hiện có: kiểu
đó cho phép tổ hợp thứ tư `{companyId: null, email: {fromUserId}}`, khi đó object rơi vào cột `text`
NOT NULL ⇒ ném ⇒ **bị nuốt bởi `catch` best-effort** (`auth.service.ts:1687-1691`) ⇒ mất log **IM
LẶNG**, đúng lớp KI-035 mà chính `:1664-1676` đã trả giá một lần.

⇒ **HAI method, không một union** — trạng thái sai không biểu diễn được bằng KIỂU, không bằng kỷ luật:

```text
// giữ NGUYÊN, 5 call-site hiện có không đổi một byte
private recordLoginAttempt(args: { companyId: string | null; userId: string | null;
                                   email: string; status; reason?; meta })

// MỚI — companyId/userId NOT NULL Ở KIỂU ⇒ không có nhánh pre-auth để rơi vào
private recordLoginAttemptForUser(args: { companyId: string; userId: string;
                                          status; reason?; meta })
```

`recordLoginAttemptForUser` mở **một** `withTenant`, SELECT `users.email` rồi INSERT **trong chính tx
đó** ⇒ **1 tx / 1 hàng**. Giữ nguyên `try/catch` best-effort + `logger.error`; ⛔ **cấm `.returning()`**.
`!user` (user vừa bị xoá) → **bỏ ghi + `logger.error`** (§8).
Cả hai gọi chung một hàm dựng `row` để không đẻ hai nguồn sự thật về hình dạng hàng.

**GIỮ bất biến `company_id IS NULL ⟹ user_id IS NULL`:** cả ba nhánh có `claims.companyId` đã verify
⇒ luôn ghi cặp đầy đủ, không bao giờ chạm nhánh NULL.

**KHÔNG thêm sàn thời gian ở bước-2.** Sàn của `login` (`BLOCKED_LOGIN_FLOOR_MS`) che oracle "slug
tenant có tồn tại" (KI-044). Ở bước-2 kẻ gọi **đã** có challengeToken hợp lệ ⇒ đã biết tenant tồn
tại; không có oracle mới để che. **Phải viết vào PR** để reviewer không đọc nhầm là "quên sàn".

### §2.2 Trio post-auth → `user_security_events`

Thêm **một** mã, APPEND cuối `SECURITY_EVENT_TYPES` + `SECURITY_EVENT_SEVERITY`:

```text
"REAUTH_FAILED"   severity: "medium"
```

Một mã, không ba — đúng tiền lệ `STEP_UP_FAILED` (`packages/contracts/src/auth.ts:240-242`: "đẻ thêm
mã cho từng lý do chỉ làm loãng bộ lọc của viewer"). Ngữ cảnh ở `payload.context`:
`"2fa_disable"` · `"change_password"` · `"2fa_enable"`.
⛔ `payload` KHÔNG chứa mật khẩu/mã/secret — **không truyền vào**, không dựa vào masker.

**Vì sao mở `withTenant` RIÊNG (vá cảnh báo v1).**
v1 viết "ba nhánh sai nằm NGOÀI `withTenant`" — **SAI**: cả ba **phát hiện thất bại BÊN TRONG tx và
thoát bằng `return`** (`auth.service.ts:604`, `:644`, `:647`; `two-factor.service.ts:201`). Ghi trong
tx là khả thi về kỹ thuật. Lý do thật để **không** làm thế:

> **BẤT BIẾN #4 (best-effort).** `SecurityEventWriter.record` **ném** khi `event_type` sai
> (`security-event-writer.service.ts:56-60`) và một lỗi DB trong tx sẽ rollback rồi nổi lên thành
> **500**. Nhánh này PHẢI trả **401**. Biến nhật ký thành đường ném = biến mất-tầm-nhìn thành
> **mất-đăng-nhập** (`notes` của WO).
> Tiền lệ cùng cây: `step-up.service.ts:187-196` (`writeOutcome`) cũng mở tx riêng vì đúng lý do này.

⇒ tx riêng, bọc `try/catch`, KHÔNG đổi outcome. Không có thay đổi nghiệp vụ nào để rollback cùng ⇒
không vi phạm luật "record trong cùng tx nghiệp vụ" (luật đó chống **orphan**, ở đây không có).

### §2.3 Bề mặt thứ hai của hàng mới — phải khai

Hàng `login_logs` mới mang `user_id` ⇒ **hiện luôn ở `/me/security/activity`** dưới nhãn
`LOGIN_FAILED` (`me-security-activity.repository.ts:52-58, 88-99`); `REAUTH_FAILED` cũng vào cùng
màn đó. **Đúng mong muốn** (chủ tài khoản thấy được người khác đang dò mình), nhưng int-spec nào
ĐẾM DÒNG của ME có thể lệch ⇒ §6 R10.

---

## §3 — KI-048: THIẾT KẾ VÁ

### §3.1 Vế LỌC — `failure_reason` vào query schema

`packages/contracts/src/auth.ts`: `failure_reason: z.string().min(1).max(64).optional()`.
**`z.string()` chứ KHÔNG `z.enum`** — mirror `securityEventListQuerySchema.event_type`. Mã lý do là
dữ liệu **append-only lịch sử**; enum hoá làm hàng mang mã cũ/mới không lọc được sau mỗi lần đổi
danh mục.

Kèm: `login-log.repository.ts` (điều kiện `eq`) · `auth-logs-viewer.service.ts` (chuyền filter) ·
FE `apps/app/src/routes/system/auth-logs/LoginLogsPage.tsx` + i18n.
✅ **Không có danh mục cứng ở FE** phải đồng bộ: `LoginLogsPage.tsx:113-116` và
`MeSecurityActivityPage.tsx:43-46` render thô; `meSecurityActivityItemSchema.eventType` là
`z.string()` (`packages/contracts/src/me.ts:445`); i18n chỉ có nhãn CỘT.

### §3.2 Vế GỘP — coalesce, KHÔNG UPDATE

⛔ **GHIM TRƯỚC:** `login_logs` REVOKE UPDATE/DELETE (mig 0443 `GRANT SELECT, INSERT`, BẤT BIẾN #2).
⇒ "gộp" **BẮT BUỘC** là *không ghi thêm*. Thiết kế nào cần UPDATE ⇒ **DỪNG**.

**Nơi ở: `LoginRateLimiter`, KHÔNG phải một service mới** (vá B4 + B9 bằng một lựa chọn).

```text
// login-rate-limiter.ts
async claimFirstOfWindow(key: string, ttlSec: number, nowMs?: number): Promise<boolean>
```

- Khoá dựng qua `rlKey(bucket, rest)` với **`RlBucket` mới `"logdedup"`** ⇒ tiền tố `rl:` **đã nằm
  trong `KEY_PREFIXES`** của `valkey-key-census.spec.ts:42-57` ⇒ cổng `envScope` phủ **miễn phí**,
  không đẻ namespace mới không ai canh (vá **B9**).
- Cơ chế: `valkey.setNx` → `true`/`false`; `null` (Valkey **chưa cấu hình** — `valkey.service.ts:117`
  — hoặc rớt) ⇒ **fallback `Map` in-memory**, đúng khuôn `recordFailureMem`
  (`login-rate-limiter.ts:80-95`) và `ReplayGuardService.claimMem`.
  ⇒ Trong int-spec **không có Valkey**, gộp VẪN chạy bằng memory ⇒ **R2a xanh được** (vá **B4**).
  Fail-open thật chỉ còn khi cả hai đường hỏng — đúng chiều: nghi ngờ thì **GHI**.
- ⚠️ Ngược chiều `ReplayGuardService` (control an ninh, fail-**closed**) ⇒ **KHÔNG tái dùng** nó.

**Khoá gộp phải SOI GƯƠNG ĐÚNG BUCKET ĐANG KHOÁ (vá B3).**
`auth.service.ts:685-693`: 429 bật khi **`ip` HOẶC `acct`** khoá; `accountKey`
(`login-rate-limiter.ts:46-48`) **không có `ip`**. Sau `TRUST_PROXY=loopback` (18/08) `ip` là IP
THẬT ⇒ credential-stuffing rải nhiều nguồn khoá bucket `acct`, mà khoá gộp theo `{slug|email|ip}`
đổi theo từng IP ⇒ **mỗi IP mới = 1 hàng mới**, KI-048 còn nguyên ở dạng nặng nhất.

⇒ **Đổi `isLoginRateLimited` trả về bucket đang khoá**, không phải boolean:

| Trả về | `rest` của khoá gộp |
| --- | --- |
| `"acct"` | `{slug}\|{email}` |
| `"ip"` | `{slug}\|{email}\|{ip}` |
| cả hai khoá | **`"acct"`** (dạng THÔ hơn thắng — 1 hàng/tài khoản/cửa sổ) |
| `null` | không phải đường 429 |

**VỊ TRÍ ĐẶT — ghim bằng chữ (vá B5).**
`auth.service.ts:248` `startedAt` · `:261-268` `finally { applyUniformResponseFloor }`. Sàn tồn tại
để che oracle "slug tenant có tồn tại" (KI-044).
⇒ Kiểm khoá gộp nằm **TRONG `try`, SAU `startedAt`**; `finally` phủ **cả nhánh gộp**. Request bị gộp
**không được** trả nhanh hơn request đầu cửa sổ. Ca đo: §6 R11.
(Với nhánh 2c ở bước-2: §1.3a điều kiện 1 — kiểm gộp trước mọi DB call; ở đó **không có sàn** nên
không có ràng buộc thời gian, xem §2.1.)

**TTL.** `recordFailure` set lock **một lần** khi chạm ngưỡng rồi xoá counter
(`login-rate-limiter.ts:88-91`), và đường đã-khoá `return` **trước** `recordFailure` ⇒ lock **KHÔNG
được gia hạn** ⇒ cửa sổ đúng bằng `LOGIN_LOCKOUT_SEC` ⇒ **TTL = `LOGIN_LOCKOUT_SEC` là ĐÚNG**.
⚠️ Lệch còn lại: khoá gộp đặt muộn hơn lock vài trăm ms nên **sống lâu hơn** lock ⇒ có thể nuốt hàng
đầu của cửa sổ kế nếu hai cửa sổ sát nhau. **Ghi nhận, chấp nhận** (mất 1 hàng trong ca hiếm, đổi lấy
việc không phải đọc TTL còn lại — thêm một round-trip Valkey trên đúng đường đang muốn làm rẻ).

**Số lần bị nuốt — QUYẾT ĐỊNH: CHẤP NHẬN MẤT.**
Không thể ghi `suppressed_count` vào hàng đầu (cần UPDATE ⇒ cấm). Không đẻ hàng "tổng kết" (lại là
hàng do kẻ tấn công điều khiển). ⇒ `login_logs` trả lời "**có** bị chặn trong cửa sổ này", không trả
lời "**bao nhiêu** lần"; số đếm sống ở bucket rate-limit (Valkey), không phải ở forensics.

**Hệ quả phải nói ra:** hàng ĐẦU mỗi cửa sổ VẪN ghi ⇒ tín hiệu "có brute-force" còn nguyên; hàng
2..N trong cùng cửa sổ biến mất. Trần: **1 hàng/bucket/15'** thay vì vô hạn.

⚠️ **`reset()` KHÔNG xoá khoá gộp.** Hôm nay không tới được (mọi đường `reset` — `auth.service.ts:421,425,494`
— chỉ chạy khi bucket **chưa** khoá). Nếu sau này có đường admin-unlock thì cửa sổ mới sẽ mất **hàng
đầu tiên**. Ghi nhận, không vá ở WO này.
⚠️ **Map gộp in-memory PHẢI prune** như `ReplayGuardService.pruneExpired` (`replay-guard.service.ts:72-77`):
nhánh replay khoá theo `jti` ⇒ số khoá phân biệt tăng theo số token, không bị chặn bởi số bucket.

⚠️ Khoá gộp **nhúng EMAIL**, và mọi đường lỗi Valkey log NGUYÊN khoá (`valkey.service.ts:75,104,125`).
Đã có tiền lệ với `rl:*` (cùng hình dạng, cùng file) ⇒ **ghi nhận có chủ đích**, không đổi hành vi
log ở WO này (đổi nó là WO riêng chạm mọi bucket).

---

## §4 — BẤT BIẾN PHẢI GIỮ

1. **`company_id IS NULL ⟹ user_id IS NULL`** — mọi đường ghi mới có companyId thật. Ghim bởi
   `auth-me-bootstrap` int-spec.
2. **Sàn thời gian ở nhánh 429 của `login`** — KHÔNG đụng; vị trí khoá gộp ghim ở §3.2
   ([[attribution-patch-creates-timing-oracle]]).
3. **Append-only** — 0 UPDATE, 0 DELETE trên `login_logs` + `user_security_events`.
4. **Best-effort** — mọi emit-site mới KHÔNG ném (§2.2).
5. **BẤT BIẾN #3** — 0 mật khẩu/mã/token vào `payload`/`failure_reason`.
6. **Khoá Valkey mang `envScope`** — dùng `rlKey` sẵn có ⇒ census phủ (§3.2).
7. **`retention`** — `login_logs` GIỮ trong `PROTECTED_TABLES`, không đụng.

---

## §5 — RATCHET (done_when #8) — vá B6

Census AST: `apps/api/test/foundation/login-log-429-census.ts`
Ratchet: `apps/api/test/foundation/login-log-429-ratchet.unit-spec.ts`
(khuôn: `body-validation-census.ts` + `body-validation-ratchet.unit-spec.ts` — cùng cây, đã chạy)

**Điều kiện ở mức NHÁNH, KHÔNG mức HÀM.** v1 tính "hàm có lời gọi ghi" ⇒ với
`completeTwoFactorLogin` (5 nhánh) một refactor bỏ ghi ở nhánh 429 vẫn xanh nhờ `recordLoginAttempt`
ở nhánh success (`:570`).

**Phát biểu CHÍNH XÁC** (đã đối chiếu với code thật, không phải mô tả gần đúng):

> Gọi `B` = **`Block` trong cùng nhất** chứa nút `throw`. Điểm ném ĐẠT khi có ít nhất một lời gọi
> `recordLoginAttempt` / `securityEvents.record` là **hậu duệ của `B`**.

Kiểm trên hai hình dạng có thật, cả hai phải XANH:

| Đường | Hình dạng | `B` | Lời gọi ghi | Kết luận |
| --- | --- | --- | --- | --- |
| `login` 429 (`:241-273`) | `if { startedAt; try{ ghi } finally{ sàn }; throw }` | thân `if` | `:251`, nằm trong `try` — `try` là con TRỰC TIẾP của `B` ⇒ vẫn là **hậu duệ** | ✅ ĐẠT |
| `completeTwoFactorLogin` 429 (`:472-476`) sau khi vá | `if { ghi; throw }` | thân `if` | cùng block | ✅ ĐẠT |

⚠️ Nếu dùng phát biểu lỏng hơn ("cùng `try`" hoặc "câu lệnh anh em trực tiếp") thì đường `login`
— đường DUY NHẤT đang ĐÚNG — sẽ bị báo vi phạm oan. Đó là lý do phải neo theo **hậu duệ của block
trong cùng nhất**, không theo quan hệ anh-em.

**Waiver — BỐN dòng, mỗi dòng có NEO DƯƠNG.**

⚠️ Vòng review 1 (B6) đề nghị **xoá** waiver của `disableTwoFactor`/`changePassword`/`confirmEnable`
vì "chúng qua bằng điều kiện dương". Đề nghị đó **tự mâu thuẫn với chính luật mức-NHÁNH mà nó vừa
đòi**: ba đường này ghi vết ở nhánh **SAI**, còn `throw` 429 nằm trong block `if (isLocked) { throw }`
**không chứa lời ghi nào** ⇒ dưới luật mức-nhánh chúng KHÔNG thể qua. Bỏ waiver ⇒ ratchet đỏ ngay lúc
merge ⇒ áp lực đẩy người thi công nới luật về mức HÀM, đúng thứ B6 vừa bỏ. ⇒ **GIỮ waiver, thay bằng
neo mạnh hơn cả hai phương án.**

| Waiver | Lý do (§1.1/§1.2) | **NEO DƯƠNG** |
| --- | --- | --- |
| `StepUpService#stepUp` | A09 anti-amplification, nửa (a) | `stepUpAntiAmplificationAnchors()` — `recordFailure` ≥1 **và** `writeOutcome` ≥1 trong `step-up.service.ts`. Xoá nửa (b) ⇒ **ĐỎ**. |
| `AuthService#disableTwoFactor` | ghi ở nhánh SAI MẬT KHẨU | `reauthFailedContexts()` ∋ `"2fa_disable"` |
| `AuthService#changePassword` | ghi ở nhánh SAI MẬT KHẨU | `reauthFailedContexts()` ∋ `"change_password"` |
| `TwoFactorService#confirmEnable` | ghi ở nhánh MÃ SAI | `reauthFailedContexts()` ∋ `"2fa_enable"` |

**Vì sao neo bằng `payload.context` chứ không bằng "hàm có `securityEvents.record`"** (mạnh hơn đề
nghị của reviewer): `changePassword` **đã có** `securityEvents.record` (`PASSWORD_CHANGED`) ở nhánh
THÀNH CÔNG từ trước (`auth.service.ts:669`) ⇒ mọi phép đếm ở mức HÀM **xanh sẵn** và không chứng minh
được gì. Tập `payload.context` của `eventType: "REAUTH_FAILED"` chỉ tồn tại nhờ đúng ba lời ghi ở
nhánh sai ⇒ neo theo ĐỊNH NGHĨA ([[index-ratchet-must-pin-definition-not-name]]).

⇒ điểm ném **thứ 7** mọc lên không khai ⇒ ĐỎ. Đúng thứ đã thiếu khi `step-up` mọc thêm.
⚠️ Census bằng **AST**, KHÔNG regex ([[nestjs-zod-class-level-pipe-does-nothing]]).
⚠️ Ca chống xanh-RỖNG: scanner phải thấy **≥6** điểm ném, **4 waiver + 4 neo dương** đều đạt, **và**
`AuthService#login` phải cho `logsInBranch === true` — neo dương cho chính BỘ DÒ (nếu luật bị viết
lỏng thành "cùng `try`"/"anh em trực tiếp" thì đường DUY NHẤT đang đúng sẽ bị báo oan).

---

## §6 — MA TRẬN RED (viết TRƯỚC, phải ĐỎ đúng chỗ)

| Mã | Ca | Kỳ vọng |
| --- | --- | --- |
| R1 | bước-2 2FA, **mã SAI** | +1 `login_logs` `failed`/`TwoFactorInvalid`, `company_id` thật, `user_id`=sub |
| R1a | **ALLOW** bước-2 mã ĐÚNG | +1 `success`, **0** hàng `failed` thừa |
| R2 | bước-2, bucket khoá → 429 lần 1 | tổng = **1** hàng `blocked`/`TooManyAttempts` |
| R2a | 429 lần 2, 3 **cùng bucket** (tuần tự, cùng kịch bản R2) | tổng **vẫn = 1** |
| R2b | **UNIT** (`login-rate-limiter.spec.ts`) `claimFirstOfWindow` với tham số `nowMs`: `t=0`→`true`; `t=ttl*1000-1`→`false`; `t=ttl*1000`→`true` | gộp bị chặn bởi TTL, KHÔNG phải "thôi ghi vĩnh viễn". ⚠️ **không làm được ở int-spec**: `LOGIN_LOCKOUT_SEC`=900 (`env.schema.ts:116`) không chờ được, và `reset()` (`login-rate-limiter.ts:99-104`) KHÔNG chạm khoá gộp |
| R2c | 429 bị gộp ⇒ spy `DatabaseService.withTenant`: lần 2 gọi **ÍT HƠN** lần 1, và 0 lời gọi `resolveBlockedLogOwner`/`recordLoginAttempt` | §1.3a điều kiện 1. Đo **DELTA**, không đo số 0 tuyệt đối — một interceptor tương lai sẽ làm ngưỡng tuyệt đối đỏ oan |
| R3 | bước-2, **replay jti** | +1 `failed`/`TwoFactorChallengeReplay`; gửi lại lần 2,3 ⇒ tổng vẫn 1 |
| R4 | `changePassword` sai mật khẩu | +1 `REAUTH_FAILED` ctx `change_password` |
| R4a | **ALLOW** `changePassword` đúng | +1 `PASSWORD_CHANGED`, **0** `REAUTH_FAILED` |
| R5 | `disableTwoFactor` sai mật khẩu | +1 `REAUTH_FAILED` ctx `2fa_disable` |
| R5a | **ALLOW** `disableTwoFactor` đúng | +1 `TOTP_DISABLED`, **0** `REAUTH_FAILED` |
| R6 | `confirmEnable` mã sai | +1 `REAUTH_FAILED` ctx `2fa_enable` |
| R6a | **ALLOW** `confirmEnable` mã đúng | +1 `TOTP_ENABLED`, **0** `REAUTH_FAILED` |
| R7 | `stepUp` **chưa khoá** (registry rỗng → `denyAndCount`) | **+1** `STEP_UP_FAILED` — vế dương chống xanh-rỗng của R7a |
| R7a | `stepUp` **đã khoá** → 429, **cùng fixture R7** | **+0** ở CẢ HAI bảng (waiver §1.2) |
| R8 | **credential-stuffing**: khoá bucket `acct`, 3 IP KHÁC NHAU cùng 429 | tổng = **1** hàng (vá B3) |
| R9 | filter `?failure_reason=TooManyAttempts` / `=WrongPassword` | chỉ trả hàng đúng mã, không lẫn |
| R10 | `/me/security/activity` sau R1 | hàng mới hiện đúng nhãn; int-spec ĐẾM DÒNG của ME cập nhật theo (§2.3) |
| R11 | **thời gian**: CẢ HAI request 429 (đầu cửa sổ và bị gộp) | mỗi cái ≥ `BLOCKED_LOGIN_FLOOR_MS` (dung sai timer ~10ms). ⚠️ **ngưỡng TUYỆT ĐỐI**, KHÔNG so sánh tương đối hai số gần bằng nhau — cả hai đều bị sàn kẹp nên hiệu số ≈ nhiễu lịch CPU ⇒ cổng vùng đỏ đỏ ngẫu nhiên sẽ bị nới trong một tuần |
| R12 | ghi nhật ký NÉM — **HAI mock riêng**: (a) đường `login_logs` (`recordLoginAttempt`), (b) đường `SecurityEventWriter.record` | outcome KHÔNG đổi ở CẢ HAI (401 và 429) + có `logger.error`. Hai writer khác nhau ⇒ một mock không phủ được cả hai |
| R12b | **RUNTIME** cho quyết định §1.1: `changePassword` khi bucket ĐÃ khoá → 429 | **+0** `REAUTH_FAILED`. Ratchet tĩnh không giữ được điều này; thiếu ca ⇒ người sau "vá cho đủ" |
| R13 | census ratchet | ≥6 điểm ném, 0 điểm không-khai, 4 waiver + 4 neo dương, `login` cho `logsInBranch=true` |
| R14 | **FE** `LoginLogsPage` | ô lọc `failure_reason` + loading/error/empty (DoD §8) |

⚠️ `step-up.service.spec.ts:224,237,292,307` đã assert 429 — R7a khoá hành vi "0 hàng"; **KHÔNG nới
assert cũ cho xanh** ([[tests-can-pin-a-hole-open]]).
⚠️ Rate-limit per-user bóp nghẹt chính int-spec ([[per-user-rate-limit-throttles-own-int-spec]]);
11 int-spec dùng chung một outbox ([[parallel-int-specs-share-one-outbox]]) ⇒ mỗi ca dùng
user/company RIÊNG.

---

## §7 — NGOÀI PHẠM VI (tách hai nhánh — vá B8)

| Nhánh | Lý do |
| --- | --- |
| **challengeToken hỏng/hết hạn** (`:458-462`) | `claims` **CHƯA** tồn tại (verify vừa ném) ⇒ hàng sẽ là pre-auth `company_id NULL`, mà sau mig `0532:61-75` (`USING` chỉ còn tenant hiện tại) **không tenant nào đọc được** ⇒ ghi vào chỉ phình bảng. **Waiver có lý do đúng.** |
| **replay jti** (`:467`) | ⚠️ v1 waiver nhánh này bằng lý do TRÊN — **SAI**: `claims` đã verify ở `:459`, companyId+sub có đủ. ⇒ **ĐÃ KÉO VÀO PHẠM VI** (§1.3b, R3). |
| bước-1 `result.kind === "2fa"` (cấp challenge) | "chưa xong đăng nhập"; ghi `success` là SAI ngữ nghĩa. Quan sát được cần `status` thứ tư (`challenged`) ⇒ đổi `LOGIN_LOG_STATUSES` = **đổi hợp đồng API**. → **cấp KI riêng**. |
| công ty ngừng ở bước-2 (`:558`) | đã có `audit_logs` `auth.login_blocked` trong tx đã commit ⇒ có vết. → ghi nhận, không vá. |

---

## §8 — CÂU HỎI MỞ ĐÃ CHỐT

- **User bị xoá + mã sai** → `recordLoginAttempt` không đọc được email ⇒ **bỏ ghi + `logger.error`**.
  Chấp nhận: giữ hợp đồng "log không bao giờ làm hỏng outcome"; ca này hiếm và đã có `logger.error`.
- **Rollback:** vá chỉ THÊM đường ghi + 1 họ khoá Valkey ⇒ **rollback = revert**, không migration,
  không backfill, không cần feature-flag.
- **Đường dẫn ngoài `paths` WO** (`guard-scope` sẽ kêu — khai trước): i18n `vi` ở
  `apps/app/src/i18n/locales/vi/system.ts`. Danh mục `SECURITY_EVENT_TYPES` còn bản thứ hai ở
  **tài liệu** (`docs/SPEC/SPEC-02`, `docs/DB/DB-02`, `docs/API Design/openapi/paths/auth.paths.yaml`)
  ⇒ hoặc mở path hoặc **ghi drift vào RELEASE-02** — chọn: **cập nhật tài liệu trong cùng PR**.

## §9 — ĐÃ SỬA GÌ SAU VÒNG REVIEW (v1 → v2)

| Blocker | Sửa |
| --- | --- |
| B1 | §2.1 — `recordLoginAttempt` nhận `{fromUserId}`, SELECT trong CHÍNH tx sắp INSERT ⇒ 1 tx/hàng. Bỏ câu "cùng withTenant đã có". |
| B2 | §1.3a — mô hình chi phí `claim` trước `isLocked` ⇒ 1 hàng : 1 argon2; + 2 điều kiện cứng. |
| B3 | §3.2 — `isLoginRateLimited` trả BUCKET; khoá gộp soi gương bucket; `acct` thắng; R8. |
| B4 | §3.2 — dedup vào `LoginRateLimiter` với memory-fallback ⇒ chạy được khi không có Valkey. |
| B5 | §3.2 — ghim vị trí TRONG `try` SAU `startedAt`, `finally` phủ; R11. |
| B6 | §5 — điều kiện mức NHÁNH; xoá 3 waiver thừa; waiver `stepUp` có neo DƯƠNG. |
| B7 | §6 — thêm R1a·R4a·R5a·R6a·R7/R7a·R2b·R2c·R8·R10·R11·R14. |
| B8 | §7 — tách 2 nhánh; replay KÉO VÀO phạm vi (§1.3b). |
| B9 | §3.2 — dùng `RlBucket` mới ⇒ tiền tố `rl:` đã có trong `KEY_PREFIXES`, không đẻ namespace. |

## §10 — CỔNG RA

- `bash harness/check.sh --all` — vùng đỏ, int-spec AUTH phải CHẠY THẬT (không SKIP).
- FULL gate: `security-reviewer` + `database-reviewer` + `silent-failure-hunter`.
- RELEASE-02: gạch KI-047 + KI-048 kèm ngày; `harness/backlog.mjs` → `done`.
- ⛔ KHÔNG gắn nhãn `auto-merge` — vùng đỏ, người chốt.
