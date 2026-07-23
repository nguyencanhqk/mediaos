# S5-LMS-BE-3 — Proxy tiến độ đào tạo vào MediaOS: `GET /me/training`

> WO: `harness/backlog.mjs` → `S5-LMS-BE-3` (zone đỏ, gate FULL). Nguồn hợp đồng: `docs/plans/S5-LMS-APP-3.md`
> §5 (JSON v1 THẬT của LMS) · §9.4 (nợ bàn giao) · §10 (security review — M3 IDOR, HIGH-2 token riêng).

## 1. Mục tiêu

`GET /api/v1/me/training` — proxy **thuần** tiến độ học của **CHÍNH user đang đăng nhập**:

- email resolve **100% từ JWT** (`req.user.email`), CẤM nhận `email`/`employeeId` từ query·body·header;
- gọi LMS `GET {LMS_BASE_URL}/api/mediaos/progress?email=` bằng `Bearer LMS_PROGRESS_TOKEN`
  (token **ĐỌC riêng**, KHÔNG phải `LMS_SYNC_TOKEN` quyền-ghi);
- cache ngắn ~60s theo `companyId:userId` (Valkey) để không đụng trần rate-limit LMS (120 req/phút/IP);
- trả DTO **đã qua Zod** (`packages/contracts`), pin `version === 1`; **KHÔNG** trả raw JSON của LMS;
- **KHÔNG ghi DB MediaOS** (đúng B06 — proxy, không lưu, không migration).

## 2. Bất biến chạm & cách xử lý

| Bất biến | Xử lý |
| --- | --- |
| #1 `company_id` mọi query | Không có bảng DB nào được đọc/ghi ⇒ không có query nghiệp vụ. `companyId` vẫn chảy qua guard chain toàn cục và là **một phần cache-key** (`me:training:{companyId}:{userId}`) ⇒ 2 actor không lẫn dữ liệu. Thêm **company-gate** `LMS_COMPANY_ID` (xem §6) để tenant ngoài funtime KHÔNG rò email sang LMS. |
| #2 không hard-delete / append-only | Không có bảng mới, không audit row mới. **CỐ Ý KHÔNG ghi `audit_logs`**: đây là đọc-own-scope, FE poll ~60s ⇒ audit sẽ thành rác (đúng bài học S5-LMS-BE-4 "chỉ ghi khi CÓ THAY ĐỔI THẬT"); 5 section `GET /me/*` hiện có cũng không audit. Đã ghi comment tại service để reviewer không đọc nhầm thành gap. |
| #3 không secret plaintext | `LMS_PROGRESS_TOKEN` đọc từ env (mirror `LMS_SSO_SECRET`/`LMS_SYNC_TOKEN`), KHÔNG hardcode, KHÔNG log ở **mọi** nhánh lỗi (timeout / non-2xx / parse-fail), KHÔNG vào DTO/cache/response. Cache Valkey CHỈ chứa DTO đã qua Zod. |
| IDOR (M3) | Handler `getMyTraining` **CẤM** khai `@Query/@Body/@Param` — mirror `me.controller.ts`. `me-training.permissions.spec.ts` + int-spec khoá hành vi này. |

## 3. Hợp đồng DTO (`packages/contracts/src/me-training.ts`)

Mirror §5 của APP-3 (đối chiếu **kiểu TS thật** trong `apps/lms/lib/lms/mediaos-progress.ts`):

```text
meTrainingProgressSchema = {
  version: literal(1),        // pin — LMS bump v2 ⇒ MediaOS 502 contract-mismatch, KHÔNG render mù
  generatedAt, user{email,name|null,active}, summary{...},
  courses[<=200]{slug,title,percent,completed,total,learningTimeSec,lastActivityAt|null},
  coursesTruncated, exams{...,truncated}, quizzes{...}
}
meTrainingResponseSchema = { status: 'ok'|'no_account', progress: meTrainingProgressSchema|null }
```

- Zod **strip** (KHÔNG `.passthrough()`, KHÔNG `.strict()`): field lạ / PII ngoài whitelist bị bỏ ⇒ LMS
  thêm field nhạy cảm về sau cũng không tự động lọt ra FE; field lạ KHÔNG làm hỏng request (fail-safe hai chiều).
- **`no_account`** (lệch nhỏ so với micro-plan — nêu rõ): LMS trả **404 sạch** khi email *chưa từng có*
  tài khoản LMS (APP-3 §4.6). Map 404 thành 502 sẽ là **nói dối** ("LMS chết"), còn ném 404 ra FE thì
  card /me vỡ. ⇒ envelope 200 `{status:'no_account', progress:null}` (fail-soft, mirror SPEC-09 §18.2).
  Tài khoản **đã khoá** vẫn là `ok` + `progress.user.active=false` (APP-3 §4.6 L1) — FE phân biệt được.

Mã lỗi APPEND vào `ME_ERROR_CODES` (append-only, không đổi/xoá mã cũ):
`TRAINING_LMS_DISABLED` (503) · `TRAINING_LMS_UNAVAILABLE` (502) · `TRAINING_CONTRACT_MISMATCH` (502).

## 4. Luồng

```text
Controller me/training  (PermissionGuard + @RequirePermission access:lms, CHỈ @Req)
   └─ MeTrainingService.getMyTraining(actor)
        ├─ client.isEnabled() = false            → 503 ME-ERR-TRAINING-LMS-DISABLED
        ├─ company-gate (LMS_COMPANY_ID lệch)    → 503 ME-ERR-TRAINING-LMS-DISABLED
        ├─ cache GET me:training:{co}:{user}     → HIT + re-validate Zod → trả luôn (không gọi LMS)
        ├─ client.fetchProgress(email)           → throw (timeout/HTTP lỗi/body lạ) → 502 …-LMS-UNAVAILABLE
        │      └─ 404 → { found:false }          → envelope no_account (vẫn cache)
        └─ Zod parse body                        → fail → 502 …-CONTRACT-MISMATCH (KHÔNG forward object lệch)
```

`LmsProgressClient` (integrations/lms): `AbortSignal.timeout(5s)` (không treo request), guard
`content-type` + `content-length` **trước** khi `res.json()`, KHÔNG log body/token/email — mirror kỷ luật
`lms-http-client.service.ts`. Email `trim().toLowerCase()` trước khi gửi (LMS match lowercase-exact,
mirror `lms-sso.service.ts`) và `encodeURIComponent`.

## 5. Test (RED trước)

| File | Nội dung |
| --- | --- |
| `packages/contracts/src/me-training.spec.ts` | pin `version:1`; v2/thiếu → reject; field lạ/PII bị strip; cap `courses` |
| `apps/api/src/me/me-training.permissions.spec.ts` | metadata `access:lms` non-sensitive + guard cấp class; DENY → 403; ALLOW → true; **handler KHÔNG có param-metadata nào** (hàng rào IDOR) |
| `apps/api/src/integrations/lms/lms-progress-client.service.spec.ts` | env thiếu → `isEnabled()=false`; gọi khi tắt → throw; timeout/non-2xx/content-type lạ/body quá lớn → throw; 404 → `found:false`; KHÔNG log token/email |
| `apps/api/src/me/me-training.service.spec.ts` | 503 disabled · 502 unavailable · 502 contract-mismatch · cache HIT không gọi lại client · cache key theo companyId+userId (2 actor độc lập) |
| `apps/api/test/integration/me-training.int-spec.ts` | (a) 401 · (b) thiếu `access:lms` → 403 · (c) IDOR: `?email=<B>` + body + header giả → vẫn dữ liệu của A (fake client ghi nhận email A) · (d) LMS down → 502 `ME-ERR-TRAINING-LMS-UNAVAILABLE` · (e) 404 → `no_account` · (f) `LMS_COMPANY_ID` lệch → 503 |

`/me/training` CỐ Ý **không** thêm vào `me-qa1-idor-sweep.int-spec.ts`: sweep đó so baseline-vs-tampered ở
HTTP 200, mà route này phụ thuộc hệ NGOÀI (không có `LMS_PROGRESS_TOKEN` trong môi trường test ⇒ 503).
Hàng rào IDOR tương đương nằm trong int-spec riêng ở trên (có stub client) + metadata route-args ở unit spec.

Phát hiện thêm khi thi công (đã vá trong WO): phiên **PAT/API-key** (`ApiKeyAuthGuard`) đặt `req.user`
**KHÔNG có `email`** ⇒ nếu không chặn sẽ nổ `TypeError` → 500 câm. Service chặn tường minh bằng 403
("endpoint cá nhân, không hỗ trợ API key") — có unit test.

## 6. Env mới (việc của owner)

`LMS_PROGRESS_TOKEN` (optional, min 32) — **giá trị = `MEDIAOS_PROGRESS_TOKEN` trong `apps/lms/.env.production`**
(APP-3 §7.1). Thiếu ⇒ `/me/training` trả **503** (tắt mềm, không chặn boot). ĐỪNG gán `LMS_SYNC_TOKEN`
(token quyền-ghi) vào đây — sai token thì LMS trả 401 ⇒ MediaOS 502, không phải lỗi bảo mật nhưng khó debug.

Company-gate: nếu `LMS_COMPANY_ID` **đã khai** thì chỉ company đó gọi được (khác → 503) — mirror
fail-closed isolation của auto-sync (BẤT BIẾN #1). Chưa khai ⇒ giữ posture SSO (N=1, không gate).

## 7. Rủi ro / nợ

- Rate-limit LMS theo IP: mọi request MediaOS→LMS đi từ **1 IP**; cache 60s là lớp giảm tải duy nhất.
  Valkey down ⇒ `ValkeyService` fail-open (get null / set no-op) ⇒ mọi request đi thẳng LMS ⇒ user đăng
  nhập có thể lặp request và đẩy LMS chạm trần 120 req/phút/IP. **Blast radius bị chặn ở phía LMS** (nó có
  rate-limit per-IP + backstop global riêng — APP-3 §4): hậu quả xấu nhất là thẻ Đào tạo trả 502 một lúc,
  KHÔNG phải LMS sập. CỐ Ý chưa thêm cache in-process fallback (YAGNI, thêm 1 nơi giữ PII trong RAM);
  nếu sau này thấy 502 hàng loạt lúc Valkey outage thì đó là dấu hiệu cần bổ sung.
- Eviction cache là TTL thuần, không invalidate theo sự kiện ⇒ tiến độ trễ tối đa 60s (chấp nhận, đúng WO).
- FE (S5-LMS-FE-1) phải xử lý 3 trạng thái: `ok` · `no_account` · lỗi 502/503 (card fail-soft).
