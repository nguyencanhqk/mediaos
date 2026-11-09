# S20-NOTI-TARGETURL-1 — target_url mở đúng bản ghi (plan, 09/11/2026 — bản 2 sau review đối kháng)

> Zone đỏ, gate FULL. Nguồn: `docs/plans/S20-WORKUX-STORIES.md` §6 Đợt 3 + §7 Q7 = B. Khuôn: migration 0497.
> Nền: `5b5a3222` (master), worktree `MediaOS-w3t`, nhánh `feat/s20-noti-targeturl-1`. Head migration = 0592 (journal idx 259).
> Owner chọn «Chạy Đợt 3 ngay» qua hộp hỏi 09/11/2026 ~14:05 (ước 825 USD cả đợt; tổng đo trước đợt 8.349 USD).

## 1. Đo hiện trạng (mã thật)

| template_code (global, IN_APP vi-VN) | Đích hiện tại (0497) | Đích mới | Producer · khoá payload thật |
| --- | --- | --- | --- |
| `TASK_DUE_SOON__IN_APP__vi-VN` | `/tasks/my-tasks` | `/tasks/{taskId}` | `task-reminder.job-handler.ts` `fireSafe`: payload CHỈ có `{task_title, due_at}` ⇒ **thêm `taskId: task.id`** |
| `TASK_OVERDUE__IN_APP__vi-VN` | `/tasks/my-tasks` | `/tasks/{taskId}` | như trên (producer duy nhất, grep `TASK_OVERDUE` trong `src/`) |
| `TASK_COMMENT_CREATED__IN_APP__vi-VN` | `/tasks/{taskId}` | `/tasks/{taskId}?comment_id={commentId}` | `task-comments.service.ts` `commentPayload()`: ĐÃ có `taskId` + `commentId` (producer duy nhất `task.comment_created`); bridge không có `payloadOf` ⇒ payload đi nguyên |
| `TASK_MENTIONED__IN_APP__vi-VN` | `/tasks/{taskId}` | `/tasks/{taskId}?comment_id={commentId}` | cùng `commentPayload()` + `mentionedUserIds` |
| `LEAVE_REQUEST_SUBMITTED__IN_APP__vi-VN` | `/leave/approvals` | `/leave/approvals?request={requestId}` | `leave-request.service.ts:503`: payload có `requestId` (producer duy nhất `leave.request.submitted`); người nhận là quản lý (`leave-noti-bridge.registrar.ts registerSubmitted`) |
| `LEAVE_REQUEST_APPROVED/REJECTED/CANCELLED/REVOKED` | `/leave/me/requests/{requestId}` | **GIỮ NGUYÊN** (gửi chủ đơn) | — |

Đo thêm:

- Renderer `interpolate()` giữ nguyên `{key}` khi thiếu khoá ⇒ engine `assertInternalTargetUrl` (`^\/(?!\/)[\w\-./?=&%#]*$`) ném 422, KHÔNG tạo thông báo. `?`, `=`, `_` nằm trong lớp ký tự ⇒ đích mới hợp lệ khi đủ khoá.
- Template ghi đè theo công ty: `upsertCompanyOverride` (`notification-template.repository.ts:176`) CHÉP `target_url_template` của nguồn khi PATCH không gửi trường này ⇒ override chỉ sửa tiêu đề vẫn mang đích cũ y hệt global.
- FE: `isSafeInternalTarget` (`NotificationTargetLink.tsx`) đã nhận mọi đường bắt đầu bằng đúng một `/` (kể cả query) ⇒ KHÔNG cần đổi luật, chỉ thêm ca test.
- FE: `taskIdFromPath` (`task-drawer-nav.ts`, regex `^/tasks/([^/?#]+)/?$`) **KHÔNG khớp** `/tasks/<uuid>?comment_id=…` ⇒ hiện sẽ rơi về `navigate({href})` sang trang toàn màn thay vì drawer.
- FE: `TaskCommentThread` đọc `comment_id` từ `window.location.search` MỘT LẦN (lazy `useState`, dòng 414–418) và không kiểm UUID. Query `taskKeys.comments(taskId)` có `staleTime: 30_000` (dòng 425–429), không thấy đường realtime nào invalidate danh sách bình luận ⇒ bình luận vừa tạo thường CHƯA có trong cache khi người dùng bấm thông báo; mở lại drawer trong 30 giây cũng không refetch khi mount.
- FE: tab «Bình luận» chỉ là tab MẶC ĐỊNH của nhóm trao đổi (`TaskDetailContent:332` `useState("comments")`). Người dùng đã chuyển sang tab khác ⇒ thread KHÔNG mount (Tabs gỡ nội dung tab không hoạt động). `requestCommentFocus()` (`task-drawer-nav.ts:52`) chuyển `collabTab` về «comments» nhưng đồng thời `setFocusComposer(true)` (`TaskDetailContent:339–345`).
- FE: `/leave/approvals?request=` đã có (#663: `leave-approval-search.ts`, `LeaveApprovalPage` tra trong phạm vi duyệt, không thấy ⇒ `approval-request-not-found` chung). Drawer việc: 404/403/xoá mềm ⇒ `taskDrawer.unavailable` chung (#618).
- **Census int-spec theo 5 mã đổi đích** (grep `TASK_COMMENT_CREATED|TASK_MENTIONED|TASK_DUE_SOON|TASK_OVERDUE|LEAVE_REQUEST_SUBMITTED` trong `apps/api/test` + `apps/api/src/**/*.int.spec.ts`: 9 tệp):

  | Tệp | Đường vào | Ảnh hưởng của 0593 |
  | --- | --- | --- |
  | `s5-noti-fix1-deeplink.int-spec.ts` | đọc template + bridge thật | **ĐỎ**: 4 khẳng định đích cũ (dòng 174, 182, 193–198, 230) |
  | `noti-event-intake.int-spec.ts` | `POST /internal/v1/notifications/events`, `body()` mặc định payload `{taskId, taskTitle}` (dòng 212–218) | **ĐỎ**: ca (b) dòng ~305 và (b2) dòng ~376–380 gửi TASK_COMMENT_CREATED không có `commentId` ⇒ 422 thay vì 200 |
  | `noti-qa-permission.int-spec.ts` | `POST /internal/v1/notifications/events`, C09 dòng 550–560, payload `{taskId, taskTitle}` | **ĐỎ**: C09 TASK_COMMENT_CREATED không có `commentId` ⇒ 422 |
  | `task-reminder-job.int-spec.ts` | `TaskReminderJobHandler.run` thật qua engine (R10 bọc `engine.intake`) | Đỏ nếu L2 lên mà L1 chưa lên (payload thiếu `taskId` ⇒ 422 ⇒ `failed`). L1 + L2 cùng commit ⇒ xanh; đây là hồi quy chứng minh |
  | `task-noti-e2e.int-spec.ts` (6)(7) | POST bình luận thật ⇒ `commentPayload()` có `commentId` | Không đổi khẳng định (đếm hàng + nội dung, không khẳng định đích) |
  | `task-comments-checklists.int-spec.ts` | producer thật | Không khẳng định đích |
  | `leave-noti-e2e.int-spec.ts` | producer thật (`requestId` có sẵn) | Không khẳng định đích |
  | `dashboard-cache-invalidate.int-spec.ts` | producer thật | Không khẳng định đích |
  | `qa2-e2e-task-noti-dash.int-spec.ts` | E4 khẳng định `/tasks/${taskId}` của **TASK_ASSIGNED** | Không đổi |

  Các int-spec khác khẳng định `/tasks/${taskId}` đều là `TASK_ASSIGNED` (qa2-e2e, qae2e1, noti-deeplink-perm-lost). Implementer chạy lại grep trên trước khi chạy test; tệp mới xuất hiện thì bổ sung bảng.
- **Cách PROD áp migration**: không chạy lúc boot (`apps/api/src/main.ts` không gọi `migrate`). `m prod-update` chạy build → snapshot `--no-activate` → migrate (fail-closed) → activate (`scripts/release-artifact.mjs:192–199`). FE (Pages) lên tự động từ master, thường TRƯỚC BE. `m prod-rollback` KHÔNG đảo migration.

## 2. Quyết định

- **D1 — Một migration thuần data `0593_s20notitargeturl1_target_url_record.sql`**, journal idx 260, `when` 1717587382000 (> 0592). Không DDL/RLS/grant/policy, không chạm `notifications` đã phát (đích cũ vẫn mở được vì là trang danh sách).
- **D2 — Global: UPDATE theo khoá đầy đủ + điều kiện giá trị CŨ chính xác**: `company_id IS NULL AND deleted_at IS NULL AND template_code = X AND channel = 'IN_APP' AND locale = 'vi-VN' AND target_url_template = <đích 0497>`, `SET target_url_template = <đích mới>, updated_at = now()`. Chạy lại ⇒ 0 hàng đổi. Hàng đã khác cả cũ lẫn mới (sửa tay) ⇒ không đè (xem D4c).
- **D3 — Override theo công ty: CHỐT cập nhật theo dấu vân tay.** Predicate: `company_id IS NOT NULL AND deleted_at IS NULL AND template_code = X AND channel = 'IN_APP' AND locale = 'vi-VN' AND target_url_template = <đích 0497>`, `SET target_url_template = <đích mới>, updated_at = now()`, **KHÔNG đổi `updated_by`** (migration không phải người dùng). Override đã xoá mềm ⇒ GIỮ nguyên. Override có đích khác đích cũ ⇒ GIỮ, `RAISE NOTICE` số lượng theo template_code (không in company_id). Lý do: copy-on-write (§1) làm override mang đích cũ dù admin không chọn; không cập nhật thì công ty đó lệch im lặng mãi. Admin cố ý đặt đúng chuỗi cũ thì không phân biệt được: chấp nhận, ghi ở SPEC-08.
- **D4 — Verify sau UPDATE, khớp D2** (khối `DO $$` cuối migration, chỉ xét 5 mã):
  - (a) 0 hàng global `deleted_at IS NULL` còn đích CŨ ⇒ nếu > 0: `RAISE EXCEPTION` kèm danh sách template_code (UPDATE không áp được là lỗi thật).
  - (b) Mỗi mã có ≥1 hàng global `deleted_at IS NULL` ⇒ thiếu: `RAISE EXCEPTION`. **Ném là cố ý**: thiếu template global là seed 0481 hỏng, và producer của mã đó đang không phát được thông báo; chặn deploy để lộ ra thay vì lệch im lặng. Census trước merge (dưới) loại trừ khả năng này trên PROD.
  - (c) Hàng global active mang giá trị KHÁC cả cũ lẫn mới ⇒ `RAISE NOTICE` (template_code + giá trị), KHÔNG ném. Trùng nhiều hàng global active cùng mã ⇒ UPDATE áp cho mọi hàng khớp, NOTICE số lượng, không ném.
- **D4' — Census PROD chỉ đọc (owner chạy TRƯỚC merge, kết quả dán vào PR):**
  ```sql
  SELECT template_code,
         (company_id IS NULL) AS is_global,
         (deleted_at IS NULL) AS is_active,
         target_url_template,
         count(*)
    FROM notification_templates
   WHERE channel = 'IN_APP' AND locale = 'vi-VN'
     AND template_code IN ('TASK_DUE_SOON__IN_APP__vi-VN','TASK_OVERDUE__IN_APP__vi-VN',
                           'TASK_COMMENT_CREATED__IN_APP__vi-VN','TASK_MENTIONED__IN_APP__vi-VN',
                           'LEAVE_REQUEST_SUBMITTED__IN_APP__vi-VN')
   GROUP BY 1,2,3,4 ORDER BY 1,2 DESC,3 DESC,4;
  ```
  Đạt khi: mỗi mã có đúng 1 hàng global active mang đích cũ; mọi override khác đích cũ được liệt kê trong PR (sẽ bị GIỮ).
- **D5 — Khoá placeholder dùng tên payload sẵn có** (`taskId`, `commentId`, `requestId`); tham số URL bình luận giữ `comment_id` (trang toàn màn đã đọc). Không thêm khoá nhạy cảm (không thuộc `SENSITIVE_PAYLOAD_KEYS`).
- **D6 — FE mở bình luận trong DRAWER** (KHÔNG sửa `TaskDetailContent*` vì thuộc chuỗi A; `withTask` KHÔNG đổi):
  - `taskTargetFromUrl(url) → {taskId, commentId|null} | null` (quy tắc DƯƠNG: path đúng `/tasks/<uuid>`, query chỉ xét `comment_id` và phải qua `isTaskUuid`; khác ⇒ `commentId = null` nhưng vẫn mở drawer). `taskIdFromPath` giữ cho caller cũ (bọc lại `taskTargetFromUrl`).
  - `openTask(taskId, {commentId})` **KHÔNG thêm gì vào URL**: chỉ phát yêu cầu làm nổi qua tín hiệu mô-đun `requestCommentHighlight({taskId, commentId})`, lưu `{seq, taskId, commentId}` (seq tăng dần) và đọc qua `useSyncExternalStore` (cùng khuôn `commentFocusRequests`). `openTask(taskId)` không có `commentId` và `closeTask()` ⇒ `clearCommentHighlight()` (yêu cầu treo không sống quá phiên drawer của việc đó).
  - **(bản 3, sau review lượt 2)** KHÔNG tiêu thụ độc quyền toàn mô-đun. Mỗi `TaskCommentThread` (taskId T) giữ ref `handledSeq` RIÊNG: gặp yêu cầu `taskId === T` có `seq > handledSeq` (kể cả lúc mount) thì làm nổi và cập nhật ref của chính nó. Thread nền ở trang toàn màn `/tasks/T` và thread trong drawer đều làm nổi, không cướp tín hiệu của nhau. Vòng đời yêu cầu do `closeTask()` / `openTask(id)` không `commentId` xoá. Quay lại tab Bình luận trong cùng phiên drawer ⇒ làm nổi lại (chấp nhận).
  - **StrictMode:** trạng thái làm nổi nằm trong state/ref của instance, đặt ngay lần chạy effect đầu, cleanup KHÔNG xoá ⇒ mount→cleanup→mount không mất làm nổi và không tải danh sách hai lần (ref `refetchedKey` sống qua remount mô phỏng). Có ca spec bọc `<StrictMode>`.
  - Nguồn làm nổi: yêu cầu tín hiệu (nếu có) ?? `comment_id` URL lúc mount (chỉ nhận khi qua `isTaskUuid`, rác ⇒ bỏ qua).
  - **Cache cũ**: có yêu cầu làm nổi mà danh sách đã tải xong (không đang fetch) và không chứa id ⇒ `queryClient.invalidateQueries({ queryKey: taskKeys.comments(taskId) })` **ĐÚNG MỘT LẦN cho mỗi yêu cầu** (ref giữ khoá `seq` hoặc `url:<id>` đã refetch). Refetch xong vẫn không thấy ⇒ không làm nổi, không hiện thông điệp.
  - **Tab khác đang mở**: KHÔNG tự chuyển tab (chọn «ngoài phạm vi», vì cách duy nhất không sửa `TaskDetailContent*` là `requestCommentFocus()`, mà nó bật focus ô soạn cùng lúc, tranh cuộn với `scrollIntoView` của bình luận). Hành vi: yêu cầu treo, chưa tiêu thụ; người dùng quay lại tab «Bình luận» ⇒ thread mount, tiêu thụ yêu cầu (taskId khớp) ⇒ làm nổi. Spec khẳng định cả hai nửa. Tự chuyển tab ghi vào §6 nợ (cần chuỗi A).
  - Chấp nhận: tải lại trang khi drawer đang mở thì mất làm nổi (yêu cầu không nằm trên URL). Mở thông báo trong tab mới (href) ⇒ trang toàn màn `/tasks/:id?comment_id=` như hiện nay. Drawer mở trên trang toàn màn có `?comment_id=` của trang: thread trong drawer đọc cùng `comment_id` URL ⇒ tối đa 1 GET danh sách thừa (giới hạn bởi luật refetch-một-lần), không làm nổi sai vì id không thuộc việc đó.
- **D7 — Thứ tự deploy + runbook rollback:**
  - **Thứ tự rollback (bản 3):** (1) chạy khối Down; (2) chạy câu kiểm tra, kỳ vọng 0 hàng; (3) MỚI `m prod-rollback`. Chạy Down TRƯỚC là an toàn vì mã mới (payload thêm `taskId`) vẫn chạy bình thường với template cũ; rollback mã trước thì mọi lượt nhắc hạn trong khoảng giữa đều 422. Muốn lên lại mã mới ⇒ chạy tay khối Up hoặc ra migration 0594.
  - Thay đổi producer (thêm `taskId` vào payload nhắc hạn) **tương thích ngược** với template cũ (khoá thừa bị bỏ qua) ⇒ thứ tự an toàn: mã mới lên CÙNG hoặc TRƯỚC migration. `m prod-update` làm đúng thứ tự này (migrate rồi mới activate) ⇒ cửa sổ 422 chỉ là khoảng giữa migrate xong và tiến trình mới activate. Job nhắc hạn của tiến trình cũ chạy trong cửa sổ đó ⇒ việc đó 422 ⇒ `failed++` (log ERROR) và lượt sau phát lại (pre-check dedupe chỉ thấy hàng đã tạo).
  - FE lên trước BE: FE mới vẫn xử lý đích cũ (`/tasks/my-tasks`, `/tasks/{id}`, `/leave/approvals`). BE mới với FE cũ: `/tasks/x?comment_id=` rơi về trang toàn màn (đọc `comment_id`), `/leave/approvals?request=` đã có từ #663 ⇒ không hỏng chiều nào.
  - **Rollback mã mà giữ migration** ⇒ nhắc hạn 422 cho từng việc, mọi lượt. `m prod-rollback` không đảo migration ⇒ PHẢI chạy tay khối Down (chép trong PR và trong chú thích cuối migration):
    ```sql
    -- Down 0593: đảo theo điều kiện = đích MỚI, cả global lẫn override active (đối xứng D2/D3)
    UPDATE notification_templates SET target_url_template = '/tasks/my-tasks', updated_at = now()
     WHERE deleted_at IS NULL AND channel='IN_APP' AND locale='vi-VN'
       AND template_code IN ('TASK_DUE_SOON__IN_APP__vi-VN','TASK_OVERDUE__IN_APP__vi-VN')
       AND target_url_template = '/tasks/{taskId}';
    UPDATE notification_templates SET target_url_template = '/tasks/{taskId}', updated_at = now()
     WHERE deleted_at IS NULL AND channel='IN_APP' AND locale='vi-VN'
       AND template_code IN ('TASK_COMMENT_CREATED__IN_APP__vi-VN','TASK_MENTIONED__IN_APP__vi-VN')
       AND target_url_template = '/tasks/{taskId}?comment_id={commentId}';
    UPDATE notification_templates SET target_url_template = '/leave/approvals', updated_at = now()
     WHERE deleted_at IS NULL AND channel='IN_APP' AND locale='vi-VN'
       AND template_code = 'LEAVE_REQUEST_SUBMITTED__IN_APP__vi-VN'
       AND target_url_template = '/leave/approvals?request={requestId}';
    -- Kiểm tra sau Down: kỳ vọng 0 hàng
    SELECT template_code, company_id IS NULL AS is_global, target_url_template
      FROM notification_templates
     WHERE deleted_at IS NULL AND channel='IN_APP' AND locale='vi-VN'
       AND (    target_url_template IN ('/tasks/{taskId}?comment_id={commentId}',
                                        '/leave/approvals?request={requestId}')
            OR (template_code IN ('TASK_DUE_SOON__IN_APP__vi-VN','TASK_OVERDUE__IN_APP__vi-VN')
                AND target_url_template = '/tasks/{taskId}'));
    ```
    Down KHÔNG xoá hàng `drizzle.__drizzle_migrations` (lần deploy sau sẽ không áp lại 0593; khi lên lại mã mới phải chạy tay khối Up hoặc ra migration 0594 mới). Ghi rõ trong PR.

## 3. Lát thi công

- **L0 (orchestrator, commit backlog riêng; bước này KHÔNG sửa backlog):** mở rộng `paths`: `apps/app/src/routes/tasks/task-drawer-nav*.ts`, `apps/api/test/integration/s5-noti-fix1-deeplink.int-spec.ts`, `apps/api/test/integration/noti-event-intake.int-spec.ts`, `apps/api/test/integration/noti-qa-permission.int-spec.ts` (glob hiện tại `*target*` / `*notification*` / `*reminder*` không phủ). Không chạm tệp chuỗi A/G/S/#580.
- **L1 BE (RED trước):**
  - `apps/api/src/notifications/task-reminder.job-handler.spec.ts`: ca payload intake có `taskId === task.id` cho cả DUE_SOON/OVERDUE (đỏ trước khi sửa).
  - `apps/api/src/notifications/task-reminder.job-handler.ts`: `payload: { taskId: task.id, task_title, due_at }`.
  - L1 và L2 cùng commit (nếu không, `task-reminder-job.int-spec` đỏ giữa hai commit).
- **L2 Migration:** `apps/api/migrations/0593_s20notitargeturl1_target_url_record.sql` (D1–D4, khối Down D7 dạng chú thích) + mục journal idx 260.
- **L3 Int-spec:**
  - Mới `apps/api/test/integration/s20-noti-targeturl1.int-spec.ts` (`applyMainPipeline`, `describe.skipIf(!hasLaneDb)`, `appPool`/`directPool` như s5-noti-fix1): xem §4.
  - Sửa `s5-noti-fix1-deeplink.int-spec.ts`, đủ 4 chỗ (giữ nguyên các ca khác):
    1. dòng ~172–174: `TASK_COMMENT_CREATED__IN_APP__vi-VN` ⇒ `/tasks/{taskId}?comment_id={commentId}`;
    2. dòng ~182–184: `LEAVE_REQUEST_SUBMITTED__IN_APP__vi-VN` ⇒ `/leave/approvals?request={requestId}`;
    3. ca (c) dòng 193–198: **viết lại** cả tên, chú thích và khẳng định thành «(c) TASK_DUE_SOON/OVERDUE template = `/tasks/{taskId}` (job payload có `taskId` từ 0593)», khẳng định cả hai mã; cập nhật dòng mô tả (c) ở khối chú thích đầu tệp (dòng 17);
    4. ca (b) COMMENT_CREATED dòng ~216–231: giữ `commentId` vào biến (`const commentId = randomUUID()`), khẳng định `/tasks/${taskId}?comment_id=${commentId}`, đổi tên ca cho khớp.
  - Sửa `noti-event-intake.int-spec.ts`: ca (b) (~305) và (b2) (~376–380) thêm `commentId: randomUUID()` vào payload TASK_COMMENT_CREATED (ghi đè `payload` trong `body({...})`, giữ `taskId`); chú thích cạnh `body()` thêm mốc 0593: «TASK_COMMENT_CREATED/MENTIONED cần thêm `commentId` từ 0593».
  - Sửa `noti-qa-permission.int-spec.ts` C09 (~550–560): payload `{ taskId: sourceEntityId, commentId: randomUUID(), taskTitle }` + chú thích mốc 0593.
- **L4 FE:**
  - `apps/app/src/routes/tasks/task-drawer-nav.ts` (+ `.spec.ts`): `taskTargetFromUrl`, `openTask(…, {commentId})`, `requestCommentHighlight` / `clearCommentHighlight` / `subscribeCommentHighlight` / `getCommentHighlight` / consume theo D6. `withTask` KHÔNG đổi. `taskIdFromPath` bọc lại.
  - `apps/app/src/components/notifications/NotificationTargetLink.tsx` (+ `.spec.tsx`): dùng `taskTargetFromUrl`.
  - `apps/app/src/routes/tasks/TaskCommentThread.tsx` (+ `.spec.tsx`): nguồn làm nổi theo D6, kiểm UUID cho `comment_id` URL, refetch-một-lần, chỉ phản ứng khi `taskId` khớp.
  - Không thêm chuỗi i18n mới (DENY dùng thông điệp chung có sẵn).
- **L5 Docs:** SPEC-08 thêm bảng «target_url theo sự kiện» cạnh mục danh sách thông báo (~dòng 779) + quy tắc override D3; SPEC-06 §14.17 «Thông báo» ghi đích `/tasks/{taskId}` mở drawer; SPEC-06 bình luận (§14.14) ghi `?comment_id=` + hành vi làm nổi (refetch một lần, tab khác ⇒ làm nổi khi quay lại); SPEC-05 §19.1/19.2 ghi đích người duyệt `/leave/approvals?request={requestId}` khác chủ đơn `/leave/me/requests/{requestId}`; DB-07 cột `target_url_template` (~dòng 640) ghi placeholder hợp lệ + mốc 0593.

## 4. Ca RED (DENY đứng cạnh ALLOW)

Int-spec (BE, LANE_DB):

- ALLOW: 5 template global mang đích mới đúng chuỗi; template chủ đơn (APPROVED…) vẫn `/leave/me/requests/{requestId}`.
- ALLOW: chạy `TaskReminderJobHandler.run` cho việc hạn trong 24h ⇒ `notifications.target_url = /tasks/<taskId>` của người phụ trách; việc quá hạn ⇒ cùng đích cho phụ trách + reporter. Không chứa `{`/`}`, khớp regex engine.
- ALLOW: POST bình luận ⇒ TASK_COMMENT_CREATED (watcher) và TASK_MENTIONED (người được nhắc) có `/tasks/<taskId>?comment_id=<commentId>`.
- ALLOW: nhân viên gửi đơn ⇒ quản lý nhận `/leave/approvals?request=<requestId>`.
- DENY (lớp cũ không tái phát): payload thiếu `taskId` (gọi `engine.intake` với payload cũ của job) ⇒ 422 `TargetUnavailableError`, 0 hàng thông báo, đứng cạnh ca ALLOW có `taskId`. Tương tự TASK_COMMENT_CREATED thiếu `commentId` ⇒ 422, đứng cạnh ca có `commentId`.
- DENY phạm vi: người nhận mất quyền / việc xoá mềm ⇒ `GET /me/notifications/:id` không lộ tiêu đề việc (hồi quy `noti-deeplink-perm-lost`); công ty B không đọc thông báo/đơn của công ty A (RLS).
- Migration: chạy lại SQL 0593 bằng `directPool` ⇒ 0 hàng đổi (`updated_at` global không đổi); override chép (đích cũ, active) của công ty test ⇒ thành đích mới, `updated_by` giữ nguyên; override tuỳ biến ⇒ giữ nguyên; **override xoá mềm mang đích cũ ⇒ GIỮ đích cũ**. Chạy khối Down D7 trong transaction rồi ROLLBACK ⇒ câu kiểm tra sau Down trả 0 hàng trong transaction (chứng minh Down đúng mà không làm bẩn lane). Dọn hàng override ở afterAll (đánh dấu theo company test).

FE spec:

- ALLOW: bấm `/tasks/<uuid>?comment_id=<uuid>` ⇒ `openTask(taskId,{commentId})`, KHÔNG `navigate({href})`, URL không thêm `comment_id`.
- ALLOW: drawer đang mở cùng việc, cache danh sách ĐÃ chứa bình luận ⇒ làm nổi, 0 lời gọi danh sách thêm.
- ALLOW: cache danh sách cũ KHÔNG chứa bình luận ⇒ đúng 1 lần tải lại danh sách ⇒ làm nổi (bộ giả trả danh sách mới có bình luận ở lần gọi thứ 2).
- ALLOW: drawer đang đóng ⇒ `openTask` rồi thread mount ⇒ tiêu thụ yêu cầu ⇒ làm nổi.
- ALLOW/hành vi tab: đang ở tab khác ⇒ thread không mount, không lỗi, 0 lời gọi danh sách; chuyển về «Bình luận» ⇒ làm nổi.
- DENY: `comment_id` rác/không UUID ⇒ mở drawer, KHÔNG làm nổi, 0 lời gọi danh sách thêm; `/tasks/my-tasks` ⇒ điều hướng thường; `//evil`, `https://…` ⇒ không phải link (`isSafeInternalTarget` false).
- DENY: bình luận đã xoá (id không có cả sau refetch) ⇒ **tối đa 1 lần tải lại danh sách**, không làm nổi, không thông điệp lộ nội dung; việc 404/403 ⇒ `taskDrawer.unavailable` chung (hồi quy `TaskDetailDrawer.spec`).
- DENY: tín hiệu cho việc KHÁC (taskId không khớp) ⇒ thread không đổi, 0 lời gọi; yêu cầu đã tiêu thụ không làm nổi lại khi thread mount lần sau; `closeTask()` / `openTask(id)` không `commentId` ⇒ yêu cầu treo bị xoá.
- ALLOW/DENY: `/leave/approvals?request=<uuid>` ⇒ `navigate({href})`; đơn ngoài phạm vi ⇒ `approval-request-not-found` (hồi quy `LeaveApprovalPage.spec`).
- Hồi quy: trang toàn màn `/tasks/:id?comment_id=<uuid>` vẫn làm nổi; mở rồi đóng drawer việc con trên trang đó ⇒ `comment_id` của trang còn nguyên (withTask không đổi).

## 5. Hồi quy cần chạy (QUA run-heavy, theo tệp)

- API unit: `src/notifications/task-reminder.job-handler.spec.ts`, `notification-renderer.spec.ts`, `notification-engine.errors.spec.ts`.
- Int-spec: `s20-noti-targeturl1`, `s5-noti-fix1-deeplink`, `noti-event-intake`, `noti-qa-permission`, `task-reminder-job`, `task-noti-e2e`, `leave-noti-e2e`, `noti-deeplink-perm-lost`, `my-notifications`, `qa2-e2e-task-noti-dash` (đọc dòng Test Files: skipped = KHÔNG đạt).
- FE: `task-drawer-nav.spec.ts`, `NotificationTargetLink.spec.tsx`, `NotificationDropdown.spec.tsx`, `TaskCommentThread.spec.tsx`, `TaskDetailDrawer.spec.tsx`, `LeaveApprovalPage.spec.tsx`; mọi bề mặt dùng chung `useOpenNotificationTarget` (toast realtime `use-notification-realtime`, `NotificationListPage`, `NotificationDetailPage`, `NotificationsWidget`, `MeNotificationsPage`, `notifications-router-flow`) — chạy lọc theo tên `Notification`/`notification` (21 tệp, xanh).
- Typecheck api + app; eslint các tệp đổi; `bash harness/check.sh --all --lane-db` trước PR; FULL gate (security · database · silent-failure).
- PR phải kèm: kết quả census D4' (owner chạy), runbook rollback D7, KPI «nhắc hạn từ thông báo tới việc: 2 lượt bấm → 1».

## 5b. Sổ vết (thi công 09/11)

- RED BE: unit `task-reminder.job-handler.spec` 1 ca đỏ trên mã cũ; int-spec `s20-noti-targeturl1` 5/7 ca đỏ trên lane chưa có 0593 (2 ca DENY tenant/Down không phụ thuộc đích mới nên xanh sẵn).
- RED FE: `TaskCommentThread.spec` 6/26 ca đỏ khi tạm trả `TaskCommentThread.tsx` về bản cũ (ALLOW cache cũ/mount sau/hai thread/StrictMode + DENY); `task-drawer-nav.spec` và `NotificationTargetLink.spec` thêm ca đích mới.
- GREEN: int-spec 12 tệp xanh (không skip) · unit `src/notifications` xanh · FE 21 tệp lọc `Notification|TaskDetail|LeaveApproval` + nav + thread xanh · typecheck api + app xanh · eslint + prettier sạch.
- Override công ty: CHỐT cập nhật theo dấu vân tay (D3), có ca int-spec (đổi / giữ tuỳ biến / giữ xoá mềm / chạy lại).
- Lệch kế hoạch: `noti-event-intake` sửa ở `body()` mặc định (thêm `commentId`) thay vì từng ca (b)/(b2) — cùng hiệu ứng. Khối `SET LOCAL lock_timeout = 5s` thêm theo review. `RAISE NOTICE` số override đã cập nhật theo từng template_code (dán log migrate vào PR).
- Chưa làm (agent khác): KPI trình duyệt thật. **Sổ vết KPI: (điền sau)**.

## 6. Nợ / ngoài phạm vi

- Thông báo ĐÃ phát giữ đích cũ (đúng done_when), không backfill `notifications.target_url`.
- Các template khác còn đích tĩnh (ATT detection, HR, LEAVE balance): không thuộc WO.
- Bình luận đã xoá: chưa có gợi ý «bình luận không còn». Có thể gieo WO FE nhỏ nếu owner muốn.
- Drawer đang ở tab khác: chưa tự chuyển về «Bình luận» khi bấm thông báo (cần sửa `TaskDetailContent*`, thuộc chuỗi A; cần tách «chuyển tab» khỏi «focus ô soạn»).
- Tải lại trang khi drawer đang mở ⇒ mất làm nổi (yêu cầu không nằm trên URL).
- Payload nhắc hạn chỉ thêm `taskId`; chưa thêm `task_code` cho tiêu đề (WO khác nếu cần).

## 7. Phản biện (review đối kháng 09/11)

1. **HIGH: int-spec intake vỡ.** NHẬN. Đo lại: `noti-event-intake` (b)/(b2) và `noti-qa-permission` C09 gửi TASK_COMMENT_CREATED không có `commentId` ⇒ 422. Đã thêm census 9 tệp vào §1 (review nói 12 tệp; grep theo đúng 5 mã trên `apps/api/test` + `src/**/*.int.spec.ts` ra 9 tệp, bảng §1 liệt kê đủ cả 9), L0 mở `paths`, L3 sửa payload, §5 thêm `noti-qa-permission` (+ `task-noti-e2e`, `leave-noti-e2e`).
2. **HIGH: FE ALLOW chính xanh giả.** NHẬN. `staleTime: 30_000` đã đo. D6 thêm refetch-một-lần mỗi yêu cầu; ca DENY bình luận đã xoá đổi thành «tối đa 1 lần tải lại»; giữ «0 lời gọi» cho `comment_id` rác; thêm ca ALLOW cache cũ. Ca tab khác: chọn **ngoài phạm vi + spec khẳng định hành vi**, không dùng `requestCommentFocus()` vì nó gắn chặt `setFocusComposer(true)` (`TaskDetailContent:344`), tranh cuộn với bình luận, và tách ra cần sửa tệp chuỗi A. Yêu cầu treo vẫn được tiêu thụ khi người dùng quay lại tab ⇒ không mất hẳn.
3. **MEDIUM: D3 bỏ ngỏ, D2/D4 mâu thuẫn.** NHẬN. D3 chốt theo dấu vân tay với predicate chính xác, không đổi `updated_by`, override xoá mềm GIỮ (có ca int-spec). D4 viết lại: (a) còn đích cũ ⇒ ném; (b) thiếu global ⇒ ném CỐ Ý (lý do ghi ở D4); (c) giá trị khác cả cũ lẫn mới, hoặc trùng hàng ⇒ NOTICE, không ném. Thêm census D4' và khối Down đối xứng.
4. **MEDIUM: sót khẳng định s5-noti-fix1.** NHẬN. L3 liệt kê đủ 4 chỗ, ca (c) viết lại cả tên/lý do, ca (b) giữ `commentId` vào biến.
5. **MEDIUM: rollback/deploy.** NHẬN. D7 thêm runbook SQL Down + câu kiểm tra, ghi tương thích ngược của producer, và cách PROD áp migration (bước riêng trong `m prod-update`: migrate rồi activate, không chạy lúc boot) ⇒ cửa sổ 422 rất ngắn. Ghi thêm: Down không xoá hàng journal của drizzle.
6. **LOW: tín hiệu toàn cục.** NHẬN MỘT PHẦN. Nhận `{seq, taskId, commentId}` + chỉ phản ứng khi `taskId` khớp + ca spec «việc khác ⇒ không đổi». BÁC luật «seq lớn hơn giá trị thấy lúc mount» (khuôn `seenFocusRequest`): ở ca CHÍNH (drawer đang đóng), thread mount SAU `openTask` nên luật đó bỏ qua đúng yêu cầu cần xử lý. Thay bằng tiêu thụ một lần (`consumedSeq` mô-đun) + xoá yêu cầu treo khi `closeTask()` / `openTask` không `commentId`. Cách này chặn giá trị cũ nằm lại mà vẫn phục vụ ca mount-sau (kể cả ca quay lại tab).
7. **LOW: withTask bỏ `comment_id`.** NHẬN, giải bằng cách khác: drawer KHÔNG đưa `comment_id` lên URL nữa (yêu cầu đi qua tín hiệu), nên `withTask` giữ nguyên và `comment_id` của trang toàn màn không bao giờ bị xoá. Có ca hồi quy ở §4. Giá phải trả (tải lại trang mất làm nổi) ghi ở D6 + §6.
