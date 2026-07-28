# S6-SEC-LOGINLOG-1 — KI-042: siết vế ĐỌC của `login_logs` (hàng NULL-tenant đọc được chéo tenant)

> **Zone:** đỏ (crown — RLS/policy) · **Module:** AUTH · **Migration:** `0532` (nối tiếp head `0531`)
> **KI:** RELEASE-02 KI-042 (S3, nhóm "KHÔNG được defer" — lộ dữ liệu ngoài phạm vi quyền = vi phạm BẤT BIẾN #1)
> **Chặn:** `S6-SEC-MV-1` (chỉ để ép migration tuần tự 0532 → 0533) → `S6-REL-1`

---

## 1. Lỗ hổng

`apps/api/migrations/0443_s2_authdb2_sessions_logs_security_events.sql:115-126` tạo policy
`tenant_isolation` trên `login_logs` với `OR company_id IS NULL` nằm trong vế **USING**:

```sql
USING (
  company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
  OR company_id IS NULL          -- ← lỗ
)
```

Hàng `company_id IS NULL` là **lần thử đăng nhập pre-auth** và mang `email` · `normalized_email` ·
`ip_address` · `user_agent` của người dùng **không thuộc tenant đang đọc**. Vế `WITH CHECK` đã đúng
từ đầu (đính chính so với vòng 1 của KI-042: **vế GHI không hỏng**, chỉ vế ĐỌC).

### 1.1 Đã tái lập (DB lane dựng mới 0000→0531, role `mediaos_app`)

| Ca | Kết quả TRƯỚC vá |
| --- | --- |
| Trong ngữ cảnh tenant A → `SELECT * FROM login_logs` | trả về hàng NULL-tenant `victim@other-tenant.test` / `203.0.113.9` |
| **NGOÀI mọi ngữ cảnh tenant** (không set GUC) → `SELECT` | **vẫn** trả về hàng NULL-tenant đó |

Vế thứ hai **nặng hơn mô tả gốc của KI-042**: không cần đứng trong tenant nào cũng đọc được, vì
`OR company_id IS NULL` đúng vô điều kiện.

### 1.2 Đo trên PROD (read-only, 2026-07-28)

| Chỉ số | Giá trị |
| --- | --- |
| Tổng `login_logs` | 314 |
| Attributed (`company_id` NOT NULL) | 46 |
| **NULL-tenant** | **268** — 165 `blocked/TooManyAttempts` + 103 `failed/CompanyInactive` |
| Bề mặt rò của khối NULL | 5 email riêng biệt + 5 IP riêng biệt |
| Số company đang sống | **1** |
| Hàng `company_id IS NULL` **AND** `user_id IS NOT NULL` | **0** |

⇒ N=1 nên **ảnh hưởng sống hiện tại = 0** (chưa có tenant thứ hai để đọc trộm). Chính vì vậy đây là
thời điểm rẻ nhất để sửa: sửa luật **trước** khi mở tenant thứ hai.

### 1.3 Vì sao lỗi này lọt

Chú thích ở 0443 ghi rõ nó chép khuôn từ `public_holidays` (mig 0434). Với `public_holidays` khuôn
`USING (… OR company_id IS NULL)` **đúng** — hàng NULL là ngày lễ toàn quốc, dữ liệu tham chiếu dùng
CHUNG có chủ đích. Với `login_logs` thì **sai** — hàng NULL là dấu vết bảo mật của người lạ. Đây là
**lỗi chép khuôn**, không phải quyết định thiết kế.

Lỗ hổng còn được **ba lớp test che đi** (memory `tests-can-pin-a-hole-open`) — xem §4.

---

## 2. Quyết định mô hình đọc (done_when #1 — CHỐT TRƯỚC KHI SỬA)

> **Hàng `company_id IS NULL` = telemetry pre-auth VÔ CHỦ. Không thuộc về tenant nào.**

- **Không tenant nào** đọc được chúng qua đường ứng dụng (REST/WS/repo) — kể cả company-admin.
- Chỉ còn đọc được bằng role `mediaos` (superuser + `BYPASSRLS`, chủ bảng) qua **truy cập DB trực
  tiếp** ⇒ thuộc **người vận hành nền tảng**, phục vụ forensics brute-force.
- Đã kiểm `pg_roles`: chỉ `mediaos` có `rolsuper`/`rolbypassrls`. `mediaos_app` · `mediaos_worker` ·
  `mediaos_owner` · `mediaos_readonly` đều KHÔNG. `login_logs` bật **FORCE RLS** nên kể cả chủ bảng
  cũng bị policy chi phối.
- **KHÔNG dựng role/route operator mới ở WO này** (YAGNI — hiện KHÔNG có người đọc nào). Khi nào cần
  thì thêm **policy permissive riêng cho đúng role đó**, tuyệt đối KHÔNG nới lại `tenant_isolation`.
- **Không xoá dữ liệu**: 268 hàng NULL-tenant giữ nguyên cho forensics, chỉ đường đọc bị siết.

---

## 3. Cách vá — `0532_s6secloginlog1_login_logs_tenant_read.sql`

Chỉ sửa **vế USING**; `WITH CHECK` giữ **nguyên văn** 0443; grant append-only giữ nguyên.

```sql
CREATE POLICY tenant_isolation ON login_logs
  USING ( company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid )
  WITH CHECK ( … giữ nguyên 0443 … );
```

**Vì sao siết USING không làm mù đường ghi:** Postgres **không áp USING cho INSERT**. Đã chứng minh
trên DB thật: sau khi siết, `INSERT … VALUES (NULL, …)` ngoài ngữ cảnh vẫn `INSERT 0 1`.

### 3.1 ⚠️ BẪY ĐÃ ĐO — `INSERT … RETURNING`

Postgres áp **policy SELECT lên mệnh đề RETURNING**. Sau 0532:

| Câu lệnh (role app, không GUC, `company_id = NULL`) | Kết quả |
| --- | --- |
| `INSERT INTO login_logs (…) VALUES (NULL, …)` | ✅ `INSERT 0 1` |
| `INSERT INTO login_logs (…) VALUES (NULL, …) RETURNING id` | ❌ `new row violates row-level security policy` |

Đường ghi thật — `auth.service.ts` → `db.insert(loginLogs).values({…})` — **không** dùng `.returning()`
nên **không ảnh hưởng**. Nhưng thêm `.returning()` vào đó sau này sẽ **giết log pre-auth trong im
lặng**: lỗi rơi vào nhánh `catch` best-effort và chỉ còn một dòng `logger.error`.

Đã chặn bằng **ba** lớp: chú thích cảnh báo tại điểm ghi · test `login-logs-rls (c2)` ghim hành vi
từ chối · test end-to-end mới ở `auth-me-bootstrap` chạy qua `auth.login()` thật.

---

## 4. BA lớp test ĐANG ĐÓNG ĐINH LỖ HỔNG (phải đảo, không phải "bị mình làm đỏ")

> memory `tests-can-pin-a-hole-open` — vá xong mà test đỏ thì **đọc assert trước khi nghi mình hỏng**.

| Nơi | Bản cũ khẳng định | Vì sao SAI |
| --- | --- | --- |
| `test/integration/login-logs-rls.int-spec.ts` (d) | `expect(seen).toContain("preauth@lgl.test")` — tenant A **phải** thấy hàng NULL | Đó chính là KI-042 được viết thành yêu cầu |
| `test/integration/rls-registry.ts` — `login_logs` | `skipNoContext: true`, lý do "giống `roles`/`seed_items` có hàng global" | Hàng NULL của `roles`/`seed_items` là dữ liệu tham chiếu dùng CHUNG; của `login_logs` là dấu vết bảo mật người lạ. Miễn trừ này **che đúng KI-042 khỏi lưới an toàn cả dự án suốt từ S2**. ⚠️ Bỏ miễn trừ THÔI là chưa đủ — xem §4.1 |
| `test/integration/me-security-activity.int-spec.ts` (nullable-tenant) | "row NULL-company của CHÍNH A **phải hiện**" = true | Hình dạng row `company NULL + user NOT NULL` **không thể sinh ra từ code** (§5). Assert này ghim khe hở ĐỌC mở ra chỉ để phục vụ một row giả lập — và chính nó đẻ ra chú thích sai ở `me-security-activity.repository.ts` |

### 4.1 Bỏ `skipNoContext` thôi thì XANH VÔ NGHĨA — phát hiện của FULL gate

`security-reviewer` bắt được điều mà bản vá đầu của tôi bỏ sót: harness đọc **cả bảng** khi không có
GUC, nhưng `seedRow` của `login_logs` **chỉ gieo hàng attributed**. Dưới policy CŨ, đọc không-GUC trả về
**đúng các hàng `company_id IS NULL`** — hàng attributed vốn đã vô hình. Nên nếu không có hàng NULL nào
trong DB, case "ngoài ngữ cảnh → 0 row" cho **0 ở CẢ HAI phía** ⇒ không bao giờ ĐỎ.

**Đã đo để xác nhận** (policy cũ + chỉ hàng attributed): `count = 0`. Tức là bỏ miễn trừ mà không gieo
hàng NULL thì ta *tuyên bố* đã phủ nhưng thực chất **không thu được bảo đảm nào** — đúng lớp lỗi mà WO
này đang đi sửa.

**Đã vá:** `seedRow` gieo THÊM một hàng `company_id IS NULL` (marker `RLS_NULL_MARKER_EMAIL`), và
`cleanupTenants()` dọn theo marker (hàng NULL không dính `DELETE ... WHERE company_id = ANY(...)`).
**Chứng minh sau khi vá:** hoàn nguyên policy về bản 0443 ⇒ `tenant-isolation` **1 failed / 453 passed**,
ca đỏ đúng là `login_logs > ngoài ngữ cảnh tenant → 0 row`. Nay nó ĐỎ tất định, không phụ thuộc
thứ tự chạy hay rác của spec khác.

---

## 5. Verify đường đọc hiện có (done_when #4)

Ba đường đọc `login_logs`, đã soi từng đường:

| Đường đọc | Ảnh hưởng của 0532 | Bằng chứng |
| --- | --- | --- |
| `AuthLogsViewerService` (AUTH-API-401, admin) | ⚠️ **CÓ mất dòng** — xem §5.2. Không phải rò, nhưng cũng KHÔNG phải "không mất gì" | `auth-logs-viewer.int.spec` 16/16 xanh |
| `MeSecurityActivityRepository` (GET /me/security/activity) | **Không mất dòng nào** | xem dưới |
| Job retention | **Không chạm** — `login_logs` nằm trong `PROTECTED_TABLES` (`retention.service.ts:49`), retention KHÔNG BAO GIỜ xoá bảng này ⇒ không có gì để "bỏ sót im lặng" | đọc mã |

### 5.1 `/me/security/activity` — chú thích cũ SAI, không phải phụ thuộc thật

`me-security-activity.repository.ts:19-21` (bản cũ) ghi rằng RLS nullable-tenant "CỐ Ý cho row company
NULL đi qua — fail đăng nhập pre-auth của CHÍNH user vẫn phải hiện". **Không đúng với dữ liệu thật:**

- Toàn bộ 5 call-site của `recordLoginAttempt` đã liệt kê; **đúng hai** đường truyền `companyId: null`
  — `auth.service.ts:201` (rate-limit) và `:221` (company không resolve được) — và **cả hai đều truyền
  kèm `userId: null`**. Ba đường còn lại (`:331` fail/blocked · `:374` success · `:506` 2FA bước-2) đều
  có `companyId` thật.
- ⇒ **BẤT BIẾN: `company_id IS NULL` ⟹ `user_id IS NULL`.** Đo PROD: 268/268 đúng, **0 vi phạm**.
- Nhánh login của repo lọc `user_id = userId` ⇒ hàng NULL **chưa bao giờ** lọt vào màn hình này.

⇒ 0532 **không** làm mất dòng nào của `/me/security/activity`. Chú thích đã được sửa lại cho đúng
(memory `wo-plans-built-on-code-comments`: comment "CỐ Ý" có thể là di sản đã chết — grep caller THẬT).

Bất biến này nay được **ghim bằng test** (`auth-me-bootstrap`, assert `user_id` NULL): nếu về sau có
đường ghi gắn `user_id` vào row NULL-company, test đỏ buộc xét lại mô hình — thay vì để trôi thành mất
dữ liệu im lặng trên màn hình người dùng.

### 5.2 ⚠️ Cái GIÁ đã trả: admin mất quan sát brute-force nhắm vào chính công ty mình

Cả `security-reviewer` lẫn `rls-tenant-isolation-tester` **độc lập** chỉ ra cùng một điểm, và nó đúng:

`isLoginRateLimited()` chạy **TRƯỚC** `resolveCompanyId()` (`auth.service.ts:199` vs `:215`). Vì vậy hàng
`blocked / TooManyAttempts` được ghi `company_id = NULL` **kể cả khi `companySlug` HOÀN TOÀN HỢP LỆ** —
không phải vì nó vô chủ, mà chỉ vì lúc ghi ta CHƯA kịp tra tenant.

Trên PROD, **165/268 hàng NULL (≈62%) là loại này** — tức là **có chủ thật**. Sau 0532, company-admin
qua AUTH-API-401 **không còn thấy** các lần bị chặn nhắm vào chính công ty mình.

| | |
| --- | --- |
| **Đây có phải rò rỉ không?** | Không. Không ai đọc được dữ liệu ngoài phạm vi; đây là mất **tầm nhìn của bên phòng thủ**. |
| **Có phải hồi quy do 0532 không?** | Không hẳn — dữ liệu vốn đã bị gắn sai chủ từ S2. 0532 chỉ làm hậu quả *lộ ra*. |
| **Vá đúng là gì?** | Gắn ĐÚNG CHỦ cho hàng `TooManyAttempts` khi slug resolve được — **KHÔNG** nới lại `USING`. |

**CỐ Ý KHÔNG sửa trong WO này.** Cách sửa hiển nhiên (gọi `resolveCompanyId()` trước nhánh rate-limit)
là **đổi thứ tự đường login** — vùng crown, và có đánh đổi mà cả hai reviewer đều KHÔNG cân: đưa một
truy vấn DB lên TRƯỚC bộ chặn tần suất nghĩa là kẻ tấn công ép được một lượt tra DB cho MỖI request kể
cả khi đang bị chặn (bề mặt DoS), đồng thời chạm vào cân bằng timing chống dò tenant mà `:219`
(`password.hash` để burn thời gian) đang cố giữ. Việc đó cần phân tích riêng, không ghép vào một WO
về policy RLS.

⇒ Đã mở **KI-044** + WO `S6-SEC-LOGINLOG-2` để không trôi mất.

---

## 6. Bằng chứng RED → GREEN (done_when #3)

RED chứng minh bằng cách **hoàn nguyên policy về đúng bản 0443 trên DB lane** rồi chạy lại nguyên bộ:

| Ca | Pre-0532 | Post-0532 |
| --- | --- | --- |
| (a) `withTenant(A)` INSERT company=B → từ chối | ✅ | ✅ |
| (b) `withTenant(A)` INSERT company=NULL → từ chối | ✅ | ✅ |
| (c) bare pool INSERT NULL → OK (**ghi pre-auth không bị làm mù**) | ✅ | ✅ |
| **(c2) INSERT NULL + RETURNING → bị từ chối** | ❌ **RED** | ✅ |
| **(d) `withTenant(A)` → 0 row NULL-tenant** | ❌ **RED** | ✅ |
| **(d2) ngoài ngữ cảnh → 0 row** | ❌ **RED** | ✅ |
| (d3) row NULL vẫn nằm trong DB cho forensics | ✅ | ✅ |
| (e) append-only: app không UPDATE/DELETE được | ✅ | ✅ |

3 ca deny mới ĐỎ đúng như yêu cầu; 5 ca cũ xanh ở **cả hai** phía ⇒ **không nới lỏng gì ở vế ghi**.

### 6.1 Bộ hồi quy đã chạy (DB lane `mediaos_loginlog`, chain 0000→0532)

| Spec | Kết quả |
| --- | --- |
| `login-logs-rls.int-spec` | **8/8** |
| `me-security-activity.int-spec` | **10/10** |
| `auth-appendonly.int-spec` | **6/6** |
| `auth-logs-viewer.int.spec` | **16/16** |
| `auth-me-bootstrap.int-spec` (+1 ca mới) | **6/6** |
| `auth-blocked-status.int-spec` | **5/5** |
| `auth-users-admin.int-spec` | **21/21** |
| `me-qa1-idor-sweep.int-spec` | **38/38** |
| `tenant-isolation.int-spec` (lưới cả dự án) | **454 passed / 11 skipped** — trong đó `login_logs > ngoài ngữ cảnh tenant → 0 row` nay **CHẠY THẬT** (✓, không còn ↓) lần đầu kể từ S2, và ĐỎ tất định khi policy bị nới lại (§4.1) |
| **Tổng chạy lại sau khi sửa theo FULL gate** | **8 file · 526 passed / 11 skipped** |
| Unit suite (không DB) | **3298 passed / 0 failed** |
| `harness/check.sh --all` (tier tiền-PR vùng đỏ, có `LANE_DB`) | **XANH ✅** — lint · typecheck · test (chunked, LANE_DB) · build · prod-tenant-check |

---

## 7. FULL gate (done_when #5)

| Reviewer | Verdict | Ghi chú |
| --- | --- | --- |
| `security-reviewer` | **PASS** | 0 CRITICAL · 0 HIGH. Tự đối chiếu `WITH CHECK` 0443 ↔ 0532 bằng script bóc comment: **byte-identical**. |
| `rls-tenant-isolation-tester` | **PASS** | Tự dựng lại RED→GREEN độc lập trên 2 DB lane; quét đường vòng (view · matview · SECURITY DEFINER · rule/trigger · kế thừa · `mediaos_readonly` · nhảy role · `pg_stats` · CREATE schema) ⇒ **không tìm được đường đọc nào còn lại**. |

> **Thay thế agent (tiền lệ `S6-SEC-1` §7c):** done_when yêu cầu `database-reviewer`, agent này **không tồn tại**
> trong môi trường phiên. Đã thay bằng `security-reviewer` (bao phủ migration/RLS/secret/auth theo CLAUDE §6)
> kèm `rls-tenant-isolation-tester` (đúng agent mà done_when nêu tên, và là agent chạy SQL thật).

**Đã sửa theo gate trước khi merge:** ba MEDIUM — (1) chú thích RLS đã chết ở `db/schema/auth-logs.ts`
(đúng lớp lỗi WO này lấy làm luận điểm); (2) `skipNoContext` xanh vô nghĩa (§4.1); (3) plan chép ba
literal mật khẩu tiền-rotate vào file MỚI của repo PUBLIC (§7 nay chỉ trỏ `file:line`). Cùng hai LOW:
dọn rác hàng NULL trong `auth-me-bootstrap`, và `0532` tái khẳng định `ENABLE/FORCE ROW LEVEL SECURITY`
cho tự đứng vững.

**Chuyển thành KI-044 thay vì sửa ở đây:** mất quan sát brute-force của admin (§5.2).

---

## 8. Nợ phát hiện khi làm (KHÔNG thuộc phạm vi WO này)

Hai chỗ vẫn giữ **mật khẩu literal trước khi rotate**, nên chế độ chạy test bằng `LANE_DB` đơn thuần
không còn xác thực được sau `S6-SEC-ROTATE-1`:

| Nơi | Vấn đề |
| --- | --- |
| `scripts/lane-db-setup.sh:25` | Biến `DEV_PW` mặc định về literal cũ và được dùng cho role **`mediaos`** (superuser). Sau rotate, mật khẩu của `mediaos` nằm ở `SUPERUSER_DB_PASSWORD`, **không phải** `OWNER_DB_PASSWORD` ⇒ `28P01` |
| `apps/api/test/db-target.ts:96-99` | Fallback dựng URL từ `LANE_DB` hardcode **ba literal mật khẩu tiền-rotate** cho `mediaos` / `mediaos_app` / `mediaos_worker` ⇒ `28P01` |

> ⚠️ **Cố ý KHÔNG chép giá trị literal vào file này.** Ba chuỗi đó chính là mật khẩu Postgres bị nêu
> trong KI-043; chép lại vào một file MỚI của repo PUBLIC chỉ làm phình bề mặt phải purge, không thêm
> thông tin gì — xem trực tiếp tại `file:line` ở trên. (Cũng là luật fixture giống-secret của CLAUDE.md §5
> và cổng `scripts/check-no-secret-literals.mjs`.)

**CI không bị ảnh hưởng** (CI truyền URL tường minh + Postgres ephemeral, và URL tường minh có
precedence cao hơn). Chỉ chế độ lane-local gãy. **Cố ý KHÔNG sửa ở WO này**: `db-target.ts` là artifact
crown của `S6-SEC-DBFENCE-1` (hàng rào chặn test ghi vào DB PROD) — sửa kèm trong một WO về RLS sẽ trộn
hai vùng đỏ và làm gate khó đọc. Đề nghị mở WO riêng.

---

## 9. Quét anh em cùng khuôn (lỗi này có phải lỗi hệ thống không?)

Vì gốc rễ là **chép khuôn**, đã quét toàn bộ policy trên DB lane dựng mới xem còn bảng nào có
`company_id IS NULL` trong vế USING:

```sql
SELECT c.relname, p.polname FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
 WHERE pg_get_expr(p.polqual, p.polrelid) ILIKE '%company_id IS NULL%';
```

Sau 0532 còn **11 bảng** (`login_logs` đã rời danh sách): `public_holidays` · `roles` ·
`role_permissions` · `notification_events` · `notification_templates` · `dashboard_widgets` ·
`data_retention_policies` · `seed_batches` · `seed_items` · `sequence_counters` · `system_job_runs`.

**Không bảng nào trong số đó cùng loại lỗi.** Hàng `company_id IS NULL` của chúng là **dữ liệu tham
chiếu/catalog toàn cục dùng chung có chủ đích** (ngày lễ toàn quốc, role hệ thống, catalog thông báo,
provenance seed…), không mang dữ liệu cá nhân của người thuộc tenant khác — khác hẳn `login_logs` vốn
mang email + IP + user-agent của người lạ. ⇒ **Đây là lỗi lẻ, không phải lỗ hổng hệ thống.**

> Ghi chú cho sau này (KHÔNG thuộc WO này, chưa mở KI): `system_job_runs` và `sequence_counters` là hai
> cái đáng soi lại nếu về sau chúng bắt đầu mang dữ liệu vận hành theo tenant — hiện tại chưa.

---

## 10. Phạm vi file (mở rộng so với `paths` khai trong backlog)

> memory `wo-paths-drive-gate-and-scheduler` — khai thiếu `paths` ⇒ lọt gate. Ghi lại tường minh:

- `apps/api/src/me/**` — **ngoài `paths` gốc**. Bắt buộc phải chạm vì done_when #4 yêu cầu verify đường
  đọc hiện có, và một trong ba đường đó (`me-security-activity`) nằm ở `src/me` với chú thích sai cần
  đính chính. Chỉ sửa **chú thích**, không đổi hành vi.
- `apps/api/migrations/**` · `apps/api/src/auth/**` · `apps/api/test/**` · `docs/**` — trong `paths`.
- `apps/api/src/foundation/retention/**` — có trong `paths` nhưng **không cần sửa** (đã protected).
