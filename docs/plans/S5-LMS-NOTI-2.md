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

## 4. Kiểm chứng

1. `npx tsc --noEmit` + `eslint` xanh ở apps/lms; `pnpm typecheck`/`lint`/`test` xanh ở monorepo.
2. Smoke thật sau deploy: duyệt 1 ghi danh ⇒ nhân viên thấy thông báo trong MediaOS, bấm vào ra `/me/training`;
   chấm 1 bài tự luận ⇒ tương tự.
3. Bấm duyệt 2 lần / retry ⇒ vẫn 1 thông báo (dedupeKey).
4. Tắt API MediaOS ⇒ duyệt ghi danh vẫn thành công, log server có 1 dòng lỗi.
5. Chuông LMS KHÔNG còn mục "enrollment approved" mới; các loại khác giữ nguyên.
