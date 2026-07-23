# S5-LMS-APP-3 — API export tiến độ học của LMS cho MediaOS

> Track **LOCAL** `apps/lms` (Next.js, KHÔNG nằm trong git MediaOS — thư mục bị .gitignore).
> WO: `harness/backlog.mjs` → `S5-LMS-APP-3`. Nguồn: `docs/plans/S5-LMS-WAVE.md` §4 B06.

## 1. Mục tiêu

`GET /api/mediaos/progress?email=<email>` (server-to-server, Bearer) trả JSON **có đánh phiên bản**
cho **đúng 1 email**:

- `courses[]`: `{ slug, title, percent, completed, total, learningTimeSec, lastActivityAt }`
- `exams`: tóm tắt (đã nộp / đạt / trượt / chờ chấm / điểm cao nhất / lần nộp gần nhất)
- `summary`: tổng thời gian học · số khoá hoàn thành · mốc hoạt động gần nhất

Người tiêu thụ (WO kế tiếp): MediaOS `GET /me/training` (S5-LMS-BE-3) — proxy, cache ~60s,
**không lưu DB MediaOS**.

## 2. Quyết định token (plan-review 2026-07-21 W4 — blast radius)

**CHỐT SAU SECURITY REVIEW (2026-07-23, HIGH-2): token chỉ-đọc riêng `MEDIAOS_PROGRESS_TOKEN`, BẮT BUỘC,
KHÔNG fallback.** Chưa đặt biến ⇒ endpoint trả 503 (tắt), không tự hạ chuẩn xuống token quyền-cao.

Lý do:

- `MEDIAOS_SYNC_TOKEN` là token **quyền-cao**: ai giữ nó có thể tạo tài khoản LMS, khoá/mở tài khoản,
  thu hồi phiên (`POST /api/admin/sync-users` — endpoint đó **không rate-limit, không audit**).
  Endpoint progress mở ra internet qua tunnel ⇒ nếu dùng chung, mọi rò rỉ ở đường đọc (log proxy, cấu
  hình MediaOS, ảnh chụp màn hình lúc debug) đều leo thang thẳng thành quyền **ghi/khoá tài khoản**.
- ~~Fallback giữ deploy hiện tại không gãy~~ — **bỏ**: hôm nay **chưa có consumer nào** (BE-3 chưa
  làm), nên lợi ích tương thích = 0 mà vẫn gánh nguyên blast-radius. Fail-closed đúng hơn.

⚠️ Hệ quả vận hành: owner **phải** đặt `MEDIAOS_PROGRESS_TOKEN` trong cùng lần build+restart, và
MediaOS (BE-3) phải gửi **đúng token đó** — xem §7.

Bất kể chọn gì: **rate-limit per-IP là BẮT BUỘC** (đã làm, §4).

## 3. File đụng (chỉ `apps/lms/**` + đúng 1 file doc này)

| File | Việc |
| --- | --- |
| `apps/lms/lib/platform/auth/server-token.ts` | **MỚI** — `bearerMatches()` (timing-safe) tách ra dùng chung |
| `apps/lms/app/api/admin/sync-users/route.ts` | Bỏ bản copy cục bộ của `bearerMatches`, import bản dùng chung (refactor thuần, giữ nguyên ngữ nghĩa) |
| `apps/lms/lib/platform/env.ts` | Thêm `MEDIAOS_PROGRESS_TOKEN` (optional, min 32) |
| `apps/lms/lib/lms/mediaos-progress.ts` | **MỚI** — truy vấn + tính toán (service layer, route mỏng) |
| `apps/lms/app/api/mediaos/progress/route.ts` | **MỚI** — route: env → rate-limit → bearer → validate → service |
| `apps/lms/lib/platform/rate-limit.ts` | SỬA (sau review) — trần `MAX_BUCKETS` evict-oldest, chống cạn bộ nhớ |
| `apps/lms/scripts/test-mediaos-progress.sh` | **MỚI** — script curl 4 ca, token đọc TỪ ENV |

KHÔNG đụng `apps/api`, `packages/**`. KHÔNG chạy `next build` (xem §6).
`harness/backlog.mjs`: chỉ thêm **1 dòng `src[]`** cho WO `S5-LMS-BE-3` (ràng buộc chống IDOR — review M3).

## 4. Thiết kế bảo mật

Thứ tự kiểm tra trong route (cố ý):

1. **Thiếu env token → 503** (`{ message: "Progress export is not enabled" }`) — mẫu y hệt sync-users.
2. **Rate-limit per-IP → 429**, TRƯỚC khi so token: brute-force token bị cắt ở 120 req/phút/IP mà
   không tốn 1 query DB nào (`RATE_LIMIT_PER_IP_BURST` = 120, refill 2/s).
   **Khoá bucket (sửa sau review HIGH-1):** ưu tiên `cf-connecting-ip` (Cloudflare ghi đè ở biên ⇒
   không giả mạo được), dự phòng `x-forwarded-for`/`x-real-ip`; giá trị bị cắt 64 ký tự và phải khớp
   `^[0-9a-fA-F.:]{3,45}$`, không khớp → dồn vào bucket `unknown`. Kèm trần `MAX_BUCKETS = 10_000`
   (evict-oldest) trong `rate-limit.ts` — nếu không, header do client điều khiển sinh key `Map` vô hạn
   = **làm cạn bộ nhớ tiến trình PROD trước cả cổng token**. Hàng rào thật vẫn là token 256-bit;
   trần per-IP là lớp phụ (XFF vẫn giả mạo được khi gọi nội bộ).
3. **Bearer sai/thiếu → 401**, so bằng `timingSafeEqual` + so độ dài trước (không rò độ dài qua thời gian).
4. **Rate-limit toàn cục → 429** (`RATE_LIMIT_GLOBAL_BURST` = 300, refill 5/s) — backstop cho tải
   **đã xác thực** (X-Forwarded-For giả mạo được ⇒ trần per-IP bị pha loãng; caller hợp lệ cũng có thể
   lặp vô hạn do lỗi cấu hình). **Đặt SAU cổng token là cố ý:** nếu đặt trước, kẻ tấn công không cần
   token vẫn hút cạn bucket chung ⇒ MediaOS bị 429 (rate-limit trở thành đòn bẩy DoS).
   Cả hai dùng lại `lib/platform/rate-limit.ts` (token bucket in-memory + sweeper; LMS chạy 1 tiến trình
   NSSM nên bộ nhớ tiến trình là đủ — nếu sau này scale nhiều instance thì phải chuyển sang Valkey/Redis).
5. **Query `email` sai định dạng / thiếu → 400** (Zod `.trim().min(3).max(254).email()`, không trả chi
   tiết lỗi Zod ra ngoài internet).
6. **Không có tài khoản LMS → 404 sạch** `{ message: "Not found" }`. **Đính chính sau review (L1):**
   tài khoản **đã khoá vẫn trả 200** kèm `user.active = false` (MediaOS cần phân biệt "chưa có tài
   khoản học" với "có nhưng đã khoá") — 404 chỉ nghĩa là *chưa từng có tài khoản*. Ghi nhận:
   404-theo-email **là** oracle enumeration, **chấp nhận** vì nằm SAU cổng token (đã ghi ở WO src).
   Nếu sau này bỏ token gate thì phải đổi thành 200-rỗng. Mọi phản hồi (kể cả 4xx/5xx) đều
   `cache-control: no-store` để không tầng cache nào giữ lại oracle này.
7. **Khoá theo đúng 1 user:** resolve `users.id` từ email rồi **mọi** truy vấn/subquery đều bind
   `user_id = ?` (kể cả subquery đếm `course_material_progress`) — không có nhánh nào chạy không-điều-kiện.
   Email khớp **chính xác sau khi lowercase** (mọi đường ghi của LMS đều chuẩn hoá lowercase:
   `signUpWithEmail`, `ensureUserForSso`, sync-users; đã kiểm DB PROD: 36/36 user lowercase, không trùng).

Chống dump / chống phình:

- Endpoint **bắt buộc** có `email`; **không** có chế độ "trả tất cả user", không có `?all=`.
- `MAX_COURSES = 100` (cắt bằng `LIMIT` trong SQL) + cờ `coursesTruncated`.
- `MAX_EXAM_ATTEMPTS = 500` (LIMIT) + cờ `examsTruncated`.
- Không trả `id` nội bộ, không trả nội dung bài làm/đáp án — chỉ số liệu tổng hợp.

Không audit-log mỗi lần đọc: MediaOS poll ~60s ⇒ audit sẽ thành rác (đúng bài học S5-LMS-BE-4:
chỉ ghi khi CÓ THAY ĐỔI THẬT). Đây là endpoint đọc, không đổi state.
**Nhưng phải có tín hiệu (sửa sau review M2):** đếm 401 theo cửa sổ 5 phút, vượt 20 lần → 1 dòng
`console.warn` (throttle 60s/loại) — và 1 dòng khi chạm trần chung SAU xác thực. Không log token,
không log Authorization.

## 5. Hợp đồng JSON (version 1)

```jsonc
{
  "version": 1,
  "generatedAt": "2026-07-23T10:00:00.000Z",
  "user": { "email": "a@b.c", "name": "Tên", "active": true },
  "summary": { "courseCount": 3, "completedCourses": 1, "learningTimeSec": 5400, "lastActivityAt": "..." },
  "courses": [
    { "slug": "...", "title": "...", "percent": 62, "completed": 5, "total": 8,
      "learningTimeSec": 3600, "lastActivityAt": "2026-07-20T..." }
  ],
  "coursesTruncated": false,
  "exams": { "submitted": 4, "passed": 2, "failed": 1, "pendingGrading": 1,
             "bestScore10": 8.5, "lastSubmittedAt": "...", "truncated": false },
  "quizzes": { "submitted": 12, "averagePercent": 78, "lastSubmittedAt": "..." }
}
```

Quy ước dữ liệu:

- `percent = round(completed / total * 100)`, `total = 0` ⇒ `percent = 0`.
- Phạm vi khoá học: mirror trang "My Learning" (`app/(app)/dashboard/page.tsx`) —
  `enrollments.approval_status = 'approved'` + `courses.status IN ('Publish','Public')`.
- `learningTimeSec` lấy từ `course_learning_time.seconds` (bảng cộng dồn có sẵn).
- `lastActivityAt` = max(`course_progress.updated_at`, `course_learning_time.updated_at`,
  max `course_material_progress.completed_at` trong khoá) — tất cả đều là ISO-8601 UTC nên so chuỗi là đủ.
- Điểm thi: lặp lại đúng công thức **trang học viên** `app/(app)/exam/page.tsx` (MC quy về thang 10 ·
  trọng số `mc_weight_percent` khi có tự luận · `pass_score` là **thang 100** · chỉ "chờ chấm" khi có
  tự luận VÀ `mc_weight_percent < 100` mà chưa có `essay_score`), gom vào hàm thuần
  `computeExamOutcome()` trong `lib/lms/mediaos-progress.ts`. (`ranks/page.tsx` dùng biến thể chặt hơn
  cho bảng xếp hạng — cố ý KHÔNG theo bản đó.)
- `quizzes`: 1 dòng tổng hợp từ `quiz_attempts` (đã nộp · % trung bình theo tổng câu đúng/tổng câu ·
  lần nộp gần nhất) — không trả từng lượt nên không có rủi ro phình payload.

## 6. Cách verify

- `npx tsc --noEmit` trong `apps/lms` + `npx eslint` các file mới.
- **CỐ Ý KHÔNG chạy `next build`:** LMS PROD (NSSM, PORT 3400) chạy **thẳng từ thư mục này**
  (`node server.mjs` đọc `.next/`). `next build` sẽ ghi đè `.next` của tiến trình đang phục vụ =
  deploy chui. Việc build/deploy là của owner (§7).
- `apps/lms/scripts/test-mediaos-progress.mjs` — 4 ca: token đúng · token sai · email lạ · vượt
  rate-limit (+ ca [2b] token SYNC bị 401 khi chạy ở localhost). Token đọc từ env — **chỉ**
  `MEDIAOS_PROGRESS_TOKEN` (không còn fallback), KHÔNG hard-code.

## 7. Việc của owner để lên PROD

1. **BẮT BUỘC — sinh token đọc riêng** rồi thêm vào `apps/lms/.env.production` (không có biến này thì
   endpoint trả 503; **không** còn fallback sang `MEDIAOS_SYNC_TOKEN` — xem §2):

   ```powershell
   cd "c:\dev 2\MediaOS\apps\lms"
   $t = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   Add-Content -Path .env.production -Encoding utf8 -Value "MEDIAOS_PROGRESS_TOKEN=$t"
   ```

   Giữ lại giá trị đó: WO **S5-LMS-BE-3** phải cấu hình MediaOS gửi **đúng token này** (biến phía
   MediaOS, không phải `LMS_SYNC_TOKEN` dùng cho sync-users).
   *Muốn tắt endpoint: **xoá hẳn dòng**, không để trống — nhưng để trống cũng an toàn rồi
   (`emptyStringAsUndefined`, sửa sau review M1).*
2. Build + restart dịch vụ LMS theo quy trình đang dùng (NSSM PORT 3400) — lane này KHÔNG tự chạy.
3. Nghiệm thu: `node --env-file=.env.production scripts/test-mediaos-progress.mjs` (đặt thêm
   `PROGRESS_TEST_EMAIL=<email nhân viên có thật>`); thêm `--rate-limit` nếu muốn chạy cả ca 429.
   Chạy ở localhost sẽ có thêm ca **[2b]**: token SYNC bị 401 ⇒ chứng minh không còn fallback.

## 8. Rủi ro

| Rủi ro | Giảm thiểu |
| --- | --- |
| Endpoint mở ra internet qua tunnel | Token gate + rate-limit per-IP + backstop global + cap kích thước |
| `x-forwarded-for` giả mạo làm loãng rate-limit per-IP | Bucket global chặn tổng; token vẫn là hàng rào chính |
| Enumeration email qua 404 | Chấp nhận (sau token gate) — ghi rõ ở §4 |
| Công thức điểm thi trôi khỏi bản ở `exam/page.tsx`/`ranks/page.tsx` | Gom vào 1 hàm thuần có comment trỏ về 2 nơi kia; nợ kỹ thuật: wave sau nên rút 2 trang đó về dùng chung |
| PROD chạy từ chính thư mục này | Không build, không restart trong lane (§6) |

---

## 9. Kết quả thi công (2026-07-23)

### 9.1 File đã tạo/sửa (tất cả trong `apps/lms/**` + file plan này)

| File | Trạng thái |
| --- | --- |
| `apps/lms/app/api/mediaos/progress/route.ts` | MỚI — route (503 → 429/IP → 401 → 429/global → 400 → 404 → 200) |
| `apps/lms/lib/lms/mediaos-progress.ts` | MỚI — service: resolve user, SQL khoá theo `user_id`, trần 100 khoá / 500 lượt thi, `computeExamOutcome()` |
| `apps/lms/lib/platform/auth/server-token.ts` | MỚI — `bearerMatches()` timing-safe dùng chung |
| `apps/lms/app/api/admin/sync-users/route.ts` | SỬA — bỏ bản copy `bearerMatches`, import bản chung (refactor thuần, ngữ nghĩa y hệt) |
| `apps/lms/lib/platform/env.ts` | SỬA — thêm `MEDIAOS_PROGRESS_TOKEN` (optional, min 32) |
| `apps/lms/scripts/test-mediaos-progress.mjs` | MỚI — nghiệm thu 4 ca (token từ ENV, in kèm lệnh curl tương đương) + ca [2b] token SYNC bị 401 (chỉ chạy ở localhost) |
| `apps/lms/lib/platform/rate-limit.ts` | SỬA (vòng review) — `MAX_BUCKETS = 10_000` evict-oldest |

Script viết bằng **Node `.mjs`** thay vì `.sh`: khớp quy ước thư mục `scripts/` hiện có (toàn `.mjs`)
và chạy được trên Windows của owner; mỗi ca vẫn in ra **lệnh curl tương đương** để copy/paste.
Ca [4] rate-limit mặc định BỎ QUA (đốt bucket của IP ~1 phút), bật bằng cờ `--rate-limit`.

### 9.2 Đã verify

- `npx tsc --noEmit` → `TSC_EXIT=0` (không lỗi).
- `npx eslint` trên 6 file trên → `ESLINT_EXIT=0`.
- **SQL chạy thật trên DB PROD của LMS ở chế độ READONLY** (script nháp, không nằm trong repo; trích
  thẳng chuỗi SQL từ `mediaos-progress.ts` nên không lệch bản chép tay):
  - query khoá học: 9 dòng cho user mẫu, đủ cột `slug/title/total_items/completed_items/last_completed_at/learning_seconds/...`;
  - user KHÁC ra 1 dòng (độc lập ⇒ không rò chéo);
  - chạy với `cmp.user_id = 'no-such-user'` ⇒ **không dòng nào có `completed_items > 0`**
    (chứng minh subquery đếm bị khoá theo user, không phải đếm chung rồi lọc sau);
  - query lượt thi + aggregate quiz chạy đúng, cột khớp schema thật;
  - đối chiếu tay 1 lượt thi thật (25/25, `mc_weight_percent=100`, `pass_score=80`, có đề tự luận):
    `computeExamOutcome` → `passed`, giống hệt kết quả trang `exam/page.tsx` cho cùng dòng dữ liệu.
- Kiểm dữ liệu email: 36/36 user lowercase, 0 trùng-khi-bỏ-hoa-thường ⇒ khớp exact-match an toàn.

### 9.3 CHƯA làm (cố ý) — việc của owner

- **KHÔNG chạy `next build`, KHÔNG restart NSSM.** LMS PROD (PORT 3400) chạy thẳng từ thư mục này và
  đọc `.next/`; build ở lane này = deploy chui vào tiến trình đang phục vụ người học.
  ⇒ Endpoint **chưa được gọi thật** (nó chỉ tồn tại sau khi owner build+restart). Nghiệm thu HTTP 4 ca
  chạy bằng `scripts/test-mediaos-progress.mjs` **sau** khi deploy.
- **Env `MEDIAOS_PROGRESS_TOKEN` là BẮT BUỘC** (đổi sau security review HIGH-2): chưa đặt ⇒ endpoint
  trả **503**, KHÔNG hạ chuẩn xuống `MEDIAOS_SYNC_TOKEN`. Lệnh sinh token: §7.1.

### 9.4 Nợ cho lane khác

- **S5-LMS-BE-3** (MediaOS `GET /me/training`):
  - dựng Zod contract theo §5 (pin `version === 1`, fail-safe khi shape lệch);
  - **BẮT BUỘC (review M3 — nếu sai thì thành IDOR):** email phải resolve **từ session/JWT phía
    server**, CẤM nhận `email`/`employeeId` từ query·body·header của client. LMS trả tiến độ của
    **bất kỳ email nào** cho ai giữ token ⇒ toàn bộ kiểm soát "đúng người" nằm ở MediaOS;
  - gửi Bearer bằng **`MEDIAOS_PROGRESS_TOKEN`** (token đọc riêng, KHÔNG phải `LMS_SYNC_TOKEN`);
  - cache ~60s để không đụng trần rate-limit.
- Nợ kỹ thuật LMS (không thuộc WO này): rút công thức điểm thi ở `exam/page.tsx` + `ranks/page.tsx`
  về dùng chung `computeExamOutcome()` để hết 3 bản song song.
- Nợ hiệu năng (review L4, hiện chưa đau — 10 khoá / 187 material): subquery `total` quét toàn bộ
  `lectures ⋈ lecture_materials` **trước** `LIMIT`, mà `better-sqlite3` là đồng bộ ⇒ chặn event-loop
  chung với app học viên. Khi catalog lớn thì giới hạn subquery theo tập khoá đã ghi danh.

---

## 10. Security review (FULL gate) — 2026-07-23

Agent `security-reviewer`, đọc thật 6 file + `rate-limit.ts`/`connection.ts`/`exam/page.tsx`, chạy lại
`tsc --noEmit`, truy vấn DB PROD readonly, và **đối chứng refactor `bearerMatches` bằng artifact build
CŨ** (`.next/server/app/api/admin/sync-users/route.js` chứa nguyên bản hàm inline cũ — giống
byte-for-byte bản tách ra ⇒ chứng minh refactor endpoint GHI quyền-cao là **thuần**).

**Vòng 1: BLOCK** — 2 HIGH, 4 MEDIUM, 5 LOW. Đã vá trong cùng WO:

| # | Vấn đề | Vá |
| --- | --- | --- |
| HIGH-1 | Key rate-limit lấy thẳng `x-forwarded-for` (client điều khiển, ~16KB, vô hạn giá trị) + `Map` không trần ⇒ **cạn bộ nhớ tiến trình PROD trước cả cổng token**; đồng thời vô hiệu hoá trần per-IP và cho phép DoS chọn lọc chính MediaOS bằng cách giả IP của nó | `clientIp()` ưu tiên `cf-connecting-ip`, cắt 64 ký tự, ép `IP_SHAPE`, không khớp → `unknown`; `rate-limit.ts` thêm `MAX_BUCKETS = 10_000` evict-oldest (§4.2) |
| HIGH-2 | Fallback `?? MEDIAOS_SYNC_TOKEN` đặt token GHI quyền-cao lên endpoint mở internet, trong khi lợi ích tương thích = 0 (BE-3 chưa tồn tại) | Bỏ fallback: `MEDIAOS_PROGRESS_TOKEN` bắt buộc, chưa đặt → 503 (§2, §7.1) |
| M1 | `MEDIAOS_PROGRESS_TOKEN=` (rỗng) làm `createEnv` throw lúc import ⇒ **sập toàn bộ LMS** thay vì tắt 1 endpoint | `emptyStringAsUndefined: true` trong `env.ts` |
| M2 | Endpoint PII mở internet không có tín hiệu nào khi bị dò token | Đếm 401 (cửa sổ 5 phút, ngưỡng 20) + `console.warn` throttle 60s; thêm cảnh báo khi chạm trần chung sau xác thực |
| M3 | Hợp đồng cho BE-3 chưa cấm nhận email từ client ⇒ nguy cơ IDOR phía MediaOS | Ghi ràng buộc vào §9.4 + `src[]` của WO `S5-LMS-BE-3` trong `harness/backlog.mjs` |
| M4 | Chỉ nhánh 200 có `cache-control: no-store` | Helper `json()` — mọi status đều `no-store` |
| L1 | Comment/plan nói 404 không phân biệt "đã khoá" vs "chưa từng có" — sai: user khoá trả 200 + `active:false` | Sửa comment route + §4.6 |
| L2 | `startsWith("Bearer ")` phân biệt hoa/thường (RFC 7235 là không) | `/^bearer /i` — chỉ scheme, token vẫn so hằng-thời-gian |
| L3 | `pass_score ?? 0` biến đề **chưa cấu hình điểm đạt** thành `passed` (dormant: PROD 100% `pass_score = 80`, nhưng migration cũ có `DEFAULT 0`) | `pass_score <= 0` → `pending` (vẫn trả `score10`) — cố ý chặt hơn `exam/page.tsx` vì số này lên màn hình nhân sự |
| L4 | Subquery `total` quét trước `LIMIT`, `better-sqlite3` đồng bộ | Ghi nợ (§9.4) — hiện 187 material, chi phí không đáng kể |
| L5 | `submitted` đếm theo LƯỢT, UI gộp theo phiên ⇒ hai số lệch | Ghi rõ trong type comment + §5 |

**ĐẠT, không phải finding:** SQL injection sạch (SQL hằng, mọi giá trị bind, kể cả `LIMIT ?`) ·
không có đường rò dữ liệu user khác (`WHERE cmp.user_id = ?` nằm **trong** subquery — chặt hơn bản
`dashboard/page.tsx`; đối chứng DB: 36/36 email lowercase, 0 trùng) · payload không chứa id nội bộ,
bài làm, đáp án · không hard-code/không log secret · refactor `sync-users` thuần (chứng minh bằng
artifact build cũ).

Sau vá: `npx tsc --noEmit` → 0 · `npx eslint` 7 file → 0.

**Vòng 2: PASS** — reviewer đọc lại delta + soi hồi quy 3 file dùng chung, kết luận "không có lỗ mới
do bản vá đẻ ra". Xác nhận bằng grep/dữ liệu: đường progress **không còn tham chiếu
`MEDIAOS_SYNC_TOKEN`** nào ngoài comment ⇒ deploy hiện trạng = endpoint **503 inert** cho tới khi owner
đặt token đọc. Còn 3 mục LOW (2 dòng doc lạc hậu + 1 comment) — đã sửa nốt trong vòng này.

Ghi nhớ cho người sau (NOTE của reviewer, không phải lỗi):

- `rate-limit.ts` chỉ có **2 importer** (`exam-attempt/route.ts` + route này); `server.mjs` có
  `rateLimit` riêng ⇒ Socket.IO/presence không dính. Eviction theo **thứ tự chèn (không phải LRU)** nên
  key sống lâu (`mediaos-progress:global`, `exam-event:<userId>`) bị đá trước; hậu quả tệ nhất là
  "được cấp lại token sớm ~10–25s" — **chỉ fail-open**, không tạo được đòn bẩy đẩy MediaOS vào 429.
  Nâng cấp tuỳ chọn: `delete + set` ở nhánh hit để thành LRU thật.
- **ĐỪNG hạ `MAX_BUCKETS`**: key IPv6 hợp lệ cắt từ header 16KB có thể là SlicedString giữ tham chiếu
  chuỗi cha; trần 10.000 chặn thiệt hại tối đa ở mức ~160MB thay vì hàng GB.
- `cf-connecting-ip` chỉ đáng tin **qua tunnel**; ai chạm thẳng `:3400` (localhost/LAN) vẫn tự đặt được
  header. Chấp nhận: trần per-IP là lớp phụ, hàng rào thật là token 256-bit.
- `emptyStringAsUndefined` là **cải thiện thuần**: biến bắt buộc rỗng vẫn fail-loud như cũ; phía client
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY=""` chuyển từ "sập boot" sang "tắt push mềm".
