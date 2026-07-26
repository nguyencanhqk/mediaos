# S5-LMS-NOTI-2 — LMS đẩy sự kiện học tập về NOTI của MediaOS (🟡 YELLOW · track LOCAL)

> WO: `harness/backlog.mjs` id `S5-LMS-NOTI-2`, phụ thuộc `S5-LMS-NOTI-1` (đã xong).
> Owner chốt 2026-07-26: lối **(a)** giữ nguyên `internalEventRecipientSchema` · **chuyển hẳn** (tắt chuông
> local cho loại đã đẩy).

---

## 0. Đo được trước khi code — 2 trong 4 mã KHÔNG có nguồn phát trong LMS

Kiểm mọi nơi ghi thông báo + mọi luồng ghi danh trong `apps/lms` (grep 2026-07-26):

| eventCode (seed 0529) | Nguồn phát trong LMS? | Kết luận |
| --- | --- | --- |
| `LMS_ENROLLMENT_APPROVED` | ✅ `app/(app)/manage-courses/actions.ts:49` (`approveCourseEnrollment`) | **WIRE** |
| `LMS_EXAM_GRADED` | ✅ `app/(app)/manage-exam/[id]/actions.ts:170` (`updateExamScore` — chấm tự luận) | **WIRE** |
| `LMS_COURSE_ASSIGNED` | ❌ LMS **không có** luồng "quản trị gán khoá cho người học". Ghi danh là TỰ PHỤC VỤ: người học bấm đăng ký (`app/(app)/course/[slug]/actions.ts:71`), khoá `is_locked` thì rơi vào `pending` chờ duyệt. | **KHÔNG wire** (không có gì để phát) |
| `LMS_COURSE_DEADLINE_NEAR` | ❌ Không có cột hạn hoàn thành trên `courses` (chỉ `exams.essay_deadline`), và không có job quét hạn nào trong LMS. | **KHÔNG wire** (thiếu CẢ dữ liệu lẫn job) |

Hai mã không wire **vẫn nằm trong catalog** — đúng thông lệ sẵn có (nhiều mã `ATT_*` cũng đã seed trước khi
có producer). Chúng KHÔNG gây hại: `registerSource()` fail-loud chỉ áp cho bridge outbox in-process, còn kênh
máy thì chỉ từ chối mã NGOÀI allowlist, không đòi mã trong allowlist phải được dùng.

**Việc còn nợ (ngoài phạm vi WO này — cần quyết định sản phẩm trước, không phải việc của một WO thông báo):**
- `LMS_COURSE_ASSIGNED`: cần tính năng "gán khoá bắt buộc cho nhân viên/phòng ban" ở LMS.
- `LMS_COURSE_DEADLINE_NEAR`: cần cột hạn hoàn thành cho enrollment + job quét (LMS có sẵn chỗ đặt timer
  trong `server.mjs`, nhưng dựng job nhắc hạn là một tính năng riêng).

### 0.1 Chồng lấn với chuông LMS (để chống nhận đôi)

| Thông báo local hiện có | Nơi phát | Chồng lấn? |
| --- | --- | --- |
| `course-update` kind=`enrollment-approved` | `manage-courses/actions.ts:60` | ✅ **CÓ** → tắt local, chuyển hẳn sang MediaOS |
| `course-update` kind=`new-lecture` | `manage-courses/[id]/actions.ts` ×3 | không (nội dung khoá — thuần vận hành LMS, giữ local) |
| `exam-available` | `manage-exam/actions.ts` ×5 | không (mở bài thi ≠ chấm bài thi) |
| `announcement`, `missed-call` | admin/chat | không (giữ local) |

Chấm bài thi hiện **KHÔNG** có thông báo local nào ⇒ `LMS_EXAM_GRADED` là năng lực MỚI, không có rủi ro
nhận đôi.

---

## 1. Định danh người nhận (lối (a)) — mang `mediaosUserId` sang LMS

`internalEventRecipientSchema` chỉ nhận UUID MediaOS, LMS chỉ biết email ⇒ phải dạy LMS biết `mediaosUserId`.

**Đường mang (2 kênh, ưu tiên kênh 1):**
1. **`sync-users`** (MediaOS→LMS, đã chạy): thêm `mediaosUserId` vào payload. Job đối soát
   `LMS_USER_SYNC` quét TOÀN BỘ user mỗi nhịp ⇒ **tự backfill** mọi user cũ, không phải chờ ai đăng nhập.
2. **token SSO**: thêm `sub = user.id`. Lưới an toàn cho user vào bằng SSO nhưng nằm ngoài phạm vi sync
   (không có hồ sơ nhân viên). Thêm field là tương thích ngược ở cả hai phía (verify chỉ kiểm field bắt buộc).

⇒ **WO này chạm CẢ `apps/api`** (ngoài `apps/lms` như WO seed giả định) — phần MediaOS đi PR bình thường,
phần LMS theo track LOCAL. Đã cập nhật `paths` trong backlog.

---

## 2. Việc — phía MediaOS (`apps/api`, PR)

| File | Việc |
| --- | --- |
| `integrations/lms/lms-http-client.service.ts` | `LmsSyncUser` += `mediaosUserId: string` |
| `integrations/lms/lms-sync-producer.service.ts` | payload outbox += `mediaosUserId` (đã có `userId` trong tay) |
| `integrations/lms/lms-user-sync.bridge.ts` | chuyển tiếp `mediaosUserId` |
| `integrations/lms/lms-user-sync.job-handler.ts` | select `users.id` → `mediaosUserId` cho từng batch |
| `integrations/lms/lms-sso.service.ts` | payload token += `sub: user.id` |

Không đổi hợp đồng summary (`LmsSyncSummary` giữ nguyên phân hoạch 6 counter — đụng vào là vỡ bất biến tổng).

## 3. Việc — phía LMS (`apps/lms`, LOCAL, không PR)

| File | Việc |
| --- | --- |
| `lib/platform/db/schema.ts` | `ALTER TABLE users ADD COLUMN mediaos_user_id TEXT` (mẫu try/catch sẵn có) + index |
| `app/api/admin/sync-users/route.ts` | nhận `mediaosUserId` optional; ghi khi tạo mới VÀ khi khác giá trị cũ (self-heal) |
| `lib/platform/auth/sso.ts` | `SsoPayload` += `sub?`; `ensureUserForSso` ghi `mediaos_user_id` |
| `app/api/auth/sso/route.ts` | truyền `verdict.payload.sub` xuống |
| `lib/platform/notifications/mediaos-noti.ts` | **MỚI** — client đẩy event sang MediaOS |
| `app/(app)/manage-courses/actions.ts` | phát `LMS_ENROLLMENT_APPROVED`; **BỎ** `notifyCourseUpdate` kind=`enrollment-approved` |
| `app/(app)/manage-exam/[id]/actions.ts` | phát `LMS_EXAM_GRADED` sau khi lưu điểm |
| `lib/platform/env.ts` | `MEDIAOS_BASE_URL` + `MEDIAOS_NOTI_TOKEN` (optional ⇒ thiếu là TẮT) |

### 3.1 Luật của `mediaos-noti.ts` (chỗ dễ hỏng nhất)

- **KHÔNG BAO GIỜ ném ra ngoài.** Duyệt ghi danh / chấm bài KHÔNG được hỏng vì MediaOS chết. Bọc try/catch
  toàn bộ, trả `boolean`.
- **KHÔNG nuốt câm.** Mọi nhánh hỏng đều `console.error` một dòng CỐ ĐỊNH + status (mẫu `LmsHttpClient`:
  không log body/email vì body có thể vọng lại email).
- **Timeout 5s** (`AbortSignal.timeout`) — không để một MediaOS treo giữ server action.
- **Bỏ qua sạch** khi: thiếu env · người nhận chưa có `mediaos_user_id` (log 1 dòng debug, không phải lỗi).
- **`dedupeKey` BẮT BUỘC** (MediaOS trả 400 nếu thiếu) và phải SUY TỪ NỘI DUNG, không phải ngẫu nhiên
  (memory `idempotency-key-must-be-content-derived`): `lms:<eventCode>:<entityId>:<mediaosUserId>`.
- **KHÔNG gửi `company_id`** — MediaOS trả 400 (tenant ghim ở server).

---

## 4. Runbook deploy (PROD) — soạn 2026-07-26

Số liệu ĐO trên máy PROD, không phải phỏng đoán:

| Thứ | Giá trị |
| --- | --- |
| API PROD | service `MediaOS-API` · port **3100** · prefix `/api/v1` (`API_PREFIX`/`API_VERSION` trong `.env`) |
| LMS PROD | service `MediaOS-LMS` · port **3400** · env `apps/lms/.env.production` (KHÔNG có `.env`) |
| Env MediaOS | service đọc `.env` ở gốc repo (`ENV_FILE_PATHS`); `.env.prod` là bản PROD mà `m prod-env` chép đè lên `.env` ⇒ **ghi CẢ HAI** |
| Đã có sẵn | `LMS_COMPANY_ID`, `LMS_BASE_URL`, `LMS_SSO_SECRET`, `LMS_SYNC_TOKEN`, `LMS_PROGRESS_TOKEN` — chỉ THIẾU `LMS_NOTI_TOKEN` |
| URL LMS gọi vào | `http://localhost:3100/api/v1` (cùng máy — không vòng qua tunnel) |

**Thứ tự BẮT BUỘC: API trước, LMS sau.** API mang migration 0529 (catalog `LMS_*`) và chính cái route.
Nếu LMS lên trước, mọi lần đẩy chỉ nhận 404 rồi log lỗi — không hỏng gì, nhưng vô ích.
Chiều ngược lại thì an toàn: API mới gửi thêm `mediaosUserId` cho LMS **cũ**, Zod của LMS strip key lạ.

### Bước 0 — sinh token dùng chung (chạy 1 lần, lấy 1 giá trị dùng cho CẢ hai file)

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### Bước 1 — MediaOS: thêm `LMS_NOTI_TOKEN` vào **cả** `.env.prod` và `.env`

```powershell
$tok = "<dán giá trị bước 0>"
Add-Content -Path ".env.prod" -Value "LMS_NOTI_TOKEN=$tok" -Encoding utf8
Add-Content -Path ".env"      -Value "LMS_NOTI_TOKEN=$tok" -Encoding utf8
```

### Bước 2 — LMS: thêm 2 biến vào `apps/lms/.env.production`

```powershell
Add-Content -Path "apps\lms\.env.production" -Value "MEDIAOS_NOTI_TOKEN=$tok" -Encoding utf8
Add-Content -Path "apps\lms\.env.production" -Value "MEDIAOS_API_URL=http://localhost:3100/api/v1" -Encoding utf8
```

> `MEDIAOS_API_URL` **khác** `MEDIAOS_APP_URL` (cái kia là URL trình duyệt của SPA). Sai chỗ này thì
> `fetch` trả 404 và mọi thông báo im lặng biến mất.

### Bước 3 — sao lưu SQLite của LMS TRƯỚC khi restart (schema sẽ thêm cột lúc khởi động)

```powershell
cd apps\lms; pnpm backup:db; cd ..\..
```

### Bước 4 — deploy API (build → **migrate 0529** → restart)

```powershell
m prod-update api
```

### Bước 5 — deploy LMS (next build → restart; `initSchema` tự thêm cột `mediaos_user_id`)

```powershell
m prod-update lms
```

### Bước 6 — kiểm chứng trước khi smoke

```powershell
# 6a. Catalog đã có 4 mã LMS (phải trả về 4 dòng)
docker exec mediaos-postgres psql -U mediaos -d mediaos -c "SELECT event_code, notification_type, dedupe_strategy FROM notification_events WHERE module_code='LMS' ORDER BY 1;"

# 6b. CHECK bảng notifications đã nới (phải thấy cả GOAL lẫn LMS)
docker exec mediaos-postgres psql -U mediaos -d mediaos -c "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='chk_notifications_module_code';"

# 6c. Route sống + fail-closed: KHÔNG token phải là 403
curl.exe -s -o NUL -w "%{http_code}`n" -X POST http://localhost:3100/api/v1/internal/v1/notifications/lms-events

# 6d. Token ĐÚNG + eventCode ngoài allowlist → 403 NOTI-ERR-EVENT-NOT-ALLOWED.
#     Đây là phép thử xác thực AN TOÀN: chứng minh token chạy mà KHÔNG tạo thông báo nào.
curl.exe -s -X POST http://localhost:3100/api/v1/internal/v1/notifications/lms-events -H "Authorization: Bearer $tok" -H "content-type: application/json" -d "{\"eventCode\":\"TASK_ASSIGNED\",\"sourceModule\":\"LMS\",\"dedupeKey\":\"probe\",\"recipient\":{\"mode\":\"UserIds\",\"userIds\":[]}}"

# 6e. Sau ~2 phút (job đối soát chạy mỗi 60s): id đã backfill sang LMS chưa?
cd apps\lms; node -e "const db=require('better-sqlite3')('data/app.db');console.log(db.prepare('SELECT count(*) AS total, count(mediaos_user_id) AS mapped FROM users').get())"; cd ..\..
```

`mapped` phải > 0 và tiến dần tới số nhân viên có hồ sơ. **Nếu `mapped = 0` thì đừng smoke** — chưa có
id thì `pushToMediaos` bỏ qua sạch (có log `chưa có mediaos_user_id`), và bạn sẽ tưởng kênh hỏng.

### Bước 7 — smoke thật

1. Duyệt 1 ghi danh trong LMS → nhân viên đó thấy thông báo trong MediaOS, bấm vào ra `/me/training`.
2. Bấm duyệt lại / gọi lại → **không** sinh thông báo thứ hai (dedupeKey).
3. Chấm 1 bài tự luận → thông báo "Bài thi đã có kết quả".
4. Chuông LMS **không** còn sinh mục "enrollment approved" mới (mục cũ vẫn hiện — đúng ý đồ).

### Rollback (không cần deploy lại)

Xoá/để trống `LMS_NOTI_TOKEN` trong `.env` rồi `m prod-restart api` ⇒ guard trả 403, kênh tắt sạch,
LMS chỉ log lỗi và **không** ảnh hưởng luồng duyệt/chấm. Migration 0529 là ADD-only, KHÔNG cần lùi
(lùi sẽ tái tạo lại đúng lỗi GOAL ở §0.1 của plan NOTI-1).

---

## 5. Kiểm chứng

1. `npx tsc --noEmit` + `eslint` xanh ở apps/lms; `pnpm typecheck`/`lint`/`test` xanh ở monorepo.
2. Smoke thật sau deploy: duyệt 1 ghi danh ⇒ nhân viên thấy thông báo trong MediaOS, bấm vào ra `/me/training`;
   chấm 1 bài tự luận ⇒ tương tự.
3. Bấm duyệt 2 lần / retry ⇒ vẫn 1 thông báo (dedupeKey).
4. Tắt API MediaOS ⇒ duyệt ghi danh vẫn thành công, log server có 1 dòng lỗi.
5. Chuông LMS KHÔNG còn mục "enrollment approved" mới; các loại khác giữ nguyên.
