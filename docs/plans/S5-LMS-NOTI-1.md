# S5-LMS-NOTI-1 — Mở đường cho LMS đẩy thông báo vào NOTI (🔴 RED · crown · trust boundary)

> WO: `harness/backlog.mjs` id `S5-LMS-NOTI-1`. Gate **FULL** (trust boundary + migration).
> Chốt với owner 2026-07-26: **(1)** danh tính = **guard riêng cho caller máy** · **(2)** seed **đủ 4 mã**
> `LMS_*` · **(3)** chống nhận đôi = **chuyển hẳn** (NOTI-2 tắt loại đã đẩy ở chuông LMS).

---

## 0. Kết luận đo được (trước khi viết dòng code nào)

| Đo | Kết quả |
| --- | --- |
| Intake hiện có | `POST /internal/v1/notifications/events` — `JwtAuthGuard` (global) **+** `InternalGuard` (`x-internal-key`). `company_id` lấy từ `req.user.companyId`, body mang `company_id` lệch → 400. |
| Đường PAT (`mok_`) | **NGÕ CỤT** — `ApiKeyAuthGuard` đã bị GỠ khỏi APP_GUARD ở CLEAN-DECOUPLE-1 (`app.module.ts:101`). Token không-JWT rơi vào `JwtAuthGuard` → 401. |
| `target_url` | `assertInternalTargetUrl` chỉ nhận route nội bộ (`/...`, không `//`, không scheme) ⇒ **không deep-link được vào LMS**. Đích khả dụng: `/me/training` (đã có, `sidebar-registry.ts:963`). |
| Recipient | `internalEventRecipientSchema` = `UserIds \| EmployeeIds` (UUID MediaOS). **GIỮ NGUYÊN** (owner chốt lối (a)) — LMS phải tự biết `mediaosUserId`, việc đó thuộc NOTI-2. |
| Boot-guard | `OutboxNotificationBridge.registerSource()` fail-loud nếu eventCode không có trong `NOTI_EVENT_CATALOG` (is_enabled). WO này KHÔNG đăng ký bridge (LMS không phát outbox trong tiến trình api) ⇒ không chạm boot-guard. |

### 0.1 🐞 LỖI ĐÃ SHIP phát hiện khi đo — GOAL không bao giờ tạo được thông báo

`0507` (S5-GOAL-DB-1) nới CHECK trên **`notification_events`** (`module_code += 'GOAL'`, `notification_type += 'Goal'`)
nhưng **KHÔNG** nới 2 CHECK cùng tên nghĩa trên bảng **`notifications`** (`0479:252-257`). Engine
`createFromEngine` (`notifications.repository.ts:170-171`) ghi `module_code = ev.moduleCode`,
`notification_type = ev.notificationType` ⇒ mọi `GOAL_ASSIGNED` / `GOAL_FINALIZED` **vỡ CHECK khi INSERT**.

Xác minh trên DB PROD `mediaos` (2026-07-26):

```
chk_notifications_module_code       → ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM')   ← thiếu GOAL
chk_notifications_notification_type → (…,'Warning','Error')                                        ← thiếu Goal
SELECT module_code, count(*) FROM notifications GROUP BY 1  →  TASK | 6      (0 hàng GOAL)
```

Không test nào bắt được vì không có int-spec nào chạy intake GOAL tới tận INSERT.

**Quyết định:** vá trong CÙNG migration của WO này. Lý do: (a) tôi đang DROP/ADD đúng 2 constraint đó để
thêm `LMS`/`Training` — bỏ qua `GOAL`/`Goal` khi tay đang đặt trên chính constraint đó là cố ý để lỗi lại;
(b) nếu không vá, seed LMS sẽ lặp lại y hệt lỗi. Kèm int-spec hồi quy cho CẢ GOAL lẫn LMS.

---

## 1. Phạm vi

**LÀM:**
1. Migration `0529` — nới **4** CHECK (2 bảng × {module_code, notification_type}) + seed 4 event `LMS_*` + 4 template vi-VN.
2. Registry `notification-event-catalog.const.ts` đồng bộ 1-1 với migration (+ contracts enum `Training`).
3. Danh tính máy: `LmsServiceIntakeGuard` + route `POST /internal/v1/notifications/lms-events`.
4. Test RED-trước: deny-path guard (unit) + int-spec trust-boundary/happy/dedupe + hồi quy GOAL.

**KHÔNG LÀM (đóng phạm vi):**
- Không nới `internalEventRecipientSchema` (không thêm mode `Emails`) — owner đã chốt.
- Không đụng route `/internal/v1/notifications/events` cũ, không đụng `InternalGuard`, không bật lại PAT.
- Không đăng ký bridge outbox cho LMS (LMS ở NGOÀI tiến trình api).
- Không sửa apps/lms (đó là NOTI-2). Không thêm `mediaosUserId` vào SSO/sync payload (NOTI-2, xem §7).

---

## 2. Danh tính máy — thiết kế (CROWN)

```
POST /internal/v1/notifications/lms-events
Authorization: Bearer <LMS_NOTI_TOKEN>

@Public()                     ← bỏ JwtAuthGuard/CompanyGuard/2FA (không có user, và KHÔNG giả vờ có)
@UseGuards(LmsServiceIntakeGuard)
  1. env LMS_NOTI_TOKEN thiếu    → 403 fail-closed (mirror InternalGuard)
  2. env LMS_COMPANY_ID thiếu    → 403 fail-closed
  3. Bearer so HẰNG-THỜI-GIAN    → lệch → 403     (mirror apps/lms/lib/platform/auth/server-token.ts)
  4. rate-limit cửa sổ cố định   → vượt → 429
  5. gắn req.lmsService = { companyId: LMS_COMPANY_ID }
Controller
  6. body có company_id/companyId (BẤT KỂ giá trị) → 400   ← chặt hơn route JWT: máy KHÔNG được nêu ý kiến
  7. eventCode ∉ allowlist LMS (suy từ NOTI_EVENT_CATALOG, module==='LMS' && isEnabled) → 403
  8. thiếu dedupeKey → 400                                 ← xem §2.1
  9. >20 người nhận → 400                                  ← xem §2.2
 10. engine.intake(companyId TỪ GUARD, dto)
```

### 2.1 `dedupeKey` BẮT BUỘC (phát sinh khi làm — deny-path (i) đỏ mới lộ ra)

Mặc định `notification_events.dedupe_strategy` của 0479 là `'None'`, và chỉ 2 mã TASK ồn ào được map trong
`DEFAULT_DEDUPE` ở code. Nghĩa là nếu để mặc định, **mỗi lần LMS retry lại đẻ thêm một thông báo** — đúng thứ
`done_when` của NOTI-2 cấm. Chốt hai lớp:

1. Seed 4 mã LMS với `dedupe_strategy='DedupeKey'` (migration bước 5) — caller giữ quyền quyết định idempotency.
2. Controller **bắt buộc** `dedupeKey`, thiếu → 400. Không có bước 2 thì "quên gửi khoá" = dedupe tắt IM LẶNG.

KHÔNG chọn `'EntityRecipient'` (once-ever theo entity+người nhận): nó sẽ khiến `LMS_COURSE_DEADLINE_NEAR`
chỉ nhắc được ĐÚNG MỘT LẦN cho mỗi khoá/người, vĩnh viễn.

### 2.2 Trần 20 người nhận

`internalEventRecipientSchema` không giới hạn độ dài mảng, còn engine lặp per-recipient (SAVEPOINT + INSERT
notification + INSERT delivery_log + audit) TRONG MỘT transaction. Với credential máy, mảng khổng lồ là đòn
khuếch đại rẻ tiền ⇒ chặn tại controller. Sự kiện học tập vốn nhắm 1 người, 20 đã quá rộng.

**Vì sao KHÔNG service-account + JWT:** LMS phải giữ credential tương đương người dùng + vòng đời refresh
token; user dịch vụ lộ ra trong danh sách/phân quyền; nhiều bộ phận chuyển động hơn cho đúng một endpoint.

**Vì sao KHÔNG bật lại PAT:** `ApiKeyAuthGuard` chạy trên MỌI request toàn hệ thống — blast radius quá lớn
so với nhu cầu, và nó đã bị park out-of-scope ở CLEAN-DECOUPLE-1.

**BẤT BIẾN #1 giữ nguyên:** `company_id` đến từ **env máy chủ**, không từ body, không từ header client.
`engine.intake` vẫn mở `withTenant(companyId)` ⇒ RLS FORCE ẩn mọi recipient khác tenant (resolve 0 hàng).

**BẤT BIẾN #3:** `LMS_NOTI_TOKEN` chỉ đọc từ env, không log, không vào audit/DTO. Khai ở `env.schema`
(`.min(32).optional()`) cùng họ `LMS_*` — thiếu env = kênh TẮT (403), không chặn boot.

**Least privilege:** allowlist eventCode suy TỪ registry ⇒ token này **không thể** mint `LEAVE_*`, `HR_*`,
`AUTH_*`. Đây là khác biệt thực chất so với việc phát cho LMS một JWT người dùng.

**Residual đã biết (ghi rõ, không giấu):**
- Rate-limit là cửa sổ cố định **trong tiến trình** — API PROD chạy 1 tiến trình (NSSM :3100). Nhiều
  instance ⇒ hạn mức nhân theo số instance. Chấp nhận ở N=1; nâng lên Valkey khi scale-out.
- `actorUserId` do LMS gửi được GIỮ (engine cần để loại actor khỏi recipient). Khoá bị lộ có thể gán sai
  actor — hệ quả giới hạn ở audit attribution + actor-exclusion, không mở rộng phạm vi dữ liệu.

---

## 3. Migration 0529 (nối tiếp head 0528 · idx 196 · when 1717587318000)

`0529_s5_lmsnoti1_noti_catalog_lms.sql` — mirror 0507, THUẦN DATA/DDL-CHECK.

| Bước | Nội dung |
| --- | --- |
| (1) | `chk_notification_events_module_code` ⊇ `'LMS'` (superset = 0479 ∪ GOAL ∪ **LMS**) |
| (2) | `chk_notification_events_type` ⊇ `'Training'` (superset = 0479 ∪ Goal ∪ **Training**) |
| (3) | `chk_notifications_module_code` ⊇ `'GOAL'`,`'LMS'` — **VÁ §0.1**, giữ nguyên nhánh `IS NULL OR` |
| (4) | `chk_notifications_notification_type` ⊇ `'Goal'`,`'Training'` — **VÁ §0.1**, giữ `IS NULL OR` |
| (5) | seed 4 `notification_events` GLOBAL (`company_id NULL`, enabled) — `ON CONFLICT (event_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING` |
| (6) | seed 4 `notification_templates` GLOBAL IN_APP/vi-VN, `is_default`, `target_url='/me/training'` |
| (7) | VERIFY fail-LOUD: 4 event enabled + mỗi event ≥1 template Active default + **cả 4** CHECK chứa giá trị mới |

⚠️ **Bẫy đã biết (memory `audit-check-union-parse-anchor-trap`):** KHÔNG dùng parser DO-block kiểu 0474
(giả định array-literal `{...}`). Ở đây dùng đúng cách của 0507: guard `pg_get_constraintdef LIKE '%''LMS'''%'`
+ **re-stamp SUPERSET tường minh**. Đã verify: chỉ `0479` và `0507` từng định nghĩa 4 constraint này
(`grep -l chk_notification*` trên toàn `apps/api/migrations`) ⇒ superset viết tay không mất giá trị nào.

### 3.1 Bốn mã + template (vi-VN, `target_url` = `/me/training`)

| eventCode | type | priority | placeholder |
| --- | --- | --- | --- |
| `LMS_ENROLLMENT_APPROVED` | Training | Normal | `{course_name}` |
| `LMS_COURSE_ASSIGNED` | Training | Normal | `{course_name}` |
| `LMS_EXAM_GRADED` | Training | Normal | `{exam_name}` |
| `LMS_COURSE_DEADLINE_NEAR` | **Reminder** | High | `{course_name}`, `{deadline_label}` |

- `DEADLINE_NEAR` dùng type `Reminder` theo đúng quy ước sẵn có (`TASK_DUE_SOON`, `HR_CONTRACT_EXPIRING`),
  không đẻ type mới cho việc nhắc hạn.
- Renderer **giữ nguyên placeholder khi thiếu biến** (`notification-renderer.service.ts:29`) ⇒ template chỉ
  dùng biến LMS LUÔN gửi được. Không nhét điểm thi/nội dung nhạy cảm vào body (SPEC-01 §22, BẤT BIẾN #3).

---

## 4. File chạm

| File | Việc |
| --- | --- |
| `apps/api/migrations/0529_…sql` + `meta/_journal.json` | §3 |
| `apps/api/src/foundation/seed/notification-event-catalog.const.ts` | `NotiModuleCode += 'LMS'`, `NotiType += 'Training'`, +4 entry, count 55→**59**, enabled 41→**45** |
| `packages/contracts/src/notification.ts` | `notificationTypeEnumSchema += 'Training'` (engine cast `as NotificationTypeEnum`) |
| `apps/api/src/notifications/lms-service-intake.guard.ts` | MỚI — §2 bước 1-5 |
| `apps/api/src/notifications/lms-notifications.controller.ts` | MỚI — §2 bước 6-8 |
| `apps/api/src/notifications/notifications.module.ts` | đăng ký controller + guard (khối additive) |
| `apps/api/src/config/env.schema.ts` + `.env.example` | `LMS_NOTI_TOKEN` |
| `apps/api/src/notifications/lms-service-intake.guard.spec.ts` | MỚI — unit deny-path |
| `apps/api/test/integration/lms-noti-service-intake.int-spec.ts` | MỚI — trust-boundary + happy + dedupe + **hồi quy GOAL** |
| `apps/api/test/integration/noti-seed-catalog-permissions.int-spec.ts` | pin 55→59 · 41→45 |

---

## 5. Test — RED trước (deny-path đi đầu)

**Unit (`*.guard.spec.ts`):** thiếu `LMS_NOTI_TOKEN` → 403 · thiếu `LMS_COMPANY_ID` → 403 · sai token → 403 ·
token đúng-tiền-tố-khác-độ-dài → 403 (không ném từ `timingSafeEqual`) · header vắng → 403 · vượt hạn mức → 429 ·
đúng → gắn `req.lmsService.companyId`.

**Integration (`hasDb && LANE_DB`):**

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| a | không `Authorization` | 403, 0 notification |
| b | token sai | 403 |
| c | `LMS_NOTI_TOKEN` unset | 403 |
| d | `LMS_COMPANY_ID` unset | 403 |
| e | `eventCode = TASK_ASSIGNED` (tồn tại + enabled, NGOÀI allowlist) | **403**, 0 notification ⇒ chứng minh least-privilege |
| f | body kèm `company_id` (kể cả ĐÚNG giá trị) | 400 |
| g | recipient là user công ty KHÁC | 200 `createdCount=0` (RLS ẩn), 0 notification bên kia |
| h | happy `LMS_ENROLLMENT_APPROVED` | 1 notification `module_code='LMS'`, `notification_type='Training'`, `target_url='/me/training'` + 1 delivery_log `Sent` |
| i | gọi lại cùng `dedupeKey` | `created=0`, `deduped=1` |
| j | **hồi quy GOAL**: intake `GOAL_ASSIGNED` qua route JWT cũ | tạo được 1 notification `module_code='GOAL'` ⇒ §0.1 đã vá |

Ca (j) là bài test mà GOAL đã thiếu — nó đứng ở đây để lỗi §0.1 không tái diễn.

---

## 6. Rủi ro & cách chặn

| Rủi ro | Chặn |
| --- | --- |
| `@Public()` mở route ra ngoài | Guard fail-closed trước mọi thứ; token ≥32 ký tự; allowlist eventCode; rate-limit; route nằm dưới `/internal/v1/**` (reverse-proxy PROD không expose ra internet). |
| Khoá LMS lộ ⇒ spam thông báo | Chỉ mint được 4 mã `LMS_*`, chỉ trong 1 company, rate-limit, mọi lần tạo đều có `audit_logs` + `notification_delivery_logs`. Thu hồi = đổi env + restart. |
| CHECK re-stamp làm mất giá trị cũ | Superset viết tay + VERIFY fail-loud so `pg_get_constraintdef` cho CẢ 4 constraint; đã grep xác nhận chỉ 0479/0507 định nghĩa chúng. |
| Registry lệch migration | int-spec `noti-seed-catalog-permissions` so tập DB ↔ registry (thiếu-mã ĐỎ, thừa-mã ĐỎ) + pin đếm. |
| `deleted_at` NULL vs seed lặp | `ON CONFLICT` partial-unique đúng chỉ mục 0479 (bare `ON CONFLICT(event_code)` nổ 42P10). |

---

## 7. Bàn giao sang S5-LMS-NOTI-2

1. LMS gọi `POST {MEDIAOS_BASE_URL}/api/v1/internal/v1/notifications/lms-events` với
   `Authorization: Bearer <MEDIAOS_NOTI_TOKEN>` (= `LMS_NOTI_TOKEN` phía MediaOS).
2. Body = `internalEventIntakeSchema`, `recipient.mode='UserIds'` + `userIds=[mediaosUserId]`,
   **KHÔNG** kèm `company_id`.
3. LMS chưa có `mediaosUserId` ⇒ NOTI-2 phải: thêm `mediaosUserId` vào payload `sync-users` (MediaOS→LMS,
   `lms-sync-producer.service.ts` + `lms-http-client.service.ts`) và vào payload SSO (`lms-sso.service.ts`),
   thêm cột `mediaos_user_id` trên `users` LMS. Job đối soát định kỳ sẽ **tự backfill** user cũ — rẻ hơn chờ
   từng người SSO. ⇒ **paths của NOTI-2 phải mở rộng sang `apps/api/src/integrations/lms/**`**.
4. `dedupeKey` ổn định: `lms:<eventCode>:<courseId|examId>:<mediaosUserId>`.
5. Chuyển hẳn (owner chốt): loại nào đã đẩy sang MediaOS thì NGỪNG ghi `user_notifications` ở LMS.
