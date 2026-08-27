# S10-FND-PARAMUUID-4 — KI-078 đợt 3: 36 tham số `:id`/`*Id` — KHÉP MỌI MODULE TRONG PHẠM VI TRỪ `tasks/`

> 🟡 LIGHT gate (`typescript-reviewer` + `quality-gate`). Không chạm permission/RLS/secret/audit/migration.
> Nối tiếp `S10-FND-PARAMUUID-3` (đợt 2, đã land `7a6dd3b9`).

---

## §1. SỐ ĐO SỐNG (đo lại, KHÔNG chép từ seed)

Chạy chính `apps/api/test/foundation/param-uuid-census.ts` trên `7a6dd3b9`:

```
ID_LIKE=298 · PIPED=150 · UNPIPED=148
```

Trùng ĐÚNG số ghi ở seed WO — không có PR nào chen giữa hai đợt. Phân bố 148 chỗ unpiped:

| module | unpiped | trong phạm vi? |
| --- | ---: | --- |
| `tasks/` | 75 | ✅ SPEC-06 — **để lại đợt 4** (xem §3) |
| `workflow/` | 36 | ⛔ PARK — out-of-scope (`S10-CLEAN-WORKFLOWPARK-1`) |
| `goals/` | 21 | ✅ **nhận đợt này** |
| `foundation/` ngoài `files/` | 8 | ✅ **nhận đợt này** |
| `notifications/` | 6 | ✅ **nhận đợt này** |
| `recycle-bin/` | 1 | ✅ **nhận đợt này** |
| `auth/` | 1 | ⛔ đã ký `skipped` ở đợt 1 — KHÔNG đụng lại |

---

## §2. TIÊU CHÍ CHỌN NHÓM — "khép prefix về 0", không phải "vá nhiều nhất"

Hai đợt trước chọn theo **rủi ro nghiệp vụ** (đợt 1: workflow phê duyệt nghỉ phép/chấm công; đợt 2:
hồ sơ nhân sự + cơ cấu tổ chức). Phần còn lại trong phạm vi KHÔNG có nhóm nào nổi bật hơn về rủi ro —
`goals`/`notifications`/`foundation-ops`/`recycle-bin` đều là dữ liệu nghiệp vụ thường.

⇒ Tiêu chí đợt này là **cấu trúc, không phải rủi ro**: nhận **TẤT CẢ phần trong phạm vi TRỪ `tasks/`**.

**Vì sao tiêu chí đó đáng giá hơn "vá 36 chỗ ngẫu nhiên của `tasks/`":**

1. **`CLEAN_PREFIXES` là bảo đảm MÁY ĐỌC ĐƯỢC, và nó chỉ nhận prefix ĐO ĐƯỢC bằng 0.** Vá 36/75 chỗ
   của `tasks/` không nới được prefix nào — tham số `tasks/` thứ 76 vẫn lẻn vào được dưới trần chung.
   Khép 4 prefix về 0 thì ca (1) của ratchet canh chúng vĩnh viễn.
2. **Sau đợt này, nợ trong phạm vi rút về ĐÚNG MỘT module.** `tasks/` 75 là một WO tự-đủ (§3), không
   còn phải kể lể "còn 5 module lẻ nữa". RELEASE-02 chuyển từ danh sách 5 dòng xuống 1 dòng.
3. **36 tham số / 8 controller** — đúng cỡ đợt 2 (42/9), một phiên làm hết.

**Cái GIÁ phải nói rõ:** đợt này KHÔNG chạm module rủi ro nhất còn lại (`tasks/`, 75 chỗ, chưa ai đo).
KI-078 vì thế **VẪN MỞ** sau đợt này.

---

## §3. PHẦN CÒN NỢ SAU ĐỢT 3 — khai trước, không để người đọc tự suy

| module | unpiped còn lại | ai xử |
| --- | ---: | --- |
| `tasks/tasks.controller.ts` | 43 | `S10-FND-PARAMUUID-5` (seed khi đóng WO này) |
| `tasks/projects.controller.ts` | 13 | ↑ |
| `tasks/task-files.controller.ts` | 11 | ↑ |
| `tasks/labels.controller.ts` | 4 | ↑ |
| `tasks/project-states.controller.ts` | 4 | ↑ |
| **`tasks/` cộng** | **75** | **nợ THẬT duy nhất còn lại trong phạm vi** |
| `workflow/` | 36 | `S10-CLEAN-WORKFLOWPARK-1` — DỌN, không vá |
| `auth/` | 1 | đã ký `skipped`, KHÔNG đụng lại |

⇒ **Trần mới `UNPIPED_CEILING` = 148 − 36 = 112.** Trong 112 đó: 75 nợ thật + 36 park + 1 skipped.

---

## §4. BA LANE — 36 tham số / 8 controller

| lane | file | unpiped | rủi ro riêng |
| --- | --- | ---: | --- |
| **L1-GOAL** | `goals/goals.controller.ts` | 12 | `goal_code` do SequenceService cấp ⇒ `:id` có thể là MÃ chứ không UUID (§5.1) |
| | `goals/task-templates.controller.ts` | 9 | `:templateId` + `:itemId` lồng nhau — 3 route hai-tham-số |
| **L2-FND** | `foundation/audit/audit.controller.ts` | 2 | **`/all/:id` là `@OperatorOnly`** — token tenant bị 401 TRƯỚC pipe (§5.2) |
| | `foundation/holidays/holidays.controller.ts` | 2 | `DELETE` trả **200**, không 204 |
| | `foundation/retention/retention.controller.ts` | 2 | cặp `manage:foundation-retention` **is_sensitive=true** |
| | `foundation/sequences/sequence.controller.ts` | 2 | bảng counter có KHOÁ NGHIỆP VỤ — `:id` có phải UUID? (§5.1) |
| **L3-NOTI** | `notifications/my-notifications.controller.ts` | 3 | own-scope tuyệt đối; `DELETE` 204, `mark-read` 200 |
| | `notifications/notification-admin.controller.ts` | 3 | catalog có `event_code`/`template_code` — `:id` có phải UUID? (§5.1) |
| | `recycle-bin/recycle-bin.controller.ts` | 1 | `restore:employee` **is_sensitive=true**, `@HttpCode(200)` |

Ba int-spec mới, chép khuôn sáu spec của hai đợt trước:

- `apps/api/test/integration/goals-param-uuid.int-spec.ts`
- `apps/api/test/integration/foundation-ops-param-uuid.int-spec.ts`
- `apps/api/test/integration/notifications-param-uuid.int-spec.ts` (gồm cả `recycle-bin`)

---

## §5. BA RỦI RO PHẢI ĐO, KHÔNG ĐƯỢC SUY

### §5.1 `:id` có thể là MÃ NGHIỆP VỤ, không phải UUID — gắn pipe sẽ CHẶN OAN

Đúng lớp đã suýt dính ở `leave_types` (đợt 1) và `job_levels`/`contract_types`/`positions` (đợt 2).
Bốn ứng viên đợt này đều có khoá nghiệp vụ riêng bên cạnh `id`:

| route | khoá nghiệp vụ cùng bảng | vì sao nghi |
| --- | --- | --- |
| `GET/PATCH /foundation/sequences/:id[/preview]` | `sequence_counters` LÀ bảng cấp mã | tên counter là khoá tự nhiên |
| `PATCH /notifications/events/:id` | `event_code` (`NOTI-EVENT-XXX`, SPEC-01 §9) | catalog nhỏ, FE dễ dùng code |
| `GET/PATCH /notifications/templates/:id` | `template_code` | ↑ |
| `GET/PATCH/... /goals/:id` | `goal_code` (SequenceService, counter seed 0506) | ↑ |

**Đọc code cho thấy cả bốn đều so `eq(<bảng>.id, id)`** (`notification-event.repository.ts:111` ·
`notification-template.repository.ts:67` · service `*ById`), tức `:id` LÀ uuid. Nhưng đọc-code không
phải số đo ⇒ **mỗi LOẠI KHOÁ bắt buộc có ca ALLOW-2xx trên HÀNG THẬT**, vì đó là vế DUY NHẤT phân biệt
"pipe chặn rác" với "pipe chặn oan request hợp lệ" ([[deny-cases-vacuous-without-allow-case]]).
Ca "UUID hợp lệ không tồn tại → 404" **KHÔNG** phát hiện được lỗi này.

### §5.2 `GET /foundation/audit-logs/all/:id` — `@OperatorOnly`, token tenant KHÔNG đo được gì

`JwtAuthGuard` đọc cờ `OPERATOR_ONLY` và verify với `expectedAudience='operator'`; token tenant → **401**.
Guard chạy TRƯỚC pipe ⇒ đo route này bằng actor tenant chỉ ra 401, **không phải số đo của tham số**.

⇒ Lane L2 phải có actor thứ hai: user gắn `PLATFORM_ADMIN_ROLE`
(`00000000-0000-0000-0000-0000000000f0`) rồi login thường — đúng cách `audit-list-filter.int-spec.ts`
đã dùng. Đây là ngoại lệ CÓ CHỦ Ý của luật "actor không phải super-admin": route này **theo thiết kế**
chỉ operator vào được, không có actor nào yếu hơn để mượn. Cặp `view:platform-audit` là
`is_sensitive=true` nên wildcard `*:*` KHÔNG kế thừa — grant vẫn phải tường minh, không có đường tắt.

### §5.3 Ba route HAI tham số id-like ⇒ đo RIÊNG TỪNG VẾ

`DELETE /goals/:id/tasks/:taskId` · `PATCH /task-templates/:templateId/items/:itemId` ·
`DELETE /task-templates/:templateId/items/:itemId`. Mỗi route hai ca DENY (rác ở vế này, HỢP LỆ ở vế
kia) — đo một vế rồi ký cả hai dòng verdict là ký cho chỗ chưa đo.

---

## §6. MÃ TRẠNG THÁI 2xx — ĐỌC TỪ FILE, không đoán

`@HttpCode` lệch khỏi mặc định ở nhiều chỗ; ca ALLOW phải assert ĐƠN TRỊ ĐÚNG số đo được:

| route | 2xx | nguồn |
| --- | ---: | --- |
| `DELETE /foundation/public-holidays/:id` | **200** | `@HttpCode(200)` `holidays.controller.ts:71` |
| `POST /foundation/retention-policies/:id/simulate` | **200** | `@HttpCode(200)` `retention.controller.ts:78` |
| `POST /recycle-bin/employees/:id/restore` | **200** | `@HttpCode(200)` `recycle-bin.controller.ts:27` |
| `POST /notifications/:id/mark-read` | **200** | `@HttpCode(200)` `my-notifications.controller.ts:112` |
| `DELETE /notifications/:id` | **204** | `@HttpCode(204)` `my-notifications.controller.ts:133` |
| `DELETE /goals/:id` · `DELETE /task-templates/:id` · `DELETE /task-templates/:templateId/items/:itemId` | **204** | `@HttpCode(204)` |
| `POST /goals/:id/check-in` · `/finalize` · `/reopen` · `/tasks` · `/decompose` · `POST /task-templates/:templateId/items` | **201** | `@Post` không khai `@HttpCode` |

---

## §7. CA LITERAL-SIBLING — liệt kê bằng ĐỌC FILE

Route tĩnh cùng cấp có thể bị `:id` nuốt nếu thứ tự khai báo sai. Danh sách lấy bằng đọc từng file:

| route tĩnh | anh em `:id` | ghi chú |
| --- | --- | --- |
| `GET /foundation/audit-logs/all` | `GET /foundation/audit-logs/:id` | **`all` là 1 segment ⇒ KHỚP `:id`**; chỉ THỨ TỰ KHAI BÁO cứu nó (`:51` trước `:68`). Ca đắt nhất của §7 |
| `GET /foundation/audit-logs` | ↑ | list company |
| `GET /foundation/public-holidays/check-working-day` | `PATCH/DELETE :id` | khác METHOD, vẫn ghim |
| `GET /foundation/public-holidays` · `GET /foundation/sequences` · `GET /foundation/retention-policies` | | |
| `GET /goals/tree` | `GET /goals/:id` | `tree` khai ở `:71`, `:id` ở `:87` |
| `GET /goals` · `GET /task-templates` | | |
| `GET /notifications/dropdown` · `GET /notifications/unread-count` | `GET /notifications/:id` | cả hai khai TRƯỚC `:id` |
| `POST /notifications/mark-all-read` | `POST /notifications/:id/mark-read` | khác số segment |
| `GET /notifications/events` · `GET /notifications/templates` · `GET /notifications/delivery-logs` | `GET /notifications/templates/:id` | |
| `GET /recycle-bin/employees` | `POST /recycle-bin/employees/:id/restore` | |

---

## §8. LUẬT ĐO (giống hai đợt trước, không nới)

- Actor ĐÃ đăng nhập, KHÔNG super-admin, KHÔNG seed `*:*` — **trừ ngoại lệ §5.2 đã khai**.
- Body HỢP LỆ cho mọi route ghi — 400-do-body là số đo GIẢ.
- KHÔNG gửi `Idempotency-Key` (interceptor chạy TRƯỚC pipe).
- DENY = **400 ĐƠN TRỊ** + neo `error.type ∉ {Error, ZodError}`.
- ALLOW = oracle loại CẢ 400 VÀ 500; ALLOW-2xx trên HÀNG THẬT cho MỖI LOẠI KHOÁ.
- `seedPermissionCatalog` phải truyền ĐÚNG `is_sensitive` của catalog, nếu không helper DỪNG:
  `manage:foundation-retention`=true · `restore:employee`=true · `view:audit-log`=true ·
  `view:platform-audit`=true · `view|update:notification-config`=true ·
  `view|update:notification-template`=true · phần còn lại (`goal` ×6 · `task-template` ·
  `foundation-holiday` ×2 · `foundation-sequence` ×2 · `view:foundation-retention` ·
  `notification` ×3 · `read:employee` · `task` ×3) = **false**.
- Cặp `notification` dùng action GẠCH DƯỚI: `read` · `mark_read` · `delete`
  (`notification-permissions.const.ts:22-27`) — KHÔNG phải `mark-read`.

---

## §9. THỨ TỰ THI CÔNG

1. **RED** — commit 3 int-spec TRƯỚC bản vá, chạy trên `LANE_DB=mediaos_paramuuid4`, dán số đo THẬT.
2. **GREEN** — gắn `ParseUUIDPipe` cho tham số ĐÃ ĐO ĐƯỢC 500. Route nào đo khác 500 ⇒ ghi ĐÚNG như
   đo, ký `skipped` kèm lý do, KHÔNG vá.
3. Ký đủ dòng verdict + thêm 8 file vào `PARAM_UUID_MEASURED_FILES` + nâng `PARAM_UUID_MEASURED_SIZE`.
4. Hạ `UNPIPED_CEILING` 148 → theo census mới; nới `CLEAN_PREFIXES` cho prefix ĐO ĐƯỢC bằng 0.
5. Census hộ tiêu thụ 500→400 đủ TÁM chỗ trước khi mở PR.
6. Rebase + chạy lại census NGAY TRƯỚC commit cuối (ca (3) là đẳng thức trên census sống).

⚠️ Thay `@Param` bằng perl/sed sửa NHẦM cả dòng COMMENT — đợt 2 dính đúng bẫy này. Soi `git diff -U0`
từng dòng sau mỗi lần thay ([[guard-immutability-matches-comments]]).
