# S18-AUTH-RETRYAFTER-1 — 429 đăng nhập mang `retryAfterSec` + đếm ngược ở màn đăng nhập

> **Work Order:** `harness/backlog.mjs` → `S18-AUTH-RETRYAFTER-1` · zone 🟡 · gate LIGHT + `security-reviewer` · **0 migration**
> **Wave:** S18-AUTH-LOCKOUT (WO thứ 3/3). Phụ thuộc `S18-AUTH-UNLOCK429-1` (đã merge — PR #472):
> `LoginRateLimiter.remainingLockSec()` + `ValkeyService.ttl()` do WO đó dựng, WO này **DÙNG LẠI, không viết bản thứ hai**.
> **Ngày:** 2026-09-03 · mọi số đo đọc từ code THẬT trên `master@13219b1b`.

---

## 1. Vấn đề — cơ chế chính xác

Khi một bucket rate-limit đang khoá, hệ thống ném **đúng một câu chữ** không mang thông tin:

```text
"Quá nhiều lần thử. Vui lòng thử lại sau."   HttpStatus.TOO_MANY_REQUESTS
```

**Census ĐẦY ĐỦ — 8 chỗ ném** (`grep -rn TOO_MANY_REQUESTS apps/api/src --include=*.ts`, 03/09; bỏ
`error-codes.ts:46` là chỗ MAP status→code, không ném).

> ⚠️ Bản plan đầu ghi "5 chỗ, không còn chỗ nào khác" — **sai số đo**: lệnh grep lúc đó bị cắt bởi
> `head -30`. Ba chỗ cuối bảng là THẬT và **cố ý nằm ngoài phạm vi**, không phải không tồn tại.

| # | Vị trí | Khoá đang xét | Sàn thời gian? | Trong `paths`? |
| --- | --- | --- | --- | --- |
| 1 | `auth.service.ts:311` — `login()` | `accountKey` HOẶC `key(slug,email,ip)` | ✅ `BLOCKED_LOGIN_FLOOR_MS` trong `finally` | ✅ |
| 2 | `auth.service.ts:565` — `verifyTwoFactorChallenge()` | `twoFactorKey(companyId,userId)` | ❌ | ✅ |
| 3 | `auth.service.ts:701` — `disableTwoFactor()` | `rateLimitKey("2fa-disable", …)` | ❌ | ✅ |
| 4 | `auth.service.ts:737` — `changePassword()` | `rateLimitKey("change-pw", …)` | ❌ | ✅ |
| 5 | `two-factor.service.ts:197` — `confirmEnable()` | `rateLimitKey("2fa-enable", …)` | ❌ | ✅ |
| — | `auth/step-up/step-up.service.ts:122` — `stepUp()` | `rateLimitKey("step-up", …)` | ❌ | ❌ **NGOÀI** |
| — | `chat/chat-calls.service.ts:531` — cooldown mời gọi | (CHAT, message riêng) | ❌ | ❌ **NGOÀI** |
| — | `notifications/lms-service-intake.guard.ts:107` | guard máy-tới-máy (LMS) | ❌ | ❌ **NGOÀI** |

**Ba dòng NGOÀI — quyết định và lý do:**

- `step-up.service.ts` là 429 **người dùng thật nhìn thấy** và cùng module AUTH ⇒ đáng lẽ nên đồng bộ.
  Nhưng file đó **không có trong `paths` của WO** (`paths` chỉ liệt `auth.service.ts`,
  `two-factor.service.ts`, và `auth/**/*.spec.ts`). Mở rộng sang đó là đổi phạm vi ⇒ **không làm ở WO
  này**; ghi thành nợ để owner quyết seed WO nối tiếp. Hệ quả chấp nhận: sau WO này AUTH có **hai hợp
  đồng 429** — 5 chỗ mang `retryAfterSec`, `stepUp` thì không.
- `chat-calls` dùng message riêng (`CHAT_CALL_INVITE_COOLDOWN_MESSAGE`) và có int-spec ghim mã lỗi
  (`chat-s7-call-be1-lifecycle.int-spec.ts:597`) — khác module, khác WO.
- `lms-service-intake.guard.ts` là kênh **máy-tới-máy**, không có màn hình nào đếm ngược.

Vì `tooManyRequests()` là hàm THÊM (không sửa `HttpException` gốc), ba chỗ trên giữ nguyên hành vi —
không có hồi quy, chỉ có bất đối xứng đã ghi ra ở trên.

Người dùng nhận 429 **không biết chờ bao lâu** ⇒ hoặc bấm lại liên tục (không nới thêm khoá vì đường
đã-khoá `return` trước `recordFailure`, nhưng vẫn vô ích), hoặc gọi admin. `LOGIN_LOCKOUT_SEC` mặc định
900s — 15 phút im lặng là quá đủ để một người dùng thật kết luận "hệ thống hỏng".

### 1.1 Số đo hiện trạng (đọc 03/09)

- `LoginRateLimiter.remainingLockSec(key, nowMs?)` (`login-rate-limiter.ts:467`) **đã có**: Valkey
  `ttl(lockKey)` → fallback `attempts` in-memory → `null`. `null` = "không khoá HOẶC không đọc được TTL"
  (không bao giờ trả `0` giả — docblock `ValkeyService.ttl:229`).
- `AllExceptionsFilter` (`common/filters/all-exceptions.filter.ts:107-123`) **đã** cho `details` đi ra
  client: opt-in (payload phải khai `details`), chỉ 4xx, và **lọc hình dạng ở runtime** — chỉ phần tử
  `{field:string, message:string, rule:string}` sống sót. Đây là HÌNH DUY NHẤT ra được ngoài.
- `httpStatusToCode(429)` → `ERROR_CODES.RATE_LIMITED` (`common/errors/error-codes.ts:46`). Payload
  object **không khai `code`** ⇒ vẫn ra đúng mã đó (`filter:92`) — không đổi hợp đồng cũ.
- `HttpException` với payload object có `message: string` ⇒ `exception.message` = chuỗi đó
  (`initMessage()` của Nest) ⇒ envelope `message` **không đổi một ký tự**.
- FE: `toApiError` (`packages/web-core/src/lib/api-client.ts:138`) đọc **BODY**, gán
  `ApiError.details: unknown`. **KHÔNG đọc header nào** ⇒ đường tải thật là body; header `Retry-After`
  là để cho hạ tầng/proxy/công cụ, không phải cho FE.
- `apps/auth/src/routes/login.tsx:22` — `err.status === 429 → t("errors.tooManyAttempts")`.
  Khoá i18n ở `packages/web-core/src/i18n/locales/vi/auth.ts:49`.

---

## 2. Ranh giới phạm vi

**LÀM:** thêm `retryAfterSec` vào 429 (body `error.details` + header `Retry-After`) ở **cả 5 chỗ ném**;
FE `login.tsx` đếm ngược mm:ss và tự nhả nút Submit.

**KHÔNG LÀM (cố ý):**

- KHÔNG đụng `LOGIN_MAX_ATTEMPTS` / `LOGIN_LOCKOUT_SEC` / ngưỡng bucket nào — WO này **chỉ hiển thị**.
- KHÔNG đổi quyết định gate: `isLocked()` vẫn là cổng; TTL chỉ đọc **bên trong nhánh đã ném**.
- KHÔNG đụng `TwoFactorChallengeForm.tsx` / `forgot-password.tsx` (ngoài `paths`; hai màn đó vẫn rơi về
  chuỗi cũ — đúng, vì `errors.tooManyAttempts` được GIỮ NGUYÊN).
- KHÔNG thêm cặp quyền, KHÔNG migration.

---

## 3. Thiết kế

### 3.1 Hợp đồng 429 (một chỗ duy nhất định nghĩa)

File mới **`apps/api/src/common/filters/retry-after.ts`** (∈ `paths` qua `common/filters/**`). Đặt cạnh
filter là có chủ ý: **hai nửa của cùng một hợp đồng** — nửa sinh `details` (service) và nửa dịch
`details` → header (filter) — không được trôi khỏi nhau. Tách sang `common/errors/` sẽ để nửa header
mồ côi ở một file khác, và không nửa nào đọc được nửa kia khi đổi.

```ts
export const RETRY_AFTER_FIELD = "retryAfterSec";
export const RETRY_AFTER_RULE = "retry-after";
export const TOO_MANY_REQUESTS_MESSAGE = "Quá nhiều lần thử. Vui lòng thử lại sau.";

/** 429 chuẩn. `retryAfterSec === null` (Valkey rớt / hết TTL giữa chừng) ⇒ KHÔNG khai `details`. */
export function tooManyRequests(retryAfterSec: number | null): HttpException;

/** Filter dùng: bóc số giây hợp lệ ra khỏi `details` để đặt header. `null` ⇒ không đặt header. */
export function retryAfterHeaderValue(details: ErrorDetail[] | null): string | null;
```

**Vì sao KHÔNG dùng `@Header('Retry-After')` ở controller:** decorator đó dán nhãn cho phản hồi
**THÀNH CÔNG** — đường ném đi qua exception filter, header không bao giờ tới (memory
`nest-header-decorator-mislabels-errors`). Header phải đặt trong `AllExceptionsFilter.catch()`, trên
chính `response` sắp ghi.

**Vì sao header suy TỪ `details` chứ không truyền song song:** một nguồn ⇒ body và header không thể
lệch nhau. Nếu ai đó sau này bỏ `details` mà quên header, header tự biến mất theo.

**Đo 03/09 — trình duyệt KHÔNG đọc được header này, và đó là lý do đường tải thật phải là BODY:**
`main.ts:37-40` gọi `enableCors({ origin, credentials:true })` — **không khai `exposedHeaders`**.
`Retry-After` không nằm trong 7 header CORS-safelisted, và `apps/auth` (`auth.localhost:5275`) gọi API
**cross-origin** ⇒ `fetch` ở FE không thấy header dù server có gửi. Header vì thế phục vụ hạ tầng
(proxy/cloudflared/công cụ/`curl`), KHÔNG phục vụ FE. **KHÔNG mở `exposedHeaders`** trong WO này: đó là
đổi biên CORS toàn hệ cho một tiện ích mà body đã giải quyết xong (và `toApiError` vẫn sẽ phải đọc body
cho mọi field khác).

**Hợp lệ hoá:** `Number.isInteger(n) && n > 0 && n <= RETRY_AFTER_MAX_SEC (86400)`. Số ngoài dải bị
LOẠI (không đặt header, FE rơi về chuỗi cũ) — RFC 9110 §10.2.3 chỉ cho delta-seconds nguyên không âm,
và `0` nghĩa là "thử ngay" trong khi ta đang ném 429.

**Ba ràng buộc CỨNG lên `tooManyRequests()` — mỗi cái là một hợp đồng câm nếu phá:**

1. **KHÔNG được là lớp con `HttpException`.** Envelope lấy `type: exception.name`
   (`all-exceptions.filter.ts:124`); `class TooManyRequestsException extends HttpException` sẽ đổi
   `type` từ `"HttpException"` sang tên lớp mới — đổi hợp đồng API mà không ai thấy. Hàm **trả về
   `new HttpException(...)` trực tiếp**, và có ca test ghim `type === "HttpException"`.
2. **Payload KHÔNG được có khoá `code`.** `payloadCode` thắng `httpStatusToCode`
   (`all-exceptions.filter.ts:88-92`) ⇒ khai `code` sẽ đẩy 429 ra khỏi `SYSTEM-ERR-RATE-LIMIT`.
   Ca test ghim `code` không đổi ở CẢ hai nhánh (có/không `details`).
3. **Ca `retryAfterSec === null` vẫn phải giữ `message`.** Nest `initMessage()` chỉ lấy `message` khi
   payload là object có `message: string`; payload `{}` sẽ cho `exception.message` = tên lớp. Ca test
   phải assert `message` **cho cả hai nhánh**, không chỉ assert "không có details".

**Hướng import:** `two-factor.service.ts` (module AUTH) sẽ import lên `common/filters/`. Chấp nhận —
`common/` vốn là tầng dưới mọi module, và AUTH đã import `common/errors`, `common/valkey`. Điều KHÔNG
được làm là chiều ngược lại (`common/filters/` import từ `auth/`).

### 3.2 Đọc TTL ở từng chỗ ném

| # | Đọc gì | Ghi chú |
| --- | --- | --- |
| 1 `login()` | `remainingLockSec(<khoá của bucket đang khoá>)` | Đọc **TRONG `try`**, TRƯỚC `finally { applyUniformResponseFloor }` |
| 2 `verifyTwoFactorChallenge()` | `remainingLockSec(rlKey)` | `rlKey` đã dựng ngay trên |
| 3 `disableTwoFactor()` | `remainingLockSec(rlKey)` | |
| 4 `changePassword()` | `remainingLockSec(rlKey)` | |
| 5 `confirmEnable()` | `remainingLockSec(rlKey)` | `two-factor.service` đã inject `LoginRateLimiter` |

`isLoginRateLimited()` hiện trả `"acct" | "ip" | null` và **dựng khoá bên trong**. Để không dựng khoá
lần thứ hai bằng tay ở `login()` (nối chuỗi tay là thứ `valkey-key-census.spec.ts` cấm, và hai bản sao
sẽ lệch câm khi builder đổi), đổi nó trả **chính khoá đang khoá** kèm bucket:

```ts
type LockedLogin = { bucket: LockedLoginBucket; key: string };
private async isLoginRateLimited(...): Promise<LockedLogin | null>
```

Call-site duy nhất là `login()` (`:255`) — `locked.bucket` thay cho `lockedBucket` ở
`claimBlockedLogSlot`. Không call-site nào khác (`grep isLoginRateLimited` = 2 hit: định nghĩa + gọi).

**Một bucket là ĐỦ, không cần lấy max của hai — chứng minh (đo 03/09):** `isLoginRateLimited` kiểm
`acct` TRƯỚC `ip`, và khi cả hai cùng khoá thì TTL của `acct` luôn **≥** TTL của `ip`, nên con số trả
về đã là "khi nào thật sự vào lại được", không phải một số ngắn hơn thực tế:

1. Mọi bucket dùng CHUNG một độ dài khoá — `recordFailure` set `:lock` bằng `LOGIN_LOCKOUT_SEC` bất kể
   `maxAttempts` (`login-rate-limiter.ts:230-241`) ⇒ TTL còn lại chỉ phụ thuộc khoá nào được dựng SAU.
2. Khi `acct` đang khoá, **không khoá per-IP mới nào hình thành được**: `login()` ném 429 ở `:255-312`,
   tức TRƯỚC `recordLoginFailure` (`:324`, `:431`) ⇒ không lượt sai nào được đếm nữa.

⇒ khoá `ip` chỉ có thể sinh ra **trước** khoá `acct` (hoặc cùng thời điểm — ca 4 IP × 5 lần, lần sai
thứ 20 vừa là lần thứ 5 của IP cuối) ⇒ `acct` hết hạn sau. Lấy `acct` trước là ĐÚNG chiều.
⚠️ Ràng buộc này sống nhờ thứ tự "chặn TRƯỚC khi đếm" ở `login()`; ai đảo thứ tự đó phải xét lại đoạn
này — ghi vào comment tại chỗ.

### 3.3 Timing — vì sao nhánh 429 vẫn không tách được

`applyUniformResponseFloor(startedAt, BLOCKED_LOGIN_FLOOR_MS)` chờ tới **mốc tuyệt đối**
`startedAt + 250 + jitter[0..80]`. Thêm một round-trip Valkey (`TTL`) vào **trước** mốc đó ⇒ tổng thời
gian phản hồi **không đổi** miễn round-trip < ngân sách còn lại.

⚠️ **Ràng buộc cứng:** phép đọc TTL phải nằm TRONG `try`. Đặt sau `finally` (giữa floor và `throw`) là
cộng thẳng thời gian Valkey vào sau sàn ⇒ tự tay đẻ lại đúng oracle mà sàn sinh ra để che.

**Ca "Valkey rớt ⇒ treo lâu hơn sàn" KHÔNG xảy ra — bằng chứng, không phải phỏng đoán:** client dựng
với `enableOfflineQueue: false` + `maxRetriesPerRequest: 1`
(`permission/valkey.service.ts:42-46`) ⇒ lệnh **fail nhanh** chứ không xếp hàng chờ reconnect; và
`ttl()` nuốt lỗi trả `null` (`valkey.service.ts:236-246`) rồi `remainingLockSec` rơi xuống map
in-memory — nhánh **đồng bộ**, 0 I/O (`login-rate-limiter.ts:467-477`).

**Residual THẬT (ghi ra, không giấu):** Valkey **chậm mà vẫn kết nối**. Nó không đẻ oracle MỚI (cùng
chi phí cho cả hai nhánh con của 429 — slug đúng và slug sai đều đọc TTL), nhưng nó **ăn vào ngân sách
250ms + jitter** đang che oracle KI-044 (`withTenant` 4 round-trip vs `db.insert` trần 1 round-trip).
Nếu một ngày TTL round-trip ngốn hết ngân sách, sàn hết tác dụng và KI-044 hở lại. → §4.2 `§floor` đo
điều này bằng số thật, không bằng lập luận.

**Lưu ý về PHA — sàn KHÔNG phủ toàn nhánh, và WO này không làm nó xấu đi:** `startedAt` đặt ở
`auth.service.ts:263`, tức **SAU** `isLoginRateLimited` (`:255`). Hai lượt `isLocked` (1 round-trip khi
bucket `acct` khoá, 2 khi chỉ `ip` khoá) **vốn đã nằm NGOÀI sàn** từ trước WO này. Đây là hiện trạng,
không phải nợ do WO này tạo — nhưng phải nói đúng, vì bản plan đầu ngụ ý sàn phủ toàn nhánh.

**4 chỗ còn lại không có sàn, và không cần** — nhưng lý do phải nói cho đúng từng chỗ:

- `disableTwoFactor` / `changePassword` / `confirmEnable`: actor ĐÃ có access token ⇒ không còn ẩn số
  nào (tenant, user) để dò bằng đồng hồ.
- `verifyTwoFactorChallenge`: nhánh 429 ở đó **đã có chênh lệch nội-nhánh sẵn** — `claimFirstOfWindow`
  và (lần đầu cửa sổ) một lượt ghi `login_logs` (`auth.service.ts:549-562`). Thêm một lượt đọc TTL
  **không làm xấu đi**, và ẩn số duy nhất còn lại (`companyId`/`sub`) đến từ challengeToken đã ký —
  không phải thứ dò được. Đây là câu đúng, thay cho "không có ẩn số nào" ở bản đầu.

### 3.4 Bề mặt lộ thêm — đo, không đoán

429 **đã** nói "đường này đang bị khoá". Thêm TTL nói thêm "còn bao lâu". Ba câu hỏi:

1. **Lộ email có tồn tại không?** KHÔNG. Bucket rate-limit chỉ đếm lần sai, dựng từ `(slug,email,ip)`
   **không tra DB**. Email-ma và email-thật sai 5 lần **từ IP riêng của mình** ⇒ cùng loại bucket
   (`ip`), cùng lịch sử, cùng TTL. → **ca test ghim** (§4.2 `§uniform`).

2. **Lộ bucket nào đang khoá?** Tên bucket thì KHÔNG — `details` chỉ mang `retryAfterSec`.
   ⚠️ **Bản plan đầu lập luận SAI ở đây** và suýt biến cái sai đó thành một ca test ghim ngược:
   nó viết "cả hai bucket dùng chung `LOGIN_LOCKOUT_SEC` ⇒ con số giống nhau". `LOGIN_LOCKOUT_SEC` là
   **TRẦN**; thứ trả ra client là **TTL CÒN LẠI** (`remainingLockSec`, `login-rate-limiter.ts:467`),
   phụ thuộc khoá được dựng lúc nào. Hai bucket dựng ở hai thời điểm khác nhau ⇒ hai con số khác nhau.

   **Bề mặt lộ THẬT, đã cân nhắc và CHẤP NHẬN:** kẻ tấn công từ IP mới tinh (0 lần sai) gõ một lần và
   nhận 429 (bucket `acct` đang khoá — `isLoginRateLimited` kiểm `acct` trước, `auth.service.ts:810`).
   `retryAfterSec = n` cho họ biết khoá được dựng cách đây `LOGIN_LOCKOUT_SEC − n` giây, tức "email này
   vừa ăn 20 lần sai từ nhiều nguồn vào lúc T".
   **Vì sao vẫn chấp nhận:** 429 hôm nay ĐÃ nói "đang bị khoá"; thời điểm T đo được sẵn bằng cách thử
   lại mỗi giây tới khi hết khoá. TTL chỉ **bỏ chi phí polling**, không mở thông tin mới. Đổi lại là
   cửa thoát cho người dùng thật — đúng mục tiêu wave S18.
   ⛔ **Cấm ghim** "hai bucket luôn cho cùng số" thành assert — đó là ghim một bất biến SAI
   (memory `tests-can-pin-a-hole-open`). Ca `§uniform` phải so **cùng-bucket**.

3. **Có giúp kẻ tấn công không?** Không rút ngắn khoá, không tăng số lần thử, không đổi ngưỡng nào.

### 3.5 FE

**`packages/web-core/src/lib/api-client.ts`** (∈ `paths`) — cạnh `ApiError`, nơi `details: unknown`
được sinh ra:

```ts
/** Giây phải chờ của một 429 mang `retryAfterSec`; `null` khi không phải 429/thiếu/hỏng hình. */
export function retryAfterSecFromError(err: unknown): number | null;
```

Bóc theo khuôn `parseRoomConflictsDetail` (`contracts/src/room.ts:314`): `details` là mảng
`{field,message,rule}`, tìm `field === 'retryAfterSec' && rule === 'retry-after'`, `Number.parseInt`,
chặn dải `1..86400`. Hỏng hình ⇒ `null` (FE rơi về chuỗi cũ) — **không ném, không hiện `0`**.

**`apps/auth/src/routes/login.tsx`:**

- state `lockRemainingSec: number | null`; `useEffect` hạ 1 mỗi giây bằng `setTimeout` tự lên lịch lại;
  chạm 0 ⇒ `setLockRemainingSec(null)` + `setError(null)` (giữ nguyên câu "quá nhiều lần thử" sau khi
  đã hết giờ là **nói sai** — hết giờ thì vào được).
- `disabled={busy || isEmpty || lockRemainingSec !== null}` ⇒ nút tự bật lại khi hết.
- Hiển thị `t("errors.tooManyAttemptsIn", { time: mm:ss })` khi đang đếm; ngược lại `error` như cũ.
- 429 **thiếu** `retryAfterSec` ⇒ `lockRemainingSec` = null ⇒ y hệt hành vi hôm nay.

**i18n** `packages/web-core/src/i18n/locales/vi/auth.ts`:
`tooManyAttemptsIn: "Quá nhiều lần thử. Thử lại sau {{time}}."` — **GIỮ** `tooManyAttempts` (3 call-site
khác vẫn dùng: `TwoFactorChallengeForm.tsx:18`, `forgot-password.tsx:50`, và chính `login.tsx` ở ca
thiếu số).

---

## 4. Test (RED trước)

### 4.0 Bước-0 BẮT BUỘC — vá mock TRƯỚC khi viết ca mới

Bỏ qua bước này thì lượt chạy đầu ĐỎ vì lý do không liên quan tới hành vi đang làm.

| File | Vấn đề đo được | Phải làm |
| --- | --- | --- |
| `common/filters/all-exceptions.filter.spec.ts:32` | helper `invoke()` dựng response mock **chỉ có `status`** (`getResponse: () => ({ status })`) — filter gọi `response.setHeader(...)` sẽ ném `TypeError` cho **cả 5 ca đang xanh** (`:47`, `:61`, `:79`, `:104`, `:111`) | Thêm `setHeader: vi.fn()` vào mock + trả nó ra để assert. **Và** filter chỉ gọi `setHeader` **có điều kiện** (429 + detail hợp lệ) — đừng để hình dạng response thành phụ thuộc bắt buộc |
| `auth/two-factor.service.spec.ts:117`, `:278` | `rateLimiter` là **`{} as never`** / `{}` — mock RỖNG. Nhánh 429 của `confirmEnable` (`two-factor.service.ts:194`) **chưa từng chạy** trong spec này | **Dựng mock từ số 0** (`isLocked` + `remainingLockSec` + `recordFailure` + `reset`), không phải "bổ sung một method" |

**Census mock `LoginRateLimiter` (SỬA — bản đầu ghi "5 spec" là sai):** `grep -rn "isLocked:" --include=*.spec.ts`
cho đúng **4 chỗ / 3 file**: `auth/auth.service.spec.ts:97` và `:341`, `auth/auth-status-guard.spec.ts:180`,
`auth/step-up/step-up.service.spec.ts:87`. Hai file bản đầu đếm nhầm (`login-rate-limiter.spec.ts`,
`forgot-password-rate-limit.spec.ts`) dùng **limiter THẬT** ⇒ không phải vá gì. Bài học: `grep -l` trên
tên method bắt cả file *dùng* lẫn file *mock*.

### 4.1 Unit

| File | Ca |
| --- | --- |
| `common/filters/retry-after.spec.ts` | `tooManyRequests(900)` → đúng 1 `ErrorDetail`; `tooManyRequests(null)` → **không** khai `details` **nhưng `message` GIỮ NGUYÊN**; cả hai nhánh: `type === "HttpException"` (không phải lớp con) và payload **không có khoá `code`**; `retryAfterHeaderValue` loại `0` / âm / `NaN` / `>86400` / `rule` sai / `field` sai |
| `common/filters/all-exceptions.filter.spec.ts` | 429 + detail hợp lệ ⇒ `setHeader('Retry-After','900')`; 429 KHÔNG detail ⇒ **0 lần** `setHeader`; **403** mang detail y hệt ⇒ **0 lần** `setHeader` (header chỉ thuộc về 429); `code` của 429 vẫn là `SYSTEM-ERR-RATE-LIMIT`; 5 ca cũ vẫn xanh |
| `auth/auth.service.spec.ts` | `login()` 429: `remainingLockSec` gọi với **khoá của bucket đang khoá** và **TRƯỚC** khi sàn chạy; TTL `null` ⇒ không có `details`; `remainingLockSec` **reject** ⇒ **vẫn 429**, không `details`, KHÔNG thành 500 (docblock `auth.service.ts:233-235` cấm 429→500); `disableTwoFactor`/`changePassword` 429 mang số |
| `auth/two-factor.service.spec.ts` | `confirmEnable` 429 mang số (mock dựng mới — §4.0) |
| `web-core/lib/api-client.spec.ts` | `retryAfterSecFromError`: đúng ⇒ số; status≠429 ⇒ null; `rule` sai ⇒ null; `message` không phải số ⇒ null; `0`/`-5`/`99999999` ⇒ null; `details` không phải mảng ⇒ null |
| `apps/auth/routes/login.spec.tsx` | 429 có số ⇒ hiện `mm:ss`, nút disabled; đồng hồ chạy ⇒ số giảm; hết giờ ⇒ nút bật lại + hết thông báo; 429 KHÔNG số ⇒ chuỗi cũ, nút **không** bị khoá; unmount giữa chừng ⇒ không rò timer |

**Chốt cách dùng đồng hồ giả (quyết ở plan, không để lúc code tự nghĩ):** `vi.useFakeTimers()` đặt
**trong `describe` của riêng ca đếm ngược** (`beforeEach` bật, `afterEach` `vi.useRealTimers()`) — KHÔNG
bật toàn file, vì các ca cũ dùng `waitFor` với timer thật sẽ treo. Nhích đồng hồ bằng
`await act(async () => { await vi.advanceTimersByTimeAsync(1000); })`. Lý do dùng bản `…Async`: state
update của React nằm trong callback `setTimeout`, bản đồng bộ không flush microtask của `act`.

### 4.2 Int-spec (LANE_DB) — `apps/api/test/integration/auth-s18-retryafter-e2e.int-spec.ts`

Khuôn mượn `auth-s18-unlock429-e2e.int-spec.ts` (seed tenant + `PasswordService` thật + supertest).

- **§e2e** — 5 lần sai qua HTTP ⇒ 429 có `error.details[0] = {field:'retryAfterSec', rule:'retry-after'}`,
  `message` là số nguyên `1..LOGIN_LOCKOUT_SEC`, **và** header `Retry-After` bằng đúng số đó.
- **§uniform** — email-ma vs email-thật, mỗi bên 5 lần sai **từ IP RIÊNG của mình** ⇒ cả hai khoá ở
  **cùng bucket `ip`**, cùng lịch sử. Hai body 429 **giống hệt nhau** sau khi bỏ `meta`
  (request_id/timestamp) và cho phép `retryAfterSec` chênh ≤ 2s (đồng hồ trôi giữa hai vòng, không phải
  tín hiệu).
  ⛔ **KHÔNG** viết ca "bucket `acct` và bucket `ip` cho cùng số" — sai (§3.4 điểm 2) và sẽ ghim một
  bất biến không tồn tại. So sánh chỉ hợp lệ khi **cùng bucket**.
- **§nolock** — đăng nhập SAI mật khẩu lần 1 (401, chưa khoá) ⇒ **không** có `Retry-After`.
- **§floor** (mới — phủ `done_when[1]`, xem §4.4) — đo thời gian phản hồi hai nhánh, chứng minh sàn
  vẫn nuốt trọn round-trip TTL vừa thêm.

### 4.3 Đột biến kiểm chứng (ghi lại kết quả vào §6)

| Bỏ đi | Ca phải ĐỎ |
| --- | --- |
| vế `details` trong `tooManyRequests` | §e2e (body) + login.spec (đếm ngược) |
| `response.setHeader` trong filter | §e2e (header) + filter.spec |
| dời đọc TTL ra SAU `finally` | auth.service.spec (thứ tự gọi) + §floor |
| bỏ chặn dải trong `retryAfterSecFromError` | api-client.spec (`0`/âm/quá lớn) |

### 4.4 `done_when[1]` — ca ĐO THỜI GIAN (bản đầu BỎ SÓT)

`harness/backlog.mjs:17155` đòi: *"Đọc TTL nằm TRONG `applyUniformResponseFloor`: ca đo thời gian nhánh
429 vs nhánh sai-mật-khẩu KHÔNG tách được"*. Bản plan đầu chỉ ghim **THỨ TỰ GỌI** — thứ tự đúng là điều
kiện CẦN, không phải điều kiện ĐỦ: đặt đúng chỗ mà round-trip vượt ngân sách thì sàn vẫn hở.

**§floor — thiết kế để KHÔNG flake** (đo phân phối, không đo một mẫu):

- Ba nhóm, mỗi nhóm N = 15 lượt tuần tự trên `LANE_DB`: **(a)** 429 slug ĐÚNG · **(b)** 429 slug SAI ·
  **(c)** 401 sai-mật-khẩu (nhánh đối chứng, có `password.hash` burn).
- Assert **sàn** trước tiên (đây mới là thứ WO này chịu trách nhiệm): p50 của (a) và (b) đều
  `>= BLOCKED_LOGIN_FLOOR_MS` ⇒ chứng minh round-trip TTL **chưa** ăn hết ngân sách.
- Assert **không tách được**: `|p50(a) − p50(b)| < 60ms`. Ngưỡng chọn theo jitter thật
  (`FORGOT_PW_JITTER_MS = 80`) — nhỏ hơn jitter thì đo được nhiễu, lớn hơn nhiều thì cổng vô dụng.
- **KHÔNG** assert quan hệ giữa (a)/(b) và (c): 429 (không băm) và 401 (có argon2) vốn khác nhau
  **theo thiết kế** — ghim chúng bằng nhau là ghim một điều sai. (c) chỉ để ghi số vào §6 làm mốc.
- Chạy `--no-file-parallelism` cho file này; nếu p50 dao động > 20% giữa hai lượt liên tiếp ⇒ **báo
  người**, đừng nới ngưỡng cho xanh (memory `tests-can-pin-a-hole-open`).

⚠️ Nếu khi chạy thật ca này tỏ ra flake không cứu được trên máy CI, **KHÔNG được im lặng bỏ**: ghi số
đo tay vào §6 + nêu lệch `done_when` để owner chốt (memory `wo-seed-hand-measurements-can-be-incomplete`).

---

## 5. Rủi ro & giảm thiểu

| # | Rủi ro | Giảm thiểu |
| --- | --- | --- |
| R1 | Đọc TTL đặt sai chỗ ⇒ đẻ oracle ở nhánh 429 của login | Ca test ghim **thứ tự gọi** (`remainingLockSec` trước `setTimeout` của sàn), + §3.3 ghi ràng buộc trong comment tại chỗ |
| R2 | `details` mở đường cho caller sau này nhét dữ liệu chưa lọc quyền vào 429 | Chỉ đi qua `tooManyRequests()`; filter vẫn lọc hình dạng runtime như cũ |
| R3 | Mock `LoginRateLimiter` dựng tay vỡ khi nhánh 429 gọi thêm method | **4 chỗ / 3 file** (census sửa ở §4.0) + `two-factor.service.spec.ts` mock RỖNG phải dựng mới. Bản đầu ghi "5 spec" là đếm nhầm |
| R4 | Countdown FE rò `setTimeout` khi unmount / khi user điều hướng | `useEffect` trả cleanup `clearTimeout`; ca test unmount |
| R5 | Đổi chữ ký `isLoginRateLimited` làm hỏng call-site khác | `grep` = 2 hit (định nghĩa `:804` + gọi `:255`); `private`, không export, không spec nào gọi. ⚠️ **PHẢI giữ thứ tự `acct` (`:810`) TRƯỚC `ip` (`:812`)** — có int-spec canh đúng điều đó (`login-blocked-attribution.int-spec.ts:297`), và §3.2 dựa vào thứ tự này để TTL trả về là số ĐÚNG |
| R6 | i18next escape `{{time}}` làm hỏng `mm:ss` | `:` không nằm trong bảng escape của i18next; ca test assert đúng chuỗi `15:00` |
| R7 | `RETRY_AFTER_MAX_SEC = 86400` chặn câm một khoá THẬT | `LOGIN_LOCKOUT_SEC` **không có `.max()`** (`env.schema.ts:116`) ⇒ ops đặt > 86400 thì `retryAfterSec` bị loại, FE về chuỗi cũ trong khi khoá là thật. Chấp nhận (fail-safe đúng chiều: mất tiện ích, không mất control) — nhưng **ghi vào docblock của hằng số** để người sau không mất một buổi truy |
| R8 | Đọc TTL ném ⇒ 429 biến thành **500** | `assertKeysScoped` chỉ ném khi `NODE_ENV==='test'` (`valkey-key.ts:240-241`) và khoá dựng từ chính builder vừa qua `isLocked` ⇒ rủi ro thấp. Vẫn có **ca test** `remainingLockSec` reject ⇒ vẫn 429 (§4.1). KHÔNG bọc `try/catch` nuốt câm — ca test là thứ giữ hợp đồng, không phải lớp catch |
| R9 | FE: `remainingLockSec` = `null` mà bucket VẪN khoá (Valkey bật, `ttl` trả `-1`) ⇒ nút Submit không bị khoá, người dùng bấm lại và ăn 429 tiếp | **Có chủ ý** — đúng bằng hành vi hôm nay, không phải hồi quy. Ghi ra để người sau không tưởng là bug |

---

## 6. Thứ tự thi công (DoD)

1. **§4.0 trước hết** — vá 2 mock (filter spec + `two-factor.service.spec.ts`). Chạy `pnpm --filter
   @mediaos/api test src/common/filters src/auth` cho XANH **trước khi** đụng code sản phẩm.
2. RED: viết ca mới ở §4.1 (phải ĐỎ đúng lý do đang làm, không phải đỏ vì mock).
3. GREEN BE: `retry-after.ts` → filter đặt header → 5 chỗ ném → `isLoginRateLimited` trả `{bucket,key}`.
4. GREEN FE: `retryAfterSecFromError` → i18n `tooManyAttemptsIn` → `login.tsx` đếm ngược.
5. Int-spec §e2e/§uniform/§nolock/§floor trên `LANE_DB=mediaos_s18retry`.
6. Chạy bảng đột biến §4.3 — ghi kết quả TỪNG dòng vào §7.
7. `bash harness/check.sh --all --lane-db=s18retry` + typecheck api/contracts/web-core/auth.
8. **Cập nhật `harness/backlog.mjs`** (`status` của WO) — `harness/backlog.mjs` nằm trong `paths` và
   CLAUDE.md §8 đòi; bản plan đầu bỏ sót bước này.
9. `security-reviewer` (WO notes: LIGHT + security-reviewer vì đây là đường 429 của auth) → PR.

**Ngoài phạm vi, ghi thành nợ khi mở PR:** `step-up.service.ts:122` (§1) — 429 AUTH duy nhất còn lại
không mang `retryAfterSec`.

## 7. Kết quả chạy thật

Chạy 03/09 trên `LANE_DB=mediaos_s18retry` (Postgres cục bộ + Valkey).

### 7.1 Test

| Bộ | Kết quả |
| --- | --- |
| `src/common/filters/retry-after.spec.ts` (mới) | 11/11 xanh |
| `src/common/filters/all-exceptions.filter.spec.ts` | 9/9 xanh (5 ca CŨ + 4 ca header mới) |
| `src/auth/auth.service.spec.ts` | 24/24 xanh (16 cũ + 8 mới) — bản đầu ghi 25, đếm sai, sửa sau review |
| `src/auth/two-factor.service.spec.ts` | 21/21 xanh (18 cũ + 3 mới) |
| `packages/web-core/src/lib/retry-after.spec.ts` (mới) | 8/8 xanh |
| `apps/auth/src/routes/login.spec.tsx` | 17/17 xanh (11 cũ + 6 mới) |
| `test/integration/auth-s18-retryafter-e2e.int-spec.ts` (mới) | 4/4 xanh |

### 7.2 §floor — số đo thật (`done_when[1]`)

```text
[s18-retryafter §floor] p50 — 429 slug-đúng: 314ms · 429 slug-sai: 323ms
                              401 đối chứng (KHÔNG assert): 43ms · sàn=250ms
```

- **Sàn còn tác dụng:** cả hai nhánh 429 đều **≥ 250ms** ⇒ round-trip TTL vừa thêm CHƯA ăn hết ngân
  sách. Đây là điều WO này chịu trách nhiệm.
- **Không tách được:** |314 − 323| = **9ms**, dưới ngưỡng 60–80ms chọn theo `FORGOT_PW_JITTER_MS = 80`.
- 401 (43ms) thấp hơn hẳn — **đúng theo thiết kế** (429 không có `password.hash` burn). KHÔNG assert
  quan hệ này; chỉ ghi làm mốc.

⚠️ **Sửa thiết kế §4.2/§4.4 khi chạy thật:** bản plan ghi "429 slug ĐÚNG vs 429 slug SAI" bằng cách đổi
slug trên **cùng một bucket đã khoá** — điều đó KHÔNG chạy được: bucket rate-limit **khoá theo slug**
(`LoginRateLimiter.key(slug,email,ip)`), nên đổi slug cho ra bucket khác ⇒ chưa khoá ⇒ **401**, không
phải 429. Ca thật phải khoá **RIÊNG một bucket cho slug ma** rồi mới đo. Đã sửa trong int-spec.

Giới hạn đã biết của ca này (ghi ra, không giấu): mọi mẫu đều là 429 **sau** lần đầu của cửa sổ, nên
`claimBlockedLogSlot` đã gộp và không nhánh nào ghi `login_logs`. Nó đo đúng thứ WO này thêm vào (round
trip TTL nằm trong sàn), KHÔNG đo chênh lệch của **lần 429 đầu cửa sổ** (đo được điều đó cần 15 cửa sổ
mới × 5 lần argon2 mỗi cửa sổ — quá đắt cho giá trị thêm).

### 7.3 Đột biến kiểm chứng (§4.3) — chạy TỪNG dòng

| Bỏ đi | Ca ĐỎ thật sự | Kết quả |
| --- | --- | --- |
| vế `details` trong `tooManyRequests` | §e2e (body) | ✅ ĐỎ |
| `retryAfterSecFromError` không bao giờ trả số | `login.spec.tsx` (đếm ngược) | ✅ ĐỎ 4 ca |
| `response.setHeader` trong filter | filter.spec + §e2e (header) | ✅ ĐỎ cả hai |
| dời đọc TTL ra SAU `finally` | `auth.service.spec` (thứ tự gọi) | ✅ ĐỎ |
| bỏ chặn dải trong `retryAfterSecFromError` | `retry-after.spec` (`0`/âm/quá lớn) | ✅ ĐỎ |

⚠️ **Bẫy gặp khi chạy đột biến FE:** lượt đầu tưởng "không ca nào bắt" — thực ra bản vá đột biến tạo
**unreachable code** làm `pnpm --filter @mediaos/web-core build` ĐỎ, nên `dist/` giữ nguyên bản CŨ và
`apps/auth` (đọc web-core qua **dist**, không phải src) vẫn chạy code đúng. Đột biến FE phải **kiểm
build xanh** trước khi kết luận. (Cùng họ với memory `web-core-stale-dist-white-page`.)

### 7.4 Lệch so với plan — đã làm KHÁC, có lý do

1. **§4.2/§4.4 §floor** — xem 7.2.
2. **FE dùng MỐC HẾT HẠN, không phải bộ đếm lùi** (`lockUntilMs` + tính lại từ `Date.now()` mỗi nhịp).
   Plan §3.5 ghi "hạ 1 mỗi giây". Đổi vì hai lý do: (a) `setTimeout` bị trình duyệt bóp xuống ≥1
   lần/phút khi tab chạy nền ⇒ bộ đếm lùi chạy CHẬM HƠN khoá thật và giam người dùng thêm sau khi
   server đã mở; (b) chuỗi nhịp không còn đi vòng qua React state nên không phụ thuộc commit kịp hay
   không. Hành vi ngoài (mm:ss, tự nhả nút, ca thiếu số) giữ nguyên như plan.
3. **Thêm ca cho chỗ ném 429 THỨ NĂM** — `AuthService.completeTwoFactorLogin` (`auth.service.ts:575`).
   Plan §4.1 liệt kê ca cho `login`/`disableTwoFactor`/`changePassword`/`confirmEnable` nhưng BỎ SÓT
   đường này; `grep verifyTwoFactorChallenge --include=*.spec.ts` chỉ ra spec của `TokenService`, không
   phải của đường này ⇒ nhánh 429 ở đó **chưa từng chạy** trong bất kỳ spec nào (cùng họ với mock rỗng
   mà §4.0 đã bắt ở `two-factor.service.spec.ts`). Đã thêm ca.
4. **`remainingLockSecSafe`** — plan R8 vừa đòi ca "TTL ném ⇒ vẫn 429" vừa cấm `try/catch`. Giải bằng
   khuôn ĐÃ CÓ ngay trên trong cùng file (`resolveBlockedLogOwner`): fail-soft **có LOG**, không phải
   catch câm. Có ca test ghim cả hai vế (vẫn 429 **và** `logger.warn` được gọi).

## 8. Nợ mở khi lên PR

- `auth/step-up/step-up.service.ts:122` — 429 AUTH **duy nhất còn lại** không mang `retryAfterSec`
  (ngoài `paths` của WO này). Sau WO này AUTH có **hai hợp đồng 429**: 5 chỗ mang số, `stepUp` thì
  không. Owner quyết có seed WO nối tiếp hay không.
- `chat/chat-calls.service.ts:531` và `notifications/lms-service-intake.guard.ts:107` — khác module /
  kênh máy-tới-máy, cố ý ngoài phạm vi (§1).

## 9. Review gate (03/09, sau commit `e926f282`)

`security-reviewer` độc lập (đọc code thật + chạy lại 7 bộ test): **PASS · 0 CRITICAL · 0 HIGH**.
Bất biến kiểm: tenant ✓ · audit append-only ✓ · secret ✓ · authz ✓ · authn ✓.

**Đã vá theo review (commit kế tiếp):**

1. **§floor không thể ĐỎ** (MEDIUM) — `expect(p50 >= 250)` xanh kể cả khi round-trip TTL ngốn 5 giây,
   vì sàn ngủ tới MỐC TUYỆT ĐỐI. Tức ca này KHÔNG ghim được điều §7.2 tuyên bố; thứ thật sự ghim
   `done_when[1]` là ca **thứ tự gọi** ở `auth.service.spec`. Thêm assert **trần**
   `FLOOR_BUDGET_CEILING_MS = sàn + jitter + 250` — bắt được việc TTL tràn RA NGOÀI sàn.
2. **Nhãn `--no-file-parallelism` chỉ là văn xuôi** (MEDIUM) — `vitest.config.ts` không hề đặt
   `fileParallelism:false`, file vẫn chạy song song. Sửa docblock nói ĐÚNG hiện trạng + ghi rõ ca chịu
   nhiễu bằng p50 xen kẽ và ngưỡng thô, không phải bằng cô lập worker.
3. `.rejects.toThrow()` TRẦN ở ca "không khoá ⇒ không đọc TTL" → ghim `UnauthorizedException` (ca cũ
   xanh với cả `TypeError` do mock thiếu).
4. `code` của 429 chỉ so với `httpStatusToCode(429)` (implementation với chính nó) → ghim thêm literal
   `SYSTEM-ERR-RATE-LIMIT` ở **unit** spec, vì int-spec SKIP khi không có `LANE_DB`.
5. Docblock `remainingLockSecOrNull` nói nhánh `catch` là điểm quan sát "Valkey rớt" — LỆCH một tầng
   (`ValkeyService.ttl` never-throws). Sửa lại cho đúng: nó là lưới cho lỗi lập trình của chỗ gọi.
6. §7.1 đếm sai `auth.service.spec` 25 → **24**.

**Ghi nhận, KHÔNG vá (owner đọc rồi quyết):**

- **Bề mặt lộ đã chấp nhận** (§3.4): kẻ tấn công từ IP mới nhận `retryAfterSec = n` của bucket `acct`
  ⇒ suy ra khoá dựng lúc `T = now − (LOGIN_LOCKOUT_SEC − n)`. Không lộ email tồn tại, không rút ngắn
  khoá, và T vốn đo được bằng polling ⇒ đây là **bỏ chi phí polling**, không phải kênh mới.
- **Đếm ngược FE có thể sống lâu hơn khoá thật** (LOW): admin gỡ khoá bằng S18-AUTH-UNLOCK429-1 thì FE
  vẫn giam nút Submit tới hết `lockRemainingSec` (lối thoát: tải lại trang). Cùng họ: đồng hồ hệ thống
  nhảy lùi ⇒ đếm ngược phình. Không mất control (server vẫn là cổng).
- **Tab chạy nền**: mốc hết hạn chống trôi tích luỹ, nhưng nhịp cuối vẫn bị bóp ≥1 lần/phút ⇒ quay lại
  tab có thể thấy nút khoá thêm tới ~60s sau khi server đã mở. Vá gọn = listener `visibilitychange`.
- `step-up.service.ts:122` — 429 AUTH duy nhất còn lại chưa mang số (§8).


## 10. Hồi quy CI: refactor 429 làm MÙ một cổng an ninh có sẵn (03/09, sau `484c0ea5`)

**Triệu chứng.** Hai job CI ĐỎ trên PR #474 (`Build · Typecheck · Migrate · Test` và
`Lint · Typecheck · Migrate · RLS Test`), cùng MỘT gốc: `test/foundation/login-log-429-ratchet.unit-spec.ts`
(cổng S10-SEC-LOGINLOG429-1 / KI-047), hai ca:

| Ca | Thông điệp |
| --- | --- |
| (2) chống xanh-rỗng | `scanner không thấy điểm ném 429 nào trong apps/api/src/auth — nó đang hỏng: expected 1 to be >= 6` |
| (1b) waiver phải CÒN im lặng | `expected [ Array(3) ] to deeply equal []` |

**Cơ chế.** `login-log-429-census.ts` nhận diện điểm ném theo hình `throw`-có-nhắc-`HttpStatus.TOO_MANY_REQUESTS`.
WO này gom **5/6** điểm ném về nhà máy chung `throw tooManyRequests(...)` (`src/common/filters/retry-after.ts`)
⇒ census chỉ còn thấy **1** (`step-up.service.ts:122`, chỗ duy nhất giữ hình cũ). Ca (1b) đỏ là **hệ quả**,
không phải quyết định độc lập: ba waiver biến mất khỏi census nên "không còn im lặng" theo nghĩa của phép đo.

⚠️ Đây là dạng hồi quy đáng sợ nhất của một refactor sạch: **không có test nào đỏ vì hành vi**, mà một
**cổng** mất thị lực. Nếu ca (2) không có SÀN ≥6 thì ca (1) đã XANH-RỖNG và điểm ném thứ bảy mọc lên
sau đó sẽ không ai thấy — đúng kịch bản KI-047 mở lại.

**Bản vá (thuộc chính WO này, không defer).** Dạy census hình thứ hai, neo theo ĐỊNH NGHĨA chứ không
theo tên ([[index-ratchet-must-pin-definition-not-name]]):

- `tooManyRequestsFactoryNames()` — quét `src/auth` + `src/common`, thu tên **hàm có câu `return` trả về
  429**. Danh sách sinh từ mã nguồn, KHÔNG hard-code chuỗi `"tooManyRequests"`. Điều kiện là `return`
  (không phải "nhắc đâu đó trong thân") để `stepUp()` — chỗ **ném** 429 — và `all-exceptions.filter.ts`
  — chỗ **ánh xạ** mã trạng thái — không bị nhận nhầm là nhà máy.
- `ThrowSite.via: "inline" | "factory"` — ghi lại hình đã nhận ra, để ca neo đo được nhánh dò mới có CHẠY.
- Ca **(2b)** mới: nhà máy ≠ rỗng · có `tooManyRequests` · ≥5 điểm ném nhận qua hình `factory`.
  Ca (2) chỉ nói "scanner đang hỏng"; (2b) nói hỏng **ở đâu**.
- **KHÔNG hạ sàn ≥6.** Hạ sàn là bịt miệng cổng — cái bẫy mà chính WO này suýt rơi vào.

**Kiểm chứng bằng đột biến (3/3 ĐỎ đúng chỗ):**

| # | Đột biến | Kết quả |
| --- | --- | --- |
| M1 | Gỡ `recordLoginAttempt` khỏi nhánh 429 của `login()` | ĐỎ ca (1) + neo dương ca (2) — chứng minh `logsInBranch` vẫn đo qua hình `factory` |
| M2 | `tooManyRequests` trả `BAD_REQUEST` thay vì 429 | ĐỎ ca (2) + (2b) `expected 0 to be greater than 0` — định-nghĩa-đổi thì cổng đỏ, không im |
| M3 | Thêm điểm ném thứ bảy im lặng `throw tooManyRequests(null)` trong `src/auth` | ĐỎ ca (1), chỉ đúng tên `MutantService#guard (auth/mutant-seventh-site.ts:6)` |

M3 là ca đáng giá nhất: **trước** bản vá nó XANH (census mù với hình factory) — tức lỗ hổng thật, không
phải chuyện thẩm mỹ.

**Bài học ghi ra ngoài WO:** một refactor gom điểm ném về hàm chung có thể vô hiệu hoá census/ratchet
quét theo *hình dạng cú pháp*. Trước khi gom, `grep` xem hình cũ có đang bị cổng nào đếm không.
