# S20-NOTI-PRIORITYFILTER-1 — lọc priority khớp hiển thị + mark-all-read theo bộ lọc

## Quyết định
1. `priority=Normal` ở GET list VÀ mark-all-read dùng chung `priorityCond` (repository):
   `priority = 'Normal' OR priority IS NULL`; mức khác khớp đúng. Lý do dạng OR thay vì
   `coalesce(priority,'Normal')`: không bọc hàm lên cột nên vẫn BitmapOr được nếu sau này có index
   priority. Hiện KHÔNG có index priority (chỉ index recipient_*), nên mọi dạng đều lọc trên tập đã thu
   hẹp bởi `(company_id, recipient_user_id)`. Cần index priority ⇒ NỢ, không làm ở WO này (cấm migration).
2. Contracts: `markAllNotificationsReadRequestSchema` thêm `priority` (enum, nullable, optional) —
   tương thích ngược. `created_before` ĐÃ có sẵn ở BE.
3. PHÁT HIỆN: `created_before` ở mark-all-read trả 400 `invalid_union` trên pipeline thật
   (ZodValidationPipe toàn cục + `@UsePipes` của controller parse HAI lần; lần 2 nhận `Date` mà
   `coerceDate()` từ chối). Spec cũ không bắt được vì không có pipe toàn cục. Vá trong contracts:
   `idempotentDateInput()` (Date ⇒ ISO trước khi giải mã), cục bộ cho body này, không đụng `coerceDate`.
   Ca int-spec mới dùng `applyMainPipeline` nên chặn được hồi quy.
4. FE: «đánh dấu theo bộ lọc» gửi `{source_module?, priority?, created_before = mốc tải danh sách}` MỘT
   lời gọi; bỏ `MarkPageReadButton` (vòng gọi từng dòng).

## ĐO strip hay reject (quan trọng cho thứ tự deploy)
Zod object mặc định STRIP khoá lạ; DTO nestjs-zod không `.strict()`. API CŨ nhận `{priority:"High"}`
sẽ BỎ priority lặng lẽ ⇒ mark-all-read đánh dấu MỌI thông báo chưa đọc (cả theo source_module). Ghim ở
`packages/contracts/src/my-notification.spec.ts` (ca «khoá lạ bị STRIP»).
**Khuyến nghị: PR TÁCH. PR BE (commit 1) merge + deploy API PROD trước; PR FE (commit 2) chỉ merge sau
khi API PROD đã có bản mới** (FE tự lên Pages khi merge, API deploy tay).
Ghi chú: created_before vốn 400 trên API cũ ⇒ FE mới trên API cũ lỗi 400 (không đánh dấu nhầm) khi có
mốc; nhưng ca chỉ-priority mà không mốc sẽ bị strip — vì vậy FE luôn gửi mốc, và vẫn phải đợi API.

## done_when → test
- Lọc Normal gồm NULL: `test/integration/my-notifications-priority.int-spec.ts` ca 1–2 (NULL có trong
  Normal, không có trong High/Low).
- mark-all-read priority + created_before: ca 3–5 (hàng sau mốc / priority khác / công ty khác không bị đụng;
  priority rác bị từ chối).
- Contracts: `my-notification.spec.ts`. FE: spec `NotificationListPage*`.
- Deny/cross-tenant: chạy lại `my-notifications.int-spec.ts`, `notifications-tenant-isolation.int-spec.ts`,
  `noti-qa-permission.int-spec.ts`.

## Nợ
- Index priority (nếu bảng lớn) ⇒ WO db-migration.
- GET list `created_from/created_to` dùng `coerceDate()` ⇒ cùng nguy cơ pipe kép (chưa đo trên PROD; ngoài phạm vi).
