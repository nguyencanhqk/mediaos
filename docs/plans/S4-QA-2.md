# S4-QA-2 — QA Sprint 4 E2E + regression sign-off (plan, máy-đọc được)

WO: `harness/backlog.mjs` id `S4-QA-2` (module INT, layer QA, zone yellow).
Nguồn: ISSUE-BOARD-01 §18 (DASH-QA-001/002) · IMP02-STORY-108 · IMPLEMENTATION-07 §15/§18 · IMPLEMENTATION-08.
Paths sở hữu: `apps/api/test/**`, `apps/app/src/**`, `docs/plans/S4-QA-2.md` — KHÔNG sửa `apps/api/src/**`/migrations
(mọi gap tìm thấy trong code nguồn → ghi known-issues, không tự vá).

## 1. Ma trận test P0

| # | Luồng / P0 | Loại | Tái dùng (file) | Viết mới |
| --- | --- | --- | --- | --- |
| 1 | TASK_ASSIGNED → notification đúng recipient, dedupe, cross-tenant, unread-count | int (đã ship S4-INT-1) | `task-noti-e2e.int-spec.ts` (16 test) | KHÔNG — đủ phủ |
| 2 | Comment mention → notification | int (đã ship) | `task-noti-e2e.int-spec.ts` (7) | KHÔNG |
| 3 | My-Notification API deny-path/own-scope/mark-read/mark-all-read/delete | int (đã ship S4-NOTI-BE-1) | `my-notifications.int-spec.ts` | KHÔNG |
| 4 | Dashboard cache invalidate (event → widget map, wiring thật qua OutboxWorker) | int (đã ship S4-INT-2) | `dashboard-cache-invalidate.int-spec.ts` | KHÔNG |
| 5 | Dashboard widget data + degraded + cache TTL + HR PII mask | int (đã ship S4-DASH-BE-2) | `dashboard-widget-data.int-spec.ts` (D1–D7, D4/D4b degraded) | KHÔNG |
| 6 | Dashboard 2-tenant cross-module | int (đã ship) | `dash-xmodule-2tenant.int-spec.ts` | KHÔNG |
| 7 | FE degraded rendering (per-widget, không sập cả grid) | component | `DashboardWidgetGrid.isolation.spec.tsx` + từng `*Widget.spec.tsx` | KHÔNG |
| 8 | FE deep-link component (target_url null/absolute/protocol-relative → an toàn) | component | `NotificationTargetLink.spec.tsx`, `NotificationDetailPage.spec.tsx`, `NotificationDropdown.spec.tsx`, `NotificationsWidget.spec.tsx`, `WidgetCard.spec.tsx` | KHÔNG |
| 9 | **E2E §15.1 xuyên suốt: assign → outbox → bridge → notify → GET nội dung thật → mark-read → unread giảm** (TASK_ASSIGNED render ĐÚNG — xác nhận thực nghiệm) | int | — (mở rộng #1, thêm assertion nội dung interpolate thật, không chỉ đếm hàng) | **MỚI (E1)** |
| 10 | **[CRITICAL QA2-CRIT-002] comment/mention → notification body CÂM** (`{task_code}`/`{actor_name}` chưa điền — 0490 bỏ sót 3 mã) | int | — | **MỚI (E1b)** |
| 11 | **Dashboard MY_TASKS phản ánh CONTENT task mới sau event thật** (không chỉ cache-row boolean như S4-INT-2-FIX-1) | int | — | **MỚI (E2)** |
| 12 | **Dashboard NOTIFICATIONS — lỗ hổng wiring đã biết (`dashboard-cache-invalidation.const.ts` dòng 80-92): 0 producer thật cho NOTIFICATION_CREATED/READ qua engine → cache STALE trong TTL 10s, tự lành sau TTL** | int | — | **MỚI (E3, chứng minh bằng E2E thật, không chỉ đọc code)** |
| 13 | **[CRITICAL QA2-CRIT-001] Deep link target_url — seed template mặc định (mig 0481) KHÔNG set `target_url_template` cho BẤT KỲ event nào (0/39 global template) → target_url luôn NULL trên toàn hệ thống dù SPEC-08 mẫu `/tasks/task-id`** | int | — | **MỚI (E4)** |
| 14 | Regression S0–S3 (AUTH/HR/ATT/LEAVE) full-suite trên LANE_DB | int + unit | toàn bộ `apps/api/test/**` + `apps/app/src/**` | KHÔNG (chạy lại — 100% xanh, 1 fragility pre-existing ghi known-issue) |

## 2. Test viết mới — file

`apps/api/test/integration/qa2-e2e-task-noti-dash.int-spec.ts` (file mới, 6 test, đã CHẠY THẬT trên
`mediaos_s4qa2`, 2 lần liên tiếp cô lập — xanh cả 2 lần):

1. **E1** — flow §15.1: Manager assign task → outbox → bridge → GET `/notifications` (Employee) → mark-read →
   unread-count giảm. Đo NỘI DUNG interpolate thật — **XÁC NHẬN THỰC NGHIỆM: TASK_ASSIGNED render ĐÚNG**
   (`task_code`/`task_title` được điền thật, không còn placeholder) nhờ migration `0490` đã vá template sang
   camelCase khớp payload thật. (Giả thuyết ban đầu — nghĩ TASK_ASSIGNED cũng câm như 0481 — SAI, bị bác bỏ
   bởi lần chạy thật đầu tiên; sửa lại assertion + ghi rõ trong doc-block để không hiểu lầm lần sau — đọc
   migration SEED GỐC không đủ, phải đọc CẢ chuỗi migration VÁ theo sau.)
2. **E1b (CRITICAL, QA2-CRIT-002)** — comment + mention trên task: outbox → bridge → GET detail
   `/notifications/:id` → `content`/`short_content` CÒN NGUYÊN placeholder `{task_code}`/`{actor_name}` CHƯA
   ĐIỀN (khác E1 — `TASK_COMMENT_CREATED`/`TASK_MENTIONED` KHÔNG được vá cùng đợt `0490` như
   `TASK_ASSIGNED`/`TASK_STATUS_CHANGED`/3 mã mới `PRIORITY/DUE_DATE/ASSIGNEE_CHANGED`).
3. **E2** — Dashboard `MY_TASKS`: baseline (cache miss) → assign task 2 (event thật) → outbox drain (registrar
   invalidate thật) → GET lại → `cache.hit=false` + `summary.total` tăng + nội dung (title) chứa task mới
   (content-level, không chỉ boolean cache-row như `dashboard-cache-invalidate.int-spec.ts`).
4. **E3 (known-issue QA2-HIGH-001)** — Dashboard `NOTIFICATIONS`: warm cache → assign task tạo notification mới
   (qua engine thật) → GET NGAY (trong TTL 10s) → `cache.hit=true`, unread KHÔNG đổi (STALE — vì
   `NOTIFICATION_CREATED` không có producer thật từ engine, chỉ module legacy mồ côi) → ép hết TTL (lùi
   `generated_at`) → GET lại → tự lành, thấy notification mới.
5. **E4 (CRITICAL known-issue QA2-CRIT-001)** — target_url: assign task → GET `/notifications/:id` (detail) VÀ
   GET `/dashboard/widgets/notifications` (item) → `target.target_url === null` / `items[].targetUrl === null`
   (documents thực trạng, KHÔNG phải test giả — assertion khớp hành vi THẬT của code hiện tại; nếu ai fix
   migration/bridge sau này, test này sẽ ĐỎ và bắt buộc phải cập nhật — đó là chủ đích, không phải che giấu bug).
6. **smoke** — 401 không token trên 3 route dùng trong flow.

Nguyên tắc viết: KHÔNG mock permission/DB — đường thật HTTP → Controller → Service → Outbox → OutboxWorker →
Bridge → NotificationEngineService → DB, mirror `task-noti-e2e.int-spec.ts`/`dashboard-cache-invalidate.int-spec.ts`.
**Bài học quy trình:** mọi giả thuyết bug PHẢI verify bằng chạy test thật trước khi ghi known-issues — giả
thuyết ban đầu về TASK_ASSIGNED (mục 1) SAI khi đọc tĩnh chỉ migration `0481`; chạy thật lộ ra `0490` đã vá,
tránh báo cáo nhầm 1 "known-issue" không tồn tại.

## 3. Known-issues (Sprint 4 sign-off)

| ID | Severity | Mô tả | Bằng chứng | Trạng thái |
| --- | --- | --- | --- | --- |
| QA2-CRIT-001 | **Critical (P0)** | `target_url` KHÔNG được set cho BẤT KỲ notification nào tạo qua `NotificationEngineService` mặc định — migration `0481_s4_notiseed1_event_template_perms.sql` seed 39 template global nhưng KHÔNG set cột `target_url_template` (không nằm trong danh sách cột INSERT); `TaskNotiBridgeRegistrar` cũng không truyền `target_module`/`target_type`/`target_id` cho `persistRecipient`. Kết quả: `GET /notifications/:id`.`target.target_url` luôn `null` cho TASK/LEAVE/ATT/AUTH — vi phạm SPEC-08 §15/§18 mẫu response (`target_url: "/tasks/task-id"`) và IMPLEMENTATION-07 §15.1 acceptance ("Click notification mở đúng task"). FE (`NotificationTargetLink`) xử lý null ĐÚNG (ẩn nút), nên không crash — nhưng chức năng deep-link THỰC TẾ không hoạt động cho tenant nào chưa tự cấu hình company-override template qua `NotificationTemplatesPage` (S4-FE-NOTI-4). | Query trực tiếp DB (`mediaos_s4qa2`): `SELECT count(*) FILTER (WHERE target_url_template IS NOT NULL) FROM notification_templates WHERE company_id IS NULL` → `0/39`. Test mới `qa2-e2e-task-noti-dash.int-spec.ts` E4. | **Chưa xử lý — ngoài scope QA-2 (paths không gồm `apps/api/src`/`migrations`).** Đề xuất WO mới: thêm migration set `target_url_template` cho các event có entity rõ ràng (TASK_*→`/tasks/{task_id}`, LEAVE_REQUEST_*→`/leave/me/requests/{leave_request_id}`, …) + sửa `TaskNotiBridgeRegistrar`/tương đương truyền `target_module`/`target_type`/`target_id` (hoặc để render tự suy ra từ `source_entity_type`/`source_entity_id` khi thiếu — cách này rẻ hơn, không cần sửa từng bridge). **Chặn "ĐẠT" tuyệt đối — xem verdict.** |
| QA2-HIGH-001 | High | Dashboard `NOTIFICATIONS` widget cache KHÔNG tự invalidate khi có notification mới qua đường thật (`NotificationEngineService`/task-noti bridge) — `NOTIFICATION_CREATED` chỉ có producer từ module `notifications.service.ts` LEGACY (mồ côi, 0 consumer), `NOTIFICATION_READ` không có producer nào. Đã tự tài liệu hoá trong code (`dashboard-cache-invalidation.const.ts` dòng 80-92, "VIỆC CÒN NỢ") từ S4-INT-2 — QA-2 bổ sung bằng chứng E2E thật (test E3). Tác động bị GIỚI HẠN bởi TTL ngắn (10s cho nhóm NOTI, `DASH_WIDGET_TTL_SECONDS.NOTI=10`) — tự lành trong ≤10s, không phải mất vĩnh viễn. | Test mới E3. | Đã biết từ S4-INT-2 (ghi nợ trong code), QA-2 xác nhận bằng E2E. Defer — sửa đụng `apps/api/src/notifications/**` (ngoài paths). Đề xuất: (a) đăng ký consumer nghe `notification.created` thật từ module `notifications` (không phải `dashboard`), hoặc (b) đơn giản hơn — chấp nhận TTL 10s làm cơ chế tự invalidate chính thức (ghi rõ trong IMPLEMENTATION-07 §17.2, đã đúng thiết kế) và XOÁ 2 mã NOTIFICATION_CREATED/READ khỏi `DASH_CACHE_INVALIDATION_MAP` cho khỏi gây hiểu lầm "đã wire" (việc dọn dẹp, không phải bug). |
| QA2-CRIT-002 | **Critical (P0)** | `TASK_COMMENT_CREATED`/`TASK_MENTIONED`/`PROJECT_MEMBER_ADDED` render CÂM — placeholder KHÔNG bao giờ điền được. Khác `QA2-CRIT-001` (target_url): đây là NỘI DUNG chính (`body`/`short_body`) mà user đọc trực tiếp. Root cause: `TaskCommentsService.commentPayload()` (task-comments.service.ts) không có field `task_code` LẪN `actor_name`; `ProjectsService` member-added payload (`projectId, memberEmployeeId, memberUserId, actorUserId`) không có `project_name`/`project_code`. Migration `0481` seed template dùng đúng 4 placeholder này (`{task_code}`,`{actor_name}` cho 2 mã đầu; `{project_name}`,`{project_code}` cho mã 3) — KHÔNG mã nào trong payload thật có tên tương ứng (không phải lỗi case, mà THIẾU HẲN — actor/project chỉ có id, không có tên người/tên dự án). Khác với `TASK_ASSIGNED`/`TASK_STATUS_CHANGED`/`TASK_PRIORITY_CHANGED`/`TASK_DUE_DATE_CHANGED`/`TASK_ASSIGNEE_CHANGED` — 5 mã NÀY đã được `0490` vá đúng (camelCase khớp payload thật) — 3 mã COMMENT_CREATED/MENTIONED/MEMBER_ADDED bị BỎ SÓT khỏi đợt vá đó. | Test mới `qa2-e2e-task-noti-dash.int-spec.ts` E1b (comment thật qua API → `GET /notifications/:id` → `content` chứa nguyên văn `{actor_name}`/`{task_code}`). | **Chưa xử lý — ngoài scope QA-2.** Đề xuất WO fix nối tiếp `0490` (cùng pattern): (a) `TaskCommentsService.commentPayload()` thêm `taskCode: task.taskCode` + JOIN lấy tên actor (`actor_name` — cần bảng `employee_profiles`/`users` tại chỗ enqueue hoặc tại bridge qua `payloadOf`); (b) `ProjectsService` member-added thêm `project_name`/`project_code` (đã có `id`/project row tại chỗ enqueue, rẻ); (c) HOẶC đơn giản hơn — sửa 3 template sang camelCase khớp field ĐANG CÓ (taskId/taskTitle/commentId cho 2 mã đầu; projectId cho mã 3) — bỏ `actor_name`/`project_name` khỏi nội dung nếu không đáng thêm JOIN. **Cùng nhóm chặn "ĐẠT" tuyệt đối với QA2-CRIT-001 — xem verdict.** |
| QA2-MED-001 | Medium (test fragility, không phải security/data bug) | `my-notifications.int-spec.ts` test "unread-count query TƯƠNG THÍCH idx_notifications_unread" — planner chọn `notifications_company_id_idx` (index gốc mig `0010`, cột `company_id` đơn) thay vì `idx_notifications_unread` (partial index mig `0479`) dù đã `SET LOCAL enable_seqscan=off`. KHÔNG phải regression do QA-2 (file/module ngoài phạm vi sửa của lane này, pre-existing từ S4-NOTI-BE-1). Bằng chứng LẪN LỘN theo NGỮ CẢNH chạy — cô lập 1 mình: ĐỎ nhất quán 3/3 lần; chạy CÙNG BATCH với ~38 file int-spec khác (bảng `notifications` có nhiều hàng hơn do các company khác chèn/xoá trong cùng phiên chạy): XANH 1/1 lần. Kết luận: bảng cardinality thấp khi cô lập ⇒ planner tie-break giữa 2 index cost gần bằng nhau không ổn định — test giả định SAI (fragile theo cardinality nhỏ, không phải theo cấu trúc index — chính bình luận gốc của test cũng cảnh báo vấn đề này nhưng cách né seqscan chưa đủ vì còn 1 index cạnh tranh khác). | 3 lần chạy cô lập `vitest run test/integration/my-notifications.int-spec.ts --no-file-parallelism` trên `mediaos_s4qa2` → cùng lỗi, cùng plan (`Index Scan using notifications_company_id_idx`); 1 lần chạy trong batch 38-file (`qa2part-ac`) → XANH (18/18 pass). | **RED cô lập / XANH theo batch — ngoài scope sửa (file thuộc S4-NOTI-BE-1, không phải `qa2-e2e-*` mới). KHÔNG tự sửa** (đúng luật "RED thật ở module khác → ghi known-issue, không tự vá ngoài scope" dù kỹ thuật file nằm trong path `apps/api/test/**` của QA-2 — đây là sửa/gỡ bug của WO KHÁC, không phải thêm test QA-2). Đề xuất: đổi assertion sang "KHÔNG phải Seq Scan" (bất kỳ Index Scan/Bitmap nào cũng chấp nhận được — đúng ý định gốc "không scan bảng") thay vì khớp CHÍNH XÁC tên index, HOẶC seed đủ hàng (>1000) để cost thật phản ánh lợi thế partial index như production. **KHÔNG chặn "ĐẠT"** — không phải lỗi chức năng/bảo mật, chỉ là assertion cứng nhắc theo implementation detail của query planner. |
| QA2-INFO-001 | Info | OpenAPI/contracts: không phát hiện drift mới trong phạm vi TASK/NOTI/DASH khi review test hiện có — việc chuẩn hoá contract tổng thể là WO riêng `S5-BE-CONTRACT-1`, không làm ở đây. | — | N/A (không phải known-issue, ghi để tránh trùng việc). |

## 4. Regression S0–S3 (kết quả THẬT, `LANE_DB=mediaos_s4qa2`)

Full-suite crash 2 lần với `Channel closed` (tinypool, memory `turbo-cache-false-green`/flake đã biết) kể cả
`--no-file-parallelism` khi chạy 1 process duy nhất cho toàn bộ `apps/api` — chia theo nhóm (unit riêng, 4 batch
int-spec ~40 file/batch) chạy trọn vẹn KHÔNG crash:

| Nhóm | Lệnh | File | Test | Kết quả |
| --- | --- | --- | --- | --- |
| Unit (`src/**/*.spec.ts`) | `vitest run src --no-file-parallelism` | 192 | 3104 | ✅ XANH 100% |
| Integration batch 1/4 | `vitest run <42 file đầu bảng chữ cái> --no-file-parallelism` | 42 | 539 | ✅ XANH |
| Integration batch 2/4 | tương tự, 38 file kế | 35 (3 file finance-*-deny bị exclude khỏi vitest config — park, không phải gap) | 764 + 4 skip | ✅ XANH |
| Integration batch 3/4 | tương tự (gồm `qa2-e2e-task-noti-dash.int-spec.ts` mới) | 38 (+1 file skip toàn bộ: `pgbouncer-tenant-isolation` thiếu `PGBOUNCER_URL`, đúng thiết kế) | 482 + 3 skip + 1 todo | ✅ XANH (bao gồm `my-notifications.int-spec.ts` 18/18 — xem QA2-MED-001 về tính KHÔNG ổn định khi cô lập) |
| Integration batch 4/4 | tương tự, 40 file cuối (2 file `webhooks-deny`/`ui-config-deny` exclude — park) | 40 | 938 + 12 skip | ✅ XANH |
| **Tổng integration** | — | **155/161 chạy được** (6 file park: 3 finance-*-deny + webhooks-deny + ui-config-deny — ngoài scope sản phẩm theo CLAUDE.md "de-media-fy", KHÔNG phải gap QA) | **~2723 pass + 19 skip + 1 todo** | ✅ XANH |
| FE (`apps/app`, `vitest run --no-file-parallelism`) | cần `pnpm --filter @mediaos/ui build` + `@mediaos/web-core build` trước (dist chưa build sẵn — setup, không phải bug) | 137 | 941 | ✅ XANH 100% |

**KHÔNG có RED THẬT nào trong AUTH/HR/ATT/LEAVE (S0–S3)** — toàn bộ pass. RED DUY NHẤT phát hiện (NOTI module,
`my-notifications.int-spec.ts`, KHÔNG phải S0-S3) là fragility test-planner cô lập (QA2-MED-001) — KHÔNG phải
regression chức năng. Flake đã biết trong done_when gốc (`super-admin-bootstrap` grant-count, outbox idempotency,
storage/MinIO) — KHÔNG gặp lại lần nào trong 2 lần chạy full batch này.

## 5. Release note Sprint 4 (tóm tắt)

- **TASK**: project/task CRUD, assign/status/priority/deadline, comment+mention, checklist, kanban, watcher,
  activity log, due-soon/overdue job — outbox producer đầy đủ 8 event (§9.4).
- **NOTI**: NotificationEngineService (intake, catalog, template render + fallback non-silent, dedupe 2 tầng,
  recipient resolver actor-exclusion), My-Notification API (list/dropdown/unread-count/detail/mark-read/
  mark-all-read/delete, own-scope tuyệt đối), Admin (template CRUD company-override), delivery log append-only.
- **DASH**: 16 widget (7 in-sprint + 9 catalog-2), cache per-user TTL theo module, degraded state
  (Promise.allSettled, không sập cả dashboard), cache invalidation qua OutboxWorker cho TASK/LEAVE/ATT (NOTI
  chưa wire thật — QA2-HIGH-001), quick_actions metadata theo quyền viewer.
- **INT bridge**: `TaskNotiBridgeRegistrar` (8 mapping TASK/PROJECT→NOTI), `DashboardCacheInvalidationRegistrar`
  (TASK/LEAVE/ATT→DASH), cả hai đăng ký tại boot qua `OutboxWorker`, idempotent 2 tầng
  (`processed_events` + `DedupeKey`).
- **Gap chặn "ĐẠT" tuyệt đối**: deep-link (QA2-CRIT-001) — xem known-issues.

## 6. Verdict dự kiến

**ĐẠT CÓ ĐIỀU KIỆN** — mọi luồng nghiệp vụ P0 (assign/notify/mark-read/unread-count/dashboard-refresh/degraded/
regression S0-S3) hoạt động đúng và có test thật (155/161 file int-spec + 192 unit + 137 FE, tất cả XANH thật
trên `LANE_DB=mediaos_s4qa2`); điều kiện:
- **QA2-CRIT-001** (deep-link target_url luôn NULL mặc định — toàn hệ thống, mọi module) VÀ
- **QA2-CRIT-002** (nội dung notification CÂM cho comment/mention/project-member-added — 3/8 event TASK/PROJECT)

PHẢI có WO fix riêng (nối tiếp pattern `0490`, ngoài paths của lane QA-2 này) TRƯỚC khi công bố "notification"
là tính năng hoàn chỉnh cho end-user Sprint 4 — hiện tại: (a) deep-link chỉ hoạt động nếu company admin tự cấu
hình template override; (b) 3/8 loại notification TASK/PROJECT hiển thị placeholder chưa điền nguyên văn cho
user (trải nghiệm THẤY LỖI trực diện, không chỉ thiếu tính năng). QA2-HIGH-001 (dashboard NOTIFICATIONS stale
≤10s) và QA2-MED-001 (test-planner fragility) KHÔNG chặn "ĐẠT" — nêu để Sprint 5 theo dõi.
