# S6-SEC-LOGINLOG-2 — KI-044: gắn ĐÚNG CHỦ cho hàng `blocked/TooManyAttempts`

> WO: `S6-SEC-LOGINLOG-2` · zone 🔴 · module AUTH · layer SEC
> Phụ thuộc: `S6-SEC-LOGINLOG-1` (✅ merged #300, mig 0532)
> KI: `RELEASE-02` KI-044 (S3) — mở 2026-07-28 từ FULL gate của WO trước
> Trạng thái plan: **v2** — v1 bị `plan-reviewer` **BLOCK**; xem §9 nhật ký sửa

---

## 1. Vấn đề (một câu)

`isLoginRateLimited()` chạy **TRƯỚC** `resolveCompanyId()`, nên hàng `blocked/TooManyAttempts` ghi
`company_id = NULL` **kể cả khi `companySlug` HOÀN TOÀN HỢP LỆ** — không phải vì nó vô chủ, mà chỉ vì
lúc ghi ta CHƯA kịp tra tenant.

```text
apps/api/src/auth/auth.service.ts
  :199  if (await this.isLoginRateLimited(req.companySlug, req.email, ip)) {
  :201      await this.recordLoginAttempt({ companyId: null, ... status:"blocked", reason:"TooManyAttempts" })
  :210      throw 429
        }
  :215  const companyId = await this.resolveCompanyId(req.companySlug);   ← TRA TENANT Ở ĐÂY, QUÁ MUỘN
```

Sau mig 0532 (vế `USING` của `tenant_isolation` chỉ còn cho tenant hiện tại), **hàng NULL không tenant
nào đọc được**. Vì vậy company-admin qua `AUTH-API-401` **không còn thấy** các lần brute-force nhắm vào
chính công ty mình.

Đo PROD 2026-07-28: **165/268 hàng NULL (~62%) là `blocked/TooManyAttempts`** ⇒ ~62% hàng NULL thực ra
**CÓ CHỦ**, đang bị gắn sai.

| | |
| --- | --- |
| Có phải rò rỉ? | **Không.** Không ai đọc được dữ liệu ngoài phạm vi. Đây là mất **tầm nhìn của bên phòng thủ**. |
| Có phải hồi quy do 0532? | **Không.** Dữ liệu vốn gắn sai chủ từ S2; 0532 chỉ làm hậu quả lộ ra. |
| Vá đúng là gì? | Gắn ĐÚNG CHỦ khi slug resolve được. **KHÔNG** nới lại `USING`. |

### 1.1 ⚠️ RANH GIỚI — WO này lấy lại được BAO NHIÊU tầm nhìn (nói đúng, không nói quá)

Đã đọc đường đọc thật (`auth-logs-viewer.service.ts:88-106`) trước khi hứa. Sau vá, hàng `blocked` hiện
ra ở `AUTH-API-401` với **`ip_address` · `user_agent` · `failure_reason=TooManyAttempts` · `created_at`**,
nhưng trường **`user` = `null`**: `userRef()` (`:88-95`) trả `null` khi thiếu `user_id`, mà hàng
`blocked/**TooManyAttempts**` luôn có `user_id IS NULL` (bất biến ở §2.4). DTO `LoginLogListItem`
(`packages/contracts/src/auth.ts:337`) **không có** trường `email` — cột `login_logs.email` cố ý không
lên DTO (§17 DTO tối giản).

⇒ Admin lấy lại được: **"có bị nện brute-force không · từ IP/UA nào · lúc nào · bao nhiêu lần"**.
⇒ Admin **KHÔNG** lấy lại được: **tài khoản nào đang bị nhắm**.

Đó vẫn là đúng phần mà KI-044 mô tả (phát hiện brute-force), nhưng văn bản đóng KI phải ghi nguyên vế
thứ hai — không được viết "tầm nhìn đã trở lại" trống trơn. Đưa `email` lên DTO là quyết định lộ dữ liệu
riêng, **KHÔNG** gộp vào WO này.

> ⚠️ **Chỉ đúng cho `TooManyAttempts`, KHÔNG đúng cho mọi hàng `blocked`.** `auth.service.ts:331-338`
> ghi `status:"blocked"` kèm `userId: result.userId` cho nhánh `Inactive` (tài khoản suspended) — hàng đó
> **CÓ** `user_id` và `company_id`, đang được ghim bởi `auth-blocked-status.int-spec.ts:154-160`. Vì vậy
> `listLoginLogs(A, {status:'blocked'})` trả về **cả hai loại**; ca R2 phải khoá theo `id` hàng, không
> được lọc bằng `failure_reason` (DTO không có `email` để phân biệt).

### 1.2 ⚠️ RANH GIỚI — bốn đường 429 KHÁC không ghi một dòng `login_logs` nào

Trong `apps/api/src/auth/**`: `auth.service.ts:211` (login — **đường DUY NHẤT** ghi `login_logs`), `:410`
(2FA bước-2), `:531` (tắt 2FA), `:566` (đổi mật khẩu), `two-factor.service.ts:187`. Bốn chỗ sau **không**
gọi `recordLoginAttempt`. (Ngoài `auth/**` còn `notifications/lms-service-intake.guard.ts:107` — không
phải đường login, không liên quan; **đừng** viết "grep trả về đúng 5 chỗ" vào văn bản đóng KI.)
Đáng kể nhất là `:410` — dò mã 6 số là brute-force thật, hiện chỉ có
`securityAlerts` (`:419-427`), không có dòng nào ở `AUTH-API-401`.

⇒ WO này **KHÔNG** mở rộng sang đó. Mở **KI-047** để không trôi mất (RELEASE-02 nằm trong `paths`).

---

## 2. Quyết định thiết kế (CHỐT TRƯỚC KHI SỬA)

### 2.1 Resolve **BÊN TRONG** nhánh đã-bị-chặn (không đảo thứ tự đường login)

```text
if (await this.isLoginRateLimited(slug, email, ip)) {
    const startedAt = Date.now();
    try {
        const ownerCompanyId = await this.resolveBlockedLogOwner(slug);   // null nếu slug sai/inactive
        await this.recordLoginAttempt({ companyId: ownerCompanyId, userId: null, status:"blocked", ... });
    } finally {
        await this.applyUniformResponseFloor(startedAt, BLOCKED_LOGIN_FLOOR_MS);   // §2.3
    }
    throw 429;
}
const companyId = await this.resolveCompanyId(slug);                      // KHÔNG ĐỔI — quyết định auth
```

| | đảo thứ tự (đưa resolve lên trước) | resolve trong nhánh blocked (**chọn**) |
| --- | --- | --- |
| Request **không** bị chặn | +1 lượt tra DB **cho mọi request** | **0** — đường đi y nguyên |
| Cân bằng timing ở `:219` (`password.hash` burn) | phải thẩm định lại toàn bộ | **không đụng tới** |
| Bề mặt DoS mới | mọi request, kể cả request đầu | chỉ request **đã** bị chặn |

### 2.2 Cân đánh đổi DoS (done_when #1)

**KHÔNG dùng cache.** v1 của plan này đề xuất một `CompanySlugCache` (TTL 60s, có trần). `plan-reviewer`
bác đúng, và giữ lại lập luận đó ở đây để WO sau không đề xuất lại:

- Nó khử **đúng một** index-probe (`resolve_company_by_slug` là `STABLE`, `0002:78-88`) trong một request
  **vẫn phải chạy trọn một transaction ghi** ⇒ lợi ích biên.
- Đổi lại phải nhập 3 bất biến mới (đối xứng dương/âm chống oracle · trần bộ nhớ vì slug do client gửi ·
  cấm rò sang đường auth `:215`) và **một lỗ ghi-chéo-tenant thật**: `0002_companies_users.sql:19` cho
  **tái dùng slug sau soft-delete** (`companies_slug_active_uq … WHERE deleted_at IS NULL`). Công ty A
  (slug `acme`) bị soft-delete → B lấy `acme` → trong ≤TTL cache trả id của **A** ⇒ email/IP/UA của người
  dùng B được INSERT dưới `company_id = A`. FK vẫn pass (hàng soft-delete còn nguyên) ⇒ **im lặng**.
  Chạm BẤT BIẾN #1. Vá một lỗ quan sát mà mở một lỗ cô lập = lỗ.

**Cách giảm thiểu được chọn** — ⚠️ đọc kỹ: đây là một **biến thể** của nhánh thứ hai trong `done_when #1`,
**không phải** đúng nguyên văn. Nguyên văn (*"chỉ resolve khi đã qua chặn thô theo IP"*) nghĩa là resolve
cho request **ĐÃ VƯỢT** bộ chặn; ở đây làm **ngược lại** — chỉ resolve cho request **BỊ CHẶN**. Biến thể
này phục vụ đúng ý đồ của tiêu chí (không thêm chi phí cho đường thường) và **rẻ hơn** nguyên văn, nhưng
văn bản đóng WO phải nói "đã chọn biến thể khác và vì sao", không được tuyên bố tuân thủ nguyên văn.
Gồm ba vế:

1. **Chỉ resolve khi ĐÃ bị chặn.** Request không bị chặn: chi phí **không đổi một byte**.
2. **Đường bị chặn VỐN ĐÃ ghi DB** — `recordLoginAttempt` ở `:201` đã là một `INSERT` cho mỗi request bị
   chặn từ trước WO này. Không mở ra một *lớp* bề mặt mới.
3. **Số slug phân biệt trên đường blocked tự bị chặn sẵn:** để VÀO được nhánh blocked với slug S, kẻ tấn
   công phải trả trước `LOGIN_MAX_ATTEMPTS = 5` (`env.schema.ts:87`) lượt argon2 ở `:219` cho mỗi
   `(slug,email,ip)`. Cái giá dựng bucket lớn hơn nhiều cái giá khai thác nó.

**Chi phí thật sau vá (nhánh blocked, phía DB):** `1 statement trần` → `1 SELECT + transaction 4
round-trip`. Trục cần theo dõi **không phải CPU** mà là **slot kết nối**: `apps/api/src/db/index.ts:18`
đặt app pool `max: 20` — thứ có thể bỏ đói đăng nhập thật là **pool**, không phải giấc ngủ của sàn.

**Vế thứ hai của cái giá — số request đang bay:** không có throttler tầng HTTP nào trong repo (không
`@nestjs/throttler`, không `express-rate-limit`); backpressure duy nhất trên `/auth/login` chính là bucket
sinh ra 429. Sàn biến một request ~2ms thành ~280ms ⇒ với cùng tốc độ đến, số request đồng thời đang bay
tăng ~100× (chỉ giữ socket + timer, **không** giữ slot DB — §2.3). Với kẻ tấn công đồng bộ thì sàn **giảm**
tải; với kẻ tấn công bất đồng bộ thì đây là cái giá phải ghi nhận. §6 phải đo **cả hai**: p50/p95 phía DB
**và** số request đồng thời khi bắn N request bị chặn song song.

### 2.3 ⚠️ Bản vá tự đẻ ra oracle "slug có tồn tại" — phải bịt cùng lúc (done_when #2)

Phát hiện của `plan-reviewer`, đã xác minh trên mã. Oracle **không** đến từ cache mà từ **HÌNH DẠNG
đường ghi**:

| nhánh 429 | đường ghi | round-trip |
| --- | --- | --- |
| slug HỢP LỆ (sau vá) | `dbsvc.withTenant` → `BEGIN` + `set_config` + `INSERT` + `COMMIT` (`db.service.ts:83-92`) | **4** |
| slug SAI | `db.insert(loginLogs)` trần (`auth.service.ts:1581`) | **1** |

Nhánh 429 **không** có `password.hash` burn (khác `:219`, vốn tồn tại chính vì lý do này) ⇒ baseline
~1-2ms ⇒ chênh 3 round-trip là tín hiệu tương đối lớn. Kẻ tấn công trả 5 lần sai để khoá bucket rồi có
`LOGIN_LOCKOUT_SEC = 900s` (`env.schema.ts:88`) lấy mẫu **miễn phí, không giới hạn** — rate-limit không
chặn được vì chính phản hồi bị chặn LÀ mẫu. **Hôm nay hai nhánh 429 giống hệt nhau ⇒ đây là oracle MỚI
do bản vá sinh ra.** Không bịt = vá KI-044 bằng cách mở một lỗ dò tenant.

**Chốt: bọc toàn nhánh 429 bằng sàn thời gian đồng nhất** — tái dùng `applyUniformResponseFloor()`
(`auth.service.ts:1266`, tiền lệ `forgotPassword` cho đúng lớp mối đe doạ này), tổng quát hoá tham số
`floorMs`, thêm hằng số riêng `BLOCKED_LOGIN_FLOOR_MS`.

- Đặt trong `finally` ⇒ áp cho **cả** nhánh ném lẫn nhánh thường.
- Sàn áp **sau khi** transaction đã commit và trả connection về pool ⇒ thời gian chờ **không** giữ slot
  PgBouncer, chỉ giữ socket HTTP.
- Giá trị: `BLOCKED_LOGIN_FLOOR_MS = 250` + jitter sẵn có (`FORGOT_PW_JITTER_MS = 80`) — trùm xa cả hai
  nhánh (~1-10ms).
- Trung thực về giới hạn: sàn là **GIẢM THIỂU, không phải chứng minh**. DB chậm bất thường (> sàn) thì
  chênh lệch lộ lại — đúng caveat đã ghi sẵn ở `:1263` cho forgot. §6 phải có số đo, không chỉ lập luận.

*Đã cân nhắc và loại:* làm hai đường ghi cùng hình dạng (nhánh NULL cũng chạy trong transaction với
`set_config('app.current_company_id','',true)` — vẫn lọt vế NULL của `WITH CHECK` `0532:69-75`). Không
tốn thêm wall-clock, **nhưng** phải sửa đường ghi pre-auth crown dùng chung bởi cả nhánh
`CompanyInactive`, và chỉ cân đúng *một* khác biệt đã biết — khác biệt mới thêm sau này sẽ mở lại oracle
trong im lặng. Sàn thời gian bền hơn trước thay đổi tương lai.

### 2.4 Cái gì KHÔNG đổi (hàng rào)

| Bất biến | Cách giữ |
| --- | --- |
| **KHÔNG nới `USING` của `tenant_isolation`** (done_when #3) | **WO này KHÔNG có migration.** Không file nào trong `apps/api/migrations/**` bị đụng. Head master = `0533`. |
| Hàng `CompanyInactive` PHẢI vẫn NULL (done_when #4) | Nhánh `:215` **không đổi**. Nhánh blocked dùng **CÙNG** vị ngữ resolve (`status !== 'active'` ⇒ `null`) ⇒ slug sai/inactive ra NULL ở CẢ HAI nhánh. |
| `company_id IS NULL ⟹ user_id IS NULL` (done_when #6) | Nhánh blocked luôn truyền `userId: null`. Chỉ đổi `companyId` từ `null` → `A`; chiều suy diễn không bị chạm. Đang ghim bởi `auth-me-bootstrap.int-spec`. |
| Đường ghi pre-auth không bị làm mù | `recordLoginAttempt` khi `companyId != null` đi nhánh `withTenant` (đã có, dùng bởi 3 call-site khác). **KHÔNG** thêm `.returning()` (bẫy 0532, ghim bởi `login-logs-rls` ca (c2)). |
| 429 không được biến thành 500 | `resolveBlockedLogOwner` fail-soft → `null`; `recordLoginAttempt` đã `try/catch` best-effort sẵn; sàn thời gian trong `finally`. |

### 2.5 Hệ quả đã biết, chấp nhận có ghi nhận

`login_logs` nằm trong `PROTECTED_TABLES` (`retention.service.ts:49`) ⇒ **không bao giờ bị job retention
xoá**. Sau vá, hàng `blocked` chuyển từ "vô chủ, không ai thấy" sang "thuộc tenant, hiện ở AUTH-API-401"
⇒ tenant bị nện brute-force sẽ **tích luỹ vô hạn** hàng hiển thị + đếm/paging của AUTH-API-401 tăng theo.
Đây là **đúng ý muốn** (đó chính là tầm nhìn đang đòi lại), nhưng là thay đổi khối lượng dữ liệu hiển
thị — ghi nhận, không xử lý ở WO này.

---

## 3. Thay đổi mã (chính xác, theo file)

### 3.1 `apps/api/src/auth/auth.service.ts`

1. Hằng số `BLOCKED_LOGIN_FLOOR_MS = 250` cạnh `FORGOT_PW_FLOOR_MS`.
2. `applyUniformResponseFloor(startedAtMs)` → `applyUniformResponseFloor(startedAtMs, floorMs = FORGOT_PW_FLOOR_MS)`
   (mặc định giữ nguyên hành vi forgot — **không** hồi quy chỗ gọi cũ). Sửa cả **docstring** `:1259-1265`
   (đang viết riêng cho forgot: *"mọi nhánh forgotPassword"*, *"KMS chậm"*) — helper nay dùng chung.
   ⚠️ **GIỮ NGUYÊN ràng buộc mà chính docstring đó đang tuyên bố:** *"Chỉ dùng hằng + setTimeout (KHÔNG
   tham chiếu field inject) + KHÔNG log"* — `forgot-password-rate-limit.spec.ts:36-42` và
   `auth.service.spec.ts:479-488` dựng `AuthService` bằng `Object.create(prototype)` + gán **một phần**
   field; thêm bất kỳ `this.<dep>` nào vào thân helper sẽ làm vỡ hai spec đó.
3. `resolveBlockedLogOwner(slug): Promise<string|null>` — gọi `resolveCompanyId`, bọc `try/catch` →
   `null` (fail-soft). **Không cache.**
   ⚠️ **Catch PHẢI `this.logger.warn(...)`, KHÔNG được nuốt câm.** Nuốt câm ở đúng chỗ này = một trục
   trặc DB âm thầm hạ hàng CÓ CHỦ xuống vô chủ — đúng lớp mù mà KI-044 đang vá, và `silent-failure-hunter`
   ở FULL gate chặn. Tiền lệ trong chính file: `:1568-1572` và `:1583-1587` đều log trước khi thoái lui
   (*"mất log bảo mật phải nhìn thấy được"*). Thông điệp log ghi **lý do**, KHÔNG ghi giá trị slug (tránh
   biến log thành nguồn liệt kê tenant).
4. Nhánh 429 (`:199-212`): `companyId: null` → `companyId: await this.resolveBlockedLogOwner(...)`;
   bọc `try/finally` + sàn thời gian; viết lại comment (comment hiện tại nói "chưa resolve tenant" —
   sẽ thành sai).
5. Comment neo tại `:215`: vì sao đường **này** không được cache/không được gộp với nhánh blocked (công
   ty bị đình chỉ phải chặn đăng nhập NGAY).
6. Sửa chú thích `recordLoginAttempt` (`:1562-1567`) — đang mô tả nhánh NULL gồm "bị chặn trước khi biết
   tenant", sau WO này sai.

### 3.2 `apps/api/src/me/me-security-activity.repository.ts` (chỉ chú thích)

Docstring `:21-28` khẳng định *"mọi đường sinh row `company_id IS NULL` (**auth.service.ts:201
rate-limit**, :221)"* — sau WO này sai.

⚠️ Bản thay thế phải ĐÚNG, đừng thay một câu sai bằng một câu sai khác (memory
`wo-plans-built-on-code-comments`). Sau vá: `:201` **vẫn** sinh hàng NULL, nhưng **chỉ khi slug không
resolve được** (slug sai/inactive, hoặc nhánh fail-soft khi resolve lỗi); `:221` thì **luôn** NULL. Bất
biến `company_id IS NULL ⟹ user_id IS NULL` **vẫn đúng** (nhánh blocked vẫn `userId: null`), nên
actor-lock của màn hình không đổi.

⇒ **Cần thêm `apps/api/src/me/**` vào `paths` của WO** trong `harness/backlog.mjs`
(memory `wo-paths-drive-gate-and-scheduler`: khai thiếu path ⇒ lọt gate).

**KHÔNG đụng:** `isLoginRateLimited` · `recordLoginFailure` · thân `recordLoginAttempt` · nhánh
`CompanyInactive` · `forgotPasswordImpl` · bất kỳ migration nào.

---

## 4. Bằng chứng RED → GREEN

### 4.1 RED — `apps/api/test/integration/login-blocked-attribution.int-spec.ts` (mới)

Dựng `AuthService` bằng tay trên Postgres thật (khuôn `auth-me-bootstrap.int-spec`), **giữ tham chiếu tới
đúng instance `LoginRateLimiter`** đã truyền vào service (`auth-me-bootstrap.int-spec.ts:100` tạo inline —
spec mới phải hoisting ra biến, nếu không "đi qua đường thật" là tuyên bố sai), rồi gọi `recordFailure()`
đủ `loadEnv().LOGIN_MAX_ATTEMPTS` lần trên đúng `LoginRateLimiter.key(slug,email,ip)` để khoá bucket —
**không stub** `isLocked`. Mỗi ca dùng **email riêng** (khoá in-memory sống 900s trong cùng process).

| Ca | Assert | Trước vá |
| --- | --- | --- |
| **R1** | slug HỢP LỆ + bucket khoá → `login()` ném 429 **và** hàng `blocked/TooManyAttempts` có `company_id = A` | ❌ **ĐỎ** |
| **R2** | Qua **đường đọc THẬT** `AuthLogsViewerService.listLoginLogs(A, {status:'blocked'})` → thấy hàng đó, khoá theo **`id`** (lấy id bằng SQL trực tiếp theo marker email TRƯỚC, rồi `data.some(r => r.id === id)`); assert `user === null` + ip/ua khớp | ❌ **ĐỎ** |
| **R3** | `listLoginLogs(B, …)` → **0** hàng (deny-path chéo tenant) | ✅ xanh cả hai phía |
| **R4** | slug SAI + bucket khoá → hàng vẫn `company_id = NULL` (done_when #4) | ✅ xanh cả hai phía |
| **R5** | `company_id IS NULL ⟹ user_id IS NULL` trên mọi hàng ca trên (done_when #6) | ✅ xanh cả hai phía |
| **R6** | slug hợp lệ + bucket khoá, resolve DB **ném** → vẫn **429** (không phải 500), hàng ghi NULL, **và** `logger.warn` được gọi | ✅ (chốt fail-soft) |

⚠️ **R2 KHÔNG được lọc bằng `failure_reason`**: `listLoginLogs(A,{status:'blocked'})` trả **cả** hàng
`blocked/Inactive` (có `user_id` — §1.1), nên khoá theo `id` mới là chốt chặt.

⚠️ **R6 phải stub ĐÚNG seam**: `vi.spyOn(auth, "resolveCompanyId").mockRejectedValue(...)` — tức là hàm
**bên trong** `try/catch` (tiền lệ `auth.service.spec.ts:489-492`, `forgot-password-rate-limit.spec.ts:44-47`).
**TUYỆT ĐỐI KHÔNG** stub `resolveBlockedLogOwner`: ném từ đó thoát khỏi `try` ⇒ 500 ⇒ R6 đỏ ⇒ cám dỗ
"sửa" bằng cách nới `finally` thành catch-all. Assert lỗi ném ra là `HttpException` với
`getStatus() === 429`, và `logger.warn` đã được gọi (nếu người thi công inline SQL vào
`resolveBlockedLogOwner` thay vì gọi `resolveCompanyId`, spy thành vô hiệu và R6 **đỏ to** — không âm
thầm thành tautology).

R3/R4/R5 **cố ý** xanh cả hai phía: chốt *không-hồi-quy*, không phải chốt vá. Chỉ R1/R2 được phép
đỏ-trước-xanh-sau; output RED thật dán vào §6 (memory `tests-can-pin-a-hole-open`,
`reviewers-pass-real-bugs`).

`afterAll` phải DELETE hàng `company_id IS NULL` theo **marker email** — `cleanupTenants` dọn theo
`company_id` nên không dính (đúng bẫy đã phải vá tay ở `auth-me-bootstrap.int-spec.ts:67-73` và
`login-logs-rls.int-spec.ts:31-37`).

### 4.2 Số đo timing (done_when #2 — không chỉ lập luận)

Script đo N=200 mẫu mỗi nhánh (slug hợp lệ vs slug sai, cùng bucket đã khoá), báo p50/p95 **trước** và
**sau** khi thêm sàn.

⚠️ **"p50/p95 chồng nhau" MỘT MÌNH là tiêu chí quá yếu** — kẻ tấn công lấy trung bình, nên một cái đuôi
1% mà nhánh slug-hợp-lệ vượt sàn vẫn là tín hiệu dùng được, trong khi p50/p95 che mất. Tiêu chí đủ:

1. p50/p95 hai nhánh chồng nhau, **và**
2. `max(thời gian TRƯỚC sàn)` của **cả hai** nhánh nằm **thấp hơn hẳn** sàn 250ms (nếu chạm sàn thì sàn
   hết tác dụng cho mẫu đó) — báo `max` chứ không chỉ phân vị, **và**
3. so sánh trung bình có khoảng tin cậy, không chỉ nhìn phân vị.

### 4.3 Bộ hồi quy trên DB lane (chain 0000→**0533**)

`login-logs-rls` · `auth-me-bootstrap` · `auth-logs-viewer` · `me-security-activity` · `auth-appendonly` ·
`auth.int-spec` · `two-factor-login` · `auth-blocked-status` · `forgot-password-rate-limit` (chạm
`applyUniformResponseFloor`).

⚠️ Bắt buộc `LANE_DB` + URL tường minh (memory `lane-db-run-needs-explicit-urls`) — thiếu thì các spec
`describe.skipIf(!hasDb)` **SKIP im lặng** = xanh-giả (memory `ci-skips-most-integration-specs`).
⚠️ Sàn 250ms có thể làm chậm spec nào lặp nhiều lượt 429 — kiểm và ghi nhận, **không** hạ sàn để test
nhanh hơn.

---

## 5. Rủi ro đã cân + cách chặn

| # | Rủi ro | Chặn |
| --- | --- | --- |
| 1 | Bản vá đẻ oracle "slug tồn tại" qua chênh round-trip | §2.3 sàn thời gian + số đo §4.2 |
| 2 | `withTenant` ở nhánh 429 ném ⇒ 429 thành 500 | fail-soft + `try/catch` sẵn có + ca **R6** |
| 3 | Nhánh blocked giữ slot transaction PgBouncer | §2.2 — đo p95 + headroom kết nối, ghi §6 |
| 4 | Ai đó "tối ưu" `:215` bằng cùng đường resolve của nhánh blocked | comment neo + §2.4; **không có cache nào tồn tại để rò** (đã bỏ ở v2) |
| 5 | Thêm `.returning()` về sau ⇒ chết log pre-auth im lặng | bẫy 0532, ghim bởi `login-logs-rls` (c2) — WO này không chạm |
| 6 | Đóng KI-044 nói quá phạm vi | §1.1 (user=null) + §1.2 (4 đường 429 khác) phải vào văn bản đóng KI |
| 7 | Sàn thời gian làm hồi quy `forgotPassword` | tham số `floorMs` **có mặc định** = hằng cũ ⇒ chỗ gọi cũ không đổi hành vi; `forgot-password-rate-limit` nằm trong bộ hồi quy §4.3 |

### 5.1 Đường lui (rollback)

Thay đổi **thuần code, không migration, không đổi schema/DTO** ⇒ hoàn nguyên = `git revert` đúng 1
commit, không cần bước DB. Hàng đã ghi với `company_id` thật **giữ nguyên** sau revert (chúng hợp lệ —
đúng chủ); chỉ hàng ghi *sau* revert quay lại NULL. Không có trạng thái nửa vời.

---

## 6. Kết quả chạy thật

DB lane `mediaos_loginlog2`, dựng MỚI chain `0000→0533`, URL tường minh (memory
`lane-db-run-needs-explicit-urls`: chỉ `LANE_DB` là db-fence từ chối chạy — mật khẩu máy này đã xoay).

### 6.1 RED (TRƯỚC khi sửa `auth.service.ts`)

```text
FAIL  R1  expected null to be 'd45e456c-…'          ← company_id NULL dù slug hợp lệ = ĐÚNG KI-044
FAIL  R2  expected undefined to be defined          ← hàng không hiện ở AUTH-API-401 của tenant A
FAIL  R6  expected "spy" to be called at least once ← chưa có đường log fail-soft
 Tests  3 failed | 3 passed (6)
```

R3/R4/R5 xanh ngay ở phía RED — đúng thiết kế: chúng là chốt **không-hồi-quy**, không phải chốt vá
(memory `tests-can-pin-a-hole-open`).

### 6.2 GREEN (SAU khi sửa)

```text
✓ test/integration/login-blocked-attribution.int-spec.ts (6 tests) 1717ms
 Tests  6 passed (6)
```

Dòng `WARN [AuthService] resolveBlockedLogOwner thất bại — … admin của tenant đó KHÔNG thấy lần bị chặn
này: db down (giả lập)` xuất hiện trong output ⇒ R6 đi qua **đúng** đường fail-soft thật, không phải
tautology.

### 6.3 Số đo timing — oracle §2.3 (done_when #2)

Đo tay (N=200/nhánh, xen kẽ để nhiễu nền rơi đều, bỏ 20 mẫu warm-up), bucket đã khoá, hai phía
slug-hợp-lệ vs slug-sai. Lượt 1 vô hiệu hoá sàn để phơi chênh lệch THÔ:

| | slug HỢP LỆ | slug SAI | Δmean |
| --- | --- | --- | --- |
| **TẮT sàn** (chênh lệch thô) | p50 **4.5** · p95 5.2 · max 6.5 · mean **4.6 ± 0.0** ms | p50 **3.2** · p95 3.7 · max 4.6 · mean **3.2 ± 0.0** ms | **+1.4 ms** |
| **BẬT sàn** (thực tế) | p50 295.1 · p95 329.4 · max 345.1 · mean **295.2 ± 3.3** ms | p50 296.5 · p95 339.8 · max 343.6 · mean **299.4 ± 3.2** ms | **−4.2 ms** |

Đọc kết quả:

1. **Oracle là THẬT, không phải lo hão.** Không có sàn, hai phân phối **rời nhau hoàn toàn** (p50 nhánh
   hợp-lệ `4.5ms` > p95 nhánh sai `3.7ms`; khoảng tin cậy ±0.0ms). Tức là bản vá KI-044 nếu ship trần thì
   **tặng kèm** một oracle "slug tenant có tồn tại" phân loại được gần như 100% chỉ với vài mẫu. Đúng
   phát hiện CRITICAL của `plan-reviewer` vòng 1.
2. **Ba tiêu chí §4.2 đều đạt sau khi bật sàn:** (1) p50/p95 hai nhánh chồng nhau; (2) `max` **trước** sàn
   = 6.5ms và 4.6ms, đều **« 250ms** ⇒ sàn chưa bao giờ bị xuyên thủng, nên nó thực sự trùm được chênh
   lệch; (3) so trung bình có CI: Δmean **đổi dấu** (−4.2 ms, ngược chiều tín hiệu thật +1.4 ms) và nằm
   trong nhiễu ⇒ không còn tín hiệu phân loại được.

*(Script đo là công cụ dùng-một-lần, đã xoá sau khi lấy số — dựng lại: `AuthService` bằng tay như
`login-blocked-attribution.int-spec`, khoá bucket, `performance.now()` quanh `login()`, monkey-patch
`applyUniformResponseFloor` thành no-op cho lượt "TẮT sàn".)*

### 6.4 Chi phí nhánh blocked (§2.2 — trục slot kết nối, không phải CPU)

`max` **trước sàn** = **6.5 ms** cho nhánh đắt nhất (`1 SELECT + transaction 4 round-trip`), so với
3.2 ms trước vá. Mức tuyệt đối vẫn nhỏ hơn hai bậc so với một lần login KHÔNG bị chặn (argon2 ~100 ms +
tra user + audit) ⇒ bộ chặn tần suất vẫn giữ đúng tác dụng shed-load của nó. Thời gian chờ của sàn nằm
**sau** commit nên không giữ slot pool (`db/index.ts:18`, `max: 20`).

### 6.5 Bộ hồi quy (cùng DB lane)

| Spec | Kết quả |
| --- | --- |
| `login-blocked-attribution.int-spec` (mới) | **6/6** |
| `login-logs-rls.int-spec` | **8/8** |
| `auth-me-bootstrap.int-spec` | **6/6** |
| `me-security-activity.int-spec` | **10/10** |
| `auth-appendonly.int-spec` | **6/6** |
| `auth-blocked-status.int-spec` | **5/5** |
| `two-factor-login.int-spec` | **9/9** |
| `auth.int-spec` | xanh (gồm ca `brute-force → 429`) |
| `auth-logs-viewer.int.spec` | **16/16** |
| `auth.service.spec` · `forgot-password-rate-limit.spec` · `auth-status-guard.spec` · `login-rate-limiter.spec` | xanh |
| **Tổng** | **13 file · 118 test · 0 đỏ** |

`forgot-password-rate-limit.spec` xanh nguyên vẹn ⇒ việc tổng quát hoá `applyUniformResponseFloor` bằng
tham số **có mặc định** không đổi hành vi chỗ gọi cũ (rủi ro §5 #7 đóng).

`pnpm --filter @mediaos/api typecheck` sạch · `eslint` trên 3 file đổi: 0 lỗi 0 cảnh báo.

## 7. FULL gate — `security-reviewer` **BLOCK → đã vá** · `rls-tenant-isolation-tester` **PASS**

Cả hai reviewer **tự chạy lại RED-proof độc lập** (hoàn nguyên `auth.service.ts` về master, chạy spec,
khôi phục + verify sha256) thay vì tin bảng §6.1 — và cả hai xác nhận R1/R2/R6 ĐỎ đúng như mô tả.

### 7.1 `security-reviewer` — BLOCK, 1 HIGH + 2 MEDIUM + 5 LOW

| # | Mức | Phát hiện | Xử lý |
| --- | --- | --- | --- |
| 1 | **HIGH** | **Chốt chống-oracle KHÔNG có test — xoá `finally` đi vẫn 6/6 xanh.** Không spec nào nhắc `FLOOR`/`floorMs`/đo thời gian; sau khi script đo bị xoá, bằng chứng "oracle đã bịt" chỉ còn là **văn xuôi**. Reviewer tự đo lại và xác nhận không sàn thì hai nhánh rời nhau ở p50-vs-p95 (4.30 vs 3.59 ms) | **VÁ** — §7.3 |
| 2 | MEDIUM | "Sàn chưa từng bị xuyên thủng" đo **tuần tự trên DB rảnh**; điều kiện thủng (`elapsed > 250ms`) **kẻ tấn công tạo ra được** qua xếp hàng pool (`max: 20`, không có throttler HTTP). Caveat cũ đọc như tai nạn môi trường | **VÁ văn bản** — ghi vào KI-044 là *attacker-inducible*, không phải rủi ro môi trường |
| 3 | MEDIUM | Hàng `blocked` nay hiện ở màn admin với **tốc độ sinh do kẻ tấn công điều khiển**; `login_logs` là `PROTECTED_TABLES` (không thu hồi) và query schema **không có filter `failure_reason`** ⇒ chôn được tín hiệu thật dưới nhiễu | **Mở KI-048** (không gộp vào WO này — hướng vá là coalesce theo bucket) |
| 4 | LOW | Docstring hứa "KHÔNG ghi giá trị slug" nhưng nội suy `err.message` (không kiểm soát được) | **VÁ** — nói đúng giới hạn: ta không nội suy slug; `err.message` là chuỗi driver; rủi ro còn lại là log-injection |
| 5 | LOW | Neo số dòng **sinh ra đã cũ** ngay trong chính commit này (KI-047 trỏ `:211/:410/…`, thật là `:259/:462/…`) | **VÁ** — thay bằng neo **theo tên hàm/ký hiệu**, hết trôi |
| 6 | LOW | `expect(warnSpy).toHaveBeenCalled()` trần — thoả mãn bởi warn BẤT KỲ, kể cả warn `!db` | **VÁ** — `expect.stringContaining("resolveBlockedLogOwner")` |
| 7 | LOW | R3 thiếu **đối chứng dương**: B không có hàng nào nên "0 row" cũng đúng nếu đường đọc chết | **VÁ** — §7.3 |
| 8 | LOW | Thiếu ca công ty **đình chỉ** (done_when #4 nói "sai/inactive", R4 chỉ phủ "sai") | **VÁ** — ca R7 mới |

### 7.2 `rls-tenant-isolation-tester` — PASS, 0 CRITICAL / 0 HIGH

Verify trên **DB SỐNG** (không chỉ đọc file): policy `tenant_isolation` byte-for-byte 0532 (`USING` không
có `OR company_id IS NULL`) · `relrowsecurity`/`relforcerowsecurity` = `t`/`t` · grant `mediaos_app =
INSERT,SELECT` · 201/201 migration khớp **sha256** · `git diff master -- apps/api/migrations` **rỗng**.

Điểm mạnh nhất: chứng minh lưới **có răng** bằng **đột biến policy** trên DB lane (rồi khôi phục):

| Đột biến | Hệ quả |
| --- | --- |
| `USING true` | **8 ca đỏ**, gồm R3 ⇒ R3 **không** phải tautology |
| Khôi phục đúng lỗ tiền-0532 (`… OR company_id IS NULL`) | **6 ca đỏ** (`login-logs-rls` (c2)(d)(d2) + 3 probe riêng) — nhưng **spec của WO này xanh hoàn toàn** ⇒ chính là MEDIUM "thiếu pin hàng vô chủ", đã vá bằng R4/R7 |

Ba ca yếu do gate này chỉ ra (R5 vacuous · R4 chỉ nửa vế · R3 thiếu đối chứng) — đã siết ở §7.3.
Probe tạm của reviewer (`zzadvprobe.int-spec.ts`) đã được chính nó xoá; đã verify cây sạch trước commit.

### 7.3 Đã vá trong CÙNG PR + RED-proof cho từng chốt mới

| Chốt mới | RED-proof (bắt buộc — chốt không đỏ được thì đừng ship) |
| --- | --- |
| R1 + R4 assert `elapsed ≥ 225ms` (**literal CỐ Ý**, không import hằng số: import vào thì hạ sàn về 0 vẫn xanh = tautology) | Gỡ `finally` ⇒ **R1 đỏ ở 16ms · R4 đỏ ở 3ms**. *(Hai con số đó CHÍNH LÀ oracle — nhánh đắt 16ms vs nhánh rẻ 3ms.)* Khôi phục ⇒ xanh |
| R5 tự sinh mẫu + assert `null_rows > 0` cùng truy vấn | Bản trước chạy `-t "R5"` cô lập = "1 passed" trên tập **RỖNG**; bản giữa = đỏ đúng (`expected 0 to be greater than 0`); bản cuối tự sinh mẫu ⇒ **xanh ở mọi cách chạy** với denominator thật |
| R3 đối chứng dương (B đọc được hàng của **chính** B) | Đường đọc chết ⇒ đỏ vế dương, không còn "chứng minh không thấy bằng một đường đọc đã chết" |
| R4/R7 thêm vế "không tenant nào đọc được hàng vô chủ" | Đây là vế ĐỎ khi lỗ KI-042 quay lại — chính lỗ hổng mà đột biến policy của gate cho thấy spec cũ mù |
| R7 công ty **đình chỉ** → vẫn NULL + vô hình | Phủ nhánh `status !== 'active'` (khác nhánh "slug không tồn tại") |

**Sau khi vá gate: 7 ca · 13 file · 119 test xanh; `typecheck` + `eslint` sạch.**

## 8. Phạm vi file

| File | Loại |
| --- | --- |
| `apps/api/src/auth/auth.service.ts` | sửa (nhánh 429 + 1 method + hằng số + sàn + 2 comment) |
| `apps/api/src/me/me-security-activity.repository.ts` | sửa (**chỉ** docstring đã thành sai) |
| `apps/api/test/integration/login-blocked-attribution.int-spec.ts` | mới (int, RED-first) |
| `docs/RELEASE/RELEASE-02_Known_Issues_MVP.md` | đóng KI-044 + mở KI-047 (§1.2) |
| `harness/backlog.mjs` | thêm `apps/api/src/me/**` **và `harness/backlog.mjs`** vào `paths` của WO — file này hiện KHÔNG nằm trong `paths` của chính nó (`:5743-5748`) nên sửa nó sẽ kêu `guard-scope`; cảnh báo đó là **dự kiến**, không phải trôi phạm vi |
| `docs/plans/S6-SEC-LOGINLOG-2.md` | plan này |

**Migration: KHÔNG có.** Xuất hiện file trong `apps/api/migrations/**` ⇒ đã đi chệch plan.
**Cache: KHÔNG có.** Xuất hiện `company-slug-cache.ts` ⇒ đã quay lại v1 đã bị bác (§2.2).

---

## 9. Nhật ký sửa plan

**v1 → v2** sau `plan-reviewer` = **BLOCK**. Đã xác minh lại từng phát hiện trên mã trước khi nhận:

| # | Phát hiện | Xử lý |
| --- | --- | --- |
| 1 (CRITICAL) | Bản vá đẻ oracle timing qua chênh hình dạng đường ghi (4 vs 1 round-trip), nhánh 429 không có argon2 che | **Nhận** — §2.3 sàn thời gian + §4.2 số đo |
| 2 (HIGH) | Cache dương-cũ + tái dùng slug sau soft-delete ⇒ ghi chéo tenant | **Nhận** — bỏ cache |
| 3 (HIGH) | Cache mua 1 index-probe, bán 3 bất biến | **Nhận** — bỏ cache (§2.2 giữ lý do) |
| 4 (MED-HIGH) | R2 assert SQL trần, không chứng minh AUTH-API-401 | **Nhận** — R2 qua `AuthLogsViewerService`; thêm §1.1 nói rõ `user=null` |
| 5 (MED) | Rủi ro cache-rò-sang-auth chỉ canh bằng comment | **Moot** — không còn cache |
| 6 (MED) | Docstring `me-security-activity.repository.ts` thành sai, `me/**` ngoài `paths` | **Nhận** — §3.2 + sửa `paths` |
| W1 | 4 đường 429 khác không ghi `login_logs` | **Nhận** — §1.2 + mở KI-047 |
| W2 | Chuẩn hoá khoá cache (citext vs slug thô) | **Moot** — không còn cache |
| W3 | Đo sai trục: slot PgBouncer chứ không phải CPU | **Nhận** — §2.2 + §6 |
| W4 | §4.3 ghi head `0534`, thật là `0533` | **Nhận** — sửa |
| W5 | R4 để lại rác NULL không dọn | **Nhận** — §4.1 `afterAll` theo marker |
| W6 | Spec phải hoisting đúng instance `LoginRateLimiter` | **Nhận** — §4.1 |
| Q1 | Thiếu đường lui | **Nhận** — §5.1 |
| Q2 | `login_logs` PROTECTED ⇒ tích luỹ vô hạn | **Nhận** — §2.5 ghi nhận |
| Q3 | `rls-tenant-isolation-tester` verify cái gì khi không có migration | **Nhận** — §7 |

**v2 → v2.1** sau `plan-reviewer` vòng 2 = **PASS** (0 mục chặn). Gộp 8 cảnh báo "phải vá khi thi công",
mỗi mục đã tự xác minh lại trên mã trước khi nhận:

| # | Cảnh báo | Xử lý |
| --- | --- | --- |
| 1 | `try/catch → null` không log = đúng lớp nuốt câm mà `silent-failure-hunter` chặn | §3.1(3) — bắt buộc `logger.warn`, R6 assert luôn |
| 2 | R6 phải stub `resolveCompanyId`, KHÔNG phải `resolveBlockedLogOwner` | §4.1 — nêu seam + lý do + assert 429 |
| 3 | §1.1 nói quá: `blocked/Inactive` (`:331-338`) **CÓ** `user_id`, ghim bởi `auth-blocked-status.int-spec:154-160` | §1.1 — thu hẹp về `TooManyAttempts`; R2 khoá theo `id` |
| 4 | §3.2 định thay câu sai bằng câu sai khác (`:201` vẫn sinh NULL khi slug không resolve) | §3.2 — viết lại bản thay thế |
| 5 | Docstring `applyUniformResponseFloor` `:1259-1265` viết riêng cho forgot; và cấm tham chiếu field inject (2 spec dựng bằng `Object.create`) | §3.1(2) |
| 6 | Tiêu chí §4.2 quá yếu — phân vị che đuôi | §4.2 — thêm `max(trước sàn)` + so trung bình |
| 7 | Không có throttler HTTP; pool `max: 20` mới là chỗ đói | §2.2 — thêm vế "request đang bay" + đo |
| 8 | `harness/backlog.mjs` không nằm trong `paths` của chính nó ⇒ `guard-scope` sẽ kêu | §8 |
| Q | §2.2 tuyên bố tuân thủ nguyên văn `done_when #1` — thật ra là biến thể ngược | §2.2 — nói rõ là biến thể |
| Q | §1.2 "grep trả 5 chỗ" — còn chỗ thứ 6 ngoài `auth/**` | §1.2 |

> **Dừng ở 2 vòng review.** Vòng 2 PASS, mọi mục còn lại là việc thi công. Memory
> `plan-review-rounds-inject-new-holes`: quá 3 vòng thì vòng review bắt đầu đẻ lỗ mới — chuyển sang
> code + test.
